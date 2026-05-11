import os
import psycopg2
from psycopg2.extras import RealDictCursor

DATABASE_URL = os.getenv("DATABASE_URL")


def get_conn():
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL is not configured")
    return psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)


def init_db():
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS jobs (
                    id          TEXT PRIMARY KEY,
                    title       TEXT,
                    company     TEXT,
                    location    TEXT,
                    salary      TEXT,
                    url         TEXT,
                    posted_at   TIMESTAMPTZ,
                    description TEXT,
                    job_area    TEXT,
                    fetched_at  TIMESTAMPTZ DEFAULT NOW()
                );

                CREATE TABLE IF NOT EXISTS job_scores (
                    job_id      TEXT REFERENCES jobs(id) ON DELETE CASCADE,
                    resume_hash TEXT,
                    score       INTEGER,
                    matched_at  TIMESTAMPTZ DEFAULT NOW(),
                    PRIMARY KEY (job_id, resume_hash)
                );

                CREATE TABLE IF NOT EXISTS search_sessions (
                    id          TEXT PRIMARY KEY,
                    name        TEXT,
                    status      TEXT DEFAULT 'running',
                    job_count   INTEGER DEFAULT 0,
                    created_at  TIMESTAMPTZ DEFAULT NOW()
                );

                CREATE TABLE IF NOT EXISTS session_jobs (
                    session_id  TEXT REFERENCES search_sessions(id) ON DELETE CASCADE,
                    job_id      TEXT REFERENCES jobs(id) ON DELETE CASCADE,
                    PRIMARY KEY (session_id, job_id)
                );
            """)
        conn.commit()
    finally:
        conn.close()
