from pathlib import Path
import sys

import pytest


BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))


@pytest.mark.parametrize("key", ["output_mesh_path", "mesh_path", "output_path", "file_path"])
def test_result_path_fallback_checks_every_declared_key(key):
    from core.utils.artifact_utils import first_result_path

    assert first_result_path({key: "/storage/result.glb"}) == "/storage/result.glb"


def test_result_path_fallback_preserves_preferred_key_order():
    from core.utils.artifact_utils import first_result_path

    assert first_result_path({"file_path": "late.glb", "mesh_path": "preferred.obj"}) == "preferred.obj"


def test_result_path_fallback_returns_none_for_empty_result():
    from core.utils.artifact_utils import first_result_path

    assert first_result_path({"output_mesh_path": None, "mesh_path": ""}) is None