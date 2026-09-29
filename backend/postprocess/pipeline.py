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
from .meshio import load_mesh, load_mesh_vertex_normals
from .physics import build_physics_metadata, collision_options_for_quality, normalize_physics_config
from .services.auto_retopo import run_auto_retopo
from .services.auto_uv import run_auto_uv
from .services.bake import run_bake
from .services.collision import run_collision
from .services.convert_fbx import run_convert_fbx
from .services.inspect import run_inspect
from .services.repair import run_repair
from .services.simplify import run_lods, run_optimize
from .schemas import (
    AutoRetopoOptions,
    AutoUvOptions,
    BakeOptions,
    CollisionOptions,
    ConvertOptions,
    InspectOptions,
    LODOptions,
    OptimizeOptions,
    RepairOptions,
)

logger = logging.getLogger(__name__)

GenerationProgress = Optional[Callable[[float, str, str], None]]

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


def _apply_baked_maps(mesh: trimesh.Trimesh, map_paths: Dict[str, Path]) -> None:
    if not map_paths or mesh.visual is None:
        return
    uv = getattr(mesh.visual, "uv", None)
    if uv is None:
        return

    try:
        from trimesh.visual.material import PBRMaterial
        from trimesh.visual.texture import TextureVisuals

        def image(name: str):
            path = map_paths.get(name)
            return Image.open(path).convert("RGBA") if path and path.exists() else None

        kwargs: Dict[str, Any] = {}
        base = image("base_color")
        normal = image("normal")
        orm = image("orm")
        ao = image("ao")
        if base is not None:
            kwargs["baseColorTexture"] = base
        if normal is not None:
            kwargs["normalTexture"] = normal
        if orm is not None:
            kwargs["metallicRoughnessTexture"] = orm
        if ao is not None:
            kwargs["occlusionTexture"] = ao
        if not kwargs:
            return

        mesh.visual = TextureVisuals(
            uv=np.asarray(uv),
            material=PBRMaterial(name="ForMash3D_GameReady", **kwargs),
        )
    except Exception:
        logger.debug("Could not attach baked PBR maps to the game-ready mesh.", exc_info=True)


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
) -> Dict[str, Any]:
    primary = generated["game_ready"].get("glb") or generated["game_ready"].get("obj")
    base_url = f"/api/v1/system/jobs/{job_id}"

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
        "model_url": f"{base_url}/download?artifact_format=glb",
        "active_model_url": f"{base_url}/download?artifact_format=glb",
        "source_model_url": f"{base_url}/download?artifact_format=master",
        "game_ready_url": f"{base_url}/download?artifact_format=glb",
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
        "thumbnail_url": (
            f"{base_url}/download?artifact_format=thumbnail"
            if generated.get("thumbnail")
            else None
        ),
        "zip_url": f"{base_url}/download?artifact_format=zip",
        "asset_root": str(asset_dir),
        "asset_name": asset_name,
        "postprocess_status": "completed",
        "qa_report": qa_report,
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
        saved["zip_url"] = f"/api/v1/system/jobs/{job_id}/download?artifact_format=zip"
        return saved

    _emit(progress, 0.05, "postprocess", "Master asset secured.")

    raw_bytes = master_path.read_bytes()
    mesh = load_mesh(raw_bytes, master_path.name)

    _emit(progress, 0.10, "inspect", "Inspecting generated mesh.")
    try:
        scene = trimesh.load(master_path, file_type="glb", process=False)
        if not isinstance(scene, trimesh.Scene):
            scene = trimesh.Scene(mesh)
        qa_before = run_inspect(
            scene,
            mesh,
            InspectOptions(
                tri_budget=50_000,
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

    _emit(progress, 0.30, "optimize", "Optimizing game-ready triangle budget.")
    target_faces = min(50_000, max(5_000, int(len(repaired.faces))))
    optimized, optimize_stats = run_optimize(
        repaired,
        OptimizeOptions(
            target_faces=target_faces,
            simplify_error=0.05,
            allow_seam_breaking=False,
            permissive=False,
            aggressive=False,
            lock_border=False,
        ),
    )

    _emit(progress, 0.42, "uv", "Generating production UVs.")
    optimized_normals = np.asarray(optimized.vertex_normals)
    uv_mesh, uv_stats, _ = run_auto_uv(
        optimized,
        AutoUvOptions(
            resolution=2048,
            padding_texels=4,
            refine=True,
            weld=True,
            preserve_normals=True,
            normal_smooth_deg=180,
        ),
        source_normals=optimized_normals,
    )

    _emit(progress, 0.54, "bake", "Baking high-poly detail and PBR maps.")
    low_glb = _export_glb(uv_mesh)
    bake_dir = texture_dir
    maps, bake_stats = run_bake(
        low_glb,
        raw_bytes,
        BakeOptions(
            maps=["normal", "ao", "base_color", "roughness", "metallic"],
            resolution=2048,
            samples=8,
            margin=8,
            align_source=True,
            require_overlap=0.5,
        ),
        progress=lambda stage, frac, msg: _emit(
            progress, 0.54 + (min(1.0, max(0.0, frac)) * 0.16), "bake", msg
        ),
    )

    texture_paths: Dict[str, Path] = {}
    for name, payload in maps.items():
        if not name:
            continue
        target = bake_dir / f"{name}.png"
        target.write_bytes(payload)
        if name != "orm":
            texture_paths[name] = target

    _apply_baked_maps(uv_mesh, {**texture_paths, "orm": bake_dir / "orm.png"})

    _emit(progress, 0.72, "game_ready", "Writing game-ready formats.")
    base_name = f"{asset_name}_{asset_hash}"
    game_ready: Dict[str, str] = {}
    glb_path = game_ready_dir / f"{base_name}.glb"
    _save_file(glb_path, _export_glb(uv_mesh))
    game_ready["glb"] = str(glb_path)

    for fmt in ("obj", "stl", "ply"):
        try:
            target = game_ready_dir / f"{base_name}.{fmt}"
            _save_file(target, _export_bytes(uv_mesh, fmt))
            game_ready[fmt] = str(target)
        except Exception as exc:
            logger.warning("Game-ready %s export skipped: %s", fmt, exc)

    try:
        fbx_bytes, _ = run_convert_fbx(
            glb_path.read_bytes(),
            ConvertOptions(preset="generic", bake_fps=30, anim_simplify=1.0),
            progress=lambda stage, frac, msg: _emit(
                progress, 0.72 + (min(1.0, max(0.0, frac)) * 0.04), "fbx", msg
            ),
        )
        fbx_path = game_ready_dir / f"{base_name}.fbx"
        fbx_path.write_bytes(fbx_bytes)
        game_ready["fbx"] = str(fbx_path)
    except Exception as exc:
        logger.warning("FBX export skipped: %s", exc)

    try:
        gltf_path = game_ready_dir / f"{base_name}.gltf"
        _export_gltf_embedded(glb_path.read_bytes(), gltf_path)
        game_ready["gltf"] = str(gltf_path)
    except Exception as exc:
        logger.warning("GLTF embedded export skipped: %s", exc)

    _emit(progress, 0.80, "lod", "Generating LOD chain.")
    lod_levels = run_lods(
        uv_mesh,
        LODOptions(ratios=[1.0, 0.5, 0.25, 0.125]),
    )
    lods: Dict[int, str] = {}
    for level in lod_levels:
        idx = int(level["level"])
        lod_path = lod_dir / f"lod{idx}.glb"
        lod_path.write_bytes(_export_glb(level["mesh"]))
        lods[idx] = str(lod_path)

    physics_enabled = bool(job_metadata.get("physics_enabled", job_inputs.get("physics_enabled", False)))
    physics_config = normalize_physics_config(job_metadata.get("physics_config") or job_inputs.get("physics_config"))
    _emit(progress, 0.88, "collision", "Preparing physics collision proxy." if physics_enabled else "Skipping physics collision.")
    collision_path: Optional[Path] = None
    collision_stats: Dict[str, Any] = {"skipped": not physics_enabled}
    physics_metadata: Optional[Dict[str, Any]] = None
    if physics_enabled:
        try:
            collision_scene, collision_stats = run_collision(
                uv_mesh,
                CollisionOptions(**collision_options_for_quality(physics_config["collision_quality"])),
            )
            collision_payload = collision_scene.export(file_type="glb")
            if isinstance(collision_payload, str):
                collision_payload = collision_payload.encode("utf-8")
            collision_path = collision_dir / "collision.glb"
            collision_path.write_bytes(collision_payload)
            physics_metadata = build_physics_metadata(uv_mesh, physics_config, collision_stats)
            _write_json(metadata_dir / "physics.json", physics_metadata)
        except Exception as exc:
            logger.error("Physics preparation failed for %s: %s", job_id, exc, exc_info=True)
            raise RuntimeError(f"Physics preparation failed: {exc}") from exc

    _emit(progress, 0.93, "preview", "Generating asset preview.")
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

    _emit(progress, 0.96, "qa", "Running final game-ready inspection.")
    try:
        final_scene = trimesh.load(glb_path, file_type="glb", process=False)
        if not isinstance(final_scene, trimesh.Scene):
            final_scene = trimesh.Scene(uv_mesh)
        qa_report = run_inspect(
            final_scene,
            uv_mesh,
            InspectOptions(
                tri_budget=50_000,
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

    now = datetime.now(timezone.utc).isoformat()
    _write_json(
        metadata_dir / "job.json",
        {
            "job_id": job_id,
            "created_at": now,
            "source_path": str(raw_path),
            "model_id": job_metadata.get("model_id"),
            "feature": job_metadata.get("feature"),
            "inputs": job_inputs,
            "generation_result": generation_result,
        },
    )
    _write_json(
        metadata_dir / "quality_report.json",
        {
            "before_postprocess": qa_before,
            "after_postprocess": qa_report,
            "repair": repair_stats,
            "optimize": optimize_stats,
            "uv": uv_stats,
            "bake": bake_stats,
            "collision": collision_stats,
            "physics": physics_metadata,
        },
    )

    generated = {
        "game_ready": game_ready,
        "lods": lods,
        "collision": str(collision_path) if collision_path else None,
        "physics": str(metadata_dir / "physics.json") if physics_metadata else None,
        "physics_metadata": physics_metadata,
        "textures": texture_paths,
        "thumbnail": str(thumbnail_path) if thumbnail_path else None,
    }
    final_result = _build_result(job_id, asset_dir, asset_name, qa_report, generated)
    final_result["model_url"] = final_result["game_ready_url"]
    _write_json(asset_manifest, final_result)
    _emit(progress, 1.0, "postprocess", "Production asset is ready.")
    return final_result
