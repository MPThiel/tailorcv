require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const express = require('express');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');

const submitRoutes = require('./routes/submit');
const statusRoutes = require('./routes/status');
const downloadRoutes = require('./routes/download');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      // Pages use inline <script> blocks — 'unsafe-inline' required until scripts are externalised
      'script-src': ["'self'", "'unsafe-inline'"],
    },
  },
}));

const PDFTOTEXT_PATH = process.env.PDFTOTEXT_PATH || '/opt/homebrew/bin/pdftotext';
if (fs.existsSync(PDFTOTEXT_PATH)) {
  console.log('[startup] pdftotext found — PDF parsing ready');
} else {
  console.warn('[startup] WARNING: pdftotext not found at', PDFTOTEXT_PATH);
}

app.use(express.json());

app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, '../public/admin.html')));
app.get('/new', (req, res) => res.sendFile(path.join(__dirname, '../public/new.html')));
app.get('/processing', (req, res) => res.sendFile(path.join(__dirname, '../public/processing.html')));
app.get('/result', (req, res) => res.sendFile(path.join(__dirname, '../public/result.html')));

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
