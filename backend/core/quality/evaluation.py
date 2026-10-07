
"""Lightweight mesh quality diagnostics for ForMash3D."""
from __future__ import annotations

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
