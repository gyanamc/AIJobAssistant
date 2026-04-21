import os
import json
import hashlib
import httpx
from fastapi import FastAPI, HTTPException, status, Depends, Request, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from typing import List, Optional
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="AI Job Assistant API", version="3.0.0")

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
def init_db():
    with engine.connect() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        conn.execute(text("""
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
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS recruiter_events (
                id SERIAL PRIMARY KEY,
                recruiter_id TEXT NOT NULL,
                events_used INTEGER DEFAULT 0,
                unmasked_candidates TEXT DEFAULT '[]',
                created_at TIMESTAMP DEFAULT NOW()
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS job_listings (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                company TEXT NOT NULL,
                location TEXT,
                source TEXT NOT NULL,
                description TEXT NOT NULL,
                apply_url TEXT NOT NULL,
                embedding vector(1536),
                scraped_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        """))
        try:
            conn.execute(text("""
                CREATE INDEX IF NOT EXISTS idx_job_listings_embedding
                ON job_listings USING ivfflat (embedding vector_cosine_ops)
                WITH (lists = 100)
            """))
        except Exception as idx_err:
            print(f"ivfflat index creation skipped: {idx_err}")
        conn.commit()

try:
    init_db()
except Exception as e:
    print(f"DB init warning: {e}")

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

# ── Embedding ─────────────────────────────────────────────────────────────────
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")

async def embed(text_input: str) -> List[float]:
    """Use OpenAI text-embedding-3-small if key available, else Ollama nomic-embed-text."""
    if OPENAI_API_KEY:
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                res = await client.post(
                    "https://api.openai.com/v1/embeddings",
                    headers={"Authorization": f"Bearer {OPENAI_API_KEY}", "Content-Type": "application/json"},
                    json={"model": "text-embedding-3-small", "input": text_input[:8000]}
                )
                if res.status_code == 200:
                    return res.json()["data"][0]["embedding"]
        except Exception as e:
            print(f"OpenAI embedding error: {e}")

    # Fallback to Ollama
    async with httpx.AsyncClient(timeout=30.0) as client:
        res = await client.post(f"{OLLAMA_HOST}/api/embeddings", json={
            "model": "nomic-embed-text",
            "prompt": text_input
        })
        if res.status_code != 200:
            raise HTTPException(503, f"Embedding service error: {res.status_code}")
        return res.json()["embedding"]

async def groq_chat_raw(prompt: str, system: str = "", temperature: float = 0.3, max_tokens: int = 1000) -> str:
    """Call Groq directly — used internally by resume parse and cover letter."""
    if not GROQ_API_KEY:
        raise HTTPException(503, "Groq service not configured.")
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            res = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {GROQ_API_KEY}", "Content-Type": "application/json"},
                json={"model": "llama-3.1-8b-instant", "messages": messages,
                      "temperature": temperature, "max_tokens": max_tokens}
            )
        if res.status_code != 200:
            raise HTTPException(503, f"Groq returned {res.status_code}")
        return res.json()["choices"][0]["message"]["content"].strip()
    except httpx.ConnectError:
        raise HTTPException(503, "Groq service unavailable.")
    except httpx.TimeoutException:
        raise HTTPException(504, "Groq request timed out.")
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
    return {"status": "ok", "version": "3.0.0"}

# ── Groq Proxy ────────────────────────────────────────────────────────────────
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")

class GroqMessage(BaseModel):
    role: str
    content: str

class GroqChatRequest(BaseModel):
    model: str = "llama-3.1-8b-instant"
    messages: List[GroqMessage]
    temperature: float = 0.3
    max_tokens: int = 600
    response_format: Optional[dict] = None

@app.post("/api/v1/groq/chat")
async def groq_chat(request: GroqChatRequest):
    if not GROQ_API_KEY:
        raise HTTPException(503, "Groq service not configured.")
    payload = {
        "model": request.model,
        "messages": [{"role": m.role, "content": m.content} for m in request.messages],
        "temperature": request.temperature,
        "max_tokens": request.max_tokens,
    }
    if request.response_format:
        payload["response_format"] = request.response_format
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {GROQ_API_KEY}", "Content-Type": "application/json"},
                json=payload
            )
        if res.status_code != 200:
            raise HTTPException(res.status_code, f"Groq returned {res.status_code}")
        return res.json()
    except httpx.ConnectError:
        raise HTTPException(503, "Groq service unavailable.")
    except httpx.TimeoutException:
        raise HTTPException(504, "Groq request timed out.")

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

    # Try to get embedding — non-fatal if unavailable
    embedding_str = None
    try:
        embedding = await embed(profile_text)
        embedding_str = "[" + ",".join(str(x) for x in embedding) + "]"
    except Exception as e:
        print(f"Profile sync: embedding skipped ({e})")

    with engine.connect() as conn:
        if embedding_str:
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
        else:
            # Save profile without embedding — still useful for recruiter search later
            conn.execute(text("""
                INSERT INTO candidate_profiles
                    (candidate_hash, role_title, skills, location, summary, name_enc, email_enc, phone_enc)
                VALUES
                    (:hash, :role, :skills, :location, :summary, :name, :email, :phone)
                ON CONFLICT (candidate_hash) DO UPDATE SET
                    role_title = EXCLUDED.role_title,
                    skills     = EXCLUDED.skills,
                    location   = EXCLUDED.location,
                    summary    = EXCLUDED.summary,
                    name_enc   = EXCLUDED.name_enc,
                    email_enc  = EXCLUDED.email_enc,
                    phone_enc  = EXCLUDED.phone_enc,
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
            })
        conn.commit()

    return {"status": "synced", "candidate_hash": candidate_hash[:8] + "..."}

# ── Job Feed Models ───────────────────────────────────────────────────────────
class JobCardResponse(BaseModel):
    id: str
    title: str
    company: str
    location: str
    source: str  # 'linkedin' | 'naukri'
    description: str
    excerpt: str  # description[:300]
    match_score: float  # 0-100
    apply_url: str

class FeedResponse(BaseModel):
    jobs: List[JobCardResponse]
    total: int

# ── Cover Letter Models ───────────────────────────────────────────────────────
class CoverLetterRequest(BaseModel):
    job_id: str
    job_title: str
    company: str
    job_description: str
    resume_summary: str

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

# ── Job Feed ──────────────────────────────────────────────────────────────────
@app.get("/api/v1/jobs/feed", response_model=FeedResponse)
async def jobs_feed(
    resume_summary: str,
    exclude_ids: Optional[str] = None,
    limit: int = 20
):
    import random, math

    excluded = set(i.strip() for i in exclude_ids.split(",") if i.strip()) if exclude_ids else set()

    # Check if any jobs have embeddings
    with engine.connect() as conn:
        emb_count = conn.execute(text(
            "SELECT COUNT(*) FROM job_listings WHERE embedding IS NOT NULL"
        )).scalar()

    if emb_count > 0:
        # Use vector similarity search
        try:
            embedding = await embed(resume_summary)
        except Exception:
            seed_val = hash(resume_summary[:100])
            rng = random.Random(seed_val)
            raw = [rng.gauss(0, 1) for _ in range(1536)]
            magnitude = math.sqrt(sum(x * x for x in raw))
            embedding = [x / magnitude for x in raw]

        emb_str = "[" + ",".join(str(x) for x in embedding) + "]"

        with engine.connect() as conn:
            rows = conn.execute(text("""
                SELECT id, title, company, location, source, description, apply_url,
                       1 - (embedding <=> :emb::vector) AS distance
                FROM job_listings
                WHERE embedding IS NOT NULL
                ORDER BY embedding <=> :emb::vector
                LIMIT :limit
            """), {"emb": emb_str, "limit": limit + len(excluded)}).fetchall()
    else:
        # No embeddings yet — return most recent jobs
        with engine.connect() as conn:
            rows = conn.execute(text("""
                SELECT id, title, company, location, source, description, apply_url,
                       0.5 AS distance
                FROM job_listings
                ORDER BY scraped_at DESC
                LIMIT :limit
            """), {"limit": limit + len(excluded)}).fetchall()

    jobs = []
    for row in rows:
        if row.id in excluded:
            continue
        jobs.append(JobCardResponse(
            id=row.id,
            title=row.title,
            company=row.company,
            location=row.location or "",
            source=row.source,
            description=row.description,
            excerpt=row.description[:300],
            match_score=round((1 - float(row.distance)) * 100, 1),
            apply_url=row.apply_url,
        ))
        if len(jobs) >= limit:
            break

    return FeedResponse(jobs=jobs, total=len(jobs))

    excluded = set(i.strip() for i in exclude_ids.split(",") if i.strip()) if exclude_ids else set()

    with engine.connect() as conn:
        rows = conn.execute(text("""
            SELECT id, title, company, location, source, description, apply_url,
                   1 - (embedding <=> :emb::vector) AS distance
            FROM job_listings
            ORDER BY embedding <=> :emb::vector
            LIMIT :limit
        """), {"emb": emb_str, "limit": limit + len(excluded)}).fetchall()

    jobs = []
    for row in rows:
        if row.id in excluded:
            continue
        jobs.append(JobCardResponse(
            id=row.id,
            title=row.title,
            company=row.company,
            location=row.location or "",
            source=row.source,
            description=row.description,
            excerpt=row.description[:300],
            match_score=round((float(row.distance)) * 100, 1),
            apply_url=row.apply_url,
        ))
        if len(jobs) >= limit:
            break

    return FeedResponse(jobs=jobs, total=len(jobs))

# ── Resume Parse ──────────────────────────────────────────────────────────────
MAX_RESUME_SIZE = 5 * 1024 * 1024  # 5 MB

@app.post("/api/v1/resume/parse")
async def parse_resume(file: UploadFile = File(...)):
    # Validate content type
    if file.content_type not in ("application/pdf", "text/plain"):
        raise HTTPException(400, "Unsupported file type. Use PDF or .txt.")

    content = await file.read()

    # Validate size
    if len(content) > MAX_RESUME_SIZE:
        raise HTTPException(413, "File exceeds 5 MB limit.")

    # Extract text
    if file.content_type == "application/pdf":
        try:
            from pypdf import PdfReader
            import io
            reader = PdfReader(io.BytesIO(content))
            raw_text = "\n".join(page.extract_text() or "" for page in reader.pages)
        except Exception as e:
            raise HTTPException(400, f"Could not read PDF: {str(e)}")
    else:
        raw_text = content.decode("utf-8", errors="ignore")

    if not raw_text.strip():
        raise HTTPException(400, "Could not extract text from the file.")

    # LLM structured extraction via Groq
    prompt = (
        "Extract structured information from the following resume text. "
        "Return ONLY valid JSON with these exact keys: "
        '"name" (string), "email" (string), "phone" (string), '
        '"skills" (array of strings), "experience_summary" (string, 2-3 sentences), '
        '"target_roles" (array of strings inferred from experience).\n\n'
        f"Resume:\n{raw_text[:3000]}"
    )
    try:
        llm_text = await groq_chat_raw(
            prompt=prompt,
            system="You are a resume parser. Return only valid JSON, no markdown.",
            temperature=0.1,
            max_tokens=800
        )
        llm_text = llm_text.replace("```json", "").replace("```", "").strip()
        parsed = json.loads(llm_text)
    except json.JSONDecodeError:
        raise HTTPException(502, "Could not parse LLM response as JSON.")

    return {
        "name":               parsed.get("name", ""),
        "email":              parsed.get("email", ""),
        "phone":              parsed.get("phone", ""),
        "skills":             parsed.get("skills", []),
        "experience_summary": parsed.get("experience_summary", ""),
        "target_roles":       parsed.get("target_roles", []),
    }

# ── Cover Letter ─────────────────────────────────────────────────────────────
@app.post("/api/v1/jobs/cover-letter")
async def generate_cover_letter(req: CoverLetterRequest):
    prompt = (
        f"Write a concise, professional cover letter (3 paragraphs) for the following job.\n\n"
        f"Job Title: {req.job_title}\nCompany: {req.company}\n"
        f"Job Description:\n{req.job_description[:1500]}\n\n"
        f"Candidate Resume Summary:\n{req.resume_summary}\n\n"
        f"Return only the cover letter text, no subject line or headers."
    )
    cover_letter = await groq_chat_raw(prompt=prompt, temperature=0.5, max_tokens=800)
    if not cover_letter:
        raise HTTPException(503, "LLM returned empty response.")
    return {"cover_letter": cover_letter}

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
        return {"evaluation": json.loads(evaluation)}
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

@app.post("/api/v1/admin/backfill-embeddings")
async def backfill_embeddings(batch_size: int = 50):
    """Compute and store embeddings for all jobs that don't have one yet."""
    with engine.connect() as conn:
        rows = conn.execute(text(
            "SELECT id, title, description FROM job_listings WHERE embedding IS NULL LIMIT :n"
        ), {"n": batch_size}).fetchall()

    if not rows:
        return {"message": "All jobs already have embeddings.", "count": 0}

    updated = 0
    failed = 0
    for row in rows:
        try:
            embedding = await embed(f"{row.title} {row.description[:800]}")
            emb_str = "[" + ",".join(str(x) for x in embedding) + "]"
            with engine.connect() as conn:
                conn.execute(text(
                    "UPDATE job_listings SET embedding = :emb::vector, updated_at = NOW() WHERE id = :id"
                ), {"emb": emb_str, "id": row.id})
                conn.commit()
            updated += 1
        except Exception as e:
            print(f"Backfill error for {row.id}: {e}")
            failed += 1

    # Check how many still remain
    with engine.connect() as conn:
        remaining = conn.execute(text(
            "SELECT COUNT(*) FROM job_listings WHERE embedding IS NULL"
        )).scalar()

    return {
        "message": f"Backfilled {updated} jobs in this batch.",
        "updated": updated,
        "failed": failed,
        "remaining": remaining
    }


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
