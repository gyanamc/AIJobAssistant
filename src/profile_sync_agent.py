"""
profile_sync_agent.py — Orchestrates candidate profile scraping from LinkedIn & Naukri,
enriches profiles using Ollama, and syncs them to the Railway backend.
"""
import os
import sys
import json
import httpx
import random

project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from src.scraper.linkedin_profiles import LinkedInProfileScraper
from src.scraper.naukri_profiles import NaukriProfileScraper

# ── Config ────────────────────────────────────────────────────────────────────
BACKEND_URL  = os.getenv("BACKEND_URL", "https://aijobassistant-production.up.railway.app")
OLLAMA_HOST  = os.getenv("OLLAMA_HOST", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2:1b")

# Max profiles per platform per run — keep low to avoid bans
MAX_LINKEDIN = int(os.getenv("MAX_LINKEDIN_PROFILES", "30"))
MAX_NAUKRI   = int(os.getenv("MAX_NAUKRI_PROFILES",   "50"))


def extract_skills_with_ollama(profile: dict) -> str:
    """
    Use local Ollama to extract a clean, comma-separated skills list
    from the raw profile text.
    """
    raw_text = f"""
Name: {profile.get('name', '')}
Headline: {profile.get('headline', '')}
About: {profile.get('about', '')}
Skills listed: {profile.get('skills', '')}
Experience: {profile.get('experience', '')}
""".strip()

    prompt = (
        "Extract a clean comma-separated list of technical and professional skills "
        "from this candidate profile. Include programming languages, frameworks, tools, "
        "and domain expertise. Return ONLY the comma-separated list, nothing else.\n\n"
        f"Profile:\n{raw_text}"
    )

    try:
        res = httpx.post(
            f"{OLLAMA_HOST}/api/generate",
            json={"model": OLLAMA_MODEL, "prompt": prompt, "stream": False},
            timeout=30.0
        )
        if res.status_code == 200:
            return res.json().get("response", "").strip()
    except Exception as e:
        print(f"  Ollama skill extraction failed: {e}")

    # Fallback — return raw skills
    return profile.get('skills', '')


def build_resume_summary(profile: dict, enriched_skills: str) -> str:
    """Build a concise resume summary string for embedding."""
    parts = []
    if profile.get('headline'):
        parts.append(profile['headline'])
    if profile.get('about'):
        parts.append(profile['about'][:300])
    if enriched_skills:
        parts.append(f"Skills: {enriched_skills[:300]}")
    if profile.get('experience'):
        parts.append(f"Experience: {profile['experience'][:200]}")
    return ' | '.join(parts)


def sync_profile_to_backend(profile: dict, enriched_skills: str) -> bool:
    """POST the enriched profile to the Railway backend."""
    resume_summary = build_resume_summary(profile, enriched_skills)

    payload = {
        "shareAnonymized": True,
        "resumeSummary": resume_summary,
        "targetRoles": profile.get('headline', ''),
        "targetLocations": profile.get('location', ''),
        "skills": enriched_skills,
        "name": profile.get('name', 'Anonymous'),
        "email": "",
        "phone": "",
    }

    try:
        res = httpx.post(
            f"{BACKEND_URL}/api/v1/profile/sync",
            json=payload,
            timeout=30.0
        )
        if res.status_code == 200:
            return True
        else:
            print(f"  Backend sync failed: {res.status_code} — {res.text[:100]}")
            return False
    except Exception as e:
        print(f"  Backend sync error: {e}")
        return False


def process_profiles(profiles: list[dict], source: str) -> tuple[int, int]:
    """Enrich and sync a list of profiles. Returns (synced, failed) counts."""
    synced = 0
    failed = 0

    for i, profile in enumerate(profiles, 1):
        print(f"\n[{source}] Processing {i}/{len(profiles)}: {profile.get('name', 'Unknown')} — {profile.get('headline', '')[:50]}")

        # Use Ollama to extract clean skills
        print("  Extracting skills with Ollama...")
        enriched_skills = extract_skills_with_ollama(profile)
        print(f"  Skills: {enriched_skills[:80]}...")

        # Sync to backend
        print("  Syncing to backend...")
        if sync_profile_to_backend(profile, enriched_skills):
            print("  ✅ Synced successfully.")
            synced += 1
        else:
            print("  ❌ Sync failed.")
            failed += 1

    return synced, failed


def run():
    print("=" * 60)
    print("Profile Sync Agent — Starting")
    print(f"Backend: {BACKEND_URL}")
    print(f"Ollama:  {OLLAMA_HOST} ({OLLAMA_MODEL})")
    print("=" * 60)

    total_synced = 0
    total_failed = 0

    # ── LinkedIn ──────────────────────────────────────────────────────────────
    print("\n[1/2] Starting LinkedIn profile scraper...")
    linkedin_scraper = LinkedInProfileScraper(headless=True, max_profiles_per_run=MAX_LINKEDIN)
    try:
        linkedin_profiles = linkedin_scraper.run()
        print(f"\nLinkedIn: scraped {len(linkedin_profiles)} profiles.")
        s, f = process_profiles(linkedin_profiles, "LinkedIn")
        total_synced += s
        total_failed += f
    except Exception as e:
        print(f"LinkedIn scraper error: {e}")
    finally:
        linkedin_scraper.cleanup()

    # ── Naukri ────────────────────────────────────────────────────────────────
    print("\n[2/2] Starting Naukri profile scraper...")
    naukri_scraper = NaukriProfileScraper(headless=True, max_profiles_per_run=MAX_NAUKRI)
    try:
        naukri_profiles = naukri_scraper.run()
        print(f"\nNaukri: scraped {len(naukri_profiles)} profiles.")
        s, f = process_profiles(naukri_profiles, "Naukri")
        total_synced += s
        total_failed += f
    except Exception as e:
        print(f"Naukri scraper error: {e}")
    finally:
        naukri_scraper.cleanup()

    print("\n" + "=" * 60)
    print(f"Run complete. Synced: {total_synced} | Failed: {total_failed}")
    print("=" * 60)


if __name__ == "__main__":
    run()
