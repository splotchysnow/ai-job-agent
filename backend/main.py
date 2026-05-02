import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from pydantic import BaseModel # Pydantic used for data validation incoming JSON, reject request if missing job_description
from anthropic import Anthropic # Antropic

from dotenv import load_dotenv

import redis
import json
import hashlib

load_dotenv()

# redis_client = redis.Redis(host='redis', port=6379, db=0)
redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
redis_client = redis.from_url(redis_url)


first_name = os.getenv("USER_FIRST_NAME")
last_name = os.getenv("USER_LAST_NAME")

# Creates a Fast API object
app = FastAPI()

# Middleware preventing invalid access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "https://ai-job-agent-psi.vercel.app"], # Change this to the actual origin of frontend later
    allow_methods=["*"],
    allow_headers=["*"],
)

# Create a client object
client = Anthropic()

# Run with
# http://localhost:8000/health
# command: uvicorn main:app --reload

# Health check endpoint sanity check
@app.get("/health")
def health():
    return {"status": "ok"}

class TailorRequest(BaseModel):
    job_description: str
    resume_bullets: str

class DraftRequest(BaseModel):
    job_description: str
    tailored_bullets: str = None

# Posting endpoint for tailoring resume bullets based on job description # EDIT Adding cashing with Redis
@app.post("/tailor")
def tailor_resume(request: TailorRequest):
    cache_key = hashlib.md5((f"{request.job_description} + {request.resume_bullets}").encode()).hexdigest()
    cached = redis_client.get(cache_key)
    
    if cached:
        return {"tailored_bullets": json.loads(cached), "cached": True}
    
    message = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=1024,
        system="You are a resume coach. Given resume bullets and a job description, rewrite and select the most relevant bullets tailored to the job. Output 4-6 strong bullet points starting with action verbs. Output only the bullets, no preamble.",
        messages=[
            {
                "role": "user",
                "content": f"Job Description: {request.job_description}\n\nResume Bullets: {request.resume_bullets}\n\nTailor the resume bullets to better fit the job description."
            }
        ]
    )
    result = message.content[0].text
    redis_client.setex(cache_key, 3600, json.dumps(result)) # Cache for 1 hour
    return {"tailored_bullets": result, "cached": False}

@app.post("/draft")
def draft_email(request: DraftRequest):
    message = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=1024,
        system=f"You are a professional outreach writer. Write a concise, genuine cold outreach email for a software engineering job application. Sound human, not corporate. 2-3 short paragraphs max. No subject line. Sign off as {first_name} {last_name}.",
        messages=[
            {
                "role": "user",
                "content": f"Job description:\n{request.job_description}\n\nMy tailored resume highlights:\n{request.tailored_bullets}"
            }
        ]
    )
    return {"email": message.content[0].text}

