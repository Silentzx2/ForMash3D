"""Rule-based pipeline planner.

Pure function plan_generation(request, runtime, rules) -> dict.
Fulfills TASKS.md Section 8 specification.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import yaml

logger = logging.getLogger(__name__)

# Default mapping between adapter ID and adapter class name
DEFAULT_ADAPTER_CLASS_MAP = {
    # Shape & Raw Mesh
    "hunyuan3d_shape_v21_image_to_raw_mesh": "Hunyuan3DShapeV21ImageToRawMeshAdapter",
    "hunyuan3d_shape_v21_image_to_mesh": "Hunyuan3DShapeV21ImageToMeshAdapter",
    "hunyuan3d_shape_v21_image_to_textured_mesh": "Hunyuan3DShapeV21ImageToTexturedMeshAdapter",
    "hunyuan3d_dit_v2_mini_turbo_image_to_raw_mesh": "Hunyuan3DDiTV2MiniTurboImageToRawMeshAdapter",
    "hunyuan3d_adapter_v21_image_to_raw_mesh": "Hunyuan3DV21ImageToRawMeshAdapter",
    "hunyuan3d_adapter_v21_image_to_textured_mesh": "Hunyuan3DV21ImageToTexturedMeshAdapter",
    "trellis2_image_to_raw_mesh": "Trellis2ImageToRawMeshAdapter",
    "trellis2_image_to_textured_mesh": "Trellis2ImageToTexturedMeshAdapter",
    "trellis2_image_to_3d": "Trellis2ImageToMeshAdapter",
    "trellis_image_to_raw_mesh": "TrellisImageToRawMeshAdapter",
    "trellis_image_to_textured_mesh": "TrellisImageToTexturedMeshAdapter",
    "trellis_image_to_3d": "TrellisImageToMeshAdapterCommon",
    "triposg_image_to_raw_mesh": "TripoSGImageToRawMeshAdapter",
    "unique3d_image_to_raw_mesh": "Unique3DImageToRawMeshAdapter",
    "pixal3d_image_to_raw_mesh": "Pixal3DImageToRawMeshAdapter",
    "pixal3d_image_to_3d": "Pixal3DImageToRawMeshAdapter",
    "taoflowforge_image_to_raw_mesh": "TaoFlowForgeImageToRawMeshAdapter",
    # Painting
    "hunyuan3d_paint_v21_image_mesh_painting": "Hunyuan3DPaintV21ImageMeshPaintingAdapter",
    "trellis_image_mesh_painting": "TrellisImageMeshPaintingAdapter",
    "trellis2_image_mesh_painting": "Trellis2ImageMeshPaintingAdapter",
    "trellis_text_mesh_painting": "TrellisTextMeshPaintingAdapter",
    "paint3d": "Paint3DAdapter",
    # Auto-Rig
    "unirig_auto_rig": "UniRigAdapter",
    # Retopology
    "fastmesh_v1k_retopology": "FastMeshRetopologyAdapter",
    "fastmesh_v4k_retopology": "FastMeshRetopologyAdapter",
    # UV
    "partuv_uv_unwrapping": "PartUVUnwrappingAdapter",
    # Motion
    "ardy_motion_generation": "ArdyMotionGenerationAdapter",
}

# Legacy alias mapping for raw geometry routing
LEGACY_RAW_MODEL_ALIASES = {
    "trellis2_image_to_textured_mesh": "trellis2_image_to_raw_mesh",
    "trellis2_image_to_3d": "trellis2_image_to_raw_mesh",
    "trellis_image_to_textured_mesh": "trellis_image_to_raw_mesh",
    "trellis_image_to_3d": "trellis_image_to_raw_mesh",
    "hunyuan3d_shape_v21_image_to_textured_mesh": "hunyuan3d_shape_v21_image_to_raw_mesh",
}

_RULES_CACHE: Optional[Dict[str, Any]] = None
_MODELS_CACHE: Optional[Dict[str, Any]] = None


def clear_rules_cache() -> None:
    """Clear internal rules cache to force reload from disk."""
    global _RULES_CACHE, _MODELS_CACHE
    _RULES_CACHE = None
    _MODELS_CACHE = None


def _load_models_yaml() -> Dict[str, Any]:
    """Load canonical model configs from backend/config/models.yaml."""
    global _MODELS_CACHE
    if _MODELS_CACHE is not None:
        return _MODELS_CACHE

    models_path = Path(__file__).resolve().parent.parent / "config" / "models.yaml"
    if not models_path.exists():
        candidate = Path.cwd() / "backend" / "config" / "models.yaml"
        if candidate.exists():
            models_path = candidate

    flat: Dict[str, Any] = {}
    if models_path.exists():
        try:
            raw = yaml.safe_load(models_path.read_text(encoding="utf-8")) or {}
            for feature, models in raw.items():
                if isinstance(models, dict):
                    for mid, mcfg in models.items():
                        if isinstance(mcfg, dict):
                            flat[mid] = mcfg
        except Exception as e:
            logger.warning("Failed to load models.yaml in planner: %s", e)

    _MODELS_CACHE = flat
    return _MODELS_CACHE


def _load_default_rules() -> Dict[str, Any]:
    """Load default planner rules from backend/config/planner_rules.yaml."""
    global _RULES_CACHE
    if _RULES_CACHE is not None:
        return _RULES_CACHE

    rules_path = Path(__file__).resolve().parent.parent / "config" / "planner_rules.yaml"
    if not rules_path.exists():
        candidate = Path.cwd() / "backend" / "config" / "planner_rules.yaml"
        if candidate.exists():
            rules_path = candidate

    if rules_path.exists():
        try:
            _RULES_CACHE = yaml.safe_load(rules_path.read_text(encoding="utf-8")) or {}
            return _RULES_CACHE
        except Exception as e:
            logger.warning("Failed to load planner rules from %s: %s", rules_path, e)

    return {}


def _is_adapter_registered(
    adapter_id: str,
    adapter_class: Optional[str],
    installed: List[str],
) -> bool:
    """Verify if adapter is registered in installed_adapters."""
    if not installed:
        return False
    if adapter_id in installed:
        return True
    if adapter_class and adapter_class in installed:
        return True
    mapped_class = DEFAULT_ADAPTER_CLASS_MAP.get(adapter_id)
    if mapped_class and mapped_class in installed:
        return True
    # Normalized convention fallback
    norm_id = adapter_id.replace("_", "").lower()
    for item in installed:
        norm_item = item.replace("_", "").lower()
        if norm_item == norm_id or norm_item == f"{norm_id}adapter" or norm_id == f"{norm_item}adapter":
            return True
    return False


def _is_adapter_enabled(
    adapter_id: str,
    adapter_class: Optional[str],
    enabled: List[str],
) -> bool:
    """Verify if adapter is enabled in models configuration."""
    if not enabled:
        return False
    if adapter_id in enabled:
        return True
    if adapter_class and adapter_class in enabled:
        return True
    for item in enabled:
        if item == adapter_id or adapter_id.startswith(f"{item}_") or item.startswith(f"{adapter_id}_"):
            return True
    return False


def _is_license_optin_satisfied(
    adapter_id: str,
    requires_optin: bool,
    optins: Dict[str, bool],
) -> Tuple[bool, Optional[str]]:
    """Check license opt-in status for an adapter."""
    # Check explicit opt-out / rejection
    if adapter_id in optins and optins[adapter_id] is False:
        return False, f"License opt-in explicitly rejected for candidate '{adapter_id}'."

    for key, accepted in optins.items():
        if (key in adapter_id or adapter_id.startswith(key)) and accepted is False:
            return False, f"License opt-in explicitly rejected for candidate '{adapter_id}'."

    # If opt-in is required, check if user explicitly accepted
    if requires_optin:
        accepted = False
        if adapter_id in optins and optins[adapter_id] is True:
            accepted = True
        else:
            for key, val in optins.items():
                if (key in adapter_id or adapter_id.startswith(key)) and val is True:
                    accepted = True
                    break
        if not accepted:
            return False, f"Candidate '{adapter_id}' requires license opt-in which has not been accepted."

    return True, None


def plan_generation(
    request: Dict[str, Any],
    runtime: Dict[str, Any],
    rules: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Pure function generating an execution plan from request parameters and runtime facts.

    Inputs:
        request: dict containing mesh_style, requested_quality, object_type, symmetry,
                 target_polycount, input_type, etc.
        runtime: dict matching exact specification from runtime_probe.py.
        rules: optional custom routing rules; defaults to backend/config/planner_rules.yaml.

    Outputs dict:
        adapter, fallback_chain, preset, num_seeds, input_prep, skip_retopo_allowed,
        uv_backend, bake, reasons, warnings, schema_version.
    """
    if rules is None:
        rules = _load_default_rules()

    reasons: List[str] = []
    warnings: List[str] = []

    # 1. Normalize and default inputs
    mesh_style = request.get("mesh_style", "auto")
    if mesh_style not in ("clean", "detailed", "auto"):
        mesh_style = "auto"

    requested_quality = request.get("requested_quality", request.get("quality", "balanced"))
    if requested_quality not in ("fast", "balanced", "high"):
        requested_quality = "balanced"

    object_type = request.get("object_type", "general")
    if object_type not in ("mechanical", "organic", "character", "general"):
        object_type = "general"

    symmetry = request.get("symmetry", "none")
    if symmetry not in ("bilateral", "radial", "none"):
        symmetry = "none"

    target_polycount = request.get("target_polycount")
    if target_polycount is not None:
        try:
            target_polycount = int(target_polycount)
        except (ValueError, TypeError):
            target_polycount = None

    input_type = request.get("input_type")
    if not input_type:
        if "text" in request and "image" not in request:
            input_type = "text"
        else:
            input_type = "image"

    if symmetry != "none":
        reasons.append(f"Requested symmetry: {symmetry} (recorded for downstream processing)")
    if target_polycount is not None:
        reasons.append(f"Target polycount constraint: {target_polycount}")

    # 2. Compute seeds based on quality tier
    seeds_by_quality = {"fast": 1, "balanced": 2, "high": 3}
    quality_seeds = seeds_by_quality.get(requested_quality, 2)

    # 3. Assemble candidate chain in priority order
    candidates: List[Dict[str, Any]] = []

    explicit_model = request.get("model_preference") or request.get("model") or request.get("adapter")
    if explicit_model is not None:
        explicit_model = str(explicit_model).strip()
        if explicit_model.lower() in ("auto", "default", "none", ""):
            explicit_model = None
    auto_mode = request.get("auto_mode")
    if auto_mode is None:
        auto_mode = explicit_model is None
    else:
        auto_mode = bool(auto_mode)
    if explicit_model is not None:
        auto_mode = False

    # Fallback of last resort candidate definition
    fallback_resort = rules.get("fallback_of_last_resort", {
        "adapter": "hunyuan3d_shape_v21_image_to_raw_mesh",
        "preset": "fast",
        "num_seeds": 1,
        "skip_retopo_allowed": False,
    })
    fallback_retopo = "feature_aware" if (mesh_style == "clean" or object_type == "mechanical") else (rules.get("object_type_routes", {}).get(object_type, {}).get("retopo_mode") or "standard")
    fallback_resort_cand = {
        "adapter": fallback_resort.get("adapter", "hunyuan3d_shape_v21_image_to_raw_mesh"),
        "preset": fallback_resort.get("preset", "fast"),
        "num_seeds": fallback_resort.get("num_seeds", 1),
        "skip_retopo_allowed": fallback_resort.get("skip_retopo_allowed", False),
        "source": "fallback_of_last_resort",
        "retopo_mode": fallback_retopo,
    }

    if not auto_mode and explicit_model:
        explicit_model_str = str(explicit_model).strip()
        reasons.append(f"Explicit model choice requested: '{explicit_model_str}'")
        canonical_model = LEGACY_RAW_MODEL_ALIASES.get(explicit_model_str, explicit_model_str)
        if canonical_model != explicit_model_str:
            reasons.append(f"Mapped legacy model '{explicit_model_str}' to raw mesh model '{canonical_model}'")
            explicit_model_str = canonical_model
        cand_meta = rules.get("adapters", {}).get(explicit_model_str, {})
        candidates.append({
            "adapter": explicit_model_str,
            "preset": requested_quality,
            "num_seeds": quality_seeds,
            "skip_retopo_allowed": cand_meta.get("skip_retopo_allowed", False),
            "source": "explicit_model_choice",
            "retopo_mode": "feature_aware" if (mesh_style == "clean" or object_type == "mechanical") else "standard",
        })
    else:
        # Check if native topology route requested (clean or mechanical)
        # TASKS.md: clean/mechanical -> native adapter ONLY if enabled + verified; else dense route with feature-aware retopo
        if mesh_style == "clean" or object_type == "mechanical":
            native_cfg = (
                rules.get("specialized_routes", {})
                .get("native_clean", {})
                .get("native_candidate", {})
            )
            native_adapter = native_cfg.get("adapter", "taoflowforge_image_to_raw_mesh")
            candidates.append({
                "adapter": native_adapter,
                "preset": requested_quality,
                "num_seeds": quality_seeds,
                "skip_retopo_allowed": True,
                "source": "native_clean_route",
                "retopo_mode": "native",
            })

        # Add dense quality candidates: check object_type_routes first, then fallback to quality_routes
        dense_candidates = (
            rules.get("object_type_routes", {})
            .get(object_type, {})
            .get(requested_quality, {})
            .get("candidates", [])
        )
        if not dense_candidates:
            dense_candidates = (
                rules.get("quality_routes", {})
                .get(requested_quality, {})
                .get("candidates", [])
            )

        for dc in dense_candidates:
            cand_retopo = dc.get("retopo_mode")
            if (mesh_style == "clean" or object_type == "mechanical") and not cand_retopo:
                cand_retopo = "feature_aware"
            candidates.append({
                "adapter": dc["adapter"],
                "preset": dc.get("preset", requested_quality),
                "num_seeds": dc.get("num_seeds", quality_seeds),
                "skip_retopo_allowed": dc.get("skip_retopo_allowed", False),
                "source": f"object_{object_type}_{requested_quality}_route",
                "retopo_mode": cand_retopo,
            })

        if not candidates or candidates[-1]["adapter"] != fallback_resort_cand["adapter"] or candidates[-1]["preset"] != fallback_resort_cand["preset"]:
            candidates.append(fallback_resort_cand)

    # 4. Evaluate candidates sequentially against runtime capabilities
    installed_adapters = runtime.get("installed_adapters", [])
    enabled_adapters = runtime.get("enabled_adapters", [])
    license_optins = runtime.get("license_optins", {})
    has_cuda = runtime.get("has_cuda", False)
    free_vram_gb = runtime.get("free_vram_gb")

    selected_candidate: Optional[Dict[str, Any]] = None
    selected_idx: int = -1

    models_catalog = _load_models_yaml()

    for idx, cand in enumerate(candidates):
        cand_id = cand["adapter"]
        # Normalize legacy aliases to canonical models
        canonical_cand_id = LEGACY_RAW_MODEL_ALIASES.get(cand_id, cand_id)
        if canonical_cand_id != cand_id:
            cand["adapter"] = canonical_cand_id
            cand_id = canonical_cand_id

        cand_meta = rules.get("adapters", {}).get(cand_id, {})
        model_meta = dict(models_catalog.get(cand_id, {}))
        alias_target = model_meta.get("alias_of")
        if alias_target and alias_target in models_catalog:
            for k, v in models_catalog[alias_target].items():
                model_meta.setdefault(k, v)

        adapter_class = cand_meta.get("adapter_class", DEFAULT_ADAPTER_CLASS_MAP.get(cand_id))
        vram_mb = model_meta.get("vram_requirement")
        vram_budget_gb = round(float(vram_mb) / 1024.0, 2) if vram_mb is not None else float(cand_meta.get("vram_budget_gb", 0.0))
        supported_inputs = model_meta.get("supported_inputs") or cand_meta.get("supported_inputs", ["image"])
        requires_cuda = cand_meta.get("requires_cuda", True)
        requires_license = cand_meta.get("requires_license_optin", False)

        # Check A: Registered
        if not _is_adapter_registered(cand_id, adapter_class, installed_adapters):
            msg = f"Candidate '{cand_id}' is not installed/registered."
            reasons.append(f"Candidate {cand_id} skipped: {msg}")
            if idx == 0:
                warnings.append(f"Preferred candidate '{cand_id}' unavailable: {msg}")
            continue

        # Check B: Enabled
        if not _is_adapter_enabled(cand_id, adapter_class, enabled_adapters):
            msg = f"Candidate '{cand_id}' is disabled in configuration."
            reasons.append(f"Candidate {cand_id} skipped: {msg}")
            if idx == 0:
                warnings.append(f"Preferred candidate '{cand_id}' unavailable: {msg}")
            continue

        # Check C: License opt-in
        lic_ok, lic_msg = _is_license_optin_satisfied(cand_id, requires_license, license_optins)
        if not lic_ok:
            reasons.append(f"Candidate {cand_id} skipped: {lic_msg}")
            if idx == 0:
                warnings.append(f"Preferred candidate '{cand_id}' unavailable: {lic_msg}")
            continue

        # Check D: CUDA and VRAM budget (single GPU, multi-GPU load sharing, or low-VRAM mode)
        if requires_cuda:
            if not has_cuda:
                msg = f"Candidate '{cand_id}' requires CUDA, but CUDA is not available."
                reasons.append(f"Candidate {cand_id} skipped: {msg}")
                if idx == 0:
                    warnings.append(f"Preferred candidate '{cand_id}' unavailable: {msg}")
                continue

            caps = dict(model_meta.get("capabilities") or {})
            multi_gpu = caps.get("multi_gpu", False) or model_meta.get("multi_gpu", False)
            low_vram_supported = (
                caps.get("low_vram_supported", False)
                or caps.get("cpu_offload", False)
                or "low_vram_requirement" in model_meta
            )
            low_vram_mb = model_meta.get("low_vram_requirement")
            low_vram_gb = round(float(low_vram_mb) / 1024.0, 2) if low_vram_mb is not None else 10.0

            gpu_count = int(runtime.get("gpu_count", 1 if has_cuda else 0))
            aggregate_free_gb = runtime.get("aggregate_free_vram_gb") or free_vram_gb
            max_free_gb = runtime.get("max_free_vram_gb") or free_vram_gb

            # 1. Fits on single GPU
            if max_free_gb is not None and max_free_gb >= vram_budget_gb:
                pass
            # 2. Fits across multiple GPUs (load sharing)
            elif multi_gpu and gpu_count > 1 and aggregate_free_gb is not None and aggregate_free_gb >= vram_budget_gb:
                reasons.append(
                    f"Candidate '{cand_id}' requires {vram_budget_gb} GB VRAM; scheduled for multi-GPU load sharing across {gpu_count} GPUs ({aggregate_free_gb} GB aggregate free)."
                )
            # 3. Fits low-VRAM sequential offload mode
            elif low_vram_supported and (
                (max_free_gb is not None and max_free_gb >= low_vram_gb)
                or (gpu_count > 1 and aggregate_free_gb is not None and aggregate_free_gb >= low_vram_gb)
            ):
                reasons.append(
                    f"Candidate '{cand_id}' requires {vram_budget_gb} GB VRAM; fits within {low_vram_gb} GB low-VRAM threshold."
                )
            # 4. Insufficient VRAM across available hardware
            elif free_vram_gb is not None:
                if multi_gpu and gpu_count > 1:
                    msg = f"Candidate '{cand_id}' requires {vram_budget_gb} GB VRAM across GPUs, but only {aggregate_free_gb} GB is free across {gpu_count} GPUs."
                else:
                    msg = f"Candidate '{cand_id}' requires {vram_budget_gb} GB VRAM, but only {max_free_gb if max_free_gb is not None else free_vram_gb} GB is free."
                reasons.append(f"Candidate {cand_id} skipped: {msg}")
                warnings.append(f"Fallback from candidate '{cand_id}': {msg}")
                continue

        # Check E: Input type support
        if input_type not in supported_inputs:
            msg = f"Candidate '{cand_id}' does not support input type '{input_type}'."
            reasons.append(f"Candidate {cand_id} skipped: {msg}")
            if idx == 0:
                warnings.append(f"Preferred candidate '{cand_id}' unavailable: {msg}")
            continue

        # All checks passed!
        selected_candidate = cand
        selected_idx = idx
        break

    # 5. If all candidates failed (e.g. no CUDA), recompute whole plan using fallback of last resort
    if selected_candidate is None:
        if not auto_mode and explicit_model:
            failure_detail = "; ".join(reasons[-2:]) if len(reasons) >= 2 else (reasons[-1] if reasons else "candidate failed capability checks")
            raise ValueError(f"Explicit model '{explicit_model}' is unavailable: {failure_detail}")
        selected_candidate = fallback_resort_cand
        selected_idx = len(candidates) - 1
        reasons.append(
            f"All candidates failed runtime checks; selected fallback of last resort: {selected_candidate['adapter']}"
        )
        warnings.append("Selected fallback of last resort; generation may run on CPU or fail if CUDA is required.")
        if not has_cuda:
            warnings.append("No CUDA device available in runtime environment.")

    # 6. Build remaining fallback chain (unique candidate adapter IDs after the selected one)
    fallback_chain: List[str] = []
    for cand in candidates[selected_idx + 1:]:
        f_id = cand["adapter"]
        if f_id != selected_candidate["adapter"] and f_id not in fallback_chain:
            fallback_chain.append(f_id)

    if auto_mode:
        last_resort_id = fallback_resort_cand["adapter"]
        if last_resort_id != selected_candidate["adapter"] and last_resort_id not in fallback_chain:
            fallback_chain.append(last_resort_id)

    # 7. Merge defaults with request overrides for input_prep, uv_backend, bake
    default_input_prep = dict(rules.get("default_input_prep", {
        "remove_background": True,
        "clean_alpha": True,
        "tight_crop": True,
        "margin": 0.1,
        "resize": True,
        "target_size": 1024,
        "upscale_small": True,
        "upscale_threshold": 512,
    }))
    if isinstance(request.get("input_prep"), dict):
        default_input_prep.update(request["input_prep"])

    default_uv = rules.get("default_uv", {}).get("backend", "auto")
    uv_backend = request.get("uv_backend", default_uv)

    default_bake = dict(rules.get("default_bake", {
        "normal_from_master": True,
        "convention": "opengl",
        "bake_ao": False,
    }))
    if isinstance(request.get("bake"), dict):
        default_bake.update(request["bake"])

    schema_version = str(rules.get("schema_version", "1.0.0"))

    # 8. Determine retopology mode and options
    selected_model_meta = models_catalog.get(selected_candidate["adapter"], {})
    native_topology = bool(selected_model_meta.get("capabilities", {}).get("native_topology", False))
    if selected_candidate.get("skip_retopo_allowed") or native_topology:
        retopo_mode = "native"
    elif mesh_style == "clean" or object_type == "mechanical":
        retopo_mode = "feature_aware"
    else:
        retopo_mode = selected_candidate.get("retopo_mode") or rules.get("object_type_routes", {}).get(object_type, {}).get("retopo_mode", "standard")

    if (mesh_style == "clean" or object_type == "mechanical") and not selected_candidate.get("skip_retopo_allowed"):
        reasons.append(
            f"Dense route '{selected_candidate['adapter']}' selected with feature-aware retopology "
            f"because native topology candidate is unavailable or disabled."
        )

    retopo_configs = rules.get("retopo_configs", {})
    retopo_cfg = dict(retopo_configs.get(retopo_mode, {}))
    retopo_dict = {
        "mode": retopo_mode,
        "feature_preserving": retopo_mode == "feature_aware",
        **retopo_cfg,
    }
    if target_polycount is not None:
        retopo_dict["target_polycount"] = target_polycount

    planned_seeds = int(selected_candidate["num_seeds"])
    auto_seeds = bool((rules.get("apply") or {}).get("auto_seeds", False))
    seed_note = (
        f"{planned_seeds} seeds"
        if auto_seeds
        else f"{planned_seeds} planned seeds, 1 executed because auto_seeds is disabled"
    )
    reasons.append(
        f"Selected adapter '{selected_candidate['adapter']}' with preset '{selected_candidate['preset']}' "
        f"({seed_note}) for quality='{requested_quality}', "
        f"mesh_style='{mesh_style}', object_type='{object_type}', retopo_mode='{retopo_mode}'."
    )

    return {
        "schema_version": schema_version,
        "adapter": selected_candidate["adapter"],
        "fallback_chain": fallback_chain,
        "preset": selected_candidate["preset"],
        "num_seeds": selected_candidate["num_seeds"],
        "input_prep": default_input_prep,
        "skip_retopo_allowed": selected_candidate["skip_retopo_allowed"],
        "retopo_mode": retopo_mode,
        "retopo": retopo_dict,
        "uv_backend": uv_backend,
        "bake": default_bake,
        "reasons": reasons,
        "warnings": warnings,
        "would_have_chosen": selected_candidate["adapter"],
    }


def get_planner_apply_config() -> Dict[str, bool]:
    """Return feature switches controlling planner application."""
    rules = _load_default_rules()
    return dict(rules.get("apply", {"model_choice": False, "auto_seeds": False, "input_prep": True}))


def resolve_seed_plan(
    request_inputs: Optional[Dict[str, Any]] = None,
    model_inputs: Optional[Dict[str, Any]] = None,
    seeds_cfg: Optional[Dict[str, Any]] = None,
    apply_cfg: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Return the candidate and seed plan that will actually execute.

    The planner's ``num_seeds`` is a plan value: it is only executed when
    ``apply.auto_seeds`` is enabled. The user's candidate count always wins, and
    the returned schedule lists the exact seeds that run.
    """
    request_inputs = request_inputs or {}
    model_inputs = model_inputs or {}
    seeds_cfg = dict(seeds_cfg or {})
    apply_cfg = dict(apply_cfg if apply_cfg is not None else get_planner_apply_config())

    user_candidate_count = max(1, int(request_inputs.get("candidate_count") or 1))
    plan_num_seeds = max(1, int((request_inputs.get("plan") or {}).get("num_seeds") or 1))
    auto_seeds = bool(apply_cfg.get("auto_seeds", False))

    if user_candidate_count > 1:
        candidate_count = user_candidate_count
        auto_candidates = False
    elif auto_seeds and plan_num_seeds > 1:
        candidate_count = plan_num_seeds
        auto_candidates = True
    else:
        candidate_count = 1
        auto_candidates = False

    max_candidates = int(seeds_cfg.get("max_candidates") or 4)
    candidate_count = min(max(candidate_count, 1), max_candidates)

    seed = model_inputs.get("seed")
    if seed is None:
        seed = seeds_cfg.get("base_seed", 0)
    base_seed = int(seed)
    seed_step = int(seeds_cfg.get("seed_step") or 0)
    return {
        "candidate_count": candidate_count,
        "user_candidate_count": user_candidate_count,
        "planned_candidate_count": plan_num_seeds,
        "auto_seeds_enabled": auto_seeds,
        "auto_candidates": auto_candidates,
        "base_seed": base_seed,
        "seed_step": seed_step,
        "seed_schedule": [base_seed + (index * seed_step) for index in range(candidate_count)],
    }
