import ast
from pathlib import Path
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
