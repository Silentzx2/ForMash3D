"""Conservative boundary-loop hole repair."""
from __future__ import annotations

from typing import Optional

import numpy as np
import trimesh

try:
    from backend.core.config import get_quality_config
except ImportError:
    from core.config import get_quality_config


def _extract_boundary_cycles(next_map: dict[int, list[int]]) -> list[list[int]]:
    """Return only complete, unbranched directed boundary cycles."""
    predecessors: dict[int, list[int]] = {}
    for start, targets in next_map.items():
        for target in targets:
            predecessors.setdefault(target, []).append(start)

    undirected: dict[int, set[int]] = {}
    for start, targets in next_map.items():
        for target in targets:
            undirected.setdefault(start, set()).add(target)
            undirected.setdefault(target, set()).add(start)

    cycles: list[list[int]] = []
    unseen = set(undirected)
    while unseen:
        seed = unseen.pop()
        component = {seed}
        stack = [seed]
        while stack:
            node = stack.pop()
            for neighbour in undirected.get(node, ()):
                if neighbour in unseen:
                    unseen.remove(neighbour)
                    component.add(neighbour)
                    stack.append(neighbour)

        if any(
            len(next_map.get(node, ())) != 1
            or len(predecessors.get(node, ())) != 1
            for node in component
        ):
            continue

        cycle = []
        current = min(component)
        for _ in component:
            if current in cycle:
                break
            cycle.append(current)
            current = next_map[current][0]
        if current == cycle[0] and len(cycle) == len(component):
            cycles.append(cycle)
    return cycles


def _cross_2d(a: np.ndarray, b: np.ndarray, c: np.ndarray) -> float:
    return float((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]))


def _segments_intersect(
    a: np.ndarray, b: np.ndarray, c: np.ndarray, d: np.ndarray, area_tolerance: float
) -> bool:
    turns = (
        _cross_2d(a, b, c),
        _cross_2d(a, b, d),
        _cross_2d(c, d, a),
        _cross_2d(c, d, b),
    )
    return (
        turns[0] * turns[1] <= area_tolerance * area_tolerance
        and turns[2] * turns[3] <= area_tolerance * area_tolerance
        and max(min(a[0], b[0]), min(c[0], d[0]))
        <= min(max(a[0], b[0]), max(c[0], d[0])) + area_tolerance
        and max(min(a[1], b[1]), min(c[1], d[1]))
        <= min(max(a[1], b[1]), max(c[1], d[1])) + area_tolerance
    )


def triangulate_boundary_loop(
    loop: list[int], vertices: np.ndarray
) -> Optional[list[list[int]]]:
    """Triangulate a simple planar loop, or reject it without adding faces."""
    if len(loop) < 3 or len(set(loop)) != len(loop):
        return None
    source_vertices = np.asarray(vertices, dtype=float)
    indices = np.asarray(loop, dtype=np.int64)
    if (
        source_vertices.ndim != 2
        or source_vertices.shape[1] != 3
        or np.any(indices < 0)
        or np.any(indices >= len(source_vertices))
    ):
        return None
    points = source_vertices[indices]
    if not np.isfinite(points).all():
        return None

    centered = points - points.mean(axis=0)
    coordinate_scale = max(
        float(np.max(np.abs(points))),
        float(np.linalg.norm(np.ptp(points, axis=0))),
    )
    if coordinate_scale == 0:
        return None
    eps = np.finfo(float).eps
    tolerance = eps * coordinate_scale * len(loop)
    _, singular_values, basis = np.linalg.svd(centered, full_matrices=False)
    if len(singular_values) < 2 or singular_values[1] <= tolerance:
        return None
    projected = centered @ basis[:2].T
    if np.max(np.abs(centered @ basis[2])) > tolerance:
        return None

    scale = float(np.linalg.norm(np.ptp(projected, axis=0)))
    area_tolerance = eps * max(scale * scale, coordinate_scale * scale) * len(loop)
    signed_area = float(
        0.5
        * np.sum(
            projected[:, 0] * np.roll(projected[:, 1], -1)
            - projected[:, 1] * np.roll(projected[:, 0], -1)
        )
    )
    if not np.isfinite(signed_area) or abs(signed_area) <= area_tolerance:
        return None

    count = len(loop)
    for first in range(count):
        following = (first + 1) % count
        for second in range(first + 1, count):
            next_second = (second + 1) % count
            if first == second or following == second or next_second == first:
                continue
            if _segments_intersect(
                projected[first],
                projected[following],
                projected[second],
                projected[next_second],
                area_tolerance,
            ):
                return None

    orientation = 1.0 if signed_area > 0 else -1.0
    remaining = list(range(count))
    triangles: list[list[int]] = []
    while len(remaining) > 3:
        ear_found = False
        for position, current in enumerate(remaining):
            previous = remaining[position - 1]
            following = remaining[(position + 1) % len(remaining)]
            a, b, c = projected[[previous, current, following]]
            if orientation * _cross_2d(a, b, c) <= area_tolerance:
                continue

            contains_vertex = False
            for candidate in remaining:
                if candidate in (previous, current, following):
                    continue
                p = projected[candidate]
                sides = (
                    orientation * _cross_2d(a, b, p),
                    orientation * _cross_2d(b, c, p),
                    orientation * _cross_2d(c, a, p),
                )
                if min(sides) >= -area_tolerance:
                    contains_vertex = True
                    break
            if contains_vertex:
                continue

            triangles.append([loop[previous], loop[current], loop[following]])
            del remaining[position]
            ear_found = True
            break
        if not ear_found:
            return None

    final_triangle = [loop[index] for index in remaining]
    final_points = projected[remaining]
    if orientation * _cross_2d(*final_points) <= area_tolerance:
        return None
    triangles.append(final_triangle)

    local_index = {vertex: index for index, vertex in enumerate(loop)}
    triangulated_area = sum(
        abs(
            _cross_2d(
                *projected[
                    [local_index[vertex] for vertex in triangle]
                ]
            )
        )
        * 0.5
        for triangle in triangles
    )
    if abs(triangulated_area - abs(signed_area)) > area_tolerance * len(loop):
        return None
    return triangles


def _boundary_cycles(mesh: trimesh.Trimesh) -> tuple[list[list[int]], int]:
    edges = mesh.edges
    _, inverse, counts = np.unique(
        mesh.edges_sorted, axis=0, return_inverse=True, return_counts=True
    )
    boundary_indices = np.flatnonzero(counts[inverse] == 1)
    next_map: dict[int, list[int]] = {}
    for index in boundary_indices:
        u, v = map(int, edges[index])
        next_map.setdefault(v, []).append(u)
    return _extract_boundary_cycles(next_map), int(len(boundary_indices))


def repair_holes_targeted(
    mesh: trimesh.Trimesh,
    max_hole_vertices: Optional[int] = None,
    max_hole_perimeter: Optional[float] = None,
    config_path: Optional[str] = None,
) -> tuple[trimesh.Trimesh, dict]:
    """Fill only small, simple, planar boundary loops with safe triangulations."""
    if max_hole_vertices is None or max_hole_perimeter is None:
        holes_config = get_quality_config(config_path)["holes"]
        if max_hole_vertices is None:
            max_hole_vertices = int(holes_config["max_hole_vertices"])
        if max_hole_perimeter is None:
            max_hole_perimeter = float(holes_config["max_hole_perimeter"])
    try:
        vertex_limit = int(max_hole_vertices)
        perimeter_limit = float(max_hole_perimeter)
    except (TypeError, ValueError, OverflowError) as exc:
        raise ValueError("Hole repair limits must be finite and non-negative") from exc
    if (
        vertex_limit != max_hole_vertices
        or vertex_limit < 0
        or not np.isfinite(perimeter_limit)
        or perimeter_limit < 0
    ):
        raise ValueError("Hole repair limits must be finite and non-negative")
    max_hole_vertices = vertex_limit
    max_hole_perimeter = perimeter_limit

    empty_stats = {
        "holes_filled": 0,
        "holes_remaining": 0,
        "boundary_edges_before": 0,
        "boundary_edges_after": 0,
    }
    if mesh is None or not hasattr(mesh, "faces") or len(mesh.faces) < 3 or len(mesh.vertices) < 3:
        return mesh.copy() if mesh is not None else mesh, empty_stats.copy()

    loops, boundary_edges_before = _boundary_cycles(mesh)
    if boundary_edges_before == 0:
        return mesh.copy(), empty_stats.copy()

    new_faces: list[list[int]] = []
    holes_filled = 0
    holes_remaining = 0
    unique_edges, unique_counts = np.unique(
        mesh.edges_sorted, axis=0, return_counts=True
    )
    edge_counts = {
        tuple(map(int, edge)): int(count)
        for edge, count in zip(unique_edges, unique_counts)
    }
    for loop in loops:
        if len(loop) > max_hole_vertices:
            holes_remaining += 1
            continue
        perimeter = sum(
            float(np.linalg.norm(mesh.vertices[loop[index]] - mesh.vertices[loop[(index + 1) % len(loop)]]))
            for index in range(len(loop))
        )
        if perimeter > max_hole_perimeter:
            holes_remaining += 1
            continue
        loop_faces = triangulate_boundary_loop(loop, mesh.vertices)
        if loop_faces is None:
            holes_remaining += 1
            continue
        boundary_keys = {
            tuple(sorted((loop[index], loop[(index + 1) % len(loop)])))
            for index in range(len(loop))
        }
        added_edge_counts: dict[tuple[int, int], int] = {}
        for face in loop_faces:
            for first, second in (
                (face[0], face[1]),
                (face[1], face[2]),
                (face[2], face[0]),
            ):
                edge = tuple(sorted((first, second)))
                added_edge_counts[edge] = added_edge_counts.get(edge, 0) + 1
        if any(
            edge_counts.get(edge, 0) + additions > 2
            or (edge_counts.get(edge, 0) == 1 and edge not in boundary_keys)
            for edge, additions in added_edge_counts.items()
        ):
            holes_remaining += 1
            continue
        new_faces.extend(loop_faces)
        holes_filled += 1

    repaired = mesh.copy()
    if new_faces:
        repaired.extend_faces(new_faces)

    _, counts_after = np.unique(repaired.edges_sorted, axis=0, return_counts=True)
    boundary_edges_after = int(np.sum(counts_after == 1))
    if boundary_edges_after and holes_remaining == 0:
        holes_remaining = 1

    stats = {
        "holes_filled": int(holes_filled),
        "holes_remaining": int(holes_remaining),
        "boundary_edges_before": int(boundary_edges_before),
        "boundary_edges_after": boundary_edges_after,
    }
    return repaired, stats
