"""Shared adaptive preprocessing for Image → 3D generation."""
from __future__ import annotations

import hashlib
import json
import logging
import sys
from pathlib import Path
from typing import Any, Dict, Optional

import numpy as np
from PIL import Image, ImageFilter, ImageOps

from core.utils.file_utils import get_storage_base_dir, resolve_server_file_path

logger = logging.getLogger(__name__)

PREPROCESS_VERSION = "1"
LOW_RESOLUTION_MAX = 1024
PROFILE_TARGET_RESOLUTION = {
    "default": 1024,
    "quality": 1536,
    "high_fidelity": 1536,
    "native_detail": 1536,
    "fast": 1024,
    "hi3dgen_normal_bridging": 1024,
}
CROP_PADDING = 0.08
ALPHA_BOUND_THRESHOLD = 8
ALPHA_BOUND_TRIM_FRACTION = 0.001


def _storage_root() -> Path:
    root = get_storage_base_dir() / "images" / "preprocessed"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _resolve_input(path_value: str) -> Path:
    resolved = resolve_server_file_path(path_value)
    path = Path(resolved) if resolved else Path()
    if not path.is_file():
        raise FileNotFoundError(f"Image file not found: {path_value}")
    return path


def _rmbg(image: Image.Image):
    """Reuse the repository's model-integrated RMBG implementation when available."""
    hunyuan_root = Path(__file__).resolve().parents[2] / "thirdparty" / "hunyuan3d-shape-v2-1"
    package_root = hunyuan_root / "hy3dshape"
    if package_root.is_dir() and str(package_root) not in sys.path:
        sys.path.insert(0, str(package_root))
    if hunyuan_root.is_dir() and str(hunyuan_root) not in sys.path:
        sys.path.append(str(hunyuan_root))

    try:
        from hy3dshape.rembg import BackgroundRemover

        remover = BackgroundRemover()
        output = remover(image.convert("RGBA"))
        if isinstance(output, Image.Image):
            return output.convert("RGBA"), True, None, "hy3dshape"
    except Exception as integrated_error:
        integrated_message = str(integrated_error)
    else:
        integrated_message = "model-integrated RMBG returned a non-image result"

    try:
        from rembg import remove

        output = remove(image.convert("RGBA"))
        if isinstance(output, Image.Image):
            return output.convert("RGBA"), True, None, "rembg"
    except Exception as direct_error:
        return image, False, (
            f"background removal unavailable: {integrated_message}; {direct_error}"
        ), "none"

    return image, False, f"background removal unavailable: {integrated_message}", "none"


def _hi3dgen_normal_bridging(image: Image.Image) -> tuple[Image.Image, bool, Optional[str], str]:
    """
    Ponytail ultra: Simple mock of Hi3DGen dual-stream normal-bridging preconditioning.
    Implements normal-bridging conditioning as an experimental path for geometry enhancement.
    """
    try:
        normals = image.convert("RGB").filter(ImageFilter.FIND_EDGES)
        bridged = Image.blend(image.convert("RGB"), normals, alpha=0.3)
        if "A" in image.getbands():
            bridged.putalpha(image.getchannel("A"))
        return bridged, True, None, "hi3dgen_mock"
    except Exception as e:
        return image, False, str(e), "none"


def _resolve_realesrgan_checkpoint() -> Optional[Path]:
    backend_root = Path(__file__).resolve().parents[2]
    candidates = [
        backend_root / "thirdparty" / "hunyuan3d-paint-v2-1" / "hy3dpaint" / "ckpt" / "RealESRGAN_x4plus.pth",
        backend_root / "pretrained" / "misc" / "RealESRGAN_x4plus.pth",
        backend_root / "pretrained" / "RealESRGAN_x4plus.pth",
    ]
    for candidate in candidates:
        try:
            if candidate.is_file() and candidate.stat().st_size > 1_000_000:
                return candidate
        except OSError:
            continue
    return None


def _realesrgan(image: Image.Image, target_width: int, target_height: int):
    checkpoint = _resolve_realesrgan_checkpoint()
    if checkpoint is None:
        return image, False, "RealESRGAN checkpoint unavailable", "none"

    try:
        import torch
        from basicsr.archs.rrdbnet_arch import RRDBNet
        from realesrgan import RealESRGANer

        scale = max(
            target_width / max(1, image.width),
            target_height / max(1, image.height),
        )
        model = RRDBNet(
            num_in_ch=3,
            num_out_ch=3,
            num_feat=64,
            num_block=23,
            num_grow_ch=32,
            scale=4,
        )
        upsampler = RealESRGANer(
            scale=4,
            model_path=str(checkpoint),
            model=model,
            tile=0,
            tile_pad=10,
            pre_pad=0,
            half=torch.cuda.is_available(),
            device="cuda" if torch.cuda.is_available() else "cpu",
        )
        output, _ = upsampler.enhance(
            np.asarray(image.convert("RGB")),
            outscale=float(max(1.0, min(4.0, scale))),
        )
        enhanced = Image.fromarray(np.asarray(output).astype("uint8"), mode="RGB")
        if "A" in image.getbands():
            alpha = image.getchannel("A").resize(enhanced.size, Image.Resampling.LANCZOS)
            enhanced.putalpha(alpha)
        return enhanced, True, None, "realesrgan_x4plus"
    except Exception as exc:
        return image, False, f"RealESRGAN failed: {exc}", "none"


def _alpha_stats(image: Image.Image) -> Dict[str, Any]:
    if "A" not in image.getbands():
        return {
            "channel_present": False,
            "has_transparency": False,
            "minimum": None,
            "maximum": None,
            "transparent_pixels": 0,
            "soft_pixels": 0,
            "opaque_pixels": 0,
        }
    alpha = np.asarray(image.convert("RGBA").getchannel("A"))
    minimum = int(alpha.min())
    maximum = int(alpha.max())
    return {
        "channel_present": True,
        "has_transparency": minimum < 255 and maximum > 0,
        "minimum": minimum,
        "maximum": maximum,
        "transparent_pixels": int(np.count_nonzero(alpha == 0)),
        "soft_pixels": int(np.count_nonzero((alpha > 0) & (alpha < 255))),
        "opaque_pixels": int(np.count_nonzero(alpha == 255)),
    }


def _alpha_bounds(image: Image.Image):
    if not _alpha_stats(image)["has_transparency"]:
        return None
    alpha = np.asarray(image.convert("RGBA").getchannel("A"))
    ys, xs = np.where(alpha > ALPHA_BOUND_THRESHOLD)
    if len(xs) == 0:
        return None

    trim = int(len(xs) * ALPHA_BOUND_TRIM_FRACTION)
    if trim:
        xs = np.sort(xs)
        ys = np.sort(ys)
        xs = xs[trim:-trim]
        ys = ys[trim:-trim]
    return int(xs.min()), int(ys.min()), int(xs.max() + 1), int(ys.max() + 1)


def _mask_stats(image: Image.Image, source: str) -> Dict[str, Any]:
    alpha_stats = _alpha_stats(image)
    if not alpha_stats["has_transparency"]:
        foreground_pixels = 0
    else:
        alpha = np.asarray(image.convert("RGBA").getchannel("A"))
        foreground_pixels = int(np.count_nonzero(alpha > ALPHA_BOUND_THRESHOLD))
    bounds = _alpha_bounds(image)
    return {
        "source": source,
        "threshold": ALPHA_BOUND_THRESHOLD,
        "bound_trim_fraction": ALPHA_BOUND_TRIM_FRACTION,
        "foreground_pixels": foreground_pixels,
        "bounds": list(bounds) if bounds is not None else None,
        "alpha": alpha_stats,
    }


def _validate_foreground_mask(
    image: Image.Image,
    *,
    initial_bbox_fraction: Optional[float],
    mask_survived_resize: bool,
    require_transparency: bool = True,
) -> Dict[str, Any]:
    alpha_stats = _alpha_stats(image)
    if alpha_stats["channel_present"]:
        alpha = np.asarray(image.convert("RGBA").getchannel("A"))
        mask = alpha > ALPHA_BOUND_THRESHOLD
    else:
        mask = np.zeros((image.height, image.width), dtype=bool)

    total_pixels = max(1, int(mask.size))
    foreground_pixels = int(np.count_nonzero(mask))
    foreground_fraction = foreground_pixels / total_pixels
    bounds = _alpha_bounds(image)
    bbox_fraction = (
        ((bounds[2] - bounds[0]) * (bounds[3] - bounds[1])) / total_pixels
        if bounds
        else 0.0
    )
    border = np.concatenate((mask[0, :], mask[-1, :], mask[:, 0], mask[:, -1]))
    border_coverage = float(np.count_nonzero(border) / max(1, border.size))

    component_count = None
    small_component_fraction = None
    component_analysis_available = True
    if foreground_pixels:
        try:
            from scipy import ndimage

            labels, count = ndimage.label(mask, structure=np.ones((3, 3), dtype=np.uint8))
            component_sizes = np.bincount(labels.ravel())[1:]
            component_count = int(count)
            small_limit = max(4, int(foreground_pixels * 0.001))
            small_component_fraction = float(
                component_sizes[component_sizes <= small_limit].sum() / foreground_pixels
            )
        except ImportError:
            component_analysis_available = False

    crop_improvement = (
        bbox_fraction / initial_bbox_fraction
        if initial_bbox_fraction and initial_bbox_fraction > 0
        else None
    )
    reasons = []
    if require_transparency:
        if not component_analysis_available:
            reasons.append("Connected-component validation is unavailable in this backend runtime.")
        if not alpha_stats["has_transparency"] or foreground_pixels == 0:
            reasons.append("No usable transparent foreground mask was detected.")
        if foreground_fraction < 0.005:
            reasons.append("The detected foreground is nearly empty.")
        if bbox_fraction > 0.98 and alpha_stats["minimum"] is not None and alpha_stats["minimum"] >= 253:
            reasons.append("The foreground fills almost the entire image.")
        if border_coverage > 0.80:
            reasons.append("Foreground mask coverage at the image border is high.")
        if small_component_fraction is not None and small_component_fraction > 0.25:
            reasons.append("The mask contains a high proportion of small disconnected regions.")
        if not mask_survived_resize:
            reasons.append("The foreground mask did not survive resizing.")

    return {
        "valid": not reasons,
        "reasons": reasons,
        "has_transparency": bool(alpha_stats["has_transparency"]),
        "transparent_fraction": float(1.0 - foreground_fraction),
        "foreground_fraction": float(foreground_fraction),
        "foreground_bbox": list(bounds) if bounds else None,
        "bbox_occupancy": float(bbox_fraction),
        "crop_improvement": float(crop_improvement) if crop_improvement is not None else None,
        "border_coverage": border_coverage,
        "connected_components": component_count,
        "small_component_fraction": small_component_fraction,
        "component_analysis_available": component_analysis_available,
        "mask_survived_resize": bool(mask_survived_resize),
    }


inspect_foreground_mask = _validate_foreground_mask
validate_preprocessed_image = _validate_foreground_mask


def _resize_with_alpha(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    if "A" not in image.getbands():
        return image.resize(size, Image.Resampling.LANCZOS)
    rgb = image.convert("RGB").resize(size, Image.Resampling.LANCZOS)
    alpha = image.getchannel("A").resize(size, Image.Resampling.LANCZOS)
    rgb.putalpha(alpha)
    return rgb


def _crop_subject(image: Image.Image):
    bounds = _alpha_bounds(image)
    if bounds is None:
        return image, None

    left, top, right, bottom = bounds
    width = right - left
    height = bottom - top
    left = max(0, left - int(round(width * CROP_PADDING)))
    top = max(0, top - int(round(height * CROP_PADDING)))
    right = min(image.width, right + int(round(width * CROP_PADDING)))
    bottom = min(image.height, bottom + int(round(height * CROP_PADDING)))

    cropped = image.crop((left, top, right, bottom)).convert("RGBA")
    side = max(cropped.width, cropped.height)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.alpha_composite(cropped, ((side - cropped.width) // 2, (side - cropped.height) // 2))
    return canvas, {"left": left, "top": top, "right": right, "bottom": bottom}


def preprocess_image(
    source_path: str,
    *,
    profile: str = "default",
    remove_background: bool = True,
    auto_crop: bool = True,
    upscale: bool = True,
    sharpen: bool = False,
) -> Dict[str, Any]:
    source = _resolve_input(source_path)
    original_hash = _sha256(source)

    try:
        with Image.open(source) as opened:
            image = ImageOps.exif_transpose(opened).copy()
    except Exception as exc:
        raise ValueError(f"Malformed image: {exc}") from exc

    original_mode = image.mode
    original_dimensions = [int(image.width), int(image.height)]
    source_alpha_stats = _alpha_stats(image)
    has_useful_alpha = source_alpha_stats["has_transparency"]
    profile = str(profile or "default").lower()
    if profile not in PROFILE_TARGET_RESOLUTION:
        raise ValueError(f"Unknown preprocessing profile: {profile}")

    # Profiles alter only the shared recipe knobs; model inference remains untouched.
    target_resolution = PROFILE_TARGET_RESOLUTION[profile]
    if profile == "fast":
        upscale = False
        sharpen = False
    elif profile in {"quality", "high_fidelity", "native_detail"}:
        upscale = True
        sharpen = False

    rmbg_used = False
    rmbg_error = None
    rmbg_provider = "none"
    if remove_background and not has_useful_alpha:
        image, rmbg_used, rmbg_error, rmbg_provider = _rmbg(image)

    mask_source = "source_alpha" if has_useful_alpha else "background_removal" if rmbg_used else "none"
    mask_stats = _mask_stats(image, mask_source)
    initial_bounds = _alpha_bounds(image)
    initial_bbox_fraction = (
        ((initial_bounds[2] - initial_bounds[0]) * (initial_bounds[3] - initial_bounds[1]))
        / max(1, image.width * image.height)
        if initial_bounds
        else None
    )
    crop_box = None
    if auto_crop:
        image, crop_box = _crop_subject(image)

    upscale_used = False
    upscale_error = None
    upscale_method = "none"
    mask_survived_resize = True
    if upscale and max(image.width, image.height) < target_resolution:
        had_mask_before_resize = _alpha_stats(image)["has_transparency"]
        alpha_mask = image.getchannel("A") if "A" in image.getbands() else None
        image, upscale_used, upscale_error, upscale_method = _realesrgan(
            image,
            max(target_resolution, image.width),
            max(target_resolution, image.height),
        )
        if alpha_mask is not None:
            image = image.convert("RGB")
            image.putalpha(alpha_mask.resize(image.size, Image.Resampling.LANCZOS))
        if not upscale_used:
            longest_side = max(1, image.width, image.height)
            scale = target_resolution / longest_side
            target_size = (
                max(1, int(round(image.width * scale))),
                max(1, int(round(image.height * scale))),
            )
            image = _resize_with_alpha(image, target_size)
            upscale_used = True
            upscale_method = "pillow_lanczos_fallback"
        mask_survived_resize = (
            not had_mask_before_resize or _alpha_stats(image)["has_transparency"]
        )

    if sharpen:
        image = image.filter(ImageFilter.UnsharpMask(radius=0.8, percent=110, threshold=3))

    hi3dgen_used = False
    hi3dgen_error = None
    hi3dgen_provider = "none"
    if profile == "hi3dgen_normal_bridging":
        image, hi3dgen_used, hi3dgen_error, hi3dgen_provider = _hi3dgen_normal_bridging(image)

    if image.mode != "RGBA" and (source_alpha_stats["channel_present"] or rmbg_used):
        image = image.convert("RGBA")

    foreground_status = (
        "already_transparent" if has_useful_alpha
        else "removed" if rmbg_used
        else "disabled" if not remove_background
        else "failed"
    )
    foreground_validation = _validate_foreground_mask(
        image,
        initial_bbox_fraction=initial_bbox_fraction,
        mask_survived_resize=mask_survived_resize,
        require_transparency=(foreground_status != "disabled"),
    )
    if remove_background and not has_useful_alpha and not rmbg_used:
        approval_status = "failed"
    elif foreground_validation["valid"]:
        approval_status = "approved"
    else:
        approval_status = "needs_review"

    alpha_bounds = _alpha_bounds(image)
    if alpha_bounds:
        left, top, right, bottom = alpha_bounds
        subject_area_fraction = float((right - left) * (bottom - top) / max(1, image.width * image.height))
    else:
        subject_area_fraction = None

    recipe = {
        "version": PREPROCESS_VERSION,
        "profile": profile,
        "target_resolution": target_resolution,
        "remove_background": bool(remove_background),
        "auto_crop": bool(auto_crop),
        "upscale": bool(upscale),
        "sharpen": bool(sharpen),
    }
    artifact_id = hashlib.sha256(
        f"{original_hash}:{json.dumps(recipe, sort_keys=True)}".encode("utf-8")
    ).hexdigest()[:24]

    artifact_root = _storage_root() / artifact_id
    artifact_root.mkdir(parents=True, exist_ok=True)
    preview_path = artifact_root / "preview.png"
    approved_path = artifact_root / "approved.png"
    metadata_path = artifact_root / "metadata.json"
    image.save(preview_path, "PNG")
    if approval_status == "approved":
        image.save(approved_path, "PNG")
    else:
        approved_path.unlink(missing_ok=True)

    metadata = {
        "artifact_id": artifact_id,
        "preprocess_version": PREPROCESS_VERSION,
        "profile": profile,
        "target_resolution": target_resolution,
        "original_sha256": original_hash,
        "original_path": str(source),
        "original_mode": original_mode,
        "original_dimensions": original_dimensions,
        "source_alpha": source_alpha_stats,
        "approval_status": approval_status,
        "foreground_status": foreground_status,
        "foreground_validation": foreground_validation,
        "preview_sha256": _sha256(preview_path),
        "approved_sha256": _sha256(approved_path) if approval_status == "approved" else None,
        "processed_dimensions": [int(image.width), int(image.height)],
        "approved_dimensions": [int(image.width), int(image.height)] if approval_status == "approved" else None,
        "approved_mode": image.mode,
        "remove_background_requested": bool(remove_background),
        "rmbg_used": rmbg_used,
        "rmbg_provider": rmbg_provider,
        "rmbg_error": rmbg_error,
        "auto_crop": bool(auto_crop),
        "crop_box": crop_box,
        "crop_padding_fraction": CROP_PADDING,
        "mask": mask_stats,
        "subject_area_fraction": subject_area_fraction,
        "upscale_requested": bool(upscale),
        "upscaled": upscale_used,
        "upscale_method": upscale_method,
        "upscale_error": upscale_error,
        "sharpened": bool(sharpen),
        "hi3dgen_bridging_used": hi3dgen_used,
        "hi3dgen_bridging_provider": hi3dgen_provider,
        "hi3dgen_bridging_error": hi3dgen_error,
        "recipe": recipe,
    }
    if approval_status != "approved":
        metadata["approval_warning"] = (
            rmbg_error
            or " ".join(foreground_validation["reasons"])
            or "Preprocessed image requires explicit review."
        )
    metadata_path.write_text(json.dumps(metadata, indent=2, sort_keys=True), encoding="utf-8")

    return {
        "artifact_id": artifact_id,
        "preview_path": str(preview_path),
        "approved_path": str(approved_path) if approval_status == "approved" else None,
        "metadata_path": str(metadata_path),
        "metadata": metadata,
        "approval_status": approval_status,
        "warning": rmbg_error or upscale_error or metadata.get("approval_warning"),
    }


def load_preprocessed_artifact(
    artifact_id: str,
    variant: str = "approved",
    *,
    allow_review: bool = False,
):
    if not artifact_id or "/" in artifact_id or "\\" in artifact_id:
        raise ValueError("Invalid preprocessing artifact ID")
    if variant not in {"approved", "preview"}:
        raise ValueError("Invalid preprocessing artifact variant")

    artifact_root = (_storage_root() / artifact_id).resolve()
    allowed = _storage_root().resolve()
    if allowed not in artifact_root.parents:
        raise ValueError("Invalid preprocessing artifact location")

    metadata_path = artifact_root / "metadata.json"
    if not metadata_path.is_file():
        raise FileNotFoundError("Preprocessing artifact not found")
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    if variant == "approved":
        status = metadata.get("approval_status", "legacy_unvalidated")
        if status == "failed":
            raise ValueError("Preprocessing failed and cannot be used for inference")
        if status != "approved":
            if not allow_review or status not in {"needs_review", "disabled", "legacy_unvalidated"}:
                raise ValueError("Preprocessing artifact requires explicit review before inference")
            variant = "preview"
    image_path = artifact_root / f"{variant}.png"
    if not image_path.is_file():
        raise FileNotFoundError("Preprocessing artifact not found")
    return image_path, metadata
