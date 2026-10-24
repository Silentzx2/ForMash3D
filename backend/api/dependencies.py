"""FastAPI dependencies for dependency injection"""

import hashlib
import logging
import secrets
import time
from typing import Any, Dict, Optional

from core.config import get_settings
from core.scheduler.job_queue import JobRequest
from fastapi import Depends, Header, HTTPException, Request
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)


class SchedulerAdapter:
    """
    Adapter that provides a consistent scheduler interface for both deployment modes.
    
    In single-worker mode: wraps the actual scheduler
    In multi-worker mode: wraps the Redis job queue and loads model info from settings
    """
    
    _cached_model_registry: Optional[Dict[str, Any]] = None
    _cached_model_features: Optional[Dict[str, Any]] = None

    def __init__(self, scheduler=None, job_queue=None, settings=None):
        self._scheduler = scheduler
        self._job_queue = job_queue
        self._settings = settings or get_settings()
        self._mode = "single_worker" if scheduler else "multi_worker"
        
        # In multi-worker mode, build or reuse model registry from settings
        if not scheduler and settings:
            if SchedulerAdapter._cached_model_registry is not None:
                self._model_registry = SchedulerAdapter._cached_model_registry
                self._model_features = SchedulerAdapter._cached_model_features
            else:
                self._model_features = {}  # feature -> [model_ids]
                self._model_registry = {}  # model_id -> config
                self._load_model_info_from_settings()
                SchedulerAdapter._cached_model_registry = self._model_registry
                SchedulerAdapter._cached_model_features = self._model_features
        else:
            self._model_features = {}
            self._model_registry = {}
    
    def _load_model_info_from_settings(self):
        """Load model information from settings (for multi-worker mode)"""
        try:
            from core.scheduler.model_factory import get_model_configs_from_settings
            
            model_configs = get_model_configs_from_settings(self._settings.models)
            
            for model_id, config in model_configs.items():
                self._model_registry[model_id] = config
                feature_type = config.get("feature_type")
                
                if feature_type:
                    if feature_type not in self._model_features:
                        self._model_features[feature_type] = []
                    self._model_features[feature_type].append(model_id)
            
            logger.info(f"Loaded {len(model_configs)} models from settings for multi-worker mode")
        except Exception as e:
            logger.error(f"Failed to load model info from settings: {e}")
    
    async def schedule_job(self, job_request: JobRequest) -> str:
        """Schedule a job (compatible with both modes)"""
        if self._scheduler:
            return await self._scheduler.schedule_job(job_request)
        elif self._job_queue:
            return await self._job_queue.enqueue(job_request)
        else:
            raise HTTPException(
                status_code=503,
                detail="Scheduler service is not available. Please check the service configuration."
            )
    
    async def get_job_status(self, job_id: str) -> Optional[Dict]:
        """Get job status (compatible with both modes)"""
        if self._scheduler:
            return await self._scheduler.get_job_status(job_id)
        else:
            return await self._job_queue.get_job(job_id)
    
    async def cancel_job(self, job_id: str) -> bool:
        """Cancel a job (compatible with both modes)"""
        if self._scheduler:
            return await self._scheduler.cancel_job(job_id)
        else:
            request_cancel = getattr(self._job_queue, "request_cancel", None)
            if callable(request_cancel):
                return await request_cancel(job_id)
            return await self._job_queue.cancel_job(job_id)
    
    async def get_system_status(self) -> Dict[str, Any]:
        """Get system status"""
        if self._scheduler:
            return await self._scheduler.get_system_status()
        else:
            # In multi-worker mode, return what we can from Redis and settings
            queue_status = await self._job_queue.get_queue_status()
            return {
                "scheduler": {
                    "type": "external_service",
                    "mode": "multi_worker",
                    "note": "Scheduler runs as separate service. GPU status not available via API.",
                    "num_registered_models": len(self._model_registry),
                },
                "queue": queue_status,
                "features": {
                    feature: len(models) 
                    for feature, models in self._model_features.items()
                },
                "gpu": {
                    "note": "GPU status only available from scheduler service",
                    "available": None
                }
            }
    
    def validate_model_preference(self, model_id: str, feature: str) -> bool:
        """Validate model preference"""
        if self._scheduler:
            return self._scheduler.validate_model_preference(model_id, feature)
        else:
            # In multi-worker mode, validate using our loaded model registry
            if not model_id:
                return True  # No preference is always valid
            
            # Check if model exists in registry
            if model_id not in self._model_registry:
                return False
            
            # Check if model supports the requested feature
            if feature not in self._model_features:
                return False
            
            return model_id in self._model_features[feature]
    
    def get_available_models(self, feature: Optional[str] = None) -> Dict[str, Any]:
        """Get available models"""
        if self._scheduler:
            return self._scheduler.get_available_models(feature)
        else:
            # In multi-worker mode, return from our loaded model registry
            if feature:
                return {feature: self._model_features.get(feature, [])}
            return dict(self._model_features)
    
    @property
    def mode(self) -> str:
        """Get deployment mode"""
        return self._mode
    
    @property
    def job_queue(self):
        """
        Get the underlying job queue.
        
        For compatibility with code that directly accesses scheduler.job_queue
        """
        if self._scheduler:
            return self._scheduler.job_queue
        else:
            return self._job_queue
    
    @property
    def job_queue(self):
        """Get the underlying job queue (for direct access when needed)"""
        if self._scheduler:
            return self._scheduler.job_queue
        else:
            return self._job_queue
    
    @property
    def model_configs(self) -> Dict[str, Dict[str, Any]]:
        """
        Get model configurations (for compatibility with code expecting scheduler.model_configs).
        
        Returns the model registry in both single-worker and multi-worker modes.
        """
        if self._scheduler:
            # Single-worker mode: get from actual scheduler
            return getattr(self._scheduler, 'model_configs', {})
        else:
            # Multi-worker mode: return our loaded registry
            return self._model_registry

async def get_current_settings():
    """Get current application settings"""
    return get_settings()

async def get_scheduler(request: Request):
    """
    Get a scheduler interface that works in both deployment modes.
    
    Returns a SchedulerAdapter that provides consistent methods whether running in:
    - Single-worker mode (scheduler embedded in FastAPI)
    - Multi-worker mode (separate scheduler service with Redis queue)
    
    In multi-worker mode, the adapter loads model information from settings,
    so clients can still query available models and validate model preferences.
    """
    settings = get_settings()
    
    # Try single-worker mode first
    scheduler = getattr(request.app.state, "scheduler", None)
    if scheduler is not None:
        return SchedulerAdapter(scheduler=scheduler, settings=settings)
    
    # Fall back to multi-worker mode with job queue
    job_queue = getattr(request.app.state, "job_queue", None)
    if job_queue is not None:
        return SchedulerAdapter(job_queue=job_queue, settings=settings)
    
    # Fall back to settings-backed adapter for model discovery & validation
    return SchedulerAdapter(settings=settings)


async def get_job_queue(request: Request):
    """
    Get the job queue instance from app state.
    
    This works in both modes:
    - Single-worker mode: Returns scheduler.job_queue
    - Multi-worker mode: Returns the Redis job queue directly
    """
    # Try to get scheduler first (single-worker mode)
    scheduler = getattr(request.app.state, "scheduler", None)
    if scheduler is not None:
        return scheduler.job_queue
    
    # Fall back to direct job_queue (multi-worker mode)
    job_queue = getattr(request.app.state, "job_queue", None)
    if job_queue is None:
        raise HTTPException(
            status_code=503,
            detail="Job queue is not available. Please try again later."
        )
    return job_queue


async def get_scheduler_or_queue(request: Request):
    """
    Get either scheduler or job queue, whichever is available.
    
    Returns a dict with 'mode', 'scheduler', and 'job_queue' keys.
    Use this for endpoints that need to work in both deployment modes.
    """
    scheduler = getattr(request.app.state, "scheduler", None)
    job_queue = getattr(request.app.state, "job_queue", None)
    
    if scheduler is not None:
        # Single-worker mode
        return {
            "mode": "single_worker",
            "scheduler": scheduler,
            "job_queue": scheduler.job_queue
        }
    elif job_queue is not None:
        # Multi-worker mode
        return {
            "mode": "multi_worker", 
            "scheduler": None,
            "job_queue": job_queue
        }
    else:
        raise HTTPException(
            status_code=503,
            detail="Neither scheduler nor job queue is available. Please check the service configuration."
        )

async def verify_api_key(
    authorization: Optional[str] = Header(None),
    request: Request = None,
    settings=Depends(get_current_settings),
):
    """Require a configured server key or a valid stored user token when enabled.

    A non-empty Bearer string is never treated as authentication by itself.
    """
    if not settings.security.api_key_required:
        return True

    if not authorization:
        raise HTTPException(
            status_code=401,
            detail="Authorization header missing",
            headers={"WWW-Authenticate": "Bearer"},
        )

    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer" or not parts[1]:
        raise HTTPException(
            status_code=401,
            detail="Invalid authorization format. Use 'Bearer <token>'.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = parts[1]
    configured_api_key = getattr(settings.security, "api_key", None)
    if configured_api_key and secrets.compare_digest(token, configured_api_key):
        return True

    if not configured_api_key:
        raise HTTPException(
            status_code=503,
            detail="API-key authentication is required but P3D_API_KEY is not configured.",
        )

    raise HTTPException(
        status_code=401,
        detail="Invalid bearer token.",
        headers={"WWW-Authenticate": "Bearer"},
    )


_RATE_LIMIT_LUA = """
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
end
return count
"""


def _rate_limit_redis_for_request(request: Request):
    """Reuse an existing shared Redis connection when the deployment has one."""
    app_state = request.app.state
    queue = getattr(app_state, "job_queue", None)
    if queue is None:
        scheduler = getattr(app_state, "scheduler", None)
        queue = getattr(scheduler, "job_queue", None)
    redis_client = getattr(queue, "redis", None) if queue is not None else None
    if redis_client is not None:
        return redis_client

    auth_service = getattr(app_state, "auth_service", None)
    storage = getattr(auth_service, "storage", None)
    return getattr(storage, "redis", None) if storage is not None else None


async def _rate_limit_result(request: Request, settings) -> Dict[str, Any]:
    """Consume one API request from a fixed 60-second bucket.

    Multi-worker mode reuses the existing Redis connection for a shared atomic
    counter. Single-worker mode uses process-local state. Only the immediate
    peer address is trusted; deployments behind a proxy must configure their
    ASGI server's trusted-proxy handling rather than trusting arbitrary XFF.
    """
    cached = getattr(request.state, "_formash_rate_limit_result", None)
    if cached is not None:
        return cached

    rate_limit_enabled = getattr(settings.security, "rate_limit_enabled", False)
    limit = int(getattr(settings.security, "rate_limit_per_minute", 0))
    if not rate_limit_enabled or limit <= 0:
        result = {
            "allowed": True,
            "limit": 0,
            "remaining": 0,
            "retry_after": 0,
        }
        request.state._formash_rate_limit_result = result
        return result

    now = time.time()
    window = int(now // 60)
    retry_after = max(1, 60 - int(now % 60))
    client = getattr(request, "client", None)
    client_ip = str(getattr(client, "host", None) or "unknown")
    client_hash = hashlib.sha256(client_ip.encode("utf-8")).hexdigest()[:32]
    redis_key = f"3daigc:api-rate-limit:{window}:{client_hash}"

    redis_client = _rate_limit_redis_for_request(request)
    if redis_client is not None:
        try:
            # The script ensures the first increment and TTL are atomic across workers.
            count = int(await redis_client.eval(_RATE_LIMIT_LUA, 1, redis_key, 120))
        except Exception as exc:
            logger.error("Shared API rate-limit store is unavailable; rejecting request.", exc_info=True)
            raise HTTPException(
                status_code=503,
                detail="API rate-limiting backend is unavailable; request was not processed.",
            ) from exc
    else:
        # Process-local fallback is safe only for the single-worker deployment;
        # multi-worker deployments use the shared Redis queue connection above.
        app_state = request.app.state
        counters = getattr(app_state, "_formash_rate_limit_counters", None)
        if counters is None:
            counters = {}
            app_state._formash_rate_limit_counters = counters
        # Keep the current and immediately previous window so concurrent requests
        # straddling a minute boundary cannot reset the new window's counters.
        for old_key in tuple(counters):
            if old_key[0] < window - 1:
                counters.pop(old_key, None)
        bucket_key = (window, client_hash)
        count = int(counters.get(bucket_key, 0)) + 1
        counters[bucket_key] = count

    result = {
        "allowed": count <= limit,
        "limit": limit,
        "remaining": max(0, limit - count),
        "retry_after": retry_after,
    }
    request.state._formash_rate_limit_result = result
    return result


async def apply_rate_limit(request: Request, settings=None):
    """FastAPI middleware hook; limits all API paths and returns a response when blocked."""
    if not request.url.path.startswith("/api/"):
        return None
    settings = settings or get_settings()
    if not getattr(settings.security, "rate_limit_enabled", False) or int(getattr(settings.security, "rate_limit_per_minute", 0)) <= 0:
        return None
    try:
        result = await _rate_limit_result(request, settings)
    except HTTPException as exc:
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": exc.detail},
            headers=exc.headers,
        )
    if not result["allowed"]:
        return JSONResponse(
            status_code=429,
            content={"detail": "API request rate limit exceeded."},
            headers={
                "Retry-After": str(result["retry_after"]),
                "X-RateLimit-Limit": str(result["limit"]),
                "X-RateLimit-Remaining": "0",
            },
        )
    return None


async def check_rate_limit(
    request: Request,
    settings=Depends(get_current_settings),
):
    """Dependency form of the same enforced rate limit, for route-level use."""
    if not getattr(settings.security, "rate_limit_enabled", False) or int(getattr(settings.security, "rate_limit_per_minute", 0)) <= 0:
        return True
    result = await _rate_limit_result(request, settings)
    if not result["allowed"]:
        raise HTTPException(
            status_code=429,
            detail="API request rate limit exceeded.",
            headers={
                "Retry-After": str(result["retry_after"]),
                "X-RateLimit-Limit": str(result["limit"]),
                "X-RateLimit-Remaining": "0",
            },
        )
    return True


async def get_file_store(request: Request):
    """
    Get the FileStore instance from app state.
    
    Returns the Redis-backed FileStore in multi-worker mode, or None in single-worker mode.
    The file_upload router handles both cases - using Redis when available, falling back
    to in-memory storage for single-worker mode.
    
    Returns:
        FileStore instance or None
    """
    return getattr(request.app.state, "file_store", None)

class CommonQueryParams:
    """Common query parameters for API endpoints"""
    def __init__(
        self,
        skip: int = 0,
        limit: int = 100,
        sort_by: Optional[str] = None,
        order: str = "asc"
    ):
        self.skip = skip
        self.limit = min(limit, 1000)  # Cap at 1000
        self.sort_by = sort_by
        self.order = order
