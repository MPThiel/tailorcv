const express = require('express');
const path = require('path');
const fs = require('fs');
const jobsDb = require('../db/jobs');

const router = express.Router();
const OUTPUTS_DIR = path.join(__dirname, '../data/outputs');

router.get('/download/:id', async (req, res) => {
  try {
    const job = await jobsDb.getJobById(req.params.id);

    if (!job.output_file) {
      return res.status(404).json({ error: true, message: 'Output file not ready.' });
    }

    const filePath = path.join(OUTPUTS_DIR, job.output_file);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: true, message: 'Output file missing from disk.' });
    }

    // Control chars stripped first so quotes/backslashes added by them can't survive into later steps.
    let safeName = (job.client_name || '')
      .replace(/[\x00-\x1f\x7f]/g, '') // strip all control characters (incl. \r \n \t)
      .replace(/"/g, '')                // strip double-quotes (would break quoted header token)
      .replace(/\\/g, '')               // strip backslashes (escape-sequence risk)
      .trim()
      .replace(/\s+/g, '_')            // collapse remaining whitespace to underscores
      || 'resume';
    const downloadName = `${safeName}_resume.docx`;
    const encoded = encodeURIComponent(downloadName);
    res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"; filename*=UTF-8''${encoded}`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    if (err.code === 'PGRST116') return res.status(404).json({ error: true, message: 'Job not found.' });
    console.error(`[${req.params.id}]`, err.message);
    res.status(500).json({ error: true, message: 'Download failed.' });
  }
});

module.exports = router;
