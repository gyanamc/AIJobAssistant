"""
Migrate job_listings embedding column from vector(768) to vector(1536)
Run once: python3 scraper/migrate_embeddings.py
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
    print("ERROR: DATABASE_URL not set in .env")
    sys.exit(1)

engine = create_engine(DATABASE_URL)

print("Migrating embedding column from vector(768) to vector(1536)...")
with engine.connect() as conn:
    # Drop old index first
    conn.execute(text("DROP INDEX IF EXISTS idx_job_listings_embedding"))
    # Alter column type — clears existing embeddings
    conn.execute(text("""
        ALTER TABLE job_listings 
        ALTER COLUMN embedding TYPE vector(1536)
        USING NULL
    """))
    # Also update candidate_profiles if needed
    try:
        conn.execute(text("DROP INDEX IF EXISTS idx_candidate_profiles_embedding"))
        conn.execute(text("""
            ALTER TABLE candidate_profiles
            ALTER COLUMN embedding TYPE vector(1536)
            USING NULL
        """))
        print("✅ candidate_profiles embedding column updated too.")
    except Exception as e:
        print(f"  candidate_profiles skip: {e}")
    conn.commit()

print("✅ Migration complete. All embeddings cleared — run backfill next.")
print("\nNow run:")
print("  curl -s -X POST https://aijobassistant-production.up.railway.app/api/v1/admin/backfill-embeddings")
