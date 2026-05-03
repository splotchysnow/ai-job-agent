# AI Job Application Agent

An AI-powered job application assistant. Paste a job description, import your resume, and get a match score, tailored bullets, and a personalized outreach email or cover letter — with optional company research to make it feel genuine.

## Stack

- **Frontend** — Next.js, TypeScript, Tailwind CSS (deployed on Vercel)
- **Backend** — FastAPI, Python (deployed on Railway)
- **Cache** — Redis (Railway managed)
- **AI** — Claude API (Anthropic)
- **Infrastructure** — Docker, Docker Compose

## Features

- **Match score** — rates how well your resume fits the job (0–100%) with a plain-English explanation
- **Tailored bullets** — rewrites your master resume bullets to match the job description
- **Email or cover letter** — generates a personalized cold outreach email or formal cover letter
- **Company research** — looks up what the company does and weaves relevant details into the email/letter naturally
- **Auto-extract job info** — detects job title and company name from the pasted job description
- **Resume import** — upload a PDF or DOCX and it pulls the text straight into the resume field
- **Bring your own API key** — optionally use your own Anthropic key; falls back to the shared key
- **Job history** — every run is saved locally with the score, date, job title, company, and generated output
- **Redis caching** on the tailor endpoint to avoid redundant API calls
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

2. Set up backend environment
   ```bash
   cd backend
   cp .env.example .env
   # Add your ANTHROPIC_API_KEY to .env
   ```

3. Run with Docker Compose
   ```bash
   cd ..
   docker compose up --build
   ```

4. Run frontend
   ```bash
   cd frontend
   npm install
   npm run dev
   ```

5. Open `http://localhost:3000`

### Backend only (without Docker)
```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| POST | `/tailor` | Tailor resume bullets to a job description (Redis cached) |
| POST | `/draft` | Generate outreach email or cover letter |
| POST | `/match` | Score resume fit against job (0–100) |
| POST | `/research` | Research a company via web search |
| POST | `/extract-job-info` | Extract job title and company name from a job description |
| POST | `/extract` | Extract plain text from a PDF or DOCX file |

## Deployment

- **Frontend** → Vercel (auto-deploys on push to main)
- **Backend** → Railway (deploy via `railway up`)
- **Redis** → Railway managed database

## Environment Variables

### Backend `.env`
```
ANTHROPIC_API_KEY=your_key_here
REDIS_URL=your_redis_url
```
