const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const scraper = require('../agent/scraper');
const parser = require('../agent/parser');
const rewriter = require('../agent/rewriter');
const builder = require('../agent/builder');

const router = express.Router();
const JOBS_FILE = path.join(__dirname, '../data/jobs.json');
const OUTPUTS_DIR = path.join(__dirname, '../data/outputs');

function readJobs() {
  if (!fs.existsSync(JOBS_FILE)) {
    fs.writeFileSync(JOBS_FILE, '[]');
  }
  return JSON.parse(fs.readFileSync(JOBS_FILE, 'utf8'));
}

function writeJobs(jobs) {
  fs.writeFileSync(JOBS_FILE, JSON.stringify(jobs, null, 2));
}

function updateJob(id, updates) {
  const jobs = readJobs();
  const idx = jobs.findIndex((j) => j.id === id);
  if (idx !== -1) {
    jobs[idx] = { ...jobs[idx], ...updates };
    writeJobs(jobs);
  }
}

const upload = multer({
  dest: path.join(__dirname, '../data/uploads'),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.docx' || ext === '.pdf') return cb(null, true);
    cb(new Error('Only .docx and .pdf files are accepted.'));
  },
});

router.get('/jobs', (req, res) => {
  try {
    const jobs = readJobs();
    res.json(jobs);
  } catch (err) {
    console.error('[jobs]', err.message);
    res.status(500).json({ error: true, message: 'Could not read jobs.' });
  }
});

router.get('/jobs/:id', (req, res) => {
  try {
    const jobs = readJobs();
    const job = jobs.find((j) => j.id === req.params.id);
    if (!job) return res.status(404).json({ error: true, message: 'Job not found.' });
    res.json(job);
  } catch (err) {
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
    _resume_path: req.file.path,
    _resume_original: req.file.originalname,
    _job_text: job_text || '',
    _prefs: { preserve_format, tone, ats_mode: ats_mode === 'true', keyword_aggression, experience_range: experience_range || null },
  };

  const jobs = readJobs();
  jobs.push(job);
  writeJobs(jobs);

  res.json({ id });

  // Run the pipeline asynchronously after responding
  runPipeline(id).catch((err) => {
    console.error(`[submit] [${id}] Unhandled pipeline crash:`, err.message);
    updateJob(id, { status: 'error', _step_error: 'Unexpected pipeline failure.' });
  });
});

async function runPipeline(id) {
  console.log(`[submit] [${id}] Pipeline started.`);
  const jobs = readJobs();
  const job = jobs.find((j) => j.id === id);
  if (!job) {
    console.error(`[submit] [${id}] Job not found in jobs.json — aborting.`);
    return;
  }

  updateJob(id, { status: 'processing', _step: 'parsing' });

  // Step 1: Parse resume
  console.log(`[submit] [${id}] Step 1: Parsing resume (${job._resume_original})...`);
  let resumeText;
  try {
    resumeText = await parser.parse(job._resume_path, job._resume_original);
    console.log(`[submit] [${id}] Step 1 complete. Resume text length: ${resumeText.length}`);
    updateJob(id, { _step: 'scraped' });
  } catch (err) {
    console.error(`[submit] [${id}] Step 1 FAILED — Parse error:`, err.message);
    updateJob(id, { status: 'error', _step_error: err.message });
    return;
  }

  // Step 2: Get job description
  console.log(`[submit] [${id}] Step 2: Getting job description...`);
  let jobDescription = job._job_text;
  if (!jobDescription && job.job_url) {
    try {
      console.log(`[submit] [${id}] No pasted text — scraping URL: ${job.job_url}`);
      jobDescription = await scraper.scrape(job.job_url);
      console.log(`[submit] [${id}] Step 2 complete. JD length: ${jobDescription.length}`);
      updateJob(id, { _step: 'keywords' });
    } catch (err) {
      console.error(`[submit] [${id}] Step 2 FAILED — Scrape error:`, err.message);
      if (err.message === 'SCRAPE_BLOCKED') {
        updateJob(id, { status: 'error', _step_error: 'This job board blocks automated access.', _error_code: 'SCRAPE_BLOCKED' });
      } else {
        updateJob(id, { status: 'error', _step_error: `Job description fetch failed: ${err.message}` });
      }
      return;
    }
  } else {
    console.log(`[submit] [${id}] Step 2 complete. Using pasted job text (length: ${jobDescription.length}).`);
    updateJob(id, { _step: 'keywords' });
  }

  if (!jobDescription) {
    console.error(`[submit] [${id}] Step 2 FAILED — No job description available.`);
    updateJob(id, { status: 'error', _step_error: 'No job description provided.' });
    return;
  }

  // Step 3: Rewrite via Claude
  console.log(`[submit] [${id}] Step 3: Sending to Claude for rewrite...`);
  updateJob(id, { _step: 'rewriting' });
  let result;
  try {
    result = await rewriter.rewrite(resumeText, jobDescription, job._prefs);
    console.log(`[submit] [${id}] Step 3 complete. Keywords: ${(result.keywords_matched || []).length}, ATS: ${result.ats_score}, Fit: ${result.fit_score}`);
  } catch (err) {
    console.error(`[submit] [${id}] Step 3 FAILED — Rewrite error:`, err.message);
    updateJob(id, { status: 'error', _step_error: `AI rewrite failed: ${err.message}` });
    return;
  }

  // Step 4: Build .docx
  console.log(`[submit] [${id}] Step 4: Building .docx...`);
  updateJob(id, { _step: 'building' });
  if (!fs.existsSync(OUTPUTS_DIR)) fs.mkdirSync(OUTPUTS_DIR, { recursive: true });

  let outputFile;
  try {
    const filename = `${id}.docx`;
    const outputPath = path.join(OUTPUTS_DIR, filename);
    await builder.build(result, outputPath, job.client_name);
    outputFile = filename;
    console.log(`[submit] [${id}] Step 4 complete. File: ${filename}`);
  } catch (err) {
    console.error(`[submit] [${id}] Step 4 FAILED — Builder error:`, err.message);
    updateJob(id, { status: 'error', _step_error: `Document build failed: ${err.message}` });
    return;
  }

  updateJob(id, {
    status: 'complete',
    completed_at: new Date().toISOString(),
    output_file: outputFile,
    keywords_matched: result.keywords_matched ? result.keywords_matched.length : 0,
    ats_score: result.ats_score || null,
    fit_score: result.fit_score != null ? result.fit_score : null,
    gaps: result.gaps || [],
    _step: 'done',
  });
  console.log(`[submit] [${id}] Pipeline complete.`);
}

module.exports = router;
