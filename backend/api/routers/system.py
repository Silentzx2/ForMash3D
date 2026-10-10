"""System management and health check endpoints"""

import asyncio
import json
import logging
import mimetypes
import os
import platform
import shutil
import tempfile
import time
import torch
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import psutil
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from starlette.background import BackgroundTask

from api.dependencies import get_current_settings, get_scheduler, verify_api_key
from core.scheduler.multiprocess_scheduler import MultiprocessModelScheduler
from core.utils.file_utils import encode_file_to_base64, get_file_size_mb

DEFAULT_MESH_THUMBNAIL_SVG = (
    '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">'
    '<rect width="256" height="256" fill="#181a20"/>'
    '<polygon points="128,48 208,94 128,140 48,94" fill="#2d3340" stroke="#f9cf00" stroke-width="3"/>'
    '<polygon points="48,94 128,140 128,212 48,166" fill="#232832" stroke="#f9cf00" stroke-width="3"/>'
    '<polygon points="208,94 128,140 128,212 208,166" fill="#1b1f27" stroke="#f9cf00" stroke-width="3"/>'
    '<text x="128" y="238" text-anchor="middle" fill="#94a3b8" font-family="monospace" font-size="12" font-weight="bold">3D ASSET</text>'
    '</svg>'
)

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/health", summary="Health check")
async def health_check():
    """Basic health check endpoint"""
    return {
        "status": "healthy",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "uptime": time.time(),
    }


@router.get("/auth-status", summary="Get authentication status")
async def get_auth_status(settings=Depends(get_current_settings)):
    """
    Get authentication and authorization status for the service.
    
    This endpoint is public (no authentication required) so clients can 
    determine whether they need to authenticate before making requests.
    
    Returns:
        - user_auth_enabled: Whether user authentication is enabled
        - api_key_required: Whether API key authentication is required
        - mode: Description of the authentication mode
    """
    return {
        "user_auth_enabled": settings.user_auth_enabled,
        "api_key_required": settings.security.api_key_required,
        "mode": "authenticated" if settings.user_auth_enabled else "simple",
        "description": (
            "User authentication enabled - Users can only see their own jobs"
            if settings.user_auth_enabled
            else "Simple mode - All clients can see all jobs"
        ),
        "features": {
            "job_isolation": settings.user_auth_enabled,
            "user_management": settings.user_auth_enabled,
            "role_based_access": settings.user_auth_enabled,
        },
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/info", summary="System information")
async def system_info(
    settings=Depends(get_current_settings), _: bool = Depends(verify_api_key)
):
    """Get system information"""
    return {
        "system": {
            "platform": platform.platform(),
            "python_version": platform.python_version(),
            "cpu_count": psutil.cpu_count(),
            "memory_total": psutil.virtual_memory().total,
            "memory_available": psutil.virtual_memory().available,
        },
        "application": {
            "version": "1.0.0",
            "environment": settings.environment,
            "debug": settings.debug,
        },
    }


@router.get("/status", summary="Detailed system status")
async def system_status(
    settings=Depends(get_current_settings), _: bool = Depends(verify_api_key)
):
    """Get detailed system status including GPU information"""

    # Basic system metrics (non-blocking delta calculation with interval for accurate reading)
    cpu_percent = psutil.cpu_percent(interval=0.1)
    memory = psutil.virtual_memory()
    disk = psutil.disk_usage("/")

    mesh_tools_status = {"status": "ready", "mode": "in_process", "routes_prefix": "/api/v1/mesh-tools"}
    try:
        import postprocess.services.auto_retopo  # noqa: F401
        import postprocess.services.auto_uv  # noqa: F401
        import postprocess.services.repair  # noqa: F401
        import postprocess.services.collision  # noqa: F401
    except Exception as exc:
        mesh_tools_status = {"status": "unavailable", "mode": "in_process", "routes_prefix": "/api/v1/mesh-tools", "error": str(exc)}

    status = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "system": {
            "cpu_usage": cpu_percent,
            "memory": {
                "total": memory.total,
                "available": memory.available,
                "used": memory.used,
                "percent": memory.percent,
            },
            "disk": {
                "total": disk.total,
                "free": disk.free,
                "used": disk.used,
                "percent": (disk.used / disk.total) * 100,
            },
        },
        "gpu": [],
        "models": {"loaded": 0, "available": 0, "total_vram_used": 0},
        "queue": {"pending_jobs": 0, "processing_jobs": 0, "completed_jobs": 0},
        "mesh_tools": mesh_tools_status,
    }

    # Try to get GPU information
    try:
        import GPUtil

        gpus = GPUtil.getGPUs()
        for gpu in gpus:
            status["gpu"].append(
                {
                    "id": gpu.id,
                    "name": gpu.name,
                    "memory_total": gpu.memoryTotal,
                    "memory_used": gpu.memoryUsed,
                    "memory_free": gpu.memoryFree,
                    "memory_utilization": gpu.memoryUtil,
                    "gpu_utilization": gpu.load,
                    "temperature": gpu.temperature,
                }
            )
    except ImportError:
        status["gpu"] = "GPU monitoring not available (GPUtil not installed)"
    except Exception as e:
        status["gpu"] = f"Error getting GPU info: {str(e)}"

    return status


@router.get("/stats", summary="Lightweight system stats for resource monitor")
async def system_stats(
    settings=Depends(get_current_settings), _: bool = Depends(verify_api_key)
):
    """Get lightweight system stats optimized for header resource monitor (5s refresh)"""
    
    cpu_percent = psutil.cpu_percent(interval=0.1)
    memory = psutil.virtual_memory()
    
    # Get GPU info for all GPUs
    gpus_info = []
    try:
        import GPUtil
        gpus = GPUtil.getGPUs()
        for gpu in gpus:
            gpus_info.append({
                "id": gpu.id,
                "name": gpu.name,
                "memory_total_mb": gpu.memoryTotal,
                "memory_used_mb": gpu.memoryUsed,
                "memory_util": gpu.memoryUtil,  # 0-1
                "load": gpu.load,  # 0-1
                "temperature": gpu.temperature,
            })
    except Exception:
        pass  # GPU monitoring not available
    
    # Calculate totals for collapsed view
    total_vram_used_gb = sum(gpu["memory_used_mb"] for gpu in gpus_info) / 1024
    total_vram_total_gb = sum(gpu["memory_total_mb"] for gpu in gpus_info) / 1024
    avg_vram_percent = (total_vram_used_gb / total_vram_total_gb * 100) if total_vram_total_gb > 0 else 0.0
    
    # For backward compatibility, keep single GPU fields (first GPU or defaults)
    primary_gpu = gpus_info[0] if gpus_info else None
    gpu_percent = primary_gpu["load"] * 100 if primary_gpu else 0.0
    vram_used_gb = primary_gpu["memory_used_mb"] / 1024 if primary_gpu else 0.0
    vram_total_gb = primary_gpu["memory_total_mb"] / 1024 if primary_gpu else 0.0
    vram_percent = primary_gpu["memory_util"] * 100 if primary_gpu else 0.0
    gpu_name = primary_gpu["name"] if primary_gpu else "Unknown"
    gpu_temp_c = primary_gpu["temperature"] if primary_gpu else None
    
    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "cpu_percent": cpu_percent,
        "ram_used_gb": memory.used / (1024**3),
        "ram_total_gb": memory.total / (1024**3),
        "ram_percent": memory.percent,
        "gpu_percent": gpu_percent,
        "vram_used_gb": vram_used_gb,
        "vram_total_gb": vram_total_gb,
        "vram_percent": vram_percent,
        "gpu_name": gpu_name,
        "gpu_temp_c": gpu_temp_c,
        # New fields for multiple GPUs
        "gpus": gpus_info,
        "total_vram_used_gb": total_vram_used_gb,
        "total_vram_total_gb": total_vram_total_gb,
        "avg_vram_percent": avg_vram_percent,
    }


@router.get("/models/{model_id}/parameters", summary="Get model parameters")
async def get_model_parameters(
    model_id: str,
    scheduler: MultiprocessModelScheduler = Depends(get_scheduler),
    _: bool = Depends(verify_api_key)
):
    """
    Get parameter schema for a specific model.
    
    Returns JSON Schema describing all model-specific parameters including:
    - Parameter types, defaults, constraints
    - Descriptions and validation rules
    
    Args:
        model_id: The model identifier (e.g., "trellis2_image_to_textured_mesh")
    
    Returns:
        Parameter schema dictionary with parameter specifications
    """
    try:
        # Get model configs from scheduler
        model_configs = scheduler.model_configs
        
        if model_id not in model_configs:
            raise HTTPException(
                status_code=404,
                detail=f"Model '{model_id}' not found. Available models: {list(model_configs.keys())}"
            )
        
        model_config = model_configs[model_id]
        
        # Instantiate model temporarily to get schema
        from core.scheduler.model_factory import ModelFactory
        
        try:
            model_instance = ModelFactory.create_model_from_config(model_config)
            schema = model_instance.get_parameter_schema()
            
            return {
                "model_id": model_id,
                "feature_type": model_config.get("feature_type"),
                "vram_requirement": model_config.get("vram_requirement"),
                "schema": schema,
                "timestamp": datetime.now(timezone.utc).isoformat()
            }
        except ImportError as e:
            logger.error(f"Model adapter not found for {model_id}: {e}")
            raise HTTPException(
                status_code=500,
                detail=f"Model adapter not found: {str(e)}"
            )
        except Exception as e:
            logger.error(f"Failed to get parameters for model {model_id}: {e}")
            raise HTTPException(
                status_code=500,
                detail=f"Failed to get parameters for model: {str(e)}"
            )
    except HTTPException:
        raise
    except KeyError as e:
        # Handle missing model config specifically
        logger.error(f"Model config key error for {model_id}: {e}")
        raise HTTPException(
            status_code=404,
            detail=f"Model '{model_id}' configuration not found"
        )
    except Exception as e:
        logger.error(f"Error getting model parameters: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Internal server error: {str(e)}"
        )


def _resolve_manifest_path(model_path: Optional[str]) -> Optional[Path]:
    if not model_path:
        return None
    path = Path(model_path).expanduser()
    if path.is_absolute():
        return path if path.exists() else None

    repo_root = Path(__file__).resolve().parents[3]
    
    candidates = [
        repo_root / path,
        repo_root / "backend" / path,
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate.resolve()
    return None


def _is_model_weights_available(model_config: Any) -> bool:
    """Check manifest files or a minimally complete local model directory."""
    path = _resolve_manifest_path(getattr(model_config, "model_path", None))
    if path is None:
        return False
    try:
        if path.is_file():
            return path.stat().st_size > 0
        if not path.is_dir():
            return False

        checkpoint_suffixes = {
            ".safetensors", ".ckpt", ".pt", ".pth", ".bin", ".onnx", ".engine"
        }
        model_descriptors = {"config.json", "config.yaml", "model_index.json", "pipeline.json"}

        # Known model weight file signatures for models without a config.json/yaml
        known_signatures = (
            "triposf", "mp_rank", "hunyuan", "partpacker", "ultrashape",
            "fastmesh", "objaverse", "p3sam", "model.ckpt", "trellis"
        )

        has_checkpoint = False
        has_descriptor = False
        has_known_model_file = False

        for item in path.rglob("*"):
            if not item.is_file() or item.stat().st_size == 0:
                continue
            if item.name.endswith(".incomplete"):
                continue
            item_lower = item.name.lower()
            if item.suffix.lower() in checkpoint_suffixes:
                has_checkpoint = True
                if any(sig in item_lower for sig in known_signatures):
                    has_known_model_file = True
            if item_lower in model_descriptors:
                has_descriptor = True

        if has_known_model_file and has_checkpoint:
            return True
        if has_checkpoint and has_descriptor:
            return True
        return False
    except OSError:
        return False


def _model_supports_download(model_id: str) -> bool:
    return any(
        token in model_id
        for token in (
            "trellis", "triposr", "triposg", "triposf", "zero123plus",
            "hunyuan", "partpacker", "ultrashape", "partfield", "fastmesh", "unique3d"
        )
    )


@router.get("/models", summary="List available models")
async def list_models(
    feature: Optional[str] = None,
    settings=Depends(get_current_settings),
    _: bool = Depends(verify_api_key),
):
    """List available models and their runtime readiness/capabilities."""
    available_models = settings.list_available_models()
    weights_status = {}
    model_details = {}
    cuda_available = False
    try:
        import torch
        cuda_available = bool(torch.cuda.is_available())
    except Exception:
        cuda_available = False

    for feat, mlist in available_models.items():
        for mid in mlist:
            cfg = settings.models.get(feat, {}).get(mid)
            weights_ok = bool(cfg and _is_model_weights_available(cfg))
            weights_status[mid] = weights_ok
            downloadable = _model_supports_download(mid)
            model_details[mid] = {
                "id": mid,
                "feature": feat,
                "status": (
                    "weights_missing" if not weights_ok
                    else "gpu_unavailable" if not cuda_available
                    else "ready"
                ),
                "weights_available": weights_ok,
                "weights_downloadable": downloadable,
                "readiness_reason": (
                    "ready" if weights_ok and cuda_available
                    else "GPU/CUDA unavailable" if weights_ok and not cuda_available
                    else "local checkpoint missing; download or install model weights"
                ),
                "cuda_available": cuda_available,
                "vram_requirement": getattr(cfg, "vram_requirement", None) if cfg else None,
                "max_workers": getattr(cfg, "max_workers", None) if cfg else None,
                "supported_inputs": getattr(cfg, "supported_inputs", []) if cfg else [],
                "supported_outputs": getattr(cfg, "supported_outputs", []) if cfg else [],
                "model_path": getattr(cfg, "model_path", None) if cfg else None,
                "capabilities": getattr(cfg, "capabilities", {}) if cfg else {},
            }

    if feature:
        if feature in available_models:
            return {
                "api_version": "1",
                "feature": feature,
                "models": available_models[feature],
                "weights_status": {mid: weights_status[mid] for mid in available_models[feature]},
                "model_details": {mid: model_details[mid] for mid in available_models[feature]},
            }
        raise HTTPException(status_code=404, detail=f"Feature '{feature}' not found")

    return {
        "api_version": "1",
        "available_models": available_models,
        "weights_status": weights_status,
        "model_details": model_details,
        "total_features": len(available_models),
        "total_models": sum(len(models) for models in available_models.values()),
    }

@router.get("/features", summary="List supported features")
async def list_features(settings=Depends(get_current_settings)):
    """List all supported features"""
    available_models = settings.list_available_models()

    features = []
    for feature_name, models in available_models.items():
        features.append(
            {"name": feature_name, "model_count": len(models), "models": models}
        )

    return {"features": features, "total_features": len(features)}


@router.post("/shutdown", summary="Shutdown server")
async def shutdown_server(_: bool = Depends(verify_api_key)):
    """Shutdown the server (admin only)"""
    # This should only be available in development or with proper authentication
    import os
    import signal

    # Graceful shutdown
    os.kill(os.getpid(), signal.SIGTERM)

    return {"message": "Server shutdown initiated"}


@router.post("/logs", summary="Log client-side activity")
async def post_client_log(request: Request):
    """Receive and record client-side activity events"""
    try:
        data = await request.json()
        logger.info(f"Client activity: {data.get('type', 'event')} - {data.get('detail', '')}")
        return {"status": "ok"}
    except Exception:
        return {"status": "ok"}


@router.get("/logs", summary="Get recent logs")
async def get_logs(
    lines: int = Query(100, description="Number of recent lines to return"),
    level: Optional[str] = Query(
        None, description="Filter by log level (DEBUG, INFO, WARNING, ERROR, CRITICAL)"
    ),
    logger_name: Optional[str] = Query(None, description="Filter by logger name"),
    since: Optional[str] = Query(
        None, description="Filter logs since timestamp (ISO format)"
    ),
    _: bool = Depends(verify_api_key),
):
    """Get recent log entries from the canonical master.log."""

    try:
        repo_root = Path(__file__).resolve().parents[3]
        logs_dir = repo_root / "logs"
        logs_dir.mkdir(parents=True, exist_ok=True)
        master_log = logs_dir / "master.log"
        master_log.touch(exist_ok=True)
        existing_log_dirs = [logs_dir]
        log_files = [master_log]

        # Read extra lines before applying timestamp/level/logger filters.
        per_file_lines = max(lines * 2, 100)

        # Collect log entries from all files
        all_entries = []
        for log_file in log_files:
            try:
                recent_lines = _tail_file_lines(log_file, per_file_lines)
                for line in recent_lines:
                    line = line.strip()
                    if not line:
                        continue
                    # Parse log entry
                    log_entry = _parse_log_line(line)
                    # Add a parsed timestamp for sorting (if parsing fails, use far past)
                    ts_str = log_entry.get("timestamp", "")
                    try:
                        # Try to parse ISO format with optional timezone
                        if ts_str:
                            # Remove trailing Z and convert to offset-aware if needed
                            if ts_str.endswith('Z'):
                                ts_str = ts_str[:-1] + '+00:00'
                            parsed_ts = datetime.fromisoformat(ts_str)
                        else:
                            parsed_ts = datetime.min
                    except Exception:
                        parsed_ts = datetime.min
                    log_entry["_parsed_timestamp"] = parsed_ts
                    all_entries.append(log_entry)
            except Exception as e:
                # If reading a particular file fails, we skip it but continue with others
                logger.warning(f"Failed to read log file {log_file}: {str(e)}")
                continue

        if not all_entries:
            return {
                "message": "No log entries found in log files",
                "logs": [],
                "available_files": [f.name for f in log_files],
                "directories_searched": [str(d) for d in existing_log_dirs],
            }

        # Apply filters: level, logger_name, since
        filtered_entries = []
        since_dt = None
        if since:
            try:
                if since.endswith('Z'):
                    since = since[:-1] + '+00:00'
                since_dt = datetime.fromisoformat(since)
            except Exception:
                # If since cannot be parsed, ignore the filter
                pass

        for entry in all_entries:
            # Level filter
            if level and entry.get("level") != level.upper():
                continue
            # Logger name filter
            if logger_name and logger_name not in entry.get("logger", ""):
                continue
            # Since filter
            if since_dt:
                entry_ts = entry.get("_parsed_timestamp")
                if entry_ts and entry_ts < since_dt:
                    continue
            filtered_entries.append(entry)

        # Sort by parsed timestamp descending (newest first)
        filtered_entries.sort(key=lambda x: x.get("_parsed_timestamp", datetime.min), reverse=True)

        # Take the most recent 'lines' entries
        final_entries = filtered_entries[:lines]

        # Remove the temporary _parsed_timestamp field from the output
        for entry in final_entries:
            entry.pop("_parsed_timestamp", None)

        return {
            "logs": final_entries,
            "total_entries": len(filtered_entries),
            "available_files": [f.name for f in log_files],
            "directories_searched": [str(d) for d in existing_log_dirs],
            "filters_applied": {
                "lines": lines,
                "level": level,
                "logger_name": logger_name,
                "since": since,
            },
        }

    except Exception as e:
        logger.error(f"Error retrieving logs: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error retrieving logs: {str(e)}")


@router.get("/logs/stream", summary="Stream logs via SSE")
async def stream_logs(
    last_n: int = Query(200, description="Number of recent lines to include initially"),
    _: bool = Depends(verify_api_key),
):
    """Stream the canonical master.log over SSE with 15-second heartbeats."""
    import asyncio
    from fastapi.responses import StreamingResponse

    project_root = Path(__file__).resolve().parents[3]
    log_path = project_root / "logs" / "master.log"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    log_path.touch(exist_ok=True)

    async def event_generator():
        process = await asyncio.create_subprocess_exec(
            "tail", "-n", str(last_n), "-f", str(log_path),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        try:
            while True:
                try:
                    line = await asyncio.wait_for(process.stdout.readline(), timeout=15.0)
                    if not line:
                        break
                    text = line.decode("utf-8", errors="replace").rstrip("\n\r")
                    if text:
                        yield f"data: {text}\n\n"
                except asyncio.TimeoutError:
                    # Heartbeat to keep SSE connection alive
                    yield ": heartbeat\n\n"
        finally:
            try:
                process.terminate()
            except Exception:
                pass

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


def _tail_file_lines(file_path: Path, max_lines: int) -> list:
    """Efficiently read the last N lines from a file without loading the entire file into memory."""
    if not file_path.exists():
        return []
    file_size = file_path.stat().st_size
    if file_size == 0:
        return []

    # Read from end of file based on estimated line length (~200b per log line)
    buffer_size = min(file_size, max(4096, max_lines * 512))
    try:
        with open(file_path, "rb") as f:
            f.seek(max(0, file_size - buffer_size))
            data = f.read().decode("utf-8", errors="replace")
            lines = data.splitlines()
            if len(lines) >= max_lines or buffer_size >= file_size:
                return lines[-max_lines:]
            # If log lines were unusually long and we got fewer lines than requested, read entire file
            f.seek(0)
            return f.read().decode("utf-8", errors="replace").splitlines()[-max_lines:]
    except Exception:
        return []


def _parse_log_line(line: str) -> dict:
    """Parse a log line into structured data"""
    try:
        # Default log format: "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
        # Example: "2024-01-01 12:00:00,000 - mylogger - INFO - This is a message"

        parts = line.split(" - ", 3)
        if len(parts) >= 4:
            timestamp_str = parts[0]
            logger_name = parts[1]
            level = parts[2]
            message = parts[3]

            return {
                "timestamp": timestamp_str,
                "logger": logger_name,
                "level": level,
                "message": message,
                "raw": line,
            }
        else:
            # Fallback for non-standard format
            return {
                "timestamp": "",
                "logger": "unknown",
                "level": "INFO",
                "message": line,
                "raw": line,
            }
    except Exception:
        # If parsing fails, return raw line
        return {
            "timestamp": "",
            "logger": "unknown",
            "level": "INFO",
            "message": line,
            "raw": line,
        }


@router.get("/logs/files", summary="List the master log")
async def list_log_files(_: bool = Depends(verify_api_key)):
    """Return the single canonical runtime log file."""
    logs_dir = Path(__file__).resolve().parents[3] / "logs"
    logs_dir.mkdir(parents=True, exist_ok=True)
    master_log = logs_dir / "master.log"
    master_log.touch(exist_ok=True)
    stat = master_log.stat()
    return {
        "files": [{
            "name": master_log.name,
            "path": str(master_log),
            "size_bytes": stat.st_size,
            "size_mb": round(stat.st_size / (1024 * 1024), 2),
            "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
            "created": datetime.fromtimestamp(stat.st_ctime).isoformat(),
        }],
        "total_files": 1,
    }


@router.get("/logs/files/{filename}", summary="Get master log contents")
async def get_log_file(
    filename: str,
    lines: int = Query(100, description="Number of recent lines to return"),
    _: bool = Depends(verify_api_key),
):
    """Read recent entries from the canonical master log."""
    if filename != "master.log":
        raise HTTPException(status_code=404, detail="Only master.log is retained")

    log_file = Path(__file__).resolve().parents[3] / "logs" / "master.log"
    log_file.parent.mkdir(parents=True, exist_ok=True)
    log_file.touch(exist_ok=True)
    entries = [
        _parse_log_line(line.strip())
        for line in _tail_file_lines(log_file, lines)
        if line.strip()
    ]
    stat = log_file.stat()
    return {
        "filename": log_file.name,
        "logs": entries,
        "total_entries": len(entries),
        "file_info": {
            "size_bytes": stat.st_size,
            "size_mb": round(stat.st_size / (1024 * 1024), 2),
            "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
            "lines_requested": lines,
            "total_lines_returned": len(entries),
        },
    }


@router.delete("/logs/files/{filename}", summary="Clear master log")
async def delete_log_file(filename: str, _: bool = Depends(verify_api_key)):
    """Clear master.log in place so active process file handles remain valid."""
    if filename != "master.log":
        raise HTTPException(status_code=404, detail="Only master.log is retained")

    log_file = Path(__file__).resolve().parents[3] / "logs" / "master.log"
    log_file.parent.mkdir(parents=True, exist_ok=True)
    with log_file.open("w", encoding="utf-8"):
        pass
    return {"message": "Master log cleared", "cleared_file": log_file.name}


@router.get("/scheduler-status", summary="Get scheduler status")
async def get_scheduler_status(request: Request):
    """Get detailed scheduler and model status"""
    try:
        scheduler = await get_scheduler(request)
        status = await scheduler.get_system_status()

        return {
            "scheduler": {
                "running": True,
                "queue_status": status.get("queue", {}),
                "gpu_status": status.get("gpu", []),
                "models": status.get("models", {}),
                "features": status.get("features", {}),
            },
            "adapters_registered": len(status.get("models", {})),
            "active_jobs": status.get("queue", {}).get("processing_jobs", 0),
            "queued_jobs": status.get("queue", {}).get("queued_jobs", 0),
            "completed_jobs": status.get("queue", {}).get("completed_jobs", 0),
        }
    except Exception as e:
        return {"scheduler": {"running": False, "error": str(e)}}


@router.get("/jobs/queue/stats", summary="Get job queue statistics")
async def get_queue_stats(
    scheduler: MultiprocessModelScheduler = Depends(get_scheduler),
):
    """
    Get current job queue statistics including pending jobs count.
    
    Returns detailed statistics about the job queue including:
    - Number of pending (queued) jobs
    - Number of processing jobs
    - Number of completed jobs
    - Queue utilization
    
    Works in both single-worker and multi-worker deployment modes.
    """
    try:
        queue_status = await scheduler.job_queue.get_queue_status()
        
        return {
            "success": True,
            "data": {
                "pending_jobs": queue_status.get("queued_jobs", queue_status.get("pending", 0)),
                "processing_jobs": queue_status.get("processing_jobs", queue_status.get("processing", 0)),
                "completed_jobs": queue_status.get("completed_jobs", queue_status.get("total_jobs", 0)),
                "max_queue_size": queue_status.get("max_queue_size"),
                "queue_utilization": queue_status.get("queue_utilization"),
                "timestamp": time.time(),
            }
        }
    except Exception as e:
        logger.error(f"Error getting queue stats: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get queue statistics: {str(e)}"
        )


def _ensure_production_result_urls(job_id: str, result: dict) -> dict:
    """Guarantee canonical production artifact URLs on a completed job result.

    Jobs persist in SQLite across restarts, but persisted results can lack
    production URLs (raw-shape workflow stages, results written before a
    backfill). These URLs only reference the job endpoints, which resolve
    artifacts from the on-disk canonical workspace, so they stay valid after
    a backend restart. Values populated by post-processing always win.
    """
    if not isinstance(result, dict) or not job_id:
        return result
    base = f"/api/v1/system/jobs/{job_id}"
    result.setdefault("model_url", f"{base}/download?artifact_format=glb")
    result.setdefault("game_ready_url", f"{base}/download?artifact_format=glb")
    result.setdefault("download_url", f"{base}/download?artifact_format=glb")
    result.setdefault("source_model_url", f"{base}/download?artifact_format=master")
    result.setdefault("high_fidelity_url", f"{base}/download?artifact_format=master")
    result.setdefault("thumbnail_url", f"{base}/thumbnail")
    return result


@router.get("/jobs/history")
async def get_jobs_history(
    limit: int = 100,
    offset: int = 0,
    status: Optional[str] = None,
    feature: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    scheduler: MultiprocessModelScheduler = Depends(get_scheduler),
    request: Request = None,
):
    """
    Get historical jobs with filtering support.
    
    Users can only see their own jobs. Admins can see all jobs.

    Args:
        limit: Maximum number of jobs to return (max 500)
        offset: Number of jobs to skip for pagination
        status: Filter by job status (queued, processing, completed, failed, cancelled)
        feature: Filter by feature type (e.g., image_to_textured_mesh)
        start_date: Filter jobs after this date (ISO format: 2024-01-01T00:00:00Z)
        end_date: Filter jobs before this date (ISO format: 2024-01-01T23:59:59Z)
        scheduler: Model scheduler dependency
        request: Request object

    Returns:
        Paginated list of historical jobs
    """
    try:
        from datetime import datetime

        from api.dependencies import get_current_user_optional
        from core.auth.models import UserRole
        from core.scheduler.job_queue import JobStatus
        
        # Get current user for filtering
        current_user = await get_current_user_optional(
            request.headers.get("authorization") if request else None,
            request
        )

        # Validate limit
        if limit > 500:
            limit = 500
        if limit < 1:
            limit = 1

        # Validate offset
        if offset < 0:
            offset = 0

        db_manager = getattr(scheduler.job_queue, "db_manager", None)
        if db_manager is not None:
            from datetime import datetime as _dt

            def parse_date(value: Optional[str]) -> Optional[_dt]:
                if not value:
                    return None
                try:
                    parsed = _dt.fromisoformat(value.replace("Z", "+00:00"))
                    return parsed.replace(tzinfo=None)
                except ValueError:
                    return None

            page_status = status.lower() if status else None
            user_id = None
            if current_user and current_user.role != UserRole.ADMIN:
                user_id = current_user.user_id

            page_jobs, total_jobs = await asyncio.to_thread(
                db_manager.get_jobs_page,
                status=page_status,
                feature=feature,
                user_id=user_id,
                start_date=parse_date(start_date),
                end_date=parse_date(end_date),
                limit=limit,
                offset=offset,
            )
            if page_jobs or total_jobs:
                jobs = [job.to_dict() for job in page_jobs]
                for job_dict in jobs:
                    if job_dict.get("status") == "completed" and job_dict.get("result"):
                        _ensure_production_result_urls(job_dict.get("job_id") or job_dict.get("id"), job_dict["result"])
                return {
                    "jobs": jobs,
                    "pagination": {
                        "limit": limit,
                        "offset": offset,
                        "total": total_jobs,
                        "has_more": offset + len(jobs) < total_jobs,
                    },
                    "filters": {
                        "status": status,
                        "feature": feature,
                        "start_date": start_date,
                        "end_date": end_date,
                    },
                    "timestamp": time.time(),
                }

        # Redis queue fallback: retain its current status-based API until a
        # dedicated history sorted-set index is introduced.
        all_jobs = []

        # Get jobs from different statuses
        job_statuses_to_fetch = []
        if status:
            # If status filter is provided, only fetch that status
            try:
                status_enum = JobStatus(status.lower())
                job_statuses_to_fetch = [status_enum]
            except ValueError:
                # Invalid status provided
                return {
                    "jobs": [],
                    "pagination": {
                        "limit": limit,
                        "offset": offset,
                        "total": 0,
                        "has_more": False,
                    },
                    "filters": {
                        "status": status,
                        "feature": feature,
                        "start_date": start_date,
                        "end_date": end_date,
                    },
                    "timestamp": time.time(),
                    "error": f"Invalid status: {status}. Valid statuses: queued, processing, completed, failed, cancelled",
                }
        else:
            # Fetch all statuses
            job_statuses_to_fetch = list(JobStatus)

        # Collect all jobs
        for job_status in job_statuses_to_fetch:
            jobs = await scheduler.job_queue.get_jobs_by_status(job_status)
            for job in jobs:
                job_dict = job.to_dict()
                if job_dict.get("status") == "completed" and job_dict.get("result"):
                    _ensure_production_result_urls(job_dict.get("job_id") or job_dict.get("id"), job_dict["result"])
                
                # User filtering: non-admin users can only see their own jobs
                if current_user and current_user.role != UserRole.ADMIN:
                    job_user_id = job_dict.get("user_id")
                    if job_user_id != current_user.user_id:
                        continue

                # Apply feature filter if provided
                if feature and job_dict.get("feature") != feature:
                    continue

                # Apply date filters if provided
                if start_date:
                    try:
                        start_dt = datetime.fromisoformat(
                            start_date.replace("Z", "+00:00")
                        )
                        job_created = datetime.fromisoformat(job_dict["created_at"])
                        if job_created < start_dt:
                            continue
                    except ValueError:
                        pass  # Skip invalid date format

                if end_date:
                    try:
                        end_dt = datetime.fromisoformat(end_date.replace("Z", "+00:00"))
                        job_created = datetime.fromisoformat(job_dict["created_at"])
                        if job_created > end_dt:
                            continue
                    except ValueError:
                        pass  # Skip invalid date format

                all_jobs.append(job_dict)

        # Sort by created_at (newest first)
        all_jobs.sort(key=lambda x: x.get("created_at", ""), reverse=True)

        # Apply pagination
        total_jobs = len(all_jobs)
        start_idx = offset
        end_idx = min(offset + limit, total_jobs)
        paginated_jobs = all_jobs[start_idx:end_idx]

        return {
            "jobs": paginated_jobs,
            "pagination": {
                "limit": limit,
                "offset": offset,
                "total": total_jobs,
                "has_more": end_idx < total_jobs,
            },
            "filters": {
                "status": status,
                "feature": feature,
                "start_date": start_date,
                "end_date": end_date,
            },
            "timestamp": time.time(),
        }

    except Exception as e:
        logger.error(f"Failed to get jobs history: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Failed to retrieve jobs history: {str(e)}"
        )


@router.get("/jobs/{job_id}", summary="Get job status")
async def get_job_status(job_id: str, request: Request):
    """Get status of a specific job with visitable URLs for files"""
    try:
        from api.dependencies import get_current_user_optional
        
        scheduler = await get_scheduler(request)
        job_status = await scheduler.get_job_status(job_id)

        if job_status is None:
            raise HTTPException(status_code=404, detail="Job not found")
        
        # User filtering: non-admin users can only see their own jobs
        from core.auth.models import UserRole
        current_user = await get_current_user_optional(
            request.headers.get("authorization"), 
            request
        )
        
        if current_user:
            job_user_id = job_status.get("user_id")
            # If user is not admin and job doesn't belong to them, deny access
            if current_user.role != UserRole.ADMIN and job_user_id != current_user.user_id:
                raise HTTPException(status_code=403, detail="Access denied to this job")

        job_status.setdefault("api_version", "1")

        # If job is completed and has results, convert file paths to URLs
        if job_status.get("status") == "completed" and job_status.get("result"):
            result = job_status["result"]

            # Convert mesh file path to URL
            mesh_path = None
            possible_mesh_keys = [
                "output_mesh_path",
                "mesh_path",
                "output_path",
                "file_path",
            ]

            for key in possible_mesh_keys:
                if key in result and result[key]:
                    mesh_path = result[key]
                    break

            if mesh_path and os.path.exists(mesh_path):
                # Create URL for mesh file
                mesh_url = f"{request.base_url}api/v1/system/jobs/{job_id}/download"
                result["mesh_url"] = mesh_url

                # Add file info
                file_stats = os.stat(mesh_path)
                result["mesh_file_info"] = {
                    "filename": os.path.basename(mesh_path),
                    "file_size_bytes": file_stats.st_size,
                    "file_size_mb": round(file_stats.st_size / (1024 * 1024), 2),
                    "content_type": get_content_type_for_file(mesh_path),
                    "file_extension": Path(mesh_path).suffix,
                }

                # Register the generated mesh as a file_id so downstream operations (retopo, UV, auto-rig) can chain seamlessly
                try:
                    from api.routers.file_upload import store_file_metadata_impl
                    file_store = getattr(request.app.state, "file_store", None)
                    file_info = {
                        "original_filename": os.path.basename(mesh_path),
                        "file_path": mesh_path,
                        "file_type": "mesh",
                        "file_size_mb": round(file_stats.st_size / (1024 * 1024), 2),
                    }
                    await store_file_metadata_impl(file_store, f"job-{job_id}", file_info)
                    await store_file_metadata_impl(file_store, job_id, file_info)
                    result["file_id"] = f"job-{job_id}"
                except Exception as ex:
                    logger.debug(f"Failed to register job result file metadata: {ex}")
                    result["file_id"] = f"job-{job_id}"

            # Convert thumbnail path to URL
            thumbnail_path = result.get("thumbnail_path") or result.get("thumbnail")
            if not thumbnail_path and result.get("asset_root"):
                root = Path(result["asset_root"])
                for candidate in [
                    root / "previews" / "thumbnail.png",
                    root / "previews" / "preview.jpg",
                    root / "previews" / "thumbnail.jpg",
                    root / "previews" / "preview.png",
                    root / "previews" / "reference.png",
                    root / "reference.png",
                    root / "input.png",
                ]:
                    if candidate.exists():
                        thumbnail_path = str(candidate)
                        result["thumbnail_path"] = thumbnail_path
                        break
            if not thumbnail_path and (result.get("mesh_path") or result.get("output_path")):
                m_path = Path(result.get("mesh_path") or result.get("output_path"))
                for candidate in [
                    m_path.parent / f"{m_path.stem}_thumb.png",
                    m_path.parent / f"{m_path.stem}_preview.png",
                    m_path.parent / "previews" / "thumbnail.png",
                    m_path.parent / "input.png",
                ]:
                    if candidate.exists():
                        thumbnail_path = str(candidate)
                        result["thumbnail_path"] = thumbnail_path
                        break

            # Fallback to reference input image if thumbnail is absent
            if not thumbnail_path or not os.path.exists(thumbnail_path):
                inputs_dict = job_status.get("inputs", {})
                cand_input = inputs_dict.get("image_path") or inputs_dict.get("image") or inputs_dict.get("texture_image_path")
                if cand_input and os.path.exists(cand_input):
                    thumbnail_path = str(cand_input)
                    result["thumbnail_path"] = thumbnail_path

            # Always populate thumbnail_url for completed jobs
            thumbnail_url = (
                f"{request.base_url}api/v1/system/jobs/{job_id}/thumbnail"
            )
            result["thumbnail_url"] = thumbnail_url

            # Canonical production artifact URLs (game-ready GLB by default,
            # master/source.glb for the source view). Stable across restarts
            # because they only reference this job's download endpoints.
            _ensure_production_result_urls(job_id, result)

            if thumbnail_path and os.path.exists(thumbnail_path):
                # Add thumbnail file info
                thumb_stats = os.stat(thumbnail_path)
                result["thumbnail_file_info"] = {
                    "filename": os.path.basename(thumbnail_path),
                    "file_size_bytes": thumb_stats.st_size,
                    "file_size_mb": round(thumb_stats.st_size / (1024 * 1024), 2),
                    "content_type": get_content_type_for_file(thumbnail_path),
                    "file_extension": Path(thumbnail_path).suffix,
                }

        # Convert input image path to URL (works for both completed and processing jobs)
        inputs = job_status.get("inputs", {})
        input_image_path = inputs.get("image_path")
        if input_image_path and os.path.exists(input_image_path):
            # Create URL for input image
            input_image_url = f"{request.base_url}api/v1/system/jobs/{job_id}/input"
            job_status["input_image_url"] = input_image_url

            # Add input image file info
            input_stats = os.stat(input_image_path)
            job_status["input_image_file_info"] = {
                "filename": os.path.basename(input_image_path),
                "file_size_bytes": input_stats.st_size,
                "file_size_mb": round(input_stats.st_size / (1024 * 1024), 2),
                "content_type": get_content_type_for_file(input_image_path),
                "file_extension": Path(input_image_path).suffix,
            }

        return job_status
    except HTTPException:
        raise
    except Exception as e:
        import traceback 
        traceback.print_exc()
        raise HTTPException(
            status_code=500, detail=f"Error retrieving job status: {str(e)}"
        )


@router.get("/adapters", summary="List registered adapters")
async def list_adapters(request: Request):
    """List all registered model adapters"""
    try:
        scheduler = await get_scheduler(request)
        status = await scheduler.get_system_status()

        adapters = []
        for model_id, model_info in status.get("models", {}).items():
            adapters.append(
                {
                    "model_id": model_id,
                    "feature_type": model_info.get("feature_type"),
                    "status": model_info.get("status"),
                    "vram_requirement": model_info.get("vram_requirement"),
                    "processing_count": model_info.get("processing_count", 0),
                    "supported_formats": model_info.get("supported_formats", {}),
                }
            )

        return {
            "adapters": adapters,
            "total_count": len(adapters),
            "by_feature": status.get("features", {}),
            "by_status": {
                "loaded": len([a for a in adapters if a["status"] == "loaded"]),
                "unloaded": len([a for a in adapters if a["status"] == "unloaded"]),
                "loading": len([a for a in adapters if a["status"] == "loading"]),
                "error": len([a for a in adapters if a["status"] == "error"]),
            },
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error listing adapters: {str(e)}")


def get_content_type_for_file(file_path: str) -> str:
    """Determine appropriate content type for a file"""
    file_ext = Path(file_path).suffix.lower()

    # Custom mappings for 3D formats
    content_type_mapping = {
        ".glb": "model/gltf-binary",
        ".gltf": "model/gltf+json",
        ".obj": "application/wavefront-obj",
        ".fbx": "model/fbx",
        ".ply": "model/ply",
        ".stl": "model/stl",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".bmp": "image/bmp",
        ".tiff": "image/tiff",
        ".json": "application/json",
        ".txt": "text/plain",
        ".log": "text/plain",
    }

    if file_ext in content_type_mapping:
        return content_type_mapping[file_ext]

    # Fallback to mimetypes guess
    mime_type, _ = mimetypes.guess_type(file_path)
    return mime_type or "application/octet-stream"


@router.get("/jobs/{job_id}/download", summary="Download job result")
async def download_job_result(
    job_id: str,
    request: Request,
    format: Optional[str] = Query(
        None, description="Response format: 'file' (default) or 'base64'"
    ),
    artifact_format: Optional[str] = Query(
        None,
        description="Canonical artifact format",
    ),
    filename: Optional[str] = Query(None, description="Custom filename for download"),
):
    """
    Download the result file of a completed job.

    Args:
        job_id: The job ID to download results for
        format: Response format ('file' for direct download, 'base64' for JSON response)
        filename: Optional custom filename for the download

    Returns:
        FileResponse for direct download or JSON with base64 data
    """
    try:
        from api.dependencies import get_current_user_optional
        from core.auth.models import UserRole
        
        scheduler = await get_scheduler(request)
        job_status = await scheduler.get_job_status(job_id)

        if job_status is None:
            raise HTTPException(status_code=404, detail="Job not found")
        
        # User filtering: non-admin users can only download their own jobs
        current_user = await get_current_user_optional(
            request.headers.get("authorization"),
            request
        )
        
        if current_user:
            job_user_id = job_status.get("user_id")
            if current_user.role != UserRole.ADMIN and job_user_id != current_user.user_id:
                raise HTTPException(status_code=403, detail="Access denied to this job")

        if job_status.get("status") != "completed":
            raise HTTPException(
                status_code=400,
                detail=f"Job is not completed yet. Current status: {job_status.get('status')}",
            )

        result = job_status.get("result", {})
        if not result:
            raise HTTPException(
                status_code=404, detail="No result available for this job"
            )

        # Canonical postprocessed artifacts are resolved from the job workspace.
        # Client input is a whitelist key, never a filesystem path.
        output_path = None
        canonical_format = (artifact_format or "glb").strip().lower()
        asset_root = result.get("asset_root")
        asset_name = result.get("asset_name")

        if asset_root:
            asset_root_path = Path(asset_root).resolve()
            models_root = (Path(__file__).resolve().parents[2] / "storage" / "models").resolve()
            if asset_root_path == models_root or models_root not in asset_root_path.parents:
                raise HTTPException(status_code=400, detail="Invalid asset workspace")

            if canonical_format == "master":
                output_path = asset_root_path / "master" / "source.glb"
            elif canonical_format in {"glb", "gltf", "fbx", "obj", "stl", "ply"}:
                candidate = asset_root_path / "game_ready" / f"{asset_root_path.name}.{canonical_format}"
                if not candidate.exists() and asset_name:
                    alt = asset_root_path / "game_ready" / f"{asset_name}.{canonical_format}"
                    if alt.exists():
                        candidate = alt
                if not candidate.exists():
                    matches = list((asset_root_path / "game_ready").glob(f"*.{canonical_format}"))
                    if matches:
                        candidate = matches[0]
                if not candidate.exists():
                    # On-demand conversion from game-ready GLB
                    glb_matches = list((asset_root_path / "game_ready").glob("*.glb"))
                    if glb_matches:
                        src_glb = glb_matches[0]
                        target_file = asset_root_path / "game_ready" / f"{src_glb.stem}.{canonical_format}"
                        try:
                            if canonical_format == "gltf":
                                from postprocess.pipeline import _export_gltf_embedded
                                _export_gltf_embedded(src_glb.read_bytes(), target_file)
                            else:
                                import trimesh
                                from postprocess.pipeline import _export_bytes
                                mesh = trimesh.load(src_glb, file_type="glb", process=False)
                                if isinstance(mesh, trimesh.Scene):
                                    mesh = trimesh.util.concatenate([g for g in mesh.geometry.values() if isinstance(g, trimesh.Trimesh)])
                                target_file.write_bytes(_export_bytes(mesh, canonical_format))
                            if target_file.exists():
                                candidate = target_file
                        except Exception as conv_err:
                            logger.warning(f"On-demand conversion to {canonical_format} failed: {conv_err}")
                output_path = candidate
            elif canonical_format in {"lod0", "lod1", "lod2", "lod3"}:
                output_path = asset_root_path / "lods" / f"{canonical_format}.glb"
            elif canonical_format == "rigged":
                output_path = asset_root_path / "rigging" / "game_ready_rigged.glb"
            elif canonical_format == "collision":
                output_path = asset_root_path / "collision" / "collision.glb"
            elif canonical_format == "thumbnail":
                output_path = asset_root_path / "previews" / "thumbnail.png"
            elif canonical_format == "qa_report":
                output_path = asset_root_path / "metadata" / "quality_report.json"
            elif canonical_format == "job_json":
                output_path = asset_root_path / "metadata" / "job.json"
            elif canonical_format == "asset_json":
                output_path = asset_root_path / "metadata" / "asset.json"
            elif canonical_format == "physics_json":
                output_path = asset_root_path / "metadata" / "physics.json"
            elif canonical_format.startswith("texture_"):
                texture_name = canonical_format.removeprefix("texture_")
                if texture_name not in {"base_color", "normal", "ao", "roughness", "metallic", "orm"}:
                    raise HTTPException(status_code=400, detail="Unsupported texture artifact")
                output_path = asset_root_path / "textures" / f"{texture_name}.png"
            elif canonical_format == "zip":
                temp_dir = Path(tempfile.mkdtemp(prefix=f"formash3d-{job_id}-"))
                archive_path = temp_dir / f"{asset_root_path.name}.zip"
                try:
                    with zipfile.ZipFile(
                        archive_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6
                    ) as archive:
                        for file_path in sorted(asset_root_path.rglob("*")):
                            if file_path.is_file():
                                archive.write(file_path, file_path.relative_to(asset_root_path.parent))
                    return FileResponse(
                        path=str(archive_path),
                        filename=archive_path.name,
                        media_type="application/zip",
                        background=BackgroundTask(shutil.rmtree, str(temp_dir), ignore_errors=True),
                        headers={"X-Job-ID": job_id, "Cache-Control": "no-store"},
                    )
                except Exception:
                    shutil.rmtree(temp_dir, ignore_errors=True)
                    raise
            else:
                raise HTTPException(status_code=400, detail=f"Unsupported artifact format: {canonical_format}")
        else:
            possible_keys = ["output_mesh_path", "mesh_path", "output_path", "file_path"]
            for key in possible_keys:
                if key in result and result[key]:
                    output_path = result[key]
                    break

        if not output_path:
            raise HTTPException(status_code=404, detail="No output file path found in job result")

        output_path = str(Path(output_path).resolve())
        if asset_root:
            try:
                Path(output_path).resolve().relative_to(models_root)
            except ValueError:
                raise HTTPException(status_code=400, detail="Invalid artifact path")
        if not os.path.exists(output_path):
            raise HTTPException(status_code=404, detail=f"Output file not found: {output_path}")

        # Determine the response format
        response_format = format or "file"

        if response_format == "base64":
            # Return base64 encoded data
            try:
                # Note: encode_file_to_base64 may have type issues, but implementation works
                base64_data = encode_file_to_base64(output_path)  # type: ignore
                file_size_mb = get_file_size_mb(output_path)

                return JSONResponse(
                    {
                        "job_id": job_id,
                        "filename": filename or os.path.basename(output_path),
                        "content_type": get_content_type_for_file(output_path),
                        "file_size_mb": file_size_mb,
                        "base64_data": base64_data,
                        "generation_info": result.get("generation_info", {}),
                        "download_time": datetime.now(timezone.utc).isoformat(),
                    }
                )
            except Exception as e:
                raise HTTPException(
                    status_code=500, detail=f"Failed to encode file as base64: {str(e)}"
                )

        else:
            # Return file download
            download_filename = (
                filename or f"result_{job_id}_{os.path.basename(output_path)}"
            )
            content_type = get_content_type_for_file(output_path)

            return FileResponse(
                path=output_path,
                filename=download_filename,
                media_type=content_type,
                headers={
                    "X-Job-ID": job_id,
                    "X-Generation-Time": result.get("generation_info", {}).get(
                        "generation_time", "unknown"
                    ),
                    "X-File-Size": str(os.path.getsize(output_path)),
                    "Cache-Control": "public, max-age=86400, immutable",
                },
            )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error downloading file: {str(e)}")


@router.get("/jobs/{job_id}/thumbnail", summary="Download job thumbnail")
async def download_job_thumbnail(
    job_id: str,
    request: Request,
    format: Optional[str] = Query(
        None, description="Response format: 'file' (default) or 'base64'"
    ),
    filename: Optional[str] = Query(None, description="Custom filename for download"),
    scheduler=Depends(get_scheduler),
):
    """
    Download the thumbnail image of a completed job.

    Args:
        job_id: The job ID to download thumbnail for
        format: Response format ('file' for direct download, 'base64' for JSON response)
        filename: Optional custom filename for the download

    Returns:
        FileResponse for direct download or JSON with base64 data
    """
    try:
        from api.dependencies import get_current_user_optional
        from core.auth.models import UserRole
        
        raw_status = scheduler.get_job_status(job_id)
        if asyncio.iscoroutine(raw_status):
            job_status = await raw_status
        else:
            job_status = raw_status

        if job_status is None:
            raise HTTPException(status_code=404, detail="Job not found")
        
        # User filtering: non-admin users can only access their own jobs
        current_user = await get_current_user_optional(
            request.headers.get("authorization"),
            request
        )
        
        if current_user:
            job_user_id = job_status.get("user_id")
            if current_user.role != UserRole.ADMIN and job_user_id != current_user.user_id:
                raise HTTPException(status_code=403, detail="Access denied to this job")

        if job_status.get("status") != "completed":
            raise HTTPException(
                status_code=400,
                detail=f"Job is not completed yet. Current status: {job_status.get('status')}",
            )

        result = job_status.get("result", {})
        if not result:
            raise HTTPException(
                status_code=404, detail="No result available for this job"
            )

        # Get thumbnail path
        thumbnail_path = result.get("thumbnail_path") or result.get("thumbnail")
        if not thumbnail_path and result.get("asset_root"):
            root = Path(result["asset_root"])
            for candidate in [
                root / "previews" / "thumbnail.png",
                root / "previews" / "preview.jpg",
                root / "previews" / "thumbnail.jpg",
                root / "previews" / "preview.png",
                root / "previews" / "reference.png",
                root / "reference.png",
                root / "input.png",
                root / "input_image.png",
            ]:
                if candidate.exists():
                    thumbnail_path = str(candidate)
                    break
        if not thumbnail_path and (result.get("mesh_path") or result.get("output_path")):
            m_path = Path(result.get("mesh_path") or result.get("output_path"))
            for candidate in [
                m_path.parent / f"{m_path.stem}_thumb.png",
                m_path.parent / f"{m_path.stem}_preview.png",
                m_path.parent / "previews" / "thumbnail.png",
                m_path.parent / "input.png",
            ]:
                if candidate.exists():
                    thumbnail_path = str(candidate)
                    break

        # Fallback to reference input image if present
        if not thumbnail_path or not os.path.exists(thumbnail_path):
            inputs_dict = job_status.get("inputs", {})
            cand_input = inputs_dict.get("image_path") or inputs_dict.get("image") or inputs_dict.get("texture_image_path")
            if cand_input and os.path.exists(cand_input):
                thumbnail_path = str(cand_input)

        # Determine the response format
        response_format = format or "file"

        if not thumbnail_path or not os.path.exists(thumbnail_path):
            import base64
            svg_bytes = DEFAULT_MESH_THUMBNAIL_SVG.encode("utf-8")
            if response_format == "base64":
                b64_str = base64.b64encode(svg_bytes).decode("utf-8")
                return JSONResponse(
                    {
                        "job_id": job_id,
                        "filename": filename or f"thumbnail_{job_id}.svg",
                        "content_type": "image/svg+xml",
                        "file_size_mb": round(len(svg_bytes) / (1024 * 1024), 4),
                        "base64_data": f"data:image/svg+xml;base64,{b64_str}",
                        "generation_info": result.get("generation_info", {}),
                        "download_time": datetime.now(timezone.utc).isoformat(),
                    }
                )
            return Response(
                content=svg_bytes,
                media_type="image/svg+xml",
                headers={
                    "X-Job-ID": job_id,
                    "X-Thumbnail-Generated": "placeholder",
                    "Cache-Control": "public, max-age=3600",
                },
            )

        if response_format == "base64":
            # Return base64 encoded data
            try:
                base64_data = encode_file_to_base64(thumbnail_path)  # type: ignore
                file_size_mb = get_file_size_mb(thumbnail_path)

                return JSONResponse(
                    {
                        "job_id": job_id,
                        "filename": filename or os.path.basename(thumbnail_path),
                        "content_type": get_content_type_for_file(thumbnail_path),
                        "file_size_mb": file_size_mb,
                        "base64_data": base64_data,
                        "generation_info": result.get("generation_info", {}),
                        "download_time": datetime.now(timezone.utc).isoformat(),
                    }
                )
            except Exception as e:
                raise HTTPException(
                    status_code=500,
                    detail=f"Failed to encode thumbnail as base64: {str(e)}",
                )

        else:
            # Return file download
            download_filename = (
                filename or f"thumbnail_{job_id}_{os.path.basename(thumbnail_path)}"
            )
            content_type = get_content_type_for_file(thumbnail_path)

            return FileResponse(
                path=thumbnail_path,
                filename=download_filename,
                media_type=content_type,
                headers={
                    "X-Job-ID": job_id,
                    "X-Thumbnail-Generated": str(
                        result.get("generation_info", {}).get(
                            "thumbnail_generated", "unknown"
                        )
                    ),
                    "X-File-Size": str(os.path.getsize(thumbnail_path)),
                    "Cache-Control": "public, max-age=604800, immutable",
                },
            )

    except HTTPException:
        raise
    except Exception as e:
        import traceback

        traceback.print_exc()
        raise HTTPException(
            status_code=500, detail=f"Error downloading thumbnail: {str(e)}"
        )


@router.get("/jobs/{job_id}/input", summary="Download job input image")
async def download_job_input(
    job_id: str,
    request: Request,
    format: Optional[str] = Query(
        None, description="Response format: 'file' (default) or 'base64'"
    ),
    filename: Optional[str] = Query(None, description="Custom filename for download"),
):
    """
    Download the input image of a job.

    Args:
        job_id: The job ID to download input image for
        format: Response format ('file' for direct download, 'base64' for JSON response)
        filename: Optional custom filename for the download

    Returns:
        FileResponse for direct download or JSON with base64 data
    """
    try:
        from api.dependencies import get_current_user_optional
        from core.auth.models import UserRole
        
        scheduler = await get_scheduler(request)
        job_status = await scheduler.get_job_status(job_id)

        if job_status is None:
            raise HTTPException(status_code=404, detail="Job not found")
        
        # User filtering: non-admin users can only access their own jobs
        current_user = await get_current_user_optional(
            request.headers.get("authorization"),
            request
        )
        
        if current_user:
            job_user_id = job_status.get("user_id")
            if current_user.role != UserRole.ADMIN and job_user_id != current_user.user_id:
                raise HTTPException(status_code=403, detail="Access denied to this job")

        # Get input image path from job inputs
        inputs = job_status.get("inputs", {})
        input_image_path = inputs.get("image_path")
        
        if not input_image_path:
            raise HTTPException(
                status_code=404, detail="No input image available for this job"
            )

        if not os.path.exists(input_image_path):
            raise HTTPException(
                status_code=404,
                detail=f"Input image file not found at path: {input_image_path}",
            )

        # Determine the response format
        response_format = format or "file"

        if response_format == "base64":
            # Return base64 encoded data
            try:
                base64_data = encode_file_to_base64(input_image_path)  # type: ignore
                file_size_mb = get_file_size_mb(input_image_path)

                return JSONResponse(
                    {
                        "job_id": job_id,
                        "filename": filename or os.path.basename(input_image_path),
                        "content_type": get_content_type_for_file(input_image_path),
                        "file_size_mb": file_size_mb,
                        "base64_data": base64_data,
                        "download_time": datetime.now(timezone.utc).isoformat(),
                    }
                )
            except Exception as e:
                raise HTTPException(
                    status_code=500,
                    detail=f"Failed to encode input image as base64: {str(e)}",
                )

        else:
            # Return file download
            download_filename = (
                filename or f"input_{job_id}_{os.path.basename(input_image_path)}"
            )
            content_type = get_content_type_for_file(input_image_path)

            return FileResponse(
                path=input_image_path,
                filename=download_filename,
                media_type=content_type,
                headers={
                    "X-Job-ID": job_id,
                    "X-File-Size": str(os.path.getsize(input_image_path)),
                    "Cache-Control": "public, max-age=604800, immutable",
                },
            )

    except HTTPException:
        raise
    except Exception as e:
        import traceback

        traceback.print_exc()
        raise HTTPException(
            status_code=500, detail=f"Error downloading input image: {str(e)}"
        )


@router.get("/jobs/{job_id}/info", summary="Get job result information")
async def get_job_result_info(job_id: str, request: Request):
    """
    Get detailed information about a job's result without downloading the file.

    Args:
        job_id: The job ID to get information for

    Returns:
        Detailed job result information including file metadata
    """
    try:
        from api.dependencies import get_current_user_optional
        from core.auth.models import UserRole
        
        scheduler = await get_scheduler(request)
        job_status = await scheduler.get_job_status(job_id)

        if job_status is None:
            raise HTTPException(status_code=404, detail="Job not found")
        
        # User filtering
        current_user = await get_current_user_optional(
            request.headers.get("authorization"),
            request
        )
        
        if current_user:
            job_user_id = job_status.get("user_id")
            if current_user.role != UserRole.ADMIN and job_user_id != current_user.user_id:
                raise HTTPException(status_code=403, detail="Access denied to this job")

        result = job_status.get("result", {})
        if not result:
            return {
                "job_id": job_id,
                "status": job_status.get("status"),
                "has_result": False,
                "message": "No result available",
            }

        # Get file information
        output_path = None
        possible_keys = ["output_mesh_path", "mesh_path", "output_path", "file_path"]

        for key in possible_keys:
            if key in result and result[key]:
                output_path = result[key]
                break

        file_info = {}
        if output_path and os.path.exists(output_path):
            file_stats = os.stat(output_path)
            file_info = {
                "filename": os.path.basename(output_path),
                "file_size_bytes": file_stats.st_size,
                "file_size_mb": file_stats.st_size / (1024 * 1024),
                "content_type": get_content_type_for_file(output_path),
                "file_extension": Path(output_path).suffix[1:],
                "created_time": datetime.fromtimestamp(file_stats.st_ctime).isoformat(),
                "modified_time": datetime.fromtimestamp(
                    file_stats.st_mtime
                ).isoformat(),
                "file_exists": True,
            }
        else:
            file_info = {"file_exists": False, "error": "Output file not found"}

        return {
            "job_id": job_id,
            "status": job_status.get("status"),
            "has_result": bool(result),
            "created_at": job_status.get("created_at"),
            "completed_at": job_status.get("completed_at"),
            "processing_time": job_status.get("processing_time"),
            "file_info": file_info,
            "generation_info": result.get("generation_info", {}),
            "result_metadata": {
                k: v
                for k, v in result.items()
                if k
                not in ["output_mesh_path", "mesh_path", "output_path", "file_path"]
            },
            "mesh_download_urls": {
                "direct_download": f"/api/v1/system/jobs/{job_id}/download",
                "base64_download": f"/api/v1/system/jobs/{job_id}/download?format=base64",
            },
            "thumbnail_download_urls": {
                "direct_download": f"/api/v1/system/jobs/{job_id}/thumbnail",
                "base64_download": f"/api/v1/system/jobs/{job_id}/thumbnail?format=base64",
            }
            if file_info.get("file_exists")
            else {},
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error getting job result info: {str(e)}"
        )


@router.post("/jobs/{job_id}/postprocess/retry", summary="Retry canonical production post-processing")
async def retry_job_postprocess(
    job_id: str, request: Request, _: bool = Depends(verify_api_key)
):
    """Rebuild derived production artifacts from the immutable canonical master."""
    try:
        from api.dependencies import get_current_user_optional
        from core.auth.models import UserRole
        from postprocess.pipeline import run_postprocess_job

        scheduler = await get_scheduler(request)
        job_status = await scheduler.get_job_status(job_id)
        if job_status is None:
            raise HTTPException(status_code=404, detail="Job not found")

        current_user = await get_current_user_optional(
            request.headers.get("authorization"), request
        )
        if current_user:
            job_user_id = job_status.get("user_id")
            if current_user.role != UserRole.ADMIN and job_user_id != current_user.user_id:
                raise HTTPException(status_code=403, detail="Access denied to this job")

        result = job_status.get("result") or {}
        asset_root = result.get("asset_root")
        if not asset_root:
            raise HTTPException(status_code=400, detail="Job has no canonical asset workspace to retry")

        asset_root_path = Path(asset_root).resolve()
        models_root = (Path(__file__).resolve().parents[2] / "storage" / "models").resolve()
        if asset_root_path == models_root or models_root not in asset_root_path.parents:
            raise HTTPException(status_code=400, detail="Invalid asset workspace")

        master_path = asset_root_path / "master" / "source.glb"
        if not master_path.is_file():
            raise HTTPException(status_code=409, detail="Immutable master source.glb is missing")

        job = await scheduler.job_queue.prepare_postprocess_retry(job_id)
        if job is None:
            raise HTTPException(status_code=409, detail="Job is not retryable from its canonical master")

        for name in ("game_ready", "lods", "collision", "textures", "previews", "metadata"):
            shutil.rmtree(asset_root_path / name, ignore_errors=True)

        try:
            final_result = await asyncio.to_thread(
                run_postprocess_job,
                job_id,
                {"success": True, "output_mesh_path": str(master_path)},
                job.inputs,
                job.metadata,
            )
        except Exception as exc:
            await scheduler.job_queue.fail_job(job_id, f"Post-process retry failed: {exc}")
            raise HTTPException(status_code=500, detail=f"Post-process retry failed: {exc}") from exc

        await scheduler.job_queue.complete_job(job_id, final_result)
        return {"job_id": job_id, "status": "completed", "postprocess_status": "completed", "result": final_result}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Post-process retry failed for %s: %s", job_id, exc, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error retrying post-processing: {exc}") from exc


def _dir_size_bytes(path: Path) -> int:
    total = 0
    if not path.is_dir():
        return 0
    try:
        for entry in path.rglob("*"):
            if entry.is_file():
                try:
                    total += entry.stat().st_size
                except OSError:
                    pass
    except OSError:
        pass
    return total


@router.get("/storage", summary="Get system storage usage")
async def get_system_storage():
    """Retrieve storage breakdown and system disk usage."""
    from core.utils.file_utils import get_storage_base_dir
    import shutil

    storage_base_dir = get_storage_base_dir()
    stat = shutil.disk_usage(storage_base_dir)
    total_gb = round(stat.total / (1024**3), 2)
    used_gb = round(stat.used / (1024**3), 2)
    free_gb = round(stat.free / (1024**3), 2)
    used_percent = round((stat.used / stat.total) * 100, 1) if stat.total > 0 else 0.0

    directories = {}
    for sub in ["models", "uploads", "exports", "thumbnails", "temp"]:
        sub_path = storage_base_dir / sub
        size_bytes = _dir_size_bytes(sub_path)
        directories[sub] = {
            "path": str(sub_path),
            "size_gb": round(size_bytes / (1024**3), 3),
            "size_mb": round(size_bytes / (1024**2), 2),
        }

    return {
        "success": True,
        "data": {
            "root_path": str(storage_base_dir),
            "total_gb": total_gb,
            "used_gb": used_gb,
            "free_gb": free_gb,
            "used_percent": used_percent,
            "directories": directories,
        },
    }


@router.post("/cache/clear", summary="Clear system temporary files and cache")
async def clear_system_cache():
    """Clear temporary files from storage/temp and stale cache files."""
    from core.utils.file_utils import get_storage_base_dir
    import shutil

    storage_base_dir = get_storage_base_dir()
    freed_bytes = 0
    files_removed = 0

    temp_dirs = [
        storage_base_dir / "temp",
        storage_base_dir / "exports",
    ]

    for temp_dir in temp_dirs:
        if temp_dir.is_dir():
            for p in list(temp_dir.iterdir()):
                try:
                    if p.is_file() or p.is_symlink():
                        freed_bytes += p.stat().st_size
                        p.unlink()
                        files_removed += 1
                    elif p.is_dir():
                        dsize = _dir_size_bytes(p)
                        shutil.rmtree(p, ignore_errors=True)
                        freed_bytes += dsize
                        files_removed += 1
                except Exception as e:
                    logger.debug("Could not remove temp file %s: %s", p, e)

    freed_mb = round(freed_bytes / (1024 * 1024), 2)
    return {
        "success": True,
        "freed_mb": freed_mb,
        "files_removed": files_removed,
        "message": f"Cache cleared! Removed {files_removed} temporary files ({freed_mb} MB freed).",
    }


@router.delete("/jobs/{job_id}/result", summary="Delete job result file")
async def delete_job_result(
    job_id: str, request: Request, _: bool = Depends(verify_api_key)
):
    """
    Delete the result file of a completed job to free up storage space.

    Args:
        job_id: The job ID to delete results for

    Returns:
        Confirmation of deletion
    """
    try:
        from api.dependencies import get_current_user_optional
        from core.auth.models import UserRole
        
        scheduler = await get_scheduler(request)
        job_status = await scheduler.get_job_status(job_id)

        if job_status is None:
            raise HTTPException(status_code=404, detail="Job not found")
        
        # User filtering: users can only delete their own job results
        current_user = await get_current_user_optional(
            request.headers.get("authorization"),
            request
        )
        
        if current_user:
            job_user_id = job_status.get("user_id")
            if current_user.role != UserRole.ADMIN and job_user_id != current_user.user_id:
                raise HTTPException(status_code=403, detail="Access denied to this job")

        result = job_status.get("result", {})
        if not result:
            return {
                "job_id": job_id,
                "message": "No result file to delete",
                "deleted": False,
            }

        # Find and delete the output file
        output_path = None
        possible_keys = ["output_mesh_path", "mesh_path", "output_path", "file_path"]

        for key in possible_keys:
            if key in result and result[key]:
                output_path = result[key]
                break

        if not output_path:
            return {
                "job_id": job_id,
                "message": "No output file path found",
                "deleted": False,
            }

        if os.path.exists(output_path):
            file_size_mb = get_file_size_mb(output_path)
            os.remove(output_path)

            return {
                "job_id": job_id,
                "message": "Result file deleted successfully",
                "deleted": True,
                "freed_space_mb": file_size_mb,
                "deleted_file": os.path.basename(output_path),
            }
        else:
            return {
                "job_id": job_id,
                "message": "Result file does not exist",
                "deleted": False,
            }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error deleting job result: {str(e)}"
        )


@router.delete("/jobs/{job_id}", summary="Delete job from database")
async def delete_job(
    job_id: str, request: Request, _: bool = Depends(verify_api_key)
):
    """
    Delete a job and its canonical generated asset workspace.

    The immutable source and all derived artifacts are removed only after the
    durable job record has been deleted successfully.

    Args:
        job_id: The job ID to delete

    Returns:
        Confirmation of deletion
    """
    try:
        from api.dependencies import get_current_user_optional
        from core.auth.models import UserRole
        
        scheduler = await get_scheduler(request)
        
        # Check if job exists
        job_status = await scheduler.get_job_status(job_id)
        if job_status is None:
            raise HTTPException(status_code=404, detail="Job not found")
        
        # User filtering: users can only delete their own jobs
        current_user = await get_current_user_optional(
            request.headers.get("authorization"),
            request
        )
        
        if current_user:
            job_user_id = job_status.get("user_id")
            if current_user.role != UserRole.ADMIN and job_user_id != current_user.user_id:
                raise HTTPException(status_code=403, detail="Access denied to this job")
        
        # Get canonical workspace before deletion; client paths are never trusted.
        asset_root = (job_status.get("result") or {}).get("asset_root")
        asset_root_path = None
        if asset_root:
            asset_root_path = Path(asset_root).resolve()
            models_root = (Path(__file__).resolve().parents[2] / "storage" / "models").resolve()
            if asset_root_path == models_root or models_root not in asset_root_path.parents:
                raise HTTPException(status_code=400, detail="Invalid asset workspace")

        job_info = {
            "status": job_status.get("status"),
            "feature": job_status.get("feature"),
            "created_at": job_status.get("created_at"),
        }

        success = await scheduler.job_queue.delete_job(job_id)

        if success:
            cleanup_error = None
            if asset_root_path and asset_root_path.exists():
                try:
                    shutil.rmtree(asset_root_path)
                except OSError as exc:
                    cleanup_error = str(exc)
                    logger.warning("Deleted job %s but failed to remove canonical workspace: %s", job_id, exc)
            return {
                "job_id": job_id,
                "message": "Job deleted successfully",
                "deleted": True,
                "asset_workspace_deleted": cleanup_error is None,
                "cleanup_error": cleanup_error,
                "job_info": job_info,
            }
        else:
            raise HTTPException(
                status_code=500,
                detail="Failed to delete job from database"
            )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting job {job_id}: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Error deleting job: {str(e)}"
        )


@router.get("/supported-formats", summary="Get supported formats")
async def get_supported_formats():
    """Get list of supported input and output formats"""
    return {
        "input_formats": {
            "text": ["string"],
            "image": ["png", "jpg", "jpeg", "bmp", "tiff", "webp"],
            "mesh": ["obj", "glb", "gltf", "ply", "stl", "fbx"],
            "base64": ["image/png", "image/jpeg", "model/gltf-binary"],
        },
        "output_formats": {
            "mesh": ["obj", "glb", "ply", "fbx"],
            "texture": ["png", "jpg"],
            "download": ["file", "base64"],
        },
        "content_types": {
            "mesh": {
                "glb": "model/gltf-binary",
                "gltf": "model/gltf+json",
                "obj": "application/wavefront-obj",
                "fbx": "model/fbx",
                "ply": "model/ply",
                "stl": "model/stl",
            },
            "image": {
                "png": "image/png",
                "jpg": "image/jpeg",
                "jpeg": "image/jpeg",
                "webp": "image/webp",
                "bmp": "image/bmp",
                "tiff": "image/tiff",
            },
        },
    }


@router.get("/available-adapters", summary="List available adapters from registry")
async def list_available_adapters(request: Request):
    """
    List all available adapters from the adapter registry.
    This provides more accurate information than the /models endpoint
    which only uses the models.yaml configuration.
    """
    try:
        scheduler = await get_scheduler(request)

        # Get adapter information from scheduler
        status = await scheduler.get_system_status()

        # Group adapters by feature type
        features = {}
        for model_id, model_info in status.get("models", {}).items():
            feature_type = model_info.get("feature_type")
            if feature_type:
                if feature_type not in features:
                    features[feature_type] = []
                features[feature_type].append(
                    {
                        "model_id": model_id,
                        "status": model_info.get("status"),
                        "vram_requirement": model_info.get("vram_requirement"),
                        "supported_formats": model_info.get("supported_formats", {}),
                    }
                )

        return {
            "features": features,
            "total_adapters": len(status.get("models", {})),
            "total_features": len(features),
        }
    except Exception as e:
        logger.error(f"Error retrieving adapter information: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Error retrieving adapter information: {str(e)}"
        )


@router.get("/logs/config", summary="Get logging configuration")
async def get_logging_config(_: bool = Depends(verify_api_key)):
    """Get current logging configuration and levels"""
    try:
        # Get all loggers and their levels
        loggers_info = {}

        # Root logger
        root_logger = logging.getLogger()
        loggers_info["root"] = {
            "level": logging.getLevelName(root_logger.level),
            "handlers": [type(h).__name__ for h in root_logger.handlers],
            "effective_level": logging.getLevelName(root_logger.getEffectiveLevel()),
        }

        # Get all named loggers
        for name in logging.Logger.manager.loggerDict:
            logger_obj = logging.getLogger(name)
            if logger_obj.handlers or logger_obj.level != logging.NOTSET:
                loggers_info[name] = {
                    "level": logging.getLevelName(logger_obj.level),
                    "handlers": [type(h).__name__ for h in logger_obj.handlers],
                    "effective_level": logging.getLevelName(
                        logger_obj.getEffectiveLevel()
                    ),
                    "propagate": logger_obj.propagate,
                }

        return {
            "loggers": loggers_info,
            "available_levels": ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"],
            "logs_directory": "logs",
            "logs_file": str(Path(__file__).resolve().parents[3] / "logs" / "master.log"),
            "config_source": "YAML configuration"
            if (Path(__file__).resolve().parents[2] / "config" / "logging.yaml").exists()
            else "Simple configuration",
        }

    except Exception as e:
        logger.error(f"Error retrieving logging config: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Error retrieving logging config: {str(e)}"
        )


@router.post("/logs/test", summary="Generate test log entries")
async def generate_test_logs(
    level: str = Query("INFO", description="Log level for test entries"),
    count: int = Query(5, description="Number of test entries to generate"),
    _: bool = Depends(verify_api_key),
):
    """Generate test log entries for testing the logging system"""

    valid_levels = ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"]
    if level.upper() not in valid_levels:
        raise HTTPException(
            status_code=400, detail=f"Invalid log level. Must be one of: {valid_levels}"
        )

    if count < 1 or count > 50:
        raise HTTPException(status_code=400, detail="Count must be between 1 and 50")

    try:
        test_logger = logging.getLogger("api.test")
        log_level = getattr(logging, level.upper())

        test_messages = [
            "Test log entry for system verification",
            "Simulating application workflow",
            "Testing log aggregation and viewing",
            "Verifying log formatting and parsing",
            "Checking log file rotation and storage",
            "Testing different logger configurations",
            "Simulating error conditions for testing",
            "Validating log filtering and search",
            "Testing concurrent logging operations",
            "Verifying logging performance and reliability",
        ]

        generated_entries = []
        for i in range(count):
            message = f"{test_messages[i % len(test_messages)]} (#{i + 1})"
            test_logger.log(log_level, message)
            generated_entries.append(
                {
                    "level": level.upper(),
                    "message": message,
                    "logger": "api.test",
                    "timestamp": datetime.now().isoformat(),
                }
            )

        return {
            "message": f"Generated {count} test log entries at {level.upper()} level",
            "entries": generated_entries,
            "level": level.upper(),
            "count": count,
        }

    except Exception as e:
        logger.error(f"Error generating test logs: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Error generating test logs: {str(e)}"
        )


@router.put("/logs/level", summary="Update logging level")
async def update_logging_level(
    logger_name: str = Query(
        ..., description="Logger name (use 'root' for root logger)"
    ),
    level: str = Query(..., description="New log level"),
    _: bool = Depends(verify_api_key),
):
    """Update logging level for a specific logger"""

    valid_levels = ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"]
    if level.upper() not in valid_levels:
        raise HTTPException(
            status_code=400, detail=f"Invalid log level. Must be one of: {valid_levels}"
        )

    try:
        if logger_name.lower() == "root":
            target_logger = logging.getLogger()
        else:
            target_logger = logging.getLogger(logger_name)

        old_level = logging.getLevelName(target_logger.level)
        new_level = getattr(logging, level.upper())
        target_logger.setLevel(new_level)

        return {
            "message": f"Updated logging level for '{logger_name}' from {old_level} to {level.upper()}",
            "logger_name": logger_name,
            "old_level": old_level,
            "new_level": level.upper(),
        }

    except Exception as e:
        logger.error(f"Error updating logging level: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Error updating logging level: {str(e)}"
        )
