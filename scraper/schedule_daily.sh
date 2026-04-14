#!/bin/bash
# Add this to your Mac's crontab to run daily at 9 AM
# Run: crontab -e
# Then add this line (update the path to match yours):
# 0 9 * * * /bin/bash /Users/kumargyanam/Downloads/AIJobAssistant4Everyone/AIJobAssistant/scraper/schedule_daily.sh >> /tmp/job_scraper.log 2>&1

cd "$(dirname "$0")/.."
source .env 2>/dev/null || true

echo "[$(date)] Starting daily job scrape..."
python3 scraper/local_scraper.py
echo "[$(date)] Done."
