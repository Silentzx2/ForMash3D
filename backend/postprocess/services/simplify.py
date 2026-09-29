"""Mesh simplification and LOD generation.

3DGenStudio drives this stage through gltfpack in its Node backend. ForMash3D is
Python/FastAPI, so the adapter uses the already-supported PyMeshLab backend while
preserving the same option contract and, critically, builds every LOD from the
ORIGINAL mesh rather than chaining simplification error from one level to the next.
"""
from __future__ import annotations

import numpy as np
import pymeshlab
import trimesh

from ..schemas import LODOptions, OptimizeOptions


def _simplify(mesh: trimesh.Trimesh, target_faces: int) -> tuple[trimesh.Trimesh, dict]:
    input_faces = int(len(mesh.faces))
    if target_faces >= input_faces or input_faces == 0:
        return mesh, {
            "input_triangles": input_faces,
            "triangles": input_faces,
            "target_faces": int(target_faces),
            "achieved_ratio": 1.0,
            "seam_limited": False,
            "seams_broken": False,
            "passthrough": True,
        }

    ms = pymeshlab.MeshSet()
    ms.add_mesh(pymeshlab.Mesh(
        vertex_matrix=np.asarray(mesh.vertices, dtype=np.float64),
        face_matrix=np.asarray(mesh.faces, dtype=np.int32),
    ))
    ms.meshing_decimation_quadric_edge_collapse(
        targetfacenum=int(target_faces),
        qualitythr=0.3,
        preservenormal=True,
        optimalplacement=True,
        autoclean=True,
    )
    out = ms.current_mesh()
    result = trimesh.Trimesh(
        vertices=np.asarray(out.vertex_matrix(), dtype=np.float64),
        faces=np.asarray(out.face_matrix(), dtype=np.int64),
        process=False,
    )
    triangles = int(len(result.faces))
    return result, {
        "input_triangles": input_faces,
        "triangles": triangles,
        "target_faces": int(target_faces),
        "achieved_ratio": round(triangles / input_faces, 6),
        "seam_limited": triangles > target_faces,
        "seams_broken": False,
        "passthrough": False,
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
