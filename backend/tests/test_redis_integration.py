"""Live Redis queue/scheduler integration coverage.

Run with:
    FORMASH_REDIS_INTEGRATION=1 pytest backend/tests/test_redis_integration.py -q
"""
import asyncio
import os
import uuid

import pytest

from core.scheduler.job_queue import JobRequest
from core.scheduler.multiprocess_scheduler import MultiprocessModelScheduler
from core.scheduler.redis_job_queue import RedisJobQueue


@pytest.mark.asyncio
async def test_redis_queue_concurrent_scheduler_submission():
    if os.getenv("FORMASH_REDIS_INTEGRATION") != "1":
        pytest.skip("Set FORMASH_REDIS_INTEGRATION=1 to run the live Redis integration test")

    queue_prefix = f"formash3d-test-{uuid.uuid4().hex}"
    queue = RedisJobQueue(
        redis_url=os.getenv("FORMASH_REDIS_URL", "redis://localhost:6379"),
        queue_prefix=queue_prefix,
    )
    await queue.connect()

    scheduler_cls = MultiprocessModelScheduler
    previous_instance = scheduler_cls._instance
    previous_initialized = scheduler_cls._initialized
    scheduler_cls._instance = None
    scheduler_cls._initialized = False

    scheduler = None
    job_ids: list[str] = []

    try:
        scheduler = scheduler_cls(job_queue=queue, enable_processing=False)
        scheduler.register_model(
            {
                "model_id": "integration_test_model",
                "feature_type": "image_to_raw_mesh",
                "module": "adapters.triposr_adapter",
                "class": "TripoSRImageToRawMeshAdapter",
                "vram_requirement": 0,
            }
        )

        requests = [
            JobRequest(
                feature="image_to_raw_mesh",
                inputs={"image_file_id": f"img-{index}"},
                model_preference="integration_test_model",
            )
            for index in range(2)
        ]

        job_ids = list(await asyncio.gather(*(scheduler.schedule_job(request) for request in requests)))
        assert len(set(job_ids)) == 2

        jobs = await asyncio.gather(*(queue.get_job(job_id) for job_id in job_ids))
        assert all(job is not None for job in jobs)
        assert {job["job_id"] for job in jobs} == set(job_ids)

        dequeued = await asyncio.gather(queue.dequeue(), queue.dequeue())
        assert {job.job_id for job in dequeued if job is not None} == set(job_ids)
    finally:
        try:
            if queue.redis is not None:
                await queue.redis.delete(
                    queue.pending_queue_key,
                    queue.processing_set_key,
                    queue.jobs_hash_key,
                    queue.progress_hash_key,
                    queue.stage_hash_key,
                    queue.message_hash_key,
                    queue.completed_index_key,
                    queue.cancel_request_key,
                )
                for job_id in job_ids:
                    await queue.redis.delete(f"{queue.results_prefix}{job_id}")
        finally:
            await queue.disconnect()
            scheduler_cls._instance = previous_instance
            scheduler_cls._initialized = previous_initialized
