"""Memory-safe, feature-preserving mesh decimation service.

Protects against out-of-memory (OOM) conditions during decimation of large meshes
(e.g., >2M triangles) by dynamically monitoring host RAM and process RSS,
and breaking down decimation into staged reduction chunks while preserving
crease edges, angle-weighted normals, and geometric bounds.
"""
from __future__ import annotations

import gc
import logging
from pathlib import Path
from typing import Any, Optional, Union

import numpy as np
import psutil
import trimesh
import yaml

try:
    from backend.core.mesh_processor import feature_preserving_decimate
    from backend.core.config import get_quality_config
except ImportError:
    from core.mesh_processor import feature_preserving_decimate
    from core.config import get_quality_config

logger = logging.getLogger(__name__)


def load_decimation_config(
    config_path: Optional[Union[str, Path, dict[str, Any]]] = None
) -> dict[str, Any]:
    """Load decimation configuration from canonical quality config."""
    if isinstance(config_path, dict):
        raw = config_path.get("decimation", config_path)
        dec = dict(raw)
        if "crease_angle_deg" not in dec:
            dec["crease_angle_deg"] = float(config_path.get("shared", {}).get("feature_edge_angle_deg", 35.0))
        return dec
    path_str = str(config_path) if config_path is not None else None
    cfg = get_quality_config(path_str)
    dec = dict(cfg.get("decimation", {}))
    dec["crease_angle_deg"] = float(cfg.get("shared", {}).get("feature_edge_angle_deg", 35.0))
    return dec


def memory_safe_decimate(
    mesh: trimesh.Trimesh,
    target_faces: int,
    crease_angle_deg: Optional[float] = None,
    config_path: Optional[Union[str, Path, dict[str, Any]]] = None,
    **kwargs: Any,
) -> tuple[trimesh.Trimesh, dict[str, Any]]:
    """Decimate mesh to target_faces with memory-safe staging and feature preservation.

    Parameters
    ----------
    mesh : trimesh.Trimesh
        Input source mesh (never modified in place; creates working copy).
    target_faces : int
        Desired number of triangles in the output mesh.
    crease_angle_deg : float, optional
        Dihedral angle threshold for crease feature preservation (default 35.0).
    config_path : str, Path, or dict, optional
        Path to custom decimation YAML configuration or dict.
    **kwargs : Any
        Overrides for thresholds (e.g. memory_safe_threshold_triangles, max_ram_fraction).

    Returns
    -------
    tuple[trimesh.Trimesh, dict[str, Any]]
        (decimated_mesh, telemetry_dict) containing:
        - triangles_before: int
        - triangles_after: int
        - reduction_ratio: float
        - peak_rss_mb: float
        - memory_safe_mode_engaged: bool
    """
    if not isinstance(mesh, trimesh.Trimesh):
        raise TypeError(f"Expected trimesh.Trimesh, got {type(mesh)}")

    # Never mutate input in-place
    working_mesh = mesh.copy()

    # Load configuration
    cfg = load_decimation_config(config_path)
    threshold_triangles = int(
        kwargs.get(
            "memory_safe_threshold_triangles",
            kwargs.get("threshold_triangles", cfg.get("memory_safe_threshold_triangles", 2_000_000)),
        )
    )
    max_deviation_deg = float(kwargs.get("max_deviation_deg", cfg.get("max_deviation_deg", 45.0)))
    max_ram_fraction = float(kwargs.get("max_ram_fraction", cfg.get("max_ram_fraction", 0.80)))
    shared_cfg = get_quality_config(str(config_path) if config_path and not isinstance(config_path, dict) else None).get("shared", {})
    fallback_crease = float(shared_cfg.get("feature_edge_angle_deg", 35.0))
    effective_crease_deg = float(kwargs.get("crease_angle_deg", crease_angle_deg if crease_angle_deg is not None else fallback_crease))

    # Monitor memory usage
    proc = psutil.Process()
    peak_rss = proc.memory_info().rss

    vm = psutil.virtual_memory()
    used_fraction = (vm.total - vm.available) / vm.total if vm.total > 0 else 0.0
    is_ram_constrained = used_fraction >= max_ram_fraction

    initial_face_count = len(mesh.faces)
    target_faces = max(1, target_faces)

    # If already at or below target faces, return copy immediately with telemetry
    if initial_face_count <= target_faces or initial_face_count == 0:
        peak_rss = max(peak_rss, proc.memory_info().rss)
        telemetry = {
            "triangles_before": initial_face_count,
            "triangles_after": len(working_mesh.faces),
            "reduction_ratio": round(
                float(len(working_mesh.faces)) / float(max(initial_face_count, 1)), 4
            ),
            "peak_rss_mb": round(peak_rss / (1024.0 * 1024.0), 2),
            "memory_safe_mode_engaged": False,
        }
        return working_mesh, telemetry

    memory_safe_mode_engaged = initial_face_count > threshold_triangles

    if memory_safe_mode_engaged:
        logger.info(
            "Mesh has %d triangles (exceeds memory safety threshold %d). Engaging staged memory-safe decimation.",
            initial_face_count,
            threshold_triangles,
        )
        current_mesh = working_mesh
        while len(current_mesh.faces) > target_faces:
            vm = psutil.virtual_memory()
            used_fraction = (vm.total - vm.available) / vm.total if vm.total > 0 else 0.0
            is_ram_constrained = used_fraction >= max_ram_fraction

            if is_ram_constrained:
                logger.warning(
                    "RAM usage (%.1f%%) exceeds safety threshold (%.1f%%). Limiting intermediate allocations and enforcing aggressive GC.",
                    used_fraction * 100.0,
                    max_ram_fraction * 100.0,
                )
                gc.collect()
                step_target = target_faces
            else:
                # Standard staged chunk: 50% reduction step towards target_faces
                step_target = max(target_faces, int(len(current_mesh.faces) * 0.5))
                if step_target <= int(target_faces * 1.1):
                    step_target = target_faces

            prev_face_count = len(current_mesh.faces)
            prev_mesh = current_mesh
            current_mesh = feature_preserving_decimate(
                prev_mesh,
                target_faces=step_target,
                crease_angle_deg=effective_crease_deg,
                max_deviation_deg=max_deviation_deg,
            )

            # Prevent intermediate accumulation
            del prev_mesh
            if hasattr(current_mesh, "_cache"):
                current_mesh._cache.clear()
            gc.collect()

            rss_now = proc.memory_info().rss
            if rss_now > peak_rss:
                peak_rss = rss_now

            # Terminate if target reached or if decimation made no progress
            if len(current_mesh.faces) <= target_faces or len(current_mesh.faces) >= prev_face_count:
                break

        decimated_mesh = current_mesh
    else:
        # Standard decimation under threshold
        if is_ram_constrained:
            gc.collect()

        decimated_mesh = feature_preserving_decimate(
            working_mesh,
            target_faces=target_faces,
            crease_angle_deg=effective_crease_deg,
            max_deviation_deg=max_deviation_deg,
        )

        rss_now = proc.memory_info().rss
        if rss_now > peak_rss:
            peak_rss = rss_now

    triangles_after = len(decimated_mesh.faces)
    telemetry = {
        "triangles_before": initial_face_count,
        "triangles_after": triangles_after,
        "reduction_ratio": round(
            float(triangles_after) / float(max(initial_face_count, 1)), 4
        ),
        "peak_rss_mb": round(peak_rss / (1024.0 * 1024.0), 2),
        "memory_safe_mode_engaged": memory_safe_mode_engaged,
    }

    return decimated_mesh, telemetry
