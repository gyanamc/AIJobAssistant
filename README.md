# AI Job Assistant (AntiGravity)

A multi-surface AI-powered job hunting platform for LinkedIn and Naukri.

## Components

| Component | Path | Stack |
|---|---|---|
| Backend API | `backend/` | FastAPI + PostgreSQL + pgvector |
| Chrome Extension | `extension-v2/` | Manifest V3, Vanilla JS |
| Mobile App | `job-swipe-app/` | React Native 0.73, TypeScript |
| Recruiter App | `recruiter-app/` | Vanilla HTML/CSS/JS |

---

## Backend Setup

### Requirements
- Python 3.x
- PostgreSQL with the `pgvector` extension
- Ollama running locally (`nomic-embed-text` + `llama3.2:1b`)

### Environment variables

```bash
DATABASE_URL=postgresql://...
OLLAMA_HOST=http://localhost:11434   # default
OPENAI_API_KEY=...                   # optional; enables OpenAI embeddings (1536-dim) + Groq fallback
GROQ_API_KEY=...                     # optional, for Groq LLM calls
SUPABASE_URL=...
SUPABASE_SERVICE_KEY=...
MAX_FREE_EVENTS=10                   # default
```

### Install and run

```bash
pip install -r backend/requirements.txt
uvicorn backend.main:app --reload
```

### Database

On startup, `init_db()` automatically creates all required tables (no manual migrations needed):

- `candidate_profiles` — candidate embeddings and profile data
- `recruiter_events` — per-recruiter event/usage tracking
- `vetted_matches` — job evaluation history
- `job_listings` — job listings with vector embeddings for the mobile app feed

The `job_listings` table stores jobs scraped from LinkedIn/Naukri and is used by `GET /api/v1/jobs/feed` to serve ranked job cards to the mobile app.

### Embeddings

Embeddings are computed via `POST /api/v1/admin/backfill-embeddings`. The model used depends on which keys are set:

- **OpenAI** (`OPENAI_API_KEY` set) — uses `text-embedding-3-small` (1536-dim). Recommended for production.
- **Ollama** (fallback) — uses `nomic-embed-text` (768-dim). Works locally without an API key.

The response includes a `model` field indicating which was used.

### Migrating from Ollama to OpenAI embeddings

If you initially backfilled with Ollama (768-dim) and want to switch to OpenAI (1536-dim), call the migration endpoint once:

```bash
# Step 1: resize column and clear old embeddings
curl -X POST https://<your-railway-url>/api/v1/admin/migrate-to-openai-embeddings

# Step 2: re-embed in batches (repeat until remaining=0)
curl -X POST "https://<your-railway-url>/api/v1/admin/backfill-embeddings?batch_size=100"
```

The migration endpoint is idempotent — if the column is already 1536-dim it skips straight to re-embedding.

---

## Key API Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/evaluate` | Evaluate a job against a resume (Groq) |
| `POST` | `/api/v1/profile/sync` | Sync candidate profile with embedding |
| `POST` | `/api/v1/recruiter/search` | Semantic candidate search (RAG) |
| `POST` | `/api/v1/recruiter/unmask` | Reveal candidate PII (costs 1 event) |
| `GET` | `/api/v1/recruiter/events` | Get recruiter event usage |
| `GET` | `/api/v1/jobs/feed` | Ranked job feed for mobile app |
| `POST` | `/api/v1/jobs/cover-letter` | Generate cover letter via Groq (`llama-3.1-8b-instant`); requires `GROQ_API_KEY` |
| `POST` | `/api/v1/resume/parse` | Parse resume PDF/text via Groq |
| `POST` | `/api/v1/ollama/chat` | Ollama proxy (CORS-safe) |
| `POST` | `/api/v1/admin/backfill-embeddings` | Compute missing job embeddings (OpenAI or Ollama) |
| `POST` | `/api/v1/admin/migrate-to-openai-embeddings` | One-time migration from 768-dim to 1536-dim embeddings |
| `GET` | `/api/v1/admin/db-status` | Check embedding column status and job counts |
| `GET` | `/api/v1/admin/job-count` | Return total job listing count |
| `DELETE` | `/api/v1/admin/purge-old-jobs?days=7` | Delete job listings older than `days` days (default: 7) |

---

## Job Ingestion Scraper (`scraper-service/`)

A scheduled pipeline that ingests jobs from Adzuna, JSearch (RapidAPI), RemoteOK, and Naukri RSS into the `job_listings` table. Targets ~500 new jobs per run (configurable via `SCRAPE_TARGET`). Each job is quality-checked (title, company, URL, description length, spam filter) before being embedded with OpenAI and inserted.

### Sources

| Source | Notes |
|---|---|
| RemoteOK | Public API, no key needed, remote jobs only |
| Naukri RSS | Per-role RSS feeds, India-focused |
| Adzuna | Requires `ADZUNA_APP_ID` + `ADZUNA_APP_KEY`; India + US |
| JSearch (RapidAPI) | Requires `JSEARCH_API_KEY`; broadest coverage |

### Environment variables

```bash
DATABASE_URL=postgresql://...
OPENAI_API_KEY=...           # required for embeddings (text-embedding-3-small, 1536-dim)
ADZUNA_APP_ID=...            # optional
ADZUNA_APP_KEY=...           # optional
JSEARCH_API_KEY=...          # optional, RapidAPI key
SCRAPE_TARGET=500            # optional, default 500
```

### Install and run

```bash
pip install httpx feedparser sqlalchemy python-dotenv
python scraper-service/ingestion.py
```

Deploy as a Railway cron job pointing to `scraper-service/ingestion.py`. Jobs older than 7 days are automatically purged by the backend on startup (or via `DELETE /api/v1/admin/purge-old-jobs`).

---

## Chrome Extension

Load `extension-v2/` as an unpacked extension in Chrome (no build step).

Supports two AI modes:
- **Free** — proxies through the Railway backend (Groq → Ollama fallback)
- **BYOK** — direct calls to OpenAI, Gemini, or Anthropic using your own key

---

## Mobile App

```bash
cd job-swipe-app
npm install
npx pod-install ios   # iOS only

npm run ios           # or: npm run android
npm run start         # Metro bundler (run separately)
npm test -- --runInBand
```

Requires the backend to be running and accessible. Set `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `job-swipe-app/.env`.

---

## Recruiter App

Open `recruiter-app/index.html` directly in a browser or serve statically. Update `SUPABASE_URL` and `SUPABASE_ANON` in `recruiter-app/app.js` before deploying.

---

## Deployment

The backend is deployed on Railway. The `Procfile` at `backend/Procfile` defines the web process:

```
web: uvicorn main:app --host 0.0.0.0 --port $PORT
```

`DATABASE_URL` is injected automatically by Railway.
