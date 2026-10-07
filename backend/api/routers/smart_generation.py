"""Smart intent resolution API."""
from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from api.dependencies import get_current_settings, get_current_user_or_none, get_file_store, get_scheduler
from api.routers.mesh_generation import (
    ImageToRawMeshRequest,
    ImageToTexturedMeshRequest,
    image_to_raw_mesh,
    image_to_textured_mesh,
)
from core.smart_presets import load_smart_presets, resolve_intent

router = APIRouter(prefix="/smart-generation", tags=["Smart Generation"])


class IntentResolveRequest(BaseModel):
    intent: str = Field(..., min_length=1)
    model: str | None = None


@router.get("/presets")
async def presets():
    data = load_smart_presets()
    return {"version": int(data.get("version", 1)), "intents": data["intents"]}


class SmartGenerationRequest(BaseModel):
    """One-click image-only generation contract for deterministic smart intents."""
    image_path: Optional[str] = None
    image_base64: Optional[str] = None
    image_file_id: Optional[str] = None
    intent: str = Field(..., min_length=1)
    model: str | None = Field(None, description="Optional explicit model override")
    preprocessing_artifact_id: str | None = None
    enhancement_enabled: bool = False
    enable_printability_check: bool | None = None
    enable_auto_repair: bool | None = None
    enable_auto_rig: bool | None = None
    auto_rig_mode: str = "full"
    physics_enabled: bool | None = None
    physics_config: Dict[str, Any] | None = None
    topology_mode: str = "triangle"
    quad_topology: bool = False
    asset_name: str | None = None
    image_name: str | None = None
    overrides: Dict[str, Any] = Field(default_factory=dict)

    model_config = ConfigDict(protected_namespaces=("settings_",))

    def model_post_init(self, __context: Any) -> None:
        count = sum(bool(value) for value in (self.image_path, self.image_base64, self.image_file_id))
        if count != 1:
            raise ValueError("Exactly one of image_path, image_base64, or image_file_id must be provided")
        if self.topology_mode not in {"triangle", "quad"}:
            raise ValueError("topology_mode must be 'triangle' or 'quad'")


def _override_value(request: SmartGenerationRequest, preset: Dict[str, Any], key: str, default: Any = None) -> Any:
    if key in request.overrides and request.overrides[key] is not None:
        return request.overrides[key]
    return preset.get(key, default)


def _build_smart_request(request: SmartGenerationRequest, resolved: Dict[str, Any]):
    preset = resolved["preset"]
    model_id = resolved["model_id"]
    overrides = dict(request.overrides)
    target_polycount = _override_value(request, preset, "target_polycount")
    texture_resolution = int(_override_value(request, preset, "texture_resolution", 1024))
    generate_lod = bool(_override_value(request, preset, "generate_lod", True))
    lod_preset = str(_override_value(request, preset, "lod_preset", "high"))
    lod_count = int(_override_value(request, preset, "lod_count", 4))
    collision = bool(
        request.physics_enabled if request.physics_enabled is not None else _override_value(request, preset, "collision", False)
    )
    printability = bool(
        request.enable_printability_check
        if request.enable_printability_check is not None
        else _override_value(request, preset, "enable_printability_check", False)
    )
    auto_repair = bool(
        request.enable_auto_repair
        if request.enable_auto_repair is not None
        else _override_value(request, preset, "enable_auto_repair", False)
    )
    auto_rig = bool(
        request.enable_auto_rig
        if request.enable_auto_rig is not None
        else _override_value(request, preset, "enable_auto_rig", False)
    )

    model_parameters = {
        key: value
        for key, value in overrides.items()
        if key not in {
            "target_polycount",
            "texture_resolution",
            "generate_lod",
            "lod_preset",
            "lod_count",
            "collision",
            "enable_printability_check",
            "enable_auto_repair",
            "enable_auto_rig",
        }
        and value is not None
    }
    model_parameters.update({
        "target_polycount": target_polycount,
        "generateLOD": generate_lod,
        "lodPreset": lod_preset,
        "lodCount": lod_count,
    })

    common = {
        "image_path": request.image_path,
        "image_base64": request.image_base64,
        "image_file_id": request.image_file_id,
        "output_format": "glb",
        "model_preference": model_id,
        "intent": request.intent,
        "preprocessing_artifact_id": request.preprocessing_artifact_id,
        "enhancement_enabled": request.enhancement_enabled,
        "enable_printability_check": printability,
        "enable_auto_repair": auto_repair,
        "enable_auto_rig": auto_rig,
        "auto_rig_mode": request.auto_rig_mode,
        "physics_enabled": collision,
        "physics_config": request.physics_config,
        "topology_mode": "quad" if request.quad_topology else request.topology_mode,
        "quad_topology": bool(request.quad_topology or request.topology_mode == "quad"),
        "asset_name": request.asset_name,
        "image_name": request.image_name,
    }

    if resolved["feature"] == "image_to_textured_mesh":
        payload = ImageToTexturedMeshRequest(
            **common,
            texture_resolution=texture_resolution,
            model_parameters=model_parameters,
        )
    else:
        payload = ImageToRawMeshRequest(
            **common,
            model_parameters=model_parameters,
        )

    summary = {
        "intent": request.intent,
        "model_id": model_id,
        "preset_version": resolved["version"],
        "preset": preset,
        "candidate_order": resolved["candidate_order"],
        "vram_budget_mb": resolved["vram_budget_mb"],
        "effective": {
            "target_polycount": target_polycount,
            "texture_resolution": texture_resolution if resolved["feature"] == "image_to_textured_mesh" else None,
            "generate_lod": generate_lod,
            "lod_preset": lod_preset,
            "lod_count": lod_count,
            "collision": collision,
            "enable_printability_check": printability,
            "enable_auto_repair": auto_repair,
            "enable_auto_rig": auto_rig,
            "topology_mode": "quad" if request.quad_topology else request.topology_mode,
        },
    }
    return payload, summary


@router.post("/generation")
async def smart_generation(
    request: SmartGenerationRequest,
    scheduler=Depends(get_scheduler),
    current_user=Depends(get_current_user_or_none),
    file_store=Depends(get_file_store),
    settings=Depends(get_current_settings),
):
    """Resolve an image-only intent and submit through the existing generation scheduler path."""
    try:
        resolved = resolve_intent(request.intent, settings, explicit_model=request.model)
        payload, summary = _build_smart_request(request, resolved)
        if isinstance(payload, ImageToTexturedMeshRequest):
            queued = await image_to_textured_mesh(
                payload,
                scheduler=scheduler,
                current_user=current_user,
                file_store=file_store,
            )
        else:
            queued = await image_to_raw_mesh(
                payload,
                scheduler=scheduler,
                current_user=current_user,
                file_store=file_store,
            )
        return {
            "job_id": queued.job_id,
            "status": queued.status,
            "message": queued.message,
            **summary,
        }
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

@router.post("/resolve")
async def resolve(
    request: IntentResolveRequest,
    settings=Depends(get_current_settings),
):
    try:
        return resolve_intent(
            request.intent,
            settings,
            explicit_model=request.model,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
