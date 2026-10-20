import hashlib
import io
from pathlib import Path
from typing import Optional

import numpy as np
import pytest
from PIL import Image

from core.preprocess.image_prep import (
    prepare_input_image,
    validate_image_aspect_and_occupancy,
)


def _create_rgba_test_image(
    canvas_size: tuple[int, int] = (500, 500),
    subject_box: Optional[tuple[int, int, int, int]] = None,
    subject_color: tuple[int, int, int, int] = (220, 50, 50, 255),
    bg_color: tuple[int, int, int, int] = (0, 0, 0, 0),
) -> Image.Image:
    """Helper to generate predictable RGBA images with centered or positioned boxes."""
    img = Image.new("RGBA", canvas_size, bg_color)
    if subject_box is None:
        w, h = canvas_size
        subject_box = (w // 4, h // 4, 3 * w // 4, 3 * h // 4)
    x0, y0, x1, y1 = subject_box
    for x in range(x0, x1):
        for y in range(y0, y1):
            img.putpixel((x, y), subject_color)
    return img


def test_preserving_original_image_untouched(tmp_path):
    """Verify in-memory PIL image, numpy array, and disk files are never mutated."""
    # 1. In-memory PIL Image
    orig_img = _create_rgba_test_image(
        canvas_size=(200, 200),
        subject_box=(50, 50, 150, 150),
        subject_color=(10, 20, 30, 255),
    )
    orig_bytes_before = orig_img.tobytes()
    orig_size_before = orig_img.size
    orig_mode_before = orig_img.mode

    processed = prepare_input_image(
        orig_img,
        prep_flags={"tight_crop": True, "margin": 0.10},
        target_size=(1024, 1024),
    )

    assert orig_img.size == orig_size_before
    assert orig_img.mode == orig_mode_before
    assert orig_img.tobytes() == orig_bytes_before
    assert processed is not orig_img

    # 2. File on disk
    file_path = tmp_path / "original_subject.png"
    orig_img.save(file_path)
    file_bytes_before = file_path.read_bytes()
    sha_before = hashlib.sha256(file_bytes_before).hexdigest()

    file_processed = prepare_input_image(
        file_path,
        prep_flags={"tight_crop": True},
        target_size=(512, 512),
    )

    file_bytes_after = file_path.read_bytes()
    sha_after = hashlib.sha256(file_bytes_after).hexdigest()
    assert sha_after == sha_before
    assert file_processed.size == (512, 512)

    # 3. Numpy array
    np_arr = np.zeros((100, 100, 4), dtype=np.uint8)
    np_arr[20:80, 20:80] = [200, 100, 50, 255]
    np_arr_before = np_arr.copy()

    np_processed = prepare_input_image(np_arr, target_size=(256, 256))
    np.testing.assert_array_equal(np_arr, np_arr_before)
    assert np_processed.size == (256, 256)


def test_tight_centered_crop_with_margin():
    """Verify cropping closely around subject bounds with configurable margin."""
    # 500x500 canvas with a 100x100 subject from (200, 200) to (300, 300)
    source = _create_rgba_test_image(
        canvas_size=(500, 500),
        subject_box=(200, 200, 300, 300),
    )

    # Margin 10% (0.10): subject width=100 -> pad_x=10, height=100 -> pad_y=10
    # Expected cropped size = (120, 120) with subject centered at (10, 10)
    cropped_10 = prepare_input_image(
        source,
        prep_flags={"tight_crop": True, "margin": 0.10},
        target_size=None,
    )
    assert cropped_10.size == (120, 120)
    # Check 10px transparent border on all four corners
    assert cropped_10.getpixel((5, 5)) == (0, 0, 0, 0)
    assert cropped_10.getpixel((115, 5)) == (0, 0, 0, 0)
    assert cropped_10.getpixel((5, 115)) == (0, 0, 0, 0)
    assert cropped_10.getpixel((115, 115)) == (0, 0, 0, 0)
    # Check subject inside is centered
    assert cropped_10.getpixel((60, 60))[3] == 255

    # Margin 20% (0.20) -> padding 20px -> size (140, 140)
    cropped_20 = prepare_input_image(
        source,
        prep_flags={"tight_crop": True, "margin": 0.20},
        target_size=None,
    )
    assert cropped_20.size == (140, 140)

    # Margin 0.0 -> exact subject bounds -> size (100, 100)
    cropped_0 = prepare_input_image(
        source,
        prep_flags={"tight_crop": True, "margin": 0.0},
        target_size=None,
    )
    assert cropped_0.size == (100, 100)
    assert cropped_0.getpixel((0, 0))[3] == 255
    assert cropped_0.getpixel((99, 99))[3] == 255

    # Margin specified as percentage integer (e.g. 10 instead of 0.10)
    cropped_pct = prepare_input_image(
        source,
        prep_flags={"tight_crop": True, "margin_pct": 10},
        target_size=None,
    )
    assert cropped_pct.size == (120, 120)


def test_resizing_with_aspect_ratio_preservation():
    """Verify resizing preserves original subject aspect ratio without distortion."""
    # Wide subject: 300x100 (3:1 aspect ratio)
    source = _create_rgba_test_image(
        canvas_size=(600, 600),
        subject_box=(100, 200, 400, 300),
    )

    result = prepare_input_image(
        source,
        prep_flags={"tight_crop": True, "margin": 0.0},
        target_size=(1024, 1024),
    )
    assert result.size == (1024, 1024)

    # In 1024x1024, subject scaled by 1024/300 ≈ 3.4133 -> width 1024, height 341
    # Check non-transparent bbox
    val = validate_image_aspect_and_occupancy(result)
    bbox = val["bbox"]
    assert bbox is not None
    x0, y0, x1, y1 = bbox
    subj_w = x1 - x0
    subj_h = y1 - y0

    assert subj_w == 1024
    assert 340 <= subj_h <= 342
    aspect = float(subj_w) / float(subj_h)
    assert pytest.approx(aspect, rel=0.02) == 3.0


def test_transparent_letterbox_centering():
    """Verify non-square subjects are centered with transparent letterboxing/pillarboxing."""
    # 1. Wide subject (letterboxing top and bottom)
    wide_img = _create_rgba_test_image(
        canvas_size=(400, 400),
        subject_box=(50, 150, 350, 250),  # 300x100 -> 3:1
    )
    wide_result = prepare_input_image(
        wide_img,
        prep_flags={"tight_crop": True, "margin": 0.0},
        target_size=(1024, 1024),
    )
    assert wide_result.size == (1024, 1024)

    val_wide = validate_image_aspect_and_occupancy(wide_result)
    min_x, min_y, max_x, max_y = val_wide["bbox"]

    # Centered horizontally: fills full width 0..1024
    assert min_x == 0
    assert max_x == 1024
    # Centered vertically: height ~341, top & bottom padding ~341px
    assert 335 <= min_y <= 345
    assert 675 <= max_y <= 685
    # Letterbox rows are transparent
    assert wide_result.getpixel((512, 100)) == (0, 0, 0, 0)
    assert wide_result.getpixel((512, 900)) == (0, 0, 0, 0)
    # Center is solid
    assert wide_result.getpixel((512, 512))[3] == 255

    # 2. Tall subject (pillarboxing left and right)
    tall_img = _create_rgba_test_image(
        canvas_size=(400, 400),
        subject_box=(150, 50, 250, 350),  # 100x300 -> 1:3
    )
    tall_result = prepare_input_image(
        tall_img,
        prep_flags={"tight_crop": True, "margin": 0.0},
        target_size=(1024, 1024),
    )
    assert tall_result.size == (1024, 1024)

    val_tall = validate_image_aspect_and_occupancy(tall_result)
    t_min_x, t_min_y, t_max_x, t_max_y = val_tall["bbox"]

    # Centered vertically: fills full height 0..1024
    assert t_min_y == 0
    assert t_max_y == 1024
    # Centered horizontally: width ~341, left & right padding ~341px
    assert 335 <= t_min_x <= 345
    assert 675 <= t_max_x <= 685
    # Pillarbox columns are transparent
    assert tall_result.getpixel((100, 512)) == (0, 0, 0, 0)
    assert tall_result.getpixel((900, 512)) == (0, 0, 0, 0)
    # Center is solid
    assert tall_result.getpixel((512, 512))[3] == 255


def test_upscaling_small_images():
    """Verify small images are upscaled to at least small_threshold using Lanczos resampling."""
    small_img = _create_rgba_test_image(
        canvas_size=(64, 64),
        subject_box=(16, 16, 48, 48),
    )

    # Upscaling enabled without letterboxing
    upscaled = prepare_input_image(
        small_img,
        prep_flags={"tight_crop": False, "upscale_if_small": True, "small_threshold": 256},
        target_size=None,
    )
    assert min(upscaled.width, upscaled.height) >= 256
    assert upscaled.size == (256, 256)

    # Upscaling disabled without letterboxing
    no_upscale = prepare_input_image(
        small_img,
        prep_flags={"tight_crop": False, "upscale_if_small": False},
        target_size=None,
    )
    assert no_upscale.size == (64, 64)


def test_occupancy_and_border_contact_calculation():
    """Verify validate_image_aspect_and_occupancy returns correct metrics."""
    # 1. 200x200 image with 100x100 centered square -> occupancy = 10,000 / 40,000 = 0.25 (25%)
    centered_img = _create_rgba_test_image(
        canvas_size=(200, 200),
        subject_box=(50, 50, 150, 150),
    )
    v1 = validate_image_aspect_and_occupancy(centered_img)
    assert v1["aspect_ratio"] == 1.0
    assert v1["occupancy_ratio"] == pytest.approx(0.25, abs=0.001)
    assert v1["foreground_occupancy"] == pytest.approx(0.25, abs=0.001)
    assert v1["bbox_occupancy"] == pytest.approx(0.25, abs=0.001)
    assert v1["border_contact"] is False
    assert v1["border_coverage"] == 0.0
    assert not any(v1["touches_borders"].values())
    assert v1["is_valid"] is True

    # 2. Image touching top border
    border_img = _create_rgba_test_image(
        canvas_size=(200, 100),
        subject_box=(40, 0, 160, 50),
    )
    v2 = validate_image_aspect_and_occupancy(border_img)
    assert v2["aspect_ratio"] == 2.0
    assert v2["border_contact"] is True
    assert v2["touches_borders"]["top"] is True
    assert v2["touches_borders"]["bottom"] is False
    assert v2["border_coverage"] > 0.0

    # 3. Completely transparent empty image
    empty_img = Image.new("RGBA", (100, 100), (0, 0, 0, 0))
    v3 = validate_image_aspect_and_occupancy(empty_img)
    assert v3["occupancy_ratio"] == 0.0
    assert v3["bbox"] is None
    assert v3["is_valid"] is False
    assert len(v3["warnings"]) > 0


def test_remove_background_and_alpha_cleanup():
    """Verify alpha cleanup removes weak noise and remove_background strips solid backdrop."""
    # 1. Weak alpha noise cleanup
    img_with_noise = Image.new("RGBA", (100, 100), (0, 0, 0, 0))
    # Weak noise pixel
    img_with_noise.putpixel((10, 10), (255, 255, 255, 5))
    # Solid subject
    for x in range(40, 60):
        for y in range(40, 60):
            img_with_noise.putpixel((x, y), (255, 0, 0, 255))

    cleaned = prepare_input_image(
        img_with_noise,
        prep_flags={"alpha_threshold": 10, "tight_crop": False, "upscale_if_small": False},
        target_size=None,
    )
    assert cleaned.size == (100, 100)
    assert cleaned.getpixel((10, 10))[3] == 0
    assert cleaned.getpixel((50, 50))[3] == 255

    # 2. Solid white backdrop RGB image
    rgb_arr = np.ones((120, 120, 3), dtype=np.uint8) * 255
    # Red box in center
    rgb_arr[40:80, 40:80] = [200, 30, 30]
    rgb_img = Image.fromarray(rgb_arr, mode="RGB")

    bg_removed = prepare_input_image(
        rgb_img,
        prep_flags={"remove_background": True, "tight_crop": False, "upscale_if_small": False},
        target_size=None,
    )
    assert bg_removed.mode == "RGBA"
    # Corner that was white is now transparent
    assert bg_removed.getpixel((5, 5))[3] == 0
    # Center that was red is still opaque
    assert bg_removed.getpixel((60, 60))[3] == 255


def test_various_input_formats():
    """Verify prepare_input_image handles bytes, BytesIO, strings, and Paths."""
    base = _create_rgba_test_image(canvas_size=(100, 100))
    buffer = io.BytesIO()
    base.save(buffer, format="PNG")
    raw_bytes = buffer.getvalue()

    # bytes
    res_bytes = prepare_input_image(raw_bytes, target_size=(256, 256))
    assert res_bytes.size == (256, 256)

    # BytesIO
    buffer.seek(0)
    res_io = prepare_input_image(buffer, target_size=(256, 256))
    assert res_io.size == (256, 256)


def test_target_size_in_prep_flags():
    """Verify target_size inside prep_flags overrides default argument."""
    source = _create_rgba_test_image(canvas_size=(200, 200))
    res = prepare_input_image(
        source,
        prep_flags={"target_size": (800, 600)},
        target_size=(1024, 1024),
    )
    assert res.size == (800, 600)


def test_invalid_input_types_and_missing_file():
    """Verify informative errors on invalid input types and missing files."""
    with pytest.raises(TypeError, match="Unsupported image input type"):
        prepare_input_image(12345)

    with pytest.raises(TypeError, match="Unsupported image input type"):
        prepare_input_image(["not", "an", "image"])

    with pytest.raises(FileNotFoundError, match="Image file not found"):
        prepare_input_image("non_existent_file_12345.png")


def test_empty_image_processing_graceful():
    """Verify completely empty transparent image is handled gracefully without crash."""
    empty = Image.new("RGBA", (100, 100), (0, 0, 0, 0))
    res = prepare_input_image(empty, prep_flags={"tight_crop": True}, target_size=(512, 512))
    assert res.size == (512, 512)
    # Entire result remains transparent
    val = validate_image_aspect_and_occupancy(res)
    assert val["occupancy_ratio"] == 0.0


def test_all_borders_contact_detection():
    """Verify bottom, left, and right borders are individually and accurately detected."""
    # Bottom border
    img_b = _create_rgba_test_image(canvas_size=(100, 100), subject_box=(20, 80, 80, 100))
    vb = validate_image_aspect_and_occupancy(img_b)
    assert vb["touches_borders"]["bottom"] is True
    assert vb["touches_borders"]["top"] is False

    # Left border
    img_l = _create_rgba_test_image(canvas_size=(100, 100), subject_box=(0, 20, 20, 80))
    vl = validate_image_aspect_and_occupancy(img_l)
    assert vl["touches_borders"]["left"] is True
    assert vl["touches_borders"]["right"] is False

    # Right border
    img_r = _create_rgba_test_image(canvas_size=(100, 100), subject_box=(80, 20, 100, 80))
    vr = validate_image_aspect_and_occupancy(img_r)
    assert vr["touches_borders"]["right"] is True
    assert vr["touches_borders"]["left"] is False


def test_opaque_rgb_occupancy_validation():
    """Verify validation works on standard RGB images."""
    rgb = Image.new("RGB", (200, 100), (128, 128, 128))
    v = validate_image_aspect_and_occupancy(rgb)
    assert v["aspect_ratio"] == 2.0
    assert v["has_transparency"] is False
    assert v["occupancy_ratio"] > 0
