"""
Multi-View generation and management API router for ForMash3D.

Provides endpoints for:
- Zero123++ v1.2 multi-view image generation
- Manual multi-view image set upload
- Multi-view asset manifest and view retrieval
- On-demand ZIP export of view collections
- Capability-gated Multi-View -> 3D reconstruction requests
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import random
import re
import tempfile
import time
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request, UploadFile, File
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator

from core.config import get_settings
from core.scheduler.multiprocess_scheduler import JobRequest, MultiprocessModelScheduler
from core.utils.file_utils import get_storage_base_dir, resolve_server_file_path, save_base64_file
from adapters.zero123plus_adapter import Zero123PlusAdapter, CAMERA_RIG, compute_source_sha256
from .file_upload import resolve_file_id_async

from ..dependencies import (
    get_current_user_or_none,
    get_file_store,
    get_scheduler,
    get_current_settings,
    verify_api_key,
)

logger = logging.getLogger(__name__)

router = APIRouter()


class MultiViewGenerateRequest(BaseModel):
    """Request schema for Zero123++ multi-view generation."""

    image_path: Optional[str] = Field(None, description="Path to reference image")
    image_base64: Optional[str] = Field(None, description="Base64 encoded reference image")
    image_file_id: Optional[str] = Field(None, description="Uploaded file ID")
    asset_name: Optional[str] = Field(None, description="User-specified asset stem name")
    inference_steps: int = Field(28, ge=15, le=100, description="Number of diffusion inference steps")
    guidance_scale: float = Field(4.0, ge=1.0, le=10.0, description="Classifier-free guidance scale")
    seed: Optional[int] = Field(None, description="Random seed (None for automatic)")
    background_removal: bool = Field(False, description="Remove background before multi-view generation")
    generate_masks: bool = Field(False, description="Generate alpha masks for each novel view")
    generate_normals: bool = Field(False, description="Generate View-Space Normals via ControlNet")
    save_contact_sheet: bool = Field(True, description="Save 3x2 composite contact sheet image")
    output_format: str = Field("png", description="Output format ('png' views or 'zip' archive)")
    model_preference: str = Field(
        "zero123plus_v12_image_to_multiview",
        description="Zero123++ model preference ID",
    )

    model_config = ConfigDict(protected_namespaces=("settings_",))

    @field_validator("image_file_id")
    @classmethod
    def validate_inputs(cls, v, info):
        image_path = info.data.get("image_path")
        image_base64 = info.data.get("image_base64")
        inputs_provided = sum(bool(x) for x in [image_path, image_base64, v])
        if inputs_provided == 0:
            raise ValueError("One of image_path, image_base64, or image_file_id must be provided")
        if inputs_provided > 1:
            raise ValueError("Only one of image_path, image_base64, or image_file_id should be provided")
        return v


class MultiViewGenerateResponse(BaseModel):
    """Response contract for multi-view generation requests."""

    api_version: str = Field("1", description="API contract version")
    job_id: str = Field(..., description="Unique generation job ID")
    status: str = Field(..., description="Job status")
    message: str = Field(..., description="Status message")
    asset_name: Optional[str] = Field(None, description="Safe asset stem name")


class ViewUploadItem(BaseModel):
    file_id: Optional[str] = None
    image_base64: Optional[str] = None
    view_label: str = Field("Unassigned", description="Camera label, e.g. Front, Right, Back, Left, Unassigned")
    azimuth_deg: Optional[float] = None
    elevation_deg: Optional[float] = None


class MultiViewManualUploadRequest(BaseModel):
    asset_name: Optional[str] = Field("manual_multiview", description="Asset stem name")
    views: List[ViewUploadItem] = Field(..., description="List of view uploads")


class MultiViewReconstruct3DRequest(BaseModel):
    """Request contract for Multi-View -> 3D reconstruction."""

    asset_id: Optional[str] = Field(None, description="Existing Multi-View asset ID")
    images: Optional[List[Dict[str, Any]]] = Field(None, description="Explicit view images with file_id and view")
    model_preference: str = Field(..., description="Target 3D reconstruction model ID")
    output_format: str = Field("glb", description="Desired mesh output format")
    topology_mode: Optional[str] = Field("triangle", description="Topology mode: 'triangle' or 'quad'")
    quad_topology: bool = Field(False, description="Request quad-dominant topology")
    physics_enabled: bool = Field(False, description="Request physics-ready post-processing")


def _get_storage_models_root() -> Path:
    models_dir = get_storage_base_dir() / "models" / "meshes"
    models_dir.mkdir(parents=True, exist_ok=True)
    return models_dir


def _find_multiview_workspace(asset_id: str) -> Optional[Path]:
    storage_base = get_storage_base_dir()
    for models_root in (
        _get_storage_models_root(),
        storage_base / "models",
    ):
        workspace = models_root / asset_id
        if (workspace / "multiview").is_dir():
            return workspace

        matches = sorted(
            path for path in models_root.glob(f"*{asset_id}*")
            if (path / "multiview").is_dir()
        )
        if matches:
            return matches[0]
    return None


def _safe_stem(name: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", str(name)).strip("._-")
    return cleaned or "asset"


@router.post("/generate", response_model=MultiViewGenerateResponse)
async def generate_multiview(
    req: MultiViewGenerateRequest,
    scheduler: MultiprocessModelScheduler = Depends(get_scheduler),
    file_store=Depends(get_file_store),
    current_user=Depends(get_current_user_or_none),
):
    """
    Queue a Zero123++ v1.2 multi-view image generation job.
    Loads Zero123++, generates 6 viewpoint images, saves canonical asset workspace, and unloads model.
    """
    try:
        if req.enhancement_enabled and not req.preprocessing_artifact_id:
            raise HTTPException(
                status_code=400,
                detail="enhancement_enabled requires an approved preprocessing_artifact_id",
            )

        # Resolve reference image path
        temp_dir: Optional[str] = None
        input_image_path: str = ""

        if req.image_path:
            input_image_path = resolve_server_file_path(req.image_path) or req.image_path
            if not Path(input_image_path).exists():
                raise HTTPException(status_code=404, detail="Reference image file not found")
        elif req.image_base64:
            temp_dir = tempfile.mkdtemp(prefix="mv_input_")
            file_info = await save_base64_file(req.image_base64, temp_dir, "input.png")
            input_image_path = file_info["path"]
        elif req.image_file_id:
            resolved_path = await resolve_file_id_async(req.image_file_id, file_store)
            if not resolved_path:
                resolved_path = resolve_server_file_path(req.image_file_id)
            if not resolved_path and file_store:
                info = await file_store.get_file(req.image_file_id)
                if info:
                    p = getattr(info, "file_path", None) or (info.get("file_path") if isinstance(info, dict) else None)
                    if p and Path(p).exists():
                        resolved_path = p
            if not resolved_path or not Path(resolved_path).exists():
                raise HTTPException(status_code=404, detail=f"File {req.image_file_id} not found")
            input_image_path = str(resolved_path)

        preprocessing_metadata: Dict[str, Any] = {}
        if req.preprocessing_artifact_id:
            input_image_path, preprocessing_metadata = load_preprocessed_artifact(
                req.preprocessing_artifact_id,
                "approved",
            )
        elif req.enhancement_enabled:
            model_config = getattr(scheduler, "model_registry", {}).get(req.model_preference, {})
            capabilities = model_config.get("capabilities", {}) if isinstance(model_config, dict) else {}
            preprocessing_profile = str(capabilities.get("preferred_preprocessing", "default"))
            enhanced = preprocess_image(input_image_path, profile=preprocessing_profile)
            input_image_path = enhanced["approved_path"]
            preprocessing_metadata = enhanced["metadata"]

        # Derive safe asset name
        raw_stem = Path(input_image_path).stem
        asset_name = _safe_stem(req.asset_name or raw_stem)
        seed = req.seed if req.seed is not None and req.seed >= 0 else random.randint(0, 2147483647)

        # Validate model preference
        available = scheduler.get_available_models("image_to_multiview")
        mv_models = available.get("image_to_multiview", [])
        if mv_models and req.model_preference not in mv_models:
            raise HTTPException(
                status_code=400,
                detail=f"Model '{req.model_preference}' is not available for 'image_to_multiview'. Available: {mv_models}",
            )

        user_id = current_user.user_id if current_user else None

        job_request = JobRequest(
            feature="image_to_multiview",
            inputs={
                "image_path": input_image_path,
                "asset_name": asset_name,
                "inference_steps": req.inference_steps,
                "guidance_scale": req.guidance_scale,
                "seed": seed,
                "background_removal": req.background_removal,
                "generate_masks": req.generate_masks,
                "generate_normals": req.generate_normals,
                "save_contact_sheet": req.save_contact_sheet,
                "output_format": req.output_format,
                "preprocessing_artifact_id": req.preprocessing_artifact_id,
                "enhancement_enabled": req.enhancement_enabled,
                "preprocessing_metadata": preprocessing_metadata,
            },
            model_preference=req.model_preference,
            priority=1,
            metadata={
                "feature_type": "image_to_multiview",
                "asset_name": asset_name,
                "source_file_id": req.image_file_id,
                "preprocessing": preprocessing_metadata,
                "enhancement_enabled": req.enhancement_enabled,
            },
            user_id=user_id,
        )

        job_id = await scheduler.schedule_job(job_request)

        return MultiViewGenerateResponse(
            job_id=job_id,
            status="queued",
            message="Zero123++ multi-view generation queued successfully",
            asset_name=asset_name,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error scheduling multi-view generation job: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to queue multi-view job: {str(e)}")


@router.post("/upload")
async def upload_manual_views(
    req: MultiViewManualUploadRequest,
    file_store=Depends(get_file_store),
    current_user=Depends(get_current_user_or_none),
):
    """
    Upload a manual multi-view image collection and construct a canonical asset workspace.
    """
    if not req.views or len(req.views) < 2:
        raise HTTPException(status_code=400, detail="At least 2 views are required for a multi-view collection")

    safe_name = _safe_stem(req.asset_name or "manual_views")
    job_hash = hashlib.sha256(f"{safe_name}_{time.time()}_{uuid4().hex}".encode("utf-8")).hexdigest()[:8]
    asset_id = f"{safe_name}_{job_hash}"

    models_root = _get_storage_models_root()
    workspace_dir = models_root / asset_id
    multiview_dir = workspace_dir / "multiview"
    multiview_dir.mkdir(parents=True, exist_ok=True)

    views_manifest = []
    for idx, v in enumerate(req.views):
        view_stem = f"view_{idx}_{_safe_stem(v.view_label.lower())}"
        target_file = multiview_dir / f"{view_stem}.png"

        # Resolve image
        if v.file_id:
            resolved = await resolve_file_id_async(v.file_id, file_store)
            if not resolved:
                resolved = resolve_server_file_path(v.file_id)
            if not resolved and file_store:
                info = await file_store.get_file(v.file_id)
                if info:
                    p = getattr(info, "file_path", None) or (info.get("file_path") if isinstance(info, dict) else None)
                    if p and Path(p).is_file():
                        resolved = p
            if resolved and Path(resolved).is_file():
                import shutil
                shutil.copy2(resolved, target_file)
        elif v.image_base64:
            await save_base64_file(v.image_base64, str(multiview_dir), f"{view_stem}.png")

        if target_file.exists():
            views_manifest.append({
                "file": target_file.name,
                "label": v.view_label,
                "azimuth_deg": v.azimuth_deg,
                "elevation_deg": v.elevation_deg,
                "path": str(target_file.resolve()),
            })

    manifest_data = {
        "schema_version": 1,
        "source_filename": req.asset_name,
        "manual_upload": True,
        "view_count": len(views_manifest),
        "views": views_manifest,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    with open(multiview_dir / "manifest.json", "w", encoding="utf-8") as f:
        json.dump(manifest_data, f, indent=2)

    return {
        "status": "success",
        "asset_id": asset_id,
        "multiview_dir": str(multiview_dir.resolve()),
        "views": views_manifest,
        "manifest": manifest_data,
    }


@router.get("/{asset_id}")
async def get_multiview_asset(
    asset_id: str,
    _: bool = Depends(verify_api_key),
):
    """
    Retrieve manifest and accessible URLs for a generated or uploaded multi-view asset.
    """
    workspace_dir = _find_multiview_workspace(asset_id)
    if workspace_dir is None:
        raise HTTPException(status_code=404, detail=f"Multi-view asset '{asset_id}' not found")
    multiview_dir = workspace_dir / "multiview"

    manifest_file = multiview_dir / "manifest.json"
    manifest_data = {}
    if manifest_file.is_file():
        try:
            with open(manifest_file, "r", encoding="utf-8") as f:
                manifest_data = json.load(f)
        except Exception as e:
            logger.warning(f"Error reading manifest: {e}")

    # Serve only this asset's multiview images through the frontend static proxy.
    asset_folder = workspace_dir.name
    storage_path = workspace_dir.relative_to(get_storage_base_dir()).as_posix()
    base_url = f"/static/{storage_path}/multiview"

    views_output = []
    raw_views = manifest_data.get("views", [])
    if raw_views:
        for v in raw_views:
            fname = v.get("file")
            v_entry = dict(v)
            v_entry["url"] = f"{base_url}/{fname}"
            if v.get("mask_file"):
                v_entry["mask_url"] = f"{base_url}/{v['mask_file']}"
            if v.get("normal_file"):
                v_entry["normal_url"] = f"{base_url}/{v['normal_file']}"
            views_output.append(v_entry)
    else:
        # Fallback to discovering png files
        for p in sorted(multiview_dir.glob("*.png")):
            if p.name in ("source.png", "contact_sheet.png"):
                continue
            views_output.append({
                "file": p.name,
                "label": p.stem.replace("_", " ").title(),
                "url": f"{base_url}/{p.name}",
            })

    contact_sheet_url = f"{base_url}/contact_sheet.png" if (multiview_dir / "contact_sheet.png").is_file() else None
    source_url = f"{base_url}/source.png" if (multiview_dir / "source.png").is_file() else None

    # Derive original stem for ZIP name
    safe_stem = manifest_data.get("source_filename") or asset_folder.split("_")[0]
    zip_url = f"/api/v1/multiview/{asset_folder}/zip"

    return {
        "status": "ready",
        "asset_id": asset_folder,
        "views": views_output,
        "contact_sheet_url": contact_sheet_url,
        "source_url": source_url,
        "zip_url": zip_url,
        "manifest": manifest_data,
    }


@router.get("/{asset_id}/zip")
async def download_multiview_zip(
    asset_id: str,
    _: bool = Depends(verify_api_key),
):
    """
    Export the multi-view pack as an on-demand ZIP file.
    The filename strictly derives from the originally uploaded image stem: <stem>.zip.
    """
    workspace_dir = _find_multiview_workspace(asset_id)
    if workspace_dir is None:
        raise HTTPException(status_code=404, detail=f"Multi-view asset '{asset_id}' not found")
    multiview_dir = workspace_dir / "multiview"

    # Read manifest to extract exact original stem
    original_stem = None
    manifest_file = multiview_dir / "manifest.json"
    if manifest_file.is_file():
        try:
            with open(manifest_file, "r", encoding="utf-8") as f:
                mdata = json.load(f)
                if mdata.get("source_filename"):
                    original_stem = Path(mdata["source_filename"]).stem
        except Exception:
            pass

    if not original_stem:
        original_stem = workspace_dir.name.split("_")[0]

    safe_stem = _safe_stem(original_stem)
    zip_filename = f"{safe_stem}.zip"
    zip_path = workspace_dir / zip_filename

    # Build ZIP on-demand if missing or modified
    Zero123PlusAdapter.create_multiview_zip(multiview_dir, zip_path)

    return FileResponse(
        path=str(zip_path),
        filename=zip_filename,
        media_type="application/zip",
    )


@router.post("/reconstruct-3d")
async def reconstruct_3d_from_multiview(
    req: MultiViewReconstruct3DRequest,
    scheduler: MultiprocessModelScheduler = Depends(get_scheduler),
    current_settings=Depends(get_current_settings),
    current_user=Depends(get_current_user_or_none),
):
    """
    Capability gate for Multi-View -> 3D reconstruction requests.
    Only models declaring `capabilities.multiview: true` can be targeted.
    Rejects unauthorized or unsupported models with HTTP 400.
    """
    model_id = req.model_preference

    if not req.asset_id and not req.images:
        raise HTTPException(
            status_code=400,
            detail="Provide an existing multiview asset_id or explicit images for reconstruction",
        )

    if req.enhancement_enabled and not req.preprocessing_artifact_id:
        raise HTTPException(
            status_code=400,
            detail="enhancement_enabled requires an approved preprocessing_artifact_id",
        )

    # Look up model configuration and verify multiview capability
    model_cfg = None
    for feat, models in current_settings.models.items():
        if model_id in models:
            model_cfg = models[model_id]
            break

    if not model_cfg:
        raise HTTPException(
            status_code=404,
            detail=f"Target 3D reconstruction model '{model_id}' is not registered in the system",
        )

    capabilities = getattr(model_cfg, "capabilities", {}) or {}
    supports_multiview = capabilities.get("multiview", False)

    if not supports_multiview:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Model '{model_id}' does not support multi-view reconstruction. "
                "Only models with capabilities.multiview=true can process multi-view image sets."
            ),
        )

    max_images = capabilities.get("max_images")
    if max_images and req.images and len(req.images) > max_images:
        raise HTTPException(
            status_code=400,
            detail=f"Model '{model_id}' accepts at most {max_images} images; {len(req.images)} were supplied.",
        )

    params = {k: v for k, v in (req.model_parameters or {}).items() if v is not None}
    target_polycount = params.pop("target_polycount", req.target_polycount)
    quality = str(params.pop("quality", req.quality)).lower()
    lod_enabled = bool(params.pop("generateLOD", req.generateLOD))
    lod_preset = str(params.pop("lodPreset", req.lodPreset))
    lod_count = int(params.pop("lodCount", req.lodCount))
    source_texture_resolution = params.pop("texture_resolution", None)
    texture_resolution = int(req.texture_resolution or 2048)

    # Queue multi-view 3D reconstruction job with validated adapter.
    user_id = current_user.user_id if current_user else None
    job_request = JobRequest(
        feature=getattr(model_cfg, "feature_type", "image_to_textured_mesh"),
        inputs={
            "multiview_asset_id": req.asset_id,
            "images": req.images,
            "output_format": req.output_format,
            "intent": req.intent,
            "preprocessing_artifact_id": req.preprocessing_artifact_id,
            "enhancement_enabled": req.enhancement_enabled,
            "quality": quality,
            "target_polycount": target_polycount,
            "generateLOD": lod_enabled,
            "lodPreset": lod_preset,
            "lodCount": lod_count,
            "texture_resolution": int(source_texture_resolution or 2048),
            "production_texture_resolution": texture_resolution,
            "enable_printability_check": req.enable_printability_check,
            "enable_auto_repair": req.enable_auto_repair,
            "enable_auto_rig": req.enable_auto_rig,
            "auto_rig_mode": req.auto_rig_mode,
            "topology_mode": req.topology_mode or ("quad" if req.quad_topology else "triangle"),
            "quad_topology": bool(req.quad_topology or req.topology_mode == "quad"),
            "physics_enabled": req.physics_enabled,
            "physics_config": req.physics_config,
            **params,
        },
        model_preference=model_id,
        priority=1,
        metadata={
            "input_type": "multiview",
            "source_multiview_asset_id": req.asset_id,
            "intent": req.intent,
            "quality": quality,
            "target_polycount": target_polycount,
            "texture_resolution": texture_resolution,
            "production_texture_resolution": texture_resolution,
            "generateLOD": lod_enabled,
            "lodPreset": lod_preset,
            "lodCount": lod_count,
            "enhancement_enabled": req.enhancement_enabled,
            "preprocessing_artifact_id": req.preprocessing_artifact_id,
            "enable_printability_check": req.enable_printability_check,
            "enable_auto_repair": req.enable_auto_repair,
            "enable_auto_rig": req.enable_auto_rig,
            "auto_rig_mode": req.auto_rig_mode,
        },
        user_id=user_id,
    )

    job_id = await scheduler.schedule_job(job_request)

    return {
        "api_version": "1",
        "job_id": job_id,
        "status": "queued",
        "message": f"Multi-view 3D reconstruction job queued on model '{model_id}'",
    }
