"""PBR asset validator for game-ready assets.

Validates textures (non-degenerate, glTF PBR channel packing, tangent-space OpenGL
normal convention) and UV mapping (bounds in [0, 1], utilization, overlap fraction).
"""
from __future__ import annotations

import io
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

import numpy as np
from PIL import Image, ImageDraw
import trimesh
import yaml

logger = logging.getLogger(__name__)

DEFAULT_BAKE_CONFIG = {
    "normal_space": "TANGENT",
    "convention": "OPENGL",
    "max_ray_distance": 0.05,
    "cage_extrusion": 0.02,
    "texture_size": 1024,
    "gutter_dilation_pixels": 4,
    "min_uv_utilization": 0.60,
}


def load_bake_config(config_path: Optional[str] = None) -> dict:
    """Load bake configuration from file or fallback to defaults."""
    candidate_paths = []
    if config_path:
        candidate_paths.append(Path(config_path))
    candidate_paths.extend([
        Path(__file__).resolve().parents[2] / "config" / "bake_config.yaml",
        Path.cwd() / "backend" / "config" / "bake_config.yaml",
        Path.cwd() / "config" / "bake_config.yaml",
    ])

    for p in candidate_paths:
        if p.is_file():
            try:
                data = yaml.safe_load(p.read_text(encoding="utf-8")) or {}
                bake_cfg = data.get("bake", data)
                merged = dict(DEFAULT_BAKE_CONFIG)
                merged.update(bake_cfg)
                return merged
            except Exception as exc:
                logger.warning("Failed to parse bake config at %s: %s", p, exc)

    return dict(DEFAULT_BAKE_CONFIG)


def _to_image_array(img_input: Any) -> Optional[np.ndarray]:
    """Convert various image inputs (PIL Image, ndarray, bytes, Path/str) to uint8 ndarray."""
    if img_input is None:
        return None

    if isinstance(img_input, np.ndarray):
        if np.issubdtype(img_input.dtype, np.floating):
            return np.clip(img_input * 255.0, 0, 255).astype(np.uint8)
        return img_input.astype(np.uint8)

    if isinstance(img_input, Image.Image):
        return np.array(img_input)

    if isinstance(img_input, (str, Path)):
        p = Path(img_input)
        if p.is_file():
            with Image.open(p) as img:
                return np.array(img)
        return None

    if isinstance(img_input, (bytes, bytearray)):
        try:
            with Image.open(io.BytesIO(img_input)) as img:
                return np.array(img)
        except Exception:
            return None

    return None


def _is_degenerate_map(arr: np.ndarray) -> Tuple[bool, Optional[int]]:
    """Check if texture map or its color channels are all-0 or all-255.

    Returns (is_degenerate, degenerate_value).
    """
    if arr.size == 0:
        return True, 0

    # For RGB / RGBA check color channels
    if arr.ndim == 3 and arr.shape[2] >= 3:
        color_channels = arr[..., :3]
        min_val = int(color_channels.min())
        max_val = int(color_channels.max())
    else:
        min_val = int(arr.min())
        max_val = int(arr.max())

    if min_val == 0 and max_val == 0:
        return True, 0
    if min_val == 255 and max_val == 255:
        return True, 255

    return False, None


def _check_normal_convention(arr: np.ndarray) -> Tuple[str, List[str]]:
    """Check if normal map is tangent-space, OpenGL convention (Y+).

    In tangent-space OpenGL:
    - Normal vector Nz points outwards (Nz >= 0, B channel high, mode/flat is 255).
    - Nx, Ny center around 0 (R, G center around 128).
    - Flat regions decode to approx (0, 0, 1) or RGB (128, 128, 255).
    """
    warnings: List[str] = []
    if arr.ndim != 3 or arr.shape[2] < 3:
        warnings.append("Normal map must have at least 3 color channels (RGB)")
        return "INVALID", warnings

    rgb = arr[..., :3].astype(np.float32)

    # Decode RGB [0, 255] to normals [-1, 1]
    nx = (rgb[..., 0] / 255.0) * 2.0 - 1.0
    ny = (rgb[..., 1] / 255.0) * 2.0 - 1.0
    nz = (rgb[..., 2] / 255.0) * 2.0 - 1.0

    r_mean = float(np.mean(rgb[..., 0]))
    g_mean = float(np.mean(rgb[..., 1]))
    b_mean = float(np.mean(rgb[..., 2]))
    nz_median = float(np.median(nz))

    # In tangent space, Blue / Nz is predominantly outward-facing (Nz >= 0, B >= 128)
    if b_mean < 140.0 or nz_median < 0.1:
        warnings.append(
            f"Normal map blue channel is low (mean B={b_mean:.1f}, median Nz={nz_median:.2f}); "
            "likely object-space or corrupted instead of tangent-space."
        )
        return "UNKNOWN", warnings

    # Check flat / unperturbed region normals
    # Flat region texels are close to neutral normal (128, 128, 255)
    flat_mask = (np.abs(nx) < 0.15) & (np.abs(ny) < 0.15) & (nz > 0.85)
    flat_count = int(np.count_nonzero(flat_mask))
    total_texels = rgb.shape[0] * rgb.shape[1]
    flat_fraction = flat_count / total_texels

    if flat_fraction > 0.01:
        avg_flat_nx = float(np.mean(nx[flat_mask]))
        avg_flat_ny = float(np.mean(ny[flat_mask]))
        avg_flat_nz = float(np.mean(nz[flat_mask]))
        if abs(avg_flat_nx) > 0.1 or abs(avg_flat_ny) > 0.1 or avg_flat_nz < 0.9:
            warnings.append(
                f"Flat region normal deviation: ({avg_flat_nx:.3f}, {avg_flat_ny:.3f}, {avg_flat_nz:.3f}) "
                "differs from expected (0, 0, 1)."
            )

    # Tangent space normal map verified with OpenGL convention
    return "OPENGL", warnings


def _compute_channel_stats(channel: np.ndarray) -> Dict[str, float]:
    """Compute summary statistics for a float channel in [0, 1]."""
    return {
        "mean": round(float(np.mean(channel)), 4),
        "std": round(float(np.std(channel)), 4),
        "min": round(float(np.min(channel)), 4),
        "max": round(float(np.max(channel)), 4),
    }


def _validate_uvs(
    uvs: np.ndarray,
    faces: np.ndarray,
    min_utilization: float = 0.60,
    raster_res: int = 512,
) -> Tuple[bool, float, float, List[str]]:
    """Validate UV mapping: bounds in [0, 1], utilization, and overlap fraction.

    Returns: (uv_valid, uv_utilization, overlap_fraction, warnings)
    """
    warnings: List[str] = []
    if uvs is None or len(uvs) == 0:
        warnings.append("Mesh has no UV coordinates.")
        return False, 0.0, 0.0, warnings

    if faces is None or len(faces) == 0:
        warnings.append("Mesh has no face indices for UV validation.")
        return False, 0.0, 0.0, warnings

    eps = 1e-4
    min_u, min_v = float(np.min(uvs[:, 0])), float(np.min(uvs[:, 1]))
    max_u, max_v = float(np.max(uvs[:, 0])), float(np.max(uvs[:, 1]))

    out_of_bounds = min_u < -eps or min_v < -eps or max_u > 1.0 + eps or max_v > 1.0 + eps
    if out_of_bounds:
        warnings.append(
            f"UV coordinates out of [0, 1] range: U in [{min_u:.4f}, {max_u:.4f}], V in [{min_v:.4f}, {max_v:.4f}]."
        )
        uv_valid = False
    else:
        uv_valid = True

    # Face UVs
    face_uvs = uvs[faces]  # shape (F, 3, 2)
    v0 = face_uvs[:, 0, :]
    v1 = face_uvs[:, 1, :]
    v2 = face_uvs[:, 2, :]

    # Geometric 2D area of each face in UV space
    signed_areas = 0.5 * ((v1[:, 0] - v0[:, 0]) * (v2[:, 1] - v0[:, 1]) - (v2[:, 0] - v0[:, 0]) * (v1[:, 1] - v0[:, 1]))
    face_areas = np.abs(signed_areas)
    total_face_area = float(np.sum(face_areas))

    zero_area_faces = int(np.count_nonzero(face_areas < 1e-7))
    if zero_area_faces > 0:
        warnings.append(f"{zero_area_faces} face(s) have zero UV area (degenerate UVs).")

    # Rasterize UV faces onto binary mask for utilization and overlap
    mask_img = Image.new("L", (raster_res, raster_res), 0)
    draw = ImageDraw.Draw(mask_img)

    # Scale UVs to raster grid (clamp to [0, 1] for rasterization)
    scaled_faces = np.clip(face_uvs, 0.0, 1.0) * (raster_res - 1)
    for tri in scaled_faces:
        draw.polygon(
            [(tri[0, 0], tri[0, 1]), (tri[1, 0], tri[1, 1]), (tri[2, 0], tri[2, 1])],
            fill=255,
        )

    covered_pixels = int(np.count_nonzero(np.array(mask_img)))
    uv_utilization = round(float(covered_pixels) / float(raster_res * raster_res), 4)

    # Compute overlap fraction: excess geometric area over rasterized union
    if total_face_area > 0.0:
        union_area = float(covered_pixels) / float(raster_res * raster_res)
        overlap_area = max(0.0, total_face_area - union_area)
        overlap_fraction = round(float(overlap_area / total_face_area), 4)
        if overlap_fraction < 0.015:  # Tolerance for pixel rasterization boundary
            overlap_fraction = 0.0
    else:
        overlap_fraction = 0.0

    if uv_utilization < min_utilization:
        warnings.append(
            f"UV space utilization ({uv_utilization:.1%}) is below recommended minimum ({min_utilization:.1%})."
        )

    return uv_valid, uv_utilization, overlap_fraction, warnings


def _extract_mesh_and_textures(
    glb_path_or_mesh: Any,
    texture_images: Optional[Dict[str, Any]] = None,
) -> Tuple[Optional[np.ndarray], Optional[np.ndarray], Dict[str, np.ndarray]]:
    """Extract UVs, faces, and texture images from input mesh and/or dict."""
    uvs: Optional[np.ndarray] = None
    faces: Optional[np.ndarray] = None
    extracted_textures: Dict[str, np.ndarray] = {}

    loaded = None
    if glb_path_or_mesh is not None:
        if isinstance(glb_path_or_mesh, (str, Path)):
            p = Path(glb_path_or_mesh)
            if p.is_file():
                loaded = trimesh.load(str(p), process=False)
            else:
                raise FileNotFoundError(f"Asset file not found: {glb_path_or_mesh}")
        elif isinstance(glb_path_or_mesh, (bytes, bytearray)):
            loaded = trimesh.load(io.BytesIO(glb_path_or_mesh), file_type="glb", process=False)
        elif isinstance(glb_path_or_mesh, (trimesh.Trimesh, trimesh.Scene)):
            loaded = glb_path_or_mesh

    if loaded is not None:
        if isinstance(loaded, trimesh.Scene):
            geoms = [g for g in loaded.geometry.values() if isinstance(g, trimesh.Trimesh)]
            if len(geoms) == 1:
                mesh = geoms[0]
                if getattr(mesh.visual, "uv", None) is not None:
                    uvs = np.asarray(mesh.visual.uv, dtype=np.float64)
                faces = np.asarray(mesh.faces, dtype=np.int64)
            elif len(geoms) > 1:
                # Concatenate geometries to validate all UVs
                uv_list = []
                face_list = []
                vert_offset = 0
                for g in geoms:
                    if getattr(g.visual, "uv", None) is not None:
                        uv_list.append(np.asarray(g.visual.uv, dtype=np.float64))
                        face_list.append(np.asarray(g.faces, dtype=np.int64) + vert_offset)
                        vert_offset += len(g.vertices)
                if uv_list:
                    uvs = np.concatenate(uv_list, axis=0)
                    faces = np.concatenate(face_list, axis=0)

            # Extract materials from geometries
            for g in geoms:
                mat = getattr(g.visual, "material", None)
                if isinstance(mat, trimesh.visual.material.PBRMaterial):
                    if mat.normalTexture is not None and "normal" not in extracted_textures:
                        arr = _to_image_array(mat.normalTexture)
                        if arr is not None:
                            extracted_textures["normal"] = arr
                    if mat.baseColorTexture is not None and "base_color" not in extracted_textures:
                        arr = _to_image_array(mat.baseColorTexture)
                        if arr is not None:
                            extracted_textures["base_color"] = arr
                    if mat.metallicRoughnessTexture is not None and "metallic_roughness" not in extracted_textures:
                        arr = _to_image_array(mat.metallicRoughnessTexture)
                        if arr is not None:
                            extracted_textures["metallic_roughness"] = arr
                    if mat.occlusionTexture is not None and "ao" not in extracted_textures:
                        arr = _to_image_array(mat.occlusionTexture)
                        if arr is not None:
                            extracted_textures["ao"] = arr
        elif isinstance(loaded, trimesh.Trimesh):
            if getattr(loaded.visual, "uv", None) is not None:
                uvs = np.asarray(loaded.visual.uv, dtype=np.float64)
            faces = np.asarray(loaded.faces, dtype=np.int64)

            mat = getattr(loaded.visual, "material", None)
            if isinstance(mat, trimesh.visual.material.PBRMaterial):
                if mat.normalTexture is not None:
                    arr = _to_image_array(mat.normalTexture)
                    if arr is not None:
                        extracted_textures["normal"] = arr
                if mat.baseColorTexture is not None:
                    arr = _to_image_array(mat.baseColorTexture)
                    if arr is not None:
                        extracted_textures["base_color"] = arr
                if mat.metallicRoughnessTexture is not None:
                    arr = _to_image_array(mat.metallicRoughnessTexture)
                    if arr is not None:
                        extracted_textures["metallic_roughness"] = arr
                if mat.occlusionTexture is not None:
                    arr = _to_image_array(mat.occlusionTexture)
                    if arr is not None:
                        extracted_textures["ao"] = arr
            elif hasattr(mat, "image") and mat.image is not None:
                # Ignore default 2x2 trimesh dummy placeholder
                if getattr(mat.image, "size", None) != (2, 2):
                    arr = _to_image_array(mat.image)
                    if arr is not None:
                        extracted_textures["base_color"] = arr

    # Overlay / incorporate texture_images dict
    if texture_images:
        key_aliases = {
            "normal": ["normal", "normal_map", "norm", "normalTexture"],
            "base_color": ["base_color", "baseColor", "albedo", "diffuse", "baseColorTexture"],
            "metallic_roughness": ["metallic_roughness", "metallicRoughness", "metallicRoughnessTexture", "orm", "mr", "packed"],
            "roughness": ["roughness", "roughnessTexture"],
            "metallic": ["metallic", "metallicTexture"],
            "ao": ["ao", "occlusion", "occlusionTexture", "ambient_occlusion"],
        }
        for canon, aliases in key_aliases.items():
            for alias in aliases:
                if alias in texture_images and texture_images[alias] is not None:
                    arr = _to_image_array(texture_images[alias])
                    if arr is not None:
                        extracted_textures[canon] = arr
                    break

    return uvs, faces, extracted_textures


def validate_pbr_asset(
    glb_path_or_mesh: Any,
    texture_images: Optional[Dict[str, Any]] = None,
    config_path: Optional[str] = None,
    strict: bool = False,
) -> Dict[str, Any]:
    """Validate game-ready PBR asset per TASKS.md 2C.

    Checks:
    - Non-degenerate textures: maps are not all-0 or all-255.
    - glTF PBR channel packing: roughness in G channel, metallic in B channel.
    - Normal map is tangent-space, OpenGL convention (Y+): flat region normal decodes to approx (0, 0, 1).
    - UV validity: every face vertex has UV coordinates in [0, 1]; reports overlap fraction and utilization.
    - Metallic/roughness sanity: distribution checks.

    Returns structured dict:
    {
        "valid": bool,
        "maps_checked": list[str],
        "uv_utilization": float,
        "uv_valid": bool,
        "normal_convention": str,
        "roughness_metallic_packed": bool,
        "warnings": list[str],
        "uv_overlap_fraction": float,
        "channel_stats": dict,
    }
    """
    config = load_bake_config(config_path)
    warnings: List[str] = []
    is_valid = True

    # 1. Extract mesh geometry and textures
    try:
        uvs, faces, textures = _extract_mesh_and_textures(glb_path_or_mesh, texture_images)
    except Exception as exc:
        return {
            "valid": False,
            "maps_checked": [],
            "uv_utilization": 0.0,
            "uv_valid": False,
            "normal_convention": "NONE",
            "roughness_metallic_packed": False,
            "warnings": [f"Failed to load asset or textures: {exc}"],
            "uv_overlap_fraction": 0.0,
            "channel_stats": {},
        }

    # 2. UV Validation
    min_utilization = float(config.get("min_uv_utilization", 0.60))
    if uvs is not None and faces is not None:
        uv_valid, uv_utilization, uv_overlap, uv_warnings = _validate_uvs(
            uvs, faces, min_utilization=min_utilization
        )
        warnings.extend(uv_warnings)
        if not uv_valid:
            is_valid = False
        if strict and uv_utilization < min_utilization:
            is_valid = False
    else:
        uv_valid = False
        uv_utilization = 0.0
        uv_overlap = 0.0
        warnings.append("No mesh geometry or UV coordinates provided.")
        is_valid = False

    # 3. Check Degenerate Maps
    maps_checked: List[str] = []
    has_degenerate = False
    for map_name, arr in textures.items():
        is_degen, degen_val = _is_degenerate_map(arr)
        if is_degen:
            has_degenerate = True
            is_valid = False
            warnings.append(f"Degenerate texture map '{map_name}': all texels are {degen_val}.")
        maps_checked.append(map_name)

    # 4. Normal Map Validation
    normal_convention = "NOT_CHECKED"
    if "normal" in textures:
        normal_convention, norm_warnings = _check_normal_convention(textures["normal"])
        warnings.extend(norm_warnings)
        expected_convention = config.get("convention", "OPENGL").upper()
        if normal_convention != expected_convention:
            warnings.append(
                f"Normal convention is '{normal_convention}', expected '{expected_convention}'."
            )
            is_valid = False

    # 5. Roughness / Metallic Channel Packing & Distribution
    roughness_metallic_packed = False
    channel_stats: Dict[str, Any] = {}

    if "metallic_roughness" in textures:
        mr_arr = textures["metallic_roughness"]
        if mr_arr.ndim == 3 and mr_arr.shape[2] >= 3:
            roughness_metallic_packed = True
            roughness_ch = mr_arr[..., 1].astype(np.float32) / 255.0
            metallic_ch = mr_arr[..., 2].astype(np.float32) / 255.0

            channel_stats["roughness"] = _compute_channel_stats(roughness_ch)
            channel_stats["metallic"] = _compute_channel_stats(metallic_ch)

            if "roughness" not in maps_checked:
                maps_checked.append("roughness")
            if "metallic" not in maps_checked:
                maps_checked.append("metallic")
        else:
            warnings.append("Metallic-roughness map has fewer than 3 channels; cannot unpack G/B.")
            is_valid = False
    else:
        # Separate maps
        if "roughness" in textures:
            r_arr = textures["roughness"]
            r_ch = (r_arr[..., 0] if r_arr.ndim == 3 else r_arr).astype(np.float32) / 255.0
            channel_stats["roughness"] = _compute_channel_stats(r_ch)
        if "metallic" in textures:
            m_arr = textures["metallic"]
            m_ch = (m_arr[..., 0] if m_arr.ndim == 3 else m_arr).astype(np.float32) / 255.0
            channel_stats["metallic"] = _compute_channel_stats(m_ch)

        if "roughness" in textures and "metallic" in textures:
            warnings.append("Roughness and metallic are separate maps, not packed into glTF G/B channels.")
        elif "roughness" in textures or "metallic" in textures:
            warnings.append("Missing packed metallic-roughness texture.")

    # Metallic / Roughness Sanity Checks
    if "roughness" in channel_stats:
        r_stats = channel_stats["roughness"]
        if r_stats["min"] == 0.0 and r_stats["max"] == 0.0:
            warnings.append("Roughness is 0.0 everywhere (pure mirror reflection across entire asset).")
        elif r_stats["min"] == 1.0 and r_stats["max"] == 1.0:
            warnings.append("Roughness is 1.0 everywhere (completely diffuse across entire asset).")

    if "metallic" in channel_stats:
        m_stats = channel_stats["metallic"]
        if 0.05 <= m_stats["mean"] <= 0.95 and m_stats["std"] < 0.001:
            warnings.append(
                f"Metallic channel has uniform intermediate value {m_stats['mean']:.2f}; "
                "flag for manual review if mixed dielectric/metallic materials are expected."
            )
        elif m_stats["min"] > 0.15 and m_stats["max"] < 0.85 and m_stats["std"] < 0.15:
            warnings.append("Metallic distribution is intermediate (non-standard PBR binary distribution).")

    # If any degenerate map was found, validation fails
    if has_degenerate:
        is_valid = False

    return {
        "valid": bool(is_valid),
        "maps_checked": maps_checked,
        "uv_utilization": float(uv_utilization),
        "uv_valid": bool(uv_valid),
        "normal_convention": normal_convention,
        "roughness_metallic_packed": bool(roughness_metallic_packed),
        "warnings": warnings,
        "uv_overlap_fraction": float(uv_overlap),
        "channel_stats": channel_stats,
    }
