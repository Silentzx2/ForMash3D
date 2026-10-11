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

