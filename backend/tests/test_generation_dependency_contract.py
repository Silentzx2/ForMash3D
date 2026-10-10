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
    assert str(backend["transformers"].specifier) == "==4.44.2"
    assert str(backend["diffusers"].specifier) == "==0.30.3"
    assert Version("4.44.2") in triposg["transformers"].specifier
    assert Version("0.30.3") in triposg["diffusers"].specifier
    assert Version("0.25.0") in backend["huggingface-hub"].specifier
    assert Version("0.25.0") in triposg["huggingface-hub"].specifier


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
