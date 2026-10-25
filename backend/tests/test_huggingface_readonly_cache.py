import os
import sys
import tempfile
import types
from pathlib import Path

backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

if "torch" not in sys.modules:
    sys.modules["torch"] = types.ModuleType("torch")


def _setup_mock_huggingface_hub(monkeypatch, mock_download):
    fake_hub = types.ModuleType("huggingface_hub")
    fake_fd = types.ModuleType("huggingface_hub.file_download")
    fake_hub.file_download = fake_fd
    fake_fd.hf_hub_download = mock_download
    monkeypatch.setitem(sys.modules, "huggingface_hub", fake_hub)
    monkeypatch.setitem(sys.modules, "huggingface_hub.file_download", fake_fd)
    return fake_fd


def test_redirected_hf_hub_download_readonly_cache_hit(monkeypatch):
    """
    Test that when hf_hub_download hits an OSError (Errno 30: Read-only file system),
    it locates and returns the file directly from existing snapshot cache without crashing.
    """
    with tempfile.TemporaryDirectory() as tmp_dir:
        hub_dir = Path(tmp_dir) / "hub"
        repo_id = "microsoft/TRELLIS.2-4B"
        repo_dir = hub_dir / f"models--{repo_id.replace('/', '--')}"
        snapshot_dir = repo_dir / "snapshots" / "abc123commit"
        snapshot_dir.mkdir(parents=True, exist_ok=True)
        
        target_file = snapshot_dir / "ckpts" / "tex_dec_next_dc_f16c32_fp16.json"
        target_file.parent.mkdir(parents=True, exist_ok=True)
        target_file.write_text('{"test": true}')

        monkeypatch.setenv("HUGGINGFACE_HUB_CACHE", str(hub_dir))

        def mock_orig_download(repo_id, filename, *args, **kwargs):
            err = OSError("Read-only file system: '/root/.cache/huggingface/hub/.locks/...'")
            err.errno = 30
            raise err

        fake_fd = _setup_mock_huggingface_hub(monkeypatch, mock_orig_download)

        import importlib.util
        spec = importlib.util.spec_from_file_location(
            "backend.utils.torchvision_fix",
            str(backend_dir / "utils" / "torchvision_fix.py")
        )
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        mod.fix_huggingface_repo_redirects()

        result = fake_fd.hf_hub_download("microsoft/TRELLIS.2-4B", "ckpts/tex_dec_next_dc_f16c32_fp16.json")
        assert result == str(target_file)
        assert Path(result).exists()


def test_redirected_hf_hub_download_readonly_cache_miss_fallback(monkeypatch):
    """
    Test that when a file is NOT in the read-only cache, it retries downloading
    to a writable fallback cache directory instead of crashing.
    """
    with tempfile.TemporaryDirectory() as tmp_dir:
        hub_dir = Path(tmp_dir) / "ro_hub"
        hub_dir.mkdir(parents=True, exist_ok=True)
        monkeypatch.setenv("HUGGINGFACE_HUB_CACHE", str(hub_dir))

        calls = []

        def mock_orig_download(repo_id, filename, *args, **kwargs):
            calls.append((repo_id, filename, kwargs.get("cache_dir")))
            if kwargs.get("cache_dir") is None:
                err = OSError("Read-only file system")
                err.errno = 30
                raise err
            return "/tmp/downloaded_file"

        fake_fd = _setup_mock_huggingface_hub(monkeypatch, mock_orig_download)

        import importlib.util
        spec = importlib.util.spec_from_file_location(
            "backend.utils.torchvision_fix",
            str(backend_dir / "utils" / "torchvision_fix.py")
        )
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        mod.fix_huggingface_repo_redirects()

        result = fake_fd.hf_hub_download("microsoft/TRELLIS.2-4B", "missing.json")
        assert result == "/tmp/downloaded_file"
        assert len(calls) == 2
        assert calls[0][2] is None
        assert calls[1][2] is not None


def test_load_dotenv_into_environ_syncs_tokens(monkeypatch, tmp_path):
    """Verify that .env loading populates HF_TOKEN and HUGGINGFACE_TOKEN."""
    monkeypatch.delenv("HF_TOKEN", raising=False)
    monkeypatch.delenv("HUGGINGFACE_TOKEN", raising=False)

    fake_env = tmp_path / ".env"
    fake_env.write_text("HF_TOKEN=hf_mock_token_12345\n")

    monkeypatch.chdir(tmp_path)

    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "backend.utils.torchvision_fix",
        str(backend_dir / "utils" / "torchvision_fix.py")
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    mod.load_dotenv_into_environ()

    assert os.environ.get("HF_TOKEN") == "hf_mock_token_12345"
    assert os.environ.get("HUGGINGFACE_TOKEN") == "hf_mock_token_12345"
