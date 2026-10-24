import pytest
import trimesh

from postprocess.services.auto_retopo import _assert_surface_fidelity


def test_surface_fidelity_gate_accepts_geometry_preserving_retopo():
    source = trimesh.creation.box()
    result = source.copy()

    report = _assert_surface_fidelity(source, result)

    assert report["passed"] is True
    assert report["decision"] == "accepted"
    assert report["sample_count"] > 0


def test_surface_fidelity_gate_rejects_large_surface_drift():
    source = trimesh.creation.box()
    result = source.copy()
    result.apply_translation([10.0, 0.0, 0.0])

    with pytest.raises(RuntimeError, match="surface drift"):
        _assert_surface_fidelity(source, result)
