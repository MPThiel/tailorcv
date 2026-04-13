require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const express = require('express');
const path = require('path');
const fs = require('fs');

const submitRoutes = require('./routes/submit');
const statusRoutes = require('./routes/status');
const downloadRoutes = require('./routes/download');

const app = express();
const PORT = process.env.PORT || 3000;

const PDFTOTEXT_PATH = process.env.PDFTOTEXT_PATH || '/opt/homebrew/bin/pdftotext';
if (fs.existsSync(PDFTOTEXT_PATH)) {
  console.log('[startup] pdftotext found — PDF parsing ready');
} else {
  console.warn('[startup] WARNING: pdftotext not found at', PDFTOTEXT_PATH);
}

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

app.use('/api', submitRoutes);
app.use('/api', statusRoutes);
app.use('/api', downloadRoutes);

process.on('unhandledRejection', (reason) => {
  console.error('[server] Unhandled rejection:', reason);
});

app.listen(PORT, () => {
  console.log(`TailorCV running on http://localhost:${PORT}`);
});
