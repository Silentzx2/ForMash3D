"""
Endpoint contract tests for POST /mesh-generation/refine-mesh (Hi3D refinement).

No GPU / model inference is exercised: the scheduler is mocked and the endpoint
function is called directly via asyncio.run (matching the pattern in
test_backend_runtime_contracts.py). These tests only validate input validation,
mesh archival (_legacy.glb), and job enqueue inputs.
"""
import asyncio
from pathlib import Path
from typing import Any, cast

import pytest
from fastapi import HTTPException

from api.routers.mesh_generation import RefineMeshRequest, refine_mesh
from core.scheduler.multiprocess_scheduler import MultiprocessModelScheduler


class FakeScheduler:
    """Minimal scheduler double capturing the enqueued JobRequest."""

    def __init__(self):
        self.captured: Any = None

    async def get_job_status(self, job_id: str):
        if job_id == "missing-job":
            return None
        return {"status": "queued"}

    async def schedule_job(self, job_request):
        self.captured = job_request
        return "refine-job-123"


def _make_request(tmp_path, mesh_name="coarse.glb", **overrides):
    mesh_path = tmp_path / mesh_name
    mesh_path.write_bytes(b"fake mesh bytes")
    return RefineMeshRequest(
        job_id="job-1",
        mesh_path=str(mesh_path),
        image_path="/tmp/ref.png",
        resolution=1024,
        **overrides,
    )


def test_refine_mesh_archives_mesh_and_enqueues(tmp_path):
    scheduler = FakeScheduler()
    request = _make_request(tmp_path)

    result = asyncio.run(refine_mesh(request, cast(MultiprocessModelScheduler, scheduler)))

    assert result == {"refinement_job_id": "refine-job-123", "status": "submitted"}

    # Original mesh archived to <mesh_path>_legacy.glb
    legacy_path = tmp_path / "coarse.glb_legacy.glb"
    assert legacy_path.is_file()
    assert legacy_path.read_bytes() == b"fake mesh bytes"

    # Job enqueued with refinement inputs
    assert scheduler.captured is not None
    assert scheduler.captured.feature == "image_to_raw_mesh"
    assert scheduler.captured.model_preference == "hi3d_image_to_raw_mesh"
    assert scheduler.captured.inputs["coarse_mesh_path"] == str(legacy_path)
    assert scheduler.captured.inputs["reference_image_path"] == "/tmp/ref.png"
    assert scheduler.captured.inputs["resolution"] == 1024
    assert scheduler.captured.metadata["feature_type"] == "refine_mesh"
    assert scheduler.captured.metadata["source_job_id"] == "job-1"


def test_refine_mesh_job_not_found_returns_404(tmp_path):
    scheduler = FakeScheduler()
    request = RefineMeshRequest(job_id="missing-job", mesh_path="/tmp/coarse.glb")

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(refine_mesh(request, cast(MultiprocessModelScheduler, scheduler)))

    assert exc_info.value.status_code == 404


def test_refine_mesh_mesh_not_found_returns_400(tmp_path):
    scheduler = FakeScheduler()
    request = RefineMeshRequest(
        job_id="job-1", mesh_path="/tmp/does-not-exist.glb"
    )

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(refine_mesh(request, cast(MultiprocessModelScheduler, scheduler)))

    assert exc_info.value.status_code == 400


def test_refine_mesh_defaults_resolution_to_1024(tmp_path):
    scheduler = FakeScheduler()
    mesh_path = tmp_path / "coarse.glb"
    mesh_path.write_bytes(b"fake mesh bytes")
    request = RefineMeshRequest(
        job_id="job-1", mesh_path=str(mesh_path), image_path=None
    )

    asyncio.run(refine_mesh(request, cast(MultiprocessModelScheduler, scheduler)))

    assert scheduler.captured.inputs["resolution"] == 1024


def test_refine_mesh_request_rejects_invalid_resolution():
    with pytest.raises(Exception):
        RefineMeshRequest(
            job_id="job-1",
            mesh_path="/tmp/coarse.glb",
            resolution=999,
        )
