"""
linkedin_profiles.py — Scrapes candidate profiles from LinkedIn People Search.
Uses a dedicated LinkedIn account (cookies) to avoid bans.
"""
import json
import os
import time
import random
from playwright.sync_api import sync_playwright, Page
from playwright_stealth import Stealth

COOKIES_FILE = os.path.join(os.path.dirname(__file__), '..', '..', 'data', 'linkedin_profile_cookies.json')

# Roles to search — broad coverage across experience levels
SEARCH_QUERIES = [
    "software engineer", "data scientist", "machine learning engineer",
    "backend developer", "frontend developer", "full stack developer",
    "data analyst", "devops engineer", "product manager", "business analyst",
    "python developer", "java developer", "react developer", "node.js developer",
    "cloud engineer", "ai engineer", "nlp engineer", "mobile developer",
]

LOCATIONS = ["India", "Bangalore", "Mumbai", "Delhi", "Hyderabad", "Pune", "Chennai"]

USER_AGENTS = [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
]


class LinkedInProfileScraper:
    def __init__(self, headless=True, max_profiles_per_run=50):
        self.headless = headless
        self.max_profiles_per_run = max_profiles_per_run
        self.profiles_scraped = 0
        self.playwright = sync_playwright().start()
        self.browser = self.playwright.chromium.launch(
            headless=self.headless,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
                "--disable-dev-shm-usage",
            ]
        )
        self.context = self.browser.new_context(
            user_agent=random.choice(USER_AGENTS),
            viewport={"width": random.randint(1200, 1400), "height": random.randint(700, 900)},
            locale="en-US",
            timezone_id="Asia/Kolkata",
        )
        self.page: Page = self.context.new_page()
        Stealth().apply_stealth_sync(self.page)

    def load_cookies(self) -> bool:
        if os.path.exists(COOKIES_FILE):
            try:
                with open(COOKIES_FILE, 'r') as f:
                    cookies = json.load(f)
                self.context.add_cookies(cookies)
                print("LinkedIn profile cookies loaded.")
                return True
            except Exception as e:
                print(f"Error loading cookies: {e}")
        return False

    def save_cookies(self):
        cookies = self.context.cookies()
        with open(COOKIES_FILE, 'w') as f:
            json.dump(cookies, f)
        print("LinkedIn profile cookies saved.")

    def login(self):
        try:
            self.page.goto('https://www.linkedin.com/login', wait_until='domcontentloaded', timeout=30000)
        except Exception:
            pass
        print("\n=== LINKEDIN LOGIN REQUIRED ===")
        print("Please log in with your DEDICATED scraping account in the browser window.")
        print("Once logged in and on the feed, press Enter.")
        input("Press Enter to continue...")
        self.save_cookies()

    def init_session(self):
        if self.load_cookies():
            try:
                self.page.goto('https://www.linkedin.com/feed/', wait_until='domcontentloaded', timeout=30000)
                self.random_sleep(2, 4)
            except Exception:
                pass
            if "login" in self.page.url or "checkpoint" in self.page.url:
                print("LinkedIn cookies expired. Need manual login.")
                self.login()
            else:
                print("LinkedIn session restored.")
        else:
            self.login()

    def random_sleep(self, min_s=5, max_s=15):
        delay = random.uniform(min_s, max_s)
        time.sleep(delay)

    def human_scroll(self):
        """Simulate human-like scrolling."""
        for _ in range(random.randint(2, 5)):
            self.page.mouse.wheel(0, random.randint(200, 600))
            time.sleep(random.uniform(0.3, 0.8))

    def check_for_captcha(self) -> bool:
        captcha_indicators = [
            'text="Let\'s do a quick security check"',
            'text="Please complete the security check"',
            '.captcha-challenge',
            '#captcha-challenge',
        ]
        for indicator in captcha_indicators:
            try:
                if self.page.locator(indicator).count() > 0:
                    return True
            except Exception:
                pass
        return False

    def search_profiles(self, query: str, location: str) -> list[dict]:
        """Search LinkedIn people and return list of profile URLs."""
        encoded_query = query.replace(' ', '%20')
        encoded_loc = location.replace(' ', '%20')
        url = (
            f"https://www.linkedin.com/search/results/people/"
            f"?keywords={encoded_query}&origin=GLOBAL_SEARCH_HEADER"
            f"&location={encoded_loc}"
        )
        try:
            self.page.goto(url, wait_until='domcontentloaded', timeout=30000)
        except Exception as e:
            print(f"Navigation error: {e}")
            return []

        self.random_sleep(4, 8)

        if self.check_for_captcha():
            print("⚠️  CAPTCHA detected! Pausing for 5 minutes...")
            time.sleep(300)
            return []

        self.human_scroll()

        # Debug: print current URL to confirm we're on the right page
        print(f"  Current URL: {self.page.url[:80]}")

        profile_urls = []
        try:
            # Try multiple selector patterns LinkedIn uses
            selectors = [
                'a[href*="linkedin.com/in/"]',
                'a[href*="/in/"]',
                '.entity-result__title-text a',
                '.app-aware-link[href*="/in/"]',
            ]
            seen = set()
            for selector in selectors:
                cards = self.page.locator(selector).all()
                for card in cards:
                    href = card.get_attribute('href') or ''
                    if '/in/' not in href:
                        continue
                    # Clean the URL — remove query params
                    clean = href.split('?')[0].rstrip('/')
                    # Filter out non-profile links like /in/feed, /in/messaging
                    parts = clean.split('/in/')
                    if len(parts) < 2 or len(parts[1]) < 3:
                        continue
                    if clean not in seen:
                        seen.add(clean)
                        profile_urls.append(clean)

            print(f"  Found {len(profile_urls)} profile URLs via selectors.")
        except Exception as e:
            print(f"Error extracting profile URLs: {e}")

        return profile_urls[:10]  # Max 10 per search to stay safe

    def scrape_profile(self, profile_url: str) -> dict | None:
        """Scrape a single LinkedIn profile page."""
        try:
            self.page.goto(profile_url, wait_until='domcontentloaded', timeout=30000)
        except Exception as e:
            print(f"Error loading profile {profile_url}: {e}")
            return None

        self.random_sleep(4, 10)

        if self.check_for_captcha():
            print("⚠️  CAPTCHA detected on profile page! Pausing...")
            time.sleep(300)
            return None

        self.human_scroll()

        try:
            def get_text(selectors):
                for s in selectors:
                    try:
                        el = self.page.locator(s).first
                        if el.count() > 0:
                            t = el.inner_text().strip()
                            if t:
                                return t
                    except Exception:
                        pass
                return ''

            name = get_text([
                'h1.text-heading-xlarge',
                'h1[class*="inline"]',
                '.pv-text-details__left-panel h1',
            ])

            headline = get_text([
                '.text-body-medium.break-words',
                '.pv-text-details__left-panel .text-body-medium',
            ])

            location = get_text([
                '.text-body-small.inline.t-black--light.break-words',
                '.pv-text-details__left-panel span.text-body-small',
            ])

            about = get_text([
                '#about ~ .pvs-list__outer-container .visually-hidden',
                'section[data-section="summary"] .pv-shared-text-with-see-more span',
                '.pv-about-section .pv-about__summary-text',
            ])

            # Skills
            skills = []
            try:
                skill_els = self.page.locator('[aria-label*="skill"], .pvs-list__item--line-separated .t-bold span').all()
                for el in skill_els[:20]:
                    t = el.inner_text().strip()
                    if t and len(t) < 50:
                        skills.append(t)
            except Exception:
                pass

            # Experience — grab first 3 roles
            experience_text = ''
            try:
                exp_section = self.page.locator('#experience ~ .pvs-list__outer-container .pvs-list__item--line-separated').all()
                exp_parts = []
                for item in exp_section[:3]:
                    t = item.inner_text().strip()
                    if t:
                        exp_parts.append(t[:200])
                experience_text = ' | '.join(exp_parts)
            except Exception:
                pass

            if not name:
                return None

            return {
                "name": name,
                "headline": headline,
                "location": location,
                "about": about[:500] if about else '',
                "skills": ', '.join(skills[:15]),
                "experience": experience_text[:500],
                "profile_url": profile_url,
                "source": "linkedin",
            }

        except Exception as e:
            print(f"Error parsing profile {profile_url}: {e}")
            return None

    def run(self) -> list[dict]:
        """Main scraping loop — returns list of candidate profiles."""
        self.init_session()
        all_profiles = []
        seen_urls = set()

        queries = random.sample(SEARCH_QUERIES, min(5, len(SEARCH_QUERIES)))
        locations = random.sample(LOCATIONS, min(3, len(LOCATIONS)))

        for query in queries:
            for location in locations:
                if self.profiles_scraped >= self.max_profiles_per_run:
                    print(f"Reached max profiles limit ({self.max_profiles_per_run}). Stopping.")
                    return all_profiles

                print(f"\nSearching LinkedIn: '{query}' in '{location}'")
                profile_urls = self.search_profiles(query, location)
                print(f"Found {len(profile_urls)} profile URLs.")

                for url in profile_urls:
                    if url in seen_urls:
                        continue
                    if self.profiles_scraped >= self.max_profiles_per_run:
                        break

                    seen_urls.add(url)
                    print(f"  Scraping: {url}")
                    profile = self.scrape_profile(url)

                    if profile:
                        all_profiles.append(profile)
                        self.profiles_scraped += 1
                        print(f"  ✅ Got: {profile['name']} — {profile['headline'][:60]}")
                    else:
                        print(f"  ⚠️  Skipped (no data)")

                    # Human-like delay between profiles
                    self.random_sleep(10, 30)

                # Longer pause between searches
                self.random_sleep(20, 45)

        return all_profiles

    def cleanup(self):
        self.context.close()
        self.browser.close()
        self.playwright.stop()
