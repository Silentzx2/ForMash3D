import ast
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
ADAPTERS = ROOT / "backend" / "adapters"
FACTORY = ROOT / "backend" / "core" / "scheduler" / "model_factory.py"

PROFILE_MODULES = {
    "hunyuan3d_adapter_v21.py",
    "hunyuan3d_dit_v2_mini_turbo.py",
    "hunyuan3d_paint_v21.py",
    "hunyuan3d_shape_v21.py",
    "paint3d_adapter.py",
    "pixal3d_adapter.py",
    "taoflowforge_adapter.py",
    "trellis_adapter.py",
    "trellis2_adapter.py",
    "trellis2_paint_adapter.py",
    "triposg_adapter.py",
    "unique3d_adapter.py",
}
NON_IMAGE_INFERENCE_MODULES = {
    "ardy_adapter.py",
    "fastmesh_adapter.py",
    "partuv_adapter.py",
    "unirig_adapter.py",
}


def _tree(path):
    return ast.parse(path.read_text(encoding="utf-8"))


def _assignment(tree, name):
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign):
            if any(isinstance(target, ast.Name) and target.id == name for target in node.targets):
                return ast.literal_eval(node.value)
    raise AssertionError(f"assignment {name} was not found")


def _find_class(tree, name):
    return next(node for node in ast.walk(tree) if isinstance(node, ast.ClassDef) and node.name == name)


def _find_method(class_node, name):
    return next(
        node
        for node in class_node.body
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name
    )


def _calls(method, attribute):
    return [
        node
        for node in ast.walk(method)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == attribute
    ]


def _name_references(node):
    return {child.id for child in ast.walk(node) if isinstance(child, ast.Name)}


def _dict_entries(node):
    return {
        key.value: value
        for key, value in zip(node.keys, node.values)
        if isinstance(key, ast.Constant) and isinstance(key.value, str)
    }


def test_registry_generation_aliases_resolve_to_adapter_profile_owners():
    factory_tree = _tree(FACTORY)
    model_factory = next(node for node in ast.walk(factory_tree) if isinstance(node, ast.ClassDef) and node.name == "ModelFactory")
    registry_node = next(
        item.value
        for item in model_factory.body
        if isinstance(item, ast.Assign)
        and any(isinstance(target, ast.Name) and target.id == "ADAPTER_REGISTRY" for target in item.targets)
    )
    registry = ast.literal_eval(registry_node)
    aliases_node = next(
        item.value
        for item in model_factory.body
        if isinstance(item, ast.Assign)
        and any(isinstance(target, ast.Name) and target.id == "LEGACY_IMAGE_TO_RAW_ALIASES" for target in item.targets)
    )
    aliases = ast.literal_eval(aliases_node)

    expected_aliases = {
        "trellis_image_to_textured_mesh": "trellis_image_to_3d",
        "trellis2_image_to_textured_mesh": "trellis2_image_to_3d",
        "hunyuan3d_shape_v21_image_to_textured_mesh": "hunyuan3d_shape_v21_image_to_3d",
        "hunyuan3dv21_image_to_textured_mesh": "hunyuan3dv21_image_to_3d",
    }
    assert aliases == expected_aliases

    registered_profile_modules = {
        entry["module"].rsplit(".", 1)[-1] + ".py"
        for entry in registry.values()
        if entry["module"].startswith("adapters.")
        and entry["module"].rsplit(".", 1)[-1] + ".py" in PROFILE_MODULES
    }
    assert registered_profile_modules == PROFILE_MODULES
    registered_modules = {
        entry["module"].rsplit(".", 1)[-1] + ".py"
        for entry in registry.values()
    }
    assert registered_modules == PROFILE_MODULES | NON_IMAGE_INFERENCE_MODULES
    for model_id, entry in registry.items():
        module_file = entry["module"].rsplit(".", 1)[-1] + ".py"
        adapter_tree = _tree(ADAPTERS / module_file)
        class_names = {
            node.name for node in ast.walk(adapter_tree) if isinstance(node, ast.ClassDef)
        }
        assignment_names = {
            target.id
            for node in ast.walk(adapter_tree)
            if isinstance(node, ast.Assign)
            for target in node.targets
            if isinstance(target, ast.Name)
        }
        assert entry["class"] in class_names | assignment_names, model_id
        if module_file in PROFILE_MODULES:
            assert (ADAPTERS / module_file).is_file(), model_id
            assert _assignment(adapter_tree, "_LOCKED_INFERENCE_PROFILE"), model_id


def test_locked_profile_unpacking_wins_over_client_values():
    for module_file in PROFILE_MODULES - {"paint3d_adapter.py"}:
        tree = _tree(ADAPTERS / module_file)
        profiles = {
            name: _assignment(tree, name)
            for name in ("_LOCKED_INFERENCE_PROFILE", "_LOCKED_PAINTING_PROFILE")
            if any(
                isinstance(node, ast.Assign)
                and any(isinstance(target, ast.Name) and target.id == name for target in node.targets)
                for node in ast.walk(tree)
            )
        }
        locked_merges = [
            node.value
            for node in ast.walk(tree)
            if isinstance(node, ast.Assign)
            and any(isinstance(target, ast.Name) and target.id == "inputs" for target in node.targets)
            and isinstance(node.value, ast.Dict)
            and any(
                isinstance(value, ast.Name) and value.id == "inputs"
                for value in node.value.values
            )
            and any(
                _name_references(value) & profiles.keys()
                for value in node.value.values
            )
        ]
        assert locked_merges, module_file
        for merge in locked_merges:
            used_profiles = [
                profile
                for name, profile in profiles.items()
                if name in _name_references(merge)
            ]
            malicious_inputs = {
                key: {"steps": -1, "guidance_scale": 999, "enabled": True}
                for profile in used_profiles
                for key in profile
            }
            effective = malicious_inputs.copy()
            for value in merge.values:
                referenced_names = _name_references(value)
                for profile_name in profiles:
                    if profile_name in referenced_names:
                        effective.update(profiles[profile_name])
            for profile in used_profiles:
                for key, value in profile.items():
                    assert effective[key] == value, (module_file, key)


def test_adapter_profiles_reach_model_library_kwargs():
    shape_tree = _tree(ADAPTERS / "hunyuan3d_shape_v21.py")
    shape_profile = _assignment(shape_tree, "_LOCKED_INFERENCE_PROFILE")
    shape_method = _find_method(
        _find_class(shape_tree, "Hunyuan3DShapeV21ImageToRawMeshAdapter"),
        "_process_request",
    )
    shape_call = next(call for call in ast.walk(shape_method) if isinstance(call, ast.Call) and isinstance(call.func, ast.Attribute) and call.func.attr == "pipeline_shapegen")
    shape_kwargs = {kw.arg: kw.value for kw in shape_call.keywords}
    assert ast.unparse(shape_kwargs["octree_resolution"]) == "octree_res"
    assert ast.unparse(shape_kwargs["num_inference_steps"]) == "num_steps"
    assert ast.unparse(shape_kwargs["guidance_scale"]) == "guidance_scale"
    assert (shape_profile["octree_resolution"], shape_profile["num_inference_steps"], shape_profile["guidance_scale"]) == (512, 50, 7.0)

    pixal_tree = _tree(ADAPTERS / "pixal3d_adapter.py")
    pixal_profile = _assignment(pixal_tree, "_LOCKED_INFERENCE_PROFILE")
    pixal_method = _find_method(_find_class(pixal_tree, "Pixal3DImageToRawMeshAdapter"), "_run_inference")
    pixal_call = next(call for call in _calls(pixal_method, "run") if isinstance(call.func.value, ast.Attribute) and call.func.value.attr == "pipeline")
    pixal_kwargs = {kw.arg: kw.value for kw in pixal_call.keywords}
    assert ast.unparse(pixal_kwargs["sparse_structure_sampler_params"]) == "ss_override"
    assert ast.unparse(pixal_kwargs["shape_slat_sampler_params"]) == "shape_override"
    assert ast.unparse(pixal_kwargs["tex_slat_sampler_params"]) == "tex_override"
    assert ast.unparse(pixal_kwargs["resolution"]) == "resolution"
    assert ast.unparse(pixal_kwargs["pipeline_type"]) == "pipeline_type"
    assert pixal_profile["sampler_overrides"]["sparse_structure"]["guidance_rescale"] == 0.9
    assert pixal_profile["sampler_overrides"]["shape"]["guidance_rescale"] == 0.8
    assert pixal_profile["sampler_overrides"]["texture"]["guidance_rescale"] == 0.5
    assert pixal_profile["max_num_tokens"] == 524288
    pixal_assignments = {
        target.id: ast.unparse(node.value)
        for node in ast.walk(pixal_method)
        if isinstance(node, ast.Assign)
        for target in node.targets
        if isinstance(target, ast.Name)
    }
    for name in ("pipeline_type", "max_num_tokens", "resolution", "low_vram"):
        assert pixal_assignments[name] == f"_LOCKED_INFERENCE_PROFILE['{name}']"

    legacy_tree = _tree(ADAPTERS / "hunyuan3d_adapter_v21.py")
    legacy_profile = _assignment(legacy_tree, "_LOCKED_INFERENCE_PROFILE")
    legacy_method = _find_method(
        _find_class(legacy_tree, "Hunyuan3DV21ImageToTexturedMeshAdapter"),
        "_process_request",
    )
    legacy_call = next(call for call in ast.walk(legacy_method) if isinstance(call, ast.Call) and isinstance(call.func, ast.Attribute) and call.func.attr == "pipeline_shapegen")
    legacy_kwargs = {kw.arg: kw.value for kw in legacy_call.keywords}
    assert ast.unparse(legacy_kwargs["octree_resolution"]) == "inputs['octree_resolution']"
    assert legacy_profile["octree_resolution"] == 512


def test_trellis_stage_kwargs_keep_the_profile_and_existing_cap():
    tree = _tree(ADAPTERS / "trellis_adapter.py")
    profile = _assignment(tree, "_LOCKED_INFERENCE_PROFILE")
    method = _find_method(_find_class(tree, "TrellisImageToMeshAdapterCommon"), "_process_request")
    call = next(
        call
        for call in _calls(method, "run")
        if any(keyword.arg == "sparse_structure_sampler_params" for keyword in call.keywords)
    )
    kwargs = {keyword.arg: keyword.value for keyword in call.keywords}
    sparse_sampler = _dict_entries(kwargs["sparse_structure_sampler_params"])
    slat_sampler = _dict_entries(kwargs["slat_sampler_params"])
    assert ast.unparse(sparse_sampler["steps"]) == "ss_steps"
    assert ast.unparse(sparse_sampler["cfg_strength"]) == "guidance"
    assert ast.unparse(slat_sampler["steps"]) == "slat_steps"
    assert ast.unparse(slat_sampler["cfg_strength"]) == "_LOCKED_INFERENCE_PROFILE['slat_cfg_strength']"
    assert profile["slat_cfg_strength"] == 3.0
    assert "min(50, ss_steps)" in ast.unparse(method)
    assert "min(50, slat_steps)" in ast.unparse(method)


def test_trellis2_raw_pipeline_receives_adapter_locked_kwargs():
    tree = _tree(ADAPTERS / "trellis2_adapter.py")
    profile = _assignment(tree, "_LOCKED_INFERENCE_PROFILE")
    method = _find_method(_find_class(tree, "Trellis2ImageToRawMeshAdapter"), "_process_request")
    call = next(call for call in _calls(method, "image_to_mesh"))
    kwargs = {keyword.arg: keyword.value for keyword in call.keywords}
    for argument in (
        "pipeline_type",
        "max_num_tokens",
        "sparse_structure_sampler_params",
        "shape_slat_sampler_params",
        "tex_slat_sampler_params",
    ):
        assert argument in kwargs
    assert profile["pipeline_type"] == "1536_cascade"
    assert profile["max_num_tokens"] == 524288
    assert profile["sparse_structure_sampler_params"]["steps"] == 50
    assert profile["shape_slat_sampler_params"]["guidance_rescale"] == 0.8
    assert profile["tex_slat_sampler_params"]["guidance_strength"] == 3.5


def test_paint3d_locks_sampler_settings_but_forwards_caller_seed():
    tree = _tree(ADAPTERS / "paint3d_adapter.py")
    profile = _assignment(tree, "_LOCKED_INFERENCE_PROFILE")
    assert profile == {
        "stage1_txt2img": {"guidance_scale": 7.0, "num_inference_steps": 40},
        "stage1_inpaint": {
            "guidance_scale": 3.0,
            "num_inference_steps": 40,
            "denoising_strength": 1.0,
        },
        "stage2_inpaint": {
            "guidance_scale": 3.0,
            "num_inference_steps": 40,
            "denoising_strength": 1.0,
        },
        "stage2_img2img": {
            "guidance_scale": 7.0,
            "num_inference_steps": 40,
            "denoising_strength": 0.75,
        },
    }
    config_method = _find_method(_find_class(tree, "Paint3DAdapter"), "_generate_configs")
    template = ast.unparse(config_method)
    assert "_LOCKED_INFERENCE_PROFILE" in template
    assert "seed: {seed}" in template
    request_method = _find_method(_find_class(tree, "Paint3DAdapter"), "_process_request")
    assert any(
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == "_generate_configs"
        and any(keyword.arg == "seed" and ast.unparse(keyword.value) == "seed" for keyword in node.keywords)
        for node in ast.walk(request_method)
    )


def test_trellis_effective_cap_is_preserved_as_an_approval_conflict():
    tree = _tree(ADAPTERS / "trellis_adapter.py")
    profile = _assignment(tree, "_LOCKED_INFERENCE_PROFILE")
    method = _find_method(_find_class(tree, "TrellisImageToMeshAdapterCommon"), "_process_request")
    source = ast.unparse(method)
    assert profile["ss_sampling_steps"] == profile["slat_sampling_steps"] == 50
    assert "min(50, ss_steps)" in source
    assert "min(50, slat_steps)" in source
