#!/bin/bash
# Run once to set up the local scraper environment

echo "Installing Python dependencies..."
pip install playwright playwright-stealth httpx sqlalchemy psycopg2-binary python-dotenv feedparser

echo "Installing Playwright browsers..."
playwright install chromium

echo "Setup complete! Run the scraper with:"
echo "  python scraper/local_scraper.py"
