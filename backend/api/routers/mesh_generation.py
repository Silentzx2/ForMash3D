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
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile
from pydantic import BaseModel, ConfigDict, Field, field_validator

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
        1024, description="Texture resolution", ge=256, le=4096
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
    output_format: str = Field("glb", description="Output mesh format")
    quality_mode: Optional[str] = Field("high", description="Target quality budget")
    target_polycount: Optional[int] = Field(None, description="Target triangle budget")
    model_preference: Optional[str] = Field(
        None, description="Explicit model override; intent presets choose a model when omitted"
    )
    intent: Optional[str] = Field(None, description="Deterministic smart-generation intent")
    preprocessing_artifact_id: Optional[str] = Field(None, description="Approved preprocessing artifact ID")
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
    asset_name: Optional[str] = Field(None, description="Asset base stem name")
    image_name: Optional[str] = Field(None, description="Original image filename")

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
    texture_resolution: int = Field(
        1024, description="Texture resolution", ge=256, le=4096
    )
    output_format: str = Field("glb", description="Output mesh format")
    quality_mode: Optional[str] = Field("high", description="Target quality budget")
    target_polycount: Optional[int] = Field(None, description="Target triangle budget")
    model_preference: Optional[str] = Field(
        None, description="Explicit model override; intent presets choose a model when omitted"
    )
    intent: Optional[str] = Field(None, description="Deterministic smart-generation intent")
    preprocessing_artifact_id: Optional[str] = Field(None, description="Approved preprocessing artifact ID")
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
    asset_name: Optional[str] = Field(None, description="Asset base stem name")
    image_name: Optional[str] = Field(None, description="Original image filename")

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
        1024, description="Texture resolution", ge=256, le=4096
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


# Helper function to process file inputs
async def process_file_input(
    file_path: Optional[str] = None,
    base64_data: Optional[str] = None,
    file_id: Optional[str] = None,
    upload_file: Optional[UploadFile] = None,
    input_type: str = "image",
    file_store: Optional[FileStore] = None,
) -> str:
    """Process various file input formats and return the processed file path"""

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
            # Process base64 data
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
            # Process uploaded file
            file_info = await save_upload_file(upload_file, temp_dir)
            return str(file_info["file_path"])
        else:
            raise HTTPException(status_code=400, detail="No input provided")
    except HTTPException as he:
        if temp_dir:
            await asyncio.to_thread(shutil.rmtree, temp_dir, True)
        import traceback
        trace = traceback.format_exc()
        logger.error(f"Error processing {input_type} input: {str(he)} {trace}")
        raise he
    except Exception as e:
        if temp_dir:
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
    try:
        user_id = current_user.user_id if current_user else None
        
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
        )

        job_request = JobRequest(
            feature="text_mesh_painting",
            inputs={
                "text_prompt": mesh_request.text_prompt,
                "mesh_path": mesh_file_path,
                "output_format": mesh_request.output_format,
                "texture_resolution": mesh_request.texture_resolution,
                **{k: v for k, v in (mesh_request.model_parameters or {}).items() if v is not None},
            },
            model_preference=mesh_request.model_preference,
            priority=1,
            metadata={"postprocess_mode": "production_mesh", "feature_type": "text_mesh_painting", "physics_enabled": mesh_request.physics_enabled, "physics_config": mesh_request.physics_config},
            user_id=user_id,
        )

        job_id = await scheduler.schedule_job(job_request)

        return MeshGenerationResponse(
            job_id=job_id,
            status="queued",
            message="Text-based mesh painting job queued successfully",
        )

    except HTTPException:
        # Re-raise HTTP exceptions (including validation errors)
        raise
    except Exception as e:
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
    try:
        user_id = current_user.user_id if current_user else None
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

        image_file_path = await process_file_input(
            file_path=mesh_request.image_path,
            base64_data=mesh_request.image_base64,
            file_id=mesh_request.image_file_id,
            input_type="image",
            file_store=file_store,
        )

        preprocessing_metadata = {}
        if mesh_request.preprocessing_artifact_id:
            image_file_path, preprocessing_metadata = load_preprocessed_artifact(
                mesh_request.preprocessing_artifact_id,
                "approved",
            )
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
        target_polycount = params.pop("target_polycount", preset.get("target_polycount"))
        lod_enabled = params.pop("generateLOD", preset.get("generate_lod", True))
        lod_preset = params.pop("lodPreset", preset.get("lod_preset", "high"))
        lod_count = params.pop("lodCount", preset.get("lod_count", 4))
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

        job_request = JobRequest(
            feature=feature,
            inputs={
                "asset_name": chosen_stem,
                "image_name": chosen_stem,
                "image_path": image_file_path,
                "output_format": mesh_request.output_format,
                "intent": mesh_request.intent,
                "preprocessing_artifact_id": mesh_request.preprocessing_artifact_id,
                "enhancement_enabled": mesh_request.enhancement_enabled,
                "preprocessing_metadata": preprocessing_metadata,
                "target_polycount": target_polycount,
                "generateLOD": lod_enabled,
                "lodPreset": lod_preset,
                "lodCount": lod_count,
                "physics_enabled": mesh_request.physics_enabled or preset.get("collision", False),
                "physics_config": mesh_request.physics_config,
                "enable_printability_check": enable_printability,
                "enable_auto_repair": enable_auto_repair,
                "enable_auto_rig": enable_auto_rig,
                "auto_rig_mode": mesh_request.auto_rig_mode,
                "topology_mode": mesh_request.topology_mode or ("quad" if mesh_request.quad_topology else "triangle"),
                "quad_topology": bool(mesh_request.quad_topology or mesh_request.topology_mode == "quad"),
                **params,
            },
            model_preference=model_id,
            priority=1,
            metadata={
                "asset_name": chosen_stem,
                "image_name": chosen_stem,
                "postprocess_mode": "production_mesh",
                "feature_type": feature,
                "physics_enabled": mesh_request.physics_enabled or preset.get("collision", False),
                "physics_config": mesh_request.physics_config,
                "intent": mesh_request.intent,
                **preset_metadata,
                "preprocessing": preprocessing_metadata,
                "enhancement_enabled": mesh_request.enhancement_enabled,
                "enable_printability_check": enable_printability,
                "enable_auto_repair": enable_auto_repair,
                "enable_auto_rig": enable_auto_rig,
                "auto_rig_mode": mesh_request.auto_rig_mode,
                "topology_mode": mesh_request.topology_mode or ("quad" if mesh_request.quad_topology else "triangle"),
                "quad_topology": bool(mesh_request.quad_topology or mesh_request.topology_mode == "quad"),
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
        raise
    except Exception as e:
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
    try:
        user_id = current_user.user_id if current_user else None
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

        image_file_path = await process_file_input(
            file_path=mesh_request.image_path,
            base64_data=mesh_request.image_base64,
            file_id=mesh_request.image_file_id,
            input_type="image",
            file_store=file_store,
        )
        preprocessing_metadata = {}
        if mesh_request.preprocessing_artifact_id:
            image_file_path, preprocessing_metadata = load_preprocessed_artifact(
                mesh_request.preprocessing_artifact_id,
                "approved",
            )
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
            )

        chosen_stem = await resolve_asset_name(
            mesh_request,
            file_store,
            image_file_path,
            mesh_request.image_file_id,
        )
        # Filter out None values from model_parameters so pop() fallbacks work correctly
        params = {k: v for k, v in (mesh_request.model_parameters or {}).items() if v is not None}
        target_polycount = params.pop("target_polycount", preset.get("target_polycount"))
        lod_enabled = params.pop("generateLOD", preset.get("generate_lod", True))
        lod_preset = params.pop("lodPreset", preset.get("lod_preset", "high"))
        lod_count = params.pop("lodCount", preset.get("lod_count", 4))
        source_texture_resolution = params.pop("texture_resolution", None)
        texture_resolution = int(
            mesh_request.texture_resolution
            or preset.get("texture_resolution", 1024)
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

        job_request = JobRequest(
            feature=feature,
            inputs={
                "asset_name": chosen_stem,
                "image_name": chosen_stem,
                "image_path": image_file_path,
                "texture_image_path": texture_image_path,
                "output_format": mesh_request.output_format,
                "texture_resolution": int(source_texture_resolution or 2048),
                "production_texture_resolution": texture_resolution,
                "intent": mesh_request.intent,
                "preprocessing_artifact_id": mesh_request.preprocessing_artifact_id,
                "enhancement_enabled": mesh_request.enhancement_enabled,
                "preprocessing_metadata": preprocessing_metadata,
                "target_polycount": target_polycount,
                "generateLOD": lod_enabled,
                "lodPreset": lod_preset,
                "lodCount": lod_count,
                "physics_enabled": mesh_request.physics_enabled or preset.get("collision", False),
                "physics_config": mesh_request.physics_config,
                "enable_printability_check": enable_printability,
                "enable_auto_repair": enable_auto_repair,
                "enable_auto_rig": enable_auto_rig,
                "auto_rig_mode": mesh_request.auto_rig_mode,
                "topology_mode": mesh_request.topology_mode or ("quad" if mesh_request.quad_topology else "triangle"),
                "quad_topology": bool(mesh_request.quad_topology or mesh_request.topology_mode == "quad"),
                **params,
            },
            model_preference=model_id,
            priority=1,
            metadata={
                "asset_name": chosen_stem,
                "image_name": chosen_stem,
                "postprocess_mode": "production_mesh",
                "feature_type": feature,
                "physics_enabled": mesh_request.physics_enabled or preset.get("collision", False),
                "physics_config": mesh_request.physics_config,
                "intent": mesh_request.intent,
                **preset_metadata,
                "preprocessing": preprocessing_metadata,
                "enhancement_enabled": mesh_request.enhancement_enabled,
                "enable_printability_check": enable_printability,
                "enable_auto_repair": enable_auto_repair,
                "enable_auto_rig": enable_auto_rig,
                "auto_rig_mode": mesh_request.auto_rig_mode,
                "topology_mode": mesh_request.topology_mode or ("quad" if mesh_request.quad_topology else "triangle"),
                "quad_topology": bool(mesh_request.quad_topology or mesh_request.topology_mode == "quad"),
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
        raise
    except Exception as e:
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
    try:
        user_id = current_user.user_id if current_user else None
        
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
        )

        # Process mesh input
        mesh_file_path = await process_file_input(
            file_path=mesh_request.mesh_path,
            base64_data=mesh_request.mesh_base64,
            file_id=mesh_request.mesh_file_id,
            input_type="mesh",
            file_store=file_store,
        )

        job_request = JobRequest(
            feature="image_mesh_painting",
            inputs={
                "image_path": image_file_path,
                "mesh_path": mesh_file_path,
                "output_format": mesh_request.output_format,
                "texture_resolution": mesh_request.texture_resolution,
                "resolution": mesh_request.texture_resolution,
                **{k: v for k, v in (mesh_request.model_parameters or {}).items() if v is not None},
            },
            model_preference=mesh_request.model_preference,
            priority=1,
            metadata={"postprocess_mode": "production_mesh", "feature_type": "image_mesh_painting", "physics_enabled": mesh_request.physics_enabled, "physics_config": mesh_request.physics_config},
            user_id=user_id,
        )

        job_id = await scheduler.schedule_job(job_request)

        return MeshGenerationResponse(
            job_id=job_id,
            status="queued",
            message="Image-based mesh painting job queued successfully",
        )

    except HTTPException:
        # Re-raise HTTP exceptions (including validation errors)
        raise
    except Exception as e:
        logger.error(f"Error scheduling image-mesh-painting job: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to schedule job: {str(e)}")



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

        if job_status.get("status") not in {"queued", "processing", "running"}:
            return {
                "job_id": job_id,
                "status": job_status.get("status"),
                "cancelled": False,
                "message": "Job is no longer cancellable",
            }

        cancelled = await scheduler.cancel_job(job_id)
        if not cancelled:
            await scheduler.job_queue.cancel_job(job_id, force=True)

        return {
            "job_id": job_id,
            "status": "cancelled",
            "cancelled": True,
            "message": "Generation job cancelled",
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error cancelling mesh generation job {job_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to cancel job: {e}")