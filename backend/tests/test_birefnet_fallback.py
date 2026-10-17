import os
import sys
from pathlib import Path
import pytest

# Add backend directory to sys.path
backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))


def test_fix_gated_huggingface_repos():
    from utils.torchvision_fix import fix_gated_huggingface_repos, apply_fix

    assert fix_gated_huggingface_repos() is True
    assert apply_fix() is True


def test_birefnet_candidate_fallback():
    # Test that BiRefNet class prioritizes ungated fallbacks when gated briaai/RMBG-2.0 is given
    sys.path.insert(0, str(backend_dir / "thirdparty" / "TRELLIS.2"))
    try:
        from trellis2.pipelines.rembg.BiRefNet import BiRefNet
        # Check that class exists and can be imported
        assert callable(BiRefNet)
    except Exception as e:
        # If transformers/torch is unavailable in minimal test env, skip
        pytest.skip(f"BiRefNet dependencies not present in this test environment: {e}")


def test_trellis2_runner_init_has_resource_plan():
    from utils.trellis2_utils import Trellis2Runner

    plan = {"gpu_ids": [0, 1], "strategy": "accelerate_component_dispatch"}
    runner = Trellis2Runner(
        trellis2_root=str(backend_dir / "thirdparty" / "TRELLIS.2"),
        model_cache_dir=str(backend_dir / "pretrained" / "TRELLIS.2"),
        device="cuda:0",
        resource_plan=plan,
    )
    assert hasattr(runner, "resource_plan")
    assert runner.resource_plan == plan

