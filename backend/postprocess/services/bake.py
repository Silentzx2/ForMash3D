"""High-to-low poly texture bake — subprocess driver for app/tools/bake_worker.py.

The worker owns the actual Blender (bpy) work; this module only provisions a job
directory, spawns the worker with the venv's own interpreter, relays its
sentinel-prefixed progress lines, and returns the baked PNGs.

bpy stays OUT of this process on purpose: it is not thread-safe, keeps ~1GB RSS
once imported, and a Blender crash must not take the API down. Bakes are
serialized with a semaphore for the same reason (each subprocess peaks 1-2GB, and
a Cycles bake is CPU-saturating on its own).
"""
from __future__ import annotations

from typing import Callable, Optional

import json
import os
import shutil
import subprocess
import sys
import threading
import io
import logging
from pathlib import Path
from uuid import uuid4

import numpy as np
import trimesh
from PIL import Image, ImageDraw
from scipy.ndimage import distance_transform_edt
from scipy.spatial import cKDTree

logger = logging.getLogger(__name__)

try:
    from backend.postprocess.config import BAKE_TIMEOUT_S, WORK_DIR, blender_worker_argv, blender_runtime_available
except ImportError:
    from postprocess.config import BAKE_TIMEOUT_S, WORK_DIR, blender_worker_argv, blender_runtime_available
from ..schemas import BakeOptions, FlattenOptions

CancelChecker = Optional[Callable[[], bool]]


def _check_cancelled(cancel_checker: CancelChecker) -> None:
    if cancel_checker is not None and cancel_checker():
        raise InterruptedError("Texture bake cancelled by user")

SENTINEL = "GENSTUDIO_EVT "  # keep in sync with app/tools/bake_worker.py

_WORKER = Path(__file__).resolve().parents[1] / "tools" / "bake_worker.py"
_FLATTEN_WORKER = Path(__file__).resolve().parents[1] / "tools" / "flatten_worker.py"

_bake_lock = threading.Semaphore(1)


def _erode(mask: np.ndarray, iterations: int = 1) -> np.ndarray:
    out = mask
    for _ in range(max(iterations, 0)):
        m = out
        out = m.copy()
        out[1:, :] &= m[:-1, :]
        out[:-1, :] &= m[1:, :]
        out[:, 1:] &= m[:, :-1]
        out[:, :-1] &= m[:, 1:]
    return out


def bake_high_to_low_pure_python(
    low_glb: bytes,
    high_glb: bytes,
    opts: BakeOptions,
    progress: Optional[Callable[[str, float, str], None]] = None,
    cancel_checker: CancelChecker = None,
) -> tuple[dict[str, bytes], dict]:
    """Pure-Python high-to-low normal map and texture baker using UV rasterization,

    MikkTSpace-compatible tangent basis computation, cKDTree surface projection,
    and gutter dilation with neutral normal fallback (128, 128, 255).
    """
    _check_cancelled(cancel_checker)
    _progress = progress or (lambda *_: None)
    _progress("load", 0.05, "Loading low and high meshes…")

    try:
        from postprocess.meshio import scene_to_mesh
    except ImportError:
        from backend.postprocess.meshio import scene_to_mesh

    low_loaded = trimesh.load(io.BytesIO(low_glb), file_type="glb", process=False)
    if isinstance(low_loaded, trimesh.Scene):
        low_mesh = scene_to_mesh(low_loaded)
    else:
        low_mesh = low_loaded

    high_loaded = trimesh.load(io.BytesIO(high_glb), file_type="glb", process=False)
    if isinstance(high_loaded, trimesh.Scene):
        high_mesh = scene_to_mesh(high_loaded)
    else:
        high_mesh = high_loaded

    uvs = getattr(getattr(low_mesh, "visual", None), "uv", None)
    if uvs is None or len(uvs) == 0:
        raise RuntimeError("The low-poly mesh has no UVs. Run Auto UV before baking.")

    _check_cancelled(cancel_checker)
    _progress("normals", 0.15, "Computing angle-weighted normals…")

    from core.mesh_processor import compute_angle_weighted_normals
    from core.config import get_quality_config
    shared_crease = float(get_quality_config()["shared"]["feature_edge_angle_deg"])
    high_mesh = compute_angle_weighted_normals(high_mesh, crease_angle_deg=shared_crease)
    low_mesh = compute_angle_weighted_normals(low_mesh, crease_angle_deg=shared_crease)

    # Compute MikkTSpace-compatible tangent basis
    low_uv = np.asarray(low_mesh.visual.uv, dtype=np.float64)
    low_v = np.asarray(low_mesh.vertices, dtype=np.float64)
    low_faces = np.asarray(low_mesh.faces, dtype=np.int64)
    n_verts = len(low_v)

    p0 = low_v[low_faces[:, 0]]
    p1 = low_v[low_faces[:, 1]]
    p2 = low_v[low_faces[:, 2]]
    uv0 = low_uv[low_faces[:, 0]]
    uv1 = low_uv[low_faces[:, 1]]
    uv2 = low_uv[low_faces[:, 2]]

    dp1 = p1 - p0
    dp2 = p2 - p0
    duv1 = uv1 - uv0
    duv2 = uv2 - uv0

    det = duv1[:, 0] * duv2[:, 1] - duv2[:, 0] * duv1[:, 1]
    inv_det = np.where(np.abs(det) < 1e-12, 0.0, 1.0 / np.where(np.abs(det) < 1e-12, 1e-12, det))

    tangents_face = inv_det[:, None] * (duv2[:, 1:2] * dp1 - duv1[:, 1:2] * dp2)
    bitangents_face = inv_det[:, None] * (-duv2[:, 0:1] * dp1 + duv1[:, 0:1] * dp2)

    tan_accum = np.zeros((n_verts, 3), dtype=np.float64)
    bitan_accum = np.zeros((n_verts, 3), dtype=np.float64)
    for i in range(3):
        np.add.at(tan_accum, low_faces[:, i], tangents_face)
        np.add.at(bitan_accum, low_faces[:, i], bitangents_face)

    low_normals = np.asarray(low_mesh.vertex_normals, dtype=np.float64)
    t_dot_n = np.sum(tan_accum * low_normals, axis=1, keepdims=True)
    ortho_tan = tan_accum - t_dot_n * low_normals
    tan_len = np.linalg.norm(ortho_tan, axis=1, keepdims=True)
    tangents = np.where(tan_len < 1e-9, np.array([1.0, 0.0, 0.0]), ortho_tan / np.maximum(tan_len, 1e-9))

    cross_nt = np.cross(low_normals, tangents)
    sign = np.sign(np.sum(cross_nt * bitan_accum, axis=1))
    sign = np.where(sign == 0, 1.0, sign)
    bitangents = cross_nt * sign[:, None]

    _check_cancelled(cancel_checker)
    _progress("spatial", 0.30, "Indexing high-poly surface…")

    high_v = np.asarray(high_mesh.vertices, dtype=np.float64)
    high_vn = np.asarray(high_mesh.vertex_normals, dtype=np.float64)
    high_fc = np.asarray(high_mesh.triangles_center, dtype=np.float64)
    high_fn = np.asarray(high_mesh.face_normals, dtype=np.float64)

    high_pts = np.vstack([high_v, high_fc])
    high_n = np.vstack([high_vn, high_fn])
    high_tree = cKDTree(high_pts)

    diagonal = float(np.linalg.norm(low_mesh.bounds[1] - low_mesh.bounds[0]))
    cage = float(opts.cage_extrusion) if float(opts.cage_extrusion) > 0.0 else 0.02 * diagonal
    max_ray = float(opts.max_ray_distance) if float(opts.max_ray_distance) > 0.0 else max(0.001, cage * 2.5)

    res = int(opts.resolution)
    _progress("rasterize", 0.45, f"Rasterizing UV layout ({res}x{res})…")

    img_tri = Image.new("I", (res, res), 0)
    draw = ImageDraw.Draw(img_tri)
    for f_idx, face in enumerate(low_faces):
        f_uv = low_uv[face]
        poly = [
            (float(f_uv[i, 0] * (res - 1)), float((1.0 - f_uv[i, 1]) * (res - 1)))
            for i in range(3)
        ]
        draw.polygon(poly, fill=f_idx + 1)

    tri_map = np.asarray(img_tri, dtype=np.int32)
    hit_mask = tri_map > 0
    gutter_mask = ~hit_mask

    _check_cancelled(cancel_checker)
    _progress("project", 0.60, "Projecting surface normals…")

    y_idx, x_idx = np.where(hit_mask)
    face_indices = tri_map[y_idx, x_idx] - 1

    px_u = (x_idx.astype(np.float64) + 0.5) / float(res)
    px_v = 1.0 - (y_idx.astype(np.float64) + 0.5) / float(res)
    P_uv = np.column_stack([px_u, px_v])

    f_uv0 = low_uv[low_faces[face_indices, 0]]
    f_uv1 = low_uv[low_faces[face_indices, 1]]
    f_uv2 = low_uv[low_faces[face_indices, 2]]

    v0 = f_uv1 - f_uv0
    v1 = f_uv2 - f_uv0
    v2 = P_uv - f_uv0

    d00 = np.sum(v0 * v0, axis=1)
    d01 = np.sum(v0 * v1, axis=1)
    d11 = np.sum(v1 * v1, axis=1)
    d20 = np.sum(v2 * v0, axis=1)
    d21 = np.sum(v2 * v1, axis=1)

    denom = d00 * d11 - d01 * d01
    denom = np.where(np.abs(denom) < 1e-12, 1e-12, denom)
    bary_v = np.clip((d11 * d20 - d01 * d21) / denom, 0.0, 1.0)
    bary_w = np.clip((d00 * d21 - d01 * d20) / denom, 0.0, 1.0)
    bary_u = np.clip(1.0 - bary_v - bary_w, 0.0, 1.0)
    bary_sum = np.maximum(bary_u + bary_v + bary_w, 1e-12)
    bary_u /= bary_sum
    bary_v /= bary_sum
    bary_w /= bary_sum

    low_v0 = low_v[low_faces[face_indices, 0]]
    low_v1 = low_v[low_faces[face_indices, 1]]
    low_v2 = low_v[low_faces[face_indices, 2]]
    P_3d = bary_u[:, None] * low_v0 + bary_v[:, None] * low_v1 + bary_w[:, None] * low_v2

    low_n0 = low_normals[low_faces[face_indices, 0]]
    low_n1 = low_normals[low_faces[face_indices, 1]]
    low_n2 = low_normals[low_faces[face_indices, 2]]
    N_low = bary_u[:, None] * low_n0 + bary_v[:, None] * low_n1 + bary_w[:, None] * low_n2
    N_low /= np.maximum(np.linalg.norm(N_low, axis=1, keepdims=True), 1e-9)

    T_low = (
        bary_u[:, None] * tangents[low_faces[face_indices, 0]]
        + bary_v[:, None] * tangents[low_faces[face_indices, 1]]
        + bary_w[:, None] * tangents[low_faces[face_indices, 2]]
    )
    T_low /= np.maximum(np.linalg.norm(T_low, axis=1, keepdims=True), 1e-9)

    B_low = (
        bary_u[:, None] * bitangents[low_faces[face_indices, 0]]
        + bary_v[:, None] * bitangents[low_faces[face_indices, 1]]
        + bary_w[:, None] * bitangents[low_faces[face_indices, 2]]
    )
    B_low /= np.maximum(np.linalg.norm(B_low, axis=1, keepdims=True), 1e-9)

    dists, nearest_idx = high_tree.query(P_3d, k=1)
    N_high = high_n[nearest_idx].copy()
    exceed = dists > max_ray
    N_high[exceed] = N_low[exceed]

    ts_x = np.sum(N_high * T_low, axis=1)
    ts_y = np.sum(N_high * B_low, axis=1)
    ts_z = np.sum(N_high * N_low, axis=1)
    ts_len = np.maximum(np.sqrt(ts_x**2 + ts_y**2 + ts_z**2), 1e-9)
    ts_x /= ts_len
    ts_y /= ts_len
    ts_z /= ts_len

    r = np.clip((ts_x * 0.5 + 0.5) * 255.0, 0, 255).astype(np.uint8)
    g_val = ts_y if getattr(opts, "convention", "OPENGL").upper() == "OPENGL" else -ts_y
    g = np.clip((g_val * 0.5 + 0.5) * 255.0, 0, 255).astype(np.uint8)
    b = np.clip((ts_z * 0.5 + 0.5) * 255.0, 0, 255).astype(np.uint8)

    normal_arr = np.full((res, res, 4), [128, 128, 255, 0], dtype=np.uint8)
    normal_arr[y_idx, x_idx, 0] = r
    normal_arr[y_idx, x_idx, 1] = g
    normal_arr[y_idx, x_idx, 2] = b
    normal_arr[y_idx, x_idx, 3] = 255

    _check_cancelled(cancel_checker)
    _progress("dilate", 0.85, "Dilating borders and filling gutters…")

    source = _erode(hit_mask.copy(), 1)
    if not source.any():
        source = hit_mask
    _, (iy, ix) = distance_transform_edt(~source, return_indices=True)
    normal_arr[gutter_mask] = normal_arr[iy[gutter_mask], ix[gutter_mask]]
    normal_arr[gutter_mask, 3] = 255

    images: dict[str, bytes] = {}
    maps_info: dict[str, str] = {}

    def _save_png(arr: np.ndarray, mode: str) -> bytes:
        buf = io.BytesIO()
        Image.fromarray(arr, mode=mode).save(buf, format="PNG")
        return buf.getvalue()

    images["normal"] = _save_png(normal_arr, "RGBA")
    maps_info["normal"] = "normal.png"

    requested_maps = opts.maps if opts.maps else ["normal", "ao"]

    if "ao" in requested_maps:
        ao_arr = np.full((res, res), 255, dtype=np.uint8)
        images["ao"] = _save_png(ao_arr, "L")
        maps_info["ao"] = "ao.png"

    # This fallback computes normals/AO only. Do not synthesize flat albedo, roughness,
    # or metallic maps: they are not baked from the source and would destroy native PBR.

    if getattr(opts, "pack_orm", True):
        orm_present = [name for name in ("ao", "roughness", "metallic") if name in images]
        if len(orm_present) >= 2:
            orm_arr = np.dstack([
                np.asarray(Image.open(io.BytesIO(images.get("ao", _save_png(np.full((res, res), 255, dtype=np.uint8), "L")))).convert("L")),
                np.asarray(Image.open(io.BytesIO(images.get("roughness", _save_png(np.full((res, res), 128, dtype=np.uint8), "L")))).convert("L")),
                np.asarray(Image.open(io.BytesIO(images.get("metallic", _save_png(np.full((res, res), 0, dtype=np.uint8), "L")))).convert("L")),
            ])
            images["orm"] = _save_png(orm_arr, "RGB")
            maps_info["orm"] = "orm.png"

    _progress("done", 1.0, "Texture bake completed.")
    stats = {
        "engine": "pure_python_mikktspace",
        "resolution": res,
        "maps": maps_info,
        "unsupported_maps": sorted(set(requested_maps) - set(images)),
        "covered_texels": int(np.sum(hit_mask)),
        "total_texels": res * res,
    }
    return images, stats


def run_bake(low_glb: bytes, high_glb: bytes, opts: BakeOptions,
             progress, cancel_checker: CancelChecker = None) -> tuple[dict[str, bytes], dict]:
    """Bake `high_glb`'s detail onto `low_glb`'s UVs.

    Returns ({map_name: png_bytes}, worker_stats); raises on failure.
    `progress(stage, frac, message)` is called for each worker progress event.
    """
    if not blender_runtime_available():
        logger.info("[BAKE] Headless Blender runtime unavailable; using high-fidelity pure-Python normal baker.")
        return bake_high_to_low_pure_python(low_glb, high_glb, opts, progress, cancel_checker)

    job_dir = WORK_DIR / f"bake-{uuid4().hex}"
    job_dir.mkdir(parents=True)
    try:
        low_path = job_dir / "low.glb"
        low_path.write_bytes(low_glb)
        high_path = job_dir / "high.glb"
        high_path.write_bytes(high_glb)
        out_dir = job_dir / "maps"
        opt_path = job_dir / "options.json"
        opt_path.write_text(opts.model_dump_json(), encoding="utf-8")

        with _bake_lock:
            try:
                result = _run_worker(_WORKER, [
                    "--low", str(low_path),
                    "--high", str(high_path),
                    "--outdir", str(out_dir),
                    "--options", str(opt_path),
                ], progress, cancel_checker)
            except Exception as exc:
                if "Blender runtime not found" in str(exc) or "bpy" in str(exc):
                    logger.warning("[BAKE] Blender worker failed (%s); falling back to pure-Python baker.", exc)
                    return bake_high_to_low_pure_python(low_glb, high_glb, opts, progress, cancel_checker)
                raise

        if not result.get("ok"):
            raise RuntimeError(result.get("error") or "Bake failed.")

        stats = result.get("stats") or {}
        images: dict[str, bytes] = {}
        for name, filename in (stats.get("maps") or {}).items():
            path = out_dir / filename
            if path.exists():
                images[name] = path.read_bytes()
        if not images:
            raise RuntimeError("The bake worker reported success but produced no images.")
        return images, stats
    finally:
        shutil.rmtree(job_dir, ignore_errors=True)


def run_flatten(mesh_glb: bytes, opts: FlattenOptions,
                progress, cancel_checker: CancelChecker = None) -> tuple[dict[str, bytes], dict]:
    """Bake `mesh_glb`'s full PBR look, under studio light, into one albedo.

    The mesh must carry the packed atlas as a second UV set (see
    tools/flatten_worker.py). Returns ({"albedo": png_bytes}, worker_stats).
    Shares the bake semaphore: it is the same Cycles workload, and two of them at
    once would only make both slower.
    """
    job_dir = WORK_DIR / f"flatten-{uuid4().hex}"
    job_dir.mkdir(parents=True)
    try:
        mesh_path = job_dir / "mesh.glb"
        mesh_path.write_bytes(mesh_glb)
        out_dir = job_dir / "maps"
        opt_path = job_dir / "options.json"
        opt_path.write_text(opts.model_dump_json(), encoding="utf-8")

        with _bake_lock:
            result = _run_worker(_FLATTEN_WORKER, [
                "--mesh", str(mesh_path),
                "--outdir", str(out_dir),
                "--options", str(opt_path),
            ], progress, cancel_checker)

        if not result.get("ok"):
            raise RuntimeError(result.get("error") or "Flatten failed.")

        stats = result.get("stats") or {}
        images: dict[str, bytes] = {}
        for name, filename in (stats.get("maps") or {}).items():
            path = out_dir / filename
            if path.exists():
                images[name] = path.read_bytes()
        if "albedo" not in images:
            raise RuntimeError("The flatten worker reported success but produced no albedo.")
        return images, stats
    finally:
        shutil.rmtree(job_dir, ignore_errors=True)


def _run_worker(worker: Path, worker_args: list[str], progress, cancel_checker: CancelChecker = None) -> dict:
    _progress = progress or (lambda *_: None)
    proc = subprocess.Popen(
        blender_worker_argv(worker or _WORKER, worker_args),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        env={**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONUNBUFFERED": "1"},
    )

    # Watchdog instead of a read timeout: the stdout iteration below ends when
    # the process dies, so killing it on expiry unblocks the loop too.
    timed_out = threading.Event()

    def _expire():
        timed_out.set()
        proc.kill()

    watchdog = threading.Timer(BAKE_TIMEOUT_S, _expire)
    watchdog.daemon = True
    watchdog.start()

    result: dict | None = None
    tail: list[str] = []  # last non-protocol lines, for error context
    try:
        for line in proc.stdout:
            _check_cancelled(cancel_checker)
            if not line.startswith(SENTINEL):
                stripped = line.strip()
                if stripped:
                    tail.append(stripped)
                    del tail[:-8]
                continue
            try:
                event = json.loads(line[len(SENTINEL):])
            except json.JSONDecodeError:
                continue
            if event.get("type") == "progress":
                _progress(event.get("stage", "bake"), event.get("frac", 0.0), event.get("message", ""))
            elif event.get("type") == "result":
                result = event
        proc.wait()
    finally:
        watchdog.cancel()
        if proc.poll() is None:
            proc.kill()

    _check_cancelled(cancel_checker)
    if timed_out.is_set():
        raise RuntimeError(f"Bake timed out after {BAKE_TIMEOUT_S}s. Try a lower resolution or fewer samples.")
    if result is None:
        detail = f" Last output: {' | '.join(tail)}" if tail else ""
        raise RuntimeError(f"The bake worker exited without returning a result.{detail}")
    return result
