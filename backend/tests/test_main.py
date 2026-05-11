import json
from unittest.mock import MagicMock, patch

from tests.conftest import _redis_mock, _anthropic_mock


def _msg(text: str):
    """Build a minimal mock Anthropic message response."""
    m = MagicMock()
    m.content = [MagicMock(text=text)]
    return m


# ── Health ───────────────────────────────────────────────────────────────────

def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


# ── Rate limiting ─────────────────────────────────────────────────────────────

def test_rate_limit_blocks_at_51(client):
    _redis_mock.incr.return_value = 51
    r = client.get("/health")
    assert r.status_code == 429


# ── /match ────────────────────────────────────────────────────────────────────

def test_match_returns_cached(client):
    _redis_mock.get.return_value = json.dumps({"score": 85, "reason": "Strong fit"}).encode()
    r = client.post("/match", json={
        "job_description": "Backend engineer", "resume_bullets": "Built APIs", "job_area": "SWE",
    })
    assert r.status_code == 200
    assert r.json()["score"] == 85
    assert r.json()["reason"] == "Strong fit"


def test_match_parses_llm_response(client):
    _redis_mock.get.return_value = None
    _anthropic_mock.messages.create.return_value = _msg("SCORE: 72\nREASON: Good technical fit but missing k8s.")
    r = client.post("/match", json={
        "job_description": "Backend engineer", "resume_bullets": "Built APIs", "job_area": "SWE",
    })
    assert r.status_code == 200
    assert r.json()["score"] == 72
    assert "fit" in r.json()["reason"].lower()


# ── /match/score ──────────────────────────────────────────────────────────────

def test_quick_match_score(client):
    _redis_mock.get.return_value = None
    _anthropic_mock.messages.create.return_value = _msg("88")
    r = client.post("/match/score", json={
        "job_description": "Full stack role", "resume_bullets": "Built Next.js apps",
    })
    assert r.status_code == 200
    assert r.json()["score"] == 88


def test_quick_match_score_cached(client):
    _redis_mock.get.return_value = json.dumps({"score": 55}).encode()
    r = client.post("/match/score", json={
        "job_description": "Full stack role", "resume_bullets": "Built Next.js apps",
    })
    assert r.status_code == 200
    assert r.json()["score"] == 55


# ── /tailor ───────────────────────────────────────────────────────────────────

def test_tailor_cache_hit(client):
    _redis_mock.get.return_value = json.dumps("• Built scalable APIs").encode()
    r = client.post("/tailor", json={
        "job_description": "Backend role", "resume_bullets": "Built APIs", "job_area": "SWE",
    })
    assert r.status_code == 200
    assert r.json()["cached"] is True


def test_tailor_cache_miss(client):
    _redis_mock.get.return_value = None
    _anthropic_mock.messages.create.return_value = _msg("• Built scalable APIs\n• Deployed microservices")
    r = client.post("/tailor", json={
        "job_description": "Backend role", "resume_bullets": "Built APIs", "job_area": "SWE",
    })
    assert r.status_code == 200
    assert r.json()["cached"] is False
    assert "Built" in r.json()["tailored_bullets"]


# ── /extract-job-info ─────────────────────────────────────────────────────────

def test_extract_job_info_parses_response(client):
    _redis_mock.get.return_value = None
    _anthropic_mock.messages.create.return_value = _msg("JOB_TITLE: Senior Engineer\nCOMPANY: Acme Corp")
    r = client.post("/extract-job-info", json={"job_description": "Senior Engineer at Acme Corp..."})
    assert r.status_code == 200
    assert r.json()["job_title"] == "Senior Engineer"
    assert r.json()["company_name"] == "Acme Corp"


def test_extract_job_info_handles_null(client):
    _redis_mock.get.return_value = None
    _anthropic_mock.messages.create.return_value = _msg("JOB_TITLE: null\nCOMPANY: null")
    r = client.post("/extract-job-info", json={"job_description": "Unknown posting"})
    assert r.status_code == 200
    assert r.json()["job_title"] is None
    assert r.json()["company_name"] is None


# ── /jobs/fetch/status ────────────────────────────────────────────────────────

def test_fetch_status_not_found(client):
    _redis_mock.get.return_value = None
    r = client.get("/jobs/fetch/status/nonexistent")
    assert r.status_code == 404


def test_fetch_status_running(client):
    payload = {"status": "running", "page": 3, "total_pages": 10, "fetched": 30}
    _redis_mock.get.return_value = json.dumps(payload).encode()
    r = client.get("/jobs/fetch/status/abc123")
    assert r.status_code == 200
    assert r.json()["status"] == "running"
    assert r.json()["fetched"] == 30


def test_fetch_status_done(client):
    payload = {"status": "done", "page": 10, "total_pages": 10, "fetched": 87}
    _redis_mock.get.return_value = json.dumps(payload).encode()
    r = client.get("/jobs/fetch/status/abc123")
    assert r.status_code == 200
    assert r.json()["status"] == "done"


# ── /jobs/fetch (start) ───────────────────────────────────────────────────────

def test_start_fetch_returns_task_id(client):
    r = client.post("/jobs/fetch", json={"job_area": "Software Engineering"})
    assert r.status_code == 200
    assert "task_id" in r.json()
    assert len(r.json()["task_id"]) == 8
    assert "session_id" in r.json()
    assert "session_name" in r.json()


# ── /jobs/results ─────────────────────────────────────────────────────────────

def test_get_results_no_db(client):
    """Returns 503 when DATABASE_URL is not set."""
    with patch("db.get_conn", side_effect=RuntimeError("DATABASE_URL is not configured")):
        r = client.get("/jobs/results?resume_hash=abc&session_id=sess1&min_score=0")
    assert r.status_code == 503


def test_get_results_returns_jobs(client):
    mock_conn = MagicMock()
    mock_cursor = MagicMock()
    mock_conn.cursor.return_value.__enter__ = MagicMock(return_value=mock_cursor)
    mock_conn.cursor.return_value.__exit__ = MagicMock(return_value=False)
    mock_cursor.fetchall.return_value = [
        {"id": "j1", "title": "SWE", "company": "Acme", "location": "SF, CA",
         "salary": None, "url": "https://example.com", "posted_at": "2025-01-01",
         "description": "Build stuff", "score": 85},
    ]

    with patch("db.get_conn", return_value=mock_conn):
        r = client.get("/jobs/results?resume_hash=abc123&session_id=sess1&min_score=0")

    assert r.status_code == 200
    assert r.json()["total"] == 1
    assert r.json()["jobs"][0]["score"] == 85
