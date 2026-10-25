"""Runtime capability probe for system resources, GPU VRAM, and adapter availability.

Fulfills TASKS.md Section 2 runtime detection contract.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

import psutil
import yaml

try:
    import torch
except ImportError:
    torch = None

logger = logging.getLogger(__name__)


def _get_models_yaml_path(custom_path: Optional[str] = None) -> Path:
    """Resolve path to models.yaml."""
    if custom_path:
        return Path(custom_path).expanduser().resolve()
    default_path = Path(__file__).resolve().parent.parent / "config" / "models.yaml"
    if default_path.exists():
        return default_path
    candidate = Path.cwd() / "backend" / "config" / "models.yaml"
    if candidate.exists():
        return candidate
    return default_path


def _get_installed_adapters() -> List[str]:
    """Retrieve installed adapter keys from backend/adapters."""
    try:
        from backend.adapters import _ADAPTER_MAP
        return list(_ADAPTER_MAP.keys())
    except Exception:
        try:
            import sys
            backend_dir = str(Path(__file__).resolve().parent.parent)
            if backend_dir not in sys.path:
                sys.path.insert(0, backend_dir)
            from adapters import _ADAPTER_MAP
            return list(_ADAPTER_MAP.keys())
        except Exception as e:
            logger.warning("Could not import _ADAPTER_MAP from backend.adapters: %s", e)
            return []


def _is_license_optin_satisfied(
    model_id: str,
    license_optins: Dict[str, bool],
    requires_optin: bool,
) -> bool:
    """Check if license opt-in is satisfied for a given model_id."""
    if not license_optins:
        return not requires_optin

    # Direct exact match
    if model_id in license_optins:
        return bool(license_optins[model_id])

    # Check substring or prefix match (e.g. 'trellis2' matches 'trellis2_image_to_raw_mesh')
    for key, accepted in license_optins.items():
        if key == model_id or model_id.startswith(f"{key}_") or f"_{key}_" in model_id or model_id.startswith(key):
            return bool(accepted)

    if requires_optin:
        return False
    return True


def _get_enabled_adapters(
    models_data: Dict[str, Any],
    license_optins: Dict[str, bool],
) -> List[str]:
    """Extract enabled adapters satisfying license opt-in from models.yaml."""
    enabled_adapters: List[str] = []
    if not isinstance(models_data, dict):
        return enabled_adapters

    for _section_name, section_dict in models_data.items():
        if not isinstance(section_dict, dict):
            continue
        for model_id, model_cfg in section_dict.items():
            if not isinstance(model_cfg, dict):
                continue
            if model_cfg.get("enabled", False) is True:
                requires_optin = bool(
                    model_cfg.get("requires_license_optin", False)
                    or model_cfg.get("license_required", False)
                    or model_cfg.get("license_optin_required", False)
                )
                if _is_license_optin_satisfied(model_id, license_optins, requires_optin):
                    if model_id not in enabled_adapters:
                        enabled_adapters.append(model_id)

    return enabled_adapters


def probe_runtime(
    models_yaml_path: Optional[str] = None,
    license_optins: Optional[Dict[str, bool]] = None,
) -> Dict[str, Any]:
    """Probe system resources, GPU/VRAM state, installed and enabled adapters.

    Returns exact dictionary schema specified in TASKS.md Section 2.
    """
    optins = dict(license_optins or {})

    has_cuda = False
    cuda_device_name: Optional[str] = None
    total_vram_gb: Optional[float] = None
    free_vram_gb: Optional[float] = None
    aggregate_free_vram_gb: Optional[float] = None
    max_free_vram_gb: Optional[float] = None
    gpu_count: int = 0
    gpu_devices: List[Dict[str, Any]] = []
    peak_vram_gb_last_run: Optional[float] = None
    cuda_version: Optional[str] = None
    torch_version = "not_installed"

    if torch is not None:
        torch_version = getattr(torch, "__version__", "not_installed")
        if hasattr(torch, "cuda") and torch.cuda.is_available():
            has_cuda = True
            cuda_version = getattr(torch.version, "cuda", None)
            try:
                gpu_count = torch.cuda.device_count()
            except Exception:
                gpu_count = 1

            agg_free = 0
            agg_total = 0
            max_free = 0

            for i in range(gpu_count):
                try:
                    dev_name = torch.cuda.get_device_name(i)
                    if cuda_device_name is None:
                        cuda_device_name = dev_name
                    free_b, total_b = torch.cuda.mem_get_info(i)
                    free_gb = round(free_b / (1024 ** 3), 2)
                    total_gb = round(total_b / (1024 ** 3), 2)
                    gpu_devices.append({
                        "id": i,
                        "name": dev_name,
                        "free_vram_gb": free_gb,
                        "total_vram_gb": total_gb,
                    })
                    agg_free += free_b
                    agg_total += total_b
                    if free_b > max_free:
                        max_free = free_b
                except Exception:
                    pass

            if agg_total > 0:
                total_vram_gb = round(agg_total / (1024 ** 3), 2)
                aggregate_free_vram_gb = round(agg_free / (1024 ** 3), 2)
                max_free_vram_gb = round(max_free / (1024 ** 3), 2)
                free_vram_gb = max_free_vram_gb
            else:
                try:
                    free_bytes, total_bytes = torch.cuda.mem_get_info(0)
                    free_vram_gb = round(free_bytes / (1024 ** 3), 2)
                    total_vram_gb = round(total_bytes / (1024 ** 3), 2)
                    aggregate_free_vram_gb = free_vram_gb
                    max_free_vram_gb = free_vram_gb
                except Exception:
                    pass

            try:
                peak_bytes = torch.cuda.max_memory_allocated(0)
                peak_vram_gb_last_run = round(peak_bytes / (1024 ** 3), 2)
            except Exception:
                pass

    # RAM detection via psutil
    try:
        vm = psutil.virtual_memory()
        total_ram_gb = round(vm.total / (1024 ** 3), 2)
        free_ram_gb = round(vm.available / (1024 ** 3), 2)
    except Exception:
        total_ram_gb = 0.0
        free_ram_gb = 0.0

    installed_adapters = _get_installed_adapters()

    models_path = _get_models_yaml_path(models_yaml_path)
    models_data: Dict[str, Any] = {}
    if models_path.exists():
        try:
            models_data = yaml.safe_load(models_path.read_text(encoding="utf-8")) or {}
        except Exception as e:
            logger.warning("Failed to load models config from %s: %s", models_path, e)

    enabled_adapters = _get_enabled_adapters(models_data, optins)

    return {
        "has_cuda": has_cuda,
        "cuda_device_name": cuda_device_name,
        "gpu_count": gpu_count,
        "gpu_devices": gpu_devices,
        "total_vram_gb": total_vram_gb,
        "free_vram_gb": free_vram_gb,
        "aggregate_free_vram_gb": aggregate_free_vram_gb,
        "max_free_vram_gb": max_free_vram_gb,
        "total_ram_gb": total_ram_gb,
        "free_ram_gb": free_ram_gb,
        "peak_vram_gb_last_run": peak_vram_gb_last_run,
        "installed_adapters": installed_adapters,
        "enabled_adapters": enabled_adapters,
        "license_optins": optins,
        "torch_version": torch_version,
        "cuda_version": cuda_version,
    }


def reset_peak_vram(device: int = 0) -> None:
    """Reset peak memory tracking for the current job."""
    if torch is not None and hasattr(torch, "cuda") and torch.cuda.is_available():
        try:
            torch.cuda.reset_peak_memory_stats(device)
        except Exception:
            pass
