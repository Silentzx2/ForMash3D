"""Tests for UV backend resolver and execute_uv_unwrap."""
from unittest.mock import patch
import numpy as np
import pytest
import trimesh

try:
    from postprocess.services.uv_backend_resolver import (
        execute_uv_unwrap,
        load_uv_config,
        resolve_uv_backend,
    )
    import postprocess.services.uv_backend_resolver as uv_resolver
except ImportError:
    from backend.postprocess.services.uv_backend_resolver import (
        execute_uv_unwrap,
        load_uv_config,
        resolve_uv_backend,
    )
    import backend.postprocess.services.uv_backend_resolver as uv_resolver



def test_load_uv_config(tmp_path):
    """Test loading config from yaml file and fallback defaults."""
    import copy
    import yaml
    from core.config import get_quality_config

    cfg = load_uv_config()
    assert cfg["partuv_triangle_threshold"] == 500000
    assert cfg["partuv_vram_requirement_gb"] == 7.0
    assert cfg["default_backend"] == "auto"
    assert cfg["fallback_backend"] == "xatlas"

    # Custom config derived from SSOT
    custom_yaml = tmp_path / "custom_uv.yaml"
    config_data = copy.deepcopy(get_quality_config())
    config_data["uv"]["partuv_triangle_threshold"] = 100000
    config_data["uv"]["partuv_vram_requirement_gb"] = 12.0
    custom_yaml.write_text(yaml.safe_dump(config_data), encoding="utf-8")

    custom_cfg = load_uv_config(str(custom_yaml))
    assert custom_cfg["partuv_triangle_threshold"] == 100000
    assert custom_cfg["partuv_vram_requirement_gb"] == 12.0


def test_resolve_uv_backend_low_poly_auto():
    """Test resolve_uv_backend for low-poly (<500k) with auto -> xatlas."""
    backend, reason = resolve_uv_backend(
        triangle_count=100000,
        requested_backend="auto",
        has_cuda=True,
        free_vram_gb=16.0,
    )
    assert backend == "xatlas"
    assert "triangle count (100000) < 500000" in reason


def test_resolve_uv_backend_high_poly_auto_cuda_vram():
    """Test resolve_uv_backend for high-poly (>=500k) with auto + CUDA + VRAM -> partuv."""
    backend, reason = resolve_uv_backend(
        triangle_count=500000,
        requested_backend="auto",
        has_cuda=True,
        free_vram_gb=8.0,
    )
    assert backend == "partuv"
    assert "partuv" in reason

    # > 500k
    backend, reason = resolve_uv_backend(
        triangle_count=750000,
        requested_backend="auto",
        has_cuda=True,
        free_vram_gb=12.0,
    )
    assert backend == "partuv"
    assert "partuv" in reason


def test_resolve_uv_backend_high_poly_without_cuda():
    """Test resolve_uv_backend for high-poly without CUDA -> falls back to xatlas."""
    backend, reason = resolve_uv_backend(
        triangle_count=600000,
        requested_backend="auto",
        has_cuda=False,
        free_vram_gb=16.0,
    )
    assert backend == "xatlas"
    assert "CUDA not available" in reason


def test_resolve_uv_backend_high_poly_insufficient_vram():
    """Test resolve_uv_backend for high-poly with CUDA but insufficient VRAM -> xatlas."""
    backend, reason = resolve_uv_backend(
        triangle_count=600000,
        requested_backend="auto",
        has_cuda=True,
        free_vram_gb=4.5,
    )
    assert backend == "xatlas"
    assert "insufficient VRAM" in reason


def test_resolve_uv_backend_explicit_partuv_with_and_without_resources():
    """Test explicit partuv request validation."""
    # Sufficient resources
    backend, _ = resolve_uv_backend(
        triangle_count=50000,
        requested_backend="partuv",
        has_cuda=True,
        free_vram_gb=8.0,
    )
    assert backend == "partuv"

    # Missing CUDA
    backend, reason = resolve_uv_backend(
        triangle_count=50000,
        requested_backend="partuv",
        has_cuda=False,
        free_vram_gb=8.0,
    )
    assert backend == "xatlas"
    assert "CUDA is not available" in reason

    # Insufficient VRAM
    backend, reason = resolve_uv_backend(
        triangle_count=50000,
        requested_backend="partuv",
        has_cuda=True,
        free_vram_gb=5.0,
    )
    assert backend == "xatlas"
    assert "insufficient VRAM" in reason


def test_resolve_uv_backend_explicit_xatlas():
    """Test explicit xatlas request always selects xatlas."""
    backend, reason = resolve_uv_backend(
        triangle_count=1000000,
        requested_backend="xatlas",
        has_cuda=True,
        free_vram_gb=24.0,
    )
    assert backend == "xatlas"
    assert "xatlas explicitly requested" in reason


def test_execute_uv_unwrap_valid_uv_coordinates():
    """Test execute_uv_unwrap on a mesh with xatlas produces valid UV coordinates in [0, 1]."""
    pytest.importorskip("xatlas")
    mesh = trimesh.creation.box()
    unwrapped, meta = execute_uv_unwrap(mesh, backend="xatlas")

    assert meta["backend_used"] == "xatlas"
    assert meta["resolved_backend"] == "xatlas"
    assert meta["triangle_count"] == len(mesh.faces)
    assert meta["success"] is True

    assert hasattr(unwrapped.visual, "uv")
    uvs = unwrapped.visual.uv
    assert uvs is not None
    assert len(uvs) > 0
    assert np.all(uvs >= 0.0)
    assert np.all(uvs <= 1.0)


def test_execute_uv_unwrap_does_not_mutate_input():
    """Test input mesh is not mutated in-place by execute_uv_unwrap."""
    pytest.importorskip("xatlas")
    mesh = trimesh.creation.icosphere(subdivisions=2)
    original_vertices = mesh.vertices.copy()
    original_faces = mesh.faces.copy()
    original_has_uv = hasattr(mesh.visual, "uv") and mesh.visual.uv is not None

    unwrapped, meta = execute_uv_unwrap(mesh, backend="xatlas")

    assert unwrapped is not mesh
    assert np.array_equal(mesh.vertices, original_vertices)
    assert np.array_equal(mesh.faces, original_faces)

    current_has_uv = hasattr(mesh.visual, "uv") and mesh.visual.uv is not None
    assert current_has_uv == original_has_uv


def test_execute_uv_unwrap_partuv_fallback_on_failure():
    """Test graceful fallback to xatlas when PartUV fails."""
    pytest.importorskip("xatlas")
    mesh = trimesh.creation.box()

    # PartUV resolved but fails internally -> graceful fallback to xatlas
    with patch.object(
        uv_resolver,
        "_unwrap_partuv",
        side_effect=RuntimeError("PartUV model weights missing"),
    ):
        unwrapped, meta = execute_uv_unwrap(
            mesh,
            backend="partuv",
            runtime={"has_cuda": True, "free_vram_gb": 10.0},
        )

    assert meta["resolved_backend"] == "partuv"
    assert meta["backend_used"] == "xatlas"
    assert meta["success"] is True
    assert hasattr(unwrapped.visual, "uv")
    assert np.all(unwrapped.visual.uv >= 0.0)
    assert np.all(unwrapped.visual.uv <= 1.0)


def test_resolve_uv_backend_ministudio_and_blender_smart():
    """Verify routing for ministudio and blender_smart backends."""
    backend, reason = resolve_uv_backend(50000, requested_backend="ministudio")
    assert backend == "ministudio"
    assert "ministudio" in reason

    backend, reason = resolve_uv_backend(50000, requested_backend="autouv")
    assert backend == "ministudio"

    backend, reason = resolve_uv_backend(50000, requested_backend="blender_smart")
    assert backend == "blender_smart"
    assert "blender_smart" in reason


def test_execute_uv_unwrap_ministudio():
    """Test execute_uv_unwrap with ministudio backend."""
    mesh = trimesh.creation.box()
    unwrapped, meta = execute_uv_unwrap(mesh, backend="ministudio")
    assert meta["resolved_backend"] == "ministudio"
    assert meta["backend_used"] in ("ministudio", "xatlas")
    assert meta["success"] is True
    assert hasattr(unwrapped.visual, "uv")
    assert len(unwrapped.visual.uv) > 0


def test_execute_uv_unwrap_massive_mesh_safe():
    """Test execute_uv_unwrap on massive mesh (>50k triangles) without segfaulting."""
    pytest.importorskip("xatlas")
    # 81,920 faces previously triggered a C++ SIGSEGV in xatlas
    mesh = trimesh.creation.icosphere(subdivisions=6)
    assert len(mesh.faces) == 81920

    unwrapped, meta = execute_uv_unwrap(
        mesh,
        backend="xatlas",
        runtime={"xatlas_max_safe_triangles": 50000},
    )

    assert meta["success"] is True
    assert meta["backend_used"] == "xatlas"
    assert len(unwrapped.faces) == 81920
    assert len(unwrapped.vertices) == len(mesh.vertices)
    assert hasattr(unwrapped.visual, "uv")
    uvs = unwrapped.visual.uv
    assert uvs is not None
    assert len(uvs) == len(mesh.vertices)
    assert np.all(uvs >= 0.0)
    assert np.all(uvs <= 1.0)

