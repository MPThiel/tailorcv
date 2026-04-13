const express = require('express');
const path = require('path');
const fs = require('fs');

const router = express.Router();
const JOBS_FILE = path.join(__dirname, '../data/jobs.json');
const OUTPUTS_DIR = path.join(__dirname, '../data/outputs');

function readJobs() {
  if (!fs.existsSync(JOBS_FILE)) return [];
  return JSON.parse(fs.readFileSync(JOBS_FILE, 'utf8'));
}

router.get('/download/:id', (req, res) => {
  try {
    const jobs = readJobs();
    const job = jobs.find((j) => j.id === req.params.id);

    if (!job) return res.status(404).json({ error: true, message: 'Job not found.' });
    if (!job.output_file) {
      return res.status(404).json({ error: true, message: 'Output file not ready.' });
    }

    const filePath = path.join(OUTPUTS_DIR, job.output_file);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: true, message: 'Output file missing from disk.' });
    }

    const downloadName = `${job.client_name.replace(/\s+/g, '_')}_resume.docx`;
    res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    console.error(`[${req.params.id}]`, err.message);
    res.status(500).json({ error: true, message: 'Download failed.' });
  }
});

module.exports = router;
