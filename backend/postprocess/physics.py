"""Physics preparation helpers for generated ForMash3D assets.

This module intentionally stays provider-neutral. It validates the small
canonical physics configuration used by generation jobs, derives safe default
physical properties, and writes portable metadata. Collision geometry itself
continues to come from postprocess.services.collision.
"""
from __future__ import annotations

from typing import Any

import numpy as np
import trimesh


_ALLOWED_BODY_TYPES = {"auto", "static", "dynamic", "kinematic"}
_ALLOWED_MASS_MODES = {"auto", "manual"}
_ALLOWED_DENSITY_MODES = {"auto", "manual"}
_ALLOWED_COLLISION_QUALITY = {"fast", "balanced", "precise"}


def _finite_number(value: Any, default: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return number if np.isfinite(number) else default


def normalize_physics_config(config: dict[str, Any] | None) -> dict[str, Any]:
    """Return a bounded, JSON-safe physics configuration.

    Accept both API-style snake_case and frontend-style camelCase keys so the
    provider-neutral contract remains tolerant of different clients.
    """
    raw = config or {}

    def value(*keys: str, default: Any = None) -> Any:
        for key in keys:
            if key in raw and raw[key] is not None:
                return raw[key]
        return default

    body_type = str(value("body_type", "bodyType", default="auto")).lower()
    if body_type not in _ALLOWED_BODY_TYPES:
        body_type = "auto"

    mass_mode = str(value("mass_mode", "massMode", default="auto")).lower()
    if mass_mode not in _ALLOWED_MASS_MODES:
        mass_mode = "auto"

    density_mode = str(value("density_mode", "densityMode", default="auto")).lower()
    if density_mode not in _ALLOWED_DENSITY_MODES:
        density_mode = "auto"

    collision_quality = str(
        value("collision_quality", "collisionQuality", default="balanced")
    ).lower()
    if collision_quality not in _ALLOWED_COLLISION_QUALITY:
        collision_quality = "balanced"

    mass = max(0.01, min(100_000.0, _finite_number(value("mass_kg", "massKg", default=1.0), 1.0)))
    density = max(
        0.01,
        min(
            20_000.0,
            _finite_number(value("density_kg_m3", "densityKgM3", default=500.0), 500.0),
        ),
    )
    friction = max(0.0, min(2.0, _finite_number(value("friction", default=0.5), 0.5)))
    restitution = max(
        0.0, min(1.0, _finite_number(value("restitution", default=0.1), 0.1))
    )
    linear_damping = max(
        0.0,
        min(
            100.0,
            _finite_number(value("linear_damping", "linearDamping", default=0.05), 0.05),
        ),
    )
    angular_damping = max(
        0.0,
        min(
            100.0,
            _finite_number(value("angular_damping", "angularDamping", default=0.05), 0.05),
        ),
    )

    return {
        "body_type": body_type,
        "mass_mode": mass_mode,
        "mass_kg": mass,
        "density_mode": density_mode,
        "density_kg_m3": density,
        "friction": friction,
        "restitution": restitution,
        "linear_damping": linear_damping,
        "angular_damping": angular_damping,
        "gravity_enabled": bool(value("gravity_enabled", "gravityEnabled", default=True)),
        "collision_quality": collision_quality,
        "deformation": "off",
    }


def collision_options_for_quality(quality: str) -> dict[str, Any]:
    """Map product-level quality to the existing collision service contract."""
    quality = quality if quality in _ALLOWED_COLLISION_QUALITY else "balanced"
    if quality == "fast":
        return {
            "method": "convex_hull",
            "max_hulls": 1,
            "input_faces": 750,
            "max_hull_vertices": 32,
            "resolution": 600,
            "mcts_nodes": 4,
            "mcts_iterations": 20,
            "mcts_max_depth": 1,
            "preprocess_resolution": 40,
            "seed": 0,
        }
    if quality == "precise":
        return {
            "method": "decomposition",
            "max_hulls": 16,
            "threshold": 0.20,
            "input_faces": 1400,
            "max_hull_vertices": 64,
            "resolution": 1200,
            "mcts_nodes": 8,
            "mcts_iterations": 60,
            "mcts_max_depth": 3,
            "preprocess_resolution": 60,
            "seed": 0,
        }
    return {
        "method": "decomposition",
        "max_hulls": 8,
        "threshold": 0.25,
        "input_faces": 1000,
        "max_hull_vertices": 64,
        "resolution": 1000,
        "mcts_nodes": 6,
        "mcts_iterations": 40,
        "mcts_max_depth": 2,
        "preprocess_resolution": 50,
        "seed": 0,
    }


def estimate_volume(mesh: trimesh.Trimesh) -> tuple[float, str]:
    """Return a conservative volume estimate in cubic metres plus provenance."""
    try:
        if mesh.is_volume and np.isfinite(mesh.volume):
            volume = abs(float(mesh.volume))
            if volume > 1e-9:
                return volume, "geometry_volume"
    except Exception:
        pass

    try:
        volume = abs(float(mesh.convex_hull.volume))
        if np.isfinite(volume) and volume > 1e-9:
            return volume, "convex_hull_volume"
    except Exception:
        pass

    return 0.001, "fallback_default"


def build_physics_metadata(
    mesh: trimesh.Trimesh,
    config: dict[str, Any] | None,
    collision_stats: dict[str, Any],
) -> dict[str, Any]:
    """Build portable rigid-body metadata from geometry + explicit/user config."""
    normalized = normalize_physics_config(config)
    volume_m3, volume_source = estimate_volume(mesh)

    density = normalized["density_kg_m3"]
    estimated_mass = max(0.01, min(100_000.0, volume_m3 * density))
    mass = (
        normalized["mass_kg"]
        if normalized["mass_mode"] == "manual"
        else estimated_mass
    )

    body_type = normalized["body_type"]
    if body_type == "auto":
        body_type = "dynamic"

    return {
        "schema_version": 1,
        "enabled": True,
        "readiness": "rigid",
        "provider_neutral": True,
        "body": {
            "type": body_type,
            "mass_kg": round(float(mass), 6),
            "density_kg_m3": round(float(density), 6),
            "center_of_mass": [0.0, 0.0, 0.0],
            "gravity_enabled": normalized["gravity_enabled"],
            "linear_damping": normalized["linear_damping"],
            "angular_damping": normalized["angular_damping"],
        },
        "material": {
            "static_friction": normalized["friction"],
            "dynamic_friction": normalized["friction"],
            "restitution": normalized["restitution"],
        },
        "collision": {
            "quality": normalized["collision_quality"],
            "method": collision_stats.get("method", "unknown"),
            "parts": int(collision_stats.get("parts", 0) or 0),
            "faces": int(collision_stats.get("faces", 0) or 0),
            "vertices": int(collision_stats.get("vertices", 0) or 0),
            "volume_ratio": collision_stats.get("volume_ratio"),
            "fallback": collision_stats.get("fallback"),
        },
        "deformable": {
            "enabled": False,
            "reason": "Not enabled in the rigid-body production path; no fake jiggle simulation is emitted.",
        },
        "provenance": {
            "mass": "user" if normalized["mass_mode"] == "manual" else "geometry_derived_estimate",
            "density": "user" if normalized["density_mode"] == "manual" else "project_default",
            "friction": "user",
            "restitution": "user",
            "volume_source": volume_source,
        },
        "capabilities": {
            "rigid_body": True,
            "collision": True,
            "joints": False,
            "soft_body": False,
            "gpu": False,
            "browser": True,
        },
    }
