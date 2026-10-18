"""CPU-only source contracts for runtime source selection."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ADAPTER = ROOT / "backend" / "adapters" / "hunyuan3d_paint_v21.py"


def test_hunyuan_adapter_preserves_explicit_checkpoint_source():
    source = ADAPTER.read_text(encoding="utf-8")
    assert "self._model_path_was_explicit = model_path is not None" in source
    assert "from hy3dpaint.utils.runtime_path_utils import resolve_model_source" in source
    assert "if self._model_path_was_explicit:" in source
    assert "falling back to remote repository tencent/Hunyuan3D-2.1" not in source


def test_backend_ci_runs_third_party_path_contracts():
    workflow = (ROOT / ".github" / "workflows" / "backend-runtime-ci.yml").read_text(encoding="utf-8")
    assert "branches: [main, dev]" in workflow
    assert "backend/thirdparty/tests/test_runtime_path_utils.py" in workflow
