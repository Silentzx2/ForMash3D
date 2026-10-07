"""ForMash3D production post-processing pipeline.

This module owns only the canonical asset lifecycle. The processing algorithms live
in the ported services under backend/postprocess/services/.
"""
from __future__ import annotations

import base64
import hashlib
import io
import json
import logging
import re
import shutil
import struct
import subprocess
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, Optional

import numpy as np
import trimesh
from PIL import Image

from core.utils.file_utils import get_storage_base_dir, resolve_server_file_path
from core.utils.log_formatters import format_banner, format_box, format_bytes
from core.quality.evaluation import compare_meshes, quality_gate
from core.scheduler.resource_planner import configure_cpu_runtime, cpu_count
from .config import BLENDER_EXECUTABLE
from .meshio import load_mesh, load_mesh_vertex_normals, mesh_stats
from .physics import build_physics_metadata, collision_options_for_quality, normalize_physics_config
from .services.auto_retopo import run_auto_retopo
from .services.auto_uv import run_auto_uv
from .services.collision import run_collision
from .services.convert_fbx import run_convert_fbx
from .services.inspect import run_inspect
from .services.repair import run_repair, topology_counts
from .services.simplify import run_lods, run_optimize
from .schemas import (
    AutoRetopoOptions,
    AutoUvOptions,
    CollisionOptions,
    ConvertOptions,
    InspectOptions,
    LODOptions,
    OptimizeOptions,
    RepairOptions,
)

logger = logging.getLogger(__name__)

GenerationProgress = Optional[Callable[[float, str, str], None]]

MAX_PRODUCTION_FACES = 200_000
_FORMATS = ("glb", "fbx")


def _storage_root() -> Path:
    root = get_storage_base_dir() / "models" / "meshes"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _safe_name(value: str) -> str:
    value = re.sub(r"[^A-Za-z0-9._-]+", "_", str(value)).strip("._-")
    return value or "asset"


def _job_hash(job_id: str) -> str:
    return hashlib.sha256(job_id.encode("utf-8")).hexdigest()[:8]


def canonical_asset_workspace(
    job_id: str,
    generation_result: Dict[str, Any],
    job_inputs: Optional[Dict[str, Any]] = None,
) -> Path:
    """Resolve the canonical workspace path used by run_postprocess_job()."""
    job_inputs = job_inputs or {}
    raw_candidate = (
        generation_result.get("output_mesh_path")
        or generation_result.get("mesh_path")
        or generation_result.get("output_path")
        or generation_result.get("file_path")
    )
    try:
        raw_path = resolve_server_file_path(raw_candidate)
    except Exception:
        raw_path = raw_candidate
    source_stem = (
        job_inputs.get("asset_name")
        or job_inputs.get("image_name")
        or job_inputs.get("source_stem")
        or job_inputs.get("original_filename")
        or job_inputs.get("image_path")
        or job_inputs.get("text_prompt")
        or (Path(raw_path).stem if raw_path else "asset")
    )
    stem_val = Path(str(source_stem)).stem
    if stem_val.startswith("upload_") and job_inputs.get("text_prompt"):
        stem_val = str(job_inputs["text_prompt"])[:32]
    asset_name = _safe_name(stem_val)
    clean_job_id = _safe_name(job_id)
    return _storage_root() / f"{asset_name}_{clean_job_id}"


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _collect_input_hashes(inputs: Dict[str, Any]) -> Dict[str, str]:
    hashes: Dict[str, str] = {}
    for key, value in inputs.items():
        if not isinstance(value, str):
            continue
        candidate = Path(value)
        if candidate.is_file():
            try:
                hashes[key] = _sha256_file(candidate)
            except OSError:
                logger.debug("Unable to hash input %s", candidate, exc_info=True)
    return hashes


def _json_safe(value: Any) -> Any:
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
    if isinstance(value, (np.integer, np.floating)):
        return value.item()
    if isinstance(value, np.ndarray):
        return value.tolist()
    return value


def _write_json(path: Path, value: Any) -> None:
    path.write_text(
        json.dumps(_json_safe(value), indent=2, sort_keys=True, default=str),
        encoding="utf-8",
    )


def _emit(progress: GenerationProgress, frac: float, stage: str, message: str) -> None:
    if progress is not None:
        progress(max(0.0, min(1.0, frac)), stage, message)


def _export_bytes(mesh: trimesh.Trimesh, fmt: str) -> bytes:
    payload = mesh.export(file_type=fmt)
    if isinstance(payload, bytes):
        return payload
    if isinstance(payload, str):
        return payload.encode("utf-8")
    if isinstance(payload, dict):
        key = next((k for k in payload if str(k).lower().endswith(f".{fmt}")), None)
        if key is None and payload:
            key = next(iter(payload))
        data = payload.get(key) if key is not None else None
        if isinstance(data, bytes):
            return data
        if isinstance(data, str):
            return data.encode("utf-8")
    raise RuntimeError(f"Unable to export {fmt} from processed mesh.")


def _export_quad_obj(mesh: trimesh.Trimesh, quad_faces: Any) -> bytes:
    """Export mesh as OBJ format with quad/polygonal faces."""
    lines = ["# ForMash3D Quad Mesh Export\n"]
    for v in mesh.vertices:
        lines.append(f"v {v[0]:.6f} {v[1]:.6f} {v[2]:.6f}\n")
    has_uv = hasattr(mesh, "visual") and getattr(mesh.visual, "uv", None) is not None and len(mesh.visual.uv) == len(mesh.vertices)
    if has_uv:
        for uv in mesh.visual.uv:
            lines.append(f"vt {uv[0]:.6f} {uv[1]:.6f}\n")
    has_vn = len(mesh.vertex_normals) == len(mesh.vertices)
    if has_vn:
        for vn in mesh.vertex_normals:
            lines.append(f"vn {vn[0]:.6f} {vn[1]:.6f} {vn[2]:.6f}\n")

    for face in quad_faces:
        if has_uv and has_vn:
            items = [f"{int(idx)+1}/{int(idx)+1}/{int(idx)+1}" for idx in face]
        elif has_uv:
            items = [f"{int(idx)+1}/{int(idx)+1}" for idx in face]
        elif has_vn:
            items = [f"{int(idx)+1}//{int(idx)+1}" for idx in face]
        else:
            items = [f"{int(idx)+1}" for idx in face]
        lines.append(f"f {' '.join(items)}\n")
    return "".join(lines).encode("utf-8")


def _export_glb(mesh: trimesh.Trimesh) -> bytes:
    payload = mesh.export(file_type="glb")
    if isinstance(payload, bytes):
        return payload
    if isinstance(payload, bytearray):
        return bytes(payload)
    raise RuntimeError("Processed mesh did not export as GLB bytes.")


def _export_gltf_embedded(glb_bytes: bytes, target: Path) -> None:
    # 1. Try pure python glb-to-embedded-gltf first (no external binary dependency)
    try:
        if len(glb_bytes) >= 12:
            magic, version, length = struct.unpack_from("<4sII", glb_bytes, 0)
            if magic == b"glTF":
                offset = 12
                json_data = None
                bin_data = b""
                while offset < len(glb_bytes):
                    chunk_len, chunk_type = struct.unpack_from("<I4s", glb_bytes, offset)
                    offset += 8
                    chunk_payload = glb_bytes[offset : offset + chunk_len]
                    offset += chunk_len
                    if chunk_type == b"JSON":
                        json_data = json.loads(chunk_payload.decode("utf-8"))
                    elif chunk_type in (b"BIN\x00", b"BIN"):
                        bin_data = chunk_payload

                if json_data is not None:
                    if bin_data and "buffers" in json_data and len(json_data["buffers"]) > 0:
                        b64_uri = "data:application/octet-stream;base64," + base64.b64encode(bin_data).decode("ascii")
                        json_data["buffers"][0]["uri"] = b64_uri
                    target.write_text(json.dumps(json_data, indent=2), encoding="utf-8")
                    return
    except Exception as exc:
        logger.debug("Pure Python GLTF embedded conversion failed: %s; trying Blender fallback", exc)

    # 2. Blender fallback if installed
    if shutil.which(BLENDER_EXECUTABLE):
        with tempfile.TemporaryDirectory(prefix="formash3d-gltf-") as temp_dir:
            temp_root = Path(temp_dir)
            input_path = temp_root / "mesh.glb"
            input_path.write_bytes(glb_bytes)
            expr = (
                "import bpy; "
                "bpy.ops.wm.read_factory_settings(use_empty=True); "
                f"bpy.ops.import_scene.gltf(filepath={str(input_path)!r}); "
                f"bpy.ops.export_scene.gltf(filepath={str(target)!r}, export_format='GLTF_EMBEDDED')"
            )
            result = subprocess.run(
                [BLENDER_EXECUTABLE, "--background", "--python-expr", expr],
                capture_output=True,
                text=True,
                check=False,
            )
            if result.returncode == 0 and target.exists():
                return
            detail = (result.stderr or result.stdout or "").strip()[-2000:]
            raise RuntimeError(f"Embedded GLTF export failed: {detail}")

    raise RuntimeError("Unable to export embedded GLTF: conversion failed and Blender is not installed.")


def _has_native_textures(mesh: trimesh.Trimesh) -> bool:
    """Return True when actual image/texture payloads or rich vertex colors exist on the mesh."""
    visual = getattr(mesh, "visual", None)
    if visual is None:
        return False

    def _is_real_image(img: Any) -> bool:
        if img is None:
            return False
        size = getattr(img, "size", None)
        if size is not None and (size[0] <= 2 or size[1] <= 2):
            return False
        return True

    if _is_real_image(getattr(visual, "image", None)):
        return True

    # Detect vertex colors (e.g. from TripoSR / Tripo meshes)
    vertex_colors = getattr(visual, "vertex_colors", None)
    if vertex_colors is not None and len(vertex_colors) > 0:
        vc = np.asarray(vertex_colors)
        if vc.ndim == 2 and vc.shape[0] > 0 and vc.shape[1] >= 3:
            # Check if vertex colors contain genuine variation (not uncolored default white/gray)
            rgb = vc[:, :3]
            if np.any(np.std(rgb, axis=0) > 1.0):
                return True

    material = getattr(visual, "material", None)
    if material is None:
        return False

    if _is_real_image(getattr(material, "image", None)):
        return True

    for attribute in (
        "baseColorTexture",
        "normalTexture",
        "metallicRoughnessTexture",
        "occlusionTexture",
        "emissiveTexture",
    ):
        val = getattr(material, attribute, None)
        if val is not None and _is_real_image(val):
            return True

    return False


def _has_native_textures_scene(raw_bytes: bytes, filename: str = "model.glb") -> bool:
    """Inspect the raw scene before concatenation to detect native textures."""
    try:
        ext = Path(filename or "mesh.glb").suffix.lower().lstrip(".") or "glb"
        loaded = trimesh.load(io.BytesIO(raw_bytes), file_type=ext, process=False)
        if isinstance(loaded, trimesh.Scene):
            return any(_has_native_textures(g) for g in loaded.geometry.values() if isinstance(g, trimesh.Trimesh))
        if isinstance(loaded, trimesh.Trimesh):
            return _has_native_textures(loaded)
        return False
    except Exception:
        return False


def _printability_report(mesh: trimesh.Trimesh) -> Dict[str, Any]:
    """Return deterministic printability metrics without mutating geometry."""
    topology = topology_counts(mesh.vertices, mesh.faces)
    try:
        components = int(len(mesh.split(only_watertight=False)))
    except Exception:
        components = int(topology.get("components", 0) or 0)
    passed = (
        bool(topology.get("watertight", False))
        and int(topology.get("boundary_edges", 0) or 0) == 0
        and int(topology.get("non_manifold_edges", 0) or 0) == 0
    )
    return {
        "status": "pass" if passed else "fail",
        "watertight": bool(topology.get("watertight", False)),
        "boundary_edges": int(topology.get("boundary_edges", 0) or 0),
        "non_manifold_edges": int(topology.get("non_manifold_edges", 0) or 0),
        "vertex_count": int(len(mesh.vertices)),
        "face_count": int(len(mesh.faces)),
        "connected_components": components,
        "topology": topology,
    }


def _quality_guard(reference: trimesh.Trimesh, candidate: trimesh.Trimesh, max_bounds_drift: float = 0.02, max_vertex_growth: float = 1.25) -> Dict[str, Any]:
    """Reject post-process results that materially drift from the reference mesh."""
    ref_vertices = np.asarray(reference.vertices, dtype=float)
    cand_vertices = np.asarray(candidate.vertices, dtype=float)
    if not len(cand_vertices) or not np.isfinite(cand_vertices).all():
        return {"passed": False, "reason": "candidate has no finite vertices"}

    ref_faces = int(len(reference.faces))
    cand_faces = int(len(candidate.faces))
    if cand_faces > ref_faces:
        return {
            "passed": False,
            "reason": f"candidate increased face count ({cand_faces} > {ref_faces})",
            "reference_faces": ref_faces,
            "candidate_faces": cand_faces,
        }

    ref_bounds = np.asarray(reference.bounds, dtype=float)
    cand_bounds = np.asarray(candidate.bounds, dtype=float)
    ref_diag = float(np.linalg.norm(ref_bounds[1] - ref_bounds[0])) if ref_bounds.shape == (2, 3) else 0.0
    scale = max(ref_diag, 1e-9)
    bounds_drift = float(np.max(np.abs(cand_bounds - ref_bounds)) / scale) if cand_bounds.shape == (2, 3) else float("inf")
    if bounds_drift > max_bounds_drift:
        return {
            "passed": False,
            "reason": f"candidate bounds drifted by {bounds_drift:.4f} (> {max_bounds_drift:.4f})",
            "reference_faces": ref_faces,
            "candidate_faces": cand_faces,
            "bounds_drift": bounds_drift,
        }

    max_vertices = max(1, int(np.ceil(len(ref_vertices) * max_vertex_growth)))
    if len(cand_vertices) > max_vertices:
        return {
            "passed": False,
            "reason": f"candidate vertex count grew unexpectedly ({len(cand_vertices)} > {max_vertices})",
            "reference_faces": ref_faces,
            "candidate_faces": cand_faces,
            "reference_vertices": len(ref_vertices),
            "candidate_vertices": len(cand_vertices),
            "bounds_drift": bounds_drift,
        }

    return {
        "passed": True,
        "reference_faces": ref_faces,
        "candidate_faces": cand_faces,
        "reference_vertices": len(ref_vertices),
        "candidate_vertices": len(cand_vertices),
        "bounds_drift": bounds_drift,
    }


def _save_file(path: Path, payload: bytes) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(payload)
    return str(path)


def _build_result(
    job_id: str,
    asset_dir: Path,
    asset_name: str,
    qa_report: Dict[str, Any],
    generated: Dict[str, Any],
    target_polycount: int = MAX_PRODUCTION_FACES,
    lod_enabled: bool = True,
) -> Dict[str, Any]:
    primary = generated["game_ready"].get("glb") or generated["game_ready"].get("obj")
    base_url = f"/api/v1/system/jobs/{job_id}"
    rel_model_dir = asset_dir.name
    artifact_errors = generated.get("artifact_errors", {})
    primary_name = Path(primary).name if primary else f"{asset_name}.glb"
    download_model_url = f"{base_url}/download?artifact_format=glb"
    download_master_url = f"{base_url}/download?artifact_format=master"

    lod_urls = [
        f"{base_url}/download?artifact_format=lod{idx}"
        for idx in sorted(generated["lods"])
    ]
    pbr_urls = {
        name: f"{base_url}/download?artifact_format=texture_{name}"
        for name in sorted(generated["textures"])
    }

    result = {
        "success": True,
        "output_mesh_path": primary,
        "static_url": None,
        "model_url": download_model_url,
        "active_model_url": download_model_url,
        "download_url": f"{base_url}/download?artifact_format=glb",
        "source_model_url": download_master_url,
        "high_fidelity_url": download_master_url,
        "game_ready_url": download_model_url,
        "game_ready_formats": {
            fmt: f"{base_url}/download?artifact_format={fmt}"
            for fmt in generated["game_ready"]
        },
        "lod_urls": lod_urls,
        "collision_url": (
            f"{base_url}/download?artifact_format=collision"
            if generated.get("collision")
            else None
        ),
        "physics_url": (
            f"{base_url}/download?artifact_format=physics_json"
            if generated.get("physics")
            else None
        ),
        "physics_ready": bool(generated.get("physics")),
        "physics": generated.get("physics_metadata"),
        "textures": generated.get("textures", {}),
        "pbr_maps": pbr_urls,
        "texture_status": generated.get("texture_status", "not_generated"),
        "thumbnail_url": f"{base_url}/thumbnail" if generated.get("thumbnail") else None,
        "thumbnail_path": str(generated["thumbnail"]) if generated.get("thumbnail") else None,
        "thumbnail_download_url": (
            f"{base_url}/download?artifact_format=thumbnail"
            if generated.get("thumbnail")
            else None
        ),
        "zip_url": f"{base_url}/download?artifact_format=zip",
        "asset_root": str(asset_dir),
        "asset_name": asset_name,
        "postprocess_status": "completed",
        "target_polycount": target_polycount,
        "lod_enabled": lod_enabled,
        "artifacts": {
            "master": {"status": "ready", "url": download_master_url, "required": True},
            "high_fidelity": {"status": "ready", "url": download_master_url, "required": True},
            "game_ready": {
                fmt: {
                    "status": (
                        "ready" if fmt in generated["game_ready"]
                        else "failed" if fmt in artifact_errors
                        else "unavailable"
                    ),
                    "url": f"{base_url}/download?artifact_format={fmt}" if fmt in generated["game_ready"] else None,
                    "error": artifact_errors.get(fmt),
                    "required": fmt == "glb",
                }
                for fmt in _FORMATS
            },
            "lods": {
                f"lod{idx}": {
                    "status": "ready",
                    "url": f"{base_url}/download?artifact_format=lod{idx}",
                    "required": False,
                }
                for idx in sorted(generated["lods"])
            } if lod_enabled else {},
            "collision": {
                "status": "ready" if generated.get("collision") else "skipped",
                "url": f"{base_url}/download?artifact_format=collision" if generated.get("collision") else None,
                "required": False,
            },
            "physics": {
                "status": "ready" if generated.get("physics") else "skipped",
                "url": f"{base_url}/download?artifact_format=physics_json" if generated.get("physics") else None,
                "required": False,
            },
            "qa_report": {"status": "ready", "url": f"{base_url}/download?artifact_format=qa_report", "required": True},
            "zip": {"status": "ready", "url": f"{base_url}/download?artifact_format=zip", "required": False},
        },
        "qa_report": qa_report,
        "artifact_errors": artifact_errors,
        "postprocess": {
            "asset_dir": str(asset_dir),
            "master": "master/source.glb",
            "high_fidelity": "master/source.glb",
            "game_ready": sorted(generated["game_ready"]),
            "lods": sorted(f"lod{idx}" for idx in generated["lods"]),
            "collision": bool(generated.get("collision")),
            "physics": bool(generated.get("physics")),
            "textures": sorted(generated["textures"]),
            "preview": bool(generated.get("thumbnail")),
        },
    }
    required_failed = any(
        artifact.get("status") == "failed"
        for group in result["artifacts"].values()
        if isinstance(group, dict)
        for artifact in (group.values() if isinstance(group, dict) else [])
        if isinstance(artifact, dict) and artifact.get("required") and artifact.get("status") == "failed"
    )
    any_failed = any(
        artifact.get("status") == "failed"
        for group in result["artifacts"].values()
        if isinstance(group, dict)
        for artifact in (group.values() if isinstance(group, dict) else [])
        if isinstance(artifact, dict)
    )
    result["production_status"] = "failed" if required_failed else "degraded" if any_failed else "ready"
    return result


def run_postprocess_job(
    job_id: str,
    generation_result: Dict[str, Any],
    job_inputs: Optional[Dict[str, Any]] = None,
    job_metadata: Optional[Dict[str, Any]] = None,
    progress: GenerationProgress = None,
) -> Dict[str, Any]:
    """Create the canonical asset workspace and run production post-processing."""
    job_inputs = job_inputs or {}
    job_metadata = job_metadata or {}
    quality_mode = str(job_inputs.get("quality") or job_inputs.get("meshQuality") or "high").lower()
    explicit_texture_resolution = job_inputs.get("texture_resolution")
    default_texture_resolution = {
        "low": 512,
        "medium": 1024,
        "high": 2048,
        "ultra": 4096,
    }.get(quality_mode, 2048)
    try:
        texture_resolution = int(explicit_texture_resolution or default_texture_resolution)
    except (TypeError, ValueError):
        texture_resolution = default_texture_resolution
    texture_resolution = max(512, min(4096, texture_resolution))
    cpu_threads = int(job_inputs.get("cpu_threads") or cpu_count())
    configure_cpu_runtime(cpu_threads)
    raw_target_polycount = job_inputs.get("target_polycount")
    try:
        parsed_target_polycount = int(raw_target_polycount) if raw_target_polycount is not None else None
    except (TypeError, ValueError):
        parsed_target_polycount = None

    # <= 0 is the explicit Native/Raw sentinel. Positive values are downstream-only budgets.
    if parsed_target_polycount is not None and parsed_target_polycount <= 0:
        resolved_target_polycount = 0
    else:
        try:
            resolved_target_polycount = min(
                MAX_PRODUCTION_FACES,
                max(5_000, int(parsed_target_polycount or MAX_PRODUCTION_FACES)),
            )
        except (TypeError, ValueError):
            resolved_target_polycount = MAX_PRODUCTION_FACES

    raw_candidate = (
        generation_result.get("output_mesh_path")
        or generation_result.get("mesh_path")
        or generation_result.get("output_path")
        or generation_result.get("file_path")
    )
    raw_path = resolve_server_file_path(raw_candidate)
    if not raw_path or not Path(raw_path).is_file():
        raise FileNotFoundError(f"Generation output mesh not found: {raw_candidate}")

    source_stem = (
        job_inputs.get("asset_name")
        or job_inputs.get("image_name")
        or job_inputs.get("source_stem")
        or job_inputs.get("original_filename")
        or job_inputs.get("image_path")
        or job_inputs.get("text_prompt")
        or Path(raw_path).stem
    )
    stem_val = Path(str(source_stem)).stem
    if stem_val.startswith("upload_") and job_inputs.get("text_prompt"):
        stem_val = str(job_inputs["text_prompt"])[:32]
    asset_name = _safe_name(stem_val)
    clean_job_id = _safe_name(job_id)
    root = _storage_root()
    asset_dir = root / f"{asset_name}_{clean_job_id}"
    base_name = f"{asset_name}_{clean_job_id}"
    master_dir = asset_dir / "master"
    game_ready_dir = asset_dir / "game_ready"
    lod_dir = asset_dir / "lods"
    collision_dir = asset_dir / "collision"
    texture_dir = asset_dir / "textures"
    preview_dir = asset_dir / "previews"
    metadata_dir = asset_dir / "metadata"

    # ponytail: create each dir immediately before its first write
    # so filesystem state reflects pipeline progress honestly
    master_dir.mkdir(parents=True, exist_ok=True)
    metadata_dir.mkdir(parents=True, exist_ok=True)

    master_path = master_dir / "source.glb"
    if not master_path.exists():
        shutil.copy2(raw_path, master_path)

    asset_manifest = metadata_dir / "asset.json"
    if asset_manifest.exists() and (game_ready_dir / f"{base_name}.glb").exists():
        saved = json.loads(asset_manifest.read_text(encoding="utf-8"))
        if Path(raw_path).resolve() != master_path.resolve() and Path(raw_path).exists():
            try:
                Path(raw_path).unlink()
                logger.info(
                    "[POSTPROCESS STORAGE] Removed legacy generation output after canonical asset recovery: %s",
                    raw_path,
                )
            except OSError:
                logger.warning(
                    "[POSTPROCESS STORAGE] Could not remove legacy generation output: %s",
                    raw_path,
                )
        saved["zip_url"] = f"/api/v1/system/jobs/{job_id}/download?artifact_format=zip"
        return saved

    pipeline_start_time = time.time()
    feature_type = str(job_metadata.get("feature") or job_inputs.get("feature") or "")
    is_quad_requested = (
        job_metadata.get("topology_mode") == "quad"
        or job_inputs.get("topology_mode") == "quad"
        or bool(job_metadata.get("quad_topology"))
        or bool(job_inputs.get("quad_topology"))
    )
    auto_optimize = bool(job_inputs.get("auto_optimize", False))
    lod_enabled = bool(job_inputs.get("generateLOD", True))
    should_bake = (
        bool(job_inputs.get("bake_normal_maps"))
        or bool(job_inputs.get("bake_high_to_low"))
        or bool(job_inputs.get("bake_textures"))
        or bool(job_metadata.get("bake_normal_maps"))
        or bool(job_metadata.get("bake_textures"))
    )
    physics_in_meta = job_metadata.get("physics_enabled")
    physics_in_inputs = job_inputs.get("physics_enabled")
    if physics_in_meta is not None:
        physics_enabled = bool(physics_in_meta)
    elif physics_in_inputs is not None:
        physics_enabled = bool(physics_in_inputs)
    else:
        physics_enabled = True
    physics_config = normalize_physics_config(
        job_metadata.get("physics_config") or job_inputs.get("physics_config")
    )
    raw_file_size = master_path.stat().st_size if master_path.exists() else 0

    logger.info(
        "\n" + format_banner(
            "POSTPROCESS: PIPELINE START",
            [
                ("Job ID", job_id),
                ("Asset Name", asset_name),
                ("Feature Type", feature_type or "standard_3d"),
                ("Source Mesh", f"{raw_path} ({format_bytes(raw_file_size)})"),
                ("Target Budget", f"{resolved_target_polycount:,} faces" if resolved_target_polycount else "Native / Raw (no decimation)"),
                ("Auto-Optimize", auto_optimize),
                ("Topology Mode", "Quad-dominant" if is_quad_requested else "Triangles"),
                ("Physics / Collision", f"Enabled (quality: {physics_config.get('collision_quality')})" if physics_enabled else "Disabled"),
                ("LOD Chain", f"Enabled (preset: {job_inputs.get('lodPreset') or 'high'})" if lod_enabled else "Disabled"),
                ("Normal Map Baking", should_bake),
                ("Asset Directory", str(asset_dir)),
            ],
        )
    )

    _emit(progress, 0.05, "postprocess", "Master asset secured.")

    raw_bytes = master_path.read_bytes()
    source_sha256 = _sha256_file(master_path)
    native_textures = _has_native_textures_scene(raw_bytes, master_path.name)
    mesh = load_mesh(raw_bytes, master_path.name)
    quality_trace = {
        "source": {
            **mesh_stats(mesh).model_dump(),
            "native_textures": native_textures,
        }
    }

    inspect_t0 = time.time()
    _emit(progress, 0.10, "inspect", "Inspecting generated mesh.")
    try:
        scene = trimesh.load(master_path, file_type="glb", process=False)
        if not isinstance(scene, trimesh.Scene):
            scene = trimesh.Scene(mesh)
        qa_before = run_inspect(
            scene,
            mesh,
            InspectOptions(
                tri_budget=resolved_target_polycount or MAX_PRODUCTION_FACES,
                texture_resolution=texture_resolution,
                max_material_count=8,
                uv_overlap_grid=512,
                uv_scan_max_faces=60_000,
                expect_ground_pivot=False,
            ),
        )
    except Exception as exc:
        qa_before = {"status": "warn", "warnings": [f"Initial inspection failed: {exc}"]}
    inspect_duration = time.time() - inspect_t0

    src_info = quality_trace["source"]
    bbox = mesh.bounds
    bbox_dim = (bbox[1] - bbox[0]) if (bbox is not None and len(bbox) == 2) else np.array([0, 0, 0])
    logger.info(
        "\n" + format_box(
            "POSTPROCESS: STAGE 1/8 - MESH INSPECTION",
            [
                ("Input Triangles", f"{src_info.get('faces', 0):,}"),
                ("Input Vertices", f"{src_info.get('vertices', 0):,}"),
                ("Bounding Box (XYZ)", f"{bbox_dim[0]:.2f} x {bbox_dim[1]:.2f} x {bbox_dim[2]:.2f}"),
                ("Watertight", src_info.get("watertight", False)),
                ("Native Textures", f"{native_textures}"),
                ("QA Status", qa_before.get("status", "ok")),
                ("Stage Elapsed", f"{inspect_duration:.2f}s"),
            ],
        )
    )

    printability_enabled = bool(
        job_metadata.get("enable_printability_check")
        or job_inputs.get("enable_printability_check")
        or job_metadata.get("enable_auto_repair")
        or job_inputs.get("enable_auto_repair")
    )
    printability_auto_repair = bool(
        job_metadata.get("enable_auto_repair")
        or job_inputs.get("enable_auto_repair")
    )
    printability_before = _printability_report(mesh) if printability_enabled else None

    repair_t0 = time.time()
    _emit(progress, 0.18, "repair", "Checking and repairing topology.")
    repair_opts = RepairOptions(
        method="remove",
        preserve_uv=True,
        close_holes=True,
        max_hole_size=30,
        weld=True,
    )
    source_topology = topology_counts(mesh.vertices, mesh.faces)
    if printability_enabled and not printability_auto_repair:
        repaired = mesh.copy()
        repair_stats = {
            "before": source_topology,
            "after": source_topology.copy(),
            "removed_faces": 0,
            "method": "skipped_printability_check_only",
            "preserve_uv": True,
            "uv_preserved": bool(getattr(getattr(mesh, "visual", None), "uv", None) is not None),
            "skipped": True,
            "reason": "Printability was requested without auto-repair; the default repair mutation was not applied.",
        }
    elif source_topology.get("watertight") and source_topology.get("non_manifold_edges", 0) == 0:
        repaired = mesh.copy()
        repair_stats = {
            "before": source_topology,
            "after": source_topology.copy(),
            "removed_faces": 0,
            "method": "skipped_healthy",
            "preserve_uv": True,
            "uv_preserved": bool(getattr(getattr(mesh, "visual", None), "uv", None) is not None),
            "skipped": True,
            "reason": "Source mesh already passes manifold/watertight topology checks.",
        }
    else:
        repaired, repair_stats, _ = run_repair(mesh, repair_opts)
    repair_duration = time.time() - repair_t0

    quality_trace["printability_before_repair"] = printability_before

    quality_trace["repaired"] = {
        **mesh_stats(repaired).model_dump(),
        "native_textures": _has_native_textures(repaired),
        "topology": repair_stats.get("after"),
    }

    rep_after = repair_stats.get("after", {})
    logger.info(
        "\n" + format_box(
            "POSTPROCESS: STAGE 2/8 - TOPOLOGY REPAIR",
            [
                ("Operations", f"Weld coincident verts, remove non-manifold, close holes (<= {repair_opts.max_hole_size})"),
                ("Before Repair", f"{len(mesh.faces):,} faces | {len(mesh.vertices):,} vertices"),
                ("After Repair", f"{len(repaired.faces):,} faces | {len(repaired.vertices):,} vertices"),
                ("Watertight", rep_after.get("watertight", False)),
                ("Non-manifold Edges", rep_after.get("non_manifold_edges", 0)),
                ("Boundary Edges", rep_after.get("boundary_edges", 0)),
                ("Stage Elapsed", f"{repair_duration:.2f}s"),
            ],
        )
    )

    repaired_topology = repair_stats.get("after", {})
    retopo_stats: Dict[str, Any] = {"status": "skipped", "reason": "No structural retopology required."}
    feature_type = str(job_metadata.get("feature") or job_inputs.get("feature") or "")
    solid_generation_feature = feature_type in {
        "image_to_raw_mesh", "image_to_textured_mesh",
    }
    large_open_defect = (
        int(repaired_topology.get("largest_boundary_component_edges", 0))
        > RepairOptions().max_hole_size
    )

    is_quad_requested = (
        job_metadata.get("topology_mode") == "quad"
        or job_inputs.get("topology_mode") == "quad"
        or bool(job_metadata.get("quad_topology"))
        or bool(job_inputs.get("quad_topology"))
    )

    retopo_t0 = time.time()
    if is_quad_requested and not native_textures:
        _emit(progress, 0.24, "retopo", "Running auto-retopology for quad-dominant mesh.")
        retopo_target = min(max(4_000, int(job_inputs.get("target_polycount") or 10_000)), MAX_PRODUCTION_FACES, max(50, int(len(repaired.faces))))
        try:
            repaired, retopo_tool_stats, _ = run_auto_retopo(
                repaired,
                AutoRetopoOptions(
                    target_faces=retopo_target,
                    quads=True,
                    watertight=True,
                    shell_smooth=0.6,
                    shell_taubin=3,
                    adaptive=True,
                    preserve_features=True,
                    feature_angle=25.0,
                    project=True,
                ),
                progress=lambda stage, frac, msg: (
                    _emit(progress, 0.24 + min(1.0, max(0.0, frac)) * 0.05, "retopo", msg),
                    logger.debug(f"[POSTPROCESS RETOPO] {frac*100:.0f}% stage={stage} msg={msg}"),
                ),
            )
            retopo_stats = {"status": "completed", "trigger": "quad_requested", **retopo_tool_stats}
        except Exception as exc:
            retopo_stats = {"status": "failed", "trigger": "quad_requested", "error": str(exc)}
            logger.warning("Quad AutoRetopo failed for %s; retaining repaired geometry: %s", job_id, exc)
    elif is_quad_requested and native_textures:
        retopo_stats = {"status": "skipped", "reason": "Native textures are preserved; quad retopology would strip UV and material mapping."}
    elif solid_generation_feature and not native_textures and not repaired_topology.get("watertight", True) and large_open_defect:
        _emit(progress, 0.24, "retopo", "Rebuilding topology for a large structural defect.")
        retopo_target = min(max(6_000, int(job_inputs.get("target_polycount") or 6_000)), MAX_PRODUCTION_FACES, max(50, int(len(repaired.faces))))
        try:
            repaired, retopo_tool_stats, _ = run_auto_retopo(
                repaired,
                AutoRetopoOptions(target_faces=retopo_target, watertight=True, shell_smooth=0.6,
                                  shell_taubin=3, adaptive=True, preserve_features=True,
                                  feature_angle=25.0, project=True),
                progress=lambda stage, frac, msg: (
                    _emit(progress, 0.24 + min(1.0, max(0.0, frac)) * 0.05, "retopo", msg),
                    logger.debug(f"[POSTPROCESS RETOPO] {frac*100:.0f}% stage={stage} msg={msg}"),
                ),
            )
            retopo_stats = {"status": "completed", "trigger": "large_open_defect", **retopo_tool_stats}
        except Exception as exc:
            retopo_stats = {"status": "failed", "trigger": "large_open_defect", "error": str(exc)}
            logger.warning("Conditional AutoRetopo failed for %s; retaining repaired geometry: %s", job_id, exc)
    elif native_textures:
        retopo_stats = {"status": "skipped", "reason": "Native textures are preserved; structural rebuild would require a real bake source."}
    elif not solid_generation_feature:
        retopo_stats = {"status": "skipped", "reason": "Asset feature does not declare a solid AI-generation contract."}
    retopo_duration = time.time() - retopo_t0

    if retopo_stats.get("status") == "completed":
        logger.info(
            "\n" + format_box(
                "POSTPROCESS: STAGE 3/8 - AUTO-RETOPOLOGY",
                [
                    ("Status", "Completed"),
                    ("Trigger", retopo_stats.get("trigger", "requested")),
                    ("Target Faces", f"{retopo_target:,}"),
                    ("Result Faces", f"{len(repaired.faces):,}"),
                    ("Watertight", retopo_stats.get("watertight", True)),
                    ("Stage Elapsed", f"{retopo_duration:.2f}s"),
                ],
            )
        )
    else:
        logger.info(
            "\n" + format_box(
                "POSTPROCESS: STAGE 3/8 - AUTO-RETOPOLOGY",
                [
                    ("Status", "Skipped"),
                    ("Reason", retopo_stats.get("reason", "Not requested or not needed")),
                    ("Stage Elapsed", f"{retopo_duration:.2f}s"),
                ],
            )
        )

    # High/ultra quality profiles use the existing curvature-adaptive AutoRetopo
    # as a conservative derivative-target builder before UV/baking. Native-textured
    # masters bypass this because their native UV/material mapping is already valuable.
    feature_remesh_stats: Dict[str, Any] = {"status": "skipped", "reason": "Quality profile does not require adaptive remesh."}
    if (
        quality_mode in {"high", "ultra"}
        and solid_generation_feature
        and not native_textures
        and retopo_stats.get("status") != "completed"
        and (
            auto_optimize
            or (parsed_target_polycount is not None and parsed_target_polycount > 0)
        )
    ):
        try:
            remesh_target = min(
                MAX_PRODUCTION_FACES,
                max(5_000, int(raw_target_polycount or MAX_PRODUCTION_FACES)),
            )
            repaired, remesh_tool_stats, _ = run_auto_retopo(
                repaired,
                AutoRetopoOptions(
                    target_faces=remesh_target,
                    quads=False,
                    watertight=False,
                    adaptive=True,
                    preserve_features=True,
                    feature_angle=25.0,
                    project=True,
                    shell_smooth=0.25,
                    shell_taubin=1,
                    calibrate_passes=1,
                ),
                progress=lambda stage, frac, msg: _emit(
                    progress,
                    0.30 + min(1.0, max(0.0, frac)) * 0.05,
                    "remesh",
                    msg,
                ),
            )
            feature_remesh_stats = {
                "status": "completed",
                "target_faces": remesh_target,
                **remesh_tool_stats,
            }
            quality_trace["feature_remesh"] = feature_remesh_stats
        except Exception as exc:
            feature_remesh_stats = {
                "status": "warn",
                "error": str(exc),
                "reason": "Adaptive remesh failed; continuing with the repaired derivative.",
            }
            quality_trace["feature_remesh"] = feature_remesh_stats
            logger.warning("Adaptive high-quality remesh failed for %s: %s", job_id, exc)

    _emit(progress, 0.30, "optimize", "Optimizing game-ready triangle budget.")
    optimize_t0 = time.time()
    auto_optimize = bool(job_inputs.get("auto_optimize", False))
    raw_target_polycount = job_inputs.get("target_polycount")
    has_explicit_target = raw_target_polycount is not None and int(raw_target_polycount) > 0
    repaired_face_count = len(repaired.faces)

    if is_quad_requested and retopo_stats.get("status") == "completed":
        optimized = repaired
        optimize_stats = {"passthrough": True, "reason": "Quad-dominant topology preserved from retopology pass"}
    elif not auto_optimize and not has_explicit_target:
        # Native/raw resolution requested without auto-decimation
        optimized = repaired
        optimize_stats = {"passthrough": True, "reason": "Native resolution preserved (auto_optimize is false and no target_polycount specified)"}
    else:
        target_faces = min(MAX_PRODUCTION_FACES, max(5_000, int(raw_target_polycount or MAX_PRODUCTION_FACES)))
        if repaired_face_count <= target_faces and not auto_optimize:
            optimized = repaired
            optimize_stats = {"passthrough": True, "reason": f"Repaired mesh face count ({repaired_face_count}) already within target ({target_faces})"}
        else:
            optimized, optimize_stats = run_optimize(
                repaired,
                OptimizeOptions(target_faces=target_faces, simplify_error=0.05, allow_seam_breaking=False,
                                permissive=False, aggressive=False, lock_border=False),
            )
    optimize_guard = _quality_guard(repaired, optimized)
    if not optimize_guard["passed"]:
        logger.warning(
            "Optimization quality guard rejected result for %s: %s",
            job_id,
            optimize_guard["reason"],
        )
        optimized = repaired
        optimize_stats = {
            **optimize_stats,
            "passthrough": True,
            "quality_guard_reverted": True,
            "quality_guard_reason": optimize_guard["reason"],
        }

    optimize_duration = time.time() - optimize_t0
    quality_trace["optimized"] = {
        **mesh_stats(optimized).model_dump(),
        "native_textures": _has_native_textures(optimized),
        "quality_guard": optimize_guard,
    }

    reduction_pct = (
        ((repaired_face_count - len(optimized.faces)) / max(1, repaired_face_count)) * 100.0
        if not optimize_stats.get("passthrough") else 0.0
    )
    logger.info(
        "\n" + format_box(
            "POSTPROCESS: STAGE 4/8 - MESH DECIMATION & OPTIMIZATION",
            [
                ("Action", "Passthrough (Native Mesh Preserved)" if optimize_stats.get("passthrough") else "Decimated with Quadric Error Metrics"),
                ("Reason", optimize_stats.get("reason") or "Budget target reached"),
                ("Before Decimation", f"{repaired_face_count:,} faces | {len(repaired.vertices):,} vertices"),
                ("After Decimation", f"{len(optimized.faces):,} faces | {len(optimized.vertices):,} vertices"),
                ("Face Reduction", f"{reduction_pct:.1f}%" if not optimize_stats.get("passthrough") else "0.0% (preserved)"),
                ("Textures Preserved", optimize_stats.get("texture_preserved", True) if native_textures else "N/A"),
                ("Stage Elapsed", f"{optimize_duration:.2f}s"),
            ],
        )
    )

    uv_t0 = time.time()
    if native_textures:
        if not _has_native_textures(optimized):
            logger.warning(
                "Texture-aware optimization lost native material data for %s; safely falling back to repaired mesh to preserve textures.",
                job_id,
            )
            optimized = repaired
            optimize_stats = {
                "passthrough": True,
                "reason": "Retained repaired mesh because decimation lost material data",
            }
        uv_mesh = optimized
        uv_stats = {"preserved": True, "native_textures": True,
                    "texture_aware_decimation": bool(not optimize_stats.get("passthrough"))}
        uv_duration = time.time() - uv_t0
        logger.info(
            "\n" + format_box(
                "POSTPROCESS: STAGE 5/8 - UV PARAMETERIZATION",
                [
                    ("Status", "Preserved Native UVs and Materials"),
                    ("Native Textures", True),
                    ("Texture-Aware Decimation", uv_stats.get("texture_aware_decimation", False)),
                    ("Stage Elapsed", f"{uv_duration:.2f}s"),
                ],
            )
        )
    else:
        _emit(progress, 0.55, "uv", "Generating production UVs.")
        optimized_normals = np.asarray(optimized.vertex_normals)
        uv_mesh, uv_stats, _ = run_auto_uv(
            optimized,
            AutoUvOptions(resolution=texture_resolution, padding_texels=4, refine=True, weld=True,
                          preserve_normals=True, normal_smooth_deg=60),
            source_normals=optimized_normals,
        )
        uv_duration = time.time() - uv_t0
        logger.info(
            "\n" + format_box(
                "POSTPROCESS: STAGE 5/8 - UV PARAMETERIZATION",
                [
                    ("Status", "Generated Production UVs"),
                    ("Resolution", f"{texture_resolution}x{texture_resolution}"),
                    ("Chart Padding", "4 texels"),
                    ("Normal Smoothing", "60 deg (source normals preserved)"),
                    ("Stage Elapsed", f"{uv_duration:.2f}s"),
                ],
            )
        )

    printability_after = _printability_report(uv_mesh) if printability_enabled else None
    printability_status = (printability_after or printability_before or {}).get("status")

    texture_paths: Dict[str, Path] = {}
    bake_stats = {
        "status": "skipped",
        "reason": (
            "High-to-low baking remains opt-in; production post-processing never "
            "synthesizes semantic PBR maps from an untextured source."
        ),
    }
    texture_status = "native" if native_textures else "not_generated"

    should_bake = (
        bool(job_inputs.get("bake_normal_maps"))
        or bool(job_inputs.get("bake_high_to_low"))
        or bool(job_inputs.get("bake_textures"))
        or bool(job_metadata.get("bake_normal_maps"))
        or bool(job_metadata.get("bake_textures"))
        # Auto-enable bake for native-textured models so native detail bakes to game-ready UVs
        or native_textures
    )

    bake_t0 = time.time()
    if should_bake:
        _emit(progress, 0.58, "bake", "Baking high-to-low micro-details and normal maps.")
        try:
            from .services.bake import run_bake
            from .schemas import BakeOptions

            bake_res = texture_resolution
            maps_to_bake = ["normal", "ao"]
            if native_textures:
                maps_to_bake.extend(["base_color", "roughness", "metallic"])

            bake_opts = BakeOptions(
                resolution=bake_res,
                maps=maps_to_bake,
            )
            low_glb_bytes = _export_glb(uv_mesh)
            baked_images, worker_stats = run_bake(
                low_glb=low_glb_bytes,
                high_glb=master_path.read_bytes(),
                opts=bake_opts,
                progress=lambda stage, frac, msg: (
                    _emit(progress, 0.58 + min(1.0, max(0.0, frac)) * 0.04, "bake", msg),
                    logger.debug(f"[POSTPROCESS BAKE] {frac*100:.0f}% stage={stage} msg={msg}"),
                ),
            )
            texture_dir.mkdir(parents=True, exist_ok=True)
            for map_name, img_bytes in baked_images.items():
                target_img_path = texture_dir / f"{map_name}.png"
                target_img_path.write_bytes(img_bytes)
                texture_paths[map_name] = str(target_img_path)
            bake_stats = {"status": "completed", **worker_stats}
            texture_status = "baked"

            # Attach normal map and PBR material to uv_mesh if normal was baked
            if "normal" in baked_images:
                try:
                    norm_img = Image.open(io.BytesIO(baked_images["normal"]))
                    base_img = Image.open(io.BytesIO(baked_images["base_color"])) if "base_color" in baked_images else None
                    pbr_mat = trimesh.visual.material.PBRMaterial(
                        name="GameReady_PBR",
                        normalTexture=norm_img,
                        baseColorTexture=base_img,
                    )
                    uvs = getattr(getattr(uv_mesh, "visual", None), "uv", None)
                    if uvs is not None:
                        uv_mesh.visual = trimesh.visual.TextureVisuals(uv=uvs, material=pbr_mat)
                except Exception as mat_err:
                    logger.warning("Could not attach baked textures to GLB material: %s", mat_err)
        except Exception as exc:
            bake_stats = {"status": "skipped", "reason": str(exc)}
            logger.warning("Bake step skipped or failed: %s", exc)
    bake_duration = time.time() - bake_t0

    # Compare every optimized derivative against the immutable master.
    # Without ground truth this is a degradation diagnostic, not an absolute quality score.
    master_quality_report: Dict[str, Any] = {"status": "skipped", "reason": "quality comparison unavailable"}
    try:
        master_quality_report = compare_meshes(
            mesh,
            uv_mesh,
            sample_count=4096,
            seed=0,
        )
        master_quality_report["interpretation"] = "master_vs_derivative_diagnostic"
        master_quality_report["quality_gate"] = quality_gate(master_quality_report)
    except Exception as exc:
        master_quality_report = {
            "status": "warn",
            "reason": f"Master/derivative quality comparison failed: {exc}",
        }
    quality_trace["master_to_derivative"] = master_quality_report

    if bake_stats.get("status") == "completed":
        logger.info(
            "\n" + format_box(
                "POSTPROCESS: STAGE 6/8 - HIGH-TO-LOW TEXTURE BAKING",
                [
                    ("Status", "Completed"),
                    ("Maps Baked", list(texture_paths.keys())),
                    ("Bake Resolution", f"{bake_res}x{bake_res}"),
                    ("Attached to GLB", "normal" in texture_paths),
                    ("Stage Elapsed", f"{bake_duration:.2f}s"),
                ],
            )
        )
    else:
        logger.info(
            "\n" + format_box(
                "POSTPROCESS: STAGE 6/8 - HIGH-TO-LOW TEXTURE BAKING",
                [
                    ("Status", "Skipped"),
                    ("Reason", bake_stats.get("reason", "Bake not requested")),
                    ("Stage Elapsed", f"{bake_duration:.2f}s"),
                ],
            )
        )

    lod_t0 = time.time()
    _emit(progress, 0.62, "game_ready", "Writing game-ready formats.")
    game_ready_dir.mkdir(parents=True, exist_ok=True)
    base_name = f"{asset_name}_{clean_job_id}"
    game_ready: Dict[str, str] = {}
    artifact_errors: Dict[str, str] = {}
    glb_path = game_ready_dir / f"{base_name}.glb"
    _save_file(glb_path, _export_glb(uv_mesh))
    game_ready["glb"] = str(glb_path)

    # Pre-generate only GLB and FBX (Unity format); other formats (OBJ, STL, PLY, GLTF) convert on-demand
    try:
        fbx_bytes, _ = run_convert_fbx(
            glb_path.read_bytes(),
            ConvertOptions(preset="generic", bake_fps=30, anim_simplify=1.0),
            progress=lambda stage, frac, msg: _emit(
                progress, 0.62 + (min(1.0, max(0.0, frac)) * 0.04), "fbx", msg
            ),
        )
        fbx_path = game_ready_dir / f"{base_name}.fbx"
        fbx_path.write_bytes(fbx_bytes)
        game_ready["fbx"] = str(fbx_path)
    except Exception as exc:
        artifact_errors["fbx"] = str(exc)
        logger.warning("FBX export failed: %s", exc)

    lods: Dict[int, str] = {}
    lod_quality: Dict[str, Dict[str, Any]] = {}
    lod_enabled = bool(job_inputs.get("generateLOD", True))
    if lod_enabled:
        _emit(progress, 0.72, "lod", "Generating LOD chain.")
        lod_dir.mkdir(parents=True, exist_ok=True)
        source_faces = max(1, len(uv_mesh.faces))
        target_faces = int(job_inputs.get("target_polycount") or MAX_PRODUCTION_FACES)
        target_ratio = min(1.0, max(0.05, target_faces / source_faces))
        preset = str(job_inputs.get("lodPreset") or "high").lower()
        preset_ratios = {
            "mobile": [1.0, 0.35, 0.12, 0.05],
            "low": [1.0, 0.5, 0.2, 0.08],
            "medium": [1.0, 0.5, 0.25, 0.125],
            "high": [1.0, 0.6, 0.3, 0.15],
            "cinematic": [1.0, 0.75, 0.5, 0.25],
        }.get(preset, [1.0, 0.6, 0.3, 0.15])
        ratios = job_inputs.get("lod_ratios")
        lod_ratios = ratios if isinstance(ratios, list) and ratios else [
            1.0 if i == 0 else max(0.025, float(ratio))
            for i, ratio in enumerate(preset_ratios)
        ]
        try:
            lod_count = max(1, min(4, int(job_inputs.get("lodCount") or len(lod_ratios))))
        except (TypeError, ValueError):
            lod_count = min(4, len(lod_ratios))
        lod_levels = run_lods(uv_mesh, LODOptions(ratios=list(lod_ratios[:lod_count])))
    else:
        lod_levels = []
    for level in lod_levels:
        idx = int(level["level"])
        level_mesh = level["mesh"]
        lod_path = lod_dir / f"lod{idx}.glb"
        lod_path.write_bytes(_export_glb(level_mesh))
        lods[idx] = str(lod_path)
        lod_quality[str(idx)] = {
            "triangles": int(len(level_mesh.faces)),
            "vertices": int(len(level_mesh.vertices)),
            "has_uv": bool(getattr(getattr(level_mesh, "visual", None), "uv", None) is not None),
            "native_textures": bool(_has_native_textures(level_mesh)),
            "texture_preserved": bool(level.get("texture_preserved", _has_native_textures(level_mesh))),
        }
    lod_duration = time.time() - lod_t0

    glb_file_size = glb_path.stat().st_size if glb_path.exists() else 0
    fbx_file_size = (
        Path(game_ready["fbx"]).stat().st_size
        if "fbx" in game_ready and Path(game_ready["fbx"]).exists()
        else 0
    )
    lod_entries = [
        (f"  LOD {lvl}", f"{l_info['triangles']:,} tris | {l_info['vertices']:,} verts -> lod{lvl}.glb")
        for lvl, l_info in lod_quality.items()
    ]
    logger.info(
        "\n" + format_box(
            "POSTPROCESS: STAGE 7/8 - PRODUCTION EXPORTS & LOD CHAIN",
            [
                ("Production GLB", f"{glb_path} ({format_bytes(glb_file_size)})"),
                ("Production FBX", f"{game_ready.get('fbx', 'Failed')} ({format_bytes(fbx_file_size)})" if "fbx" in game_ready else f"Skipped/Failed ({artifact_errors.get('fbx', 'N/A')})"),
                ("LOD Preset", preset if lod_enabled else "Disabled"),
                ("LOD Levels Built", f"{len(lods)} levels" if lod_enabled else "0"),
                *lod_entries,
                ("Stage Elapsed", f"{lod_duration:.2f}s"),
            ],
        )
    )

    collision_t0 = time.time()
    # Collision is only part of the production contract when physics is requested.
    collision_path: Optional[Path] = None
    collision_stats: Optional[Dict[str, Any]] = None
    physics_metadata: Optional[Dict[str, Any]] = None
    if physics_enabled:
        collision_quality = physics_config["collision_quality"]
        collision_options = collision_options_for_quality(collision_quality)
        _emit(progress, 0.82, "collision", "Generating collision proxy.")
        collision_dir.mkdir(parents=True, exist_ok=True)
        try:
            game_ready_mesh = load_mesh(glb_path)
            collision_scene, collision_stats = run_collision(
                game_ready_mesh,
                CollisionOptions(**collision_options),
            )
            collision_payload = collision_scene.export(file_type="glb")
            if isinstance(collision_payload, str):
                collision_payload = collision_payload.encode("utf-8")
            collision_path = collision_dir / "collision.glb"
            collision_path.write_bytes(collision_payload)
            physics_metadata = build_physics_metadata(
                game_ready_mesh, physics_config, collision_stats
            )
            _write_json(metadata_dir / "physics.json", physics_metadata)
        except Exception as exc:
            logger.error("Collision generation failed for %s: %s", job_id, exc, exc_info=True)
            raise RuntimeError(f"Collision generation failed: {exc}") from exc
    collision_duration = time.time() - collision_t0

    if physics_enabled and collision_path and collision_path.exists():
        logger.info(
            "\n" + format_box(
                "POSTPROCESS: STAGE 8/8 - PHYSICS & COLLISION PROXY",
                [
                    ("Quality Preset", collision_quality),
                    ("Convex Hulls", collision_stats.get("hull_count", "N/A") if collision_stats else "N/A"),
                    ("Collision Triangles", collision_stats.get("total_triangles", "N/A") if collision_stats else "N/A"),
                    ("Proxy File", f"{collision_path} ({format_bytes(collision_path.stat().st_size)})"),
                    ("Center of Mass", physics_metadata.get("center_of_mass", "N/A") if physics_metadata else "N/A"),
                    ("Stage Elapsed", f"{collision_duration:.2f}s"),
                ],
            )
        )
    else:
        logger.info(
            "\n" + format_box(
                "POSTPROCESS: STAGE 8/8 - PHYSICS & COLLISION PROXY",
                [
                    ("Status", "Skipped"),
                    ("Reason", "Physics disabled for this asset"),
                    ("Stage Elapsed", f"{collision_duration:.2f}s"),
                ],
            )
        )

    _emit(progress, 0.90, "preview", "Generating asset preview.")
    preview_dir.mkdir(parents=True, exist_ok=True)
    thumbnail_path: Optional[Path] = None
    try:
        from .services.mesh_thumbnail import render_mesh_thumbnail
        thumbnail_path = preview_dir / "thumbnail.png"
        thumbnail_bytes = render_mesh_thumbnail(glb_path.read_bytes())
        thumbnail_path.write_bytes(thumbnail_bytes)
        with Image.open(thumbnail_path) as preview:
            preview.convert("RGB").save(preview_dir / "preview.jpg", "JPEG", quality=92)
        logger.info(
            "\n" + format_box(
                "POSTPROCESS: PREVIEW THUMBNAIL",
                [
                    ("Status", "Rendered successfully"),
                    ("Thumbnail PNG", f"{thumbnail_path} ({format_bytes(thumbnail_path.stat().st_size)})"),
                    ("Preview JPG", f"{preview_dir / 'preview.jpg'} ({format_bytes((preview_dir / 'preview.jpg').stat().st_size)})"),
                ],
            )
        )
    except Exception as exc:
        logger.warning("Preview generation skipped: %s", exc)

    _emit(progress, 0.95, "qa", "Running final game-ready inspection.")
    try:
        final_scene = trimesh.load(glb_path, file_type="glb", process=False)
        if not isinstance(final_scene, trimesh.Scene):
            final_scene = trimesh.Scene(uv_mesh)
        qa_report = run_inspect(
            final_scene,
            uv_mesh,
            InspectOptions(
                tri_budget=resolved_target_polycount or MAX_PRODUCTION_FACES,
                texture_resolution=2048,
                max_material_count=8,
                uv_overlap_grid=512,
                uv_scan_max_faces=60_000,
                expect_ground_pivot=False,
            ),
        )
    except Exception as exc:
        qa_report = {
            "status": "warn",
            "warnings": [f"Final inspection failed: {exc}"],
        }

    quality_trace["game_ready"] = {
        **mesh_stats(uv_mesh).model_dump(),
        "native_textures": _has_native_textures(uv_mesh),
        "uv_seam_vertex_delta": len(uv_mesh.vertices) - len(mesh.vertices),
        "qa": qa_report,
    }

    now = datetime.now(timezone.utc).isoformat()
    _write_json(
        metadata_dir / "job.json",
        {
            "manifest_version": "1",
            "api_version": "1",
            "asset_id": asset_name,
            "job_id": job_id,
            "parent_job_id": job_metadata.get("parent_job_id"),
            "created_at": now,
            "source_path": str(raw_path),
            "model_id": job_metadata.get("model_id"),
            "feature": job_metadata.get("feature"),
            "seed": job_inputs.get("seed"),
            "target_polycount": resolved_target_polycount,
            "source_policy": "model-native maximum geometry fidelity; target_polycount is downstream-only",
            "printability": {
                "enabled": printability_enabled,
                "auto_repair": printability_auto_repair,
                "before": printability_before,
                "after": printability_after,
                "status": printability_status,
            } if printability_enabled else None,
            "lod": {
                "enabled": lod_enabled,
                "preset": job_inputs.get("lodPreset") or "high",
                "count": len(lods),
            },
            "model_parameters": {
                key: value
                for key, value in job_inputs.items()
                if key not in {"image_path", "mesh_path", "texture_image_path"}
            },
            "input_sha256": _collect_input_hashes(job_inputs),
            "inputs": job_inputs,
            "generation_result": generation_result,
        },
    )
    if _sha256_file(master_path) != source_sha256:
        raise RuntimeError("Immutable master source.glb changed during post-processing.")

    _write_json(
        metadata_dir / "quality_report.json",
        {
            "source_sha256": source_sha256,
            "before_postprocess": qa_before,
            "after_postprocess": qa_report,
            "repair": repair_stats,
            "retopo": retopo_stats,
            "optimize": optimize_stats,
            "uv": uv_stats,
            "bake": bake_stats,
            "texture_status": texture_status,
            "quality_trace": quality_trace,
            "master_to_derivative": master_quality_report,
            "quality_mode": quality_mode,
            "texture_resolution": texture_resolution,
            "cpu_threads": cpu_threads,
            "lods": lod_quality,
            "collision": collision_stats,
            "physics": physics_metadata,
            "target_polycount": resolved_target_polycount,
            "source_policy": "immutable source.glb is the model-native maximum-fidelity checkpoint; production budget applies only to derived outputs",
            "printability": {
                "enabled": printability_enabled,
                "auto_repair": printability_auto_repair,
                "before": printability_before,
                "after": printability_after,
                "status": printability_status,
            } if printability_enabled else None,
        },
    )

    generated = {
        "game_ready": game_ready,
        "lods": lods,
        "collision": str(collision_path) if collision_path else None,
        "physics": str(metadata_dir / "physics.json") if physics_metadata else None,
        "physics_metadata": physics_metadata,
        "textures": texture_paths,
        "texture_status": texture_status,
        "thumbnail": str(thumbnail_path) if thumbnail_path else None,
        "artifact_errors": artifact_errors,
    }
    final_result = _build_result(job_id, asset_dir, asset_name, qa_report, generated, target_polycount=resolved_target_polycount, lod_enabled=lod_enabled)
    final_result["model_url"] = final_result["game_ready_url"]
    final_result["high_fidelity_url"] = final_result["source_model_url"]
    final_result["quality_trace"] = quality_trace
    final_result["master_to_derivative"] = master_quality_report
    final_result["quality_mode"] = quality_mode
    final_result["texture_resolution"] = texture_resolution
    final_result["cpu_threads"] = cpu_threads
    final_result["optimize"] = optimize_stats
    if printability_enabled:
        final_result["printability"] = {
            "enabled": True,
            "auto_repair": printability_auto_repair,
            "before": printability_before,
            "after": printability_after,
            "status": printability_status,
        }
        if printability_status == "fail":
            final_result["production_status"] = "degraded"
            final_result["degraded_reasons"] = list(
                final_result.get("degraded_reasons", [])
            ) + ["printability_failed"]
    _write_json(asset_manifest, final_result)

    total_pipeline_time = time.time() - pipeline_start_time
    logger.info(
        "\n" + format_banner(
            "POSTPROCESS: PIPELINE COMPLETE",
            [
                ("Job ID", job_id),
                ("Asset Name", asset_name),
                ("Production Status", final_result.get("production_status", "ready").upper()),
                ("Game-Ready GLB", f"{glb_path} ({format_bytes(glb_file_size)})"),
                ("Game-Ready FBX", f"{game_ready.get('fbx', 'N/A')} ({format_bytes(fbx_file_size)})" if "fbx" in game_ready else "N/A"),
                ("LOD Levels", f"{len(lods)} levels"),
                ("Physics Proxy", str(collision_path) if collision_path else "None"),
                ("Thumbnail", str(thumbnail_path) if thumbnail_path else "None"),
                ("Asset Manifest", str(asset_manifest)),
                ("Total Processing Time", f"{total_pipeline_time:.2f}s"),
            ],
        )
    )

    if Path(raw_path).resolve() != master_path.resolve() and Path(raw_path).exists():
        try:
            Path(raw_path).unlink()
            logger.info(
                "[POSTPROCESS STORAGE] Canonical asset promoted; removed legacy generation output: %s",
                raw_path,
            )
        except OSError:
            logger.warning(
                "[POSTPROCESS STORAGE] Canonical asset is ready but legacy output could not be removed: %s",
                raw_path,
            )

    _emit(progress, 1.0, "postprocess", "Production asset is ready.")
    return final_result
