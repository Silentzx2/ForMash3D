
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


def render_multi_view(
    mesh: trimesh.Trimesh,
    output_dir: str | Path,
    image_size: int = 512,
) -> dict[str, Any]:
    try:
        import pyrender
        from PIL import Image
    except Exception as exc:
        raise RuntimeError("pyrender and Pillow are required for multi-view rendering.") from exc

    output_root = Path(output_dir)
    output_root.mkdir(parents=True, exist_ok=True)
    center = mesh.bounding_box.centroid
    radius = max(float(np.linalg.norm(mesh.extents)) * 2.2, 2.0)
    directions = [
        np.array(v, dtype=float)
        for v in (
            (1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0),
            (0, 0, 1), (0, 0, -1), (1, 1, 1), (-1, 1, 1),
            (1, -1, 1), (-1, -1, 1), (1, 1, -1), (-1, 1, -1),
        )
    ]
    scene = pyrender.Scene(bg_color=[0, 0, 0, 0])
    scene.add(pyrender.Mesh.from_trimesh(mesh, smooth=False))
    camera = pyrender.PerspectiveCamera(yfov=np.pi / 3.0)
    light = pyrender.DirectionalLight(color=np.ones(3), intensity=3.0)
    renderer = pyrender.OffscreenRenderer(image_size, image_size)
    try:
        for index, direction in enumerate(directions):
            direction /= max(np.linalg.norm(direction), 1e-8)
            eye = center + direction * radius
            pose = trimesh.geometry.look_at(eye, center)
            camera_node = scene.add(camera, pose=pose)
            light_node = scene.add(light, pose=pose)
            color, _ = renderer.render(scene)
            Image.fromarray(color).save(output_root / f"view_{index:02d}.png")
            scene.remove_node(camera_node)
            scene.remove_node(light_node)
    finally:
        renderer.delete()
    return {"status": "ok", "views": len(directions), "output_dir": str(output_root)}

def compare_render_directories(
    baseline_dir: str | Path,
    candidate_dir: str | Path,
) -> dict[str, Any]:
    """Compare standardized render views without treating either render as truth."""
    from PIL import Image

    baseline_root = Path(baseline_dir)
    candidate_root = Path(candidate_dir)
    baseline_files = sorted(baseline_root.glob("view_*.png"))
    candidate_files = sorted(candidate_root.glob("view_*.png"))
    names = sorted(set(p.name for p in baseline_files) & set(p.name for p in candidate_files))
    if not names:
        return {"status": "blocked", "reason": "No common standardized render views found."}

    per_view = {}
    errors = []
    ious = []
    for name in names:
        base = np.asarray(Image.open(baseline_root / name).convert("RGB"), dtype=np.float32) / 255.0
        cand = np.asarray(
            Image.open(candidate_root / name).convert("RGB").resize((base.shape[1], base.shape[0])),
            dtype=np.float32,
        ) / 255.0
        error = float(np.abs(base - cand).mean())
        base_mask = np.linalg.norm(base, axis=2) > 0.05
        cand_mask = np.linalg.norm(cand, axis=2) > 0.05
        intersection = float(np.logical_and(base_mask, cand_mask).sum())
        union = float(np.logical_or(base_mask, cand_mask).sum())
        iou = intersection / union if union else 1.0
        per_view[name] = {"mean_absolute_rgb_error": error, "silhouette_iou": iou}
        errors.append(error)
        ious.append(iou)

    return {
        "status": "ok",
        "views_compared": len(names),
        "mean_absolute_rgb_error": float(np.mean(errors)),
        "mean_silhouette_iou": float(np.mean(ious)),
        "per_view": per_view,
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
        from tempfile import TemporaryDirectory
        render_root = Path(render_output_dir)
        render_root.mkdir(parents=True, exist_ok=True)
        with TemporaryDirectory(prefix="formash-ab-") as temp_dir:
            temp_root = Path(temp_dir)
            baseline_render = temp_root / "baseline"
            candidate_render = temp_root / "candidate"
            render_multi_view(load_mesh(baseline_master), baseline_render)
            render_multi_view(load_mesh(candidate_master), candidate_render)
            result["render_comparison"] = compare_render_directories(
                baseline_render,
                candidate_render,
            )
            for source_dir, destination in (
                (baseline_render, render_root / "baseline"),
                (candidate_render, render_root / "candidate"),
            ):
                destination.mkdir(parents=True, exist_ok=True)
                for source in source_dir.glob("view_*.png"):
                    (destination / source.name).write_bytes(source.read_bytes())

    return result
