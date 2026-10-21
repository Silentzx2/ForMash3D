"""Unit and integration tests for Planner v1 and API request wiring.

Fulfills Task 3B requirements:
- API schemas (ImageToRawMeshRequest, ImageToTexturedMeshRequest) accept:
  mesh_style (default "auto"), requested_quality (default "balanced"),
  object_type (default "general"), symmetry (default "none").
- Schema validation enforces valid enums.
- Endpoints attach computed plan to JobRequest.inputs["plan"] and metadata.
- plan_generation routes mechanical/clean to high-detail generator with
  feature-aware retopo when native adapter is disabled.
- plan_generation routes to native candidate when enabled and opted in.
- Benchmark-driven routing per object_type (mechanical, organic, character, general)
  and quality tiers (fast, balanced, high).
"""
import itertools
from unittest.mock import AsyncMock, patch
import pytest
from pydantic import ValidationError

from api.routers.mesh_generation import (
    ImageToRawMeshRequest,
    ImageToTexturedMeshRequest,
    TextMeshPaintingRequest,
    ImageMeshPaintingRequest,
    image_to_raw_mesh,
    image_to_textured_mesh,
)
from core.planner import plan_generation, clear_rules_cache
from core.scheduler.job_queue import JobRequest


@pytest.fixture(autouse=True)
def reset_rules():
    clear_rules_cache()
    yield
    clear_rules_cache()


def _get_mock_runtime(
    has_cuda: bool = True,
    free_vram_gb: float = 24.0,
    license_optins: dict = None,
    installed_adapters: list = None,
    enabled_adapters: list = None,
) -> dict:
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


# =====================================================================
# 1. API Schema Tests
# =====================================================================

def test_raw_mesh_request_schema_defaults():
    """Verify ImageToRawMeshRequest sets specified defaults."""
    req = ImageToRawMeshRequest(image_path="/tmp/fake.png")
    assert req.mesh_style == "auto"
    assert req.requested_quality is None
    assert req.object_type == "general"
    assert req.symmetry == "none"


def test_textured_mesh_request_schema_defaults():
    """Verify ImageToTexturedMeshRequest sets specified defaults."""
    req = ImageToTexturedMeshRequest(image_path="/tmp/fake.png")
    assert req.mesh_style == "auto"
    assert req.requested_quality is None
    assert req.object_type == "general"
    assert req.symmetry == "none"


def test_painting_requests_schema_defaults():
    """Verify TextMeshPaintingRequest and ImageMeshPaintingRequest accept and default the fields."""
    req_text = TextMeshPaintingRequest(text_prompt="robot", mesh_path="/tmp/fake.glb")
    assert req_text.mesh_style == "auto"
    assert req_text.requested_quality is None
    assert req_text.object_type == "general"
    assert req_text.symmetry == "none"

    req_img = ImageMeshPaintingRequest(image_path="/tmp/fake.png", mesh_path="/tmp/fake.glb")
    assert req_img.mesh_style == "auto"
    assert req_img.requested_quality is None
    assert req_img.object_type == "general"
    assert req_img.symmetry == "none"


def test_request_schemas_accept_valid_custom_values():
    """Verify schemas accept custom values for all 4 fields."""
    req = ImageToRawMeshRequest(
        image_path="/tmp/fake.png",
        mesh_style="clean",
        requested_quality="high",
        object_type="mechanical",
        symmetry="bilateral",
    )
    assert req.mesh_style == "clean"
    assert req.requested_quality == "high"
    assert req.object_type == "mechanical"
    assert req.symmetry == "bilateral"


def test_request_schemas_reject_invalid_enums():
    """Verify schemas raise ValidationError for unsupported values."""
    with pytest.raises(ValidationError):
        ImageToRawMeshRequest(image_path="/tmp/fake.png", mesh_style="invalid_style")

    with pytest.raises(ValidationError):
        ImageToRawMeshRequest(image_path="/tmp/fake.png", requested_quality="ultra_extreme")

    with pytest.raises(ValidationError):
        ImageToRawMeshRequest(image_path="/tmp/fake.png", object_type="architecture")

    with pytest.raises(ValidationError):
        ImageToRawMeshRequest(image_path="/tmp/fake.png", symmetry="spherical")


# =====================================================================
# 2. Endpoint Wiring & Plan Attachment Tests
# =====================================================================

TINY_PNG_B64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="


@pytest.mark.anyio
async def test_image_to_raw_mesh_attaches_computed_plan():
    """Verify image_to_raw_mesh endpoint computes plan and attaches it to JobRequest inputs and metadata."""
    captured_job: JobRequest | None = None

    class MockScheduler:
        def validate_model_preference(self, model_id, feature):
            return True

        def get_available_models(self, feature):
            return {feature: ["hunyuan3d_shape_v21_image_to_raw_mesh", "trellis2_image_to_raw_mesh"]}

        async def schedule_job(self, job_req: JobRequest) -> str:
            nonlocal captured_job
            captured_job = job_req
            return "job-12345"

    req = ImageToRawMeshRequest(
        image_base64=TINY_PNG_B64,
        mesh_style="clean",
        requested_quality="high",
        object_type="mechanical",
        symmetry="bilateral",
    )

    resp = await image_to_raw_mesh(req, scheduler=MockScheduler(), file_store=None)
    assert resp.job_id == "job-12345"
    assert captured_job is not None

    # Verify fields attached to inputs
    assert captured_job.inputs["mesh_style"] == "clean"
    assert captured_job.inputs["requested_quality"] == "high"
    assert captured_job.inputs["object_type"] == "mechanical"
    assert captured_job.inputs["symmetry"] == "bilateral"

    # Verify plan attached to inputs and metadata
    plan = captured_job.inputs.get("plan")
    assert plan is not None
    assert isinstance(plan, dict)
    assert "adapter" in plan
    assert "retopo_mode" in plan
    assert plan["retopo_mode"] == "feature_aware"
    assert plan["skip_retopo_allowed"] is False
    assert plan["retopo"]["feature_preserving"] is True

    # Check metadata as well
    assert captured_job.metadata["plan"] == plan
    assert captured_job.metadata["mesh_style"] == "clean"
    assert captured_job.metadata["object_type"] == "mechanical"


@pytest.mark.anyio
async def test_image_to_textured_mesh_attaches_computed_plan():
    """Verify image_to_textured_mesh endpoint computes plan and attaches it to JobRequest inputs."""
    captured_job: JobRequest | None = None

    class MockScheduler:
        def validate_model_preference(self, model_id, feature):
            return True

        def get_available_models(self, feature):
            return {feature: ["trellis_image_to_textured_mesh"]}

        async def schedule_job(self, job_req: JobRequest) -> str:
            nonlocal captured_job
            captured_job = job_req
            return "job-textured-67890"

    req = ImageToTexturedMeshRequest(
        image_base64=TINY_PNG_B64,
        mesh_style="auto",
        requested_quality="balanced",
        object_type="organic",
        symmetry="none",
    )

    resp = await image_to_textured_mesh(req, scheduler=MockScheduler(), file_store=None)
    assert resp.job_id == "job-textured-67890"
    assert captured_job is not None

    plan = captured_job.inputs.get("plan")
    assert plan is not None
    assert plan["retopo_mode"] == "smooth"
    assert captured_job.inputs["object_type"] == "organic"
    assert captured_job.metadata["plan"] == plan


# =====================================================================
# 3. Plan Generation Routing Tests
# =====================================================================

def test_plan_generation_routes_mechanical_clean_when_native_disabled():
    """Verify mechanical/clean routes to high-detail adapter with feature-aware retopo when native adapter is disabled."""
    runtime = _get_mock_runtime(has_cuda=True, free_vram_gb=24.0)
    # Native adapter is NOT in installed_adapters or enabled_adapters

    # Case A: mesh_style="clean", object_type="mechanical", quality="high"
    plan_clean_mech = plan_generation(
        {
            "mesh_style": "clean",
            "object_type": "mechanical",
            "requested_quality": "high",
        },
        runtime,
    )
    assert plan_clean_mech["adapter"] == "trellis2_image_to_raw_mesh"
    assert plan_clean_mech["preset"] == "high"
    assert plan_clean_mech["num_seeds"] == 3
    assert plan_clean_mech["skip_retopo_allowed"] is False
    assert plan_clean_mech["retopo_mode"] == "feature_aware"
    assert plan_clean_mech["retopo"]["feature_preserving"] is True
    assert plan_clean_mech["retopo"]["crease_angle_deg"] == 35.0
    assert any("feature-aware retopology" in r for r in plan_clean_mech["reasons"])

    # Case B: mesh_style="clean" on general object_type
    plan_clean_gen = plan_generation(
        {
            "mesh_style": "clean",
            "object_type": "general",
            "requested_quality": "balanced",
        },
        runtime,
    )
    assert plan_clean_gen["adapter"] == "trellis2_image_to_raw_mesh"
    assert plan_clean_gen["skip_retopo_allowed"] is False
    assert plan_clean_gen["retopo_mode"] == "feature_aware"
    assert plan_clean_gen["retopo"]["feature_preserving"] is True

    # Case C: object_type="mechanical" with mesh_style="auto"
    plan_auto_mech = plan_generation(
        {
            "mesh_style": "auto",
            "object_type": "mechanical",
            "requested_quality": "balanced",
        },
        runtime,
    )
    assert plan_auto_mech["adapter"] == "trellis2_image_to_raw_mesh"
    assert plan_auto_mech["skip_retopo_allowed"] is False
    assert plan_auto_mech["retopo_mode"] == "feature_aware"
    assert plan_auto_mech["retopo"]["feature_preserving"] is True

    # Case D: mechanical with fast quality tier
    plan_fast_mech = plan_generation(
        {
            "mesh_style": "clean",
            "object_type": "mechanical",
            "requested_quality": "fast",
        },
        runtime,
    )
    assert plan_fast_mech["adapter"] == "hunyuan3d_dit_v2_mini_turbo_image_to_raw_mesh"
    assert plan_fast_mech["preset"] == "fast"
    assert plan_fast_mech["num_seeds"] == 1
    assert plan_fast_mech["skip_retopo_allowed"] is False
    assert plan_fast_mech["retopo_mode"] == "feature_aware"


def test_plan_generation_routes_to_native_when_enabled_and_opted_in():
    """Verify clean / mechanical routes to native adapter when enabled and license is accepted."""
    runtime = _get_mock_runtime(has_cuda=True, free_vram_gb=24.0)
    runtime["installed_adapters"].append("TaoFlowForgeImageToRawMeshAdapter")
    runtime["enabled_adapters"].append("taoflowforge_image_to_raw_mesh")
    runtime["license_optins"] = {"taoflowforge_image_to_raw_mesh": True}

    plan = plan_generation(
        {
            "mesh_style": "clean",
            "object_type": "mechanical",
            "requested_quality": "balanced",
        },
        runtime,
    )
    assert plan["adapter"] == "taoflowforge_image_to_raw_mesh"
    assert plan["skip_retopo_allowed"] is True
    assert plan["retopo_mode"] == "native"
    assert "trellis2_image_to_raw_mesh" in plan["fallback_chain"]


def test_plan_generation_organic_routing():
    """Verify organic object type routes to smooth retopo mode."""
    runtime = _get_mock_runtime(has_cuda=True, free_vram_gb=24.0)
    plan = plan_generation(
        {
            "mesh_style": "auto",
            "object_type": "organic",
            "requested_quality": "balanced",
        },
        runtime,
    )
    assert plan["adapter"] == "trellis2_image_to_raw_mesh"
    assert plan["retopo_mode"] == "smooth"
    assert plan["retopo"]["feature_preserving"] is False
    assert plan["retopo"]["crease_angle_deg"] == 60.0


def test_plan_generation_character_routing():
    """Verify character object type routes to silhouette_aware retopo mode."""
    runtime = _get_mock_runtime(has_cuda=True, free_vram_gb=24.0)
    plan = plan_generation(
        {
            "mesh_style": "auto",
            "object_type": "character",
            "requested_quality": "high",
            "symmetry": "bilateral",
        },
        runtime,
    )
    assert plan["adapter"] == "trellis2_image_to_raw_mesh"
    assert plan["retopo_mode"] == "silhouette_aware"
    assert plan["retopo"]["feature_preserving"] is False
    assert plan["retopo"]["crease_angle_deg"] == 45.0
    assert any("Requested symmetry: bilateral" in r for r in plan["reasons"])


def test_plan_generation_general_routing():
    """Verify general object type routes to standard retopo mode."""
    runtime = _get_mock_runtime(has_cuda=True, free_vram_gb=24.0)
    plan = plan_generation(
        {
            "mesh_style": "auto",
            "object_type": "general",
            "requested_quality": "fast",
        },
        runtime,
    )
    assert plan["adapter"] == "hunyuan3d_dit_v2_mini_turbo_image_to_raw_mesh"
    assert plan["retopo_mode"] == "standard"
    assert plan["retopo"]["feature_preserving"] is False
    assert plan["retopo"]["crease_angle_deg"] == 45.0


# Table-driven test: 4 object types x 3 qualities
OBJECT_TYPES = ["mechanical", "organic", "character", "general"]
QUALITIES = ["fast", "balanced", "high"]
COMBOS = list(itertools.product(OBJECT_TYPES, QUALITIES))


@pytest.mark.parametrize("obj_type,quality", COMBOS)
def test_all_object_types_and_quality_tiers(obj_type, quality):
    """Table-driven test verifying routing for all object types and quality tiers."""
    runtime = _get_mock_runtime(has_cuda=True, free_vram_gb=24.0)
    plan = plan_generation(
        {
            "object_type": obj_type,
            "requested_quality": quality,
            "mesh_style": "auto",
        },
        runtime,
    )

    expected_seeds = {"fast": 1, "balanced": 2, "high": 3}[quality]
    assert plan["num_seeds"] == expected_seeds

    if quality == "fast":
        assert plan["adapter"] == "hunyuan3d_dit_v2_mini_turbo_image_to_raw_mesh"
    else:
        assert plan["adapter"] == "trellis2_image_to_raw_mesh"

    expected_retopo = {
        "mechanical": "feature_aware",
        "organic": "smooth",
        "character": "silhouette_aware",
        "general": "standard",
    }[obj_type]
    assert plan["retopo_mode"] == expected_retopo
    assert "retopo" in plan
    assert plan["retopo"]["mode"] == expected_retopo


# =====================================================================
# 4. Wiring, Preservation, and Auto-Mode Tests
# =====================================================================

def test_plan_generation_textured_mesh_adapter():
    """Verify plan_generation recognizes textured mesh adapters when requested explicitly."""
    runtime = {
        "has_cuda": True,
        "free_vram_gb": 24.0,
        "installed_adapters": [
            "TrellisImageToTexturedMeshAdapter",
            "Trellis2ImageToTexturedMeshAdapter",
        ],
        "enabled_adapters": [
            "trellis_image_to_textured_mesh",
            "trellis2_image_to_textured_mesh",
        ],
        "license_optins": {},
    }
    plan = plan_generation(
        {
            "model_preference": "trellis_image_to_textured_mesh",
            "auto_mode": False,
        },
        runtime,
    )
    assert plan["adapter"] == "trellis_image_to_textured_mesh"
    assert plan["would_have_chosen"] == "trellis_image_to_textured_mesh"


@pytest.mark.anyio
async def test_planner_wiring_preserves_explicit_model_when_auto_disabled():
    """Verify endpoint preserves explicit model preference when auto_mode=False."""
    captured_job: JobRequest | None = None

    class MockScheduler:
        def validate_model_preference(self, model_id, feature):
            return True

        def get_available_models(self, feature):
            return {feature: ["triposg_image_to_raw_mesh", "trellis2_image_to_raw_mesh"]}

        async def schedule_job(self, job_req: JobRequest) -> str:
            nonlocal captured_job
            captured_job = job_req
            return "job-explicit-1"

    req = ImageToRawMeshRequest(
        image_base64=TINY_PNG_B64,
        model_preference="triposg_image_to_raw_mesh",
        auto_mode=False,
    )

    with patch("core.runtime_probe.probe_runtime", return_value=_get_mock_runtime()):
        resp = await image_to_raw_mesh(req, scheduler=MockScheduler(), file_store=None)

    assert resp.job_id == "job-explicit-1"
    assert captured_job is not None
    assert captured_job.model_preference == "triposg_image_to_raw_mesh"
    assert captured_job.metadata["plan"]["adapter"] == "triposg_image_to_raw_mesh"
    assert "fallback_chain" in captured_job.metadata


@pytest.mark.anyio
async def test_planner_wiring_auto_mode_uses_would_have_chosen():
    """Verify endpoint uses would_have_chosen when auto_mode=True."""
    captured_job: JobRequest | None = None

    class MockScheduler:
        def validate_model_preference(self, model_id, feature):
            return True

        def get_available_models(self, feature):
            return {feature: ["trellis2_image_to_raw_mesh", "hunyuan3d_shape_v21_image_to_raw_mesh"]}

        async def schedule_job(self, job_req: JobRequest) -> str:
            nonlocal captured_job
            captured_job = job_req
            return "job-auto-1"

    req = ImageToRawMeshRequest(
        image_base64=TINY_PNG_B64,
        auto_mode=True,
        requested_quality="balanced",
        object_type="general",
    )

    with patch("core.runtime_probe.probe_runtime", return_value=_get_mock_runtime()):
        resp = await image_to_raw_mesh(req, scheduler=MockScheduler(), file_store=None)

    assert resp.job_id == "job-auto-1"
    assert captured_job is not None
    # balanced + general routes to trellis2_image_to_raw_mesh
    assert captured_job.model_preference == "trellis2_image_to_raw_mesh"
    assert captured_job.metadata["chosen_model"] == "trellis2_image_to_raw_mesh"
    assert captured_job.metadata["planner_applied"] is True
    assert captured_job.inputs["fallback_chain"] == captured_job.metadata["fallback_chain"]


@pytest.mark.anyio
async def test_planner_wiring_input_prep_flags_passed():
    """Verify request-level input_prep overrides are passed into plan and metadata."""
    captured_job: JobRequest | None = None

    class MockScheduler:
        def validate_model_preference(self, model_id, feature):
            return True

        def get_available_models(self, feature):
            return {feature: ["trellis2_image_to_raw_mesh"]}

        async def schedule_job(self, job_req: JobRequest) -> str:
            nonlocal captured_job
            captured_job = job_req
            return "job-prep-1"

    req = ImageToRawMeshRequest(
        image_base64=TINY_PNG_B64,
        input_prep={
            "remove_background": False,
            "tight_crop": False,
        },
    )

    with patch("core.runtime_probe.probe_runtime", return_value=_get_mock_runtime()):
        resp = await image_to_raw_mesh(req, scheduler=MockScheduler(), file_store=None)

    assert resp.job_id == "job-prep-1"
    assert captured_job is not None
    prep = captured_job.metadata["plan"]["input_prep"]
    assert prep["remove_background"] is False
    assert prep["tight_crop"] is False


@pytest.mark.anyio
async def test_planner_wiring_rejects_unavailable_explicit_model():
    """Verify endpoint returns 400 when explicit model is unavailable and auto_mode=False."""
    class MockScheduler:
        def validate_model_preference(self, model_id, feature):
            return True

        def get_available_models(self, feature):
            return {feature: ["hunyuan3d_shape_v21_image_to_raw_mesh"]}

        async def schedule_job(self, job_req: JobRequest) -> str:
            return "should-not-reach"

    req = ImageToRawMeshRequest(
        image_base64=TINY_PNG_B64,
        model_preference="completely_missing_model",
        auto_mode=False,
    )

    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc_info:
        with patch("core.runtime_probe.probe_runtime", return_value=_get_mock_runtime()):
            await image_to_raw_mesh(req, scheduler=MockScheduler(), file_store=None)

    assert exc_info.value.status_code == 400
    assert "unavailable" in exc_info.value.detail.lower()

