from __future__ import annotations

import trimesh

from postprocess.physics import build_physics_metadata, collision_options_for_quality, normalize_physics_config


def test_normalize_physics_config_bounds_and_defaults():
    config = normalize_physics_config({
        "body_type": "dynamic",
        "mass_mode": "manual",
        "mass_kg": -5,
        "friction": 9,
        "restitution": -1,
        "collision_quality": "unknown",
    })
    assert config["body_type"] == "dynamic"
    assert config["mass_kg"] == 0.01
    assert config["friction"] == 2.0
    assert config["restitution"] == 0.0
    assert config["collision_quality"] == "balanced"


def test_collision_quality_maps_to_existing_collision_contract():
    assert collision_options_for_quality("fast")["method"] == "convex_hull"
    assert collision_options_for_quality("balanced")["method"] == "decomposition"
    assert collision_options_for_quality("precise")["method"] == "decomposition"


def test_physics_metadata_marks_estimated_properties():
    mesh = trimesh.creation.box(extents=(1.0, 1.0, 1.0))
    metadata = build_physics_metadata(
        mesh,
        {"body_type": "auto", "mass_mode": "auto", "density_mode": "auto"},
        {"method": "convex_hull", "parts": 1, "faces": 12, "vertices": 8},
    )

    assert metadata["enabled"] is True
    assert metadata["readiness"] == "rigid"
    assert metadata["body"]["type"] == "dynamic"
    assert metadata["provenance"]["mass"] == "geometry_derived_estimate"
    assert metadata["capabilities"]["soft_body"] is False
