import os
import json
import hashlib
import httpx
from fastapi import FastAPI, HTTPException, status, Depends, Request
from fastapi.responses import HTMLResponse
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
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS vetted_matches (
                id SERIAL PRIMARY KEY,
                candidate_hash TEXT,
                job_title TEXT,
                company_name TEXT,
                is_match BOOLEAN,
                reasoning TEXT,
                created_at TIMESTAMP DEFAULT NOW()
            )
        """))
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

# ── Ollama helpers ────────────────────────────────────────────────────────────
async def embed(text_input: str) -> List[float]:
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
    return {"status": "ok", "version": "3.0.0"}

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
                --text: #f9fafb;
                --text-muted: #9ca3af;
                --accent: #7dd3a8;
                --red: #ef4444;
            }
            body {
                background-color: var(--bg); color: var(--text);
                font-family: 'Inter', -apple-system, sans-serif;
                margin: 0; padding: 40px;
            }
            .header { display: flex; align-items: center; gap: 15px; margin-bottom: 40px; }
            .header h1 { margin: 0; color: var(--accent); font-weight: 800; font-size: 2.5rem; }
            .metrics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin-bottom: 40px; }
            .card { background: var(--surface); padding: 30px; border-radius: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.5); }
            .card h3 { margin: 0 0 10px 0; color: var(--text-muted); font-size: 1rem; font-weight: 600; text-transform: uppercase; }
            .card .value { font-size: 3.5rem; font-weight: 800; color: var(--text); }
            .tables-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 30px; }
            .feed-card { background: var(--surface); padding: 25px; border-radius: 16px; }
            .feed-card h2 { margin-top: 0; border-bottom: 2px solid var(--bg); padding-bottom: 15px; }
            .feed-item { padding: 15px 0; border-bottom: 1px solid rgba(255,255,255,0.05); display: flex; justify-content: space-between; }
            .feed-item:last-child { border-bottom: none; }
            .match-badge { padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; background: rgba(125,211,168,0.2); color: var(--accent); }
            .pass-badge { padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; background: rgba(239,68,68,0.2); color: var(--red); }
            .time { color: var(--text-muted); font-size: 0.85rem; }
        </style>
    </head>
    <body>
        <div class="header">
            <h1>🚀 AntiGravity</h1>
            <span style="color: var(--text-muted); font-size: 1.2rem; font-weight: 500;">Metrics Dashboard</span>
            <div style="flex-grow: 1;"></div>
            <div id="status" style="color: var(--accent);">● Live Engine</div>
        </div>

        <div class="metrics-grid">
            <div class="card">
                <h3>Total Candidate Profiles</h3>
                <div class="value" id="total_profiles">--</div>
            </div>
            <div class="card">
                <h3>Total Jobs Evaluated</h3>
                <div class="value" id="total_jobs">--</div>
            </div>
        </div>

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
            async function fetchStats() {
                try {
                    const res = await fetch('/api/v1/admin/stats');
                    const data = await res.json();
                    
                    document.getElementById('total_profiles').innerText = data.metrics.total_profiles;
                    document.getElementById('total_jobs').innerText = data.metrics.total_jobs_evaluated;
                    
                    document.getElementById('jobs_feed').innerHTML = data.recent_jobs.map(j => `
                        <div class="feed-item">
                            <div>
                                <strong style="display:block; margin-bottom:5px;">${j.job_title}</strong>
                                <span style="color: #9ca3af; font-size: 14px;">${j.company_name}</span>
                            </div>
                            <div style="text-align: right;">
                                <span class="${j.is_match ? 'match-badge' : 'pass-badge'}">${j.is_match ? 'APPLY MATCH' : 'PASS'}</span>
                                <div class="time" style="margin-top: 8px;">${new Date(j.created_at).toLocaleTimeString()}</div>
                            </div>
                        </div>
                    `).join('') || '<div style="color: #9ca3af; padding: 20px 0;">No jobs scanned yet.</div>';

                    document.getElementById('profiles_feed').innerHTML = data.recent_profiles.map(p => `
                        <div class="feed-item">
                            <div>
                                <strong>Role: </strong> <span>${p.role_title || 'Unknown'}</span>
                            </div>
                            <div class="time">${new Date(p.created_at).toLocaleTimeString()}</div>
                        </div>
                    `).join('') || '<div style="color: #9ca3af; padding: 20px 0;">No profiles synced yet.</div>';

                } catch (err) {
                    console.error("Failed to fetch stats", err);
                    document.getElementById('status').innerText = "● Offline";
                    document.getElementById('status').style.color = "var(--red)";
                }
            }

            setInterval(fetchStats, 5000);
            fetchStats();
        </script>
    </body>
    </html>
    """
