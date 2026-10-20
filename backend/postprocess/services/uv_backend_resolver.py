"""UV Backend Resolver and Unwrap Driver.

Provides single-point-of-truth backend resolution between PartUV (high-poly, GPU)
and xatlas (low-poly / fallback, CPU/GPU) along with unified execution.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

import numpy as np
import trimesh
import yaml

logger = logging.getLogger(__name__)

DEFAULT_CONFIG_PATH = Path(__file__).resolve().parents[2] / "config" / "uv_config.yaml"


def load_uv_config(config_path: Optional[str | Path] = None) -> Dict[str, Any]:
    """Load UV configuration from yaml file, with safe fallbacks."""
    config: Dict[str, Any] = {
        "partuv_triangle_threshold": 500000,
        "partuv_vram_requirement_gb": 7.0,
        "default_backend": "auto",
        "fallback_backend": "xatlas",
        "max_chart_size": 4096,
    }

    resolved_path: Optional[Path] = None
    if config_path is not None:
        resolved_path = Path(config_path)
    elif DEFAULT_CONFIG_PATH.is_file():
        resolved_path = DEFAULT_CONFIG_PATH
    else:
        alt_path = Path.cwd() / "backend" / "config" / "uv_config.yaml"
        if alt_path.is_file():
            resolved_path = alt_path

    if resolved_path and resolved_path.is_file():
        try:
            with open(resolved_path, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f)
                if isinstance(data, dict):
                    uv_section = data.get("uv", data)
                    if isinstance(uv_section, dict):
                        config.update(uv_section)
        except Exception as e:
            logger.warning("Failed to load UV config from %s: %s", resolved_path, e)

    return config


def resolve_uv_backend(
    triangle_count: int,
    requested_backend: str = "auto",
    has_cuda: bool = False,
    free_vram_gb: float = 0.0,
    config_path: Optional[str] = None,
) -> Tuple[str, str]:
    """Resolve which UV unwrapping backend to use.

    Returns:
        tuple[str, str]: (selected_backend, reason)
    """
    cfg = load_uv_config(config_path)
    threshold = int(cfg.get("partuv_triangle_threshold", 500000))
    vram_req = float(cfg.get("partuv_vram_requirement_gb", 7.0))
    fallback = str(cfg.get("fallback_backend", "xatlas"))

    requested = (requested_backend or "auto").strip().lower()

    if requested == "partuv":
        if not has_cuda:
            logger.warning("PartUV requested but CUDA is not available; falling back to %s.", fallback)
            return fallback, f"partuv requested but CUDA is not available; falling back to {fallback}"
        if free_vram_gb < vram_req:
            logger.warning(
                "PartUV requested but free VRAM (%.1fGB) is below required (%.1fGB); falling back to %s.",
                free_vram_gb,
                vram_req,
                fallback,
            )
            return (
                fallback,
                f"partuv requested but insufficient VRAM ({free_vram_gb:.1f}GB < {vram_req:.1f}GB); falling back to {fallback}",
            )
        return "partuv", f"partuv explicitly requested with sufficient CUDA VRAM ({free_vram_gb:.1f}GB >= {vram_req:.1f}GB)"

    if requested == "auto":
        if triangle_count >= threshold and has_cuda and free_vram_gb >= vram_req:
            return (
                "partuv",
                f"auto selected partuv: triangle count ({triangle_count}) >= {threshold} and sufficient CUDA VRAM ({free_vram_gb:.1f}GB >= {vram_req:.1f}GB)",
            )
        if triangle_count < threshold:
            reason = f"auto selected {fallback}: triangle count ({triangle_count}) < {threshold}"
        elif not has_cuda:
            reason = f"auto selected {fallback}: triangle count ({triangle_count}) >= {threshold} but CUDA not available"
        else:
            reason = f"auto selected {fallback}: triangle count ({triangle_count}) >= {threshold} but insufficient VRAM ({free_vram_gb:.1f}GB < {vram_req:.1f}GB)"
        return fallback, reason

    if requested == "xatlas":
        return "xatlas", "xatlas explicitly requested"

    logger.warning("Unknown UV backend '%s' requested; falling back to %s.", requested_backend, fallback)
    return fallback, f"unknown backend '{requested_backend}'; falling back to {fallback}"


def _unwrap_xatlas(
    mesh: trimesh.Trimesh,
    runtime: Optional[Dict[str, Any]] = None,
    max_chart_size: int = 4096,
) -> trimesh.Trimesh:
    """Unwrap mesh using xatlas numpy vertex/face API."""
    import xatlas

    v = np.asarray(mesh.vertices, dtype=np.float64)
    f = np.asarray(mesh.faces, dtype=np.int32)

    if len(v) == 0 or len(f) == 0:
        return mesh.copy()

    atlas = xatlas.Atlas()
    pack_opts = xatlas.PackOptions()
    pack_opts.max_chart_size = int(max_chart_size)

    if runtime:
        if "resolution" in runtime:
            pack_opts.resolution = int(runtime["resolution"])
        if "padding" in runtime:
            pack_opts.padding = int(runtime["padding"])
        elif "padding_texels" in runtime:
            pack_opts.padding = int(runtime["padding_texels"])

    atlas.add_mesh(v, f)
    atlas.generate(pack_options=pack_opts)
    vmapping, indices, uvs = atlas.get_mesh(0)

    out_v = v[vmapping]
    out_f = indices
    out_uv = np.asarray(uvs, dtype=np.float32)

    out_normals = None
    if hasattr(mesh, "vertex_normals") and mesh.vertex_normals is not None and len(mesh.vertex_normals) == len(v):
        out_normals = np.asarray(mesh.vertex_normals, dtype=np.float64)[vmapping]

    unwrapped = trimesh.Trimesh(
        vertices=out_v,
        faces=out_f,
        vertex_normals=out_normals,
        process=False,
    )

    source_visual = getattr(mesh, "visual", None)
    source_material = getattr(source_visual, "material", None)
    source_image = getattr(source_visual, "image", None)
    source_vertex_colors = getattr(source_visual, "vertex_colors", None)

    unwrapped.visual = trimesh.visual.TextureVisuals(
        uv=out_uv,
        material=source_material if source_material is not None else trimesh.visual.material.PBRMaterial(name="xatlas"),
        image=source_image if source_image is not None else None,
    )

    if source_vertex_colors is not None:
        try:
            if len(source_vertex_colors) == len(out_v):
                unwrapped.visual.vertex_colors = source_vertex_colors
            elif len(source_vertex_colors) == len(v):
                unwrapped.visual.vertex_colors = np.asarray(source_vertex_colors)[vmapping]
        except Exception:
            pass

    return unwrapped


def _unwrap_partuv(
    mesh: trimesh.Trimesh,
    runtime: Optional[Dict[str, Any]] = None,
) -> trimesh.Trimesh:
    """Unwrap mesh using PartUV runner."""
    import tempfile

    try:
        from utils.partuv_utils import PartUVRunner
    except ImportError:
        try:
            from backend.utils.partuv_utils import PartUVRunner
        except ImportError as e:
            raise RuntimeError(f"PartUV utilities not available: {e}") from e

    runtime_dict = runtime or {}
    distortion_threshold = runtime_dict.get("distortion_threshold", 1.25)
    config_path = runtime_dict.get("partuv_config_path", None)

    runner = PartUVRunner(
        config_path=config_path,
        distortion_threshold=distortion_threshold,
    )

    with tempfile.TemporaryDirectory() as tmp_dir:
        input_mesh_path = Path(tmp_dir) / "input.obj"
        mesh.export(str(input_mesh_path))

        output_dir = Path(tmp_dir) / "output"
        runner.generate_uv_from_mesh(
            mesh_path=input_mesh_path,
            output_path=output_dir,
            save_individual_parts=False,
            save_visuals=False,
        )

        final_mesh_path = output_dir / "final_components.obj"
        if not final_mesh_path.exists():
            raise RuntimeError(f"PartUV did not produce expected output at {final_mesh_path}")

        unwrapped = trimesh.load(str(final_mesh_path), force="mesh", process=False)
        return unwrapped


def execute_uv_unwrap(
    mesh: trimesh.Trimesh,
    backend: str = "auto",
    runtime: Optional[Dict[str, Any]] = None,
) -> Tuple[trimesh.Trimesh, Dict[str, Any]]:
    """Execute UV unwrapping with automatic backend resolution and fallback.

    Never mutates input in-place: works on mesh.copy().
    Returns:
        tuple[trimesh.Trimesh, dict]:
            unwrapped_mesh,
            {"backend_used": str, "resolved_backend": str, "triangle_count": int, "success": bool}
    """
    if mesh is None:
        raise ValueError("Input mesh cannot be None")

    mesh_copy = mesh.copy()
    triangle_count = int(len(mesh.faces))

    runtime_dict: Dict[str, Any] = dict(runtime) if runtime else {}

    if "has_cuda" in runtime_dict:
        has_cuda = bool(runtime_dict["has_cuda"])
    else:
        try:
            import torch
            has_cuda = bool(torch.cuda.is_available())
        except Exception:
            has_cuda = False

    if "free_vram_gb" in runtime_dict:
        free_vram_gb = float(runtime_dict["free_vram_gb"])
    else:
        free_vram_gb = 0.0
        if has_cuda:
            try:
                import torch
                free_bytes = torch.cuda.mem_get_info()[0]
                free_vram_gb = float(free_bytes) / (1024.0 ** 3)
            except Exception:
                free_vram_gb = 0.0

    config_path = runtime_dict.get("config_path", None)
    resolved_backend, _ = resolve_uv_backend(
        triangle_count=triangle_count,
        requested_backend=backend,
        has_cuda=has_cuda,
        free_vram_gb=free_vram_gb,
        config_path=config_path,
    )

    cfg = load_uv_config(config_path)
    max_chart_size = runtime_dict.get("max_chart_size", cfg.get("max_chart_size", 4096))

    backend_used = resolved_backend
    success = True
    unwrapped_mesh = mesh_copy

    if resolved_backend == "partuv":
        try:
            unwrapped_mesh = _unwrap_partuv(mesh_copy, runtime_dict)
            backend_used = "partuv"
            success = True
        except Exception as exc:
            logger.warning("PartUV unwrap failed (%s); gracefully falling back to xatlas", exc)
            try:
                unwrapped_mesh = _unwrap_xatlas(mesh_copy, runtime_dict, max_chart_size=max_chart_size)
                backend_used = "xatlas"
                success = True
            except Exception as inner_exc:
                logger.error("Fallback xatlas unwrap also failed: %s", inner_exc)
                unwrapped_mesh = mesh_copy
                backend_used = "xatlas"
                success = False
    else:
        try:
            unwrapped_mesh = _unwrap_xatlas(mesh_copy, runtime_dict, max_chart_size=max_chart_size)
            backend_used = "xatlas"
            success = True
        except Exception as exc:
            logger.error("xatlas unwrap failed: %s", exc)
            unwrapped_mesh = mesh_copy
            backend_used = "xatlas"
            success = False

    stats = {
        "backend_used": backend_used,
        "resolved_backend": resolved_backend,
        "triangle_count": triangle_count,
        "success": success,
    }
    return unwrapped_mesh, stats
