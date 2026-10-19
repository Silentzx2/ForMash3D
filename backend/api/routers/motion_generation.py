"""
Motion Generation API endpoints (ARDY and future motion models).

Provides endpoints for text-to-motion generation and interactive animation synthesis.
"""

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from api.dependencies import get_current_user_or_none, get_scheduler
from core.scheduler.job_queue import JobRequest
from core.scheduler.multiprocess_scheduler import MultiprocessModelScheduler

logger = logging.getLogger(__name__)

LEGACY_MODEL_PREFERENCES = {
    "ardy-core": "ardy_motion_generation",
    "ardy-g1": "ardy_motion_generation",
}

router = APIRouter(prefix="/motion-generation", tags=["motion_generation"])


class MotionGenerationRequest(BaseModel):
    """Request for motion generation"""

    prompt: str = Field(..., description="Text description of the desired motion")
    duration: float = Field(5.0, description="Duration in seconds", ge=0.5, le=30.0)
    seed: Optional[int] = Field(None, description="Random seed for reproducibility")
    checkpoint: Optional[str] = Field(
        "ARDY-Core-RP-20FPS-Horizon40",
        description="ARDY model checkpoint variant (e.g. core40, core8, g1_52, g1_8)",
    )
    post_process: bool = Field(True, description="Apply motion post-processing/foot skating cleanup")
    target_skeleton: Optional[str] = Field("core", description="Target skeleton ('core' or 'g1')")
    target_bones: Optional[List[str]] = Field(
        None, description="Optional target armature bone names for compatibility check"
    )
    constraints: Optional[Any] = Field(None, description="Kinematic or waypoint constraints")
    model_preference: str = Field(
        "ardy_motion_generation", description="Name of the motion generation model to use"
    )
    model_parameters: Optional[Dict[str, Any]] = Field(
        None, description="Model-specific parameters"
    )

    model_config = ConfigDict(protected_namespaces=("settings_",))


class MotionGenerationResponse(BaseModel):
    """Response for motion generation request"""

    job_id: str = Field(..., description="Unique job identifier")
    status: str = Field(..., description="Job status")
    message: str = Field(..., description="Status message")


@router.post("/generate-motion", response_model=MotionGenerationResponse)
async def generate_motion(
    request: MotionGenerationRequest,
    scheduler: MultiprocessModelScheduler = Depends(get_scheduler),
    current_user=Depends(get_current_user_or_none),
):
    """
    Generate character animation / motion from a text prompt using ARDY.
    """
    user_id = current_user.user_id if current_user else None

    # Old clients used skeleton labels as model IDs; ARDY variants are checkpoints
    # of one registered model, not separately registered scheduler models.
    feature = "motion_generation"
    model_preference = LEGACY_MODEL_PREFERENCES.get(request.model_preference, request.model_preference)
    if not scheduler.validate_model_preference(model_preference, feature):
        available_models = scheduler.get_available_models(feature)
        feature_models = available_models.get(feature, [])
        if not feature_models:
            raise HTTPException(
                status_code=400,
                detail=f"No models available for feature '{feature}'. Please ensure ARDY is enabled in models.yaml.",
            )
        raise HTTPException(
            status_code=400,
            detail=f"Model '{model_preference}' is not available for feature '{feature}'. "
            f"Available models: {feature_models}",
        )

    try:
        job_inputs = {
            "prompt": request.prompt.strip(),
            "duration": float(request.duration),
            "seed": request.seed,
            "checkpoint": request.checkpoint,
            "post_process": request.post_process,
            "target_skeleton": request.target_skeleton,
            "target_bones": request.target_bones,
            "constraints": request.constraints,
            **(request.model_parameters or {}),
        }

        job_request = JobRequest(
            feature=feature,
            inputs=job_inputs,
            model_preference=model_preference,
            priority=1,
            metadata={"feature_type": feature, "prompt": request.prompt},
            user_id=user_id,
        )

        job_id = await scheduler.schedule_job(job_request)

        return MotionGenerationResponse(
            job_id=job_id,
            status="queued",
            message="Motion generation job queued successfully",
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error scheduling motion generation job: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to schedule job: {e}")


@router.get("/checkpoints")
async def get_checkpoints():
    """Get available ARDY checkpoint variants."""
    return {
        "checkpoints": [
            "ARDY-Core-RP-20FPS-Horizon40",
            "ARDY-Core-RP-20FPS-Horizon8",
            "ARDY-G1-RP-25FPS-Horizon52",
            "ARDY-G1-RP-25FPS-Horizon8",
            "ardy_lite",
            "ardy_full",
        ],
        "default": "ARDY-Core-RP-20FPS-Horizon40",
        "checkpoint_details": [
            {
                "id": "ARDY-Core-RP-20FPS-Horizon40",
                "nickname": "core40",
                "skeleton": "core",
                "fps": 20,
                "horizon": 40,
                "description": "Core human skeleton, 20 FPS, 40-step horizon (recommended for standard characters)",
            },
            {
                "id": "ARDY-Core-RP-20FPS-Horizon8",
                "nickname": "core8",
                "skeleton": "core",
                "fps": 20,
                "horizon": 8,
                "description": "Core human skeleton, 20 FPS, 8-step horizon (faster reactive transitions)",
            },
            {
                "id": "ARDY-G1-RP-25FPS-Horizon52",
                "nickname": "g1_52",
                "skeleton": "g1",
                "fps": 25,
                "horizon": 52,
                "description": "Unitree G1 humanoid skeleton, 25 FPS, 52-step horizon",
            },
            {
                "id": "ARDY-G1-RP-25FPS-Horizon8",
                "nickname": "g1_8",
                "skeleton": "g1",
                "fps": 25,
                "horizon": 8,
                "description": "Unitree G1 humanoid skeleton, 25 FPS, 8-step horizon",
            },
            {
                "id": "ardy_lite",
                "nickname": "ardy_lite",
                "skeleton": "core",
                "fps": 20,
                "horizon": 8,
                "description": "ARDY Lite (Fast inference, ~6GB VRAM)",
            },
            {
                "id": "ardy_full",
                "nickname": "ardy_full",
                "skeleton": "core",
                "fps": 20,
                "horizon": 40,
                "description": "ARDY Full (High fidelity, ~8GB VRAM)",
            },
        ],
    }


@router.get("/available-models")
async def get_available_models(
    scheduler: MultiprocessModelScheduler = Depends(get_scheduler),
):
    """Get available motion generation models."""
    try:
        available_models = scheduler.get_available_models("motion_generation")
        models_info = available_models.get("motion_generation", [])
        return {
            "available_models": models_info,
            "models": [
                {
                    "id": m,
                    "name": "ARDY Motion Generation",
                    "description": "NVIDIA ARDY Autoregressive Motion Generation",
                    "supported_formats": ["json", "npz", "bvh"],
                }
                for m in models_info
            ],
            "models_details": {
                m: {"description": "NVIDIA ARDY Autoregressive Motion Generation"}
                for m in models_info
            },
        }
    except Exception as e:
        logger.error(f"Error getting available motion models: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/supported-formats")
async def get_supported_formats():
    """Get supported input and output formats."""
    return {
        "input_formats": {
            "text": ["prompt", "text"],
        },
        "output_formats": {
            "mesh": ["json", "npz", "bvh"],
        },
        "artifact_type": "motion",
    }
