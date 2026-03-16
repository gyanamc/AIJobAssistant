import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), 'jobs.db')

def init_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS jobs (
            job_id TEXT PRIMARY KEY,
            title TEXT,
            company TEXT,
            url TEXT,
            status TEXT, -- 'applied', 'draft', 'failed', 'skipped'
            role_title TEXT,
            reasoning TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.commit()
    conn.close()

def add_job(job_id: str, title: str, company: str, url: str, status: str, role_title: str = '', reasoning: str = ''):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    try:
        cursor.execute('''
            INSERT INTO jobs (job_id, title, company, url, status, role_title, reasoning)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(job_id) DO UPDATE SET status=excluded.status, reasoning=excluded.reasoning
        ''', (job_id, title, company, url, status, role_title, reasoning))
        conn.commit()
    except sqlite3.Error as e:
        print(f"Database error: {e}")
    finally:
        conn.close()

def update_job_status(job_id: str, status: str):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('UPDATE jobs SET status = ? WHERE job_id = ?', (status, job_id))
    conn.commit()
    conn.close()

def should_skip(job_id: str) -> bool:
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('SELECT status FROM jobs WHERE job_id = ?', (job_id,))
    result = cursor.fetchone()
    conn.close()
    
    if result:
        # If it's failed, return False so we process it again
        return result[0] in ('applied', 'draft', 'skipped')
    return False

init_db()
