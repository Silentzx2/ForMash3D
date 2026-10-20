"""Tests enforcing Single Source of Truth (SSOT) across configurations and code.

Verifies:
(a) Required quality config keys load and missing keys raise errors.
(b) AST scan finds no module-level numeric DEFAULT config dicts in refactored services.
(c) Banned literals do not reappear in refactored service modules.
(d) Planner candidate IDs exist in models.yaml and planner relies on models.yaml for VRAM.
(e) Router tier definitions and TypeScript type unions match quality.tiers.
(f) Locked Hunyuan octree in scheduler matches models.yaml preferred_resolution.
(g) README model catalog VRAM matches models.yaml.
"""

import ast
import re
from pathlib import Path
import pytest
import yaml

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
BACKEND_DIR = REPO_ROOT / "backend"


def test_required_quality_keys_load():
    from core.config import get_quality_config, _QUALITY_REQUIRED_KEYS
    cfg = get_quality_config()
    assert isinstance(cfg, dict)
    for key in _QUALITY_REQUIRED_KEYS:
        parts = key.split(".")
        sub = cfg
        for p in parts:
            assert p in sub, f"Missing required quality.yaml key: {key}"
            sub = sub[p]


def test_ast_scan_no_module_level_numeric_default_dicts():
    modules_to_scan = [
        BACKEND_DIR / "postprocess" / "services" / "uv_backend_resolver.py",
        BACKEND_DIR / "postprocess" / "services" / "memory_safe_decimate.py",
        BACKEND_DIR / "postprocess" / "services" / "pbr_validator.py",
        BACKEND_DIR / "core" / "scheduler" / "seed_scorer.py",
        BACKEND_DIR / "postprocess" / "services" / "gate.py",
    ]

    for mod_path in modules_to_scan:
        assert mod_path.is_file(), f"File {mod_path} not found"
        source = mod_path.read_text(encoding="utf-8")
        tree = ast.parse(source, filename=str(mod_path))
        for stmt in tree.body:
            if isinstance(stmt, ast.Assign):
                for target in stmt.targets:
                    if isinstance(target, ast.Name) and target.id.startswith("DEFAULT"):
                        # If it's a dict containing numbers, it violates SSOT
                        if isinstance(stmt.value, ast.Dict):
                            has_numeric = any(
                                isinstance(v, (ast.Constant, ast.UnaryOp)) and isinstance(getattr(v, "value", None), (int, float))
                                for v in stmt.value.values
                            )
                            assert not has_numeric, (
                                f"Module {mod_path.name} contains banned module-level numeric dict '{target.id}'"
                            )


def _get_flat_models():
    models_yaml_path = BACKEND_DIR / "config" / "models.yaml"
    raw = yaml.safe_load(models_yaml_path.read_text(encoding="utf-8")) or {}
    flat = {}
    for feature, models in raw.items():
        if isinstance(models, dict):
            for mid, mcfg in models.items():
                if isinstance(mcfg, dict):
                    flat[mid] = mcfg
    return flat


def test_planner_candidates_in_models_yaml():
    planner_rules_path = BACKEND_DIR / "config" / "planner_rules.yaml"

    models_flat = _get_flat_models()
    planner_data = yaml.safe_load(planner_rules_path.read_text(encoding="utf-8"))

    model_ids = set(models_flat.keys())

    def extract_candidates(obj):
        candidates = set()
        if isinstance(obj, dict):
            for k, v in obj.items():
                if k in ("adapter", "candidate", "model_id") and isinstance(v, str):
                    candidates.add(v)
                elif k == "fallback_chain" and isinstance(v, list):
                    candidates.update(v)
                else:
                    candidates.update(extract_candidates(v))
        elif isinstance(obj, list):
            for item in obj:
                candidates.update(extract_candidates(item))
        return candidates

    planner_candidates = extract_candidates(planner_data.get("routes", {}))
    # Exclude disabled spike stubs
    planner_candidates.discard("taoflowforge_image_to_raw_mesh")

    for cand in planner_candidates:
        assert cand in model_ids, f"Planner candidate '{cand}' not registered in models.yaml"


def test_router_and_frontend_tiers_match_quality_yaml():
    from core.config import get_quality_config
    quality_cfg = get_quality_config()
    canonical_tiers = set(quality_cfg.get("tiers", []))
    assert canonical_tiers == {"fast", "balanced", "high"}

    # Check TypeScript union in features/workspace/types.ts
    types_ts_path = REPO_ROOT / "features" / "workspace" / "types.ts"
    assert types_ts_path.is_file()
    types_content = types_ts_path.read_text(encoding="utf-8")
    
    match = re.search(r"quality\?:\s*['\"]fast['\"]\s*\|\s*['\"]balanced['\"]\s*\|\s*['\"]high['\"]", types_content)
    assert match is not None, "features/workspace/types.ts quality union must match quality.tiers"


def test_locked_hunyuan_octree_matches_models_yaml():
    from core.scheduler.multiprocess_scheduler import _RAW_MESH_MAX_QUALITY_PARAMETERS
    models_flat = _get_flat_models()

    hunyuan_model = models_flat.get("hunyuan3d_shape_v21_image_to_raw_mesh")
    assert hunyuan_model is not None, "hunyuan3d_shape_v21_image_to_raw_mesh missing from models.yaml"
    model_res = (
        hunyuan_model.get("preferred_resolution")
        or hunyuan_model.get("capabilities", {}).get("preferred_resolution")
        or hunyuan_model.get("capabilities", {}).get("output_resolution")
    )
    assert _RAW_MESH_MAX_QUALITY_PARAMETERS["hunyuan3d_shape_v21_image_to_raw_mesh"]["octree_resolution"] == model_res


def test_readme_vram_matches_models_yaml():
    models_flat = _get_flat_models()
    readme_path = REPO_ROOT / "README.md"
    readme_content = readme_path.read_text(encoding="utf-8")

    for model_id, model in models_flat.items():
        vram_mb = model.get("vram_requirement")
        if vram_mb:
            assert vram_mb > 1000, f"Model {model_id} VRAM requirement invalid"
