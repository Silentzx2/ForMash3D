import ast
import pytest
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Dict, Optional

from core.planner import plan_generation, resolve_seed_plan


def _load_model_input_builder():
    scheduler_path = (
        Path(__file__).resolve().parents[1]
        / "core"
        / "scheduler"
        / "multiprocess_scheduler.py"
    )
    tree = ast.parse(scheduler_path.read_text(encoding="utf-8"))
    nodes = []
    namespace = {"Any": Any, "Dict": Dict, "Optional": Optional}

    for node in tree.body:
        if isinstance(node, ast.Assign) and any(
            isinstance(target, ast.Name) and target.id == "_POSTPROCESS_ONLY_INPUTS"
            for target in node.targets
        ):
            namespace["_POSTPROCESS_ONLY_INPUTS"] = frozenset(
                ast.literal_eval(node.value.args[0])
            )
            nodes.append(node)
        elif isinstance(node, ast.FunctionDef) and node.name == "_build_model_inference_inputs":
            namespace.update({
                "_ADAPTER_OWNED_INFERENCE_PROFILE_MODEL_IDS": frozenset(),
                "_ADAPTER_OWNED_INFERENCE_INPUTS": frozenset(),
                "_RAW_MESH_MAX_QUALITY_PARAMETERS": {},
            })
            nodes.append(node)

    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(scheduler_path), "exec"), namespace)
    return namespace["_build_model_inference_inputs"]


def _load_model_fallback_policy():
    scheduler_path = (
        Path(__file__).resolve().parents[1]
        / "core"
        / "scheduler"
        / "multiprocess_scheduler.py"
    )
    tree = ast.parse(scheduler_path.read_text(encoding="utf-8"))
    node = next(
        statement
        for statement in tree.body
        if isinstance(statement, ast.FunctionDef)
        and statement.name == "_may_fallback_after_model_load_failure"
    )
    namespace = {"Any": Any, "Dict": Dict, "Optional": Optional}
    exec(
        compile(ast.Module(body=[node], type_ignores=[]), str(scheduler_path), "exec"),
        namespace,
    )
    return namespace[node.name]


def _load_smart_request_builder():
    smart_generation_path = (
        Path(__file__).resolve().parents[1]
        / "api"
        / "routers"
        / "smart_generation.py"
    )
    tree = ast.parse(smart_generation_path.read_text(encoding="utf-8"))
    nodes = [
        statement
        for statement in tree.body
        if isinstance(statement, ast.FunctionDef)
        and statement.name in {"_override_value", "_build_smart_request"}
    ]

    class Payload:
        def __init__(self, **values):
            self.__dict__.update(values)

    namespace = {
        "Any": Any,
        "Dict": Dict,
        "SmartGenerationRequest": object,
        "ImageToRawMeshRequest": Payload,
        "ImageToTexturedMeshRequest": Payload,
    }
    exec(
        compile(ast.Module(body=nodes, type_ignores=[]), str(smart_generation_path), "exec"),
        namespace,
    )
    return namespace["_build_smart_request"]


def test_explicit_zero_seed_is_the_first_seed_in_candidate_schedule():
    seed_plan = resolve_seed_plan(
        {"candidate_count": 3},
        {"seed": 0},
        seeds_cfg={"base_seed": 41, "seed_step": 7, "max_candidates": 4},
        apply_cfg={"auto_seeds": False},
    )

    assert seed_plan["base_seed"] == 0
    assert seed_plan["seed_schedule"] == [0, 7, 14]


def test_unset_seed_uses_configured_base_seed():
    seed_plan = resolve_seed_plan(
        {"candidate_count": 2},
        {},
        seeds_cfg={"base_seed": 41, "seed_step": 7, "max_candidates": 4},
        apply_cfg={"auto_seeds": False},
    )

    assert seed_plan["seed_schedule"] == [41, 48]


def test_explicit_model_preference_wins_over_auto_mode_and_preset_route():
    explicit_model = "explicit-model"
    rules = {
        "adapters": {explicit_model: {"requires_cuda": False}},
        "quality_routes": {
            "balanced": {"candidates": [{"adapter": "preset-recommended-model"}]}
        },
        "fallback_of_last_resort": {
            "adapter": "last-resort-model",
            "preset": "fast",
            "num_seeds": 1,
        },
    }
    runtime = {
        "installed_adapters": [explicit_model, "preset-recommended-model", "last-resort-model"],
        "enabled_adapters": [explicit_model, "preset-recommended-model", "last-resort-model"],
        "has_cuda": False,
    }

    plan = plan_generation(
        {"model_preference": explicit_model, "auto_mode": True},
        runtime,
        rules=rules,
    )

    assert plan["adapter"] == explicit_model
    assert plan["fallback_chain"] == []


def test_scheduler_does_not_route_candidate_or_production_fields_to_models():
    build_model_inputs = _load_model_input_builder()

    model_inputs = build_model_inputs(
        {
            "image_path": "source.png",
            "seed": 0,
            "candidate_count": 3,
            "target_polycount": 50_000,
            "enable_postprocess": True,
            "plan": {"num_seeds": 3},
            "fallback_chain": ["fallback-model"],
            "quality": "ultra",
            "topology_mode": "quad",
            "quad_topology": True,
        },
        model_id="test-model",
    )

    assert model_inputs == {"image_path": "source.png", "seed": 0}


def test_automatic_model_selection_can_fall_back_after_load_failure():
    may_fallback = _load_model_fallback_policy()

    assert may_fallback("planner-selected-model", {"model_selection": "automatic"})
    assert may_fallback(None, {})


def test_explicit_model_selection_remains_a_hard_requirement():
    may_fallback = _load_model_fallback_policy()

    assert not may_fallback("user-selected-model", {"model_selection": "explicit"})
    assert not may_fallback("legacy-user-selected-model", {})


def test_smart_intent_preserves_only_user_supplied_model_as_explicit():
    build_smart_request = _load_smart_request_builder()
    resolved = {
        "preset": {},
        "model_id": "intent-selected-model",
        "feature": "image_to_raw_mesh",
        "version": 1,
        "candidate_order": [],
        "vram_budget_mb": 1,
    }
    request_fields = {
        "image_path": "source.png",
        "image_base64": None,
        "image_file_id": None,
        "intent": "game_ready",
        "overrides": {},
        "physics_enabled": None,
        "enable_printability_check": None,
        "enable_auto_repair": None,
        "enable_auto_rig": None,
        "preprocessing_artifact_id": None,
        "preprocessing_review_override": False,
        "enhancement_enabled": False,
        "auto_rig_mode": "full",
        "physics_config": None,
        "topology_mode": "triangle",
        "quad_topology": False,
        "asset_name": None,
        "image_name": None,
    }

    automatic, _ = build_smart_request(
        SimpleNamespace(**request_fields, model=None), resolved
    )
    explicit, _ = build_smart_request(
        SimpleNamespace(**request_fields, model="user-selected-model"),
        {**resolved, "model_id": "user-selected-model"},
    )

    assert automatic.model_preference is None
    assert explicit.model_preference == "user-selected-model"


def test_auto_seeds_enabled_executes_planned_candidate_count():
    seed_plan = resolve_seed_plan(
        {"candidate_count": None, "plan": {"num_seeds": 3}},
        {"seed": 10},
        seeds_cfg={"base_seed": 41, "seed_step": 5, "max_candidates": 4},
        apply_cfg={"auto_seeds": True},
    )

    assert seed_plan["candidate_count"] == 3
    assert seed_plan["auto_seeds_enabled"] is True
    assert seed_plan["seed_schedule"] == [10, 15, 20]


def test_explicit_single_candidate_count_wins_over_auto_seeds():
    seed_plan = resolve_seed_plan(
        {"candidate_count": 1, "plan": {"num_seeds": 3}},
        {"seed": 10},
        seeds_cfg={"base_seed": 41, "seed_step": 5, "max_candidates": 4},
        apply_cfg={"auto_seeds": True},
    )

    assert seed_plan["candidate_count"] == 1
    assert seed_plan["auto_candidates"] is False
    assert seed_plan["seed_schedule"] == [10]


def test_rate_limit_disabled_allows_arbitrary_requests():
    import asyncio
    from unittest.mock import MagicMock
    from api.dependencies import _rate_limit_result

    request = MagicMock()
    request.state = MagicMock()
    request.state._formash_rate_limit_result = None

    settings = MagicMock()
    settings.security.rate_limit_enabled = False
    settings.security.rate_limit_per_minute = 0

    result = asyncio.run(_rate_limit_result(request, settings))
    assert result["allowed"] is True
    assert result["limit"] == 0


def test_multi_gpu_load_sharing_accepts_candidate_when_single_gpu_is_insufficient():
    runtime = {
        "has_cuda": True,
        "gpu_count": 2,
        "installed_adapters": ["trellis2_image_to_raw_mesh"],
        "enabled_adapters": ["trellis2_image_to_raw_mesh"],
        "free_vram_gb": 14.36,
        "max_free_vram_gb": 14.36,
        "aggregate_free_vram_gb": 28.72,
    }
    plan = plan_generation(
        {"model_preference": "trellis2_image_to_raw_mesh", "auto_mode": False},
        runtime,
    )
    assert plan["adapter"] == "trellis2_image_to_raw_mesh"
    assert any("multi-GPU load sharing" in r or "low-VRAM" in r for r in plan["reasons"])


def test_low_vram_mode_accepts_trellis2_when_free_vram_meets_low_threshold():
    runtime = {
        "has_cuda": True,
        "gpu_count": 1,
        "installed_adapters": ["trellis2_image_to_raw_mesh"],
        "enabled_adapters": ["trellis2_image_to_raw_mesh"],
        "free_vram_gb": 14.36,
        "max_free_vram_gb": 14.36,
        "aggregate_free_vram_gb": 14.36,
    }
    plan = plan_generation(
        {"model_preference": "trellis2_image_to_raw_mesh", "auto_mode": False},
        runtime,
    )
    assert plan["adapter"] == "trellis2_image_to_raw_mesh"


def test_low_vram_false_rejects_trellis2_when_free_vram_is_below_full_24gb():
    runtime = {
        "has_cuda": True,
        "gpu_count": 1,
        "installed_adapters": ["trellis2_image_to_raw_mesh"],
        "enabled_adapters": ["trellis2_image_to_raw_mesh"],
        "free_vram_gb": 14.36,
        "max_free_vram_gb": 14.36,
        "aggregate_free_vram_gb": 14.36,
    }
    with pytest.raises(ValueError, match="requires 23.0 GB VRAM, but only 14.36 GB is free"):
        plan_generation(
            {"model_preference": "trellis2_image_to_raw_mesh", "auto_mode": False, "low_vram": False},
            runtime,
        )


def test_low_vram_false_accepts_trellis2_when_free_vram_meets_full_24gb():
    runtime = {
        "has_cuda": True,
        "gpu_count": 1,
        "installed_adapters": ["trellis2_image_to_raw_mesh"],
        "enabled_adapters": ["trellis2_image_to_raw_mesh"],
        "free_vram_gb": 24.0,
        "max_free_vram_gb": 24.0,
        "aggregate_free_vram_gb": 24.0,
    }
    plan = plan_generation(
        {"model_preference": "trellis2_image_to_raw_mesh", "auto_mode": False, "low_vram": False},
        runtime,
    )
    assert plan["adapter"] == "trellis2_image_to_raw_mesh"


def test_legacy_textured_mesh_model_preference_normalizes_to_raw_mesh():
    runtime = {
        "has_cuda": True,
        "gpu_count": 2,
        "installed_adapters": ["trellis2_image_to_raw_mesh", "trellis2_image_to_textured_mesh"],
        "enabled_adapters": ["trellis2_image_to_raw_mesh", "trellis2_image_to_textured_mesh"],
        "free_vram_gb": 14.36,
        "max_free_vram_gb": 14.36,
        "aggregate_free_vram_gb": 28.72,
    }
    plan = plan_generation(
        {"model_preference": "trellis2_image_to_textured_mesh", "auto_mode": False},
        runtime,
    )
    assert plan["adapter"] == "trellis2_image_to_raw_mesh"


def test_random_seed_dynamic_assignment_when_seed_unspecified():
    import random
    from core.config import get_quality_config
    from core.planner import get_planner_apply_config, resolve_seed_plan

    request_inputs = {}
    model_inputs = {}

    seeds = set()
    for _ in range(5):
        seeds_cfg = dict(get_quality_config()["seeds"])
        if model_inputs.get("seed") is None and request_inputs.get("seed") is None:
            seeds_cfg["base_seed"] = random.randint(10000, 999999)
        plan = resolve_seed_plan(
            request_inputs,
            model_inputs,
            seeds_cfg=seeds_cfg,
            apply_cfg=get_planner_apply_config(),
        )
        seed = plan["base_seed"]
        assert 10000 <= seed <= 999999
        seeds.add(seed)

    # Over 5 runs with range 10000..999999, seeds should not all be identical
    assert len(seeds) > 1


def test_unloaded_model_rejected_when_free_vram_is_insufficient():
    """When a model is not loaded and free VRAM is below requirements, it must be rejected."""
    runtime = {
        "has_cuda": True,
        "gpu_count": 1,
        "installed_adapters": ["trellis_image_to_raw_mesh"],
        "enabled_adapters": ["trellis_image_to_raw_mesh"],
        "free_vram_gb": 4.63,
        "max_free_vram_gb": 4.63,
        "aggregate_free_vram_gb": 4.63,
        "loaded_models": [],
    }
    with pytest.raises(ValueError, match="requires 11.5 GB VRAM, but only 4.63 GB is free"):
        plan_generation(
            {"model_preference": "trellis_image_to_raw_mesh", "auto_mode": False},
            runtime,
        )


def test_already_loaded_model_accepted_even_with_low_free_vram():
    """When a model is already loaded in worker memory, it must not be rejected due to low free VRAM."""
    runtime = {
        "has_cuda": True,
        "gpu_count": 1,
        "installed_adapters": ["trellis_image_to_raw_mesh"],
        "enabled_adapters": ["trellis_image_to_raw_mesh"],
        "free_vram_gb": 4.63,
        "max_free_vram_gb": 4.63,
        "aggregate_free_vram_gb": 4.63,
        "loaded_models": ["trellis_image_to_raw_mesh"],
    }
    plan = plan_generation(
        {"model_preference": "trellis_image_to_raw_mesh", "auto_mode": False},
        runtime,
    )
    assert plan["adapter"] == "trellis_image_to_raw_mesh"
    assert any("already loaded in worker memory" in r for r in plan["reasons"])


def test_already_loaded_model_with_legacy_alias_accepted_when_vram_is_low():
    """Legacy alias request succeeds when the canonical model is already loaded."""
    runtime = {
        "has_cuda": True,
        "gpu_count": 1,
        "installed_adapters": ["trellis_image_to_raw_mesh", "trellis_image_to_textured_mesh"],
        "enabled_adapters": ["trellis_image_to_raw_mesh", "trellis_image_to_textured_mesh"],
        "free_vram_gb": 4.63,
        "max_free_vram_gb": 4.63,
        "aggregate_free_vram_gb": 4.63,
        "loaded_models": ["trellis_image_to_raw_mesh"],
    }
    plan = plan_generation(
        {"model_preference": "trellis_image_to_textured_mesh", "auto_mode": False},
        runtime,
    )
    assert plan["adapter"] == "trellis_image_to_raw_mesh"
    assert any("already loaded in worker memory" in r for r in plan["reasons"])


def test_scheduler_get_loaded_models_and_router_extraction():
    """Verify scheduler reporting of loaded models and router helper extraction."""
    from core.scheduler.multiprocess_scheduler import MultiprocessModelScheduler
    from api.routers.mesh_generation import _get_loaded_models_from_scheduler

    scheduler = MultiprocessModelScheduler.__new__(MultiprocessModelScheduler)
    scheduler.worker_assignments = {
        "trellis_image_to_raw_mesh": ["worker_1"],
    }
    scheduler.workers = {}
    scheduler.worker_configs = {}

    loaded = scheduler.get_loaded_models()
    assert "trellis_image_to_raw_mesh" in loaded

    router_loaded = _get_loaded_models_from_scheduler(scheduler)
    assert "trellis_image_to_raw_mesh" in router_loaded


def test_already_loaded_model_accepted_even_with_low_vram_false():
    """Even if low_vram is explicitly False and free VRAM is below requirements, resident model is accepted."""
    runtime = {
        "has_cuda": True,
        "gpu_count": 1,
        "installed_adapters": ["trellis_image_to_raw_mesh"],
        "enabled_adapters": ["trellis_image_to_raw_mesh"],
        "free_vram_gb": 4.63,
        "max_free_vram_gb": 4.63,
        "aggregate_free_vram_gb": 4.63,
        "loaded_models": ["trellis_image_to_raw_mesh"],
    }
    plan = plan_generation(
        {
            "model_preference": "trellis_image_to_raw_mesh",
            "auto_mode": False,
            "low_vram": False,
        },
        runtime,
    )
    assert plan["adapter"] == "trellis_image_to_raw_mesh"
    assert any("already loaded in worker memory" in r for r in plan["reasons"])


def test_auto_mode_selects_already_loaded_candidate_when_free_vram_is_constrained():
    """In auto mode with low free VRAM, candidate already loaded in worker memory is selected."""
    runtime = {
        "has_cuda": True,
        "gpu_count": 1,
        "installed_adapters": [
            "trellis2_image_to_raw_mesh",
            "hunyuan3d_shape_v21_image_to_raw_mesh",
        ],
        "enabled_adapters": [
            "trellis2_image_to_raw_mesh",
            "hunyuan3d_shape_v21_image_to_raw_mesh",
        ],
        "free_vram_gb": 4.63,
        "max_free_vram_gb": 4.63,
        "aggregate_free_vram_gb": 4.63,
        "loaded_models": ["hunyuan3d_shape_v21_image_to_raw_mesh"],
    }
    # balanced quality routes candidates: trellis2 first, then hunyuan3d
    plan = plan_generation(
        {
            "mesh_style": "auto",
            "requested_quality": "balanced",
            "object_type": "general",
            "auto_mode": True,
        },
        runtime,
    )
    assert plan["adapter"] == "hunyuan3d_shape_v21_image_to_raw_mesh"
    assert any("already loaded in worker memory" in r for r in plan["reasons"])



