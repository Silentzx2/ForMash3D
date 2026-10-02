"""Mesh simplification and LOD generation.

3DGenStudio drives this stage through gltfpack in its Node backend. ForMash3D is
Python/FastAPI, so the adapter uses the already-supported PyMeshLab backend while
preserving the same option contract and, critically, builds every LOD from the
ORIGINAL mesh rather than chaining simplification error from one level to the next.
"""
from __future__ import annotations

import copy

import numpy as np
import pymeshlab
import trimesh

from ..schemas import LODOptions, OptimizeOptions


def _has_uv(mesh: trimesh.Trimesh) -> bool:
    uv = getattr(getattr(mesh, "visual", None), "uv", None)
    return uv is not None and len(uv) == len(mesh.vertices)


def _restore_texture(source: trimesh.Trimesh, vertices: np.ndarray, faces: np.ndarray, wedge_uv: np.ndarray, normals: np.ndarray | None) -> trimesh.Trimesh:
    """Rebuild per-vertex UVs/material data from MeshLab's per-wedge UVs."""
    wedge_uv = np.asarray(wedge_uv, dtype=np.float64).reshape((-1, 3, 2))
    new_vertices, new_uv, new_normals, remapped_faces, cache = [], [], [], [], {}
    for face_index, face in enumerate(np.asarray(faces, dtype=np.int64)):
        remapped = []
        for corner, source_index in enumerate(face):
            uv = wedge_uv[face_index, corner]
            key = (int(source_index), round(float(uv[0]), 10), round(float(uv[1]), 10))
            output_index = cache.get(key)
            if output_index is None:
                output_index = len(new_vertices)
                cache[key] = output_index
                new_vertices.append(vertices[source_index])
                new_uv.append(uv)
                if normals is not None and len(normals) == len(vertices):
                    new_normals.append(normals[source_index])
            remapped.append(output_index)
        remapped_faces.append(remapped)
    result = trimesh.Trimesh(vertices=np.asarray(new_vertices, dtype=np.float64),
                             faces=np.asarray(remapped_faces, dtype=np.int64),
                             vertex_normals=np.asarray(new_normals, dtype=np.float64) if new_normals else None,
                             process=False)
    source_visual = getattr(source, "visual", None)
    source_material = getattr(source_visual, "material", None)
    source_image = getattr(source_visual, "image", None)
    if source_material is not None:
        result.visual = trimesh.visual.TextureVisuals(
            uv=np.asarray(new_uv, dtype=np.float64),
            material=copy.copy(source_material),
            image=source_image if source_image is not None else getattr(source_material, "image", None),
        )
    elif source_image is not None:
        result.visual = trimesh.visual.TextureVisuals(uv=np.asarray(new_uv, dtype=np.float64), image=source_image)
    else:
        result.visual = trimesh.visual.TextureVisuals(uv=np.asarray(new_uv, dtype=np.float64))
    return result


def _simplify(mesh: trimesh.Trimesh, target_faces: int) -> tuple[trimesh.Trimesh, dict]:
    input_faces = int(len(mesh.faces))
    if target_faces >= input_faces or input_faces == 0:
        return mesh, {
            "input_triangles": input_faces, "triangles": input_faces,
            "target_faces": int(target_faces), "achieved_ratio": 1.0,
            "seam_limited": False, "seams_broken": False, "passthrough": True,
            "texture_preserved": _has_uv(mesh),
        }
    textured = _has_uv(mesh)
    ms = pymeshlab.MeshSet()
    mesh_kwargs = {
        "vertex_matrix": np.asarray(mesh.vertices, dtype=np.float64),
        "face_matrix": np.asarray(mesh.faces, dtype=np.int32),
        "v_normals_matrix": np.asarray(mesh.vertex_normals, dtype=np.float64),
    }
    if textured:
        uv = np.asarray(mesh.visual.uv, dtype=np.float64)
        mesh_kwargs["w_tex_coords_matrix"] = uv[np.asarray(mesh.faces, dtype=np.int64)].reshape(-1, 2)
    ms.add_mesh(pymeshlab.Mesh(**mesh_kwargs))
    try:
        if textured:
            ms.meshing_decimation_quadric_edge_collapse_with_texture(
                targetfacenum=int(target_faces), qualitythr=0.3, extratcoordw=1.0,
                preserveboundary=True, boundaryweight=1.0, optimalplacement=True,
            )
        else:
            ms.meshing_decimation_quadric_edge_collapse(
                targetfacenum=int(target_faces), qualitythr=0.3, preservenormal=True,
                optimalplacement=True, autoclean=True,
            )
        out = ms.current_mesh()
        vertices = np.asarray(out.vertex_matrix(), dtype=np.float64)
        faces = np.asarray(out.face_matrix(), dtype=np.int64)
        if textured:
            wedge_uv = np.asarray(out.wedge_tex_coord_matrix(), dtype=np.float64)
            out_normals = None
            try:
                out_normals = np.asarray(out.vertex_normal_matrix(), dtype=np.float64)
            except Exception:
                pass
            result = _restore_texture(mesh, vertices, faces, wedge_uv, out_normals)
        else:
            result = trimesh.Trimesh(vertices=vertices, faces=faces, process=False)
    except Exception as exc:
        if textured:
            return mesh, {
                "input_triangles": input_faces, "triangles": input_faces,
                "target_faces": int(target_faces), "achieved_ratio": 1.0,
                "seam_limited": False, "seams_broken": False, "passthrough": True,
                "texture_preserved": True, "texture_decimator_error": str(exc),
            }
        try:
            reduced = mesh.simplify_quadric_decimation(face_count=int(target_faces))
            triangles = int(len(reduced.faces))
            return reduced, {
                "input_triangles": input_faces, "triangles": triangles,
                "target_faces": int(target_faces), "achieved_ratio": round(triangles / input_faces, 6) if input_faces else 1.0,
                "seam_limited": triangles > target_faces, "seams_broken": False,
                "passthrough": False,
                "texture_preserved": False,
            }
        except Exception:
            return mesh, {
                "input_triangles": input_faces, "triangles": input_faces,
                "target_faces": int(target_faces), "achieved_ratio": 1.0,
                "seam_limited": False, "seams_broken": False, "passthrough": True,
                "texture_preserved": False, "decimator_error": str(exc),
            }
    triangles = int(len(result.faces))
    return result, {
        "input_triangles": input_faces, "triangles": triangles,
        "target_faces": int(target_faces), "achieved_ratio": round(triangles / input_faces, 6),
        "seam_limited": triangles > target_faces, "seams_broken": False,
        "passthrough": False,
        "texture_preserved": bool(textured and _has_uv(result)),
    }


def run_optimize(mesh: trimesh.Trimesh, options: OptimizeOptions, progress=None):
    input_faces = int(len(mesh.faces))
    target = int(options.target_faces) if options.target_faces else max(1, round(input_faces * options.simplify_ratio))
    if progress:
        progress("simplify", 0.15, f"Reducing {input_faces:,} triangles to ~{target:,}")
    out, stats = _simplify(mesh, target)
    if options.allow_seam_breaking:
        stats["seams_broken"] = bool(not stats["passthrough"])
    if progress:
        progress("done", 1.0, "Optimization complete")
    return out, stats


def run_lods(mesh: trimesh.Trimesh, options: LODOptions, progress=None):
    input_faces = int(len(mesh.faces))
    levels = []
    for index, ratio in enumerate(options.ratios):
        ratio = float(max(0.01, min(1.0, ratio)))
        if ratio >= 1.0:
            levels.append({
                "level": index, "ratio": ratio, "triangles": input_faces,
                "achieved_ratio": 1.0, "seam_limited": False,
                "seams_broken": False, "passthrough": True, "mesh": mesh,
            })
            continue
        target = max(1, round(input_faces * ratio))
        if progress:
            progress("lod", (index + 0.2) / max(1, len(options.ratios)), f"Generating LOD{index}")
        reduced, stats = _simplify(mesh, target)
        if options.allow_seam_breaking:
            stats["seams_broken"] = bool(not stats["passthrough"])
        levels.append({"level": index, "ratio": ratio, "mesh": reduced, **stats})
    if progress:
        progress("done", 1.0, "LOD chain complete")
    return levels
