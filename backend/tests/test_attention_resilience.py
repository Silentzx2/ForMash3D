import os
import sys
import pytest
from unittest.mock import patch, MagicMock

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from utils.torchvision_fix import fix_flash_attention_hardware


def test_fix_flash_attention_hardware_pre_ampere():
    """Verify that compute capability < 8.0 auto-routes to 'sdpa'."""
    with patch("torch.cuda.is_available", return_value=True), \
         patch("torch.cuda.device_count", return_value=1), \
         patch("torch.cuda.get_device_capability", return_value=(7, 5)):
        
        # Reset env vars to flash_attn
        os.environ["ATTN_BACKEND"] = "flash_attn"
        os.environ["SPARSE_ATTN_BACKEND"] = "flash_attn"
        
        fix_flash_attention_hardware()
        
        assert os.environ["ATTN_BACKEND"] == "sdpa"
        assert os.environ["SPARSE_ATTN_BACKEND"] == "sdpa"


def test_fix_flash_attention_hardware_ampere_preserved():
    """Verify that compute capability >= 8.0 preserves flash_attn backend."""
    with patch("torch.cuda.is_available", return_value=True), \
         patch("torch.cuda.device_count", return_value=1), \
         patch("torch.cuda.get_device_capability", return_value=(8, 0)):
        
        os.environ["ATTN_BACKEND"] = "flash_attn"
        os.environ["SPARSE_ATTN_BACKEND"] = "flash_attn"
        
        fix_flash_attention_hardware()
        
        assert os.environ["ATTN_BACKEND"] == "flash_attn"
        assert os.environ["SPARSE_ATTN_BACKEND"] == "flash_attn"


def test_trellis2_attention_config_pre_ampere():
    """Verify TRELLIS.2 attention config selects sdpa when major < 8."""
    trellis_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "thirdparty", "TRELLIS.2"))
    if trellis_path not in sys.path:
        sys.path.insert(0, trellis_path)
    
    with patch("torch.cuda.is_available", return_value=True), \
         patch("torch.cuda.get_device_capability", return_value=(7, 5)):
        
        # Unset env var
        old_val = os.environ.pop("ATTN_BACKEND", None)
        try:
            from trellis2.modules.attention import config
            config.__from_env()
            assert config.BACKEND == "sdpa"
        finally:
            if old_val is not None:
                os.environ["ATTN_BACKEND"] = old_val
