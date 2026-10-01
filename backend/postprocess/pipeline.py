"""ForMash3D production post-processing pipeline.

This module owns only the canonical asset lifecycle. The processing algorithms live
in the ported services under backend/postprocess/services/.
"""
from __future__ import annotations

import hashlib
import json
import logging
import re
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, Optional

import numpy as np
import trimesh
from PIL import Image

from core.utils.file_utils import resolve_server_file_path
from .config import BLENDER_EXECUTABLE
from .meshio import load_mesh, load_mesh_vertex_normals, mesh_stats
from .physics import build_physics_metadata, collision_options_for_quality, normalize_physics_config
from .services.auto_retopo import run_auto_retopo
from .services.auto_uv import run_auto_uv
from .services.collision import run_collision
from .services.convert_fbx import run_convert_fbx
from .services.inspect import run_inspect
from .services.repair import run_repair
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

MAX_PRODUCTION_FACES = 50_000
_FORMATS = ("glb", "gltf", "fbx", "obj", "stl", "ply")


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _storage_root() -> Path:
    return _repo_root() / "backend" / "storage" / "models"


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
    raw_path = resolve_server_file_path(raw_candidate)
    source_stem = (
        job_inputs.get("asset_name")
        or job_inputs.get("image_path")
        or job_inputs.get("text_prompt")
        or (Path(raw_path).stem if raw_path else "asset")
    )
    asset_name = _safe_name(Path(str(source_stem)).stem)
    return _storage_root() / f"{asset_name}_{_job_hash(job_id)}"


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
        if result.returncode != 0 or not target.exists():
            detail = (result.stderr or result.stdout or "").strip()[-2000:]
            raise RuntimeError(f"Embedded GLTF export failed: {detail}")


def _has_native_textures(mesh: trimesh.Trimesh) -> bool:
    """Return True only when actual image/texture payloads exist on the mesh."""
    visual = getattr(mesh, "visual", None)
    if visual is None:
        return False

    if getattr(visual, "image", None) is not None:
        return True

    material = getattr(visual, "material", None)
    if material is None:
        return False

    return any(
        getattr(material, attribute, None) is not None
        for attribute in (
            "baseColorTexture",
            "normalTexture",
            "metallicRoughnessTexture",
            "occlusionTexture",
            "emissiveTexture",
        )
    )


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

    return {
        "success": True,
        "output_mesh_path": primary,
        "static_url": None,
        "model_url": download_model_url,
        "active_model_url": download_model_url,
        "download_url": f"{base_url}/download?artifact_format=glb",
        "source_model_url": download_master_url,
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
        "pbr_maps": pbr_urls,
        "texture_status": generated.get("texture_status", "not_generated"),
        "thumbnail_url": f"{base_url}/thumbnail" if generated.get("thumbnail") else None,
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
            "game_ready": sorted(generated["game_ready"]),
            "lods": sorted(f"lod{idx}" for idx in generated["lods"]),
            "collision": bool(generated.get("collision")),
            "physics": bool(generated.get("physics")),
            "textures": sorted(generated["textures"]),
            "preview": bool(generated.get("thumbnail")),
        },
    }


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
    try:
        resolved_target_polycount = min(
            MAX_PRODUCTION_FACES,
            max(5_000, int(job_inputs.get("target_polycount") or MAX_PRODUCTION_FACES)),
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
        or job_inputs.get("image_path")
        or job_inputs.get("text_prompt")
        or Path(raw_path).stem
    )
    source_name = Path(str(source_stem)).stem
    asset_name = _safe_name(source_name)
    asset_hash = _job_hash(job_id)
    root = _storage_root()
    asset_dir = root / f"{asset_name}_{asset_hash}"
    master_dir = asset_dir / "master"
    game_ready_dir = asset_dir / "game_ready"
    lod_dir = asset_dir / "lods"
    collision_dir = asset_dir / "collision"
    texture_dir = asset_dir / "textures"
    preview_dir = asset_dir / "previews"
    metadata_dir = asset_dir / "metadata"

    for directory in (
        master_dir,
        game_ready_dir,
        lod_dir,
        collision_dir,
        texture_dir,
        preview_dir,
        metadata_dir,
    ):
        directory.mkdir(parents=True, exist_ok=True)

    master_path = master_dir / "source.glb"
    if not master_path.exists():
        shutil.copy2(raw_path, master_path)

    asset_manifest = metadata_dir / "asset.json"
    if asset_manifest.exists() and (game_ready_dir / f"{asset_name}_{asset_hash}.glb").exists():
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

    _emit(progress, 0.05, "postprocess", "Master asset secured.")

    raw_bytes = master_path.read_bytes()
    source_sha256 = _sha256_file(master_path)
    mesh = load_mesh(raw_bytes, master_path.name)
    native_textures = _has_native_textures(mesh)
    quality_trace = {
        "source": {
            **mesh_stats(mesh).model_dump(),
            "native_textures": native_textures,
        }
    }

    _emit(progress, 0.10, "inspect", "Inspecting generated mesh.")
    try:
        scene = trimesh.load(master_path, file_type="glb", process=False)
        if not isinstance(scene, trimesh.Scene):
            scene = trimesh.Scene(mesh)
        qa_before = run_inspect(
            scene,
            mesh,
            InspectOptions(
                tri_budget=resolved_target_polycount,
                texture_resolution=2048,
                max_material_count=8,
                uv_overlap_grid=512,
                uv_scan_max_faces=60_000,
                expect_ground_pivot=False,
            ),
        )
    except Exception as exc:
        qa_before = {"status": "warn", "warnings": [f"Initial inspection failed: {exc}"]}

    _emit(progress, 0.18, "repair", "Repairing topology.")
    repaired, repair_stats, _ = run_repair(
        mesh,
        RepairOptions(
            method="remove",
            preserve_uv=True,
            close_holes=True,
            max_hole_size=30,
            weld=True,
        ),
    )

    quality_trace["repaired"] = {
        **mesh_stats(repaired).model_dump(),
        "native_textures": _has_native_textures(repaired),
        "topology": repair_stats.get("after"),
    }

    repaired_topology = repair_stats.get("after", {})
    retopo_stats: Dict[str, Any] = {"status": "skipped", "reason": "No structural retopology required."}
    feature_type = str(job_metadata.get("feature") or job_inputs.get("feature") or "")
    solid_generation_feature = feature_type in {
        "image_to_raw_mesh", "image_to_textured_mesh", "text_to_raw_mesh", "text_to_textured_mesh",
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

    if is_quad_requested:
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
                progress=lambda stage, frac, msg: _emit(progress, 0.24 + min(1.0, max(0.0, frac)) * 0.05, "retopo", msg),
            )
            retopo_stats = {"status": "completed", "trigger": "quad_requested", **retopo_tool_stats}
        except Exception as exc:
            retopo_stats = {"status": "failed", "trigger": "quad_requested", "error": str(exc)}
            logger.warning("Quad AutoRetopo failed for %s; retaining repaired geometry: %s", job_id, exc)
    elif solid_generation_feature and not native_textures and not repaired_topology.get("watertight", True) and large_open_defect:
        _emit(progress, 0.24, "retopo", "Rebuilding topology for a large structural defect.")
        retopo_target = min(max(6_000, int(job_inputs.get("target_polycount") or 6_000)), MAX_PRODUCTION_FACES, max(50, int(len(repaired.faces))))
        try:
            repaired, retopo_tool_stats, _ = run_auto_retopo(
                repaired,
                AutoRetopoOptions(target_faces=retopo_target, watertight=True, shell_smooth=0.6,
                                  shell_taubin=3, adaptive=True, preserve_features=True,
                                  feature_angle=25.0, project=True),
                progress=lambda stage, frac, msg: _emit(progress, 0.24 + min(1.0, max(0.0, frac)) * 0.05, "retopo", msg),
            )
            retopo_stats = {"status": "completed", "trigger": "large_open_defect", **retopo_tool_stats}
        except Exception as exc:
            retopo_stats = {"status": "failed", "trigger": "large_open_defect", "error": str(exc)}
            logger.warning("Conditional AutoRetopo failed for %s; retaining repaired geometry: %s", job_id, exc)
    elif native_textures:
        retopo_stats = {"status": "skipped", "reason": "Native textures are preserved; structural rebuild would require a real bake source."}
    elif not solid_generation_feature:
        retopo_stats = {"status": "skipped", "reason": "Asset feature does not declare a solid AI-generation contract."}

    _emit(progress, 0.30, "optimize", "Optimizing game-ready triangle budget.")
    if is_quad_requested and retopo_stats.get("status") == "completed":
        optimized = repaired
        optimize_stats = {"passthrough": True, "reason": "Quad-dominant topology preserved from retopology pass"}
    else:
        target_faces = min(MAX_PRODUCTION_FACES, max(5_000, int(job_inputs.get("target_polycount") or MAX_PRODUCTION_FACES)))
        optimized, optimize_stats = run_optimize(
            repaired,
            OptimizeOptions(target_faces=target_faces, simplify_error=0.05, allow_seam_breaking=False,
                            permissive=False, aggressive=False, lock_border=False),
        )
    quality_trace["optimized"] = {
        **mesh_stats(optimized).model_dump(),
        "native_textures": _has_native_textures(optimized),
    }
    if native_textures:
        if not _has_native_textures(optimized):
            raise RuntimeError("Texture-aware optimization lost native material data.")
        uv_mesh = optimized
        uv_stats = {"preserved": True, "native_textures": True,
                    "texture_aware_decimation": bool(not optimize_stats.get("passthrough"))}
    else:
        _emit(progress, 0.55, "uv", "Generating production UVs.")
        optimized_normals = np.asarray(optimized.vertex_normals)
        uv_mesh, uv_stats, _ = run_auto_uv(
            optimized,
            AutoUvOptions(resolution=2048, padding_texels=4, refine=True, weld=True,
                          preserve_normals=True, normal_smooth_deg=60),
            source_normals=optimized_normals,
        )

    texture_paths: Dict[str, Path] = {}
    bake_stats = {
        "status": "skipped",
        "reason": (
            "High-to-low baking remains opt-in; production post-processing never "
            "synthesizes semantic PBR maps from an untextured source."
        ),
    }
    texture_status = "native" if native_textures else "not_generated"

    _emit(progress, 0.62, "game_ready", "Writing game-ready formats.")
    base_name = f"{asset_name}_{asset_hash}"
    game_ready: Dict[str, str] = {}
    artifact_errors: Dict[str, str] = {}
    glb_path = game_ready_dir / f"{base_name}.glb"
    _save_file(glb_path, _export_glb(uv_mesh))
    game_ready["glb"] = str(glb_path)

    quad_faces = retopo_stats.get("quad_faces")
    for fmt in ("obj", "stl", "ply"):
        try:
            target = game_ready_dir / f"{base_name}.{fmt}"
            if fmt == "obj" and quad_faces:
                _save_file(target, _export_quad_obj(uv_mesh, quad_faces))
            else:
                _save_file(target, _export_bytes(uv_mesh, fmt))
            game_ready[fmt] = str(target)
        except Exception as exc:
            artifact_errors[fmt] = str(exc)
            logger.warning("Game-ready %s export failed: %s", fmt, exc)

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

    try:
        gltf_path = game_ready_dir / f"{base_name}.gltf"
        _export_gltf_embedded(glb_path.read_bytes(), gltf_path)
        game_ready["gltf"] = str(gltf_path)
    except Exception as exc:
        artifact_errors["gltf"] = str(exc)
        logger.warning("GLTF embedded export failed: %s", exc)

    lods: Dict[int, str] = {}
    lod_quality: Dict[str, Dict[str, Any]] = {}
    lod_enabled = bool(job_inputs.get("generateLOD", True))
    if lod_enabled:
        _emit(progress, 0.72, "lod", "Generating LOD chain.")
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
            1.0 if i == 0 else max(0.025, target_ratio * ratio)
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

    physics_enabled = bool(
        job_metadata.get("physics_enabled", job_inputs.get("physics_enabled", False))
    )
    physics_config = normalize_physics_config(
        job_metadata.get("physics_config") or job_inputs.get("physics_config")
    )

    # Collision is only part of the production contract when physics is requested.
    collision_path: Optional[Path] = None
    collision_stats: Optional[Dict[str, Any]] = None
    physics_metadata: Optional[Dict[str, Any]] = None
    if physics_enabled:
        collision_quality = physics_config["collision_quality"]
        collision_options = collision_options_for_quality(collision_quality)
        _emit(progress, 0.82, "collision", "Generating collision proxy.")
        try:
            collision_scene, collision_stats = run_collision(
                uv_mesh,
                CollisionOptions(**collision_options),
            )
            collision_payload = collision_scene.export(file_type="glb")
            if isinstance(collision_payload, str):
                collision_payload = collision_payload.encode("utf-8")
            collision_path = collision_dir / "collision.glb"
            collision_path.write_bytes(collision_payload)
            physics_metadata = build_physics_metadata(
                uv_mesh, physics_config, collision_stats
            )
            _write_json(metadata_dir / "physics.json", physics_metadata)
        except Exception as exc:
            logger.error("Collision generation failed for %s: %s", job_id, exc, exc_info=True)
            raise RuntimeError(f"Collision generation failed: {exc}") from exc

    _emit(progress, 0.90, "preview", "Generating asset preview.")
    thumbnail_path: Optional[Path] = None
    try:
        from .services.mesh_thumbnail import render_mesh_thumbnail
        thumbnail_path = preview_dir / "thumbnail.png"
        thumbnail_bytes = render_mesh_thumbnail(glb_path.read_bytes())
        thumbnail_path.write_bytes(thumbnail_bytes)
        with Image.open(thumbnail_path) as preview:
            preview.convert("RGB").save(preview_dir / "preview.jpg", "JPEG", quality=92)
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
                tri_budget=resolved_target_polycount,
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
            "lods": lod_quality,
            "collision": collision_stats,
            "physics": physics_metadata,
            "target_polycount": resolved_target_polycount,
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
    _write_json(asset_manifest, final_result)

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
