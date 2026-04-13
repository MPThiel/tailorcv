const Anthropic = require('@anthropic-ai/sdk');

const SYSTEM_PROMPT = `You are an expert executive resume writer and ATS optimization specialist.
Your task is to rewrite the provided resume to precisely match the target job description.

Rules:
1. Never fabricate experience, skills, or credentials. Only rewrite what exists.
2. If a required skill is genuinely absent, flag it in the "gaps" array — do not invent it.
3. Use keywords from the job description verbatim where natural.
4. Match the tone of the job description (formal/conversational/technical).
5. Apply ATS rules if ats_mode is true (see below).
6. Output ONLY valid JSON. No preamble. No markdown fences.
7. Consider the candidate's experience_range when calibrating seniority and language in the rewrite.

ATS rules (apply when ats_mode: true):
- No tables, text boxes, or multi-column layouts
- No headers/footers containing key content
- Section headings must be: Summary, Experience, Education, Skills, Certifications
- No images, icons, or special characters
- Keywords from job description used at least once verbatim

Output format:
{
  "summary": "string",
  "experience": [
    {
      "company": "string",
      "title": "string",
      "dates": "string",
      "bullets": ["string"]
    }
  ],
  "skills": ["string"],
  "education": [
    {
      "institution": "string",
      "degree": "string",
      "dates": "string"
    }
  ],
  "certifications": ["string"],
  "keywords_matched": ["string"],
  "gaps": ["string"],
  "ats_score": "High | Medium | Low",
  "fit_score": integer from 1-10,
  "highest_education": "string"
}

fit_score: A number from 1-10 representing how well this candidate genuinely fits this specific role, based on their actual experience vs. the job requirements. Be honest — do not inflate. 10 = near-perfect match, 1 = significant mismatch. Base this on the original resume only, not the rewritten version.

highest_education: Extract the candidate's highest education level from their resume. Return exactly one of: "High School", "Diploma", "Bachelor's", "Honours", "Master's", "MBA", "PhD", "Professional Certification". If unclear, return "Bachelor's" as default.`;

function buildUserMessage(resumeText, jobDescription, prefs) {
  return `RESUME:
${resumeText}

JOB DESCRIPTION:
${jobDescription}

PREFERENCES:
- preserve_format: ${prefs.preserve_format}
- tone: ${prefs.tone}
- ats_mode: ${prefs.ats_mode}
- keyword_aggression: ${prefs.keyword_aggression}
- experience_range: ${prefs.experience_range || 'not specified'}`;
}

async function callClaude(userMessage) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  console.log('[rewriter] Using key starting with:', apiKey?.slice(0, 15));
  const client = new Anthropic({ apiKey });
  console.log('[rewriter] Sending request to Claude API...');
  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });
  console.log('[rewriter] Claude API responded.');
  return response.content[0].text;
}

async function rewrite(resumeText, jobDescription, prefs) {
  console.log('[rewriter] Starting rewrite. Resume length:', resumeText.length, 'JD length:', jobDescription.length);
  const userMessage = buildUserMessage(resumeText, jobDescription, prefs);

  let raw = await callClaude(userMessage);
  console.log('[rewriter] Raw response length:', raw.length);

  try {
    const parsed = JSON.parse(raw);
    console.log('[rewriter] JSON parsed successfully on first attempt.');
    return parsed;
  } catch {
    console.log('[rewriter] JSON parse failed. Retrying with explicit instruction...');
    const retryMessage = userMessage + '\n\nReturn only raw JSON, no other text.';
    raw = await callClaude(retryMessage);
    console.log('[rewriter] Retry raw response length:', raw.length);
    try {
      const parsed = JSON.parse(raw);
      console.log('[rewriter] JSON parsed successfully on retry.');
      return parsed;
    } catch (err) {
      console.error('[rewriter] JSON parse failed on retry. Raw response:', raw.slice(0, 500));
      const error = new Error('Claude returned invalid JSON after retry.');
      error.rawResponse = raw;
      throw error;
    }
  }
}

module.exports = { rewrite };
