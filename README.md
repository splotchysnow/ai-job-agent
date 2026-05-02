# AI Job Application Agent

An AI-powered job application assistant that takes a job description and your resume, then generates tailored resume bullets, a personalized outreach email, and a match score instantly.

## Stack

- **Frontend** — Next.js, TypeScript, Tailwind CSS (deployed on Vercel)
- **Backend** — FastAPI, Python (deployed on Railway)
- **Cache** — Redis (Railway managed)
- **AI** — Claude API (Anthropic)
- **Infrastructure** — Docker, Docker Compose

## Features

- Paste a job description and get tailored resume bullets in seconds
- Generates a personalized cold outreach email
- Match score (0-100%) showing how well your resume fits the job
- Job area selector (Software Engineering, Product, Design, Data Science, etc.)
- Name and resume bullets persist via localStorage
- Redis caching on tailor endpoint to avoid redundant API calls
- Fully deployed — frontend on Vercel, backend on Railway

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
| POST | `/tailor` | Tailor resume bullets to job description |
| POST | `/draft` | Generate personalized outreach email |
| POST | `/match` | Score resume match against job (0-100) |

## Deployment

- **Frontend** → Vercel (auto-deploys on push to main)
- **Backend** → Railway (deploy via `railway up`)
- **Redis** → Railway managed database

## Environment Variables

### Backend `.env`
```
ANTHROPIC_API_KEY=your_key_here
USER_FIRST_NAME=Guan
USER_LAST_NAME=Li
REDIS_URL=your_redis_url
```
