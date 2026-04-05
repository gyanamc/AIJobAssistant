"""
scheduler.py — Runs the profile sync agent on a nightly schedule.
Default: every day at 2:00 AM local time.

Usage:
    python src/scheduler.py

Environment variables:
    SCHEDULE_TIME   — Time to run daily, e.g. "02:00" (default: "02:00")
    RUN_NOW         — Set to "1" to run immediately on startup, then schedule
"""
import os
import sys
import time
import schedule
from datetime import datetime

project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from src.profile_sync_agent import run as run_agent

SCHEDULE_TIME = os.getenv("SCHEDULE_TIME", "02:00")
RUN_NOW       = os.getenv("RUN_NOW", "0") == "1"


def job():
    print(f"\n{'='*60}")
    print(f"Scheduler triggered at {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'='*60}")
    try:
        run_agent()
    except Exception as e:
        print(f"Agent run failed: {e}")


def main():
    print(f"Scheduler started. Daily run scheduled at {SCHEDULE_TIME}.")
    print("Press Ctrl+C to stop.\n")

    schedule.every().day.at(SCHEDULE_TIME).do(job)

    if RUN_NOW:
        print("RUN_NOW=1 detected — running immediately...")
        job()

    while True:
        schedule.run_pending()
        time.sleep(60)


if __name__ == "__main__":
    main()
