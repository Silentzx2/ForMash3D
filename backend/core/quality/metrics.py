"""Pure trimesh/numpy mesh quality metrics computation for ForMesh3D.

Zero external heavy dependencies; operates directly on trimesh.Trimesh instances.
"""
from __future__ import annotations

from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import trimesh

from ..utils.artifact_utils import sha256_file


def _triangle_aspect_ratios(vertices: np.ndarray, faces: np.ndarray) -> np.ndarray:
    """Calculate normalized radius-edge triangle aspect ratios in [0.0, 1.0].
    
    1.0 corresponds to an equilateral triangle.
    ~0.717 corresponds to right isosceles triangles (standard cube face).
    0.0 corresponds to degenerate or needle sliver triangles.
    """
    if len(faces) == 0:
        return np.zeros(0, dtype=np.float64)
    V = np.asarray(vertices, dtype=np.float64)
    F = np.asarray(faces, dtype=np.int64)
    a = V[F[:, 0]]
    b = V[F[:, 1]]
    c = V[F[:, 2]]

    e0 = np.linalg.norm(b - a, axis=1)
    e1 = np.linalg.norm(c - b, axis=1)
    e2 = np.linalg.norm(a - c, axis=1)

    s = (e0 + e1 + e2) * 0.5
    area_sq = s * (s - e0) * (s - e1) * (s - e2)
    area = np.sqrt(np.maximum(area_sq, 0.0))
    longest = np.maximum.reduce([e0, e1, e2])

    inradius = np.zeros_like(area)
    np.divide(area, s, out=inradius, where=(s > 1e-12))
    aspect = np.zeros_like(longest)
    np.divide(2.0 * np.sqrt(3.0) * inradius, longest, out=aspect, where=(longest > 1e-12))
    return np.clip(aspect, 0.0, 1.0)


def _geometry_integrity(mesh: trimesh.Trimesh) -> Tuple[bool, bool, int]:
    """Return finite-coordinate and face-index validity for a mesh."""
    vertices = np.asarray(mesh.vertices)
    faces = np.asarray(mesh.faces)

    try:
        finite_vertices = bool(
            vertices.ndim == 2
            and vertices.shape[1] == 3
            and np.isfinite(vertices).all()
        )
    except (TypeError, ValueError):
        finite_vertices = False

    if faces.ndim == 2 and faces.shape[1] == 3 and np.issubdtype(faces.dtype, np.integer):
        valid_face_mask = np.all(
            (faces >= 0) & (faces < len(vertices)),
            axis=1,
        )
        invalid_face_count = int(np.count_nonzero(~valid_face_mask))
    else:
        invalid_face_count = int(len(faces)) if faces.ndim > 0 else 1

    return finite_vertices, invalid_face_count == 0, invalid_face_count


def _count_non_manifold_vertices(mesh: trimesh.Trimesh) -> int:
    """Count non-manifold vertices.
    
    A vertex is manifold if its link is a single connected 1D disk (cycle)
    or half-disk (chain) and no incident edge has >2 faces.
    """
    if len(mesh.faces) == 0 or len(mesh.vertices) == 0:
        return 0

    F = np.asarray(mesh.faces, dtype=np.int64)
    opp_edges: Dict[int, List[Tuple[int, int]]] = defaultdict(list)
    for f in F:
        opp_edges[f[0]].append((f[1], f[2]))
        opp_edges[f[1]].append((f[2], f[0]))
        opp_edges[f[2]].append((f[0], f[1]))

    non_manifold_count = 0
    for v, edges in opp_edges.items():
        adj: Dict[int, set] = defaultdict(set)
        deg: Dict[int, int] = defaultdict(int)
        for u, w in edges:
            adj[u].add(w)
            adj[w].add(u)
            deg[u] += 1
            deg[w] += 1

        # Check if an edge incident to v is shared by > 2 faces
        if any(d > 2 for d in deg.values()):
            non_manifold_count += 1
            continue

        # Count connected components in vertex link
        visited = set()
        components = 0
        for node in adj:
            if node not in visited:
                components += 1
                stack = [node]
                visited.add(node)
                while stack:
                    curr = stack.pop()
                    for nbr in adj[curr]:
                        if nbr not in visited:
                            visited.add(nbr)
                            stack.append(nbr)
        if components > 1:
            non_manifold_count += 1

    return non_manifold_count


def _extract_boundary_loops(mesh: trimesh.Trimesh) -> Tuple[int, List[int]]:
    """Count and measure boundary loops (holes) using directed boundary traversal."""
    if len(mesh.faces) == 0:
        return 0, []

    F = np.asarray(mesh.faces, dtype=np.int64)
    directed = np.vstack([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]])
    sorted_e = np.sort(directed, axis=1)

    _, inv, counts = np.unique(sorted_e, axis=0, return_inverse=True, return_counts=True)
    boundary_mask = (counts[inv] == 1)
    b_edges = directed[boundary_mask]

    if len(b_edges) == 0:
        return 0, []

    succ: Dict[int, List[int]] = defaultdict(list)
    edge_counts: Dict[Tuple[int, int], int] = defaultdict(int)
    for u, v in b_edges:
        succ[int(u)].append(int(v))
        edge_counts[(int(u), int(v))] += 1

    loop_sizes: List[int] = []

    for u_raw, v_raw in b_edges:
        u, v = int(u_raw), int(v_raw)
        if edge_counts[(u, v)] <= 0:
            continue
        curr = v
        edge_counts[(u, v)] -= 1
        length = 1

        while curr != u:
            next_node = None
            for cand in succ[curr]:
                if edge_counts[(curr, cand)] > 0:
                    next_node = cand
                    edge_counts[(curr, cand)] -= 1
                    break
            if next_node is None:
                break
            curr = next_node
            length += 1
            if length > len(b_edges):
                break

        if curr == u:
            loop_sizes.append(length)

    remaining = [e for e, cnt in edge_counts.items() if cnt > 0]
    if remaining:
        undirected: Dict[int, set] = defaultdict(set)
        for u, v in remaining:
            undirected[u].add(v)
            undirected[v].add(u)
        visited = set()
        for node in list(undirected.keys()):
            if node in visited:
                continue
            stack = [node]
            visited.add(node)
            edge_count = 0
            while stack:
                curr = stack.pop()
                for nbr in undirected[curr]:
                    edge_count += 1
                    if nbr not in visited:
                        visited.add(nbr)
                        stack.append(nbr)
            loop_sizes.append(max(1, edge_count // 2))

    return len(loop_sizes), sorted(loop_sizes, reverse=True)


def _compute_components_and_floaters(mesh: trimesh.Trimesh) -> Tuple[int, float]:
    """Calculate connected components and floater ratio (< 0.5% vertices)."""
    V = len(mesh.vertices)
    if V == 0:
        return 0, 0.0
    if len(mesh.faces) == 0:
        return V, 1.0

    comps = trimesh.graph.connected_components(mesh.edges_unique, nodes=np.arange(V))
    comp_count = len(comps)
    if comp_count <= 1:
        return comp_count, 0.0

    floater_verts = 0
    for c in comps:
        if len(c) / V < 0.005:
            floater_verts += len(c)

    floater_ratio = float(floater_verts / V)
    return comp_count, floater_ratio


def _count_uv_islands(mesh: trimesh.Trimesh) -> int:
    """Count disconnected UV charts if visual UVs are present, else 0."""
    visual = getattr(mesh, "visual", None)
    uv = getattr(visual, "uv", None)
    if uv is None or len(mesh.faces) == 0 or len(mesh.vertices) == 0:
        return 0
    uv_arr = np.asarray(uv)
    if len(uv_arr) == 0:
        return 0

    adj = mesh.face_adjacency
    if len(adj) == 0:
        return int(len(mesh.faces))
    comps = trimesh.graph.connected_components(adj, nodes=np.arange(len(mesh.faces)))
    return int(len(comps))


try:
    from backend.core.config import get_quality_config
except ImportError:
    from core.config import get_quality_config


def _compute_feature_edge_retention(
    mesh: trimesh.Trimesh,
    reference_master: Optional[trimesh.Trimesh] = None,
    angle_tol_deg: Optional[float] = None,
    dist_tol_ratio: float = 0.02,
) -> float:
    """Calculate share of master feature edges still present in derivative mesh."""
    if reference_master is None or len(reference_master.faces) == 0:
        return 1.0

    if angle_tol_deg is None:
        try:
            angle_tol_deg = float(get_quality_config()["shared"]["feature_edge_angle_deg"])
        except Exception:
            angle_tol_deg = 35.0

    ref_angles = reference_master.face_adjacency_angles
    ref_sharp_mask = ref_angles > np.radians(angle_tol_deg)
    ref_sharp_edges = reference_master.face_adjacency_edges[ref_sharp_mask]

    if len(ref_sharp_edges) == 0:
        return 1.0

    if len(mesh.faces) == 0:
        return 0.0

    mesh_angles = mesh.face_adjacency_angles
    mesh_sharp_mask = mesh_angles > np.radians(30.0)
    mesh_sharp_edges = mesh.face_adjacency_edges[mesh_sharp_mask]

    if len(mesh_sharp_edges) == 0:
        return 0.0

    diag = float(np.linalg.norm(reference_master.bounds[1] - reference_master.bounds[0]))
    dist_tol = max(diag * dist_tol_ratio, 1e-4)
    cos_angle_tol = np.cos(np.radians(angle_tol_deg))

    ref_v0 = reference_master.vertices[ref_sharp_edges[:, 0]]
    ref_v1 = reference_master.vertices[ref_sharp_edges[:, 1]]
    ref_dir = ref_v1 - ref_v0
    ref_len = np.linalg.norm(ref_dir, axis=1, keepdims=True)
    ref_u = ref_dir / np.maximum(ref_len, 1e-12)
    ref_mid = (ref_v0 + ref_v1) * 0.5

    cand_v0 = mesh.vertices[mesh_sharp_edges[:, 0]]
    cand_v1 = mesh.vertices[mesh_sharp_edges[:, 1]]
    cand_dir = cand_v1 - cand_v0
    cand_len = np.linalg.norm(cand_dir, axis=1, keepdims=True)
    cand_u = cand_dir / np.maximum(cand_len, 1e-12)

    align = np.abs(np.dot(ref_u, cand_u.T)) >= cos_angle_tol

    retained_count = 0
    for i in range(len(ref_mid)):
        p = ref_mid[i]
        cand_indices = np.where(align[i])[0]
        if len(cand_indices) == 0:
            continue
        c_a = cand_v0[cand_indices]
        c_b = cand_v1[cand_indices]
        ab = c_b - c_a
        ap = p - c_a
        ab_lensq = np.sum(ab ** 2, axis=1)
        t = np.sum(ap * ab, axis=1) / np.maximum(ab_lensq, 1e-12)
        t = np.clip(t, 0.0, 1.0)
        proj = c_a + t[:, None] * ab
        dists = np.linalg.norm(p - proj, axis=1)
        if np.any(dists <= dist_tol):
            retained_count += 1

    return float(retained_count / len(ref_mid))


def compute_mesh_metrics(
    mesh: trimesh.Trimesh,
    reference_master: Optional[trimesh.Trimesh] = None,
) -> Dict[str, Any]:
    """Compute pure trimesh/numpy quality metrics for a mesh.
    
    Parameters
    ----------
    mesh : trimesh.Trimesh
        Mesh to evaluate.
    reference_master : trimesh.Trimesh, optional
        Reference master mesh used to calculate feature edge retention.
        
    Returns
    -------
    dict:
        triangle_count, vertex_count, is_watertight, non_manifold_edges,
        non_manifold_vertices, hole_count, boundary_loop_sizes,
        connected_components, floater_ratio, degenerate_faces,
        aspect_ratio_p1, aspect_ratio_p5, uv_island_count,
        feature_edge_retention, finite_vertices, valid_face_indices,
        invalid_face_count
    """
    face_count = int(len(mesh.faces))
    vertex_count = int(len(mesh.vertices))
    finite_vertices, valid_face_indices, invalid_face_count = _geometry_integrity(mesh)
    valid_face_shape = (
        np.asarray(mesh.faces).ndim == 2
        and np.asarray(mesh.faces).shape[1] == 3
        and np.issubdtype(np.asarray(mesh.faces).dtype, np.integer)
    )

    topology_geometry_valid = finite_vertices and valid_face_indices and valid_face_shape
    is_watertight = bool(mesh.is_watertight) if topology_geometry_valid and face_count > 0 else False

    if not topology_geometry_valid or face_count == 0:
        non_manifold_edges = 0
        degenerate_faces = 0
    else:
        edges_sorted = np.sort(mesh.edges, axis=1)
        _, counts = np.unique(edges_sorted, axis=0, return_counts=True)
        non_manifold_edges = int(np.sum(counts > 2))

        nondeg = np.asarray(mesh.nondegenerate_faces())
        kept = int(nondeg.sum()) if nondeg.dtype == bool else int(len(nondeg))
        degenerate_faces = max(0, face_count - kept)

    if topology_geometry_valid:
        non_manifold_vertices = _count_non_manifold_vertices(mesh)
        hole_count, boundary_loop_sizes = _extract_boundary_loops(mesh)
        connected_components, floater_ratio = _compute_components_and_floaters(mesh)
    else:
        non_manifold_vertices = 0
        hole_count, boundary_loop_sizes = 0, []
        connected_components, floater_ratio = 0, 0.0

    ratios = (
        _triangle_aspect_ratios(mesh.vertices, mesh.faces)
        if topology_geometry_valid
        else np.zeros(0, dtype=np.float64)
    )
    if len(ratios) == 0:
        aspect_ratio_p1 = 0.0
        aspect_ratio_p5 = 0.0
    else:
        aspect_ratio_p1 = float(np.percentile(ratios, 1))
        aspect_ratio_p5 = float(np.percentile(ratios, 5))

    uv_island_count = _count_uv_islands(mesh) if topology_geometry_valid else 0
    feature_edge_retention = (
        _compute_feature_edge_retention(mesh, reference_master)
        if topology_geometry_valid and finite_vertices
        else 0.0
    )

    return {
        "triangle_count": face_count,
        "vertex_count": vertex_count,
        "finite_vertices": finite_vertices,
        "valid_face_indices": valid_face_indices,
        "invalid_face_count": invalid_face_count,
        "is_watertight": is_watertight,
        "non_manifold_edges": non_manifold_edges,
        "non_manifold_vertices": non_manifold_vertices,
        "hole_count": hole_count,
        "boundary_loop_sizes": boundary_loop_sizes,
        "connected_components": connected_components,
        "floater_ratio": floater_ratio,
        "degenerate_faces": degenerate_faces,
        "aspect_ratio_p1": aspect_ratio_p1,
        "aspect_ratio_p5": aspect_ratio_p5,
        "uv_island_count": uv_island_count,
        "feature_edge_retention": feature_edge_retention,
    }


def audit_master_immutability(master_path: str | Path, working_copy_path: str | Path) -> bool:
    """Audit helper: verify master copy hash matches working copy and is intact."""
    m_path = Path(master_path)
    w_path = Path(working_copy_path)
    if not m_path.is_file() or not w_path.is_file():
        return False
    return sha256_file(m_path) == sha256_file(w_path)
