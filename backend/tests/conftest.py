import os
os.environ.setdefault("ANTHROPIC_API_KEY", "test-key")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379")
os.environ.setdefault("JSEARCH_API_KEY", "test-jsearch-key")

from unittest.mock import MagicMock, patch

# Patch redis.from_url before main is imported so the module-level
# redis_client never tries to connect to a real Redis instance.
_redis_mock = MagicMock()
_redis_mock.incr.return_value = 1
_redis_mock.get.return_value = None
_redis_mock.setex.return_value = True
_redis_mock.expire.return_value = True

patch("redis.from_url", return_value=_redis_mock).start()

import pytest
from fastapi.testclient import TestClient
from main import app, get_client


_anthropic_mock = MagicMock()
app.dependency_overrides[get_client] = lambda: _anthropic_mock


@pytest.fixture(autouse=True)
def reset_mocks():
    """Reset both mocks to clean defaults before every test."""
    _redis_mock.reset_mock()
    _redis_mock.incr.return_value = 1
    _redis_mock.get.return_value = None
    _redis_mock.setex.return_value = True
    _redis_mock.expire.return_value = True
    _anthropic_mock.reset_mock()
    yield


@pytest.fixture(scope="session")
def client():
    return TestClient(app)
