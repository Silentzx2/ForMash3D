"""Mesh load/export helpers built on trimesh.

The editor speaks GLB natively, so GLB is the default exchange format. OBJ is
also accepted on input. Keep all format knowledge in this module so the route
handlers and services stay format-agnostic.
"""
from __future__ import annotations

import io
from pathlib import Path

import numpy as np
import trimesh

from .schemas import MeshStats

# Extensions we know how to load on input.
SUPPORTED_INPUT_EXTS = {".glb", ".gltf", ".obj", ".ply", ".stl"}


def load_mesh(data: bytes | str | Path, filename: str | None = None) -> trimesh.Trimesh:
    """Load a single mesh from raw bytes or a file path.

    Scene geometry is flattened in world space so node transforms are applied
    before downstream tools receive a single Trimesh.
    """
    if isinstance(data, (str, Path)):
        path = Path(data)
        filename = filename or path.name
        data = path.read_bytes()

    ext = Path(filename or "mesh.glb").suffix.lower() or ".glb"
    if ext not in SUPPORTED_INPUT_EXTS:
        raise ValueError(f"Unsupported input format '{ext}'. Supported: {sorted(SUPPORTED_INPUT_EXTS)}")

    file_type = ext.lstrip(".")
    loaded = trimesh.load(io.BytesIO(data), file_type=file_type, process=False)

    if isinstance(loaded, trimesh.Scene):
        loaded = scene_to_mesh(loaded)

    if not isinstance(loaded, trimesh.Trimesh):
        raise ValueError("The uploaded file did not resolve to a triangle mesh.")

    return loaded


def load_mesh_vertex_normals(data: bytes, filename: str) -> np.ndarray | None:
    """The vertex normals the FILE carried, aligned to `load_mesh`'s vertex order.

    None when the file shipped no normals (or any geometry in a multi-mesh file
    lacks them, since a partial channel cannot be aligned).

    Why this is separate from `load_mesh`: flattening a multi-node scene creates
    new geometry and cannot preserve the source's cached normals. Setting source
    normals onto that mesh globally is unsafe for tools that change topology;
    Auto UV asks for them explicitly because it preserves shape and shading.
    """
    ext = Path(filename or "mesh.glb").suffix.lower() or ".glb"
    if ext not in SUPPORTED_INPUT_EXTS:
        return None
    try:
        loaded = trimesh.load(io.BytesIO(data), file_type=ext.lstrip("."), process=False)
    except Exception:  # noqa: BLE001 — load_mesh already reports real load errors
        return None

    if isinstance(loaded, trimesh.Scene):
        parts = []
        for node in loaded.graph.nodes_geometry:
            transform, geometry_name = loaded.graph[node]
            geom = loaded.geometry[geometry_name]
            if not isinstance(geom, trimesh.Trimesh):
                return None
            cached = geom._cache.cache.get("vertex_normals")
            if cached is None or len(cached) != len(geom.vertices):
                return None
            linear = np.asarray(transform[:3, :3], dtype=np.float64)
            try:
                normals = np.asarray(cached, dtype=np.float64) @ np.linalg.inv(linear)
            except np.linalg.LinAlgError:
                return None
            lengths = np.linalg.norm(normals, axis=1)
            if np.any(lengths == 0) or not np.all(np.isfinite(lengths)):
                return None
            parts.append(normals / lengths[:, None])
        return np.concatenate(parts, axis=0) if parts else None

    if not isinstance(loaded, trimesh.Trimesh):
        return None
    # Read the cache directly: touching `.vertex_normals` would compute them.
    cached = loaded._cache.cache.get("vertex_normals")
    if cached is None or len(cached) != len(loaded.vertices):
        return None
    return np.asarray(cached, dtype=np.float64)


def load_scene(data: bytes, filename: str) -> trimesh.Scene:
    """Load raw bytes as a Scene, preserving the material/node structure.

    `load_mesh` flattens mesh scenes into one Trimesh, which loses the structure
    the Game-Ready check needs to report (draw calls and texture count). Use this
    when that structure matters; use `load_mesh` for tools that only need geometry.
    A file that resolves to a lone mesh is wrapped in a one-geometry Scene.
    """
    ext = Path(filename or "mesh.glb").suffix.lower() or ".glb"
    if ext not in SUPPORTED_INPUT_EXTS:
        raise ValueError(f"Unsupported input format '{ext}'. Supported: {sorted(SUPPORTED_INPUT_EXTS)}")

    loaded = trimesh.load(io.BytesIO(data), file_type=ext.lstrip("."), process=False)

    if isinstance(loaded, trimesh.Scene):
        if len(loaded.geometry) == 0:
            raise ValueError("The uploaded file contains no geometry.")
        return loaded

    if not isinstance(loaded, trimesh.Trimesh):
        raise ValueError("The uploaded file did not resolve to a triangle mesh.")

    return trimesh.Scene(loaded)


def scene_to_mesh(scene: trimesh.Scene) -> trimesh.Trimesh:
    """Flatten a Scene into one Trimesh in **world space**.

    Applying the scene graph before flattening keeps node transforms and geometry
    aligned for processing and inspection, as they are when imported by an engine.
    """
    if len(scene.geometry) == 0:
        raise ValueError("The scene contains no geometry.")
    if not all(isinstance(geometry, trimesh.Trimesh) for geometry in scene.geometry.values()):
        raise ValueError("The scene contains non-mesh geometry that cannot be flattened.")
    try:
        dumped = scene.to_geometry()
    except Exception as exc:
        raise ValueError("Unable to flatten scene geometry with node transforms.") from exc
    if not isinstance(dumped, trimesh.Trimesh):
        raise ValueError("The scene did not resolve to triangle mesh geometry.")
    return dumped


def export_mesh(mesh: trimesh.Trimesh, fmt: str = "glb") -> bytes:
    """Serialize a mesh to bytes in the requested format (default GLB)."""
    fmt = (fmt or "glb").lstrip(".").lower()
    exported = mesh.export(file_type=fmt)
    return exported if isinstance(exported, (bytes, bytearray)) else str(exported).encode("utf-8")


def mesh_stats(mesh: trimesh.Trimesh) -> MeshStats:
    has_uv = bool(getattr(getattr(mesh, "visual", None), "uv", None) is not None)
    return MeshStats(
        vertex_count=int(len(mesh.vertices)),
        face_count=int(len(mesh.faces)),
        has_uv=has_uv,
    )
