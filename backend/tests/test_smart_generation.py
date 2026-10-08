"""Regression coverage for deterministic smart-generation intent routing."""
from pathlib import Path
from types import SimpleNamespace

import trimesh

from core.preprocess import image_enhancement
from core.smart_presets import load_smart_presets, resolve_intent
from postprocess.pipeline import _printability_report


def _model_config(path: Path, *, vram: int = 4096):
    return SimpleNamespace(
        enabled=True,
        model_path=str(path),
        vram_requirement=vram,
        capabilities={"image_to_3d": True},
    )


def test_resolve_intent_is_deterministic_and_uses_priority(tmp_path):
    first = tmp_path / "first.ckpt"
    second = tmp_path / "second.ckpt"
    first.write_bytes(b"weights")
    second.write_bytes(b"weights")

    settings = SimpleNamespace(
        models={
            "image_to_raw_mesh": {
                "triposr_image_to_raw_mesh": _model_config(first),
            },
            "image_to_textured_mesh": {
                "trellis_image_to_textured_mesh": _model_config(second),
            },
        }
    )

    result = resolve_intent(
        "game_ready",
        settings,
        available_vram_mb=128 * 1024,
    )

    assert result["model_id"] == "trellis_image_to_textured_mesh"
    assert result["candidate_order"][0] == "trellis_image_to_textured_mesh"


def test_capability_contract_is_normalized():
    from core.config import ModelConfig, normalize_model_capabilities

    config = ModelConfig(
        vram_requirement=8192,
        supported_inputs=["image"],
        supported_outputs=["glb"],
    )
    normalized = normalize_model_capabilities(
        "image_to_raw_mesh",
        "example_model",
        config,
    )
    capabilities = normalized.capabilities
    for key in (
        "image_to_3d",
        "multiview_input",
        "generated_multiview",
        "single_view",
        "texture_generation",
        "preferred_preprocessing",
        "preferred_extraction",
        "minimum_vram_mb",
        "cpu_requirements",
        "multi_gpu",
        "recommended_postprocess_profile",
        "supported_output_formats",
    ):
        assert key in capabilities
    assert capabilities["single_view"] is True
    assert capabilities["minimum_vram_mb"] == 8192


def test_generated_multiview_capability_is_not_image_to_3d():
    from core.config import ModelConfig, normalize_model_capabilities

    config = ModelConfig(
        vram_requirement=5120,
        supported_inputs=["image"],
        supported_outputs=["png", "zip"],
        capabilities={"multiview": True, "generated_multiview": True},
    )
    normalized = normalize_model_capabilities(
        "image_to_multiview",
        "zero123plus_v12_image_to_multiview",
        config,
    )
    capabilities = normalized.capabilities
    assert capabilities["image_to_3d"] is False
    assert capabilities["multiview"] is True
    assert capabilities["multiview_input"] is False
    assert capabilities["generated_multiview"] is True
    assert capabilities["single_view"] is False


def test_multi_gpu_preset_requires_more_than_one_gpu(tmp_path, monkeypatch):
    checkpoint = tmp_path / "shape.ckpt"
    checkpoint.write_bytes(b"weights")
    settings = SimpleNamespace(
        models={
            "image_to_raw_mesh": {
                "hunyuan3d_shape_v21_image_to_raw_mesh": _model_config(checkpoint, vram=12000),
            }
        }
    )

    monkeypatch.setattr(
        "core.smart_presets.get_gpu_memory_profile",
        lambda: {"gpu_count": 1, "free_mb": [8000], "aggregate_free_mb": 8000, "max_free_mb": 8000},
    )
    try:
        resolve_intent(
            "game_ready",
            settings,
            available_vram_mb=8000,
        )
    except ValueError:
        pass
    else:
        raise AssertionError("A single GPU must not satisfy a multi-GPU aggregate-only placement")


def test_resolve_intent_honors_explicit_model_override(tmp_path):
    checkpoint = tmp_path / "shape.ckpt"
    checkpoint.write_bytes(b"weights")

    settings = SimpleNamespace(
        models={
            "image_to_raw_mesh": {
                "hunyuan3d_shape_v21_image_to_raw_mesh": _model_config(checkpoint),
            },
        }
    )

    result = resolve_intent(
        "game_ready",
        settings,
        explicit_model="hunyuan3d_shape_v21_image_to_raw_mesh",
        available_vram_mb=128 * 1024,
    )

    assert result["model_id"] == "hunyuan3d_shape_v21_image_to_raw_mesh"


def test_preprocess_preserves_alpha_and_writes_provenance(tmp_path, monkeypatch):
    from PIL import Image

    source = tmp_path / "source.png"
    image = Image.new("RGBA", (320, 240), (20, 30, 40, 0))
    image.putpixel((100, 100), (200, 100, 50, 255))
    image.save(source)

    monkeypatch.setattr(image_enhancement, "_resolve_input", lambda value: Path(value))
    monkeypatch.setattr(image_enhancement, "_storage_root", lambda: tmp_path / "preprocessed")

    result = image_enhancement.preprocess_image(
        str(source),
        remove_background=True,
        auto_crop=True,
        upscale=False,
        sharpen=False,
    )

    assert result["metadata"]["original_mode"] == "RGBA"
    assert result["metadata"]["rmbg_used"] is False
    assert result["metadata"]["original_sha256"]
    approved = Path(result["approved_path"])
    assert approved.is_file()
    assert result["metadata"]["approved_sha256"] == image_enhancement._sha256(approved)


def test_smart_preset_file_has_five_builtin_intents():
    data = load_smart_presets()
    assert set(data["intents"]) == {"game_ready", "cinematic", "animation", "3d_print", "mobile"}


def test_printability_report_is_deterministic():
    watertight = trimesh.creation.box()
    report = _printability_report(watertight)
    assert report["status"] == "pass"

    open_mesh = watertight.copy()
    open_mesh.update_faces([i for i in range(len(open_mesh.faces)) if i != 0])
    open_mesh.remove_unreferenced_vertices()
    failed = _printability_report(open_mesh)
    assert failed["status"] == "fail"
    assert failed["boundary_edges"] > 0
