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

from api.dependencies import get_current_settings, get_current_user_or_none, get_file_store, get_scheduler
from api.routers.file_upload import resolve_file_id_async
from api.utils.asset_name import resolve_asset_name
from core.file_store import FileStore
from core.scheduler.job_queue import JobRequest
from core.preprocess.image_enhancement import load_preprocessed_artifact, preprocess_image
from core.scheduler.multiprocess_scheduler import MultiprocessModelScheduler
from core.smart_presets import resolve_intent
from core.utils.file_utils import save_base64_file, save_upload_file

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/mesh-generation", tags=["mesh_generation"])

_LEGACY_TEXTURED_MODEL_ALIASES = {
    "trellis_image_to_textured_mesh": "trellis_image_to_3d",
    "trellis2_image_to_textured_mesh": "trellis2_image_to_3d",
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
    """Resolve a generation budget without allowing a nested default to mask explicit API input."""
    if top_level_target is not None:
        return top_level_target if top_level_target > 0 else 0
    if nested_target is not None and nested_target > 0:
        return nested_target
    return preset_target


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
    enable_postprocess: bool = Field(True, description="Run production postprocessing pipeline after mesh generation. If False, postprocessing is bypassed.")

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

    @field_validator("mesh_file_id")
    @classmethod
    def validate_inputs(cls, v, info):
        mesh_path = info.data.get("mesh_path")
        mesh_base64 = info.data.get("mesh_base64")

        inputs_provided = sum(bool(x) for x in [mesh_path, mesh_base64, v])

        if inputs_provided == 0:
            raise ValueError(
                "One of mesh_path, mesh_base64, or mesh_file_id must be provided"
            )
        if inputs_provided > 1:
            raise ValueError(
                "Only one of mesh_path, mesh_base64, or mesh_file_id should be provided"
            )
        return v

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
    texture_resolution: int = Field(
        2048, description="Optional texture-atlas preset or size"
    )
    bake_normal_maps: bool = Field(True, description="Bake high-to-low detail maps when supported")
    texture_enabled: Optional[bool] = None
    generate_texture: Optional[bool] = None
    output_format: str = Field("glb", description="Output mesh format")
    quality_mode: Optional[str] = Field("high", description="Target quality budget")
    target_polycount: Optional[int] = Field(None, description="Target triangle budget")
    model_preference: Optional[str] = Field(
        None, description="Explicit model override; intent presets choose a model when omitted"
    )
    intent: Optional[str] = Field(None, description="Deterministic smart-generation intent")
    preprocessing_artifact_id: Optional[str] = Field(None, description="Approved preprocessing artifact ID")
    preprocessing_review_override: bool = Field(False, description="Explicitly allow a flagged preprocessing preview after review")
    enhancement_enabled: bool = Field(False, description="Use the approved preprocessing artifact")
    enable_printability_check: bool = Field(False, description="Run final printability QA")
    enable_auto_repair: bool = Field(False, description="Allow the shared repair stage to mutate the mesh for printability")
    enable_auto_rig: bool = Field(False, description="Run UniRig after production processing")
    auto_rig_mode: str = Field("full", description="UniRig mode: full, skeleton, or skin")
    model_parameters: Optional[dict] = Field(
        None,
        description="Model-specific parameters (query /system/models/{model_id}/parameters for schema)"
    )
    physics_enabled: bool = Field(False, description="Request physics-ready post-processing for this generated asset")
    physics_config: Optional[dict] = Field(None, description="Provider-neutral physics controller values")
    topology_mode: Optional[str] = Field("triangle", description="Topology mode: 'triangle' or 'quad'")
    quad_topology: bool = Field(False, description="Request quad-dominant topology")
    enable_postprocess: bool = Field(True, description="Run production postprocessing pipeline after mesh generation. If False, postprocessing is bypassed.")
    candidate_count: int = Field(1, ge=1, le=4, description="Candidate variations to generate (1-4, default 1)")
    asset_name: Optional[str] = Field(None, description="Asset base stem name")
    image_name: Optional[str] = Field(None, description="Original image filename")

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
    output_format: str = Field("glb", description="Output mesh format")
    quality_mode: Optional[str] = Field("high", description="Target quality budget")
    target_polycount: Optional[int] = Field(None, description="Target triangle budget")
    model_preference: Optional[str] = Field(
        None, description="Explicit model override; intent presets choose a model when omitted"
    )
    intent: Optional[str] = Field(None, description="Deterministic smart-generation intent")
    preprocessing_artifact_id: Optional[str] = Field(None, description="Approved preprocessing artifact ID")
    preprocessing_review_override: bool = Field(False, description="Explicitly allow a flagged preprocessing preview after review")
    enhancement_enabled: bool = Field(False, description="Use the approved preprocessing artifact")
    enable_printability_check: bool = Field(False, description="Run final printability QA")
    enable_auto_repair: bool = Field(False, description="Allow the shared repair stage to mutate the mesh for printability")
    enable_auto_rig: bool = Field(False, description="Run UniRig after production processing")
    auto_rig_mode: str = Field("full", description="UniRig mode: full, skeleton, or skin")
    model_parameters: Optional[dict] = Field(
        None,
        description="Model-specific parameters (query /system/models/{model_id}/parameters for schema)"
    )
    physics_enabled: bool = Field(False, description="Request physics-ready post-processing for this generated asset")
    physics_config: Optional[dict] = Field(None, description="Provider-neutral physics controller values")
    topology_mode: Optional[str] = Field("triangle", description="Topology mode: 'triangle' or 'quad'")
    quad_topology: bool = Field(False, description="Request quad-dominant topology")
    enable_postprocess: bool = Field(True, description="Run production postprocessing pipeline after mesh generation. If False, postprocessing is bypassed.")
    candidate_count: int = Field(1, ge=1, le=4, description="Candidate variations to generate (1-4, default 1)")
    asset_name: Optional[str] = Field(None, description="Asset base stem name")
    image_name: Optional[str] = Field(None, description="Original image filename")

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

    @field_validator("image_file_id")
    @classmethod
    def validate_inputs(cls, v, info):
        image_path = info.data.get("image_path")
        image_base64 = info.data.get("image_base64")

        inputs_provided = sum(bool(x) for x in [image_path, image_base64, v])

        if inputs_provided == 0:
            raise ValueError(
                "One of image_path, image_base64, or image_file_id must be provided"
            )
        if inputs_provided > 1:
            raise ValueError(
                "Only one of image_path, image_base64, or image_file_id should be provided"
            )
        return v

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
    model_parameters: Optional[dict] = Field(
        None,
        description="Model-specific parameters (query /system/models/{model_id}/parameters for schema)"
    )
    physics_enabled: bool = Field(False, description="Request physics-ready post-processing for this generated asset")
    physics_config: Optional[dict] = Field(None, description="Provider-neutral physics controller values")
    topology_mode: Optional[str] = Field("triangle", description="Topology mode: 'triangle' or 'quad'")
    quad_topology: bool = Field(False, description="Request quad-dominant topology")
    enable_postprocess: bool = Field(True, description="Run production postprocessing pipeline after mesh generation. If False, postprocessing is bypassed.")

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

    @field_validator("mesh_file_id")
    @classmethod
    def validate_inputs(cls, v, info):
        image_path = info.data.get("image_path")
        image_base64 = info.data.get("image_base64")
        image_file_id = info.data.get("image_file_id")
        mesh_path = info.data.get("mesh_path")
        mesh_base64 = info.data.get("mesh_base64")

        image_inputs_provided = sum(
            bool(x) for x in [image_path, image_base64, image_file_id]
        )
        mesh_inputs_provided = sum(bool(x) for x in [mesh_path, mesh_base64, v])

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
        return v

    model_config = ConfigDict(protected_namespaces=("settings_",))



# Enhanced Response models
class MeshGenerationResponse(BaseModel):
    """Versioned response contract for mesh generation requests."""

    api_version: str = Field("1", description="Generation API contract version")
    job_id: str = Field(..., description="Unique job identifier")
    status: str = Field(..., description="Job status")
    message: str = Field(..., description="Status message")


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
    current_user = Depends(get_current_user_or_none),
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
        user_id = getattr(current_user, "user_id", None)
        
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

        job_request = JobRequest(
            feature="text_mesh_painting",
            inputs={
                "text_prompt": mesh_request.text_prompt,
                "mesh_path": mesh_file_path,
                "output_format": mesh_request.output_format,
                "texture_resolution": mesh_request.texture_resolution,
                "enable_postprocess": getattr(mesh_request, "enable_postprocess", True),
                **_clean_paint_parameters(mesh_request.model_parameters),
            },
            model_preference=mesh_request.model_preference,
            priority=1,
            metadata={
                "postprocess_mode": "production_mesh" if getattr(mesh_request, "enable_postprocess", True) else "none",
                "enable_postprocess": getattr(mesh_request, "enable_postprocess", True),
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
    model_id = request.model_preference or default_model
    feature = default_feature
    preset = {}
    preset_metadata = {}

    if request.intent:
        settings = await get_current_settings()
        resolved = resolve_intent(
            request.intent,
            settings,
            explicit_model=request.model_preference,
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
    current_user = Depends(get_current_user_or_none),
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
        user_id = getattr(current_user, "user_id", None)
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
            enhanced = preprocess_image(
                str(image_file_path),
                profile=preprocessing_profile,
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
        # Intent presets take precedence over frontend default autoOptimizeSettings (e.g. generateLOD: true, lodPreset: 'high', lodCount: 4)
        if "generate_lod" in preset:
            lod_enabled = bool(preset["generate_lod"])
            params.pop("generateLOD", None)
        else:
            lod_enabled = bool(params.pop("generateLOD", True))

        if "lod_preset" in preset:
            lod_preset = str(preset["lod_preset"])
            params.pop("lodPreset", None)
        else:
            lod_preset = str(params.pop("lodPreset", "high"))

        if "lod_count" in preset:
            lod_count = int(preset["lod_count"])
            params.pop("lodCount", None)
        else:
            lod_count = int(params.pop("lodCount", 4))

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

        enable_printability = bool(
            params.pop(
                "enable_printability_check",
                mesh_request.enable_printability_check or preset.get("enable_printability_check", False),
            )
        )
        enable_auto_repair = bool(
            params.pop(
                "enable_auto_repair",
                mesh_request.enable_auto_repair or preset.get("enable_auto_repair", False),
            )
        )
        enable_auto_rig = bool(
            params.pop(
                "enable_auto_rig",
                mesh_request.enable_auto_rig or preset.get("enable_auto_rig", False),
            )
        )

        if not mesh_request.enable_postprocess:
            texture_enabled = False
            lod_enabled = False
            enable_printability = False
            enable_auto_repair = False
            enable_auto_rig = False
            target_polycount = 0

        job_request = JobRequest(
            feature=feature,
            inputs={
                "asset_name": chosen_stem,
                "image_name": chosen_stem,
                "image_path": image_file_path,
                "reference_image_path": original_image_path,
                "output_format": mesh_request.output_format,
                "texture_resolution": mesh_request.texture_resolution,
                "bake_normal_maps": mesh_request.bake_normal_maps,
                "texture_enabled": texture_enabled,
                "intent": mesh_request.intent,
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
                "physics_enabled": mesh_request.physics_enabled or preset.get("collision", False),
                "physics_config": mesh_request.physics_config,
                "enable_printability_check": enable_printability,
                "enable_auto_repair": enable_auto_repair,
                "enable_auto_rig": enable_auto_rig,
                "auto_rig_mode": mesh_request.auto_rig_mode,
                "topology_mode": mesh_request.topology_mode or ("quad" if mesh_request.quad_topology else "triangle"),
                "quad_topology": bool(mesh_request.quad_topology or mesh_request.topology_mode == "quad"),
                "enable_postprocess": mesh_request.enable_postprocess,
                "candidate_count": int(mesh_request.candidate_count or 1),
                **params,
            },
            model_preference=model_id,
            priority=1,
            metadata={
                "asset_name": chosen_stem,
                "image_name": chosen_stem,
                "candidate_count": int(mesh_request.candidate_count or 1),
                "postprocess_mode": "production_mesh" if mesh_request.enable_postprocess else "none",
                "enable_postprocess": mesh_request.enable_postprocess,
                "feature_type": feature,
                "texture_resolution": mesh_request.texture_resolution,
                "bake_normal_maps": mesh_request.bake_normal_maps,
                "texture_enabled": texture_enabled,
                "reference_image_path": original_image_path,
                "physics_enabled": mesh_request.physics_enabled or preset.get("collision", False),
                "physics_config": mesh_request.physics_config,
                "intent": mesh_request.intent,
                **preset_metadata,
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
    except Exception as e:
        for td in tracked_temp_dirs:
            shutil.rmtree(td, ignore_errors=True)
        logger.error(f"Error scheduling image-to-raw-mesh job: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to schedule job: {e}")

@router.post("/image-to-textured-mesh", response_model=MeshGenerationResponse)
async def image_to_textured_mesh(
    mesh_request: ImageToTexturedMeshRequest,
    scheduler: MultiprocessModelScheduler = Depends(get_scheduler),
    current_user = Depends(get_current_user_or_none),
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
        user_id = getattr(current_user, "user_id", None)
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
            enhanced = preprocess_image(
                str(image_file_path),
                profile=preprocessing_profile,
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
        # Intent presets take precedence over frontend default autoOptimizeSettings (e.g. generateLOD: true, lodPreset: 'high', lodCount: 4)
        if "generate_lod" in preset:
            lod_enabled = bool(preset["generate_lod"])
            params.pop("generateLOD", None)
        else:
            lod_enabled = bool(params.pop("generateLOD", True))

        if "lod_preset" in preset:
            lod_preset = str(preset["lod_preset"])
            params.pop("lodPreset", None)
        else:
            lod_preset = str(params.pop("lodPreset", "high"))

        if "lod_count" in preset:
            lod_count = int(preset["lod_count"])
            params.pop("lodCount", None)
        else:
            lod_count = int(params.pop("lodCount", 4))

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
            mesh_request.texture_resolution
            or source_texture_resolution
            or preset.get("texture_resolution")
            or 2048
        )
        enable_printability = bool(
            params.pop(
                "enable_printability_check",
                mesh_request.enable_printability_check or preset.get("enable_printability_check", False),
            )
        )
        enable_auto_repair = bool(
            params.pop(
                "enable_auto_repair",
                mesh_request.enable_auto_repair or preset.get("enable_auto_repair", False),
            )
        )
        enable_auto_rig = bool(
            params.pop(
                "enable_auto_rig",
                mesh_request.enable_auto_rig or preset.get("enable_auto_rig", False),
            )
        )

        if not mesh_request.enable_postprocess:
            texture_enabled = False
            lod_enabled = False
            enable_printability = False
            enable_auto_repair = False
            enable_auto_rig = False
            target_polycount = 0

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
                "physics_enabled": mesh_request.physics_enabled or preset.get("collision", False),
                "physics_config": mesh_request.physics_config,
                "enable_printability_check": enable_printability,
                "enable_auto_repair": enable_auto_repair,
                "enable_auto_rig": enable_auto_rig,
                "auto_rig_mode": mesh_request.auto_rig_mode,
                "topology_mode": mesh_request.topology_mode or ("quad" if mesh_request.quad_topology else "triangle"),
                "quad_topology": bool(mesh_request.quad_topology or mesh_request.topology_mode == "quad"),
                "enable_postprocess": mesh_request.enable_postprocess,
                "candidate_count": int(mesh_request.candidate_count or 1),
                **params,
            },
            model_preference=model_id,
            priority=1,
            metadata={
                "asset_name": chosen_stem,
                "image_name": chosen_stem,
                "candidate_count": int(mesh_request.candidate_count or 1),
                "postprocess_mode": "production_mesh" if mesh_request.enable_postprocess else "none",
                "enable_postprocess": mesh_request.enable_postprocess,
                "feature_type": feature,
                "texture_resolution": texture_resolution,
                "bake_normal_maps": mesh_request.bake_normal_maps,
                "texture_enabled": texture_enabled,
                "reference_image_path": original_image_path,
                "physics_enabled": mesh_request.physics_enabled or preset.get("collision", False),
                "physics_config": mesh_request.physics_config,
                "intent": mesh_request.intent,
                **preset_metadata,
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
    except Exception as e:
        for td in tracked_temp_dirs:
            shutil.rmtree(td, ignore_errors=True)
        logger.error(f"Error scheduling image-to-textured-mesh job: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to schedule job: {e}")

@router.post("/image-mesh-painting", response_model=MeshGenerationResponse)
async def image_mesh_painting(
    mesh_request: ImageMeshPaintingRequest,
    scheduler: MultiprocessModelScheduler = Depends(get_scheduler),
    current_user = Depends(get_current_user_or_none),
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
        user_id = getattr(current_user, "user_id", None)
        
        # Validate model preference
        validate_model_preference(
            mesh_request.model_preference, "image_mesh_painting", scheduler
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

        job_request = JobRequest(
            feature="image_mesh_painting",
            inputs={
                "image_path": image_file_path,
                "reference_image_path": image_file_path,
                "mesh_path": mesh_file_path,
                "output_format": mesh_request.output_format,
                "texture_resolution": mesh_request.texture_resolution,
                "resolution": (
                    (mesh_request.model_parameters or {}).get("resolution")
                    or (
                        768 if "paint_v21" in mesh_request.model_preference
                        and mesh_request.texture_resolution >= 8192
                        else 512 if "paint_v21" in mesh_request.model_preference
                        else mesh_request.texture_resolution
                    )
                ),
                "enable_postprocess": getattr(mesh_request, "enable_postprocess", True),
                **_clean_paint_parameters(mesh_request.model_parameters),
            },
            model_preference=mesh_request.model_preference,
            priority=1,
            metadata={
                "postprocess_mode": "production_mesh" if getattr(mesh_request, "enable_postprocess", True) else "none",
                "enable_postprocess": getattr(mesh_request, "enable_postprocess", True),
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
    current_user = Depends(get_current_user_or_none),
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
        current_user=current_user,
        file_store=file_store,
    )


@router.post("/generate-mesh-from-image/batch", response_model=BatchMeshGenerationResponse)
@router.post("/batch/generate-mesh-from-image", response_model=BatchMeshGenerationResponse)
@router.post("/batch-generate-mesh-from-image", response_model=BatchMeshGenerationResponse)
async def generate_mesh_from_image_batch(
    batch_request: BatchImageToMeshRequest,
    scheduler: MultiprocessModelScheduler = Depends(get_scheduler),
    current_user = Depends(get_current_user_or_none),
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
            current_user=current_user,
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
    current_user = Depends(get_current_user_or_none),
):
    """Cancel a queued mesh-generation job without deleting its history record."""
    try:
        job_status = await scheduler.get_job_status(job_id)
        if job_status is None:
            raise HTTPException(status_code=404, detail="Job not found")

        if current_user:
            from core.auth.models import UserRole
            job_user_id = job_status.get("user_id")
            if current_user.role != UserRole.ADMIN and job_user_id != current_user.user_id:
                raise HTTPException(status_code=403, detail="Access denied to this job")

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