import asyncio
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from core.file_store import FileInfo, FileStore
from api.dependencies import get_scheduler, get_file_store, get_current_user_or_none
from api.routers.system import router as system_router, DEFAULT_MESH_THUMBNAIL_SVG
from api.routers.multiview import router as multiview_router


def test_file_info_attribute_and_dict_access():
    data = {
        "file_id": "test-123",
        "file_path": "/tmp/test.png",
        "file_name": "test.png",
        "file_type": "image",
        "custom_field": "custom_val"
    }
    info = FileInfo(data)
    assert info.file_id == "test-123"
    assert info.file_path == "/tmp/test.png"
    assert info.file_name == "test.png"
    assert info.file_type == "image"
    assert info["file_id"] == "test-123"
    assert info["file_path"] == "/tmp/test.png"
    assert info.get("custom_field") == "custom_val"
    assert "file_path" in info
    assert info.to_dict() == data


def test_file_store_get_file_returns_file_info():
    async def _test():
        mock_redis = MagicMock()
        mock_redis.get = AsyncMock(return_value='{"file_id": "img-abc", "file_path": "/storage/img.png", "file_name": "img.png", "file_type": "image"}')
        store = FileStore(redis_client=mock_redis)
        file_obj = await store.get_file("img-abc")
        assert file_obj is not None
        assert isinstance(file_obj, FileInfo)
        assert file_obj.file_path == "/storage/img.png"
        assert file_obj["file_id"] == "img-abc"

        # Non-existent file
        mock_redis.get = AsyncMock(return_value=None)
        assert await store.get_file("non-existent") is None

    asyncio.run(_test())


def test_thumbnail_download_falls_back_to_svg_placeholder_instead_of_404():
    app = FastAPI()
    app.include_router(system_router, prefix="/api/v1/system")

    fake_scheduler = MagicMock()
    # Job completed, but thumbnail was never rendered and does not exist on disk
    fake_scheduler.get_job_status.return_value = {
        "job_id": "test-job-no-thumb",
        "status": "completed",
        "result": {
            "mesh_path": "/tmp/non_existent_mesh.glb",
            "asset_root": "/tmp/non_existent_dir",
        },
        "inputs": {},
    }

    app.dependency_overrides[get_scheduler] = lambda: fake_scheduler
    app.dependency_overrides[get_current_user_or_none] = lambda: None
    client = TestClient(app)

    response = client.get("/api/v1/system/jobs/test-job-no-thumb/thumbnail")

    assert response.status_code == 200
    assert "image/svg+xml" in response.headers.get("content-type", "")
    assert "<svg" in response.text
    assert "3D ASSET" in response.text


def test_thumbnail_download_falls_back_to_input_image_if_present(tmp_path):
    app = FastAPI()
    app.include_router(system_router, prefix="/api/v1/system")

    # Create dummy reference image
    input_img = tmp_path / "reference.png"
    input_img.write_bytes(b"\x89PNG\r\n\x1a\nfake_image_bytes")

    fake_scheduler = MagicMock()
    fake_scheduler.get_job_status.return_value = {
        "job_id": "test-job-input-thumb",
        "status": "completed",
        "result": {
            "mesh_path": str(tmp_path / "model.glb"),
        },
        "inputs": {
            "image_path": str(input_img),
        },
    }

    app.dependency_overrides[get_scheduler] = lambda: fake_scheduler
    app.dependency_overrides[get_current_user_or_none] = lambda: None
    client = TestClient(app)

    response = client.get("/api/v1/system/jobs/test-job-input-thumb/thumbnail")

    assert response.status_code == 200
    assert response.content == b"\x89PNG\r\n\x1a\nfake_image_bytes"


def test_multiview_generate_resolves_image_file_id(tmp_path):
    app = FastAPI()
    app.include_router(multiview_router, prefix="/api/v1/multiview")

    ref_img = tmp_path / "uploaded.png"
    ref_img.write_bytes(b"\x89PNG\r\n\x1a\nreference_data")

    fake_file_store = MagicMock()
    fake_file_store.get_file = AsyncMock(return_value=FileInfo({
        "file_id": "file-1234",
        "file_path": str(ref_img),
        "file_name": "uploaded.png",
        "file_type": "image",
    }))

    fake_scheduler = MagicMock()
    fake_scheduler.get_available_models.return_value = {
        "image_to_multiview": ["zero123plus_v12_image_to_multiview"]
    }
    fake_scheduler.schedule_job = AsyncMock(return_value="job-mv-999")

    app.dependency_overrides[get_scheduler] = lambda: fake_scheduler
    app.dependency_overrides[get_file_store] = lambda: fake_file_store
    app.dependency_overrides[get_current_user_or_none] = lambda: None

    client = TestClient(app)

    with patch("api.routers.multiview.resolve_file_id_async", return_value=str(ref_img)):
        response = client.post(
            "/api/v1/multiview/generate",
            json={
                "image_file_id": "file-1234",
                "model_preference": "zero123plus_v12_image_to_multiview",
            }
        )

    assert response.status_code == 200
    data = response.json()
    assert data["job_id"] == "job-mv-999"
    assert data["status"] == "queued"
