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
    output_type: str = "email"
    company_research: str = None

class MatchRequest(BaseModel):
    job_description: str
    resume_bullets: str
    job_area: str

@app.post("/tailor")
def tailor_resume(request: TailorRequest, client: Anthropic = Depends(get_client)):
    cache_key = hashlib.md5(f"{request.job_description}+{request.resume_bullets}+{request.job_area}".encode()).hexdigest()
    cached = redis_client.get(cache_key)
    if cached:
        return {"tailored_bullets": json.loads(cached), "cached": True}

    message = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=1024,
        system=f"You are a resume coach specializing in {request.job_area}. Given resume bullets and a job description, rewrite and select the most relevant bullets tailored to the job. Output 4-6 strong bullet points starting with action verbs. Label each bullet with the company/experience it comes from in brackets before the bullet, like [SOL Automatic]. Output only the bullets, no preamble.",
        messages=[{"role": "user", "content": f"Job Description: {request.job_description}\n\nResume Bullets: {request.resume_bullets}\n\nTailor the resume bullets to better fit the job description."}]
    )
    result = message.content[0].text
    redis_client.setex(cache_key, 3600, json.dumps(result))
    return {"tailored_bullets": result, "cached": False}

@app.post("/draft")
def draft_email(request: DraftRequest, client: Anthropic = Depends(get_client)):
    if request.output_type == "cover_letter":
        system = f"You are a professional cover letter writer. Write a formal, well-structured cover letter for a {request.job_area} job application. Include an opening paragraph, 2-3 body paragraphs highlighting relevant experience, and a closing paragraph. Plain text only, no markdown. Sign off as {request.first_name} {request.last_name}."
    else:
        system = f"You are a professional outreach writer. Write a concise, genuine cold outreach email for a {request.job_area} job application. Sound human, not corporate. 2-3 short paragraphs max. No subject line. No markdown formatting — plain text only. Sign off as {request.first_name} {request.last_name}."

    content = f"Job description:\n{request.job_description}\n\nMy tailored resume highlights:\n{request.tailored_bullets}"
    if request.company_research:
        content += f"\n\nCompany research (use this to personalise the message):\n{request.company_research}"

    message = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=1024,
        system=system,
        messages=[{"role": "user", "content": content}]
    )
    return {"email": message.content[0].text}

@app.post("/extract-job-info")
def extract_job_info(request: ExtractJobInfoRequest, client: Anthropic = Depends(get_client)):
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
    return {"job_title": job_title, "company_name": company_name}

class ResearchRequest(BaseModel):
    company_name: str
    job_area: str = None

@app.post("/research")
def research_company(request: ResearchRequest, client: Anthropic = Depends(get_client)):
    messages = [{
        "role": "user",
        "content": f"Research the company '{request.company_name}'. Summarize: what they do, their products/services, company size and stage, culture/values, and any recent notable news or initiatives. Keep it to 150-200 words."
    }]

    for _ in range(8):
        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=1024,
            system="You are a company research assistant. Write in plain prose only — no markdown, no headers, no bold, no bullet points. Just clean paragraphs.",
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
                .replace('* ', '')
                .strip())
            return {"summary": text}
        messages.append({"role": "assistant", "content": response.content})
        tool_results = [
            {"type": "tool_result", "tool_use_id": block.id, "content": ""}
            for block in response.content
            if block.type == "tool_use"
        ]
        if tool_results:
            messages.append({"role": "user", "content": tool_results})

    return {"summary": "Unable to research this company at this time."}

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

@app.post("/match")
def match_jobs(request: MatchRequest, client: Anthropic = Depends(get_client)):
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
    return {"score": score, "reason": reason}
