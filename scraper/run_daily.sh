#!/bin/bash
# Daily job scraper launcher
# Add to crontab: 0 8 * * * /bin/bash /path/to/scraper/run_daily.sh >> /tmp/daily_scraper.log 2>&1

cd "$(dirname "$0")/.."
source .env 2>/dev/null || true

echo "[$(date)] Starting daily scraper (last 24h)..."
python3 scraper/daily_scraper.py --days 1
echo "[$(date)] Done."
