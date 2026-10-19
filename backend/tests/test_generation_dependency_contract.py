from pathlib import Path

from packaging.requirements import Requirement
from packaging.version import Version


BACKEND = Path(__file__).resolve().parents[1]


def requirements(path: Path) -> dict[str, Requirement]:
    return {
        requirement.name.lower().replace("_", "-"): requirement
        for line in path.read_text().splitlines()
        if line.strip() and not line.lstrip().startswith("#") and not line.startswith("-")
        for requirement in [Requirement(line.partition("#")[0].strip())]
    }


def test_backend_baseline_matches_the_declared_shared_triposg_runtime():
    backend = requirements(BACKEND / "requirements.txt")
    triposg = requirements(BACKEND / "thirdparty/TripoSG/requirements.txt")

    # The repo's working shared pins are maintained in backend/requirements.txt.
    # TripoSG intentionally leaves these shared packages to the parent environment.
    if "torch" in backend:
        assert str(backend["torch"].specifier) == "==2.6.0+cu124"
        assert str(backend["torchvision"].specifier) == "==0.21.0+cu124"
        assert str(backend["torchaudio"].specifier) == "==2.6.0+cu124"
    assert str(backend["transformers"].specifier) == "==4.44.2"
    assert str(backend["diffusers"].specifier) == "==0.30.3"
    assert Version("0.25.5") in backend["huggingface-hub"].specifier
    assert Version("0.26.0") not in backend["huggingface-hub"].specifier
    assert str(backend["datasets"].specifier) == "==3.6.0"
    assert "jaxtyping" in triposg
    assert not ({"transformers", "diffusers", "huggingface-hub"} & set(triposg))


def test_installer_and_docker_builds_install_triposg_after_backend():
    installer = (BACKEND / "scripts/install.sh").read_text()
    backend_install = installer.find("$PROJECT_ROOT/backend/requirements.txt")
    triposg_install = installer.find("thirdparty/TripoSG/requirements.txt")
    assert backend_install < triposg_install
    assert installer.count("thirdparty/TripoSG/requirements.txt") == 1

    repo_root = BACKEND.parent
    dockerfiles = [
        path for name in ("Dockerfile", "Dockerfile.runpod")
        for path in (repo_root / name, BACKEND / name)
        if path.is_file()
    ]
    assert len(dockerfiles) >= 2
    for dockerfile in dockerfiles:
        docker = dockerfile.read_text()
        assert "torch==2.6.0" in docker and "cu124" in docker
        assert "python=3.10" in docker
        assert docker.index("/app/backend/requirements.txt") < docker.index(
            "/app/backend/thirdparty/TripoSG/requirements.txt"
        )



def test_unique3d_avoids_unused_gradio_ui_wrapper():
    installer = (BACKEND / "scripts/install.sh").read_text()
    unique3d_block = installer.split("### Unique3D ###", 1)[1].split("### Unique3D end ###", 1)[0]
    assert '"datasets==3.6.0"' in unique3d_block
    assert not any(line.strip().startswith("gradio ") for line in unique3d_block.splitlines())
    assert "$UV_PIP uninstall gradio gradio-client hf-gradio" in installer

    adapter = (BACKEND / "adapters/unique3d_adapter.py").read_text()
    assert "from app.custom_models.mvimg_prediction import run_mvprediction" not in adapter



def test_hunyuan_model_loaders_use_their_vendored_package_roots():
    shape = (BACKEND / "adapters/hunyuan3d_shape_v21.py").read_text()
    mini = (BACKEND / "adapters/hunyuan3d_dit_v2_mini_turbo.py").read_text()
    scheduler = (BACKEND / "core/scheduler/multiprocess_scheduler.py").read_text()

    assert "from hy3dshape.pipelines import Hunyuan3DDiTFlowMatchingPipeline" in shape
    assert "from hy3dshape.rembg import BackgroundRemover" in shape
    assert "hy3dshape.hy3dshape.pipelines" not in shape
    assert 'sys.path.append(str(self.hunyuan3d_root))' in shape
    assert 'thirdparty_turbo / "hy3dgen" / "shapegen" / "pipelines.py"' in mini
    assert "requires CUDA; refusing to initialize model weights on CPU" in mini
    assert "logger.exception(" in mini
    assert 'error=f"{err_msg}\\n{tb}"' not in scheduler
    assert 'WorkerResponse("init", False, error=err_msg)' in scheduler


def test_transformers_cache_compatibility_shim(monkeypatch):
    import importlib.util
    import sys
    import types
    import uuid

    # Load the main-repo helper by file path; the generic `utils` namespace
    # intentionally retains Hunyuan Shape's independent utilities.
    helper_path = BACKEND / "utils" / "torchvision_fix.py"
    helper_name = f"backend_torchvision_fix_{uuid.uuid4().hex}"
    spec = importlib.util.spec_from_file_location(helper_name, helper_path)
    helper_module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper_module)
    fix_transformers_cache = helper_module.fix_transformers_cache

    class DynamicCache:
        def __init__(self):
            self.updates = 0

        def update(self):
            self.updates += 1

    fake_tf = types.ModuleType("transformers")
    fake_tf.Cache = object
    fake_tf.DynamicCache = DynamicCache
    fake_cache_utils = types.ModuleType("transformers.cache_utils")
    fake_cache_utils.DynamicCache = DynamicCache
    fake_tf.cache_utils = fake_cache_utils
    monkeypatch.setitem(sys.modules, "transformers", fake_tf)
    monkeypatch.setitem(sys.modules, "transformers.cache_utils", fake_cache_utils)

    assert not hasattr(fake_tf, "HybridCache")
    success = fix_transformers_cache()
    assert success is True
    assert fake_tf.HybridCache is DynamicCache
    assert fake_cache_utils.HybridCache is DynamicCache
    cache = fake_tf.HybridCache()
    cache.update()
    assert cache.updates == 1


def test_torchvision_fix_import_survives_native_import_error(monkeypatch):
    import builtins
    import importlib.util
    import uuid

    module_path = BACKEND / "utils" / "torchvision_fix.py"
    module_name = f"torchvision_fix_native_error_{uuid.uuid4().hex}"
    original_import = builtins.__import__

    def fail_torchvision_import(name, *args, **kwargs):
        if name == "torchvision":
            raise RuntimeError("torchvision::nms operator does not exist")
        return original_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", fail_torchvision_import)
    spec = importlib.util.spec_from_file_location(module_name, module_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    assert module.torchvision is None
    assert isinstance(module._TORCHVISION_IMPORT_ERROR, RuntimeError)


def test_hunyuan_paint_import_paths_are_scoped_not_global():
    backend_utils = (BACKEND / "utils" / "__init__.py").read_text(encoding="utf-8")
    paint_adapter = (BACKEND / "adapters" / "hunyuan3d_paint_v21.py").read_text(encoding="utf-8")

    assert "_hy3dpaint_candidates" not in backend_utils
    assert "hunyuan3d-shape-v2-1" in backend_utils  # Keep shape adapter lookup intact.
    assert "utils_package.__path__[:] = original_utils_path" in paint_adapter
    assert "for path_entry in added_sys_paths:" in paint_adapter
    assert "sys.modules.pop(mod, None)" not in paint_adapter


def test_hunyuan_processing_errors_keep_the_original_cause():
    paint_adapter = (BACKEND / "adapters" / "hunyuan3d_paint_v21.py").read_text(encoding="utf-8")

    assert 'logger.exception("Hunyuan3D-Paint-v2-1 mesh painting failed")' in paint_adapter
    assert 'raise RuntimeError(f"Hunyuan3D-Paint-v2-1 mesh painting failed: {e}") from e' in paint_adapter
    assert "def _has_local_dino_checkpoint(path: Path) -> bool:" in paint_adapter
    assert "model weight files" in paint_adapter


def test_base_model_failure_state_and_load_error_chain_contracts():
    base = (BACKEND / "core" / "models" / "base.py").read_text(encoding="utf-8")
    load_start = base.index("    def load(")
    unload_start = base.index("    def unload(", load_start)
    load_block = base[load_start:unload_start]
    process_start = base.index("    def process(")
    process_end = base.find("\n    def ", process_start + 5)
    process_block = base[process_start:process_end]

    assert 'raise RuntimeError(f"Failed to load model {self.model_id}: {e}") from e' in load_block
    assert "self.status = ModelStatus.ERROR" in process_block
    assert "if succeeded:" in process_block
    assert "self.status = ModelStatus.LOADED" in process_block


def test_paint3d_runtime_preflight_and_uv_contracts():
    paint = (BACKEND / "adapters" / "paint3d_adapter.py").read_text(encoding="utf-8")

    assert "self._preflight_stage_imports()" in paint
    assert "pipeline_paint3d_stage1" in paint and "pipeline_paint3d_stage2" in paint
    assert "child-stage import preflight failed" in paint
    assert "requires finite per-vertex UV coordinates before texturing" in paint
    assert "np.isfinite(uv_array).all()" in paint


def test_scoped_adapter_loaders_preserve_exception_causes():
    unirig = (BACKEND / "adapters" / "unirig_adapter.py").read_text(encoding="utf-8")
    ardy = (BACKEND / "adapters" / "ardy_adapter.py").read_text(encoding="utf-8")
    factory = (BACKEND / "core" / "scheduler" / "model_factory.py").read_text(encoding="utf-8")

    assert 'raise RuntimeError(f"Failed to load UniRig model: {e}") from e' in unirig
    assert 'raise RuntimeError(f"Failed to load ARDY model: {e}") from e' in ardy
    assert "raise RuntimeError(" in factory and ") from e" in factory
    assert "logger.exception(" in factory


def test_model_factory_uses_the_main_backend_compatibility_helper():
    factory = (BACKEND / "core" / "scheduler" / "model_factory.py").read_text(encoding="utf-8")
    runtime_compat = (BACKEND / "core" / "utils" / "runtime_compat.py").read_text(encoding="utf-8")
    unirig = (BACKEND / "adapters" / "unirig_adapter.py").read_text(encoding="utf-8")

    assert "get_backend_torchvision_fix().apply_fix()" in factory
    assert "_formash3d_backend_torchvision_fix" in runtime_compat
    assert "from utils.torchvision_fix import apply_fix" not in factory
    assert "get_backend_torchvision_fix().apply_fix()" in unirig

    scheduler = (BACKEND / "core" / "scheduler" / "multiprocess_scheduler.py").read_text(encoding="utf-8")
    assert "get_backend_torchvision_fix().apply_fix()" in scheduler
    assert "from utils.torchvision_fix import apply_fix" not in scheduler

    paint = (BACKEND / "adapters" / "hunyuan3d_paint_v21.py").read_text(encoding="utf-8")
    assert "get_backend_torchvision_fix().fix_numba_caching()" in paint
    assert "from utils.torchvision_fix import" not in paint
    assert "from torchvision_fix import" not in paint




def test_torch_cluster_fallback_imports_its_runtime_types_lazily(monkeypatch):
    import builtins
    import importlib.util
    import sys
    import types
    import uuid

    helper_path = BACKEND / "utils" / "torchvision_fix.py"
    helper_name = f"torchvision_fix_torch_cluster_{uuid.uuid4().hex}"
    original_import = builtins.__import__
    fake_torch = types.ModuleType("torch")
    fake_torch.Tensor = type("Tensor", (), {})

    def import_without_torch_cluster(name, *args, **kwargs):
        if name == "torch_cluster":
            raise ImportError("optional torch_cluster is not installed")
        return original_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", import_without_torch_cluster)
    monkeypatch.setitem(sys.modules, "torch", fake_torch)
    monkeypatch.delitem(sys.modules, "torch_cluster", raising=False)

    spec = importlib.util.spec_from_file_location(helper_name, helper_path)
    helper_module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper_module)

    assert helper_module.fix_torch_cluster() is True
    assert callable(sys.modules["torch_cluster"].fps)


def test_unirig_selects_only_attention_backends_supported_by_the_model():
    source = (BACKEND / "thirdparty" / "UniRig" / "src" / "model" / "unirig_ar.py").read_text(encoding="utf-8")

    assert "AutoModelForCausalLM._model_mapping[type(llm_config)]" in source
    assert "getattr(model_class, '_supports_sdpa', False)" in source
    assert "'eager'" in source


def test_fastmesh_manifest_does_not_claim_unsupported_multi_gpu_dispatch():
    manifest = (BACKEND / "config" / "models.yaml").read_text(encoding="utf-8")
    start = manifest.index("  fastmesh_v1k_retopology:")
    end = manifest.index("\n# UV unwrapping", start)
    fastmesh = manifest[start:end]

    assert "multi_gpu:" not in fastmesh
    assert "multi_gpu_strategy:" not in fastmesh
    assert "vram_requirement: 16384" in fastmesh
    assert "vram_requirement: 24500" in fastmesh


def test_fastmesh_download_and_readiness_require_full_checkpoints():
    downloader = (BACKEND / "scripts" / "download_models.sh").read_text(encoding="utf-8")
    system = (BACKEND / "api" / "routers" / "system.py").read_text(encoding="utf-8")

    assert 'verify_file "$model_dir/model.safetensors" 4000000000' in downloader
    assert 'verify_fastmesh_model "$PRETRAINED_DIR/FastMesh-V1K" || all_verified=false' in downloader
    assert 'verify_fastmesh_model "$PRETRAINED_DIR/FastMesh-V4K" || all_verified=false' in downloader
    assert 'checkpoint.stat().st_size > 4_000_000_000' in system
    assert 'descriptor.get("max_vertices") == expected_vertices' in system



def test_fastmesh_uses_architecture_compatible_attention_fallback():
    single_gpt = (BACKEND / "thirdparty" / "FastMesh" / "models" / "single_gpt.py").read_text(encoding="utf-8")
    shape_opt = (BACKEND / "thirdparty" / "FastMesh" / "models" / "shape_opt.py").read_text(encoding="utf-8")

    assert "def _select_fastmesh_attention_implementation() -> str:" in single_gpt
    assert "torch.cuda.get_device_capability(torch.cuda.current_device())" in single_gpt
    assert "if capability[0] >= 8:" in single_gpt
    assert "_attn_implementation=attention_implementation" in single_gpt
    assert 'self.config._attn_implementation ="flash_attention_2"' not in single_gpt

    assert "from transformers.modeling_attn_mask_utils import _prepare_4d_causal_attention_mask" in shape_opt
    assert "_prepare_4d_causal_attention_mask(" in shape_opt
    assert "Only flash_attention_2 is supported in MeshAnything" not in shape_opt



def test_unirig_pointcept_uses_eager_attention_on_pre_ampere_gpus():
    ptv3 = (
        BACKEND / "thirdparty" / "UniRig" / "src" / "model"
        / "pointcept" / "models" / "PTv3Object.py"
    ).read_text(encoding="utf-8")

    assert "def _supports_flash_attention_on_current_device() -> bool:" in ptv3
    assert "torch.cuda.get_device_capability(torch.cuda.current_device())" in ptv3
    assert "return major >= 8" in ptv3
    assert "enable_flash = bool(enable_flash and _supports_flash_attention_on_current_device())" in ptv3
    assert "self.attn_drop = torch.nn.Dropout(attn_drop)" in ptv3
    assert "dropout_p=self.attn_drop.p if self.training else 0" in ptv3
    assert "self.attn_drop = attn_drop" not in ptv3
