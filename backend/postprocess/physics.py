"""Physics preparation helpers for generated ForMesh3D assets.

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


def _physics_quality_config() -> dict[str, Any]:
    try:
        from backend.core.config import get_quality_config
    except ImportError:  # pragma: no cover - package-layout variant
        from core.config import get_quality_config
    return get_quality_config()["physics"]


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
    physics_policy = _physics_quality_config()
    defaults = physics_policy["defaults"]
    limits = physics_policy["limits"]

    def value(*keys: str, default: Any = None) -> Any:
        for key in keys:
            if key in raw and raw[key] is not None:
                return raw[key]
        return default

    body_type = str(
        value("body_type", "bodyType", default=defaults["body_type"])
    ).lower()
    if body_type not in _ALLOWED_BODY_TYPES:
        body_type = str(defaults["body_type"])

    mass_mode = str(
        value("mass_mode", "massMode", default=defaults["mass_mode"])
    ).lower()
    if mass_mode not in _ALLOWED_MASS_MODES:
        mass_mode = str(defaults["mass_mode"])

    density_mode = str(
        value("density_mode", "densityMode", default=defaults["density_mode"])
    ).lower()
    if density_mode not in _ALLOWED_DENSITY_MODES:
        density_mode = str(defaults["density_mode"])

    default_collision_quality = str(physics_policy["default_collision_quality"])
    collision_quality = str(
        value(
            "collision_quality",
            "collisionQuality",
            default=default_collision_quality,
        )
    ).lower()
    if collision_quality not in physics_policy["collision_quality_profiles"]:
        collision_quality = default_collision_quality

    mass = min(
        float(limits["mass_kg"]["max"]),
        max(
            float(limits["mass_kg"]["min"]),
            _finite_number(value("mass_kg", "massKg", default=defaults["mass_kg"]), defaults["mass_kg"]),
        ),
    )
    density = min(
        float(limits["density_kg_m3"]["max"]),
        max(
            float(limits["density_kg_m3"]["min"]),
            _finite_number(
                value("density_kg_m3", "densityKgM3", default=defaults["density_kg_m3"]),
                defaults["density_kg_m3"],
            ),
        ),
    )
    friction = min(
        float(limits["friction"]["max"]),
        max(
            float(limits["friction"]["min"]),
            _finite_number(value("friction", default=defaults["friction"]), defaults["friction"]),
        ),
    )
    restitution = min(
        float(limits["restitution"]["max"]),
        max(
            float(limits["restitution"]["min"]),
            _finite_number(
                value("restitution", default=defaults["restitution"]),
                defaults["restitution"],
            ),
        ),
    )
    linear_damping = min(
        float(limits["linear_damping"]["max"]),
        max(
            float(limits["linear_damping"]["min"]),
            _finite_number(
                value("linear_damping", "linearDamping", default=defaults["linear_damping"]),
                defaults["linear_damping"],
            ),
        ),
    )
    angular_damping = min(
        float(limits["angular_damping"]["max"]),
        max(
            float(limits["angular_damping"]["min"]),
            _finite_number(
                value("angular_damping", "angularDamping", default=defaults["angular_damping"]),
                defaults["angular_damping"],
            ),
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
        "gravity_enabled": bool(
            value("gravity_enabled", "gravityEnabled", default=defaults["gravity_enabled"])
        ),
        "collision_quality": collision_quality,
        "deformation": "off",
    }


def collision_options_for_quality(quality: str) -> dict[str, Any]:
    """Map product-level quality to the existing collision service contract."""
    physics_config = _physics_quality_config()
    profiles = physics_config["collision_quality_profiles"]
    selected = quality if quality in profiles else physics_config["default_collision_quality"]
    return dict(profiles[selected])


def estimate_volume(mesh: trimesh.Trimesh) -> tuple[float, str]:
    """Return a conservative volume estimate in cubic metres plus provenance."""
    physics_policy = _physics_quality_config()
    minimum_valid_volume = float(
        physics_policy["thresholds"]["minimum_valid_volume_m3"]
    )
    try:
        if mesh.is_volume and np.isfinite(mesh.volume):
            volume = abs(float(mesh.volume))
            if volume > minimum_valid_volume:
                return volume, "geometry_volume"
    except Exception:
        pass

    try:
        volume = abs(float(mesh.convex_hull.volume))
        if np.isfinite(volume) and volume > minimum_valid_volume:
            return volume, "convex_hull_volume"
    except Exception:
        pass

    return float(physics_policy["defaults"]["fallback_volume_m3"]), "fallback_default"


def build_physics_metadata(
    mesh: trimesh.Trimesh,
    config: dict[str, Any] | None,
    collision_stats: dict[str, Any],
) -> dict[str, Any]:
    """Build portable rigid-body metadata from geometry + explicit/user config."""
    normalized = normalize_physics_config(config)
    volume_m3, volume_source = estimate_volume(mesh)

    density = normalized["density_kg_m3"]
    mass_limits = _physics_quality_config()["limits"]["mass_kg"]
    estimated_mass = max(
        float(mass_limits["min"]),
        min(float(mass_limits["max"]), volume_m3 * density),
    )
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
