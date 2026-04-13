const express = require('express');
const jobsDb = require('../db/jobs');

const router = express.Router();

const STEP_MAP = {
  parsing: 1,
  scraped: 2,
  keywords: 3,
  rewriting: 4,
  building: 5,
  done: 5,
};

router.get('/status/:id', async (req, res) => {
  try {
    const job = await jobsDb.getJobById(req.params.id);
    const step = STEP_MAP[job._step] || 0;
    res.json({
      id: job.id,
      status: job.status,
      step,
      step_label: job._step || null,
      error_message: job._step_error || null,
      error_code: job._error_code || null,
    });
  } catch (err) {
    if (err.code === 'PGRST116') return res.status(404).json({ error: true, message: 'Job not found.' });
    console.error(`[${req.params.id}]`, err.message);
    res.status(500).json({ error: true, message: 'Could not read job status.' });
  }
});

module.exports = router;
