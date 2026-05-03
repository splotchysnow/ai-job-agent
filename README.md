# AI Job Application Agent

Paste a job description, drop in your resume, and get a match score, tailored bullets, and a personalized outreach email or cover letter in seconds. Optional company research pulls live info about the company and weaves it into the output naturally.

## Stack

| Layer | Tech |
|---|---|
| Frontend | Next.js, TypeScript, Tailwind CSS |
| Backend | FastAPI, Python |
| AI | Claude (Anthropic) |
| Cache | Redis |
| Infra | Docker, Docker Compose |
| Hosting | Vercel (frontend), Railway (backend + Redis) |

## Features

- **Match score** — rates how well your resume fits the job (0-100) with a plain-English explanation of what fits and what's missing
- **Tailored bullets** — rewrites your master resume bullets to best match the job; never invents facts not in your original resume
- **Email or cover letter** — generates a concise cold outreach email or a formal cover letter, your choice
- **Company research** — live web search summary of what the company does, woven naturally into the output
- **Auto-extract job info** — detects the job title and company name from the pasted description automatically (can be toggled off to save API cost)
- **Resume import** — upload a PDF or DOCX and the text lands straight into the resume field
- **Bring your own API key** — paste your own Anthropic key to use your own quota; falls back to the shared key if left blank
- **Job history** — every run is saved in the browser with the score, output, tailored bullets, company research, and the full job description
- **Redis caching** — match scores, tailored bullets, job info extraction, and company research are all cached to avoid redundant API calls
- **Rate limiting** — 50 requests per IP per hour

## Local Development

### Prerequisites

- Docker Desktop
- Node.js 18+
- Python 3.11+
- Anthropic API key

### Setup

1. Clone the repo
   ```bash
   git clone https://github.com/splotchysnow/ai-job-agent
   cd ai-job-agent
   ```

2. Configure the backend
   ```bash
   cd backend
   cp .env.example .env
   # Fill in ANTHROPIC_API_KEY in .env
   ```

3. Start the backend and Redis
   ```bash
   cd ..
   docker compose up --build
   ```

4. Start the frontend
   ```bash
   cd frontend
   npm install
   npm run dev
   ```

5. Open [http://localhost:3000](http://localhost:3000)

### Backend without Docker

```bash
cd backend
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload
```

> Redis is required for caching and rate limiting. You can run it locally with `docker run -p 6379:6379 redis`.

## API Endpoints

| Method | Endpoint | Description | Cached |
|--------|----------|-------------|--------|
| GET | `/health` | Liveness check | - |
| POST | `/match` | Score resume fit against a job (0-100) | 1hr |
| POST | `/tailor` | Rewrite resume bullets to match the job | 1hr |
| POST | `/draft` | Generate outreach email or cover letter | - |
| POST | `/extract-job-info` | Extract job title and company from a job description | 24hr |
| POST | `/research` | Research a company via live web search | 24hr |
| POST | `/extract` | Extract plain text from a PDF or DOCX upload | - |

## Deployment

- **Frontend** — Vercel, auto-deploys on push to `main`
- **Backend** — Railway (`railway up`)
- **Redis** — Railway managed database

## Environment Variables

**`backend/.env`**
```
ANTHROPIC_API_KEY=your_key_here
REDIS_URL=your_redis_url
```
