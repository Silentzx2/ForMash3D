import asyncio
import os
import time
from unittest.mock import MagicMock, AsyncMock, patch
import pytest

from core.scheduler.multiprocess_scheduler import (
    get_model_cache_ttl_seconds,
    auto_unload_after_job_enabled,
    MultiprocessModelScheduler,
)


def test_get_model_cache_ttl_seconds_env_vars():
    # Test P3D_MODEL_CACHE_TTL_SECONDS
    with patch.dict(os.environ, {"P3D_MODEL_CACHE_TTL_SECONDS": "120", "AUTO_UNLOAD_AFTER_JOB": "false"}):
        assert get_model_cache_ttl_seconds() == 120.0
        assert not auto_unload_after_job_enabled()

    # Test MODEL_CACHE_TTL_SECONDS fallback
    with patch.dict(os.environ, {"P3D_MODEL_CACHE_TTL_SECONDS": "", "MODEL_CACHE_TTL_SECONDS": "450", "AUTO_UNLOAD_AFTER_JOB": "false"}):
        assert get_model_cache_ttl_seconds() == 450.0
        assert not auto_unload_after_job_enabled()

    # Test AUTO_UNLOAD_AFTER_JOB=true overrides to 0
    with patch.dict(os.environ, {"P3D_MODEL_CACHE_TTL_SECONDS": "600", "AUTO_UNLOAD_AFTER_JOB": "true"}):
        assert get_model_cache_ttl_seconds() == 0.0
        assert auto_unload_after_job_enabled()

    # Test default is 300s
    with patch.dict(os.environ, {}, clear=True):
        assert get_model_cache_ttl_seconds() == 300.0
        assert not auto_unload_after_job_enabled()


def test_multi_gpu_keeps_cached_model_when_second_gpu_has_vram():
    async def _run():
        scheduler = MultiprocessModelScheduler.__new__(MultiprocessModelScheduler)
        scheduler.gpu_monitor = MagicMock()
        scheduler.gpu_monitor.get_gpu_status.return_value = [
            {"id": 0, "name": "GPU 0", "total_mb": 16000, "free_mb": 2000},
            {"id": 1, "name": "GPU 1", "total_mb": 16000, "free_mb": 15000},
        ]
        scheduler.gpu_monitor.get_gpu_available_vram.side_effect = lambda gid: 2000 if gid == 0 else 15000
        scheduler.worker_status = {"worker_model_a": False}
        scheduler.worker_configs = {
            "worker_model_a": MagicMock(gpu_id=0, model_config={"model_id": "model_a", "vram_requirement": 10000})
        }
        scheduler.worker_last_used = {"worker_model_a": time.time() - 50}
        scheduler._destroy_worker = AsyncMock()

        # Model B needs 8000 MB VRAM
        # GPU 1 has 15000 MB available, so Model A on GPU 0 should NOT be evicted!
        result = await scheduler._evict_lru_workers_to_free_vram(8000, {"model_id": "model_b"})
        assert result is True
        scheduler._destroy_worker.assert_not_called()

    asyncio.run(_run())


def test_lru_eviction_when_vram_insufficient():
    async def _run():
        scheduler = MultiprocessModelScheduler.__new__(MultiprocessModelScheduler)
        scheduler.gpu_monitor = MagicMock()
        scheduler.gpu_monitor.get_gpu_status.return_value = [
            {"id": 0, "name": "GPU 0", "total_mb": 16000, "free_mb": 2000},
            {"id": 1, "name": "GPU 1", "total_mb": 16000, "free_mb": 2000},
        ]

        # Two idle workers:
        # Worker 1 on GPU 0 used 100s ago (older)
        # Worker 2 on GPU 1 used 20s ago (newer)
        scheduler.worker_status = {
            "worker_old": False,
            "worker_new": False,
        }
        scheduler.worker_configs = {
            "worker_old": MagicMock(gpu_id=0, model_config={"model_id": "old_model", "vram_requirement": 12000}),
            "worker_new": MagicMock(gpu_id=1, model_config={"model_id": "new_model", "vram_requirement": 12000}),
        }
        now = time.time()
        scheduler.worker_last_used = {
            "worker_old": now - 100,
            "worker_new": now - 20,
        }

        # After destroying worker_old, GPU 0 available VRAM becomes 14000
        def mock_avail(gid):
            if gid == 0 and scheduler._destroy_worker.called:
                return 14000
            return 2000

        scheduler.gpu_monitor.get_gpu_available_vram.side_effect = mock_avail
        scheduler._destroy_worker = AsyncMock()

        # Need 10000 MB VRAM
        # LRU should choose GPU 0 and evict worker_old (idle 100s ago) rather than worker_new (idle 20s ago)
        result = await scheduler._evict_lru_workers_to_free_vram(10000, {"model_id": "target_model"})
        assert result is True
        scheduler._destroy_worker.assert_called_once_with("worker_old")

    asyncio.run(_run())
