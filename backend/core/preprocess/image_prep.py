"""Pure Pillow / numpy input image preparation module for 3D generation."""
from __future__ import annotations

import io
from pathlib import Path
from typing import Any, BinaryIO, Dict, Optional, Tuple, Union

import numpy as np
from PIL import Image, ImageOps


def _to_pil_image(image_input: Union[Image.Image, str, Path, bytes, BinaryIO, np.ndarray]) -> Image.Image:
    """Load and return an unmutated PIL Image copy from diverse input types."""
    if isinstance(image_input, Image.Image):
        # Explicit copy guarantees the original image object is never mutated
        img = image_input.copy()
    elif isinstance(image_input, (str, Path)):
        path = Path(image_input)
        if not path.is_file():
            raise FileNotFoundError(f"Image file not found: {image_input}")
        with Image.open(path) as loaded:
            img = loaded.copy()
    elif isinstance(image_input, bytes):
        with Image.open(io.BytesIO(image_input)) as loaded:
            img = loaded.copy()
    elif isinstance(image_input, io.IOBase):
        with Image.open(image_input) as loaded:
            img = loaded.copy()
    elif isinstance(image_input, np.ndarray):
        img = Image.fromarray(image_input.copy())
    else:
        raise TypeError(f"Unsupported image input type: {type(image_input)}")

    # Respect EXIF orientation without mutating the caller's data
    return ImageOps.exif_transpose(img)


def _detect_background_color(arr_rgb: np.ndarray) -> np.ndarray:
    """Estimate background color from image corners."""
    h, w = arr_rgb.shape[:2]
    cw = max(1, min(5, w // 4))
    ch = max(1, min(5, h // 4))
    corners = np.concatenate(
        [
            arr_rgb[0:ch, 0:cw].reshape(-1, 3),
            arr_rgb[0:ch, w - cw : w].reshape(-1, 3),
            arr_rgb[h - ch : h, 0:cw].reshape(-1, 3),
            arr_rgb[h - ch : h, w - cw : w].reshape(-1, 3),
        ],
        axis=0,
    )
    return np.median(corners, axis=0)


def _get_subject_mask(
    image: Image.Image,
    alpha_threshold: int = 10,
    bg_tolerance: float = 25.0,
) -> np.ndarray:
    """Compute boolean 2D mask of foreground subject pixels."""
    if "A" in image.getbands():
        alpha = np.asarray(image.getchannel("A"))
        has_transparency = bool((alpha < 255).any())
        if has_transparency:
            return alpha > alpha_threshold

    # Fallback to color-distance from background corners for opaque images
    rgb_arr = np.asarray(image.convert("RGB"))
    bg_color = _detect_background_color(rgb_arr)
    diff = np.linalg.norm(rgb_arr.astype(np.float32) - bg_color.astype(np.float32), axis=-1)
    mask = diff > bg_tolerance

    # If mask is empty or covers the entire image uniformly, treat entire frame as foreground
    if not np.any(mask) or np.all(mask):
        return np.ones((image.height, image.width), dtype=bool)
    return mask


def _cleanup_alpha(image: Image.Image, alpha_threshold: int = 10) -> Image.Image:
    """Clean up near-zero alpha values in an RGBA image."""
    rgba = image.convert("RGBA")
    arr = np.asarray(rgba).copy()
    alpha = arr[:, :, 3]
    arr[alpha <= alpha_threshold, 3] = 0
    return Image.fromarray(arr, mode="RGBA")


def _remove_solid_background(image: Image.Image, tolerance: float = 25.0) -> Image.Image:
    """Pure numpy/Pillow removal of solid/near-solid background."""
    rgb = image.convert("RGB")
    rgb_arr = np.asarray(rgb)
    bg_color = _detect_background_color(rgb_arr)
    diff = np.linalg.norm(rgb_arr.astype(np.float32) - bg_color.astype(np.float32), axis=-1)

    alpha = np.where(diff > tolerance, 255, 0).astype(np.uint8)
    rgba_arr = np.dstack((rgb_arr, alpha))
    return Image.fromarray(rgba_arr, mode="RGBA")


def validate_image_aspect_and_occupancy(image: Image.Image) -> Dict[str, Any]:
    """
    Validate image geometry, subject occupancy, aspect ratio, and border contact.

    Returns:
        dict containing:
        - width: int
        - height: int
        - aspect_ratio: float (width / height)
        - occupancy_ratio: float (foreground pixels / total pixels)
        - foreground_occupancy: float (synonym for occupancy_ratio)
        - bbox_occupancy: float (bbox area / total pixels)
        - bbox: Optional[Tuple[int, int, int, int]] (min_x, min_y, max_x, max_y)
        - border_contact: bool (True if foreground touches any image edge)
        - border_coverage: float (fraction of border pixels that are foreground)
        - touches_borders: Dict[str, bool] (contact on top, bottom, left, right)
        - has_transparency: bool
        - is_valid: bool
        - warnings: list[str]
    """
    w, h = image.width, image.height
    total_pixels = max(1, w * h)
    aspect_ratio = float(w) / float(max(1, h))

    has_transparency = False
    if "A" in image.getbands():
        alpha = np.asarray(image.getchannel("A"))
        has_transparency = bool((alpha < 255).any())
        if has_transparency:
            mask = alpha > 10
        else:
            mask = np.ones((h, w), dtype=bool)
    else:
        mask = _get_subject_mask(image)

    foreground_pixels = int(np.count_nonzero(mask))
    occupancy_ratio = float(foreground_pixels) / float(total_pixels)

    border_pixels = np.concatenate((mask[0, :], mask[-1, :], mask[:, 0], mask[:, -1]))
    border_contact_count = int(np.count_nonzero(border_pixels))
    border_contact = border_contact_count > 0
    border_coverage = float(border_contact_count) / float(max(1, border_pixels.size))

    touches_top = bool(np.any(mask[0, :]))
    touches_bottom = bool(np.any(mask[-1, :]))
    touches_left = bool(np.any(mask[:, 0]))
    touches_right = bool(np.any(mask[:, -1]))

    bbox = None
    bbox_occupancy = 0.0
    if foreground_pixels > 0:
        ys, xs = np.nonzero(mask)
        min_x, max_x = int(np.min(xs)), int(np.max(xs)) + 1
        min_y, max_y = int(np.min(ys)), int(np.max(ys)) + 1
        bbox = (min_x, min_y, max_x, max_y)
        bbox_w = max_x - min_x
        bbox_h = max_y - min_y
        bbox_occupancy = float(bbox_w * bbox_h) / float(total_pixels)

    warnings = []
    if foreground_pixels == 0:
        warnings.append("No foreground subject detected (image is empty or fully transparent).")
    elif occupancy_ratio < 0.01:
        warnings.append("Foreground occupancy is extremely low (< 1%).")

    if border_contact and has_transparency:
        warnings.append("Subject touches image border, which may lead to clipping in 3D reconstruction.")

    is_valid = foreground_pixels > 0 and (occupancy_ratio >= 0.005)

    return {
        "width": w,
        "height": h,
        "aspect_ratio": round(aspect_ratio, 4),
        "occupancy_ratio": round(occupancy_ratio, 4),
        "foreground_occupancy": round(occupancy_ratio, 4),
        "bbox_occupancy": round(bbox_occupancy, 4),
        "bbox": bbox,
        "border_contact": border_contact,
        "border_coverage": round(border_coverage, 4),
        "touches_borders": {
            "top": touches_top,
            "bottom": touches_bottom,
            "left": touches_left,
            "right": touches_right,
        },
        "has_transparency": has_transparency,
        "is_valid": is_valid,
        "warnings": warnings,
    }


def prepare_input_image(
    image_input: Union[Image.Image, str, Path, bytes, BinaryIO, np.ndarray],
    prep_flags: Optional[Dict[str, Any]] = None,
    target_size: Optional[Tuple[int, int]] = (1024, 1024),
) -> Image.Image:
    """
    Prepare and normalize input image for 3D generation.

    Guarantees:
    - Pure Pillow / numpy implementation (never mutates original file or image).
    - Preserves aspect ratio with transparent letterbox centering.

    Supported prep_flags:
    - remove_background: bool (default False; cleans alpha if present, or removes solid background)
    - tight_crop: bool (default True; crops to subject bounding box with margin)
    - crop_margin / margin: float (default 0.10 for 10% padding)
    - target_size: Optional[Tuple[int, int]] (overrides target_size argument if provided)
    - upscale_if_small: bool (default True; resamples using LANCZOS if min dim < threshold)
    - small_threshold: int (default 256; minimum dimension threshold for upscaling)
    - alpha_threshold: int (default 10; alpha values <= threshold are considered transparent)
    - bg_tolerance: float (default 25.0; color distance threshold for solid bg removal)
    """
    flags = dict(prep_flags) if prep_flags is not None else {}

    # 1. Load fresh image copy (never mutate original)
    image = _to_pil_image(image_input)

    # Resolve options
    remove_bg = bool(flags.get("remove_background", False))
    tight_crop = bool(flags.get("tight_crop", True))
    raw_margin = flags.get("crop_margin", flags.get("margin", flags.get("margin_pct", 0.10)))
    margin = float(raw_margin) / 100.0 if float(raw_margin) > 1.0 else max(0.0, float(raw_margin))
    upscale_small = bool(flags.get("upscale_if_small", False))
    small_threshold = int(flags.get("small_threshold", 256))
    alpha_thresh = int(flags.get("alpha_threshold", 10))
    bg_tol = float(flags.get("bg_tolerance", 25.0))

    if "target_size" in flags:
        target_size = flags["target_size"]

    # 2. Background handling / alpha cleanup
    has_alpha = "A" in image.getbands()
    if has_alpha:
        image = _cleanup_alpha(image, alpha_threshold=alpha_thresh)
    elif remove_bg:
        image = _remove_solid_background(image, tolerance=bg_tol)
    else:
        image = image.convert("RGBA")

    # 3. Tight crop to subject with margin
    if tight_crop:
        mask = _get_subject_mask(image, alpha_threshold=alpha_thresh, bg_tolerance=bg_tol)
        if np.any(mask):
            ys, xs = np.nonzero(mask)
            min_x, max_x = int(np.min(xs)), int(np.max(xs)) + 1
            min_y, max_y = int(np.min(ys)), int(np.max(ys)) + 1
            bw = max_x - min_x
            bh = max_y - min_y

            pad_x = int(round(bw * margin))
            pad_y = int(round(bh * margin))

            crop_l = min_x - pad_x
            crop_t = min_y - pad_y
            crop_r = max_x + pad_x
            crop_b = max_y + pad_y

            # Pillow RGBA crop automatically pads out-of-bounds regions with transparent pixels (0, 0, 0, 0)
            image = image.crop((crop_l, crop_t, crop_r, crop_b))

    # 4. Upscale if small
    if upscale_small and min(image.width, image.height) < small_threshold:
        scale = float(small_threshold) / float(min(image.width, image.height))
        up_w = max(1, int(round(image.width * scale)))
        up_h = max(1, int(round(image.height * scale)))
        image = image.resize((up_w, up_h), resample=Image.Resampling.LANCZOS)

    # 5. Target size letterboxing with aspect-ratio preservation
    if target_size is not None:
        target_w, target_h = int(target_size[0]), int(target_size[1])
        src_w, src_h = image.width, image.height

        scale = min(float(target_w) / float(src_w), float(target_h) / float(src_h))
        fit_w = max(1, int(round(src_w * scale)))
        fit_h = max(1, int(round(src_h * scale)))

        if (fit_w, fit_h) != (src_w, src_h):
            image = image.resize((fit_w, fit_h), resample=Image.Resampling.LANCZOS)

        canvas = Image.new("RGBA", (target_w, target_h), (0, 0, 0, 0))
        offset_x = (target_w - fit_w) // 2
        offset_y = (target_h - fit_h) // 2
        canvas.paste(image, (offset_x, offset_y))
        image = canvas

    return image
