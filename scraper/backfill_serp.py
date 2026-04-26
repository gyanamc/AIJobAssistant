import os
import sys
import time
import json
import urllib.request
import urllib.parse
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "")
SERP_API_KEY = os.getenv("SERP_API_KEY", "")
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")

if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

if not DATABASE_URL or not SERP_API_KEY or not GROQ_API_KEY:
    print("ERROR: Missing required API keys in .env")
    sys.exit(1)

engine = create_engine(DATABASE_URL)

def backfill_job(row):
    job_id = row[0]
    title = row[1]
    company = row[2]
    location = row[3]

    print(f"Backfilling {job_id} ({company})...")

    query = urllib.parse.quote(f"{company} employee count and industry")
    url = f"https://serpapi.com/search.json?q={query}&api_key={SERP_API_KEY}"
    
    try:
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read())
            
        snippets = []
        if "knowledge_graph" in data:
            snippets.append(json.dumps(data["knowledge_graph"]))
        for res in data.get("organic_results", [])[:3]:
            snippets.append(res.get("snippet", ""))
            
        context_str = " ".join(snippets)
        if not context_str:
            print("  No search results.")
            return
            
        prompt = (
            f"Extract the following info for company '{company}' from these search results: {context_str}\n"
            f"Also infer job_level (Entry, Mid, Senior, Executive) and job_type (Remote, On-site, Hybrid) from title '{title}' and location '{location}'.\n"
            f"Return ONLY valid JSON with keys: 'industry' (string), 'company_size' (string, e.g. '1001-5000'), 'job_level' (string), 'job_type' (string). No markdown blocks."
        )
        
        req_llm = urllib.request.Request(
            "https://api.groq.com/openai/v1/chat/completions",
            data=json.dumps({
                "model": "llama-3.1-8b-instant",
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.1,
                "response_format": {"type": "json_object"}
            }).encode(),
            headers={"Authorization": f"Bearer {GROQ_API_KEY}", "Content-Type": "application/json"}
        )
        
        with urllib.request.urlopen(req_llm, timeout=15) as resp_llm:
            result = json.loads(resp_llm.read())
            parsed = json.loads(result["choices"][0]["message"]["content"])
            
            industry = parsed.get("industry", "")[:50]
            company_size = parsed.get("company_size", "")[:50]
            job_level = parsed.get("job_level", "")[:50]
            job_type = parsed.get("job_type", "")[:50]
            
            with engine.connect() as conn:
                conn.execute(text("""
                    UPDATE job_listings 
                    SET industry=:industry, company_size=:company_size, job_level=:job_level, job_type=:job_type 
                    WHERE id=:id
                """), {"industry": industry, "company_size": company_size, "job_level": job_level, "job_type": job_type, "id": job_id})
                conn.commit()
            print(f"  ✅ Updated: {industry}, {company_size}")
            
    except Exception as e:
        print(f"  Error: {e}")

def main():
    print("Starting SERP API backfill...")
    with engine.connect() as conn:
        rows = conn.execute(text("""
            SELECT id, title, company, location 
            FROM job_listings 
            WHERE (industry IS NULL OR industry = '') AND company != 'Unknown' AND company != ''
            LIMIT 50
        """)).fetchall()
        
    print(f"Found {len(rows)} jobs to backfill.")
    for row in rows:
        backfill_job(row)
        time.sleep(2) # Prevent rate limiting
        
    print("Backfill complete.")

if __name__ == "__main__":
    main()
