"""Topology repair — clean non-manifold edges without a full retopo.

Resolves the non-manifold edges the editor's watertight check reports, targeting
the surface directly instead of rebuilding it like Auto Retopo does:

  1. weld coincident vertices by position (so near-duplicate sheets share verts);
  2. drop duplicate + degenerate faces;
  3. resolve non-manifold edges — either *remove* the offending faces (then the
     small holes that opens can be closed) or *split* the sheets apart (keeps all
     faces, leaves clean boundary loops);
  4. optionally close only small, planar, safely triangulable holes.

The before/after non-manifold and boundary-edge counts are reported so the UI can
show exactly what changed — some meshes (genuine multi-sheet "fins") cannot reach
a perfectly closed result and the honest numbers make that visible.
"""
from __future__ import annotations

from collections import Counter

import numpy as np
import trimesh

from ..schemas import RepairOptions
from .hole_repair import _extract_boundary_cycles, repair_holes_targeted, triangulate_boundary_loop

try:
    from backend.core.config import get_quality_config
except ImportError:
    from core.config import get_quality_config

try:  # pymeshlab is a hard dependency of the service, but stay defensive.
    import pymeshlab as ml
except Exception:  # pragma: no cover
    ml = None


def topology_counts(vertices, faces) -> dict:
    """Non-manifold + boundary edge counts under a position-weld at diag*1e-6,
    mirroring the editor's client-side getGeometryWatertight so the numbers agree.

    Public because the Game-Ready check (services/inspect.py) reports the same
    numbers — they must not drift from what Repair reports about the same mesh.
    """
    V = np.asarray(vertices, dtype=float)
    F = np.asarray(faces, dtype=np.int64)
    if len(F) == 0:
        return {"non_manifold_edges": 0, "boundary_edges": 0, "faces": 0, "watertight": False}
    diag = float(np.linalg.norm(V.max(axis=0) - V.min(axis=0))) if len(V) else 1.0
    tol = max(diag * 1e-6, 1e-9)
    keys = np.round(V * (1.0 / tol)).astype(np.int64)
    _, canon = np.unique(keys, axis=0, return_inverse=True)
    canon = canon.reshape(-1)
    edge_counts: "Counter" = Counter()
    for f in F:
        a, b, c = int(canon[f[0]]), int(canon[f[1]]), int(canon[f[2]])
        for s, t in ((a, b), (b, c), (c, a)):
            if s == t:
                continue
            edge_counts[(s, t) if s < t else (t, s)] += 1
    non_manifold = sum(1 for n in edge_counts.values() if n > 2)
    boundary_edges = [edge for edge, n in edge_counts.items() if n == 1]
    boundary_neighbours: dict[int, set[int]] = {}
    for a, b in boundary_edges:
        boundary_neighbours.setdefault(int(a), set()).add(int(b))
        boundary_neighbours.setdefault(int(b), set()).add(int(a))

    # ponytail: classify the largest connected boundary component instead of
    # comparing the total boundary-edge count to the per-hole repair threshold.
    largest_boundary_component_edges = 0
    visited_boundary: set[int] = set()
    for start in boundary_neighbours:
        if start in visited_boundary:
            continue
        stack = [start]
        component_vertices: set[int] = set()
        while stack:
            vertex = stack.pop()
            if vertex in component_vertices:
                continue
            component_vertices.add(vertex)
            visited_boundary.add(vertex)
            stack.extend(
                neighbour
                for neighbour in boundary_neighbours.get(vertex, ())
                if neighbour not in component_vertices
            )
        component_edges = sum(
            len(boundary_neighbours.get(vertex, ()))
            for vertex in component_vertices
        ) // 2
        largest_boundary_component_edges = max(
            largest_boundary_component_edges, int(component_edges)
        )

    return {
        "non_manifold_edges": int(non_manifold),
        "boundary_edges": int(len(boundary_edges)),
        "largest_boundary_component_edges": int(largest_boundary_component_edges),
        "faces": int(len(F)),
        "watertight": bool(non_manifold == 0 and not boundary_edges),
    }


def _weld(vertices, faces) -> trimesh.Trimesh:
    """Weld coincident vertices regardless of normal/UV splits, drop degenerates."""
    m = trimesh.Trimesh(np.asarray(vertices, float), np.asarray(faces, np.int64), process=False)
    m.merge_vertices(merge_tex=True, merge_norm=True)
    m.update_faces(m.nondegenerate_faces())
    m.remove_unreferenced_vertices()
    return m


# ── UV-preserving repair ────────────────────────────────────────────────────
#
# The pymeshlab path below rebuilds the mesh from scratch: it welds across UV
# splits (merge_tex=True, by design) and pymeshlab only carries positions and
# faces, so every UV — and therefore the texture — is lost. That is a wildly
# disproportionate price for a defect that is usually a handful of edges.
#
# This path never touches a vertex that is not part of the defect. Positions and
# UVs keep their indices, so the texture stays pinned exactly where it was; only
# the offending faces are removed (or detached). Welding is still computed, but
# only as an *analysis* view used to find coincident geometry — it is never
# written back to the vertex array.

def _canonical_ids(vertices) -> np.ndarray:
    """Map each vertex to an id shared by all vertices at the same position.

    This is how two sides of a UV seam are recognised as one point topologically
    while remaining separate entries in the vertex/UV arrays.
    """
    V = np.asarray(vertices, dtype=float)
    if len(V) == 0:
        return np.zeros(0, dtype=np.int64)
    diag = float(np.linalg.norm(V.max(axis=0) - V.min(axis=0))) or 1.0
    tol = max(diag * 1e-6, 1e-9)
    keys = np.round(V * (1.0 / tol)).astype(np.int64)
    _, canon = np.unique(keys, axis=0, return_inverse=True)
    return canon.reshape(-1).astype(np.int64)


def _edge_key(a: int, b: int) -> tuple:
    return (a, b) if a < b else (b, a)


def _edge_to_faces(faces, canon, alive) -> dict:
    edges: dict = {}
    for index, face in enumerate(faces):
        if not alive[index]:
            continue
        a, b, c = int(canon[face[0]]), int(canon[face[1]]), int(canon[face[2]])
        for s, t in ((a, b), (b, c), (c, a)):
            if s != t:
                edges.setdefault(_edge_key(s, t), []).append(index)
    return edges


def _face_areas(vertices, faces) -> np.ndarray:
    tri = np.asarray(vertices, float)[np.asarray(faces, np.int64)]
    return np.linalg.norm(np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]), axis=1) * 0.5


def _fill_small_holes(
    vertices, faces, canon, alive, max_hole_size: int, max_hole_perimeter: float
) -> int:
    """Fill only simple, planar boundary loops with safe triangulations."""
    if max_hole_size <= 0:
        return 0

    edges = _edge_to_faces(faces, canon, alive)
    boundary_keys = {edge for edge, owners in edges.items() if len(owners) == 1}
    if not boundary_keys:
        return 0

    representative: dict[int, int] = {}
    next_map: dict[int, list[int]] = {}
    for face_index, face in enumerate(faces):
        if not alive[face_index]:
            continue
        for vertex in face:
            representative.setdefault(int(canon[vertex]), int(vertex))
        for first, second in zip(face, face[1:] + face[:1]):
            a, b = int(canon[first]), int(canon[second])
            edge = _edge_key(a, b)
            if edge in boundary_keys:
                next_map.setdefault(b, []).append(a)

    edge_count = {edge: len(owners) for edge, owners in edges.items()}
    added = []
    for loop in _extract_boundary_cycles(next_map):
        if len(loop) > max_hole_size or any(node not in representative for node in loop):
            continue
        loop_vertices = [representative[node] for node in loop]
        loop_points = np.asarray(vertices, dtype=float)[loop_vertices]
        perimeter = sum(
            float(np.linalg.norm(loop_points[i] - loop_points[(i + 1) % len(loop)]))
            for i in range(len(loop))
        )
        if perimeter > max_hole_perimeter:
            continue
        local_faces = triangulate_boundary_loop(list(range(len(loop))), loop_points)
        if local_faces is None:
            continue

        loop_boundary_keys = {
            _edge_key(loop[index], loop[(index + 1) % len(loop)])
            for index in range(len(loop))
        }
        candidate_edges: dict[tuple, int] = {}
        for face in local_faces:
            for first, second in ((face[0], face[1]), (face[1], face[2]), (face[2], face[0])):
                edge = _edge_key(loop[first], loop[second])
                candidate_edges[edge] = candidate_edges.get(edge, 0) + 1
        if any(
            edge_count.get(edge, 0) + additions > 2
            or (edge_count.get(edge, 0) == 1 and edge not in loop_boundary_keys)
            for edge, additions in candidate_edges.items()
        ):
            continue

        for edge, additions in candidate_edges.items():
            edge_count[edge] = edge_count.get(edge, 0) + additions
        added.extend([[loop_vertices[index] for index in face] for face in local_faces])

    if added:
        faces.extend(added)
        alive.extend([True] * len(added))
    return len(added)


def _repair_preserving_uv(
    mesh: trimesh.Trimesh,
    options: RepairOptions,
    emit,
    max_hole_vertices: int,
    max_hole_perimeter: float,
) -> tuple[trimesh.Trimesh, dict]:
    vertices = np.asarray(mesh.vertices, dtype=float)
    faces = [list(map(int, face)) for face in np.asarray(mesh.faces, dtype=np.int64)]

    uv = getattr(getattr(mesh, "visual", None), "uv", None)
    uv = np.asarray(uv, dtype=float) if uv is not None else None
    if uv is not None and len(uv) != len(vertices):
        uv = None  # per-face or malformed UVs — cannot be carried by index

    vc = getattr(getattr(mesh, "visual", None), "vertex_colors", None)
    vc = np.asarray(vc) if vc is not None else None
    if vc is not None and len(vc) != len(vertices):
        vc = None

    canon = list(_canonical_ids(vertices))
    alive = [True] * len(faces)
    removed_degenerate = removed_duplicate = removed_nonmanifold = 0
    detached_faces = 0

    emit("dedup", 0.25, "Removing degenerate and duplicate faces…")
    seen: dict = {}
    for index, face in enumerate(faces):
        a, b, c = canon[face[0]], canon[face[1]], canon[face[2]]
        if a == b or b == c or a == c:
            alive[index] = False
            removed_degenerate += 1
            continue
        key = tuple(sorted((a, b, c)))
        if key in seen:
            alive[index] = False
            removed_duplicate += 1
        else:
            seen[key] = index

    emit("repair", 0.5, "Resolving non-manifold edges…")
    if options.method == "split":
        # Detach the surplus faces instead of deleting them: duplicate just the
        # two vertices that lie on the offending edge (copying their UVs and vertex colors), so the
        # face keeps its other two edges attached and nothing disappears.
        extra_vertices = []
        extra_uv = []
        extra_vc = []
        next_canon = (max(canon) + 1) if canon else 0
        for _ in range(1000):  # guard: each pass detaches at least one face
            edges = _edge_to_faces(faces, canon, alive)
            offenders = [(edge, owners) for edge, owners in edges.items() if len(owners) > 2]
            if not offenders:
                break
            (s, t), owners = offenders[0]
            for face_index in owners[2:]:
                face = faces[face_index]
                for corner in range(3):
                    vertex = face[corner]
                    if canon[vertex] in (s, t):
                        extra_vertices.append(vertices[vertex])
                        if uv is not None:
                            extra_uv.append(uv[vertex])
                        if vc is not None:
                            extra_vc.append(vc[vertex])
                        canon.append(next_canon)
                        next_canon += 1
                        face[corner] = len(vertices) + len(extra_vertices) - 1
                detached_faces += 1
        if extra_vertices:
            vertices = np.vstack([vertices, np.asarray(extra_vertices, dtype=float)])
            if uv is not None:
                uv = np.vstack([uv, np.asarray(extra_uv, dtype=float)])
            if vc is not None:
                vc = np.vstack([vc, np.asarray(extra_vc)])
    else:
        # Remove the fewest faces that make every edge manifold. Greedy on the
        # face involved in the most over-subscribed edges, breaking ties by
        # smallest area, so slivers go before real surface.
        areas = _face_areas(vertices, [faces[i] for i in range(len(faces))])
        for _ in range(1000):  # guard: each pass removes at least one face
            edges = _edge_to_faces(faces, canon, alive)
            offenders = {edge: owners for edge, owners in edges.items() if len(owners) > 2}
            if not offenders:
                break
            score: dict = {}
            for owners in offenders.values():
                for face_index in owners:
                    score[face_index] = score.get(face_index, 0) + 1
            worst = max(score, key=lambda i: (score[i], -areas[i]))
            alive[worst] = False
            removed_nonmanifold += 1

    filled = 0
    if options.close_holes and options.method != "split":
        emit("close", 0.75, "Closing small holes…")
        filled = _fill_small_holes(
            vertices,
            faces,
            canon,
            alive,
            max_hole_vertices,
            max_hole_perimeter,
        )

    # Compact: keep only live faces, then drop vertices nothing references —
    # remapping positions and UVs together so the two never drift apart.
    kept = np.asarray([faces[i] for i in range(len(faces)) if alive[i]], dtype=np.int64)
    if len(kept) == 0:
        raise RuntimeError("Repair removed every face; the mesh is too broken for this method.")

    used = np.unique(kept)
    remap = np.full(len(vertices), -1, dtype=np.int64)
    remap[used] = np.arange(len(used), dtype=np.int64)

    out = trimesh.Trimesh(vertices[used], remap[kept], process=False)
    if uv is not None:
        out.visual = trimesh.visual.TextureVisuals(uv=uv[used])
        # Carry the source material so the exported GLB keeps pointing at the
        # same texture image rather than coming back untextured.
        source_material = getattr(getattr(mesh, "visual", None), "material", None)
        if source_material is not None:
            out.visual.material = source_material
    if vc is not None:
        out.visual.vertex_colors = vc[used]

    stats = {
        "removed_degenerate": removed_degenerate,
        "removed_duplicate": removed_duplicate,
        "removed_nonmanifold": removed_nonmanifold,
        "detached_faces": detached_faces,
        "filled_faces": filled,
        "uv_preserved": bool(uv is not None),
    }
    return out, stats


def run_repair(mesh: trimesh.Trimesh, options: RepairOptions,
               progress=None) -> tuple[trimesh.Trimesh, dict, None]:
    def emit(stage, frac, msg=""):
        if progress:
            progress(stage, frac, msg)

    mesh = mesh.copy()
    hole_limits = get_quality_config()["holes"]
    max_hole_perimeter = float(hole_limits["max_hole_perimeter"])
    max_hole_vertices = (
        int(options.max_hole_size)
        if "max_hole_size" in getattr(options, "model_fields_set", set())
        else int(hole_limits["max_hole_vertices"])
    )
    emit("analyze", 0.05, "Analyzing topology…")
    before = topology_counts(mesh.vertices, mesh.faces)

    # ponytail: Phase 3 requirements - conservative repair for fragments, normals
    trimesh.repair.fix_normals(mesh)
    # skipped: extreme spikes (handled by Taubin smooth in retopo), invalid transforms (trimesh applies them at load, NaNs caught by inspect)

    # Default path: surgical, UV-preserving. Only the faces that form the defect
    # are touched, so a textured mesh keeps its texture. The pymeshlab rebuild
    # below is the fallback for meshes too broken for that — it is far more
    # aggressive and discards UVs entirely.
    if options.preserve_uv:
        out, tool_stats = _repair_preserving_uv(
            mesh, options, emit, max_hole_vertices, max_hole_perimeter
        )
        emit("done", 1.0, "Repair complete.")
        after = topology_counts(out.vertices, out.faces)
        return out, {
            "before": before,
            "after": after,
            "removed_faces": int(before["faces"] - after["faces"]),
            "method": options.method,
            "preserve_uv": True,
            **tool_stats,
        }, None

    if ml is None:
        raise RuntimeError("pymeshlab is not available on the mesh-tools service.")

    # 1. Weld coincident vertices so near-duplicate sheets share geometry and
    #    their doubled faces become exact duplicates the next step can drop.
    if options.weld:
        emit("weld", 0.2, "Welding coincident vertices…")
        m = _weld(mesh.vertices, mesh.faces)
    else:
        m = trimesh.Trimesh(np.asarray(mesh.vertices, float),
                            np.asarray(mesh.faces, np.int64), process=False)

    ms = ml.MeshSet()
    ms.add_mesh(ml.Mesh(np.asarray(m.vertices, float), np.asarray(m.faces, np.int64)))

    # 2. Duplicate / degenerate face + vertex cleanup.
    emit("dedup", 0.4, "Removing duplicate faces…")
    for fn in ("meshing_remove_duplicate_faces", "meshing_remove_duplicate_vertices",
               "meshing_remove_null_faces"):
        filt = getattr(ms, fn, None)
        if filt is not None:
            try:
                filt()
            except Exception:
                pass

    # 3. Resolve non-manifold edges. pymeshlab's method arg is a string in newer
    #    builds and an int in older ones, so try both spellings.
    emit("repair", 0.6, "Repairing non-manifold edges…")
    ml_variants = (({"method": "Remove Faces"}, {"method": 0}) if options.method == "remove"
                   else ({"method": "Split Vertices"}, {"method": 1}))
    edge_filt = getattr(ms, "meshing_repair_non_manifold_edges", None)
    if edge_filt is not None:
        for kwargs in ml_variants:
            try:
                edge_filt(**kwargs)
                break
            except Exception:
                continue
    vert_filt = getattr(ms, "meshing_repair_non_manifold_vertices", None)
    if vert_filt is not None:
        try:
            vert_filt()
        except Exception:
            pass

    try:
        ms.meshing_remove_unreferenced_vertices()
    except Exception:
        pass

    mm = ms.current_mesh()
    out = trimesh.Trimesh(np.asarray(mm.vertex_matrix()),
                          np.asarray(mm.face_matrix(), np.int64), process=False)

    # Final cleanup, then use the same guarded hole filler as the UV-preserving path.
    out.merge_vertices(merge_tex=True, merge_norm=True)
    out.update_faces(out.nondegenerate_faces())
    out.remove_unreferenced_vertices()
    hole_stats = {
        "holes_filled": 0,
        "holes_remaining": 0,
        "boundary_edges_before": topology_counts(out.vertices, out.faces)["boundary_edges"],
        "boundary_edges_after": topology_counts(out.vertices, out.faces)["boundary_edges"],
    }
    if options.close_holes:
        emit("close", 0.8, "Closing safe small holes…")
        out, hole_stats = repair_holes_targeted(
            out,
            max_hole_vertices=max_hole_vertices,
            max_hole_perimeter=max_hole_perimeter,
        )

    emit("done", 1.0, "Repair complete.")
    after = topology_counts(out.vertices, out.faces)

    stats = {
        "before": before,
        "after": after,
        "removed_faces": int(before["faces"] - after["faces"]),
        "method": options.method,
        "preserve_uv": False,
        "uv_preserved": False,
        "hole_stats": hole_stats,
    }
    return out, stats, None
