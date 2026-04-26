import os
import sys
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL", "")
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

if not DATABASE_URL:
    print("No database url")
    sys.exit(1)

engine = create_engine(DATABASE_URL)

with engine.connect() as conn:
    try:
        conn.execute(text("ALTER TABLE job_listings ADD COLUMN industry TEXT"))
    except Exception as e:
        print("industry col might exist:", e)

    try:
        conn.execute(text("ALTER TABLE job_listings ADD COLUMN company_size TEXT"))
    except Exception as e:
        print("company_size col might exist:", e)

    try:
        conn.execute(text("ALTER TABLE job_listings ADD COLUMN job_level TEXT"))
    except Exception as e:
        print("job_level col might exist:", e)

    try:
        conn.execute(text("ALTER TABLE job_listings ADD COLUMN job_type TEXT"))
    except Exception as e:
        print("job_type col might exist:", e)
        
    conn.commit()
    print("Migration finished")
