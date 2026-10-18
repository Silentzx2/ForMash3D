"""Regression tests for runtime failure diagnostics and model state."""
import sys
from pathlib import Path

import pytest

backend_dir = Path(__file__).resolve().parents[1]
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from core.models.base import BaseModel, ModelStatus
from adapters.unirig_adapter import UniRigAdapter
from adapters.ardy_adapter import ArdyMotionGenerationAdapter
from utils.unirig_utils import _format_unirig_import_error
from adapters.hunyuan3d_paint_v21 import (
    Hunyuan3DPaintV21ImageMeshPaintingAdapter,
    _format_background_remover_import_error,
)


class _StubModel(BaseModel):
    def __init__(self, handler):
        super().__init__(model_id="stub", model_path=".", vram_requirement=0)
        self.handler = handler

    def _load_model(self):
        return None

    def _unload_model(self):
        return None

    def _process_request(self, inputs):
        return self.handler(inputs)


def test_failed_request_keeps_error_status():
    model = _StubModel(lambda _inputs: (_ for _ in ()).throw(RuntimeError("inference failed")))
    model.status = ModelStatus.LOADED

    with pytest.raises(RuntimeError, match="inference failed"):
        model.process({})

    assert model.status is ModelStatus.ERROR


def test_successful_request_restores_loaded_status():
    model = _StubModel(lambda _inputs: {"ok": True})
    model.status = ModelStatus.LOADED

    assert model.process({}) == {"ok": True}
    assert model.status is ModelStatus.LOADED


def test_unirig_diagnostic_preserves_the_actual_missing_module():
    error = ModuleNotFoundError("No module named 'lightning'", name="lightning")
    message = _format_unirig_import_error(error)
    assert "lightning" in message
    assert "ModuleNotFoundError" in message
    assert "not identified as the cause" in message


def test_background_remover_diagnostic_preserves_import_cause():
    error = ModuleNotFoundError("No module named 'pymatting'", name="pymatting")
    message = str(_format_background_remover_import_error(error))
    assert "BackgroundRemover" in message
    assert "pymatting" in message
    assert "ModuleNotFoundError" in message


def test_unirig_default_paths_are_independent_of_current_working_directory(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    adapter = UniRigAdapter(vram_requirement=4096)

    assert adapter.unirig_root == backend_dir / "thirdparty" / "UniRig"
    assert adapter.model_path == backend_dir / "pretrained" / "UniRig"


def test_hunyuan_background_removal_fallback_is_marked_degraded(monkeypatch):
    import types

    class SafeFallback:
        def __call__(self, image):
            return image

    import core.utils.runtime_compat as runtime_compat
    monkeypatch.setattr(
        runtime_compat,
        "get_backend_torchvision_fix",
        lambda: types.SimpleNamespace(SafeBackgroundRemoverFallback=SafeFallback),
    )

    state = types.SimpleNamespace()
    Hunyuan3DPaintV21ImageMeshPaintingAdapter._use_safe_background_remover(
        state, RuntimeError("background remover initialization failed")
    )

    assert state.bg_remover_mode == "safe_fallback"
    assert state.bg_remover_fallback_reason.startswith("RuntimeError:")
    assert "background remover initialization failed" in state.bg_remover_fallback_reason


def test_ardy_contract_reports_transformers_version_mismatch(tmp_path, monkeypatch):
    import importlib.metadata

    (tmp_path / "pyproject.toml").write_text(
        '[project]\n'
        'dependencies = [\n'
        '  "transformers==5.8.1",\n'
        '  "peft>=0.19",\n'
        ']\n',
        encoding="utf-8",
    )
    installed = {"transformers": "5.10.1", "peft": "0.19.0"}

    def fake_version(package_name):
        key = package_name.lower().replace("_", "-")
        if key not in installed:
            raise importlib.metadata.PackageNotFoundError(package_name)
        return installed[key]

    monkeypatch.setattr(importlib.metadata, "version", fake_version)
    adapter = ArdyMotionGenerationAdapter(
        model_path=str(tmp_path),
        ardy_root=str(tmp_path),
        vram_requirement=4096,
    )

    mismatches = adapter._check_runtime_dependency_contract()

    assert any("transformers==5.8.1" in item for item in mismatches)
    assert all("peft>=0.19" not in item for item in mismatches)


def test_hunyuan_local_dino_checkpoint_requires_config_and_weights(tmp_path):
    helper = Hunyuan3DPaintV21ImageMeshPaintingAdapter._has_local_dino_checkpoint

    assert helper(tmp_path) is False
    (tmp_path / "config.json").write_text("{}", encoding="utf-8")
    assert helper(tmp_path) is False

    (tmp_path / "model.safetensors").write_bytes(b"checkpoint")
    assert helper(tmp_path) is True


def test_hunyuan_local_dino_checkpoint_accepts_sharded_weight_names(tmp_path):
    helper = Hunyuan3DPaintV21ImageMeshPaintingAdapter._has_local_dino_checkpoint
    (tmp_path / "config.json").write_text("{}", encoding="utf-8")
    (tmp_path / "model-00001-of-00002.safetensors").write_bytes(b"checkpoint")

    assert helper(tmp_path) is True

