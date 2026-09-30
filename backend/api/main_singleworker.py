"""FastAPI application main entry point - Single Worker Mode

This is the standard deployment mode with scheduler embedded in FastAPI.
For multi-worker deployments, use api/main_multiworker.py with scheduler_service.py

Deployment:
    Single worker (recommended for simple deployments):
        uvicorn api.main:app --workers 1
"""

import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

try:
    import orjson
    from fastapi.responses import ORJSONResponse
    FastAPIResponse = ORJSONResponse
except ImportError:
    FastAPIResponse = JSONResponse

from core.config import get_settings, setup_logging #, create_directories
from core.scheduler import GPUMonitor
from core.scheduler.scheduler_factory import (
    create_development_scheduler,
    create_production_scheduler,
)
from core.utils.exceptions import BaseAPIException

from .routers import (
    auto_rigging,
    file_upload,
    mesh_editing,
    mesh_generation,
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
            ("GET /api/v1/system/jobs/" in msg or "GET /health" in msg or "GET /api/v1/system/status" in msg)
            and (" 200" in msg or " 304" in msg)
        )

# Global variables for shared resources
scheduler = None


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
            # allowed_hosts=["localhost", "127.0.0.1", settings.server.host]
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager"""
    global scheduler

    # Startup
    logger.info("Starting 3D Generative Models Backend (Single Worker Mode)...")

    try:
        # Load configuration
        settings = get_settings()

        # Setup logging
        setup_logging(settings.logging)
        logging.getLogger("uvicorn.access").addFilter(PollingEndpointFilter())

        # Create necessary directories
        # create_directories(settings.storage)

        # Initialize GPU monitor and scheduler
        gpu_monitor = GPUMonitor(memory_buffer=1024)  # Keep 1GB free

        # Use factory to create appropriate scheduler based on environment
        logger.info(f"Environment: {settings.environment}")
        if settings.environment == "production":
            logger.info("Creating production scheduler (multiprocess)")
            scheduler = create_production_scheduler(
                gpu_monitor=gpu_monitor,
                models_config=settings.models,
            )
        else:
            logger.info("Creating development scheduler (async)")
            scheduler = create_development_scheduler(
                gpu_monitor=gpu_monitor,
                models_config=settings.models,
            )

        # Note: The factory functions handle model registration automatically
        # when auto_register_models=True (which is the default)
        logger.info("Scheduler created with automatic model registration")

        # Start the scheduler
        await scheduler.start()

        # Store scheduler in app state for dependency injection
        app.state.scheduler = scheduler

        logger.info("Application startup completed successfully")

        yield

    except Exception as e:
        logger.error(f"Failed to start application: {str(e)}")
        raise

    finally:
        # Shutdown
        logger.info("Shutting down 3D Generative Models Backend...")

        # Cleanup resources
        if scheduler:
            await scheduler.stop()

        logger.info("Application shutdown completed")


# Create FastAPI application
app = FastAPI(
    title="ForMash 3D API",
    description="ForMash 3D — Generative 3D Asset Creation, Optimization & Game-Ready Pipeline",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    default_response_class=FastAPIResponse,
    lifespan=lifespan,
)

# Configure CORS, GZip, and security middleware
settings = get_settings()
configure_cors(app, settings)
configure_security(app, settings)
app.add_middleware(GZipMiddleware, minimum_size=1000)


# Add middleware
@app.middleware("http")
async def add_process_time_header(request: Request, call_next):
    """Add processing time header to responses"""
    start_time = time.time()
    response = await call_next(request)
    process_time = time.time() - start_time
    response.headers["X-Process-Time"] = str(process_time)
    return response


@app.middleware("http")
async def log_requests(request: Request, call_next):
    """Log requests with suppression of routine successful status polling"""
    start_time = time.time()
    path = request.url.path
    is_poll = path.startswith(("/health", "/api/v1/system/jobs", "/api/v1/system/status"))

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

app.include_router(file_upload.router, prefix="/api/v1", tags=["File Upload"])

app.include_router(mesh_generation.router, prefix="/api/v1", tags=["Mesh Generation"])

app.include_router(mesh_editing.router, prefix="/api/v1", tags=["Mesh Editing"])

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
app.mount("/static", StaticFiles(directory=str(_storage_mount_dir)), name="static")


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
        "description": "Scalable 3D AI model inference server",
        "docs_url": "/docs",
        "health_url": "/health",
    }
