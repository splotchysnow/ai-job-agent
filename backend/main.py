import os
import io
import json
import hashlib
import uuid

from fastapi import FastAPI, Query, Request, HTTPException, Header, Depends, File, UploadFile, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.encoders import jsonable_encoder
from contextlib import asynccontextmanager
from pydantic import BaseModel
from anthropic import Anthropic
from dotenv import load_dotenv
import redis
from enum import Enum
from datetime import datetime, timedelta, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed
import requests

load_dotenv()

redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
redis_client = redis.from_url(redis_url)

JSEARCH_API_KEY = os.getenv("JSEARCH_API_KEY")


@asynccontextmanager
async def lifespan(app: FastAPI):
    if os.getenv("DATABASE_URL"):
        try:
            from db import init_db
            init_db()
        except Exception as e:
            print(f"DB init warning: {e}")
    yield


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class DatePosted(str, Enum):
    hours_24 = "24hours"
    days_3   = "3days"
    week_1   = "1week"
    weeks_2  = "2weeks"

class JobRecommendationRequest(BaseModel):
    resume_bullets: str
    job_area: str
    max_page: int = 10
    date_posted: DatePosted = DatePosted.week_1

class QuickMatchRequest(BaseModel):
    job_description: str
    resume_bullets: str

JSEARCH_DATE_MAP = {
    DatePosted.hours_24: "today",
    DatePosted.days_3:   "3days",
    DatePosted.week_1:   "week",
    DatePosted.weeks_2:  "month",
}

CUTOFF_MAP = {
    DatePosted.hours_24: timedelta(hours=24),
    DatePosted.days_3:   timedelta(days=3),
    DatePosted.week_1:   timedelta(weeks=1),
    DatePosted.weeks_2:  timedelta(weeks=2),
}

def is_within_cutoff(posted_at: str | None, cutoff: timedelta) -> bool:
    if not posted_at:
        return True
    try:
        posted_dt = datetime.fromisoformat(posted_at.replace("Z", "+00:00"))
        return datetime.now(timezone.utc) - posted_dt <= cutoff
    except ValueError:
        return True
@app.middleware("http")
async def rate_limit(request: Request, call_next):
    ip = request.client.host
    key = f"rate:{ip}"
    count = redis_client.incr(key)
    if count == 1:
        redis_client.expire(key, 3600)
    if count > 50:
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=429, content={"detail": "Too many requests"})
    return await call_next(request)

def get_client(x_api_key: str | None = Header(default=None)) -> Anthropic:
    return Anthropic(api_key=x_api_key or os.getenv("ANTHROPIC_API_KEY"))

# Liveness check — used by Railway and Docker to confirm the server is up.
@app.get("/health")
def health():
    return {"status": "ok"}

class TailorRequest(BaseModel):
    job_description: str
    resume_bullets: str
    job_area: str

class ExtractJobInfoRequest(BaseModel):
    job_description: str

class DraftRequest(BaseModel):
    job_description: str
    tailored_bullets: str = None
    first_name: str = None
    last_name: str = None
    job_area: str = None
    company_name: str = None
    output_type: str = "email"
    company_research: str = None

class MatchRequest(BaseModel):
    job_description: str
    resume_bullets: str
    job_area: str

# Rewrites the user's master resume bullets to be more relevant to a specific job description.
# Returns 4-6 action-verb bullets labelled with the originating company/role.
# Redis-cached for 1hr — same job + same bullets + same area always produces the same output.
@app.post("/tailor")
def tailor_resume(request: TailorRequest, client: Anthropic = Depends(get_client)):
    cache_key = "tailor:" + hashlib.md5(f"{request.job_description}+{request.resume_bullets}+{request.job_area}".encode()).hexdigest()
    cached = redis_client.get(cache_key)
    if cached:
        return {"tailored_bullets": json.loads(cached), "cached": True}

    message = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=1024,
        system=[{
            "type": "text",
            "text": f"You are a resume coach specializing in {request.job_area}. Given resume bullets and a job description, rewrite and select the most relevant bullets tailored to the job. Output 4-6 strong bullet points starting with action verbs. Label each bullet with the company/experience it comes from in brackets before the bullet, like [SOL Automatic]. Output only the bullets, no preamble. CRITICAL: Only rewrite bullets from the provided resume. Never invent new achievements, metrics, technologies, or experiences not present in the original bullets.",
            "cache_control": {"type": "ephemeral"},
        }],
        messages=[{"role": "user", "content": [
            {
                "type": "text",
                "text": f"Resume Bullets:\n{request.resume_bullets}",
                "cache_control": {"type": "ephemeral"},
            },
            {
                "type": "text",
                "text": f"Job Description:\n{request.job_description}\n\nTailor the resume bullets to better fit the job description.",
            },
        ]}]
    )
    result = message.content[0].text
    redis_client.setex(cache_key, 3600, json.dumps(result))
    return {"tailored_bullets": result, "cached": False}

# Generates a personalized cold outreach email or formal cover letter.
# Weaves in company research when provided. Not cached — output is personalized to the user's name and preferences.
@app.post("/draft")
def draft_email(request: DraftRequest, client: Anthropic = Depends(get_client)):
    research_instruction = (
        " Specific company talking points are provided — pick 1-2 that connect naturally to the candidate's background and weave them into the email. Make them feel genuine, not like a checklist."
        if request.company_research else ""
    )

    company = request.company_name or "the company"
    honesty_rule = " CRITICAL: Only use facts that appear explicitly in the candidate's resume highlights. Never invent years of experience, skills, projects, or achievements not mentioned. If something is not in the resume, do not say it."
    formatting_rule = " Plain text only. No markdown, no bullet points, no em dashes (—), no en dashes (–). Use commas and periods instead."

    if request.output_type == "cover_letter":
        system = f"You are a professional cover letter writer. Write a formal, well-structured cover letter for a {request.job_area} position. Start with 'Dear {company} Hiring Team,' on the first line. Include an opening paragraph, 2-3 body paragraphs highlighting relevant experience and why this company specifically, and a closing paragraph. Sign off as {request.first_name} {request.last_name}.{research_instruction}{honesty_rule}{formatting_rule}"
    else:
        system = f"You are a professional outreach writer. Write a concise, genuine cold outreach email for a {request.job_area} position. Start with 'Hi {company} team,' on the first line. Sound human, not corporate. 2-3 short paragraphs max. No subject line. Sign off as {request.first_name} {request.last_name}.{research_instruction}{honesty_rule}{formatting_rule}"

    content = f"Job description:\n{request.job_description}"
    if request.company_research:
        content += f"\n\nAbout the company:\n{request.company_research}"
    content += f"\n\nMy relevant experience and highlights:\n{request.tailored_bullets}"

    message = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=1024,
        system=system,
        messages=[{"role": "user", "content": content}]
    )
    return {"email": message.content[0].text}

# Extracts job title and company name from a raw job description.
# Redis-cached for 24hr — the same job posting always contains the same metadata.
@app.post("/extract-job-info")
def extract_job_info(request: ExtractJobInfoRequest, client: Anthropic = Depends(get_client)):
    cache_key = "jobinfo:" + hashlib.md5(request.job_description.encode()).hexdigest()
    cached = redis_client.get(cache_key)
    if cached:
        return json.loads(cached)

    message = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=64,
        system="Extract the job title and company name from the job description. Respond in this exact format:\nJOB_TITLE: [title or null]\nCOMPANY: [company name or null]",
        messages=[{"role": "user", "content": request.job_description}]
    )
    text = message.content[0].text
    job_title = None
    company_name = None
    for line in text.split('\n'):
        if line.startswith('JOB_TITLE:'):
            val = line.replace('JOB_TITLE:', '').strip()
            job_title = None if val.lower() in ('null', 'unknown', 'n/a', '') else val
        elif line.startswith('COMPANY:'):
            val = line.replace('COMPANY:', '').strip()
            company_name = None if val.lower() in ('null', 'unknown', 'n/a', '') else val
    result = {"job_title": job_title, "company_name": company_name}
    redis_client.setex(cache_key, 86400, json.dumps(result))
    return result

class CleanResumeRequest(BaseModel):
    resume_text: str

class ResearchRequest(BaseModel):
    company_name: str
    job_area: str = None

# Strips a full resume down to experience bullets grouped by company and role.
# Removes contact info, summary, education, and skills sections to cut token noise on every run.
# Redis-cached for 7 days — same resume text always produces the same cleaned output.
@app.post("/clean-resume")
def clean_resume(request: CleanResumeRequest, client: Anthropic = Depends(get_client)):
    cache_key = "cleanresume:" + hashlib.md5(request.resume_text.encode()).hexdigest()
    cached = redis_client.get(cache_key)
    if cached:
        return json.loads(cached)

    message = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=1024,
        system=[{
            "type": "text",
            "text": "Extract the work experience bullet points from this resume. For each role, write the company name and job title as a label in brackets (e.g. [NewBeeDrone — Full Stack Engineer]), then list the bullet points underneath. Keep all specific achievements, metrics, and technical details. Skip contact information, summary, education, and skills sections. Output only the formatted bullets, no preamble.",
            "cache_control": {"type": "ephemeral"},
        }],
        messages=[{"role": "user", "content": request.resume_text}]
    )
    result = {"cleaned": message.content[0].text}
    redis_client.setex(cache_key, 86400 * 7, json.dumps(result))
    return result

# Researches a company and returns 3-4 job-application-specific talking points.
# Each point is a concrete fact paired with a note on how to use it in an outreach email.
# Redis-cached for 24hr — v2 cache key forces refresh from old prose format.
@app.post("/research")
def research_company(request: ResearchRequest, client: Anthropic = Depends(get_client)):
    cache_key = "research:v2:" + hashlib.md5(f"{request.company_name}+{request.job_area or ''}".encode()).hexdigest()
    cached = redis_client.get(cache_key)
    if cached:
        return json.loads(cached)

    job_area = request.job_area or "tech"
    messages = [{
        "role": "user",
        "content": f"Research '{request.company_name}' for someone applying to a {job_area} role. Find 3-4 specific, current talking points they could naturally weave into a cold outreach email to show genuine interest. Focus on: recent funding or milestones, notable products or launches, engineering or company culture signals, what makes them stand out. Skip generic facts like employee count or founding year unless they're remarkable. For each point explain briefly how a candidate could use it."
    }]

    for _ in range(8):
        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=512,
            system=f"You are a job application coach helping someone research a company before reaching out. Return exactly 3-4 bullet points starting with •. Each bullet: one specific, current fact about the company, then a dash, then one sentence on how a {job_area} candidate could reference it naturally in an outreach email. No intros, no prose, no headers — just the bullets.",
            tools=[{"type": "web_search_20250305", "name": "web_search"}],
            messages=messages
        )
        if response.stop_reason == "end_turn":
            text = next((b.text for b in response.content if hasattr(b, 'text')), '')
            text = (text
                .replace('**', '')
                .replace('__', '')
                .replace('## ', '')
                .replace('# ', '')
                .strip())
            result = {"summary": text}
            redis_client.setex(cache_key, 86400, json.dumps(result))
            return result
        messages.append({"role": "assistant", "content": response.content})
        tool_results = [
            {"type": "tool_result", "tool_use_id": block.id, "content": ""}
            for block in response.content
            if block.type == "tool_use"
        ]
        if tool_results:
            messages.append({"role": "user", "content": tool_results})

    return {"summary": "Unable to research this company at this time."}

# Accepts a PDF or DOCX resume upload and returns the extracted plain text.
# Not cached — file content varies per upload.
@app.post("/extract")
async def extract_text(file: UploadFile = File(...)):
    content = await file.read()
    filename = file.filename or ''

    if filename.lower().endswith('.pdf'):
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(content))
        text = '\n'.join(page.extract_text() or '' for page in reader.pages)
    elif filename.lower().endswith('.docx'):
        from docx import Document
        doc = Document(io.BytesIO(content))
        text = '\n'.join(p.text for p in doc.paragraphs if p.text.strip())
    else:
        raise HTTPException(status_code=400, detail="Unsupported file type. Upload a PDF or DOCX.")

    return {"text": text.strip()}

# Scores how well a candidate's resume matches a job description from 0-100,
# with a 2-3 sentence plain-English explanation of what fits and what's missing.
# Redis-cached for 1hr — same job + same resume always yields the same score.
@app.post("/match")
def match_jobs(request: MatchRequest, client: Anthropic = Depends(get_client)):
    cache_key = "match:" + hashlib.md5(f"{request.job_description}+{request.resume_bullets}+{request.job_area}".encode()).hexdigest()
    cached = redis_client.get(cache_key)
    if cached:
        return json.loads(cached)

    message = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=256,
        system=[{
            "type": "text",
            "text": "You are a hiring manager. Given a job description and a candidate's resume bullets, score how well the candidate matches the job from 0-100. Be honest and critical. Respond in this exact format:\nSCORE: [number]\nREASON: [2-3 sentences explaining the score, what fits well and what's missing]",
            "cache_control": {"type": "ephemeral"},
        }],
        messages=[{"role": "user", "content": [
            {
                "type": "text",
                "text": f"Candidate Resume:\n{request.resume_bullets}",
                "cache_control": {"type": "ephemeral"},
            },
            {
                "type": "text",
                "text": f"Job Description:\n{request.job_description}",
            },
        ]}]
    )
    text = message.content[0].text
    score_line = [line for line in text.split('\n') if line.startswith('SCORE:')][0]
    reason_line = [line for line in text.split('\n') if line.startswith('REASON:')][0]
    score = int(''.join(filter(str.isdigit, score_line)))
    reason = reason_line.replace('REASON:', '').strip()
    result = {"score": score, "reason": reason}
    redis_client.setex(cache_key, 3600, json.dumps(result))
    return result


@app.post("/match/score")
def quick_match(request: QuickMatchRequest, client: Anthropic = Depends(get_client)):
    cache_key = "quickmatch:" + hashlib.md5(f"{request.job_description}+{request.resume_bullets}".encode()).hexdigest()
    cached = redis_client.get(cache_key)
    if cached:
        return json.loads(cached)

    message = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=5,   # a number 0-100 is at most 3 tokens, give a tiny buffer
        system="You are a hiring manager. Score how well the candidate's resume matches the job from 0-100. Reply with ONLY the number. No text, no explanation.",
        messages=[{"role": "user", "content": f"Job Description:\n{request.job_description}\n\nCandidate Resume:\n{request.resume_bullets}"}]
    )

    score = int(''.join(filter(str.isdigit, message.content[0].text.strip())))
    result = {"score": score}
    redis_client.setex(cache_key, 3600, json.dumps(result))
    return result



def score_job(job: dict, resume_bullets: str, client: Anthropic) -> dict:
    try:
        cache_key = "quickmatch:" + hashlib.md5(f"{job['description']}+{resume_bullets}".encode()).hexdigest()
        cached = redis_client.get(cache_key)
        if cached:
            job["matchScore"] = json.loads(cached)["score"]
            return job

        message = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=5,
            system="You are a hiring manager. Score how well the candidate's resume matches the job from 0-100. Reply with ONLY the number. No text, no explanation.",
            messages=[{"role": "user", "content": f"Job Description:\n{job['description']}\n\nCandidate Resume:\n{resume_bullets}"}]
        )

        score = int(''.join(filter(str.isdigit, message.content[0].text.strip())))
        redis_client.setex(cache_key, 3600, json.dumps({"score": score}))
        job["matchScore"] = score
    except Exception as e:
        print(f"Failed to score job {job.get('id')}: {e}")
        job["matchScore"] = 0

    return job

# ── DB-backed job pipeline ──────────────────────────────────────────────────

class FetchRequest(BaseModel):
    job_area: str
    location: str = ""
    remote_only: bool = False
    max_page: int = 10
    date_posted: DatePosted = DatePosted.week_1
    name: str = ""

class DbMatchRequest(BaseModel):
    resume_bullets: str
    session_id: str


def _fetch_job_details(job_id: str) -> str | None:
    """Returns the full job description from JSearch Job Details, or None on failure."""
    try:
        resp = requests.get(
            "https://jsearch.p.rapidapi.com/job-details",
            headers={"X-RapidAPI-Key": JSEARCH_API_KEY, "X-RapidAPI-Host": "jsearch.p.rapidapi.com"},
            params={"job_id": job_id, "extended_publisher_details": "false"},
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json().get("data", [])
        if not isinstance(data, list) or not data:
            return None
        return data[0].get("job_description") if isinstance(data[0], dict) else None
    except Exception:
        return None


def _run_fetch(task_id: str, session_id: str, request: FetchRequest):
    """Fetches jobs from JSearch (V2 single-call, falls back to V1 pagination) and upserts into NeonDB."""
    from db import get_conn
    jsearch_headers = {"X-RapidAPI-Key": JSEARCH_API_KEY, "X-RapidAPI-Host": "jsearch.p.rapidapi.com"}
    jsearch_filter = JSEARCH_DATE_MAP[request.date_posted]
    cutoff = CUTOFF_MAP[request.date_posted]
    total_fetched = 0

    query = request.job_area
    if request.location:
        query += f" in {request.location}"
    if request.remote_only:
        query += " remote"

    def _set_status(status: str, page: int = 0, error: str = None):
        payload = {"status": status, "page": page, "total_pages": request.max_page, "fetched": total_fetched}
        if error:
            payload["error"] = error
        redis_client.setex(f"fetch:{task_id}", 3600, json.dumps(payload))

    def _update_session(status: str):
        try:
            c = get_conn()
            try:
                with c.cursor() as cur:
                    cur.execute(
                        "UPDATE search_sessions SET status=%s, job_count=%s WHERE id=%s",
                        (status, total_fetched, session_id),
                    )
                c.commit()
            finally:
                c.close()
        except Exception:
            pass

    def _clean(s):
        return s.replace('\x00', '') if isinstance(s, str) else s

    def _upsert_jobs(conn, jobs: list):
        nonlocal total_fetched
        with conn.cursor() as cur:
            for job in jobs:
                if not isinstance(job, dict):
                    continue
                if not is_within_cutoff(job.get("job_posted_at_datetime_utc"), cutoff):
                    continue
                job_id = job.get("job_id")
                cur.execute("""
                    INSERT INTO jobs (id, title, company, location, salary, url, posted_at, description, job_area)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (id) DO UPDATE SET
                        title = EXCLUDED.title, company = EXCLUDED.company,
                        description = EXCLUDED.description, fetched_at = NOW()
                """, (
                    job_id, _clean(job.get("job_title")), _clean(job.get("employer_name")),
                    _clean(f"{job.get('job_city')}, {job.get('job_state')}"),
                    job.get("job_min_salary") or job.get("job_salary"),
                    job.get("job_apply_link"),
                    job.get("job_posted_at_datetime_utc"),
                    _clean(job.get("job_description")), request.job_area,
                ))
                if job_id:
                    cur.execute(
                        "INSERT INTO session_jobs (session_id, job_id) VALUES (%s, %s) ON CONFLICT DO NOTHING",
                        (session_id, job_id),
                    )
                total_fetched += 1
        conn.commit()

    try:
        conn = get_conn()
        try:
            _set_status("running", 1)

            # Try V2 first — single call, returns all pages at once, uses 1 quota unit vs N
            try:
                resp = requests.get(
                    "https://jsearch.p.rapidapi.com/search-v2",
                    headers=jsearch_headers,
                    params={"query": query, "num_pages": str(request.max_page),
                            "date_posted": jsearch_filter, "country": "us"},
                    timeout=20,
                )
                resp.raise_for_status()
                payload = resp.json()
                jobs = payload.get("data", []) if isinstance(payload, dict) else []
                if isinstance(jobs, list) and jobs:
                    _upsert_jobs(conn, jobs)
                    _update_session("done")
                    _set_status("done", request.max_page)
                    return
            except requests.exceptions.RequestException:
                pass  # V2 unavailable or rate-limited — fall through to V1

            # V1 fallback — paginate one page at a time
            consecutive_failures = 0
            for page in range(1, request.max_page + 1):
                _set_status("running", page)
                try:
                    resp = requests.get(
                        "https://jsearch.p.rapidapi.com/search",
                        headers=jsearch_headers,
                        params={"query": query, "num_pages": "1",
                                "page": str(page), "date_posted": jsearch_filter},
                        timeout=20,
                    )
                    resp.raise_for_status()
                    payload = resp.json()
                    jobs = payload.get("data", []) if isinstance(payload, dict) else []
                    if not isinstance(jobs, list):
                        jobs = []
                    consecutive_failures = 0
                except requests.exceptions.RequestException:
                    consecutive_failures += 1
                    if consecutive_failures >= 3:
                        break  # give up after 3 consecutive failures
                    continue  # skip this page and try the next

                if not jobs:
                    break
                _upsert_jobs(conn, jobs)

        finally:
            conn.close()
        _update_session("done")
        _set_status("done", request.max_page)
    except Exception as e:
        _update_session("error")
        _set_status("error", error=str(e))


@app.post("/jobs/fetch")
async def start_fetch(request: FetchRequest, background_tasks: BackgroundTasks):
    session_id = uuid.uuid4().hex[:12]
    task_id = hashlib.md5(f"{request.job_area}{datetime.now().isoformat()}".encode()).hexdigest()[:8]

    if request.name.strip():
        session_name = request.name.strip()
    else:
        date_label = {"24hours": "24h", "3days": "3d", "1week": "1wk", "2weeks": "2wk"}.get(
            request.date_posted.value, request.date_posted.value
        )
        parts = [request.job_area]
        if request.location:
            parts.append(request.location)
        parts.append(date_label)
        session_name = " · ".join(parts)

    try:
        from db import get_conn
        _c = get_conn()
        try:
            with _c.cursor() as cur:
                cur.execute(
                    "INSERT INTO search_sessions (id, name, status) VALUES (%s, %s, 'running')",
                    (session_id, session_name),
                )
            _c.commit()
        finally:
            _c.close()
    except Exception:
        pass

    redis_client.setex(f"fetch:{task_id}", 3600, json.dumps({
        "status": "running", "page": 0, "total_pages": request.max_page, "fetched": 0,
    }))
    background_tasks.add_task(_run_fetch, task_id, session_id, request)
    return {"task_id": task_id, "session_id": session_id, "session_name": session_name}


@app.get("/jobs/fetch/status/{task_id}")
def fetch_status(task_id: str):
    data = redis_client.get(f"fetch:{task_id}")
    if not data:
        raise HTTPException(status_code=404, detail="Task not found")
    return json.loads(data)


@app.get("/jobs/sessions")
def list_sessions():
    """Returns all search sessions ordered by newest first."""
    from db import get_conn
    try:
        conn = get_conn()
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, name, status, job_count, created_at::text AS created_at
                FROM search_sessions
                ORDER BY created_at DESC
                LIMIT 50
            """)
            sessions = [dict(row) for row in cur.fetchall()]
    finally:
        conn.close()
    return {"sessions": sessions}


@app.post("/jobs/match")
def match_from_db(request: DbMatchRequest, client: Anthropic = Depends(get_client)):
    """Scores all un-scored jobs in the DB for this resume and stores results."""
    from db import get_conn
    resume_hash = hashlib.md5(request.resume_bullets.encode()).hexdigest()
    try:
        conn = get_conn()
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))

    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT j.id, j.description FROM jobs j
                JOIN session_jobs sj ON j.id = sj.job_id
                WHERE sj.session_id = %s
                AND NOT EXISTS (
                    SELECT 1 FROM job_scores s WHERE s.job_id = j.id AND s.resume_hash = %s
                )
            """, (request.session_id, resume_hash))
            unscored = cur.fetchall()

        def _score(row):
            try:
                msg = client.messages.create(
                    model="claude-haiku-4-5-20251001", max_tokens=5,
                    # Cache the system prompt — same across every call in this batch
                    system=[{
                        "type": "text",
                        "text": "Score resume-to-job match 0-100. Reply with ONLY the number.",
                        "cache_control": {"type": "ephemeral"},
                    }],
                    messages=[{"role": "user", "content": [
                        # Cache the resume — identical for every job in this match run.
                        # First call writes to cache; subsequent calls read at ~10% token cost.
                        {
                            "type": "text",
                            "text": f"Candidate Resume:\n{request.resume_bullets}",
                            "cache_control": {"type": "ephemeral"},
                        },
                        {
                            "type": "text",
                            "text": f"\nJob Description:\n{row['description']}\n\nScore 0-100, reply with ONLY the number.",
                        },
                    ]}],
                )
                return row["id"], int("".join(filter(str.isdigit, msg.content[0].text.strip())))
            except Exception:
                return row["id"], 0

        with ThreadPoolExecutor(max_workers=5) as executor:
            scored = list(executor.map(_score, unscored))

        with conn.cursor() as cur:
            for job_id, score in scored:
                cur.execute("""
                    INSERT INTO job_scores (job_id, resume_hash, score)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (job_id, resume_hash) DO UPDATE SET score = EXCLUDED.score
                """, (job_id, resume_hash, score))
        conn.commit()

        # Enrich high-scoring jobs with full description from Job Details API.
        # Scores are already committed so this step failing won't lose anything.
        high_scorers = [job_id for job_id, score in scored if score >= 65]
        if high_scorers and JSEARCH_API_KEY:
            with ThreadPoolExecutor(max_workers=3) as executor:
                futures = {executor.submit(_fetch_job_details, jid): jid for jid in high_scorers}
                enriched = [(futures[f], f.result()) for f in as_completed(futures)]
            with conn.cursor() as cur:
                for job_id, description in enriched:
                    if description:
                        cur.execute(
                            "UPDATE jobs SET description = %s WHERE id = %s",
                            (description, job_id),
                        )
            conn.commit()
    finally:
        conn.close()

    return {"scored": len(unscored), "resume_hash": resume_hash, "enriched": len(high_scorers)}


@app.get("/jobs/results")
def get_results(resume_hash: str, session_id: str, min_score: int = 0):
    """Returns scored jobs for a resume + session, ordered by score."""
    from db import get_conn
    try:
        conn = get_conn()
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))

    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT j.id, j.title, j.company, j.location, j.salary,
                       j.url, j.posted_at::text AS posted_at, j.description, s.score
                FROM jobs j
                JOIN job_scores s ON j.id = s.job_id
                JOIN session_jobs sj ON j.id = sj.job_id
                WHERE s.resume_hash = %s AND sj.session_id = %s AND s.score >= %s
                ORDER BY s.score DESC
            """, (resume_hash, session_id, min_score))
            jobs = [dict(row) for row in cur.fetchall()]
    finally:
        conn.close()

    return {"total": len(jobs), "jobs": jobs}


# ── Legacy endpoint (fetch + score in one blocking call) ────────────────────

@app.post("/jobs/recommendations")
def recommend_jobs(request: JobRecommendationRequest, client: Anthropic = Depends(get_client)):

    API_KEY = JSEARCH_API_KEY
    url = "https://jsearch.p.rapidapi.com/search"
    headers = {
        "X-RapidAPI-Key": API_KEY,
        "X-RapidAPI-Host": "jsearch.p.rapidapi.com"
    }

    jsearch_filter = JSEARCH_DATE_MAP[request.date_posted]
    cutoff = CUTOFF_MAP[request.date_posted]
    query = request.job_area

    all_jobs = []

    for page in range(1, request.max_page + 1):
        querystring = {
            "query": query,
            "num_pages": "1",
            "page": str(page),
            "date_posted": jsearch_filter
        }

        try:
            response = requests.get(url, headers=headers, params=querystring, timeout=10)
            response.raise_for_status()
            data = response.json()
        except requests.exceptions.RequestException as e:
            print(f"An error occurred while fetching jobs: {e}")
            raise HTTPException(status_code=502, detail=f"Error fetching job recommendations on Page {page}: {str(e)}")

        job_fetched = data.get("data", [])

        if not job_fetched:
            break

        for job in job_fetched:
            all_jobs.append({
                "id": job.get("job_id"),
                "title": job.get("job_title"),
                "company": job.get("employer_name"),
                "location": f"{job.get('job_city')}, {job.get('job_state')}",
                "salary": job.get("job_salary"),
                "matchScore": 0,
                "matchReason": "",
                "url": job.get("job_apply_link"),
                "postedAt": job.get("job_posted_at_datetime_utc"),
                "description": job.get("job_description"),
            })

    # Filter by date first, then only score what survives
    filtered_jobs = [j for j in all_jobs if is_within_cutoff(j["postedAt"], cutoff)]

    # Score concurrently
    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = [
            executor.submit(score_job, job, request.resume_bullets, client)
            for job in filtered_jobs
        ]
        scored_jobs = [f.result() for f in as_completed(futures)]

    scored_jobs.sort(key=lambda j: j["matchScore"], reverse=True)

    return {"total": len(scored_jobs), "jobs": scored_jobs}
