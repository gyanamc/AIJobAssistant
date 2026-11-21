"""
Database migration: create `resumes` table in PostgreSQL.
Retains original uploaded resume files (PDF/DOCX) in BYTEA format,
along with extracted text, parsed structured metadata, file checksum,
and version tracking per user.
"""
import os
import sys
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL", "")
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

if not DATABASE_URL:
    print("No DATABASE_URL found in environment.")
    sys.exit(1)

engine = create_engine(DATABASE_URL)

def run_migration():
    with engine.connect() as conn:
        print("Migrating: creating resumes table...")
        # JSONB for postgres, JSON fallback for sqlite
        json_type = "JSON" if "sqlite" in DATABASE_URL else "JSONB"
        bytea_type = "BLOB" if "sqlite" in DATABASE_URL else "BYTEA"
        
        conn.execute(text(f"""
            CREATE TABLE IF NOT EXISTS resumes (
                id SERIAL PRIMARY KEY,
                user_id VARCHAR(100) NOT NULL,
                filename VARCHAR(255) NOT NULL,
                mime_type VARCHAR(100) NOT NULL,
                file_size INTEGER NOT NULL,
                file_hash VARCHAR(64) NOT NULL,
                file_data {bytea_type} NOT NULL,
                extracted_text TEXT NOT NULL,
                parsed_info {json_type} NOT NULL DEFAULT '{{}}',
                version INTEGER NOT NULL DEFAULT 1,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            )
        """))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_resumes_user_id ON resumes(user_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_resumes_file_hash ON resumes(file_hash)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_resumes_user_hash ON resumes(user_id, file_hash)"))
        conn.commit()
        print("Migration finished: `resumes` table ready.")

if __name__ == "__main__":
    run_migration()

