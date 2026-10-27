"""Topology gate for 3D generation adapters.

Evaluates mesh quality and topology metrics against configurable thresholds
to decide whether repair can be skipped, minimally targeted, or fully remeshed.
"""
from __future__ import annotations

import functools
from pathlib import Path
from typing import Any, Dict, List, Optional
import yaml

import trimesh

try:
    from backend.core.quality.metrics import compute_mesh_metrics
    from backend.core.config import get_quality_config
    from backend.postprocess.services.hole_repair import repair_holes_targeted
except ImportError:
    from core.quality.metrics import compute_mesh_metrics
    from core.config import get_quality_config
    from postprocess.services.hole_repair import repair_holes_targeted


@functools.lru_cache(maxsize=8)
def load_gate_thresholds(config_path: Optional[str] = None) -> Dict[str, Any]:
    """Load topology gate thresholds from canonical quality config."""
    cfg = get_quality_config(config_path)
    return dict(cfg["gate"])


def evaluate_topology_gate(
    mesh: trimesh.Trimesh,
    plan: Optional[Dict[str, Any]] = None,
    strict: bool = False,
    config_path: Optional[str] = None,
) -> Dict[str, Any]:
    """Evaluate topology gate on mesh against quality thresholds.

    Parameters
    ----------
    mesh : trimesh.Trimesh
        Input mesh to evaluate. Evaluated on a working copy; original mesh is untouched.
    plan : dict, optional
        Planner configuration dictionary, e.g. {"skip_retopo_allowed": True}.
    strict : bool, default False
        If True, any flaw immediately triggers 'full_repair'.
    config_path : str, optional
        Path to custom gate_thresholds.yaml file.

    Returns
    -------
    dict
        {
            "repair_decision": str,  # "skip_repair", "minimal_repair", or "full_repair"
            "skip_retopo": bool,
            "passed_clean": bool,
            "metrics": dict,
            "violations": list[str],
        }
    """
    if mesh is None:
        return {
            "repair_decision": "full_repair",
            "skip_retopo": False,
            "passed_clean": False,
            "metrics": {},
            "violations": ["Mesh is None"],
        }

    working_copy = mesh.copy()
    metrics = compute_mesh_metrics(working_copy)
    boundary_loop_sizes = metrics.get("boundary_loop_sizes") or []
    max_hole_size = max(boundary_loop_sizes) if boundary_loop_sizes else 0
    metrics["max_hole_size"] = max_hole_size

    quality_config = get_quality_config(config_path)
    thresholds = dict(quality_config["gate"])
    is_strict = bool(strict or thresholds.get("strict", False))

    non_manifold_edges = int(metrics.get("non_manifold_edges", 0))
    non_manifold_vertices = int(metrics.get("non_manifold_vertices", 0))
    hole_count = int(metrics.get("hole_count", 0))
    floater_ratio = float(metrics.get("floater_ratio", 0.0))
    degenerate_faces = int(metrics.get("degenerate_faces", 0))
    aspect_ratio_p1 = float(metrics.get("aspect_ratio_p1", 0.0))
    aspect_ratio_p5 = float(metrics.get("aspect_ratio_p5", 0.0))
    finite_vertices = bool(metrics.get("finite_vertices", False))
    valid_face_indices = bool(metrics.get("valid_face_indices", False))

    violations: List[str] = []

    if not finite_vertices:
        violations.append("vertex coordinates are not finite")
    if not valid_face_indices:
        violations.append(
            f"invalid face indices ({metrics.get('invalid_face_count', 0)})"
        )
    if non_manifold_edges > thresholds["max_non_manifold_edges"]:
        violations.append(
            f"non_manifold_edges ({non_manifold_edges}) > {thresholds['max_non_manifold_edges']}"
        )
    if non_manifold_vertices > thresholds["max_non_manifold_vertices"]:
        violations.append(
            f"non_manifold_vertices ({non_manifold_vertices}) > {thresholds['max_non_manifold_vertices']}"
        )
    if hole_count > thresholds["max_holes"]:
        violations.append(
            f"hole_count ({hole_count}) > {thresholds['max_holes']}"
        )
    if floater_ratio > thresholds["max_floater_ratio"]:
        violations.append(
            f"floater_ratio ({floater_ratio:.4f}) > {thresholds['max_floater_ratio']}"
        )
    if degenerate_faces > thresholds["max_degenerate_faces"]:
        violations.append(
            f"degenerate_faces ({degenerate_faces}) > {thresholds['max_degenerate_faces']}"
        )
    if aspect_ratio_p1 < thresholds["min_aspect_ratio_p1"]:
        violations.append(
            f"aspect_ratio_p1 ({aspect_ratio_p1:.4f}) < {thresholds['min_aspect_ratio_p1']}"
        )
    if aspect_ratio_p5 < thresholds["min_aspect_ratio_p5"]:
        violations.append(
            f"aspect_ratio_p5 ({aspect_ratio_p5:.4f}) < {thresholds['min_aspect_ratio_p5']}"
        )

    plan_dict = plan if isinstance(plan, dict) else {}
    passed_clean = len(violations) == 0

    if passed_clean:
        skip_retopo_allowed = bool(plan_dict.get("skip_retopo_allowed", True))
        return {
            "repair_decision": "skip_repair",
            "skip_retopo": skip_retopo_allowed,
            "passed_clean": True,
            "metrics": metrics,
            "violations": violations,
        }

    if is_strict:
        return {
            "repair_decision": "full_repair",
            "skip_retopo": False,
            "passed_clean": False,
            "metrics": metrics,
            "violations": violations,
        }

    hole_limits = quality_config["holes"]
    max_hole_limit = int(hole_limits["max_hole_vertices"])
    # If mesh only has small boundary loops (holes <= max_hole_limit vertices) and no non-manifold geometry:
    has_only_small_holes = (
        non_manifold_edges == 0
        and non_manifold_vertices == 0
        and hole_count > 0
        and max_hole_size <= max_hole_limit
        and degenerate_faces <= thresholds["max_degenerate_faces"]
        and floater_ratio <= thresholds["max_floater_ratio"]
        and aspect_ratio_p1 >= thresholds["min_aspect_ratio_p1"]
        and aspect_ratio_p5 >= thresholds["min_aspect_ratio_p5"]
    )
    if has_only_small_holes:
        _, hole_repair_stats = repair_holes_targeted(
            working_copy,
            max_hole_vertices=max_hole_limit,
            max_hole_perimeter=float(hole_limits["max_hole_perimeter"]),
            config_path=config_path,
        )
        has_only_small_holes = (
            hole_repair_stats["holes_filled"] == hole_count
            and hole_repair_stats["holes_remaining"] == 0
            and hole_repair_stats["boundary_edges_after"] == 0
        )

    if has_only_small_holes:
        repair_decision = "minimal_repair"
    else:
        repair_decision = "full_repair"

    return {
        "repair_decision": repair_decision,
        "skip_retopo": False,
        "passed_clean": False,
        "metrics": metrics,
        "violations": violations,
    }
