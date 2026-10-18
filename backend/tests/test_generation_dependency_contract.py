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


def test_backend_baseline_is_compatible_with_triposg():
    backend = requirements(BACKEND / "requirements.txt")
    triposg = requirements(BACKEND / "thirdparty/TripoSG/requirements.txt")

    if "torch" in backend:
        assert str(backend["torch"].specifier) == "==2.6.0+cu124"
        assert str(backend["torchvision"].specifier) == "==0.21.0+cu124"
        assert str(backend["torchaudio"].specifier) == "==2.6.0+cu124"
    assert str(backend["transformers"].specifier) == "==5.10.1"
    assert str(backend["diffusers"].specifier) == "==0.38.0"
    assert Version("1.5.0") in backend["huggingface-hub"].specifier
    assert str(backend["datasets"].specifier) == "==3.6.0"
    assert "jaxtyping" in triposg


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
    import sys
    import types
    from utils.torchvision_fix import fix_transformers_cache

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
    assert "utils_package.__path__[:] = original_utils_path" in paint_adapter
    assert "for path_entry in added_sys_paths:" in paint_adapter
    assert "sys.modules.pop(mod, None)" not in paint_adapter


def test_hunyuan_processing_errors_keep_the_original_cause():
    paint_adapter = (BACKEND / "adapters" / "hunyuan3d_paint_v21.py").read_text(encoding="utf-8")

    assert 'logger.exception("Hunyuan3D-Paint-v2-1 mesh painting failed")' in paint_adapter
    assert 'raise RuntimeError(f"Hunyuan3D-Paint-v2-1 mesh painting failed: {e}") from e' in paint_adapter
    assert "def _has_local_dino_checkpoint(path: Path) -> bool:" in paint_adapter
    assert "model weight files" in paint_adapter

