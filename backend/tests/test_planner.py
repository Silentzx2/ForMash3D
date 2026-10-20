"""Table-driven tests for Planner v0 and Runtime Probe.

Fulfills TASKS.md Section 8 and Task 1E requirements:
- quality x mesh_style x object_type combinations
- low-VRAM fallback (forces Hunyuan when VRAM < Trellis2 budget)
- no-CUDA behavior
- license opt-in requirement
- determinism: same input -> identical plan
"""
import itertools
from typing import Any, Dict

import pytest

try:
    from backend.core.models.base import BaseModel
    from backend.core.planner import plan_generation
    from backend.core.runtime_probe import probe_runtime
except ImportError:
    from core.models.base import BaseModel
    from core.planner import plan_generation
    from core.runtime_probe import probe_runtime


class DummyModel(BaseModel):
    """Concrete model class to test BaseModel.__init__."""

    def _load_model(self) -> Any:
        return None

    def _unload_model(self) -> None:
        pass

    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        return {}

    def get_supported_formats(self) -> Dict[str, Any]:
        return {}

    def get_parameter_schema(self) -> Dict[str, Any]:
        return {}


def _get_mock_runtime(
    has_cuda: bool = True,
    free_vram_gb: float = 24.0,
    license_optins: Dict[str, bool] = None,
    installed_adapters: list = None,
    enabled_adapters: list = None,
) -> Dict[str, Any]:
    """Helper constructing mock runtime matching probe_runtime specification."""
    if license_optins is None:
        license_optins = {}
    if installed_adapters is None:
        installed_adapters = [
            "Trellis2ImageToRawMeshAdapter",
            "Hunyuan3DShapeV21ImageToRawMeshAdapter",
            "Hunyuan3DDiTV2MiniTurboImageToRawMeshAdapter",
            "TripoSGImageToRawMeshAdapter",
            "FastMeshRetopologyAdapter",
            "PartUVUnwrappingAdapter",
        ]
    if enabled_adapters is None:
        enabled_adapters = [
            "trellis2_image_to_raw_mesh",
            "hunyuan3d_shape_v21_image_to_raw_mesh",
            "hunyuan3d_dit_v2_mini_turbo_image_to_raw_mesh",
            "triposg_image_to_raw_mesh",
        ]

    return {
        "has_cuda": has_cuda,
        "cuda_device_name": "NVIDIA GeForce RTX 4090" if has_cuda else None,
        "total_vram_gb": 24.0 if has_cuda else None,
        "free_vram_gb": free_vram_gb if has_cuda else None,
        "total_ram_gb": 32.0,
        "free_ram_gb": 16.0,
        "peak_vram_gb_last_run": 0.0 if has_cuda else None,
        "installed_adapters": installed_adapters,
        "enabled_adapters": enabled_adapters,
        "license_optins": dict(license_optins),
        "torch_version": "2.4.0" if has_cuda else "not_installed",
        "cuda_version": "12.4" if has_cuda else None,
    }


def test_base_model_native_topology_flag():
    """Verify BaseModel has native_topology initialized to False."""
    model = DummyModel(
        model_id="test_model",
        model_path="/tmp/test",
        vram_requirement=4096,
        feature_type="image_to_raw_mesh",
    )
    assert hasattr(model, "native_topology")
    assert model.native_topology is False


def test_runtime_probe_structure():
    """Verify probe_runtime returns the exact dictionary schema specified in TASKS.md."""
    runtime = probe_runtime()
    required_keys = [
        "has_cuda",
        "cuda_device_name",
        "total_vram_gb",
        "free_vram_gb",
        "total_ram_gb",
        "free_ram_gb",
        "peak_vram_gb_last_run",
        "installed_adapters",
        "enabled_adapters",
        "license_optins",
        "torch_version",
        "cuda_version",
    ]
    for key in required_keys:
        assert key in runtime, f"Missing required key in probe_runtime: {key}"

    assert isinstance(runtime["has_cuda"], bool)
    assert isinstance(runtime["total_ram_gb"], float)
    assert isinstance(runtime["free_ram_gb"], float)
    assert isinstance(runtime["installed_adapters"], list)
    assert isinstance(runtime["enabled_adapters"], list)
    assert isinstance(runtime["license_optins"], dict)
    assert isinstance(runtime["torch_version"], str)


# Table-driven test: quality x mesh_style x object_type combinations
QUALITIES = ["fast", "balanced", "high"]
STYLES = ["clean", "detailed", "auto"]
OBJECT_TYPES = ["general", "mechanical", "organic", "character"]
COMBINATIONS = list(itertools.product(QUALITIES, STYLES, OBJECT_TYPES))


@pytest.mark.parametrize("quality,mesh_style,object_type", COMBINATIONS)
def test_quality_mesh_style_object_type_combinations(quality, mesh_style, object_type):
    """Table-driven test for all quality x mesh_style x object_type combinations."""
    runtime = _get_mock_runtime(has_cuda=True, free_vram_gb=24.0)
    request = {
        "requested_quality": quality,
        "mesh_style": mesh_style,
        "object_type": object_type,
    }
    plan = plan_generation(request, runtime)

    # Verify all expected plan keys exist
    expected_keys = [
        "adapter",
        "fallback_chain",
        "preset",
        "num_seeds",
        "input_prep",
        "skip_retopo_allowed",
        "uv_backend",
        "bake",
        "reasons",
        "warnings",
        "schema_version",
    ]
    for k in expected_keys:
        assert k in plan, f"Missing output key in plan: {k}"

    assert isinstance(plan["adapter"], str)
    assert isinstance(plan["fallback_chain"], list)
    assert isinstance(plan["preset"], str)
    assert isinstance(plan["num_seeds"], int)
    assert isinstance(plan["input_prep"], dict)
    assert isinstance(plan["skip_retopo_allowed"], bool)
    assert isinstance(plan["uv_backend"], str)
    assert isinstance(plan["bake"], dict)
    assert isinstance(plan["reasons"], list)
    assert isinstance(plan["warnings"], list)
    assert isinstance(plan["schema_version"], str)

    # Verify seed count mapping per quality
    expected_seeds = {"fast": 1, "balanced": 2, "high": 3}[quality]
    assert plan["num_seeds"] == expected_seeds

    # When native adapter is not installed/enabled, clean / mechanical must fall back to dense route
    # and skip_retopo_allowed must be False.
    if mesh_style == "clean" or object_type == "mechanical":
        assert plan["skip_retopo_allowed"] is False
        assert any("taoflowforge" in r for r in plan["reasons"])

    # High / balanced with 24GB VRAM select Trellis2
    if quality in ("balanced", "high"):
        assert plan["adapter"] == "trellis2_image_to_raw_mesh"
        assert plan["preset"] == quality
    elif quality == "fast":
        assert plan["adapter"] == "hunyuan3d_shape_v21_image_to_raw_mesh"
        assert plan["preset"] == "fast"


def test_native_adapter_clean_route_when_enabled():
    """Verify that when native adapter (TaoFlowForge) is enabled and opted in, clean style selects it."""
    runtime = _get_mock_runtime(has_cuda=True, free_vram_gb=24.0)
    runtime["installed_adapters"].append("TaoFlowForgeImageToRawMeshAdapter")
    runtime["enabled_adapters"].append("taoflowforge_image_to_raw_mesh")
    runtime["license_optins"] = {"taoflowforge_image_to_raw_mesh": True}

    request = {
        "requested_quality": "balanced",
        "mesh_style": "clean",
        "object_type": "mechanical",
    }
    plan = plan_generation(request, runtime)

    assert plan["adapter"] == "taoflowforge_image_to_raw_mesh"
    assert plan["skip_retopo_allowed"] is True
    assert plan["num_seeds"] == 2
    assert "trellis2_image_to_raw_mesh" in plan["fallback_chain"]


def test_low_vram_fallback():
    """Verify that when free VRAM is lower than Trellis2 requirement (16GB), planner falls back to Hunyuan."""
    # Free VRAM is 12GB (sufficient for Hunyuan 10GB, but below Trellis2 16GB)
    runtime = _get_mock_runtime(has_cuda=True, free_vram_gb=12.0)

    # Balanced request
    plan_balanced = plan_generation({"requested_quality": "balanced"}, runtime)
    assert plan_balanced["adapter"] == "hunyuan3d_shape_v21_image_to_raw_mesh"
    assert plan_balanced["preset"] == "balanced"
    assert plan_balanced["num_seeds"] == 2
    assert any("requires 16.0 GB VRAM" in r for r in plan_balanced["reasons"])
    assert any("Fallback from candidate 'trellis2_image_to_raw_mesh'" in w for w in plan_balanced["warnings"])

    # High request
    plan_high = plan_generation({"requested_quality": "high"}, runtime)
    assert plan_high["adapter"] == "hunyuan3d_shape_v21_image_to_raw_mesh"
    assert plan_high["preset"] == "high"
    assert plan_high["num_seeds"] == 3
    assert any("requires 16.0 GB VRAM" in r for r in plan_high["reasons"])


def test_no_cuda_behavior():
    """Verify planner behavior in environments without CUDA."""
    runtime = _get_mock_runtime(has_cuda=False, free_vram_gb=None)
    plan = plan_generation({"requested_quality": "balanced"}, runtime)

    # Must not crash, should fall back to Hunyuan fast (fallback of last resort)
    assert plan["adapter"] == "hunyuan3d_shape_v21_image_to_raw_mesh"
    assert plan["preset"] == "fast"
    assert plan["num_seeds"] == 1
    assert any("No CUDA device available" in w for w in plan["warnings"])
    assert any("Selected fallback of last resort" in w for w in plan["warnings"])


def test_license_optin_requirement():
    """Verify candidate is skipped if license opt-in is not satisfied or rejected."""
    # Case 1: Trellis2 explicitly rejected in license_optins
    runtime = _get_mock_runtime(
        has_cuda=True,
        free_vram_gb=24.0,
        license_optins={"trellis2_image_to_raw_mesh": False},
    )
    plan = plan_generation({"requested_quality": "balanced"}, runtime)
    assert plan["adapter"] == "hunyuan3d_shape_v21_image_to_raw_mesh"
    assert any("License opt-in explicitly rejected" in r for r in plan["reasons"])

    # Case 2: Native adapter requiring license opt-in, but user has not accepted
    runtime_native_no_optin = _get_mock_runtime(has_cuda=True, free_vram_gb=24.0)
    runtime_native_no_optin["installed_adapters"].append("TaoFlowForgeImageToRawMeshAdapter")
    runtime_native_no_optin["enabled_adapters"].append("taoflowforge_image_to_raw_mesh")
    # No optin provided
    plan_native = plan_generation({"mesh_style": "clean"}, runtime_native_no_optin)
    assert plan_native["adapter"] == "trellis2_image_to_raw_mesh"
    assert plan_native["skip_retopo_allowed"] is False
    assert any("requires license opt-in which has not been accepted" in r for r in plan_native["reasons"])


def test_determinism():
    """Verify determinism: identical request + runtime -> identical plan."""
    runtime = _get_mock_runtime(has_cuda=True, free_vram_gb=24.0)
    request = {
        "requested_quality": "balanced",
        "mesh_style": "clean",
        "object_type": "mechanical",
        "symmetry": "bilateral",
        "target_polycount": 50000,
    }

    first_plan = plan_generation(request, runtime)
    for _ in range(20):
        subsequent_plan = plan_generation(request, runtime)
        assert subsequent_plan == first_plan


def test_input_type_not_supported_fallback():
    """Verify unsupported input_type triggers fallback."""
    runtime = _get_mock_runtime(has_cuda=True, free_vram_gb=24.0)
    # text input requested on image-only model
    request = {"input_type": "text", "requested_quality": "balanced"}
    plan = plan_generation(request, runtime)
    assert any("does not support input type 'text'" in r for r in plan["reasons"])


def test_optional_target_polycount_and_symmetry():
    """Verify target_polycount and symmetry handle None and edge values cleanly."""
    runtime = _get_mock_runtime(has_cuda=True, free_vram_gb=24.0)
    plan_none = plan_generation({"target_polycount": None, "symmetry": None}, runtime)
    assert plan_none["adapter"] is not None

    plan_str = plan_generation({"target_polycount": "75000", "symmetry": "radial"}, runtime)
    assert any("Target polycount constraint: 75000" in r for r in plan_str["reasons"])
    assert any("Requested symmetry: radial" in r for r in plan_str["reasons"])
