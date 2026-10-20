"""Unit tests for topology gate service and quality thresholds."""

from pathlib import Path
import numpy as np
import pytest
import trimesh
import yaml

from postprocess.services import evaluate_topology_gate
from postprocess.services.gate import load_gate_thresholds, DEFAULT_THRESHOLDS


def test_gate_thresholds_config():
    """Verify backend/config/gate_thresholds.yaml exists and contains all required keys."""
    cfg_path = Path(__file__).resolve().parents[1] / "config" / "gate_thresholds.yaml"
    assert cfg_path.is_file(), f"Missing config file at {cfg_path}"

    with open(cfg_path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f)

    assert "topology_gate" in data
    cfg = data["topology_gate"]
    assert cfg["strict"] is False
    assert cfg["max_non_manifold_edges"] == 0
    assert cfg["max_non_manifold_vertices"] == 0
    assert cfg["max_holes"] == 0
    assert cfg["max_floater_ratio"] == 0.005
    assert cfg["max_degenerate_faces"] == 0
    assert cfg["min_aspect_ratio_p1"] == 0.05
    assert cfg["min_aspect_ratio_p5"] == 0.10


def test_clean_box_passes_clean():
    """Test on clean box -> passed_clean=True, skip_repair, skip_retopo=True."""
    box = trimesh.creation.box()
    v_before = box.vertices.copy()
    f_before = box.faces.copy()

    report = evaluate_topology_gate(box)

    assert report["passed_clean"] is True
    assert report["repair_decision"] == "skip_repair"
    assert report["skip_retopo"] is True
    assert report["violations"] == []
    assert report["metrics"]["max_hole_size"] == 0
    assert report["metrics"]["non_manifold_edges"] == 0
    assert report["metrics"]["non_manifold_vertices"] == 0
    assert report["metrics"]["degenerate_faces"] == 0

    # Ensure input mesh was not mutated
    assert np.array_equal(box.vertices, v_before)
    assert np.array_equal(box.faces, f_before)


def test_clean_box_with_skip_retopo_allowed_false():
    """Test with plan.skip_retopo_allowed=False -> skip_retopo=False."""
    box = trimesh.creation.box()
    plan = {"skip_retopo_allowed": False}

    report = evaluate_topology_gate(box, plan=plan)

    assert report["passed_clean"] is True
    assert report["repair_decision"] == "skip_repair"
    assert report["skip_retopo"] is False
    assert report["violations"] == []


def test_open_box_minimal_repair():
    """Test with open box (1 hole <= 50 vertices) -> minimal_repair, skip_retopo=False."""
    box = trimesh.creation.box()
    # Remove one face to create a 3-vertex hole
    open_box = trimesh.Trimesh(
        vertices=box.vertices.copy(),
        faces=box.faces[1:].copy(),
        process=False,
    )

    report = evaluate_topology_gate(open_box)

    assert report["passed_clean"] is False
    assert report["repair_decision"] == "minimal_repair"
    assert report["skip_retopo"] is False
    assert report["metrics"]["hole_count"] == 1
    assert 0 < report["metrics"]["max_hole_size"] <= 50
    assert any("hole_count" in v for v in report["violations"])


def test_tube_small_holes_minimal_repair():
    """Test revolving tube with small 16-vertex boundary loops -> minimal_repair."""
    tube = trimesh.creation.revolve([[1.0, -1.0], [1.0, 1.0]], sections=16)

    report = evaluate_topology_gate(tube)

    assert report["passed_clean"] is False
    assert report["repair_decision"] == "minimal_repair"
    assert report["skip_retopo"] is False
    assert report["metrics"]["hole_count"] == 2
    assert report["metrics"]["max_hole_size"] == 16


def test_tube_large_holes_full_repair():
    """Test revolving tube with 64-vertex boundary loops (> 50) -> full_repair."""
    tube = trimesh.creation.revolve([[1.0, -1.0], [1.0, 1.0]], sections=64)

    report = evaluate_topology_gate(tube)

    assert report["passed_clean"] is False
    assert report["repair_decision"] == "full_repair"
    assert report["skip_retopo"] is False
    assert report["metrics"]["max_hole_size"] == 64


def test_non_manifold_geometry_full_repair():
    """Test with non-manifold geometry -> full_repair."""
    box = trimesh.creation.box()
    # Add a fin sharing an existing edge (edge shared by 3 faces)
    extra_vert = np.array([[2.0, 2.0, 2.0]])
    new_vertices = np.vstack([box.vertices, extra_vert])
    extra_face = np.array([[box.faces[0, 0], box.faces[0, 1], len(box.vertices)]])
    new_faces = np.vstack([box.faces, extra_face])

    nm_mesh = trimesh.Trimesh(vertices=new_vertices, faces=new_faces, process=False)
    report = evaluate_topology_gate(nm_mesh)

    assert report["passed_clean"] is False
    assert report["repair_decision"] == "full_repair"
    assert report["skip_retopo"] is False
    assert any("non_manifold" in v for v in report["violations"])


def test_degenerate_faces_full_repair():
    """Test with degenerate faces -> full_repair."""
    verts = np.array([[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [2.0, 0.0, 0.0]])
    faces = np.array([[0, 1, 2]])
    degen_mesh = trimesh.Trimesh(vertices=verts, faces=faces, process=False)

    report = evaluate_topology_gate(degen_mesh)

    assert report["passed_clean"] is False
    assert report["repair_decision"] == "full_repair"
    assert report["skip_retopo"] is False
    assert any("degenerate_faces" in v for v in report["violations"])


def test_strict_mode_triggers_full_repair():
    """Test with strict=True -> any violation causes full_repair."""
    box = trimesh.creation.box()
    open_box = trimesh.Trimesh(
        vertices=box.vertices.copy(),
        faces=box.faces[1:].copy(),
        process=False,
    )

    # When strict=False, open_box gets minimal_repair
    rep_non_strict = evaluate_topology_gate(open_box, strict=False)
    assert rep_non_strict["repair_decision"] == "minimal_repair"

    # When strict=True, open_box must trigger full_repair
    rep_strict = evaluate_topology_gate(open_box, strict=True)
    assert rep_strict["passed_clean"] is False
    assert rep_strict["repair_decision"] == "full_repair"
    assert rep_strict["skip_retopo"] is False


def test_strict_mode_clean_box_passes():
    """Test with strict=True on clean box -> passes clean with skip_repair."""
    box = trimesh.creation.box()
    report = evaluate_topology_gate(box, strict=True)

    assert report["passed_clean"] is True
    assert report["repair_decision"] == "skip_repair"
    assert report["skip_retopo"] is True
    assert report["violations"] == []


def test_none_mesh_handling():
    """Test handling of None mesh input."""
    report = evaluate_topology_gate(None)
    assert report["passed_clean"] is False
    assert report["repair_decision"] == "full_repair"
    assert report["skip_retopo"] is False
    assert "Mesh is None" in report["violations"]
