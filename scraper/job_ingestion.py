"""
Job Ingestion Pipeline
Runs daily on Railway as a scheduled job.
Sources: Adzuna API, JSearch (RapidAPI), RemoteOK, Naukri RSS
Target: 500 jobs/day into job_listings table with embeddings
"""

import os
import json
import hashlib
import asyncio
import httpx
import feedparser
import random
import time
from datetime import datetime, timezone
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL  = os.getenv("DATABASE_URL", "")
ADZUNA_APP_ID = os.getenv("ADZUNA_APP_ID", "")
ADZUNA_APP_KEY= os.getenv("ADZUNA_APP_KEY", "")
JSEARCH_KEY   = os.getenv("JSEARCH_API_KEY", "")  # RapidAPI key
GROQ_API_KEY  = os.getenv("GROQ_API_KEY", "")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OLLAMA_HOST   = os.getenv("OLLAMA_HOST", "http://localhost:11434")

if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

engine = create_engine(DATABASE_URL)

# ── Target roles and locations ────────────────────────────────────────────────
TECH_ROLES = [
    "software engineer", "data analyst", "machine learning engineer",
    "frontend developer", "backend developer", "full stack developer",
    "data scientist", "devops engineer", "python developer",
    "react developer", "android developer", "ios developer",
    "cloud engineer", "qa engineer", "product manager",
]

NON_TECH_ROLES = [
    "marketing manager", "sales executive", "business analyst",
    "hr executive", "content writer", "graphic designer",
    "customer support", "operations manager", "finance analyst",
    "project coordinator", "digital marketing", "social media manager",
]

ALL_ROLES = TECH_ROLES + NON_TECH_ROLES

INDIA_LOCATIONS = ["India", "Bangalore", "Mumbai", "Delhi", "Hyderabad", "Pune", "Chennai"]
USA_LOCATIONS   = ["United States", "New York", "San Francisco", "Austin", "Remote"]
ALL_LOCATIONS   = INDIA_LOCATIONS + USA_LOCATIONS

# ── Quality check ─────────────────────────────────────────────────────────────
def is_quality_job(job: dict) -> tuple[bool, str]:
    """Returns (passes, reason). Rejects spam, incomplete, or low-quality jobs."""
    title = job.get("title", "").strip()
    company = job.get("company", "").strip()
    desc = job.get("description", "").strip()
    apply_url = job.get("apply_url", "").strip()

    if not title or len(title) < 3:
        return False, "missing title"
    if not company or company in ("Unknown", "", "N/A"):
        return False, "missing company"
    if not apply_url or not apply_url.startswith("http"):
        return False, "invalid apply_url"
    if len(desc) < 100:
        return False, f"description too short ({len(desc)} chars)"

    spam_keywords = ["test job", "dummy", "sample posting", "xxx", "asdf", "lorem ipsum"]
    title_lower = title.lower()
    if any(kw in title_lower for kw in spam_keywords):
        return False, f"spam title: {title}"

    return True, "ok"

# ── Embedding via OpenAI (primary) or Ollama (fallback) ───────────────────────
async def embed_text(text_input: str) -> list[float] | None:
    """Generate embedding using OpenAI text-embedding-3-small (1536-dim).
    Falls back to Ollama nomic-embed-text (768-dim) if no OpenAI key.
    Returns None if both fail — job will be inserted without embedding for later backfill.
    """
    if OPENAI_API_KEY:
        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                res = await client.post(
                    "https://api.openai.com/v1/embeddings",
                    headers={
                        "Authorization": f"Bearer {OPENAI_API_KEY}",
                        "Content-Type": "application/json"
                    },
                    json={"model": "text-embedding-3-small", "input": text_input[:8000]}
                )
                if res.status_code == 200:
                    return res.json()["data"][0]["embedding"]
                print(f"  OpenAI embedding error: {res.status_code}")
        except Exception as e:
            print(f"  OpenAI embedding exception: {e}")

    # Fallback: Ollama
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            res = await client.post(f"{OLLAMA_HOST}/api/embeddings", json={
                "model": "nomic-embed-text",
                "prompt": text_input[:2000]
            })
            if res.status_code == 200:
                return res.json()["embedding"]
    except Exception:
        pass

    return None

# ── DB helpers ────────────────────────────────────────────────────────────────
def job_exists(job_id: str) -> bool:
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT 1 FROM job_listings WHERE id = :id"), {"id": job_id}
        ).fetchone()
    return row is not None

def insert_job(job: dict, embedding: list[float] | None):
    emb_str = ("[" + ",".join(str(x) for x in embedding) + "]") if embedding else None
    with engine.connect() as conn:
        conn.execute(text("""
            INSERT INTO job_listings
                (id, title, company, location, source, description, apply_url, embedding, scraped_at, updated_at)
            VALUES
                (:id, :title, :company, :location, :source, :description, :apply_url,
                 :emb::vector, NOW(), NOW())
            ON CONFLICT (id) DO NOTHING
        """), {
            "id":          job["id"],
            "title":       job["title"][:500],
            "company":     job["company"][:300],
            "location":    job.get("location", "")[:300],
            "source":      job["source"],
            "description": job["description"][:10000],
            "apply_url":   job["apply_url"][:1000],
            "emb":         emb_str,
        })
        conn.commit()

def stable_id(source: str, url: str, title: str) -> str:
    raw = f"{source}:{url}:{title}"
    return hashlib.sha256(raw.encode()).hexdigest()[:32]

# ── Source 1: Adzuna API ──────────────────────────────────────────────────────
async def fetch_adzuna(role: str, country: str, page: int = 1) -> list[dict]:
    """country: 'gb','us','in' etc. Adzuna India = 'in'"""
    if not ADZUNA_APP_ID or not ADZUNA_APP_KEY:
        return []
    country_code = "in" if country == "India" else "us"
    url = (f"https://api.adzuna.com/v1/api/jobs/{country_code}/search/{page}"
           f"?app_id={ADZUNA_APP_ID}&app_key={ADZUNA_APP_KEY}"
           f"&results_per_page=20&what={role.replace(' ', '+')}&content-type=application/json")
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            res = await client.get(url)
        if res.status_code != 200:
            return []
        data = res.json()
        jobs = []
        for item in data.get("results", []):
            desc = item.get("description", "")
            if len(desc) < 50:
                continue
            jobs.append({
                "id":          stable_id("adzuna", item.get("redirect_url", ""), item.get("title", "")),
                "title":       item.get("title", ""),
                "company":     item.get("company", {}).get("display_name", "Unknown"),
                "location":    item.get("location", {}).get("display_name", country),
                "source":      "adzuna",
                "description": desc,
                "apply_url":   item.get("redirect_url", ""),
            })
        return jobs
    except Exception as e:
        print(f"Adzuna error ({role}, {country}): {e}")
        return []

# ── Source 2: JSearch via RapidAPI ────────────────────────────────────────────
async def fetch_jsearch(role: str, location: str) -> list[dict]:
    """JSearch scrapes LinkedIn, Indeed, Glassdoor via RapidAPI."""
    if not JSEARCH_KEY:
        return []
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            res = await client.get(
                "https://jsearch.p.rapidapi.com/search",
                params={"query": f"{role} in {location}", "num_pages": "1", "page": "1"},
                headers={"X-RapidAPI-Key": JSEARCH_KEY, "X-RapidAPI-Host": "jsearch.p.rapidapi.com"}
            )
        if res.status_code != 200:
            return []
        jobs = []
        for item in res.json().get("data", []):
            desc = item.get("job_description", "")
            if len(desc) < 50:
                continue
            source = "linkedin" if "linkedin" in item.get("job_apply_link", "").lower() else "naukri"
            jobs.append({
                "id":          stable_id("jsearch", item.get("job_apply_link", ""), item.get("job_title", "")),
                "title":       item.get("job_title", ""),
                "company":     item.get("employer_name", "Unknown"),
                "location":    f"{item.get('job_city', '')}, {item.get('job_country', '')}".strip(", "),
                "source":      source,
                "description": desc,
                "apply_url":   item.get("job_apply_link", ""),
            })
        return jobs
    except Exception as e:
        print(f"JSearch error ({role}, {location}): {e}")
        return []

# ── Source 3: RemoteOK (free, no auth) ───────────────────────────────────────
async def fetch_remoteok() -> list[dict]:
    try:
        async with httpx.AsyncClient(timeout=15.0, headers={"User-Agent": "JobSwipeApp/1.0"}) as client:
            res = await client.get("https://remoteok.com/api")
        if res.status_code != 200:
            return []
        jobs = []
        for item in res.json()[1:]:  # first item is metadata
            desc = item.get("description", "")
            if len(desc) < 50:
                continue
            jobs.append({
                "id":          stable_id("remoteok", item.get("url", ""), item.get("position", "")),
                "title":       item.get("position", ""),
                "company":     item.get("company", "Unknown"),
                "location":    "Remote",
                "source":      "remoteok",
                "description": desc,
                "apply_url":   item.get("url", ""),
            })
        return jobs[:50]  # cap at 50
    except Exception as e:
        print(f"RemoteOK error: {e}")
        return []

# ── Source 4: Naukri RSS ──────────────────────────────────────────────────────
def fetch_naukri_rss(role: str) -> list[dict]:
    """Naukri exposes public RSS feeds — no auth, no scraping."""
    query = role.replace(" ", "-").lower()
    url = f"https://www.naukri.com/rss/jobsearch/{query}-jobs"
    try:
        feed = feedparser.parse(url)
        jobs = []
        for entry in feed.entries[:20]:
            title = entry.get("title", "")
            link  = entry.get("link", "")
            desc  = entry.get("summary", entry.get("description", ""))
            if not title or not link or len(desc) < 30:
                continue
            # Extract company from title if possible (Naukri format: "Role - Company")
            parts = title.split(" - ")
            company = parts[-1].strip() if len(parts) > 1 else "Unknown"
            clean_title = parts[0].strip() if len(parts) > 1 else title
            jobs.append({
                "id":          stable_id("naukri", link, title),
                "title":       clean_title,
                "company":     company,
                "location":    "India",
                "source":      "naukri",
                "description": desc,
                "apply_url":   link,
            })
        return jobs
    except Exception as e:
        print(f"Naukri RSS error ({role}): {e}")
        return []

# ── Main pipeline ─────────────────────────────────────────────────────────────
async def run_pipeline(target: int = 500):
    print(f"[{datetime.now()}] Starting job ingestion pipeline. Target: {target} jobs.")
    inserted = 0
    skipped  = 0

    # Shuffle roles so we get variety each run
    roles = ALL_ROLES.copy()
    random.shuffle(roles)

    # 1. RemoteOK — free batch
    print("Fetching RemoteOK jobs...")
    remote_jobs = await fetch_remoteok()
    for job in remote_jobs:
        if inserted >= target:
            break
        if job_exists(job["id"]):
            skipped += 1
            continue
        passes, reason = is_quality_job(job)
        if not passes:
            print(f"  ⚠️  Rejected: {job.get('title', '?')} — {reason}")
            skipped += 1
            continue
        embedding = await embed_text(f"{job['title']} {job['description'][:500]}")
        insert_job(job, embedding)
        inserted += 1
        emb_status = "✓ embedded" if embedding else "⚠ no embedding"
        print(f"  [{inserted}] {job['title']} @ {job['company']} ({emb_status})")

    # 2. Naukri RSS — free, no auth
    print("Fetching Naukri RSS jobs...")
    for role in roles:
        if inserted >= target:
            break
        naukri_jobs = fetch_naukri_rss(role)
        for job in naukri_jobs:
            if inserted >= target:
                break
            if job_exists(job["id"]):
                skipped += 1
                continue
            passes, reason = is_quality_job(job)
            if not passes:
                skipped += 1
                continue
            embedding = await embed_text(f"{job['title']} {job['description'][:500]}")
            insert_job(job, embedding)
            inserted += 1
            emb_status = "✓ embedded" if embedding else "⚠ no embedding"
            print(f"  [{inserted}] {job['title']} @ {job['company']} (naukri rss | {emb_status})")
        await asyncio.sleep(1)

    # 3. Adzuna — India + USA
    print("Fetching Adzuna jobs...")
    for role in roles:
        if inserted >= target:
            break
        for country in ["India", "United States"]:
            if inserted >= target:
                break
            jobs = await fetch_adzuna(role, country)
            for job in jobs:
                if inserted >= target:
                    break
                if job_exists(job["id"]):
                    skipped += 1
                    continue
                passes, reason = is_quality_job(job)
                if not passes:
                    skipped += 1
                    continue
                embedding = await embed_text(f"{job['title']} {job['description'][:500]}")
                insert_job(job, embedding)
                inserted += 1
                emb_status = "✓ embedded" if embedding else "⚠ no embedding"
                print(f"  [{inserted}] {job['title']} @ {job['company']} ({country} | {emb_status})")
            await asyncio.sleep(random.uniform(0.5, 1.5))

    # 4. JSearch — fills remaining quota
    if inserted < target and JSEARCH_KEY:
        print("Fetching JSearch jobs...")
        for role in roles:
            if inserted >= target:
                break
            for location in random.sample(ALL_LOCATIONS, min(3, len(ALL_LOCATIONS))):
                if inserted >= target:
                    break
                jobs = await fetch_jsearch(role, location)
                for job in jobs:
                    if inserted >= target:
                        break
                    if job_exists(job["id"]):
                        skipped += 1
                        continue
                    passes, reason = is_quality_job(job)
                    if not passes:
                        skipped += 1
                        continue
                    embedding = await embed_text(f"{job['title']} {job['description'][:500]}")
                    insert_job(job, embedding)
                    inserted += 1
                    emb_status = "✓ embedded" if embedding else "⚠ no embedding"
                    print(f"  [{inserted}] {job['title']} @ {job['company']} ({location} | {emb_status})")
                await asyncio.sleep(random.uniform(1, 2))

    print(f"\n✅ Pipeline complete. Inserted: {inserted}, Skipped (duplicates): {skipped}")
    return inserted

if __name__ == "__main__":
    asyncio.run(run_pipeline(target=500))
