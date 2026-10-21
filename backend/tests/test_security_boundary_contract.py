"""Security and API-rate-limit contracts for both backend deployment modes."""
import asyncio
import sys
import types
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

# Import the dependency module without triggering the package's full runtime bootstrap.
_original_api = sys.modules.get("api")
_original_api_dependencies = sys.modules.get("api.dependencies")
_original_scheduler = sys.modules.get("core.scheduler")
_original_job_queue = sys.modules.get("core.scheduler.job_queue")

api_package = types.ModuleType("api")
api_package.__path__ = [str(BACKEND_ROOT / "api")]
sys.modules.setdefault("api", api_package)

# Avoid importing the database-backed queue just to exercise the dependency helpers.
scheduler_package = types.ModuleType("core.scheduler")
scheduler_package.__path__ = [str(BACKEND_ROOT / "core" / "scheduler")]
sys.modules.setdefault("core.scheduler", scheduler_package)
job_queue = types.ModuleType("core.scheduler.job_queue")
class JobRequest:
    def __init__(self, **values):
        self.__dict__.update(values)
job_queue.JobRequest = JobRequest
sys.modules.setdefault("core.scheduler.job_queue", job_queue)

from api import dependencies

# Do not let these lightweight import shims leak into other tests in this pytest process.
if _original_job_queue is None:
    sys.modules.pop("core.scheduler.job_queue", None)
else:
    sys.modules["core.scheduler.job_queue"] = _original_job_queue
if _original_scheduler is None:
    sys.modules.pop("core.scheduler", None)
else:
    sys.modules["core.scheduler"] = _original_scheduler
if _original_api_dependencies is None:
    sys.modules.pop("api.dependencies", None)
else:
    sys.modules["api.dependencies"] = _original_api_dependencies
if _original_api is None:
    sys.modules.pop("api", None)
else:
    sys.modules["api"] = _original_api


class FakeRequest:
    def __init__(self, app, ip="192.0.2.10", path="/api/v1/test"):
        self.app = app
        self.client = SimpleNamespace(host=ip)
        self.url = SimpleNamespace(path=path)
        self.state = SimpleNamespace()


def settings(*, required=True, api_key="configured-test-key", user_auth=False, rate=60):
    return SimpleNamespace(
        security=SimpleNamespace(
            api_key_required=required,
            api_key=api_key,
            rate_limit_per_minute=rate,
        ),
        user_auth_enabled=user_auth,
    )


def test_server_api_key_is_compared_and_arbitrary_bearer_is_rejected():
    async def scenario():
        config = settings()
        request = FakeRequest(SimpleNamespace(state=SimpleNamespace()))
        assert await dependencies.verify_api_key(
            authorization="Bearer configured-test-key", request=request, settings=config
        ) is True

        with pytest.raises(HTTPException) as error:
            await dependencies.verify_api_key(
                authorization="Bearer arbitrary-token", request=request, settings=config
            )
        assert error.value.status_code == 401
    asyncio.run(scenario())


def test_user_bearer_token_uses_existing_auth_service(monkeypatch):
    async def scenario():
        config = settings(api_key=None, user_auth=True)
        request = FakeRequest(SimpleNamespace(state=SimpleNamespace()))
        user = SimpleNamespace(user_id="user-test")

        class AuthService:
            async def validate_token(self, token):
                return (user, None) if token == "valid-stored-token" else (None, "invalid")

        async def get_auth_service(_request):
            return AuthService()

        monkeypatch.setattr(dependencies, "get_auth_service", get_auth_service)
        assert await dependencies.verify_api_key(
            authorization="Bearer valid-stored-token", request=request, settings=config
        ) is True
        assert request.state.authenticated_user is user

        with pytest.raises(HTTPException) as error:
            await dependencies.verify_api_key(
                authorization="Bearer invalid-stored-token", request=request, settings=config
            )
        assert error.value.status_code == 401
    asyncio.run(scenario())


def test_required_api_key_without_configured_credential_fails_closed():
    async def scenario():
        config = settings(required=True, api_key=None, user_auth=False)
        request = FakeRequest(SimpleNamespace(state=SimpleNamespace()))
        with pytest.raises(HTTPException) as error:
            await dependencies.verify_api_key(
                authorization="Bearer anything", request=request, settings=config
            )
        assert error.value.status_code == 503
    asyncio.run(scenario())


def test_rate_limit_enforced_in_single_worker_mode():
    async def scenario():
        app = SimpleNamespace(state=SimpleNamespace())
        config = settings(required=False, api_key=None, rate=2)
        for _ in range(2):
            assert await dependencies.check_rate_limit(
                request=FakeRequest(app, ip="192.0.2.20"), settings=config
            ) is True

        with pytest.raises(HTTPException) as error:
            await dependencies.check_rate_limit(
                request=FakeRequest(app, ip="192.0.2.20"), settings=config
            )
        assert error.value.status_code == 429
        assert error.value.headers["Retry-After"]
    asyncio.run(scenario())


def test_rate_limit_uses_shared_atomic_redis_counter_across_workers():
    async def scenario():
        class FakeRedis:
            def __init__(self):
                self.counts = {}

            async def eval(self, script, key_count, key, ttl):
                assert key_count == 1
                assert "INCR" in script and "EXPIRE" in script
                self.counts[key] = self.counts.get(key, 0) + 1
                return self.counts[key]

        redis = FakeRedis()
        app_a = SimpleNamespace(state=SimpleNamespace(job_queue=SimpleNamespace(redis=redis)))
        app_b = SimpleNamespace(state=SimpleNamespace(job_queue=SimpleNamespace(redis=redis)))
        config = settings(required=False, api_key=None, rate=2)

        assert await dependencies.check_rate_limit(
            request=FakeRequest(app_a, ip="192.0.2.30"), settings=config
        ) is True
        assert await dependencies.check_rate_limit(
            request=FakeRequest(app_b, ip="192.0.2.30"), settings=config
        ) is True
        with pytest.raises(HTTPException) as error:
            await dependencies.check_rate_limit(
                request=FakeRequest(app_b, ip="192.0.2.30"), settings=config
            )
        assert error.value.status_code == 429
    asyncio.run(scenario())


def test_rate_limit_middleware_returns_429_for_api_route():
    async def scenario():
        app = SimpleNamespace(state=SimpleNamespace())
        config = settings(required=False, api_key=None, rate=1)

        first = await dependencies.apply_rate_limit(
            FakeRequest(app, ip="192.0.2.40"), config
        )
        assert first is None
        second = await dependencies.apply_rate_limit(
            FakeRequest(app, ip="192.0.2.40"), config
        )
        assert second is not None
        assert second.status_code == 429
        assert second.headers["Retry-After"]
    asyncio.run(scenario())
