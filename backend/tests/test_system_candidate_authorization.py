import asyncio
import sys
from types import ModuleType, SimpleNamespace

import pytest
from fastapi import HTTPException
from starlette.requests import Request

import api.dependencies as dependencies
from api.routers import system
from core.auth.models import UserRole


class _AuthService:
    def __init__(self):
        self.users = {
            "owner-token": SimpleNamespace(user_id="owner", role=UserRole.USER),
            "other-token": SimpleNamespace(user_id="other", role=UserRole.USER),
            "admin-token": SimpleNamespace(user_id="admin", role=UserRole.ADMIN),
        }

    async def validate_token(self, token):
        user = self.users.get(token)
        return user, None if user else "Invalid or expired token"


class _JobQueue:
    def __init__(self):
        self.updated_result = None

    async def update_job_result(self, job_id, result):
        self.updated_result = result

    async def get_jobs_by_status(self, status):
        return []


class _Scheduler:
    def __init__(self, job_status):
        self.job_status = job_status
        self.job_queue = _JobQueue()

    async def get_job_status(self, job_id):
        return self.job_status if job_id == "job-1" else None


def _request(monkeypatch, tmp_path, auth_enabled, authorization=None):
    mesh_path = tmp_path / "candidate.glb"
    mesh_path.write_bytes(b"candidate-mesh")
    other_mesh_path = tmp_path / "other-candidate.glb"
    other_mesh_path.write_bytes(b"other-mesh")
    thumbnail_path = tmp_path / "candidate.png"
    thumbnail_path.write_bytes(b"thumbnail")
    job_status = {
        "job_id": "job-1",
        "user_id": "owner",
        "status": "completed",
        "inputs": {},
        "result": {
            "candidates": [
                {
                    "candidate_id": 1,
                    "mesh_path": str(mesh_path),
                    "thumbnail_path": str(thumbnail_path),
                },
                {
                    "candidate_id": 2,
                    "mesh_path": str(other_mesh_path),
                },
            ]
        },
    }
    scheduler = _Scheduler(job_status)
    auth_service = _AuthService()
    app = SimpleNamespace(
        state=SimpleNamespace(scheduler=scheduler, auth_service=auth_service)
    )
    headers = (
        [(b"authorization", authorization.encode("latin-1"))]
        if authorization is not None
        else []
    )
    request = Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/",
            "headers": headers,
            "query_string": b"",
            "app": app,
        }
    )
    monkeypatch.setattr(
        dependencies, "get_settings", lambda: SimpleNamespace(user_auth_enabled=auth_enabled)
    )
    return request, scheduler, job_status, mesh_path, thumbnail_path


async def _call_candidate_operation(operation, request):
    endpoint = {
        "download": system.download_candidate_mesh,
        "thumbnail": system.download_candidate_thumbnail,
        "select": system.select_candidate_mesh,
    }[operation]
    return await endpoint("job-1", 1, request)


def _use_asset_workspace(monkeypatch, asset_root):
    pipeline_module = ModuleType("postprocess.pipeline")
    pipeline_module.canonical_asset_workspace = lambda *_args: asset_root
    monkeypatch.setitem(sys.modules, "postprocess.pipeline", pipeline_module)


@pytest.mark.parametrize("operation", ["download", "thumbnail", "select"])
@pytest.mark.parametrize("authorization", [None, "Bearer invalid-token"])
def test_candidate_endpoints_reject_missing_or_invalid_auth_in_auth_mode(
    monkeypatch, tmp_path, operation, authorization
):
    request, *_ = _request(monkeypatch, tmp_path, True, authorization)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(_call_candidate_operation(operation, request))

    assert exc_info.value.status_code == 401


@pytest.mark.parametrize("authorization", [None, "Bearer invalid-token"])
def test_job_history_preserves_missing_or_invalid_auth_status(
    monkeypatch, tmp_path, authorization
):
    request, scheduler, *_ = _request(monkeypatch, tmp_path, True, authorization)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(system.get_jobs_history(scheduler=scheduler, request=request))

    assert exc_info.value.status_code == 401


@pytest.mark.parametrize("endpoint_name", ["status", "download"])
@pytest.mark.parametrize("authorization", [None, "Bearer invalid-token"])
def test_job_status_and_download_reject_missing_or_invalid_auth(
    monkeypatch, tmp_path, endpoint_name, authorization
):
    request, *_ = _request(monkeypatch, tmp_path, True, authorization)
    endpoint = {
        "status": system.get_job_status,
        "download": system.download_job_result,
    }[endpoint_name]

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(endpoint("job-1", request))

    assert exc_info.value.status_code == 401


@pytest.mark.parametrize("operation", ["download", "thumbnail", "select"])
def test_candidate_endpoints_reject_cross_owner_access(
    monkeypatch, tmp_path, operation
):
    request, _, job_status, mesh_path, _ = _request(
        monkeypatch, tmp_path, True, "Bearer other-token"
    )
    asset_root = tmp_path / "asset"
    _use_asset_workspace(monkeypatch, asset_root)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(_call_candidate_operation(operation, request))

    assert exc_info.value.status_code == 403
    assert not job_status["result"]["candidates"][0].get("selected", False)
    assert not (asset_root / "master" / "source.glb").exists()
    assert mesh_path.is_file()


@pytest.mark.parametrize(
    ("authorization", "operation"),
    [
        ("Bearer owner-token", "download"),
        ("Bearer owner-token", "thumbnail"),
        ("Bearer admin-token", "download"),
        ("Bearer admin-token", "thumbnail"),
    ],
)
def test_candidate_download_and_thumbnail_allow_owner_and_admin(
    monkeypatch, tmp_path, authorization, operation
):
    request, _, _, mesh_path, thumbnail_path = _request(
        monkeypatch, tmp_path, True, authorization
    )

    response = asyncio.run(_call_candidate_operation(operation, request))

    assert response.path == str(mesh_path if operation == "download" else thumbnail_path)


@pytest.mark.parametrize("authorization", ["Bearer owner-token", "Bearer admin-token"])
def test_candidate_selection_allows_owner_and_admin(
    monkeypatch, tmp_path, authorization
):
    request, scheduler, job_status, mesh_path, _ = _request(
        monkeypatch, tmp_path, True, authorization
    )
    asset_root = tmp_path / "asset"
    _use_asset_workspace(monkeypatch, asset_root)

    result = asyncio.run(_call_candidate_operation("select", request))

    master_source = asset_root / "master" / "source.glb"
    assert result["success"] is True
    assert master_source.read_bytes() == mesh_path.read_bytes()
    assert job_status["result"]["selected_candidate_id"] == 1
    assert scheduler.job_queue.updated_result is job_status["result"]


@pytest.mark.parametrize("operation", ["download", "thumbnail", "select"])
def test_candidate_endpoints_keep_simple_mode_access(monkeypatch, tmp_path, operation):
    request, _, _, _, _ = _request(monkeypatch, tmp_path, False)
    asset_root = tmp_path / "asset"
    _use_asset_workspace(monkeypatch, asset_root)

    response = asyncio.run(_call_candidate_operation(operation, request))

    if operation == "select":
        assert response["success"] is True
    else:
        assert response.path
