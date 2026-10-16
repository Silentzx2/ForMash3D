"""Phase 1 source contracts and preprocessing tests."""
from pathlib import Path

import pytest
from PIL import Image

import core.preprocess.image_enhancement as enhancement
from core.preprocess.image_enhancement import preprocess_image
from core.smart_presets import load_smart_presets


@pytest.fixture(autouse=True)
def allow_tmp_roots(monkeypatch):
    monkeypatch.setenv("ALLOW_LOCAL_SERVER_PATH_INPUTS", "true")


@pytest.fixture
def preprocess_workspace(tmp_path, monkeypatch):
    monkeypatch.setattr(enhancement, "_storage_root", lambda: tmp_path / "preprocessed")
    monkeypatch.setattr(enhancement, "_resolve_input", lambda value: Path(value))
    return tmp_path


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


def test_opaque_rgba_is_not_treated_as_a_useful_alpha_mask(preprocess_workspace, monkeypatch):
    source = preprocess_workspace / "opaque.png"
    Image.new("RGBA", (80, 60), (30, 50, 70, 255)).save(source)
    original_bytes = source.read_bytes()
    remover_calls = []

    def remove_background(image):
        remover_calls.append(image.mode)
        return image, True, None, "test-remover"

    monkeypatch.setattr(enhancement, "_rmbg", remove_background)
    result = enhancement.preprocess_image(
        str(source), remove_background=True, auto_crop=True, upscale=False
    )

    assert remover_calls == ["RGBA"]
    assert result["metadata"]["source_alpha"]["channel_present"] is True
    assert result["metadata"]["source_alpha"]["has_transparency"] is False
    assert result["metadata"]["crop_box"] is None
    assert source.read_bytes() == original_bytes


def test_true_and_soft_alpha_are_preserved_in_approved_image(preprocess_workspace, monkeypatch):
    source = preprocess_workspace / "soft-alpha.png"
    image = Image.new("RGBA", (64, 48), (100, 120, 140, 0))
    alpha = Image.new("L", image.size)
    for x in range(image.width):
        alpha.paste(int(x * 255 / (image.width - 1)), (x, 0, x + 1, image.height))
    image.putalpha(alpha)
    image.save(source)
    monkeypatch.setattr(
        enhancement,
        "_rmbg",
        lambda *_: (_ for _ in ()).throw(AssertionError("valid alpha must skip RMBG")),
    )

    result = enhancement.preprocess_image(
        str(source), remove_background=True, auto_crop=False, upscale=False
    )

    with Image.open(result["approved_path"]) as approved:
        assert approved.mode == "RGBA"
        assert approved.getchannel("A").tobytes() == alpha.tobytes()
    assert result["metadata"]["source_alpha"]["has_transparency"] is True
    assert result["metadata"]["source_alpha"]["soft_pixels"] > 0
    assert result["metadata"]["mask"]["source"] == "source_alpha"


def test_crop_ignores_isolated_alpha_speck_and_pads_non_square_subject(preprocess_workspace):
    source = preprocess_workspace / "subject-with-speck.png"
    image = Image.new("RGBA", (400, 300), (0, 0, 0, 0))
    image.paste((200, 80, 30, 255), (100, 75, 300, 225))
    image.putpixel((0, 0), (255, 255, 255, 255))
    image.save(source)

    result = enhancement.preprocess_image(
        str(source), remove_background=False, auto_crop=True, upscale=False
    )

    assert result["metadata"]["mask"]["bounds"] == [100, 75, 300, 225]
    assert result["metadata"]["crop_box"] == {
        "left": 84,
        "top": 63,
        "right": 316,
        "bottom": 237,
    }
    assert result["metadata"]["approved_dimensions"] == [232, 232]


def test_realesrgan_output_reapplies_aligned_alpha(preprocess_workspace, monkeypatch):
    source = preprocess_workspace / "upscale.png"
    image = Image.new("RGBA", (64, 48), (20, 30, 40, 0))
    alpha = Image.new("L", image.size)
    for x in range(image.width):
        alpha.paste(int(x * 255 / (image.width - 1)), (x, 0, x + 1, image.height))
    image.putalpha(alpha)
    image.save(source)
    monkeypatch.setattr(
        enhancement,
        "_realesrgan",
        lambda *_: (Image.new("RGB", (128, 96), (40, 50, 60)), True, None, "test-realesrgan"),
    )

    result = enhancement.preprocess_image(
        str(source), remove_background=False, auto_crop=False, upscale=True
    )

    expected_alpha = alpha.resize((128, 96), Image.Resampling.LANCZOS)
    with Image.open(result["approved_path"]) as approved:
        assert approved.mode == "RGBA"
        assert approved.getchannel("A").tobytes() == expected_alpha.tobytes()
    assert result["metadata"]["upscale_method"] == "test-realesrgan"


def test_pillow_fallback_resizes_alpha_alongside_rgb(preprocess_workspace, monkeypatch):
    source = preprocess_workspace / "fallback.png"
    image = Image.new("RGBA", (64, 48), (20, 30, 40, 0))
    alpha = Image.new("L", image.size)
    for x in range(image.width):
        alpha.paste(int(x * 255 / (image.width - 1)), (x, 0, x + 1, image.height))
    image.putalpha(alpha)
    image.save(source)
    monkeypatch.setattr(
        enhancement,
        "_realesrgan",
        lambda image, *_: (image.convert("RGB"), False, "checkpoint unavailable", "none"),
    )

    result = enhancement.preprocess_image(
        str(source), remove_background=False, auto_crop=False, upscale=True
    )

    with Image.open(result["approved_path"]) as approved:
        output_alpha = approved.getchannel("A")
        assert approved.mode == "RGBA"
        assert approved.size == (1024, 768)
        assert output_alpha.getextrema() == (0, 255)
        assert len(set(output_alpha.tobytes())) > 2
    assert result["metadata"]["upscale_method"] == "pillow_lanczos_fallback"


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
    backend_root = Path(__file__).resolve().parents[1]
    pipeline = (backend_root / "postprocess/pipeline.py").read_text(encoding="utf-8")
    scheduler = (backend_root / "core/scheduler/multiprocess_scheduler.py").read_text(encoding="utf-8")
    generation = (backend_root / "api/routers/mesh_generation.py").read_text(encoding="utf-8")

    assert "enable_printability_check" in pipeline
    assert "printability_failed" in pipeline
    assert "enable_auto_repair" in pipeline
    assert "enable_auto_rig" in scheduler
    assert "_watch_auto_rig" in scheduler
    assert 'feature="auto_rig"' in scheduler
    assert 'postprocess_mode == "production_mesh"' in scheduler
    assert "artifact_format=rigged" in scheduler or "artifact_format=rigged" in (backend_root / "api/routers/system.py").read_text(encoding="utf-8")
    assert "preprocessing_artifact_id" in generation
    assert "enable_printability_check" in generation
    assert "intent" in generation
