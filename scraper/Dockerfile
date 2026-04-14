FROM python:3.11-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY job_ingestion.py .

# Run once on container start (Railway Cron will restart it daily)
CMD ["python", "job_ingestion.py"]
