# CLAUDE.md — TailorCV

This file is read by Claude Code at the start of every session.
Always read this file fully before writing any code.

---

## Project Overview

**TailorCV** is a resume tailoring web app. It takes a candidate's resume (.docx or PDF)
and a job description (URL or pasted text), then uses the Anthropic Claude API to rewrite
the resume to match the job — hitting keywords, tone, and ATS requirements.

**Business context:** Day 1 this is an operator-run tool (the owner runs it for clients).
Future phases add self-serve client access and Stripe payment gating.

---

## Tech Stack

| Layer         | Choice                          | Notes                                      |
|---------------|---------------------------------|--------------------------------------------|
| Frontend      | Plain HTML / CSS / JS           | No frameworks. No React. No Tailwind CDN.  |
| Backend       | Node.js + Express               | REST API, handles file I/O and agent calls |
| AI            | Anthropic SDK (`@anthropic-ai/sdk`) | Claude claude-sonnet-4-20250514 only              |
| Scraping      | Puppeteer + Cheerio             | URL → raw job description text             |
| Resume Parse  | `mammoth` (.docx) + `pdf-parse` (PDF) | Extract plain text from uploaded resume |
| .docx Output  | `docx` npm library              | Build styled output document               |
| Job Storage   | Supabase Postgres (`@supabase/supabase-js`) | Cloud DB, replaces flat-file jobs.json |
| File Storage  | Local filesystem (`data/outputs/`) | Generated .docx files stored here        |

---

## File Structure

```
tailorcv/
├── public/
│   ├── index.html          # Dashboard — job history, stats
│   ├── new.html            # Submission form
│   ├── processing.html     # Live status / progress page
│   ├── result.html         # Output summary + .docx download
│   └── style.css           # Single shared stylesheet (all pages)
├── server/
│   ├── index.js            # Express entry point, routes registration
│   ├── routes/
│   │   ├── submit.js       # POST /api/submit — receive form + files
│   │   ├── status.js       # GET /api/status/:id — job progress polling
│   │   └── download.js     # GET /api/download/:id — serve .docx file
│   ├── agent/
│   │   ├── scraper.js      # URL → job description text
│   │   ├── parser.js       # Resume file → structured plain text
│   │   ├── rewriter.js     # Claude API call — core rewrite logic
│   │   └── builder.js      # Structured JSON → formatted .docx
│   ├── db/
│   │   ├── supabase.js     # Supabase client initialisation
│   │   ├── jobs.js         # DB abstraction: getAllJobs, getJobById, createJob, updateJob
│   │   └── setup.sql       # Run once in Supabase SQL editor to create jobs table
│   └── data/
│       ├── uploads/        # Temp resume uploads (multer)
│       └── outputs/        # Generated .docx files (gitignored)
├── .env                    # Secrets — never commit
├── .gitignore
├── package.json
└── CLAUDE.md               # This file
```

Do not deviate from this structure without a clear reason. If a new file is needed,
place it in the most logical existing folder and note it here.

---

## Environment Variables

Store in `.env`. Never hardcode. Never log.

```
ANTHROPIC_API_KEY=your_key_here
PORT=3000
SUPABASE_URL=your_project_url
SUPABASE_ANON_KEY=your_anon_key
```

Access via `process.env.ANTHROPIC_API_KEY`. Use `dotenv` package.

---

## Coding Conventions

### General
- Use `async/await` throughout — no raw `.then()` chains
- Always wrap async route handlers in try/catch
- Return consistent JSON error shape: `{ error: true, message: "..." }`
- Use `const` by default, `let` only when reassignment is needed
- No `var`

### Frontend (HTML/CSS/JS)
- One shared `style.css` — no inline styles, no per-page stylesheets
- Vanilla JS only — no jQuery, no Alpine, no HTMX
- Use `fetch()` for all API calls
- Keep JS in `<script>` tags at bottom of each HTML file
- CSS variables for all colours and spacing — defined in `:root`

### Style Guide (CSS)

```css
:root {
  --color-bg: #0f0f0f;
  --color-surface: #1a1a1a;
  --color-border: #2a2a2a;
  --color-text: #e8e8e8;
  --color-text-muted: #888888;
  --color-accent: #c8ff00;        /* Lime green — primary CTA */
  --color-accent-hover: #b8ef00;
  --color-danger: #ff4444;
  --color-success: #00cc88;

  --radius: 6px;
  --radius-lg: 12px;
  --font-mono: 'JetBrains Mono', 'Fira Code', monospace;
  --font-sans: 'Inter', system-ui, sans-serif;
  --transition: 0.15s ease;
}
```

**Visual direction:** Dark, precise, tool-like. Think dev dashboard meets document editor.
No gradients on buttons. No drop shadows on cards. Clean borders only.
Accent colour (`--color-accent`) used sparingly — CTAs and active states only.

### Backend
- All routes return JSON (except `/api/download/:id` which returns the .docx file)
- Job IDs: use `crypto.randomUUID()`
- File uploads: use `multer` middleware, accept `.docx` and `.pdf` only, 10MB limit
- Never expose internal file paths in API responses

---

## Agent Logic — `rewriter.js`

This is the core of the app. Follow this pattern exactly:

### Model
Always use: `claude-sonnet-4-20250514`

### System Prompt Structure

```
You are an expert executive resume writer and ATS optimization specialist.
Your task is to rewrite the provided resume to precisely match the target job description.

Rules:
1. Never fabricate experience, skills, or credentials. Only rewrite what exists.
2. If a required skill is genuinely absent, flag it in the "gaps" array — do not invent it.
3. Use keywords from the job description verbatim where natural.
4. Match the tone of the job description (formal/conversational/technical).
5. Apply ATS rules if ats_mode is true (see below).
6. Output ONLY valid JSON. No preamble. No markdown fences.

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
      "bullets": ["string", ...]
    }
  ],
  "skills": ["string", ...],
  "education": [
    {
      "institution": "string",
      "degree": "string",
      "dates": "string"
    }
  ],
  "certifications": ["string", ...],
  "keywords_matched": ["string", ...],
  "gaps": ["string", ...],
  "ats_score": "High | Medium | Low"
}
```

### User Message Structure

Inject the following into the user turn:

```
RESUME:
{raw resume text}

JOB DESCRIPTION:
{scraped or pasted job description}

PREFERENCES:
- preserve_format: {true|false}
- tone: {keep|formal|conversational}
- ats_mode: {true|false}
- keyword_aggression: {subtle|balanced|maximum}
```

### Response Handling
- Parse response as JSON immediately
- If JSON.parse fails, retry once with an appended instruction: "Return only raw JSON, no other text."
- If second attempt fails, return error to UI with raw response for debugging

---

## Job Tracking — Supabase Postgres

All job state is stored in the `jobs` table in Supabase. The schema is in `server/db/setup.sql`.
Run that file once in the Supabase SQL editor before first use.

DB access goes through `server/db/jobs.js` only — never call Supabase directly from routes.
All four functions are async: `getAllJobs()`, `getJobById(id)`, `createJob(job)`, `updateJob(id, updates)`.

Internal pipeline columns (`_step`, `_step_error`, `_error_code`) are written during processing
and read by the status endpoint. They are not exposed in the frontend.

---

## Page Behaviours

### `index.html` (Dashboard)
- On load: `GET /api/jobs` → render table of all jobs
- Show stats: total jobs, completed this week
- "New Job" button → navigate to `new.html`
- Each row: client name, job title, company, date, status badge, download button (if complete)

### `new.html` (Submission Form)
- File drag-and-drop zone for resume upload (.docx or .pdf)
- URL input + "Fetch" button (calls `GET /api/scrape?url=...`)
- On fetch success: show first 300 chars of job description as preview
- Collapsible "Paste instead" textarea — toggled by link below URL field
- Preferences section (all optional, sensible defaults):
  - Preserve formatting: radio (Yes / No / Let AI decide) — default: Let AI decide
  - Tone: select (Keep as-is / More formal / More conversational) — default: Keep as-is
  - ATS-safe mode: toggle — default: ON
  - Keyword aggression: radio (Subtle / Balanced / Maximum) — default: Balanced
  - Client name: text input (required for dashboard tracking)
- Submit → `POST /api/submit` (multipart/form-data)
- On success: redirect to `processing.html?id={jobId}`

### `processing.html` (Status)
- Extract `id` from URL params
- Poll `GET /api/status/:id` every 2 seconds
- Display step-by-step progress list with animated states:
  1. Resume parsed
  2. Job description fetched
  3. Analysing keywords
  4. Rewriting resume
  5. Building .docx
- On status `complete`: redirect to `result.html?id={jobId}`
- On status `error`: show error message, link back to form

### `result.html` (Output)
- Fetch job details from `GET /api/jobs/:id`
- Show summary bar: keywords matched | sections rewritten | ATS score badge
- Show gaps list if any (flagged by Claude)
- Download .docx button → `GET /api/download/:id`
- "Run another job for this client" button → `new.html?client={clientName}`

---

## API Endpoints

| Method | Route                | Handler       | Description                        |
|--------|----------------------|---------------|------------------------------------|
| GET    | `/api/jobs`          | `submit.js`   | Return all jobs (for dashboard)    |
| GET    | `/api/jobs/:id`      | `submit.js`   | Return single job details          |
| POST   | `/api/submit`        | `submit.js`   | Receive form + file, create job    |
| GET    | `/api/scrape`        | `submit.js`   | Scrape URL → return job text       |
| GET    | `/api/status/:id`    | `status.js`   | Return current job status          |
| GET    | `/api/download/:id`  | `download.js` | Stream .docx file to browser       |

---

## Error Handling Rules

- All `try/catch` blocks must log to console with job ID context: `console.error('[jobId]', err.message)`
- Update `jobs.json` status to `"error"` on any agent failure
- Never crash the Express server — all unhandled promise rejections must be caught
- File upload errors: return 400 with human-readable message
- Scrape failures: return `{ error: true, message: "Could not scrape URL. Use paste option." }`

---

## What NOT to Build (Phase 1)

- No user authentication
- No email notifications
- No Stripe / payment integration
- No cloud storage (S3 etc.)
- No additional database tables beyond `jobs`
- No multi-tenancy
- No rate limiting (operator-only tool for now)

These are Phase 3 concerns. Keep Phase 1 simple and shippable.

---

## Development Commands

> **Note:** `pdftotext` is a required system dependency. Install via: `brew install poppler`

```bash
npm install          # Install all dependencies
npm run dev          # Start with nodemon (auto-restart)
npm start            # Production start
```

`package.json` scripts:
```json
"scripts": {
  "start": "node server/index.js",
  "dev": "nodemon server/index.js"
}
```

---

## Dependencies to Install

```bash
npm install express multer mammoth pdf-parse docx puppeteer \
  cheerio @anthropic-ai/sdk dotenv uuid @supabase/supabase-js
npm install --save-dev nodemon
```

---

## Notes for Claude Code

- The `jobs` table must be created in Supabase before first run — paste `server/db/setup.sql`
  into the Supabase SQL editor and execute it
- Set `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `.env` and in Railway environment variables
- Always check `data/outputs/` directory exists before writing — create it if missing
- Puppeteer may need `--no-sandbox` flag in some environments: handle in `scraper.js`
- The `docx` library uses a builder pattern — always check their docs if structure is unclear
- Keep all Claude API calls in `rewriter.js` only — no API calls from routes directly
- All DB access must go through `server/db/jobs.js` — never import supabase client directly in routes
- When unsure about a UI detail, default to the style guide above — dark, minimal, precise
