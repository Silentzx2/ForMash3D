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

    assert str(backend["torch"].specifier) == "==2.6.0+cu124"
    assert str(backend["torchvision"].specifier) == "==0.21.0+cu124"
    assert str(backend["torchaudio"].specifier) == "==2.6.0+cu124"
    assert str(backend["transformers"].specifier) == "==4.48.3"
    assert str(backend["diffusers"].specifier) == "==0.30.3"
    assert Version("0.25.0") in backend["huggingface-hub"].specifier
    assert str(backend["datasets"].specifier) == "==3.6.0"
    assert "jaxtyping" in triposg


def test_installer_and_docker_builds_install_triposg_after_backend():
    installer = (BACKEND / "scripts/install.sh").read_text()
    backend_install = installer.rfind("-r requirements.txt")
    triposg_install = installer.rfind("thirdparty/TripoSG/requirements.txt")
    assert backend_install < triposg_install
    assert installer.count("thirdparty/TripoSG/requirements.txt") == 1
    assert '"huggingface_hub>=0.25.0,<0.26.0"' in installer

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
    assert "$UV_PIP uninstall --yes gradio gradio-client hf-gradio" in installer

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
