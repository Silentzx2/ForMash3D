"""
Mesh generation API endpoints.

Provides endpoints for Image → 3D generation plus text-guided mesh painting. Enhanced to support file uploads, base64 encoding, and proper
result downloading.
"""

import asyncio
import logging
import shutil
import tempfile
from pathlib import Path
from uuid import uuid4
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from api.dependencies import get_current_settings, get_file_store, get_scheduler
from api.routers.file_upload import resolve_file_id_async
from api.utils.asset_name import resolve_asset_name
from core.file_store import FileStore
from core.scheduler.job_queue import JobRequest
from core.config import get_quality_config, validate_quality_tier
from core.preprocess.image_enhancement import load_preprocessed_artifact, preprocess_image
from core.scheduler.multiprocess_scheduler import MultiprocessModelScheduler
from core.smart_presets import CANONICAL_INTENTS, NATIVE_PRESET, resolve_intent
from core.utils.file_utils import save_base64_file, save_upload_file

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/mesh-generation", tags=["mesh_generation"])

_LEGACY_TEXTURED_MODEL_ALIASES = {
    "trellis_image_to_textured_mesh": "trellis_image_to_raw_mesh",
    "trellis2_image_to_textured_mesh": "trellis2_image_to_raw_mesh",
    "trellis2_image_to_3d": "trellis2_image_to_raw_mesh",
}

_TEXTURE_RESOLUTION_PRESETS = {"1K": 1024, "2K": 2048, "4K": 4096, "8K": 8192}
_SUPPORTED_TEXTURE_RESOLUTIONS = {1024, 2048, 4096, 8192}


def _normalize_texture_resolution(value):
    """Accept user presets or numeric atlas sizes at the API boundary, rejecting unsupported values."""
    if value is None:
        return None
    if isinstance(value, str):
        normalized = value.strip().upper()
        if normalized in _TEXTURE_RESOLUTION_PRESETS:
            return _TEXTURE_RESOLUTION_PRESETS[normalized]
        if normalized.isdecimal():
            int_val = int(normalized)
            if int_val in _SUPPORTED_TEXTURE_RESOLUTIONS:
                return int_val
        raise ValueError(
            f"Unsupported texture resolution '{value}'. Supported values: 1K (1024), 2K (2048), 4K (4096), 8K (8192)"
        )
    if isinstance(value, int):
        if value in _SUPPORTED_TEXTURE_RESOLUTIONS:
            return value
        raise ValueError(
            f"Unsupported texture resolution {value}. Supported values: 1024 (1K), 2048 (2K), 4096 (4K), 8192 (8K)"
        )
    raise ValueError(
        f"Unsupported texture resolution type: {type(value).__name__}"
    )


def _resolve_target_polycount_precedence(
    top_level_target: Optional[int],
    nested_target: Optional[int],
    preset_target: Optional[int],
) -> Optional[int]:
    """Resolve a generation budget without allowing a default 0 to mask explicit API or preset input.
    Explicit positive values (> 0) or explicit native sentinel (-1) take highest precedence.
    """
    if top_level_target is not None and (top_level_target > 0 or top_level_target == -1):
        return top_level_target
    if nested_target is not None and (nested_target > 0 or nested_target == -1):
        return nested_target
    return preset_target


def _resolve_preset_option(
    explicit: Any,
    preset: Dict[str, Any],
    preset_key: str,
    default: Any,
) -> Any:
    """Resolve one production option: explicit request value > intent preset > backend default.

    `explicit` is None when the caller omitted the field. That tri-state contract is
    what lets an intent preset supply its own default without an unset UI value
    silently overriding it, while an explicit request value always wins.
    """
    if explicit is not None:
        return explicit
    if preset_key in preset:
        return preset[preset_key]
    return default


def _clean_paint_parameters(parameters: Optional[dict]) -> Dict[str, Any]:
    """Keep direct paint jobs from re-triggering centralized texture generation."""
    obsolete = {
        "texture_enabled", "generate_texture", "generateTexture", "auto_paint",
        "texture_resolution", "texture_resolution_preset",
        "enable_realesrgan", "enableRealESRGAN", "realeg",
    }
    return {
        key: value for key, value in (parameters or {}).items()
        if value is not None and key not in obsolete
    }




def validate_model_preference(
    model_preference: str, feature: str, scheduler: MultiprocessModelScheduler
) -> None:
    """
    Validate that the model preference is available for the given feature.

    Args:
        model_preference: The preferred model ID
        feature: The feature type for the job
        scheduler: The model scheduler instance

    Raises:
        HTTPException: If the model preference is invalid
    """
    if not scheduler.validate_model_preference(model_preference, feature):
        available_models = scheduler.get_available_models(feature)
        feature_models = available_models.get(feature, [])

        if not feature_models:
            raise HTTPException(
                status_code=400,
                detail=f"No models available for feature '{feature}'. Please check if models are registered.",
            )

        raise HTTPException(
            status_code=400,
            detail=f"Model '{model_preference}' is not available for feature '{feature}'. "
            f"Available models: {feature_models}",
        )


def _is_explicit_model_preference(model_preference: Optional[str]) -> bool:
    return bool(
        model_preference
        and str(model_preference).strip().lower() not in {"auto", "default", "none"}
    )


def _get_loaded_models_from_scheduler(scheduler: Any) -> List[str]:
    """Retrieve currently loaded models across scheduler workers."""
    if scheduler is None:
        return []
    if hasattr(scheduler, "get_loaded_models") and callable(scheduler.get_loaded_models):
        try:
            return list(scheduler.get_loaded_models() or [])
        except Exception as ex:
            logger.warning("Failed to get loaded models from scheduler: %s", ex)
    elif hasattr(scheduler, "worker_assignments"):
        try:
            return list(scheduler.worker_assignments.keys())
        except Exception:
            pass
    return []


def _augment_runtime_facts_with_freeable_vram(runtime_facts: Dict[str, Any], scheduler: Any) -> None:
    """
    Augment runtime_facts with freeable VRAM accounting for idle workers that can be evicted.
    Updates free_vram_gb, max_free_vram_gb, and aggregate_free_vram_gb so planners
    treat reclaimable memory as available for candidate evaluation.
    """
    if not runtime_facts or not runtime_facts.get("has_cuda"):
        return
    idle_vram_by_gpu: Dict[int, int] = {}
    if scheduler is not None:
        if hasattr(scheduler, "get_idle_workers_vram_by_gpu") and callable(scheduler.get_idle_workers_vram_by_gpu):
            try:
                idle_vram_by_gpu = scheduler.get_idle_workers_vram_by_gpu() or {}
            except Exception as ex:
                logger.warning("Failed to get idle workers VRAM from scheduler: %s", ex)
        elif hasattr(scheduler, "worker_status") and hasattr(scheduler, "worker_configs"):
            for wid, is_busy in getattr(scheduler, "worker_status", {}).items():
                if not is_busy and getattr(scheduler, "worker_current_job", {}).get(wid) is None:
                    cfg = getattr(scheduler, "worker_configs", {}).get(wid)
                    if cfg:
                        gid = getattr(cfg, "gpu_id", 0)
                        if gid is not None:
                            req = int((getattr(cfg, "model_config", {}) or {}).get("vram_requirement", 1024))
                            idle_vram_by_gpu[int(gid)] = idle_vram_by_gpu.get(int(gid), 0) + req

    if not idle_vram_by_gpu:
        return

    gpu_devices = runtime_facts.get("gpu_devices") or []
    max_freeable_gb = 0.0
    agg_freeable_gb = 0.0
    for dev in gpu_devices:
        dev_id = int(dev.get("id", 0))
        cur_free = float(dev.get("free_vram_gb") or 0.0)
        tot_vram = float(dev.get("total_vram_gb") or 0.0)
        idle_gb = round(idle_vram_by_gpu.get(dev_id, 0) / 1024.0, 2)
        freeable = cur_free + idle_gb
        if tot_vram > 0:
            freeable = min(tot_vram, freeable)
        freeable = round(freeable, 2)
        dev["freeable_vram_gb"] = freeable
        dev["idle_worker_vram_gb"] = idle_gb
        dev["raw_free_vram_gb"] = cur_free
        max_freeable_gb = max(max_freeable_gb, freeable)
        agg_freeable_gb += freeable

    if not gpu_devices and runtime_facts.get("free_vram_gb") is not None:
        cur_free = float(runtime_facts.get("free_vram_gb") or 0.0)
        tot_vram = float(runtime_facts.get("total_vram_gb") or cur_free)
        idle_gb = round(sum(idle_vram_by_gpu.values()) / 1024.0, 2)
        freeable = round(min(tot_vram, cur_free + idle_gb) if tot_vram > 0 else (cur_free + idle_gb), 2)
        max_freeable_gb = freeable
        agg_freeable_gb = freeable

    runtime_facts["raw_free_vram_gb"] = runtime_facts.get("free_vram_gb")
    runtime_facts["raw_max_free_vram_gb"] = runtime_facts.get("max_free_vram_gb")
    runtime_facts["raw_aggregate_free_vram_gb"] = runtime_facts.get("aggregate_free_vram_gb")

    runtime_facts["freeable_vram_gb"] = max_freeable_gb
    runtime_facts["max_freeable_vram_gb"] = max_freeable_gb
    runtime_facts["aggregate_freeable_vram_gb"] = agg_freeable_gb

    # Update the planner free VRAM fields to reflect freeable VRAM
    runtime_facts["free_vram_gb"] = max_freeable_gb
    runtime_facts["max_free_vram_gb"] = max_freeable_gb
    runtime_facts["aggregate_free_vram_gb"] = agg_freeable_gb


# Enhanced Request models with file upload support
class TextMeshPaintingRequest(BaseModel):
    """Request for text-based mesh painting"""

    text_prompt: str = Field(..., description="Text description for painting")
    mesh_path: Optional[str] = Field(
        None, description="Path to the input mesh file (for local files)"
    )
    mesh_base64: Optional[str] = Field(None, description="Base64 encoded mesh data")
    mesh_file_id: Optional[str] = Field(
        None, description="File ID from upload endpoint"
    )
    texture_resolution: int = Field(
        1024, description="Texture resolution"
    )
    output_format: str = Field("glb", description="Output mesh format")
    quality_mode: Optional[str] = Field("high", description="Target quality budget")
    target_polycount: Optional[int] = Field(None, description="Target triangle budget")
    model_preference: str = Field(
        "trellis_text_mesh_painting", description="Model name for mesh generation"
    )
    model_parameters: Optional[dict] = Field(
        None,
        description="Model-specific parameters (query /system/models/{model_id}/parameters for schema)"
    )
    physics_enabled: bool = Field(False, description="Request physics-ready post-processing for this generated asset")
    physics_config: Optional[dict] = Field(None, description="Provider-neutral physics controller values")
    topology_mode: Optional[str] = Field("triangle", description="Topology mode: 'triangle' or 'quad'")
    quad_topology: bool = Field(False, description="Request quad-dominant topology")
    mask_path: Optional[str] = Field(None, description="Path to optional spot retexture UV mask image")
    mask_base64: Optional[str] = Field(None, description="Base64 encoded spot retexture UV mask image")
    mask_file_id: Optional[str] = Field(None, description="File ID for spot retexture UV mask image")
    postprocess_mode: Optional[str] = Field("manual_mesh_tool", description="Postprocessing mode: 'manual_mesh_tool' bypasses raw decimation/remeshing pipeline")
    enable_postprocess: bool = Field(False, description="Run production postprocessing pipeline after mesh generation. If False, postprocessing is bypassed.")
    mesh_style: str = Field("auto", deprecated=True, description="Deprecated mesh style hint. Does not override locked adapter inference profiles.")
    requested_quality: Optional[str] = Field(None, deprecated=True, description="Deprecated requested quality tier. Does not override locked adapter inference profiles.")
    object_type: str = Field("general", deprecated=True, description="Deprecated object type. Does not override locked adapter inference profiles.")
    symmetry: str = Field("none", deprecated=True, description="Deprecated symmetry setting. Does not override locked adapter inference profiles.")

    @field_validator("mesh_style")
    @classmethod
    def validate_mesh_style(cls, v):
        if not v:
            return "auto"
        v_str = str(v).strip().lower()
        if v_str not in ("clean", "detailed", "auto"):
            raise ValueError(f"Invalid mesh_style '{v}'. Must be one of: 'clean', 'detailed', 'auto'")
        return v_str

    @field_validator("requested_quality")
    @classmethod
    def validate_requested_quality(cls, v):
        return validate_quality_tier(v)

    @field_validator("object_type")
    @classmethod
    def validate_object_type(cls, v):
        if not v:
            return "general"
        v_str = str(v).strip().lower()
        if v_str not in ("mechanical", "organic", "character", "general"):
            raise ValueError(f"Invalid object_type '{v}'. Must be one of: 'mechanical', 'organic', 'character', 'general'")
        return v_str

    @field_validator("symmetry")
    @classmethod
    def validate_symmetry(cls, v):
        if not v:
            return "none"
        v_str = str(v).strip().lower()
        if v_str not in ("bilateral", "radial", "none"):
            raise ValueError(f"Invalid symmetry '{v}'. Must be one of: 'bilateral', 'radial', 'none'")
        return v_str

    @field_validator("texture_resolution", mode="before")
    @classmethod
    def normalize_texture_resolution(cls, value):
        return _normalize_texture_resolution(value)

    @field_validator("output_format")
    @classmethod
    def validate_output_format(cls, v):
        allowed_formats = ["glb"]
        if v not in allowed_formats:
            raise ValueError(f"Output format must be one of: {allowed_formats}")
        return v

    @model_validator(mode="after")
    def validate_inputs(self):
        inputs_provided = sum(
            bool(x) for x in [self.mesh_path, self.mesh_base64, self.mesh_file_id]
        )

        if inputs_provided == 0:
            raise ValueError(
                "One of mesh_path, mesh_base64, or mesh_file_id must be provided"
            )
        if inputs_provided > 1:
            raise ValueError(
                "Only one of mesh_path, mesh_base64, or mesh_file_id should be provided"
            )
        return self

    model_config = ConfigDict(protected_namespaces=("settings_",))


class ImageToRawMeshRequest(BaseModel):
    """Request for image-to-mesh generation"""

    image_path: Optional[str] = Field(
        None, description="Path to the input image (for local files)"
    )
    image_base64: Optional[str] = Field(None, description="Base64 encoded image data")
    image_file_id: Optional[str] = Field(
        None, description="File ID from upload endpoint"
    )
    texture_resolution: Optional[int] = Field(
        None, description="Optional texture-atlas preset or size; omitted values fall back to the intent preset"
    )
    bake_normal_maps: bool = Field(True, description="Bake high-to-low detail maps when supported")
    texture_enabled: Optional[bool] = None
    generate_texture: Optional[bool] = None
    low_vram: Optional[bool] = Field(None, description="Enable low-VRAM execution mode (<= 15GB VRAM via sequential offload). Set False to run full 24GB in-memory pipeline.")
    output_format: str = Field("glb", description="Output mesh format")
    quality_mode: Optional[str] = Field("high", description="Target quality budget")
    target_polycount: Optional[int] = Field(None, description="Target triangle budget")
    model_preference: Optional[str] = Field(
        None, description="Explicit model override; intent presets choose a model when omitted"
    )
    auto_mode: Optional[bool] = Field(
        None,
        description="Enable smart model selection when model_preference is omitted; an explicit model_preference always takes precedence.",
    )
    input_prep: Optional[Dict[str, Any]] = Field(
        None,
        description="Optional input image preparation overrides (e.g. remove_background, tight_crop, margin, resize, upscale_small).",
    )
    intent: Optional[str] = Field(None, description="Deterministic smart-generation intent: 'mobile', 'game_ready', 'cinematic', 'animation', '3d_print', 'native', 'game_ready_quad', 'multi_variant'")
    preprocessing_artifact_id: Optional[str] = Field(None, description="Approved preprocessing artifact ID")
    preprocessing_review_override: bool = Field(False, description="Explicitly allow a flagged preprocessing preview after review")
    enhancement_enabled: bool = Field(False, description="Use the approved preprocessing artifact")
    enable_printability_check: Optional[bool] = Field(None, description="Run final printability QA; omitted values fall back to the intent preset")
    enable_auto_repair: Optional[bool] = Field(None, description="Allow the shared repair stage to mutate the mesh for printability; omitted values fall back to the intent preset")
    enable_auto_rig: Optional[bool] = Field(None, description="Run UniRig after production processing; omitted values fall back to the intent preset")
    auto_rig_mode: str = Field("full", description="UniRig mode: full, skeleton, or skin")
    generate_lod: Optional[bool] = Field(None, description="Build the LOD hierarchy; omitted values fall back to the intent preset")
    lod_preset: Optional[str] = Field(None, description="LOD ratio preset: 'mobile', 'low', 'medium', 'high' or 'cinematic'")
    lod_count: Optional[int] = Field(None, ge=0, le=4, description="Number of LOD levels to generate (0-4); 0 disables the LOD chain")
    model_parameters: Optional[dict] = Field(
        None,
        description="Model-specific parameters (query /system/models/{model_id}/parameters for schema)"
    )
    physics_enabled: Optional[bool] = Field(None, description="Request physics-ready post-processing; omitted values fall back to the intent preset")
    physics_config: Optional[dict] = Field(None, description="Provider-neutral physics controller values")
    topology_mode: Optional[str] = Field("triangle", description="Topology mode: 'triangle' or 'quad'")
    quad_topology: bool = Field(False, description="Request quad-dominant topology")
    enable_postprocess: bool = Field(True, description="Run production postprocessing pipeline after mesh generation. If False, postprocessing is bypassed.")
    candidate_count: int = Field(1, ge=1, le=int(get_quality_config()["seeds"]["max_candidates"]), description="Candidate variations to generate (1-4, default 1)")
    part_count_range: Optional[str] = Field(None, description="Target part count range for segmentation: '1', '3-6', '6-15', '15+'")
    rig_type: Optional[str] = Field(None, description="Rig type: 'none', 'generic', 'humanoid', 'quadruped', 'bird', 'insect', 'custom'")
    export_formats: Optional[List[str]] = Field(None, description="Export formats: 'glb', 'fbx', 'obj', 'stl', '3mf'")
    slicer_handoff: Optional[bool] = Field(None, description="Hand the print-ready mesh to a slicer (STL/3MF handoff); omitted values fall back to the intent preset")
    asset_name: Optional[str] = Field(None, description="Asset base stem name")
    image_name: Optional[str] = Field(None, description="Original image filename")
    mesh_style: str = Field("auto", deprecated=True, description="Deprecated mesh style hint. Does not override locked adapter inference profiles.")
    requested_quality: Optional[str] = Field(None, deprecated=True, description="Deprecated requested quality tier. Does not override locked adapter inference profiles.")
    object_type: str = Field("general", deprecated=True, description="Deprecated object type. Does not override locked adapter inference profiles.")
    symmetry: str = Field("none", deprecated=True, description="Deprecated symmetry setting. Does not override locked adapter inference profiles.")

    @field_validator("auto_rig_mode")
    @classmethod
    def validate_auto_rig_mode(cls, value):
        normalized = str(value or "full").strip().lower()
        if normalized not in {"full", "skeleton", "skin"}:
            raise ValueError("Invalid auto_rig_mode. Must be one of: 'full', 'skeleton', 'skin'")
        return normalized

    @field_validator("topology_mode")
    @classmethod
    def validate_topology_mode(cls, value):
        if value is None:
            return value
        normalized = str(value).strip().lower()
        if normalized not in {"triangle", "quad"}:
            raise ValueError("Invalid topology_mode. Must be one of: 'triangle', 'quad'")
        return normalized

    @field_validator("rig_type")
    @classmethod
    def validate_rig_type(cls, value):
        if value is None:
            return None
        normalized = str(value).strip().lower()
        if normalized not in {"none", "generic", "humanoid", "quadruped", "bird", "insect", "custom"}:
            raise ValueError("Invalid rig_type. Must be one of: 'none', 'generic', 'humanoid', 'quadruped', 'bird', 'insect', 'custom'")
        return normalized

    @field_validator("export_formats")
    @classmethod
    def validate_export_formats(cls, value):
        if value is None:
            return None
        allowed = {"glb", "fbx", "obj", "stl", "3mf"}
        for fmt in value:
            if fmt not in allowed:
                raise ValueError(f"Invalid export format '{fmt}'. Allowed: {sorted(allowed)}")
        return value

    @field_validator("lod_preset")
    @classmethod
    def validate_lod_preset(cls, value):
        if value is None:
            return value
        normalized = str(value).strip().lower()
        if normalized not in {"mobile", "low", "medium", "high", "cinematic"}:
            raise ValueError(
                "Invalid lod_preset. Must be one of: 'mobile', 'low', 'medium', 'high', 'cinematic'"
            )
        return normalized

    @field_validator("intent")
    @classmethod
    def validate_intent(cls, v):
        if v is None:
            return None
        v_str = str(v).strip().lower()
        if not v_str:
            return None
        if v_str not in CANONICAL_INTENTS:
            raise ValueError(
                f"Invalid intent '{v}'. Canonical presets are: {', '.join(sorted(CANONICAL_INTENTS))}"
            )
        return v_str

    @field_validator("mesh_style")
    @classmethod
    def validate_mesh_style(cls, v):
        if not v:
            return "auto"
        v_str = str(v).strip().lower()
        if v_str not in ("clean", "detailed", "auto"):
            raise ValueError(f"Invalid mesh_style '{v}'. Must be one of: 'clean', 'detailed', 'auto'")
        return v_str

    @field_validator("requested_quality")
    @classmethod
    def validate_requested_quality(cls, v):
        return validate_quality_tier(v)

    @field_validator("object_type")
    @classmethod
    def validate_object_type(cls, v):
        if not v:
            return "general"
        v_str = str(v).strip().lower()
        if v_str not in ("mechanical", "organic", "character", "general"):
            raise ValueError(f"Invalid object_type '{v}'. Must be one of: 'mechanical', 'organic', 'character', 'general'")
        return v_str

    @field_validator("symmetry")
    @classmethod
    def validate_symmetry(cls, v):
        if not v:
            return "none"
        v_str = str(v).strip().lower()
        if v_str not in ("bilateral", "radial", "none"):
            raise ValueError(f"Invalid symmetry '{v}'. Must be one of: 'bilateral', 'radial', 'none'")
        return v_str

    @field_validator("texture_resolution", mode="before")
    @classmethod
    def normalize_texture_resolution(cls, value):
        return _normalize_texture_resolution(value)

    @field_validator("output_format")
    @classmethod
    def validate_output_format(cls, v):
        allowed_formats = ["glb"]
        if v not in allowed_formats:
            raise ValueError(f"Output format must be one of: {allowed_formats}")
        return v

    @model_validator(mode="after")
    def validate_inputs(self):
        image_path = self.image_path
        image_base64 = self.image_base64
        image_file_id = self.image_file_id

        inputs_provided = sum(bool(x) for x in [image_path, image_base64, image_file_id])

        if inputs_provided == 0:
            raise ValueError(
                "One of image_path, image_base64, or image_file_id must be provided"
            )
        if inputs_provided > 1:
            raise ValueError(
                "Only one of image_path, image_base64, or image_file_id should be provided"
            )
        return self

    model_config = ConfigDict(protected_namespaces=("settings_",))


class ImageToTexturedMeshRequest(BaseModel):
    """Request for image-to-textured-mesh generation"""

    image_path: Optional[str] = Field(None, description="Path to the input image")
    image_base64: Optional[str] = Field(None, description="Base64 encoded image data")
    image_file_id: Optional[str] = Field(
        None, description="File ID from upload endpoint"
    )
    texture_image_path: Optional[str] = Field(
        None, description="Path to the texture image"
    )
    texture_image_base64: Optional[str] = Field(
        None, description="Base64 encoded texture image"
    )
    texture_image_file_id: Optional[str] = Field(
        None, description="Texture image file ID from upload endpoint"
    )
    texture_resolution: Optional[int] = Field(
        None, description="Texture atlas preset or size"
    )
    bake_normal_maps: bool = Field(True, description="Bake high-to-low detail maps when supported")
    texture_enabled: Optional[bool] = None
    generate_texture: Optional[bool] = None
    low_vram: Optional[bool] = Field(None, description="Enable low-VRAM execution mode (<= 15GB VRAM via sequential offload). Set False to run full 24GB in-memory pipeline.")
    output_format: str = Field("glb", description="Output mesh format")
    quality_mode: Optional[str] = Field("high", description="Target quality budget")
    target_polycount: Optional[int] = Field(None, description="Target triangle budget")
    model_preference: Optional[str] = Field(
        None, description="Explicit model override; intent presets choose a model when omitted"
    )
    auto_mode: Optional[bool] = Field(
        None,
        description="Enable smart model selection when model_preference is omitted; an explicit model_preference always takes precedence.",
    )
    input_prep: Optional[Dict[str, Any]] = Field(
        None,
        description="Optional input image preparation overrides (e.g. remove_background, tight_crop, margin, resize, upscale_small).",
    )
    intent: Optional[str] = Field(None, description="Deterministic smart-generation intent: 'mobile', 'game_ready', 'cinematic', 'animation', '3d_print', 'native'")
    preprocessing_artifact_id: Optional[str] = Field(None, description="Approved preprocessing artifact ID")
    preprocessing_review_override: bool = Field(False, description="Explicitly allow a flagged preprocessing preview after review")
    enhancement_enabled: bool = Field(False, description="Use the approved preprocessing artifact")
    enable_printability_check: Optional[bool] = Field(None, description="Run final printability QA; omitted values fall back to the intent preset")
    enable_auto_repair: Optional[bool] = Field(None, description="Allow the shared repair stage to mutate the mesh for printability; omitted values fall back to the intent preset")
    enable_auto_rig: Optional[bool] = Field(None, description="Run UniRig after production processing; omitted values fall back to the intent preset")
    auto_rig_mode: str = Field("full", description="UniRig mode: full, skeleton, or skin")
    generate_lod: Optional[bool] = Field(None, description="Build the LOD hierarchy; omitted values fall back to the intent preset")
    lod_preset: Optional[str] = Field(None, description="LOD ratio preset: 'mobile', 'low', 'medium', 'high' or 'cinematic'")
    lod_count: Optional[int] = Field(None, ge=0, le=4, description="Number of LOD levels to generate (0-4); 0 disables the LOD chain")
    model_parameters: Optional[dict] = Field(
        None,
        description="Model-specific parameters (query /system/models/{model_id}/parameters for schema)"
    )
    physics_enabled: Optional[bool] = Field(None, description="Request physics-ready post-processing; omitted values fall back to the intent preset")
    physics_config: Optional[dict] = Field(None, description="Provider-neutral physics controller values")
    topology_mode: Optional[str] = Field("triangle", description="Topology mode: 'triangle' or 'quad'")
    quad_topology: bool = Field(False, description="Request quad-dominant topology")
    enable_postprocess: bool = Field(True, description="Run production postprocessing pipeline after mesh generation. If False, postprocessing is bypassed.")
    candidate_count: int = Field(1, ge=1, le=int(get_quality_config()["seeds"]["max_candidates"]), description="Candidate variations to generate (1-4, default 1)")
    part_count_range: Optional[str] = Field(None, description="Target part count range for segmentation: '1', '3-6', '6-15', '15+'")
    rig_type: Optional[str] = Field(None, description="Rig type: 'none', 'generic', 'humanoid', 'quadruped', 'bird', 'insect', 'custom'")
    export_formats: Optional[List[str]] = Field(None, description="Export formats: 'glb', 'fbx', 'obj', 'stl', '3mf'")
    slicer_handoff: Optional[bool] = Field(None, description="Hand the print-ready mesh to a slicer (STL/3MF handoff); omitted values fall back to the intent preset")
    asset_name: Optional[str] = Field(None, description="Asset base stem name")
    image_name: Optional[str] = Field(None, description="Original image filename")
    mesh_style: str = Field("auto", deprecated=True, description="Deprecated mesh style hint. Does not override locked adapter inference profiles.")
    requested_quality: Optional[str] = Field(None, deprecated=True, description="Deprecated requested quality tier. Does not override locked adapter inference profiles.")
    object_type: str = Field("general", deprecated=True, description="Deprecated object type. Does not override locked adapter inference profiles.")
    symmetry: str = Field("none", deprecated=True, description="Deprecated symmetry setting. Does not override locked adapter inference profiles.")

    @field_validator("auto_rig_mode")
    @classmethod
    def validate_auto_rig_mode(cls, value):
        normalized = str(value or "full").strip().lower()
        if normalized not in {"full", "skeleton", "skin"}:
            raise ValueError("Invalid auto_rig_mode. Must be one of: 'full', 'skeleton', 'skin'")
        return normalized

    @field_validator("topology_mode")
    @classmethod
    def validate_topology_mode(cls, value):
        if value is None:
            return value
        normalized = str(value).strip().lower()
        if normalized not in {"triangle", "quad"}:
            raise ValueError("Invalid topology_mode. Must be one of: 'triangle', 'quad'")
        return normalized

    @field_validator("lod_preset")
    @classmethod
    def validate_lod_preset(cls, value):
        if value is None:
            return value
        normalized = str(value).strip().lower()
        if normalized not in {"mobile", "low", "medium", "high", "cinematic"}:
            raise ValueError(
                "Invalid lod_preset. Must be one of: 'mobile', 'low', 'medium', 'high', 'cinematic'"
            )
        return normalized

    @field_validator("intent")
    @classmethod
    def validate_intent(cls, v):
        if v is None:
            return None
        v_str = str(v).strip().lower()
        if not v_str:
            return None
        if v_str not in CANONICAL_INTENTS:
            raise ValueError(
                f"Invalid intent '{v}'. Canonical presets are: {', '.join(sorted(CANONICAL_INTENTS))}"
            )
        return v_str

    @field_validator("mesh_style")
    @classmethod
    def validate_mesh_style(cls, v):
        if not v:
            return "auto"
        v_str = str(v).strip().lower()
        if v_str not in ("clean", "detailed", "auto"):
            raise ValueError(f"Invalid mesh_style '{v}'. Must be one of: 'clean', 'detailed', 'auto'")
        return v_str

    @field_validator("requested_quality")
    @classmethod
    def validate_requested_quality(cls, v):
        return validate_quality_tier(v)

    @field_validator("object_type")
    @classmethod
    def validate_object_type(cls, v):
        if not v:
            return "general"
        v_str = str(v).strip().lower()
        if v_str not in ("mechanical", "organic", "character", "general"):
            raise ValueError(f"Invalid object_type '{v}'. Must be one of: 'mechanical', 'organic', 'character', 'general'")
        return v_str

    @field_validator("symmetry")
    @classmethod
    def validate_symmetry(cls, v):
        if not v:
            return "none"
        v_str = str(v).strip().lower()
        if v_str not in ("bilateral", "radial", "none"):
            raise ValueError(f"Invalid symmetry '{v}'. Must be one of: 'bilateral', 'radial', 'none'")
        return v_str

    @field_validator("texture_resolution", mode="before")
    @classmethod
    def normalize_texture_resolution(cls, value):
        return _normalize_texture_resolution(value)

    @field_validator("output_format")
    @classmethod
    def validate_output_format(cls, v):
        allowed_formats = ["glb"]
        if v not in allowed_formats:
            raise ValueError(f"Output format must be one of: {allowed_formats}")
        return v

    @model_validator(mode="after")
    def validate_inputs(self):
        inputs_provided = sum(
            bool(x) for x in [self.image_path, self.image_base64, self.image_file_id]
        )

        if inputs_provided == 0:
            raise ValueError(
                "One of image_path, image_base64, or image_file_id must be provided"
            )
        if inputs_provided > 1:
            raise ValueError(
                "Only one of image_path, image_base64, or image_file_id should be provided"
            )
        return self

    model_config = ConfigDict(protected_namespaces=("settings_",))


class ImageMeshPaintingRequest(BaseModel):
    """Request for image-based mesh painting"""

    image_path: Optional[str] = Field(None, description="Path to the input image")
    image_base64: Optional[str] = Field(None, description="Base64 encoded image data")
    image_file_id: Optional[str] = Field(
        None, description="File ID from upload endpoint"
    )
    mesh_path: Optional[str] = Field(None, description="Path to the input mesh file")
    mesh_base64: Optional[str] = Field(None, description="Base64 encoded mesh data")
    mesh_file_id: Optional[str] = Field(
        None, description="File ID from upload endpoint"
    )
    texture_resolution: int = Field(
        1024, description="Texture resolution"
    )
    output_format: str = Field("glb", description="Output mesh format")
    quality_mode: Optional[str] = Field("high", description="Target quality budget")
    target_polycount: Optional[int] = Field(None, description="Target triangle budget")
    model_preference: str = Field(
        "trellis_image_mesh_painting", description="Model name for mesh generation"
    )
    text_prompt: Optional[str] = Field(
        None, description="Optional Paint3D text prompt; Hunyuan3D-Paint is reference-image guided"
    )
    model_parameters: Optional[dict] = Field(
        None,
        description="Model-specific parameters (query /system/models/{model_id}/parameters for schema)"
    )
    physics_enabled: bool = Field(False, description="Request physics-ready post-processing for this generated asset")
    physics_config: Optional[dict] = Field(None, description="Provider-neutral physics controller values")
    topology_mode: Optional[str] = Field("triangle", description="Topology mode: 'triangle' or 'quad'")
    quad_topology: bool = Field(False, description="Request quad-dominant topology")
    mask_path: Optional[str] = Field(None, description="Path to optional spot retexture UV mask image")
    mask_base64: Optional[str] = Field(None, description="Base64 encoded spot retexture UV mask image")
    mask_file_id: Optional[str] = Field(None, description="File ID for spot retexture UV mask image")
    postprocess_mode: Optional[str] = Field("manual_mesh_tool", description="Postprocessing mode: 'manual_mesh_tool' bypasses raw decimation/remeshing pipeline")
    enable_postprocess: bool = Field(False, description="Run production postprocessing pipeline after mesh generation. If False, postprocessing is bypassed.")
    mesh_style: str = Field("auto", deprecated=True, description="Deprecated mesh style hint. Does not override locked adapter inference profiles.")
    requested_quality: Optional[str] = Field(None, deprecated=True, description="Deprecated requested quality tier. Does not override locked adapter inference profiles.")
    object_type: str = Field("general", deprecated=True, description="Deprecated object type. Does not override locked adapter inference profiles.")
    symmetry: str = Field("none", deprecated=True, description="Deprecated symmetry setting. Does not override locked adapter inference profiles.")

    @field_validator("mesh_style")
    @classmethod
    def validate_mesh_style(cls, v):
        if not v:
            return "auto"
        v_str = str(v).strip().lower()
        if v_str not in ("clean", "detailed", "auto"):
            raise ValueError(f"Invalid mesh_style '{v}'. Must be one of: 'clean', 'detailed', 'auto'")
        return v_str

    @field_validator("requested_quality")
    @classmethod
    def validate_requested_quality(cls, v):
        return validate_quality_tier(v)

    @field_validator("object_type")
    @classmethod
    def validate_object_type(cls, v):
        if not v:
            return "general"
        v_str = str(v).strip().lower()
        if v_str not in ("mechanical", "organic", "character", "general"):
            raise ValueError(f"Invalid object_type '{v}'. Must be one of: 'mechanical', 'organic', 'character', 'general'")
        return v_str

    @field_validator("symmetry")
    @classmethod
    def validate_symmetry(cls, v):
        if not v:
            return "none"
        v_str = str(v).strip().lower()
        if v_str not in ("bilateral", "radial", "none"):
            raise ValueError(f"Invalid symmetry '{v}'. Must be one of: 'bilateral', 'radial', 'none'")
        return v_str

    @field_validator("texture_resolution", mode="before")
    @classmethod
    def normalize_texture_resolution(cls, value):
        return _normalize_texture_resolution(value)

    @field_validator("output_format")
    @classmethod
    def validate_output_format(cls, v):
        allowed_formats = ["glb"]
        if v not in allowed_formats:
            raise ValueError(f"Output format must be one of: {allowed_formats}")
        return v

    @model_validator(mode="after")
    def validate_inputs(self):

        image_inputs_provided = sum(
            bool(x) for x in [self.image_path, self.image_base64, self.image_file_id]
        )
        mesh_inputs_provided = sum(
            bool(x) for x in [self.mesh_path, self.mesh_base64, self.mesh_file_id]
        )

        if image_inputs_provided == 0:
            raise ValueError(
                "One of image_path, image_base64, or image_file_id must be provided"
            )
        if image_inputs_provided > 1:
            raise ValueError(
                "Only one of image_path, image_base64, or image_file_id should be provided"
            )
        if mesh_inputs_provided == 0:
            raise ValueError(
                "One of mesh_path, mesh_base64, or mesh_file_id must be provided"
            )
        if mesh_inputs_provided > 1:
            raise ValueError(
                "Only one of mesh_path, mesh_base64, or mesh_file_id should be provided"
            )
        return self

    model_config = ConfigDict(protected_namespaces=("settings_",))



# Enhanced Response models
class MeshGenerationResponse(BaseModel):
    """Versioned response contract for mesh generation requests."""

    api_version: str = Field("1", description="Generation API contract version")
    job_id: str = Field(..., description="Unique job identifier")
    status: str = Field(..., description="Job status")
    message: str = Field(..., description="Status message")


class RefineMeshRequest(BaseModel):
    """Request to refine an existing coarse mesh with Hi3D."""

    job_id: str = Field(..., description="Unique job identifier of the source mesh job")
    mesh_path: str = Field(..., description="Path to the coarse mesh to refine")
    image_path: Optional[str] = Field(None, description="Optional reference image path")
    resolution: int = Field(1024, description="Target resolution: 512, 1024, or 1536")

    @field_validator("resolution")
    @classmethod
    def validate_resolution(cls, v: int) -> int:
        if v not in (512, 1024, 1536):
            raise ValueError("resolution must be one of 512, 1024, 1536")
        return v


class BatchImageToMeshRequest(BaseModel):
    """Request for batch image-to-mesh generation"""
    items: List[ImageToRawMeshRequest] = Field(..., description="List of image generation requests")


class BatchMeshGenerationResponse(BaseModel):
    """Versioned response contract for batch mesh generation requests."""
    api_version: str = Field("1", description="Generation API contract version")
    job_ids: List[str] = Field(..., description="Unique job identifiers")
    status: str = Field("queued", description="Job status")
    message: str = Field(..., description="Status message")


# Helper function to process file inputs
async def process_file_input(
    file_path: Optional[str] = None,
    base64_data: Optional[str] = None,
    file_id: Optional[str] = None,
    upload_file: Optional[UploadFile] = None,
    input_type: str = "image",
    file_store: Optional[FileStore] = None,
    tracked_temp_dirs: Optional[List[str]] = None,
) -> str:
    """Process various file input formats and return the processed file path"""

    # A data URL (e.g. "data:image/webp;base64,...") is an inline base64 payload,
    # not a server path, so normalize it before checking provided inputs.
    if file_path and isinstance(file_path, str) and file_path.strip().startswith("data:"):
        if not base64_data:
            base64_data = file_path.strip()
            file_path = None

    inputs = [file_path, base64_data, file_id, upload_file]
    provided_inputs = [x for x in inputs if x is not None]

    if not provided_inputs:
        raise HTTPException(status_code=400, detail=f"No {input_type} input provided")

    if len(provided_inputs) > 1:
        raise HTTPException(
            status_code=400,
            detail=f"Multiple {input_type} inputs provided. Only one allowed.",
        )

    temp_dir: Optional[str] = None

    try:
        if file_path:
            from api.routers.file_upload import resolve_input_reference_async

            # file_path may be a download URL or bare /{file_id} path from an upstream job
            file_path = (
                await resolve_input_reference_async(file_path, file_store) or file_path
            )
            from core.utils.file_utils import resolve_server_file_path
            file_path = resolve_server_file_path(file_path)
            # Validate existing file path
            if not Path(file_path).exists():
                raise HTTPException(
                    status_code=404, detail=f"{input_type.title()} file not found"
                )
            return str(file_path)

        elif base64_data:
            temp_dir = tempfile.mkdtemp(prefix="mesh_gen_")
            if tracked_temp_dirs is not None:
                tracked_temp_dirs.append(temp_dir)
            # Process base64 data (also accepts a full "data:...;base64," data URL)
            file_info = await save_base64_file(
                base64_data, f"input_{input_type}", temp_dir
            )
            return str(file_info["file_path"])

        elif file_id:
            # Process file ID (uses Redis in multi-worker mode)
            resolved_path = await resolve_file_id_async(file_id, file_store)
            if not resolved_path:
                raise HTTPException(
                    status_code=404,
                    detail=f"{input_type.title()} file not found or expired",
                )
            return resolved_path

        elif upload_file:
            temp_dir = tempfile.mkdtemp(prefix="mesh_gen_")
            if tracked_temp_dirs is not None:
                tracked_temp_dirs.append(temp_dir)
            # Process uploaded file
            file_info = await save_upload_file(upload_file, temp_dir)
            return str(file_info["file_path"])
        else:
            raise HTTPException(status_code=400, detail="No input provided")
    except HTTPException as he:
        if temp_dir:
            if tracked_temp_dirs is not None and temp_dir in tracked_temp_dirs:
                tracked_temp_dirs.remove(temp_dir)
            await asyncio.to_thread(shutil.rmtree, temp_dir, True)
        import traceback
        trace = traceback.format_exc()
        logger.error(f"Error processing {input_type} input: {str(he)} {trace}")
        raise he
    except Exception as e:
        if temp_dir:
            if tracked_temp_dirs is not None and temp_dir in tracked_temp_dirs:
                tracked_temp_dirs.remove(temp_dir)
            await asyncio.to_thread(shutil.rmtree, temp_dir, True)
        import traceback
        trace = traceback.format_exc()
        logger.error(f"Error processing {input_type} input: {str(e)} {trace}")
        raise HTTPException(
            status_code=400, detail=f"Error processing {input_type}: {str(e)}"
        )


# Text-to-3D generation is intentionally image-only. Text prompts remain supported for mesh painting and motion.

# Removed text-to-textured-mesh endpoints - project is Image-to-3D only
# Text-to-Motion is kept in ardy_adapter.py

# Text-based mesh painting endpoint (supports both file path and base64)
@router.post("/text-mesh-painting", response_model=MeshGenerationResponse)
async def text_mesh_painting(
    mesh_request: TextMeshPaintingRequest,
    scheduler: MultiprocessModelScheduler = Depends(get_scheduler),
    file_store: Optional[FileStore] = Depends(get_file_store),
):
    """
    Texture a 3D mesh from text description.

    Args:
        mesh_request: Text-based mesh painting parameters
        scheduler: Model scheduler dependency
        current_user: Current authenticated user (required if auth enabled)

    Returns:
        Job information for the mesh painting task
    """
    tracked_temp_dirs: List[str] = []
    try:
        user_id = None
        
        # Validate model preference
        validate_model_preference(
            mesh_request.model_preference, "text_mesh_painting", scheduler
        )

        # Process mesh input
        mesh_file_path = await process_file_input(
            file_path=mesh_request.mesh_path,
            base64_data=mesh_request.mesh_base64,
            file_id=mesh_request.mesh_file_id,
            input_type="mesh",
            file_store=file_store,
            tracked_temp_dirs=tracked_temp_dirs,
        )

        # Process mask input if provided
        mask_file_path = None
        if mesh_request.mask_path or mesh_request.mask_base64 or mesh_request.mask_file_id:
            mask_file_path = await process_file_input(
                file_path=mesh_request.mask_path,
                base64_data=mesh_request.mask_base64,
                file_id=mesh_request.mask_file_id,
                input_type="image",
                file_store=file_store,
                tracked_temp_dirs=tracked_temp_dirs,
            )

        job_request = JobRequest(
            feature="text_mesh_painting",
            inputs={
                "text_prompt": mesh_request.text_prompt,
                "mesh_path": mesh_file_path,
                "mask_path": mask_file_path,
                "output_format": mesh_request.output_format,
                "texture_resolution": mesh_request.texture_resolution,
                "enable_postprocess": False,
                "postprocess_mode": mesh_request.postprocess_mode or "manual_mesh_tool",
                **_clean_paint_parameters(mesh_request.model_parameters),
            },
            model_preference=mesh_request.model_preference,
            priority=1,
            metadata={
                "postprocess_mode": mesh_request.postprocess_mode or "manual_mesh_tool",
                "enable_postprocess": False,
                "feature_type": "text_mesh_painting",
                "physics_enabled": getattr(mesh_request, "physics_enabled", False),
                "physics_config": getattr(mesh_request, "physics_config", None),
                "temp_input_dirs": list(tracked_temp_dirs),
            },
            user_id=user_id,
        )

        job_id = await scheduler.schedule_job(job_request)

        return MeshGenerationResponse(
            job_id=job_id,
            status="queued",
            message="Text-based mesh painting job queued successfully",
        )

    except HTTPException:
        for td in tracked_temp_dirs:
            shutil.rmtree(td, ignore_errors=True)
        raise
    except Exception as e:
        for td in tracked_temp_dirs:
            shutil.rmtree(td, ignore_errors=True)
        logger.error(f"Error scheduling text-mesh-painting job: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to schedule job: {str(e)}")


async def _resolve_generation_plan(request, *, default_model: str, default_feature: str, scheduler):
    explicit_model = (
        request.model_preference
        if _is_explicit_model_preference(request.model_preference)
        else None
    )
    model_id = explicit_model or default_model
    feature = default_feature
    preset = {}
    preset_metadata = {}

    if request.intent:
        settings = await get_current_settings()
        resolved = resolve_intent(
            request.intent,
            settings,
            explicit_model=explicit_model,
        )
        model_id = resolved["model_id"]
        feature = resolved["feature"]
        preset = resolved["preset"]
        preset_metadata = {
            "intent": request.intent,
            "smart_preset_version": resolved["version"],
            "applied_preset": preset,
            "chosen_model": model_id,
            "candidate_order": resolved["candidate_order"],
            "vram_budget_mb": resolved["vram_budget_mb"],
        }

    # Legacy textured-generation IDs remain accepted, but resolve to raw geometry.
    # Optional texture generation is controlled by the request flags.
    if model_id in _LEGACY_TEXTURED_MODEL_ALIASES:
        model_id = _LEGACY_TEXTURED_MODEL_ALIASES[model_id]
        feature = "image_to_raw_mesh"

    validate_model_preference(model_id, feature, scheduler)
    return model_id, feature, preset, preset_metadata


# Image-to-mesh endpoints (supports both file path and base64)
@router.post("/image-to-raw-mesh", response_model=MeshGenerationResponse)
async def image_to_raw_mesh(
    mesh_request: ImageToRawMeshRequest,
    scheduler: MultiprocessModelScheduler = Depends(get_scheduler),
    file_store: Optional[FileStore] = Depends(get_file_store),
):
    """
    Generate a 3D mesh from image.

    Args:
        mesh_request: Image-to-mesh generation parameters
        scheduler: Model scheduler dependency
        current_user: Current authenticated user (required if auth enabled)

    Returns:
        Job information for the mesh generation task
    """
    tracked_temp_dirs: List[str] = []
    try:
        user_id = None

        # A concrete user model choice takes precedence over automatic selection.
        if mesh_request.model_preference in _LEGACY_TEXTURED_MODEL_ALIASES:
            mesh_request.model_preference = _LEGACY_TEXTURED_MODEL_ALIASES[mesh_request.model_preference]
        from core.planner import plan_generation, get_planner_apply_config
        apply_cfg = get_planner_apply_config()
        has_explicit_model = _is_explicit_model_preference(mesh_request.model_preference)
        if has_explicit_model:
            is_auto = False
        elif mesh_request.auto_mode is not None:
            is_auto = bool(mesh_request.auto_mode)
        else:
            is_auto = bool(apply_cfg.get("model_choice", False))

        req_qual = getattr(mesh_request, "requested_quality", None) or getattr(mesh_request, "quality_mode", None) or "balanced"
        planner_req = {
            "mesh_style": getattr(mesh_request, "mesh_style", "auto") or "auto",
            "requested_quality": req_qual,
            "object_type": getattr(mesh_request, "object_type", "general") or "general",
            "symmetry": getattr(mesh_request, "symmetry", "none") or "none",
            "target_polycount": getattr(mesh_request, "target_polycount", None),
            "input_type": "image",
            "model_preference": mesh_request.model_preference,
            "auto_mode": is_auto,
            "low_vram": mesh_request.low_vram,
            "input_prep": mesh_request.input_prep,
        }
        from core.runtime_probe import probe_runtime
        scheduler_loaded = _get_loaded_models_from_scheduler(scheduler)
        try:
            runtime_facts = probe_runtime(loaded_models=scheduler_loaded)
        except Exception as e:
            logger.warning("probe_runtime failed, using fallback runtime facts: %s", e)
            runtime_facts = {
                "has_cuda": False,
                "installed_adapters": [],
                "enabled_adapters": [],
                "loaded_models": scheduler_loaded,
                "license_optins": {},
            }
        existing_loaded = set(runtime_facts.get("loaded_models") or [])
        existing_loaded.update(scheduler_loaded)
        runtime_facts["loaded_models"] = list(existing_loaded)
        _augment_runtime_facts_with_freeable_vram(runtime_facts, scheduler)
        generation_plan = plan_generation(planner_req, runtime_facts)
        would_have_chosen = generation_plan.get("would_have_chosen") or generation_plan.get("adapter")
        logger.info("Planner would_have_chosen: %s, reasons: %s", would_have_chosen, generation_plan.get("reasons"))

        if not is_auto and has_explicit_model:
            model_id, feature, preset, preset_metadata = await _resolve_generation_plan(
                mesh_request,
                default_model="hunyuan3d_shape_v21_image_to_raw_mesh",
                default_feature="image_to_raw_mesh",
                scheduler=scheduler,
            )
        elif (
            is_auto
            and would_have_chosen
            and scheduler.validate_model_preference(
                would_have_chosen, "image_to_raw_mesh"
            )
        ):
            if mesh_request.intent:
                _, feature, preset, preset_metadata = await _resolve_generation_plan(
                    mesh_request,
                    default_model=would_have_chosen,
                    default_feature="image_to_raw_mesh",
                    scheduler=scheduler,
                )
                model_id = would_have_chosen
                preset_metadata["chosen_model"] = model_id
                preset_metadata["planner_applied"] = True
            else:
                model_id = would_have_chosen
                feature = "image_to_raw_mesh"
                preset = {}
                preset_metadata = {"applied_preset": preset, "chosen_model": model_id, "planner_applied": True}
        else:
            model_id, feature, preset, preset_metadata = await _resolve_generation_plan(
                mesh_request,
                default_model="hunyuan3d_shape_v21_image_to_raw_mesh",
                default_feature="image_to_raw_mesh",
                scheduler=scheduler,
            )

        if mesh_request.enhancement_enabled and not mesh_request.preprocessing_artifact_id:
            raise HTTPException(
                status_code=400,
                detail="enhancement_enabled requires an approved preprocessing_artifact_id",
            )
        if mesh_request.preprocessing_artifact_id and not mesh_request.enhancement_enabled:
            raise HTTPException(
                status_code=400,
                detail="Choose the preprocessing artifact or disable enhancement and use the original image",
            )
        if mesh_request.preprocessing_review_override and not mesh_request.preprocessing_artifact_id:
            raise HTTPException(status_code=400, detail="A review override requires a preprocessing artifact")

        original_image_path = await process_file_input(
            file_path=mesh_request.image_path,
            base64_data=mesh_request.image_base64,
            file_id=mesh_request.image_file_id,
            input_type="image",
            file_store=file_store,
            tracked_temp_dirs=tracked_temp_dirs,
        )

        image_file_path = original_image_path
        preprocessing_metadata = {}
        if mesh_request.preprocessing_artifact_id:
            try:
                image_file_path, preprocessing_metadata = load_preprocessed_artifact(
                    mesh_request.preprocessing_artifact_id,
                    "approved",
                    allow_review=mesh_request.preprocessing_review_override,
                )
            except ValueError as exc:
                raise HTTPException(status_code=409, detail=str(exc)) from exc
        elif mesh_request.enhancement_enabled:
            model_config = getattr(scheduler, "model_registry", {}).get(model_id, {})
            capabilities = (
                model_config.get("capabilities", {})
                if isinstance(model_config, dict)
                else getattr(model_config, "capabilities", {}) or {}
            )
            preprocessing_profile = str(capabilities.get("preferred_preprocessing", "default"))
            prep_flags = generation_plan.get("input_prep", {}) if apply_cfg.get("input_prep", True) else {}
            enhanced = preprocess_image(
                str(image_file_path),
                profile=preprocessing_profile,
                remove_background=bool(prep_flags.get("remove_background", True)),
                auto_crop=bool(prep_flags.get("tight_crop", True)),
                upscale=bool(prep_flags.get("upscale_small", prep_flags.get("upscale_if_small", True))),
            )
            image_file_path = enhanced["approved_path"]
            preprocessing_metadata = enhanced["metadata"]

        chosen_stem = await resolve_asset_name(
            mesh_request,
            file_store,
            image_file_path,
            mesh_request.image_file_id,
        )
        # Filter out None values from model_parameters so pop() fallbacks work correctly
        params = {k: v for k, v in (mesh_request.model_parameters or {}).items() if v is not None}
        for key in (
            "candidate_count",
            "enable_postprocess",
            "topology_mode",
            "quad_topology",
            "part_count_range",
            "rig_type",
            "export_formats",
            "slicer_handoff",
        ):
            params.pop(key, None)
        # Keep texture-stage controls out of model-specific inference parameters.
        params.pop("texture_resolution", None)
        params.pop("texture_resolution_preset", None)
        nested_texture_flags = [
            params.pop("texture_enabled", None),
            params.pop("generate_texture", None),
            params.pop("generateTexture", None),
            params.pop("auto_paint", None),
        ]
        top_level_texture_flags = [mesh_request.texture_enabled, mesh_request.generate_texture]
        texture_enabled = next(
            (bool(value) for value in top_level_texture_flags if value is not None),
            next((bool(value) for value in nested_texture_flags if value is not None), False),
        )
        nested_target_polycount = params.pop("target_polycount", None)
        target_polycount = _resolve_target_polycount_precedence(
            mesh_request.target_polycount,
            nested_target_polycount,
            preset.get("target_polycount"),
        )
        # Production options: explicit request value > intent preset > backend default.
        # Legacy `model_parameters` production keys are ignored and never reach job inputs.
        params.pop("generateLOD", None)
        params.pop("lodPreset", None)
        params.pop("lodCount", None)
        lod_enabled = bool(_resolve_preset_option(mesh_request.generate_lod, preset, "generate_lod", True))
        lod_preset = str(_resolve_preset_option(mesh_request.lod_preset, preset, "lod_preset", "high"))
        lod_count = int(_resolve_preset_option(mesh_request.lod_count, preset, "lod_count", 4))

        if "auto_uv" in preset:
            auto_uv = bool(preset["auto_uv"])
            params.pop("auto_uv", None)
        else:
            auto_uv = bool(params.pop("auto_uv", True))

        # Resolve quality: cinematic intent or target >= 150k uses "ultra", others default to "high"
        if mesh_request.intent == "cinematic" or (target_polycount is not None and target_polycount >= 150_000):
            quality = "ultra"
        elif preset.get("quality"):
            quality = str(preset["quality"])
        elif mesh_request.quality_mode and mesh_request.quality_mode != "high":
            quality = str(mesh_request.quality_mode)
        else:
            quality = str(params.pop("quality", mesh_request.quality_mode or "high"))
        params.pop("quality", None)

        params.pop("enable_printability_check", None)
        params.pop("enable_auto_repair", None)
        params.pop("enable_auto_rig", None)
        enable_printability = bool(
            _resolve_preset_option(mesh_request.enable_printability_check, preset, "enable_printability_check", False)
        )
        enable_auto_repair = bool(
            _resolve_preset_option(mesh_request.enable_auto_repair, preset, "enable_auto_repair", False)
        )
        enable_auto_rig = bool(
            _resolve_preset_option(mesh_request.enable_auto_rig, preset, "enable_auto_rig", False)
        )
        physics_enabled = bool(_resolve_preset_option(mesh_request.physics_enabled, preset, "collision", False))
        texture_resolution = int(
            _resolve_preset_option(mesh_request.texture_resolution, preset, "texture_resolution", 2048)
        )
        part_count_range = str(
            _resolve_preset_option(mesh_request.part_count_range, preset, "part_count_range", "1")
        )
        rig_type = str(_resolve_preset_option(mesh_request.rig_type, preset, "rig_type", "none"))
        export_formats = list(
            _resolve_preset_option(mesh_request.export_formats, preset, "export_formats", ["glb"])
        )
        slicer_handoff = bool(
            _resolve_preset_option(mesh_request.slicer_handoff, preset, "slicer_handoff", False)
        )

        if not mesh_request.enable_postprocess:
            texture_enabled = False
            lod_enabled = False
            enable_printability = False
            enable_auto_repair = False
            enable_auto_rig = False
            target_polycount = 0
        elif mesh_request.intent == "native" or target_polycount == -1:
            if mesh_request.intent == "native":
                if mesh_request.texture_enabled is None and mesh_request.generate_texture is None:
                    texture_enabled = False
                lod_enabled = False
                enable_printability = False
                enable_auto_repair = False
                enable_auto_rig = False
                auto_uv = False
            target_polycount = -1

        job_request = JobRequest(
            feature=feature,
            inputs={
                "asset_name": chosen_stem,
                "image_name": chosen_stem,
                "image_path": image_file_path,
                "reference_image_path": original_image_path,
                "output_format": mesh_request.output_format,
                "texture_resolution": texture_resolution,
                "bake_normal_maps": mesh_request.bake_normal_maps,
                "texture_enabled": texture_enabled,
                "intent": mesh_request.intent,
                "mesh_style": getattr(mesh_request, "mesh_style", "auto") or "auto",
                "requested_quality": req_qual,
                "object_type": getattr(mesh_request, "object_type", "general") or "general",
                "symmetry": getattr(mesh_request, "symmetry", "none") or "none",
                "plan": generation_plan,
                "fallback_chain": generation_plan.get("fallback_chain", []),
                "preprocessing_artifact_id": mesh_request.preprocessing_artifact_id,
                "preprocessing_review_override": mesh_request.preprocessing_review_override,
                "enhancement_enabled": mesh_request.enhancement_enabled,
                "preprocessing_metadata": preprocessing_metadata,
                "target_polycount": target_polycount,
                "generateLOD": lod_enabled,
                "lodPreset": lod_preset,
                "lodCount": lod_count,
                "auto_uv": auto_uv,
                "quality": quality,
                "physics_enabled": physics_enabled,
                "physics_config": mesh_request.physics_config,
                "enable_printability_check": enable_printability,
                "enable_auto_repair": enable_auto_repair,
                "enable_auto_rig": enable_auto_rig,
                "auto_rig_mode": mesh_request.auto_rig_mode,
                "topology_mode": mesh_request.topology_mode or ("quad" if mesh_request.quad_topology else "triangle"),
                "quad_topology": bool(mesh_request.quad_topology or mesh_request.topology_mode == "quad"),
                "enable_postprocess": mesh_request.enable_postprocess,
                "candidate_count": int(mesh_request.candidate_count or 1),
                "part_count_range": part_count_range,
                "rig_type": rig_type,
                "export_formats": export_formats,
                "slicer_handoff": slicer_handoff,
                "low_vram": mesh_request.low_vram if mesh_request.low_vram is not None else params.get("low_vram"),
                **params,
            },
            model_preference=model_id,
            priority=1,
            metadata={
                "asset_name": chosen_stem,
                "image_name": chosen_stem,
                "candidate_count": int(mesh_request.candidate_count or 1),
                "part_count_range": part_count_range,
                "rig_type": rig_type,
                "export_formats": export_formats,
                "slicer_handoff": slicer_handoff,
                "postprocess_mode": "production_mesh" if mesh_request.enable_postprocess else "none",
                "enable_postprocess": mesh_request.enable_postprocess,
                "feature_type": feature,
                "texture_resolution": texture_resolution,
                "bake_normal_maps": mesh_request.bake_normal_maps,
                "texture_enabled": texture_enabled,
                "reference_image_path": original_image_path,
                "physics_enabled": physics_enabled,
                "physics_config": mesh_request.physics_config,
                "intent": mesh_request.intent,
                "mesh_style": getattr(mesh_request, "mesh_style", "auto") or "auto",
                "requested_quality": req_qual,
                "object_type": getattr(mesh_request, "object_type", "general") or "general",
                "symmetry": getattr(mesh_request, "symmetry", "none") or "none",
                "plan": generation_plan,
                "fallback_chain": generation_plan.get("fallback_chain", []),
                **preset_metadata,
                "model_selection": "explicit" if has_explicit_model else "automatic",
                "preprocessing": preprocessing_metadata,
                "preprocessing_review_override": mesh_request.preprocessing_review_override,
                "enhancement_enabled": mesh_request.enhancement_enabled,
                "target_polycount": target_polycount,
                "generateLOD": lod_enabled,
                "lodPreset": lod_preset,
                "lodCount": lod_count,
                "auto_uv": auto_uv,
                "quality": quality,
                "enable_printability_check": enable_printability,
                "enable_auto_repair": enable_auto_repair,
                "enable_auto_rig": enable_auto_rig,
                "auto_rig_mode": mesh_request.auto_rig_mode,
                "topology_mode": mesh_request.topology_mode or ("quad" if mesh_request.quad_topology else "triangle"),
                "quad_topology": bool(mesh_request.quad_topology or mesh_request.topology_mode == "quad"),
                "temp_input_dirs": list(tracked_temp_dirs),
            },
            user_id=user_id,
        )

        job_id = await scheduler.schedule_job(job_request)

        return MeshGenerationResponse(
            job_id=job_id,
            status="queued",
            message="Image-to-raw-mesh generation job queued successfully",
        )

    except HTTPException:
        for td in tracked_temp_dirs:
            shutil.rmtree(td, ignore_errors=True)
        raise
    except ValueError as e:
        for td in tracked_temp_dirs:
            shutil.rmtree(td, ignore_errors=True)
        logger.warning(f"Validation error in image_to_raw_mesh: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        for td in tracked_temp_dirs:
            shutil.rmtree(td, ignore_errors=True)
        logger.error(f"Error scheduling image-to-raw-mesh job: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to schedule job: {e}")

@router.post("/image-to-textured-mesh", response_model=MeshGenerationResponse)
async def image_to_textured_mesh(
    mesh_request: ImageToTexturedMeshRequest,
    scheduler: MultiprocessModelScheduler = Depends(get_scheduler),
    file_store: Optional[FileStore] = Depends(get_file_store),
):
    """
    Generate a 3D textured mesh from image.

    Args:
        mesh_request: Image-to-textured-mesh generation parameters
        scheduler: Model scheduler dependency
        current_user: Current authenticated user (required if auth enabled)

    Returns:
        Job information for the mesh generation task
    """
    tracked_temp_dirs: List[str] = []
    try:
        user_id = None
        # A concrete user model choice takes precedence over automatic selection.
        if mesh_request.model_preference in _LEGACY_TEXTURED_MODEL_ALIASES:
            mesh_request.model_preference = _LEGACY_TEXTURED_MODEL_ALIASES[mesh_request.model_preference]
        from core.planner import plan_generation, get_planner_apply_config
        apply_cfg = get_planner_apply_config()
        has_explicit_model = _is_explicit_model_preference(mesh_request.model_preference)
        if has_explicit_model:
            is_auto = False
        elif mesh_request.auto_mode is not None:
            is_auto = bool(mesh_request.auto_mode)
        else:
            is_auto = bool(apply_cfg.get("model_choice", False))

        req_qual = getattr(mesh_request, "requested_quality", None) or getattr(mesh_request, "quality_mode", None) or "balanced"
        planner_req = {
            "mesh_style": getattr(mesh_request, "mesh_style", "auto") or "auto",
            "requested_quality": req_qual,
            "object_type": getattr(mesh_request, "object_type", "general") or "general",
            "symmetry": getattr(mesh_request, "symmetry", "none") or "none",
            "target_polycount": getattr(mesh_request, "target_polycount", None),
            "input_type": "image",
            "model_preference": mesh_request.model_preference,
            "auto_mode": is_auto,
            "low_vram": mesh_request.low_vram,
            "input_prep": mesh_request.input_prep,
        }
        from core.runtime_probe import probe_runtime
        scheduler_loaded = _get_loaded_models_from_scheduler(scheduler)
        try:
            runtime_facts = probe_runtime(loaded_models=scheduler_loaded)
        except Exception as e:
            logger.warning("probe_runtime failed, using fallback runtime facts: %s", e)
            runtime_facts = {
                "has_cuda": False,
                "installed_adapters": [],
                "enabled_adapters": [],
                "loaded_models": scheduler_loaded,
                "license_optins": {},
            }
        existing_loaded = set(runtime_facts.get("loaded_models") or [])
        existing_loaded.update(scheduler_loaded)
        runtime_facts["loaded_models"] = list(existing_loaded)
        _augment_runtime_facts_with_freeable_vram(runtime_facts, scheduler)
        generation_plan = plan_generation(planner_req, runtime_facts)
        would_have_chosen = generation_plan.get("would_have_chosen") or generation_plan.get("adapter")
        logger.info("Planner would_have_chosen: %s, reasons: %s", would_have_chosen, generation_plan.get("reasons"))

        if not is_auto and has_explicit_model:
            model_id, feature, preset, preset_metadata = await _resolve_generation_plan(
                mesh_request,
                default_model="trellis_image_to_textured_mesh",
                default_feature="image_to_textured_mesh",
                scheduler=scheduler,
            )
        elif (
            is_auto
            and would_have_chosen
            and scheduler.validate_model_preference(
                would_have_chosen, "image_to_textured_mesh"
            )
        ):
            if mesh_request.intent:
                _, feature, preset, preset_metadata = await _resolve_generation_plan(
                    mesh_request,
                    default_model=would_have_chosen,
                    default_feature="image_to_textured_mesh",
                    scheduler=scheduler,
                )
                model_id = would_have_chosen
                preset_metadata["chosen_model"] = model_id
                preset_metadata["planner_applied"] = True
            else:
                model_id = would_have_chosen
                feature = "image_to_textured_mesh"
                preset = {}
                preset_metadata = {"applied_preset": preset, "chosen_model": model_id, "planner_applied": True}
        else:
            model_id, feature, preset, preset_metadata = await _resolve_generation_plan(
                mesh_request,
                default_model="trellis_image_to_textured_mesh",
                default_feature="image_to_textured_mesh",
                scheduler=scheduler,
            )

        if mesh_request.enhancement_enabled and not mesh_request.preprocessing_artifact_id:
            raise HTTPException(
                status_code=400,
                detail="enhancement_enabled requires an approved preprocessing_artifact_id",
            )
        if mesh_request.preprocessing_artifact_id and not mesh_request.enhancement_enabled:
            raise HTTPException(
                status_code=400,
                detail="Choose the preprocessing artifact or disable enhancement and use the original image",
            )
        if mesh_request.preprocessing_review_override and not mesh_request.preprocessing_artifact_id:
            raise HTTPException(status_code=400, detail="A review override requires a preprocessing artifact")

        original_image_path = await process_file_input(
            file_path=mesh_request.image_path,
            base64_data=mesh_request.image_base64,
            file_id=mesh_request.image_file_id,
            input_type="image",
            file_store=file_store,
            tracked_temp_dirs=tracked_temp_dirs,
        )

        image_file_path = original_image_path
        preprocessing_metadata = {}
        if mesh_request.preprocessing_artifact_id:
            try:
                image_file_path, preprocessing_metadata = load_preprocessed_artifact(
                    mesh_request.preprocessing_artifact_id,
                    "approved",
                    allow_review=mesh_request.preprocessing_review_override,
                )
            except ValueError as exc:
                raise HTTPException(status_code=409, detail=str(exc)) from exc
        elif mesh_request.enhancement_enabled:
            model_config = getattr(scheduler, "model_registry", {}).get(model_id, {})
            capabilities = (
                model_config.get("capabilities", {})
                if isinstance(model_config, dict)
                else getattr(model_config, "capabilities", {}) or {}
            )
            preprocessing_profile = str(capabilities.get("preferred_preprocessing", "default"))
            prep_flags = generation_plan.get("input_prep", {}) if apply_cfg.get("input_prep", True) else {}
            enhanced = preprocess_image(
                str(image_file_path),
                profile=preprocessing_profile,
                remove_background=bool(prep_flags.get("remove_background", True)),
                auto_crop=bool(prep_flags.get("tight_crop", True)),
                upscale=bool(prep_flags.get("upscale_small", prep_flags.get("upscale_if_small", True))),
            )
            image_file_path = enhanced["approved_path"]
            preprocessing_metadata = enhanced["metadata"]

        texture_image_path = None
        if mesh_request.texture_image_path or mesh_request.texture_image_base64 or mesh_request.texture_image_file_id:
            texture_image_path = await process_file_input(
                file_path=mesh_request.texture_image_path,
                base64_data=mesh_request.texture_image_base64,
                file_id=mesh_request.texture_image_file_id,
                input_type="texture_image",
                file_store=file_store,
                tracked_temp_dirs=tracked_temp_dirs,
            )

        chosen_stem = await resolve_asset_name(
            mesh_request,
            file_store,
            image_file_path,
            mesh_request.image_file_id,
        )
        # Filter out None values from model_parameters so pop() fallbacks work correctly
        params = {k: v for k, v in (mesh_request.model_parameters or {}).items() if v is not None}
        for key in (
            "candidate_count",
            "enable_postprocess",
            "topology_mode",
            "quad_topology",
            "part_count_range",
            "rig_type",
            "export_formats",
            "slicer_handoff",
        ):
            params.pop(key, None)
        # Preserve nested resolution from old clients, but never pass it to geometry inference.
        source_texture_resolution = params.pop("texture_resolution", None)
        legacy_preset = params.pop("texture_resolution_preset", None)
        if source_texture_resolution is not None or legacy_preset is not None:
            try:
                source_texture_resolution = _normalize_texture_resolution(
                    source_texture_resolution or legacy_preset
                )
            except ValueError as e:
                raise HTTPException(status_code=422, detail=str(e))
        nested_target_polycount = params.pop("target_polycount", None)
        target_polycount = _resolve_target_polycount_precedence(
            mesh_request.target_polycount,
            nested_target_polycount,
            preset.get("target_polycount"),
        )
        # Production options: explicit request value > intent preset > backend default.
        # Legacy `model_parameters` production keys are ignored and never reach job inputs.
        params.pop("generateLOD", None)
        params.pop("lodPreset", None)
        params.pop("lodCount", None)
        lod_enabled = bool(_resolve_preset_option(mesh_request.generate_lod, preset, "generate_lod", True))
        lod_preset = str(_resolve_preset_option(mesh_request.lod_preset, preset, "lod_preset", "high"))
        lod_count = int(_resolve_preset_option(mesh_request.lod_count, preset, "lod_count", 4))

        if "auto_uv" in preset:
            auto_uv = bool(preset["auto_uv"])
            params.pop("auto_uv", None)
        else:
            auto_uv = bool(params.pop("auto_uv", True))

        # Resolve quality: cinematic intent or target >= 150k uses "ultra", others default to "high"
        if mesh_request.intent == "cinematic" or (target_polycount is not None and target_polycount >= 150_000):
            quality = "ultra"
        elif preset.get("quality"):
            quality = str(preset["quality"])
        elif mesh_request.quality_mode and mesh_request.quality_mode != "high":
            quality = str(mesh_request.quality_mode)
        else:
            quality = str(params.pop("quality", mesh_request.quality_mode or "high"))
        params.pop("quality", None)

        nested_texture_flags = [
            params.pop("texture_enabled", None),
            params.pop("generate_texture", None),
            params.pop("generateTexture", None),
            params.pop("auto_paint", None),
        ]
        top_level_texture_flags = [mesh_request.texture_enabled, mesh_request.generate_texture]
        texture_enabled = next(
            (bool(value) for value in top_level_texture_flags if value is not None),
            next((bool(value) for value in nested_texture_flags if value is not None), True),
        )
        texture_resolution = int(
            _resolve_preset_option(
                mesh_request.texture_resolution,
                preset,
                "texture_resolution",
                source_texture_resolution or 2048,
            )
        )
        part_count_range = str(
            _resolve_preset_option(mesh_request.part_count_range, preset, "part_count_range", "1")
        )
        rig_type = str(_resolve_preset_option(mesh_request.rig_type, preset, "rig_type", "none"))
        export_formats = list(
            _resolve_preset_option(mesh_request.export_formats, preset, "export_formats", ["glb"])
        )
        slicer_handoff = bool(
            _resolve_preset_option(mesh_request.slicer_handoff, preset, "slicer_handoff", False)
        )
        params.pop("enable_printability_check", None)
        params.pop("enable_auto_repair", None)
        params.pop("enable_auto_rig", None)
        enable_printability = bool(
            _resolve_preset_option(mesh_request.enable_printability_check, preset, "enable_printability_check", False)
        )
        enable_auto_repair = bool(
            _resolve_preset_option(mesh_request.enable_auto_repair, preset, "enable_auto_repair", False)
        )
        enable_auto_rig = bool(
            _resolve_preset_option(mesh_request.enable_auto_rig, preset, "enable_auto_rig", False)
        )
        physics_enabled = bool(_resolve_preset_option(mesh_request.physics_enabled, preset, "collision", False))

        if not mesh_request.enable_postprocess:
            texture_enabled = False
            lod_enabled = False
            enable_printability = False
            enable_auto_repair = False
            enable_auto_rig = False
            target_polycount = 0
        elif mesh_request.intent == "native" or target_polycount == -1:
            if mesh_request.intent == "native":
                if mesh_request.texture_enabled is None and mesh_request.generate_texture is None:
                    texture_enabled = False
                lod_enabled = False
                enable_printability = False
                enable_auto_repair = False
                enable_auto_rig = False
                auto_uv = False
            target_polycount = -1

        job_request = JobRequest(
            feature=feature,
            inputs={
                "asset_name": chosen_stem,
                "image_name": chosen_stem,
                "image_path": image_file_path,
                "reference_image_path": original_image_path,
                "texture_image_path": texture_image_path,
                "output_format": mesh_request.output_format,
                "texture_resolution": texture_resolution,
                "production_texture_resolution": texture_resolution,
                "bake_normal_maps": mesh_request.bake_normal_maps,
                "texture_enabled": texture_enabled,
                "intent": mesh_request.intent,
                "mesh_style": getattr(mesh_request, "mesh_style", "auto") or "auto",
                "requested_quality": req_qual,
                "object_type": getattr(mesh_request, "object_type", "general") or "general",
                "symmetry": getattr(mesh_request, "symmetry", "none") or "none",
                "plan": generation_plan,
                "fallback_chain": generation_plan.get("fallback_chain", []),
                "preprocessing_artifact_id": mesh_request.preprocessing_artifact_id,
                "preprocessing_review_override": mesh_request.preprocessing_review_override,
                "enhancement_enabled": mesh_request.enhancement_enabled,
                "preprocessing_metadata": preprocessing_metadata,
                "target_polycount": target_polycount,
                "generateLOD": lod_enabled,
                "lodPreset": lod_preset,
                "lodCount": lod_count,
                "auto_uv": auto_uv,
                "quality": quality,
                "physics_enabled": physics_enabled,
                "physics_config": mesh_request.physics_config,
                "enable_printability_check": enable_printability,
                "enable_auto_repair": enable_auto_repair,
                "enable_auto_rig": enable_auto_rig,
                "auto_rig_mode": mesh_request.auto_rig_mode,
                "topology_mode": mesh_request.topology_mode or ("quad" if mesh_request.quad_topology else "triangle"),
                "quad_topology": bool(mesh_request.quad_topology or mesh_request.topology_mode == "quad"),
                "enable_postprocess": mesh_request.enable_postprocess,
                "candidate_count": int(mesh_request.candidate_count or 1),
                "part_count_range": part_count_range,
                "rig_type": rig_type,
                "export_formats": export_formats,
                "slicer_handoff": slicer_handoff,
                "low_vram": mesh_request.low_vram if mesh_request.low_vram is not None else params.get("low_vram"),
                **params,
            },
            model_preference=model_id,
            priority=1,
            metadata={
                "asset_name": chosen_stem,
                "image_name": chosen_stem,
                "candidate_count": int(mesh_request.candidate_count or 1),
                "part_count_range": part_count_range,
                "rig_type": rig_type,
                "export_formats": export_formats,
                "slicer_handoff": slicer_handoff,
                "postprocess_mode": "production_mesh" if mesh_request.enable_postprocess else "none",
                "enable_postprocess": mesh_request.enable_postprocess,
                "feature_type": feature,
                "texture_resolution": texture_resolution,
                "bake_normal_maps": mesh_request.bake_normal_maps,
                "texture_enabled": texture_enabled,
                "reference_image_path": original_image_path,
                "physics_enabled": physics_enabled,
                "physics_config": mesh_request.physics_config,
                "intent": mesh_request.intent,
                "mesh_style": getattr(mesh_request, "mesh_style", "auto") or "auto",
                "requested_quality": req_qual,
                "object_type": getattr(mesh_request, "object_type", "general") or "general",
                "symmetry": getattr(mesh_request, "symmetry", "none") or "none",
                "plan": generation_plan,
                "fallback_chain": generation_plan.get("fallback_chain", []),
                **preset_metadata,
                "model_selection": "explicit" if has_explicit_model else "automatic",
                "preprocessing": preprocessing_metadata,
                "preprocessing_review_override": mesh_request.preprocessing_review_override,
                "enhancement_enabled": mesh_request.enhancement_enabled,
                "target_polycount": target_polycount,
                "generateLOD": lod_enabled,
                "lodPreset": lod_preset,
                "lodCount": lod_count,
                "auto_uv": auto_uv,
                "quality": quality,
                "enable_printability_check": enable_printability,
                "enable_auto_repair": enable_auto_repair,
                "enable_auto_rig": enable_auto_rig,
                "auto_rig_mode": mesh_request.auto_rig_mode,
                "topology_mode": mesh_request.topology_mode or ("quad" if mesh_request.quad_topology else "triangle"),
                "quad_topology": bool(mesh_request.quad_topology or mesh_request.topology_mode == "quad"),
                "temp_input_dirs": list(tracked_temp_dirs),
            },
            user_id=user_id,
        )

        job_id = await scheduler.schedule_job(job_request)

        return MeshGenerationResponse(
            job_id=job_id,
            status="queued",
            message="Image-to-textured-mesh generation job queued successfully",
        )

    except HTTPException:
        for td in tracked_temp_dirs:
            shutil.rmtree(td, ignore_errors=True)
        raise
    except ValueError as e:
        for td in tracked_temp_dirs:
            shutil.rmtree(td, ignore_errors=True)
        logger.warning(f"Validation error in image_to_textured_mesh: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        for td in tracked_temp_dirs:
            shutil.rmtree(td, ignore_errors=True)
        logger.error(f"Error scheduling image-to-textured-mesh job: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to schedule job: {e}")

@router.post("/image-mesh-painting", response_model=MeshGenerationResponse)
async def image_mesh_painting(
    mesh_request: ImageMeshPaintingRequest,
    scheduler: MultiprocessModelScheduler = Depends(get_scheduler),
    file_store: Optional[FileStore] = Depends(get_file_store),
):
    """
    Texture a 3D mesh using an image.

    Args:
        mesh_request: Image-based mesh painting parameters
        scheduler: Model scheduler dependency
        current_user: Current authenticated user (required if auth enabled)

    Returns:
        Job information for the mesh painting task
    """
    tracked_temp_dirs: List[str] = []
    try:
        user_id = None
        
        if mesh_request.mask_path or mesh_request.mask_base64 or mesh_request.mask_file_id:
            raise HTTPException(
                status_code=422,
                detail="Localized UV-mask retexturing is not supported by Paint3D/Hunyuan3D-Paint yet. Submit a full-mesh texture request without a mask.",
            )

        # Resolution routing: 1K/2K strictly routes to Paint3D, 4K/8K strictly routes to Hunyuan3D-Paint-v2-1
        model_preference = mesh_request.model_preference
        if model_preference in ("trellis_image_mesh_painting", "auto", "default", None, ""):
            if mesh_request.texture_resolution >= 4096:
                model_preference = "hunyuan3d_paint_v21_image_mesh_painting"
            else:
                model_preference = "paint3d_image_mesh_painting"

        # Validate model preference
        validate_model_preference(
            model_preference, "image_mesh_painting", scheduler
        )

        # Process image input
        image_file_path = await process_file_input(
            file_path=mesh_request.image_path,
            base64_data=mesh_request.image_base64,
            file_id=mesh_request.image_file_id,
            input_type="image",
            file_store=file_store,
            tracked_temp_dirs=tracked_temp_dirs,
        )

        # Process mesh input
        mesh_file_path = await process_file_input(
            file_path=mesh_request.mesh_path,
            base64_data=mesh_request.mesh_base64,
            file_id=mesh_request.mesh_file_id,
            input_type="mesh",
            file_store=file_store,
            tracked_temp_dirs=tracked_temp_dirs,
        )

        # Process mask input if provided
        mask_file_path = None
        if mesh_request.mask_path or mesh_request.mask_base64 or mesh_request.mask_file_id:
            mask_file_path = await process_file_input(
                file_path=mesh_request.mask_path,
                base64_data=mesh_request.mask_base64,
                file_id=mesh_request.mask_file_id,
                input_type="image",
                file_store=file_store,
                tracked_temp_dirs=tracked_temp_dirs,
            )

        job_request = JobRequest(
            feature="image_mesh_painting",
            inputs={
                "image_path": image_file_path,
                "reference_image_path": image_file_path,
                "mesh_path": mesh_file_path,
                "mask_path": mask_file_path,
                "output_format": mesh_request.output_format,
                "texture_resolution": mesh_request.texture_resolution,
                "topology_mode": "quad" if mesh_request.quad_topology or mesh_request.topology_mode == "quad" else mesh_request.topology_mode,
                "quad_topology": bool(mesh_request.quad_topology or mesh_request.topology_mode == "quad"),
                "resolution": (
                    (mesh_request.model_parameters or {}).get("resolution")
                    or (
                        768 if "paint_v21" in model_preference
                        and mesh_request.texture_resolution >= 8192
                        else 512 if "paint_v21" in model_preference
                        else mesh_request.texture_resolution
                    )
                ),
                **({"prompt": mesh_request.text_prompt.strip()} if mesh_request.text_prompt and "paint_v21" not in model_preference else {}),
                "enable_postprocess": False,
                "postprocess_mode": mesh_request.postprocess_mode or "manual_mesh_tool",
                **_clean_paint_parameters(mesh_request.model_parameters),
            },
            model_preference=model_preference,
            priority=1,
            metadata={
                "postprocess_mode": mesh_request.postprocess_mode or "manual_mesh_tool",
                "enable_postprocess": False,
                "feature_type": "image_mesh_painting",
                "physics_enabled": getattr(mesh_request, "physics_enabled", False),
                "physics_config": getattr(mesh_request, "physics_config", None),
                "temp_input_dirs": list(tracked_temp_dirs),
            },
            user_id=user_id,
        )

        job_id = await scheduler.schedule_job(job_request)

        return MeshGenerationResponse(
            job_id=job_id,
            status="queued",
            message="Image-based mesh painting job queued successfully",
        )

    except HTTPException:
        for td in tracked_temp_dirs:
            shutil.rmtree(td, ignore_errors=True)
        raise
    except Exception as e:
        for td in tracked_temp_dirs:
            shutil.rmtree(td, ignore_errors=True)
        logger.error(f"Error scheduling image-mesh-painting job: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to schedule job: {str(e)}")



# Alias single and batch endpoints for image-to-mesh generation
@router.post("/generate-mesh-from-image", response_model=MeshGenerationResponse)
async def generate_mesh_from_image(
    mesh_request: ImageToRawMeshRequest,
    scheduler: MultiprocessModelScheduler = Depends(get_scheduler),
    file_store: Optional[FileStore] = Depends(get_file_store),
):
    """
    Generate a 3D mesh from image (endpoint alias for image-to-raw-mesh).
    Supports intent presets (game_ready: 50k, cinematic: 200k, animation: 30k, 3d_print: 0, mobile: 20k)
    for target_polycount, generateLOD, lodPreset, lodCount, auto_uv, and quality.
    """
    return await image_to_raw_mesh(
        mesh_request=mesh_request,
        scheduler=scheduler,
        file_store=file_store,
    )


@router.post("/generate-mesh-from-image/batch", response_model=BatchMeshGenerationResponse)
@router.post("/batch/generate-mesh-from-image", response_model=BatchMeshGenerationResponse)
@router.post("/batch-generate-mesh-from-image", response_model=BatchMeshGenerationResponse)
async def generate_mesh_from_image_batch(
    batch_request: BatchImageToMeshRequest,
    scheduler: MultiprocessModelScheduler = Depends(get_scheduler),
    file_store: Optional[FileStore] = Depends(get_file_store),
):
    """
    Batch generate 3D meshes from multiple images.
    Aligns intent presets for each item without default 0s clobbering preset values.
    """
    job_ids: List[str] = []
    for item in batch_request.items:
        res = await image_to_raw_mesh(
            mesh_request=item,
            scheduler=scheduler,
                file_store=file_store,
        )
        job_ids.append(res.job_id)
    return BatchMeshGenerationResponse(
        job_ids=job_ids,
        status="queued",
        message=f"{len(job_ids)} mesh generation jobs queued successfully",
    )


batch_generate_mesh_from_image = generate_mesh_from_image_batch


# Utility endpoints
@router.get("/supported-formats")
async def get_supported_formats():
    """Get list of supported input and output formats"""
    return {
        "input_formats": {
            "text": ["string"],
            "image": ["png", "jpg", "jpeg", "webp", "bmp", "tiff"],
            "mesh": ["obj", "glb", "gltf", "ply", "stl", "fbx"],
            "base64": ["image/png", "image/jpeg", "model/gltf-binary"],
        },
        "output_formats": {
            "mesh": ["glb"],
            "texture": ["png", "jpg"],
        },
        "upload_limits": {
            "image_max_size_mb": 50,
            "mesh_max_size_mb": 200,
            "image_max_resolution": [4096, 4096],
        },
    }


@router.post("/cancel/{job_id}")
async def cancel_mesh_generation(
    job_id: str,
    request: Request,
    scheduler: MultiprocessModelScheduler = Depends(get_scheduler),
):
    """Cancel a queued mesh-generation job without deleting its history record."""
    try:
        job_status = await scheduler.get_job_status(job_id)
        if job_status is None:
            raise HTTPException(status_code=404, detail="Job not found")


        current_status = job_status.get("status")
        if current_status not in {"queued", "processing", "running"}:
            return {
                "job_id": job_id,
                "status": current_status,
                "cancelled": False,
                "message": "Job is no longer cancellable",
            }

        cancelled = await scheduler.cancel_job(job_id)
        if cancelled:
            return {
                "job_id": job_id,
                "status": "cancelled",
                "cancelled": True,
                "message": "Generation job cancelled",
            }

        updated_status = await scheduler.get_job_status(job_id)
        latest_status = (updated_status.get("status") if updated_status else None) or current_status
        if latest_status == "cancelled":
            return {
                "job_id": job_id,
                "status": "cancelled",
                "cancelled": True,
                "message": "Generation job cancelled",
            }

        if latest_status in {"queued", "processing", "running"}:
            return {
                "job_id": job_id,
                "status": latest_status,
                "cancelled": False,
                "cancel_requested": True,
                "message": "Cancellation requested",
            }

        return {
            "job_id": job_id,
            "status": latest_status,
            "cancelled": False,
            "message": "Job is no longer cancellable",
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error cancelling mesh generation job {job_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to cancel job: {e}")


@router.post("/refine-mesh")
async def refine_mesh(
    refine_request: RefineMeshRequest,
    scheduler: MultiprocessModelScheduler = Depends(get_scheduler),
):
    """Refine a coarse mesh with Hi3D, archiving the original mesh first.

    GPU inference is not exercised here (no torch/GPU in this environment);
    this endpoint only validates input and enqueues the refinement job.
    """
    try:
        # Validate the source job exists before archiving its mesh
        job_status = await scheduler.get_job_status(refine_request.job_id)
        if job_status is None:
            raise HTTPException(status_code=404, detail="Job not found")

        mesh_path = Path(refine_request.mesh_path)
        if not mesh_path.is_file():
            raise HTTPException(status_code=400, detail=f"Mesh file not found: {mesh_path}")

        # Archive the original mesh so refinement does not destroy the source
        legacy_path = f"{refine_request.mesh_path}_legacy.glb"
        shutil.copy2(mesh_path, legacy_path)

        job_request = JobRequest(
            feature="image_to_raw_mesh",
            inputs={
                "coarse_mesh_path": legacy_path,
                "reference_image_path": refine_request.image_path,
                "resolution": refine_request.resolution,
            },
            model_preference="hi3d_image_to_raw_mesh",
            priority=1,
            metadata={
                "feature_type": "refine_mesh",
                "source_job_id": refine_request.job_id,
            },
        )

        refinement_job_id = await scheduler.schedule_job(job_request)

        return {"refinement_job_id": refinement_job_id, "status": "submitted"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error scheduling refine-mesh job: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to schedule refinement job: {e}")
