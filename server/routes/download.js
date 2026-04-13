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

    const downloadName = `${job.client_name.replace(/\s+/g, '_')}_resume.docx`;
    res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    if (err.code === 'PGRST116') return res.status(404).json({ error: true, message: 'Job not found.' });
    console.error(`[${req.params.id}]`, err.message);
    res.status(500).json({ error: true, message: 'Download failed.' });
  }
});

module.exports = router;
