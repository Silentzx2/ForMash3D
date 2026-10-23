from pathlib import Path
import sys

import pytest
from core.config import get_quality_config
from core.quality.evaluation import compare_meshes, quality_gate
import trimesh


def _pipeline_result_builder():
    if sys.version_info >= (3, 14):
        pytest.skip("Pipeline integration requires the documented Python 3.10 runtime.")
    from postprocess.pipeline import _build_result

    return _build_result


def test_quality_gate_uses_configured_drift_threshold():
    threshold = float(get_quality_config()["gate"]["max_native_mesh_normalized_drift"])

    assert quality_gate({"normalized_surface_drift": threshold})["passed"] is True
    assert quality_gate({"normalized_surface_drift": threshold + 0.01})["passed"] is False


def test_quality_gate_rejects_missing_or_invalid_metrics():
    assert quality_gate({})["status"] == "missing_metrics"
    assert quality_gate({"normalized_surface_drift": "not-a-number"})["status"] == "invalid_metrics"
    assert quality_gate({"normalized_surface_drift": float("nan")})["status"] == "invalid_metrics"


def test_mesh_comparison_uses_the_canonical_sampling_policy():
    config = get_quality_config()["surface_comparison"]
    mesh = trimesh.creation.box()

    report = compare_meshes(mesh, mesh)

    diagonal = float((mesh.bounds[1] - mesh.bounds[0]).dot(mesh.bounds[1] - mesh.bounds[0]) ** 0.5)
    assert report["sample_count"] == config["sample_count"]
    assert report["fscore_threshold"] == max(
        diagonal * config["fscore_diagonal_fraction"],
        config["minimum_fscore_threshold"],
    )


def test_failed_final_topology_gate_degrades_production_result(tmp_path: Path):
    build_result = _pipeline_result_builder()
    output_path = tmp_path / "game_ready.glb"
    output_path.touch()
    generated = {
        "game_ready": {"glb": str(output_path)},
        "lods": {},
        "textures": {},
        "final_topology_gate": {"passed_clean": False, "repair_decision": "full_repair"},
    }

    result = build_result(
        job_id="test-job",
        asset_dir=tmp_path,
        asset_name="test-asset",
        qa_report={},
        generated=generated,
        master_quality_report={"quality_gate": {"passed": True, "status": "ok"}},
    )

    assert result["production_status"] == "degraded"
    assert "final_topology_gate_failed" in result["degraded_reasons"]


def test_passed_final_topology_gate_does_not_degrade_result(tmp_path: Path):
    build_result = _pipeline_result_builder()
    output_path = tmp_path / "game_ready.glb"
    output_path.touch()
    collision_path = tmp_path / "collision.glb"
    collision_path.touch()
    generated = {
        "game_ready": {"glb": str(output_path)},
        "lods": {},
        "textures": {},
        "final_topology_gate": {"passed_clean": True},
        "collision": str(collision_path),
        "collision_stats": {"method": "decomposition", "fallback": None},
    }

    result = build_result(
        job_id="test-job",
        asset_dir=tmp_path,
        asset_name="test-asset",
        qa_report={},
        generated=generated,
        master_quality_report={"quality_gate": {"passed": True, "status": "ok"}},
    )

    assert result["production_status"] == "ready"


def test_collision_fallback_degrades_production_result(tmp_path: Path):
    build_result = _pipeline_result_builder()
    output_path = tmp_path / "game_ready.glb"
    output_path.touch()
    collision_path = tmp_path / "collision.glb"
    collision_path.touch()
    generated = {
        "game_ready": {"glb": str(output_path)},
        "lods": {},
        "textures": {},
        "final_topology_gate": {"passed_clean": True},
        "collision": str(collision_path),
        "collision_stats": {
            "method": "convex_hull",
            "requested_method": "decomposition",
            "fallback": "CoACD is unavailable; used a convex-hull fallback.",
        },
    }

    result = build_result(
        job_id="test-job",
        asset_dir=tmp_path,
        asset_name="test-asset",
        qa_report={},
        generated=generated,
        master_quality_report={"quality_gate": {"passed": True, "status": "ok"}},
    )

    assert result["production_status"] == "degraded"
    assert "collision_fallback_used" in result["degraded_reasons"]


def test_missing_final_topology_gate_degrades_production_result(tmp_path: Path):
    build_result = _pipeline_result_builder()
    output_path = tmp_path / "game_ready.glb"
    output_path.touch()
    generated = {"game_ready": {"glb": str(output_path)}, "lods": {}, "textures": {}}

    result = build_result(
        job_id="test-job",
        asset_dir=tmp_path,
        asset_name="test-asset",
        qa_report={},
        generated=generated,
        master_quality_report={"quality_gate": {"passed": True, "status": "ok"}},
    )

    assert result["production_status"] == "degraded"
    assert "final_topology_gate_unverified" in result["degraded_reasons"]


def test_missing_master_comparison_degrades_production_result(tmp_path: Path):
    build_result = _pipeline_result_builder()
    output_path = tmp_path / "game_ready.glb"
    output_path.touch()
    generated = {"game_ready": {"glb": str(output_path)}, "lods": {}, "textures": {}}

    result = build_result(
        job_id="test-job",
        asset_dir=tmp_path,
        asset_name="test-asset",
        qa_report={},
        generated=generated,
        master_quality_report={"status": "warn", "reason": "comparison failed"},
    )

    assert result["production_status"] == "degraded"
    assert "master_to_derivative_quality_unverified" in result["degraded_reasons"]


def test_measured_master_drift_failure_is_reported(tmp_path: Path):
    build_result = _pipeline_result_builder()
    output_path = tmp_path / "game_ready.glb"
    output_path.touch()
    generated = {"game_ready": {"glb": str(output_path)}, "lods": {}, "textures": {}}

    result = build_result(
        job_id="test-job",
        asset_dir=tmp_path,
        asset_name="test-asset",
        qa_report={},
        generated=generated,
        master_quality_report={
            "quality_gate": {"passed": False, "status": "ok"},
        },
    )

    assert result["production_status"] == "degraded"
    assert "master_to_derivative_quality_drift" in result["degraded_reasons"]
