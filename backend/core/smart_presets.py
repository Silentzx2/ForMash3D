"""Deterministic intent preset resolver."""
from __future__ import annotations
from pathlib import Path
from typing import Any, Dict, Optional

import torch
import yaml

from core.scheduler.resource_planner import ResourcePlanner

CONFIG = Path(__file__).resolve().parents[1] / "config" / "smart_presets.yaml"

def load_smart_presets() -> Dict[str, Any]:
    data = yaml.safe_load(CONFIG.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or not isinstance(data.get("intents"), dict):
        raise ValueError("smart_presets.yaml must define an intents mapping")
    return data

def get_gpu_memory_profile() -> Dict[str, Any]:
    if not torch.cuda.is_available():
        return {"gpu_count": 0, "free_mb": [], "aggregate_free_mb": None, "max_free_mb": None}
    free_mb = []
    for index in range(torch.cuda.device_count()):
        try:
            free_bytes, _ = torch.cuda.mem_get_info(index)
            free_mb.append(int(free_bytes / (1024 * 1024)))
        except Exception:
            continue
    return {
        "gpu_count": len(free_mb),
        "free_mb": free_mb,
        "aggregate_free_mb": sum(free_mb) if free_mb else None,
        "max_free_mb": max(free_mb) if free_mb else None,
    }


def get_available_vram_mb() -> Optional[int]:
    return get_gpu_memory_profile().get("max_free_mb")

def _model_ready(config: Any) -> bool:
    if not getattr(config, "enabled", True):
        return False
    model_path = getattr(config, "model_path", None)
    if not model_path:
        return False
    path = Path(str(model_path)).expanduser()
    if not path.is_absolute():
        candidates = [
            Path.cwd() / path,
            Path(__file__).resolve().parents[1] / path,
            Path(__file__).resolve().parents[2] / str(model_path).replace("backend/", "", 1),
        ]
        path = next((candidate for candidate in candidates if candidate.exists()), path)
    if not path.exists():
        return False
    if path.is_file():
        return path.stat().st_size > 0
    try:
        checkpoint_suffixes = {".safetensors", ".bin", ".pt", ".pth", ".ckpt", ".onnx", ".engine"}
        for child in path.rglob("*"):
            if not child.is_file():
                continue
            try:
                if child.stat().st_size > 0 and child.suffix.lower() in checkpoint_suffixes:
                    return True
            except OSError:
                continue
        return False
    except OSError:
        return False

def _configs(settings: Any) -> Dict[str, Any]:
    result = {}
    for feature, models in (getattr(settings, "models", {}) or {}).items():
        for model_id, config in (models or {}).items():
            result[model_id] = (feature, config)
    return result

def resolve_intent(
    intent: str,
    settings: Any,
    *,
    explicit_model: Optional[str] = None,
    available_vram_mb: Optional[int] = None,
    inputs: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    data = load_smart_presets()
    preset = data["intents"].get(intent)
    if not preset:
        raise ValueError(f"Unknown intent preset: {intent}")

    configs = _configs(settings)
    profile = get_gpu_memory_profile()
    vram_budget = available_vram_mb if available_vram_mb is not None else profile.get("max_free_mb")
    candidates = []

    routing_inputs = dict(inputs or {})
    routing_inputs.setdefault("target_polycount", preset.get("target_polycount"))
    routing_inputs.setdefault("texture_resolution", preset.get("texture_resolution"))
    routing_inputs.setdefault("available_gpu_count", profile.get("gpu_count", 0))
    if not routing_inputs.get("quality"):
        target = int(routing_inputs.get("target_polycount") or 0)
        routing_inputs["quality"] = "ultra" if target >= 150_000 else "high"

    for model_id in preset.get("model_priority", []):
        entry = configs.get(model_id)
        if not entry:
            continue
        feature, config = entry
        capabilities = getattr(config, "capabilities", {}) or {}
        if feature not in preset.get("preferred_features", []):
            continue
        if not capabilities.get("image_to_3d", True):
            continue
        if not _model_ready(config):
            continue
        required = int(getattr(config, "vram_requirement", 0) or 0)
        fits_single = vram_budget is None or required <= int(vram_budget)
        aggregate = profile.get("aggregate_free_mb")
        fits_multi = (
            profile.get("gpu_count", 0) > 1
            and bool(capabilities.get("multi_gpu"))
            and aggregate is not None
            and required <= int(aggregate)
        )
        if not (fits_single or fits_multi):
            continue
        candidates.append((model_id, feature, config))

    if explicit_model:
        entry = configs.get(explicit_model)
        if not entry:
            raise ValueError(f"Requested model '{explicit_model}' is not registered")
        feature, config = entry
        capabilities = getattr(config, "capabilities", {}) or {}
        if feature not in preset.get("preferred_features", []) or not capabilities.get("image_to_3d", True):
            raise ValueError(f"Model '{explicit_model}' is incompatible with intent '{intent}'")
        if not _model_ready(config):
            raise ValueError(f"Requested model '{explicit_model}' is not ready; install its weights first")
        required = int(getattr(config, "vram_requirement", 0) or 0)
        capabilities = getattr(config, "capabilities", {}) or {}
        fits_single = vram_budget is None or required <= int(vram_budget)
        aggregate = profile.get("aggregate_free_mb")
        fits_multi = (
            profile.get("gpu_count", 0) > 1
            and bool(capabilities.get("multi_gpu"))
            and aggregate is not None
            and required <= int(aggregate)
        )
        if not (fits_single or fits_multi):
            raise ValueError(
                f"Requested model '{explicit_model}' needs {required}MB VRAM; "
                f"single-GPU free={vram_budget}MB, aggregate-free={aggregate}MB"
            )
        chosen = (explicit_model, feature, config)
    elif candidates:
        candidate_registry = {
            model_id: {
                "vram_requirement": int(getattr(config, "vram_requirement", 0) or 0),
                "capabilities": dict(getattr(config, "capabilities", {}) or {}),
            }
            for model_id, _, config in candidates
        }
        ranked_id = ResourcePlanner.choose_model(
            candidate_registry,
            [item[0] for item in candidates],
            routing_inputs,
        )
        chosen = next(item for item in candidates if item[0] == ranked_id)
    else:
        raise ValueError(
            f"No ready Image → 3D model satisfies intent '{intent}' under current resource constraints"
        )

    return {
        "version": int(data.get("version", 1)),
        "intent": intent,
        "preset": preset,
        "model_id": chosen[0],
        "feature": chosen[1],
        "vram_required_mb": int(getattr(chosen[2], "vram_requirement", 0) or 0),
        "candidate_order": [item[0] for item in candidates],
        "vram_budget_mb": vram_budget,
    }
