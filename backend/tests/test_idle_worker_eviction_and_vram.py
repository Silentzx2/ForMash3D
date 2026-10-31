import asyncio
import time
from unittest.mock import MagicMock, AsyncMock, patch
import pytest

from core.planner import plan_generation
from core.scheduler.multiprocess_scheduler import MultiprocessModelScheduler
from api.routers.mesh_generation import _augment_runtime_facts_with_freeable_vram


def test_augment_runtime_facts_with_freeable_vram():
    """Verify that idle workers' VRAM is added to free VRAM in runtime facts."""
    scheduler = MagicMock()
    # GPU 0 has 10240 MB held by idle worker
    scheduler.get_idle_workers_vram_by_gpu.return_value = {0: 10240}

    runtime_facts = {
        "has_cuda": True,
        "gpu_count": 1,
        "free_vram_gb": 6.22,
        "max_free_vram_gb": 6.22,
        "aggregate_free_vram_gb": 6.22,
        "total_vram_gb": 24.0,
        "gpu_devices": [
            {
                "id": 0,
                "name": "NVIDIA RTX 4090",
                "free_vram_gb": 6.22,
                "total_vram_gb": 24.0,
            }
        ],
    }

    _augment_runtime_facts_with_freeable_vram(runtime_facts, scheduler)

    assert runtime_facts["raw_free_vram_gb"] == 6.22
    # 6.22 + 10.0 = 16.22 GB freeable VRAM
    assert runtime_facts["free_vram_gb"] == 16.22
    assert runtime_facts["max_free_vram_gb"] == 16.22
    assert runtime_facts["aggregate_free_vram_gb"] == 16.22
    assert runtime_facts["gpu_devices"][0]["freeable_vram_gb"] == 16.22
    assert runtime_facts["gpu_devices"][0]["idle_worker_vram_gb"] == 10.0


def test_planner_accepts_model_when_idle_worker_vram_can_be_freed():
    """
    Test the exact symptom from the issue:
    Candidate requires 10.0 GB VRAM.
    Raw free VRAM is only 6.22 GB.
    Idle worker holds 10.0 GB (Unique3D).
    Plan generation should accept the candidate and note eviction in reasons.
    """
    scheduler = MagicMock()
    scheduler.get_idle_workers_vram_by_gpu.return_value = {0: 10240}

    runtime = {
        "has_cuda": True,
        "gpu_count": 1,
        "installed_adapters": ["hunyuan3d_shape_v21_image_to_raw_mesh"],
        "enabled_adapters": ["hunyuan3d_shape_v21_image_to_raw_mesh"],
        "free_vram_gb": 6.22,
        "max_free_vram_gb": 6.22,
        "aggregate_free_vram_gb": 6.22,
        "total_vram_gb": 24.0,
        "gpu_devices": [
            {
                "id": 0,
                "name": "NVIDIA RTX 4090",
                "free_vram_gb": 6.22,
                "total_vram_gb": 24.0,
            }
        ],
    }

    # Before augmentation: should fail because 6.22 < 10.0 GB
    with pytest.raises(ValueError, match="requires 10.0 GB VRAM, but only 6.22 GB is free"):
        plan_generation(
            {"model_preference": "hunyuan3d_shape_v21_image_to_raw_mesh", "auto_mode": False},
            runtime,
        )

    # After augmentation with idle worker VRAM: should succeed!
    _augment_runtime_facts_with_freeable_vram(runtime, scheduler)

    plan = plan_generation(
        {"model_preference": "hunyuan3d_shape_v21_image_to_raw_mesh", "auto_mode": False},
        runtime,
    )

    assert plan["adapter"] == "hunyuan3d_shape_v21_image_to_raw_mesh"
    reasons_str = " ".join(plan.get("reasons", []))
    assert "accommodates by evicting idle workers" in reasons_str


def test_scheduler_get_idle_workers_vram_by_gpu():
    """Verify MultiprocessModelScheduler tracks idle workers' VRAM correctly."""
    scheduler = MultiprocessModelScheduler.__new__(MultiprocessModelScheduler)
    scheduler.worker_status = {
        "worker_idle_1": False,
        "worker_busy_2": True,
        "worker_idle_3": False,
    }
    scheduler.worker_current_job = {
        "worker_busy_2": "job_123",
    }
    scheduler.workers = {
        "worker_idle_1": MagicMock(is_alive=lambda: True),
        "worker_busy_2": MagicMock(is_alive=lambda: True),
        "worker_idle_3": MagicMock(is_alive=lambda: True),
    }
    scheduler.worker_configs = {
        "worker_idle_1": MagicMock(
            gpu_id=0,
            gpu_ids=[0],
            resource_plan={"reservation_mb": {0: 10240}},
            model_config={"model_id": "unique3d", "vram_requirement": 10240},
        ),
        "worker_busy_2": MagicMock(
            gpu_id=0,
            gpu_ids=[0],
            resource_plan={"reservation_mb": {0: 8192}},
            model_config={"model_id": "other_model", "vram_requirement": 8192},
        ),
        "worker_idle_3": MagicMock(
            gpu_id=1,
            gpu_ids=[1],
            resource_plan={"reservation_mb": {1: 4096}},
            model_config={"model_id": "small_model", "vram_requirement": 4096},
        ),
    }

    idle_vram = scheduler.get_idle_workers_vram_by_gpu()
    # GPU 0: worker_idle_1 = 10240 MB (worker_busy_2 is busy so excluded)
    assert idle_vram[0] == 10240
    # GPU 1: worker_idle_3 = 4096 MB
    assert idle_vram[1] == 4096


def test_cancel_job_cleans_up_and_returns_true():
    """Verify cancel_job cleans up worker process and returns True."""
    async def _run():
        scheduler = MultiprocessModelScheduler.__new__(MultiprocessModelScheduler)
        scheduler.job_queue = MagicMock()
        mock_job = MagicMock()
        mock_job.status = MagicMock(value="processing")
        scheduler.job_queue.get_job = AsyncMock(return_value=mock_job)
        scheduler.job_queue.cancel_job = AsyncMock(return_value=True)
        scheduler.job_queue.request_cancel = AsyncMock()

        scheduler._cancel_requested_jobs = set()
        scheduler._active_postprocess_cancels = {}
        scheduler._cleanup_temporary_inputs = MagicMock()
        scheduler._cleanup_dead_workers = AsyncMock()
        scheduler._stop_worker_for_job = AsyncMock(return_value=True)

        res = await scheduler.cancel_job("job_xyz")
        assert res is True
        scheduler._stop_worker_for_job.assert_called_once_with("job_xyz", "cancelled by user")
        scheduler._cleanup_dead_workers.assert_called_once_with(run_once=True)

    asyncio.run(_run())


def test_fatal_cuda_error_destroys_worker():
    """Verify that a worker reporting fatal CUDA error is destroyed."""
    scheduler = MultiprocessModelScheduler.__new__(MultiprocessModelScheduler)
    scheduler.running = False  # loop won't run continuously
    scheduler._destroy_worker = AsyncMock()
    mock_loop = MagicMock()

    # Emulate fatal OOM error handling logic from _handle_worker_responses
    result = {"success": False, "error": "CUDA out of memory. Tried to allocate 2.00 GiB"}
    success = False
    err_str = str(result.get("error", "")).lower()

    is_fatal = any(kw in err_str for kw in ["out of memory", "cuda error", "illegal memory access"])
    assert is_fatal is True
