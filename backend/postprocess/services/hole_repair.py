"""Targeted boundary loop hole repair.

Fills boundary loops before falling back to full remesh,
preserving existing non-hole geometry completely untouched.
"""
from __future__ import annotations

from typing import Optional
import numpy as np
import trimesh


def _triangulate_polygon_loop(loop: list[int], vertices: np.ndarray) -> list[list[int]]:
    """Triangulate a simple boundary loop preserving orientation."""
    k = len(loop)
    if k < 3:
        return []
    if k == 3:
        return [[loop[0], loop[1], loop[2]]]
    if k == 4:
        d02 = float(np.linalg.norm(vertices[loop[0]] - vertices[loop[2]]))
        d13 = float(np.linalg.norm(vertices[loop[1]] - vertices[loop[3]]))
        if d02 <= d13:
            return [[loop[0], loop[1], loop[2]], [loop[0], loop[2], loop[3]]]
        return [[loop[0], loop[1], loop[3]], [loop[1], loop[2], loop[3]]]

    # k > 4: Pick the anchor vertex that minimizes maximum chord distance
    best_a = 0
    best_max_dist = float("inf")
    for a in range(k):
        v_a = vertices[loop[a]]
        max_dist = 0.0
        for i in range(2, k - 1):
            target_idx = (a + i) % k
            d = float(np.linalg.norm(v_a - vertices[loop[target_idx]]))
            if d > max_dist:
                max_dist = d
        if max_dist < best_max_dist:
            best_max_dist = max_dist
            best_a = a

    rot = loop[best_a:] + loop[:best_a]
    faces = []
    for i in range(1, k - 1):
        faces.append([rot[0], rot[i], rot[i + 1]])
    return faces


def _extract_boundary_cycles(next_map: dict[int, list[int]]) -> list[list[int]]:
    """Extract simple directed cycles from a directed boundary adjacency graph."""
    available = {k: list(v) for k, v in next_map.items() if v}
    cycles: list[list[int]] = []
    while any(available.values()):
        start = next(k for k, v in available.items() if v)
        path = [start]
        visited = {start: 0}
        while path:
            curr = path[-1]
            if not available.get(curr):
                visited.pop(curr, None)
                path.pop()
                continue
            nxt = available[curr].pop()
            if not available[curr]:
                del available[curr]
            if nxt in visited:
                idx = visited[nxt]
                cycle = path[idx:]
                if len(cycle) >= 3:
                    cycles.append(cycle)
                for node in cycle:
                    visited.pop(node, None)
                path = path[:idx]
            else:
                visited[nxt] = len(path)
                path.append(nxt)
    return cycles


def repair_holes_targeted(
    mesh: trimesh.Trimesh,
    max_hole_vertices: int = 50,
    max_hole_perimeter: Optional[float] = None,
) -> tuple[trimesh.Trimesh, dict]:
    """Implements targeted boundary loop filling before full remesh fallback.

    - Inspects boundary loops using mesh.edges_face / boundary edges.
    - For boundary loops with vertex count <= max_hole_vertices, fills the hole
      by triangulating the polygon / boundary fan.
    - Preserves non-hole geometry completely untouched.
    - Returns repaired mesh and stats dict:
      {"holes_filled": int, "holes_remaining": int, "boundary_edges_before": int, "boundary_edges_after": int}
    """
    if mesh is None or not hasattr(mesh, "faces") or len(mesh.faces) < 3 or len(mesh.vertices) < 3:
        return mesh.copy() if mesh is not None else mesh, {
            "holes_filled": 0,
            "holes_remaining": 0,
            "boundary_edges_before": 0,
            "boundary_edges_after": 0,
        }

    edges = mesh.edges
    edges_face = mesh.edges_face
    edges_sorted = mesh.edges_sorted

    _, inverse, counts = np.unique(edges_sorted, axis=0, return_inverse=True, return_counts=True)
    boundary_indices = np.where(counts[inverse] == 1)[0]
    boundary_edges_before = int(len(boundary_indices))

    if boundary_edges_before == 0:
        return mesh.copy(), {
            "holes_filled": 0,
            "holes_remaining": 0,
            "boundary_edges_before": 0,
            "boundary_edges_after": 0,
        }

    # For edge (u, v) in face, the boundary loop enclosing the hole traverses in opposite direction (v -> u)
    next_map: dict[int, list[int]] = {}
    for idx in boundary_indices:
        u, v = int(edges[idx][0]), int(edges[idx][1])
        next_map.setdefault(v, []).append(u)

    loops = _extract_boundary_cycles(next_map)

    new_faces: list[list[int]] = []
    holes_filled = 0
    holes_remaining = 0

    for loop in loops:
        loop_len = len(loop)
        if loop_len > max_hole_vertices:
            holes_remaining += 1
            continue

        if max_hole_perimeter is not None and max_hole_perimeter > 0:
            perimeter = sum(
                float(np.linalg.norm(mesh.vertices[loop[i]] - mesh.vertices[loop[(i + 1) % loop_len]]))
                for i in range(loop_len)
            )
            if perimeter > max_hole_perimeter:
                holes_remaining += 1
                continue

        loop_faces = _triangulate_polygon_loop(loop, mesh.vertices)
        if loop_faces:
            new_faces.extend(loop_faces)
            holes_filled += 1
        else:
            holes_remaining += 1

    repaired = mesh.copy()
    if new_faces:
        repaired.extend_faces(new_faces)

    _, inv_after, counts_after = np.unique(repaired.edges_sorted, axis=0, return_inverse=True, return_counts=True)
    boundary_edges_after = int(np.sum(counts_after == 1))

    if boundary_edges_after > 0 and holes_remaining == 0 and holes_filled == 0:
        holes_remaining = 1

    stats = {
        "holes_filled": int(holes_filled),
        "holes_remaining": int(holes_remaining),
        "boundary_edges_before": int(boundary_edges_before),
        "boundary_edges_after": int(boundary_edges_after),
    }
    return repaired, stats
