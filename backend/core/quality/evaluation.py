
"""Lightweight mesh quality diagnostics for ForMash3D."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Optional, Sequence, Tuple

import numpy as np
import trimesh

try:
    from scipy.spatial import cKDTree
except Exception:
    cKDTree = None


def load_mesh(path: str | Path) -> trimesh.Trimesh:
    loaded = trimesh.load(path, process=False)
    if isinstance(loaded, trimesh.Scene):
        meshes = [g for g in loaded.geometry.values() if isinstance(g, trimesh.Trimesh) and len(g.faces)]
        if not meshes:
            raise ValueError(f"No mesh geometry found in {path}")
        return meshes[0] if len(meshes) == 1 else trimesh.util.concatenate(meshes)
    if not isinstance(loaded, trimesh.Trimesh):
        raise ValueError(f"Unsupported mesh object in {path}")
    return loaded


def sample_surface(mesh: trimesh.Trimesh, count: int = 4096, seed: int = 0) -> np.ndarray:
    if len(mesh.faces) == 0:
        raise ValueError("Cannot sample an empty mesh.")
    previous = np.random.get_state()
    try:
        np.random.seed(seed)
        points, _ = trimesh.sample.sample_surface_even(mesh, count)
        if len(points) < count:
            points = trimesh.sample.sample_surface(mesh, count)[0]
        return np.asarray(points, dtype=np.float32)
    finally:
        np.random.set_state(previous)


def _nearest_distances(source: np.ndarray, target: np.ndarray) -> np.ndarray:
    if cKDTree is not None:
        return np.asarray(cKDTree(target).query(source, workers=-1)[0], dtype=np.float32)
    distances = np.sqrt(((source[:, None, :] - target[None, :, :]) ** 2).sum(axis=2))
    return distances.min(axis=1).astype(np.float32)


def chamfer_distance(source_points: np.ndarray, target_points: np.ndarray) -> float:
    a = _nearest_distances(source_points, target_points)
    b = _nearest_distances(target_points, source_points)
    return float((np.mean(a ** 2) + np.mean(b ** 2)) * 0.5)


def f_score(source_points: np.ndarray, target_points: np.ndarray, threshold: float) -> float:
    precision = float(np.mean(_nearest_distances(source_points, target_points) <= threshold))
    recall = float(np.mean(_nearest_distances(target_points, source_points) <= threshold))
    return float(0.0 if precision + recall == 0.0 else 2.0 * precision * recall / (precision + recall))


def _local_density(points: np.ndarray, k: int = 16) -> np.ndarray:
    if len(points) <= 1:
        return np.ones(len(points), dtype=np.float32)
    if cKDTree is None:
        return np.ones(len(points), dtype=np.float32)
    k = max(2, min(k, len(points) - 1))
    distances = cKDTree(points).query(points, k=k + 1, workers=-1)[0]
    scale = np.maximum(distances[:, -1], 1e-8)
    return (1.0 / (scale ** 3)).astype(np.float32)


def density_aware_chamfer_distance(source_points: np.ndarray, target_points: np.ndarray) -> float:
    a = _nearest_distances(source_points, target_points) ** 2
    b = _nearest_distances(target_points, source_points) ** 2
    wa = _local_density(source_points)
    wb = _local_density(target_points)
    wa /= max(float(np.mean(wa)), 1e-8)
    wb /= max(float(np.mean(wb)), 1e-8)
    return float(0.5 * (np.mean(a * wa) + np.mean(b * wb)))


def compare_meshes(
    reference: trimesh.Trimesh,
    candidate: trimesh.Trimesh,
    sample_count: int = 4096,
    fscore_threshold: Optional[float] = None,
    seed: int = 0,
) -> dict[str, Any]:
    reference_points = sample_surface(reference, sample_count, seed)
    candidate_points = sample_surface(candidate, sample_count, seed)
    diagonal = float(np.linalg.norm(reference.bounds[1] - reference.bounds[0]))
    threshold = float(fscore_threshold if fscore_threshold is not None else max(diagonal * 0.005, 1e-5))
    cd = chamfer_distance(reference_points, candidate_points)
    normalized_drift = float((max(cd, 0.0) ** 0.5) / max(diagonal, 1e-8))
    return {
        "status": "ok",
        "sample_count": int(sample_count),
        "fscore_threshold": threshold,
        "chamfer_distance": cd,
        "normalized_surface_drift": normalized_drift,
        "density_aware_chamfer_distance": density_aware_chamfer_distance(reference_points, candidate_points),
        "f_score": f_score(reference_points, candidate_points, threshold),
        "reference_faces": int(len(reference.faces)),
        "candidate_faces": int(len(candidate.faces)),
        "reference_vertices": int(len(reference.vertices)),
        "candidate_vertices": int(len(candidate.vertices)),
    }


def compare_paths(reference_path: str | Path, candidate_path: str | Path, **kwargs: Any) -> dict[str, Any]:
    return compare_meshes(load_mesh(reference_path), load_mesh(candidate_path), **kwargs)


def quality_gate(report: dict[str, Any], max_normalized_drift: float = 0.15) -> dict[str, Any]:
    drift = float(report.get("normalized_surface_drift", max(report.get("chamfer_distance", 0.0), 0.0) ** 0.5))
    return {
        "passed": drift <= float(max_normalized_drift),
        "normalized_surface_drift": drift,
        "threshold": float(max_normalized_drift),
    }


def compare_mesh_volumes(
    baseline_mesh: trimesh.Trimesh,
    candidate_mesh: trimesh.Trimesh,
) -> dict[str, Any]:
    """Fast diagnostic check for mesh deformation without slow headless rendering."""
    base_vol = baseline_mesh.volume
    cand_vol = candidate_mesh.volume
    if base_vol == 0:
        return {"status": "blocked", "reason": "Baseline mesh has 0 volume."}
    
    vol_drift = abs(base_vol - cand_vol) / base_vol
    
    return {
        "status": "ok",
        "volume_drift": float(vol_drift),
        "interpretation": "diagnostic_only_without_ground_truth",
    }


def _load_run_metadata(asset_dir: str | Path) -> tuple[dict[str, Any], dict[str, Any]]:
    root = Path(asset_dir)
    job_path = root / "metadata" / "job.json"
    quality_path = root / "metadata" / "quality_report.json"
    if not job_path.is_file():
        raise FileNotFoundError(f"Missing benchmark metadata: {job_path}")
    job = json.loads(job_path.read_text(encoding="utf-8"))
    quality = json.loads(quality_path.read_text(encoding="utf-8")) if quality_path.is_file() else {}
    return job, quality


def compare_model_runs(
    baseline_asset_dir: str | Path,
    candidate_asset_dir: str | Path,
    *,
    reference_mesh: str | Path | None = None,
    sample_count: int = 4096,
    render_output_dir: str | Path | None = None,
) -> dict[str, Any]:
    """Controlled A/B comparison requiring identical input hashes and protocol."""
    baseline_job, baseline_quality = _load_run_metadata(baseline_asset_dir)
    candidate_job, candidate_quality = _load_run_metadata(candidate_asset_dir)
    baseline_hashes = baseline_job.get("input_sha256") or {}
    candidate_hashes = candidate_job.get("input_sha256") or {}
    if baseline_hashes != candidate_hashes:
        return {
            "status": "blocked",
            "reason": "baseline and candidate do not have identical input hashes",
        }

    protocol_keys = ("target_polycount", "texture_resolution")
    if any(baseline_job.get(key) != candidate_job.get(key) for key in protocol_keys):
        return {
            "status": "blocked",
            "reason": "baseline and candidate do not share the same production protocol",
            "protocol_keys": protocol_keys,
        }

    baseline_master = Path(baseline_asset_dir) / "master" / "source.glb"
    candidate_master = Path(candidate_asset_dir) / "master" / "source.glb"
    result: dict[str, Any] = {
        "status": "ok",
        "baseline_model": baseline_job.get("model_id"),
        "candidate_model": candidate_job.get("model_id"),
        "input_sha256": baseline_hashes,
        "protocol": {key: baseline_job.get(key) for key in protocol_keys},
        "baseline_quality": baseline_quality.get("after_postprocess"),
        "candidate_quality": candidate_quality.get("after_postprocess"),
        "evaluation_mode": "diagnostic_only_no_ground_truth",
    }

    result["master_to_master_diagnostic"] = compare_paths(
        baseline_master,
        candidate_master,
        sample_count=max(256, sample_count),
    )

    if reference_mesh:
        result["baseline_reference"] = compare_paths(
            reference_mesh,
            baseline_master,
            sample_count=max(256, sample_count),
        )
        result["candidate_reference"] = compare_paths(
            reference_mesh,
            candidate_master,
            sample_count=max(256, sample_count),
        )
        result["evaluation_mode"] = "reference"

    if render_output_dir:
        result["render_comparison"] = compare_mesh_volumes(
            load_mesh(baseline_master),
            load_mesh(candidate_master)
        )

    return result
