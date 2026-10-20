"""GATE A integration test:
Verifies full flow: request -> planner -> fallback/seeds -> candidate scoring -> postprocess -> quality report with plan, seed_scores, quality_tier; master sha256 unchanged.
"""
import copy
import hashlib
import json
from pathlib import Path
import pytest
import trimesh

from core.planner import plan_generation
from core.scheduler.multiprocess_scheduler import _score_and_select
from postprocess.pipeline import run_postprocess_job


def test_gate_a_e2e_flow(tmp_path, monkeypatch):
    monkeypatch.setenv("ALLOW_LOCAL_SERVER_PATH_INPUTS", "true")
    storage_root = tmp_path / "storage"
    storage_root.mkdir()
    monkeypatch.setattr("postprocess.pipeline._storage_root", lambda: storage_root)

    # 1. Planner invocation
    mock_runtime = {
        "has_cuda": True,
        "cuda_device_name": "NVIDIA RTX 4090",
        "total_vram_gb": 24.0,
        "free_vram_gb": 24.0,
        "total_ram_gb": 32.0,
        "free_ram_gb": 16.0,
        "peak_vram_gb_last_run": None,
        "installed_adapters": ["Trellis2ImageToRawMeshAdapter", "Hunyuan3DShapeV21ImageToRawMeshAdapter"],
        "enabled_adapters": ["trellis2_image_to_raw_mesh", "hunyuan3d_shape_v21_image_to_raw_mesh"],
        "license_optins": {},
        "torch_version": "2.4.0",
        "cuda_version": "12.4",
    }
    request_data = {
        "mesh_style": "auto",
        "requested_quality": "balanced",
        "object_type": "general",
    }
    plan = plan_generation(request_data, mock_runtime)
    assert plan["adapter"] == "trellis2_image_to_raw_mesh"
    assert "reasons" in plan
    assert "warnings" in plan

    # 2. Fake generation candidates and scoring (G2)
    cube_a = trimesh.creation.box(extents=(1.0, 1.0, 1.0))
    cube_b = trimesh.creation.box(extents=(1.2, 1.2, 1.2))

    path_a = tmp_path / "cand_0.glb"
    path_b = tmp_path / "cand_1.glb"
    canonical_raw = tmp_path / "canonical_raw.glb"

    cube_a.export(path_a)
    cube_b.export(path_b)

    candidates = [
        {"candidate_id": 0, "seed": 42891, "mesh_path": str(path_a), "selected": False},
        {"candidate_id": 1, "seed": 44228, "mesh_path": str(path_b), "selected": False},
    ]

    best_idx, scored_candidates = _score_and_select(
        candidates,
        canonical_dest_path=str(canonical_raw),
        early_stop_threshold=0.85,
    )
    assert canonical_raw.exists()
    assert best_idx in (0, 1)
    seed_scores = [c["score"] for c in scored_candidates]
    assert len(seed_scores) == 2

    # 3. Secure master sha256
    initial_raw_bytes = canonical_raw.read_bytes()
    initial_raw_sha256 = hashlib.sha256(initial_raw_bytes).hexdigest()

    # 4. Run post-processing pipeline
    job_id = "test_gate_a_001"
    generation_result = {
        "output_mesh_path": str(canonical_raw),
        "seed_scores": seed_scores,
        "plan": plan,
    }
    job_inputs = {
        "asset_name": "gate_a_cube",
        "plan": plan,
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

    # 5. Assertions for Gate A
    asset_dir = storage_root / "gate_a_cube_test_gate_a_001"
    master_file = asset_dir / "master" / "source.glb"
    assert master_file.exists()
    # Master must be byte-for-byte identical
    assert hashlib.sha256(master_file.read_bytes()).hexdigest() == initial_raw_sha256

    # Quality report checks
    report_file = asset_dir / "metadata" / "quality_report.json"
    assert report_file.exists()
    report = json.loads(report_file.read_text(encoding="utf-8"))

    assert "plan" in report
    assert report["plan"]["adapter"] == "trellis2_image_to_raw_mesh"
    assert "reasons" in report["plan"]
    assert "warnings" in report["plan"]
    assert "seed_scores" in report
    assert report["seed_scores"] == seed_scores
    assert "quality_tier" in report
    assert report["quality_tier"] in ("sharp", "clean", "needs_review")
