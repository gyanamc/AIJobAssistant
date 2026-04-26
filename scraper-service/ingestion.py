"""
AntiGravity Job Ingestion — Railway Cron Service
Runs daily. Sources: Adzuna, JSearch (RapidAPI), RemoteOK, Naukri RSS.
Each job is quality-checked then immediately embedded with OpenAI.
"""

import os
import json
import hashlib
import asyncio
import httpx
import feedparser
import random
from datetime import datetime, timezone
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL   = os.getenv("DATABASE_URL", "")
ADZUNA_APP_ID  = os.getenv("ADZUNA_APP_ID", "")
ADZUNA_APP_KEY = os.getenv("ADZUNA_APP_KEY", "")
JSEARCH_KEY    = os.getenv("JSEARCH_API_KEY", "")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
TARGET         = int(os.getenv("SCRAPE_TARGET", "500"))

if not DATABASE_URL:
    raise SystemExit("ERROR: DATABASE_URL not set")

if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

engine = create_engine(DATABASE_URL, pool_pre_ping=True)

# ── Roles & Locations ─────────────────────────────────────────────────────────
ROLES = [
    "software engineer", "data analyst", "machine learning engineer",
    "frontend developer", "backend developer", "full stack developer",
    "data scientist", "devops engineer", "python developer",
    "react developer", "android developer", "ios developer",
    "cloud engineer", "qa engineer", "product manager",
    "marketing manager", "sales executive", "business analyst",
    "hr executive", "content writer", "graphic designer",
    "customer support", "operations manager", "finance analyst",
    "digital marketing", "social media manager",
]

LOCATIONS = [
    "India", "Bangalore", "Mumbai", "Delhi", "Hyderabad", "Pune",
    "United States", "Remote",
]

# ── Quality check ─────────────────────────────────────────────────────────────
def is_quality_job(job: dict) -> tuple[bool, str]:
    title   = (job.get("title") or "").strip()
    company = (job.get("company") or "").strip()
    desc    = (job.get("description") or "").strip()
    url     = (job.get("apply_url") or "").strip()

    if len(title) < 3:
        return False, "missing title"
    if not company or company in ("Unknown", "N/A", ""):
        return False, "missing company"
    if not url.startswith("http"):
        return False, "invalid url"
    if len(desc) < 100:
        return False, f"short description ({len(desc)} chars)"

    spam = ["test job", "dummy", "sample posting", "lorem ipsum", "xxx"]
    if any(s in title.lower() for s in spam):
        return False, "spam title"

    return True, "ok"

# ── Embedding ─────────────────────────────────────────────────────────────────
async def embed(text_input: str) -> list | None:
    if not OPENAI_API_KEY:
        return None
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            res = await client.post(
                "https://api.openai.com/v1/embeddings",
                headers={"Authorization": f"Bearer {OPENAI_API_KEY}", "Content-Type": "application/json"},
                json={"model": "text-embedding-3-small", "input": text_input[:8000]}
            )
            if res.status_code == 200:
                return res.json()["data"][0]["embedding"]
            print(f"  OpenAI error {res.status_code}: {res.text[:100]}")
    except Exception as e:
        print(f"  Embed error: {e}")
    return None

# ── DB helpers ────────────────────────────────────────────────────────────────
def stable_id(source: str, url: str, title: str) -> str:
    return hashlib.sha256(f"{source}:{url}:{title}".encode()).hexdigest()[:32]

def job_exists(job_id: str) -> bool:
    with engine.connect() as conn:
        return conn.execute(
            text("SELECT 1 FROM job_listings WHERE id = :id"), {"id": job_id}
        ).fetchone() is not None

def insert_job(job: dict, embedding: list | None) -> bool:
    emb_str = ("[" + ",".join(str(x) for x in embedding) + "]") if embedding else None
    try:
        with engine.connect() as conn:
            result = conn.execute(text("""
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
                "location":    (job.get("location") or "")[:300],
                "source":      job["source"],
                "description": job["description"][:10000],
                "apply_url":   job["apply_url"][:1000],
                "emb":         emb_str,
            })
            conn.commit()
            return result.rowcount > 0
    except Exception as e:
        print(f"  Insert error: {e}")
        return False

async def process(job: dict, stats: dict) -> bool:
    """Quality check → embed → insert. Returns True if inserted."""
    passes, reason = is_quality_job(job)
    if not passes:
        stats["rejected"] += 1
        return False
    if job_exists(job["id"]):
        stats["skipped"] += 1
        return False
    embedding = await embed(f"{job['title']} {job.get('company','')} {job['description'][:600]}")
    inserted = insert_job(job, embedding)
    if inserted:
        stats["inserted"] += 1
        emb = "✓" if embedding else "⚠"
        print(f"  [{stats['inserted']}] {emb} {job['title']} @ {job['company']}")
    return inserted

# ── Source 1: RemoteOK ────────────────────────────────────────────────────────
async def fetch_remoteok() -> list:
    try:
        async with httpx.AsyncClient(timeout=15.0, headers={"User-Agent": "AntiGravity/1.0"}) as client:
            res = await client.get("https://remoteok.com/api")
        if res.status_code != 200:
            return []
        jobs = []
        for item in res.json()[1:]:
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
        return jobs[:60]
    except Exception as e:
        print(f"RemoteOK error: {e}")
        return []

# ── Source 2: Naukri RSS ──────────────────────────────────────────────────────
def fetch_naukri_rss(role: str) -> list:
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
            parts   = title.split(" - ")
            company = parts[-1].strip() if len(parts) > 1 else "Unknown"
            clean   = parts[0].strip() if len(parts) > 1 else title
            jobs.append({
                "id":          stable_id("naukri", link, title),
                "title":       clean,
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

# ── Source 3: Adzuna ──────────────────────────────────────────────────────────
async def fetch_adzuna(role: str, country: str) -> list:
    if not ADZUNA_APP_ID or not ADZUNA_APP_KEY:
        return []
    code = "in" if country == "India" else "us"
    url = (
        f"https://api.adzuna.com/v1/api/jobs/{code}/search/1"
        f"?app_id={ADZUNA_APP_ID}&app_key={ADZUNA_APP_KEY}"
        f"&results_per_page=20&what={role.replace(' ', '+')}&content-type=application/json"
    )
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            res = await client.get(url)
        if res.status_code != 200:
            return []
        jobs = []
        for item in res.json().get("results", []):
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

# ── Source 4: JSearch ─────────────────────────────────────────────────────────
async def fetch_jsearch(role: str, location: str) -> list:
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
            jobs.append({
                "id":          stable_id("jsearch", item.get("job_apply_link", ""), item.get("job_title", "")),
                "title":       item.get("job_title", ""),
                "company":     item.get("employer_name", "Unknown"),
                "location":    f"{item.get('job_city', '')}, {item.get('job_country', '')}".strip(", "),
                "source":      "linkedin" if "linkedin" in item.get("job_apply_link", "").lower() else "naukri",
                "description": desc,
                "apply_url":   item.get("job_apply_link", ""),
            })
        return jobs
    except Exception as e:
        print(f"JSearch error ({role}, {location}): {e}")
        return []

# ── Main ──────────────────────────────────────────────────────────────────────
async def main():
    print(f"\n{'='*60}")
    print(f"AntiGravity Job Ingestion — {datetime.now().strftime('%Y-%m-%d %H:%M UTC')}")
    print(f"Target: {TARGET} jobs | OpenAI: {'✓' if OPENAI_API_KEY else '✗'}")
    print(f"{'='*60}\n")

    stats = {"inserted": 0, "skipped": 0, "rejected": 0}
    roles = ROLES.copy()
    random.shuffle(roles)

    # 1. RemoteOK
    print("── RemoteOK ──")
    for job in await fetch_remoteok():
        if stats["inserted"] >= TARGET:
            break
        await process(job, stats)

    # 2. Naukri RSS
    print("\n── Naukri RSS ──")
    for role in roles:
        if stats["inserted"] >= TARGET:
            break
        for job in fetch_naukri_rss(role):
            if stats["inserted"] >= TARGET:
                break
            await process(job, stats)
        await asyncio.sleep(1)

    # 3. Adzuna
    print("\n── Adzuna ──")
    for role in roles:
        if stats["inserted"] >= TARGET:
            break
        for country in ["India", "United States"]:
            if stats["inserted"] >= TARGET:
                break
            for job in await fetch_adzuna(role, country):
                if stats["inserted"] >= TARGET:
                    break
                await process(job, stats)
            await asyncio.sleep(random.uniform(0.5, 1.5))

    # 4. JSearch
    if stats["inserted"] < TARGET and JSEARCH_KEY:
        print("\n── JSearch ──")
        for role in roles:
            if stats["inserted"] >= TARGET:
                break
            for loc in random.sample(LOCATIONS, min(3, len(LOCATIONS))):
                if stats["inserted"] >= TARGET:
                    break
                for job in await fetch_jsearch(role, loc):
                    if stats["inserted"] >= TARGET:
                        break
                    await process(job, stats)
                await asyncio.sleep(random.uniform(1, 2))

    print(f"\n{'='*60}")
    print(f"✅ Done — {datetime.now().strftime('%H:%M UTC')}")
    print(f"   Inserted:  {stats['inserted']}")
    print(f"   Skipped:   {stats['skipped']} (duplicates)")
    print(f"   Rejected:  {stats['rejected']} (quality check)")
    print(f"{'='*60}\n")

if __name__ == "__main__":
    asyncio.run(main())
