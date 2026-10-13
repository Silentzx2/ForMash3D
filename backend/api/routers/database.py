"""Database administration endpoints (job queue, Redis inspector, destructive wipes).

Mounted at /api/v1/system/database. Every endpoint reuses the existing
dual-store job queue (Redis hot keys + SQLite durable rows) and the shared
file store; destructive operations require an explicit typed confirmation and
an admin user when authentication is active.
"""

import asyncio
import logging
import shutil
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request

from api.dependencies import get_current_user_optional, get_scheduler, verify_api_key

router = APIRouter()
logger = logging.getLogger(__name__)

# Job data namespaces owned by the app. User/token auth keys (3daigc:user*,
# 3daigc:token*, 3daigc:users:all) are deliberately excluded: a job-data wipe
# must never log users out or revoke API keys.
_JOB_KEY_PATTERNS = (
    "3daigc:jobs",
    "3daigc:progress",
    "3daigc:stage",
    "3daigc:message",
    "3daigc:queue:pending",
    "3daigc:queue:processing",
    "3daigc:queue:failed",
    "3daigc:queue:completed",
    "3daigc:completed_at",
    "3daigc:cancel_requested",
    "3daigc:result:*",
)
_FILE_KEY_PATTERNS = (
    "3daigc:file:*",
    "3daigc:files:*",
)

_TERMINAL_STATUSES = {"completed", "failed", "cancelled"}
_MAX_BULK_PAGES = 200


async def _admin_user(request: Request, _: bool = Depends(verify_api_key)):
    """Same trust boundary as the job-management endpoints: API key required,
    and admin role required whenever a user is authenticated."""
    from core.auth.models import UserRole

    current_user = await get_current_user_optional(
        request.headers.get("authorization"), request
    )
    if current_user and current_user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=403, detail="Admin access required for database operations"
        )
    return current_user


def _models_root() -> Path:
    return (_storage_root() / "models").resolve()


def _storage_root() -> Path:
    from core.utils.file_utils import get_storage_base_dir

    return Path(get_storage_base_dir()).resolve()


def _dir_size(path: Path, max_bytes: int = 64 * 1024 ** 3) -> int:
    total = 0
    try:
        for entry in path.rglob("*"):
            try:
                if entry.is_file():
                    total += entry.stat().st_size
            except OSError:
                continue
            if total > max_bytes:
                break
    except OSError:
        return 0
    return total


def _delete_tree(path: Path, must_be_under: Path) -> Optional[str]:
    """Remove a contained path (file, symlink, or directory); returns an error string instead of raising."""
    try:
        resolved_root = must_be_under.resolve()
        if not path.exists() and not path.is_symlink():
            return None
        if path.is_symlink():
            parent_resolved = path.parent.resolve()
            if parent_resolved != resolved_root and resolved_root not in parent_resolved.parents:
                return f"Refusing to delete path outside {resolved_root}: {path}"
            path.unlink()
            return None
        resolved = path.resolve()
    except OSError as exc:
        logger.warning("Database admin: failed to resolve/delete path %s: %s", path, exc)
        return "Failed to process workspace path"

    if resolved == resolved_root or resolved_root not in resolved.parents:
        return f"Refusing to delete path outside {resolved_root}: {resolved}"
    try:
        if resolved.is_dir():
            shutil.rmtree(resolved)
        else:
            resolved.unlink()
    except OSError as exc:
        logger.warning("Database admin: failed to remove path %s: %s", resolved, exc)
        return "Failed to delete workspace path"
    return None


async def _cancel_job_if_active(scheduler, job_id: str, status: Optional[str] = None) -> bool:
    """Cancel and drain an active job before deleting its record.
    Returns True if the job is terminal, was successfully cancelled, or is safe to delete.
    Returns False if an active worker cannot be stopped.
    """
    if status is None:
        job_status = await scheduler.get_job_status(job_id)
        status = (job_status or {}).get("status")

    if status not in ("queued", "processing"):
        return True

    cancel_fn = getattr(scheduler, "cancel_job", None)
    if not callable(cancel_fn):
        cancel_fn = getattr(getattr(scheduler, "job_queue", None), "cancel_job", None)

    if callable(cancel_fn):
        try:
            try:
                cancelled_ok = await cancel_fn(job_id, force=True)
            except TypeError:
                cancelled_ok = await cancel_fn(job_id)
        except Exception as exc:
            logger.warning("Database admin: cancel_job failed for %s: %s", job_id, exc)
            cancelled_ok = False

        if cancelled_ok:
            for _ in range(10):
                await asyncio.sleep(0.05)
                cur_status = await scheduler.get_job_status(job_id)
                if (cur_status or {}).get("status") in _TERMINAL_STATUSES:
                    return True
            return True

    # If cancel_fn returned False, check if the job is actively executing on a worker
    # vs an idle row in database.
    job_queue = getattr(scheduler, "job_queue", None)
    processing_cache = getattr(job_queue, "_processing_cache", None)
    if processing_cache is not None:
        if job_id not in processing_cache:
            return True
        return False

    redis_client = getattr(job_queue, "redis", None)
    if redis_client is not None:
        try:
            is_processing = await redis_client.sismember("3daigc:queue:processing", job_id)
            if not is_processing:
                return True
        except Exception:
            pass

    return False


async def _delete_job_with_workspace(scheduler, job_id: str) -> Dict[str, Any]:
    """Delete one job from both stores, then its canonical asset workspace.

    Mirrors DELETE /api/v1/system/jobs/{job_id}: the workspace is removed only
    after the durable record deletion succeeds, and the path is validated
    against the models root. Active jobs are cancelled before deletion.
    """
    job_status = await scheduler.get_job_status(job_id)
    if job_status is None:
        return {"job_id": job_id, "deleted": False, "reason": "not_found"}

    job_state = job_status.get("status")
    if job_state in ("queued", "processing"):
        stopped = await _cancel_job_if_active(scheduler, job_id, job_state)
        if not stopped:
            return {
                "job_id": job_id,
                "deleted": False,
                "reason": f"active_job_cannot_be_stopped (status={job_state})",
            }

    asset_root = (job_status.get("result") or {}).get("asset_root")
    success = await scheduler.job_queue.delete_job(job_id)
    if not success:
        return {"job_id": job_id, "deleted": False, "reason": "store_delete_failed"}

    cleanup_error = None
    workspace_deleted = False
    workspace_status = "not_recorded"
    if asset_root:
        root_path = Path(asset_root)
        if not root_path.exists():
            workspace_status = "missing"
            workspace_deleted = False
        else:
            cleanup_error = _delete_tree(root_path, _models_root())
            if cleanup_error is None:
                workspace_status = "deleted"
                workspace_deleted = True
            else:
                workspace_status = "failed"
                workspace_deleted = False
    else:
        workspace_status = "not_recorded"
        workspace_deleted = False

    return {
        "job_id": job_id,
        "deleted": True,
        "asset_workspace_deleted": workspace_deleted,
        "asset_workspace_status": workspace_status,
        "cleanup_error": cleanup_error,
    }


async def _collect_job_ids(scheduler, db_manager, status: Optional[str], feature: Optional[str]) -> List[str]:
    """Enumerate job ids from Redis first, then SQLite (authoritative fallback), applying selectors."""
    import json
    ids: List[str] = []
    seen = set()

    redis_client = getattr(scheduler.job_queue, "redis", None)
    if redis_client is not None:
        try:
            if status or feature:
                all_jobs = await redis_client.hgetall("3daigc:jobs")
                for job_id_raw, job_json in all_jobs.items():
                    job_id = job_id_raw.decode("utf-8") if isinstance(job_id_raw, bytes) else str(job_id_raw)
                    try:
                        data = json.loads(job_json)
                        if status and data.get("status") != status:
                            continue
                        if feature and data.get("feature") != feature:
                            continue
                        if job_id not in seen:
                            seen.add(job_id)
                            ids.append(job_id)
                    except Exception:
                        continue
            else:
                for job_id in await redis_client.hkeys("3daigc:jobs"):
                    job_id_str = job_id.decode("utf-8") if isinstance(job_id, bytes) else str(job_id)
                    if job_id_str not in seen:
                        seen.add(job_id_str)
                        ids.append(job_id_str)
        except Exception as exc:
            logger.warning("Database admin: Redis job enumeration failed: %s", exc)

    if db_manager is not None:
        offset = 0
        for _ in range(_MAX_BULK_PAGES):
            jobs, total = await asyncio.to_thread(
                db_manager.get_jobs_page,
                status=status,
                feature=feature,
                limit=500,
                offset=offset,
            )
            if not jobs:
                break
            for job in jobs:
                if job.job_id not in seen:
                    seen.add(job.job_id)
                    ids.append(job.job_id)
            offset += len(jobs)
            if offset >= total:
                break

    return ids


async def _filter_jobs_by_selector(
    scheduler, job_ids: List[str], status: Optional[str], feature: Optional[str]
) -> List[str]:
    """Filter job IDs by status and feature selectors by checking each job's actual status."""
    if not status and not feature:
        return job_ids

    filtered: List[str] = []
    for job_id in job_ids:
        job_status = await scheduler.get_job_status(job_id)
        if job_status is None:
            continue
        job_state = (job_status or {}).get("status")
        job_feat = (job_status or {}).get("feature")
        if status and job_state != status:
            continue
        if feature and job_feat != feature:
            continue
        filtered.append(job_id)
    return filtered


@router.get("/stats", summary="Database statistics across both stores")
async def database_stats(
    request: Request, scheduler=Depends(get_scheduler), admin=Depends(_admin_user)
):
    """SQLite row counts and file size, Redis key/memory footprint, file
    metadata counts and on-disk artifact sizes."""
    job_queue = scheduler.job_queue
    db_manager = getattr(job_queue, "db_manager", None)
    redis_client = getattr(job_queue, "redis", None)
    file_store = getattr(request.app.state, "file_store", None)

    sqlite_stats: Dict[str, Any] = {"available": db_manager is not None}
    if db_manager is not None:
        try:
            stats = await asyncio.to_thread(db_manager.get_queue_statistics)
            sqlite_stats.update(stats)
        except Exception as exc:
            sqlite_stats["error"] = str(exc)
        sqlite_stats["database_size_bytes"] = await asyncio.to_thread(
            db_manager.get_database_size_bytes
        )

    redis_stats: Dict[str, Any] = {"available": redis_client is not None}
    if redis_client is not None:
        try:
            info = await redis_client.info("memory")
            redis_stats["used_memory"] = info.get("used_memory")
            redis_stats["used_memory_human"] = info.get("used_memory_human")
            keyspace = await redis_client.info("keyspace")
            redis_stats["keys"] = sum(
                int(db.get("keys", 0)) for db in keyspace.values() if isinstance(db, dict)
            )
        except Exception as exc:
            redis_stats["error"] = str(exc)

    queue_stats: Dict[str, Any] = {}
    try:
        queue_stats = await job_queue.get_queue_status()
    except Exception as exc:
        queue_stats = {"error": str(exc)}

    file_stats: Dict[str, Any] = {"available": file_store is not None}
    if file_store is not None:
        try:
            file_stats["count"] = await file_store.count_files()
        except Exception as exc:
            file_stats["error"] = str(exc)

    storage = _storage_root()
    disk_stats = {
        "storage_root": str(storage),
        "job_queue_db_bytes": await asyncio.to_thread(
            db_manager.get_database_size_bytes
        )
        if db_manager is not None
        else 0,
        "meshes_bytes": await asyncio.to_thread(_dir_size, storage / "models" / "meshes"),
        "uploads_bytes": await asyncio.to_thread(_dir_size, storage / "uploads"),
    }

    return {
        "sqlite": sqlite_stats,
        "redis": redis_stats,
        "queue": queue_stats,
        "file_metadata": file_stats,
        "disk": disk_stats,
    }


@router.get("/keys", summary="Inspect Redis keys by pattern")
async def redis_keys(
    request: Request,
    pattern: str = Query("3daigc:*", description="Redis SCAN pattern"),
    limit: int = Query(500, ge=1, le=1000),
    scheduler=Depends(get_scheduler),
    admin=Depends(_admin_user),
):
    """Read-only Redis key inspector (SCAN-based, capped)."""
    redis_client = getattr(scheduler.job_queue, "redis", None)
    if redis_client is None:
        raise HTTPException(status_code=503, detail="Redis is not available")

    keys: List[Dict[str, Any]] = []
    truncated = False
    try:
        async for key in redis_client.scan_iter(match=pattern, count=200):
            if len(keys) >= limit:
                truncated = True
                break
            try:
                key_type = await redis_client.type(key)
                ttl = await redis_client.ttl(key)
                size = None
                if key_type == "hash":
                    size = await redis_client.hlen(key)
                elif key_type == "set":
                    size = await redis_client.scard(key)
                elif key_type == "zset":
                    size = await redis_client.zcard(key)
                elif key_type == "string":
                    size = await redis_client.strlen(key)
                keys.append({"key": key, "type": key_type, "size": size, "ttl": ttl})
            except Exception as exc:
                keys.append({"key": key, "error": str(exc)})
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to scan Redis keys: {exc}")

    return {"pattern": pattern, "keys": keys, "count": len(keys), "truncated": truncated}


@router.delete("/jobs", summary="Bulk delete jobs by ids, status, or feature")
async def delete_jobs(
    request: Request,
    payload: Dict[str, Any] = Body(...),
    scheduler=Depends(get_scheduler),
    admin=Depends(_admin_user),
):
    """Delete jobs from both stores plus their canonical asset workspaces.

    Body: {"job_ids": [...]} or {"status": "completed"} or {"feature": "..."}.
    Running jobs are skipped unless "force": true.
    """
    if not payload.get("confirm"):
        raise HTTPException(status_code=400, detail="Pass \"confirm\": true to delete jobs")

    job_queue = scheduler.job_queue
    db_manager = getattr(job_queue, "db_manager", None)

    job_ids: Optional[List[str]] = payload.get("job_ids")
    status = payload.get("status")
    feature = payload.get("feature")
    force = bool(payload.get("force"))

    if not job_ids and not status and not feature:
        raise HTTPException(
            status_code=400,
            detail="Provide job_ids, status, or feature to select jobs",
        )

    ids = job_ids if job_ids else await _collect_job_ids(scheduler, db_manager, status, feature)
    if not ids:
        return {"deleted": 0, "skipped": 0, "failed": 0, "results": []}

    # Apply status/feature selectors to all collected IDs (including Redis-sourced ones)
    ids = await _filter_jobs_by_selector(scheduler, ids, status, feature)
    if not ids:
        return {"deleted": 0, "skipped": 0, "failed": 0, "results": []}

    deleted = skipped = failed = 0
    results: List[Dict[str, Any]] = []
    for job_id in ids:
        job_status = await scheduler.get_job_status(job_id)
        job_state = (job_status or {}).get("status")
        if not force and job_state not in _TERMINAL_STATUSES and job_state is not None:
            skipped += 1
            results.append({"job_id": job_id, "deleted": False, "reason": f"status={job_state} (not terminal)"})
            continue
        result = await _delete_job_with_workspace(scheduler, job_id)
        results.append(result)
        if result["deleted"]:
            deleted += 1
        elif result.get("reason") == "not_found":
            skipped += 1
        else:
            failed += 1

    return {
        "deleted": deleted,
        "skipped": skipped,
        "failed": failed,
        "results": results,
    }


@router.post("/jobs/clear", summary="Clear every job and its asset workspace")
async def clear_all_jobs(
    request: Request,
    payload: Dict[str, Any] = Body(...),
    scheduler=Depends(get_scheduler),
    admin=Depends(_admin_user),
):
    """Wipe all jobs from Redis + SQLite and remove every job asset workspace.

    Requires {"confirm": "CLEAR_ALL_JOBS"}. Uploads and file metadata are kept.
    Active (queued/processing) jobs are cancelled first; jobs that cannot be
    stopped are reported and not deleted.
    """
    if payload.get("confirm") != "CLEAR_ALL_JOBS":
        raise HTTPException(
            status_code=400,
            detail='Pass {"confirm": "CLEAR_ALL_JOBS"} to clear every job',
        )

    job_queue = scheduler.job_queue
    db_manager = getattr(job_queue, "db_manager", None)
    redis_client = getattr(job_queue, "redis", None)

    ids = await _collect_job_ids(scheduler, db_manager, None, None)
    deleted = failed = 0
    cancelled = 0
    active_unresponsive: List[str] = []
    for job_id in ids:
        job_status = await scheduler.get_job_status(job_id)
        job_state = (job_status or {}).get("status")
        if job_state in ("queued", "processing"):
            stopped = await _cancel_job_if_active(scheduler, job_id, job_state)
            if not stopped:
                active_unresponsive.append(job_id)
                failed += 1
                continue
            cancelled += 1

        result = await _delete_job_with_workspace(scheduler, job_id)
        if result["deleted"]:
            deleted += 1
        else:
            failed += 1

    # Sweep any job-owned Redis keys that survived per-job deletion.
    swept = 0
    if redis_client is not None:
        for pattern in _JOB_KEY_PATTERNS:
            try:
                async for key in redis_client.scan_iter(match=pattern, count=200):
                    await redis_client.delete(key)
                    swept += 1
            except Exception as exc:
                logger.warning("Database admin: key sweep failed for %s: %s", pattern, exc)

    # Durable rows that never reached Redis (or vice versa).
    rows_deleted = 0
    if db_manager is not None:
        rows_deleted = await asyncio.to_thread(db_manager.delete_all_jobs)

    # Every top-level directory under models/meshes is a canonical job workspace.
    workspaces_removed = 0
    workspace_errors: List[str] = []
    meshes_root = _storage_root() / "models" / "meshes"
    if meshes_root.is_dir():
        for child in meshes_root.iterdir():
            if not child.is_dir():
                continue
            error = _delete_tree(child, meshes_root)
            if error:
                workspace_errors.append(f"{child.name}: {error}")
            else:
                workspaces_removed += 1

    # Reclaim the freed SQLite pages. VACUUM cannot run inside a transaction,
    # so the connection must switch to autocommit first.
    vacuum_error = None
    if db_manager is not None:
        try:
            def _vacuum() -> None:
                from sqlalchemy import text as sql_text

                with db_manager.engine.connect() as conn:
                    conn = conn.execution_options(isolation_level="AUTOCOMMIT")
                    conn.execute(sql_text("VACUUM"))

            await asyncio.to_thread(_vacuum)
        except Exception as exc:
            vacuum_error = "Database maintenance step failed"
            logger.warning("Database admin: VACUUM after clear failed: %s", exc)

    return {
        "jobs_deleted": deleted,
        "jobs_failed": failed,
        "jobs_cancelled": cancelled,
        "active_unresponsive": active_unresponsive,
        "redis_keys_swept": swept,
        "sqlite_rows_deleted": rows_deleted,
        "workspaces_removed": workspaces_removed,
        "workspace_errors": workspace_errors,
        "vacuum_error": vacuum_error,
        "message": "All job records and asset workspaces cleared. Uploads and file metadata are preserved.",
    }


@router.delete("/files/clear", summary="Clear all file metadata and uploads")
async def clear_all_files(
    request: Request,
    payload: Dict[str, Any] = Body(...),
    scheduler=Depends(get_scheduler),
    admin=Depends(_admin_user),
):
    """Wipe file metadata (Redis) and the referenced upload files on disk.

    Requires {"confirm": "CLEAR_ALL_FILES"}.
    """
    if payload.get("confirm") != "CLEAR_ALL_FILES":
        raise HTTPException(
            status_code=400,
            detail='Pass {"confirm": "CLEAR_ALL_FILES"} to clear file metadata and uploads',
        )

    file_store = getattr(request.app.state, "file_store", None)
    redis_client = getattr(scheduler.job_queue, "redis", None)
    storage = _storage_root()

    metadata_removed = 0
    upload_errors: List[str] = []

    if file_store is not None:
        try:
            all_file_ids: List[str] = []
            offset = 0
            batch_size = 1000
            while True:
                batch = await file_store.list_file_metadata(limit=batch_size, offset=offset)
                if not batch:
                    break
                for info in batch:
                    fid = getattr(info, "file_id", None) or (
                        info.get("file_id") if isinstance(info, dict) else None
                    )
                    if fid and fid not in all_file_ids:
                        all_file_ids.append(fid)
                offset += len(batch)
                if len(batch) < batch_size:
                    break

            for file_id in all_file_ids:
                try:
                    uploads = storage / "uploads"
                    for candidate in uploads.rglob(f"upload_{file_id}.*"):
                        error = _delete_tree(candidate, uploads)
                        if error:
                            upload_errors.append(f"{candidate.name}: {error}")
                    thumbnail = uploads / "thumbnails" / f"{file_id}.png"
                    if thumbnail.exists():
                        error = _delete_tree(thumbnail, uploads)
                        if error:
                            upload_errors.append(f"{thumbnail.name}: {error}")
                    if await file_store.delete_file_metadata(file_id):
                        metadata_removed += 1
                except Exception as exc:
                    upload_errors.append(f"{file_id}: {exc}")
        except Exception as exc:
            upload_errors.append(f"file_store listing failed: {exc}")

    # Redis-side cleanup even when the in-process file store is unavailable.
    redis_keys_swept = 0
    if redis_client is not None:
        for pattern in _FILE_KEY_PATTERNS:
            try:
                async for key in redis_client.scan_iter(match=pattern, count=200):
                    await redis_client.delete(key)
                    redis_keys_swept += 1
            except Exception as exc:
                logger.warning("Database admin: file key sweep failed for %s: %s", pattern, exc)

    # On-disk uploads left behind without metadata: clear every child of the
    # per-type directories (image/, mesh/, thumbnails/, ...) and loose files.
    uploads_root = storage / "uploads"
    if uploads_root.is_dir():
        for child in uploads_root.iterdir():
            if child.is_dir():
                for grandchild in child.iterdir():
                    error = _delete_tree(grandchild, uploads_root)
                    if error:
                        upload_errors.append(f"{grandchild.name}: {error}")
            else:
                error = _delete_tree(child, uploads_root)
                if error:
                    upload_errors.append(f"{child.name}: {error}")

    return {
        "file_metadata_removed": metadata_removed,
        "redis_keys_swept": redis_keys_swept,
        "errors": upload_errors,
        "message": "All file metadata and upload files cleared. Job records and assets are preserved.",
    }
