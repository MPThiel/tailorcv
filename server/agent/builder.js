const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  BorderStyle,
} = require('docx');
const fs = require('fs');

function sectionHeading(text) {
  return new Paragraph({
    text,
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 300, after: 100 },
    border: {
      bottom: { color: '2a2a2a', space: 1, style: BorderStyle.SINGLE, size: 6 },
    },
  });
}

function bulletPoint(text) {
  return new Paragraph({
    bullet: { level: 0 },
    children: [new TextRun({ text, size: 22 })],
    spacing: { after: 60 },
  });
}

function bodyText(text) {
  return new Paragraph({
    children: [new TextRun({ text, size: 22 })],
    spacing: { after: 80 },
  });
}

async function build(result, outputPath, clientName) {
  console.log('[builder] Starting .docx build for:', clientName);
  const children = [];

  // Name / header
  children.push(
    new Paragraph({
      children: [new TextRun({ text: clientName, bold: true, size: 36 })],
      alignment: AlignmentType.LEFT,
      spacing: { after: 120 },
    })
  );

  // Summary
  if (result.summary) {
    console.log('[builder] Adding summary section.');
    children.push(sectionHeading('Summary'));
    children.push(bodyText(result.summary));
  }

  // Experience
  if (result.experience && result.experience.length > 0) {
    console.log(`[builder] Adding experience section (${result.experience.length} roles).`);
    children.push(sectionHeading('Experience'));
    for (const job of result.experience) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: job.title, bold: true, size: 24 }),
            new TextRun({ text: ` — ${job.company}`, size: 24 }),
          ],
          spacing: { before: 160, after: 40 },
        })
      );
      if (job.dates) {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: job.dates, color: '888888', size: 20, italics: true })],
            spacing: { after: 80 },
          })
        );
      }
      for (const bullet of job.bullets || []) {
        children.push(bulletPoint(bullet));
      }
    }
  }

  // Skills
  if (result.skills && result.skills.length > 0) {
    console.log(`[builder] Adding skills section (${result.skills.length} skills).`);
    children.push(sectionHeading('Skills'));
    children.push(bodyText(result.skills.join(' · ')));
  }

  // Education
  if (result.education && result.education.length > 0) {
    console.log(`[builder] Adding education section (${result.education.length} entries).`);
    children.push(sectionHeading('Education'));
    for (const edu of result.education) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: edu.degree, bold: true, size: 22 }),
            new TextRun({ text: ` — ${edu.institution}`, size: 22 }),
          ],
          spacing: { before: 120, after: 40 },
        })
      );
      if (edu.dates) {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: edu.dates, color: '888888', size: 20, italics: true })],
            spacing: { after: 80 },
          })
        );
      }
    }
  }

  // Certifications
  if (result.certifications && result.certifications.length > 0) {
    console.log(`[builder] Adding certifications section (${result.certifications.length} entries).`);
    children.push(sectionHeading('Certifications'));
    for (const cert of result.certifications) {
      children.push(bulletPoint(cert));
    }
  }

  console.log('[builder] Packing document...');
  const doc = new Document({
    sections: [
      {
        properties: {},
        children,
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(outputPath, buffer);
  console.log(`[builder] .docx written to ${outputPath} (${buffer.length} bytes).`);
}

module.exports = { build };
