"""Unit tests for Hunyuan3D presets, targeted hole repair, and seed scoring."""

from pathlib import Path
import numpy as np
import pytest
import trimesh
import yaml

from postprocess.services.hole_repair import repair_holes_targeted
from core.scheduler.seed_scorer import score_seed_candidate, select_best_candidate


def test_hunyuan_presets_config():
    """Verify hunyuan_presets.yaml configuration exists and matches specification."""
    cfg_path = Path(__file__).resolve().parents[1] / "config" / "hunyuan_presets.yaml"
    assert cfg_path.is_file(), f"Missing config file at {cfg_path}"

    with open(cfg_path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f)

    presets = data.get("presets", data)
    assert "fast" in presets
    assert "balanced" in presets
    assert "high" in presets

    fast = presets["fast"]
    assert fast["octree_resolution"] == 380
    assert fast["num_inference_steps"] == 30
    assert fast["guidance_scale"] == 5.0
    assert fast["vram_budget_gb"] == 8.0

    balanced = presets["balanced"]
    assert balanced["octree_resolution"] == 512
    assert balanced["num_inference_steps"] == 50
    assert balanced["guidance_scale"] == 7.5
    assert balanced["vram_budget_gb"] == 10.0

    high = presets["high"]
    assert high["octree_resolution"] == 512
    assert high["num_inference_steps"] == 100
    assert high["guidance_scale"] == 7.5
    assert high["vram_budget_gb"] == 14.0

    hole_repair = data.get("hole_repair", data)
    assert hole_repair["max_hole_perimeter"] == 0.5
    assert hole_repair["max_hole_vertices"] == 50


def test_seed_scoring_config():
    """Verify seed_scoring.yaml configuration matches specifications."""
    cfg_path = Path(__file__).resolve().parents[1] / "config" / "seed_scoring.yaml"
    assert cfg_path.is_file(), f"Missing config file at {cfg_path}"

    with open(cfg_path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f)

    cfg = data.get("seed_scoring", data)
    weights = cfg["weights"]
    ranges = cfg["ranges"]

    assert weights["feature_edge_retention"] == 0.40
    assert weights["hole_count"] == 0.20
    assert weights["component_floater_ratio"] == 0.15
    assert weights["degenerate_face_ratio"] == 0.10
    assert weights["triangle_count"] == 0.05
    assert weights["aspect_ratio_p5"] == 0.10
    assert pytest.approx(sum(weights.values()), rel=1e-5) == 1.0

    assert ranges["hole_count"] == [0, 50]
    assert ranges["component_floater_ratio"] == [0.0, 0.2]
    assert ranges["degenerate_face_ratio"] == [0.0, 0.05]
    assert ranges["triangle_count"] == [1000, 1000000]
    assert ranges["aspect_ratio_p5"] == [0.0, 1.0]

    assert cfg["early_stop_score"] == 0.85


def test_watertight_mesh_untouched():
    """Closed watertight mesh is untouched by repair_holes_targeted."""
    box = trimesh.creation.box()
    assert box.is_watertight

    repaired, stats = repair_holes_targeted(box, max_hole_vertices=50)

    assert stats["holes_filled"] == 0
    assert stats["holes_remaining"] == 0
    assert stats["boundary_edges_before"] == 0
    assert stats["boundary_edges_after"] == 0
    assert repaired.is_watertight
    assert np.array_equal(repaired.vertices, box.vertices)
    assert np.array_equal(repaired.faces, box.faces)


def test_hole_repair_open_box():
    """Hole repair on an open mesh closes the hole and leaves non-hole geometry untouched."""
    box = trimesh.creation.box()
    # Remove 1 face (triangle hole)
    open_box = trimesh.Trimesh(vertices=box.vertices.copy(), faces=box.faces[1:].copy(), process=False)
    assert not open_box.is_watertight

    repaired, stats = repair_holes_targeted(open_box, max_hole_vertices=50)

    assert stats["holes_filled"] == 1
    assert stats["holes_remaining"] == 0
    assert stats["boundary_edges_before"] == 3
    assert stats["boundary_edges_after"] == 0
    assert repaired.is_watertight

    # Verify non-hole geometry is preserved completely untouched
    assert np.array_equal(repaired.vertices, open_box.vertices)
    assert np.array_equal(repaired.faces[:len(open_box.faces)], open_box.faces)
    assert len(repaired.faces) == len(open_box.faces) + 1


def test_hole_repair_tube_and_threshold():
    """Hole repair closes tube ends with large max_hole_vertices and skips with small threshold."""
    tube = trimesh.creation.revolve([[1.0, -1.0], [1.0, 1.0]], sections=16)
    assert not tube.is_watertight

    # Case 1: max_hole_vertices=50 covers the 16-vertex loops -> fills both ends
    repaired, stats = repair_holes_targeted(tube, max_hole_vertices=50)
    assert stats["holes_filled"] == 2
    assert stats["holes_remaining"] == 0
    assert stats["boundary_edges_before"] == 32
    assert stats["boundary_edges_after"] == 0
    assert repaired.is_watertight
    assert np.array_equal(repaired.vertices, tube.vertices)
    assert np.array_equal(repaired.faces[:len(tube.faces)], tube.faces)

    # Case 2: max_hole_vertices=10 is smaller than 16 -> leaves holes untouched
    repaired_small, stats_small = repair_holes_targeted(tube, max_hole_vertices=10)
    assert stats_small["holes_filled"] == 0
    assert stats_small["holes_remaining"] == 2
    assert stats_small["boundary_edges_before"] == 32
    assert stats_small["boundary_edges_after"] == 32
    assert not repaired_small.is_watertight
    assert np.array_equal(repaired_small.faces, tube.faces)


def test_seed_scoring_formula():
    """Seed scoring formula with fixed range normalization and metric inversion."""
    perfect_metrics = {
        "feature_edge_retention": 1.0,
        "hole_count": 0,
        "component_floater_ratio": 0.0,
        "degenerate_face_ratio": 0.0,
        "triangle_count": 1000,
        "aspect_ratio_p5": 0.0,
    }
    score_perf = score_seed_candidate(perfect_metrics)
    assert score_perf == 1.0

    worst_metrics = {
        "feature_edge_retention": 0.0,
        "hole_count": 50,
        "component_floater_ratio": 0.2,
        "degenerate_face_ratio": 0.05,
        "triangle_count": 1000000,
        "aspect_ratio_p5": 1.0,
    }
    score_worst = score_seed_candidate(worst_metrics)
    assert score_worst == 0.0

    # Test clamping outside range bounds
    clamped_metrics = {
        "feature_edge_retention": 1.5,   # clamps to 1.0
        "hole_count": 100,              # clamps to 50 (worst)
        "component_floater_ratio": 0.5, # clamps to 0.2 (worst)
        "degenerate_face_ratio": 0.1,   # clamps to 0.05 (worst)
        "triangle_count": 500,          # clamps to 1000 (best)
        "aspect_ratio_p5": -0.1,        # clamps to 0.0 (best)
    }
    # Expected: 0.40*1.0 + 0.20*0.0 + 0.15*0.0 + 0.10*0.0 + 0.05*1.0 + 0.10*1.0 = 0.55
    score_clamped = score_seed_candidate(clamped_metrics)
    assert pytest.approx(score_clamped, rel=1e-4) == 0.55


def test_seed_scorer_early_stopping():
    """Early stopping triggers when candidate score >= 0.85."""
    cand0 = {
        "feature_edge_retention": 0.95,
        "hole_count": 0,
        "component_floater_ratio": 0.0,
        "degenerate_face_ratio": 0.0,
        "triangle_count": 5000,
        "aspect_ratio_p5": 0.02,
    }
    cand1 = {
        "feature_edge_retention": 0.99,
        "hole_count": 0,
        "component_floater_ratio": 0.0,
        "degenerate_face_ratio": 0.0,
        "triangle_count": 2000,
        "aspect_ratio_p5": 0.01,
    }

    score0 = score_seed_candidate(cand0)
    assert score0 >= 0.85

    # Early stop should return candidate 0 immediately and NOT evaluate candidate 1
    best_idx, best_score, records = select_best_candidate([cand0, cand1], early_stop_threshold=0.85)
    assert best_idx == 0
    assert best_score == score0
    assert len(records) == 1
    assert records[0]["early_stop"] is True


def test_seed_scorer_tie_breaking():
    """Breaks ties within 2% composite score preferring higher feature_edge_retention, then lower triangle_count."""
    # c_a: higher composite score (0.810), but lower feature_edge_retention (0.70)
    c_a = {
        "feature_edge_retention": 0.70,
        "hole_count": 0,
        "component_floater_ratio": 0.05,
        "degenerate_face_ratio": 0.01,
        "triangle_count": 50000,
        "aspect_ratio_p5": 0.1,
    }
    # c_b: slightly lower composite score (0.806, diff=0.004 <= 0.02), but higher feature_edge_retention (0.73)
    c_b = {
        "feature_edge_retention": 0.73,
        "hole_count": 4,
        "component_floater_ratio": 0.05,
        "degenerate_face_ratio": 0.01,
        "triangle_count": 50000,
        "aspect_ratio_p5": 0.1,
    }

    s_a = score_seed_candidate(c_a)
    s_b = score_seed_candidate(c_b)
    assert s_a > s_b
    assert (s_a - s_b) <= 0.02

    # Since threshold=0.95 prevents early stop, both are evaluated. c_b should win due to higher feature_edge_retention!
    best_idx, best_score, records = select_best_candidate([c_a, c_b], early_stop_threshold=0.95)
    assert len(records) == 2
    assert best_idx == 1  # candidate c_b wins tie-break!
    assert best_score == s_b

    # Secondary tie breaker: lower triangle_count when feature_edge_retention is equal
    c_c = {
        "feature_edge_retention": 0.70,
        "hole_count": 0,
        "component_floater_ratio": 0.05,
        "degenerate_face_ratio": 0.01,
        "triangle_count": 20000,  # fewer triangles than c_a (50000)
        "aspect_ratio_p5": 0.1,
    }
    best_idx2, _, _ = select_best_candidate([c_a, c_c], early_stop_threshold=0.95)
    assert best_idx2 == 1  # c_c has fewer triangles
