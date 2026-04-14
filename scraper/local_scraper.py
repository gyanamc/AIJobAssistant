"""
Local Job Scraper — runs on your Mac
Scrapes LinkedIn + Naukri using Playwright with stealth
Pushes jobs to Railway PostgreSQL with embeddings
Run: python scraper/local_scraper.py
Schedule: add to cron or run manually daily
"""

import os
import sys
import json
import time
import random
import hashlib
import asyncio
import httpx
from datetime import datetime
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

load_dotenv()

DATABASE_URL  = os.getenv("DATABASE_URL", "")
GROQ_API_KEY  = os.getenv("GROQ_API_KEY", "")
OLLAMA_HOST   = os.getenv("OLLAMA_HOST", "http://localhost:11434")

if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

engine = create_engine(DATABASE_URL)

# ── Cookies paths ─────────────────────────────────────────────────────────────
DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'data')
LINKEDIN_COOKIES = os.path.join(DATA_DIR, 'scraper_linkedin_cookies.json')
NAUKRI_COOKIES   = os.path.join(DATA_DIR, 'scraper_naukri_cookies.json')

# ── Target roles ──────────────────────────────────────────────────────────────
ROLES = [
    # Technical
    "software engineer", "data analyst", "python developer",
    "frontend developer", "backend developer", "full stack developer",
    "machine learning engineer", "data scientist", "devops engineer",
    "react developer", "android developer", "cloud engineer",
    "qa engineer", "product manager", "ui ux designer",
    # Non-technical
    "marketing manager", "sales executive", "business analyst",
    "hr executive", "content writer", "graphic designer",
    "customer support", "operations manager", "finance analyst",
    "digital marketing", "social media manager", "project coordinator",
]

LOCATIONS_INDIA = ["Bangalore", "Mumbai", "Delhi", "Hyderabad", "Pune", "Chennai", "India"]
LOCATIONS_USA   = ["New York", "San Francisco", "Austin", "Chicago", "Remote"]

# ── Stealth helpers ───────────────────────────────────────────────────────────
def human_delay(min_s=2.0, max_s=5.0):
    time.sleep(random.uniform(min_s, max_s))

def random_scroll(page):
    """Simulate human scrolling."""
    for _ in range(random.randint(2, 4)):
        scroll_y = random.randint(300, 800)
        page.evaluate(f"window.scrollBy(0, {scroll_y})")
        time.sleep(random.uniform(0.5, 1.5))

# ── DB helpers ────────────────────────────────────────────────────────────────
def stable_id(source: str, url: str, title: str) -> str:
    return hashlib.sha256(f"{source}:{url}:{title}".encode()).hexdigest()[:32]

def job_exists(job_id: str) -> bool:
    with engine.connect() as conn:
        return conn.execute(
            text("SELECT 1 FROM job_listings WHERE id = :id"), {"id": job_id}
        ).fetchone() is not None

def insert_job(job: dict, embedding: list | None):
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

# ── Embedding ─────────────────────────────────────────────────────────────────
async def embed(text_input: str) -> list | None:
    """Try Ollama first, skip embedding if unavailable."""
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            res = await client.post(f"{OLLAMA_HOST}/api/embeddings", json={
                "model": "nomic-embed-text",
                "prompt": text_input[:1500]
            })
            if res.status_code == 200:
                return res.json()["embedding"]
    except Exception:
        pass
    return None

# ── LinkedIn Scraper ──────────────────────────────────────────────────────────
class LinkedInJobScraper:
    def __init__(self):
        from playwright.sync_api import sync_playwright
        try:
            from playwright_stealth import Stealth
            self.stealth = Stealth()
        except ImportError:
            self.stealth = None

        self.pw = sync_playwright().start()
        self.browser = self.pw.chromium.launch(
            headless=False,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
                "--disable-dev-shm-usage",
            ]
        )
        self.context = self.browser.new_context(
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            viewport={"width": 1366, "height": 768},
            locale="en-US",
            timezone_id="Asia/Kolkata",
        )
        self.page = self.context.new_page()
        if self.stealth:
            self.stealth.apply_stealth_sync(self.page)

    def load_cookies(self) -> bool:
        if os.path.exists(LINKEDIN_COOKIES):
            with open(LINKEDIN_COOKIES) as f:
                self.context.add_cookies(json.load(f))
            return True
        return False

    def save_cookies(self):
        os.makedirs(DATA_DIR, exist_ok=True)
        with open(LINKEDIN_COOKIES, 'w') as f:
            json.dump(self.context.cookies(), f)

    def login(self):
        self.page.goto('https://www.linkedin.com/login', wait_until='domcontentloaded')
        print("\n[LinkedIn] Please log in with your SCRAPER account in the browser.")
        print("Press Enter here once you're on the LinkedIn feed...")
        input()
        self.save_cookies()
        print("[LinkedIn] Cookies saved.")

    def init(self):
        if self.load_cookies():
            self.page.goto('https://www.linkedin.com/feed/', wait_until='domcontentloaded')
            human_delay(2, 3)
            if "login" in self.page.url or "checkpoint" in self.page.url:
                print("[LinkedIn] Session expired, need to log in again.")
                self.login()
            else:
                print("[LinkedIn] Session restored.")
        else:
            self.login()

    def scrape_jobs(self, role: str, location: str, max_jobs: int = 25) -> list[dict]:
        url = (f"https://www.linkedin.com/jobs/search/"
               f"?keywords={role.replace(' ', '%20')}"
               f"&location={location.replace(' ', '%20')}"
               f"&sortBy=DD")  # sort by date — freshest jobs
        try:
            self.page.goto(url, wait_until='domcontentloaded', timeout=30000)
        except Exception:
            pass
        human_delay(3, 5)
        random_scroll(self.page)

        jobs = []
        cards = self.page.locator('.job-card-container, .jobs-search-results__list-item')
        count = min(cards.count(), max_jobs)

        for i in range(count):
            try:
                card = cards.nth(i)
                card.scroll_into_view_if_needed()
                human_delay(0.3, 0.8)

                job_id = card.get_attribute('data-job-id') or card.locator('[data-job-id]').first.get_attribute('data-job-id')
                if not job_id:
                    continue

                title_el = card.locator('.job-card-list__title, .artdeco-entity-lockup__title')
                company_el = card.locator('.job-card-container__company-name, .artdeco-entity-lockup__subtitle')
                location_el = card.locator('.job-card-container__metadata-item, .artdeco-entity-lockup__caption')

                title   = title_el.first.inner_text().strip() if title_el.count() > 0 else ""
                company = company_el.first.inner_text().strip() if company_el.count() > 0 else "Unknown"
                loc     = location_el.first.inner_text().strip() if location_el.count() > 0 else location

                if not title:
                    continue

                apply_url = f"https://www.linkedin.com/jobs/view/{job_id}/"
                jobs.append({
                    "id":       stable_id("linkedin", apply_url, title),
                    "title":    title,
                    "company":  company,
                    "location": loc,
                    "source":   "linkedin",
                    "apply_url": apply_url,
                    "job_id":   job_id,
                })
            except Exception as e:
                continue

        return jobs

    def get_description(self, job_id: str) -> str:
        url = f"https://www.linkedin.com/jobs/view/{job_id}/"
        try:
            self.page.goto(url, wait_until='domcontentloaded', timeout=20000)
        except Exception:
            pass
        human_delay(2, 4)

        # Click "See more" if present
        try:
            see_more = self.page.locator('button.jobs-description__footer-button, button[aria-label*="more"]')
            if see_more.count() > 0 and see_more.first.is_visible():
                see_more.first.click()
                human_delay(0.5, 1)
        except Exception:
            pass

        for selector in ['.jobs-description__content', '#job-details', '.description__text']:
            el = self.page.locator(selector)
            if el.count() > 0:
                text = el.first.inner_text().strip()
                if len(text) > 100:
                    return text
        return ""

    def cleanup(self):
        self.context.close()
        self.browser.close()
        self.pw.stop()


# ── Naukri Scraper ────────────────────────────────────────────────────────────
class NaukriJobScraper:
    def __init__(self):
        from playwright.sync_api import sync_playwright
        try:
            from playwright_stealth import Stealth
            self.stealth = Stealth()
        except ImportError:
            self.stealth = None

        self.pw = sync_playwright().start()
        self.browser = self.pw.chromium.launch(
            headless=False,
            args=["--disable-blink-features=AutomationControlled"]
        )
        self.context = self.browser.new_context(
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            viewport={"width": 1366, "height": 768},
            locale="en-IN",
            timezone_id="Asia/Kolkata",
        )
        self.page = self.context.new_page()
        if self.stealth:
            self.stealth.apply_stealth_sync(self.page)

    def load_cookies(self) -> bool:
        if os.path.exists(NAUKRI_COOKIES):
            with open(NAUKRI_COOKIES) as f:
                self.context.add_cookies(json.load(f))
            return True
        return False

    def save_cookies(self):
        os.makedirs(DATA_DIR, exist_ok=True)
        with open(NAUKRI_COOKIES, 'w') as f:
            json.dump(self.context.cookies(), f)

    def login(self):
        self.page.goto('https://www.naukri.com/mnjuser/homepage', wait_until='domcontentloaded')
        print("\n[Naukri] Please log in with your SCRAPER account in the browser.")
        print("Press Enter here once you're on the Naukri homepage...")
        input()
        self.save_cookies()
        print("[Naukri] Cookies saved.")

    def init(self):
        if self.load_cookies():
            self.page.goto('https://www.naukri.com/', wait_until='domcontentloaded')
            human_delay(2, 3)
            if self.page.locator('a[title="Jobseeker Login"]').count() > 0:
                print("[Naukri] Session expired, need to log in again.")
                self.login()
            else:
                print("[Naukri] Session restored.")
        else:
            self.login()

    def scrape_jobs(self, role: str, location: str, max_jobs: int = 25) -> list[dict]:
        query = role.replace(' ', '-').lower()
        loc   = location.replace(' ', '-').lower()
        url   = f"https://www.naukri.com/{query}-jobs-in-{loc}"
        try:
            self.page.goto(url, wait_until='domcontentloaded', timeout=30000)
        except Exception:
            pass
        human_delay(3, 5)
        random_scroll(self.page)

        jobs = []
        cards = self.page.locator('.srp-jobtuple-wrapper, article.jobTuple')
        count = min(cards.count(), max_jobs)

        for i in range(count):
            try:
                card = cards.nth(i)
                card.scroll_into_view_if_needed()
                human_delay(0.2, 0.6)

                title_el   = card.locator('a.title, a.job-title')
                company_el = card.locator('a.comp-name, .company_name')
                loc_el     = card.locator('.locWdth, .location')

                if title_el.count() == 0:
                    continue

                title     = title_el.first.inner_text().strip()
                apply_url = title_el.first.get_attribute('href') or ""
                if apply_url.startswith('/'):
                    apply_url = "https://www.naukri.com" + apply_url
                company   = company_el.first.inner_text().strip() if company_el.count() > 0 else "Unknown"
                loc_text  = loc_el.first.inner_text().strip() if loc_el.count() > 0 else location

                if not title or not apply_url:
                    continue

                jobs.append({
                    "id":        stable_id("naukri", apply_url, title),
                    "title":     title,
                    "company":   company,
                    "location":  loc_text,
                    "source":    "naukri",
                    "apply_url": apply_url,
                })
            except Exception:
                continue

        return jobs

    def get_description(self, url: str) -> str:
        try:
            self.page.goto(url, wait_until='domcontentloaded', timeout=20000)
        except Exception:
            pass
        human_delay(2, 3)

        for selector in ['.job-desc', '.dang-inner-html', '#jobDescription', '.jobDescription']:
            el = self.page.locator(selector)
            if el.count() > 0:
                text = el.first.inner_text().strip()
                if len(text) > 100:
                    return text
        return ""

    def cleanup(self):
        self.context.close()
        self.browser.close()
        self.pw.stop()


# ── Main pipeline ─────────────────────────────────────────────────────────────
async def process_job(job: dict, description: str) -> bool:
    """Embed and insert a job. Returns True if inserted."""
    if not description or len(description) < 50:
        return False
    job["description"] = description
    embedding = await embed(f"{job['title']} {description[:800]}")
    insert_job(job, embedding)
    return True

def run_pipeline(target: int = 500):
    print(f"\n{'='*50}")
    print(f"Job Scraper — {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    print(f"Target: {target} jobs")
    print(f"{'='*50}\n")

    inserted = 0
    skipped  = 0

    roles = ROLES.copy()
    random.shuffle(roles)

    # ── LinkedIn ──────────────────────────────────────────────────────────────
    print("\n[1/2] Starting LinkedIn scraper...")
    li = LinkedInJobScraper()
    try:
        li.init()
        locations = LOCATIONS_INDIA + LOCATIONS_USA
        random.shuffle(locations)

        for role in roles:
            if inserted >= target // 2:  # LinkedIn gets half the quota
                break
            for location in locations[:4]:  # 4 locations per role
                if inserted >= target // 2:
                    break
                print(f"\n  Searching: '{role}' in '{location}'")
                jobs = li.scrape_jobs(role, location, max_jobs=15)
                print(f"  Found {len(jobs)} cards")

                for job in jobs:
                    if inserted >= target // 2:
                        break
                    if job_exists(job["id"]):
                        skipped += 1
                        continue
                    desc = li.get_description(job["job_id"])
                    if asyncio.run(process_job(job, desc)):
                        inserted += 1
                        print(f"  ✅ [{inserted}] {job['title']} @ {job['company']}")
                    human_delay(1.5, 3)

                human_delay(5, 10)  # delay between searches
    except Exception as e:
        print(f"[LinkedIn] Error: {e}")
    finally:
        li.cleanup()

    # ── Naukri ────────────────────────────────────────────────────────────────
    print("\n[2/2] Starting Naukri scraper...")
    nk = NaukriJobScraper()
    try:
        nk.init()
        india_locs = LOCATIONS_INDIA.copy()
        random.shuffle(india_locs)

        for role in roles:
            if inserted >= target:
                break
            for location in india_locs[:3]:
                if inserted >= target:
                    break
                print(f"\n  Searching: '{role}' in '{location}'")
                jobs = nk.scrape_jobs(role, location, max_jobs=15)
                print(f"  Found {len(jobs)} cards")

                for job in jobs:
                    if inserted >= target:
                        break
                    if job_exists(job["id"]):
                        skipped += 1
                        continue
                    desc = nk.get_description(job["apply_url"])
                    if asyncio.run(process_job(job, desc)):
                        inserted += 1
                        print(f"  ✅ [{inserted}] {job['title']} @ {job['company']}")
                    human_delay(1.5, 3)

                human_delay(5, 10)
    except Exception as e:
        print(f"[Naukri] Error: {e}")
    finally:
        nk.cleanup()

    print(f"\n{'='*50}")
    print(f"✅ Done! Inserted: {inserted} | Skipped (duplicates): {skipped}")
    print(f"{'='*50}\n")

if __name__ == "__main__":
    run_pipeline(target=500)
