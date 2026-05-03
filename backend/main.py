import os
import json
import hashlib
import httpx
from fastapi import FastAPI, HTTPException, status, Depends, Request, UploadFile, File
from fastapi.responses import HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from typing import List, Optional
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="AI Job Assistant API", version="3.0.1")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Config ────────────────────────────────────────────────────────────────────
OLLAMA_HOST      = os.getenv("OLLAMA_HOST", "http://localhost:11434")
DATABASE_URL     = os.getenv("DATABASE_URL", "sqlite:///./local.db")
MAX_FREE_EVENTS  = int(os.getenv("MAX_FREE_EVENTS", "10"))
SUPABASE_URL     = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY     = os.getenv("SUPABASE_SERVICE_KEY", "")

if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

engine = create_engine(DATABASE_URL)

# ── DB Init ───────────────────────────────────────────────────────────────────
def _run_ddl(sql: str):
    """Run a single DDL statement in its own connection+transaction, ignoring errors."""
    try:
        with engine.connect() as conn:
            conn.execute(text(sql))
            conn.commit()
    except Exception as e:
        print(f"DDL warning (non-fatal): {e}")

def init_db():
    _run_ddl("CREATE EXTENSION IF NOT EXISTS vector")
    _run_ddl("""
        CREATE TABLE IF NOT EXISTS candidate_profiles (
            id SERIAL PRIMARY KEY,
            candidate_hash TEXT UNIQUE NOT NULL,
            role_title TEXT,
            skills TEXT,
            location TEXT,
            experience TEXT,
            summary TEXT,
            name_enc TEXT,
            email_enc TEXT,
            phone_enc TEXT,
            embedding vector(768),
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        )
    """)
    _run_ddl("""
        CREATE TABLE IF NOT EXISTS recruiter_events (
            id SERIAL PRIMARY KEY,
            recruiter_id TEXT NOT NULL,
            events_used INTEGER DEFAULT 0,
            unmasked_candidates TEXT DEFAULT '[]',
            created_at TIMESTAMP DEFAULT NOW()
        )
    """)
    _run_ddl("""
        CREATE TABLE IF NOT EXISTS vetted_matches (
            id SERIAL PRIMARY KEY,
            candidate_hash TEXT,
            job_title TEXT,
            company_name TEXT,
            is_match BOOLEAN,
            reasoning TEXT,
            created_at TIMESTAMP DEFAULT NOW()
        )
    """)
    _run_ddl("""
        CREATE TABLE IF NOT EXISTS job_listings (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            company TEXT,
            location TEXT,
            source TEXT DEFAULT 'naukri',
            description TEXT,
            excerpt TEXT,
            apply_url TEXT,
            industry TEXT,
            company_size TEXT,
            job_level TEXT,
            job_type TEXT,
            scraped_at TIMESTAMP DEFAULT NOW(),
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        )
    """)
    # Ensure scraped_at exists on tables created before this column was added
    _run_ddl("ALTER TABLE job_listings ADD COLUMN IF NOT EXISTS scraped_at TIMESTAMP DEFAULT NOW()")
    _run_ddl("""
        CREATE TABLE IF NOT EXISTS ingestion_logs (
            id SERIAL PRIMARY KEY,
            run_date DATE NOT NULL DEFAULT CURRENT_DATE,
            inserted INTEGER NOT NULL DEFAULT 0,
            skipped INTEGER NOT NULL DEFAULT 0,
            rejected INTEGER NOT NULL DEFAULT 0,
            source_breakdown JSONB NOT NULL DEFAULT '{}',
            duration_seconds NUMERIC(8,2),
            created_at TIMESTAMP DEFAULT NOW()
        )
    """)

try:
    init_db()
except Exception as e:
    print(f"DB init warning: {e}")

# Auto-purge jobs older than N days — shared by startup and the admin endpoint
def _purge_old_jobs(days: int = 7) -> int:
    """Delete job listings older than `days` days. Returns the number of deleted rows."""
    with engine.connect() as conn:
        result = conn.execute(text(
            f"DELETE FROM job_listings WHERE created_at < NOW() - INTERVAL '{days} days'"
        ))
        conn.commit()
        return result.rowcount

def purge_old_jobs_sync(days: int = 7):
    try:
        deleted = _purge_old_jobs(days)
        if deleted > 0:
            print(f"Auto-purge: deleted {deleted} jobs older than {days} days.")
    except Exception as e:
        print(f"Auto-purge warning: {e}")

purge_old_jobs_sync()

# ── Auth ──────────────────────────────────────────────────────────────────────
security = HTTPBearer(auto_error=False)

async def get_recruiter_id(credentials: HTTPAuthorizationCredentials = Depends(security)) -> Optional[str]:
    if not credentials:
        return None
    token = credentials.credentials
    # Verify with Supabase
    try:
        async with httpx.AsyncClient() as client:
            res = await client.get(
                f"{SUPABASE_URL}/auth/v1/user",
                headers={"Authorization": f"Bearer {token}", "apikey": SUPABASE_KEY}
            )
            if res.status_code == 200:
                return res.json().get("id")
    except Exception:
        pass
    return None

# ── Ollama helpers ────────────────────────────────────────────────────────────
async def embed(text_input: str) -> List[float]:
    """Generate embeddings. Uses OpenAI text-embedding-3-small (1536-dim) if key set,
    otherwise falls back to Ollama nomic-embed-text (768-dim)."""
    openai_key = os.getenv("OPENAI_API_KEY")
    if openai_key:
        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.post(
                "https://api.openai.com/v1/embeddings",
                headers={"Authorization": f"Bearer {openai_key}", "Content-Type": "application/json"},
                json={"model": "text-embedding-3-small", "input": text_input[:8000]}
            )
            if res.status_code == 200:
                return res.json()["data"][0]["embedding"]
            raise HTTPException(503, f"OpenAI embedding error: {res.status_code} {res.text}")
    # Fallback: Ollama
    async with httpx.AsyncClient(timeout=30.0) as client:
        res = await client.post(f"{OLLAMA_HOST}/api/embeddings", json={
            "model": "nomic-embed-text",
            "prompt": text_input
        })
        if res.status_code != 200:
            raise HTTPException(503, f"Embedding service error: {res.status_code}")
        return res.json()["embedding"]

async def llm_reason(jd: str, candidate_summary: str, rank: int) -> str:
    prompt = (f"You are a recruitment assistant. Explain in 2 sentences why this candidate is ranked #{rank} "
              f"for the following job.\n\nJob Description:\n{jd[:500]}\n\nCandidate Profile:\n{candidate_summary}\n\n"
              f"Be specific about matching skills and experience. Return only the explanation.")
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.post(f"{OLLAMA_HOST}/api/generate", json={
                "model": "llama3.2:1b",
                "prompt": prompt,
                "stream": False
            })
            if res.status_code == 200:
                return res.json().get("response", "").strip()
    except Exception:
        pass
    return "Strong skills alignment with the job requirements."

# ── Health ────────────────────────────────────────────────────────────────────
@app.get("/")
def health():
    return {"status": "ok", "version": "3.0.1"}

# ── Resume Parse ──────────────────────────────────────────────────────────────
@app.post("/api/v1/resume/parse")
async def parse_resume(file: UploadFile = File(...)):
    """Parse a resume PDF or text file and extract structured summary using Groq."""
    groq_key = os.getenv("GROQ_API_KEY")
    if not groq_key:
        raise HTTPException(503, "Resume parsing service not configured.")

    content = await file.read()
    filename = (file.filename or "").lower()

    # Extract text based on file type
    text_content = ""
    if filename.endswith(".pdf") or file.content_type == "application/pdf":
        try:
            import io
            from pypdf import PdfReader
            reader = PdfReader(io.BytesIO(content))
            pages = [page.extract_text() or "" for page in reader.pages]
            text_content = "\n".join(pages).strip()
        except Exception as e:
            # Fallback: try raw decode
            text_content = content.decode("utf-8", errors="ignore")
    else:
        try:
            text_content = content.decode("utf-8", errors="ignore")
        except Exception:
            raise HTTPException(400, "Could not read file content.")

    if not text_content.strip():
        raise HTTPException(400, "Could not extract text from the file. Please use a text-based PDF or .txt file.")

    # Truncate to avoid token limits
    text_content = text_content[:6000]

    system_prompt = (
        "You are an expert resume parser. Extract structured information from the resume text. "
        "Respond with EXACTLY valid JSON with these keys:\n"
        '- "name": string (full name)\n'
        '- "email": string\n'
        '- "phone": string\n'
        '- "skills": array of strings (top technical and soft skills)\n'
        '- "experience_summary": string (2-3 sentence professional summary)\n'
        '- "target_roles": array of strings (suitable job titles based on experience)\n'
        'If a field cannot be determined, use an empty string or empty array.'
    )

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {groq_key}", "Content-Type": "application/json"},
                json={
                    "model": "llama-3.1-8b-instant",
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": f"Parse this resume:\n\n{text_content}"}
                    ],
                    "response_format": {"type": "json_object"},
                    "temperature": 0.1,
                    "max_tokens": 800
                }
            )
        if res.status_code != 200:
            raise HTTPException(502, f"Groq returned {res.status_code}")
        parsed = json.loads(res.json()["choices"][0]["message"]["content"])
        parsed["synced_at"] = ""
        return parsed
    except json.JSONDecodeError:
        raise HTTPException(502, "Invalid JSON from parsing model.")
    except httpx.TimeoutException:
        raise HTTPException(504, "Resume parsing timed out.")

# ── Cover Letter ──────────────────────────────────────────────────────────────
class CoverLetterRequest(BaseModel):
    job_id: str
    job_title: str
    company: str
    job_description: str
    resume_summary: str = ""

@app.post("/api/v1/jobs/cover-letter")
async def generate_cover_letter(req: CoverLetterRequest):
    """Generate a tailored cover letter using Groq."""
    groq_key = os.getenv("GROQ_API_KEY")
    if not groq_key:
        raise HTTPException(503, "Cover letter service not configured.")

    prompt = (
        f"Write a concise, professional cover letter for the following job.\n\n"
        f"Job Title: {req.job_title}\nCompany: {req.company}\n"
        f"Job Description:\n{req.job_description[:1500]}\n\n"
        f"Candidate Background:\n{req.resume_summary[:800] or 'Not provided'}\n\n"
        f"Write 2 short paragraphs. Be specific, confident, and avoid clichés. "
        f"Return only the cover letter text, no subject line or salutation needed."
    )

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {groq_key}", "Content-Type": "application/json"},
                json={
                    "model": "llama-3.1-8b-instant",
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.7,
                    "max_tokens": 400
                }
            )
        if res.status_code != 200:
            raise HTTPException(502, f"Groq returned {res.status_code}")
        cover_letter = res.json()["choices"][0]["message"]["content"].strip()
        return {"cover_letter": cover_letter}
    except httpx.TimeoutException:
        raise HTTPException(504, "Cover letter generation timed out.")

# ── Job Feed ──────────────────────────────────────────────────────────────────
async def _embed_for_search(text_input: str) -> list:
    """Generate embeddings for search — delegates to embed() which uses OpenAI if key set."""
    try:
        return await embed(text_input)
    except Exception:
        return []

@app.get("/api/v1/jobs/feed")
async def jobs_feed(
    resume_summary: str = "",
    exclude_ids: str = "",
    limit: int = 20,
):
    """Return job listings ranked by vector similarity to the resume summary, descending."""
    exclude_list = [x.strip() for x in exclude_ids.split(",") if x.strip()]

    try:
        with engine.connect() as conn:
            total = conn.execute(text("SELECT COUNT(*) FROM job_listings")).scalar() or 0
    except Exception:
        return {"jobs": [], "total": 0}

    if total == 0:
        return {"jobs": [], "total": 0}

    resume_q = resume_summary.strip()
    rows = []

    # ── Strategy 1: Vector similarity (best) ─────────────────────────────────
    score_type = "none"  # tracks which strategy was used
    if resume_q:
        embedding = await _embed_for_search(resume_q)
        if embedding:
            emb_str = "[" + ",".join(str(x) for x in embedding) + "]"
            try:
                with engine.connect() as conn:
                    excl_clause = "AND id != ALL(:excl)" if exclude_list else ""
                    params = {"emb": emb_str, "lim": limit}
                    if exclude_list:
                        params["excl"] = exclude_list
                    rows = conn.execute(text(f"""
                        SELECT id, title, company, location, source, description,
                               LEFT(description, 200) AS excerpt, apply_url,
                               industry, company_size, job_level, job_type,
                               ROUND(CAST((1 - (embedding <=> :emb::vector)) * 100 AS numeric), 0)::integer AS match_score
                        FROM job_listings
                        WHERE embedding IS NOT NULL {excl_clause}
                        ORDER BY embedding <=> :emb::vector
                        LIMIT :lim
                    """), params).fetchall()
                if rows:
                    score_type = "vector"
            except Exception:
                rows = []

    # ── Strategy 2: Full-text search (good fallback) ──────────────────────────
    if not rows and resume_q:
        try:
            with engine.connect() as conn:
                excl_clause = "AND id != ALL(:excl)" if exclude_list else ""
                params = {"resume_q": resume_q, "lim": limit}
                if exclude_list:
                    params["excl"] = exclude_list
                rows = conn.execute(text(f"""
                    SELECT id, title, company, location, source, description,
                           LEFT(description, 200) AS excerpt, apply_url,
                           industry, company_size, job_level, job_type,
                           GREATEST(50, LEAST(95,
                               (55 + ts_rank(
                                   to_tsvector('english', COALESCE(title,'') || ' ' || COALESCE(description,'')),
                                   plainto_tsquery('english', :resume_q)
                               ) * 120)::integer
                           )) AS match_score
                    FROM job_listings WHERE 1=1 {excl_clause}
                    ORDER BY match_score DESC, RANDOM()
                    LIMIT :lim
                """), params).fetchall()
            if rows:
                score_type = "text"
        except Exception:
            rows = []

    # ── Strategy 3: Random (last resort, no resume) ───────────────────────────
    if not rows:
        try:
            with engine.connect() as conn:
                excl_clause = "AND id != ALL(:excl)" if exclude_list else ""
                params = {"lim": limit}
                if exclude_list:
                    params["excl"] = exclude_list
                rows = conn.execute(text(f"""
                    SELECT id, title, company, location, source, description,
                           LEFT(description, 200) AS excerpt, apply_url,
                           industry, company_size, job_level, job_type,
                           (55 + ABS(HASHTEXT(id::text)) % 36)::integer AS match_score
                    FROM job_listings WHERE 1=1 {excl_clause}
                    ORDER BY RANDOM() LIMIT :lim
                """), params).fetchall()
            score_type = "none"
        except Exception as e:
            raise HTTPException(500, f"Failed to fetch jobs: {str(e)}")

    jobs = []
    for row in rows:
        jobs.append({
            "id": str(row.id),
            "title": row.title or "",
            "company": row.company or "",
            "location": row.location or "Remote",
            "source": row.source or "naukri",
            "description": row.description or "",
            "excerpt": row.excerpt or (row.description or "")[:200],
            "apply_url": row.apply_url or "",
            "industry": row.industry or "",
            "company_size": row.company_size or "",
            "job_level": row.job_level or "",
            "job_type": row.job_type or "",
            # Only expose a real score for vector matches; null triggers "Add resume" CTA in the app
            "match_score": int(row.match_score) if (score_type == "vector" and getattr(row, 'match_score', None) is not None) else None,
            "score_type": score_type,
        })

    return {"jobs": jobs, "total": len(jobs)}

# ── Apply URL Classifier ──────────────────────────────────────────────────────
EXTERNAL_ATS_DOMAINS = [
    "myworkdayjobs.com", "wd1.myworkdayjobs.com", "wd3.myworkdayjobs.com",
    "greenhouse.io", "boards.greenhouse.io",
    "lever.co", "jobs.lever.co",
    "workable.com", "apply.workable.com",
    "smartrecruiters.com", "jobs.smartrecruiters.com",
    "icims.com", "careers.icims.com",
    "taleo.net", "tbe.taleo.net",
    "successfactors.com", "performancemanager.successfactors.com",
    "bamboohr.com", "app.bamboohr.com",
    "ashbyhq.com", "jobs.ashbyhq.com",
    "jobvite.com", "jobs.jobvite.com",
    "breezy.hr", "apply.breezy.hr",
    "recruitee.com",
    "pinpointhq.com",
    "dover.com",
    "rippling.com",
    "gusto.com",
    "paylocity.com",
    "adp.com",
    "ultipro.com",
    "kronos.com",
    "oracle.com/taleo",
    "sap.com",
    "kenexa.com",
    "hirevue.com",
    "indeed.com/apply",
    "glassdoor.com/job-listing",
]

@app.get("/api/v1/jobs/classify-apply-url")
async def classify_apply_url(url: str = ""):
    """
    Classify an apply URL to determine the best apply strategy.

    Returns:
    - form_type: 'linkedin_easy_apply' | 'naukri_apply' | 'external_ats' | 'unknown'
    - strategy: 'webview_autofill' | 'clipboard_browser'
    - platform: 'linkedin' | 'naukri' | None
    - ats_name: name of the ATS if external (e.g. 'Workday'), else None
    """
    if not url:
        return {
            "form_type": "unknown",
            "strategy": "clipboard_browser",
            "platform": None,
            "ats_name": None,
        }

    url_lower = url.lower()

    # LinkedIn
    if "linkedin.com" in url_lower:
        return {
            "form_type": "linkedin_easy_apply",
            "strategy": "webview_autofill",
            "platform": "linkedin",
            "ats_name": None,
        }

    # Naukri
    if "naukri.com" in url_lower:
        return {
            "form_type": "naukri_apply",
            "strategy": "webview_autofill",
            "platform": "naukri",
            "ats_name": None,
        }

    # Check external ATS platforms
    for ats_domain in EXTERNAL_ATS_DOMAINS:
        if ats_domain in url_lower:
            # Extract a friendly name from the domain
            ats_name = ats_domain.split(".")[0].capitalize()
            # Special cases for better names
            name_map = {
                "myworkdayjobs": "Workday",
                "wd1": "Workday",
                "wd3": "Workday",
                "boards": "Greenhouse",
                "jobs": "Lever" if "lever.co" in url_lower else "SmartRecruiters",
                "apply": "Workable" if "workable.com" in url_lower else "Breezy",
                "tbe": "Taleo",
                "performancemanager": "SAP SuccessFactors",
                "app": "BambooHR",
            }
            friendly = name_map.get(ats_name.lower(), ats_name)
            return {
                "form_type": "external_ats",
                "strategy": "clipboard_browser",
                "platform": None,
                "ats_name": friendly,
            }

    # Unknown — use clipboard fallback
    return {
        "form_type": "unknown",
        "strategy": "clipboard_browser",
        "platform": None,
        "ats_name": None,
    }

# ── Ollama Proxy ──────────────────────────────────────────────────────────────
class OllamaMessage(BaseModel):
    role: str
    content: str

class OllamaChatRequest(BaseModel):
    model: str = "llama3.2:1b"
    messages: List[OllamaMessage]
    options: Optional[dict] = {"temperature": 0.3}
    stream: bool = False

@app.post("/api/v1/ollama/chat")
async def ollama_chat(request: OllamaChatRequest):
    payload = {
        "model": request.model,
        "messages": [{"role": m.role, "content": m.content} for m in request.messages],
        "options": request.options or {"temperature": 0.3},
        "stream": False
    }
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            res = await client.post(f"{OLLAMA_HOST}/api/chat", json=payload)
        if res.status_code != 200:
            raise HTTPException(503, f"Ollama returned {res.status_code}")
        return {"content": res.json().get("message", {}).get("content", "")}
    except httpx.ConnectError:
        raise HTTPException(503, "Ollama service unavailable.")
    except httpx.TimeoutException:
        raise HTTPException(504, "Ollama request timed out.")

# ── Profile Sync ──────────────────────────────────────────────────────────────
class ProfileSyncRequest(BaseModel):
    shareAnonymized: bool
    resumeSummary: str
    targetRoles: Optional[str] = ""
    targetLocations: Optional[str] = ""
    skills: Optional[str] = ""
    name: Optional[str] = ""
    email: Optional[str] = ""
    phone: Optional[str] = ""

@app.post("/api/v1/profile/sync")
async def sync_profile(req: ProfileSyncRequest):
    if not req.shareAnonymized:
        raise HTTPException(403, "Candidate has not given consent to share profile.")

    # Stable hash from email (or summary if no email)
    raw_id = req.email or req.resumeSummary[:50]
    candidate_hash = hashlib.sha256(raw_id.encode()).hexdigest()

    # Build searchable text
    profile_text = f"Role: {req.targetRoles}\nLocation: {req.targetLocations}\nSkills: {req.skills}\nSummary: {req.resumeSummary}"

    embedding = await embed(profile_text)
    embedding_str = "[" + ",".join(str(x) for x in embedding) + "]"

    with engine.connect() as conn:
        conn.execute(text("""
            INSERT INTO candidate_profiles
                (candidate_hash, role_title, skills, location, summary, name_enc, email_enc, phone_enc, embedding)
            VALUES
                (:hash, :role, :skills, :location, :summary, :name, :email, :phone, :emb::vector)
            ON CONFLICT (candidate_hash) DO UPDATE SET
                role_title = EXCLUDED.role_title,
                skills     = EXCLUDED.skills,
                location   = EXCLUDED.location,
                summary    = EXCLUDED.summary,
                name_enc   = EXCLUDED.name_enc,
                email_enc  = EXCLUDED.email_enc,
                phone_enc  = EXCLUDED.phone_enc,
                embedding  = EXCLUDED.embedding,
                updated_at = NOW()
        """), {
            "hash":     candidate_hash,
            "role":     req.targetRoles,
            "skills":   req.skills,
            "location": req.targetLocations,
            "summary":  req.resumeSummary[:1000],
            "name":     req.name,
            "email":    req.email,
            "phone":    req.phone,
            "emb":      embedding_str
        })
        conn.commit()

    return {"status": "synced", "candidate_hash": candidate_hash[:8] + "..."}

# ── Recruiter Search ──────────────────────────────────────────────────────────
class SearchRequest(BaseModel):
    jd: str
    session_searched: bool = False  # frontend tracks if this is first search

@app.post("/api/v1/recruiter/search")
async def recruiter_search(req: SearchRequest, recruiter_id: Optional[str] = Depends(get_recruiter_id)):
    # Second search requires auth
    if req.session_searched and not recruiter_id:
        raise HTTPException(401, "Sign in to continue searching.")

    jd_embedding = await embed(req.jd)
    emb_str = "[" + ",".join(str(x) for x in jd_embedding) + "]"

    with engine.connect() as conn:
        rows = conn.execute(text("""
            SELECT id, candidate_hash, role_title, skills, location, summary,
                   1 - (embedding <=> :emb::vector) AS score
            FROM candidate_profiles
            ORDER BY embedding <=> :emb::vector
            LIMIT 20
        """), {"emb": emb_str}).fetchall()

    results = []
    for rank, row in enumerate(rows, 1):
        score = round(float(row.score) * 100, 1)
        candidate_text = f"Role: {row.role_title}\nSkills: {row.skills}\nLocation: {row.location}\nSummary: {row.summary}"
        reasoning = await llm_reason(req.jd, candidate_text, rank)
        results.append({
            "rank":          rank,
            "candidate_id":  row.candidate_hash,
            "role_title":    row.role_title or "—",
            "skills":        row.skills or "—",
            "location":      row.location or "—",
            "match_score":   score,
            "ai_reasoning":  reasoning,
            "name":          "****",
            "email":         "****",
            "phone":         "****"
        })

    return {"results": results, "total": len(results)}

# ── PII Unmask ────────────────────────────────────────────────────────────────
class UnmaskRequest(BaseModel):
    candidate_id: str

@app.post("/api/v1/recruiter/unmask")
async def unmask_candidate(req: UnmaskRequest, recruiter_id: Optional[str] = Depends(get_recruiter_id)):
    if not recruiter_id:
        raise HTTPException(401, "Sign in to view candidate details.")

    with engine.connect() as conn:
        # Get or create recruiter record
        rec = conn.execute(text(
            "SELECT events_used, unmasked_candidates FROM recruiter_events WHERE recruiter_id = :rid"
        ), {"rid": recruiter_id}).fetchone()

        if not rec:
            conn.execute(text(
                "INSERT INTO recruiter_events (recruiter_id, events_used, unmasked_candidates) VALUES (:rid, 0, '[]')"
            ), {"rid": recruiter_id})
            conn.commit()
            events_used = 0
            unmasked = []
        else:
            events_used = rec.events_used
            unmasked = json.loads(rec.unmasked_candidates or "[]")

        # Already unmasked — free repeat
        if req.candidate_id in unmasked:
            candidate = conn.execute(text(
                "SELECT name_enc, email_enc, phone_enc FROM candidate_profiles WHERE candidate_hash = :h"
            ), {"h": req.candidate_id}).fetchone()
            if not candidate:
                raise HTTPException(404, "Candidate not found.")
            return {"name": candidate.name_enc, "email": candidate.email_enc, "phone": candidate.phone_enc}

        # Check event limit
        if events_used >= MAX_FREE_EVENTS:
            raise HTTPException(402, f"Free tier limit of {MAX_FREE_EVENTS} events reached.")

        # Fetch PII
        candidate = conn.execute(text(
            "SELECT name_enc, email_enc, phone_enc FROM candidate_profiles WHERE candidate_hash = :h"
        ), {"h": req.candidate_id}).fetchone()
        if not candidate:
            raise HTTPException(404, "Candidate not found.")

        # Deduct event
        unmasked.append(req.candidate_id)
        conn.execute(text("""
            UPDATE recruiter_events
            SET events_used = events_used + 1, unmasked_candidates = :uc
            WHERE recruiter_id = :rid
        """), {"uc": json.dumps(unmasked), "rid": recruiter_id})
        conn.commit()

    return {"name": candidate.name_enc, "email": candidate.email_enc, "phone": candidate.phone_enc}

# ── Recruiter Events ──────────────────────────────────────────────────────────
@app.get("/api/v1/recruiter/events")
async def get_recruiter_events(recruiter_id: Optional[str] = Depends(get_recruiter_id)):
    """Return events used and remaining for the authenticated recruiter."""
    if not recruiter_id:
        raise HTTPException(401, "Sign in to view your event balance.")

    with engine.connect() as conn:
        rec = conn.execute(text(
            "SELECT events_used, unmasked_candidates FROM recruiter_events WHERE recruiter_id = :rid"
        ), {"rid": recruiter_id}).fetchone()

        if not rec:
            # First time — create record
            conn.execute(text(
                "INSERT INTO recruiter_events (recruiter_id, events_used, unmasked_candidates) VALUES (:rid, 0, '[]')"
            ), {"rid": recruiter_id})
            conn.commit()
            events_used = 0
        else:
            events_used = rec.events_used

    return {
        "events_used": events_used,
        "events_remaining": max(0, MAX_FREE_EVENTS - events_used),
        "free_tier_limit": MAX_FREE_EVENTS,
    }

# ── Seed Test Candidates ──────────────────────────────────────────────────────
@app.post("/api/v1/admin/seed-candidates")
async def seed_test_candidates():
    """
    Seed the database with realistic test candidate profiles for recruiter app testing.
    Safe to call multiple times — uses ON CONFLICT DO NOTHING.
    """
    test_candidates = [
        {
            "hash": "test_candidate_001",
            "role": "Senior Software Engineer",
            "skills": "Python, FastAPI, PostgreSQL, Docker, AWS, React, TypeScript",
            "location": "Bangalore, India",
            "summary": "8 years of experience building scalable backend systems. Led a team of 5 engineers at a Series B startup. Strong in distributed systems and API design.",
            "name": "Arjun Sharma",
            "email": "arjun.sharma@email.com",
            "phone": "+91 98765 43210",
        },
        {
            "hash": "test_candidate_002",
            "role": "Machine Learning Engineer",
            "skills": "Python, TensorFlow, PyTorch, LangChain, RAG, NLP, Hugging Face, SQL",
            "location": "Hyderabad, India",
            "summary": "5 years in ML/AI with focus on NLP and LLM applications. Built production RAG pipelines serving 100K+ daily queries. Published 2 papers on transformer fine-tuning.",
            "name": "Priya Nair",
            "email": "priya.nair@email.com",
            "phone": "+91 87654 32109",
        },
        {
            "hash": "test_candidate_003",
            "role": "Full Stack Developer",
            "skills": "React, Node.js, TypeScript, MongoDB, GraphQL, AWS Lambda, Tailwind CSS",
            "location": "Mumbai, India",
            "summary": "6 years building full-stack web applications. Shipped 3 SaaS products from 0 to 1. Strong in React performance optimization and Node.js microservices.",
            "name": "Rahul Mehta",
            "email": "rahul.mehta@email.com",
            "phone": "+91 76543 21098",
        },
        {
            "hash": "test_candidate_004",
            "role": "Data Scientist",
            "skills": "Python, R, SQL, Pandas, Scikit-learn, Tableau, Power BI, Statistics, A/B Testing",
            "location": "Pune, India",
            "summary": "4 years in data science at e-commerce companies. Specialized in customer segmentation, churn prediction, and recommendation systems. Reduced churn by 23% at last role.",
            "name": "Sneha Patel",
            "email": "sneha.patel@email.com",
            "phone": "+91 65432 10987",
        },
        {
            "hash": "test_candidate_005",
            "role": "DevOps Engineer",
            "skills": "Kubernetes, Docker, Terraform, AWS, GCP, CI/CD, Jenkins, Prometheus, Grafana, Linux",
            "location": "Chennai, India",
            "summary": "7 years in DevOps and platform engineering. Migrated 3 monoliths to microservices on Kubernetes. Reduced deployment time from 2 hours to 8 minutes.",
            "name": "Vikram Singh",
            "email": "vikram.singh@email.com",
            "phone": "+91 54321 09876",
        },
        {
            "hash": "test_candidate_006",
            "role": "Product Manager",
            "skills": "Product Strategy, Roadmapping, SQL, Figma, Agile, Jira, User Research, A/B Testing, Growth",
            "location": "Delhi, India",
            "summary": "5 years as PM at B2B SaaS companies. Grew ARR from $2M to $12M. Strong in data-driven product decisions and cross-functional team leadership.",
            "name": "Ananya Krishnan",
            "email": "ananya.krishnan@email.com",
            "phone": "+91 43210 98765",
        },
        {
            "hash": "test_candidate_007",
            "role": "Android Developer",
            "skills": "Kotlin, Java, Android SDK, Jetpack Compose, MVVM, Retrofit, Room, Firebase, Coroutines",
            "location": "Bangalore, India",
            "summary": "4 years building Android apps with 1M+ downloads. Expert in Jetpack Compose and modern Android architecture. Contributed to 2 open-source Android libraries.",
            "name": "Karthik Reddy",
            "email": "karthik.reddy@email.com",
            "phone": "+91 32109 87654",
        },
        {
            "hash": "test_candidate_008",
            "role": "Frontend Developer",
            "skills": "React, Vue.js, JavaScript, TypeScript, CSS, Webpack, Performance Optimization, Accessibility",
            "location": "Remote",
            "summary": "5 years in frontend development. Obsessed with performance and accessibility. Reduced LCP by 60% at previous company. Strong in design systems and component libraries.",
            "name": "Divya Menon",
            "email": "divya.menon@email.com",
            "phone": "+91 21098 76543",
        },
        {
            "hash": "test_candidate_009",
            "role": "Backend Engineer",
            "skills": "Java, Spring Boot, Microservices, Kafka, Redis, PostgreSQL, gRPC, Docker, AWS",
            "location": "Hyderabad, India",
            "summary": "6 years in Java backend development at fintech companies. Built payment processing systems handling 50K TPS. Expert in event-driven architecture with Kafka.",
            "name": "Suresh Kumar",
            "email": "suresh.kumar@email.com",
            "phone": "+91 10987 65432",
        },
        {
            "hash": "test_candidate_010",
            "role": "AI/ML Research Engineer",
            "skills": "Python, PyTorch, Transformers, RLHF, Fine-tuning, LLM, Computer Vision, OpenCV, CUDA",
            "location": "Bangalore, India",
            "summary": "3 years in AI research with focus on LLM fine-tuning and RLHF. MSc in Computer Science from IIT Bombay. Interned at a top AI lab. Strong publication record.",
            "name": "Meera Iyer",
            "email": "meera.iyer@email.com",
            "phone": "+91 09876 54321",
        },
    ]

    seeded = 0
    failed = 0
    errors = []

    for c in test_candidates:
        try:
            profile_text = f"Role: {c['role']}\nSkills: {c['skills']}\nLocation: {c['location']}\nSummary: {c['summary']}"
            embedding = await embed(profile_text)
            emb_str = "[" + ",".join(str(x) for x in embedding) + "]"

            with engine.connect() as conn:
                conn.execute(text("""
                    INSERT INTO candidate_profiles
                        (candidate_hash, role_title, skills, location, summary, name_enc, email_enc, phone_enc, embedding)
                    VALUES
                        (:hash, :role, :skills, :location, :summary, :name, :email, :phone, :emb::vector)
                    ON CONFLICT (candidate_hash) DO UPDATE SET
                        role_title = EXCLUDED.role_title,
                        skills     = EXCLUDED.skills,
                        location   = EXCLUDED.location,
                        summary    = EXCLUDED.summary,
                        name_enc   = EXCLUDED.name_enc,
                        email_enc  = EXCLUDED.email_enc,
                        phone_enc  = EXCLUDED.phone_enc,
                        embedding  = EXCLUDED.embedding,
                        updated_at = NOW()
                """), {
                    "hash":     c["hash"],
                    "role":     c["role"],
                    "skills":   c["skills"],
                    "location": c["location"],
                    "summary":  c["summary"],
                    "name":     c["name"],
                    "email":    c["email"],
                    "phone":    c["phone"],
                    "emb":      emb_str,
                })
                conn.commit()
            seeded += 1
        except Exception as e:
            err_msg = str(e)
            print(f"Seed error for {c['hash']}: {err_msg}")
            errors.append({"candidate": c["hash"], "error": err_msg[:200]})
            failed += 1

    # Verify count
    with engine.connect() as conn:
        total = conn.execute(text("SELECT COUNT(*) FROM candidate_profiles")).scalar()

    return {
        "seeded": seeded,
        "failed": failed,
        "total_candidates_in_db": total,
        "message": f"Successfully seeded {seeded} test candidates. {total} total candidates in database.",
        "errors": errors,
    }

# ── Job Evaluation (server-side key) ─────────────────────────────────────────
class EvaluateRequest(BaseModel):
    jobTitle: str
    company: str
    description: str
    resumeSummary: str

@app.post("/api/v1/evaluate")
async def evaluate_job(req: EvaluateRequest):
    groq_key = os.getenv("GROQ_API_KEY")
    if not groq_key:
        raise HTTPException(503, "Evaluation service not configured.")

    system_prompt = (
        "You are an expert AI career assistant evaluating job matches. "
        "Respond with EXACTLY valid JSON with these keys:\n"
        '- "is_match": boolean\n'
        '- "reasoning": string (2-3 sentences explaining the match decision)\n'
        '- "cover_letter": string (short 2-paragraph cover letter if is_match is true, else empty string)'
    )
    user_prompt = (
        f"Resume Summary:\n{req.resumeSummary or 'Not provided'}\n\n"
        f"Job Title: {req.jobTitle}\nCompany: {req.company}\n"
        f"Description:\n{req.description[:2000]}"
    )

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {groq_key}", "Content-Type": "application/json"},
                json={
                    "model": "llama-3.1-8b-instant",
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user",   "content": user_prompt}
                    ],
                    "response_format": {"type": "json_object"},
                    "temperature": 0.3,
                    "max_tokens": 600
                }
            )
        if res.status_code != 200:
            raise HTTPException(502, f"Groq returned {res.status_code}")
        evaluation = res.json()["choices"][0]["message"]["content"]
        eval_dict = json.loads(evaluation)

        # Store the evaluated job match persistently
        candidate_hash = hashlib.sha256(req.resumeSummary[:50].encode()).hexdigest() if req.resumeSummary else "anon"
        with engine.connect() as conn:
            conn.execute(text("""
                INSERT INTO vetted_matches (candidate_hash, job_title, company_name, is_match, reasoning)
                VALUES (:hash, :title, :company, :match, :reason)
            """), {
                "hash": candidate_hash,
                "title": req.jobTitle,
                "company": req.company,
                "match": bool(eval_dict.get("is_match", False)),
                "reason": str(eval_dict.get("reasoning", ""))
            })
            conn.commit()

        return {"evaluation": eval_dict}
    except json.JSONDecodeError:
        raise HTTPException(502, "Invalid JSON from evaluation model.")
    except httpx.TimeoutException:
        raise HTTPException(504, "Evaluation service timed out.")

# ── Embedding Backfill ────────────────────────────────────────────────────────
@app.get("/api/v1/admin/db-status")
async def db_status():
    """Check database status for debugging."""
    with engine.connect() as conn:
        job_count = conn.execute(text("SELECT COUNT(*) FROM job_listings")).scalar()
        with_embeddings = conn.execute(text("SELECT COUNT(*) FROM job_listings WHERE embedding IS NOT NULL")).scalar()
        col_info = conn.execute(text("""
            SELECT column_name, udt_name, character_maximum_length
            FROM information_schema.columns
            WHERE table_name = 'job_listings' AND column_name = 'embedding'
        """)).fetchone()
    return {
        "total_jobs": job_count,
        "jobs_with_embeddings": with_embeddings,
        "embedding_column": str(col_info) if col_info else "not found"
    }

@app.get("/api/v1/admin/job-count")
async def job_count():
    """Return the total number of job listings in the database."""
    with engine.connect() as conn:
        total = conn.execute(text("SELECT COUNT(*) FROM job_listings")).scalar()
    return {"total_jobs": total}

@app.delete("/api/v1/admin/purge-old-jobs")
async def purge_old_jobs(days: int = 7):
    """Delete all job listings older than `days` days. Default: 7 days."""
    try:
        deleted = _purge_old_jobs(days)
        with engine.connect() as conn:
            remaining = conn.execute(text("SELECT COUNT(*) FROM job_listings")).scalar()
        return {
            "deleted": deleted,
            "remaining": remaining,
            "cutoff_days": days,
            "message": f"Deleted {deleted} jobs older than {days} days.",
        }
    except Exception as e:
        raise HTTPException(500, f"Purge failed: {e}")

@app.post("/api/v1/admin/backfill-embeddings")
async def backfill_embeddings(batch_size: int = 50):
    """Compute and store embeddings for all jobs that don't have one yet.
    Uses OpenAI text-embedding-3-small if OPENAI_API_KEY is set (1536-dim),
    otherwise falls back to Ollama nomic-embed-text (768-dim).
    """
    openai_key = os.getenv("OPENAI_API_KEY")
    model_used = "openai/text-embedding-3-small" if openai_key else "ollama/nomic-embed-text"

    with engine.connect() as conn:
        rows = conn.execute(text(
            "SELECT id, title, description FROM job_listings WHERE embedding IS NULL LIMIT :n"
        ), {"n": batch_size}).fetchall()

    if not rows:
        return {"message": "All jobs already have embeddings.", "count": 0, "model": model_used}

    updated = 0
    failed = 0
    last_error = None
    for row in rows:
        try:
            embedding = await embed(f"{row.title} {row.description[:800]}")
            emb_str = "[" + ",".join(str(x) for x in embedding) + "]"
            with engine.connect() as conn:
                conn.execute(text(
                    "UPDATE job_listings SET embedding = CAST(:emb AS vector), updated_at = NOW() WHERE id = :id"
                ), {"emb": emb_str, "id": row.id})
                conn.commit()
            updated += 1
        except Exception as e:
            last_error = str(e)
            print(f"Backfill error for {row.id}: {e}")
            failed += 1

    with engine.connect() as conn:
        remaining = conn.execute(text(
            "SELECT COUNT(*) FROM job_listings WHERE embedding IS NULL"
        )).scalar()

    return {
        "message": f"Backfilled {updated} jobs in this batch.",
        "updated": updated,
        "failed": failed,
        "remaining": remaining,
        "last_error": last_error,
        "model": model_used,
        "openai_key_set": bool(openai_key)
    }

@app.get("/api/v1/admin/scrape-stats")
async def scrape_stats():
    """Show when the last scrape ran and how many jobs were added recently."""
    with engine.connect() as conn:
        total = conn.execute(text("SELECT COUNT(*) FROM job_listings")).scalar() or 0
        with_embeddings = conn.execute(text("SELECT COUNT(*) FROM job_listings WHERE embedding IS NOT NULL")).scalar() or 0
        # Detect which timestamp column exists (scraped_at or created_at)
        cols = conn.execute(text(
            "SELECT column_name FROM information_schema.columns WHERE table_name='job_listings' AND column_name IN ('scraped_at','created_at')"
        )).fetchall()
        ts_col = "scraped_at" if any(c.column_name == "scraped_at" for c in cols) else "created_at"

        last_job = conn.execute(text(f"SELECT {ts_col} AS ts FROM job_listings ORDER BY {ts_col} DESC LIMIT 1")).fetchone()
        jobs_last_24h = conn.execute(text(f"SELECT COUNT(*) FROM job_listings WHERE {ts_col} >= NOW() - INTERVAL '24 hours'")).scalar() or 0
        jobs_last_7d  = conn.execute(text(f"SELECT COUNT(*) FROM job_listings WHERE {ts_col} >= NOW() - INTERVAL '7 days'")).scalar() or 0
        newest_jobs = conn.execute(text(
            f"SELECT title, company, source, {ts_col} AS ts FROM job_listings ORDER BY {ts_col} DESC LIMIT 5"
        )).fetchall()

    return {
        "total_jobs": total,
        "jobs_with_embeddings": with_embeddings,
        "jobs_without_embeddings": total - with_embeddings,
        "last_job_inserted_at": str(last_job.ts) if last_job else None,
        "jobs_added_last_24h": jobs_last_24h,
        "jobs_added_last_7d": jobs_last_7d,
        "newest_5_jobs": [
            {"title": r.title, "company": r.company, "source": r.source, "inserted_at": str(r.ts)}
            for r in newest_jobs
        ]
    }

@app.post("/api/v1/admin/migrate-to-openai-embeddings")
async def migrate_to_openai_embeddings(batch_size: int = 100):
    """
    One-time migration: resize embedding column to 1536-dim and re-embed ALL jobs
    using OpenAI text-embedding-3-small. Call this endpoint repeatedly until
    remaining=0. Each call processes batch_size jobs.

    Step 1 (first call): Alters the column type from vector(768) to vector(1536)
                         and clears all existing embeddings so they get re-generated.
    Step 2 (subsequent calls): Re-embeds jobs in batches.
    """
    openai_key = os.getenv("OPENAI_API_KEY")
    if not openai_key:
        raise HTTPException(503, "OPENAI_API_KEY not set — cannot migrate.")

    # Step 1: Check if column is already 1536-dim
    with engine.connect() as conn:
        col_info = conn.execute(text("""
            SELECT udt_name, character_maximum_length,
                   pg_attribute.atttypmod
            FROM information_schema.columns
            JOIN pg_class ON pg_class.relname = table_name
            JOIN pg_attribute ON pg_attribute.attrelid = pg_class.oid
                AND pg_attribute.attname = column_name
            WHERE table_name = 'job_listings' AND column_name = 'embedding'
        """)).fetchone()

        needs_migration = True
        if col_info:
            # atttypmod for vector(N) encodes N; vector(1536) has atttypmod = 1536 + 4 = 1540
            dim = (col_info.atttypmod - 4) if col_info.atttypmod and col_info.atttypmod > 0 else 0
            if dim == 1536:
                needs_migration = False

        if needs_migration:
            # Drop existing embeddings and resize column
            conn.execute(text("UPDATE job_listings SET embedding = NULL"))
            conn.execute(text("UPDATE candidate_profiles SET embedding = NULL"))
            conn.execute(text("ALTER TABLE job_listings ALTER COLUMN embedding TYPE vector(1536)"))
            conn.execute(text("ALTER TABLE candidate_profiles ALTER COLUMN embedding TYPE vector(1536)"))
            conn.commit()
            return {
                "message": "Column resized to vector(1536). All embeddings cleared. Call this endpoint again to start re-embedding.",
                "step": "migration_complete",
                "next": "Call POST /api/v1/admin/backfill-embeddings?batch_size=100 repeatedly until remaining=0"
            }

    # Step 2: Re-embed in batches (delegates to backfill_embeddings)
    result = await backfill_embeddings(batch_size)
    result["step"] = "re_embedding"
    return result


# ── Ingestion Monitoring ──────────────────────────────────────────────────────
@app.get("/api/v1/admin/daily-stats")
async def daily_stats():
    """Return job insertion counts broken down by day, source, and embedding status."""
    try:
        with engine.connect() as conn:
            total_jobs = conn.execute(text("SELECT COUNT(*) FROM job_listings")).scalar() or 0

            today_count = conn.execute(text(
                "SELECT COUNT(*) FROM job_listings WHERE scraped_at >= CURRENT_DATE"
            )).scalar() or 0

            yesterday_count = conn.execute(text(
                "SELECT COUNT(*) FROM job_listings "
                "WHERE scraped_at >= CURRENT_DATE - INTERVAL '1 day' "
                "  AND scraped_at < CURRENT_DATE"
            )).scalar() or 0

            week_count = conn.execute(text(
                "SELECT COUNT(*) FROM job_listings WHERE scraped_at >= CURRENT_DATE - INTERVAL '7 days'"
            )).scalar() or 0

            source_rows = conn.execute(text(
                "SELECT source, COUNT(*) AS cnt FROM job_listings GROUP BY source ORDER BY cnt DESC"
            )).fetchall()

            with_embeddings = conn.execute(text(
                "SELECT COUNT(*) FROM job_listings WHERE embedding IS NOT NULL"
            )).scalar() or 0

            # Per-source counts for today
            today_source_rows = conn.execute(text(
                "SELECT source, COUNT(*) AS cnt FROM job_listings "
                "WHERE scraped_at >= CURRENT_DATE GROUP BY source ORDER BY cnt DESC"
            )).fetchall()

        return {
            "total_jobs": total_jobs,
            "inserted_today": today_count,
            "inserted_yesterday": yesterday_count,
            "inserted_this_week": week_count,
            "source_breakdown": {row.source or "unknown": int(row.cnt) for row in source_rows},
            "today_by_source": {row.source or "unknown": int(row.cnt) for row in today_source_rows},
            "embeddings": {
                "with_embedding": with_embeddings,
                "without_embedding": total_jobs - with_embeddings,
                "coverage_pct": round(with_embeddings / total_jobs * 100, 1) if total_jobs else 0,
            },
        }
    except Exception as e:
        raise HTTPException(500, f"Failed to fetch daily stats: {e}")


@app.get("/api/v1/admin/ingestion-log")
async def ingestion_log(limit: int = 30):
    """Return recent ingestion run history from the ingestion_logs table."""
    try:
        with engine.connect() as conn:
            rows = conn.execute(text("""
                SELECT id, run_date, inserted, skipped, rejected,
                       source_breakdown, duration_seconds, created_at
                FROM ingestion_logs
                ORDER BY created_at DESC
                LIMIT :lim
            """), {"lim": limit}).fetchall()

        logs = []
        for row in rows:
            breakdown = row.source_breakdown
            if isinstance(breakdown, str):
                try:
                    breakdown = json.loads(breakdown)
                except Exception:
                    breakdown = {}
            logs.append({
                "id": row.id,
                "run_date": str(row.run_date),
                "inserted": row.inserted,
                "skipped": row.skipped,
                "rejected": row.rejected,
                "source_breakdown": breakdown or {},
                "duration_seconds": float(row.duration_seconds) if row.duration_seconds else None,
                "created_at": row.created_at.isoformat() if row.created_at else None,
            })

        return {"logs": logs, "total": len(logs)}
    except Exception as e:
        raise HTTPException(500, f"Failed to fetch ingestion log: {e}")


# ── Events Status ─────────────────────────────────────────────────────────────
@app.get("/api/v1/recruiter/events")
async def get_events(recruiter_id: Optional[str] = Depends(get_recruiter_id)):
    if not recruiter_id:
        raise HTTPException(401, "Authentication required.")

    with engine.connect() as conn:
        rec = conn.execute(text(
            "SELECT events_used FROM recruiter_events WHERE recruiter_id = :rid"
        ), {"rid": recruiter_id}).fetchone()

    used = rec.events_used if rec else 0
    return {
        "events_used":      used,
        "events_remaining": max(0, MAX_FREE_EVENTS - used),
        "free_tier_limit":  MAX_FREE_EVENTS
    }

# ── Admin Dashboard ───────────────────────────────────────────────────────────
@app.get("/api/v1/admin/stats")
async def admin_stats():
    with engine.connect() as conn:
        # Check if tables exist safely
        # Quick fallback if DB not fully initialized
        try:
            profiles_count = conn.execute(text("SELECT COUNT(*) FROM candidate_profiles")).scalar() or 0
            jobs_count = conn.execute(text("SELECT COUNT(*) FROM vetted_matches")).scalar() or 0
            
            recent_profiles = [dict(r._mapping) for r in conn.execute(text(
                "SELECT role_title, created_at FROM candidate_profiles ORDER BY created_at DESC LIMIT 5"
            )).fetchall()]
            
            recent_jobs = [dict(r._mapping) for r in conn.execute(text(
                "SELECT job_title, company_name, is_match, created_at FROM vetted_matches ORDER BY created_at DESC LIMIT 5"
            )).fetchall()]
        except:
            profiles_count, jobs_count, recent_profiles, recent_jobs = 0, 0, [], []
            
    return {
        "metrics": {
            "total_profiles": profiles_count,
            "total_jobs_evaluated": jobs_count
        },
        "recent_profiles": recent_profiles,
        "recent_jobs": recent_jobs
    }

@app.get("/dashboard", response_class=HTMLResponse)
async def dashboard_view():
    return """
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>AntiGravity | Command Center</title>
        <style>
            :root {
                --bg: #0e1212;
                --surface: #1f2937;
                --surface2: #263040;
                --text: #f9fafb;
                --text-muted: #9ca3af;
                --accent: #7dd3a8;
                --blue: #60a5fa;
                --yellow: #fbbf24;
                --red: #ef4444;
            }
            body {
                background-color: var(--bg); color: var(--text);
                font-family: 'Inter', -apple-system, sans-serif;
                margin: 0; padding: 40px;
            }
            .header { display: flex; align-items: center; gap: 15px; margin-bottom: 40px; }
            .header h1 { margin: 0; color: var(--accent); font-weight: 800; font-size: 2.5rem; }
            .section-title {
                font-size: 1.1rem; font-weight: 700; color: var(--text-muted);
                text-transform: uppercase; letter-spacing: 0.08em;
                margin: 40px 0 16px 0; border-left: 3px solid var(--accent); padding-left: 12px;
            }
            .metrics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 20px; margin-bottom: 10px; }
            .card { background: var(--surface); padding: 28px 30px; border-radius: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.5); }
            .card h3 { margin: 0 0 10px 0; color: var(--text-muted); font-size: 0.85rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
            .card .value { font-size: 3rem; font-weight: 800; color: var(--text); line-height: 1; }
            .card .value.accent { color: var(--accent); }
            .card .value.blue   { color: var(--blue); }
            .card .value.yellow { color: var(--yellow); }
            .card .sub { font-size: 0.8rem; color: var(--text-muted); margin-top: 6px; }
            .tables-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 30px; }
            .feed-card { background: var(--surface); padding: 25px; border-radius: 16px; }
            .feed-card h2 { margin-top: 0; border-bottom: 2px solid var(--bg); padding-bottom: 15px; font-size: 1.1rem; }
            .feed-item { padding: 13px 0; border-bottom: 1px solid rgba(255,255,255,0.05); display: flex; justify-content: space-between; align-items: center; }
            .feed-item:last-child { border-bottom: none; }
            .match-badge { padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; background: rgba(125,211,168,0.2); color: var(--accent); }
            .pass-badge  { padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; background: rgba(239,68,68,0.2); color: var(--red); }
            .source-badge { padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; background: rgba(96,165,250,0.15); color: var(--blue); }
            .time { color: var(--text-muted); font-size: 0.82rem; }
            /* Source bar chart */
            .bar-row { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
            .bar-label { width: 90px; font-size: 0.82rem; color: var(--text-muted); text-align: right; flex-shrink: 0; }
            .bar-track { flex: 1; background: rgba(255,255,255,0.07); border-radius: 4px; height: 18px; overflow: hidden; }
            .bar-fill  { height: 100%; border-radius: 4px; background: var(--accent); transition: width 0.6s ease; }
            .bar-count { width: 50px; font-size: 0.82rem; color: var(--text); text-align: right; flex-shrink: 0; }
            /* Embedding donut-style */
            .emb-row { display: flex; gap: 20px; margin-top: 8px; }
            .emb-stat { text-align: center; }
            .emb-stat .num { font-size: 1.6rem; font-weight: 800; }
            .emb-stat .lbl { font-size: 0.75rem; color: var(--text-muted); margin-top: 2px; }
            /* Log table */
            .log-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
            .log-table th { text-align: left; color: var(--text-muted); font-weight: 600; padding: 8px 10px; border-bottom: 1px solid rgba(255,255,255,0.08); }
            .log-table td { padding: 10px 10px; border-bottom: 1px solid rgba(255,255,255,0.04); vertical-align: top; }
            .log-table tr:last-child td { border-bottom: none; }
            .log-table tr:hover td { background: rgba(255,255,255,0.03); }
            .pill { display: inline-block; padding: 2px 7px; border-radius: 10px; font-size: 11px; font-weight: 600; margin: 1px; }
            .pill-green  { background: rgba(125,211,168,0.15); color: var(--accent); }
            .pill-blue   { background: rgba(96,165,250,0.15);  color: var(--blue); }
            .pill-yellow { background: rgba(251,191,36,0.15);  color: var(--yellow); }
            .pill-red    { background: rgba(239,68,68,0.15);   color: var(--red); }
            .empty { color: var(--text-muted); padding: 20px 0; font-size: 0.9rem; }
        </style>
    </head>
    <body>
        <div class="header">
            <h1>🚀 AntiGravity</h1>
            <span style="color: var(--text-muted); font-size: 1.2rem; font-weight: 500;">Command Center</span>
            <div style="flex-grow: 1;"></div>
            <div id="status" style="color: var(--accent);">● Live</div>
        </div>

        <!-- ── Recruiter metrics ── -->
        <div class="section-title">Recruiter Activity</div>
        <div class="metrics-grid">
            <div class="card">
                <h3>Candidate Profiles</h3>
                <div class="value accent" id="total_profiles">--</div>
            </div>
            <div class="card">
                <h3>Jobs Evaluated</h3>
                <div class="value" id="total_jobs">--</div>
            </div>
        </div>

        <!-- ── Scraper / ingestion metrics ── -->
        <div class="section-title">Job Ingestion</div>
        <div class="metrics-grid">
            <div class="card">
                <h3>Total in DB</h3>
                <div class="value accent" id="ing_total">--</div>
            </div>
            <div class="card">
                <h3>Inserted Today</h3>
                <div class="value blue" id="ing_today">--</div>
                <div class="sub" id="ing_today_sub"></div>
            </div>
            <div class="card">
                <h3>Yesterday</h3>
                <div class="value" id="ing_yesterday">--</div>
            </div>
            <div class="card">
                <h3>This Week</h3>
                <div class="value yellow" id="ing_week">--</div>
            </div>
        </div>

        <div class="tables-grid" style="margin-top: 24px;">
            <!-- Source breakdown bar chart -->
            <div class="feed-card">
                <h2>📊 Jobs by Source (all-time)</h2>
                <div id="source_bars"><div class="empty">Loading…</div></div>
                <div style="margin-top: 20px;">
                    <h2 style="border-top: 2px solid var(--bg); padding-top: 18px; margin-bottom: 12px;">🔗 Embedding Coverage</h2>
                    <div class="emb-row" id="emb_stats"></div>
                </div>
            </div>

            <!-- Ingestion run log -->
            <div class="feed-card">
                <h2>🗓 Recent Ingestion Runs</h2>
                <div id="ingestion_log_wrap"><div class="empty">Loading…</div></div>
            </div>
        </div>

        <!-- ── Recruiter activity feeds ── -->
        <div class="section-title" style="margin-top: 40px;">Recent Activity</div>
        <div class="tables-grid">
            <div class="feed-card">
                <h2>Recent Jobs Scanned</h2>
                <div id="jobs_feed">Running diagnostics...</div>
            </div>
            <div class="feed-card">
                <h2>Recent Candidate Syncs</h2>
                <div id="profiles_feed">Running diagnostics...</div>
            </div>
        </div>

        <script>
            // ── Recruiter stats ──────────────────────────────────────────────
            async function fetchStats() {
                try {
                    const res = await fetch('/api/v1/admin/stats');
                    const data = await res.json();

                    document.getElementById('total_profiles').innerText = data.metrics.total_profiles;
                    document.getElementById('total_jobs').innerText = data.metrics.total_jobs_evaluated;

                    document.getElementById('jobs_feed').innerHTML = data.recent_jobs.map(j => `
                        <div class="feed-item">
                            <div>
                                <strong style="display:block; margin-bottom:4px;">${j.job_title}</strong>
                                <span style="color:#9ca3af; font-size:13px;">${j.company_name}</span>
                            </div>
                            <div style="text-align:right;">
                                <span class="${j.is_match ? 'match-badge' : 'pass-badge'}">${j.is_match ? 'MATCH' : 'PASS'}</span>
                                <div class="time" style="margin-top:6px;">${new Date(j.created_at).toLocaleTimeString()}</div>
                            </div>
                        </div>
                    `).join('') || '<div class="empty">No jobs scanned yet.</div>';

                    document.getElementById('profiles_feed').innerHTML = data.recent_profiles.map(p => `
                        <div class="feed-item">
                            <div><strong>Role: </strong><span>${p.role_title || 'Unknown'}</span></div>
                            <div class="time">${new Date(p.created_at).toLocaleTimeString()}</div>
                        </div>
                    `).join('') || '<div class="empty">No profiles synced yet.</div>';

                } catch (err) {
                    console.error('Failed to fetch stats', err);
                    document.getElementById('status').innerText = '● Offline';
                    document.getElementById('status').style.color = 'var(--red)';
                }
            }

            // ── Daily ingestion stats ────────────────────────────────────────
            async function fetchDailyStats() {
                try {
                    const res = await fetch('/api/v1/admin/daily-stats');
                    if (!res.ok) return;
                    const d = await res.json();

                    document.getElementById('ing_total').innerText     = d.total_jobs.toLocaleString();
                    document.getElementById('ing_today').innerText     = d.inserted_today.toLocaleString();
                    document.getElementById('ing_yesterday').innerText = d.inserted_yesterday.toLocaleString();
                    document.getElementById('ing_week').innerText      = d.inserted_this_week.toLocaleString();

                    // Today sub-label: top source
                    const todaySources = Object.entries(d.today_by_source || {});
                    if (todaySources.length) {
                        const top = todaySources.sort((a,b) => b[1]-a[1])[0];
                        document.getElementById('ing_today_sub').innerText = `top source: ${top[0]}`;
                    }

                    // Source bar chart
                    const sources = Object.entries(d.source_breakdown || {}).sort((a,b) => b[1]-a[1]);
                    const maxVal  = sources.length ? sources[0][1] : 1;
                    const sourceColors = { remoteok:'#7dd3a8', naukri:'#60a5fa', adzuna:'#fbbf24', jsearch:'#f472b6', linkedin:'#a78bfa' };
                    document.getElementById('source_bars').innerHTML = sources.length
                        ? sources.map(([src, cnt]) => {
                            const pct   = Math.round(cnt / maxVal * 100);
                            const color = sourceColors[src] || '#9ca3af';
                            return `<div class="bar-row">
                                <div class="bar-label">${src}</div>
                                <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${color};"></div></div>
                                <div class="bar-count">${cnt.toLocaleString()}</div>
                            </div>`;
                          }).join('')
                        : '<div class="empty">No data yet.</div>';

                    // Embedding coverage
                    const emb = d.embeddings || {};
                    document.getElementById('emb_stats').innerHTML = `
                        <div class="emb-stat">
                            <div class="num" style="color:var(--accent);">${(emb.with_embedding||0).toLocaleString()}</div>
                            <div class="lbl">With embedding</div>
                        </div>
                        <div class="emb-stat">
                            <div class="num" style="color:var(--red);">${(emb.without_embedding||0).toLocaleString()}</div>
                            <div class="lbl">Missing embedding</div>
                        </div>
                        <div class="emb-stat">
                            <div class="num" style="color:var(--yellow);">${emb.coverage_pct||0}%</div>
                            <div class="lbl">Coverage</div>
                        </div>`;
                } catch (err) {
                    console.error('Failed to fetch daily stats', err);
                }
            }

            // ── Ingestion run log ────────────────────────────────────────────
            async function fetchIngestionLog() {
                try {
                    const res = await fetch('/api/v1/admin/ingestion-log?limit=10');
                    if (!res.ok) return;
                    const d = await res.json();

                    if (!d.logs || d.logs.length === 0) {
                        document.getElementById('ingestion_log_wrap').innerHTML =
                            '<div class="empty">No ingestion runs recorded yet. Runs will appear here after the next scraper execution.</div>';
                        return;
                    }

                    const rows = d.logs.map(log => {
                        const breakdown = Object.entries(log.source_breakdown || {})
                            .map(([s, n]) => `<span class="pill pill-blue">${s}: ${n}</span>`).join(' ');
                        const dur = log.duration_seconds != null
                            ? `${Math.round(log.duration_seconds)}s` : '—';
                        return `<tr>
                            <td>${log.run_date}</td>
                            <td><span class="pill pill-green">+${log.inserted}</span></td>
                            <td><span class="pill pill-yellow">${log.skipped} skip</span>
                                <span class="pill pill-red">${log.rejected} rej</span></td>
                            <td>${breakdown || '—'}</td>
                            <td style="color:var(--text-muted);">${dur}</td>
                        </tr>`;
                    }).join('');

                    document.getElementById('ingestion_log_wrap').innerHTML = `
                        <table class="log-table">
                            <thead><tr>
                                <th>Date</th><th>Inserted</th><th>Skipped / Rejected</th>
                                <th>By Source</th><th>Duration</th>
                            </tr></thead>
                            <tbody>${rows}</tbody>
                        </table>`;
                } catch (err) {
                    console.error('Failed to fetch ingestion log', err);
                }
            }

            // ── Boot ─────────────────────────────────────────────────────────
            fetchStats();
            fetchDailyStats();
            fetchIngestionLog();
            setInterval(fetchStats,        30000);
            setInterval(fetchDailyStats,   60000);
            setInterval(fetchIngestionLog, 60000);
        </script>
    </body>
    </html>
    """
