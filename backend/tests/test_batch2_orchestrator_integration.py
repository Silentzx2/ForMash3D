"""Integration tests for Batch 2 (Tasks 2A - 2E):
- Topology gate integration in run_postprocess_job
- UV backend resolver integration
- Memory-safe decimation integration
- Master immutability preservation check
"""
import hashlib
import json
import shutil
import tempfile
from pathlib import Path
import pytest
import trimesh

from postprocess.pipeline import run_postprocess_job


def test_batch2_end_to_end_postprocess_integration(tmp_path, monkeypatch):
    monkeypatch.setenv("ALLOW_LOCAL_SERVER_PATH_INPUTS", "true")
    # Route storage root to temporary directory
    storage_root = tmp_path / "storage"
    storage_root.mkdir()
    monkeypatch.setattr("postprocess.pipeline._storage_root", lambda: storage_root)

    # Create a clean cube mesh and save as synthetic generation output
    cube = trimesh.creation.box(extents=(2.0, 2.0, 2.0))
    raw_mesh_file = tmp_path / "raw_cube.glb"
    cube.export(raw_mesh_file)
    initial_raw_sha256 = hashlib.sha256(raw_mesh_file.read_bytes()).hexdigest()

    job_id = "test_job_batch2_001"
    generation_result = {
        "output_mesh_path": str(raw_mesh_file),
        "plan": {
            "adapter": "trellis2_image_to_raw_mesh",
            "uv_backend": "auto",
            "skip_retopo_allowed": True,
        },
    }
    job_inputs = {
        "asset_name": "clean_cube",
        "target_polycount": 12,
        "auto_optimize": False,
        "texture_enabled": False,
        "physics_enabled": False,
        "generateLOD": False,
        "bake_normal_maps": False,
    }

    result = run_postprocess_job(
        job_id=job_id,
        generation_result=generation_result,
        job_inputs=job_inputs,
    )

    # 1. Verify master was created and has identical sha256 to raw output
    asset_dir = storage_root / "clean_cube_test_job_batch2_001"
    master_file = asset_dir / "master" / "source.glb"
    assert master_file.exists()
    assert hashlib.sha256(master_file.read_bytes()).hexdigest() == initial_raw_sha256

    # 2. Verify quality_report.json exists and contains topology_gate and pbr_validation
    quality_report_file = asset_dir / "metadata" / "quality_report.json"
    assert quality_report_file.exists()
    quality_data = json.loads(quality_report_file.read_text())

    assert "topology_gate" in quality_data
    gate_data = quality_data["topology_gate"]
    assert gate_data["passed_clean"] is True
    assert gate_data["repair_decision"] == "skip_repair"
    assert gate_data["skip_retopo"] is True

    # 3. Verify repair was skipped due to gate
    assert quality_data["repair"]["method"] == "gate_skipped_clean"
    assert quality_data["repair"]["skipped"] is True

    # 4. Verify retopo was bypassed due to gate
    assert quality_data["retopo"]["status"] == "skipped"
    assert "bypassed" in quality_data["retopo"]["reason"].lower()

    # 5. Verify pbr_validation was performed on game_ready output
    assert "pbr_validation" in quality_data
    assert quality_data["pbr_validation"]["valid"] is True

    # 6. Verify game-ready asset exists
    game_ready_glb = asset_dir / "game_ready" / "clean_cube_test_job_batch2_001.glb"
    assert game_ready_glb.exists()
