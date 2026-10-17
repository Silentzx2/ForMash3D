"""
Tests for Unique3D adapter model loading resilience, token sanitization, and fallback mechanisms.
"""

import os
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from adapters.unique3d_adapter import Unique3DImageToRawMeshAdapter


@pytest.fixture(autouse=True)
def cleanup_symlinks():
    yield
    for symlink_candidate in [Path("ckpt"), Path("backend/ckpt"), Path("app"), Path("backend/app")]:
        try:
            if symlink_candidate.is_symlink():
                symlink_candidate.unlink()
        except Exception:
            pass


def test_sanitize_hf_tokens():
    """Verify empty/dummy/github tokens are removed from os.environ."""
    # Test empty token
    os.environ["HF_TOKEN"] = ""
    os.environ["HUGGINGFACE_TOKEN"] = "   "
    Unique3DImageToRawMeshAdapter._sanitize_hf_tokens()
    assert "HF_TOKEN" not in os.environ
    assert "HUGGINGFACE_TOKEN" not in os.environ

    # Test dummy strings
    os.environ["HF_TOKEN"] = "None"
    os.environ["HUGGINGFACE_TOKEN"] = "null"
    Unique3DImageToRawMeshAdapter._sanitize_hf_tokens()
    assert "HF_TOKEN" not in os.environ
    assert "HUGGINGFACE_TOKEN" not in os.environ

    # Test github token mistakenly put in HF_TOKEN
    os.environ["GITHUB_TOKEN"] = "ghp_secrettoken123"
    os.environ["HF_TOKEN"] = "ghp_secrettoken123"
    Unique3DImageToRawMeshAdapter._sanitize_hf_tokens()
    assert "HF_TOKEN" not in os.environ
    assert os.environ["GITHUB_TOKEN"] == "ghp_secrettoken123"

    # Test valid token preserved
    os.environ["HF_TOKEN"] = "hf_validSecretToken12345"
    Unique3DImageToRawMeshAdapter._sanitize_hf_tokens()
    assert os.environ["HF_TOKEN"] == "hf_validSecretToken12345"
    del os.environ["HF_TOKEN"]
    del os.environ["GITHUB_TOKEN"]


def test_find_local_img2mvimg(tmp_path):
    """Verify local img2mvimg directory detection across candidates."""
    fake_model_path = tmp_path / "model_root"
    fake_ckpt = fake_model_path / "ckpt" / "img2mvimg"
    fake_ckpt.mkdir(parents=True)

    adapter = Unique3DImageToRawMeshAdapter(
        vram_requirement=10240,
        model_path=str(fake_model_path),
    )
    found = adapter._find_local_img2mvimg()
    assert found is not None
    assert found == fake_ckpt.resolve()


def test_create_normal_config_override(tmp_path):
    """Verify normal config override correctly replaces base model and attention ref."""
    adapter = Unique3DImageToRawMeshAdapter(vram_requirement=10240)
    override_path = adapter._create_normal_config_override("./ckpt/custom_mvimg")
    
    override_file = Path(override_path)
    assert override_file.exists()
    content = override_file.read_text(encoding="utf-8")
    assert 'pretrained_model_name_or_path: "./ckpt/custom_mvimg"' in content
    assert 'self_attn_ref_other_model_name: "${pretrained_model_name_or_path}"' in content
    assert 'init_unet_path: "${pretrained_model_name_or_path}"' in content


def test_resolve_normal_config_uses_local_when_available(tmp_path):
    """Verify _resolve_normal_config resolves to local img2mvimg when present."""
    fake_model_path = tmp_path / "model_root"
    fake_ckpt = fake_model_path / "ckpt" / "img2mvimg"
    fake_ckpt.mkdir(parents=True)

    adapter = Unique3DImageToRawMeshAdapter(
        vram_requirement=10240,
        model_path=str(fake_model_path),
    )
    resolved = adapter._resolve_normal_config()
    content = Path(resolved).read_text(encoding="utf-8")
    assert str(fake_ckpt.resolve()) in content or "./ckpt/img2mvimg" in content


def test_load_normal_pipeline_fallback(tmp_path):
    """Verify that when loading lambda/sd-image-variations-diffusers fails, it retries with local img2mvimg."""
    fake_model_path = tmp_path / "model_root"
    fake_ckpt = fake_model_path / "ckpt" / "img2mvimg"
    fake_ckpt.mkdir(parents=True)

    adapter = Unique3DImageToRawMeshAdapter(
        vram_requirement=10240,
        model_path=str(fake_model_path),
    )

    calls = []

    def mock_load_pipeline(cfg_path, ckpt_path):
        calls.append((cfg_path, ckpt_path))
        cfg_text = Path(cfg_path).read_text(encoding="utf-8")
        if "lambda/sd-image-variations-diffusers" in cfg_text:
            raise RuntimeError(
                "Can't load config for 'lambda/sd-image-variations-diffusers'. "
                "If you were trying to load it from 'https://huggingface.co/models'..."
            )
        return MagicMock(), MagicMock()

    # Point normal_config to a dummy file containing lambda repo
    dummy_lambda_yaml = tmp_path / "dummy_normal.yaml"
    dummy_lambda_yaml.write_text(
        'pretrained_model_name_or_path: "lambda/sd-image-variations-diffusers"\n'
        'self_attn_ref_other_model_name: "lambda/sd-image-variations-diffusers"\n'
    )
    adapter.normal_config = str(dummy_lambda_yaml)

    with patch("torch.cuda.is_available", return_value=True), \
         patch("adapters.unique3d_adapter.Unique3DImageToRawMeshAdapter._ensure_unique3d_in_path"):
        import sys
        fake_app = MagicMock()
        fake_app.custom_models.utils.load_pipeline = mock_load_pipeline
        with patch.dict(sys.modules, {
            "app": fake_app,
            "app.custom_models": fake_app.custom_models,
            "app.custom_models.utils": fake_app.custom_models.utils,
            "app.custom_models.mvimg_prediction": MagicMock(),
            "app.custom_models.normal_prediction": MagicMock(),
            "onnxruntime": MagicMock(),
        }):
            adapter._load_model()
            assert adapter.normal_pipeline is not None
            assert adapter.mvimg_pipeline is not None
            # Verify load_pipeline was called and fallback succeeded
            assert len(calls) >= 2
