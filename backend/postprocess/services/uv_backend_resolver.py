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

try:
    from backend.core.config import get_quality_config
except ImportError:
    from core.config import get_quality_config

logger = logging.getLogger(__name__)


def load_uv_config(config_path: Optional[str | Path] = None) -> Dict[str, Any]:
    """Load UV configuration from canonical quality config."""
    path_str = str(config_path) if config_path is not None else None
    return dict(get_quality_config(path_str)["uv"])


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

    if requested in ("ministudio", "autouv"):
        return "ministudio", f"{requested} explicitly requested"

    if requested in ("blender_smart", "blender"):
        return "blender_smart", f"{requested} explicitly requested"

    if requested == "xatlas":
        return "xatlas", "xatlas explicitly requested"

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

    logger.warning("Unknown UV backend '%s' requested; falling back to %s.", requested_backend, fallback)
    return fallback, f"unknown backend '{requested_backend}'; falling back to {fallback}"


def _unwrap_massive_mesh_safe(
    mesh: trimesh.Trimesh,
    runtime: Optional[Dict[str, Any]] = None,
    max_safe_faces: int = 50000,
    max_chart_size: int = 4096,
) -> trimesh.Trimesh:
    """Safely unwrap a massive mesh by unwrapping a simplified proxy and transferring UVs via cKDTree.

    Prevents C++ SIGSEGV in xatlas while preserving the native dense mesh geometry,
    vertex count, normals, and vertex colors.
    """
    from scipy.spatial import cKDTree

    V = np.asarray(mesh.vertices, dtype=np.float64)
    F = np.asarray(mesh.faces, dtype=np.int64)

    if len(V) == 0 or len(F) == 0:
        return mesh.copy()

    # Fast voxel grid clustering proxy in pure numpy
    bbox_extent = V.max(axis=0) - V.min(axis=0)
    vol = float(np.prod(np.maximum(bbox_extent, 1e-6)))
    target_proxy_faces = min(max_safe_faces // 2, 25000)
    n_target_verts = max(100, target_proxy_faces // 2)
    cell_size = (vol / n_target_verts) ** (1.0 / 3.0)

    grid_coords = np.floor((V - V.min(axis=0)) / max(cell_size, 1e-6)).astype(np.int64)
    _, unique_indices, inverse = np.unique(grid_coords, axis=0, return_index=True, return_inverse=True)

    proxy_V = V[unique_indices]
    proxy_F = inverse[F]

    # Filter degenerate triangles
    valid_faces = (proxy_F[:, 0] != proxy_F[:, 1]) & (proxy_F[:, 1] != proxy_F[:, 2]) & (proxy_F[:, 2] != proxy_F[:, 0])
    proxy_F = proxy_F[valid_faces]

    if len(proxy_F) == 0 or len(proxy_V) < 4:
        # Fallback to simple strided face sampling
        stride = max(1, len(F) // target_proxy_faces)
        sampled_F = F[::stride]
        unique_v, inv_v = np.unique(sampled_F, return_inverse=True)
        proxy_V = V[unique_v]
        proxy_F = inv_v.reshape(-1, 3)

    proxy_mesh = trimesh.Trimesh(vertices=proxy_V, faces=proxy_F, process=False)
    unwrapped_proxy = _unwrap_xatlas(proxy_mesh, runtime=runtime, max_chart_size=max_chart_size)

    proxy_unwrapped_verts = np.asarray(unwrapped_proxy.vertices, dtype=np.float64)
    proxy_uvs = np.asarray(unwrapped_proxy.visual.uv, dtype=np.float32)

    # Transfer UVs to original vertices via cKDTree
    tree = cKDTree(proxy_unwrapped_verts)
    _, nearest = tree.query(V)
    dense_uvs = proxy_uvs[nearest]

    out_mesh = mesh.copy()
    source_visual = getattr(mesh, "visual", None)
    source_material = getattr(source_visual, "material", None)
    source_image = getattr(source_visual, "image", None)

    out_mesh.visual = trimesh.visual.TextureVisuals(
        uv=dense_uvs,
        material=source_material if source_material is not None else trimesh.visual.material.PBRMaterial(name="xatlas_safe"),
        image=source_image if source_image is not None else None,
    )
    if hasattr(source_visual, "vertex_colors") and source_visual.vertex_colors is not None:
        out_mesh.visual.vertex_colors = source_visual.vertex_colors

    return out_mesh


def _unwrap_ministudio(
    mesh: trimesh.Trimesh,
    runtime: Optional[Dict[str, Any]] = None,
) -> trimesh.Trimesh:
    """Unwrap mesh using ministudio/autouv package."""
    from postprocess.services.auto_uv import run_auto_uv
    from postprocess.schemas import AutoUvOptions

    runtime_dict = runtime or {}
    opts = AutoUvOptions(
        resolution=int(runtime_dict.get("resolution", 2048)),
        padding_texels=int(runtime_dict.get("padding", runtime_dict.get("padding_texels", 4))),
    )
    unwrapped, _, _ = run_auto_uv(mesh, opts)
    return unwrapped


def _unwrap_blender_smart(
    mesh: trimesh.Trimesh,
    runtime: Optional[Dict[str, Any]] = None,
) -> trimesh.Trimesh:
    """Unwrap mesh using Blender Smart UV Project."""
    import shutil
    import subprocess
    from uuid import uuid4
    from postprocess.config import WORK_DIR, blender_runtime_available, blender_worker_argv

    if not blender_runtime_available():
        raise RuntimeError("Blender runtime not available for blender_smart UV unwrap.")

    job_dir = WORK_DIR / f"blender_uv-{uuid4().hex}"
    job_dir.mkdir(parents=True, exist_ok=True)
    try:
        in_glb = job_dir / "input.glb"
        out_glb = job_dir / "output.glb"
        in_glb.write_bytes(mesh.export(file_type="glb"))
        angle_limit = float((runtime or {}).get("angle_limit", 66.0))
        island_margin = float((runtime or {}).get("island_margin", 0.01))

        script = job_dir / "smart_uv.py"
        script.write_text(
            f'import bpy\n'
            f'bpy.ops.wm.read_factory_settings(use_empty=True)\n'
            f'bpy.ops.import_scene.gltf(filepath=r"{in_glb}")\n'
            f'for obj in bpy.context.scene.objects:\n'
            f'    if obj.type == "MESH":\n'
            f'        bpy.context.view_layer.objects.active = obj\n'
            f'        bpy.ops.object.mode_set(mode="EDIT")\n'
            f'        bpy.ops.mesh.select_all(action="SELECT")\n'
            f'        bpy.ops.uv.smart_project(angle_limit={angle_limit}, island_margin={island_margin})\n'
            f'        bpy.ops.object.mode_set(mode="OBJECT")\n'
            f'bpy.ops.export_scene.gltf(filepath=r"{out_glb}", export_format="GLB")\n',
            encoding="utf-8",
        )
        cmd = blender_worker_argv(script, [])
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
        if proc.returncode != 0 or not out_glb.exists():
            raise RuntimeError(f"Blender smart UV unwrap failed: {proc.stderr or proc.stdout}")

        from postprocess.meshio import load_mesh
        return load_mesh(out_glb.read_bytes(), "output.glb")
    finally:
        shutil.rmtree(job_dir, ignore_errors=True)


def _unwrap_xatlas(
    mesh: trimesh.Trimesh,
    runtime: Optional[Dict[str, Any]] = None,
    max_chart_size: int = 4096,
) -> trimesh.Trimesh:
    """Unwrap mesh using xatlas numpy vertex/face API with massive mesh protection."""
    import xatlas

    v = np.asarray(mesh.vertices, dtype=np.float64)
    f = np.asarray(mesh.faces, dtype=np.int32)

    if len(v) == 0 or len(f) == 0:
        return mesh.copy()

    runtime_dict = runtime or {}
    max_safe_faces = int(runtime_dict.get("xatlas_max_safe_triangles", 50000))
    if len(f) > max_safe_faces:
        logger.info(
            "Mesh has %d triangles (> %d); using memory-safe proxy UV unwrapping to prevent segfaults.",
            len(f),
            max_safe_faces,
        )
        return _unwrap_massive_mesh_safe(mesh, runtime=runtime_dict, max_safe_faces=max_safe_faces, max_chart_size=max_chart_size)

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
    elif resolved_backend == "ministudio":
        try:
            unwrapped_mesh = _unwrap_ministudio(mesh_copy, runtime_dict)
            backend_used = "ministudio"
            success = True
        except Exception as exc:
            logger.warning("ministudio unwrap failed (%s); gracefully falling back to xatlas", exc)
            try:
                unwrapped_mesh = _unwrap_xatlas(mesh_copy, runtime_dict, max_chart_size=max_chart_size)
                backend_used = "xatlas"
                success = True
            except Exception as inner_exc:
                logger.error("Fallback xatlas unwrap also failed: %s", inner_exc)
                unwrapped_mesh = mesh_copy
                backend_used = "xatlas"
                success = False
    elif resolved_backend == "blender_smart":
        try:
            unwrapped_mesh = _unwrap_blender_smart(mesh_copy, runtime_dict)
            backend_used = "blender_smart"
            success = True
        except Exception as exc:
            logger.warning("blender_smart unwrap failed (%s); gracefully falling back to xatlas", exc)
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
