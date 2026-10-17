"""
Tests for DINOv3ViTModel standalone fallback, transformers registration, and TRELLIS.2 import resilience.
"""

import sys
from pathlib import Path
import unittest
from unittest.mock import MagicMock, patch

import pytest
import torch

from utils.dinov3_vit import DINOv3ViTConfig, DINOv3ViTModel
from utils.torchvision_fix import fix_transformers_dinov3, get_dinov3_model_class


def test_dinov3_config():
    """Verify DINOv3ViTConfig properties and defaults."""
    cfg = DINOv3ViTConfig(hidden_size=256, num_hidden_layers=4, num_attention_heads=4, patch_size=16)
    assert cfg.hidden_size == 256
    assert cfg.num_hidden_layers == 4
    assert cfg.num_attention_heads == 4
    assert cfg.patch_size == 16
    assert cfg.model_type == "dinov3_vit"


def test_dinov3_model_forward():
    """Verify DINOv3ViTModel forward pass and layer traversal."""
    cfg = DINOv3ViTConfig(
        hidden_size=64,
        intermediate_size=128,
        num_hidden_layers=2,
        num_attention_heads=2,
        patch_size=16,
        num_register_tokens=4,
    )
    model = DINOv3ViTModel(cfg)
    model.eval()

    # Check flat layer property access for TRELLIS.2 compatibility
    assert hasattr(model, "layer")
    assert len(model.layer) == 2

    # Run feature extraction pipeline like DinoV3FeatureExtractor
    fake_img = torch.randn(2, 3, 64, 64)
    emb = model.embeddings(fake_img)
    rope = model.rope_embeddings(fake_img)

    assert emb.shape[0] == 2
    assert emb.shape[-1] == 64

    for layer_module in model.layer:
        emb = layer_module(emb, position_embeddings=rope)

    normed = torch.nn.functional.layer_norm(emb, emb.shape[-1:])
    assert normed.shape[0] == 2
    assert normed.shape[-1] == 64


def test_fix_transformers_dinov3_registration():
    """Verify fix_transformers_dinov3 registers DINOv3ViTModel into transformers."""
    # Create or use transformers module
    if "transformers" not in sys.modules:
        dummy_tf = MagicMock()
        sys.modules["transformers"] = dummy_tf

    import transformers
    if hasattr(transformers, "DINOv3ViTModel"):
        delattr(transformers, "DINOv3ViTModel")

    assert not hasattr(transformers, "DINOv3ViTModel")

    # Apply fix
    res = fix_transformers_dinov3()
    assert res is True

    # Now verify DINOv3ViTModel is available on transformers
    assert hasattr(transformers, "DINOv3ViTModel")
    cls = get_dinov3_model_class()
    assert cls is not None
    assert cls.__name__ == "DINOv3ViTModel"


def test_trellis2_feature_extractor_import():
    """Verify TRELLIS.2 DinoV3FeatureExtractor can be imported and uses fallback."""
    # Ensure fix is applied
    fix_transformers_dinov3()

    trellis2_path = str(Path(__file__).resolve().parents[1] / "thirdparty" / "TRELLIS.2")
    if trellis2_path not in sys.path:
        sys.path.insert(0, trellis2_path)

    try:
        from trellis2.modules.image_feature_extractor import DinoV3FeatureExtractor
        assert DinoV3FeatureExtractor is not None
    except ModuleNotFoundError as e:
        if "torchvision" in str(e):
            with patch.dict(sys.modules, {"torchvision": MagicMock(), "torchvision.transforms": MagicMock()}):
                from trellis2.modules.image_feature_extractor import DinoV3FeatureExtractor
                assert DinoV3FeatureExtractor is not None
        else:
            raise
