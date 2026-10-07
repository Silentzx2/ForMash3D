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
}
CROP_PADDING = 0.08


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
        return (
            Image.fromarray(np.asarray(output).astype("uint8"), mode="RGB"),
            True,
            None,
            "realesrgan_x4plus",
        )
    except Exception as exc:
        return image, False, f"RealESRGAN failed: {exc}", "none"


def _alpha_bounds(image: Image.Image):
    if "A" not in image.getbands():
        return None
    alpha = np.asarray(image.convert("RGBA").getchannel("A"))
    ys, xs = np.where(alpha > 8)
    if len(xs) == 0:
        return None
    return int(xs.min()), int(ys.min()), int(xs.max() + 1), int(ys.max() + 1)


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
    had_alpha = "A" in image.getbands()
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
    if remove_background and not had_alpha:
        image, rmbg_used, rmbg_error, rmbg_provider = _rmbg(image)

    crop_box = None
    if auto_crop:
        image, crop_box = _crop_subject(image)

    upscale_used = False
    upscale_error = None
    upscale_method = "none"
    if upscale and max(image.width, image.height) < target_resolution:
        image, upscale_used, upscale_error, upscale_method = _realesrgan(
            image,
            max(target_resolution, image.width),
            max(target_resolution, image.height),
        )
        if not upscale_used:
            longest_side = max(1, image.width, image.height)
            scale = target_resolution / longest_side
            target_size = (
                max(1, int(round(image.width * scale))),
                max(1, int(round(image.height * scale))),
            )
            image = image.resize(target_size, Image.Resampling.LANCZOS)
            upscale_used = True
            upscale_method = "pillow_lanczos_fallback"

    if sharpen:
        image = image.filter(ImageFilter.UnsharpMask(radius=0.8, percent=110, threshold=3))

    if image.mode != "RGBA" and (had_alpha or rmbg_used):
        image = image.convert("RGBA")

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
    image.save(approved_path, "PNG")

    metadata = {
        "artifact_id": artifact_id,
        "preprocess_version": PREPROCESS_VERSION,
        "profile": profile,
        "target_resolution": target_resolution,
        "original_sha256": original_hash,
        "original_path": str(source),
        "original_mode": original_mode,
        "original_dimensions": original_dimensions,
        "approved_sha256": _sha256(approved_path),
        "approved_dimensions": [int(image.width), int(image.height)],
        "approved_mode": image.mode,
        "remove_background_requested": bool(remove_background),
        "rmbg_used": rmbg_used,
        "rmbg_provider": rmbg_provider,
        "rmbg_error": rmbg_error,
        "auto_crop": bool(auto_crop),
        "crop_box": crop_box,
        "subject_area_fraction": subject_area_fraction,
        "upscale_requested": bool(upscale),
        "upscaled": upscale_used,
        "upscale_method": upscale_method,
        "upscale_error": upscale_error,
        "sharpened": bool(sharpen),
        "recipe": recipe,
    }
    metadata_path.write_text(json.dumps(metadata, indent=2, sort_keys=True), encoding="utf-8")

    return {
        "artifact_id": artifact_id,
        "preview_path": str(preview_path),
        "approved_path": str(approved_path),
        "metadata_path": str(metadata_path),
        "metadata": metadata,
        "warning": rmbg_error or upscale_error,
    }


def load_preprocessed_artifact(artifact_id: str, variant: str = "approved"):
    if not artifact_id or "/" in artifact_id or "\\" in artifact_id:
        raise ValueError("Invalid preprocessing artifact ID")
    if variant not in {"approved", "preview"}:
        raise ValueError("Invalid preprocessing artifact variant")

    artifact_root = (_storage_root() / artifact_id).resolve()
    allowed = _storage_root().resolve()
    if allowed not in artifact_root.parents:
        raise ValueError("Invalid preprocessing artifact location")

    image_path = artifact_root / f"{variant}.png"
    metadata_path = artifact_root / "metadata.json"
    if not image_path.is_file() or not metadata_path.is_file():
        raise FileNotFoundError("Preprocessing artifact not found")
    return image_path, json.loads(metadata_path.read_text(encoding="utf-8"))
