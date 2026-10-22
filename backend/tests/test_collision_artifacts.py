import importlib.util
import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace

import numpy as np
import pytest
import trimesh

from postprocess import physics
from postprocess.schemas import CollisionOptions


_collision_package = "postprocess._isolated_services"
_collision_package_module = ModuleType(_collision_package)
_collision_package_module.__path__ = []
sys.modules.setdefault(_collision_package, _collision_package_module)
_collision_name = f"{_collision_package}.collision"
_collision_spec = importlib.util.spec_from_file_location(
    _collision_name,
    Path(__file__).parents[1] / "postprocess" / "services" / "collision.py",
)
collision = importlib.util.module_from_spec(_collision_spec)
sys.modules[_collision_name] = collision
_collision_spec.loader.exec_module(collision)


def _box():
    return trimesh.creation.box(extents=(1.0, 2.0, 3.0))


def test_collision_scene_does_not_mutate_render_mesh():
    render_mesh = _box()
    original_vertices = render_mesh.vertices.copy()
    original_faces = render_mesh.faces.copy()

    scene, stats = collision.run_collision(
        render_mesh, CollisionOptions(method="convex_hull")
    )

    assert np.array_equal(render_mesh.vertices, original_vertices)
    assert np.array_equal(render_mesh.faces, original_faces)
    assert scene.geometry
    assert stats["method"] == "convex_hull"
    assert stats["requested_method"] == "convex_hull"
    assert stats["fallback"] is None


def test_unavailable_coacd_uses_and_reports_convex_hull(monkeypatch):
    monkeypatch.setattr(collision, "coacd", None)

    scene, stats = collision.run_collision(
        _box(), CollisionOptions(method="decomposition", input_faces=0)
    )

    assert scene.geometry
    assert stats["method"] == "convex_hull"
    assert stats["requested_method"] == "decomposition"
    assert "CoACD is unavailable" in stats["fallback"]


def test_failed_decomposition_uses_and_reports_convex_hull(monkeypatch):
    class FailingCoacd:
        @staticmethod
        def Mesh(vertices, faces):
            return object()

        @staticmethod
        def run_coacd(*args, **kwargs):
            raise ValueError("decomposition rejected input")

    monkeypatch.setattr(collision, "coacd", FailingCoacd)
    render_mesh = _box()
    original_vertices = render_mesh.vertices.copy()
    original_faces = render_mesh.faces.copy()

    scene, stats = collision.run_collision(
        render_mesh, CollisionOptions(method="decomposition", input_faces=0)
    )

    assert scene.geometry
    assert np.array_equal(render_mesh.vertices, original_vertices)
    assert np.array_equal(render_mesh.faces, original_faces)
    assert stats["method"] == "convex_hull"
    assert stats["requested_method"] == "decomposition"
    assert "ValueError" in stats["fallback"]
    assert "decomposition rejected input" in stats["fallback"]
    assert "convex-hull fallback" in stats["fallback"]


def test_cancellation_is_not_reported_as_a_fallback(monkeypatch):
    monkeypatch.setattr(
        collision,
        "coacd",
        SimpleNamespace(Mesh=lambda vertices, faces: object()),
    )

    with pytest.raises(InterruptedError, match="cancelled"):
        collision.run_collision(
            _box(),
            CollisionOptions(method="decomposition", input_faces=0),
            cancel_checker=lambda: True,
        )


def test_physics_metadata_reports_actual_collision_method_and_fallback():
    stats = {
        "method": "convex_hull",
        "requested_method": "decomposition",
        "parts": 1,
        "faces": 12,
        "vertices": 8,
        "fallback": "CoACD is unavailable; used a convex-hull fallback.",
    }

    metadata = physics.build_physics_metadata(
        _box(), {"collision_quality": "precise"}, stats
    )

    assert metadata["collision"]["quality"] == "precise"
    assert metadata["collision"]["method"] == "convex_hull"
    assert metadata["collision"]["fallback"] == stats["fallback"]


@pytest.mark.parametrize("quality", ["fast", "balanced", "precise"])
def test_collision_quality_maps_to_decomposition_options(quality):
    options = physics.collision_options_for_quality(quality)

    assert options["method"] == "decomposition"
    assert options["max_hulls"] > 0
    assert options["max_hull_vertices"] > 0
    assert options["input_faces"] > 0
