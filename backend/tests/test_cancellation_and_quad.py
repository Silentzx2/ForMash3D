"""Unit tests verifying external cancellation dict safety, quad topology options, and quad export."""
import pytest
import trimesh
import numpy as np
from unittest.mock import AsyncMock, MagicMock

from core.scheduler.multiprocess_scheduler import _extract_job_status, MultiprocessModelScheduler
from core.scheduler.job_queue import JobRequest, JobStatus
from postprocess.pipeline import _export_quad_obj
from api.routers.mesh_generation import (
    ImageMeshPaintingRequest,
    ImageToRawMeshRequest,
    ImageToTexturedMeshRequest,
    _clean_paint_parameters,
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
    img_req = ImageToRawMeshRequest(
        image_path="/tmp/test.png",
        model_preference="hunyuan3d_shape_v21_image_to_raw_mesh",
        topology_mode="quad",
        quad_topology=True,
    )
    assert img_req.topology_mode == "quad"
    assert img_req.quad_topology is True


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



def test_texture_api_accepts_named_8k_preset_and_enables_detail_bake_by_default():
    raw = ImageToRawMeshRequest(image_path="/tmp/test.png", texture_resolution="8K")
    textured = ImageToTexturedMeshRequest(image_path="/tmp/test.png", texture_resolution="8K")
    painting = ImageMeshPaintingRequest(
        image_path="/tmp/ref.png", mesh_path="/tmp/mesh.glb",
        texture_resolution="8K", model_preference="hunyuan3d_paint_v21_image_mesh_painting",
    )
    assert raw.texture_resolution == 8192
    assert textured.texture_resolution == 8192
    assert painting.texture_resolution == 8192
    assert raw.bake_normal_maps is True
    assert textured.bake_normal_maps is True
    assert ImageToRawMeshRequest(
        image_path="/tmp/test.png", texture_enabled=True
    ).texture_enabled is True
    assert ImageToTexturedMeshRequest(
        image_path="/tmp/test.png", texture_enabled=False
    ).texture_enabled is False


def test_direct_paint_parameters_cannot_trigger_second_texture_stage():
    cleaned = _clean_paint_parameters({
        "resolution": 768,
        "max_num_view": 6,
        "texture_resolution": "8K",
        "texture_enabled": True,
        "generate_texture": True,
        "auto_paint": True,
        "enable_realesrgan": False,
    })
    assert cleaned == {"resolution": 768, "max_num_view": 6}


def test_bake_run_worker_uses_blender_worker_argv(monkeypatch):
    """Verify _run_worker uses blender_worker_argv instead of sys.executable directly."""
    from unittest.mock import MagicMock
    import shutil
    import postprocess.services.bake as bake_mod
    import postprocess.config as cfg_mod
    from postprocess.config import blender_worker_argv

    monkeypatch.setattr(shutil, "which", lambda cmd: "/usr/bin/blender")
    monkeypatch.setattr(cfg_mod.shutil, "which", lambda cmd: "/usr/bin/blender")

    mock_popen = MagicMock()
    mock_proc = MagicMock()
    mock_proc.stdout = [bake_mod.SENTINEL + '{"type": "result", "ok": true}']
    mock_proc.poll = MagicMock(return_value=0)
    mock_proc.wait = MagicMock()
    mock_popen.return_value = mock_proc
    monkeypatch.setattr(bake_mod.subprocess, "Popen", mock_popen)

    worker_args = ["--low", "low.glb", "--high", "high.glb", "--outdir", "/tmp", "--options", "opt.json"]
    bake_mod._run_worker(bake_mod._WORKER, worker_args, progress=None)

    assert mock_popen.called
    called_argv = mock_popen.call_args[0][0]
    expected_argv = blender_worker_argv(bake_mod._WORKER, worker_args)
    assert called_argv == expected_argv


def test_no_hardcoded_storage_models_paths():
    """Verify system.py and multiprocess_scheduler.py have no hardcoded storage/models paths."""
    from pathlib import Path
    import re

    system_py = Path(__file__).resolve().parents[1] / "api" / "routers" / "system.py"
    scheduler_py = Path(__file__).resolve().parents[1] / "core" / "scheduler" / "multiprocess_scheduler.py"

    hardcoded_pattern = re.compile(r'Path\([^)]*\)\s*/\s*["\']storage["\']\s*/\s*["\']models["\']')
    assert not hardcoded_pattern.search(system_py.read_text(encoding="utf-8")), "Found hardcoded storage/models in system.py"
    assert not hardcoded_pattern.search(scheduler_py.read_text(encoding="utf-8")), "Found hardcoded storage/models in multiprocess_scheduler.py"


def test_clear_gpu_cache_and_uv_detection():
    """Verify _clear_gpu_cache and _has_uvs helper functions."""
    from postprocess.pipeline import _clear_gpu_cache, _has_uvs

    # Should run cleanly without exception
    _clear_gpu_cache()

    # Plain mesh without UVs
    mesh_no_uv = trimesh.creation.box(extents=(1.0, 1.0, 1.0))
    if hasattr(mesh_no_uv.visual, "uv"):
        mesh_no_uv.visual.uv = None
    assert _has_uvs(mesh_no_uv) is False

    # Mesh with UVs
    mesh_with_uv = mesh_no_uv.copy()
    mesh_with_uv.visual = trimesh.visual.TextureVisuals(
        uv=np.zeros((len(mesh_with_uv.vertices), 2), dtype=np.float32)
    )
    assert _has_uvs(mesh_with_uv) is True


def test_pipeline_quad_obj_and_auto_uv_logic():
    """Verify quad OBJ export and UV presence validation."""
    from postprocess.pipeline import _export_quad_obj, _has_uvs

    # Verify quad OBJ export with quad faces
    mesh = trimesh.creation.box(extents=(1.0, 1.0, 1.0))
    quad_faces = [
        [0, 1, 2, 3],
        [4, 5, 6, 7],
    ]
    obj_bytes = _export_quad_obj(mesh, quad_faces)
    assert b"# ForMash3D Quad Mesh Export" in obj_bytes
    face_lines = [l for l in obj_bytes.decode("utf-8").splitlines() if l.startswith("f ")]
    assert len(face_lines) == 2
    assert len(face_lines[0].split()) == 5  # f + 4 vertex indices


