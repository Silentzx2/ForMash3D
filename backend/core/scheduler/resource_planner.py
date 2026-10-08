
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
    def cpu_worker_limit(requested: Optional[int] = None) -> int:
        """Resolve a safe CPU worker cap from hardware and optional override."""
        override = _env_int("FORMSH3D_CPU_WORKERS", 0)
        if override:
            return max(1, min(cpu_count(), override))
        if requested:
            return max(1, min(cpu_count(), int(requested)))
        return cpu_count()


def dispatch_pipeline_across_gpus(pipeline: Any, resource_plan: ResourcePlan, offload_dir: Optional[str] = None) -> Dict[str, Any]:
    if not resource_plan.is_multi_gpu: return {"applied": False, "reason": "single_gpu_plan"}
    from accelerate import dispatch_model, infer_auto_device_map
    device_map = infer_auto_device_map(pipeline)
    dispatch_model(pipeline, device_map=device_map)
    return {"applied": True, "strategy": "accelerate_native", "device_map": str(device_map)}
