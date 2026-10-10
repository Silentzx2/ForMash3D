"""Phase 1 source contracts and preprocessing tests."""
from pathlib import Path

from PIL import Image

import core.preprocess.image_enhancement as enhancement
from core.preprocess.image_enhancement import preprocess_image
from core.smart_presets import load_smart_presets


def test_preprocessing_rgb_and_low_resolution(tmp_path, monkeypatch):
    root = tmp_path / "preprocessed"
    monkeypatch.setattr(enhancement, "_storage_root", lambda: root)
    monkeypatch.setattr(
        enhancement,
        "_rmbg",
        lambda image: (image, False, "disabled in test", "none"),
    )
    monkeypatch.setattr(
        enhancement,
        "_realesrgan",
        lambda image, width, height: (image, False, "checkpoint unavailable", "none"),
    )

    source = tmp_path / "rgb.png"
    Image.new("RGB", (256, 180), (20, 30, 40)).save(source)
    result = preprocess_image(
        str(source),
        remove_background=False,
        auto_crop=False,
        upscale=True,
    )

    assert result["metadata"]["original_dimensions"] == [256, 180]
    assert result["metadata"]["upscaled"] is True
    assert result["metadata"]["upscale_method"] == "pillow_lanczos_fallback"
    assert Path(result["approved_path"]).is_file()
    assert result["metadata"]["original_sha256"]
    assert result["metadata"]["approved_sha256"]


def test_preprocessing_rgba_and_high_resolution_are_preserved(tmp_path, monkeypatch):
    root = tmp_path / "preprocessed"
    monkeypatch.setattr(enhancement, "_storage_root", lambda: root)
    source = tmp_path / "rgba.png"
    image = Image.new("RGBA", (1600, 1200), (0, 0, 0, 0))
    image.paste((255, 10, 20, 255), (300, 200, 1300, 1000))
    image.save(source)

    result = preprocess_image(str(source), remove_background=True, auto_crop=False, upscale=True)

    assert result["metadata"]["upscaled"] is False
    assert result["metadata"]["approved_dimensions"] == [1600, 1200]
    assert result["metadata"]["rmbg_used"] is False
    assert result["metadata"]["approved_mode"] == "RGBA"


def test_preprocessing_subject_crop_bounds(tmp_path, monkeypatch):
    root = tmp_path / "preprocessed"
    monkeypatch.setattr(enhancement, "_storage_root", lambda: root)
    source = tmp_path / "rgba.png"
    image = Image.new("RGBA", (300, 200), (0, 0, 0, 0))
    image.paste((255, 10, 20, 255), (90, 40, 210, 160))
    image.save(source)

    result = preprocess_image(str(source), remove_background=False, auto_crop=True, upscale=False)
    assert result["metadata"]["crop_box"] == {"left": 80, "top": 30, "right": 220, "bottom": 170}


def test_preprocessing_is_deterministic_and_reuses_approved_hash(tmp_path, monkeypatch):
    root = tmp_path / "preprocessed"
    monkeypatch.setattr(enhancement, "_storage_root", lambda: root)
    source = tmp_path / "source.png"
    Image.new("RGB", (640, 480), (1, 2, 3)).save(source)

    first = preprocess_image(str(source), remove_background=False, auto_crop=False, upscale=False)
    second = preprocess_image(str(source), remove_background=False, auto_crop=False, upscale=False)

    assert first["artifact_id"] == second["artifact_id"]
    assert first["metadata"]["approved_sha256"] == second["metadata"]["approved_sha256"]
    assert Path(second["approved_path"]).read_bytes() == Path(first["approved_path"]).read_bytes()


def test_preprocessing_malformed_image(tmp_path, monkeypatch):
    root = tmp_path / "preprocessed"
    monkeypatch.setattr(enhancement, "_storage_root", lambda: root)
    source = tmp_path / "broken.png"
    source.write_bytes(b"not-an-image")
    try:
        preprocess_image(str(source))
    except ValueError as exc:
        assert "Malformed image" in str(exc)
    else:
        raise AssertionError("Malformed image must be rejected")




def test_rmbg_unavailable_is_explicit(tmp_path, monkeypatch):
    root = tmp_path / "preprocessed"
    monkeypatch.setattr(enhancement, "_storage_root", lambda: root)
    monkeypatch.setattr(
        enhancement,
        "_rmbg",
        lambda image: (image, False, "RMBG unavailable", "none"),
    )
    source = tmp_path / "complex.png"
    image = Image.new("RGB", (1200, 900), (80, 90, 100))
    image.save(source)

    result = preprocess_image(
        str(source),
        remove_background=True,
        auto_crop=True,
        upscale=False,
    )

    assert result["metadata"]["rmbg_used"] is False
    assert "unavailable" in result["metadata"]["rmbg_error"].lower()
    assert result["metadata"]["approved_sha256"]


def test_smart_presets_are_complete_and_unique():
    intents = load_smart_presets()["intents"]
    assert set(intents) == {"game_ready", "cinematic", "animation", "3d_print", "mobile"}
    for preset in intents.values():
        assert preset["model_priority"]
        assert preset["preferred_features"]
        assert "target_polycount" in preset
        assert "texture_resolution" in preset
        assert "enable_printability_check" in preset
        assert "enable_auto_rig" in preset


def test_phase1_wiring_markers():
    pipeline = Path("postprocess/pipeline.py").read_text(encoding="utf-8")
    scheduler = Path("core/scheduler/multiprocess_scheduler.py").read_text(encoding="utf-8")
    generation = Path("api/routers/mesh_generation.py").read_text(encoding="utf-8")

    assert "enable_printability_check" in pipeline
    assert "printability_failed" in pipeline
    assert "enable_auto_repair" in pipeline
    assert "enable_auto_rig" in scheduler
    assert "_watch_auto_rig" in scheduler
    assert 'feature="auto_rig"' in scheduler
    assert 'postprocess_mode == "production_mesh"' in scheduler
    assert "artifact_format=rigged" in scheduler or "artifact_format=rigged" in Path("api/routers/system.py").read_text(encoding="utf-8")
    assert "preprocessing_artifact_id" in generation
    assert "enable_printability_check" in generation
    assert "intent" in generation
