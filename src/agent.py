import time
import os
import json
import sys
import random

# Add project root to Python path to fix ModuleNotFoundError
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from src.scraper.linkedin import LinkedInScraper
from src.llm.llm_client import LLMClient
from src.llm.schema import UserProfile
from db.database import init_db, add_job, should_skip
from src.sheets.sheets_client import SheetsClient

def load_user_profile(filepath='data/user_profile.json') -> UserProfile:
    profile_path = os.path.join(os.path.dirname(__file__), '..', filepath)
    with open(profile_path, 'r') as f:
        return UserProfile(**json.load(f))

def run_agent():
    print("Initializing Database...")
    init_db()
    
    print("Loading Profile...")
    profile = load_user_profile()
    
    print("Initializing LLM Client...")
    try:
        llm = LLMClient()
    except Exception as e:
        print(f"Error initializing LLM: {e}. Did you set OPENAI_API_KEY in .env?")
        sys.exit(1)
        
    print("Initializing Sheets Client...")
    sheets = SheetsClient()
    
    print("Starting Scraper (Headed mode for demonstration)...")
    scraper = LinkedInScraper(headless=False)
    
    try:
        scraper.init_session()
        
        for role in profile.preferences.roles:
            for location in profile.preferences.locations:
                print(f"\n--- Searching for '{role}' in '{location}' ---")
                jobs = scraper.search_jobs(role, location)
                
                print(f"Found {len(jobs)} jobs. Processing...")
                for job in jobs:
                    if should_skip(job['id']):
                        print(f"Already processed job {job['id']} successfully or explicitly skipped, ignoring...")
                        continue
                        
                    print(f"\nEvaluating: {job['title']} at {job['company']}")
                    print(f"URL: {job['url']}")
                    
                    desc = scraper.get_job_description(job['url'])
                    if not desc:
                        print("Failed to get description...")
                        add_job(job['id'], job['title'], job['company'], job['url'], 'failed', role_title=role, reasoning="Failed to retrieve description")
                        continue
                        
                    evaluation = llm.evaluate_job(job['title'], desc)
                    
                    if evaluation.is_match:
                        print("✅ MATCH FOUND!")
                        print(f"Reasoning: {evaluation.reasoning}")
                        # Next step: Fill out the application form
                        # For now, we mark as 'draft'
                        add_job(job['id'], job['title'], job['company'], job['url'], 'draft', role_title=role, reasoning=evaluation.reasoning)
                        print("Job saved to draft queue!")
                        
                        # Push it to Google Sheets
                        if sheets.service:
                            print("Syncing to Google Sheets...")
                            sheets.append_job_to_sheet(job, evaluation)
                            
                    else:
                        print("❌ No match.")
                        print(f"Reasoning: {evaluation.reasoning}")
                        add_job(job['id'], job['title'], job['company'], job['url'], 'skipped', role_title=role, reasoning=evaluation.reasoning)
                        
                    time.sleep(random.uniform(3, 7)) # Be polite, add human-like delay
                
                # Add an overarching delay between searching different roles/locations
                print("Taking a longer break before the next search query...")
                time.sleep(random.uniform(10, 20))
    except Exception as e:
        print(f"Agent encountered an error: {e}")
    finally:
        print("Cleaning up scraper...")
        scraper.cleanup()

if __name__ == "__main__":
    run_agent()
