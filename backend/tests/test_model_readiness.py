import asyncio
from types import SimpleNamespace

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from api.routers.system import _is_model_weights_available, health_check


def test_model_directory_with_only_arbitrary_checkpoint_is_not_ready(tmp_path):
    (tmp_path / "unrelated.ckpt").write_bytes(b"not a model")

    assert not _is_model_weights_available(SimpleNamespace(model_path=str(tmp_path)))


def test_model_directory_requires_nonempty_descriptor_and_checkpoint(tmp_path):
    (tmp_path / "model_index.json").write_text("{}")
    weights = tmp_path / "weights.safetensors"
    weights.write_bytes(b"weights")
    config = SimpleNamespace(model_path=str(tmp_path))

    assert _is_model_weights_available(config)

    weights.write_bytes(b"")
    assert not _is_model_weights_available(config)


def test_manifest_file_path_is_checked_directly(tmp_path):
    checkpoint = tmp_path / "declared.pt"
    checkpoint.write_bytes(b"weights")
    config = SimpleNamespace(model_path=str(checkpoint))

    assert _is_model_weights_available(config)

    checkpoint.write_bytes(b"")
    assert not _is_model_weights_available(config)


def test_health_route_reports_liveness_without_model_readiness():
    response = asyncio.run(health_check())

    assert response["status"] == "healthy"
    assert "models" not in response
