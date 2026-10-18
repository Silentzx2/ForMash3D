"""Regression tests for runtime failure diagnostics and model state."""
import sys
from pathlib import Path

import pytest

backend_dir = Path(__file__).resolve().parents[1]
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from core.models.base import BaseModel, ModelStatus
from utils.unirig_utils import _format_unirig_import_error
from adapters.hunyuan3d_paint_v21 import _format_background_remover_import_error


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
