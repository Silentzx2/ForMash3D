import asyncio
import json
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch
import pytest

from core.scheduler.database_models import JobModel, JobStatus as DBJobStatus
from core.scheduler.job_queue import JobRequest, JobStatus
from core.scheduler.redis_job_queue import RedisJobQueue, _TERMINAL_STATUSES
from api.routers.mesh_generation import cancel_mesh_generation


@pytest.mark.asyncio
async def test_update_job_progress_ignores_terminal_jobs():
    """A4: update_job_progress must not mutate progress, stage, message or logs if terminal."""
    queue = RedisJobQueue()
    mock_redis = AsyncMock()
    queue.redis = mock_redis

    for terminal_status in ["completed", "failed", "cancelled"]:
        job_data = {
            "job_id": "job-term-1",
            "status": terminal_status,
            "progress": 1.0 if terminal_status == "completed" else 0.5,
            "stage": terminal_status,
            "message": "Terminal state",
            "logs": [],
        }
        mock_redis.hget.return_value = json.dumps(job_data)
        mock_redis.hset.reset_mock()

        await queue.update_job_progress("job-term-1", 0.8, stage="working", message="Should be ignored")

        # Must not write to progress, stage, message, or jobs hash
        mock_redis.hset.assert_not_called()


@pytest.mark.asyncio
async def test_update_job_progress_updates_active_jobs():
    """update_job_progress mutates active jobs as expected."""
    queue = RedisJobQueue()
    mock_redis = AsyncMock()
    queue.redis = mock_redis

    job_data = {
        "job_id": "job-active-1",
        "status": "processing",
        "progress": 0.2,
        "stage": "loading_model",
        "message": "Loading",
        "logs": [],
    }
    mock_redis.hget.return_value = json.dumps(job_data)

    await queue.update_job_progress("job-active-1", 0.5, stage="generating", message="Generating mesh")

    assert mock_redis.hset.call_count >= 4  # progress, stage, message, jobs_hash


@pytest.mark.asyncio
async def test_cancel_job_persists_to_sqlite():
    """B1: cancel_job must persist cancellation to durable SQLite store."""
    queue = RedisJobQueue()
    mock_redis = AsyncMock()
    queue.redis = mock_redis
    queue.db_manager = MagicMock()
    queue.db_manager.save_job = MagicMock(return_value=True)

    job_data = {
        "job_id": "job-cancel-1",
        "feature": "image_to_raw_mesh",
        "inputs": json.dumps({"image_path": "/test/img.png"}),
        "status": "queued",
        "progress": 0.0,
        "priority": 1,
        "created_at": datetime.utcnow().isoformat(),
        "metadata": json.dumps({"test": True}),
        "logs": [],
    }
    mock_redis.hget.return_value = json.dumps(job_data)

    result = await queue.cancel_job("job-cancel-1")

    assert result is True
    # Verify save_job was called
    queue.db_manager.save_job.assert_called_once()
    saved_job = queue.db_manager.save_job.call_args[0][0]
    assert isinstance(saved_job, JobRequest)
    assert saved_job.status == JobStatus.CANCELLED
    assert saved_job.error == "Cancelled by user"
    assert saved_job.completed_at is not None
    assert saved_job.metadata.get("stage") == "cancelled"
    assert saved_job.metadata.get("error_code") == "JOB_CANCELLED"


@pytest.mark.asyncio
async def test_cancel_job_handles_running_alias():
    """A6: cancel_job recognizes 'running' as alias for processing."""
    queue = RedisJobQueue()
    mock_redis = AsyncMock()
    queue.redis = mock_redis
    queue.db_manager = MagicMock()
    queue.db_manager.save_job = MagicMock(return_value=True)

    job_data = {
        "job_id": "job-running-1",
        "feature": "image_to_raw_mesh",
        "inputs": json.dumps({}),
        "status": "running",
        "progress": 0.3,
        "logs": [],
    }
    mock_redis.hget.return_value = json.dumps(job_data)

    # Without force=True, cancel_job on running/processing returns False
    res_no_force = await queue.cancel_job("job-running-1", force=False)
    assert res_no_force is False

    # With force=True, cancel_job on running/processing returns True and cancels
    res_force = await queue.cancel_job("job-running-1", force=True)
    assert res_force is True
    queue.db_manager.save_job.assert_called_once()


@pytest.mark.asyncio
async def test_cancel_mesh_generation_truthful_responses():
    """A5: cancel_mesh_generation propagates real outcome and does not call force=True."""
    mock_scheduler = AsyncMock()
    mock_request = MagicMock()

    # Case 1: Job already terminal (completed)
    mock_scheduler.get_job_status.return_value = {"job_id": "job-1", "status": "completed"}
    resp = await cancel_mesh_generation(
        job_id="job-1",
        request=mock_request,
        scheduler=mock_scheduler,
        current_user=None,
    )
    assert resp["cancelled"] is False
    assert resp["status"] == "completed"
    assert "no longer cancellable" in resp["message"]

    # Case 2: Cancellation succeeded immediately
    mock_scheduler.get_job_status.return_value = {"job_id": "job-2", "status": "queued"}
    mock_scheduler.cancel_job.return_value = True
    resp2 = await cancel_mesh_generation(
        job_id="job-2",
        request=mock_request,
        scheduler=mock_scheduler,
        current_user=None,
    )
    assert resp2["cancelled"] is True
    assert resp2["status"] == "cancelled"

    # Case 3: Cancel requested, job still processing
    mock_scheduler.get_job_status.side_effect = [
        {"job_id": "job-3", "status": "processing"},  # Initial check
        {"job_id": "job-3", "status": "processing"},  # Post-cancel check
    ]
    mock_scheduler.cancel_job.return_value = False
    mock_scheduler.job_queue = MagicMock()
    mock_scheduler.job_queue.cancel_job = AsyncMock()

    resp3 = await cancel_mesh_generation(
        job_id="job-3",
        request=mock_request,
        scheduler=mock_scheduler,
        current_user=None,
    )
    assert resp3["cancelled"] is False
    assert resp3["cancel_requested"] is True
    assert resp3["status"] == "processing"
    assert resp3["message"] == "Cancellation requested"
    # Verify force=True was NOT called on job_queue
    mock_scheduler.job_queue.cancel_job.assert_not_called()
