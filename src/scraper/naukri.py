import json
import os
import time
import random
import re
import urllib.parse
from playwright.sync_api import sync_playwright, BrowserContext, Page
from playwright_stealth import Stealth

COOKIES_FILE = os.path.join(os.path.dirname(__file__), '..', '..', 'data', 'naukri_cookies.json')

class NaukriScraper:
    def __init__(self, headless=False):
        self.headless = headless
        self.playwright = sync_playwright().start()
        # Use Chrome to seem more legitimate
        self.browser = self.playwright.chromium.launch(
            headless=self.headless, 
            args=["--disable-blink-features=AutomationControlled"]
        )
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
                print(f"Error loading Naukri cookies: {e}")
        return False

    def save_cookies(self):
        cookies = self.context.cookies()
        with open(COOKIES_FILE, 'w') as f:
            json.dump(cookies, f)

    def login(self):
        try:
            self.page.goto('https://www.naukri.com/mnjuser/homepage', wait_until='domcontentloaded', timeout=30000)
        except Exception:
            pass
            
        print("\n=== NAUKRI LOGIN REQUIRED ===")
        print("Please log in manually in the opened browser window.")
        print("Once you have successfully logged in and see your homepage, press Enter in the terminal.")
        input("Press Enter to continue...")
        self.save_cookies()
        print("Naukri cookies saved! Next time you won't need to log in manually.")

    def init_session(self):
        print("Initializing Naukri Session...")
        if self.load_cookies():
            try:
                self.page.goto('https://www.naukri.com/mnjuser/homepage', wait_until='domcontentloaded', timeout=30000)
                self.random_sleep(2, 3)
            except Exception as e:
                print(f"Warning: Navigation issue on Naukri ({e}).")
            
            # Check for login form or typical logged-out elements
            if self.page.locator('form[name="login-form"], .login-layer, a[title="Jobseeker Login"]').count() > 0:
                print("Naukri cookies expired or invalid. Need manual login.")
                self.login()
            else:
                print("Naukri session restored from cookies successfully.")
        else:
            self.login()

    def random_sleep(self, min_seconds=2.0, max_seconds=5.0):
        time.sleep(random.uniform(min_seconds, max_seconds))

    def search_jobs(self, query: str, location: str, max_jobs=40):
        # Format query for URL: e.g., "software engineer" -> "software-engineer"
        formatted_query = query.lower().replace(' ', '-')
        formatted_loc = location.lower().replace(' ', '-')
        
        # Example URL: https://www.naukri.com/software-engineer-jobs-in-bangalore
        url = f"https://www.naukri.com/{formatted_query}-jobs-in-{formatted_loc}"
        
        print(f"Searching Naukri with URL: {url}")
        try:
            self.page.goto(url, wait_until='domcontentloaded')
        except Exception as e:
            print(f"Error navigating to search page: {e}")
        
        self.random_sleep(3, 6)
        
        # Scroll down to load jobs
        for _ in range(3):
            self.page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            self.random_sleep(1, 2)
            
        jobs = []
        
        # Naukri uses 'srp-jobtuple-wrapper' or 'jobTuple' or 'list div' class
        job_cards = self.page.locator('.srp-jobtuple-wrapper, article.jobTuple, .jobTuple')
        
        count = min(job_cards.count(), max_jobs)
        for i in range(count):
            card = job_cards.nth(i)
            card.scroll_into_view_if_needed()
            
            try:
                # Find the title anchor tag
                title_elem = card.locator('a.title, a.job-title, a[title]')
                if title_elem.count() == 0:
                    continue
                    
                title_loc = title_elem.first
                title = title_loc.inner_text().strip()
                job_url = title_loc.get_attribute('href')
                
                if not job_url:
                    continue
                    
                # Fix relative URLs
                if job_url.startswith('/'):
                    job_url = "https://www.naukri.com" + job_url
                    
                company_elem = card.locator('a.comp-name, a.subTitle, .company_name')
                company = company_elem.first.inner_text().strip() if company_elem.count() > 0 else "Unknown"
                
                # Extract job ID from URL (usually ends with sequence of digits for Naukri)
                # E.g., ...150325000123
                match = re.search(r'-(\d{7,})(\?|$)', job_url)
                if match:
                    raw_id = match.group(1)
                else:
                    # Fallback construct an ID
                    # Some don't have digits, use the last part of path
                    parts = urllib.parse.urlparse(job_url).path.split('-')
                    if parts and parts[-1].isdigit():
                        raw_id = parts[-1]
                    else:
                        # Very crude fallback
                        raw_id = str(abs(hash(job_url)))
                        
                # Ensure we add a suffix/prefix so Naukri IDs don't collide with LinkedIn
                job_id = f"naukri_{raw_id}"
                
                jobs.append({
                    "id": job_id,
                    "title": title,
                    "company": company,
                    "url": job_url
                })
            except Exception as e:
                print(f"Error extracting Naukri job card: {e}")
                continue

        return jobs
    
    def get_job_description(self, job_url: str) -> str:
        try:
            self.page.goto(job_url, wait_until='domcontentloaded')
        except Exception as e:
            print(f"Error navigating to Naukri job description: {e}")
            return ""
            
        self.random_sleep(2, 4)
        
        try:
            # Common selectors for job description on Naukri
            selectors = [
                '.job-desc',
                '.dang-inner-html',
                'section.job-desc',
                'div.job-description',
                '#jobDescription'
            ]
            
            for selector in selectors:
                desc_locator = self.page.locator(selector)
                if desc_locator.count() > 0:
                    text_content = desc_locator.first.inner_text().strip()
                    if len(text_content) > 20:
                        return text_content
            
            # Fallback if specific div is not found - try to capture body text
            print("    [Warning] Could not find specific description selectors on Naukri, trying fallback.")
            return self.page.locator('body').inner_text()[:4000] # Cap fallback text to avoid noise
            
        except Exception as e:
            print(f"    [Error] Exception parsing Naukri get_job_description: {e}")
        return ""
    
    def apply_to_job(self, job_url: str) -> bool:
        try:
            print(f"    [Action] Navigating to {job_url} to apply...")
            self.page.goto(job_url, wait_until='domcontentloaded')
            self.random_sleep(2, 4)
            
            # Identify the apply button
            # Usually on Naukri it's a button with id 'apply-button' or text 'Apply'
            apply_btn = self.page.locator('button#apply-button, button:has-text("Apply"), .apply-button').first
            
            if apply_btn.count() > 0:
                btn_text = apply_btn.inner_text().lower()
                
                if "company site" in btn_text or "external" in btn_text:
                    print("    [Info] Job requires applying on company site. Skipping auto-apply.")
                    return False
                    
                print("    [Action] Found Apply button. Clicking...")
                apply_btn.click()
                self.random_sleep(3, 6)
                
                # Check for success message or indicator
                # E.g., 'Successfully Applied', 'Applied successfully', or specific dialogs
                success_indicators = [
                    '.success-msg',
                    'text="Successfully Applied"',
                    'text="Applied successfully"',
                    'text="Applied Successfully"',
                    '.apply-message:has-text("Successfully")'
                ]
                
                for indicator in success_indicators:
                    if self.page.locator(indicator).count() > 0 and self.page.locator(indicator).first.is_visible():
                        print("    [Success] Confirmed application submitted via success message.")
                        return True
                        
                # Sometimes the button text just changes to "Applied"
                new_btn_text = self.page.locator('button#apply-button, .apply-button').first.inner_text().lower() if self.page.locator('button#apply-button, .apply-button').count() > 0 else ""
                if new_btn_text == "applied":
                    print("    [Success] Button text changed to 'Applied'.")
                    return True
                    
                print("    [Warning] Clicked apply but could not definitively verify success message.")
                # We return False if we can't verify to be safe and keep it as draft
                return False
                
            else:
                # Button might already say "Applied"
                already_applied = self.page.locator('button:has-text("Applied")')
                if already_applied.count() > 0:
                    print("    [Info] Job already applied.")
                    return True
                    
                print("    [Error] Could not locate an Apply button.")
                return False
                
        except Exception as e:
            print(f"    [Error] Exception during apply_to_job: {e}")
            return False

    def cleanup(self):
        self.context.close()
        self.browser.close()
        self.playwright.stop()
