"""
FastAPI application main entry point - Multi-Worker Configuration

This version is designed for multi-worker deployment with a separate scheduler service.

Architecture:
    - Multiple FastAPI workers handle HTTP requests
    - Jobs are submitted to Redis queue
    - Separate scheduler service (scheduler_service.py) processes jobs
    
Deployment:
    1. Start Redis: docker run -d -p 6379:6379 redis:latest
    2. Start scheduler: python scripts/scheduler_service.py
    3. Start API: uvicorn api.main_multiworker:app --workers 4

Key Differences from main.py:
    - No scheduler creation (connects to external scheduler via Redis)
    - Redis-based job queue for cross-worker communication
    - Can safely run with multiple uvicorn workers
"""

import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse

from core.config import get_settings, setup_logging #, create_directories
from core.file_store import FileStore
from core.scheduler.redis_job_queue import RedisJobQueue
from core.utils.exceptions import BaseAPIException

from .routers import (
    auto_rigging,
    database,
    file_upload,
    mesh_editing,
    mesh_tools,
    mesh_generation,
    image_enhancement,
    smart_generation,
    mesh_retopology,
    mesh_segmentation,
    mesh_uv_unwrapping,
    motion_generation,
    system,
)

logger = logging.getLogger(__name__)


class PollingEndpointFilter(logging.Filter):
    """Filter out routine successful polling requests from access logs"""
    def filter(self, record: logging.LogRecord) -> bool:
        msg = record.getMessage()
        return not (
            (
                "GET /api/v1/system/jobs" in msg
                or "GET /health" in msg
                or "GET /api/v1/system/status" in msg
                or "/api/v1/system/logs" in msg
            )
            and (" 200" in msg or " 304" in msg)
        )

# Global variables for shared resources
redis_job_queue = None
file_store = None


# Configure CORS
def configure_cors(app: FastAPI, settings):
    """Configure CORS middleware"""
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.security.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["*"],
    )


# Configure security middleware
def configure_security(app: FastAPI, settings):
    """Configure security middleware"""
    if settings.environment == "production":
        app.add_middleware(
            TrustedHostMiddleware,
            allowed_hosts=["*"],
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager"""
    global redis_job_queue, file_store

    # Startup
    logger.info("Starting 3D Generative Models Backend (Multi-Worker Mode)...")

    try:
        # Load configuration
        settings = get_settings()

        # Setup logging
        setup_logging(settings.logging)
        logging.getLogger("uvicorn.access").addFilter(PollingEndpointFilter())

        # Create necessary directories
        # create_directories(settings.storage)

        # Connect to Redis job queue (shared with scheduler service)
        redis_url = getattr(settings, "redis_url", "redis://localhost:6379")
        logger.info(f"Connecting to Redis at {redis_url}")

        redis_job_queue = RedisJobQueue(
            redis_url=redis_url,
            queue_prefix="3daigc",
            max_job_age_hours=24,
        )
        await redis_job_queue.connect()

        # Store job queue in app state for dependency injection
        app.state.job_queue = redis_job_queue

        # Initialize file store for cross-worker file metadata sharing
        from redis.asyncio import Redis as AsyncRedis
        
        logger.info("Initializing Redis-based file store...")
        file_store_redis = AsyncRedis.from_url(
            redis_url,
            decode_responses=False,
            max_connections=20,
        )
        await file_store_redis.ping()
        file_store = FileStore(
            redis_client=file_store_redis,
            key_prefix="3daigc",
            default_ttl_seconds=None,  # use FILE_METADATA_TTL_SECONDS; default is persistent metadata
        )
        app.state.file_store = file_store
        logger.info("✓ File store initialized")

        logger.info("=" * 60)
        logger.info("✓ FastAPI worker startup completed successfully")
        logger.info("=" * 60)
        logger.info("This worker submits jobs to Redis queue")
        logger.info("Scheduler service processes jobs independently")
        logger.info(f"Debug mode: {'ENABLED' if settings.debug else 'DISABLED'}")
        logger.info("=" * 60)

        yield

    except Exception as e:
        logger.error(f"Failed to start application: {str(e)}")
        raise

    finally:
        # Shutdown
        logger.info("Shutting down 3D Generative Models Backend...")

        # Cleanup resources
        if redis_job_queue:
            try:
                await redis_job_queue.disconnect()
            except Exception as e:
                logger.warning(f"Error disconnecting Redis job queue: {e}")
            finally:
                redis_job_queue = None
        
        if file_store:
            try:
                await file_store.close()
            except Exception as e:
                logger.warning(f"Error disconnecting file store: {e}")
            finally:
                file_store = None

        logger.info("Application shutdown completed")


# Create FastAPI application
app = FastAPI(
    title="ForMesh 3D API",
    description="ForMesh 3D — Generative 3D Asset Creation, Optimization & Game-Ready Pipeline (Multi-Worker Mode)",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

# Configure CORS, GZip and security middleware
settings = get_settings()
configure_cors(app, settings)
configure_security(app, settings)
app.add_middleware(GZipMiddleware, minimum_size=1000)


# Add middleware
@app.middleware("http")
async def add_process_time_header(request: Request, call_next):
    """Add processing time header to responses"""
    start_time = time.time()
    if request.url.path.startswith("/api/"):
        from api.dependencies import apply_rate_limit
        limited_response = await apply_rate_limit(request, get_settings())
        if limited_response is not None:
            limited_response.headers["X-Process-Time"] = str(time.time() - start_time)
            return limited_response
    response = await call_next(request)
    process_time = time.time() - start_time
    response.headers["X-Process-Time"] = str(process_time)
    return response


@app.middleware("http")
async def log_requests(request: Request, call_next):
    """Log requests with suppression of routine successful status polling"""
    start_time = time.time()
    path = request.url.path
    is_poll = path.startswith((
        "/health",
        "/api/v1/system/jobs",
        "/api/v1/system/status",
        "/api/v1/system/logs",
    ))

    if not is_poll:
        logger.info(f"Request: {request.method} {request.url}")

    response = await call_next(request)

    process_time = time.time() - start_time
    if is_poll:
        if response.status_code >= 400:
            logger.warning(
                f"Polling issue: {response.status_code} - "
                f"{request.method} {path} - "
                f"Time: {process_time:.3f}s"
            )
        else:
            logger.debug(
                f"Response: {response.status_code} - "
                f"{request.method} {path} - "
                f"Time: {process_time:.3f}s"
            )
    else:
        logger.info(
            f"Response: {response.status_code} - "
            f"{request.method} {request.url} - "
            f"Time: {process_time:.3f}s"
        )

    return response


# Exception handlers
@app.exception_handler(BaseAPIException)
async def base_api_exception_handler(request: Request, exc: BaseAPIException):
    """Handle custom API exceptions"""
    return JSONResponse(
        status_code=400,
        content={
            "error": exc.error_code or "API_ERROR",
            "message": exc.message,
            "detail": str(exc),
        },
    )


@app.exception_handler(ValueError)
async def value_error_handler(request: Request, exc: ValueError):
    """Handle value errors"""
    return JSONResponse(
        status_code=400,
        content={
            "error": "INVALID_VALUE",
            "message": "Invalid input value",
            "detail": str(exc),
        },
    )


@app.exception_handler(404)
async def not_found_handler(request: Request, exc: HTTPException):
    """Handle 404 errors"""
    return JSONResponse(
        status_code=404,
        content={
            "error": "NOT_FOUND",
            "message": "Resource not found",
            "detail": str(exc.detail)
            if hasattr(exc, "detail")
            else "The requested resource was not found",
        },
    )


@app.exception_handler(500)
async def internal_error_handler(request: Request, exc: Exception):
    """Handle internal server errors"""
    logger.error(f"Internal server error: {str(exc)}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={
            "error": "INTERNAL_ERROR",
            "message": "An internal server error occurred",
            "detail": "Please try again later or contact support",
        },
    )


# Include routers
app.include_router(system.router, prefix="/api/v1/system", tags=["System"])
app.include_router(database.router, prefix="/api/v1/system/database", tags=["Database"])

app.include_router(file_upload.router, prefix="/api/v1", tags=["File Upload"])

app.include_router(mesh_generation.router, prefix="/api/v1", tags=["Mesh Generation"])
app.include_router(image_enhancement.router, prefix="/api/v1", tags=["Image Enhancement"])
app.include_router(smart_generation.router, prefix="/api/v1", tags=["Smart Generation"])

app.include_router(mesh_editing.router, prefix="/api/v1", tags=["Mesh Editing"])
app.include_router(mesh_tools.router, prefix="/api/v1", tags=["Mesh Tools"])

app.include_router(auto_rigging.router, prefix="/api/v1", tags=["Auto Rigging"])

app.include_router(
    mesh_segmentation.router, prefix="/api/v1", tags=["Mesh Segmentation"]
)

app.include_router(mesh_retopology.router, prefix="/api/v1", tags=["Mesh Retopology"])

app.include_router(
    mesh_uv_unwrapping.router, prefix="/api/v1", tags=["Mesh UV Unwrapping"]
)

app.include_router(
    motion_generation.router, prefix="/api/v1", tags=["Motion Generation"]
)


# Canonical storage static files mount (models, uploads, textures, previews)
try:
    from core.utils.file_utils import get_storage_base_dir
    _storage_mount_dir = get_storage_base_dir()
except Exception:
    _storage_mount_dir = Path(__file__).resolve().parents[1] / "storage"
_storage_mount_dir.mkdir(parents=True, exist_ok=True)


# Health check endpoint
@app.get("/health", tags=["Health"])
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "timestamp": time.time(), "version": "1.0.0"}


# Root endpoint
@app.get("/", tags=["Root"])
async def root():
    """Root endpoint with API information"""
    return {
        "name": "3D Generative Models API",
        "version": "1.0.0",
        "description": "Scalable 3D AI model inference server (Multi-Worker Mode)",
        "docs_url": "/docs",
        "health_url": "/health",
        "deployment_mode": "multi_worker",
        "note": "Jobs are processed by external scheduler service",
    }

