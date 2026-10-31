"""Auto Retopology — bridges the FastAPI route to the bundled `autoretopo` package.

AutoRetopo.run() accepts a trimesh.Trimesh directly (it repairs it internally),
so we pass the uploaded mesh straight through and return the retopologized
trimesh.Trimesh plus the metrics/timings for the UI.
"""
from __future__ import annotations

from typing import Callable, Optional

import trimesh

from core.quality.evaluation import compare_meshes, quality_gate

from ..schemas import AutoRetopoOptions
from .autoretopo import AutoRetopo, RetopoConfig
from .autoretopo import gpu

CancelChecker = Optional[Callable[[], bool]]


def _check_cancelled(cancel_checker: CancelChecker) -> None:
    if cancel_checker is not None and cancel_checker():
        raise InterruptedError("Auto-retopology cancelled by user")


def _assert_surface_fidelity(
    reference: trimesh.Trimesh,
    candidate: trimesh.Trimesh,
) -> dict:
    """Reject a retopo derivative whose sampled surface drift exceeds quality.yaml."""
    comparison = compare_meshes(reference, candidate, seed=1)
    gate = quality_gate(comparison)
    if gate.get("passed") is not True:
        drift = gate.get("normalized_surface_drift")
        threshold = gate.get("threshold")
        if drift is not None and threshold is not None:
            reason = f"normalized surface drift {float(drift):.4f} exceeds configured limit {float(threshold):.4f}"
        else:
            reason = str(gate.get("reason") or "surface-fidelity metrics are unavailable")
        raise RuntimeError(
            "Auto-retopology quality gate rejected the candidate: " + reason
        )
    return {
        **gate,
        "decision": "accepted",
        "sample_count": int(comparison.get("sample_count", 0)),
        "f_score": float(comparison.get("f_score", 0.0)),
        "chamfer_distance": float(comparison.get("chamfer_distance", 0.0)),
    }


def run_auto_retopo(
    mesh: trimesh.Trimesh,
    options: AutoRetopoOptions,
    progress=None,
    cancel_checker: CancelChecker = None,
) -> tuple[trimesh.Trimesh, dict, None]:
    cfg = RetopoConfig(
        target_faces=options.target_faces,
        quads=options.quads,
        watertight=options.watertight,
        shell_resolution=options.shell_resolution,
        shell_close_iter=options.shell_close_iter,
        shell_smooth=options.shell_smooth,
        shell_taubin=options.shell_taubin,
        shell_samples_per_pitch=options.shell_samples_per_pitch,
        max_memory_gb=options.max_memory_gb,
        adaptive=options.adaptive,
        remesh_iters=options.remesh_iters,
        feature_deg=options.feature_deg,
        calibrate_passes=options.calibrate_passes,
        preserve_features=options.preserve_features,
        feature_angle=options.feature_angle,
        project=options.project,
        project_iters=options.project_iters,
        project_clamp=options.project_clamp,
        relax_strength=options.relax_strength,
        device=options.device,
        seed=options.seed,
        verbose=False,
    )

    retopo_progress = progress
    if progress is not None or cancel_checker is not None:
        def retopo_progress(stage, frac, msg=""):
            _check_cancelled(cancel_checker)
            if progress:
                progress(stage, frac, msg)

    try:
        result = AutoRetopo(cfg).run(mesh, progress=retopo_progress)
    finally:
        # Long-running server: hand each run's GPU pool back to the driver so the
        # footprint doesn't accumulate across Auto Retopo requests. Also runs on
        # the error path (e.g. a shell-stage OOM) so a failed run cleans up too.
        gpu.free_gpu_memory()

    fidelity_gate = _assert_surface_fidelity(result.original, result.mesh)
    stats = {
        "fidelity_gate": fidelity_gate,
        "metrics": result.metrics,
        "timings": result.timings,
        "quad_face_count": (len(result.quad_faces) if result.quad_faces is not None else None),
        "quad_faces": result.quad_faces,
    }
    # result.mesh is a triangle trimesh.Trimesh (GLB is triangles-only; the
    # quad-dominant face list, when requested, is summarized in stats above).
    # No preview image for retopo (third tuple element kept for a uniform contract).
    return result.mesh, stats, None
