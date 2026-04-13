const express = require('express');
const path = require('path');
const fs = require('fs');

const router = express.Router();
const JOBS_FILE = path.join(__dirname, '../data/jobs.json');

function readJobs() {
  if (!fs.existsSync(JOBS_FILE)) return [];
  return JSON.parse(fs.readFileSync(JOBS_FILE, 'utf8'));
}

const STEP_MAP = {
  parsing: 1,
  scraped: 2,
  keywords: 3,
  rewriting: 4,
  building: 5,
  done: 5,
};

router.get('/status/:id', (req, res) => {
  try {
    const jobs = readJobs();
    const job = jobs.find((j) => j.id === req.params.id);
    if (!job) return res.status(404).json({ error: true, message: 'Job not found.' });

    const step = STEP_MAP[job._step] || 0;

    res.json({
      id: job.id,
      status: job.status,
      step,
      step_label: job._step || null,
      error_message: job._step_error || null,
    });
  } catch (err) {
    console.error(`[${req.params.id}]`, err.message);
    res.status(500).json({ error: true, message: 'Could not read job status.' });
  }
});

module.exports = router;
