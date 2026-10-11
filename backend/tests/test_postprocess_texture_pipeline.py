"""Tests for centralized texture stage and cooperative post-processing cancellation."""
import asyncio
import threading
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import trimesh

from core.scheduler.job_queue import JobRequest, JobStatus
from core.scheduler.multiprocess_scheduler import MultiprocessModelScheduler
from postprocess.pipeline import (
    resolve_texture_preset,
    run_postprocess_job,
    _check_cancelled,
    _validate_texture_atlas_dimension,
)


def test_resolve_texture_preset():
    """Verify texture preset mappings for 1K, 2K, 4K, 8K."""
    assert resolve_texture_preset("1K") == ("1K", 1024)
    assert resolve_texture_preset(1024) == ("1K", 1024)
    assert resolve_texture_preset("2K") == ("2K", 2048)
    assert resolve_texture_preset(2048) == ("2K", 2048)
    assert resolve_texture_preset("4K") == ("4K", 4096)
    assert resolve_texture_preset(4096) == ("4K", 4096)
    assert resolve_texture_preset("8K") == ("8K", 8192)
    assert resolve_texture_preset(8192) == ("8K", 8192)
    # Default fallback
    assert resolve_texture_preset(None) == ("2K", 2048)


def test_check_cancelled_raises_interrupted_error():
    """Verify _check_cancelled raises InterruptedError when flag is set."""
    _check_cancelled(None)
    _check_cancelled(lambda: False)

    with pytest.raises(InterruptedError, match="cancelled"):
        _check_cancelled(lambda: True)


def test_postprocess_job_aborts_on_cancel_checker(tmp_path):
    """Verify run_postprocess_job cleanly raises InterruptedError before execution."""
    raw_mesh_path = tmp_path / "raw.glb"
    # Create simple cube mesh
    box = trimesh.creation.box()
    box.export(str(raw_mesh_path))

    gen_result = {
        "output_mesh_path": str(raw_mesh_path),
        "success": True,
    }

    cancel_event = threading.Event()
    cancel_event.set()

    with pytest.raises(InterruptedError):
        run_postprocess_job(
            job_id="test-cancel-job",
            generation_result=gen_result,
            job_inputs={},
            cancel_checker=lambda: cancel_event.is_set(),
        )


def test_texture_stage_skipped_when_disabled(tmp_path, monkeypatch):
    """Verify texture stage is marked skipped when texture_enabled is False."""
    monkeypatch.setenv("ALLOW_LOCAL_SERVER_PATH_INPUTS", "true")
    raw_mesh_path = tmp_path / "raw_mesh.glb"
    box = trimesh.creation.box()
    box.export(str(raw_mesh_path))

    gen_result = {
        "output_mesh_path": str(raw_mesh_path),
        "success": True,
    }

    result = run_postprocess_job(
        job_id="test-skip-texture",
        generation_result=gen_result,
        job_inputs={
            "texture_enabled": False,
            "target_polycount": -1,  # native
            "lod_enabled": False,
            "enable_auto_repair": False,
            "remesh": False,
        },
    )

    assert result["success"] is True
    texture_stage = result.get("texture_stage", {})
    assert texture_stage.get("status") == "skipped"
    # Raw master must exist
    asset_root = Path(result["asset_root"])
    master_path = asset_root / "master" / "source.glb"
    assert master_path.exists()


def test_watch_auto_rig_does_not_resurrect_cancelled_parent():
    """Verify _watch_auto_rig does not call complete_job if parent job is cancelled."""
    async def _run():
        scheduler = MultiprocessModelScheduler()
        mock_queue = MagicMock()
        # Mock child job completes successfully
        mock_queue.get_job = AsyncMock(side_effect=lambda jid: {
            "job_id": jid,
            "status": "completed" if jid == "child-123" else "cancelled",
            "result": {"output_mesh_path": "/tmp/rigged.glb"},
        })
        mock_queue.complete_job = AsyncMock()
        mock_queue.update_job_progress = AsyncMock()
        mock_queue.update_job_result = AsyncMock()

        scheduler.job_queue = mock_queue

        await scheduler._watch_auto_rig(
            parent_job_id="parent-456",
            child_job_id="child-123",
            base_result={"output_mesh_path": "/tmp/source.glb"},
        )

        # complete_job must NOT be called for the parent since parent was cancelled
        mock_queue.complete_job.assert_not_called()

    asyncio.run(_run())


def test_cancel_job_cooperative_signal():
    """Verify cancel_job sets cooperative cancel signal when no worker is running."""
    async def _run():
        scheduler = MultiprocessModelScheduler()
        mock_queue = MagicMock()
        mock_queue.get_job = AsyncMock(return_value={
            "job_id": "job-coop-1",
            "status": "processing",
        })
        mock_queue.request_cancel = AsyncMock()
        scheduler.job_queue = mock_queue

        # Mock _stop_worker_for_job returning False (worker not found / active in postprocess)
        scheduler._stop_worker_for_job = AsyncMock(return_value=False)

        postprocess_event = threading.Event()
        scheduler._active_postprocess_cancels["job-coop-1"] = postprocess_event

        res = await scheduler.cancel_job("job-coop-1")

        assert res is False
        assert "job-coop-1" in scheduler._cancel_requested_jobs
        assert postprocess_event.is_set()
        mock_queue.request_cancel.assert_called_once_with("job-coop-1")

    asyncio.run(_run())


def test_handle_job_result_cooperative_cancellation():
    """Verify _handle_job_result cancels job cleanly when InterruptedError is raised in postprocess."""
    async def _run():
        scheduler = MultiprocessModelScheduler()
        mock_queue = MagicMock()
        mock_queue.get_job = AsyncMock(return_value={"job_id": "job-cancel-test", "status": "processing"})
        mock_queue.update_job_result = AsyncMock(return_value=True)
        mock_queue.update_job_progress = AsyncMock()
        mock_queue.cancel_job = AsyncMock(return_value=True)
        mock_queue.fail_job = AsyncMock()
        mock_queue.complete_job = AsyncMock()
        scheduler.job_queue = mock_queue

        req = JobRequest(
            feature="image_to_raw_mesh",
            inputs={"mesh_path": "/tmp/test.glb"},
            metadata={"postprocess_mode": "production_mesh"},
        )
        req.job_id = "job-cancel-test"
        fut = asyncio.Future()
        fut.set_result({"success": True, "result": {"output_mesh_path": "/tmp/test.glb"}})

        with patch("postprocess.pipeline.canonical_asset_workspace", return_value=Path("/tmp/asset")), \
             patch("postprocess.pipeline.run_postprocess_job", side_effect=InterruptedError("Cancelled")):
            await scheduler._handle_job_result(req, fut)

        mock_queue.cancel_job.assert_called_once_with("job-cancel-test")
        mock_queue.fail_job.assert_not_called()
        mock_queue.complete_job.assert_not_called()

    asyncio.run(_run())


def test_handle_job_result_routes_texture_into_postprocess():
    """Verify _handle_job_result normalizes texture_enabled and does not schedule child paint job."""
    async def _run():
        scheduler = MultiprocessModelScheduler()
        scheduler.schedule_job = AsyncMock()
        mock_queue = MagicMock()
        mock_queue.get_job = AsyncMock(return_value={"job_id": "job-tex-test", "status": "processing"})
        mock_queue.update_job_result = AsyncMock(return_value=True)
        mock_queue.update_job_progress = AsyncMock()
        mock_queue.complete_job = AsyncMock()
        mock_queue.fail_job = AsyncMock()
        scheduler.job_queue = mock_queue

        req = JobRequest(
            feature="image_to_raw_mesh",
            inputs={"auto_paint": True},
            metadata={"postprocess_mode": "production_mesh"},
        )
        req.job_id = "job-tex-test"
        fut = asyncio.Future()
        fut.set_result({"success": True, "result": {"output_mesh_path": "/tmp/test.glb"}})

        captured_metadata = {}
        def mock_postprocess(job_id, final_result, job_inputs, job_metadata, report, cancel_checker):
            captured_metadata.update(job_metadata)
            return {**final_result, "texture_stage": {"status": "completed"}}

        with patch("postprocess.pipeline.canonical_asset_workspace", return_value=Path("/tmp/asset")), \
             patch("postprocess.pipeline.run_postprocess_job", side_effect=mock_postprocess):
            await scheduler._handle_job_result(req, fut)

        # Child paint job must NOT have been scheduled
        scheduler.schedule_job.assert_not_called()
        assert req.metadata.get("texture_enabled") is True
        assert req.inputs.get("texture_enabled") is True
        mock_queue.complete_job.assert_called_once()

    asyncio.run(_run())




def test_texture_atlas_validation_requires_observed_exact_size():
    assert _validate_texture_atlas_dimension([2048, 2048], 2048) == (True, [2048, 2048], None)
    valid, actual, error = _validate_texture_atlas_dimension([2048, 1024], 2048)
    assert valid is False
    assert actual == [2048, 1024]
    assert "requested 2048x2048" in error


def test_texture_atlas_validation_rejects_missing_dimension():
    valid, actual, error = _validate_texture_atlas_dimension(None, 8192)
    assert valid is False
    assert actual is None
    assert "Could not verify" in error


def test_textured_generation_designates_active_model_url_and_preserves_master(tmp_path, monkeypatch):
    """BUG-008 & BUG-009: When centralized texturing succeeds:
    - textured_model_url is active_model_url
    - master/source.glb remains immutable
    - downstream LODs and game-ready GLB are built from textured mesh
    """
    import numpy as np
    from PIL import Image
    monkeypatch.setenv("ALLOW_LOCAL_SERVER_PATH_INPUTS", "true")
    monkeypatch.setenv("STORAGE_LOCAL_PATH", str(tmp_path / "storage"))

    raw_mesh_path = tmp_path / "raw.glb"
    box = trimesh.creation.box()
    box.export(str(raw_mesh_path))

    # Create dummy textured mesh with TextureVisuals
    textured_box = trimesh.creation.box()
    uvs = np.zeros((len(textured_box.vertices), 2), dtype=np.float32)
    dummy_img = Image.new("RGB", (1024, 1024), (255, 0, 0))
    textured_box.visual = trimesh.visual.TextureVisuals(uv=uvs, image=dummy_img)
    textured_glb_bytes = textured_box.export(file_type="glb")

    def mock_texture_stage(**kwargs):
        asset_dir = kwargs["asset_dir"]
        base_name = kwargs["base_name"]
        t_dir = asset_dir / "textures"
        t_dir.mkdir(parents=True, exist_ok=True)
        t_path = t_dir / f"{base_name}_textured.glb"
        t_path.write_bytes(textured_glb_bytes)
        base_color = t_dir / "base_color.png"
        dummy_img.save(base_color)
        return {
            "status": "completed",
            "textured_glb": str(t_path),
            "texture_maps": {"base_color": str(base_color)},
            "target_atlas_size": 1024,
            "validated_atlas_dimension": [1024, 1024],
        }

    monkeypatch.setattr("postprocess.pipeline._execute_texture_stage", mock_texture_stage)

    result = run_postprocess_job(
        job_id="test-tex-success",
        generation_result={"output_mesh_path": str(raw_mesh_path), "success": True},
        job_inputs={"texture_enabled": True, "generateLOD": True},
    )

    assert result["success"] is True
    assert result["active_model_url"].endswith("artifact_format=textured")
    assert result["textured_model_url"].endswith("artifact_format=textured")
    assert result["source_model_url"].endswith("artifact_format=master")
    assert result["artifacts"]["textured"]["status"] == "ready"
    assert result["artifacts"]["textured"]["url"] == result["active_model_url"]

    # Verify immutable master
    asset_root = Path(result["asset_root"])
    master_file = asset_root / "master" / "source.glb"
    assert master_file.exists()
    assert master_file.stat().st_size > 0

    # Verify game-ready GLB and LODs
    game_ready_glb = Path(result["output_mesh_path"])
    assert game_ready_glb.exists()
    assert (asset_root / "lods" / "lod0.glb").exists()


def test_8k_preset_normal_ao_bake_not_clamped_and_records_dimensions(tmp_path, monkeypatch):
    """BUG-019: 8K preset normal/AO bake maps are not arbitrarily clamped to 4K when 8K is requested,
    and each map's dimensions are accurately recorded in texture_dimensions."""
    import io
    from PIL import Image

    monkeypatch.setenv("ALLOW_LOCAL_SERVER_PATH_INPUTS", "true")
    monkeypatch.setenv("STORAGE_LOCAL_PATH", str(tmp_path / "storage"))

    raw_mesh_path = tmp_path / "raw.glb"
    box = trimesh.creation.box()
    box.export(str(raw_mesh_path))

    # Create dummy 8K images
    img_8k = Image.new("RGB", (8192, 8192), (128, 128, 255))
    buf = io.BytesIO()
    img_8k.save(buf, format="PNG")
    png_8k_bytes = buf.getvalue()

    captured_bake_opts = []
    def mock_run_bake(low_glb, high_glb, opts, progress=None):
        captured_bake_opts.append(opts)
        return (
            {"normal": png_8k_bytes, "ao": png_8k_bytes},
            {"status": "completed", "maps": {"normal": "normal.png", "ao": "ao.png"}},
        )

    monkeypatch.setattr("postprocess.services.bake.run_bake", mock_run_bake)

    result = run_postprocess_job(
        job_id="test-8k-bake",
        generation_result={"output_mesh_path": str(raw_mesh_path), "success": True},
        job_inputs={
            "texture_resolution": "8K",
            "bake_normal_maps": True,
            "texture_enabled": False,
            "generateLOD": False,
        },
    )

    assert len(captured_bake_opts) == 1
    assert captured_bake_opts[0].resolution == 8192, f"Expected 8192 bake resolution, got {captured_bake_opts[0].resolution}"
    assert result["texture_dimensions"]["normal"] == [8192, 8192]
    assert result["texture_dimensions"]["ao"] == [8192, 8192]


def test_bake_and_collision_failures_surface_degraded_reasons(tmp_path, monkeypatch):
    """BUG-020: Requested bake and collision failures are not masked as 'skipped';
    they report 'failed' artifact status and surface degraded reasons in production status."""
    monkeypatch.setenv("ALLOW_LOCAL_SERVER_PATH_INPUTS", "true")
    monkeypatch.setenv("STORAGE_LOCAL_PATH", str(tmp_path / "storage"))

    raw_mesh_path = tmp_path / "raw.glb"
    box = trimesh.creation.box()
    box.export(str(raw_mesh_path))

    def mock_failing_bake(**kwargs):
        raise RuntimeError("GPU out of memory during normal bake")

    def mock_failing_collision(**kwargs):
        raise RuntimeError("CoACD decomposition failed")

    monkeypatch.setattr("postprocess.services.bake.run_bake", mock_failing_bake)
    monkeypatch.setattr("postprocess.services.collision.run_collision", mock_failing_collision)
    # Also fail the convex hull fallback
    monkeypatch.setattr("trimesh.Trimesh.convex_hull", property(lambda self: (_ for _ in ()).throw(RuntimeError("Hull failed"))))

    result = run_postprocess_job(
        job_id="test-failures-degraded",
        generation_result={"output_mesh_path": str(raw_mesh_path), "success": True},
        job_inputs={
            "bake_normal_maps": True,
            "enable_physics": True,
            "texture_enabled": False,
            "generateLOD": False,
        },
    )

    assert result["artifacts"]["bake"]["status"] == "failed"
    assert result["artifacts"]["collision"]["status"] == "failed"
    assert result["production_status"] == "degraded"
    assert "bake_failed" in result["degraded_reasons"]
    assert "collision_generation_failed" in result["degraded_reasons"]


def test_quad_retopology_on_native_textures_reports_degraded_fallback(tmp_path, monkeypatch):
    """BUG-026: When quad retopology is requested on native-textured mesh, report truthful degraded status."""
    import numpy as np
    from PIL import Image
    monkeypatch.setenv("ALLOW_LOCAL_SERVER_PATH_INPUTS", "true")
    monkeypatch.setenv("STORAGE_LOCAL_PATH", str(tmp_path / "storage"))

    raw_mesh_path = tmp_path / "native_textured.glb"
    box = trimesh.creation.box()
    uvs = np.zeros((len(box.vertices), 2), dtype=np.float32)
    dummy_img = Image.new("RGB", (64, 64), (0, 255, 0))
    box.visual = trimesh.visual.TextureVisuals(uv=uvs, image=dummy_img)
    box.export(str(raw_mesh_path))

    from postprocess.services import bake as bake_service
    monkeypatch.setattr(bake_service, "run_bake", lambda **kwargs: ({}, {"status": "completed"}))

    result = run_postprocess_job(
        job_id="test-quad-native",
        generation_result={"output_mesh_path": str(raw_mesh_path), "success": True},
        job_inputs={
            "topology_mode": "quad",
            "quad_topology": True,
            "texture_enabled": False,
            "bake_normal_maps": False,
            "generateLOD": False,
        },
    )

    assert result["artifacts"]["retopology"]["status"] == "degraded"
    assert result["artifacts"]["retopology"]["fallback"] == "triangles_retained_to_preserve_native_uvs"
    assert result["production_status"] == "degraded"
    assert "quad_topology_unsupported_native_textures" in result["degraded_reasons"]
