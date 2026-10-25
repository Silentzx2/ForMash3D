"""
IMPORTANT: FIFO Job Processing Implementation

This multiprocessing scheduler has been modified to implement strict FIFO (First-In-First-Out)
job processing with the following key behavioral changes:

1. **No Retry Mechanism for Resource Constraints**: When a job cannot be processed due to
   WORKERS_BUSY or NO_VRAM, it is immediately put back at the front of the queue instead
   of using a retry mechanism with exponential backoff delays.

2. **Strict FIFO Submission Order**: Jobs are submitted to workers in the exact order they 
   were enqueued. A job submitted later will NEVER be submitted before an earlier job 
   unless the earlier job is impossible to process.

3. **Job Failure Only for Impossible Cases**: Jobs are only failed if they are truly
   impossible to process:
   - No models available for the requested feature
   - VRAM requirement exceeds total available VRAM across all GPUs
   - Job has been waiting for more than 1 hour

4. **Resource-Based Requeuing**: When resources are unavailable, jobs are put back at
   the front of the queue and processing continues with a short delay to prevent
   busy waiting.

5. **Transient Error Handling**: Transient errors (network, timeout, etc.) cause jobs
   to be requeued rather than failed, maintaining the FIFO order.

6. **Concurrent Execution**: Jobs are submitted to workers in FIFO order, but multiple 
   jobs can execute concurrently on different workers. The scheduler continues dequeuing 
   and submitting jobs without waiting for previous jobs to complete, enabling true 
   parallelism across multiple GPU workers.

7. **Single Instance**: Uses singleton pattern to prevent multiple scheduler instances
   when deployed with uvicorn. For true multi-worker deployments, use external queue systems.

This ensures predictable, ordered job submission while maximizing GPU utilization through
concurrent job execution across multiple workers.

DEPLOYMENT NOTE:
- Use `uvicorn app:main --workers 1` for single-worker deployment with this scheduler
- For multi-worker deployments, consider Redis-based job queues or similar external systems
"""

import asyncio
import hashlib
import json
import logging
import multiprocessing as mp
import os
import queue
import random
import shutil
import threading
import tempfile
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

try:
    import torch
except ImportError:
    torch = None

# core.config is imported inside model_worker_process after CPU-only CUDA visibility is applied.
from core.utils.file_utils import get_storage_base_dir
from core.utils.log_formatters import (
    format_banner,
    format_box,
    format_bytes,
    get_gpu_memory_summary,
)
from ..models.base import BaseModel
from .gpu_monitor import GPUMonitor
from .job_queue import JobQueue, JobRequest, JobStatus
from .resource_planner import ResourcePlan, ResourcePlanner, configure_cpu_runtime

logger = logging.getLogger(__name__)

def parse_bool_env(env_var: str, default: bool = False) -> bool:
    """Parse environment variable as boolean, handling common string representations."""
    value = os.environ.get(env_var, str(default)).strip().lower()
    return value in {"1", "true", "yes", "on"}

def retry_transient_errors_enabled() -> bool:
    """Read the retry switch at decision time so runtime configuration is not frozen at import."""
    return parse_bool_env("RETRY_TRANSIENT_ERRORS", False)


def _may_fallback_after_model_load_failure(
    model_preference: Optional[str], metadata: Dict[str, Any]
) -> bool:
    selection = metadata.get("model_selection")
    if selection == "explicit":
        return False
    if selection == "automatic":
        return True
    return not model_preference


def get_model_cache_ttl_seconds() -> float:
    """Read the model cache TTL in seconds.
    Controls how long an idle model remains loaded on GPU after job completion.
    Priority:
      1. If AUTO_UNLOAD_AFTER_JOB=true, returns 0.0 (immediate unload)
      2. P3D_MODEL_CACHE_TTL_SECONDS / MODEL_CACHE_TTL_SECONDS / MODEL_CACHE_TTL
      3. Default: 300.0 seconds (5 minutes)
    """
    if parse_bool_env("AUTO_UNLOAD_AFTER_JOB", False):
        return 0.0

    raw = (
        os.environ.get("P3D_MODEL_CACHE_TTL_SECONDS")
        or os.environ.get("MODEL_CACHE_TTL_SECONDS")
        or os.environ.get("MODEL_CACHE_TTL")
    )
    if raw is not None:
        try:
            return max(0.0, float(raw))
        except ValueError:
            pass

    return 300.0


def auto_unload_after_job_enabled() -> bool:
    """Read the VRAM unload switch at decision time."""
    return get_model_cache_ttl_seconds() == 0.0

# Production budgets belong to post-processing. Never let them reach model inference.
_POSTPROCESS_ONLY_INPUTS = frozenset({
    "candidate_count", "enable_postprocess", "plan", "fallback_chain",
    "target_polycount", "auto_optimize", "generateLOD", "lodPreset", "lodCount",
    "quality", "meshQuality", "mesh_quality", "topology_mode", "quad_topology", "auto_uv",
    "physics_enabled", "physics_config", "auto_paint", "paint_model_preference", "paint_resolution",
    "texture_enabled", "generate_texture", "generateTexture", "texture_resolution",
    "texture_resolution_preset", "production_texture_resolution",
    "enable_realesrgan", "enableRealESRGAN", "realeg",
    "faces", "num_faces", "simplify", "decimation_target", "remesh", "remesh_band", "remesh_project",
    "bake_normal_maps", "bake_high_to_low", "bake_textures",
    "intent", "preprocessing_artifact_id", "enhancement_enabled", "preprocessing_metadata",
    "enable_printability_check", "enable_auto_repair", "enable_auto_rig", "auto_rig_mode",
    "mesh_style", "requested_quality", "object_type", "symmetry",
})

# Adapter-owned numerical profiles live in adapter code; these sets hold only IDs and key names.
_ADAPTER_OWNED_INFERENCE_PROFILE_MODEL_IDS = frozenset({
    "hunyuan3d_shape_v21_image_to_raw_mesh",
    "hunyuan3d_shape_v21_image_to_3d",
    "hunyuan3d_shape_v21_image_to_textured_mesh",
    "hunyuan3dv21_image_to_raw_mesh",
    "hunyuan3dv21_image_to_3d",
    "hunyuan3dv21_image_to_textured_mesh",
    "hunyuan3dv21_image_mesh_painting",
    "hunyuan3d_dit_v2_mini_turbo_image_to_raw_mesh",
    "hunyuan3d_dit_v2_mini_turbo_image_to_3d",
    "triposg_image_to_raw_mesh",
    "trellis_image_to_raw_mesh",
    "trellis_image_to_3d",
    "trellis_image_to_textured_mesh",
    "trellis_image_mesh_painting",
    "trellis_text_mesh_painting",
    "trellis2_image_to_raw_mesh",
    "trellis2_image_to_3d",
    "trellis2_image_to_textured_mesh",
    "trellis2_image_mesh_painting",
    "pixal3d_image_to_raw_mesh",
    "pixal3d_image_to_3d",
    "unique3d_image_to_raw_mesh",
    "taoflowforge_image_to_raw_mesh",
    "hunyuan3d_paint_v21_image_mesh_painting",
})
_ADAPTER_OWNED_INFERENCE_INPUTS = frozenset({
    "source_quality", "requested_quality", "quality", "meshQuality", "mesh_quality",
    "num_inference_steps", "num_steps", "steps", "guidance_scale",
    "octree_resolution", "octree_res", "grid_resolution", "num_chunks", "mc_algo",
    "flash_octree_depth", "octree_depth", "dense_octree_depth",
    "hierarchical_octree_depth", "use_flash_decoder", "low_vram", "low_vram_mode",
    "pipeline_type", "max_num_tokens", "sparse_structure_sampler_params",
    "shape_slat_sampler_params", "tex_slat_sampler_params", "sampler_overrides",
    "resolution", "texture_size", "max_num_view", "ss_sampling_steps", "slat_sampling_steps",
    "input_processing", "do_refine", "expansion_weight", "init_type",
    "fill_holes", "offload", "enable_flashvdm",
})

# EXPERIMENTAL_MAX_DETAIL snapshot (2026-10-20). Ask the user once and get explicit confirmation
# before changing any locked profile in a later task. Sources/limits: Docs/EXPERIMENTAL-MODEL-SETTINGS.md.
# High-fidelity source mesh profiles have all been migrated into adapter-owned _LOCKED_INFERENCE_PROFILE.
# Production budgets remain in request_inputs and are applied only to downstream copies by post-processing.
_RAW_MESH_MAX_QUALITY_PARAMETERS: Dict[str, Dict[str, Any]] = {}


def _build_model_inference_inputs(
    inputs: Optional[Dict[str, Any]],
    model_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Keep production budgets downstream and force max supported raw mesh fidelity."""
    source = inputs or {}
    model_inputs = {
        key: value for key, value in source.items()
        if key not in _POSTPROCESS_ONLY_INPUTS
    }
    model_key = str(model_id or "").lower()
    if model_key in _ADAPTER_OWNED_INFERENCE_PROFILE_MODEL_IDS:
        model_inputs = {
            key: value for key, value in model_inputs.items()
            if key not in _ADAPTER_OWNED_INFERENCE_INPUTS
        }
        model_inputs["source_quality"] = "max"
    profile = _RAW_MESH_MAX_QUALITY_PARAMETERS.get(model_key)
    if profile:
        model_inputs.update({
            key: (dict(value) if isinstance(value, dict) else value)
            for key, value in profile.items()
        })
        # UI quality sliders must not lower source fidelity. The user seed remains intact.
        model_inputs.pop("quality", None)
        model_inputs.pop("meshQuality", None)
        model_inputs["source_quality"] = "max"
    return model_inputs


def _score_and_select(
    candidates_list: List[Dict[str, Any]],
    canonical_dest_path: Optional[str] = None,
    early_stop_threshold: float = 0.85,
) -> Tuple[int, List[Dict[str, Any]]]:
    """Score candidate meshes using trimesh metrics and select the winning candidate.

    Selects the best candidate with select_best_candidate, updates 'selected', 'score', and 'metrics'.
    If canonical_dest_path is provided, copies the best candidate mesh to canonical_dest_path.
    Returns: (best_idx, scored_candidates_list)
    """
    if not candidates_list:
        return 0, []

    import trimesh
    try:
        from core.quality.metrics import compute_mesh_metrics
        from core.scheduler.seed_scorer import score_seed_candidate, select_best_candidate
    except ImportError:
        from backend.core.quality.metrics import compute_mesh_metrics
        from backend.core.scheduler.seed_scorer import score_seed_candidate, select_best_candidate

    metrics_list = []
    for cand in candidates_list:
        metrics = cand.get("metrics")
        if metrics is None:
            mpath = cand.get("mesh_path")
            metrics = {}
            if mpath and os.path.isfile(str(mpath)):
                try:
                    m = trimesh.load(str(mpath), force="mesh", process=False)
                    metrics = compute_mesh_metrics(m)
                except Exception as e:
                    logger.warning("Failed to compute metrics for candidate %s: %s", cand.get("candidate_id"), e)
            cand["metrics"] = metrics
        if "score" not in cand:
            try:
                cand["score"] = float(score_seed_candidate(metrics))
            except Exception:
                cand["score"] = 0.0
        metrics_list.append(metrics)

    best_idx, best_score, _ = select_best_candidate(metrics_list, early_stop_threshold=early_stop_threshold)

    for i, cand in enumerate(candidates_list):
        cand["selected"] = (i == best_idx)

    if canonical_dest_path and candidates_list[best_idx].get("mesh_path"):
        best_path = candidates_list[best_idx]["mesh_path"]
        if os.path.isfile(best_path):
            try:
                if Path(best_path).resolve() != Path(canonical_dest_path).resolve():
                    shutil.copy2(best_path, canonical_dest_path)
            except Exception as e:
                logger.warning("Failed to copy best candidate to canonical path: %s", e)

    return best_idx, candidates_list


class WorkerConfig:
    """Configuration for a worker process - simplified to one model per worker"""

    def __init__(
        self,
        worker_id: str,
        gpu_id: Optional[int],
        model_config: Dict[str, Any],
        gpu_ids: Optional[List[int]] = None,
        resource_plan: Optional[Dict[str, Any]] = None,
    ):
        self.worker_id = worker_id
        self.gpu_id = gpu_id
        self.gpu_ids = list(gpu_ids if gpu_ids is not None else ([] if gpu_id is None else [gpu_id]))
        self.resource_plan = dict(resource_plan or {})
        self.model_config = model_config


class WorkerMessage:
    """Message types for worker communication"""

    class Type:
        PROCESS_JOB = "process_job"
        LOAD_MODEL = "load_model"
        UNLOAD_MODEL = "unload_model"
        GET_STATUS = "get_status"
        SHUTDOWN = "shutdown"
        HEALTH_CHECK = "health_check"

    def __init__(self, msg_type: str, data: Any = None, msg_id: Optional[str] = None):
        self.type = msg_type
        self.data = data
        self.msg_id = msg_id or str(uuid.uuid4())
        self.timestamp = time.time()


class WorkerResponse:
    """Response from worker process"""

    def __init__(
        self, msg_id: str, success: bool, data: Any = None, error: Optional[str] = None
    ):
        self.msg_id = msg_id
        self.success = success
        self.data = data
        self.error = error
        self.timestamp = time.time()


def _extract_job_status(job: Any) -> Optional[str]:
    """Safely extract lowercase status string from either a JobRequest or a Redis job dict."""
    if job is None:
        return None
    if isinstance(job, dict):
        status_val = job.get("status")
    else:
        status_val = getattr(job, "status", None)
    if status_val is None:
        return None
    if hasattr(status_val, "value"):
        return str(status_val.value).lower()
    return str(status_val).lower()


def model_worker_process(
    worker_config: WorkerConfig,
    job_queue: mp.Queue,
    response_queue: mp.Queue,
    control_queue: mp.Queue,
    control_response_queue: mp.Queue,
):
    """
    Main worker process function that handles model loading and job processing.

    This function runs in a separate process and manages models on a specific GPU.
    """
    worker_id = worker_config.worker_id
    gpu_id = worker_config.gpu_id
    gpu_ids = list(worker_config.gpu_ids)
    cpu_only = (worker_config.resource_plan or {}).get("kind") == "cpu"
    device_label = "CPU" if cpu_only else f"GPU {gpu_id}"
    if cpu_only:
        # Dedicated worker process: hide CUDA before any runtime code can initialize it.
        os.environ["CUDA_VISIBLE_DEVICES"] = ""

    try:
        # Re-initialize logging in spawned worker process so logs are routed to logs/*.log files
        from core.config import get_settings, setup_logging
        worker_settings = get_settings()
        setup_logging(worker_settings.logging)

        # Apply runtime compatibility patches (SDPA hardware fallback, dinov3, gated repos, numba)
        try:
            from core.utils.runtime_compat import get_backend_torchvision_fix
            get_backend_torchvision_fix().apply_fix()
        except Exception as fix_err:
            logger.warning("Worker %s compatibility fix warning: %s", worker_id, fix_err)

        # Set up process environment
        logger.info(f"Starting worker process {worker_id} on {device_label}")
        # At the very beginning we try to login huggingface for the download of some special models
        import os
        from huggingface_hub import InferenceClient, login

        hf_token = os.getenv("HUGGINGFACE_TOKEN") or os.getenv("HF_TOKEN")
        if hf_token is not None:
            try:
                login(token=hf_token, add_to_git_credential=False)
                logger.info("Login to huggingface successfully.")
            except Exception as e:
                logger.warning("Failed to login to huggingface, possibly invalid token!")

        # Set primary CUDA device; multi-GPU adapters dispatch modules across worker_config.gpu_ids.
        if not cpu_only and gpu_id is not None and torch.cuda.is_available():
            torch.cuda.set_device(gpu_id)
        worker_threads = int((worker_config.resource_plan or {}).get("cpu_threads", 0))
        if worker_threads <= 1:
            worker_threads = os.cpu_count() or 8
        configure_cpu_runtime(worker_threads)
        if not cpu_only:
            # Enable TF32 and benchmark for Tensor Core acceleration.
            try:
                torch.backends.cuda.matmul.allow_tf32 = True
                torch.backends.cudnn.allow_tf32 = True
                torch.backends.cudnn.benchmark = True
            except Exception:
                pass
            # Warm up CUDA context only for GPU-backed resource plans.
            try:
                dummy = torch.zeros(1, device=f"cuda:{gpu_id}")
                del dummy
            except Exception:
                pass
            try:
                torch.cuda.empty_cache()
            except Exception:
                pass

        # Initialize worker state - simplified for single model
        loaded_model: Optional[BaseModel] = None
        model_config = worker_config.model_config
        model_id = model_config["model_id"]
        processing_job: Optional[str] = None

        logger.info(f"Worker {worker_id} initialized for model '{model_id}' (feature: {model_config.get('feature_type')})")

        # Sanitize token env vars in worker process so invalid/empty tokens don't cause HTTP 401
        for token_key in ("GITHUB_TOKEN", "GH_TOKEN", "HF_TOKEN", "HUGGINGFACE_TOKEN"):
            if token_key in os.environ and not os.environ[token_key].strip():
                os.environ.pop(token_key, None)

        # Load model immediately upon worker creation
        try:
            logger.info(f"[MODEL LOAD START] Worker {worker_id} loading model '{model_id}' on {device_label} with config: {model_config.get('init_params', {})}")
            model = _create_model_from_config(model_config)
            success = model.load(gpu_id, resource_plan=worker_config.resource_plan)

            if success:
                loaded_model = model
                logger.info(f"[MODEL LOAD SUCCESS] ✓ Worker {worker_id} loaded model '{model_id}' on {device_label}")
                control_response_queue.put(WorkerResponse("init", True, {"model_id": model_id}))
            else:
                err_msg = f"Worker {worker_id} model.load on {device_label} returned False for model '{model_id}'"
                logger.error(f"[MODEL LOAD FAILED] ❌ {err_msg}")
                try:
                    control_response_queue.put(WorkerResponse("init", False, error=err_msg))
                    time.sleep(1.0)
                except Exception:
                    pass
                return  # Exit worker if model loading fails
        except Exception as e:
            import traceback
            tb = traceback.format_exc()
            err_msg = f"FATAL ERROR loading model '{model_id}' in worker {worker_id}: {e}"
            logger.error(f"❌ {err_msg}\n{tb}")
            try:
                control_response_queue.put(WorkerResponse("init", False, error=err_msg))
                time.sleep(1.0)
            except Exception:
                pass
            return  # Exit worker if model loading fails

        # Main worker loop
        while True:
            try:
                # Check for control messages (non-blocking)
                try:
                    control_msg = control_queue.get_nowait()
                    response = _handle_control_message(
                        control_msg,
                        loaded_model,
                        model_config,
                        processing_job,
                        gpu_id,
                        worker_config.resource_plan,
                    )
                    control_response_queue.put(response)

                    # Check for shutdown
                    if control_msg.type == WorkerMessage.Type.SHUTDOWN:
                        break

                except queue.Empty:
                    pass

                # Check for job processing (blocking with timeout)
                try:
                    job_data = job_queue.get(timeout=0.1)
                    job_request, result_callback_id = job_data
                    logger.info(f"Worker {worker_id} received job {job_request.job_id}")

                    # Process job
                    result, loaded_model, processing_job = _process_job_in_worker(
                        job_request,
                        loaded_model,
                        model_config,
                        processing_job,
                        gpu_id,
                        worker_config.resource_plan,
                    )
                    status_str = "SUCCESS" if result.get("success") else "FAILED"
                    logger.info(
                        f"Worker {worker_id} finished job {job_request.job_id} [status={status_str}]"
                    )

                    # Send result back
                    response_queue.put((result_callback_id, result))

                except queue.Empty:
                    continue

            except Exception as e:
                logger.error(f"Error in worker {worker_id}: {e}")
                time.sleep(0.1)

    except KeyboardInterrupt:
        logger.info(f"Worker {worker_id} received shutdown signal")
    except Exception as e:
        logger.error(f"Fatal error in worker {worker_id}: {e}")
    finally:
        # Cleanup
        try:
            if loaded_model and hasattr(loaded_model, "_unload_model"):
                # Synchronous unload for cleanup
                try:
                    logger.info(f"[MODEL UNLOAD START] Worker {worker_id} unloading model from {device_label}...")
                    loaded_model._unload_model()
                    logger.info(f"[MODEL UNLOAD SUCCESS] ✓ Worker {worker_id} unloaded model from {device_label}")
                except Exception as unl_err:
                    logger.warning(f"[GPU UNLOAD FAILED] Worker {worker_id} unload warning: {unl_err}")
            if not cpu_only and torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:
            pass
        logger.info(f"Worker {worker_id} shutdown complete")


_worker_loop = model_worker_process


def _handle_control_message(
    msg: WorkerMessage,
    loaded_model: Optional[BaseModel],
    model_config: Dict[str, Any],
    processing_job: Optional[str],
    gpu_id: Optional[int],
    resource_plan: Optional[Dict[str, Any]] = None,
) -> WorkerResponse:
    """Handle control messages in worker process - simplified for single model"""
    try:
        model_id = model_config["model_id"]
        device_label = "CPU" if (resource_plan or {}).get("kind") == "cpu" else f"GPU {gpu_id}"

        if msg.type == WorkerMessage.Type.LOAD_MODEL:
            requested_model_id = msg.data["model_id"]
            if requested_model_id != model_id:
                return WorkerResponse(
                    msg.msg_id,
                    False,
                    error=f"Worker only supports model {model_id}, not {requested_model_id}",
                )

            if loaded_model is not None:
                return WorkerResponse(msg.msg_id, True, {"status": "already_loaded"})

            # Create and load model
            logger.info(f"[MODEL LOAD START] Worker loading model '{model_id}' on {device_label}...")
            model = _create_model_from_config(model_config)

            # Load synchronously (we're in a worker process)
            success = model.load(gpu_id, resource_plan=resource_plan)

            if success:
                loaded_model = model
                logger.info(f"[MODEL LOAD SUCCESS] ✓ Worker loaded model '{model_id}' on {device_label}")
                return WorkerResponse(msg.msg_id, True, {"status": "loaded"})
            else:
                logger.error(f"[MODEL LOAD FAILED] ❌ Failed to load model '{model_id}' on {device_label}")
                return WorkerResponse(msg.msg_id, False, error="Failed to load model")

        elif msg.type == WorkerMessage.Type.UNLOAD_MODEL:
            requested_model_id = msg.data["model_id"]
            if requested_model_id != model_id:
                return WorkerResponse(msg.msg_id, True, {"status": "not_our_model"})

            if loaded_model is None:
                return WorkerResponse(msg.msg_id, True, {"status": "not_loaded"})

            logger.info(f"[MODEL UNLOAD START] Worker unloading model '{model_id}' from {device_label}...")
            success = loaded_model.unload()

            if success:
                loaded_model = None
                logger.info(f"[MODEL UNLOAD SUCCESS] ✓ Worker unloaded model '{model_id}' from {device_label}")
                return WorkerResponse(msg.msg_id, True, {"status": "unloaded"})
            else:
                logger.error(f"[MODEL UNLOAD FAILED] ❌ Failed to unload model '{model_id}' from {device_label}")
                return WorkerResponse(msg.msg_id, False, error="Failed to unload model")

        elif msg.type == WorkerMessage.Type.GET_STATUS:
            status = {
                "gpu_id": gpu_id,
                "model_id": model_id,
                "loaded": loaded_model is not None,
                "processing": processing_job is not None,
                "model_status": loaded_model.get_info() if loaded_model else None,
            }
            return WorkerResponse(msg.msg_id, True, status)

        elif msg.type == WorkerMessage.Type.HEALTH_CHECK:
            return WorkerResponse(msg.msg_id, True, {"status": "healthy"})

        elif msg.type == WorkerMessage.Type.SHUTDOWN:
            return WorkerResponse(msg.msg_id, True, {"status": "shutting_down"})

        else:
            return WorkerResponse(
                msg.msg_id, False, error=f"Unknown message type: {msg.type}"
            )

    except Exception as e:
        logger.error(f"Error handling control message {msg.type}: {e}")
        return WorkerResponse(msg.msg_id, False, error=str(e))


def _reset_cuda_peak_memory_stats(resource_plan: Optional[Dict[str, Any]], fallback_gpu_id: Optional[int]) -> None:
    """Reset per-job CUDA memory peaks after model load and before inference."""
    if (resource_plan or {}).get("kind") == "cpu":
        return
    if torch is None or not torch.cuda.is_available():
        return
    gpu_ids = (resource_plan or {}).get("gpu_ids") or [fallback_gpu_id]
    for gpu_id in sorted({int(value) for value in gpu_ids if value is not None}):
        try:
            torch.cuda.reset_peak_memory_stats(gpu_id)
        except Exception:
            logger.debug("Could not reset CUDA peak stats for GPU %s", gpu_id, exc_info=True)

def _sha256_existing_file(path: Any) -> Optional[str]:
    """Hash a persisted source file without loading it into memory."""
    if not path:
        return None
    try:
        source = Path(path)
        if not source.is_file():
            return None
        digest = hashlib.sha256()
        with source.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()
    except OSError:
        logger.debug("Could not hash generation provenance path %s", path, exc_info=True)
        return None


def _attach_raw_geometry_telemetry(
    result: Dict[str, Any],
    job_request: JobRequest,
    model_id: str,
    model_inputs: Dict[str, Any],
    model_config: Dict[str, Any],
    loaded_model: BaseModel,
    gpu_id: int,
    resource_plan: Optional[Dict[str, Any]] = None,
    inference_seconds: Optional[float] = None,
) -> None:
    """Attach common model/input/output provenance to every raw image geometry job."""
    if str(getattr(job_request, "feature", "") or "").lower().replace("-", "_") not in {
        "image_to_raw_mesh", "image_to_textured_mesh", "image_to_3d"
    }:
        return
    output_path = (
        result.get("output_mesh_path") or result.get("mesh_path")
        or result.get("output_path") or result.get("file_path")
    )
    if not output_path or not Path(output_path).is_file():
        return

    info = result.get("generation_info")
    if not isinstance(info, dict):
        info = {}
        result["generation_info"] = info

    request_inputs = job_request.inputs or {}
    input_image = model_inputs.get("image_path") or request_inputs.get("image_path")
    reference_image = request_inputs.get("reference_image_path") or input_image
    preprocessing_metadata = request_inputs.get("preprocessing_metadata")
    parameter_names = (
        "source_quality", "seed", "num_inference_steps", "num_steps", "guidance_scale",
        "cfg_scale", "pipeline_type", "max_num_tokens", "sparse_structure_sampler_params",
        "shape_slat_sampler_params", "tex_slat_sampler_params", "sampler_overrides", "ss_sampling_steps", "slat_sampling_steps",
        "octree_resolution", "octree_res", "grid_resolution", "flash_octree_depth",
        "dense_octree_depth", "hierarchical_octree_depth", "num_chunks",
        "input_processing", "do_refine", "expansion_weight", "init_type",
        "faces", "decimation_target", "simplify", "remesh", "low_vram", "low_vram_mode",
        "enable_flashvdm",
    )
    native_vertices = info.get("native_vertex_count", info.get("vertex_count"))
    native_faces = info.get("native_face_count", info.get("face_count"))
    if native_vertices is None or native_faces is None:
        try:
            import trimesh
            loaded = trimesh.load(str(output_path), process=False)
            if isinstance(loaded, trimesh.Scene):
                geometries = [
                    geometry for geometry in loaded.geometry.values()
                    if hasattr(geometry, "vertices") and hasattr(geometry, "faces")
                ]
                native_vertices = sum(len(geometry.vertices) for geometry in geometries)
                native_faces = sum(len(geometry.faces) for geometry in geometries)
            elif hasattr(loaded, "vertices") and hasattr(loaded, "faces"):
                native_vertices, native_faces = len(loaded.vertices), len(loaded.faces)
        except Exception:
            logger.debug("Could not read geometry statistics for %s", output_path, exc_info=True)

    try:
        raw_bytes = Path(output_path).stat().st_size
    except OSError:
        return
    scheduled_gpus = (resource_plan or {}).get("gpu_ids") or [gpu_id]
    gpu_details = []
    if torch is not None and torch.cuda.is_available():
        for device_id in sorted({int(value) for value in scheduled_gpus if value is not None}):
            try:
                props = torch.cuda.get_device_properties(device_id)
                gpu_details.append({
                    "id": device_id,
                    "name": str(getattr(props, "name", f"GPU {device_id}")),
                    "total_vram_bytes": int(getattr(props, "total_memory", 0)),
                    "peak_allocated_vram_bytes": int(torch.cuda.max_memory_allocated(device_id)),
                    "peak_reserved_vram_bytes": int(torch.cuda.max_memory_reserved(device_id)),
                })
            except Exception:
                logger.debug("Could not collect CUDA telemetry for GPU %s", device_id, exc_info=True)

    def _image_dimensions(path: Any) -> Optional[List[int]]:
        if not path:
            return None
        try:
            from PIL import Image
            with Image.open(path) as image:
                return [int(image.width), int(image.height)]
        except Exception:
            return None

    resolution = info.get("effective_geometry_resolution")
    resolution_status = (
        info.get("effective_geometry_resolution_status")
        or info.get("resolution_status")
        or ("reported_by_adapter" if resolution is not None else
            "upstream adapter does not expose a scalar achieved resolution")
    )
    effective_parameters = {
        key: (dict(model_inputs[key]) if isinstance(model_inputs[key], dict) else model_inputs[key])
        for key in parameter_names if key in model_inputs
    }
    # Adapter-reported values represent the actual call, unlike stripped request overrides.
    for key in parameter_names:
        if key in info:
            effective_parameters[key] = info[key]
    if "num_inference_steps" not in effective_parameters and "steps" in info:
        effective_parameters["num_inference_steps"] = info["steps"]
    info["raw_geometry_telemetry"] = {
        "schema_version": 2,
        "model_id": model_id,
        "model_version": getattr(loaded_model, "version", None),
        "adapter_class": type(loaded_model).__name__,
        "checkpoint": str(getattr(loaded_model, "model_path", model_config.get("model_path", "unknown"))),
        "checkpoint_revision": (
            getattr(loaded_model, "revision", None)
            or getattr(loaded_model, "model_revision", None)
            or model_config.get("revision")
        ),
        "source_quality": info.get("source_quality", model_inputs.get("source_quality", "model_default")),
        "inference_runtime_seconds": round(float(inference_seconds), 4) if inference_seconds is not None else None,
        "input_image_sha256": _sha256_existing_file(input_image),
        "reference_image_sha256": _sha256_existing_file(reference_image),
        "input_image_size": _image_dimensions(input_image),
        "reference_image_size": _image_dimensions(reference_image),
        "preprocessing": {
            "artifact_id": request_inputs.get("preprocessing_artifact_id"),
            "enabled": bool(request_inputs.get("enhancement_enabled", False)),
            "metadata": preprocessing_metadata if isinstance(preprocessing_metadata, dict) else None,
        },
        "effective_parameters": effective_parameters,
        "scheduler_gpu_ids": list(scheduled_gpus),
        "primary_gpu_id": int(gpu_id),
        "model_device": str(getattr(loaded_model, "device", None) or "adapter_reported_device"),
        "gpu_telemetry": gpu_details,
        "reported_inference_dtype": str(
            getattr(loaded_model, "dtype", None)
            or info.get("inference_dtype")
            or "not_exposed_by_adapter"
        ),
        "raw_mesh_path": str(output_path),
        "raw_mesh_bytes": raw_bytes,
        "raw_mesh_sha256": _sha256_existing_file(output_path),
        "native_vertex_count": native_vertices,
        "native_face_count": native_faces,
        "requested_geometry_resolution": info.get("requested_geometry_resolution"),
        "geometry_extraction_grid_resolution": info.get("geometry_extraction_grid_resolution"),
        "effective_geometry_resolution": resolution,
        "effective_geometry_resolution_status": resolution_status,
        "geometry_resolution_limited": bool(info.get("geometry_resolution_limited", False)),
        "geometry_resolution_limit_reason": info.get("geometry_resolution_limit_reason"),
        "geometry_quality_warning": info.get("geometry_quality_warning"),
        "geometry_resolution_source": info.get("geometry_resolution_source"),
        "voxel_size": info.get("voxel_size"),
        "geometry_extractor": info.get("geometry_extractor"),
        "mesh_operations": info.get("mesh_operations", []),
    }


def _process_job_in_worker(
    job_request: JobRequest,
    loaded_model: Optional[BaseModel],
    model_config: Dict[str, Any],
    processing_job: Optional[str],
    gpu_id: Optional[int],
    resource_plan: Optional[Dict[str, Any]] = None,
) -> Tuple[Dict[str, Any], Optional[BaseModel], Optional[str]]:
    """Process a job in the worker process - simplified for single model"""
    try:
        job_id = job_request.job_id
        model_id = model_config["model_id"]
        cpu_only = (resource_plan or {}).get("kind") == "cpu"

        # Check if this worker can handle the requested feature
        if model_config.get("feature_type") != job_request.feature:
            return (
                {
                    "success": False,
                    "error": f"Worker model {model_id} handles {model_config.get('feature_type')}, not {job_request.feature}",
                    "job_id": job_id,
                },
                loaded_model,
                processing_job,
            )

        # Check if worker is busy
        if processing_job is not None:
            return (
                {
                    "success": False,
                    "error": f"Worker is busy processing job {processing_job}",
                    "job_id": job_id,
                },
                loaded_model,
                processing_job,
            )

        # Load model if not already loaded
        if loaded_model is None:
            model = _create_model_from_config(model_config)
            success = model.load(gpu_id, resource_plan=resource_plan)

            if not success:
                return (
                    {
                        "success": False,
                        "error": f"Failed to load model {model_id}",
                        "job_id": job_id,
                    },
                    loaded_model,
                    processing_job,
                )

            loaded_model = model

        # Mark as processing
        processing_job = job_id
        start_time = time.time()
        logger.info(f"[GENERATION START] job_id={job_id} model={model_id} feature={job_request.feature}")

        # Configure CPU runtime if job request specifies threads override
        req_threads = int((job_request.inputs or {}).get("cpu_threads") or 0)
        if req_threads > 0:
            configure_cpu_runtime(req_threads)

        # Section 26: Exact runtime parameter logging
        request_inputs = job_request.inputs or {}
        model_inputs = _build_model_inference_inputs(request_inputs, model_id=model_id)

        # Effective seed plan. The planner's num_seeds is a plan value, so the
        # runtime log reports the candidates and the exact seeds that run.
        from core.config import get_quality_config
        from core.planner import get_planner_apply_config, resolve_seed_plan
        seeds_cfg = dict(get_quality_config()["seeds"])
        if model_inputs.get("seed") is None and request_inputs.get("seed") is None:
            seeds_cfg["base_seed"] = random.randint(10000, 999999)
        seed_plan = resolve_seed_plan(
            request_inputs,
            model_inputs,
            seeds_cfg=seeds_cfg,
            apply_cfg=get_planner_apply_config(),
        )
        total_seeds_to_run = int(seed_plan["candidate_count"])
        base_seed = int(seed_plan["base_seed"])
        seed_step = int(seed_plan["seed_step"])
        early_stop_score = float(seeds_cfg["early_stop_score"])
        seed_schedule = list(seed_plan["seed_schedule"])
        if "seed" not in model_inputs or model_inputs["seed"] is None:
            model_inputs["seed"] = base_seed

        runtime_log = {
            "model": model_id,
            "model_version": getattr(loaded_model, "version", "1.0"),
            "checkpoint": getattr(loaded_model, "model_path", model_config.get("model_path", "unknown")),
            "requested_quality": request_inputs.get("quality", request_inputs.get("meshQuality", "not_specified")),
            "source_quality_contract": model_inputs.get("source_quality", "max"),
            "postprocess_target_polycount": request_inputs.get("target_polycount", "native"),
            "actual_inference_steps": model_inputs.get("num_inference_steps", model_inputs.get("num_steps",
                "adapter_owned" if str(model_id).lower() in _ADAPTER_OWNED_INFERENCE_PROFILE_MODEL_IDS else "not_supported")),
            "actual_guidance": model_inputs.get("guidance_scale", model_inputs.get("cfg_scale",
                "adapter_owned" if str(model_id).lower() in _ADAPTER_OWNED_INFERENCE_PROFILE_MODEL_IDS else "not_supported")),
            "requested_resolution_parameter": model_inputs.get("resolution", "not_supported"),
            "requested_extraction_resolution": model_inputs.get(
                "mc_resolution", model_inputs.get("octree_resolution", model_inputs.get("octree_res", model_inputs.get(
                    "grid_resolution", "adapter_owned" if str(model_id).lower() in _ADAPTER_OWNED_INFERENCE_PROFILE_MODEL_IDS else "not_supported"))),
            ),
            "effective_geometry_resolution": "reported_after_decode_if_supported",
            "actual_seed": seed_schedule[0] if seed_schedule else "not_supported",
            "candidate_count": total_seeds_to_run,
            "planned_candidate_count": int(seed_plan["planned_candidate_count"]),
            "auto_seeds_enabled": bool(seed_plan["auto_seeds_enabled"]),
            "seed_schedule": seed_schedule,
            "actual_dtype": str(getattr(loaded_model, "dtype", None) or model_inputs.get("dtype") or "adapter_default"),
            "actual_device": (
                "cpu" if cpu_only else str(
                    getattr(loaded_model, "device", None)
                    or (f"cuda:{gpu_id}" if torch.cuda.is_available() else "cpu")
                )
            ),
            "actual_low_vram_mode": model_inputs.get("low_vram_mode", model_inputs.get("low_vram", "not_supported")),
            "requested_target_polycount": request_inputs.get("target_polycount", "native"),
            "requested_auto_optimize": request_inputs.get("auto_optimize", False),
            "adapter_received_target_polycount": "not_sent",
            "adapter_received_auto_optimize": "not_sent",
            "actual_decimation_target": model_inputs.get("decimation_target", "not_supported"),
        }
        logger.info(f"[RUNTIME PARAMETERS] job_id={job_id} params={json.dumps(runtime_log, default=str)}")
        logger.info(
            "[SEED PLAN] job_id=%s candidates=%s planned=%s auto_seeds=%s seeds=%s",
            job_id,
            total_seeds_to_run,
            seed_plan["planned_candidate_count"],
            seed_plan["auto_seeds_enabled"],
            seed_schedule,
        )

        # Format a clean, human-readable start box with REAL runtime values
        input_desc = "None"
        if request_inputs.get("text_prompt"):
            input_desc = f"Text: \"{request_inputs.get('text_prompt')}\""
        elif request_inputs.get("image_path") or request_inputs.get("image"):
            input_path = str(request_inputs.get("image_path") or request_inputs.get("image"))
            img_sz = ""
            if os.path.isfile(input_path):
                img_sz = f" ({format_bytes(os.path.getsize(input_path))})"
            input_desc = f"Image: {input_path}{img_sz}"

        logger.info(
            "\n" + format_box(
                "GENERATION: INFERENCE START",
                [
                    ("Job ID", job_id),
                    ("Model ID", f"{model_id} (v{runtime_log['model_version']})"),
                    ("Feature Type", job_request.feature),
                    ("Device", "CPU-only (GPU intentionally unused)" if cpu_only else f"{runtime_log['actual_device']} ({get_gpu_memory_summary(gpu_id)})"),
                    ("Input Source", input_desc),
                    ("Steps / Guidance", (
                        f"Steps={runtime_log['actual_inference_steps']} | CFG={runtime_log['actual_guidance']}"
                        if runtime_log["actual_inference_steps"] != "adapter_owned"
                        else "adapter-owned (effective values reported after inference)"
                    )),
                    ("Requested Resolution / Grid", f"{runtime_log['requested_resolution_parameter']} / {runtime_log['requested_extraction_resolution']}"),
                    ("Effective Geometry Resolution", runtime_log["effective_geometry_resolution"]),
                    ("Candidates", str(total_seeds_to_run)),
                    ("Seed" if len(seed_schedule) <= 1 else "Seeds", ", ".join(str(seed) for seed in seed_schedule)),
                    ("Quality Contract", runtime_log["source_quality_contract"]),
                    ("Downstream Budget", runtime_log["postprocess_target_polycount"]),
                ],
            )
        )

        # Reset after model load so these peaks cover this inference call, not model initialization.
        _reset_cuda_peak_memory_stats(resource_plan, gpu_id)
        inference_start_time = time.time()

        if total_seeds_to_run > 1:
            candidates_list = []
            candidate_results = []
            canonical_output_path = None
            for c_idx in range(total_seeds_to_run):
                c_seed = base_seed + (c_idx * seed_step)
                c_inputs = dict(model_inputs)
                c_inputs["seed"] = c_seed
                logger.info(f"[CANDIDATE GENERATION] Running candidate {c_idx + 1}/{total_seeds_to_run} with seed {c_seed}")
                with torch.no_grad():
                    c_res = loaded_model.process(c_inputs)
                if not isinstance(c_res, dict) or not c_res.get("success", True):
                    continue
                c_mesh = (
                    c_res.get("output_mesh_path")
                    or c_res.get("mesh_path")
                    or c_res.get("output_path")
                    or c_res.get("file_path")
                )
                if c_mesh and os.path.isfile(str(c_mesh)):
                    c_path = Path(c_mesh)
                    if canonical_output_path is None:
                        canonical_output_path = str(c_path)
                    cand_dest = c_path.parent / f"{c_path.stem}_cand_{c_idx}{c_path.suffix}"
                    try:
                        shutil.copy2(c_path, cand_dest)
                        saved_path = str(cand_dest)
                    except Exception:
                        saved_path = str(c_mesh)
                    cand_record = {
                        "candidate_id": c_idx,
                        "seed": c_seed,
                        "mesh_path": saved_path,
                        "selected": False,
                    }
                    candidates_list.append(cand_record)
                    candidate_results.append(c_res)
                    # Check early stop on this candidate
                    try:
                        import trimesh
                        from core.quality.metrics import compute_mesh_metrics
                        from core.scheduler.seed_scorer import score_seed_candidate
                        m = trimesh.load(saved_path, force="mesh", process=False)
                        cand_record["metrics"] = compute_mesh_metrics(m)
                        cand_record["score"] = float(score_seed_candidate(cand_record["metrics"]))
                        if cand_record["score"] >= early_stop_score:
                            logger.info(f"[CANDIDATE GENERATION] Early stopping triggered at candidate {c_idx} (score {cand_record['score']:.4f} >= {early_stop_score})")
                            break
                    except Exception as e:
                        logger.debug(f"Candidate {c_idx} scoring check failed: {e}")

            best_idx, candidates_list = _score_and_select(
                candidates_list,
                canonical_dest_path=canonical_output_path,
                early_stop_threshold=early_stop_score,
            )
            result = candidate_results[best_idx] if candidate_results else loaded_model.process(model_inputs)
            if candidates_list:
                result["candidates"] = candidates_list
                result["seed_scores"] = [c.get("score", 0.0) for c in candidates_list]
                result["selected_candidate_id"] = best_idx
                if seed_plan["auto_candidates"]:
                    for i, c in enumerate(candidates_list):
                        if i != best_idx and c.get("mesh_path") and os.path.isfile(c["mesh_path"]):
                            try:
                                os.remove(c["mesh_path"])
                            except Exception:
                                pass
        else:
            with torch.no_grad():
                result = loaded_model.process(model_inputs)

        effective_info = result.get("generation_info") if isinstance(result, dict) else None
        if isinstance(effective_info, dict):
            logger.info(
                "[EFFECTIVE PARAMETERS] job_id=%s model=%s params=%s",
                job_id,
                model_id,
                json.dumps(
                    {
                        key: effective_info.get(key)
                        for key in (
                            "num_inference_steps", "ss_sampling_steps", "slat_sampling_steps",
                            "guidance_scale", "slat_cfg_strength", "seed", "texture_resolution",
                        )
                    },
                    default=str,
                ),
            )

        inference_seconds = time.time() - inference_start_time
        if isinstance(result, dict) and result.get("success", True):
            try:
                _attach_raw_geometry_telemetry(
                    result,
                    job_request,
                    model_id,
                    model_inputs,
                    model_config,
                    loaded_model,
                    gpu_id,
                    resource_plan,
                    inference_seconds,
                )
            except Exception:
                # Provenance must never convert a successful model inference into a failed job.
                logger.warning("Could not attach geometry telemetry for %s", job_id, exc_info=True)

        elapsed = time.time() - start_time
        logger.info(f"[GENERATION SUCCESS] job_id={job_id} model={model_id} elapsed={elapsed:.2f}s")

        # Dynamically determine real output mesh / multiview statistics from output on disk
        out_mesh = (
            result.get("output_mesh_path")
            or result.get("mesh_path")
            or result.get("output_path")
            or result.get("file_path")
        )
        real_output_details = "N/A"
        if out_mesh and os.path.isfile(str(out_mesh)):
            fsize = format_bytes(os.path.getsize(str(out_mesh)))
            try:
                import trimesh
                m_peek = trimesh.load(str(out_mesh), process=False)
                if hasattr(m_peek, "faces") and len(m_peek.faces) > 0:
                    real_output_details = f"{len(m_peek.faces):,} faces | {len(m_peek.vertices):,} vertices ({fsize})"
                elif hasattr(m_peek, "geometry") and m_peek.geometry:
                    tot_f = sum(len(g.faces) for g in m_peek.geometry.values() if hasattr(g, "faces"))
                    tot_v = sum(len(g.vertices) for g in m_peek.geometry.values() if hasattr(g, "vertices"))
                    real_output_details = f"{tot_f:,} faces | {tot_v:,} vertices ({fsize})"
                else:
                    real_output_details = f"File size: {fsize}"
            except Exception:
                real_output_details = f"File size: {fsize}"
        elif result.get("multiview_images") or result.get("views"):
            views = result.get("multiview_images") or result.get("views") or []
            real_output_details = f"{len(views)} generated view images"

        logger.info(
            "\n" + format_box(
                "GENERATION: INFERENCE SUCCESS",
                [
                    ("Job ID", job_id),
                    ("Model ID", model_id),
                    ("Elapsed Time", f"{elapsed:.2f}s"),
                    ("Output Artifact", str(out_mesh) if out_mesh else "In-memory result"),
                    ("Artifact Details", real_output_details),
                    ("GPU Memory State", "CPU-only (GPU intentionally unused)" if cpu_only else get_gpu_memory_summary(gpu_id)),
                ],
            )
        )

        if auto_unload_after_job_enabled():
            try:
                logger.info(
                    f"[MODEL UNLOAD QUEUED] job_id={job_id} model={model_id} reason=AUTO_UNLOAD_AFTER_JOB"
                )
                loaded_model.unload()
                loaded_model = None
            except Exception as unload_err:
                logger.error(
                    f"[GPU UNLOAD FAILED] job_id={job_id} model={model_id}: {unload_err}",
                    exc_info=True,
                )

        return (
            {
                "success": True,
                "result": result,
                "job_id": job_id,
                "model_id": model_id,
            },
            loaded_model,
            None,
        )  # Clear processing_job

    except Exception as e:
        import traceback
        tb = traceback.format_exc()
        logger.error(f"[GENERATION FAILED] job_id={job_request.job_id} model={model_config.get('model_id')}: {e}\n{tb}")
        logger.info(
            "\n" + format_box(
                "GENERATION: INFERENCE FAILED",
                [
                    ("Job ID", job_request.job_id),
                    ("Model ID", model_config.get("model_id")),
                    ("Error Type", type(e).__name__),
                    ("Error Details", str(e)),
                ],
            )
        )
        if loaded_model is not None and auto_unload_after_job_enabled():
            try:
                logger.info(
                    f"[GPU UNLOAD QUEUED] job_id={job_request.job_id} "
                    f"model={model_config.get('model_id')} reason=GENERATION_FAILED"
                )
                loaded_model.unload()
                loaded_model = None
            except Exception as unload_err:
                logger.error(
                    f"[GPU UNLOAD FAILED] job_id={job_request.job_id} "
                    f"model={model_config.get('model_id')}: {unload_err}",
                    exc_info=True,
                )
        return (
            {"success": False, "error": f"{str(e)}\n{tb}", "job_id": job_request.job_id},
            loaded_model,
            None,
        )  # Clear processing_job on error


def _create_model_from_config(config: Dict[str, Any]) -> BaseModel:
    """Create a model instance from configuration"""
    from .model_factory import create_model_from_config

    return create_model_from_config(config)


class MultiprocessModelScheduler:
    """
    Multiprocessing-based model scheduler that provides true parallelism with FIFO job submission.

    This scheduler spawns worker processes on-demand for each model, enabling concurrent job
    execution across multiple GPU workers while maintaining strict FIFO order for job submission.
    Jobs are dequeued and submitted in order, but multiple jobs execute in parallel on available
    workers, maximizing GPU utilization.

    IMPORTANT: This scheduler should be used with uvicorn --workers 1 to avoid
    multiple scheduler instances. For multi-worker deployments, use external
    job queue systems like Redis/Celery.
    """

    _instance = None
    _initialized = False

    def __new__(cls, *args, **kwargs):
        if cls._instance is None:
            cls._instance = super(MultiprocessModelScheduler, cls).__new__(cls)
        return cls._instance

    def __init__(
        self,
        gpu_monitor: Optional[GPUMonitor] = None,
        job_queue: Optional[JobQueue] = None,
        database_url: Optional[str] = None,
        enable_processing: bool = True,  # NEW: Allow disabling job processing
    ):
        # Prevent multiple initialization
        if self._initialized:
            return

        # Set multiprocessing start method for CUDA safety
        if mp.get_start_method(allow_none=True) != "spawn":
            mp.set_start_method("spawn", force=True)

        self.gpu_monitor = gpu_monitor or GPUMonitor(tracking_mode=True)
        self.resource_planner = ResourcePlanner(self.gpu_monitor)
        self.job_queue = job_queue or JobQueue(
            database_url=database_url,
            max_size=1000,
            max_completed_jobs=1000,
            # Keep legacy parameters for backward compatibility
            persistence_file="data/job_queue_state.json",
            persistence_interval=30,
        )
        self.enable_processing = enable_processing  # NEW: Control job processing

        # Worker management
        self.workers: Dict[str, mp.Process] = {}
        self.worker_configs: Dict[str, WorkerConfig] = {}
        self.worker_queues: Dict[str, mp.Queue] = {}
        self.worker_response_queues: Dict[str, mp.Queue] = {}
        self.worker_control_queues: Dict[str, mp.Queue] = {}
        self.worker_control_response_queues: Dict[str, mp.Queue] = {}
        self.worker_current_job: Dict[str, Optional[str]] = {}
        self.worker_current_callback: Dict[str, Optional[str]] = {}
        self.job_to_callback: Dict[str, str] = {}

        # Model management
        self.model_registry: Dict[str, Dict[str, Any]] = {}
        self.model_features: Dict[str, List[str]] = {}
        self.worker_assignments: Dict[
            str, List[str]
        ] = {}  # model_id -> list of worker_ids
        self.worker_status: Dict[str, bool] = {}  # worker_id -> is_busy
        self.model_max_workers: Dict[str, int] = {}  # model_id -> max_workers
        self.worker_last_used: Dict[
            str, float
        ] = {}  # worker_id -> timestamp of last use
        self.model_selection_counter: Dict[str, int] = {}  # feature -> round-robin index
        self.idle_cleanup_interval: float = 30.0  # seconds to wait before considering cleanup, about 20 mins (30 seconds for debug)

        # Scheduler state
        self.running = False
        self._background_tasks: set[asyncio.Task] = set()
        self.response_handler_thread: Optional[threading.Thread] = None
        self.pending_results: Dict[str, asyncio.Future] = {}
        self.result_lock = threading.Lock()
        self.main_event_loop: Optional[asyncio.AbstractEventLoop] = None
        self.last_worker_error: Dict[str, str] = {}
        # Backoff before the next VRAM placement attempt (monotonic deadline, 0 = none)
        self._vram_wait_until: float = 0.0
        self._cancel_requested_jobs: set[str] = set()
        self._active_postprocess_cancels: Dict[str, threading.Event] = {}

        # Per-worker locks to prevent race conditions between check-and-mark
        self.worker_locks: Dict[str, asyncio.Lock] = {}

        # Thread pool for async operations
        self.thread_executor = ThreadPoolExecutor(max_workers=4)

        # Job processing task
        self.job_processing_task: Optional[asyncio.Task] = None

        # Mark as initialized
        self._initialized = True

    def register_model(self, model_config: Dict[str, Any]):
        """
        Register a model configuration with the scheduler.

        Args:
            model_config: Dictionary containing model configuration:
                - model_id: Unique model identifier
                - feature_type: Type of feature this model handles
                - module: Python module path for the model class
                - class: Model class name
                - init_params: Parameters for model initialization
                - vram_requirement: VRAM requirement in MB
                - max_workers: Maximum number of workers for this model (default: 1)
        """
        model_id = model_config["model_id"]
        feature_type = model_config["feature_type"]
        capabilities = dict(model_config.get("capabilities") or {})
        cpu_only = capabilities.get("cpu_only") is True
        gpu_count = 1 if cpu_only else max(len(self.gpu_monitor.get_gpu_status()), 1)
        max_workers = model_config.get("max_workers", 1) if cpu_only else max(model_config.get("max_workers", 1), gpu_count)
        capabilities.setdefault("image_to_3d", feature_type.startswith("image_to_"))
        capabilities.setdefault("multiview", False)
        capabilities.setdefault("raw_mesh", feature_type.endswith("raw_mesh"))
        capabilities.setdefault("texture_generation", feature_type in {"image_to_textured_mesh", "image_mesh_painting", "text_mesh_painting"})
        capabilities.setdefault("native_pbr", False)
        capabilities.setdefault("high_fidelity_geometry", False)
        capabilities.setdefault("multi_gpu", False)
        capabilities.setdefault("multi_gpu_strategy", None)
        model_config["capabilities"] = capabilities

        self.model_registry[model_id] = model_config
        self.model_max_workers[model_id] = max_workers

        # Index by feature type
        if feature_type not in self.model_features:
            self.model_features[feature_type] = []
        self.model_features[feature_type].append(model_id)

        logger.info(
            f"Registered model: {model_id} for feature: {feature_type}, max_workers: {max_workers}"
        )

    def unregister_model(self, model_id: str):
        """Unregister a model from the scheduler"""
        if model_id in self.model_registry:
            config = self.model_registry[model_id]
            feature_type = config["feature_type"]

            # Remove from feature index
            if feature_type in self.model_features:
                if model_id in self.model_features[feature_type]:
                    self.model_features[feature_type].remove(model_id)
                if not self.model_features[feature_type]:
                    del self.model_features[feature_type]

            # Shutdown and remove workers for this model
            if model_id in self.worker_assignments:
                worker_ids = self.worker_assignments[model_id].copy()
                for worker_id in worker_ids:
                    asyncio.create_task(self._destroy_worker(worker_id))
                del self.worker_assignments[model_id]

            # Cleanup tracking
            if model_id in self.model_max_workers:
                del self.model_max_workers[model_id]

            del self.model_registry[model_id]
            logger.info(f"Unregistered model: {model_id}")

    async def schedule_job(self, job_request: JobRequest) -> str:
        """Schedule a new job for processing"""
        if str(job_request.metadata.get("postprocess_mode") or "").lower() == "manual_mesh_tool":
            source_path = Path(str(job_request.inputs.get("mesh_path") or ""))
            if source_path.is_file():
                from core.utils.artifact_utils import sha256_file

                job_request.metadata.setdefault("source_sha256", sha256_file(source_path))

        # Validate that we have models for this feature
        if job_request.feature not in self.model_features:
            raise Exception(
                f"No models available for feature: {job_request.feature}. Available features: {list(self.model_features.keys())}"
            )

        try:
            job_id = await self.job_queue.enqueue(job_request)
        except Exception:
            self._cleanup_temporary_inputs(job_request)
            raise
        logger.info(f"Scheduled job {job_id} for feature {job_request.feature}")

        # Job will be processed by the background job processing loop
        return job_id

    async def get_job_status(self, job_id: str) -> Optional[Dict]:
        """Get job status and results"""
        job = await self.job_queue.get_job(job_id)
        if job:
            if isinstance(job, dict):
                return job
            return job.to_dict()
        return None

    async def cancel_job(self, job_id: str) -> bool:
        """Stop the owning worker, or set cooperative cancel signal for active post-processing."""
        job = await self.job_queue.get_job(job_id)
        if job is None:
            return False
        status_str = _extract_job_status(job)
        if status_str == "cancelled":
            return True
        if status_str != "processing":
            cancelled = await self.job_queue.cancel_job(job_id)
            if cancelled:
                self._cleanup_temporary_inputs(job)
            return cancelled

        stopped = await self._stop_worker_for_job(job_id, "cancelled by user")

        # Always signal post-processing cancellation, regardless of whether a worker was stopped.
        # Post-processing runs in the main process and may have started after the worker returned.
        self._cancel_requested_jobs.add(job_id)
        if job_id in self._active_postprocess_cancels:
            self._active_postprocess_cancels[job_id].set()
        if hasattr(self.job_queue, "request_cancel"):
            await self.job_queue.request_cancel(job_id)

        if not stopped:
            logger.info("No live worker found for processing job %s; set cooperative cancel request", job_id)
            return False

        self._cleanup_temporary_inputs(job)
        return True

    async def reorder_queued_jobs(self, ordered_job_ids: List[str]) -> bool:
        """Reorder pending jobs in the queue without touching active processing jobs."""
        if hasattr(self.job_queue, "reorder_queued_jobs"):
            return await self.job_queue.reorder_queued_jobs(ordered_job_ids)
        return False

    async def start(self):
        """Start the scheduler - no workers created initially"""
        if self.running:
            logger.warning("Scheduler is already running")
            return

        self.running = True
        # Store reference to main event loop
        self.main_event_loop = asyncio.get_event_loop()
        
        if self.enable_processing:
            logger.info("Starting multiprocess model scheduler (on-demand mode)")

            # Start job queue persistence
            await self.job_queue.start_persistence()
            await self.job_queue.recover_processing_jobs()
            self._cleanup_stale_input_dirs()

            # Start response handler thread
            self.response_handler_thread = threading.Thread(
                target=self._handle_worker_responses, daemon=True
            )
            self.response_handler_thread.start()

            # Start background job processing task
            self.job_processing_task = asyncio.create_task(self._job_processing_loop())

            # Start cleanup task for idle workers
            asyncio.create_task(self._cleanup_idle_workers())

            # Start cleanup task for dead workers
            asyncio.create_task(self._cleanup_dead_workers())

            # Start job queue cleanup task
            asyncio.create_task(self._job_queue_cleanup_loop())

            logger.info("Scheduler started - workers will be created on demand")
        else:
            logger.info("Scheduler started in queue-only mode (no job processing)")

    async def stop(self):
        """Stop the scheduler and cleanup worker processes"""
        if not self.running:
            return

        self.running = False
        logger.info("Stopping multiprocess model scheduler")

        # Stop job processing task
        if self.job_processing_task:
            self.job_processing_task.cancel()
            try:
                await self.job_processing_task
            except asyncio.CancelledError:
                pass

        if self._background_tasks:
            pending = list(self._background_tasks)
            _, still_pending = await asyncio.wait(pending, timeout=10.0)
            for task in still_pending:
                task.cancel()
            if still_pending:
                await asyncio.gather(*still_pending, return_exceptions=True)
            self._background_tasks.clear()

        # Stop job queue persistence
        await self.job_queue.stop_persistence()

        # Send shutdown messages to all workers
        for worker_id in list(self.workers.keys()):
            try:
                await self._destroy_worker(worker_id)
            except Exception as e:
                logger.warning(f"Error shutting down worker {worker_id}: {e}")

        # Stop response handler thread
        if self.response_handler_thread:
            self.response_handler_thread.join(timeout=2.0)

        # Final cleanup
        self.workers.clear()
        self.worker_configs.clear()
        self.worker_queues.clear()
        self.worker_response_queues.clear()
        self.worker_control_queues.clear()
        self.worker_control_response_queues.clear()
        self.worker_current_job.clear()
        self.worker_current_callback.clear()
        self.job_to_callback.clear()
        self.worker_assignments.clear()
        self.worker_status.clear()
        self.worker_last_used.clear()
        self.model_selection_counter.clear()
        self.main_event_loop = None

        logger.info("Multiprocess scheduler stopped")

    def validate_model_preference(self, model_id: str, feature: str) -> bool:
        """
        Validate that a model preference is valid for the given feature.

        Args:
            model_id: The preferred model ID
            feature: The feature type for the job

        Returns:
            True if the model exists and supports the feature, False otherwise
        """
        if not model_id:
            return True  # No preference is always valid

        # Check if model exists in registry
        if model_id not in self.model_registry:
            return False

        # Check if model supports the requested feature
        if feature not in self.model_features:
            return False

        return model_id in self.model_features[feature]

    def get_available_models(
        self, feature: Optional[str] = None
    ) -> Dict[str, List[str]]:
        """
        Get available models, optionally filtered by feature.

        Args:
            feature: Optional feature type to filter by

        Returns:
            Dictionary mapping feature types to lists of model IDs
        """
        if feature:
            return {feature: self.model_features.get(feature, [])}
        return dict(self.model_features)

    def _is_job_impossible(self, job_request: JobRequest) -> tuple[bool, str]:
        """
        Check if a job is impossible to process.

        Args:
            job_request: The job to check

        Returns:
            Tuple of (is_impossible, reason)
        """
        feature = job_request.feature

        # Check if any models support this feature
        if feature not in self.model_features:
            return True, f"No models available for feature: {feature}"

        # Check if job has been waiting too long (1 hour)
        if job_request.is_waiting_too_long():
            return True, "Job has been waiting for more than 1 hour"

        target_model_id = self._get_model_id_for_job(job_request)
        if target_model_id == "unknown" or target_model_id not in self.model_registry:
            return True, f"No compatible model available for feature: {feature}"

        model_config = self.model_registry[target_model_id]
        if self.resource_planner.model_is_impossible(model_config):
            caps = model_config.get("capabilities") or {}
            if caps.get("multi_gpu"):
                aggregate = sum(int(g.get("memory_total", 0)) for g in self.gpu_monitor.get_gpu_status())
                return True, f"VRAM requirement ({model_config.get('vram_requirement', 0)}MB) exceeds aggregate supported capacity ({aggregate}MB)"
            max_gpu = max((int(g.get("memory_total", 0)) for g in self.gpu_monitor.get_gpu_status()), default=0)
            return True, f"VRAM requirement ({model_config.get('vram_requirement', 0)}MB) exceeds maximum single-GPU capacity ({max_gpu}MB)"
        return False, ""

    async def get_system_status(self) -> Dict:
        """Get comprehensive system status"""
        gpu_status = self.gpu_monitor.get_gpu_status()
        queue_status = await self.job_queue.get_queue_status()

        # Get worker status
        async def read_worker_status(worker_id: str) -> tuple[str, Dict]:
            try:
                response = await self._send_control_message(
                    worker_id, WorkerMessage.Type.GET_STATUS, timeout=2.0
                )
                return worker_id, (
                    response.data if response.success else {"error": response.error}
                )
            except Exception as e:
                return worker_id, {"error": str(e)}

        worker_results = await asyncio.gather(
            *(read_worker_status(worker_id) for worker_id in self.workers),
            return_exceptions=False,
        )
        worker_status = dict(worker_results)

        return {
            "scheduler": {
                "type": "multiprocess_resource_aware",
                "running": self.running,
                "num_workers": len(self.workers),
                "processing_mode": "priority_fifo_with_resource_rotation",
            },
            "gpu": gpu_status,
            "resources": {
                "cpu_count": max(1, os.cpu_count() or 1),
                "cpu_threads_per_worker": max(1, (os.cpu_count() or 1) // max(1, len(self.workers))),
                "gpu_capacity": self.resource_planner.gpu_capacity_snapshot(),
            },
            "queue": queue_status,
            "workers": worker_status,
            "features": {
                feature: len(models) for feature, models in self.model_features.items()
            },
        }

    async def get_queue_info(self) -> Dict:
        """Get detailed queue information for monitoring FIFO behavior"""
        queue_status = await self.job_queue.get_queue_status()

        # Get the first few jobs in queue to verify FIFO order
        queue_preview = []
        async with self.job_queue._cache_lock:
            for i, job in enumerate(
                list(self.job_queue._queue_cache)[:5]
            ):  # First 5 jobs
                queue_preview.append(
                    {
                        "position": i + 1,
                        "job_id": job.job_id,
                        "feature": job.feature,
                        "created_at": job.created_at.isoformat(),
                        "priority": job.priority,
                        "waiting_time_seconds": (
                            datetime.utcnow() - job.created_at
                        ).total_seconds(),
                    }
                )

        return {
            "queue_status": queue_status,
            "queue_preview": queue_preview,
            "fifo_processing": True,
            "retry_mechanism": "disabled_for_resources",
        }

    async def _process_external_cancellations(self) -> None:
        """Stop workers for cancellation requests issued through a shared queue."""
        get_requests = getattr(self.job_queue, "get_cancel_requests", None)
        clear_request = getattr(self.job_queue, "clear_cancel_request", None)
        if not callable(get_requests) or not callable(clear_request):
            return

        for job_id in await get_requests():
            try:
                self._cancel_requested_jobs.add(job_id)
                if job_id in self._active_postprocess_cancels:
                    self._active_postprocess_cancels[job_id].set()
                stopped = await self._stop_worker_for_job(job_id, "cancelled by user")
                if not stopped:
                    job = await self.job_queue.get_job(job_id)
                    if job and _extract_job_status(job) == "queued":
                        await self.job_queue.cancel_job(job_id)
                await clear_request(job_id)
            except Exception:
                logger.error(
                    "Failed to process external cancellation for %s",
                    job_id,
                    exc_info=True,
                )

    async def _job_processing_loop(self):
        """
        Background loop that processes jobs from the queue using JobQueue.dequeue().
        
        Jobs are dequeued in FIFO order and submitted to workers. The loop does not wait
        for job completion, allowing multiple jobs to execute concurrently on different workers.
        """
        logger.info("Starting job processing loop")

        while self.running:
            try:
                await self._process_external_cancellations()
                # Backoff after a VRAM rejection: skip dequeuing so the same blocked
                # job is not re-requeued in a tight loop.
                if time.monotonic() < self._vram_wait_until:
                    await asyncio.sleep(0.5)
                    continue
                # Try to get next job from queue
                job_request = await self.job_queue.dequeue()

                if job_request is None:
                    # No jobs available, wait a bit
                    await asyncio.sleep(0.5)
                    continue

                logger.info(f"Dequeued job {job_request.job_id} for processing")

                # Submit job to worker (non-blocking, result handled in separate task)
                await self._process_job_with_queue_integration(job_request)

            except Exception as e:
                if "MISCONF" in str(e):
                    logger.warning("Detected Redis MISCONF (bgsave failure). Disabling stop-writes-on-bgsave-error...")
                    try:
                        if hasattr(self.job_queue, "_ensure_writable"):
                            await self.job_queue._ensure_writable()
                        elif hasattr(self.job_queue, "redis") and self.job_queue.redis:
                            await self.job_queue.redis.config_set("stop-writes-on-bgsave-error", "no")
                    except Exception as cfg_err:
                        logger.error("Failed to recover Redis from MISCONF: %s", cfg_err)
                    await asyncio.sleep(1.0)
                    continue
                logger.error(f"Error in job processing loop: {e}")
                await asyncio.sleep(1.0)

        logger.info("Job processing loop stopped")

    async def _batch_slot_available(self, job_request: JobRequest) -> bool:
        """Honor a batch's max_parallel limit across single-worker and Redis queues."""
        batch_id = job_request.metadata.get("batch_id")
        max_parallel = job_request.metadata.get("batch_max_parallel")
        if not batch_id or not max_parallel:
            return True
        try:
            limit = max(1, int(max_parallel))
        except (TypeError, ValueError):
            return True
        processing = await self.job_queue.get_jobs_by_status(JobStatus.PROCESSING)
        active = sum(
            1
            for job in processing
            if job.metadata.get("batch_id") == batch_id
        )
        return active < limit

    async def _process_job_with_queue_integration(self, job_request: JobRequest):
        """Process a job with proper JobQueue integration - FIFO approach with concurrent execution"""
        try:
            if not await self._batch_slot_available(job_request):
                await self.job_queue.requeue_job(job_request.job_id, front=False)
                await asyncio.sleep(0.25)
                return

            # First check if job is impossible to process
            is_impossible, impossible_reason = self._is_job_impossible(job_request)
            if is_impossible:
                await self.job_queue.fail_job(job_request.job_id, impossible_reason)
                logger.error(
                    f"Job {job_request.job_id} is impossible: {impossible_reason}"
                )
                return

            # Try to find or create worker with suitable model
            worker_result = await self._find_or_create_worker_for_job(job_request)

            if worker_result == "NO_FEATURE":
                # No models available for this feature - fail immediately
                await self.job_queue.fail_job(
                    job_request.job_id,
                    f"No models available for feature: {job_request.feature}",
                )
                return
            elif worker_result == "MODEL_LOAD_FAILED":
                target_model = self._get_model_id_for_job(job_request)
                load_err = self.last_worker_error.pop(
                    target_model,
                    f"Model '{target_model}' worker startup/load failed",
                )
                # Explicit model selections are hard requirements. Automatic routes may
                # fall back to the next compatible retained model instead of failing the job.
                if _may_fallback_after_model_load_failure(
                    job_request.model_preference, job_request.metadata
                ):
                    feature_models = self.model_features.get(job_request.feature, [])
                    routing_inputs = dict(job_request.inputs or {})
                    routing_inputs["available_gpu_count"] = len(self.gpu_monitor.get_gpu_status())
                    ranked = ResourcePlanner.choose_model(
                        self.model_registry,
                        feature_models,
                        routing_inputs,
                        explicit_model=None,
                    )
                    plan_chain = (job_request.inputs or {}).get("fallback_chain") or ((job_request.inputs or {}).get("plan") or {}).get("fallback_chain", [])
                    candidates = [m for m in plan_chain if m in feature_models and m != target_model]
                    if ranked and ranked not in candidates and ranked != target_model:
                        candidates.append(ranked)
                    candidates.extend(
                        model_id for model_id in feature_models
                        if model_id != target_model and model_id not in candidates
                    )
                    for candidate in candidates:
                        if candidate is None:
                            continue
                        if self.resource_planner.model_is_impossible(self.model_registry[candidate]):
                            continue
                        job_request.model_preference = candidate
                        fallback_result = await self._find_or_create_worker_for_job(job_request)
                        if isinstance(fallback_result, str) and fallback_result not in {
                            "MODEL_LOAD_FAILED",
                            "NO_VRAM",
                            "WORKERS_BUSY",
                            "NO_FEATURE",
                        }:
                            logger.warning(
                                "Job %s fell back from model %s to retained model %s after load failure",
                                job_request.job_id,
                                target_model,
                                candidate,
                            )
                            worker_result = fallback_result
                            break
                    else:
                        worker_result = "MODEL_LOAD_FAILED"
                if worker_result == "MODEL_LOAD_FAILED":
                    logger.error(
                        f"Job {job_request.job_id} failed: model '{target_model}' could not be loaded: {load_err}"
                    )
                    await self.job_queue.fail_job(
                        job_request.job_id,
                        f"Model load failed: {load_err}",
                    )
                    return
                if worker_result == "NO_FEATURE":
                    await self.job_queue.fail_job(
                        job_request.job_id,
                        f"No models available for feature: {job_request.feature}",
                    )
                    return
                if worker_result in {"WORKERS_BUSY", "NO_VRAM"}:
                    if worker_result == "NO_VRAM":
                        self._vram_wait_until = time.monotonic() + 5.0
                    await self.job_queue.requeue_job(job_request.job_id, front=False)
                    await asyncio.sleep(2.0)
                    return
            elif worker_result in ["WORKERS_BUSY", "NO_VRAM"]:
                # Resources unavailable: rotate the blocked job so compatible jobs
                # behind it can run.
                logger.info(
                    f"Job {job_request.job_id} cannot be processed now ({worker_result}), rotating queue"
                )
                if worker_result == "NO_VRAM":
                    self._vram_wait_until = time.monotonic() + 5.0
                await self.job_queue.requeue_job(job_request.job_id, front=False)

                # Add a short delay to prevent busy waiting
                await asyncio.sleep(2.0)
                return
            elif isinstance(worker_result, str):
                # Got a worker ID - proceed with job processing
                self._vram_wait_until = 0.0
                worker_id = worker_result
            else:
                # Unexpected result
                await self.job_queue.fail_job(
                    job_request.job_id,
                    f"Unexpected error finding worker: {worker_result}",
                )
                return

            # Determine model ID for this job
            model_id = self._get_model_id_for_job(job_request)

            # Mark job as started in the queue
            await self.job_queue.mark_job_started(job_request.job_id, model_id)

            # Create future for result
            result_future = asyncio.Future()
            callback_id = str(uuid.uuid4())

            with self.result_lock:
                self.pending_results[callback_id] = result_future
                self.job_to_callback[job_request.job_id] = callback_id

            # Mark worker as busy and send job
            marked = await self._mark_worker_busy_async(worker_id, job_request.job_id, callback_id)
            if not marked:
                # Worker became busy between check and mark - requeue
                await self.job_queue.requeue_job(job_request.job_id, front=False)
                await asyncio.sleep(0.25)
                return
            job_data = (job_request, callback_id)
            self.worker_queues[worker_id].put(job_data)
            logger.info(f"Sent job {job_request.job_id} to worker {worker_id} (callback: {callback_id})")

            # Create a separate task to handle the result asynchronously
            # This allows the main loop to continue processing other jobs
            asyncio.create_task(
                self._handle_job_result(job_request, result_future)
            )
            logger.info(
                f"Job {job_request.job_id} submitted to worker, result will be handled asynchronously"
            )

        except Exception as e:
            logger.error(f"Error processing job {job_request.job_id}: {e}")

            # For transient errors, requeue the job; for non-transient errors, fail immediately
            error_msg = str(e).lower()
            if retry_transient_errors_enabled() and any(
                keyword in error_msg
                for keyword in ["timeout", "connection", "network", "temporarily"]
            ):
                # Transient error - put job back in queue
                logger.info(
                    f"Job {job_request.job_id} encountered transient error, requeuing: {str(e)}"
                )
                await self.job_queue.requeue_job(job_request.job_id)
                await asyncio.sleep(2.0)  # Brief delay before processing continues
            else:
                # Non-transient error - fail immediately
                await self.job_queue.fail_job(job_request.job_id, str(e))

    async def _watch_auto_rig(
        self,
        parent_job_id: str,
        child_job_id: str,
        base_result: Dict[str, Any],
    ) -> None:
        """Wait for UniRig, persist the durable rigged artifact, then finalize the parent job."""
        try:
            while True:
                parent_job = await self.job_queue.get_job(parent_job_id)
                parent_status = _extract_job_status(parent_job)
                if parent_status in {"cancelled", "failed"}:
                    logger.info("Parent job %s is %s; cancelling auto-rig child %s", parent_job_id, parent_status, child_job_id)
                    await self.cancel_job(child_job_id)
                    return

                child = await self.job_queue.get_job(child_job_id)
                status = _extract_job_status(child)
                if status in {"completed", "failed", "cancelled"}:
                    break
                await asyncio.sleep(1.0)

            # Check parent job status before processing child results
            parent_job = await self.job_queue.get_job(parent_job_id)
            parent_status = _extract_job_status(parent_job)
            if parent_status in {"cancelled", "failed"}:
                logger.info("Parent job %s is %s; cleaning up child %s and exiting", parent_job_id, parent_status, child_job_id)
                child_result = (
                    child.get("result")
                    if isinstance(child, dict)
                    else getattr(child, "result", None)
                ) or {}
                child_path = child_result.get("output_mesh_path")
                if child_path and Path(child_path).is_file():
                    try:
                        Path(child_path).unlink()
                    except OSError:
                        pass
                return

            result = dict(base_result)
            child_result = (
                child.get("result")
                if isinstance(child, dict)
                else getattr(child, "result", None)
            ) or {}

            if status == "completed":
                child_path = child_result.get("output_mesh_path")
                child_fbx_path = child_result.get("output_fbx_path")
                if not child_path or not Path(child_path).is_file() or Path(child_path).suffix.lower() != ".glb":
                    raise RuntimeError("UniRig completed without a durable output_mesh_path")

                asset_root = Path(result["asset_root"]).resolve()
                storage_root = (get_storage_base_dir() / "models" / "meshes").resolve()
                asset_root.relative_to(storage_root)

                rig_dir = asset_root / "rigging" / child_job_id
                rig_dir.mkdir(parents=True, exist_ok=True)
                rig_path = rig_dir / "rigged.glb"
                source_glb = Path(child_path).resolve()
                source_glb.relative_to(asset_root)
                if source_glb != rig_path.resolve():
                    shutil.copy2(source_glb, rig_path)

                rig_fbx_path = None
                if child_fbx_path:
                    source_fbx = Path(child_fbx_path).resolve()
                    if source_fbx.suffix.lower() == ".fbx" and source_fbx.is_file() and source_fbx.stat().st_size > 0:
                        source_fbx.relative_to(asset_root)
                        rig_fbx_path = rig_dir / "rigged.fbx"
                        if source_fbx != rig_fbx_path.resolve():
                            shutil.copy2(source_fbx, rig_fbx_path)

                rig_url = (
                    f"/api/v1/system/jobs/{parent_job_id}/download"
                    f"?artifact_format=rigged"
                )
                result["output_fbx_path"] = str(rig_fbx_path) if rig_fbx_path else None
                result["rigging"] = {
                    "status": "completed",
                    "provider": "unirig_auto_rig",
                    "child_job_id": child_job_id,
                    "artifact_path": str(rig_path),
                    "artifact_url": rig_url,
                    "fbx_path": str(rig_fbx_path) if rig_fbx_path else None,
                    "fbx_status": "ready" if rig_fbx_path else "unavailable",
                    "bone_count": child_result.get("bone_count"),
                    "rig_info": child_result.get("rig_info"),
                }
                result["rigged_model_url"] = rig_url
                result["artifacts"] = {
                    **dict(result.get("artifacts") or {}),
                    "rigged": {
                        "status": "ready",
                        "url": rig_url,
                        "path": str(rig_path),
                        "format": "glb",
                        "required": False,
                    },
                    "rigged_fbx": {
                        "status": "ready" if rig_fbx_path else "unavailable",
                        "url": f"/api/v1/system/jobs/{parent_job_id}/download?artifact_format=fbx" if rig_fbx_path else None,
                        "path": str(rig_fbx_path) if rig_fbx_path else None,
                        "format": "fbx",
                        "required": False,
                    },
                }
                from postprocess.pipeline import register_asset_job_manifest

                master_path = Path(result.get("source_model_path") or asset_root / "master" / "source.glb")
                manifest_artifacts = {
                    "rigged": {"path": str(rig_path), "format": "glb"},
                }
                if rig_fbx_path:
                    manifest_artifacts["fbx"] = {"path": str(rig_fbx_path), "format": "fbx"}
                register_asset_job_manifest(
                    asset_root, parent_job_id, master_path, master_path, manifest_artifacts
                )
            else:
                error = (
                    child.get("error")
                    if isinstance(child, dict)
                    else getattr(child, "error", None)
                )
                result["rigging"] = {
                    "status": "failed" if status == "failed" else "cancelled",
                    "provider": "unirig_auto_rig",
                    "child_job_id": child_job_id,
                    "error": error or f"UniRig child job ended with {status}",
                }
                result["production_status"] = "degraded"
                result["degraded_reasons"] = list(result.get("degraded_reasons", [])) + ["auto_rig_failed"]

            result["workflow_rig_job_id"] = child_job_id

            # Check parent job status again before calling complete_job
            parent_job = await self.job_queue.get_job(parent_job_id)
            if parent_job and _extract_job_status(parent_job) in {"cancelled", "failed"}:
                logger.info("Parent job %s is %s; skipping complete_job after auto-rig", parent_job_id, _extract_job_status(parent_job))
                return

            await self.job_queue.update_job_progress(
                parent_job_id,
                1.0,
                "rigging",
                f"Auto-rig {status}",
            )
            await self.job_queue.complete_job(parent_job_id, result)
        except Exception as exc:
            logger.error(
                "Auto-rig finalization failed for parent %s: %s",
                parent_job_id,
                exc,
                exc_info=True,
            )
            parent_job = await self.job_queue.get_job(parent_job_id)
            if parent_job and _extract_job_status(parent_job) in {"cancelled", "failed"}:
                logger.info("Parent job %s is %s; skipping fallback complete_job", parent_job_id, _extract_job_status(parent_job))
                return

            fallback = dict(base_result)
            fallback["rigging"] = {
                "status": "failed",
                "provider": "unirig_auto_rig",
                "child_job_id": child_job_id,
                "error": str(exc),
            }
            fallback["production_status"] = "degraded"
            fallback["degraded_reasons"] = list(
                fallback.get("degraded_reasons", [])
            ) + ["auto_rig_workflow_failed"]
            await self.job_queue.complete_job(parent_job_id, fallback)

    async def _handle_job_result(self, job_request: JobRequest, result_future: asyncio.Future):
        """Handle job result asynchronously without blocking the main processing loop"""
        job_id = job_request.job_id
        keep_inputs_for_postprocess = False
        try:
            result = await asyncio.wait_for(result_future, timeout=3600.0)

            current_job = await self.job_queue.get_job(job_id)
            if (current_job and _extract_job_status(current_job) in {"failed", "cancelled"}) or job_id in self._cancel_requested_jobs:
                self._cleanup_temporary_inputs(job_request)
                return

            # Generation jobs become final only after canonical post-processing.
            if result.get("success"):
                final_result = result.get("result") or {}
                if job_request.feature in ("image_mesh_painting", "text_mesh_painting"):
                    postprocess_mode = "manual_mesh_tool"
                    enable_postprocess = False
                else:
                    postprocess_mode = str(job_request.metadata.get("postprocess_mode") or "none").lower()
                    enable_postprocess = bool(
                        job_request.metadata.get("enable_postprocess", True)
                        and job_request.inputs.get("enable_postprocess", True)
                    ) if ("enable_postprocess" in job_request.metadata or "enable_postprocess" in job_request.inputs) else (postprocess_mode == "production_mesh")

                    if not enable_postprocess and postprocess_mode == "production_mesh":
                        postprocess_mode = "none"

                # Normalize texture_enabled into post-processing rather than launching redundant independent child workflows.
                texture_enabled = bool(
                    job_request.metadata.get("texture_enabled")
                    or job_request.inputs.get("texture_enabled")
                    or job_request.metadata.get("generateTexture")
                    or job_request.inputs.get("generateTexture")
                    or job_request.metadata.get("generate_texture")
                    or job_request.inputs.get("generate_texture")
                    or job_request.metadata.get("auto_paint")
                    or job_request.inputs.get("auto_paint")
                )
                job_request.metadata["texture_enabled"] = texture_enabled
                job_request.inputs["texture_enabled"] = texture_enabled

                if postprocess_mode == "manual_mesh_tool":
                    from postprocess.pipeline import persist_manual_mesh_result

                    final_result = await asyncio.to_thread(
                        persist_manual_mesh_result,
                        job_id,
                        final_result,
                        job_request.inputs,
                        job_request.metadata,
                    )

                # Postprocessing runs for raw-mesh jobs with production_mesh mode when postprocess is enabled.
                if final_result.get("output_mesh_path") and postprocess_mode == "production_mesh" and enable_postprocess:
                    current_job = await self.job_queue.get_job(job_id)
                    if (current_job and _extract_job_status(current_job) in {"failed", "cancelled"}) or job_id in self._cancel_requested_jobs:
                        self._cleanup_temporary_inputs(job_request)
                        return

                    await self.job_queue.update_job_progress(
                        job_id, 0.75, "postprocess", "Running production post-processing"
                    )
                    logger.info(f"[POSTPROCESS PROGRESS] job_id={job_id} progress=75% stage=postprocess message='Running production post-processing'")

                    cancel_event = threading.Event()
                    if job_id in self._cancel_requested_jobs:
                        cancel_event.set()
                    self._active_postprocess_cancels[job_id] = cancel_event

                    def cancel_checker() -> bool:
                        return cancel_event.is_set() or job_id in self._cancel_requested_jobs

                    try:
                        from postprocess.pipeline import canonical_asset_workspace, run_postprocess_job
                        canonical_root = canonical_asset_workspace(job_id, final_result, job_request.inputs)
                        final_result = {**final_result, "asset_root": str(canonical_root), "postprocess_status": "running", "postprocess_progress": 0.0}
                        if "plan" in job_request.inputs and "plan" not in final_result:
                            final_result["plan"] = job_request.inputs["plan"]
                        job_request.result = final_result
                        if not await self.job_queue.update_job_result(job_id, final_result):
                            raise RuntimeError("Failed to persist post-process retry metadata")

                        loop = asyncio.get_running_loop()

                        def report(frac: float, stage: str, message: str) -> None:
                            calc_progress = 0.75 + (min(1.0, max(0.0, frac)) * 0.25)
                            pct = int(calc_progress * 100)
                            logger.info(
                                f"[POSTPROCESS PROGRESS] job_id={job_id} progress={pct}% stage={stage} message='{message}'"
                            )
                            future = asyncio.run_coroutine_threadsafe(
                                self.job_queue.update_job_progress(
                                    job_id,
                                    calc_progress,
                                    stage,
                                    message,
                                ),
                                loop,
                            )
                            # Telemetry must never block mesh post-processing.
                            if future.done():
                                try:
                                    future.result()
                                except Exception:
                                    logger.debug(
                                        "Could not persist postprocess progress for %s",
                                        job_id,
                                        exc_info=True,
                                    )

                        final_result = await asyncio.to_thread(
                            run_postprocess_job,
                            job_id,
                            final_result,
                            job_request.inputs,
                            {
                                **job_request.metadata,
                                "feature": job_request.feature,
                                "model_id": job_request.model_preference,
                                "physics_enabled": bool(job_request.metadata.get("physics_enabled", False)),
                                "physics_config": job_request.metadata.get("physics_config"),
                            },
                            report,
                            cancel_checker,
                        )
                    except (InterruptedError, asyncio.CancelledError):
                        logger.info(f"Post-processing cleanly cancelled for job {job_id}")
                        current_job = await self.job_queue.get_job(job_id)
                        if current_job and _extract_job_status(current_job) != "cancelled":
                            await self.job_queue.cancel_job(job_id)
                        return
                    except Exception as postprocess_error:
                        current_job = await self.job_queue.get_job(job_id)
                        if (current_job and _extract_job_status(current_job) in {"failed", "cancelled"}) or job_id in self._cancel_requested_jobs:
                            logger.info(f"Job {job_id} cancelled during post-processing; skipping fail_job")
                            return
                        err_msg = (
                            f"Post-processing failed for job {job_id}: "
                            f"{postprocess_error}"
                        )
                        await self.job_queue.fail_job(job_id, err_msg)
                        logger.error(err_msg, exc_info=True)
                        return
                    finally:
                        self._active_postprocess_cancels.pop(job_id, None)
                        self._cancel_requested_jobs.discard(job_id)

                current_job = await self.job_queue.get_job(job_id)
                if (current_job and _extract_job_status(current_job) in {"failed", "cancelled"}) or job_id in self._cancel_requested_jobs:
                    return

                if (
                    final_result.get("output_mesh_path")
                    and bool(job_request.inputs.get("enable_auto_rig"))
                    and postprocess_mode == "production_mesh"
                ):
                    child_request = JobRequest(
                        feature="auto_rig",
                        inputs={
                            "mesh_path": final_result["output_mesh_path"],
                            "rig_mode": job_request.inputs.get("auto_rig_mode", "full"),
                            "output_format": "glb",
                            "with_skinning": True,
                        },
                        model_preference="unirig_auto_rig",
                        priority=job_request.priority,
                        timeout_seconds=job_request.timeout_seconds,
                        metadata={
                            "postprocess_mode": "none",
                            "feature_type": "auto_rig",
                            "parent_job_id": job_id,
                            "workflow_id": str(job_request.metadata.get("workflow_id") or job_id),
                            "workflow_stage": "rigging",
                            "workflow_state": "queued",
                        },
                        user_id=job_request.user_id,
                    )
                    child_request.inputs["output_dir"] = str(
                        Path(final_result["asset_root"]).resolve()
                        / "rigging"
                        / child_request.job_id
                    )
                    child_request.metadata["asset_root"] = final_result["asset_root"]
                    child_request.metadata["source_path"] = final_result["output_mesh_path"]
                    child_request.metadata["source_master_path"] = str(
                        Path(final_result["asset_root"]).resolve() / "master" / "source.glb"
                    )
                    child_id = await self.schedule_job(child_request)
                    final_result["rigging"] = {
                        "status": "queued",
                        "provider": "unirig_auto_rig",
                        "child_job_id": child_id,
                    }
                    final_result["rigged_model_url"] = (
                        f"/api/v1/system/jobs/{job_id}/download"
                        f"?artifact_format=rigged"
                    )
                    await self.job_queue.update_job_result(job_id, final_result)
                    await self.job_queue.update_job_progress(
                        job_id,
                        0.90,
                        "rigging",
                        f"Auto-rig queued: {child_id}",
                    )
                    asyncio.create_task(
                        self._watch_auto_rig(job_id, child_id, final_result)
                    )
                    return

                if job_request.feature == "auto_rig":
                    asset_root = Path(job_request.metadata["asset_root"]).resolve(strict=True)
                    meshes_root = (get_storage_base_dir() / "models" / "meshes").resolve()
                    asset_root.relative_to(meshes_root)
                    expected_dir = asset_root / "rigging" / job_id
                    preview_path = Path(final_result.get("output_mesh_path") or "").resolve(strict=True)
                    preview_path.relative_to(expected_dir.resolve())
                    if preview_path.suffix.lower() != ".glb" or preview_path.stat().st_size == 0:
                        raise RuntimeError("UniRig did not produce a valid GLB preview artifact")

                    source_path = Path(job_request.metadata["source_path"]).resolve(strict=True)
                    master_path = Path(job_request.metadata["source_master_path"]).resolve(strict=True)
                    from core.utils.artifact_utils import sha256_file

                    if sha256_file(source_path) != job_request.metadata.get("source_sha256"):
                        raise RuntimeError("Selected source mesh changed during UniRig processing")

                    fbx_path_value = final_result.get("output_fbx_path")
                    fbx_path = Path(fbx_path_value).resolve(strict=True) if fbx_path_value else None
                    if fbx_path:
                        fbx_path.relative_to(expected_dir.resolve())
                        if fbx_path.suffix.lower() != ".fbx" or fbx_path.stat().st_size == 0:
                            fbx_path = None

                    final_result["asset_root"] = str(asset_root)
                    final_result["output_mesh_path"] = str(preview_path)
                    final_result["output_fbx_path"] = str(fbx_path) if fbx_path else None
                    final_result["rigging"] = {
                        "status": "completed",
                        "provider": "unirig_auto_rig",
                        "artifact_path": str(preview_path),
                        "fbx_path": str(fbx_path) if fbx_path else None,
                        "fbx_status": "ready" if fbx_path else "unavailable",
                    }
                    final_result["artifacts"] = {
                        **dict(final_result.get("artifacts") or {}),
                        "rigged": {
                            "status": "ready",
                            "path": str(preview_path),
                            "format": "glb",
                            "url": f"/api/v1/system/jobs/{job_id}/download?artifact_format=rigged",
                            "required": True,
                        },
                        "rigged_fbx": {
                            "status": "ready" if fbx_path else "unavailable",
                            "path": str(fbx_path) if fbx_path else None,
                            "format": "fbx",
                            "url": f"/api/v1/system/jobs/{job_id}/download?artifact_format=fbx" if fbx_path else None,
                            "required": False,
                        },
                    }
                    final_result["rigged_model_url"] = (
                        f"/api/v1/system/jobs/{job_id}/download?artifact_format=rigged"
                    )
                    final_result["output_fbx_url"] = (
                        f"/api/v1/system/jobs/{job_id}/download?artifact_format=fbx" if fbx_path else None
                    )
                    from postprocess.pipeline import register_asset_job_manifest

                    manifest_artifacts = {
                        "rigged": {"path": str(preview_path), "format": "glb"},
                        "glb": {"path": str(preview_path), "format": "glb"},
                    }
                    if fbx_path:
                        manifest_artifacts["fbx"] = {"path": str(fbx_path), "format": "fbx"}
                        manifest_artifacts["rigged_fbx"] = {"path": str(fbx_path), "format": "fbx"}
                    register_asset_job_manifest(
                        asset_root, job_id, source_path, master_path, manifest_artifacts
                    )

                if not enable_postprocess or postprocess_mode != "production_mesh":
                    final_result.setdefault("postprocess_status", "bypassed")
                    final_result.setdefault("production_status", "ready")
                    out_mesh = (
                        final_result.get("output_mesh_path")
                        or final_result.get("mesh_path")
                        or final_result.get("output_path")
                        or final_result.get("file_path")
                    )
                    if out_mesh and postprocess_mode == "manual_mesh_tool":
                        derived_url = f"/api/v1/system/jobs/{job_id}/download?artifact_format=derived"
                        master_url = f"/api/v1/system/jobs/{job_id}/download?artifact_format=master"
                        final_result.setdefault("model_url", derived_url)
                        final_result.setdefault("game_ready_url", derived_url)
                        final_result.setdefault("source_model_url", master_url)
                        final_result.setdefault("high_fidelity_url", master_url)
                        final_result.setdefault("download_url", derived_url)
                    elif out_mesh:
                        final_result.setdefault("model_url", f"/api/v1/system/jobs/{job_id}/download?artifact_format=glb")
                        final_result.setdefault("game_ready_url", f"/api/v1/system/jobs/{job_id}/download?artifact_format=glb")
                        final_result.setdefault("source_model_url", f"/api/v1/system/jobs/{job_id}/download?artifact_format=glb")
                        final_result.setdefault("download_url", f"/api/v1/system/jobs/{job_id}/download?artifact_format=glb")
                    gen_info = final_result.get("generation_info") or {}
                    if "polygon_count" not in final_result:
                        final_result["polygon_count"] = gen_info.get("face_count") or gen_info.get("native_face_count") or 0
                    if "vertex_count" not in final_result:
                        final_result["vertex_count"] = gen_info.get("vertex_count") or gen_info.get("native_vertex_count") or 0

                if isinstance(result, dict) and "candidates" in result and "candidates" not in final_result:
                    final_result["candidates"] = result["candidates"]

                await self.job_queue.complete_job(job_id, final_result)
                logger.info(f"[JOB COMPLETE] job_id={job_id} status=success")
            else:
                err_msg = result.get("error", "Unknown error")
                await self.job_queue.fail_job(job_id, err_msg)
                logger.error(f"[JOB FAILED] job_id={job_id} error={err_msg}")

        except asyncio.TimeoutError:
            logger.error(f"Job {job_id} timed out waiting for worker result (3600s)")
            try:
                await self._stop_worker_for_job(job_id, "timeout")
                await self.job_queue.fail_job(
                    job_id, "Job processing timed out after 3600 seconds"
                )
            except Exception as e_to:
                logger.error(f"Failed to terminate timed-out job {job_id}: {e_to}")
        except Exception as e:
            logger.error(f"Error handling result for job {job_id}: {e}")
            try:
                current_job = await self.job_queue.get_job(job_id)
                if current_job and _extract_job_status(current_job) not in {"failed", "cancelled"}:
                    await self.job_queue.fail_job(
                        job_id, f"Error handling result: {str(e)}"
                    )
            except Exception as e2:
                logger.error(f"Failed to mark job {job_id} as failed: {e2}")
        finally:
            if not keep_inputs_for_postprocess:
                self._cleanup_temporary_inputs(job_request)

    def _register_managed_input_dir(self, directory: Path) -> None:
        """Register an app-managed temporary input directory for safe cleanup."""
        try:
            resolved = directory.resolve()
        except OSError:
            return
        if not hasattr(self, "_managed_temp_input_dirs"):
            self._managed_temp_input_dirs = set()
        self._managed_temp_input_dirs.add(resolved)

    def _unregister_managed_input_dir(self, directory: Path) -> None:
        """Remove a managed temporary input directory from the cleanup allowlist."""
        try:
            resolved = directory.resolve()
        except OSError:
            return
        managed = getattr(self, "_managed_temp_input_dirs", None)
        if managed is not None:
            managed.discard(resolved)

    def _is_managed_input_dir(self, directory: Path) -> bool:
        """Check whether a directory is explicitly managed by this scheduler."""
        managed = getattr(self, "_managed_temp_input_dirs", None)
        if not managed:
            return False
        return directory in managed

    def _cleanup_temporary_inputs(self, job_request: Any) -> None:
        """Remove per-request mesh_gen_* input directories once job ownership ends."""
        parents = set()
        temp_base = Path(tempfile.gettempdir()).resolve()
        managed_dirs = set(getattr(self, "_managed_temp_input_dirs", set()) or set())
        if not managed_dirs:
            return

        def _to_local_path(value: Any) -> Optional[Path]:
            if isinstance(value, Path):
                return value
            if not isinstance(value, str):
                return None
            raw = value.strip()
            if not raw:
                return None
            # Ignore URL-like/opaque values; cleanup only needs local filesystem paths.
            lowered = raw.lower()
            if "://" in lowered:
                return None
            return Path(raw)

        def _safe_mesh_gen_dir(candidate: Path) -> Optional[Path]:
            try:
                resolved = candidate.resolve()
            except OSError:
                return None
            if resolved not in managed_dirs:
                return None
            if not resolved.is_dir():
                return None
            if not resolved.name.startswith("mesh_gen_"):
                return None
            if resolved == temp_base or temp_base not in resolved.parents:
                return None
            return resolved

        inputs = getattr(job_request, "inputs", None)
        if inputs is None and isinstance(job_request, dict):
            inputs = job_request.get("inputs", {})
        metadata = getattr(job_request, "metadata", None)
        if metadata is None and isinstance(job_request, dict):
            metadata = job_request.get("metadata", {})

        for container in (inputs, metadata):
            if not isinstance(container, dict):
                continue
            for value in container.values():
                items = value if isinstance(value, (list, tuple, set)) else [value]
                for item in items:
                    path = _to_local_path(item)
                    if path is None:
                        continue
                    candidate = _safe_mesh_gen_dir(path)
                    if candidate:
                        parents.add(candidate)
                        continue
                    parent_candidate = _safe_mesh_gen_dir(path.parent)
                    if parent_candidate:
                        parents.add(parent_candidate)

        for directory in parents:
            shutil.rmtree(directory, ignore_errors=True)
            self._unregister_managed_input_dir(directory)

    def _cleanup_stale_input_dirs(self) -> None:
        """Remove orphaned mesh_gen_* input directories from previous crashed sessions.

        Only dirs untouched for several hours qualify: the API process may be
        holding dirs for jobs still queued when this scheduler starts, and
        deleting those breaks the job with a missing-file error.
        """
        stale_after_seconds = 6 * 60 * 60
        now = time.time()
        temp_base = Path(tempfile.gettempdir())
        for entry in temp_base.iterdir():
            if not entry.is_dir() or not entry.name.startswith("mesh_gen_"):
                continue
            try:
                age = now - entry.stat().st_mtime
            except OSError:
                continue
            if age < stale_after_seconds:
                logger.debug(
                    "Skipping recent input dir (in flight): %s (%.0fs old)",
                    entry,
                    age,
                )
                continue
            shutil.rmtree(entry, ignore_errors=True)
            logger.debug("Cleaned stale input dir: %s", entry)

    async def _stop_worker_for_job(self, job_id: str, reason: str) -> bool:
        """Terminate the worker owning a job and release its resources."""
        worker_id = next(
            (wid for wid, current_job in self.worker_current_job.items()
             if current_job == job_id),
            None,
        )
        if not worker_id:
            return False

        callback_id = self.worker_current_callback.get(worker_id)
        with self.result_lock:
            future = self.pending_results.pop(callback_id, None) if callback_id else None
            self.job_to_callback.pop(job_id, None)

        process = self.workers.get(worker_id)
        if process and process.is_alive():
            process.terminate()
            await asyncio.to_thread(process.join, 2.0)

        await self._destroy_worker(worker_id)

        # Signal post-processing cancellation in case it started after worker returned
        self._cancel_requested_jobs.add(job_id)
        if job_id in self._active_postprocess_cancels:
            self._active_postprocess_cancels[job_id].set()

        if reason == "cancelled by user":
            await self.job_queue.cancel_job(job_id, force=True)
        else:
            await self.job_queue.fail_job(
                job_id, "Job processing timed out after 3600 seconds"
            )

        if future is not None and not future.done():
            future.set_result({
                "success": False,
                "error": reason,
                "job_id": job_id,
                "cancelled": reason == "cancelled by user",
            })
        return True

    def _get_model_id_for_job(self, job_request: JobRequest) -> str:
        """Get the model ID that will be used for processing this job"""
        feature = job_request.feature

        # Determine target model
        if job_request.model_preference:
            # Check if the preferred model exists and supports this feature
            if (
                job_request.model_preference in self.model_registry
                and job_request.model_preference in self.model_features.get(feature, [])
            ):
                return job_request.model_preference

        available_models = self.model_features.get(feature, [])
        if available_models:
            routing_inputs = dict(job_request.inputs or {})
            routing_inputs["available_gpu_count"] = len(self.gpu_monitor.get_gpu_status())
            preferred = ResourcePlanner.choose_model(
                self.model_registry,
                available_models,
                routing_inputs,
                explicit_model=None,
            )
            ordered = ([preferred] if preferred else []) + [m for m in available_models if m != preferred]
            first_viable = None
            for candidate in ordered:
                config = self.model_registry[candidate]
                if self.resource_planner.model_is_impossible(config):
                    continue
                if first_viable is None:
                    first_viable = candidate
                if self.resource_planner.plan(
                    config,
                    active_workers=self.resource_planner.cpu_worker_limit(len(self.workers)),
                ) is not None:
                    return candidate
            return first_viable or ordered[0]

        # This shouldn't happen if _is_job_impossible was called first, but just in case
        logger.warning(
            f"No model available for feature {feature} in job {job_request.job_id}"
        )
        return "unknown"

    async def _find_or_create_worker_for_job(self, job_request: JobRequest) -> str:
        """Find an existing worker or create a new one for the job

        Returns:
            - worker_id (str): If a worker is available or created successfully
            - "NO_FEATURE": If no models support this feature
            - "WORKERS_BUSY": If all workers are busy and max workers reached
            - "NO_VRAM": If no VRAM is available for creating new workers
        """
        feature = job_request.feature

        if feature not in self.model_features:
            return "NO_FEATURE"

        # Determine target model
        target_model_id = None
        if job_request.model_preference:
            # Check if the preferred model exists and supports this feature
            if (
                job_request.model_preference in self.model_registry
                and job_request.model_preference in self.model_features.get(feature, [])
            ):
                target_model_id = job_request.model_preference
                logger.info(f"🎯 Job {job_request.job_id}: User explicitly requested model '{target_model_id}' for feature '{feature}'")
            else:
                logger.warning(
                    f"⚠️ Preferred model '{job_request.model_preference}' is NOT available in registry for feature '{feature}'. "
                    f"Available registered models for this feature: {self.model_features.get(feature, [])}"
                )

        if not target_model_id:
            available_models = self.model_features.get(feature, [])
            if not available_models:
                logger.error(f"No registered models support feature '{feature}'")
                return "NO_FEATURE"
            target_model_id = self._get_model_id_for_job(job_request)
            logger.info(
                f"Auto-selected model '{target_model_id}' for feature '{feature}' "
                "using deterministic quality-aware routing"
            )

        # Try to find existing available worker for this model
        if target_model_id in self.worker_assignments:
            worker_ids = self.worker_assignments[target_model_id]
            available_worker = await self._find_available_worker_async(worker_ids)
            if available_worker:
                logger.info(
                    f"Using existing worker {available_worker} for model {target_model_id}"
                )
                return available_worker

        model_config = self.model_registry[target_model_id]
        cpu_only = (model_config.get("capabilities") or {}).get("cpu_only") is True

        # CPU-only models do not depend on the visible GPU inventory.
        current_workers = len(self.worker_assignments.get(target_model_id, []))
        gpu_count = 1 if cpu_only else max(len(self.gpu_monitor.get_gpu_status()), 1)
        configured_max = self.model_max_workers.get(target_model_id, 1)
        max_workers = configured_max if cpu_only else max(configured_max, gpu_count)

        if current_workers >= max_workers:
            logger.info(
                f"Model {target_model_id} has reached max workers ({max_workers}), job will wait"
            )
            return "WORKERS_BUSY"

        resource_plan = self.resource_planner.plan(
            model_config,
            active_workers=self.resource_planner.cpu_worker_limit(len(self.workers)),
        )
        if resource_plan is None and not cpu_only:
            # Multi-GPU LRU eviction: if no GPU has enough free VRAM, evict idle workers
            # starting with the oldest idle (LRU) on the GPU where the new model will fit.
            required_vram = int(model_config.get("vram_requirement", 1024))
            await self._evict_lru_workers_to_free_vram(required_vram, model_config)
            resource_plan = self.resource_planner.plan(
                model_config,
                active_workers=self.resource_planner.cpu_worker_limit(len(self.workers)),
            )
        if resource_plan is None:
            logger.info("No supported resource placement for model %s; job will wait", target_model_id)
            return "NO_VRAM"

        worker_id = await self._create_worker_for_model(
            target_model_id,
            resource_plan=resource_plan,
        )
        if worker_id:
            return worker_id
        else:
            return "MODEL_LOAD_FAILED"

    async def _create_worker_for_model(
        self,
        model_id: str,
        gpu_id: Optional[int] = None,
        resource_plan: Optional[ResourcePlan] = None,
    ) -> Optional[str]:
        """Create a new worker for the specified model on the given GPU"""
        try:
            model_config = self.model_registry[model_id]
            if resource_plan is None:
                resource_plan = self.resource_planner.plan(
                    model_config,
                    active_workers=self.resource_planner.cpu_worker_limit(len(self.workers)),
                )
                if resource_plan is None:
                    return None

            allocated = []
            for plan_gpu, plan_vram in resource_plan.reservation_mb.items():
                if not self.gpu_monitor.allocate_vram(int(plan_gpu), int(plan_vram)):
                    for allocated_gpu, allocated_vram in allocated:
                        self.gpu_monitor.deallocate_vram(allocated_gpu, allocated_vram)
                    logger.error(
                        "Failed to reserve %sMB on GPU %s for model %s",
                        plan_vram,
                        plan_gpu,
                        model_id,
                    )
                    return None
                allocated.append((int(plan_gpu), int(plan_vram)))

            primary_gpu = resource_plan.primary_gpu
            device_suffix = f"gpu{primary_gpu}" if primary_gpu is not None else "cpu"
            worker_count = len(self.worker_assignments.get(model_id, []))
            worker_id = f"worker_{model_id}_{device_suffix}_{worker_count}"

            worker_config = WorkerConfig(
                worker_id=worker_id,
                gpu_id=primary_gpu,
                gpu_ids=list(resource_plan.gpu_ids),
                resource_plan=resource_plan.as_dict(),
                model_config=model_config,
            )

            # Create communication queues
            job_queue = mp.Queue(maxsize=100)
            response_queue = mp.Queue()
            control_queue = mp.Queue()
            control_response_queue = mp.Queue()

            # Create and start worker process
            worker_process = mp.Process(
                target=model_worker_process,
                args=(
                    worker_config,
                    job_queue,
                    response_queue,
                    control_queue,
                    control_response_queue,
                ),
                name=worker_id,
            )

            # Store worker information
            self.workers[worker_id] = worker_process
            self.worker_configs[worker_id] = worker_config
            self.worker_queues[worker_id] = job_queue
            self.worker_response_queues[worker_id] = response_queue
            self.worker_control_queues[worker_id] = control_queue
            self.worker_control_response_queues[worker_id] = control_response_queue

            # Initialize worker as available
            self.worker_status[worker_id] = False
            self.worker_last_used[worker_id] = time.time()

            # Track assignment
            if model_id not in self.worker_assignments:
                self.worker_assignments[model_id] = []
            self.worker_assignments[model_id].append(worker_id)

            # Start process
            worker_process.start()

            # Wait for worker process to initialize and report model load status
            init_success = False
            error_reason = f"Worker {worker_id} terminated unexpectedly during model initialization"
            start_wait = time.time()
            max_load_timeout = 180.0

            while time.time() - start_wait < max_load_timeout:
                # 1. Check response queue first before process status
                try:
                    init_resp = control_response_queue.get(block=False)
                    if isinstance(init_resp, WorkerResponse) and init_resp.msg_id == "init":
                        if init_resp.success:
                            init_success = True
                        else:
                            error_reason = init_resp.error or error_reason
                        break
                except queue.Empty:
                    pass

                # 2. Check if worker process terminated
                if not worker_process.is_alive():
                    worker_process.join(timeout=1.0)
                    # Check queue one final time after process exit in case response was buffered
                    try:
                        init_resp = control_response_queue.get(timeout=0.5)
                        if isinstance(init_resp, WorkerResponse) and init_resp.msg_id == "init":
                            if init_resp.success:
                                init_success = True
                            else:
                                error_reason = init_resp.error or error_reason
                    except Exception:
                        pass

                    # If still generic message, report the process exitcode and tail master.log
                    if not init_success and "terminated unexpectedly" in error_reason:
                        exit_code = worker_process.exitcode
                        hint = ""
                        if exit_code in (-9, 137):
                            hint = " (SIGKILL: OS Out-of-Memory / OOM Killer)"
                        elif exit_code in (-11, 139):
                            hint = " (SIGSEGV: Segmentation Fault)"
                        
                        last_log_lines = ""
                        try:
                            master_log = Path(__file__).resolve().parents[2] / "logs" / "master.log"
                            if master_log.exists():
                                lines = master_log.read_text(encoding="utf-8", errors="replace").splitlines()
                                if lines:
                                    last_log_lines = "\nLast logs:\n" + "\n".join(lines[-10:])
                        except Exception:
                            pass
                        error_reason = f"Worker {worker_id} terminated unexpectedly (exitcode={exit_code}{hint}) during model initialization.{last_log_lines}"
                    break

                await asyncio.sleep(0.2)

            if not init_success:
                logger.error(
                    f"Worker {worker_id} failed during startup/model-load: {error_reason}"
                )
                self.last_worker_error[model_id] = error_reason
                self._remove_worker_tracking(worker_id, model_id, resource_plan.as_dict())
                if worker_process.is_alive():
                    worker_process.terminate()
                    worker_process.join(timeout=2.0)
                return None

            logger.info(
                f"Created worker {worker_id} for model {model_id} on "
                f"{'CPU' if primary_gpu is None else f'GPU {primary_gpu}'}"
            )

            return worker_id

        except Exception as e:
            logger.error(f"Error creating worker for model {model_id}: {e}")
            if "worker_id" in locals():
                self._remove_worker_tracking(
                    worker_id,
                    model_id,
                    resource_plan.as_dict() if resource_plan is not None else None,
                )
            elif resource_plan is not None:
                for plan_gpu, plan_vram in resource_plan.reservation_mb.items():
                    self.gpu_monitor.deallocate_vram(int(plan_gpu), int(plan_vram))
            return None

    async def _find_gpu_with_freeable_vram(self, required_vram: int) -> Optional[int]:
        """
        Find a GPU where we can free up enough VRAM by destroying idle workers.

        Args:
            required_vram: Required VRAM in MB

        Returns:
            GPU ID if a suitable GPU is found, None otherwise
        """
        # Get all available GPUs and check each one
        gpu_status = self.gpu_monitor.get_gpu_status()

        for gpu_info in gpu_status:
            gpu_id = gpu_info["id"]
            current_available = self.gpu_monitor.get_gpu_available_vram(gpu_id)

            if current_available >= required_vram:
                # This GPU already has enough VRAM
                return gpu_id

            # Check if we can free up enough VRAM on this GPU
            needed_to_free = required_vram - current_available

            # Find idle workers on this GPU
            idle_workers_on_gpu = []
            current_time = time.time()

            for worker_id, is_busy in self.worker_status.items():
                logger.info(f"Worker {worker_id} is busy: {is_busy}")
                if not is_busy:
                    worker_config = self.worker_configs[worker_id]
                    if worker_config.gpu_id == gpu_id:
                        last_used = self.worker_last_used.get(worker_id, current_time)
                        idle_time = current_time - last_used

                        # Only consider workers that have been idle for a reasonable time
                        if idle_time > 10:  # 10 seconds
                            worker_vram = worker_config.model_config.get(
                                "vram_requirement", 1024
                            )
                            idle_workers_on_gpu.append(
                                (worker_id, idle_time, worker_vram)
                            )
                            logger.info(
                                f"Worker {worker_id} has been idle for {idle_time} seconds"
                            )
                        else:
                            logger.info(
                                f"Worker {worker_id} hasn't been idle for enough time: {idle_time}"
                            )

            # Sort by idle time (longest idle first)
            idle_workers_on_gpu.sort(key=lambda x: x[1], reverse=True)

            # Check if we can free up enough VRAM by destroying idle workers
            potential_freed_vram = 0
            for _, _, worker_vram in idle_workers_on_gpu:
                potential_freed_vram += worker_vram
                if potential_freed_vram >= needed_to_free:
                    # We can free up enough VRAM on this GPU
                    logger.info(
                        f"Can free up {potential_freed_vram}MB VRAM on GPU {gpu_id} (need {needed_to_free}MB)"
                    )

                    # Actually free up the VRAM
                    await self._ensure_vram_available(required_vram, gpu_id)

                    # Verify that we now have enough VRAM
                    final_available = self.gpu_monitor.get_gpu_available_vram(gpu_id)
                    if final_available >= required_vram:
                        return gpu_id
                    break

        logger.info(f"No GPU can be made to have {required_vram}MB VRAM available")
        return None

    async def _evict_lru_workers_to_free_vram(
        self, required_vram: int, model_config: Dict[str, Any]
    ) -> bool:
        """Smart multi-GPU LRU eviction:
        Finds the best GPU to accommodate the requested VRAM by evicting idle cached workers.
        If a secondary GPU already has free VRAM, no workers are evicted.
        If eviction is necessary, evicts workers in Least Recently Used (oldest idle) order.
        """
        gpu_status = self.gpu_monitor.get_gpu_status()
        if not gpu_status:
            return False

        current_time = time.time()
        gpu_candidates = []

        for gpu_info in gpu_status:
            gpu_id = int(gpu_info["id"])
            current_available = self.gpu_monitor.get_gpu_available_vram(gpu_id)

            if current_available >= required_vram:
                return True

            needed = required_vram - current_available

            idle_on_gpu = []
            for worker_id, is_busy in self.worker_status.items():
                if not is_busy:
                    cfg = self.worker_configs.get(worker_id)
                    if cfg and cfg.gpu_id == gpu_id:
                        last_used = self.worker_last_used.get(worker_id, current_time)
                        worker_vram = int(cfg.model_config.get("vram_requirement", 1024))
                        idle_on_gpu.append((worker_id, last_used, worker_vram))

            # Oldest idle first (LRU)
            idle_on_gpu.sort(key=lambda x: x[1])
            reclaimable = sum(w[2] for w in idle_on_gpu)

            if current_available + reclaimable >= required_vram:
                oldest_use = idle_on_gpu[0][1] if idle_on_gpu else current_time
                gpu_candidates.append({
                    "gpu_id": gpu_id,
                    "available": current_available,
                    "needed": needed,
                    "idle_workers": idle_on_gpu,
                    "oldest_use": oldest_use,
                })

        if not gpu_candidates:
            logger.info(
                f"[LRU EVICTION] No GPU can satisfy {required_vram}MB VRAM even after evicting all idle models"
            )
            return False

        # Pick the GPU with oldest idle model or needing least memory
        gpu_candidates.sort(key=lambda c: (c["oldest_use"], c["needed"]))
        target_candidate = gpu_candidates[0]
        target_gpu_id = target_candidate["gpu_id"]

        logger.info(
            f"[LRU EVICTION] Selected GPU {target_gpu_id} for eviction (needs {target_candidate['needed']}MB freed) "
            f"to place '{model_config.get('model_id')}'"
        )

        for worker_id, last_used, worker_vram in target_candidate["idle_workers"]:
            cur_available = self.gpu_monitor.get_gpu_available_vram(target_gpu_id)
            if cur_available >= required_vram:
                break

            idle_secs = current_time - last_used
            w_cfg = self.worker_configs.get(worker_id)
            w_model = w_cfg.model_config.get("model_id") if w_cfg else "unknown"
            logger.info(
                f"[LRU EVICTION] Evicting idle model '{w_model}' (worker={worker_id}, GPU={target_gpu_id}) "
                f"idle for {idle_secs:.1f}s to free {worker_vram}MB VRAM"
            )
            try:
                await self._destroy_worker(worker_id)
            except Exception as e:
                logger.error(f"Error evicting worker {worker_id}: {e}")

        return self.gpu_monitor.get_gpu_available_vram(target_gpu_id) >= required_vram

    async def _ensure_vram_available(
        self, required_vram: int, target_gpu_id: Optional[int] = None
    ):
        """Ensure sufficient VRAM is available on target GPU by destroying idle workers if needed"""
        if target_gpu_id is not None:
            # Check specific GPU
            available_vram = self.gpu_monitor.get_gpu_available_vram(target_gpu_id)

            if available_vram >= required_vram:
                return  # Sufficient VRAM already available on target GPU

            logger.info(
                f"Freeing VRAM on GPU {target_gpu_id}: need {required_vram}MB, have {available_vram}MB"
            )

            # Find idle workers on the target GPU to destroy
            idle_workers = []
            current_time = time.time()

            for worker_id, is_busy in self.worker_status.items():
                if not is_busy:
                    worker_config = self.worker_configs.get(worker_id)
                    if not worker_config:
                        continue
                    worker_gpu_id = worker_config.gpu_id

                    # Only consider workers on the target GPU
                    if worker_gpu_id == target_gpu_id:
                        last_used = self.worker_last_used.get(worker_id, current_time)
                        idle_time = current_time - last_used
                        idle_workers.append((worker_id, idle_time))

            # Sort by idle time (longest idle first)
            idle_workers.sort(key=lambda x: x[1], reverse=True)

            # Destroy idle workers until we have enough VRAM on target GPU
            for worker_id, _ in idle_workers:
                current_available = self.gpu_monitor.get_gpu_available_vram(
                    target_gpu_id
                )
                if current_available >= required_vram:
                    break

                try:
                    # Get VRAM that will be freed by this worker
                    worker_config = self.worker_configs[worker_id]
                    model_config = worker_config.model_config
                    freed_vram = model_config.get("vram_requirement", 1024)

                    await self._destroy_worker(worker_id)

                    logger.info(
                        f"Destroyed idle worker {worker_id} on GPU {target_gpu_id}, freed {freed_vram}MB VRAM"
                    )

                except Exception as e:
                    logger.error(f"Error destroying idle worker {worker_id}: {e}")
        else:
            logger.warning(
                "_ensure_vram_available called without target_gpu_id - this should not happen in the new per-GPU logic"
            )

    async def _find_worker_for_job(self, job_request: JobRequest) -> Optional[str]:
        """Legacy method - now redirects to the new implementation"""
        return await self._find_or_create_worker_for_job(job_request)

    def _find_available_worker(self, worker_ids: List[str]) -> Optional[str]:
        """
        Find an available (not busy) worker from the given list.

        Args:
            worker_ids: List of worker IDs to check

        Returns:
            Available worker ID or None if all are busy
        """
        for worker_id in worker_ids:
            # Check if worker exists, is alive, and is not busy
            proc = self.workers.get(worker_id)
            if proc and proc.is_alive() and not self.worker_status.get(worker_id, False):
                return worker_id
        return None

    async def _find_available_worker_async(self, worker_ids: List[str]) -> Optional[str]:
        """Async version that uses locks to prevent race conditions"""
        for worker_id in worker_ids:
            if worker_id not in self.worker_locks:
                self.worker_locks[worker_id] = asyncio.Lock()
            
            async with self.worker_locks[worker_id]:
                proc = self.workers.get(worker_id)
                if proc and proc.is_alive() and not self.worker_status.get(worker_id, False):
                    # Tentatively mark as busy to prevent race
                    self.worker_status[worker_id] = True
                    self.worker_last_used[worker_id] = time.time()
                    return worker_id
        return None

    def _mark_worker_busy(
        self, worker_id: str, job_id: Optional[str] = None, callback_id: Optional[str] = None
    ):
        """Mark a worker as busy"""
        # Ensure lock exists for this worker
        if worker_id not in self.worker_locks:
            self.worker_locks[worker_id] = asyncio.Lock()
        
        # Use the lock to prevent race conditions
        # Note: This is a synchronous method called from async context,
        # so we can't await here. The lock is used in async methods instead.
        self.worker_status[worker_id] = True
        self.worker_last_used[worker_id] = time.time()
        if job_id is not None:
            self.worker_current_job[worker_id] = job_id
        if callback_id is not None:
            self.worker_current_callback[worker_id] = callback_id

    async def _mark_worker_busy_async(
        self, worker_id: str, job_id: Optional[str] = None, callback_id: Optional[str] = None
    ):
        """Async version of _mark_worker_busy with lock to prevent race conditions"""
        if worker_id not in self.worker_locks:
            self.worker_locks[worker_id] = asyncio.Lock()
        
        async with self.worker_locks[worker_id]:
            # Double-check worker is still available or was tentatively reserved for this job
            current_job = self.worker_current_job.get(worker_id)
            if current_job is not None and current_job != job_id:
                return False  # Truly busy with another active job
            
            self.worker_status[worker_id] = True
            self.worker_last_used[worker_id] = time.time()
            if job_id is not None:
                self.worker_current_job[worker_id] = job_id
            if callback_id is not None:
                self.worker_current_callback[worker_id] = callback_id
            return True

    def _mark_worker_available(self, worker_id: str):
        """Mark a worker as available"""
        self.worker_status[worker_id] = False
        self.worker_last_used[worker_id] = time.time()
        job_id = self.worker_current_job.pop(worker_id, None)
        callback_id = self.worker_current_callback.pop(worker_id, None)
        if job_id:
            self.job_to_callback.pop(job_id, None)
        if callback_id:
            for j_id, cb_id in list(self.job_to_callback.items()):
                if cb_id == callback_id:
                    self.job_to_callback.pop(j_id, None)

    def _handle_worker_responses(self):
        """Handle responses from worker processes (runs in separate thread)"""
        while self.running:
            try:
                # Check all response queues
                for worker_id, response_queue in self.worker_response_queues.items():
                    try:
                        callback_id, result = response_queue.get_nowait()
                        success = bool(result.get("success")) if isinstance(result, dict) else False
                        logger.info(
                            f"Worker {worker_id} response received: callback_id={callback_id} success={success}"
                        )

                        # Find corresponding future and mark worker as available
                        with self.result_lock:
                            if callback_id in self.pending_results:
                                future = self.pending_results.pop(callback_id)

                                # Mark worker as available again
                                self._mark_worker_available(worker_id)
                                logger.debug(f"Marked worker {worker_id} as available")

                                # Set result in event loop
                                if self.main_event_loop and not future.done():
                                    try:
                                        self.main_event_loop.call_soon_threadsafe(
                                            future.set_result, result
                                        )
                                        logger.debug(
                                            f"Set future result for callback {callback_id}"
                                        )
                                    except asyncio.InvalidStateError:
                                        pass
                                else:
                                    logger.warning(
                                        f"Cannot set future result: main_event_loop={self.main_event_loop}, future.done()={future.done()}"
                                    )
                            else:
                                logger.warning(
                                    f"Callback ID {callback_id} not found in pending results"
                                )

                    except queue.Empty:
                        continue

                time.sleep(0.01)  # Small delay to prevent busy waiting

            except Exception as e:
                logger.error(f"Error handling worker responses: {e}")
                time.sleep(0.1)

    async def _send_control_message(
        self, worker_id: str, msg_type: str, data: Any = None, timeout: float = 10.0
    ) -> WorkerResponse:
        """Send a control message to a worker and wait for response"""
        if worker_id not in self.worker_control_queues:
            raise Exception(f"Worker {worker_id} not found")

        msg = WorkerMessage(msg_type, data)

        # Send message
        self.worker_control_queues[worker_id].put(msg)

        # Wait for response
        start_time = time.time()
        while time.time() - start_time < timeout:
            try:
                response = self.worker_control_response_queues[worker_id].get_nowait()
                if response.msg_id == msg.msg_id:
                    return response
            except queue.Empty:
                await asyncio.sleep(0.01)

        raise TimeoutError(f"Timeout waiting for response from worker {worker_id}")

    async def _cleanup_idle_workers(self):
        """Cleanup idle workers periodically when their idle time exceeds model cache TTL"""
        while self.running:
            try:
                ttl = get_model_cache_ttl_seconds()
                current_time = time.time()

                workers_to_destroy = []

                for worker_id, is_busy in list(self.worker_status.items()):
                    if not is_busy:
                        last_used = self.worker_last_used.get(worker_id, current_time)
                        idle_time = current_time - last_used

                        # If idle time exceeds TTL, evict worker to free GPU VRAM
                        if ttl > 0 and idle_time >= ttl:
                            workers_to_destroy.append((worker_id, idle_time))
                        elif ttl <= 0 and idle_time > 1:
                            workers_to_destroy.append((worker_id, idle_time))

                # Destroy expired idle workers
                for worker_id, idle_time in workers_to_destroy:
                    try:
                        worker_config = self.worker_configs.get(worker_id)
                        m_id = worker_config.model_config.get("model_id") if worker_config else "unknown"
                        gpu_label = f"GPU {worker_config.gpu_id}" if worker_config and worker_config.gpu_id is not None else "CPU"
                        logger.info(
                            f"[MODEL TTL EXPIRED] Evicting idle worker {worker_id} (model={m_id}, {gpu_label}) "
                            f"after {idle_time:.1f}s idle (TTL={ttl:.1f}s)"
                        )
                        await self._destroy_worker(worker_id)
                    except Exception as e:
                        logger.error(f"Error cleaning up expired worker {worker_id}: {e}")

                # Wait between cleanup cycles
                sleep_time = min(max(5.0, ttl / 2.0), 30.0) if ttl > 0 else 5.0
                await asyncio.sleep(sleep_time)

            except Exception as e:
                logger.error(f"Error in idle worker cleanup: {e}")
                await asyncio.sleep(10)  # Wait longer on error

    async def _cleanup_dead_workers(self, run_once: bool = False):
        """Periodically check for and clean up dead worker processes"""
        while self.running or run_once:
            try:
                dead_workers = []
                for worker_id, process in list(self.workers.items()):
                    if not process.is_alive():
                        dead_workers.append(worker_id)

                for worker_id in dead_workers:
                    try:
                        job_id = self.worker_current_job.get(worker_id)
                        callback_id = self.worker_current_callback.get(worker_id)
                        if not callback_id and job_id:
                            callback_id = self.job_to_callback.get(job_id)

                        # Clean up pending future for this dead worker's job
                        fut = None
                        with self.result_lock:
                            if callback_id:
                                fut = self.pending_results.pop(callback_id, None)
                            if job_id:
                                self.job_to_callback.pop(job_id, None)

                        if fut is not None and not fut.done():
                            try:
                                fut.set_result({
                                    "success": False,
                                    "error": f"Worker {worker_id} terminated unexpectedly during execution",
                                    "job_id": job_id,
                                })
                            except asyncio.InvalidStateError:
                                pass

                        # Mark worker unavailable and clean up process/VRAM exactly once
                        self._mark_worker_available(worker_id)
                        await self._destroy_worker(worker_id)

                        if job_id:
                            try:
                                await self.job_queue.fail_job(
                                    job_id,
                                    f"Worker {worker_id} terminated unexpectedly",
                                )
                            except Exception as e:
                                logger.error(
                                    f"Failed to mark job {job_id} as failed after worker {worker_id} died: {e}"
                                )
                    except Exception as e:
                        logger.error(f"Error cleaning up dead worker {worker_id}: {e}")

                if run_once:
                    break
                await asyncio.sleep(5.0)

            except Exception as e:
                logger.error(f"Error in dead worker cleanup: {e}")
                if run_once:
                    break
                await asyncio.sleep(10)

    async def _job_queue_cleanup_loop(self):
        """Periodically clean up expired jobs in the job queue"""
        while self.running:
            try:
                expired_job_ids = await self.job_queue.cleanup_expired_jobs()
                for expired_job_id in expired_job_ids:
                    job = await self.job_queue.get_job(expired_job_id)
                    if not job:
                        continue
                    await self._stop_worker_for_job(expired_job_id, "timeout")
                    await self.job_queue.fail_job(
                        expired_job_id,
                        "Job processing timed out after 3600 seconds",
                    )
                    self._cleanup_temporary_inputs(job)
                await asyncio.sleep(60)  # Check every minute
            except Exception as e:
                logger.error(f"Error in job queue cleanup: {e}")
                await asyncio.sleep(60)

    def _remove_worker_tracking(
        self,
        worker_id: str,
        model_id: str,
        resource_plan: Optional[Dict[str, Any]] = None,
    ):
        """Remove worker from all tracking dictionaries"""
        self.workers.pop(worker_id, None)
        self.worker_configs.pop(worker_id, None)
        self.worker_queues.pop(worker_id, None)
        self.worker_response_queues.pop(worker_id, None)
        self.worker_control_queues.pop(worker_id, None)
        self.worker_control_response_queues.pop(worker_id, None)
        self.worker_status.pop(worker_id, None)
        self.worker_last_used.pop(worker_id, None)
        self.worker_current_job.pop(worker_id, None)
        self.worker_current_callback.pop(worker_id, None)
        if model_id in self.worker_assignments:
            if worker_id in self.worker_assignments[model_id]:
                self.worker_assignments[model_id].remove(worker_id)
            if not self.worker_assignments[model_id]:
                del self.worker_assignments[model_id]
        for plan_gpu, plan_vram in (resource_plan or {}).get("reservation_mb", {}).items():
            self.gpu_monitor.deallocate_vram(int(plan_gpu), int(plan_vram))

    async def _destroy_worker(self, worker_id: str):
        """Destroy a worker process"""
        if worker_id not in self.workers:
            return

        try:
            # Remove from worker assignments first
            worker_config = self.worker_configs.get(worker_id)
            if not worker_config:
                self.workers.pop(worker_id, None)
                return

            model_id = worker_config.model_config["model_id"]
            gpu_id = worker_config.gpu_id
            resource_plan = worker_config.resource_plan or {
                "reservation_mb": {
                    gpu_id: worker_config.model_config.get("vram_requirement", 1024)
                }
            }

            if model_id in self.worker_assignments:
                if worker_id in self.worker_assignments[model_id]:
                    self.worker_assignments[model_id].remove(worker_id)

                # If no workers left for this model, remove the entry
                if not self.worker_assignments[model_id]:
                    del self.worker_assignments[model_id]

            # Send shutdown message
            try:
                await self._send_control_message(
                    worker_id, WorkerMessage.Type.SHUTDOWN, timeout=5.0
                )
            except Exception:
                pass  # Ignore timeout/communication errors during shutdown

            # Terminate the process
            process = self.workers.pop(worker_id, None)
            if process:
                await asyncio.to_thread(process.join, 5.0)
                if process.is_alive():
                    logger.warning(f"Force terminating worker {worker_id}")
                    process.terminate()
                    await asyncio.to_thread(process.join, 2.0)
                    if process.is_alive():
                        process.kill()

            # Deallocate exact reservations, including multi-GPU plans.
            for plan_gpu, plan_vram in resource_plan.get("reservation_mb", {}).items():
                self.gpu_monitor.deallocate_vram(int(plan_gpu), int(plan_vram))

            # Cleanup all tracking data
            self.worker_configs.pop(worker_id, None)
            self.worker_queues.pop(worker_id, None)
            self.worker_response_queues.pop(worker_id, None)
            self.worker_control_queues.pop(worker_id, None)
            self.worker_control_response_queues.pop(worker_id, None)
            self.worker_status.pop(worker_id, None)
            self.worker_last_used.pop(worker_id, None)
            self.worker_current_job.pop(worker_id, None)
            self.worker_current_callback.pop(worker_id, None)

            logger.info(
                f"Worker {worker_id} destroyed and cleaned up; released resource plan {resource_plan.get('reservation_mb', {})}"
            )

        except Exception as e:
            logger.error(f"Error destroying worker {worker_id}: {e}")
