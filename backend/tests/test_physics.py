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
    assert collision_options_for_quality("fast")["method"] == "decomposition"
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


def test_normalize_physics_config_accepts_frontend_camel_case():
    config = normalize_physics_config({
        "bodyType": "static",
        "massMode": "manual",
        "massKg": 12.5,
        "densityMode": "manual",
        "densityKgM3": 900,
        "friction": 0.8,
        "restitution": 0.3,
        "linearDamping": 0.2,
        "angularDamping": 0.4,
        "gravityEnabled": False,
        "collisionQuality": "precise",
    })

    assert config["body_type"] == "static"
    assert config["mass_mode"] == "manual"
    assert config["mass_kg"] == 12.5
    assert config["density_kg_m3"] == 900
    assert config["gravity_enabled"] is False
    assert config["collision_quality"] == "precise"


def test_collision_decomposition_invokes_coacd_and_rejects_silent_fallback(monkeypatch):
    import pytest
    from postprocess.schemas import CollisionOptions
    from postprocess.services import collision as collision_service

    # When coacd is None, it must raise RuntimeError and never silently return a single convex hull placeholder
    monkeypatch.setattr(collision_service, "coacd", None)
    mesh = trimesh.creation.box(extents=(1.0, 1.0, 1.0))
    with pytest.raises(RuntimeError, match="CoACD is required for collision decomposition"):
        collision_service.run_collision(mesh, CollisionOptions(method="decomposition"))


def test_collision_options_accepts_dict_or_schema():
    from postprocess.schemas import CollisionOptions
    from postprocess.services.collision import run_collision

    mesh = trimesh.creation.box(extents=(1.0, 1.0, 1.0))
    _, stats1 = run_collision(mesh, {"method": "convex_hull"})
    assert stats1["method"] == "convex_hull"

    _, stats2 = run_collision(mesh, CollisionOptions(method="convex_hull"))
    assert stats2["method"] == "convex_hull"
