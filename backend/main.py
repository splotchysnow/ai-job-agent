import os
import io
import json
import hashlib

from fastapi import FastAPI, Request, HTTPException, Header, Depends, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from anthropic import Anthropic
from dotenv import load_dotenv
import redis

load_dotenv()

redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
redis_client = redis.from_url(redis_url)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def rate_limit(request: Request, call_next):
    ip = request.client.host
    key = f"rate:{ip}"
    count = redis_client.incr(key)
    if count == 1:
        redis_client.expire(key, 3600)
    if count > 50:
        raise HTTPException(status_code=429, detail="Too many requests")
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
        system=f"You are a resume coach specializing in {request.job_area}. Given resume bullets and a job description, rewrite and select the most relevant bullets tailored to the job. Output 4-6 strong bullet points starting with action verbs. Label each bullet with the company/experience it comes from in brackets before the bullet, like [SOL Automatic]. Output only the bullets, no preamble. CRITICAL: Only rewrite bullets from the provided resume. Never invent new achievements, metrics, technologies, or experiences not present in the original bullets.",
        messages=[{"role": "user", "content": f"Job Description: {request.job_description}\n\nResume Bullets: {request.resume_bullets}\n\nTailor the resume bullets to better fit the job description."}]
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
        system="Extract the work experience bullet points from this resume. For each role, write the company name and job title as a label in brackets (e.g. [NewBeeDrone — Full Stack Engineer]), then list the bullet points underneath. Keep all specific achievements, metrics, and technical details. Skip contact information, summary, education, and skills sections. Output only the formatted bullets, no preamble.",
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
            max_tokens=1024,
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
        max_tokens=512,
        system="You are a hiring manager. Given a job description and a candidate's resume bullets, score how well the candidate matches the job from 0-100. Be honest and critical. Respond in this exact format:\nSCORE: [number]\nREASON: [2-3 sentences explaining the score, what fits well and what's missing]",
        messages=[{"role": "user", "content": f"Job Description:\n{request.job_description}\n\nCandidate Resume:\n{request.resume_bullets}"}]
    )
    text = message.content[0].text
    score_line = [l for l in text.split('\n') if l.startswith('SCORE:')][0]
    reason_line = [l for l in text.split('\n') if l.startswith('REASON:')][0]
    score = int(''.join(filter(str.isdigit, score_line)))
    reason = reason_line.replace('REASON:', '').strip()
    result = {"score": score, "reason": reason}
    redis_client.setex(cache_key, 3600, json.dumps(result))
    return result
