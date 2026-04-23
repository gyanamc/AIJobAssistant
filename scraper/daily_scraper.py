"""
Daily Job Scraper — LinkedIn + Naukri
Scrapes jobs posted in last 24h (falls back to 7 days)
Inserts each job immediately after scraping — safe to Ctrl+C anytime.

Run: python3 scraper/daily_scraper.py
     python3 scraper/daily_scraper.py --days 7
     python3 scraper/daily_scraper.py --dry-run
"""

import os
import sys
import json
import time
import random
import hashlib
import argparse
import re
import urllib.request
from datetime import datetime, timezone
from dataclasses import dataclass, asdict

from sqlalchemy import create_engine, text
from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
load_dotenv()

DATABASE_URL   = os.getenv("DATABASE_URL", "")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")

if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

if not DATABASE_URL:
    print("ERROR: DATABASE_URL not set in .env")
    sys.exit(1)

engine = create_engine(DATABASE_URL)

# ── Counters (global so Ctrl+C shows progress) ────────────────────────────────
stats = {"scraped": 0, "inserted": 0, "skipped": 0, "invalid": 0}

# ── Data model ────────────────────────────────────────────────────────────────
@dataclass
class JobRecord:
    id: str
    title: str
    company: str
    location: str
    source: str
    description: str
    apply_url: str
    posted_date: str

# ── Helpers ───────────────────────────────────────────────────────────────────
def stable_id(source: str, url: str, title: str) -> str:
    return hashlib.sha256(f"{source}:{url}:{title}".encode()).hexdigest()[:32]

def human_delay(min_s=1.5, max_s=4.0):
    time.sleep(random.uniform(min_s, max_s))

def random_scroll(page, times=3):
    for _ in range(times):
        page.evaluate(f"window.scrollBy(0, {random.randint(300, 700)})")
        time.sleep(random.uniform(0.4, 1.0))

def clean_text(text: str) -> str:
    text = re.sub(r'\s+', ' ', text).strip()
    text = re.sub(r'[^\x20-\x7E\n]', '', text)
    return text

def is_valid_job(job: JobRecord) -> bool:
    if not job.title or len(job.title) < 3:
        return False
    if not job.company or job.company in ("Unknown", ""):
        return False
    if not job.apply_url or not job.apply_url.startswith("http"):
        return False
    spam = ["test", "dummy", "sample", "xxx", "asdf"]
    if any(kw in job.title.lower() for kw in spam):
        return False
    # Accept jobs even with short/missing descriptions
    return True

# ── DB ────────────────────────────────────────────────────────────────────────
def get_existing_ids() -> set:
    with engine.connect() as conn:
        rows = conn.execute(text("SELECT id FROM job_listings")).fetchall()
    return {row.id for row in rows}

def insert_one(job: JobRecord, embedding: list | None) -> bool:
    """Insert a single job immediately. Returns True if newly inserted."""
    try:
        with engine.connect() as conn:
            if embedding:
                emb_str = "[" + ",".join(str(x) for x in embedding) + "]"
                result = conn.execute(text("""
                    INSERT INTO job_listings
                        (id, title, company, location, source, description, apply_url, embedding, scraped_at, updated_at)
                    VALUES (:id, :title, :company, :location, :source, :description, :apply_url,
                            :emb::vector, NOW(), NOW())
                    ON CONFLICT (id) DO NOTHING
                """), {**asdict(job), "emb": emb_str})
            else:
                result = conn.execute(text("""
                    INSERT INTO job_listings
                        (id, title, company, location, source, description, apply_url, scraped_at, updated_at)
                    VALUES (:id, :title, :company, :location, :source, :description, :apply_url, NOW(), NOW())
                    ON CONFLICT (id) DO NOTHING
                """), asdict(job))
            conn.commit()
            return result.rowcount > 0
    except Exception as e:
        print(f"  Insert error {job.id}: {e}")
        return False

# ── Embedding ─────────────────────────────────────────────────────────────────
def get_embedding(text_input: str) -> list | None:
    if not OPENAI_API_KEY:
        return None
    try:
        data = json.dumps({
            "model": "text-embedding-3-small",
            "input": text_input[:8000]
        }).encode()
        req = urllib.request.Request(
            "https://api.openai.com/v1/embeddings",
            data=data,
            headers={
                "Authorization": f"Bearer {OPENAI_API_KEY}",
                "Content-Type": "application/json"
            }
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read())
            return result["data"][0]["embedding"]
    except Exception as e:
        print(f"  Embedding error: {e}")
        return None

# ── Process one job: validate → embed → insert ────────────────────────────────
def process_and_insert(job: JobRecord, dry_run: bool) -> bool:
    """Validate, embed, and insert a single job. Returns True if inserted."""
    stats["scraped"] += 1

    # Build fallback description if missing
    if not job.description or len(job.description) < 50:
        job.description = f"{job.title} position at {job.company}. Location: {job.location}."

    if not is_valid_job(job):
        stats["invalid"] += 1
        return False

    if dry_run:
        print(f"  [DRY RUN] {job.title} @ {job.company} ({job.source})")
        stats["inserted"] += 1
        return True

    embedding = get_embedding(f"{job.title} {job.company} {job.description[:500]}")
    inserted = insert_one(job, embedding)
    if inserted:
        stats["inserted"] += 1
        print(f"  ✅ [{stats['inserted']}] {job.title} @ {job.company} ({job.source})")
    else:
        stats["skipped"] += 1
    return inserted

# ── Cookie paths ──────────────────────────────────────────────────────────────
LINKEDIN_COOKIES = os.path.join(os.path.dirname(__file__), '..', 'data', 'scraper_linkedin_cookies.json')
NAUKRI_COOKIES   = os.path.join(os.path.dirname(__file__), '..', 'data', 'scraper_naukri_cookies.json')

SEARCH_TERMS = [
    "software engineer", "data analyst", "product manager",
    "marketing manager", "sales executive", "business analyst",
    "hr executive", "operations manager", "finance analyst",
    "frontend developer", "backend developer", "full stack developer",
    "machine learning engineer", "devops engineer", "qa engineer",
    "content writer", "graphic designer", "digital marketing",
    "manager", "analyst", "engineer", "developer", "designer",
]

# ── LinkedIn ──────────────────────────────────────────────────────────────────
def scrape_linkedin(days: int, existing_ids: set, dry_run: bool):
    from playwright.sync_api import sync_playwright
    try:
        from playwright_stealth import Stealth
        stealth = Stealth()
    except ImportError:
        stealth = None

    time_filter = "r86400" if days <= 1 else "r604800"
    locations = ["India", "United States", "Remote"]
    seen = set(existing_ids)

    with sync_playwright() as pw:
        browser = pw.chromium.launch(
            headless=False,
            args=["--disable-blink-features=AutomationControlled", "--no-sandbox"]
        )
        ctx = browser.new_context(
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            viewport={"width": 1366, "height": 768},
            locale="en-US",
        )
        page = ctx.new_page()
        if stealth:
            stealth.apply_stealth_sync(page)

        # Login
        if os.path.exists(LINKEDIN_COOKIES):
            with open(LINKEDIN_COOKIES) as f:
                ctx.add_cookies(json.load(f))
            try:
                page.goto('https://www.linkedin.com/feed/', wait_until='domcontentloaded', timeout=30000)
                human_delay(2, 3)
            except Exception:
                pass
            if "login" in page.url or "checkpoint" in page.url:
                page.goto('https://www.linkedin.com/login', wait_until='domcontentloaded')
                print("\n[LinkedIn] Session expired. Please log in.")
                input("Press Enter after logging in...")
                os.makedirs(os.path.dirname(LINKEDIN_COOKIES), exist_ok=True)
                with open(LINKEDIN_COOKIES, 'w') as f:
                    json.dump(ctx.cookies(), f)
            else:
                print("[LinkedIn] Session restored.")
        else:
            page.goto('https://www.linkedin.com/login', wait_until='domcontentloaded')
            print("\n[LinkedIn] Please log in with your scraper account.")
            input("Press Enter after logging in...")
            os.makedirs(os.path.dirname(LINKEDIN_COOKIES), exist_ok=True)
            with open(LINKEDIN_COOKIES, 'w') as f:
                json.dump(ctx.cookies(), f)
            print("[LinkedIn] Cookies saved.")

        for term in SEARCH_TERMS:
            for location in locations:
                url = (
                    f"https://www.linkedin.com/jobs/search/"
                    f"?keywords={term.replace(' ', '%20')}"
                    f"&location={location.replace(' ', '%20')}"
                    f"&f_TPR={time_filter}&sortBy=DD"
                )
                try:
                    page.goto(url, wait_until='domcontentloaded', timeout=30000)
                except Exception:
                    pass
                human_delay(3, 5)
                random_scroll(page)

                cards = page.locator('.job-card-container, .jobs-search-results__list-item')
                count = min(cards.count(), 20)

                for i in range(count):
                    try:
                        card = cards.nth(i)
                        card.scroll_into_view_if_needed()
                        human_delay(0.2, 0.5)

                        job_id_raw = card.get_attribute('data-job-id')
                        if not job_id_raw:
                            continue

                        apply_url = f"https://www.linkedin.com/jobs/view/{job_id_raw}/"
                        sid = stable_id("linkedin", apply_url, job_id_raw)
                        if sid in seen:
                            continue
                        seen.add(sid)

                        title_el   = card.locator('.job-card-list__title, .artdeco-entity-lockup__title')
                        company_el = card.locator('.job-card-container__company-name, .artdeco-entity-lockup__subtitle')
                        loc_el     = card.locator('.job-card-container__metadata-item')

                        title   = title_el.first.inner_text().strip() if title_el.count() > 0 else ""
                        company = company_el.first.inner_text().strip() if company_el.count() > 0 else "Unknown"
                        loc     = loc_el.first.inner_text().strip() if loc_el.count() > 0 else location

                        if not title:
                            continue

                        # Click card to load description in right panel (no page navigation)
                        desc = ""
                        try:
                            card.click()
                            human_delay(2, 3)
                            # Try right panel selectors first
                            for sel in [
                                '.jobs-search__job-details .jobs-description__content',
                                '.jobs-description__content',
                                '.jobs-box__html-content',
                                '#job-details',
                                '.description__text',
                                '[class*="job-details"]',
                            ]:
                                el = page.locator(sel)
                                if el.count() > 0:
                                    t = el.first.inner_text().strip()
                                    if len(t) > 100:
                                        desc = clean_text(t)
                                        break
                            # If still empty, try expanding "See more"
                            if not desc:
                                try:
                                    see_more = page.locator('button[aria-label*="more"], button.jobs-description__footer-button')
                                    if see_more.count() > 0 and see_more.first.is_visible():
                                        see_more.first.click()
                                        human_delay(0.5, 1)
                                        for sel in ['.jobs-description__content', '#job-details']:
                                            el = page.locator(sel)
                                            if el.count() > 0:
                                                t = el.first.inner_text().strip()
                                                if len(t) > 100:
                                                    desc = clean_text(t)
                                                    break
                                except Exception:
                                    pass
                        except Exception:
                            pass

                        job = JobRecord(
                            id=sid,
                            title=clean_text(title),
                            company=clean_text(company),
                            location=clean_text(loc),
                            source="linkedin",
                            description=desc,
                            apply_url=apply_url,
                            posted_date=datetime.now(timezone.utc).date().isoformat(),
                        )
                        # ← Insert immediately
                        process_and_insert(job, dry_run)
                        human_delay(1, 2)
                    except Exception:
                        continue

                print(f"  [LinkedIn] '{term}' / {location} done | total inserted: {stats['inserted']}")
                human_delay(3, 6)

        ctx.close()
        browser.close()


# ── Naukri ────────────────────────────────────────────────────────────────────
def scrape_naukri(days: int, existing_ids: set, dry_run: bool):
    from playwright.sync_api import sync_playwright
    try:
        from playwright_stealth import Stealth
        stealth = Stealth()
    except ImportError:
        stealth = None

    freshness = 1 if days <= 1 else 7
    locations = ["India", "Bangalore", "Mumbai", "Delhi", "Hyderabad", "Pune"]
    seen = set(existing_ids)

    with sync_playwright() as pw:
        browser = pw.chromium.launch(
            headless=False,
            args=["--disable-blink-features=AutomationControlled"]
        )
        ctx = browser.new_context(
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            viewport={"width": 1366, "height": 768},
            locale="en-IN",
        )
        page = ctx.new_page()
        if stealth:
            stealth.apply_stealth_sync(page)

        # Login
        if os.path.exists(NAUKRI_COOKIES):
            with open(NAUKRI_COOKIES) as f:
                ctx.add_cookies(json.load(f))
            try:
                page.goto('https://www.naukri.com/', wait_until='domcontentloaded', timeout=30000)
                human_delay(2, 3)
            except Exception:
                pass
            if page.locator('a[title="Jobseeker Login"]').count() > 0:
                page.goto('https://www.naukri.com/mnjuser/homepage', wait_until='domcontentloaded')
                print("\n[Naukri] Session expired. Please log in.")
                input("Press Enter after logging in...")
                os.makedirs(os.path.dirname(NAUKRI_COOKIES), exist_ok=True)
                with open(NAUKRI_COOKIES, 'w') as f:
                    json.dump(ctx.cookies(), f)
            else:
                print("[Naukri] Session restored.")
        else:
            page.goto('https://www.naukri.com/mnjuser/homepage', wait_until='domcontentloaded')
            print("\n[Naukri] Please log in with your scraper account.")
            input("Press Enter after logging in...")
            os.makedirs(os.path.dirname(NAUKRI_COOKIES), exist_ok=True)
            with open(NAUKRI_COOKIES, 'w') as f:
                json.dump(ctx.cookies(), f)
            print("[Naukri] Cookies saved.")

        for term in SEARCH_TERMS:
            for location in locations[:3]:
                query = term.replace(' ', '-').lower()
                loc   = location.replace(' ', '-').lower()
                url   = f"https://www.naukri.com/{query}-jobs-in-{loc}?freshness={freshness}"

                try:
                    page.goto(url, wait_until='domcontentloaded', timeout=30000)
                except Exception:
                    pass
                human_delay(3, 5)
                random_scroll(page)

                cards = page.locator('.srp-jobtuple-wrapper, article.jobTuple')
                count = min(cards.count(), 20)

                for i in range(count):
                    try:
                        card = cards.nth(i)
                        card.scroll_into_view_if_needed()
                        human_delay(0.2, 0.5)

                        title_el = card.locator('a.title, a.job-title')
                        if title_el.count() == 0:
                            continue

                        title     = title_el.first.inner_text().strip()
                        apply_url = title_el.first.get_attribute('href') or ""
                        if apply_url.startswith('/'):
                            apply_url = "https://www.naukri.com" + apply_url
                        if not apply_url.startswith('http'):
                            continue

                        sid = stable_id("naukri", apply_url, title)
                        if sid in seen:
                            continue
                        seen.add(sid)

                        company_el = card.locator('a.comp-name, .company_name')
                        loc_el     = card.locator('.locWdth, .location')
                        company    = company_el.first.inner_text().strip() if company_el.count() > 0 else "Unknown"
                        loc_text   = loc_el.first.inner_text().strip() if loc_el.count() > 0 else location

                        # Fetch description — navigate to job page
                        desc = ""
                        try:
                            page.goto(apply_url, wait_until='domcontentloaded', timeout=25000)
                            human_delay(2, 3)
                            # Try multiple selectors — Naukri changes these frequently
                            for sel in [
                                '.styles_JDC__dang-inner-html__h0K4t',
                                '.job-desc',
                                '.dang-inner-html',
                                '#jobDescription',
                                '.jobDescription',
                                '[class*="job-desc"]',
                                '[class*="JDC"]',
                                'section.styles_job-desc-container',
                            ]:
                                el = page.locator(sel)
                                if el.count() > 0:
                                    t = el.first.inner_text().strip()
                                    if len(t) > 50:
                                        desc = clean_text(t)
                                        break
                            # Fallback: grab any large text block on the page
                            if not desc:
                                all_text = page.locator('body').inner_text()
                                # Extract middle section which usually has the description
                                lines = [l.strip() for l in all_text.split('\n') if len(l.strip()) > 30]
                                if lines:
                                    desc = clean_text(' '.join(lines[5:25]))
                        except Exception:
                            pass

                        job = JobRecord(
                            id=sid,
                            title=clean_text(title),
                            company=clean_text(company),
                            location=clean_text(loc_text),
                            source="naukri",
                            description=desc,
                            apply_url=apply_url,
                            posted_date=datetime.now(timezone.utc).date().isoformat(),
                        )
                        # ← Insert immediately
                        process_and_insert(job, dry_run)
                        human_delay(1, 2)
                    except Exception:
                        continue

                print(f"  [Naukri] '{term}' / {location} done | total inserted: {stats['inserted']}")
                human_delay(3, 6)

        ctx.close()
        browser.close()


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=1)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    print(f"\n{'='*60}")
    print(f"Daily Job Scraper — {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    print(f"Mode: last {args.days} day(s) | Dry run: {args.dry_run}")
    print(f"Jobs are inserted immediately — safe to Ctrl+C anytime")
    print(f"{'='*60}\n")

    print("Loading existing job IDs from DB...")
    existing_ids = get_existing_ids()
    print(f"  {len(existing_ids)} jobs already in DB\n")

    try:
        print("[1/2] Scraping LinkedIn...")
        scrape_linkedin(args.days, existing_ids, args.dry_run)
    except KeyboardInterrupt:
        print("\n⚠️  Interrupted by user.")
    except Exception as e:
        print(f"[LinkedIn] Error: {e}")

    try:
        print("\n[2/2] Scraping Naukri...")
        scrape_naukri(args.days, existing_ids, args.dry_run)
    except KeyboardInterrupt:
        print("\n⚠️  Interrupted by user.")
    except Exception as e:
        print(f"[Naukri] Error: {e}")

    print(f"\n{'='*60}")
    print(f"✅ Done!")
    print(f"   Scraped:  {stats['scraped']}")
    print(f"   Inserted: {stats['inserted']}")
    print(f"   Skipped:  {stats['skipped']} (duplicates)")
    print(f"   Invalid:  {stats['invalid']} (bad data)")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    main()
