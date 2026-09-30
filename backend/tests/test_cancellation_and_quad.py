"""Unit tests verifying external cancellation dict safety, quad topology options, and quad export."""
import pytest
import trimesh
import numpy as np
from unittest.mock import AsyncMock, MagicMock

from core.scheduler.multiprocess_scheduler import _extract_job_status, MultiprocessModelScheduler
from core.scheduler.job_queue import JobRequest, JobStatus
from postprocess.pipeline import _export_quad_obj
from api.routers.mesh_generation import (
    TextToRawMeshRequest,
    TextToTexturedMeshRequest,
    ImageToRawMeshRequest,
    ImageToTexturedMeshRequest,
    BatchTextToTexturedMeshItem,
)


def test_extract_job_status_variants():
    """Verify _extract_job_status handles dicts, JobRequests, and None safely."""
    assert _extract_job_status(None) is None
    assert _extract_job_status({"status": "queued"}) == "queued"
    assert _extract_job_status({"status": "PROCESSING"}) == "processing"
    assert _extract_job_status({"status": "completed"}) == "completed"

    req = JobRequest(feature="image_to_raw_mesh", inputs={})
    req.status = JobStatus.QUEUED
    assert _extract_job_status(req) == "queued"
    req.status = JobStatus.PROCESSING
    assert _extract_job_status(req) == "processing"


import asyncio


def test_process_external_cancellations_with_dict():
    """Verify _process_external_cancellations does not crash when get_job returns a dict."""
    async def _run():
        scheduler = MultiprocessModelScheduler()
        orig_queue = scheduler.job_queue
        orig_running = scheduler.running
        scheduler.running = True

        mock_queue = MagicMock()
        mock_queue.get_cancel_requests = AsyncMock(return_value=["job-123", "job-456"])
        mock_queue.clear_cancel_request = AsyncMock()
        mock_queue.get_job = AsyncMock(side_effect=lambda jid: {
            "job_id": jid,
            "status": "queued" if jid == "job-123" else "processing",
            "inputs": {},
        })
        mock_queue.cancel_job = AsyncMock(return_value=True)

        try:
            scheduler.job_queue = mock_queue
            await scheduler._process_external_cancellations()

            mock_queue.cancel_job.assert_called_once_with("job-123")
            assert mock_queue.clear_cancel_request.call_count == 2
        finally:
            scheduler.job_queue = orig_queue
            scheduler.running = orig_running

    asyncio.run(_run())


def test_mesh_generation_requests_accept_quad_topology():
    """Verify request models accept topology_mode and quad_topology."""
    t_req = TextToRawMeshRequest(
        text_prompt="a cute low-poly robot",
        model_preference="trellis_text_to_textured_mesh",
        topology_mode="quad",
        quad_topology=True,
    )
    assert t_req.topology_mode == "quad"
    assert t_req.quad_topology is True

    img_req = ImageToRawMeshRequest(
        image_path="/tmp/test.png",
        model_preference="hunyuan3d_shape_v21_image_to_raw_mesh",
        topology_mode="quad",
        quad_topology=True,
    )
    assert img_req.topology_mode == "quad"
    assert img_req.quad_topology is True

    batch_item = BatchTextToTexturedMeshItem(
        text_prompt="sword",
        topology_mode="quad",
        quad_topology=True,
    )
    assert batch_item.topology_mode == "quad"
    assert batch_item.quad_topology is True


def test_export_quad_obj_produces_quad_polygons():
    """Verify _export_quad_obj generates proper 4-vertex quad face lines in OBJ format."""
    # Create simple 4-vertex quad planar mesh
    vertices = np.array([
        [0.0, 0.0, 0.0],
        [1.0, 0.0, 0.0],
        [1.0, 1.0, 0.0],
        [0.0, 1.0, 0.0],
    ])
    # triangulated trimesh
    faces = np.array([
        [0, 1, 2],
        [0, 2, 3],
    ])
    mesh = trimesh.Trimesh(vertices=vertices, faces=faces, process=False)
    mesh.fix_normals()

    quad_faces = [[0, 1, 2, 3]]
    obj_bytes = _export_quad_obj(mesh, quad_faces)
    obj_str = obj_bytes.decode("utf-8")

    assert "v 0.000000 0.000000 0.000000" in obj_str
    # Check that a 4-vertex face line was written: f 1/... 2/... 3/... 4/... or f 1 2 3 4
    face_lines = [l for l in obj_str.splitlines() if l.startswith("f ")]
    assert len(face_lines) == 1
    tokens = face_lines[0].split()
    assert len(tokens) == 5  # "f", v1, v2, v3, v4
