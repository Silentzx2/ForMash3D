from pathlib import Path

import pytest
from PIL import Image

import core.preprocess.image_enhancement as enhancement


@pytest.fixture
def preprocess_workspace(tmp_path, monkeypatch):
    monkeypatch.setattr(enhancement, "_storage_root", lambda: tmp_path / "preprocessed")
    monkeypatch.setattr(enhancement, "_resolve_input", lambda value: Path(value))
    return tmp_path


def test_valid_transparent_foreground_is_approved(preprocess_workspace, monkeypatch):
    source = preprocess_workspace / "cutout.png"
    image = Image.new("RGBA", (120, 90), (0, 0, 0, 0))
    image.paste((180, 80, 40, 255), (30, 15, 90, 75))
    image.putpixel((0, 0), (255, 255, 255, 255))
    image.save(source)
    monkeypatch.setattr(
        enhancement,
        "_rmbg",
        lambda *_: (_ for _ in ()).throw(AssertionError("valid alpha must skip RMBG")),
    )

    result = enhancement.preprocess_image(
        str(source), remove_background=True, auto_crop=False, upscale=False
    )

    assert result["metadata"]["foreground_status"] == "already_transparent"
    assert result["metadata"]["foreground_validation"]["mask_survived_resize"] is True
    validation = result["metadata"]["foreground_validation"]
    if validation["component_analysis_available"]:
        assert validation["connected_components"] == 2
        assert result["approval_status"] == "approved"
        assert Path(result["approved_path"]).is_file()
        with Image.open(result["approved_path"]) as approved:
            assert approved.getchannel("A").getextrema() == (0, 255)
    else:
        assert result["approval_status"] == "needs_review"
        assert result["approved_path"] is None


def test_failed_background_removal_never_writes_approved_artifact(preprocess_workspace, monkeypatch):
    source = preprocess_workspace / "opaque.png"
    Image.new("RGB", (80, 60), (30, 50, 70)).save(source)
    monkeypatch.setattr(
        enhancement,
        "_rmbg",
        lambda image: (image, False, "removal providers unavailable", "none"),
    )

    result = enhancement.preprocess_image(
        str(source), remove_background=True, auto_crop=True, upscale=False
    )

    assert result["approval_status"] == "failed"
    assert result["approved_path"] is None
    assert result["metadata"]["foreground_status"] == "failed"
    assert result["metadata"]["approval_warning"] == "removal providers unavailable"
    assert Path(result["preview_path"]).is_file()
    assert not (Path(result["preview_path"]).parent / "approved.png").exists()
    with pytest.raises(ValueError, match="cannot be used for inference"):
        enhancement.load_preprocessed_artifact(result["artifact_id"])


def test_suspicious_mask_requires_explicit_review_override(preprocess_workspace):
    source = preprocess_workspace / "nearly-empty.png"
    image = Image.new("RGBA", (100, 80), (0, 0, 0, 0))
    image.putpixel((50, 40), (220, 100, 30, 255))
    image.save(source)

    result = enhancement.preprocess_image(
        str(source), remove_background=False, auto_crop=False, upscale=False
    )

    assert result["approval_status"] == "needs_review"
    assert result["metadata"]["foreground_validation"]["foreground_fraction"] < 0.005
    assert result["approved_path"] is None
    with pytest.raises(ValueError, match="requires explicit review"):
        enhancement.load_preprocessed_artifact(result["artifact_id"])
    preview_path, metadata = enhancement.load_preprocessed_artifact(
        result["artifact_id"], allow_review=True
    )
    assert preview_path == Path(result["preview_path"])
    assert metadata["approval_status"] == "needs_review"
