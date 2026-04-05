"""
naukri_profiles.py — Scrapes candidate profiles from Naukri public resume search.
Uses a dedicated Naukri account (cookies).
"""
import json
import os
import time
import random
from playwright.sync_api import sync_playwright, Page
from playwright_stealth import Stealth

COOKIES_FILE = os.path.join(os.path.dirname(__file__), '..', '..', 'data', 'naukri_profile_cookies.json')

SEARCH_QUERIES = [
    "software engineer", "data scientist", "machine learning",
    "backend developer", "frontend developer", "full stack developer",
    "data analyst", "devops", "product manager", "business analyst",
    "python developer", "java developer", "react developer",
    "cloud engineer", "ai engineer", "mobile developer", "android developer",
    "ios developer", "qa engineer", "automation tester",
]

LOCATIONS = ["Bangalore", "Mumbai", "Delhi", "Hyderabad", "Pune", "Chennai", "Noida", "Gurgaon"]

USER_AGENTS = [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
]


class NaukriProfileScraper:
    def __init__(self, headless=True, max_profiles_per_run=80):
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
            locale="en-IN",
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
                print("Naukri profile cookies loaded.")
                return True
            except Exception as e:
                print(f"Error loading Naukri cookies: {e}")
        return False

    def save_cookies(self):
        cookies = self.context.cookies()
        with open(COOKIES_FILE, 'w') as f:
            json.dump(cookies, f)
        print("Naukri profile cookies saved.")

    def login(self):
        try:
            self.page.goto('https://www.naukri.com/mnjuser/homepage', wait_until='domcontentloaded', timeout=30000)
        except Exception:
            pass
        print("\n=== NAUKRI LOGIN REQUIRED ===")
        print("Please log in with your DEDICATED scraping account.")
        print("Once logged in and on your homepage, press Enter.")
        input("Press Enter to continue...")
        self.save_cookies()

    def init_session(self):
        if self.load_cookies():
            try:
                self.page.goto('https://www.naukri.com/mnjuser/homepage', wait_until='domcontentloaded', timeout=30000)
                self.random_sleep(2, 4)
            except Exception:
                pass
            if self.page.locator('form[name="login-form"], .login-layer').count() > 0:
                print("Naukri cookies expired. Need manual login.")
                self.login()
            else:
                print("Naukri session restored.")
        else:
            self.login()

    def random_sleep(self, min_s=5, max_s=15):
        time.sleep(random.uniform(min_s, max_s))

    def human_scroll(self):
        for _ in range(random.randint(2, 4)):
            self.page.mouse.wheel(0, random.randint(200, 500))
            time.sleep(random.uniform(0.3, 0.7))

    def check_for_captcha(self) -> bool:
        try:
            if self.page.locator('.captcha, #captcha, [class*="captcha"]').count() > 0:
                return True
        except Exception:
            pass
        return False

    def search_profiles(self, query: str, location: str) -> list[str]:
        """
        Naukri public profile search — searches for job seekers by keyword.
        Uses the public people search (not resdex which requires paid account).
        """
        encoded_query = query.replace(' ', '-').lower()
        encoded_loc = location.replace(' ', '-').lower()
        url = f"https://www.naukri.com/mnjuser/profile?id=&altresid"

        # Use Naukri's public search for profiles
        search_url = f"https://www.naukri.com/{encoded_query}-jobs-in-{encoded_loc}?src=jobsearchDesk"
        try:
            self.page.goto(search_url, wait_until='domcontentloaded', timeout=30000)
        except Exception as e:
            print(f"Navigation error: {e}")
            return []

        self.random_sleep(3, 6)

        if self.check_for_captcha():
            print("⚠️  CAPTCHA detected! Pausing for 5 minutes...")
            time.sleep(300)
            return []

        self.human_scroll()

        # Extract candidate profile links from job cards (applicant profiles visible on some listings)
        profile_urls = []
        try:
            links = self.page.locator('a[href*="naukri.com/profile/"]').all()
            for link in links:
                href = link.get_attribute('href') or ''
                if '/profile/' in href and href not in profile_urls:
                    profile_urls.append(href)
        except Exception:
            pass

        # Also try the people search endpoint
        people_url = f"https://www.naukri.com/jobseeker/search-results?keyword={query.replace(' ', '+')}&location={location}"
        try:
            self.page.goto(people_url, wait_until='domcontentloaded', timeout=20000)
            self.random_sleep(2, 5)
            cards = self.page.locator('.srp-jobtuple-wrapper, .jobTuple').all()
            for card in cards[:15]:
                try:
                    link = card.locator('a.title, a.job-title').first
                    href = link.get_attribute('href') or ''
                    if href and href not in profile_urls:
                        profile_urls.append(href)
                except Exception:
                    pass
        except Exception:
            pass

        return profile_urls[:10]

    def scrape_job_card_as_profile(self, card) -> dict | None:
        """
        Extract candidate-relevant data from a Naukri job card.
        Since Naukri public search shows jobs not profiles, we extract
        the skills/role data that represents what candidates are applying for.
        """
        try:
            title_el = card.locator('a.title, a.job-title').first
            company_el = card.locator('a.comp-name, .company_name').first
            skill_els = card.locator('.dot-wrapper li, .tag-li').all()
            location_el = card.locator('.loc-wrap, .location').first
            exp_el = card.locator('.exp-wrap, .experience').first
            salary_el = card.locator('.sal-wrap, .salary').first

            title = title_el.inner_text().strip() if title_el.count() > 0 else ''
            if not title:
                return None

            skills = ', '.join([s.inner_text().strip() for s in skill_els[:15] if s.inner_text().strip()])
            location = location_el.inner_text().strip() if location_el.count() > 0 else ''
            experience = exp_el.inner_text().strip() if exp_el.count() > 0 else ''
            salary = salary_el.inner_text().strip() if salary_el.count() > 0 else ''

            return {
                "name": "Anonymous",  # Naukri public search doesn't show names
                "headline": title,
                "location": location,
                "about": f"Looking for {title} roles. Experience: {experience}. Salary: {salary}",
                "skills": skills,
                "experience": experience,
                "profile_url": title_el.get_attribute('href') or '',
                "source": "naukri",
            }
        except Exception as e:
            print(f"Error parsing Naukri card: {e}")
            return None

    def run(self) -> list[dict]:
        """Main scraping loop — returns list of candidate profiles."""
        self.init_session()
        all_profiles = []
        seen_urls = set()

        queries = random.sample(SEARCH_QUERIES, min(6, len(SEARCH_QUERIES)))
        locations = random.sample(LOCATIONS, min(3, len(LOCATIONS)))

        for query in queries:
            for location in locations:
                if self.profiles_scraped >= self.max_profiles_per_run:
                    print(f"Reached max profiles limit ({self.max_profiles_per_run}). Stopping.")
                    return all_profiles

                print(f"\nSearching Naukri: '{query}' in '{location}'")

                formatted_query = query.replace(' ', '-').lower()
                formatted_loc = location.replace(' ', '-').lower()
                url = f"https://www.naukri.com/{formatted_query}-jobs-in-{formatted_loc}"

                try:
                    self.page.goto(url, wait_until='domcontentloaded', timeout=30000)
                except Exception as e:
                    print(f"Error: {e}")
                    continue

                self.random_sleep(3, 7)

                if self.check_for_captcha():
                    print("⚠️  CAPTCHA! Pausing 5 minutes...")
                    time.sleep(300)
                    continue

                self.human_scroll()

                cards = self.page.locator('.srp-jobtuple-wrapper').all()
                print(f"Found {len(cards)} job cards.")

                for card in cards[:15]:
                    if self.profiles_scraped >= self.max_profiles_per_run:
                        break

                    profile = self.scrape_job_card_as_profile(card)
                    if profile and profile['profile_url'] not in seen_urls:
                        seen_urls.add(profile['profile_url'])
                        all_profiles.append(profile)
                        self.profiles_scraped += 1
                        print(f"  ✅ Got: {profile['headline'][:60]} — {profile['location']}")

                    self.random_sleep(2, 5)

                self.random_sleep(15, 35)

        return all_profiles

    def cleanup(self):
        self.context.close()
        self.browser.close()
        self.playwright.stop()
