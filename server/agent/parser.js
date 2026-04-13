const mammoth = require('mammoth');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const PDFTOTEXT_PATH = process.env.PDFTOTEXT_PATH || '/opt/homebrew/bin/pdftotext';

async function parsePDF(filePath) {
  try {
    console.log('[parser] Calling pdftotext at', PDFTOTEXT_PATH);
    const { stdout } = await execFileAsync(PDFTOTEXT_PATH, ['-layout', filePath, '-'], {
      timeout: 15000,
      maxBuffer: 10 * 1024 * 1024,
    });
    if (!stdout || stdout.trim().length === 0) {
      throw new Error('pdftotext returned empty text');
    }
    return stdout;
  } catch (err) {
    throw new Error(`PDF parsing failed: ${err.message}`);
  }
}

async function parse(filePath, originalName) {
  const ext = path.extname(originalName).toLowerCase();
  console.log(`[parser] Starting resume parse. File: ${originalName}, ext: ${ext}, path: ${filePath}`);

  if (ext === '.docx') {
    console.log('[parser] Using mammoth for .docx...');
    const result = await mammoth.extractRawText({ path: filePath });
    const text = result.value.trim();
    console.log(`[parser] .docx parsed successfully. ${text.length} characters extracted.`);
    return text;
  }

  if (ext === '.pdf') {
    console.log('[parser] Using pdftotext for .pdf...');
    let text;
    try {
      text = await parsePDF(filePath);
    } catch (err) {
      console.error('[parser] PDF parse failed:', err.message);
      throw new Error('Could not parse PDF. Try converting to .docx and uploading again.');
    }
    console.log(`[parser] .pdf parsed successfully. ${text.trim().length} characters extracted.`);
    return text.trim();
  }

  throw new Error(`Unsupported file type: ${ext}`);
}

module.exports = { parse };
