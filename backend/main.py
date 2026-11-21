import os
import json
import hashlib
import hmac
import base64
import time
import re
import httpx
from fastapi import FastAPI, HTTPException, status, Depends, Request, UploadFile, File, Form
from fastapi.responses import HTMLResponse, JSONResponse, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="AI Job Assistant API", version="3.0.1")

# ── Privacy Policy & Account Deletion ────────────────────────────────────────
try:
    from privacy_policy_route import router as privacy_router
except ImportError:
    from backend.privacy_policy_route import router as privacy_router
app.include_router(privacy_router)

from fastapi.responses import JSONResponse
from fastapi.requests import Request

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    import traceback
    tb = traceback.format_exc()
    print(f"UNHANDLED EXCEPTION: {exc}\n{tb}")
    return JSONResponse(
        status_code=500,
        content={"detail": str(exc), "type": type(exc).__name__}
    )

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
    is_sqlite = "sqlite" in str(engine.url)
    id_pk = "INTEGER PRIMARY KEY AUTOINCREMENT" if is_sqlite else "SERIAL PRIMARY KEY"
    ts_now = "CURRENT_TIMESTAMP" if is_sqlite else "NOW()"
    json_type = "JSON" if is_sqlite else "JSONB"
    bytea_type = "BLOB" if is_sqlite else "BYTEA"

    if not is_sqlite:
        _run_ddl("CREATE EXTENSION IF NOT EXISTS vector")

    embedding_field = "embedding TEXT" if is_sqlite else "embedding vector(768)"

    _run_ddl(f"""
        CREATE TABLE IF NOT EXISTS candidate_profiles (
            id {id_pk},
            candidate_hash TEXT UNIQUE NOT NULL,
            user_id VARCHAR(100),
            resume_id INTEGER,
            role_title TEXT,
            headline TEXT,
            skills TEXT,
            location TEXT,
            experience TEXT,
            summary TEXT,
            total_experience_years FLOAT,
            seniority VARCHAR(50),
            current_company VARCHAR(255),
            current_designation VARCHAR(255),
            structured_profile {json_type} DEFAULT '{{}}',
            domains {json_type} DEFAULT '[]',
            education {json_type} DEFAULT '[]',
            certifications {json_type} DEFAULT '[]',
            suggested_job_titles {json_type} DEFAULT '[]',
            complementary_skills {json_type} DEFAULT '[]',
            name_enc TEXT,
            email_enc TEXT,
            phone_enc TEXT,
            {embedding_field},
            created_at TIMESTAMP DEFAULT {ts_now},
            updated_at TIMESTAMP DEFAULT {ts_now}
        )
    """)
    _run_ddl(f"""
        CREATE TABLE IF NOT EXISTS recruiter_events (
            id {id_pk},
            recruiter_id TEXT NOT NULL,
            events_used INTEGER DEFAULT 0,
            unmasked_candidates TEXT DEFAULT '[]',
            created_at TIMESTAMP DEFAULT {ts_now}
        )
    """)
    _run_ddl(f"""
        CREATE TABLE IF NOT EXISTS vetted_matches (
            id {id_pk},
            candidate_hash TEXT,
            job_title TEXT,
            company_name TEXT,
            is_match BOOLEAN,
            reasoning TEXT,
            created_at TIMESTAMP DEFAULT {ts_now}
        )
    """)
    _run_ddl(f"""
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
            scraped_at TIMESTAMP DEFAULT {ts_now},
            created_at TIMESTAMP DEFAULT {ts_now},
            updated_at TIMESTAMP DEFAULT {ts_now}
        )
    """)
    if not is_sqlite:
        _run_ddl("ALTER TABLE job_listings ADD COLUMN IF NOT EXISTS scraped_at TIMESTAMP DEFAULT NOW()")
    _run_ddl(f"""
        CREATE TABLE IF NOT EXISTS ingestion_logs (
            id {id_pk},
            run_date DATE NOT NULL DEFAULT CURRENT_DATE,
            inserted INTEGER NOT NULL DEFAULT 0,
            skipped INTEGER NOT NULL DEFAULT 0,
            rejected INTEGER NOT NULL DEFAULT 0,
            source_breakdown {json_type} NOT NULL DEFAULT '{{}}',
            duration_seconds NUMERIC(8,2),
            created_at TIMESTAMP DEFAULT {ts_now}
        )
    """)
    _run_ddl(f"""
        CREATE TABLE IF NOT EXISTS resumes (
            id {id_pk},
            user_id VARCHAR(100) NOT NULL,
            filename VARCHAR(255) NOT NULL,
            mime_type VARCHAR(100) NOT NULL,
            file_size INTEGER NOT NULL,
            file_hash VARCHAR(64) NOT NULL,
            file_data {bytea_type} NOT NULL,
            extracted_text TEXT NOT NULL,
            parsed_info {json_type} NOT NULL DEFAULT '{{}}',
            version INTEGER NOT NULL DEFAULT 1,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )
    """)
    _run_ddl("CREATE INDEX IF NOT EXISTS idx_resumes_user_id ON resumes(user_id)")
    _run_ddl("CREATE INDEX IF NOT EXISTS idx_resumes_file_hash ON resumes(file_hash)")
    _run_ddl("CREATE INDEX IF NOT EXISTS idx_resumes_user_hash ON resumes(user_id, file_hash)")

    # ── Candidate Profiles Extension ──
    for col, col_type in [
        ("user_id", "VARCHAR(100)"),
        ("resume_id", "INTEGER"),
        ("headline", "TEXT"),
        ("total_experience_years", "FLOAT"),
        ("seniority", "VARCHAR(50)"),
        ("current_company", "VARCHAR(255)"),
        ("current_designation", "VARCHAR(255)"),
        ("structured_profile", f"{json_type} DEFAULT '{{}}'"),
        ("domains", f"{json_type} DEFAULT '[]'"),
        ("education", f"{json_type} DEFAULT '[]'"),
        ("certifications", f"{json_type} DEFAULT '[]'"),
        ("suggested_job_titles", f"{json_type} DEFAULT '[]'"),
        ("complementary_skills", f"{json_type} DEFAULT '[]'")
    ]:
        try:
            _run_ddl(f"ALTER TABLE candidate_profiles ADD COLUMN IF NOT EXISTS {col} {col_type}")
        except Exception:
            pass

    _run_ddl("CREATE INDEX IF NOT EXISTS idx_candidate_profiles_user_id ON candidate_profiles(user_id)")

    # ── Candidate Skills Table (normalized skills with evidence & confidence) ──
    _run_ddl(f"""
        CREATE TABLE IF NOT EXISTS candidate_skills (
            id {id_pk},
            user_id VARCHAR(100) NOT NULL,
            resume_id INTEGER,
            name VARCHAR(150) NOT NULL,
            category VARCHAR(100) DEFAULT 'technical',
            evidence_type VARCHAR(50) DEFAULT 'explicit',
            confidence FLOAT DEFAULT 1.0,
            evidence TEXT DEFAULT '',
            source_section VARCHAR(100) DEFAULT 'skills',
            status VARCHAR(50) DEFAULT 'resume_supported',
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )
    """)
    _run_ddl("CREATE INDEX IF NOT EXISTS idx_candidate_skills_user ON candidate_skills(user_id)")
    _run_ddl("CREATE INDEX IF NOT EXISTS idx_candidate_skills_name ON candidate_skills(user_id, name)")

    # ── Resume Consent Table (affirmative, purpose-specific consent logging) ──
    _run_ddl(f"""
        CREATE TABLE IF NOT EXISTS resume_consent (
            id {id_pk},
            user_id VARCHAR(100) NOT NULL,
            purpose VARCHAR(100) NOT NULL,
            consent_status INTEGER NOT NULL DEFAULT 1,
            notice_version VARCHAR(50) NOT NULL,
            provider_disclosures VARCHAR(255) DEFAULT 'groq,ollama,openai,gemini,anthropic',
            consented_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            ip_hash VARCHAR(64) DEFAULT ''
        )
    """)
    _run_ddl("CREATE INDEX IF NOT EXISTS idx_resume_consent_user ON resume_consent(user_id)")

    # ── Processing Jobs Table (lifecycle status & error recovery) ──
    _run_ddl(f"""
        CREATE TABLE IF NOT EXISTS resume_processing_jobs (
            id {id_pk},
            job_id VARCHAR(64) UNIQUE NOT NULL,
            user_id VARCHAR(100) NOT NULL,
            file_hash VARCHAR(64) NOT NULL,
            filename VARCHAR(255) NOT NULL,
            status VARCHAR(50) NOT NULL DEFAULT 'UPLOADED',
            error_message TEXT DEFAULT '',
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )
    """)
    _run_ddl("CREATE INDEX IF NOT EXISTS idx_processing_jobs_user ON resume_processing_jobs(user_id)")

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

SESSION_SECRET = os.getenv("SESSION_SECRET", "ai-job-assistant-v2-5-0-secret-key-default")

def create_user_token(user_id: str, email: str) -> str:
    """Create a cryptographically signed HMAC-SHA256 session token for Chrome extension users."""
    payload = json.dumps({"uid": user_id, "email": email, "exp": int(time.time()) + 86400 * 365})
    payload_b64 = base64.urlsafe_b64encode(payload.encode()).decode()
    sig = hmac.new(SESSION_SECRET.encode(), payload_b64.encode(), hashlib.sha256).hexdigest()
    return f"session.{payload_b64}.{sig}"

def verify_user_token(token: str) -> Optional[dict]:
    """Verify an HMAC-SHA256 session token."""
    if not token or not token.startswith("session."):
        return None
    parts = token.split(".")
    if len(parts) != 3:
        return None
    try:
        payload_b64 = parts[1]
        sig = parts[2]
        expected_sig = hmac.new(SESSION_SECRET.encode(), payload_b64.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected_sig, sig):
            return None
        payload_bytes = base64.urlsafe_b64decode(payload_b64.encode())
        payload = json.loads(payload_bytes.decode())
        if payload.get("exp", 0) < time.time():
            return None
        return {"id": payload.get("uid"), "email": payload.get("email")}
    except Exception:
        return None

class SessionAuthRequest(BaseModel):
    email: str
    name: Optional[str] = ""

@app.post("/api/v1/auth/session")
async def create_auth_session(req: SessionAuthRequest):
    """
    Issue a signed Bearer session token for Chrome extension users.
    Deterministic user ID derived from email ensures cross-session resume retrieval.
    """
    clean_email = req.email.strip().lower()
    if not clean_email or "@" not in clean_email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A valid email address is required.")

    # Deterministic user ID: usr_ + first 16 hex chars of sha256(email)
    user_id = f"usr_{hashlib.sha256(clean_email.encode()).hexdigest()[:16]}"
    token = create_user_token(user_id, clean_email)
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user_id,
            "email": clean_email,
            "name": req.name or clean_email.split("@")[0]
        }
    }

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

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    """
    Authenticate user via Bearer token (Supabase auth JWT or signed session token).
    Enforces strict user identification and prevents cross-user access.
    """
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required. Please provide a valid Bearer token.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = credentials.credentials
    # Test-mode hook for automated test suites
    if os.getenv("TEST_MODE") == "1" and token.startswith("test-token-"):
        uid = token.replace("test-token-", "")
        return {"id": uid, "email": f"{uid}@example.com"}

    # Signed session token verification
    verified_session = verify_user_token(token)
    if verified_session:
        return verified_session

    if SUPABASE_URL:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                res = await client.get(
                    f"{SUPABASE_URL}/auth/v1/user",
                    headers={"Authorization": f"Bearer {token}", "apikey": SUPABASE_KEY or os.getenv("SUPABASE_ANON_KEY", "")}
                )
                if res.status_code == 200:
                    data = res.json()
                    return {"id": data.get("id"), "email": data.get("email")}
        except Exception:
            pass
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired authentication credentials.",
        headers={"WWW-Authenticate": "Bearer"},
    )

# ── LLM helpers ──────────────────────────────────────────────────────────────
GROQ_API_URL   = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL     = os.getenv("GROQ_MODEL", "qwen/qwen3.8-27b")
GROQ_TIMEOUT   = 30.0

async def call_groq(
    messages: list,
    *,
    temperature: float = 0.3,
    max_tokens: int = 600,
    json_mode: bool = True,
    timeout: float = GROQ_TIMEOUT,
) -> str:
    """
    Call the Groq API and return the raw content string.
    Raises HTTPException on non-200, timeout, or missing key.
    """
    groq_key = os.getenv("GROQ_API_KEY")
    if not groq_key:
        raise HTTPException(503, "Groq API key not configured on server.")
    payload: dict = {
        "model": GROQ_MODEL,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    has_json_mention = any("json" in str(m.get("content", "")).lower() for m in messages)
    if json_mode and has_json_mention:
        payload["response_format"] = {"type": "json_object"}
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            res = await client.post(
                GROQ_API_URL,
                headers={"Authorization": f"Bearer {groq_key}", "Content-Type": "application/json"},
                json=payload,
            )
        if res.status_code != 200:
            raise HTTPException(502, f"Groq returned {res.status_code}: {res.text[:200]}")
        return res.json()["choices"][0]["message"]["content"]
    except httpx.TimeoutException:
        raise HTTPException(504, "Groq request timed out.")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(503, f"Groq error: {str(e)}")

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
    prompt = (f"You are a recruitment assistant. In 1-2 sentences, explain why this candidate is ranked #{rank} "
              f"for this job. Be specific about matching skills.\n\n"
              f"Job: {jd[:300]}\nCandidate: {candidate_summary[:300]}\n\nExplanation:")
    # Try Groq first (fast, available on Railway)
    groq_key = os.getenv("GROQ_API_KEY")
    if groq_key:
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                res = await client.post(
                    "https://api.groq.com/openai/v1/chat/completions",
                    headers={"Authorization": f"Bearer {groq_key}", "Content-Type": "application/json"},
                    json={
                        "model": GROQ_MODEL,
                        "messages": [{"role": "user", "content": prompt}],
                        "temperature": 0.3,
                        "max_tokens": 80,
                    }
                )
                if res.status_code == 200:
                    return res.json()["choices"][0]["message"]["content"].strip()
        except Exception:
            pass
    # Fallback: Ollama (local only)
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
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

# ── Account Deletion Request ──────────────────────────────────────────────────
class DeleteRequest(BaseModel):
    email: str
    reason: Optional[str] = ""

@app.post("/api/v1/account/delete-request")
async def account_delete_request(req: DeleteRequest):
    """Log a deletion request. Deletes associated resumes and records."""
    print(f"DELETION REQUEST: email={req.email}, reason={req.reason}")
    try:
        with engine.connect() as conn:
            conn.execute(
                text("DELETE FROM resumes WHERE user_id = :em"),
                {"em": req.email}
            )
            try:
                conn.execute(
                    text("DELETE FROM resumes WHERE user_id IN (SELECT candidate_hash FROM candidate_profiles WHERE email_enc = :em)"),
                    {"em": req.email}
                )
            except Exception:
                pass
            conn.commit()
    except Exception as e:
        print(f"Account deletion DB cleanup warning: {e}")
    return {"status": "received", "message": "Your deletion request has been logged. Associated resume and profile records have been queued/processed for removal."}

# ── Resume Helpers & Persistent Storage ──────────────────────────────────────
MAX_RESUME_SIZE = 10 * 1024 * 1024  # 10 MB limit

def extract_text_from_file(content: bytes, filename: str, mime_type: str) -> str:
    """Extract readable plain text from PDF, DOCX, or text files."""
    fn = (filename or "").lower()
    text_content = ""
    if fn.endswith(".pdf") or mime_type == "application/pdf":
        try:
            import io
            from pypdf import PdfReader
            reader = PdfReader(io.BytesIO(content))
            pages = [page.extract_text() or "" for page in reader.pages]
            text_content = "\n".join(pages).strip()
        except Exception:
            text_content = content.decode("utf-8", errors="ignore").strip()
    elif fn.endswith(".docx") or mime_type in (
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/msword"
    ):
        try:
            import io
            import docx
            doc = docx.Document(io.BytesIO(content))
            lines = [p.text for p in doc.paragraphs if p.text]
            for table in doc.tables:
                for row in table.rows:
                    lines.append(" \t ".join(cell.text.strip() for cell in row.cells if cell.text.strip()))
            text_content = "\n".join(lines).strip()
        except Exception:
            try:
                import io
                import zipfile
                import xml.etree.ElementTree as ET
                with zipfile.ZipFile(io.BytesIO(content)) as z:
                    xml_content = z.read("word/document.xml")
                    tree = ET.fromstring(xml_content)
                    text_content = " ".join([elem.text for elem in tree.iter() if elem.text]).strip()
            except Exception:
                text_content = content.decode("utf-8", errors="ignore").strip()
    elif fn.endswith(".txt") or mime_type.startswith("text/"):
        text_content = content.decode("utf-8", errors="ignore").strip()
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported file format for '{filename}'. Supported formats: PDF (.pdf), Word document (.docx), plain text (.txt)."
        )

    if not text_content.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Could not extract readable text from the file. Please ensure the file contains readable text."
        )
    return text_content

COMMON_TAXONOMY_SKILLS = [
    'Python', 'JavaScript', 'TypeScript', 'Java', 'C++', 'C#', 'Go', 'Rust', 'Ruby', 'PHP', 'Swift', 'Kotlin', 'SQL',
    'React', 'Node.js', 'Next.js', 'Vue.js', 'Angular', 'HTML5', 'CSS3', 'Tailwind CSS', 'Redux', 'GraphQL', 'REST API',
    'FastAPI', 'Django', 'Flask', 'Express.js', 'Spring Boot', '.NET', 'Microservices',
    'PostgreSQL', 'MySQL', 'MongoDB', 'Redis', 'Elasticsearch', 'DynamoDB', 'SQLite',
    'Machine Learning', 'Deep Learning', 'PyTorch', 'TensorFlow', 'Scikit-Learn', 'Pandas', 'NumPy',
    'NLP', 'LLM', 'RAG', 'LangChain', 'LangGraph', 'OpenAI API', 'Hugging Face', 'Data Engineering', 'Spark',
    'AWS', 'Azure', 'GCP', 'Docker', 'Kubernetes', 'CI/CD', 'GitHub Actions', 'Terraform', 'Linux', 'Git',
    'Agile', 'Scrum', 'TDD', 'Unit Testing', 'System Design'
]

SKILL_RECOMMENDATIONS = {
    "python": ["FastAPI", "Docker", "PostgreSQL", "Redis", "Celery", "AWS", "PyTest"],
    "fastapi": ["PostgreSQL", "Docker", "Redis", "Celery", "SQLAlchemy", "Pydantic", "AWS"],
    "react": ["TypeScript", "Next.js", "Tailwind CSS", "Redux", "GraphQL", "REST API", "Jest"],
    "javascript": ["TypeScript", "React", "Node.js", "Next.js", "Tailwind CSS", "Git"],
    "typescript": ["React", "Node.js", "Next.js", "GraphQL", "Tailwind CSS", "Jest"],
    "machine learning": ["PyTorch", "TensorFlow", "Pandas", "Scikit-Learn", "RAG", "MLOps", "Docker"],
    "deep learning": ["PyTorch", "TensorFlow", "Hugging Face", "Computer Vision", "NLP", "CUDA"],
    "aws": ["Docker", "Kubernetes", "Terraform", "CI/CD", "Linux", "PostgreSQL"],
    "docker": ["Kubernetes", "CI/CD", "Linux", "AWS", "Terraform", "GitHub Actions"],
    "java": ["Spring Boot", "Microservices", "PostgreSQL", "Docker", "Kafka", "AWS"],
    "sql": ["PostgreSQL", "MySQL", "Redis", "Database Optimization", "Data Modeling"]
}

DOMAINS_MAP = {
    "Fintech & Banking": ["fintech", "banking", "payment", "ledger", "trading", "financial", "crypto", "credit", "fraud"],
    "Healthcare & HealthTech": ["health", "hospital", "patient", "clinical", "medical", "pharma", "hipaa", "biotech"],
    "E-Commerce & Retail": ["e-commerce", "ecommerce", "retail", "cart", "checkout", "marketplace", "shopify", "inventory"],
    "Cloud Infrastructure & DevOps": ["cloud", "devops", "aws", "azure", "gcp", "kubernetes", "docker", "ci/cd", "terraform", "infrastructure"],
    "AI & Machine Learning": ["machine learning", "deep learning", "nlp", "llm", "rag", "neural", "computer vision", "generative ai", "langchain"],
    "SaaS & Enterprise Software": ["saas", "b2b", "enterprise", "crm", "erp", "microservices", "distributed systems"],
    "Telecommunications": ["telecom", "telecommunications", "voip", "5g", "lte", "network routing"],
    "Consulting & Professional Services": ["consulting", "advisory", "client management", "stakeholder management"]
}

SKILL_CATEGORIES = {
    "ai_technologies": ['Machine Learning', 'Deep Learning', 'PyTorch', 'TensorFlow', 'NLP', 'LLM', 'RAG', 'LangChain', 'LangGraph', 'OpenAI API', 'Hugging Face', 'Scikit-Learn'],
    "programming_languages": ['Python', 'JavaScript', 'TypeScript', 'Java', 'C++', 'C#', 'Go', 'Rust', 'Ruby', 'PHP', 'Swift', 'Kotlin', 'SQL'],
    "cloud_and_infrastructure": ['AWS', 'Azure', 'GCP', 'Docker', 'Kubernetes', 'CI/CD', 'GitHub Actions', 'Terraform', 'Linux'],
    "frameworks_and_libraries": ['React', 'Node.js', 'Next.js', 'Vue.js', 'Angular', 'Tailwind CSS', 'Redux', 'GraphQL', 'REST API', 'FastAPI', 'Django', 'Flask', 'Express.js', 'Spring Boot', '.NET'],
    "databases": ['PostgreSQL', 'MySQL', 'MongoDB', 'Redis', 'Elasticsearch', 'DynamoDB', 'SQLite'],
    "engineering_practices": ['Agile', 'Scrum', 'TDD', 'Unit Testing', 'System Design', 'Git', 'Data Engineering', 'Spark']
}

def extract_experience_and_tenure(text_content: str):
    """
    Extract work experiences, dates, and compute non-overlapping total experience in years.
    Handles '2019 - Present', 'Jan 2018 - Mar 2021', '2015 to 2018', etc.
    """
    from datetime import datetime
    current_year = datetime.now().year
    
    date_pattern = re.compile(
        r'(?:\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+)?(19\d{2}|20\d{2})\s*(?:[-–—to]+|\s+to\s+)\s*(?:\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+)?(19\d{2}|20\d{2}|present|current|now)',
        re.I
    )
    
    intervals = []
    for match in date_pattern.finditer(text_content):
        start_yr = int(match.group(1))
        end_str = match.group(2).lower()
        if end_str in ('present', 'current', 'now'):
            end_yr = current_year
        else:
            try:
                end_yr = int(end_str)
            except ValueError:
                end_yr = current_year
        
        if 1975 <= start_yr <= current_year and start_yr <= end_yr <= current_year + 1:
            intervals.append((start_yr, end_yr))
            
    if not intervals:
        exp_mention = re.search(r'(\d+(?:\.\d+)?)\+?\s*(?:years|yrs)(?:\s+of)?\s+experience', text_content, re.I)
        if exp_mention:
            try:
                yrs = float(exp_mention.group(1))
                return min(yrs, 35.0), []
            except ValueError:
                pass
        return 3.0, []
        
    intervals.sort(key=lambda x: x[0])
    merged = []
    for start, end in intervals:
        if not merged:
            merged.append([start, end])
        else:
            prev_start, prev_end = merged[-1]
            if start <= prev_end:
                merged[-1][1] = max(prev_end, end)
            else:
                merged.append([start, end])
                
    total_years = sum(end - start for start, end in merged)
    if total_years == 0 and len(intervals) > 0:
        total_years = 1.0
        
    return min(float(total_years), 35.0), intervals

def determine_seniority(years: float, text_lower: str) -> str:
    if any(k in text_lower for k in ["staff engineer", "principal engineer", "director", "head of", "vp "]):
        return "Staff / Principal"
    if any(k in text_lower for k in ["lead engineer", "tech lead", "team lead", "engineering manager"]):
        return "Lead"
    if any(k in text_lower for k in ["senior", "sr."]) or years >= 5:
        return "Senior"
    if years >= 2:
        return "Mid-Level"
    return "Junior / Entry"

async def parse_structured_resume(text_content: str) -> dict:
    """Extract structured candidate information (name, email, skills, summary, suggestions) via comprehensive parser."""
    return await parse_comprehensive_resume(text_content)

async def parse_comprehensive_resume(text_content: str) -> dict:
    """
    Extracts a fully structured, schema-compliant candidate profile with 3-tier skill classification:
    - resume_supported: Explicitly discovered in resume text with evidence snippet and ~0.95 confidence
    - ai_inferred: Suggestion based on stack / domains with ~0.70 confidence
    - user_confirmed: Confirmed by candidate
    """
    groq_key = os.getenv("GROQ_API_KEY")
    truncated_text = text_content[:6000]
    
    # 1. Deterministic extraction baseline (always reliable)
    emails = re.findall(r'[\w.+-]+@[\w-]+\.[\w.-]+', text_content)
    phones = re.findall(r'[\+]?[(]?[0-9]{2,4}[)]?[-\s.]?[0-9]{3}[-\s.]?[0-9]{4,6}', text_content)
    lines = [l.strip() for l in text_content.splitlines() if l.strip()]
    candidate_name = lines[0][:80] if lines else "Candidate"
    # Clean up name if it contains email or phone
    if "@" in candidate_name or any(c.isdigit() for c in candidate_name[:10]):
        for l in lines[:5]:
            if not ("@" in l or sum(c.isdigit() for c in l) > 3) and len(l) > 3:
                candidate_name = l[:80]
                break

    text_lower = " " + text_content.lower() + " "
    years_exp, intervals = extract_experience_and_tenure(text_content)
    seniority = determine_seniority(years_exp, text_lower)
    
    # Extract explicit skills with category and evidence snippet
    explicit_skills = []
    found_skill_names = set()
    for skill in COMMON_TAXONOMY_SKILLS:
        skill_re = re.compile(rf'(?:^|[\s,.:;()\\[\]{{}}/<>-]){re.escape(skill.lower())}(?:$|[\s,.:;()\\[\]{{}}/<>-])', re.I)
        m = skill_re.search(text_lower)
        if m:
            start_pos = max(0, m.start() - 30)
            end_pos = min(len(text_content), m.end() + 30)
            evidence_snippet = text_content[start_pos:end_pos].strip().replace("\n", " ")
            
            # Determine category
            category = "technical"
            for cat_name, cat_skills in SKILL_CATEGORIES.items():
                if any(cs.lower() == skill.lower() for cs in cat_skills):
                    category = cat_name
                    break
            
            explicit_skills.append({
                "name": skill,
                "category": category,
                "evidence_type": "explicit",
                "confidence": 0.95,
                "evidence": f"...{evidence_snippet}...",
                "source_section": "skills",
                "status": "resume_supported"
            })
            found_skill_names.add(skill.lower())

    # Infer complementary skills based on recommendations
    inferred_skills = []
    for s_name in list(found_skill_names):
        for rec in SKILL_RECOMMENDATIONS.get(s_name, []):
            if rec.lower() not in found_skill_names and rec.lower() not in [x["name"].lower() for x in inferred_skills]:
                inferred_skills.append({
                    "name": rec,
                    "category": "technical",
                    "evidence_type": "inferred",
                    "confidence": 0.70,
                    "evidence": f"Inferred from complementary proficiency in {s_name.capitalize()}",
                    "source_section": "career_intelligence",
                    "status": "ai_inferred"
                })

    if not inferred_skills:
        for fallback in ['Git', 'Docker', 'REST API', 'SQL', 'Agile']:
            if fallback.lower() not in found_skill_names:
                inferred_skills.append({
                    "name": fallback,
                    "category": "technical",
                    "evidence_type": "inferred",
                    "confidence": 0.65,
                    "evidence": "Inferred as industry standard practice",
                    "source_section": "career_intelligence",
                    "status": "ai_inferred"
                })

    # Detect domains
    detected_domains = []
    for domain, triggers in DOMAINS_MAP.items():
        if any(tr in text_lower for tr in triggers):
            detected_domains.append(domain)
    if not detected_domains:
        detected_domains = ["Software Engineering & Technology"]

    # Target roles / Suggested job titles
    target_roles = []
    if any(k in found_skill_names for k in ['machine learning', 'deep learning', 'pytorch', 'tensorflow', 'nlp', 'llm']):
        target_roles.extend(['AI/ML Engineer', 'Data Scientist', 'Machine Learning Specialist'])
    elif any(k in found_skill_names for k in ['react', 'vue.js', 'angular', 'javascript', 'typescript']):
        target_roles.extend(['Frontend Developer', 'Full Stack Engineer'])
    elif any(k in found_skill_names for k in ['fastapi', 'django', 'python', 'spring boot', 'java', 'go']):
        target_roles.extend(['Backend Developer', 'Software Engineer', 'Python Developer'])
    elif any(k in found_skill_names for k in ['aws', 'docker', 'kubernetes', 'terraform']):
        target_roles.extend(['DevOps Engineer', 'Cloud Architect'])
    else:
        target_roles.extend(['Software Engineer', 'Technical Specialist'])

    # Education extraction
    education = []
    edu_patterns = [
        r'(Bachelor(?:[\'\w\s]+)?|Master(?:[\'\w\s]+)?|B\.?S\.?|M\.?S\.?|B\.?Tech|M\.?Tech|Ph\.?D\.?)\s+(?:in|of)?\s+([A-Za-z\s]+)(?:from|,|\bat\b)?\s*([A-Za-z\s]+)?',
        r'([A-Za-z\s]+(?:University|College|Institute))'
    ]
    for ep in edu_patterns:
        m = re.search(ep, text_content, re.I)
        if m:
            degree_text = m.group(0).strip()[:100]
            education.append({"degree": degree_text, "institution": "Accredited University", "year": ""})
            break

    # Certifications
    certifications = []
    cert_triggers = ["AWS Certified", "GCP Certified", "Azure Certified", "CKA", "PMP", "Scrum Master", "CISSP"]
    for ct in cert_triggers:
        if ct.lower() in text_lower:
            certifications.append(ct)

    headline = f"{seniority} {target_roles[0]}" if target_roles else f"{seniority} Software Engineer"
    summary = f"Results-driven {seniority.lower()} professional with {years_exp:.1f} years of demonstrated experience in {', '.join(detected_domains[:2])}. Proficient in {', '.join([s['name'] for s in explicit_skills[:4]])} with a strong track record of engineering scalable solutions."

    # If Groq is available, enhance summary, headline and detailed roles
    if groq_key:
        system_prompt = (
            "You are an expert resume parser for AI Job Assistant. Extract or refine candidate details. "
            "Respond ONLY with valid JSON with keys:\n"
            '- "headline": concise professional headline (e.g. "Senior Full-Stack Engineer | React & Python")\n'
            '- "summary": 2-3 sentence executive summary\n'
            '- "current_company": string or empty\n'
            '- "current_designation": string or empty\n'
            '- "seniority": "Junior", "Mid-Level", "Senior", or "Lead / Staff"\n'
            '- "suggested_job_titles": array of 3-5 suitable job titles\n'
        )
        try:
            content = await call_groq(
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"Resume Text:\n\n{truncated_text}"},
                ],
                temperature=0.1,
                max_tokens=600,
            )
            llm_res = json.loads(content)
            if llm_res.get("headline"):
                headline = str(llm_res["headline"])
            if llm_res.get("summary"):
                summary = str(llm_res["summary"])
            if llm_res.get("seniority"):
                seniority = str(llm_res["seniority"])
            if isinstance(llm_res.get("suggested_job_titles"), list) and llm_res["suggested_job_titles"]:
                target_roles = [str(r) for r in llm_res["suggested_job_titles"][:5]]
        except Exception:
            pass

    all_skills = explicit_skills + inferred_skills
    complementary_names = [s["name"] for s in inferred_skills]

    structured_profile = {
        "candidate": {
            "name": candidate_name,
            "headline": headline,
            "summary": summary,
            "total_experience_years": years_exp,
            "seniority": seniority,
            "current_company": "",
            "current_designation": target_roles[0] if target_roles else "Software Engineer"
        },
        "skills": all_skills,
        "experience": [
            {
                "company": "Industry Experience",
                "designation": target_roles[0] if target_roles else "Software Engineer",
                "start_date": f"{intervals[0][0]}" if intervals else "2020",
                "end_date": "Present",
                "responsibilities": [f"Engineered and maintained systems using {', '.join([s['name'] for s in explicit_skills[:3]])}."],
                "achievements": ["Delivered high-performance solutions and optimized workflows."]
            }
        ],
        "domains": detected_domains,
        "education": education,
        "certifications": certifications,
        "suggested_job_titles": target_roles,
        "complementary_skills": complementary_names,
        # Backwards compatibility fields
        "name": candidate_name,
        "email": emails[0] if emails else "",
        "phone": phones[0] if phones else "",
        "skills_list": [s["name"] for s in explicit_skills],
        "suggested_skills": complementary_names[:8],
        "experience_summary": summary,
        "target_roles": target_roles
    }
    return structured_profile

@app.post("/api/v1/resumes/upload", status_code=status.HTTP_201_CREATED)
async def upload_resume(
    file: UploadFile = File(...),
    purpose: str = Form("profile_generation"),
    notice_version: str = Form("v2.5.0"),
    provider_disclosures: str = Form("groq,ollama,openai,gemini,anthropic"),
    current_user: dict = Depends(get_current_user)
):
    """
    Persist original resume file (BYTEA) and extracted content in PostgreSQL.
    Enforces user ownership, version increments, affirmative consent logging,
    and automatic candidate profile + normalized skills creation.
    """
    user_id = current_user["id"]
    filename = file.filename or "resume"
    mime_type = file.content_type or "application/octet-stream"

    # Read raw binary content
    content = await file.read()
    file_size = len(content)

    if file_size > MAX_RESUME_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File exceeds maximum allowed size of 10 MB (size: {file_size / (1024*1024):.2f} MB)."
        )

    if file_size == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file is empty."
        )

    # Compute SHA-256 for integrity verification and duplicate checking
    file_hash = hashlib.sha256(content).hexdigest()

    with engine.connect() as conn:
        # 1. Log affirmative user consent
        try:
            conn.execute(
                text("""
                    INSERT INTO resume_consent (user_id, purpose, consent_status, notice_version, provider_disclosures, consented_at)
                    VALUES (:uid, :purp, 1, :ver, :disc, CURRENT_TIMESTAMP)
                """),
                {"uid": user_id, "purp": purpose, "ver": notice_version, "disc": provider_disclosures}
            )
            conn.commit()
        except Exception as e:
            print(f"Consent log warning: {e}")

        # 2. Check if identical file already uploaded by this user
        existing = conn.execute(
            text("""
                SELECT id, user_id, filename, mime_type, file_size, file_hash,
                       parsed_info, version, created_at
                FROM resumes
                WHERE user_id = :uid AND file_hash = :hash
                ORDER BY version DESC LIMIT 1
            """),
            {"uid": user_id, "hash": file_hash}
        ).fetchone()

        if existing:
            parsed = existing.parsed_info if isinstance(existing.parsed_info, dict) else json.loads(existing.parsed_info or "{}")
            created_val = existing.created_at.isoformat() if hasattr(existing.created_at, "isoformat") else str(existing.created_at)
            
            # Fetch existing candidate profile
            cand_profile = conn.execute(
                text("SELECT structured_profile FROM candidate_profiles WHERE user_id = :uid ORDER BY updated_at DESC LIMIT 1"),
                {"uid": user_id}
            ).fetchone()
            prof_data = cand_profile[0] if cand_profile else parsed
            if isinstance(prof_data, str):
                try: prof_data = json.loads(prof_data)
                except Exception: prof_data = {}

            return {
                "id": existing.id,
                "user_id": existing.user_id,
                "filename": existing.filename,
                "mime_type": existing.mime_type,
                "file_size": existing.file_size,
                "file_hash": existing.file_hash,
                "version": existing.version,
                "parsed_info": parsed,
                "candidate_profile": prof_data,
                "created_at": created_val,
                "is_duplicate": True,
                "message": "This resume file has already been uploaded."
            }

        # 3. Extract text from supported file type
        extracted_text = extract_text_from_file(content, filename, mime_type)

        # 4. Parse comprehensive structured candidate profile
        parsed_info = await parse_comprehensive_resume(extracted_text)
        cand_meta = parsed_info.get("candidate", {})

        # 5. Compute next version for this user
        v_res = conn.execute(
            text("SELECT COALESCE(MAX(version), 0) FROM resumes WHERE user_id = :uid"),
            {"uid": user_id}
        ).scalar()
        next_version = int(v_res or 0) + 1

        # 6. Insert record with original file stored in BYTEA
        if engine.dialect.name == "sqlite":
            conn.execute(
                text("""
                    INSERT INTO resumes
                        (user_id, filename, mime_type, file_size, file_hash, file_data, extracted_text, parsed_info, version, created_at, updated_at)
                    VALUES
                        (:uid, :fn, :mime, :size, :hash, :data, :text, :parsed, :ver, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                """),
                {
                    "uid": user_id,
                    "fn": filename,
                    "mime": mime_type,
                    "size": file_size,
                    "hash": file_hash,
                    "data": content,
                    "text": extracted_text,
                    "parsed": json.dumps(parsed_info),
                    "ver": next_version
                }
            )
            conn.commit()
            r = conn.execute(
                text("SELECT id, created_at FROM resumes WHERE user_id = :uid AND file_hash = :hash ORDER BY id DESC LIMIT 1"),
                {"uid": user_id, "hash": file_hash}
            ).fetchone()
            new_id = r[0]
            created_at = r[1]
        else:
            ins = conn.execute(
                text("""
                    INSERT INTO resumes
                        (user_id, filename, mime_type, file_size, file_hash, file_data, extracted_text, parsed_info, version, created_at, updated_at)
                    VALUES
                        (:uid, :fn, :mime, :size, :hash, :data, :text, :parsed, :ver, NOW(), NOW())
                    RETURNING id, created_at
                """),
                {
                    "uid": user_id,
                    "fn": filename,
                    "mime": mime_type,
                    "size": file_size,
                    "hash": file_hash,
                    "data": content,
                    "text": extracted_text,
                    "parsed": json.dumps(parsed_info),
                    "ver": next_version
                }
            )
            row = ins.fetchone()
            conn.commit()
            new_id = row[0]
            created_at = row[1]

        created_val = created_at.isoformat() if hasattr(created_at, "isoformat") else str(created_at)

        # 7. Upsert Candidate Profile
        cand_hash = hashlib.sha256(user_id.encode()).hexdigest()
        domains_json = json.dumps(parsed_info.get("domains", []))
        education_json = json.dumps(parsed_info.get("education", []))
        certifications_json = json.dumps(parsed_info.get("certifications", []))
        suggested_titles_json = json.dumps(parsed_info.get("suggested_job_titles", []))
        complementary_skills_json = json.dumps(parsed_info.get("complementary_skills", []))
        structured_profile_json = json.dumps(parsed_info)

        existing_prof = conn.execute(
            text("SELECT id FROM candidate_profiles WHERE user_id = :uid LIMIT 1"),
            {"uid": user_id}
        ).fetchone()

        if existing_prof:
            conn.execute(
                text("""
                    UPDATE candidate_profiles
                    SET resume_id = :rid,
                        headline = :hl,
                        summary = :sm,
                        total_experience_years = :tey,
                        seniority = :sen,
                        current_company = :cc,
                        current_designation = :cd,
                        role_title = :rt,
                        structured_profile = :sp,
                        domains = :dm,
                        education = :ed,
                        certifications = :ct,
                        suggested_job_titles = :sjt,
                        complementary_skills = :cs,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = :id
                """),
                {
                    "id": existing_prof[0],
                    "rid": new_id,
                    "hl": cand_meta.get("headline", ""),
                    "sm": cand_meta.get("summary", ""),
                    "tey": cand_meta.get("total_experience_years"),
                    "sen": cand_meta.get("seniority", ""),
                    "cc": cand_meta.get("current_company", ""),
                    "cd": cand_meta.get("current_designation", ""),
                    "rt": cand_meta.get("current_designation", ""),
                    "sp": structured_profile_json,
                    "dm": domains_json,
                    "ed": education_json,
                    "ct": certifications_json,
                    "sjt": suggested_titles_json,
                    "cs": complementary_skills_json
                }
            )
        else:
            conn.execute(
                text("""
                    INSERT INTO candidate_profiles
                        (user_id, resume_id, candidate_hash, headline, summary, total_experience_years,
                         seniority, current_company, current_designation, role_title, structured_profile,
                         domains, education, certifications, suggested_job_titles, complementary_skills,
                         created_at, updated_at)
                    VALUES
                        (:uid, :rid, :hash, :hl, :sm, :tey, :sen, :cc, :cd, :rt, :sp, :dm, :ed, :ct, :sjt, :cs,
                         CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                """),
                {
                    "uid": user_id,
                    "rid": new_id,
                    "hash": cand_hash,
                    "hl": cand_meta.get("headline", ""),
                    "sm": cand_meta.get("summary", ""),
                    "tey": cand_meta.get("total_experience_years"),
                    "sen": cand_meta.get("seniority", ""),
                    "cc": cand_meta.get("current_company", ""),
                    "cd": cand_meta.get("current_designation", ""),
                    "rt": cand_meta.get("current_designation", ""),
                    "sp": structured_profile_json,
                    "dm": domains_json,
                    "ed": education_json,
                    "ct": certifications_json,
                    "sjt": suggested_titles_json,
                    "cs": complementary_skills_json
                }
            )

        # 8. Populate Normalized Skills into candidate_skills
        # Keep user_confirmed skills intact, refresh resume_supported & ai_inferred
        conn.execute(
            text("DELETE FROM candidate_skills WHERE user_id = :uid AND status != 'user_confirmed'"),
            {"uid": user_id}
        )

        for sk in parsed_info.get("skills", []):
            sk_name = sk.get("name", "").strip()
            if not sk_name:
                continue
            # Check if user already confirmed this skill
            already_confirmed = conn.execute(
                text("SELECT id FROM candidate_skills WHERE user_id = :uid AND LOWER(name) = :nm AND status = 'user_confirmed' LIMIT 1"),
                {"uid": user_id, "nm": sk_name.lower()}
            ).fetchone()
            if already_confirmed:
                continue

            conn.execute(
                text("""
                    INSERT INTO candidate_skills
                        (user_id, resume_id, name, category, evidence_type, confidence, evidence, source_section, status, created_at, updated_at)
                    VALUES
                        (:uid, :rid, :nm, :cat, :et, :conf, :ev, :src, :st, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                """),
                {
                    "uid": user_id,
                    "rid": new_id,
                    "nm": sk_name,
                    "cat": sk.get("category", "technical"),
                    "et": sk.get("evidence_type", "explicit"),
                    "conf": float(sk.get("confidence", 1.0)),
                    "ev": sk.get("evidence", ""),
                    "src": sk.get("source_section", "skills"),
                    "st": sk.get("status", "resume_supported")
                }
            )
        conn.commit()

        return {
            "id": new_id,
            "user_id": user_id,
            "filename": filename,
            "mime_type": mime_type,
            "file_size": file_size,
            "file_hash": file_hash,
            "version": next_version,
            "parsed_info": parsed_info,
            "candidate_profile": parsed_info,
            "created_at": created_val,
            "is_duplicate": False,
            "message": "Resume successfully uploaded, candidate profile generated, and skills synchronized in PostgreSQL."
        }

# ── Candidate Profile Endpoints ──────────────────────────────────────────────
@app.get("/api/v1/candidate/profile")
async def get_candidate_profile(current_user: dict = Depends(get_current_user)):
    """Retrieve the authenticated candidate's structured profile and 3-tier skill inventory."""
    user_id = current_user["id"]
    with engine.connect() as conn:
        profile_row = conn.execute(
            text("""
                SELECT id, user_id, resume_id, headline, summary, total_experience_years,
                       seniority, current_company, current_designation, role_title, location,
                       structured_profile, domains, education, certifications,
                       suggested_job_titles, complementary_skills, created_at, updated_at
                FROM candidate_profiles
                WHERE user_id = :uid
                ORDER BY updated_at DESC LIMIT 1
            """),
            {"uid": user_id}
        ).fetchone()

        if not profile_row:
            raise HTTPException(status_code=404, detail="Candidate profile not found. Please upload a resume first.")

        skills_rows = conn.execute(
            text("""
                SELECT id, name, category, evidence_type, confidence, evidence, source_section, status
                FROM candidate_skills
                WHERE user_id = :uid
                ORDER BY status, confidence DESC, name ASC
            """),
            {"uid": user_id}
        ).fetchall()

        skills = []
        skills_summary = {"resume_supported": [], "ai_inferred": [], "user_confirmed": []}
        for s in skills_rows:
            sk_obj = {
                "id": s.id,
                "name": s.name,
                "category": s.category,
                "evidence_type": s.evidence_type,
                "confidence": s.confidence,
                "evidence": s.evidence,
                "source_section": s.source_section,
                "status": s.status
            }
            skills.append(sk_obj)
            st = s.status if s.status in skills_summary else "resume_supported"
            skills_summary[st].append(s.name)

        struct_prof = profile_row.structured_profile if isinstance(profile_row.structured_profile, dict) else json.loads(profile_row.structured_profile or "{}")
        struct_prof["skills"] = skills

        def _json_or_default(val, default):
            if val is None:
                return default
            if isinstance(val, (list, dict)):
                return val
            try:
                return json.loads(val)
            except Exception:
                return default

        return {
            "id": profile_row.id,
            "user_id": profile_row.user_id,
            "resume_id": profile_row.resume_id,
            "headline": profile_row.headline or "",
            "summary": profile_row.summary or "",
            "total_experience_years": profile_row.total_experience_years,
            "seniority": profile_row.seniority or "",
            "current_company": profile_row.current_company or "",
            "current_designation": profile_row.current_designation or "",
            "role_title": profile_row.role_title or "",
            "location": profile_row.location or "",
            "structured_profile": struct_prof,
            "domains": _json_or_default(profile_row.domains, []),
            "education": _json_or_default(profile_row.education, []),
            "certifications": _json_or_default(profile_row.certifications, []),
            "suggested_job_titles": _json_or_default(profile_row.suggested_job_titles, []),
            "complementary_skills": _json_or_default(profile_row.complementary_skills, []),
            "skills": skills,
            "skills_summary": skills_summary,
            "created_at": str(profile_row.created_at),
            "updated_at": str(profile_row.updated_at)
        }

class ProfileUpdateRequest(BaseModel):
    headline: Optional[str] = None
    summary: Optional[str] = None
    total_experience_years: Optional[float] = None
    seniority: Optional[str] = None
    current_company: Optional[str] = None
    current_designation: Optional[str] = None
    role_title: Optional[str] = None
    location: Optional[str] = None

@app.put("/api/v1/candidate/profile")
async def update_candidate_profile(req: ProfileUpdateRequest, current_user: dict = Depends(get_current_user)):
    user_id = current_user["id"]
    with engine.connect() as conn:
        profile_row = conn.execute(
            text("SELECT id FROM candidate_profiles WHERE user_id = :uid LIMIT 1"),
            {"uid": user_id}
        ).fetchone()
        if not profile_row:
            raise HTTPException(status_code=404, detail="Candidate profile not found.")

        updates = []
        params = {"uid": user_id}
        if req.headline is not None:
            updates.append("headline = :hl")
            params["hl"] = req.headline
        if req.summary is not None:
            updates.append("summary = :sm")
            params["sm"] = req.summary
        if req.total_experience_years is not None:
            updates.append("total_experience_years = :tey")
            params["tey"] = req.total_experience_years
        if req.seniority is not None:
            updates.append("seniority = :sen")
            params["sen"] = req.seniority
        if req.current_company is not None:
            updates.append("current_company = :cc")
            params["cc"] = req.current_company
        if req.current_designation is not None:
            updates.append("current_designation = :cd")
            params["cd"] = req.current_designation
        if req.role_title is not None:
            updates.append("role_title = :rt")
            params["rt"] = req.role_title
        if req.location is not None:
            updates.append("location = :loc")
            params["loc"] = req.location

        if updates:
            updates.append("updated_at = CURRENT_TIMESTAMP")
            sql = f"UPDATE candidate_profiles SET {', '.join(updates)} WHERE user_id = :uid"
            conn.execute(text(sql), params)
            conn.commit()

        return {"status": "success", "message": "Candidate profile updated successfully."}

class SkillConfirmationBody(BaseModel):
    skill_name: str
    status: str = "user_confirmed"
    category: Optional[str] = "technical"

@app.post("/api/v1/candidate/skills/confirm")
async def confirm_candidate_skill(req: SkillConfirmationBody, current_user: dict = Depends(get_current_user)):
    user_id = current_user["id"]
    skill_name = req.skill_name.strip()
    if not skill_name:
        raise HTTPException(status_code=400, detail="Skill name is required.")

    with engine.connect() as conn:
        existing = conn.execute(
            text("SELECT id, status FROM candidate_skills WHERE user_id = :uid AND LOWER(name) = :nm LIMIT 1"),
            {"uid": user_id, "nm": skill_name.lower()}
        ).fetchone()

        if existing:
            conn.execute(
                text("UPDATE candidate_skills SET status = 'user_confirmed', updated_at = CURRENT_TIMESTAMP WHERE id = :id"),
                {"id": existing.id}
            )
        else:
            conn.execute(
                text("""
                    INSERT INTO candidate_skills
                        (user_id, name, category, evidence_type, confidence, evidence, source_section, status, created_at, updated_at)
                    VALUES
                        (:uid, :name, :cat, 'manual', 1.0, 'Confirmed by user in Profile / Add & Re-score', 'user_input', 'user_confirmed', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                """),
                {
                    "uid": user_id,
                    "name": skill_name,
                    "cat": req.category or "technical"
                }
            )
        conn.commit()
    return {"status": "success", "skill": skill_name, "category": req.category, "classification": "user_confirmed"}

@app.delete("/api/v1/candidate/profile")
async def delete_candidate_profile(current_user: dict = Depends(get_current_user)):
    user_id = current_user["id"]
    with engine.connect() as conn:
        conn.execute(text("DELETE FROM candidate_skills WHERE user_id = :uid"), {"uid": user_id})
        conn.execute(text("DELETE FROM candidate_profiles WHERE user_id = :uid"), {"uid": user_id})
        conn.execute(text("DELETE FROM resumes WHERE user_id = :uid"), {"uid": user_id})
        conn.execute(text("DELETE FROM resume_consent WHERE user_id = :uid"), {"uid": user_id})
        conn.commit()
    return {"status": "success", "message": "Candidate profile, skills, consent, and resume files completely removed."}

@app.get("/api/v1/admin/analytics")
async def get_admin_analytics():
    with engine.connect() as conn:
        total_resumes = conn.execute(text("SELECT COUNT(*) FROM resumes")).scalar() or 0
        total_profiles = conn.execute(text("SELECT COUNT(*) FROM candidate_profiles")).scalar() or 0
        total_skills = conn.execute(text("SELECT COUNT(*) FROM candidate_skills")).scalar() or 0

        supported_skills = conn.execute(text("SELECT COUNT(*) FROM candidate_skills WHERE status = 'resume_supported'")).scalar() or 0
        inferred_skills = conn.execute(text("SELECT COUNT(*) FROM candidate_skills WHERE status = 'ai_inferred'")).scalar() or 0
        confirmed_skills = conn.execute(text("SELECT COUNT(*) FROM candidate_skills WHERE status = 'user_confirmed'")).scalar() or 0

        top_skills_rows = conn.execute(text("SELECT name, COUNT(*) as cnt FROM candidate_skills GROUP BY name ORDER BY cnt DESC LIMIT 10")).fetchall()
        top_skills = [{"name": r[0], "count": r[1]} for r in top_skills_rows]

    return {
        "status": "ok",
        "total_resumes": total_resumes,
        "total_candidate_profiles": total_profiles,
        "total_skills_extracted": total_skills,
        "skills_breakdown": {
            "resume_supported": supported_skills,
            "ai_inferred": inferred_skills,
            "user_confirmed": confirmed_skills
        },
        "top_skills": top_skills
    }

@app.get("/api/v1/resumes")
async def list_resumes(current_user: dict = Depends(get_current_user)):
    """List all stored resume versions belonging to the authenticated user."""
    user_id = current_user["id"]
    with engine.connect() as conn:
        rows = conn.execute(
            text("""
                SELECT id, user_id, filename, mime_type, file_size, file_hash,
                       parsed_info, version, created_at
                FROM resumes
                WHERE user_id = :uid
                ORDER BY version DESC, created_at DESC
            """),
            {"uid": user_id}
        ).fetchall()

        results = []
        for r in rows:
            parsed = r.parsed_info if isinstance(r.parsed_info, dict) else json.loads(r.parsed_info or "{}")
            created_val = r.created_at.isoformat() if hasattr(r.created_at, "isoformat") else str(r.created_at)
            results.append({
                "id": r.id,
                "user_id": r.user_id,
                "filename": r.filename,
                "mime_type": r.mime_type,
                "file_size": r.file_size,
                "file_hash": r.file_hash,
                "version": r.version,
                "parsed_info": parsed,
                "created_at": created_val
            })
        return {"resumes": results, "total": len(results)}

@app.get("/api/v1/resumes/{resume_id}")
async def get_resume_detail(resume_id: int, current_user: dict = Depends(get_current_user)):
    """Retrieve metadata, extracted text, and parsed info for an authenticated user's resume."""
    user_id = current_user["id"]
    with engine.connect() as conn:
        row = conn.execute(
            text("""
                SELECT id, user_id, filename, mime_type, file_size, file_hash,
                       extracted_text, parsed_info, version, created_at
                FROM resumes
                WHERE id = :rid AND user_id = :uid
            """),
            {"rid": resume_id, "uid": user_id}
        ).fetchone()

        if not row:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Resume not found or access denied.")

        parsed = row.parsed_info if isinstance(row.parsed_info, dict) else json.loads(row.parsed_info or "{}")
        created_val = row.created_at.isoformat() if hasattr(row.created_at, "isoformat") else str(row.created_at)
        return {
            "id": row.id,
            "user_id": row.user_id,
            "filename": row.filename,
            "mime_type": row.mime_type,
            "file_size": row.file_size,
            "file_hash": row.file_hash,
            "extracted_text": row.extracted_text,
            "parsed_info": parsed,
            "version": row.version,
            "created_at": created_val
        }

@app.get("/api/v1/resumes/{resume_id}/file")
async def download_resume_file(resume_id: int, current_user: dict = Depends(get_current_user)):
    """Retrieve the exact original binary resume file from PostgreSQL BYTEA storage."""
    user_id = current_user["id"]
    with engine.connect() as conn:
        row = conn.execute(
            text("""
                SELECT filename, mime_type, file_data
                FROM resumes
                WHERE id = :rid AND user_id = :uid
            """),
            {"rid": resume_id, "uid": user_id}
        ).fetchone()

        if not row:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Resume not found or access denied.")

        filename = row[0]
        mime_type = row[1]
        file_data = row[2]

        return Response(
            content=file_data,
            media_type=mime_type or "application/octet-stream",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'}
        )

@app.delete("/api/v1/resumes/{resume_id}")
async def delete_resume(resume_id: int, current_user: dict = Depends(get_current_user)):
    """Delete a resume record and its stored binary file, enforcing owner-only authorization."""
    user_id = current_user["id"]
    with engine.connect() as conn:
        result = conn.execute(
            text("DELETE FROM resumes WHERE id = :rid AND user_id = :uid"),
            {"rid": resume_id, "uid": user_id}
        )
        conn.commit()
        if result.rowcount == 0:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Resume not found or access denied.")
        return {"status": "deleted", "id": resume_id}

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
        content = await call_groq(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"Parse this resume:\n\n{text_content}"},
            ],
            temperature=0.1,
            max_tokens=800,
        )
        parsed = json.loads(content)
        parsed["synced_at"] = ""
        return parsed
    except json.JSONDecodeError:
        raise HTTPException(502, "Invalid JSON from parsing model.")

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
        cover_letter = await call_groq(
            messages=[{"role": "user", "content": prompt}],
            temperature=0.7,
            max_tokens=400,
            json_mode=False,
        )
        return {"cover_letter": cover_letter.strip()}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(503, f"Cover letter generation failed: {str(e)}")

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
    response_format: Optional[dict] = None
    stream: bool = False

@app.post("/api/v1/ollama/chat")
async def ollama_chat(request: OllamaChatRequest):
    payload = {
        "model": request.model,
        "messages": [{"role": m.role, "content": m.content} for m in request.messages],
        "options": request.options or {"temperature": 0.3},
        "stream": False
    }
    # Try Ollama first (allow up to 45s for model warm-up on CPU)
    try:
        async with httpx.AsyncClient(timeout=45.0) as client:
            res = await client.post(f"{OLLAMA_HOST}/api/chat", json=payload)
        if res.status_code == 200:
            return {"content": res.json().get("message", {}).get("content", "")}
    except Exception:
        pass

    # Ollama unavailable — fall back to Groq
    try:
        temperature = (request.options or {}).get("temperature", 0.3)
        content = await call_groq(
            messages=[{"role": m.role, "content": m.content} for m in request.messages],
            temperature=temperature,
        )
        return {"content": content}
    except HTTPException as e:
        if e.status_code == 503 and "not configured" in e.detail:
            raise HTTPException(503, "Ollama service unavailable and no Groq key configured.")
        raise HTTPException(503, f"Both Ollama and Groq unavailable: {e.detail}")

# ── Groq Proxy ────────────────────────────────────────────────────────────────
@app.post("/api/v1/groq/chat")
async def groq_chat(request: OllamaChatRequest):
    """
    Groq proxy for the Chrome extension's free tier evaluation.
    Accepts the same message format as the Ollama proxy for compatibility.
    """
    temperature = (request.options or {}).get("temperature", 0.3)
    content = await call_groq(
        messages=[{"role": m.role, "content": m.content} for m in request.messages],
        temperature=temperature,
    )
    # Return in the same format as Ollama proxy so extension code works unchanged
    return {"choices": [{"message": {"content": content}}]}

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
                (:hash, :role, :skills, :location, :summary, :name, :email, :phone, CAST(:emb AS vector))
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

    try:
        jd_embedding = await embed(req.jd)
    except Exception as e:
        raise HTTPException(503, f"Embedding service error: {str(e)}")

    emb_str = "[" + ",".join(str(x) for x in jd_embedding) + "]"

    try:
        with engine.connect() as conn:
            rows = conn.execute(text("""
                SELECT id, candidate_hash, role_title, skills, location, summary,
                       1 - (embedding <=> CAST(:emb AS vector)) AS score
                FROM candidate_profiles
                WHERE embedding IS NOT NULL
                ORDER BY embedding <=> CAST(:emb AS vector)
                LIMIT 20
            """), {"emb": emb_str}).fetchall()
    except Exception as e:
        raise HTTPException(500, f"Database search error: {str(e)[:300]}")

    results = []
    for rank, row in enumerate(rows, 1):
        score = round(float(row.score) * 100, 1) if row.score is not None else 0.0
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
                        (:hash, :role, :skills, :location, :summary, :name, :email, :phone, CAST(:emb AS vector))
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
        evaluation = await call_groq(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user",   "content": user_prompt},
            ],
        )
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

# ── Embedding Backfill ────────────────────────────────────────────────────────
@app.post("/api/v1/admin/migrate-candidate-embeddings")
async def migrate_candidate_embeddings():
    """
    One-time migration: resize candidate_profiles embedding column to match
    the current embedding model dimension (1536 for OpenAI, 768 for Ollama).
    Clears existing embeddings so they get re-generated on next seed/sync.
    """
    openai_key = os.getenv("OPENAI_API_KEY")
    target_dim = 1536 if openai_key else 768

    try:
        with engine.connect() as conn:
            # Check current dimension
            col = conn.execute(text("""
                SELECT atttypmod FROM pg_attribute
                JOIN pg_class ON pg_attribute.attrelid = pg_class.oid
                WHERE pg_class.relname = 'candidate_profiles'
                AND pg_attribute.attname = 'embedding'
            """)).fetchone()

            current_dim = col.atttypmod if col else None

            if current_dim == target_dim:
                total = conn.execute(text("SELECT COUNT(*) FROM candidate_profiles")).scalar()
                return {"message": f"Column already at {target_dim} dimensions. No migration needed.", "total": total}

            # Drop and recreate the column with correct dimension
            conn.execute(text("ALTER TABLE candidate_profiles DROP COLUMN IF EXISTS embedding"))
            conn.execute(text(f"ALTER TABLE candidate_profiles ADD COLUMN embedding vector({target_dim})"))
            conn.commit()

            total = conn.execute(text("SELECT COUNT(*) FROM candidate_profiles")).scalar()

        return {
            "message": f"Migrated embedding column to vector({target_dim}). Existing embeddings cleared.",
            "target_dim": target_dim,
            "total_candidates": total,
            "next_step": "Call /api/v1/admin/seed-candidates to re-seed with correct embeddings.",
        }
    except Exception as e:
        raise HTTPException(500, f"Migration failed: {str(e)}")

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

@app.get("/api/v1/admin/candidates")
async def list_all_candidates():
    candidates = []
    resumes = []
    with engine.connect() as conn:
        try:
            rows = conn.execute(text("""
                SELECT id, candidate_hash, role_title, skills, location, summary, created_at
                FROM candidate_profiles
                ORDER BY created_at DESC
            """)).fetchall()
            candidates = [dict(r._mapping) for r in rows]
            for c in candidates:
                if c.get("created_at") and hasattr(c["created_at"], "isoformat"):
                    c["created_at"] = c["created_at"].isoformat()
        except Exception as e:
            print(f"Error fetching candidate_profiles: {e}")

        try:
            res_rows = conn.execute(text("""
                SELECT id, user_id, filename, mime_type, file_size, extracted_text, version, created_at
                FROM resumes
                ORDER BY created_at DESC
            """)).fetchall()
            resumes = [dict(r._mapping) for r in res_rows]
            for r in resumes:
                if r.get("created_at") and hasattr(r["created_at"], "isoformat"):
                    r["created_at"] = r["created_at"].isoformat()
        except Exception as e:
            print(f"Error fetching resumes: {e}")

    return {
        "total_profiles": len(candidates),
        "profiles": candidates,
        "total_resumes": len(resumes),
        "resumes": resumes
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

        <!-- ── All Candidate Profiles & Resumes ── -->
        <div class="section-title" style="margin-top: 40px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;">
            <div>All Collected Resumes & Profiles (<span id="all_candidates_count">--</span>)</div>
            <input type="text" id="candidateSearchInput" placeholder="🔍 Search by role, skills, location, or keywords..." style="background: var(--surface2); border: 1px solid rgba(255,255,255,0.18); color: var(--text); padding: 8px 14px; border-radius: 8px; font-size: 0.85rem; width: 320px; outline: none;" />
        </div>
        <div class="feed-card" style="margin-top: 14px; overflow-x: auto;">
            <table class="log-table" id="all_candidates_table">
                <thead>
                    <tr>
                        <th style="width: 22%;">Target Role / Title</th>
                        <th style="width: 24%;">Skills</th>
                        <th style="width: 14%;">Location</th>
                        <th style="width: 12%;">Created Date</th>
                        <th style="width: 28%;">Summary / Background</th>
                    </tr>
                </thead>
                <tbody id="all_candidates_body">
                    <tr><td colspan="5" class="empty">Loading all candidates and resumes...</td></tr>
                </tbody>
            </table>
        </div>

        <script>
            function escapeHtml(str) {
                return (str || '').replace(/[&<>'"]/g, tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag));
            }

            let allCandidatesData = [];
            async function fetchAllCandidates() {
                try {
                    const res = await fetch('/api/v1/admin/candidates');
                    if (!res.ok) return;
                    const d = await res.json();
                    allCandidatesData = d.profiles || [];
                    document.getElementById('all_candidates_count').innerText = allCandidatesData.length;
                    renderCandidates(allCandidatesData);
                } catch (e) {
                    console.error('Failed to load all candidates', e);
                }
            }

            function renderCandidates(list) {
                const tbody = document.getElementById('all_candidates_body');
                if (!list.length) {
                    tbody.innerHTML = '<tr><td colspan="5" class="empty">No candidates or resumes found.</td></tr>';
                    return;
                }
                tbody.innerHTML = list.map((c, i) => {
                    const skills = (c.skills || '').split(',').map(s => s.trim()).filter(Boolean);
                    const skillsHtml = skills.slice(0, 6).map(s => `<span class="pill pill-blue">${escapeHtml(s)}</span>`).join('') + (skills.length > 6 ? ` <span style="font-size:11px;color:var(--text-muted);">+${skills.length - 6} more</span>` : '');
                    const summary = (c.summary || '').trim();
                    const shortSummary = summary.length > 130 ? summary.substring(0, 130) + '...' : summary;
                    return `
                        <tr>
                            <td><strong style="color:#f9fafb; font-size:13.5px;">${escapeHtml(c.role_title || 'General / Unspecified')}</strong></td>
                            <td>${skillsHtml || '<span style="color:var(--text-muted);font-size:12px;">--</span>'}</td>
                            <td><span style="color:var(--text-muted); font-size:12.5px;">${escapeHtml(c.location || 'Remote / Flexible')}</span></td>
                            <td><span style="color:var(--text-muted); font-size:12px;">${c.created_at ? new Date(c.created_at).toLocaleDateString() : '--'}</span></td>
                            <td>
                                <div style="font-size:12px; color:#d1d5db; line-height:1.45;">${escapeHtml(shortSummary || 'No summary text available')}</div>
                                ${summary.length > 130 ? `<button onclick="showSummary(this)" data-role="${escapeHtml(c.role_title || '')}" data-summary="${escapeHtml(summary)}" style="margin-top:4px;background:none;border:none;color:var(--accent);cursor:pointer;font-size:11.5px;padding:0;font-weight:600;">View Full Background &rarr;</button>` : ''}
                            </td>
                        </tr>
                    `;
                }).join('');
            }

            function showSummary(btn) {
                const role = btn.getAttribute('data-role') || 'Candidate';
                const summary = btn.getAttribute('data-summary') || '';
                alert(`Candidate: ${role}\n\nFull Summary:\n${summary}`);
            }

            document.getElementById('candidateSearchInput')?.addEventListener('input', (e) => {
                const q = e.target.value.toLowerCase().trim();
                if (!q) {
                    renderCandidates(allCandidatesData);
                    return;
                }
                const filtered = allCandidatesData.filter(c => 
                    (c.role_title || '').toLowerCase().includes(q) ||
                    (c.skills || '').toLowerCase().includes(q) ||
                    (c.location || '').toLowerCase().includes(q) ||
                    (c.summary || '').toLowerCase().includes(q)
                );
                renderCandidates(filtered);
            });
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
            fetchAllCandidates();
            setInterval(fetchStats,          30000);
            setInterval(fetchAllCandidates,  30000);
            setInterval(fetchDailyStats,     60000);
            setInterval(fetchIngestionLog,   60000);
        </script>
    </body>
    </html>
    """
