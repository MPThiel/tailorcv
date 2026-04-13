const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const scraper = require('../agent/scraper');
const parser = require('../agent/parser');
const rewriter = require('../agent/rewriter');
const builder = require('../agent/builder');
const jobsDb = require('../db/jobs');

const router = express.Router();
const OUTPUTS_DIR = path.join(__dirname, '../data/outputs');

const upload = multer({
  dest: path.join(__dirname, '../data/uploads'),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.docx' || ext === '.pdf') return cb(null, true);
    cb(new Error('Only .docx and .pdf files are accepted.'));
  },
});

router.get('/jobs', async (req, res) => {
  try {
    const jobs = await jobsDb.getAllJobs();
    res.json(jobs);
  } catch (err) {
    console.error('[jobs]', err.message);
    res.status(500).json({ error: true, message: 'Could not read jobs.' });
  }
});

router.get('/jobs/:id', async (req, res) => {
  try {
    const job = await jobsDb.getJobById(req.params.id);
    res.json(job);
  } catch (err) {
    if (err.code === 'PGRST116') return res.status(404).json({ error: true, message: 'Job not found.' });
    console.error('[jobs/:id]', err.message);
    res.status(500).json({ error: true, message: 'Could not read job.' });
  }
});

router.get('/scrape', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: true, message: 'url query param required.' });
  try {
    const text = await scraper.scrape(url);
    res.json({ text });
  } catch (err) {
    console.error('[scrape]', err.message);
    if (err.message === 'SCRAPE_BLOCKED') {
      return res.status(422).json({ error: true, code: 'SCRAPE_BLOCKED', message: 'This job board blocks automated access.' });
    }
    res.status(500).json({ error: true, message: 'Could not scrape URL. Use paste option.' });
  }
});

router.post('/submit', upload.single('resume'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: true, message: 'Resume file is required.' });
  }

  const {
    client_name,
    job_title,
    company,
    job_url,
    job_text,
    preserve_format = 'ai',
    tone = 'keep',
    ats_mode = 'true',
    keyword_aggression = 'balanced',
    experience_range = '',
    current_salary = '',
    target_salary = '',
  } = req.body;

  if (!client_name) {
    return res.status(400).json({ error: true, message: 'Client name is required.' });
  }

  const id = crypto.randomUUID();
  const job = {
    id,
    client_name,
    job_title: job_title || '',
    company: company || '',
    job_url: job_url || '',
    status: 'pending',
    created_at: new Date().toISOString(),
    completed_at: null,
    output_file: null,
    keywords_matched: 0,
    ats_score: null,
    fit_score: null,
    experience_range: experience_range || null,
    current_salary: current_salary ? parseInt(current_salary, 10) : null,
    target_salary: target_salary ? parseInt(target_salary, 10) : null,
    gaps: [],
  };

  try {
    await jobsDb.createJob(job);
  } catch (err) {
    console.error(`[submit] Failed to create job:`, err.message);
    return res.status(500).json({ error: true, message: 'Failed to create job.' });
  }

  res.json({ id });

  const prefs = {
    preserve_format,
    tone,
    ats_mode: ats_mode === 'true',
    keyword_aggression,
    experience_range: experience_range || null,
  };

  runPipeline(id, req.file.path, req.file.originalname, job_text || '', job_url || '', prefs, client_name).catch((err) => {
    console.error(`[submit] [${id}] Unhandled pipeline crash:`, err.message);
    jobsDb.updateJob(id, { status: 'error', _step_error: 'Unexpected pipeline failure.' }).catch(() => {});
  });
});

async function runPipeline(id, resumePath, resumeOriginal, jobText, jobUrl, prefs, clientName) {
  console.log(`[submit] [${id}] Pipeline started.`);

  await jobsDb.updateJob(id, { status: 'processing', _step: 'parsing' });

  // Step 1: Parse resume
  console.log(`[submit] [${id}] Step 1: Parsing resume (${resumeOriginal})...`);
  let resumeText;
  try {
    resumeText = await parser.parse(resumePath, resumeOriginal);
    console.log(`[submit] [${id}] Step 1 complete. Resume text length: ${resumeText.length}`);
    await jobsDb.updateJob(id, { _step: 'scraped' });
  } catch (err) {
    console.error(`[submit] [${id}] Step 1 FAILED — Parse error:`, err.message);
    await jobsDb.updateJob(id, { status: 'error', _step_error: err.message });
    return;
  }

  // Step 2: Get job description
  console.log(`[submit] [${id}] Step 2: Getting job description...`);
  let jobDescription = jobText;
  if (!jobDescription && jobUrl) {
    try {
      console.log(`[submit] [${id}] No pasted text — scraping URL: ${jobUrl}`);
      jobDescription = await scraper.scrape(jobUrl);
      console.log(`[submit] [${id}] Step 2 complete. JD length: ${jobDescription.length}`);
      await jobsDb.updateJob(id, { _step: 'keywords' });
    } catch (err) {
      console.error(`[submit] [${id}] Step 2 FAILED — Scrape error:`, err.message);
      if (err.message === 'SCRAPE_BLOCKED') {
        await jobsDb.updateJob(id, { status: 'error', _step_error: 'This job board blocks automated access.', _error_code: 'SCRAPE_BLOCKED' });
      } else {
        await jobsDb.updateJob(id, { status: 'error', _step_error: `Job description fetch failed: ${err.message}` });
      }
      return;
    }
  } else {
    console.log(`[submit] [${id}] Step 2 complete. Using pasted job text (length: ${jobDescription.length}).`);
    await jobsDb.updateJob(id, { _step: 'keywords' });
  }

  if (!jobDescription) {
    console.error(`[submit] [${id}] Step 2 FAILED — No job description available.`);
    await jobsDb.updateJob(id, { status: 'error', _step_error: 'No job description provided.' });
    return;
  }

  // Step 3: Rewrite via Claude
  console.log(`[submit] [${id}] Step 3: Sending to Claude for rewrite...`);
  await jobsDb.updateJob(id, { _step: 'rewriting' });
  let result;
  try {
    result = await rewriter.rewrite(resumeText, jobDescription, prefs);
    console.log(`[submit] [${id}] Step 3 complete. Keywords: ${(result.keywords_matched || []).length}, ATS: ${result.ats_score}, Fit: ${result.fit_score}`);
  } catch (err) {
    console.error(`[submit] [${id}] Step 3 FAILED — Rewrite error:`, err.message);
    await jobsDb.updateJob(id, { status: 'error', _step_error: `AI rewrite failed: ${err.message}` });
    return;
  }

  // Step 4: Build .docx
  console.log(`[submit] [${id}] Step 4: Building .docx...`);
  await jobsDb.updateJob(id, { _step: 'building' });
  if (!fs.existsSync(OUTPUTS_DIR)) fs.mkdirSync(OUTPUTS_DIR, { recursive: true });

  let outputFile;
  try {
    const filename = `${id}.docx`;
    const outputPath = path.join(OUTPUTS_DIR, filename);
    await builder.build(result, outputPath, clientName);
    outputFile = filename;
    console.log(`[submit] [${id}] Step 4 complete. File: ${filename}`);
  } catch (err) {
    console.error(`[submit] [${id}] Step 4 FAILED — Builder error:`, err.message);
    await jobsDb.updateJob(id, { status: 'error', _step_error: `Document build failed: ${err.message}` });
    return;
  }

  await jobsDb.updateJob(id, {
    status: 'complete',
    completed_at: new Date().toISOString(),
    output_file: outputFile,
    keywords_matched: result.keywords_matched ? result.keywords_matched.length : 0,
    ats_score: result.ats_score || null,
    fit_score: result.fit_score != null ? result.fit_score : null,
    gaps: result.gaps || [],
    highest_education: result.highest_education || null,
    _step: 'done',
  });
  console.log(`[submit] [${id}] Pipeline complete.`);
}

module.exports = router;
