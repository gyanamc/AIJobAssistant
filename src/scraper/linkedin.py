import json
import os
import time
import random
from playwright.sync_api import sync_playwright, BrowserContext, Page
from playwright_stealth import Stealth

COOKIES_FILE = os.path.join(os.path.dirname(__file__), '..', '..', 'data', 'linkedin_cookies.json')

class LinkedInScraper:
    def __init__(self, headless=False):
        self.headless = headless
        self.playwright = sync_playwright().start()
        # Use Chrome to seem more legitimate
        self.browser = self.playwright.chromium.launch(headless=self.headless, args=["--disable-blink-features=AutomationControlled"])
        self.context = self.browser.new_context(
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            viewport={"width": 1280, "height": 800}
        )
        self.page: Page = self.context.new_page()
        Stealth().apply_stealth_sync(self.page)

    def load_cookies(self) -> bool:
        if os.path.exists(COOKIES_FILE):
            try:
                with open(COOKIES_FILE, 'r') as f:
                    cookies = json.load(f)
                self.context.add_cookies(cookies)
                return True
            except Exception as e:
                print(f"Error loading cookies: {e}")
        return False

    def save_cookies(self):
        cookies = self.context.cookies()
        with open(COOKIES_FILE, 'w') as f:
            json.dump(cookies, f)

    def login(self):
        try:
            self.page.goto('https://www.linkedin.com/login', wait_until='domcontentloaded', timeout=30000)
        except Exception:
            pass  # Page may still be usable even if load event doesn't fire
        print("Please log in manually in the opened browser window.")
        print("Once you have successfully logged in and are on the feed page, press Enter in the terminal.")
        input("Press Enter to continue...")
        self.save_cookies()
        print("Cookies saved! Next time you won't need to log in.")


    def init_session(self):
        if self.load_cookies():
            try:
                # Use domcontentloaded instead of default 'load' to avoid ERR_ABORTED on heavy pages
                self.page.goto('https://www.linkedin.com/feed/', wait_until='domcontentloaded', timeout=30000)
                self.random_sleep(2, 3)
            except Exception as e:
                print(f"Warning: Navigation to feed had an issue ({e}). Checking login state...")
            # Check if still logged in
            if "login" in self.page.url or "checkpoint" in self.page.url:
                print("Cookies expired or invalid. Need manual login.")
                self.login()
            else:
                print("Session restored from cookies successfully.")
        else:
            self.login()

    def random_sleep(self, min_seconds=2.0, max_seconds=5.0):
        time.sleep(random.uniform(min_seconds, max_seconds))

    def search_jobs(self, query: str, location: str, max_jobs=40):
        # We search with specifically the Easy Apply filter (f_AL=true)
        url = f"https://www.linkedin.com/jobs/search/?keywords={query}&location={location}&f_AL=true"
        self.page.goto(url)
        self.random_sleep(3, 6) # Wait for results to load
        
        jobs = []
        
        # Scroll the left-hand job list container to load more jobs
        list_panel = self.page.locator('.jobs-search-results-list')
        if list_panel.count() > 0:
            for _ in range(3): # Scroll a few times to load more
                list_panel.evaluate("node => node.scrollTop = node.scrollHeight")
                self.random_sleep(1, 2)
                
        # Use a more generic selector for the cards
        job_cards = self.page.locator('.job-card-container')
        
        count = min(job_cards.count(), max_jobs)
        for i in range(count):
            card = job_cards.nth(i)
            # Scroll to it
            card.scroll_into_view_if_needed()
            
            try:
                job_id = card.get_attribute('data-job-id')
                if not job_id:
                    # Sometimes the ID is on the parent elements
                    parent = card.locator('xpath=..')
                    if parent.count() > 0:
                        job_id = parent.get_attribute('data-job-id')
                        
                if not job_id:
                    continue
                    
                title_elem = card.locator('.job-card-list__title, .artdeco-entity-lockup__title')
                company_elem = card.locator('.job-card-container__company-name, .artdeco-entity-lockup__subtitle')
                
                title = title_elem.first.inner_text().strip() if title_elem.count() > 0 else "Unknown"
                company = company_elem.first.inner_text().strip() if company_elem.count() > 0 else "Unknown"
                
                jobs.append({
                    "id": job_id,
                    "title": title,
                    "company": company,
                    "url": f"https://www.linkedin.com/jobs/view/{job_id}/"
                })
            except Exception as e:
                print(f"Error extracting job card: {e}")
                continue

        return jobs
    
    def get_job_description(self, job_url: str) -> str:
        self.page.goto(job_url)
        self.random_sleep(2, 4)
        try:
            # Wait for either the explicit 'About the job' header or the fallback description container
            try:
                self.page.wait_for_selector('h2:has-text("About the job"), h2:has-text("About the role"), .jobs-description__content', timeout=5000)
            except Exception as e:
                print(f"    [Warning] Initial wait for description container timed out.")

            # Click "See more" if it exists
            see_more = self.page.locator('button[aria-label*="Click to see more"], button.jobs-description__footer-button, button.show-more-less-html__button')
            if see_more.count() > 0 and see_more.first.is_visible():
                see_more.first.click()
                self.random_sleep(1, 2)
            
            # STRATEGY 1: Semantic Header (Best for logged-in randomized CSS)
            for header_text in ["About the job", "About the role"]:
                header_loc = self.page.locator(f'h2:has-text("{header_text}")')
                if header_loc.count() > 0:
                    # In LinkedIn's layout, the description text is inside a sibling of the div containing the h2
                    # Getting the grandparent container reliably grabs the whole section
                    desc = header_loc.first.locator('xpath=../..').inner_text()
                    if len(desc.strip()) > 50: # Ensure it actually found meat
                        return desc.strip()
                        
            # STRATEGY 2: Fallback CSS selectors
            selectors = [
                '.jobs-description__content',
                '.description__text',
                '#job-details',
                '.artdeco-card .jobs-box__html-content'
            ]
            
            for selector in selectors:
                desc_locator = self.page.locator(selector)
                if desc_locator.count() > 0:
                    text_content = desc_locator.first.inner_text().strip()
                    if text_content:
                        return text_content
            
            print(f"    [Error] Could not find any description text matching our semantic headers or selectors.")
            
        except Exception as e:
            print(f"    [Error] Exception in get_job_description: {e}")
        return ""
    
    def cleanup(self):
        self.context.close()
        self.browser.close()
        self.playwright.stop()
