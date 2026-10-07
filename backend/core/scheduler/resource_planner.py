
"""GPU/CPU resource planning for ForMash3D."""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Sequence, Tuple

import torch

logger = logging.getLogger(__name__)


def _env_int(name: str, default: int) -> int:
    try:
        return max(0, int(os.environ.get(name, str(default))))
    except (TypeError, ValueError):
        return default


def cpu_count() -> int:
    return max(1, os.cpu_count() or 1)


def cpu_threads_for_workers(active_workers: int = 1) -> int:
    explicit = _env_int("FORMSH3D_CPU_THREADS", 0)
    if explicit:
        return explicit
    return max(1, cpu_count() // max(1, int(active_workers or 1)))


def configure_cpu_runtime(threads: int) -> int:
    threads = max(1, int(threads))
    os.environ.setdefault("OMP_NUM_THREADS", str(threads))
    os.environ.setdefault("MKL_NUM_THREADS", str(threads))
    os.environ.setdefault("OPENBLAS_NUM_THREADS", str(threads))
    os.environ.setdefault("NUMEXPR_NUM_THREADS", str(threads))
    try:
        torch.set_num_threads(threads)
    except Exception:
        logger.debug("Unable to set torch CPU thread count", exc_info=True)
    try:
        torch.set_num_interop_threads(max(1, min(4, threads)))
    except RuntimeError:
        pass
    return threads


@dataclass(frozen=True)
class ResourcePlan:
    kind: str
    gpu_ids: Tuple[int, ...]
    primary_gpu: Optional[int]
    reservation_mb: Dict[int, int]
    max_memory_mb: Dict[str, int]
    cpu_threads: int
    strategy: str
    reason: str

    @property
    def is_multi_gpu(self) -> bool:
        return len(self.gpu_ids) > 1

    def as_dict(self) -> Dict[str, Any]:
        return {
            "kind": self.kind,
            "gpu_ids": list(self.gpu_ids),
            "primary_gpu": self.primary_gpu,
            "reservation_mb": dict(self.reservation_mb),
            "max_memory_mb": dict(self.max_memory_mb),
            "cpu_threads": self.cpu_threads,
            "strategy": self.strategy,
            "reason": self.reason,
        }


class ResourcePlanner:
    def __init__(self, gpu_monitor: Any, safety_margin_mb: Optional[int] = None):
        self.gpu_monitor = gpu_monitor
        self.safety_margin_mb = (
            max(256, int(safety_margin_mb))
            if safety_margin_mb is not None
            else max(256, _env_int("VRAM_SAFETY_MARGIN_MB", 1024))
        )

    def gpu_capacity_snapshot(self) -> List[Dict[str, Any]]:
        result = []
        for gpu in self.gpu_monitor.get_gpu_status():
            gpu_id = int(gpu["id"])
            result.append(
                {
                    "id": gpu_id,
                    "name": gpu.get("name", f"GPU {gpu_id}"),
                    "total_mb": int(gpu.get("memory_total", 0)),
                    "free_mb": int(gpu.get("memory_free", 0)),
                    "available_mb": int(self.gpu_monitor.get_gpu_available_vram(gpu_id)),
                }
            )
        return result

    def model_is_impossible(self, model_config: Dict[str, Any]) -> bool:
        required = max(1, int(model_config.get("vram_requirement", 1024)))
        snapshot = self.gpu_capacity_snapshot()
        if not snapshot:
            return False
        max_total = max((g["total_mb"] for g in snapshot), default=0)
        if max_total >= required:
            return False
        caps = model_config.get("capabilities") or {}
        if bool(caps.get("multi_gpu")):
            return sum(g["total_mb"] for g in snapshot) < required
        return True

    def plan(self, model_config: Dict[str, Any], active_workers: int = 1) -> Optional[ResourcePlan]:
        required = max(1, int(model_config.get("vram_requirement", 1024)))
        caps = dict(model_config.get("capabilities") or {})
        snapshot = sorted(
            self.gpu_capacity_snapshot(),
            key=lambda item: item["available_mb"],
            reverse=True,
        )
        if not snapshot:
            return None

        threads = cpu_threads_for_workers(active_workers)

        for gpu in snapshot:
            if gpu["available_mb"] >= required:
                return ResourcePlan(
                    kind="single_gpu",
                    gpu_ids=(gpu["id"],),
                    primary_gpu=gpu["id"],
                    reservation_mb={gpu["id"]: required},
                    max_memory_mb={str(gpu["id"]): gpu["available_mb"]},
                    cpu_threads=threads,
                    strategy="single_gpu",
                    reason="Model fits on one GPU.",
                )

        if not bool(caps.get("multi_gpu")):
            return None

        aggregate = sum(g["available_mb"] for g in snapshot)
        if aggregate < required:
            return None

        selected = []
        remaining = required
        for gpu in snapshot:
            if remaining <= 0:
                break
            take = min(int(gpu["available_mb"]), remaining)
            if take > 0:
                selected.append((gpu, take))
                remaining -= take

        if remaining > 0 or len(selected) < 2:
            return None

        reservation = {int(gpu["id"]): int(take) for gpu, take in selected}
        max_memory = {str(gpu["id"]): int(take) for gpu, take in selected}

        try:
            import psutil
            cpu_memory = max(4096, int(psutil.virtual_memory().available / (1024 * 1024) * 0.8))
        except Exception:
            cpu_memory = 4096
        max_memory["cpu"] = _env_int("FORMSH3D_CPU_OFFLOAD_MB", cpu_memory)

        gpu_ids = tuple(int(gpu["id"]) for gpu, _ in selected)
        return ResourcePlan(
            kind="multi_gpu",
            gpu_ids=gpu_ids,
            primary_gpu=gpu_ids[0],
            reservation_mb=reservation,
            max_memory_mb=max_memory,
            cpu_threads=threads,
            strategy=str(caps.get("multi_gpu_strategy") or "accelerate_component_dispatch"),
            reason="Single-GPU placement unavailable; using declared multi-GPU strategy.",
        )

    @staticmethod
    def choose_model(
        model_registry: Dict[str, Dict[str, Any]],
        feature_models: Sequence[str],
        inputs: Optional[Dict[str, Any]] = None,
        explicit_model: Optional[str] = None,
    ) -> Optional[str]:
        """Deterministic capability/resource/quality-aware model routing."""
        inputs = inputs or {}
        if explicit_model and explicit_model in feature_models:
            return explicit_model

        quality = str(inputs.get("quality") or inputs.get("meshQuality") or "").lower()
        requested_poly = inputs.get("target_polycount")
        try:
            target_polycount = int(requested_poly) if requested_poly is not None else 0
        except (TypeError, ValueError):
            target_polycount = 0
        multiview = bool(inputs.get("multiview") or inputs.get("multiview_input"))
        multiview = multiview or len(inputs.get("image_paths") or []) > 1
        texture = bool(
            inputs.get("texture")
            or inputs.get("texture_generation")
            or inputs.get("texture_image_path")
        )
        latency = str(inputs.get("latency") or inputs.get("performance_mode") or "").lower()
        available_gpus = int(inputs.get("available_gpu_count", 0) or 0)

        def score(model_id: str):
            config = model_registry.get(model_id, {})
            caps = config.get("capabilities") or {}
            vram = int(config.get("vram_requirement", 0) or 0)
            points = int(caps.get("quality_priority", 0) or 0)

            if multiview:
                points += 100 if caps.get("multiview_input") or caps.get("multiview") else -200
            elif caps.get("single_view"):
                points += 5

            if texture:
                points += 70 if caps.get("texture_generation") else -30
                points += 25 if caps.get("native_pbr") else 0

            if quality in {"high", "ultra", "cinematic"}:
                points += 25 if caps.get("raw_mesh") else 0
                points += 35 if caps.get("high_fidelity_geometry") else 0
                points += 15 if caps.get("recommended_postprocess_profile") in {"high_fidelity", "cinematic"} else 0
            elif quality in {"low", "fast", "mobile"}:
                points += 20 if caps.get("latency_class") in {"fast", "low"} else 0

            if target_polycount >= 100_000:
                points += 20 if caps.get("high_fidelity_geometry") else 0
            elif 0 < target_polycount <= 30_000:
                points += 15 if caps.get("latency_class") in {"fast", "balanced"} else 0

            if inputs.get("source_quality") == "max":
                points += 20 if caps.get("high_fidelity_geometry") else 0
                points += 10 if caps.get("raw_mesh") else 0

            if latency in {"fast", "low"}:
                points += 20 if caps.get("latency_class") in {"fast", "low"} else -5
            elif latency in {"quality", "high"}:
                points += 15 if caps.get("high_fidelity_geometry") else 0

            if available_gpus > 1 and caps.get("multi_gpu"):
                points += 12
            if vram > 0:
                points -= min(vram // 8192, 8)

            return (points, int(caps.get("quality_priority", 0) or 0), -vram, model_id)

        ranked = sorted(
            (model_id for model_id in feature_models if model_id in model_registry),
            key=score,
            reverse=True,
        )
        return ranked[0] if ranked else None


    @staticmethod
    def cpu_worker_limit(requested: Optional[int] = None) -> int:
        """Resolve a safe CPU worker cap from hardware and optional override."""
        override = _env_int("FORMSH3D_CPU_WORKERS", 0)
        if override:
            return max(1, min(cpu_count(), override))
        if requested:
            return max(1, min(cpu_count(), int(requested)))
        return cpu_count()


def dispatch_pipeline_across_gpus(pipeline: Any, resource_plan: ResourcePlan, offload_dir: Optional[str] = None) -> Dict[str, Any]:
    if not resource_plan.is_multi_gpu:
        return {"applied": False, "reason": "single_gpu_plan"}
    if resource_plan.strategy != "accelerate_component_dispatch":
        raise RuntimeError(f"Unsupported multi-GPU strategy: {resource_plan.strategy}")

    from accelerate import dispatch_model, infer_auto_device_map
    import torch.nn as nn

    components = getattr(pipeline, "components", None)
    if not isinstance(components, dict):
        raise RuntimeError("Pipeline does not expose a diffusers-style components mapping.")

    class PipelineBundle(nn.Module):
        def __init__(self, items):
            super().__init__()
            for name, component in items.items():
                if isinstance(component, nn.Module):
                    setattr(self, name.replace("-", "_"), component)

    items = {name: component for name, component in components.items() if isinstance(component, nn.Module)}
    if not items:
        raise RuntimeError("No torch modules were found in the selected pipeline.")

    bundle = PipelineBundle(items)
    max_memory = {int(device_id): f"{int(memory_mb)}MB" for device_id, memory_mb in resource_plan.max_memory_mb.items() if str(device_id).isdigit()}
    max_memory["cpu"] = f"{int(resource_plan.max_memory_mb.get('cpu', 4096))}MB"

    device_map = infer_auto_device_map(
        bundle,
        max_memory=max_memory,
        dtype=torch.float16 if torch.cuda.is_available() else torch.float32,
        verbose=False,
    )
    if any(device == "disk" for device in device_map.values()):
        raise RuntimeError("Accelerate requested disk offload; refusing an implicit disk-quality/performance fallback.")

    kwargs = {"device_map": device_map, "offload_buffers": True}
    if offload_dir:
        kwargs["offload_dir"] = offload_dir
    dispatch_model(bundle, **kwargs)
    return {"applied": True, "strategy": resource_plan.strategy, "device_map": {str(k): str(v) for k, v in device_map.items()}}
