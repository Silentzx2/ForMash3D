"""
Redis-based Job Queue for Multi-Worker Deployment

This allows multiple uvicorn workers to share the same job queue
without conflicts.
"""

import asyncio
import json
import logging
import time
from datetime import datetime, timedelta
from typing import Any, Dict, Optional

import redis.asyncio as aioredis

from .database_manager import DatabaseManager
from .job_queue import JobRequest, JobStatus, classify_job_error, cleanup_canonical_asset_workspace

logger = logging.getLogger(__name__)


def _status_to_str(status: JobStatus) -> str:
    """Convert JobStatus enum to string for JSON serialization."""
    if hasattr(status, "value"):
        return status.value
    return str(status)


def _priority_score(priority: int, created_at: datetime) -> float:
    # Use a valid minimum timestamp (year 1970) instead of datetime.min which causes timestamp() to fail
    if created_at <= datetime(1970, 1, 1):
        created_at = datetime(1970, 1, 1)
    return -priority * 1e12 + created_at.timestamp()


def _append_log(job_data: Dict[str, Any], stage: str, progress: float, message: str, level: str = "info") -> None:
    logs = job_data.get("logs") or []
    logs.append(
        {
            "stage": stage,
            "progress": round(float(progress) * 100, 2),
            "message": message,
            "level": level,
            "timestamp": datetime.utcnow().isoformat(),
        }
    )
    job_data["logs"] = logs[-100:]


class RedisJobQueue:
    """Redis-backed job queue for multi-worker deployments"""

    def __init__(
        self,
        redis_url: str = "redis://localhost:6379",
        queue_prefix: str = "3daigc",
        max_job_age_hours: int = 24,
        max_connections: int = 20,
    ):
        self.redis_url = redis_url
        self.queue_prefix = queue_prefix
        self.max_job_age_hours = max_job_age_hours
        self.max_connections = max_connections
        self.db_manager = DatabaseManager()
        
        # Redis keys
        self.pending_queue_key = f"{queue_prefix}:queue:pending"
        self.processing_set_key = f"{queue_prefix}:queue:processing"
        self.jobs_hash_key = f"{queue_prefix}:jobs"
        self.results_prefix = f"{queue_prefix}:result:"
        self.progress_hash_key = f"{queue_prefix}:progress"
        self.stage_hash_key = f"{queue_prefix}:stage"
        self.message_hash_key = f"{queue_prefix}:message"
        self.completed_index_key = f"{queue_prefix}:completed_at"
        self.cancel_request_key = f"{queue_prefix}:cancel_requested"
        
        self.redis: Optional[aioredis.Redis] = None
        self._last_get_job_log: Dict[str, float] = {}

    async def connect(self):
        """Connect to Redis with bounded connection pool"""
        self.redis = aioredis.from_url(
            self.redis_url,
            encoding="utf-8",
            decode_responses=True,
            max_connections=self.max_connections,
        )
        await self.redis.ping()
        logger.info(f"Connected to Redis at {self.redis_url} (max_connections={self.max_connections})")

    async def disconnect(self):
        """Disconnect from Redis cleanly"""
        if self.redis:
            try:
                await self.redis.aclose()
            except Exception as e:
                logger.warning(f"Error during Redis disconnect: {e}")
            finally:
                self.redis = None

    async def recover_orphaned_jobs(self):
        """
        Find any jobs stuck in the 'processing' set on startup and requeue them.
        This handles cases where the scheduler crashed while jobs were running.
        """
        if not self.redis:
            raise RuntimeError("Redis not connected")

        orphaned_job_ids = await self.redis.smembers(self.processing_set_key)
        if not orphaned_job_ids:
            logger.info("No orphaned jobs found in 'processing' set.")
            return

        logger.warning(f"Found {len(orphaned_job_ids)} orphaned jobs. Requeuing them...")
        for job_id in orphaned_job_ids:
            logger.info(f"Requeuing orphaned job {job_id}")
            await self.requeue_job(job_id)

        logger.info("Finished requeuing all orphaned jobs.")

    async def enqueue(self, job_request: JobRequest) -> str:
        """Add a job to the queue"""
        if not self.redis:
            raise RuntimeError("Redis not connected")

        job_id = job_request.job_id
        logger.debug("enqueue: storing job_id=%s prefix=%s", job_id, self.queue_prefix)

        # Store job data (convert enum to string for JSON serialization)
        job_data = {
            "job_id": job_id,
            "feature": job_request.feature,
            "inputs": json.dumps(job_request.inputs),
            "model_preference": job_request.model_preference or "",
            "priority": job_request.priority,
            "status": _status_to_str(JobStatus.QUEUED),
            "created_at": job_request.created_at.isoformat(),
            "metadata": json.dumps(job_request.metadata),
            "user_id": job_request.user_id or "",  # Store user_id for job isolation
            "logs": [],
        }

        await self.redis.hset(self.jobs_hash_key, job_id, json.dumps(job_data))
        if not await asyncio.to_thread(self.db_manager.save_job, job_request):
            await self.redis.hdel(self.jobs_hash_key, job_id)
            raise RuntimeError("Failed to persist job in durable SQL history")

        # Add to pending queue (sorted by priority and timestamp)
        score = _priority_score(job_request.priority, job_request.created_at)
        await self.redis.zadd(self.pending_queue_key, {job_id: score})

        logger.info("Enqueued job %s to Redis", job_id)
        return job_id

    async def dequeue(self) -> Optional[JobRequest]:
        """Get next job from queue (FIFO with priority)"""
        if not self.redis:
            raise RuntimeError("Redis not connected")

        # Use ZPOPMIN to get lowest score (highest priority, earliest timestamp)
        result = await self.redis.zpopmin(self.pending_queue_key, count=1)

        if not result:
            return None

        job_id = result[0][0]
        logger.debug("dequeue: popped job_id=%s prefix=%s", job_id, self.queue_prefix)

        # Get job data
        job_data_str = await self.redis.hget(self.jobs_hash_key, job_id)
        if not job_data_str:
            logger.warning(f"Job {job_id} not found in jobs hash")
            return None
        
        job_data = json.loads(job_data_str)
        
        # Mark as processing
        await self.redis.sadd(self.processing_set_key, job_id)
        job_data["status"] = _status_to_str(JobStatus.PROCESSING)
        job_data["started_at"] = datetime.utcnow().isoformat()
        job_data["progress"] = 0.15
        job_data["stage"] = "loading_model"
        job_data["message"] = "Loading model on GPU..."
        _append_log(job_data, "loading_model", 0.15, "Loading model on GPU...")
        await self.redis.hset(self.jobs_hash_key, job_id, json.dumps(job_data))
        
        await self.redis.hset(self.progress_hash_key, job_id, "0.15")
        await self.redis.hset(self.stage_hash_key, job_id, "loading_model")
        await self.redis.hset(self.message_hash_key, job_id, "Loading model on GPU...")
        logger.info(f"[JOB STARTED] job_id={job_id} stage=loading_model progress=15% message='Loading model on GPU...'")

        # Reconstruct JobRequest (job_id is auto-generated, so we set it after)
        job_request = JobRequest(
            feature=job_data["feature"],
            inputs=json.loads(job_data["inputs"]),
            model_preference=job_data.get("model_preference") or None,
            priority=job_data.get("priority", 0),
            metadata=json.loads(job_data.get("metadata", "{}")),
            user_id=job_data.get("user_id") or None,  # Restore user_id
        )
        # Restore original job_id and created_at
        job_request.job_id = job_id
        job_request.created_at = datetime.fromisoformat(job_data["created_at"])
        job_request.status = JobStatus.PROCESSING
        job_request.progress = 0.15
        job_request.metadata.update({"stage": "loading_model", "message": "Loading model on GPU..."})
        if not await asyncio.to_thread(self.db_manager.save_job, job_request):
            raise RuntimeError(f"Failed to persist started job {job_id}")
        
        return job_request

    async def requeue_job(self, job_id: str, front: bool = True):
        """Put a job back into the pending queue.

        Args:
            job_id: The job to requeue.
            front: If True, place the job at the front of the queue (highest priority).
                If False, place it at the back of the queue (lowest priority).
        """
        if not self.redis:
            raise RuntimeError("Redis not connected")

        # Remove from processing set
        await self.redis.srem(self.processing_set_key, job_id)

        # Get job data to update status
        job_data_str = await self.redis.hget(self.jobs_hash_key, job_id)
        if job_data_str:
            job_data = json.loads(job_data_str)
            job_data["status"] = _status_to_str(JobStatus.QUEUED)
            job_data["started_at"] = ""
            job_data["progress"] = 0.0
            job_data["stage"] = "recovering"
            job_data["message"] = (
                "Requeued after worker busy; waiting for GPU worker."
                if not front
                else "Requeued to front; waiting for GPU worker."
            )
            await self.redis.hset(self.jobs_hash_key, job_id, json.dumps(job_data))

            priority = int(job_data.get("priority", 0))
            if front:
                # Put at the very front of the queue regardless of original timestamp.
                score = _priority_score(priority, datetime.min)
            else:
                # Put at the back of the queue using the current timestamp.
                score = _priority_score(priority, datetime.utcnow())
            await self.redis.zadd(self.pending_queue_key, {job_id: score})

    async def complete_job(self, job_id: str, result: Any):
        """Mark job as completed"""
        if not self.redis:
            raise RuntimeError("Redis not connected")

        # Remove from processing
        await self.redis.srem(self.processing_set_key, job_id)
        
        # Update job status
        job_data_str = await self.redis.hget(self.jobs_hash_key, job_id)
        if job_data_str:
            job_data = json.loads(job_data_str)
            job_data["status"] = _status_to_str(JobStatus.COMPLETED)
            job_data["completed_at"] = datetime.utcnow().isoformat()
            job_data["progress"] = 1.0
            job_data["stage"] = "completed"
            job_data["message"] = "Production asset is ready."
            _append_log(job_data, "completed", 1.0, "Production asset is ready.")
            await self.redis.hset(self.jobs_hash_key, job_id, json.dumps(job_data))
        logger.info(f"[JOB COMPLETE] job_id={job_id} progress=100% status=completed")
        job_request = await self._load_job_request_for_persistence(job_id)
        if job_request is not None:
            job_request.status = JobStatus.COMPLETED
            job_request.progress = 1.0
            job_request.result = result
            job_request.completed_at = datetime.utcnow()
            job_request.metadata.update({"stage": "completed", "message": "Production asset is ready."})
            await asyncio.to_thread(self.db_manager.save_job, job_request)

        # Redis remains a queue/cache; terminal history is durable in SQL.
        await self.redis.set(f"{self.results_prefix}{job_id}", json.dumps(result))

    async def update_job_result(self, job_id: str, result: Dict[str, Any]) -> bool:
        """Merge result metadata into an in-flight Redis job and durable SQL history."""
        if not self.redis:
            raise RuntimeError("Redis not connected")
        raw = await self.redis.hget(self.jobs_hash_key, job_id)
        if not raw:
            return False
        job_data = json.loads(raw)
        current = job_data.get("result") or {}
        if isinstance(current, str):
            current = json.loads(current)
        current.update(result)
        job_data["result"] = current
        await self.redis.hset(self.jobs_hash_key, job_id, json.dumps(job_data))
        job_request = await self._load_job_request_for_persistence(job_id)
        if job_request is not None:
            job_request.result = current
            if not await asyncio.to_thread(self.db_manager.save_job, job_request):
                return False
        return True

    async def update_completed_result(self, job_id: str, result: Dict[str, Any]) -> bool:
        """Merge background post-processing results into a completed Redis job."""
        if not self.redis:
            raise RuntimeError("Redis not connected")
        current_raw = await self.redis.get(f"{self.results_prefix}{job_id}") or "{}"
        current = json.loads(current_raw)
        current.update(result)
        await self.redis.set(f"{self.results_prefix}{job_id}", json.dumps(current), ex=86400)
        return True

    async def fail_job(self, job_id: str, error: str):
        """Mark job as failed"""
        if not self.redis:
            raise RuntimeError("Redis not connected")

        logger.error(f"[JOB FAILED] job_id={job_id} error={error}")

        # Remove from processing
        await self.redis.srem(self.processing_set_key, job_id)
        
        # Update job status
        job_data_str = await self.redis.hget(self.jobs_hash_key, job_id)
        if job_data_str:
            job_data = json.loads(job_data_str)
            failed_at = datetime.utcnow()
            job_data["status"] = _status_to_str(JobStatus.FAILED)
            job_data["error"] = error
            job_data["failed_at"] = failed_at.isoformat()
            job_data["stage"] = "failed"
            job_data["message"] = error
            job_data["error_code"] = classify_job_error(error)
            progress = float(job_data.get("progress", 0.0))
            _append_log(job_data, "failed", progress, error, "error")
            await self.redis.hset(self.jobs_hash_key, job_id, json.dumps(job_data))
            await self.redis.hset(self.progress_hash_key, job_id, str(progress))
            await self.redis.hset(self.stage_hash_key, job_id, "failed")
            await self.redis.hset(self.message_hash_key, job_id, error)
            await self.redis.zadd(self.completed_index_key, {job_id: failed_at.timestamp()})
            job_request = await self._load_job_request_for_persistence(job_id)
            if job_request is not None:
                job_request.status = JobStatus.FAILED
                job_request.progress = progress
                job_request.error = error
                job_request.completed_at = failed_at
                job_request.metadata.update({"stage": "failed", "message": error, "error_code": job_data["error_code"]})
                await asyncio.to_thread(self.db_manager.save_job, job_request)

    async def _load_job_request_for_persistence(self, job_id: str) -> Optional[JobRequest]:
        job_data_str = await self.redis.hget(self.jobs_hash_key, job_id)
        if not job_data_str:
            return None
        data = json.loads(job_data_str)
        job = JobRequest(
            feature=data["feature"],
            inputs=json.loads(data["inputs"]),
            model_preference=data.get("model_preference") or None,
            priority=data.get("priority", 0),
            metadata=json.loads(data.get("metadata", "{}")),
            user_id=data.get("user_id") or None,
        )
        job.job_id = job_id
        if data.get("created_at"):
            job.created_at = datetime.fromisoformat(data["created_at"])
        job.result = data.get("result")
        job.error = data.get("error")
        return job

    async def update_job_progress(self, job_id: str, progress: float, stage: Optional[str] = None, message: Optional[str] = None):
        """Update job progress and stage"""
        if not self.redis:
            return
        value = min(1.0, max(0.0, float(progress)))
        logger.info(f"[JOB PROGRESS] job_id={job_id} progress={int(value * 100)}% stage={stage or 'processing'} message='{message or ''}'")
        await self.redis.hset(self.progress_hash_key, job_id, str(value))
        if stage:
            await self.redis.hset(self.stage_hash_key, job_id, stage)
        if message:
            await self.redis.hset(self.message_hash_key, job_id, message)
        if stage or message:
            job_data_str = await self.redis.hget(self.jobs_hash_key, job_id)
            if job_data_str:
                job_data = json.loads(job_data_str)
                job_data["progress"] = value
                if stage:
                    job_data["stage"] = stage
                if message:
                    job_data["message"] = message
                _append_log(job_data, stage or "processing", value, message or "Processing")
                await self.redis.hset(self.jobs_hash_key, job_id, json.dumps(job_data))


    async def prepare_postprocess_retry(self, job_id: str) -> Optional[JobRequest]:
        """Move a failed/completed job back to processing for deterministic postprocess retry."""
        if not self.redis:
            raise RuntimeError("Redis not connected")
        
        job_data = await self.get_job(job_id)
        if not job_data or not job_data.get("result", {}).get("asset_root"):
            return None
            
        # Reconstruct JobRequest
        job = JobRequest(
            feature=job_data["feature"],
            inputs=job_data.get("inputs", {}),
            preferences=job_data.get("preferences", {}),
            priority=job_data.get("priority", 0)
        )
        job.id = job_data["id"]
        job.created_at = datetime.fromisoformat(job_data["created_at"]) if isinstance(job_data.get("created_at"), str) else job_data.get("created_at")
        job.status = JobStatus.PROCESSING
        job.progress = 0.0
        job.error = None
        job.metadata = job_data.get("metadata", {})
        job.metadata["stage"] = "postprocess"
        job.metadata["message"] = "Retrying production post-processing."
        job.result = job_data.get("result", {})
        
        # Update Redis
        pipe = self.redis.pipeline()
        pipe.hset(self.jobs_hash_key, job_id, json.dumps(job.to_dict()))
        pipe.hset(self.progress_hash_key, job_id, "0.0")
        pipe.hset(self.stage_hash_key, job_id, "postprocess")
        pipe.hset(self.message_hash_key, job_id, "Retrying production post-processing.")
        pipe.srem(f"{self.queue_prefix}:queue:failed", job_id)
        pipe.srem(f"{self.queue_prefix}:queue:completed", job_id)
        pipe.sadd(self.processing_set_key, job_id)
        await pipe.execute()
        
        # Save to DB
        await asyncio.to_thread(self.db_manager.save_job, job)
        return job

    async def get_job(self, job_id: str) -> Optional[Dict]:
        """Get job status and result"""
        if not self.redis:
            raise RuntimeError("Redis not connected")

        now = time.monotonic()
        should_log = (now - self._last_get_job_log.get(job_id, 0.0)) >= 15.0
        if should_log:
            self._last_get_job_log[job_id] = now
            if len(self._last_get_job_log) > 500:
                cutoff = now - 60.0
                self._last_get_job_log = {k: v for k, v in self._last_get_job_log.items() if v >= cutoff}
            logger.debug("get_job: looking up job_id=%s prefix=%s", job_id, self.queue_prefix)

        job_data_str = await self.redis.hget(self.jobs_hash_key, job_id)
        if not job_data_str:
            durable = await asyncio.to_thread(self.db_manager.get_job, job_id)
            return durable.to_dict() if durable else None
        if should_log:
            logger.debug("get_job: job_id=%s found", job_id)
        
        job_data = json.loads(job_data_str)
        hot_progress, hot_stage, hot_message = await asyncio.gather(
            self.redis.hget(self.progress_hash_key, job_id),
            self.redis.hget(self.stage_hash_key, job_id),
            self.redis.hget(self.message_hash_key, job_id),
        )
        if hot_progress is not None:
            job_data["progress"] = float(hot_progress)
        if hot_stage is not None:
            job_data["stage"] = hot_stage
        if hot_message is not None:
            job_data["message"] = hot_message
        
        # Parse nested JSON fields
        if "inputs" in job_data and isinstance(job_data["inputs"], str):
            job_data["inputs"] = json.loads(job_data["inputs"])
        if "metadata" in job_data and isinstance(job_data["metadata"], str):
            job_data["metadata"] = json.loads(job_data["metadata"])

        # Reads are side-effect free; progress remains owned by worker events.
        if job_data["status"] == _status_to_str(JobStatus.COMPLETED):
            result_str = await self.redis.get(f"{self.results_prefix}{job_id}")
            if result_str:
                job_data["result"] = json.loads(result_str)
        
        return job_data

    async def get_queue_status(self) -> Dict:
        """Get queue statistics"""
        if not self.redis:
            raise RuntimeError("Redis not connected")

        pending_count = await self.redis.zcard(self.pending_queue_key)
        processing_count = await self.redis.scard(self.processing_set_key)
        all_jobs = await self.redis.hgetall(self.jobs_hash_key)
        status_counts: Dict[str, int] = {}
        for raw in all_jobs.values():
            status = json.loads(raw).get("status", "")
            status_counts[status] = status_counts.get(status, 0) + 1

        max_queue_size = 1000
        logger.debug(
            "get_queue_status: prefix=%s pending=%s processing=%s status_counts=%s",
            self.queue_prefix,
            pending_count,
            processing_count,
            status_counts,
        )
        return {
            "queued_jobs": status_counts.get(_status_to_str(JobStatus.QUEUED), 0),
            "processing_jobs": status_counts.get(_status_to_str(JobStatus.PROCESSING), processing_count),
            "completed_jobs": status_counts.get(_status_to_str(JobStatus.COMPLETED), 0),
            "failed_jobs": status_counts.get(_status_to_str(JobStatus.FAILED), 0),
            "cancelled_jobs": status_counts.get(_status_to_str(JobStatus.CANCELLED), 0),
            "max_queue_size": max_queue_size,
            "queue_utilization": min(1.0, pending_count / max_queue_size),
        }

    async def cleanup_old_jobs(self):
        """Clean up old completed/failed jobs"""
        if not self.redis:
            raise RuntimeError("Redis not connected")

        cutoff_time = datetime.utcnow() - timedelta(hours=self.max_job_age_hours)
        
        cutoff_time = (datetime.utcnow() - timedelta(hours=self.max_job_age_hours)).timestamp()
        old_job_ids = await self.redis.zrangebyscore(
            self.completed_index_key, min="-inf", max=cutoff_time
        )

        deleted_count = 0
        for job_id in old_job_ids:
            retained_job = await self._load_job_request_for_persistence(job_id)
            cleanup_canonical_asset_workspace(retained_job.result if retained_job else None)
            await self.redis.hdel(self.jobs_hash_key, job_id)
            await self.redis.hdel(self.progress_hash_key, job_id)
            await self.redis.hdel(self.stage_hash_key, job_id)
            await self.redis.hdel(self.message_hash_key, job_id)
            await self.redis.delete(f"{self.results_prefix}{job_id}")
            await asyncio.to_thread(self.db_manager.delete_job, job_id)
            await self.redis.zrem(self.completed_index_key, job_id)
            deleted_count += 1
        
        if deleted_count > 0:
            logger.info(f"Cleaned up {deleted_count} old jobs from Redis")

    async def mark_job_started(self, job_id: str, model_id: str):
        """Mark job as started with model info"""
        if not self.redis:
            raise RuntimeError("Redis not connected")
        
        job_data_str = await self.redis.hget(self.jobs_hash_key, job_id)
        if job_data_str:
            job_data = json.loads(job_data_str)
            job_data["status"] = _status_to_str(JobStatus.PROCESSING)
            job_data["model_id"] = model_id
            job_data["started_at"] = datetime.utcnow().isoformat()
            job_data["progress"] = 0.25
            job_data["stage"] = "loading_model"
            job_data["message"] = f"Loading model {model_id} on GPU..."
            await self.redis.hset(self.jobs_hash_key, job_id, json.dumps(job_data))

    async def request_cancel(self, job_id: str) -> bool:
        """Request cancellation through the external scheduler service."""
        if not self.redis:
            raise RuntimeError("Redis not connected")
        job_data_str = await self.redis.hget(self.jobs_hash_key, job_id)
        if not job_data_str:
            return False
        status = json.loads(job_data_str).get("status")
        if status == _status_to_str(JobStatus.QUEUED):
            return await self.cancel_job(job_id)
        if status == _status_to_str(JobStatus.PROCESSING):
            await self.redis.sadd(self.cancel_request_key, job_id)
            return True
        return False

    async def get_cancel_requests(self) -> list[str]:
        if not self.redis:
            return []
        return list(await self.redis.smembers(self.cancel_request_key))

    async def clear_cancel_request(self, job_id: str) -> None:
        if self.redis:
            await self.redis.srem(self.cancel_request_key, job_id)

    async def cancel_job(self, job_id: str, force: bool = False) -> bool:
        """Cancel a queued job or a worker-already-stopped processing job."""
        if not self.redis:
            raise RuntimeError("Redis not connected")

        job_data_str = await self.redis.hget(self.jobs_hash_key, job_id)
        if not job_data_str:
            return False
        job_data = json.loads(job_data_str)
        status = job_data.get("status")
        if status == _status_to_str(JobStatus.PROCESSING) and not force:
            return False
        if status not in {
            _status_to_str(JobStatus.QUEUED),
            _status_to_str(JobStatus.PROCESSING),
        }:
            return False

        await self.redis.zrem(self.pending_queue_key, job_id)
        await self.redis.srem(self.processing_set_key, job_id)
        job_data["status"] = _status_to_str(JobStatus.CANCELLED)
        job_data["error"] = "Cancelled by user"
        job_data["error_code"] = "JOB_CANCELLED"
        completed_at = datetime.utcnow()
        job_data["completed_at"] = completed_at.isoformat()
        _append_log(job_data, "cancelled", float(job_data.get("progress", 0.0)), "Cancelled by user", "warning")
        await self.redis.hset(self.jobs_hash_key, job_id, json.dumps(job_data))
        await self.redis.srem(self.cancel_request_key, job_id)
        await self.redis.hset(self.stage_hash_key, job_id, "cancelled")
        await self.redis.hset(self.message_hash_key, job_id, "Cancelled by user")
        await self.redis.zadd(self.completed_index_key, {job_id: completed_at.timestamp()})
        return True

    # Compatibility methods for original JobQueue interface
    async def start_persistence(self):
        """Compatibility method: recover jobs stranded by the previous scheduler."""
        await self.recover_orphaned_jobs()

    async def recover_processing_jobs(self) -> int:
        """Compatibility alias: recover jobs stranded in processing state."""
        await self.recover_orphaned_jobs()
        return 0

    async def stop_persistence(self):
        """Compatibility method - Redis persistence is always active"""
        logger.debug("Redis persistence is always active, no action needed")
        pass

    async def cleanup_expired_jobs(self):
        """Compatibility hook; Redis cleanup is handled by TTL + retention sweep."""
        await self.cleanup_old_jobs()
        return []
    
    async def get_jobs_by_status(self, status: JobStatus) -> list:
        """Get all jobs with specified status (compatibility method)"""
        if not self.redis:
            raise RuntimeError("Redis not connected")
        
        target_status = _status_to_str(status)
        matching_jobs = []
        
        # Get all jobs from Redis
        all_jobs = await self.redis.hgetall(self.jobs_hash_key)
        
        for job_id, job_data_str in all_jobs.items():
            try:
                job_data = json.loads(job_data_str)
                if job_data.get("status") == target_status:
                    # Hot keys hold the live progress/stage/message written by workers
                    hot_progress, hot_stage, hot_message = await asyncio.gather(
                        self.redis.hget(self.progress_hash_key, job_id),
                        self.redis.hget(self.stage_hash_key, job_id),
                        self.redis.hget(self.message_hash_key, job_id),
                    )
                    if hot_progress is not None:
                        job_data["progress"] = float(hot_progress)
                    if hot_stage is not None:
                        job_data["stage"] = hot_stage
                    if hot_message is not None:
                        job_data["message"] = hot_message

                    # Reconstruct JobRequest for compatibility
                    job_request = JobRequest(
                        feature=job_data["feature"],
                        inputs=json.loads(job_data["inputs"]),
                        model_preference=job_data.get("model_preference") or None,
                        priority=job_data.get("priority", 0),
                        metadata=json.loads(job_data.get("metadata", "{}")),
                        user_id=job_data.get("user_id") or None,  # Restore user_id
                    )
                    job_request.job_id = job_id
                    job_request.created_at = datetime.fromisoformat(job_data["created_at"])
                    job_request.status = JobStatus(job_data["status"])
                    job_request.progress = float(job_data.get("progress", 0.0) or 0.0)
                    if job_data.get("error"):
                        job_request.error = job_data["error"]
                    if job_data.get("stage") is not None:
                        job_request.metadata["stage"] = job_data["stage"]
                    if job_data.get("message") is not None:
                        job_request.metadata["message"] = job_data["message"]
                    if job_data.get("completed_at"):
                        job_request.completed_at = datetime.fromisoformat(job_data["completed_at"])
                    if job_request.status == JobStatus.COMPLETED:
                        result_str = await self.redis.get(f"{self.results_prefix}{job_id}")
                        if result_str:
                            job_request.result = json.loads(result_str)
                    matching_jobs.append(job_request)
            except Exception as e:
                logger.error(f"Error parsing job {job_id}: {e}")
                continue
        
        return matching_jobs
    
    async def delete_job(self, job_id: str) -> bool:
        """Delete a job from Redis and database"""
        if not self.redis:
            raise RuntimeError("Redis not connected")
        
        try:
            # Remove from pending queue
            await self.redis.zrem(self.pending_queue_key, job_id)
            
            # Remove from processing set
            await self.redis.srem(self.processing_set_key, job_id)
            
            # Delete job data
            deleted_count = await self.redis.hdel(self.jobs_hash_key, job_id)
            
            # Delete auxiliary hot keys
            await self.redis.hdel(self.progress_hash_key, job_id)
            await self.redis.hdel(self.stage_hash_key, job_id)
            await self.redis.hdel(self.message_hash_key, job_id)
            await self.redis.zrem(self.completed_index_key, job_id)
            
            # Delete result if exists (string key; there is no results hash)
            await self.redis.delete(f"{self.results_prefix}{job_id}")
            self._last_get_job_log.pop(job_id, None)
            
            # Also delete from SQLite/DatabaseManager
            db_deleted = await asyncio.to_thread(self.db_manager.delete_job, job_id)
            
            if deleted_count > 0 or db_deleted:
                logger.info(f"Deleted job {job_id} (redis_deleted={deleted_count > 0}, db_deleted={db_deleted})")
                return True
            else:
                logger.warning(f"Job {job_id} not found in Redis or database")
                return False
        except Exception as e:
            logger.error(f"Error deleting job {job_id}: {e}")
            return False

