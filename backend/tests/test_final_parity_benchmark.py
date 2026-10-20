"""Tests for final parity benchmark and scorecard generation (Task 3D)."""
from __future__ import annotations

import json
from pathlib import Path
import pytest

import sys
REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from scripts.run_final_parity_benchmark import (
    AUTHORITATIVE_SCORECARD_ENTRIES,
    build_synthetic_shapes,
    run_benchmark,
)


def test_synthetic_test_shapes_structure():
    """Verify all 4 required synthetic shapes exist with proper structure."""
    shapes = build_synthetic_shapes()
    required_shapes = ["cube", "sphere", "cylinder", "mechanical_prop"]
    for name in required_shapes:
        assert name in shapes, f"Missing required shape: {name}"
        item = shapes[name]
        assert "master" in item
        assert "raw" in item
        assert "target_faces" in item
        assert len(item["master"].faces) > 0
        assert len(item["raw"].faces) > 0


def test_run_benchmark_metrics():
    """Verify run_benchmark produces valid metrics across all stages."""
    benchmark = run_benchmark()
    assert "summary" in benchmark
    assert "results" in benchmark
    summary = benchmark["summary"]
    assert summary["shapes_evaluated"] == 4
    assert summary["now_total_holes"] == 0
    assert summary["watertight_rate"] == 1.0
    assert summary["pbr_validation_pass_rate"] == 1.0
    assert summary["now_avg_feature_edge_retention"] >= 0.90
    assert summary["now_avg_uv_utilization"] >= 0.60
    assert summary["master_immutability"] == "verified"

    results = benchmark["results"]
    for name in ["cube", "sphere", "cylinder", "mechanical_prop"]:
        assert name in results
        res = results[name]
        assert res["baseline"]["hole_count"] > 0
        assert res["postprocessed_now"]["hole_count"] == 0
        assert res["postprocessed_now"]["is_watertight"] is True
        assert res["postprocessed_now"]["pbr_valid"] is True
        assert res["postprocessed_now"]["uv_utilization"] > 0.60


def test_parity_scorecard_file_contents():
    """Verify parity_scorecard.json contains authoritative non-null entries."""
    scorecard_file = REPO_ROOT / "parity_scorecard.json"
    assert scorecard_file.exists()
    data = json.loads(scorecard_file.read_text(encoding="utf-8"))
    assert "scorecard" in data
    scorecard = data["scorecard"]
    required_rows = [
        "sharpness",
        "topology_cleanliness",
        "uv_quality",
        "texture_quality",
        "speed",
        "failure_rate",
    ]
    required_cols = ["ForMash3D", "Tripo", "Meshy", "Hyper3D"]
    for row in required_rows:
        assert row in scorecard, f"Missing row {row} in scorecard"
        for col in required_cols:
            val = scorecard[row].get(col)
            assert val is not None and len(str(val)) > 0, f"Null or empty value for {row}:{col}"
