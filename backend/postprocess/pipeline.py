"""ForMesh3D production post-processing pipeline.

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
from core.utils.artifact_utils import sha256_file
from core.quality.evaluation import compare_meshes, quality_gate
from core.config import get_quality_config
from core.scheduler.resource_planner import configure_cpu_runtime, cpu_count
from .config import blender_expr_argv, blender_runtime_available
from .services.memory_safe_decimate import memory_safe_decimate
from .meshio import apply_angle_weighted_normals, load_mesh, load_mesh_vertex_normals, mesh_stats
from .physics import build_physics_metadata, collision_options_for_quality, normalize_physics_config
from .services.auto_retopo import run_auto_retopo
from .services.auto_uv import run_auto_uv
from .services.collision import run_collision
from .services.convert_fbx import run_convert_fbx
from .services.inspect import run_inspect
from .services.repair import run_repair, topology_counts
from .services.simplify import run_lods, run_optimize
from .services import (
    evaluate_topology_gate,
    repair_holes_targeted,
    memory_safe_decimate,
    resolve_uv_backend,
    execute_uv_unwrap,
    validate_pbr_asset,
)
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

from core.config import get_quality_config

logger = logging.getLogger(__name__)

GenerationProgress = Optional[Callable[[float, str, str], None]]
CancelChecker = Optional[Callable[[], bool]]

MAX_PRODUCTION_FACES = int(get_quality_config()["limits"]["max_production_faces"])
_FORMATS = ("glb", "fbx")


def _check_cancelled(cancel_checker: CancelChecker) -> None:
    if cancel_checker is not None:
        try:
            if cancel_checker():
                logger.info("[POSTPROCESS CANCELLED] Cancellation requested; stopping pipeline cooperatively.")
                raise InterruptedError("Post-processing cancelled by user")
        except InterruptedError:
            raise
        except Exception as exc:
            logger.warning("[POSTPROCESS] Cancel checker check failed: %s", exc)


def resolve_texture_preset(preset_val: Any) -> tuple[str, int]:
    """Resolve user-visible resolution preset to canonical label and target atlas dimension."""
    if preset_val is None:
        return ("2K", 2048)
    s = str(preset_val).strip().upper()
    if s in {"1K", "1024"}:
        return ("1K", 1024)
    if s in {"2K", "2048"}:
        return ("2K", 2048)
    if s in {"4K", "4096"}:
        return ("4K", 4096)
    if s in {"8K", "8192"}:
        return ("8K", 8192)
    raise ValueError(
        f"Unsupported texture resolution '{preset_val}'. Supported values: 1K (1024), 2K (2048), 4K (4096), 8K (8192)"
    )


def _resolve_reference_image(job_inputs: Dict[str, Any], job_metadata: Dict[str, Any]) -> Optional[Path]:
    """Find durable server-side path to reference image."""
    candidates = [
        job_inputs.get("texture_image_path"),
        job_metadata.get("texture_image_path"),
        job_inputs.get("reference_image_path"),
        job_metadata.get("reference_image_path"),
        job_inputs.get("image_path"),
        job_metadata.get("image_path"),
        job_inputs.get("image_file_path"),
        job_inputs.get("image_file_id"),
        job_inputs.get("file_id"),
        job_metadata.get("image_file_id"),
    ]
    for cand in candidates:
        if not cand:
            continue
        try:
            resolved = resolve_server_file_path(cand)
            if resolved and Path(resolved).is_file():
                return Path(resolved)
        except Exception:
            pass
        p = Path(str(cand))
        if p.is_file():
            return p
    return None



def _extract_base_color_texture(glb_path: Path) -> Optional[Image.Image]:
    """Read the actual embedded base-colour atlas from a newly generated GLB."""
    try:
        loaded = trimesh.load(glb_path, file_type="glb", process=False)
        geometries = (
            loaded.geometry.values()
            if isinstance(loaded, trimesh.Scene)
            else [loaded]
        )
        for geometry in geometries:
            material = getattr(getattr(geometry, "visual", None), "material", None)
            if material is None:
                continue
            image = (
                getattr(material, "baseColorTexture", None)
                or getattr(material, "image", None)
            )
            if isinstance(image, Image.Image):
                return image.copy()
            if isinstance(image, np.ndarray) and image.ndim in (2, 3):
                try:
                    return Image.fromarray(image.copy())
                except (TypeError, ValueError):
                    continue
    except Exception as exc:
        logger.debug("Could not extract embedded base-colour atlas from %s: %s", glb_path, exc)
    return None


def _validate_texture_atlas_dimension(
    actual_dimension: Optional[list[int]], target_dimension: int
) -> tuple[bool, Optional[list[int]], Optional[str]]:
    """Require an observed embedded atlas with exactly the requested square size."""
    if not actual_dimension or len(actual_dimension) < 2:
        return False, actual_dimension, "Could not verify the embedded base-colour atlas dimensions."
    actual = [int(actual_dimension[0]), int(actual_dimension[1])]
    if actual != [target_dimension, target_dimension]:
        return False, actual, (
            f"Texture atlas is {actual[0]}x{actual[1]}; "
            f"requested {target_dimension}x{target_dimension}."
        )
    return True, actual, None


def _normalize_textured_glb_pbr_defaults(glb_path: Path) -> int:
    """Apply safe PBR defaults to albedo-only materials without re-exporting geometry.

    glTF defaults an omitted metallicFactor to 1.0. For AI-painted materials that
    carry base colour but no metallic/roughness map, this can render the albedo
    almost black under a studio environment. Patch only omitted factors in the
    GLB JSON chunk and leave geometry, images, extensions, and explicit factors
    byte-for-byte intact.
    """
    payload = glb_path.read_bytes()
    if len(payload) < 20:
        raise RuntimeError("Textured GLB is truncated or missing its first chunk.")

    magic, version, declared_length = struct.unpack_from("<4sII", payload, 0)
    if magic != b"glTF" or version != 2 or declared_length != len(payload):
        raise RuntimeError("Texturing adapter returned an invalid GLB 2.0 container.")

    chunks: list[tuple[bytes, bytes]] = []
    document: Optional[Dict[str, Any]] = None
    offset = 12
    while offset < len(payload):
        if offset + 8 > len(payload):
            raise RuntimeError("Textured GLB contains a truncated chunk header.")
        chunk_length, chunk_type = struct.unpack_from("<I4s", payload, offset)
        offset += 8
        chunk_end = offset + chunk_length
        if chunk_end > len(payload):
            raise RuntimeError("Textured GLB contains a truncated chunk payload.")
        chunk_payload = payload[offset:chunk_end]
        if chunk_type == b"JSON":
            if document is not None:
                raise RuntimeError("Textured GLB contains duplicate JSON chunks.")
            try:
                parsed = json.loads(chunk_payload.decode("utf-8").rstrip(" \t\r\n\x00"))
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise RuntimeError("Textured GLB has an unreadable JSON chunk.") from exc
            if not isinstance(parsed, dict):
                raise RuntimeError("Textured GLB JSON root must be an object.")
            document = parsed
        chunks.append((chunk_type, chunk_payload))
        offset = chunk_end

    if document is None:
        raise RuntimeError("Textured GLB has no JSON chunk.")

    normalized_materials = 0
    materials = document.get("materials", [])
    if isinstance(materials, list):
        for material in materials:
            if not isinstance(material, dict):
                continue
            pbr = material.get("pbrMetallicRoughness")
            if not isinstance(pbr, dict) or "baseColorTexture" not in pbr:
                continue
            # Preserve explicit authored factors; repair only the glTF metallic
            # default for albedo-only materials and give missing roughness a
            # neutral studio value.
            before = dict(pbr)
            if "metallicRoughnessTexture" not in pbr:
                pbr.setdefault("metallicFactor", 0.0)
                pbr.setdefault("roughnessFactor", 0.7)
            if pbr != before:
                normalized_materials += 1

    if normalized_materials == 0:
        return 0

    rebuilt = bytearray(struct.pack("<4sII", b"glTF", 2, 0))
    for chunk_type, chunk_payload in chunks:
        if chunk_type == b"JSON":
            chunk_payload = json.dumps(
                document, ensure_ascii=False, separators=(",", ":")
            ).encode("utf-8")
            chunk_payload += b" " * ((-len(chunk_payload)) % 4)
        if len(chunk_payload) % 4:
            raise RuntimeError(f"Textured GLB chunk {chunk_type!r} is not 4-byte aligned.")
        rebuilt.extend(struct.pack("<I4s", len(chunk_payload), chunk_type))
        rebuilt.extend(chunk_payload)

    struct.pack_into("<I", rebuilt, 8, len(rebuilt))
    temporary_path = glb_path.with_name(f".{glb_path.name}.pbr.tmp")
    try:
        temporary_path.write_bytes(rebuilt)
        temporary_path.replace(glb_path)
    finally:
        temporary_path.unlink(missing_ok=True)
    return normalized_materials


def _execute_texture_stage(
    job_id: str,
    asset_dir: Path,
    base_name: str,
    target_mesh_path: Path,
    job_inputs: Dict[str, Any],
    job_metadata: Dict[str, Any],
    preset_label: str,
    target_atlas_size: int,
    cancel_checker: CancelChecker = None,
    progress: GenerationProgress = None,
) -> Dict[str, Any]:
    """Run centralized texture stage using Paint3D (1K/2K), Hunyuan3D-Paint v2.1 (4K/8K), or TRELLIS.2."""
    _check_cancelled(cancel_checker)
    paint_preference = str(
        job_inputs.get("paint_model_preference")
        or job_inputs.get("paint_model")
        or job_metadata.get("paint_model_preference")
        or job_metadata.get("paint_model")
        or ""
    ).strip().lower()

    if paint_preference in {"trellis2", "trellis2_paint", "trellis2_image_mesh_painting"}:
        model_id = "trellis2_image_mesh_painting"
    else:
        model_id = "paint3d" if preset_label in {"1K", "2K"} else "hunyuan3d_paint_v21"

    ref_image_path = _resolve_reference_image(job_inputs, job_metadata)
    if not ref_image_path or not ref_image_path.is_file():
        err_msg = f"Original reference image not found or inaccessible for texturing: {ref_image_path}"
        logger.warning("[POSTPROCESS TEXTURE] %s", err_msg)
        return {
            "status": "failed",
            "error": err_msg,
            "model": model_id,
            "preset": preset_label,
            "target_atlas_size": target_atlas_size,
        }

    texture_dir = asset_dir / "textures"
    texture_dir.mkdir(parents=True, exist_ok=True)
    textured_glb_path = texture_dir / f"{base_name}_textured.glb"

    try:
        if model_id == "trellis2_image_mesh_painting":
            adapter = None
            try:
                from core.scheduler.model_factory import ModelFactory
                for key in ("trellis2_image_mesh_painting", "trellis2_paint"):
                    if key in ModelFactory.ADAPTER_REGISTRY:
                        adapter = ModelFactory.create_model_from_config({
                            "model_id": key,
                            "vram_requirement": 16000,
                            "feature_type": "image_mesh_painting",
                        })
                        break
            except Exception as e:
                logger.debug("ModelFactory Trellis2-Paint lookup: %s", e)

            if adapter is None:
                try:
                    from adapters.trellis2_paint_adapter import Trellis2ImageMeshPaintingAdapter
                    adapter = Trellis2ImageMeshPaintingAdapter(vram_requirement=16000)
                except Exception as exc:
                    raise RuntimeError(f"TRELLIS.2 paint adapter could not be loaded: {exc}")

            _check_cancelled(cancel_checker)
            should_unload_t2 = False
            from core.models.base import ModelStatus
            if getattr(adapter, "status", None) in (ModelStatus.UNLOADED, ModelStatus.ERROR):
                gpu_id = getattr(adapter, "gpu_id", None)
                if gpu_id is None:
                    import os
                    cuda_vis = os.environ.get("CUDA_VISIBLE_DEVICES", "0")
                    try:
                        gpu_id = int(cuda_vis.split(",")[0])
                    except Exception:
                        gpu_id = 0
                _emit(progress, 0.66, "texture", f"Loading {model_id} model on GPU {gpu_id}...")
                adapter.load(gpu_id)
                _emit(progress, 0.68, "texture", f"{model_id} model loaded successfully")
                should_unload_t2 = True
            try:
                _emit(progress, 0.70, "texture", "Texturing mesh with TRELLIS.2...")
                res = adapter.process({
                    "mesh_path": str(target_mesh_path),
                    "image_path": str(ref_image_path),
                    "output_format": "glb",
                    "extension_webp": True,
                    "progress_callback": lambda stage, frac, msg: _emit(progress, frac, stage, msg),
                    "timeout_seconds": 1800,
                    "cancel_checker": cancel_checker,
                })
            finally:
                if should_unload_t2:
                    try:
                        adapter.unload()
                    except Exception:
                        pass
            out_mesh = res.get("output_mesh_path") if isinstance(res, dict) else None
            if not out_mesh or not Path(out_mesh).is_file():
                raise RuntimeError(f"TRELLIS.2 paint returned no output mesh: {res}")
            shutil.copy2(out_mesh, textured_glb_path)

        elif preset_label in {"1K", "2K"}:
            adapter = None
            try:
                from core.scheduler.model_factory import ModelFactory
                for key in ("paint3d", "paint3d_image_mesh_painting"):
                    if key in ModelFactory.ADAPTER_REGISTRY:
                        adapter = ModelFactory.create_model_from_config({
                            "model_id": key,
                            "vram_requirement": 12000,
                            "feature_type": "image_mesh_painting",
                        })
                        break
            except Exception as e:
                logger.debug("ModelFactory Paint3D lookup: %s", e)

            if adapter is None:
                for mod_name, cls_name in [
                    ("adapters.paint3d_adapter", "Paint3DImageMeshPaintingAdapter"),
                    ("adapters.paint3d_adapter", "Paint3DAdapter"),
                ]:
                    try:
                        import importlib
                        mod = importlib.import_module(mod_name)
                        cls = getattr(mod, cls_name, None)
                        if cls:
                            adapter = cls(vram_requirement=12000)
                            break
                    except Exception as e:
                        logger.debug("Paint3D direct import %s.%s: %s", mod_name, cls_name, e)

            if adapter is None:
                raise RuntimeError("Paint3D texture adapter is not yet registered or installed.")

            _check_cancelled(cancel_checker)
            should_unload = False
            from core.models.base import ModelStatus
            if getattr(adapter, "status", None) in (ModelStatus.UNLOADED, ModelStatus.ERROR):
                # BaseModel.load() requires gpu_id; use adapter's gpu_id or default to 0
                gpu_id = getattr(adapter, "gpu_id", None)
                if gpu_id is None:
                    import os
                    cuda_vis = os.environ.get("CUDA_VISIBLE_DEVICES", "0")
                    try:
                        gpu_id = int(cuda_vis.split(",")[0])
                    except Exception:
                        gpu_id = 0
                _emit(progress, 0.66, "texture", f"Loading {model_id} model on GPU {gpu_id}...")
                adapter.load(gpu_id)
                _emit(progress, 0.68, "texture", f"{model_id} model loaded successfully")
                should_unload = True
            try:
                res = adapter.process({
                    "mesh_path": str(target_mesh_path),
                    "image_path": str(ref_image_path),
                    "output_format": "glb",
                    "resolution": target_atlas_size,
                    "texture_resolution": target_atlas_size,
                    "progress_callback": lambda stage, frac, msg: _emit(progress, frac, stage, msg),
                    "timeout_seconds": 1800,
                    "cancel_checker": cancel_checker,
                })
            finally:
                if should_unload:
                    try:
                        adapter.unload()
                    except Exception:
                        pass
            out_mesh = res.get("output_mesh_path") if isinstance(res, dict) else None
            if not out_mesh or not Path(out_mesh).is_file():
                raise RuntimeError(f"Paint3D returned no output mesh: {res}")
            shutil.copy2(out_mesh, textured_glb_path)

        else:
            adapter = None
            try:
                from core.scheduler.model_factory import ModelFactory
                if "hunyuan3d_paint_v21_image_mesh_painting" in ModelFactory.ADAPTER_REGISTRY:
                    adapter = ModelFactory.create_model_from_config({
                        "model_id": "hunyuan3d_paint_v21_image_mesh_painting",
                        "vram_requirement": 21000,
                        "feature_type": "image_mesh_painting",
                    })
            except Exception as e:
                logger.debug("ModelFactory Hunyuan3D-Paint lookup: %s", e)

            if adapter is None:
                try:
                    from adapters.hunyuan3d_paint_v21 import Hunyuan3DPaintV21ImageMeshPaintingAdapter
                    adapter = Hunyuan3DPaintV21ImageMeshPaintingAdapter(vram_requirement=21000)
                except Exception as exc:
                    raise RuntimeError(f"Hunyuan3D-Paint-v2.1 adapter could not be loaded: {exc}")

            _check_cancelled(cancel_checker)
            should_unload_hy = False
            from core.models.base import ModelStatus
            if getattr(adapter, "status", None) in (ModelStatus.UNLOADED, ModelStatus.ERROR):
                # BaseModel.load() requires gpu_id; use adapter's gpu_id or default to 0
                gpu_id = getattr(adapter, "gpu_id", None)
                if gpu_id is None:
                    import os
                    cuda_vis = os.environ.get("CUDA_VISIBLE_DEVICES", "0")
                    try:
                        gpu_id = int(cuda_vis.split(",")[0])
                    except Exception:
                        gpu_id = 0
                _emit(progress, 0.66, "texture", f"Loading {model_id} model on GPU {gpu_id}...")
                adapter.load(gpu_id)
                _emit(progress, 0.68, "texture", f"{model_id} model loaded successfully")
                should_unload_hy = True
            try:
                hy_res = 512 if preset_label == "4K" else 768
                res = adapter.process({
                    "mesh_path": str(target_mesh_path),
                    "image_path": str(ref_image_path),
                    "output_format": "glb",
                    "resolution": hy_res,
                    "texture_resolution": target_atlas_size,
                    "max_num_view": int(job_inputs.get("max_num_view") or 6),
                    "progress_callback": lambda stage, frac, msg: _emit(progress, frac, stage, msg),
                    "timeout_seconds": 1800,
                    "cancel_checker": cancel_checker,
                })
            finally:
                if should_unload_hy:
                    try:
                        adapter.unload()
                    except Exception:
                        pass
            out_mesh = res.get("output_mesh_path") if isinstance(res, dict) else None
            if not out_mesh or not Path(out_mesh).is_file():
                raise RuntimeError(f"Hunyuan3D-Paint-v2.1 returned no output mesh: {res}")
            shutil.copy2(out_mesh, textured_glb_path)

        _check_cancelled(cancel_checker)

        normalized_material_count = _normalize_textured_glb_pbr_defaults(textured_glb_path)
        if normalized_material_count:
            logger.info(
                "[POSTPROCESS TEXTURE] Applied safe PBR defaults to %d albedo-only material(s).",
                normalized_material_count,
            )

        standard_textured = texture_dir / "textured.glb"
        if not standard_textured.exists() or standard_textured.resolve() != textured_glb_path.resolve():
            shutil.copy2(textured_glb_path, standard_textured)

        base_color = _extract_base_color_texture(textured_glb_path)
        actual_dim = list(base_color.size) if base_color is not None else None
        valid_dim, actual_dim, dimension_error = _validate_texture_atlas_dimension(
            actual_dim, target_atlas_size
        )
        if not valid_dim:
            raise RuntimeError(dimension_error or "Texture atlas dimensions could not be verified.")
        assert base_color is not None
        pbr_output_report = _run_pbr_validation(textured_glb_path, required=True)
        base_color_degenerate = any(
            "degenerate texture map 'base_color'" in str(warning).lower()
            for warning in pbr_output_report.get("warnings", [])
        )
        if pbr_output_report.get("uv_valid") is not True:
            uv_warnings = [
                str(warning) for warning in pbr_output_report.get("warnings", [])
                if "uv" in str(warning).lower()
            ]
            raise RuntimeError(
                "Textured GLB has missing or invalid UV coordinates: "
                + ("; ".join(uv_warnings) if uv_warnings else "UV validation failed.")
            )
        if base_color_degenerate:
            raise RuntimeError(
                "Textured GLB contains a degenerate base-colour atlas (uniform black or white)."
            )
        base_color.save(texture_dir / "base_color.png")

        logger.info(
            "[POSTPROCESS TEXTURE] Stage completed for %s: model=%s preset=%s atlas=%dx%d",
            job_id, model_id, preset_label, actual_dim[0], actual_dim[1],
        )
        return {
            "status": "completed",
            "model": model_id,
            "preset": preset_label,
            "target_atlas_size": target_atlas_size,
            "validated_atlas_dimension": actual_dim,
            "pbr_validation": pbr_output_report,
            "normalized_material_count": normalized_material_count,
            "textured_glb": str(textured_glb_path),
            "texture_maps": {p.stem: str(p) for p in texture_dir.glob("*.png")},
        }

    except InterruptedError:
        raise
    except Exception as exc:
        logger.warning(
            "Centralized texture generation failed for %s: %s; preserving raw mesh artifacts",
            job_id, exc, exc_info=True,
        )
        return {
            "status": "failed",
            "error": str(exc),
            "model": model_id,
            "preset": preset_label,
            "target_atlas_size": target_atlas_size,
        }
    finally:
        _clear_gpu_cache()


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


def _ensure_master_source(raw_path: Path | str, master_path: Path | str) -> tuple[bool, str]:
    """Refresh master/source.glb by content identity, not file size."""
    source = Path(raw_path)
    master = Path(master_path)
    if not source.is_file():
        raise FileNotFoundError(f"Raw source mesh is missing: {source}")

    source_sha256 = sha256_file(source)
    master_sha256 = sha256_file(master) if master.is_file() else None
    if source_sha256 == master_sha256:
        return False, source_sha256

    master.parent.mkdir(parents=True, exist_ok=True)
    temp_path = master.with_name(f".{master.name}.{time.time_ns()}.tmp")
    try:
        shutil.copy2(source, temp_path)
        if sha256_file(temp_path) != source_sha256:
            raise RuntimeError("Raw source mesh changed while copying to master/source.glb.")
        temp_path.replace(master)
    finally:
        try:
            temp_path.unlink()
        except FileNotFoundError:
            pass
    return True, source_sha256


def prepare_asset_job_workspace(source_path: Path | str, job_id: str) -> tuple[Path, Path]:
    """Reuse the selected asset workspace or snapshot an external source into one."""
    source = Path(source_path).resolve(strict=True)
    if not source.is_file():
        raise FileNotFoundError(f"Source mesh is missing: {source}")

    meshes_root = _storage_root().resolve()
    asset_root = None
    for parent in source.parents:
        if parent.parent == meshes_root and any(
            (parent / "metadata" / name).is_file()
            for name in ("job.json", "asset.json")
        ):
            asset_root = parent.resolve(strict=True)
            break

    if asset_root is None:
        asset_root = meshes_root / f"{_safe_name(source.stem)}_{_safe_name(job_id)}"
        asset_root.mkdir(parents=True, exist_ok=True)

    asset_root.relative_to(meshes_root)
    master_dir = asset_root / "master"
    master_dir.mkdir(parents=True, exist_ok=True)
    source_candidates = list(master_dir.glob("source.*"))
    if source_candidates:
        matching = [candidate for candidate in source_candidates if candidate.suffix.lower() == source.suffix.lower()]
        if len(matching) == 1:
            master_path = matching[0]
        elif len(source_candidates) == 1:
            master_path = source_candidates[0]
        elif master_dir / "source.glb" in source_candidates:
            master_path = master_dir / "source.glb"
        else:
            raise RuntimeError(f"Ambiguous immutable master in asset workspace: {asset_root}")
    else:
        master_path = master_dir / f"source{source.suffix.lower() or '.glb'}"
        if source != master_path.resolve():
            shutil.copy2(source, master_path)

    return asset_root, master_path


def register_asset_job_manifest(
    asset_root: Path | str,
    job_id: str,
    source_path: Path | str,
    master_path: Path | str,
    artifacts: Optional[Dict[str, Dict[str, Any]]] = None,
) -> Path:
    """Persist a per-job artifact declaration without replacing the asset manifest."""
    root = Path(asset_root).resolve(strict=True)
    root.relative_to(_storage_root().resolve())
    master = Path(master_path).resolve(strict=True)
    master.relative_to(root)
    source = Path(source_path).resolve(strict=True)
    try:
        source_ref = source.relative_to(root).as_posix()
    except ValueError:
        source_ref = master.relative_to(root).as_posix()

    declared = {}
    for name, artifact in (artifacts or {}).items():
        path = Path(artifact["path"]).resolve(strict=True)
        path.relative_to(root)
        declared[name] = {
            **{key: value for key, value in artifact.items() if key != "path"},
            "path": path.relative_to(root).as_posix(),
        }

    metadata_dir = root / "metadata" / "jobs"
    metadata_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = metadata_dir / f"{_safe_name(job_id)}.json"
    temporary_path = manifest_path.with_suffix(".tmp")
    manifest_payload = {
        "manifest_version": "1",
        "job_id": job_id,
        "asset_root": str(root),
        "source_path": source_ref,
        "master_path": master.relative_to(root).as_posix(),
        "artifacts": declared,
    }
    _write_json(temporary_path, manifest_payload)
    temporary_path.replace(manifest_path)
    job_manifest_path = root / "metadata" / "job.json"
    _write_json(job_manifest_path, manifest_payload)
    return manifest_path


def persist_manual_mesh_result(
    job_id: str,
    result: Dict[str, Any],
    job_inputs: Dict[str, Any],
    job_metadata: Dict[str, Any],
) -> Dict[str, Any]:
    """Save a mesh-tool result as a derivative of its selected immutable source."""
    source = Path(job_inputs["mesh_path"]).resolve(strict=True)
    expected_source_hash = job_metadata.get("source_sha256")
    source_hash = sha256_file(source)
    if expected_source_hash and source_hash != expected_source_hash:
        raise RuntimeError("Selected source mesh changed while the mesh tool was running.")

    output_path = next(
        (result.get(key) for key in ("output_mesh_path", "mesh_path", "output_path", "file_path") if result.get(key)),
        None,
    )
    if not output_path:
        raise FileNotFoundError("Mesh tool completed without a declared output path.")
    output = Path(output_path).resolve(strict=True)
    if not output.is_file() or output == source:
        raise RuntimeError("Mesh tool output must be a separate file from its source.")

    asset_root, master_path = prepare_asset_job_workspace(source, job_id)
    derivative = asset_root / "derived" / _safe_name(job_id) / f"result{output.suffix.lower()}"
    derivative.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(output, derivative)

    # Enforce target polycount / face count on derivative if specified
    target_polycount = job_inputs.get("target_polycount")
    if target_polycount is not None:
        try:
            target_poly = int(target_polycount)
            if target_poly > 0:
                from core.mesh_processor import MeshProcessor
                mp = MeshProcessor()
                loaded_mesh = mp.load_mesh(derivative)
                if loaded_mesh is not None and len(loaded_mesh.faces) > target_poly:
                    simplified, _ = mp.simplify_mesh(loaded_mesh, target_faces=target_poly)
                    if simplified is not None:
                        mp.save_mesh(simplified, derivative, do_normalise=False)
        except Exception as poly_err:
            logger.warning("[MANUAL MESH TOOL] Could not decimate derivative to target_polycount=%s: %s", target_polycount, poly_err)

    if sha256_file(source) != source_hash:
        derivative.unlink(missing_ok=True)
        raise RuntimeError("Selected source mesh changed while saving the tool derivative.")

    derivative_rel = derivative.relative_to(asset_root).as_posix()
    master_rel = master_path.relative_to(asset_root).as_posix()
    try:
        source_rel = source.relative_to(asset_root).as_posix()
    except ValueError:
        source_rel = master_rel

    artifact = {
        "status": "ready",
        "path": str(derivative),
        "relative_path": derivative_rel,
        "format": output.suffix.lower().lstrip("."),
        "source_path": source_rel,
    }
    artifacts = dict(result.get("artifacts") or {})
    artifacts["derived"] = artifact
    artifacts["master"] = {
        "status": "ready",
        "path": str(master_path),
        "relative_path": master_rel,
        "format": master_path.suffix.lower().lstrip("."),
    }

    feature_type = (
        job_metadata.get("feature_type")
        or job_metadata.get("feature")
        or job_inputs.get("feature_type")
        or job_inputs.get("feature")
        or ""
    )
    is_texture_job = (
        feature_type in ("image_mesh_painting", "text_mesh_painting", "image_to_textured_mesh")
        or "painting_info" in result
        or "texture_map_paths" in result
        or "textured_mesh_path" in result
        or bool(job_inputs.get("texture_resolution"))
    )

    if is_texture_job:
        textures_dir = asset_root / "textures"
        textures_dir.mkdir(parents=True, exist_ok=True)
        asset_stem = _safe_name(job_inputs.get("asset_name") or source.stem or "asset")
        textured_canonical = textures_dir / f"{asset_stem}_textured.glb"
        standard_textured = textures_dir / "textured.glb"
        try:
            shutil.copy2(derivative, textured_canonical)
            if not standard_textured.exists() or standard_textured.resolve() != textured_canonical.resolve():
                shutil.copy2(textured_canonical, standard_textured)

            map_paths = result.get("texture_map_paths") or {}
            if isinstance(map_paths, dict):
                for map_name, map_p in map_paths.items():
                    if map_p and Path(map_p).is_file():
                        shutil.copy2(map_p, textures_dir / f"{map_name}{Path(map_p).suffix}")

            base_color = _extract_base_color_texture(textured_canonical)
            if base_color is not None:
                base_color.save(textures_dir / "base_color.png")
        except Exception as tex_err:
            logger.warning("[MANUAL MESH TOOL] Could not register canonical texture artifacts: %s", tex_err)

        textured_rel = textured_canonical.relative_to(asset_root).as_posix()
        artifacts["textured"] = {
            "status": "ready",
            "path": str(textured_canonical),
            "relative_path": textured_rel,
            "format": "glb",
            "source_path": source_rel,
        }

    register_asset_job_manifest(asset_root, job_id, source, master_path, artifacts)

    # Update or create canonical asset manifest (asset.json) with relative paths
    asset_manifest_file = asset_root / "metadata" / "asset.json"
    manifest_data = {}
    if asset_manifest_file.is_file():
        try:
            manifest_data = json.loads(asset_manifest_file.read_text(encoding="utf-8"))
        except Exception:
            manifest_data = {}
    if not isinstance(manifest_data, dict) or not manifest_data:
        manifest_data = {
            "manifest_version": "1",
            "asset_id": asset_root.name,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "master": master_rel,
            "production_status": "ready",
            "artifacts": {},
            "source_lineage": {
                "source_path": source_rel,
                "master_path": master_rel,
                "source_sha256": source_hash,
                "derivative_path": derivative_rel,
            },
        }
    artifacts_map = manifest_data.setdefault("artifacts", {})
    artifacts_map["master"] = {
        "status": "ready",
        "path": master_rel,
        "format": master_path.suffix.lower().lstrip("."),
    }
    artifacts_map["derived"] = {
        "status": "ready",
        "path": derivative_rel,
        "format": output.suffix.lower().lstrip("."),
    }
    if is_texture_job and "textured" in artifacts:
        artifacts_map["textured"] = {
            "status": "ready",
            "path": artifacts["textured"]["relative_path"],
            "format": "glb",
        }
    manifest_data.setdefault("derived_artifacts", {})[job_id] = {
        "path": derivative_rel,
        "format": output.suffix.lower().lstrip("."),
        "job_id": job_id,
    }
    _write_json(asset_manifest_file, manifest_data)

    final_result = dict(result)
    final_result["output_mesh_path"] = str(derivative)
    if is_texture_job and "textured" in artifacts:
        final_result["textured_glb"] = artifacts["textured"]["path"]
    final_result["asset_root"] = str(asset_root)
    final_result["artifacts"] = artifacts
    final_result["source_lineage"] = {
        "source_path": str(source),
        "master_path": str(master_path),
        "source_sha256": source_hash,
        "derivative_path": str(derivative),
    }
    return final_result


def _resolve_target_polycount(value: Any) -> int:
    """Missing/nonpositive budgets mean Native/Raw; positive values opt into a derivative budget."""
    if value is None:
        return 0
    try:
        target = int(value)
    except (TypeError, ValueError, OverflowError):
        return 0
    if target <= 0:
        return 0
    return min(MAX_PRODUCTION_FACES, max(50, target))


def _should_run_structural_repair(topology: Dict[str, Any], auto_repair_enabled: bool) -> bool:
    """Structural repair mutates a derivative only after explicit user opt-in."""
    return bool(auto_repair_enabled) and (
        not bool(topology.get("watertight", False))
        or int(topology.get("non_manifold_edges") or 0) > 0
    )


def _should_auto_optimize(requested: Any, target_polycount: int) -> bool:
    """A Native/Raw sentinel cannot also request automatic production decimation."""
    return bool(requested) and int(target_polycount) > 0


def _should_run_feature_remesh(
    quality_mode: str,
    solid_generation_feature: bool,
    native_textures: bool,
    retopo_status: str,
    target_polycount: Optional[int],
) -> bool:
    """Adaptive remeshing requires an explicit positive production target."""
    return (
        quality_mode in {"high", "ultra"}
        and solid_generation_feature
        and not native_textures
        and retopo_status != "completed"
        and target_polycount is not None
        and target_polycount > 0
    )


def _collect_input_hashes(inputs: Dict[str, Any]) -> Dict[str, str]:
    hashes: Dict[str, str] = {}
    for key, value in inputs.items():
        if not isinstance(value, str):
            continue
        candidate = Path(value)
        if candidate.is_file():
            try:
                hashes[key] = sha256_file(candidate)
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
    lines = ["# ForMesh3D Quad Mesh Export\n"]
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


def compute_mesh_tangents(mesh: trimesh.Trimesh) -> Optional[np.ndarray]:
    """Compute standard glTF 4-component tangent vectors (xyz + bitangent sign w)."""
    if not hasattr(mesh.visual, "uv") or mesh.visual.uv is None:
        return None
    uvs = np.asarray(mesh.visual.uv, dtype=np.float32)
    verts = np.asarray(mesh.vertices, dtype=np.float32)
    faces = np.asarray(mesh.faces, dtype=np.int64)
    if len(uvs) != len(verts) or len(faces) == 0:
        return None
    normals = np.asarray(mesh.vertex_normals, dtype=np.float32)
    v0, v1, v2 = verts[faces[:, 0]], verts[faces[:, 1]], verts[faces[:, 2]]
    uv0, uv1, uv2 = uvs[faces[:, 0]], uvs[faces[:, 1]], uvs[faces[:, 2]]
    delta_pos1 = v1 - v0
    delta_pos2 = v2 - v0
    delta_uv1 = uv1 - uv0
    delta_uv2 = uv2 - uv0
    r = (delta_uv1[:, 0] * delta_uv2[:, 1] - delta_uv1[:, 1] * delta_uv2[:, 0])
    valid = np.abs(r) > 1e-12
    inv_r = np.zeros_like(r)
    inv_r[valid] = 1.0 / r[valid]
    face_tangents = (delta_pos1 * delta_uv2[:, 1:2] - delta_pos2 * delta_uv1[:, 1:2]) * inv_r[:, np.newaxis]
    face_bitangents = (delta_pos2 * delta_uv1[:, 0:1] - delta_pos1 * delta_uv2[:, 0:1]) * inv_r[:, np.newaxis]
    tangents = np.zeros_like(verts)
    bitangents = np.zeros_like(verts)
    for i in range(3):
        np.add.at(tangents, faces[:, i], face_tangents)
        np.add.at(bitangents, faces[:, i], face_bitangents)
    dot_nt = np.sum(normals * tangents, axis=1, keepdims=True)
    ortho_tangents = tangents - normals * dot_nt
    norm_t = np.linalg.norm(ortho_tangents, axis=1, keepdims=True)
    norm_t[norm_t < 1e-8] = 1.0
    ortho_tangents /= norm_t
    cross_nt = np.cross(normals, ortho_tangents)
    dot_cb = np.sum(cross_nt * bitangents, axis=1)
    w = np.where(dot_cb < 0.0, -1.0, 1.0).astype(np.float32)
    result = np.zeros((len(verts), 4), dtype=np.float32)
    result[:, :3] = ortho_tangents
    result[:, 3] = w
    return result


def _export_glb(mesh: trimesh.Trimesh) -> bytes:
    if hasattr(mesh, "vertex_normals"):
        _ = mesh.vertex_normals
    tree_postprocessor = None
    mat = getattr(getattr(mesh, "visual", None), "material", None)
    if isinstance(mat, trimesh.visual.material.PBRMaterial):
        if getattr(mat, "metallicFactor", None) is None:
            mat.metallicFactor = 0.0 if getattr(mat, "metallicRoughnessTexture", None) is None else 1.0
        if getattr(mat, "roughnessFactor", None) is None:
            mat.roughnessFactor = 0.7 if getattr(mat, "metallicRoughnessTexture", None) is None else 1.0
        if getattr(mat, "baseColorFactor", None) is None and getattr(mat, "baseColorTexture", None) is None:
            mat.baseColorFactor = [0.82, 0.82, 0.82, 1.0]
    has_normal_tex = mat is not None and getattr(mat, "normalTexture", None) is not None
    if has_normal_tex and hasattr(mesh.visual, "uv") and mesh.visual.uv is not None:
        tangents = compute_mesh_tangents(mesh)
        if tangents is not None:
            mesh.vertex_attributes["TANGENT"] = tangents
            def _postprocess_tree(tree):
                for m in tree.get("meshes", []):
                    for p in m.get("primitives", []):
                        attrs = p.get("attributes", {})
                        if "_TANGENT" in attrs:
                            attrs["TANGENT"] = attrs.pop("_TANGENT")
            tree_postprocessor = _postprocess_tree

    payload = mesh.export(file_type="glb", tree_postprocessor=tree_postprocessor)
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

    # 2. Blender fallback (executable on PATH, or the bpy-module runtime)
    try:
        blender_available = blender_runtime_available()
    except Exception:
        blender_available = False
    if blender_available:
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
                blender_expr_argv(expr),
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


def _has_uvs(mesh: trimesh.Trimesh) -> bool:
    """Return True if mesh has non-empty UV coordinates."""
    visual = getattr(mesh, "visual", None)
    if visual is None:
        return False
    uv = getattr(visual, "uv", None)
    return uv is not None and len(uv) > 0


def _clear_gpu_cache() -> None:
    """Clear PyTorch/CUDA cache and garbage collection if torch/cuda is available."""
    try:
        import gc
        gc.collect()
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            if hasattr(torch.cuda, "ipc_collect"):
                torch.cuda.ipc_collect()
    except Exception:
        pass


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


def _validate_lod_chain(lod_levels: list[dict[str, Any]], reference: trimesh.Trimesh) -> Dict[str, Any]:
    """Validate LOD lineage without modifying any asset."""
    errors = []
    previous_faces = len(reference.faces)
    reference_bounds = np.asarray(reference.bounds, dtype=float)
    reference_diagonal = max(float(np.linalg.norm(reference_bounds[1] - reference_bounds[0])), 1e-9)
    for level in lod_levels:
        index = int(level.get("level", 0))
        level_mesh = level.get("mesh")
        if not isinstance(level_mesh, trimesh.Trimesh):
            errors.append(f"LOD{index}: missing mesh")
            continue
        vertices = np.asarray(level_mesh.vertices, dtype=float)
        if len(level_mesh.faces) == 0 or not np.isfinite(vertices).all():
            errors.append(f"LOD{index}: invalid or non-finite geometry")
            continue
        if index > 0 and len(level_mesh.faces) > previous_faces:
            errors.append(f"LOD{index}: face count increased")
        bounds = np.asarray(level_mesh.bounds, dtype=float)
        if bounds.shape == (2, 3):
            drift = float(np.max(np.abs(bounds - reference_bounds)) / reference_diagonal)
            if drift > 0.02:
                errors.append(f"LOD{index}: bounds drift {drift:.4f} exceeds 0.02")
        previous_faces = len(level_mesh.faces)
    return {
        "status": "pass" if not errors else "fail",
        "validated": len(lod_levels),
        "errors": errors,
    }


def _save_file(path: Path, payload: bytes) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(payload)
    return str(path)


def _run_pbr_validation(glb_path: Path, *, required: bool) -> Dict[str, Any]:
    """Run the PBR checker without letting an optional validator crash a finished mesh job."""
    try:
        report = validate_pbr_asset(glb_path)
        report = dict(report) if isinstance(report, dict) else {
            "valid": False,
            "warnings": ["PBR validator returned an invalid report shape."],
        }
        report["status"] = "pass" if report.get("valid") is True else "fail"
    except Exception as exc:
        logger.warning("PBR validation failed for %s: %s", glb_path, exc)
        report = {
            "valid": False,
            "status": "error",
            "warnings": ["PBR validator raised an exception."],
            "error": str(exc),
        }
    report["required"] = bool(required)
    return report


def _build_result(
    job_id: str,
    asset_dir: Path,
    asset_name: str,
    qa_report: Dict[str, Any],
    generated: Dict[str, Any],
    target_polycount: int = MAX_PRODUCTION_FACES,
    lod_enabled: bool = True,
    job_inputs: Optional[Dict[str, Any]] = None,
    job_metadata: Optional[Dict[str, Any]] = None,
    texture_enabled: bool = False,
    master_quality_report: Optional[Dict[str, Any]] = None,
    pbr_validation_report: Optional[Dict[str, Any]] = None,
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

    inputs = job_inputs or {}
    meta = job_metadata or {}
    textured_glb_path = generated.get("textured_glb")
    texture_stage = generated.get("texture_stage", {})
    texture_completed = texture_stage.get("status") == "completed"
    texture_failed = texture_stage.get("status") == "failed"
    bake_status = generated.get("bake_stats", {}).get("status", "skipped")
    bake_requested = bool(
        inputs.get("bake_normal_maps")
        or inputs.get("bake_high_to_low")
        or inputs.get("bake_textures")
        or meta.get("bake_normal_maps")
        or meta.get("bake_textures")
    )
    bake_degraded = bake_status == "degraded"
    bake_failed = bake_status == "failed" or (
        bake_requested and bake_status not in {"completed", "degraded"}
    )
    pbr_validation_report = pbr_validation_report if isinstance(pbr_validation_report, dict) else {}
    pbr_validation_required = bool(pbr_validation_report.get("required"))
    pbr_validation_failed = bool(
        pbr_validation_required and pbr_validation_report.get("valid") is not True
    )
    physics_enabled = bool(
        inputs.get("enable_physics")
        or inputs.get("physics_enabled")
        or meta.get("enable_physics")
        or meta.get("physics_enabled")
        or generated.get("collision")
    )
    collision_failed = bool(
        (generated.get("collision") is None and generated.get("artifact_errors", {}).get("collision"))
        or (physics_enabled and not generated.get("collision"))
    )
    collision_stats = generated.get("collision_stats") or {}
    collision_fallback_used = bool(
        collision_stats.get("fallback") or collision_stats.get("fallback_reason")
    )
    retopo_stats = generated.get("retopo_stats", {})
    retopo_requested = bool(
        inputs.get("quad_topology")
        or meta.get("quad_topology")
        or inputs.get("topology_mode") == "quad"
        or meta.get("topology_mode") == "quad"
    )
    retopo_skipped_native = bool(
        retopo_requested
        and (
            retopo_stats.get("fallback") == "triangles_retained_to_preserve_native_uvs"
            or (retopo_stats.get("status") in {"skipped", "degraded"} and "native" in str(retopo_stats.get("reason", "")).lower())
        )
    )

    active_model_url = download_model_url
    textured_url = None
    if texture_completed and textured_glb_path:
        textured_url = f"{base_url}/download?artifact_format=textured"
        active_model_url = textured_url

    result = {
        "success": True,
        "output_mesh_path": primary,
        "static_url": None,
        "model_url": download_model_url,
        "active_model_url": active_model_url,
        "textured_model_url": textured_url,
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
        "texture_dimensions": generated.get("texture_dimensions", {}),
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
        "topology": "Quad" if (generated.get("retopo_stats", {}).get("quad_faces") or inputs.get("topology_mode") == "quad" or meta.get("topology_mode") == "quad" or inputs.get("quad_topology") or meta.get("quad_topology")) else "Triangle",
        "quad_topology": bool(generated.get("retopo_stats", {}).get("quad_faces") or inputs.get("topology_mode") == "quad" or meta.get("topology_mode") == "quad" or inputs.get("quad_topology") or meta.get("quad_topology")),
        "asset_name": asset_name,
        "target_polycount": target_polycount,
        "lod_enabled": lod_enabled,
        "artifacts": {
            "master": {
                "status": "ready",
                "url": download_master_url,
                "path": "master/source.glb",
                "required": True,
            },
            "high_fidelity": {
                "status": "ready",
                "url": download_master_url,
                "path": "master/source.glb",
                "required": True,
            },
            "textured": {
                "status": "ready" if (texture_completed and textured_glb_path) else ("failed" if texture_failed else "skipped"),
                "url": textured_url,
                "path": Path(textured_glb_path).relative_to(asset_dir).as_posix() if (texture_completed and textured_glb_path) else None,
                "required": False,
                "error": texture_stage.get("error") if texture_failed else None,
            },
            "game_ready": {
                fmt: {
                    "status": (
                        "ready" if fmt in generated["game_ready"]
                        else "failed" if fmt in artifact_errors
                        else "unavailable"
                    ),
                    "url": f"{base_url}/download?artifact_format={fmt}" if fmt in generated["game_ready"] else None,
                    "path": Path(generated["game_ready"][fmt]).relative_to(asset_dir).as_posix() if fmt in generated["game_ready"] else None,
                    "error": artifact_errors.get(fmt),
                    "required": fmt == "glb",
                }
                for fmt in sorted(set(_FORMATS).union(k for k in generated.get("game_ready", {}) if k in {"obj", "quad_obj"}))
            },
            "lods": {
                f"lod{idx}": {
                    "status": "ready",
                    "url": f"{base_url}/download?artifact_format=lod{idx}",
                    "path": Path(generated["lods"][idx]).relative_to(asset_dir).as_posix() if idx in generated.get("lods", {}) else f"lods/lod{idx}.glb",
                    "required": False,
                }
                for idx in sorted(generated["lods"])
            } if lod_enabled else {},
            "collision": {
                "status": "ready" if generated.get("collision") else ("failed" if collision_failed else "skipped"),
                "url": f"{base_url}/download?artifact_format=collision" if generated.get("collision") else None,
                "path": Path(generated["collision"]).relative_to(asset_dir).as_posix() if generated.get("collision") else None,
                "required": False,
                "error": generated.get("artifact_errors", {}).get("collision"),
            },
            "physics": {
                "status": "ready" if generated.get("physics") else "skipped",
                "url": f"{base_url}/download?artifact_format=physics_json" if generated.get("physics") else None,
                "path": "metadata/physics.json" if generated.get("physics") else None,
                "required": False,
            },
            "bake": {
                "status": (
                    "ready" if bake_status == "completed"
                    else "degraded" if bake_degraded
                    else "failed" if bake_failed
                    else "skipped"
                ),
                "url": f"{base_url}/download?artifact_format=normal_map" if bake_status in {"completed", "degraded"} else None,
                "required": False,
                "error": (
                    generated.get("bake_stats", {}).get("error")
                    or generated.get("bake_stats", {}).get("reason")
                ) if (bake_failed or bake_degraded) else None,
            },
            "pbr_validation": {
                "status": (
                    "ready" if pbr_validation_report.get("valid") is True
                    else "failed" if pbr_validation_required
                    else "skipped"
                ),
                "url": f"{base_url}/download?artifact_format=qa_report",
                "path": "metadata/quality_report.json",
                "required": False,
                "error": pbr_validation_report.get("error"),
                "warnings": pbr_validation_report.get("warnings", []),
            },
            "retopology": {
                "status": retopo_stats.get("status", "skipped"),
                "required": retopo_requested,
                "fallback": retopo_stats.get("fallback"),
                "error": retopo_stats.get("error") if retopo_stats.get("status") == "failed" else (retopo_stats.get("reason") if retopo_skipped_native else None),
            },
            "texture_generation": {
                "status": texture_stage.get("status", "skipped"),
                "required": texture_enabled,
                "error": texture_stage.get("error") if texture_failed else None,
            },
            "qa_report": {
                "status": "ready",
                "url": f"{base_url}/download?artifact_format=qa_report",
                "path": "metadata/quality_report.json",
                "required": True,
            },
            "thumbnail": {
                "status": "ready" if generated.get("thumbnail") else "skipped",
                "url": f"{base_url}/download?artifact_format=thumbnail" if generated.get("thumbnail") else None,
                "path": Path(generated["thumbnail"]).relative_to(asset_dir).as_posix() if generated.get("thumbnail") else None,
                "required": False,
            },
            "zip": {"status": "ready", "url": f"{base_url}/download?artifact_format=zip", "required": False},
        },
        "qa_report": qa_report,
        "lod_validation": generated.get("lod_validation", {}),
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
    def _is_failed_artifact(art: Any) -> bool:
        if isinstance(art, dict):
            if art.get("status") == "failed":
                return True
            for sub in art.values():
                if isinstance(sub, dict) and sub.get("status") == "failed":
                    return True
        return False

    def _is_required_failed(art: Any) -> bool:
        if isinstance(art, dict):
            if art.get("required") and art.get("status") == "failed":
                return True
            for sub in art.values():
                if isinstance(sub, dict) and sub.get("required") and sub.get("status") == "failed":
                    return True
        return False

    required_failed = any(_is_required_failed(v) for v in result["artifacts"].values())
    any_failed = any(_is_failed_artifact(v) for v in result["artifacts"].values())
    quality_failed = (
        isinstance(qa_report.get("qa"), dict)
        and qa_report["qa"].get("status") == "fail"
    )
    lod_failed = generated.get("lod_validation", {}).get("status") == "fail"
    final_topology_gate = generated.get("final_topology_gate")
    final_topology_unverified = (
        not isinstance(final_topology_gate, dict)
        or not isinstance(final_topology_gate.get("passed_clean"), bool)
    )
    final_topology_failed = (
        isinstance(final_topology_gate, dict)
        and final_topology_gate.get("passed_clean") is False
    )
    # Master/derivative gate is a real outcome: a failed drift gate (or an
    # unusable gate metric) must degrade the result, never pass silently.
    master_quality_gate = (
        master_quality_report.get("quality_gate")
        if isinstance(master_quality_report, dict)
        else None
    )
    master_drift_unverified = (
        not isinstance(master_quality_gate, dict)
        or master_quality_gate.get("status") != "ok"
        or not isinstance(master_quality_gate.get("passed"), bool)
    )
    master_drift_failed = (
        master_drift_unverified
        or master_quality_gate.get("passed") is False
    )
    result["production_status"] = (
        "failed"
        if required_failed
        else "degraded"
        if any_failed or quality_failed or lod_failed or final_topology_unverified or final_topology_failed or master_drift_failed or retopo_skipped_native or pbr_validation_failed or bake_degraded or collision_fallback_used
        else "ready"
    )
    degraded_reasons = []
    if quality_failed:
        degraded_reasons.append("final_quality_gate_failed")
    if final_topology_failed:
        degraded_reasons.append("final_topology_gate_failed")
    elif final_topology_unverified:
        degraded_reasons.append("final_topology_gate_unverified")
    if lod_failed:
        degraded_reasons.append("lod_validation_failed")
    if texture_failed and texture_enabled:
        degraded_reasons.append("texture_generation_failed")
    if bake_failed and (bake_requested or generated.get("bake_requested")):
        degraded_reasons.append("bake_failed")
    if bake_degraded:
        degraded_reasons.append("bake_incomplete")
    if pbr_validation_failed:
        degraded_reasons.append("pbr_validation_failed")
    if collision_failed and physics_enabled:
        degraded_reasons.append("collision_generation_failed")
    if collision_fallback_used:
        degraded_reasons.append("collision_fallback_used")
    if retopo_skipped_native and retopo_requested:
        degraded_reasons.append("quad_topology_unsupported_native_textures")
    if master_drift_failed:
        if master_drift_unverified:
            degraded_reasons.append("master_to_derivative_quality_unverified")
        else:
            degraded_reasons.append("master_to_derivative_quality_drift")
    if degraded_reasons:
        result["degraded_reasons"] = degraded_reasons

    postprocess_status_map = {
        "ready": "completed",
        "degraded": "degraded",
        "failed": "failed",
    }
    result["postprocess_status"] = postprocess_status_map.get(result["production_status"], "completed")
    return result


def _enforce_mesh_limits(mesh: trimesh.Trimesh, model_id: str) -> trimesh.Trimesh:
    """Decimate mesh if it exceeds per-model vertex/face caps from quality.yaml mesh.limits.
    Also applies hole repair, winding fix, normal fix, and Taubin smoothing.

    Runs ONCE after adapter extraction, BEFORE saving to master/source.glb.
    After this, master/source.glb is immutable and never touched again.
    """
    cfg = get_quality_config()
    mesh_cfg = cfg.get("mesh", {})

    max_vertices = int(mesh_cfg.get("max_vertices_per_mesh", 500000))
    max_faces = int(mesh_cfg.get("max_faces_per_mesh", 1000000))
    crease_angle = float(
        mesh_cfg.get("shared", {}).get("feature_edge_angle_deg", 35.0)
    )

    original_vertices = len(mesh.vertices)
    original_faces = len(mesh.faces)

    # Repair: fill holes, fix winding, fix normals — applies to every adapter output
    try:
        trimesh.repair.fill_holes(mesh)
        trimesh.repair.fix_winding(mesh)
        trimesh.repair.fix_normals(mesh)
        trimesh.smoothing.filter_taubin(mesh, lamb=0.3, nu=-0.34, iterations=4)
    except Exception as _t_repair_err:
        logger.warning("[RAW SOURCE] Mesh repair failed for %s: %s", model_id, _t_repair_err)

    # Re-measure after repair (hole fill can add faces)
    original_vertices = len(mesh.vertices)
    original_faces = len(mesh.faces)

    if original_vertices <= max_vertices and original_faces <= max_faces:
        return mesh  # Within caps — no decimation needed

    # Decimate to stay under caps, protecting crease edges
    target_faces = min(original_faces, max_faces)

    mesh = memory_safe_decimate(
        mesh,
        target_faces=target_faces,
        max_deviation_deg=45.0,
        crease_angle_deg=crease_angle,
        max_ram_fraction=0.80,
    )

    logger.warning(
        "[RAW SOURCE] Enforced mesh size cap: %s mesh %d verts -> %d verts, "
        "%d faces -> %d faces (cap: %d verts / %d faces)",
        model_id,
        original_vertices,
        len(mesh.vertices),
        original_faces,
        len(mesh.faces),
        max_vertices,
        max_faces,
    )

    return mesh


def run_postprocess_job(
    job_id: str,
    generation_result: Dict[str, Any],
    job_inputs: Optional[Dict[str, Any]] = None,
    job_metadata: Optional[Dict[str, Any]] = None,
    progress: GenerationProgress = None,
    cancel_checker: CancelChecker = None,
) -> Dict[str, Any]:
    """Create the canonical asset workspace and run production post-processing."""
    _check_cancelled(cancel_checker)
    job_inputs = job_inputs or {}
    job_metadata = job_metadata or {}
    quality_mode = str(job_inputs.get("quality") or job_inputs.get("meshQuality") or "high").lower()
    explicit_texture_resolution = job_inputs.get("production_texture_resolution", job_inputs.get("texture_resolution"))
    default_texture_resolution = {
        "low": 512,
        "medium": 1024,
        "high": 2048,
        "ultra": 4096,
        "8k": 8192,
        "cinematic": 8192,
    }.get(quality_mode, 2048)
    preset_input = (
        job_inputs.get("texture_resolution")
        or job_inputs.get("paint_resolution")
        or job_inputs.get("resolution")
        or job_metadata.get("texture_resolution")
        or explicit_texture_resolution
        or default_texture_resolution
    )
    preset_label, target_atlas_size = resolve_texture_preset(preset_input)
    try:
        texture_resolution = int(explicit_texture_resolution or default_texture_resolution)
    except (TypeError, ValueError):
        texture_resolution = default_texture_resolution
    if preset_label == "8K" or target_atlas_size >= 8192:
        texture_resolution = max(texture_resolution, target_atlas_size)
    uv_resolution = max(512, min(8192, texture_resolution))
    texture_resolution = uv_resolution

    texture_enabled = bool(
        job_inputs.get("texture_enabled")
        or job_metadata.get("texture_enabled")
        or job_inputs.get("generateTexture")
        or job_metadata.get("generateTexture")
        or job_inputs.get("generate_texture")
        or job_metadata.get("generate_texture")
        or job_inputs.get("auto_paint")
        or job_metadata.get("auto_paint")
    )

    cpu_threads = int(job_inputs.get("cpu_threads") or cpu_count())
    configure_cpu_runtime(cpu_threads)
    raw_target_polycount = job_inputs.get("target_polycount")
    try:
        parsed_target_polycount = int(raw_target_polycount) if raw_target_polycount is not None else None
    except (TypeError, ValueError):
        parsed_target_polycount = None

    resolved_target_polycount = _resolve_target_polycount(parsed_target_polycount)

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
    master_refreshed, master_source_sha256 = _ensure_master_source(raw_path, master_path)
    if master_refreshed:
        logger.info(
            "[RAW SOURCE] Created/refreshed master/source.glb after SHA-256 identity comparison."
        )

    # Enforce raw mesh size cap — NO model may exceed 500K vertices / 1M faces
    # in the immutable master. Decimate post-extraction if the adapter produced
    # an oversized mesh (e.g. TripoSG ~3.4M vertices).
    _raw_mesh = load_mesh(str(raw_path), Path(raw_path).name)
    _enforced_mesh = _enforce_mesh_limits(_raw_mesh, job_inputs.get("model_preference", "unknown"))
    if len(_enforced_mesh.vertices) < len(_raw_mesh.vertices) or len(_enforced_mesh.faces) < len(
        _raw_mesh.faces
    ):
        _enforced_mesh.export(str(master_path))
        master_source_sha256 = sha256_file(master_path)
        logger.info(
            "[RAW SOURCE] Mesh size cap enforced and saved to master/source.glb: "
            "%d verts -> %d verts, %d faces -> %d faces",
            len(_raw_mesh.vertices),
            len(_enforced_mesh.vertices),
            len(_raw_mesh.faces),
            len(_enforced_mesh.faces),
        )

    asset_manifest = metadata_dir / "asset.json"
    if (
        not master_refreshed
        and asset_manifest.exists()
        and (game_ready_dir / f"{base_name}.glb").exists()
    ):
        try:
            saved = json.loads(asset_manifest.read_text(encoding="utf-8"))
            saved_texture_status = saved.get("texture_stage", {}).get("status")
            if not texture_enabled or saved_texture_status == "completed":
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
            else:
                logger.info("[POSTPROCESS] Existing raw mesh found; proceeding with requested texture stage for %s", job_id)
        except Exception:
            logger.warning("Corrupt asset.json for %s, discarding and rebuilding.", job_id)

    pipeline_start_time = time.time()
    feature_type = str(job_metadata.get("feature") or job_inputs.get("feature") or "")
    is_quad_requested = (
        job_metadata.get("topology_mode") == "quad"
        or job_inputs.get("topology_mode") == "quad"
        or bool(job_metadata.get("quad_topology"))
        or bool(job_inputs.get("quad_topology"))
    )
    auto_optimize = _should_auto_optimize(job_inputs.get("auto_optimize", False), resolved_target_polycount)
    auto_uv_input = job_inputs.get("auto_uv")
    if auto_uv_input is None:
        auto_uv_input = job_metadata.get("auto_uv")
    if auto_uv_input is not None:
        auto_uv = bool(auto_uv_input) if not isinstance(auto_uv_input, str) else auto_uv_input.lower() not in {"false", "0", "no"}
    else:
        auto_uv = True
    quad_source_mesh: Optional[trimesh.Trimesh] = None
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
                ("Auto-UV", auto_uv),
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
    source_sha256 = master_source_sha256
    generation_info = generation_result.get("generation_info")
    if not isinstance(generation_info, dict):
        generation_info = {}
    raw_geometry_telemetry = generation_info.get("raw_geometry_telemetry")
    if not isinstance(raw_geometry_telemetry, dict):
        raw_geometry_telemetry = {}
    adapter_output_sha256 = raw_geometry_telemetry.get("raw_mesh_sha256")
    native_textures = _has_native_textures_scene(raw_bytes, master_path.name)
    mesh = load_mesh(raw_bytes, master_path.name)
    raw_master_identity_matches = (
        bool(adapter_output_sha256 and adapter_output_sha256 == source_sha256)
        if adapter_output_sha256 else None
    )
    if raw_master_identity_matches is False:
        logger.error(
            "Raw adapter output hash does not match canonical master for job %s: adapter=%s master=%s",
            job_id, adapter_output_sha256, source_sha256,
        )
    quality_trace = {
        "source": {
            **mesh_stats(mesh).model_dump(),
            "native_textures": native_textures,
        },
        "source_identity": {
            "adapter_output_sha256": adapter_output_sha256,
            "canonical_master_sha256": source_sha256,
            "canonical_master_path": str(master_path),
            "adapter_output_matches_master": raw_master_identity_matches,
            "status": (
                "verified_match" if raw_master_identity_matches is True
                else "hash_mismatch" if raw_master_identity_matches is False
                else "adapter_hash_unavailable"
            ),
        },
        "raw_generation": {
            "model_id": generation_info.get("model"),
            "geometry_extractor": generation_info.get("geometry_extractor"),
            "requested_geometry_resolution": generation_info.get("requested_geometry_resolution"),
            "geometry_extraction_grid_resolution": generation_info.get("geometry_extraction_grid_resolution"),
            "effective_geometry_resolution": generation_info.get("effective_geometry_resolution"),
            "geometry_resolution_limited": generation_info.get("geometry_resolution_limited", False),
            "geometry_quality_warning": generation_info.get("geometry_quality_warning"),
            "raw_geometry_telemetry": raw_geometry_telemetry,
        },
    }
    plan_dict = job_inputs.get("plan") or job_metadata.get("plan") or generation_info.get("plan") or {}
    quality_trace["plan"] = {
        "adapter": plan_dict.get("adapter"),
        "preset": plan_dict.get("preset"),
        "num_seeds": plan_dict.get("num_seeds"),
        "fallback_chain": plan_dict.get("fallback_chain") or job_inputs.get("fallback_chain") or job_metadata.get("fallback_chain") or [],
        "reasons": plan_dict.get("reasons", []),
        "warnings": plan_dict.get("warnings", []),
        "would_have_chosen": plan_dict.get("would_have_chosen"),
    }
    quality_trace["seed_scores"] = (
        generation_info.get("seed_scores")
        or generation_result.get("seed_scores")
        or []
    )

    inspect_t0 = time.time()
    _check_cancelled(cancel_checker)
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

    _check_cancelled(cancel_checker)
    repair_t0 = time.time()
    _emit(progress, 0.18, "repair", "Checking topology and applying enabled repairs.")
    repair_opts = RepairOptions(
        method="remove",
        preserve_uv=True,
        close_holes=True,
        max_hole_size=int(get_quality_config()["holes"]["max_hole_vertices"]),
        weld=True,
    )
    source_topology = topology_counts(mesh.vertices, mesh.faces)
    gate_eval = evaluate_topology_gate(
        mesh=mesh.copy(),
        plan=generation_result.get("plan") or job_inputs.get("plan"),
        strict=bool(job_inputs.get("strict_topology_gate", False)),
    )
    quality_trace["topology_gate"] = gate_eval
    gate_repair_decision = gate_eval.get("repair_decision", "full_repair")
    gate_skip_retopo = gate_eval.get("skip_retopo", False)

    if gate_repair_decision == "skip_repair":
        repaired = mesh.copy()
        repair_stats = {
            "before": source_topology,
            "after": source_topology.copy(),
            "removed_faces": 0,
            "method": "gate_skipped_clean",
            "preserve_uv": True,
            "uv_preserved": bool(getattr(getattr(mesh, "visual", None), "uv", None) is not None),
            "skipped": True,
            "reason": "Topology gate evaluated mesh as clean; structural repair skipped.",
            "gate_report": gate_eval,
        }
    elif gate_repair_decision == "minimal_repair" and printability_auto_repair:
        repaired, hole_stats = repair_holes_targeted(
            mesh.copy(),
            max_hole_vertices=int(get_quality_config()["holes"]["max_hole_vertices"]),
            max_hole_perimeter=float(get_quality_config()["holes"]["max_hole_perimeter"]),
        )
        repair_stats = {
            "before": source_topology,
            "after": topology_counts(repaired.vertices, repaired.faces),
            "method": "minimal_hole_repair",
            "hole_stats": hole_stats,
            "preserve_uv": True,
            "uv_preserved": bool(getattr(getattr(repaired, "visual", None), "uv", None) is not None),
            "skipped": False,
            "gate_report": gate_eval,
        }
    elif gate_repair_decision == "minimal_repair":
        repaired = mesh.copy()
        repair_stats = {
            "before": source_topology,
            "after": source_topology.copy(),
            "removed_faces": 0,
            "method": "skipped_auto_repair_disabled",
            "preserve_uv": True,
            "uv_preserved": bool(getattr(getattr(mesh, "visual", None), "uv", None) is not None),
            "skipped": True,
            "reason": "Automatic repair is disabled; source geometry was preserved as a copy.",
            "gate_report": gate_eval,
        }
    elif _should_run_structural_repair(source_topology, printability_auto_repair):
        repaired, repair_stats, _ = run_repair(mesh, repair_opts)
        repair_stats["gate_report"] = gate_eval
    else:
        repaired = mesh.copy()
        repair_stats = {
            "before": source_topology,
            "after": source_topology.copy(),
            "removed_faces": 0,
            "method": "skipped_healthy" if source_topology.get("watertight") and source_topology.get("non_manifold_edges", 0) == 0 else "skipped_native_preservation",
            "preserve_uv": True,
            "uv_preserved": bool(getattr(getattr(mesh, "visual", None), "uv", None) is not None),
            "skipped": True,
            "reason": (
                "Automatic repair is disabled; source geometry was preserved as a copy."
                if not printability_auto_repair
                else "Source mesh already passes manifold/watertight topology checks."
            ),
            "gate_report": gate_eval,
        }
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
                (
                    "Operations",
                    repair_stats.get("reason")
                    if repair_stats.get("skipped")
                    else f"Weld coincident verts, remove non-manifold, close holes (<= {repair_opts.max_hole_size})",
                ),
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

    _check_cancelled(cancel_checker)
    retopo_t0 = time.time()
    if is_quad_requested:
        _emit(progress, 0.24, "retopo", "Running auto-retopology for quad-dominant mesh.")
        source_face_count = min(5_000_000, max(50, int(len(repaired.faces))))
        retopo_target = min(
            source_face_count,
            resolved_target_polycount if resolved_target_polycount > 0 else source_face_count,
        )
        try:
            repaired, retopo_tool_stats, _ = run_auto_retopo(
                repaired,
                AutoRetopoOptions(
                    target_faces=retopo_target,
                    quads=True,
                    # Use the source surface for already-closed meshes; a low-res voxel shell
                    # rounds genuine edges. Only open/defective inputs need shell reconstruction.
                    watertight=not bool(repaired_topology.get("watertight", False)),
                    shell_smooth=0.25,
                    shell_taubin=1,
                    adaptive=True,
                    preserve_features=True,
                    feature_angle=25.0,
                    project=True,
                ),
                progress=lambda stage, frac, msg: (
                    _emit(progress, 0.24 + min(1.0, max(0.0, frac)) * 0.05, "retopo", msg),
                    logger.debug(f"[POSTPROCESS RETOPO] {frac*100:.0f}% stage={stage} msg={msg}"),
                ),
                cancel_checker=cancel_checker,
            )
            retopo_stats = {"status": "completed", "trigger": "quad_requested", **retopo_tool_stats}
            if retopo_stats.get("quad_faces"):
                quad_source_mesh = repaired.copy()
        except Exception as exc:
            retopo_stats = {"status": "failed", "trigger": "quad_requested", "error": str(exc)}
            logger.warning("Quad AutoRetopo failed for %s; retaining repaired geometry: %s", job_id, exc)
    elif printability_auto_repair and solid_generation_feature and not native_textures and not repaired_topology.get("watertight", True) and large_open_defect:
        _emit(progress, 0.24, "retopo", "Rebuilding topology for a large structural defect.")
        retopo_target = min(resolved_target_polycount or 6_000, max(50, int(len(repaired.faces))))
        try:
            repaired, retopo_tool_stats, _ = run_auto_retopo(
                repaired,
                AutoRetopoOptions(target_faces=retopo_target, watertight=True, shell_smooth=0.25,
                                  shell_taubin=1, adaptive=True, preserve_features=True,
                                  feature_angle=25.0, project=True),
                progress=lambda stage, frac, msg: (
                    _emit(progress, 0.24 + min(1.0, max(0.0, frac)) * 0.05, "retopo", msg),
                    logger.debug(f"[POSTPROCESS RETOPO] {frac*100:.0f}% stage={stage} msg={msg}"),
                ),
                cancel_checker=cancel_checker,
            )
            retopo_stats = {"status": "completed", "trigger": "large_open_defect", **retopo_tool_stats}
        except Exception as exc:
            retopo_stats = {"status": "failed", "trigger": "large_open_defect", "error": str(exc)}
            logger.warning("Conditional AutoRetopo failed for %s; retaining repaired geometry: %s", job_id, exc)
    elif gate_skip_retopo and not is_quad_requested:
        retopo_stats = {"status": "skipped", "reason": "Topology gate evaluated mesh as clean; retopology bypassed."}
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
    _check_cancelled(cancel_checker)
    if _should_run_feature_remesh(
        quality_mode=quality_mode,
        solid_generation_feature=solid_generation_feature,
        native_textures=native_textures,
        retopo_status=str(retopo_stats.get("status", "skipped")),
        target_polycount=parsed_target_polycount,
    ):
        try:
            remesh_target = resolved_target_polycount or MAX_PRODUCTION_FACES
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
                cancel_checker=cancel_checker,
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

    _check_cancelled(cancel_checker)
    _emit(progress, 0.30, "optimize", "Optimizing game-ready triangle budget.")
    optimize_t0 = time.time()
    auto_optimize = _should_auto_optimize(job_inputs.get("auto_optimize", False), resolved_target_polycount)
    has_explicit_target = resolved_target_polycount > 0
    repaired_face_count = len(repaired.faces)

    if is_quad_requested and retopo_stats.get("status") == "completed":
        optimized = repaired
        optimize_stats = {"passthrough": True, "reason": "Quad-dominant topology preserved from retopology pass"}
    elif not auto_optimize and not has_explicit_target:
        # Native/raw resolution requested without auto-decimation
        optimized = repaired
        optimize_stats = {"passthrough": True, "reason": "Native resolution preserved (auto_optimize is false and no target_polycount specified)"}
    else:
        target_faces = resolved_target_polycount or MAX_PRODUCTION_FACES
        if repaired_face_count <= target_faces and not auto_optimize:
            optimized = repaired
            optimize_stats = {"passthrough": True, "reason": f"Repaired mesh face count ({repaired_face_count}) already within target ({target_faces})"}
        elif repaired_face_count > int(get_quality_config()["limits"]["memory_safe_dispatch_triangles"]):
            optimized, mem_stats = memory_safe_decimate(repaired.copy(), target_faces=target_faces)
            optimize_stats = {"passthrough": False, "method": "memory_safe_decimate", **mem_stats}
        else:
            optimized, optimize_stats = run_optimize(
                repaired,
                OptimizeOptions(target_faces=target_faces, simplify_error=0.05, allow_seam_breaking=False,
                                permissive=False, aggressive=False, lock_border=False),
                cancel_checker=cancel_checker,
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

    _check_cancelled(cancel_checker)
    uv_t0 = time.time()
    retopo_ran = retopo_stats.get("status") == "completed"

    if native_textures and not retopo_ran and _has_uvs(optimized):
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
    elif not auto_uv and not (native_textures and retopo_ran):
        # Preserve watertightness / native state: when auto_uv is False (and retopo did not discard UVs on a textured mesh),
        # skip UV unwrapping so vertices are not split along seams and native vertex colors/geometry are preserved.
        uv_mesh = optimized
        uv_stats = {
            "status": "skipped",
            "auto_uv": False,
            "native_textures": bool(native_textures),
            "reason": "auto_uv disabled; UV unwrapping skipped",
        }
        uv_duration = time.time() - uv_t0
        logger.info(
            "\n" + format_box(
                "POSTPROCESS: STAGE 5/8 - UV PARAMETERIZATION",
                [
                    ("Status", "Skipped (auto_uv=False)"),
                    ("Watertight Preserved", True),
                    ("Reason", "auto_uv disabled; seam vertex splitting skipped"),
                    ("Stage Elapsed", f"{uv_duration:.2f}s"),
                ],
            )
        )
    else:
        if native_textures and retopo_ran:
            _emit(progress, 0.55, "uv", "Generating UVs for retopologized mesh (native textures require bake mapping).")
            logger.info("Quad retopology rebuilt topology without UVs on native-textured mesh; generating UVs for baking.")
        else:
            _emit(progress, 0.55, "uv", "Generating production UVs.")
        optimized_normals = np.asarray(optimized.vertex_normals)
        plan_uv_backend = (generation_result.get("plan") or job_inputs.get("plan") or {}).get("uv_backend", "auto")
        try:
            uv_mesh, uv_unwrap_stats = execute_uv_unwrap(optimized.copy(), backend=plan_uv_backend)
            uv_stats = {"status": "completed", **uv_unwrap_stats}
        except Exception as uv_err:
            logger.warning("execute_uv_unwrap failed (%s), falling back to run_auto_uv", uv_err)
            uv_mesh, uv_stats, _ = run_auto_uv(
                optimized,
                AutoUvOptions(resolution=texture_resolution, padding_texels=4, refine=True, weld=True,
                              preserve_normals=True, normal_smooth_deg=60),
                source_normals=optimized_normals,
                cancel_checker=cancel_checker,
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
    artifact_errors: Dict[str, str] = {}
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

    _check_cancelled(cancel_checker)
    bake_t0 = time.time()
    if should_bake:
        # If quad retopology ran on a native-textured mesh, ensure UVs exist or run auto_uv before baking
        # to prevent Blender 'No UV map on active object' errors.
        if not _has_uvs(uv_mesh):
            logger.info("Target mesh lacks UVs before bake; running auto_uv to ensure UV map exists.")
            _emit(progress, 0.56, "uv", "Generating required UV map for texture bake.")
            uv_mesh_normals = np.asarray(uv_mesh.vertex_normals)
            uv_mesh, uv_bake_stats, _ = run_auto_uv(
                uv_mesh,
                AutoUvOptions(
                    resolution=texture_resolution,
                    padding_texels=4,
                    refine=True,
                    weld=True,
                    preserve_normals=True,
                    normal_smooth_deg=60,
                ),
                source_normals=uv_mesh_normals,
                cancel_checker=cancel_checker,
            )
        _emit(progress, 0.58, "bake", "Baking high-to-low micro-details and normal maps.")
        try:
            from .services.bake import run_bake
            from .schemas import BakeOptions

            bake_res = max(texture_resolution, target_atlas_size) if (preset_label == "8K" or target_atlas_size >= 8192) else texture_resolution
            maps_to_bake = ["normal", "ao"]
            if native_textures:
                maps_to_bake.extend(["base_color", "roughness", "metallic"])

            bake_cfg = get_quality_config().get("bake", {})
            bake_opts = BakeOptions(
                resolution=bake_res,
                maps=maps_to_bake,
                cage_extrusion=float(bake_cfg.get("cage_extrusion", 0.02)),
                max_ray_distance=float(bake_cfg.get("max_ray_distance", 0.05)),
                margin=int(bake_cfg.get("gutter_dilation_pixels", 4)),
                normal_space=str(bake_cfg.get("normal_space", "TANGENT")),
                convention=str(bake_cfg.get("convention", "OPENGL")),
            )
            low_glb_bytes = _export_glb(uv_mesh)
            baked_images, worker_stats = run_bake(
                low_glb=low_glb_bytes,
                high_glb=raw_bytes,
                opts=bake_opts,
                progress=lambda stage, frac, msg: (
                    _emit(progress, 0.58 + min(1.0, max(0.0, frac)) * 0.04, "bake", msg),
                    logger.debug(f"[POSTPROCESS BAKE] {frac*100:.0f}% stage={stage} msg={msg}"),
                ),
                cancel_checker=cancel_checker,
            )
            texture_dir.mkdir(parents=True, exist_ok=True)
            for map_name, img_bytes in baked_images.items():
                target_img_path = texture_dir / f"{map_name}.png"
                target_img_path.write_bytes(img_bytes)
                texture_paths[map_name] = str(target_img_path)
            required_bake_maps = set(maps_to_bake)
            if len(required_bake_maps.intersection({"ao", "roughness", "metallic"})) >= 2:
                required_bake_maps.add("orm")
            missing_bake_maps = sorted(required_bake_maps - set(baked_images))
            bake_stats = {
                "status": "degraded" if missing_bake_maps else "completed",
                **worker_stats,
            }
            if missing_bake_maps:
                bake_stats["missing_requested_maps"] = missing_bake_maps
                bake_stats["reason"] = (
                    "The active bake backend did not produce all requested maps: "
                    + ", ".join(missing_bake_maps)
                )
                artifact_errors["bake"] = bake_stats["reason"]
                logger.warning("%s", bake_stats["reason"])
            texture_status = "baked"

            # Attach only maps that were genuinely baked. Keep native material
            # channels when a fallback backend cannot bake albedo/ORM for them.
            if "normal" in baked_images:
                try:
                    norm_img = Image.open(io.BytesIO(baked_images["normal"]))
                    base_img = Image.open(io.BytesIO(baked_images["base_color"])) if "base_color" in baked_images else None
                    orm_img = Image.open(io.BytesIO(baked_images["orm"])) if "orm" in baked_images else None
                    ao_img = Image.open(io.BytesIO(baked_images["ao"])) if "ao" in baked_images else None
                    uvs = getattr(getattr(uv_mesh, "visual", None), "uv", None)
                    existing_material = getattr(getattr(uv_mesh, "visual", None), "material", None)

                    if native_textures and base_img is None and isinstance(
                        existing_material, trimesh.visual.material.PBRMaterial
                    ):
                        # Native PBR data is authoritative when the fallback cannot bake semantic maps.
                        pbr_mat = existing_material
                        pbr_mat.normalTexture = norm_img
                        if orm_img is not None:
                            pbr_mat.metallicRoughnessTexture = orm_img
                        pbr_mat.occlusionTexture = orm_img if orm_img is not None else ao_img
                    elif native_textures and base_img is None and existing_material is not None:
                        # Do not replace a non-PBR material with fake flat maps.
                        logger.warning(
                            "Preserving native material: the active baker did not produce a baked base-color map."
                        )
                        pbr_mat = None
                    else:
                        base_factor = [1.0, 1.0, 1.0, 1.0] if base_img is not None else [0.82, 0.82, 0.82, 1.0]
                        pbr_mat = trimesh.visual.material.PBRMaterial(
                            name="GameReady_PBR",
                            normalTexture=norm_img,
                            baseColorTexture=base_img,
                            baseColorFactor=base_factor,
                            metallicRoughnessTexture=orm_img,
                            metallicFactor=0.0 if orm_img is None else 1.0,
                            roughnessFactor=0.7 if orm_img is None else 1.0,
                            occlusionTexture=orm_img if orm_img is not None else ao_img,
                        )
                    if uvs is not None and pbr_mat is not None:
                        uv_mesh.visual = trimesh.visual.TextureVisuals(uv=uvs, material=pbr_mat)
                except Exception as mat_err:
                    logger.warning("Could not attach baked textures to GLB material: %s", mat_err)
        except Exception as exc:
            bake_stats = {"status": "failed", "error": str(exc), "reason": f"Bake failed: {exc}"}
            artifact_errors["bake"] = str(exc)
            logger.warning("Bake step failed: %s", exc)
        finally:
            _clear_gpu_cache()
    bake_duration = time.time() - bake_t0

    # Compare every optimized derivative against the immutable master.
    # Without ground truth this is a degradation diagnostic, not an absolute quality score.
    master_quality_report: Dict[str, Any] = {"status": "skipped", "reason": "quality comparison unavailable"}
    try:
        master_quality_report = compare_meshes(
            mesh,
            uv_mesh,
            seed=1,
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
                    ("Status", "Failed" if bake_stats.get("status") == "failed" else "Skipped"),
                    ("Reason", bake_stats.get("reason", "Bake not requested")),
                    ("Stage Elapsed", f"{bake_duration:.2f}s"),
                ],
            )
        )



    game_ready_dir.mkdir(parents=True, exist_ok=True)
    base_name = f"{asset_name}_{clean_job_id}"
    game_ready: Dict[str, str] = {}
    glb_path = game_ready_dir / f"{base_name}.glb"

    # Centralized Texture Stage
    _check_cancelled(cancel_checker)
    texture_stage_info: Dict[str, Any] = {"status": "skipped"}
    if not texture_enabled:
        texture_stage_info = {
            "status": "skipped",
            "reason": "Textured generation not requested",
        }
        logger.info("[POSTPROCESS TEXTURE] Stage skipped: textured generation not requested")
    else:
        _save_file(glb_path, _export_glb(uv_mesh))
        painter_display = (
            "trellis2_paint"
            if str(
                job_inputs.get("paint_model_preference")
                or job_inputs.get("paint_model")
                or job_metadata.get("paint_model_preference")
                or job_metadata.get("paint_model")
                or ""
            ).strip().lower() in {"trellis2", "trellis2_paint", "trellis2_image_mesh_painting"}
            else ("paint3d" if preset_label in {"1K", "2K"} else "hunyuan3d_paint_v21")
        )
        _emit(progress, 0.65, "texture", f"Generating {preset_label} textures with {painter_display}...")
        texture_stage_info = _execute_texture_stage(
            job_id=job_id,
            asset_dir=asset_dir,
            base_name=base_name,
            target_mesh_path=glb_path,
            job_inputs=job_inputs,
            job_metadata=job_metadata,
            preset_label=preset_label,
            target_atlas_size=target_atlas_size,
            cancel_checker=cancel_checker,
            progress=progress,
        )
        if texture_stage_info.get("status") == "completed":
            texture_status = "completed"
            for k, v in texture_stage_info.get("texture_maps", {}).items():
                texture_paths[k] = v
        elif texture_stage_info.get("status") == "failed":
            texture_status = "failed"
            artifact_errors["texture"] = texture_stage_info.get("error", "Texture generation failed")
        _clear_gpu_cache()

    # Determine game-ready mesh for downstream production exports (GLB, FBX, LOD chain)
    is_raw_native_passthrough = (
        resolved_target_polycount == 0
        and not auto_optimize
        and not is_quad_requested
        and texture_stage_info.get("status") != "completed"
    )

    if texture_stage_info.get("status") == "completed" and texture_stage_info.get("textured_glb"):
        textured_glb_path = Path(texture_stage_info["textured_glb"])
        if textured_glb_path.exists():
            game_ready_mesh = load_mesh(textured_glb_path.read_bytes(), textured_glb_path.name)
        else:
            game_ready_mesh = uv_mesh
    elif is_raw_native_passthrough:
        logger.info(
            "[RAW PASSTHROUGH] Native resolution preserved byte-for-byte from master/source.glb with optimal normals (no decimation)."
        )
        if master_path.exists() and str(master_path).lower().endswith(".glb") and master_path.stat().st_size > 0:
            game_ready_glb_bytes = master_path.read_bytes()
            game_ready_mesh = load_mesh(game_ready_glb_bytes, master_path.name)
        else:
            game_ready_mesh = apply_angle_weighted_normals(repaired if repaired is not None else mesh, crease_angle_deg=35.0)
            game_ready_glb_bytes = _export_glb(game_ready_mesh)
    else:
        game_ready_mesh = uv_mesh

    _check_cancelled(cancel_checker)
    _emit(progress, 0.62, "game_ready", "Writing game-ready formats.")
    if not is_raw_native_passthrough:
        if texture_stage_info.get("status") == "completed" and texture_stage_info.get("textured_glb"):
            textured_source_path = Path(texture_stage_info["textured_glb"])
            if not textured_source_path.is_file():
                raise FileNotFoundError(
                    f"Validated textured GLB disappeared before final export: {textured_source_path}"
                )
            # load_mesh() flattens GLB scenes for geometric metrics/LODs. Do not
            # re-export that flattened Trimesh: it can discard per-node materials,
            # UV assignments, and embedded texture bindings from the painter output.
            game_ready_glb_bytes = textured_source_path.read_bytes()
        else:
            game_ready_glb_bytes = _export_glb(game_ready_mesh)
    _save_file(glb_path, game_ready_glb_bytes)
    game_ready["glb"] = str(glb_path)
    pbr_validation_required = bool(texture_enabled or native_textures or should_bake)
    pbr_report = _run_pbr_validation(glb_path, required=pbr_validation_required)
    quality_trace["pbr_validation"] = pbr_report

    if retopo_stats.get("quad_faces"):
        try:
            quad_export_mesh = quad_source_mesh if quad_source_mesh is not None else game_ready_mesh
            obj_bytes = _export_quad_obj(quad_export_mesh, retopo_stats["quad_faces"])
            obj_path = game_ready_dir / f"{base_name}.obj"
            _save_file(obj_path, obj_bytes)
            game_ready["obj"] = str(obj_path)
            game_ready["quad_obj"] = str(obj_path)
            logger.info("Exported quad OBJ: %s (%s)", obj_path, format_bytes(len(obj_bytes)))
        except Exception as exc:
            artifact_errors["obj"] = str(exc)
            artifact_errors["quad_obj"] = str(exc)
            logger.warning("Quad OBJ export failed: %s", exc)

    try:
        fbx_bytes, _ = run_convert_fbx(
            game_ready_glb_bytes,
            ConvertOptions(preset="generic", bake_fps=30, anim_simplify=1.0),
            progress=lambda stage, frac, msg: _emit(
                progress, 0.62 + (min(1.0, max(0.0, frac)) * 0.04), "fbx", msg
            ),
            cancel_checker=cancel_checker,
        )
        fbx_path = game_ready_dir / f"{base_name}.fbx"
        fbx_path.write_bytes(fbx_bytes)
        game_ready["fbx"] = str(fbx_path)
    except Exception as exc:
        artifact_errors["fbx"] = str(exc)
        logger.warning("FBX export failed: %s", exc)

    _check_cancelled(cancel_checker)
    lods: Dict[int, str] = {}
    lod_quality: Dict[str, Dict[str, Any]] = {}
    lod_enabled = bool(job_inputs.get("generateLOD", True))
    lod_t0 = time.time()
    if lod_enabled:
        _emit(progress, 0.72, "lod", "Generating LOD chain.")
        lod_dir.mkdir(parents=True, exist_ok=True)
        source_faces = max(1, len(game_ready_mesh.faces))
        target_faces = resolved_target_polycount or source_faces
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
        lod_levels = run_lods(game_ready_mesh, LODOptions(ratios=list(lod_ratios[:lod_count])), cancel_checker=cancel_checker)
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
    lod_validation = _validate_lod_chain(lod_levels, game_ready_mesh)
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

    _check_cancelled(cancel_checker)
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
                cancel_checker=cancel_checker,
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
        except InterruptedError:
            raise
        except Exception as exc:
            logger.warning("Collision generation failed for %s, falling back to simple convex hull: %s", job_id, exc)
            try:
                hull = game_ready_mesh.convex_hull
                collision_scene = trimesh.Scene(hull)
                collision_payload = collision_scene.export(file_type="glb")
                if isinstance(collision_payload, str):
                    collision_payload = collision_payload.encode("utf-8")
                collision_path = collision_dir / "collision.glb"
                collision_path.write_bytes(collision_payload)
                collision_stats = {
                    "method": "convex_hull",
                    "parts": 1,
                    "faces": int(len(getattr(hull, "faces", []))),
                    "vertices": int(len(getattr(hull, "vertices", []))),
                    "source_faces": int(len(game_ready_mesh.faces)),
                    "fallback": True,
                    "fallback_reason": str(exc),
                }
                physics_metadata = build_physics_metadata(game_ready_mesh, physics_config, collision_stats)
                _write_json(metadata_dir / "physics.json", physics_metadata)
            except Exception as inner_exc:
                logger.error("Collision fallback failed: %s", inner_exc)
                artifact_errors["collision"] = str(inner_exc)
        if collision_path is None or not collision_path.exists():
            artifact_errors.setdefault("collision", "Collision proxy generation failed")
    collision_duration = time.time() - collision_t0

    if physics_enabled and collision_path and collision_path.exists():
        logger.info(
            "\n" + format_box(
                "POSTPROCESS: STAGE 8/8 - PHYSICS & COLLISION PROXY",
                [
                    ("Quality Preset", collision_quality),
                    ("Convex Hulls", collision_stats.get("parts", "N/A") if collision_stats else "N/A"),
                    ("Collision Triangles", collision_stats.get("faces", "N/A") if collision_stats else "N/A"),
                    ("Proxy File", f"{collision_path} ({format_bytes(collision_path.stat().st_size)})"),
                    ("Body Mass", physics_metadata.get("body", {}).get("mass_kg", "N/A") if physics_metadata else "N/A"),
                    ("Stage Elapsed", f"{collision_duration:.2f}s"),
                ],
            )
        )
    else:
        status_label = "Failed" if physics_enabled else "Skipped"
        reason_label = (
            artifact_errors.get("collision") or "Collision generation failed"
            if physics_enabled
            else "Physics disabled for this asset"
        )
        logger.info(
            "\n" + format_box(
                "POSTPROCESS: STAGE 8/8 - PHYSICS & COLLISION PROXY",
                [
                    ("Status", status_label),
                    ("Reason", reason_label),
                    ("Stage Elapsed", f"{collision_duration:.2f}s"),
                ],
            )
        )

    _check_cancelled(cancel_checker)
    _emit(progress, 0.90, "preview", "Generating asset preview.")
    preview_dir.mkdir(parents=True, exist_ok=True)
    thumbnail_path: Optional[Path] = None
    try:
        from .services.mesh_thumbnail import render_mesh_thumbnail
        thumbnail_path = preview_dir / "thumbnail.png"
        thumbnail_bytes = render_mesh_thumbnail(game_ready_glb_bytes if "game_ready_glb_bytes" in locals() else glb_path.read_bytes())
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

    _check_cancelled(cancel_checker)
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

    is_quad_dominant = bool(retopo_stats.get("quad_faces")) or (is_quad_requested and retopo_ran)
    quad_face_count = retopo_stats.get("quad_face_count") or (len(retopo_stats["quad_faces"]) if retopo_stats.get("quad_faces") else None)

    quality_trace["game_ready"] = {
        **mesh_stats(uv_mesh).model_dump(),
        "native_textures": _has_native_textures(uv_mesh),
        "uv_seam_vertex_delta": len(uv_mesh.vertices) - len(mesh.vertices),
        "qa": qa_report,
        "quad_dominant": is_quad_dominant,
        "quad_face_count": quad_face_count,
        "topology": "Quad" if is_quad_dominant else "Triangle",
    }
    final_topology_gate = evaluate_topology_gate(
        mesh=uv_mesh.copy(),
        plan=generation_result.get("plan") or job_inputs.get("plan"),
        strict=bool(job_inputs.get("strict_topology_gate", False)),
    )
    quality_trace["final_topology_gate"] = final_topology_gate

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
            "master_path": master_path.relative_to(asset_dir).as_posix(),
            "game_ready_path": glb_path.relative_to(asset_dir).as_posix() if glb_path.exists() else None,
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
    if sha256_file(master_path) != source_sha256:
        raise RuntimeError("Immutable master source.glb changed during post-processing.")

    badge_cfg = get_quality_config().get("badge", {})
    sharp_cutoff = float(badge_cfg.get("sharp_min_score", 0.85))
    passed_clean = bool(gate_eval.get("passed_clean", False)) if isinstance(gate_eval, dict) else False
    pbr_valid = (not pbr_validation_required) or (
        isinstance(pbr_report, dict) and pbr_report.get("valid") is True
    )
    has_flaws = (
        (not passed_clean)
        or (not pbr_valid)
        or (len(qa_report.get("warnings", [])) > 0 if isinstance(qa_report, dict) else False)
    )
    feature_ret = (master_quality_report or {}).get("feature_edge_retention")
    if has_flaws:
        backend_quality_tier = "needs_review"
    elif feature_ret is not None and float(feature_ret) >= sharp_cutoff:
        backend_quality_tier = "sharp"
    else:
        backend_quality_tier = "clean"
    quality_trace["quality_tier"] = backend_quality_tier

    _write_json(
        metadata_dir / "quality_report.json",
        {
            "quality_tier": backend_quality_tier,
            "plan": quality_trace.get("plan"),
            "seed_scores": quality_trace.get("seed_scores"),
            "source_sha256": source_sha256,
            "adapter_output_sha256": adapter_output_sha256,
            "adapter_output_matches_master": raw_master_identity_matches,
            "raw_geometry_telemetry": raw_geometry_telemetry,
            "before_postprocess": qa_before,
            "after_postprocess": qa_report,
            "topology_gate": quality_trace.get("topology_gate"),
            "repair": repair_stats,
            "retopo": retopo_stats,
            "optimize": optimize_stats,
            "uv": uv_stats,
            "bake": bake_stats,
            "pbr_validation": quality_trace.get("pbr_validation"),
            "texture_status": texture_status,
            "texture_stage": texture_stage_info,
            "quality_trace": quality_trace,
            "master_to_derivative": master_quality_report,
            "quality_mode": quality_mode,
            "texture_resolution": (
                int(texture_stage_info.get("target_atlas_size") or texture_resolution)
                if texture_enabled else texture_resolution
            ),
            "cpu_threads": cpu_threads,
            "lods": lod_quality,
            "lod_validation": lod_validation,
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

    texture_dimensions: Dict[str, List[int]] = {}
    for map_name, map_path_str in texture_paths.items():
        try:
            p = Path(map_path_str)
            if p.is_file():
                with Image.open(p) as img:
                    texture_dimensions[map_name] = [int(img.width), int(img.height)]
        except Exception:
            pass

    generated = {
        "game_ready": game_ready,
        "lods": lods,
        "final_topology_gate": final_topology_gate,
        "collision": str(collision_path) if collision_path else None,
        "collision_stats": collision_stats,
        "physics": str(metadata_dir / "physics.json") if physics_metadata else None,
        "physics_metadata": physics_metadata,
        "textures": texture_paths,
        "texture_dimensions": texture_dimensions,
        "texture_status": texture_status,
        "texture_stage": texture_stage_info,
        "textured_glb": texture_stage_info.get("textured_glb"),
        "thumbnail": str(thumbnail_path) if thumbnail_path else None,
        "artifact_errors": artifact_errors,
        "lod_validation": lod_validation,
        "bake_stats": bake_stats,
        "retopo_stats": retopo_stats,
        "pbr_validation": pbr_report,
    }
    final_result = _build_result(
        job_id, asset_dir, asset_name, qa_report, generated,
        target_polycount=resolved_target_polycount,
        lod_enabled=lod_enabled,
        job_inputs=job_inputs,
        job_metadata=job_metadata,
        texture_enabled=texture_enabled,
        master_quality_report=master_quality_report,
        pbr_validation_report=pbr_report,
    )
    final_result["quality_trace"] = quality_trace
    final_result["final_topology_gate"] = final_topology_gate
    final_result["quality_tier"] = backend_quality_tier
    final_result["generation_info"] = generation_info
    final_result["raw_geometry_telemetry"] = raw_geometry_telemetry or None
    final_result["geometry_quality_warning"] = generation_info.get("geometry_quality_warning")
    final_result["master_to_derivative"] = master_quality_report
    final_result["quality_mode"] = quality_mode
    final_result["texture_stage"] = texture_stage_info
    texture_info = final_result.get("texture_stage") or {}
    final_result["texture_resolution"] = (
        int(texture_info["target_atlas_size"])
        if texture_enabled and texture_info.get("target_atlas_size")
        else texture_resolution
    )
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
