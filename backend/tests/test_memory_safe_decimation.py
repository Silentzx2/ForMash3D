"""Tests for memory-safe feature-preserving decimation service."""
from __future__ import annotations

from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import numpy as np
import pytest
import trimesh
import yaml

try:
    from postprocess.services.memory_safe_decimate import (
        load_decimation_config,
        memory_safe_decimate,
    )
except ImportError:
    from backend.postprocess.services.memory_safe_decimate import (
        load_decimation_config,
        memory_safe_decimate,
    )



def test_config_loading_and_defaults():
    """Verify loading from backend/config/decimation_config.yaml matches task specification."""
    cfg = load_decimation_config()
    assert cfg["memory_safe_threshold_triangles"] == 2_000_000
    assert cfg["crease_angle_deg"] == 35.0
    assert cfg["max_deviation_deg"] == 45.0
    assert cfg["max_ram_fraction"] == 0.80


def test_standard_decimation_under_threshold_preserves_bounds_and_creases():
    """Test standard decimation under 2M tris uses feature-preserving decimation and preserves bounds/creases."""
    # Create a box with subdivided faces to produce hard crease edges (dihedral angle 90 degrees)
    box = trimesh.creation.box(extents=(2.0, 4.0, 6.0)).subdivide()
    orig_faces = len(box.faces)
    assert orig_faces < 2_000_000
    orig_bounds = box.bounds.copy()

    target_faces = 24
    decimated, telemetry = memory_safe_decimate(
        box,
        target_faces=target_faces,
        crease_angle_deg=35.0,
    )

    # Telemetry checks
    assert telemetry["memory_safe_mode_engaged"] is False
    assert telemetry["triangles_before"] == orig_faces
    assert telemetry["triangles_after"] == len(decimated.faces)
    assert telemetry["triangles_after"] <= orig_faces
    assert telemetry["triangles_after"] == target_faces
    assert telemetry["reduction_ratio"] == round(target_faces / orig_faces, 4)
    assert telemetry["peak_rss_mb"] > 0

    # Bounds preservation check
    np.testing.assert_allclose(
        decimated.bounds,
        orig_bounds,
        atol=1e-5,
        err_msg="Decimated mesh bounds must exactly match original bounds",
    )

    # Crease / vertex normal preservation check
    assert hasattr(decimated, "vertex_normals")
    assert len(decimated.vertex_normals) > 0
    # Distinct vertex normals exist because corner/crease vertices are split to avoid melted shading
    distinct_normals = len(np.unique(np.round(decimated.vertex_normals, 2), axis=0))
    assert distinct_normals >= 6


def test_input_mesh_never_mutated_in_place():
    """Verify that memory_safe_decimate never mutates the input mesh in-place."""
    mesh = trimesh.creation.box(extents=(1.0, 1.0, 1.0)).subdivide()
    orig_verts = mesh.vertices.copy()
    orig_faces = mesh.faces.copy()

    # 1. Under-threshold decimation
    decimated, _ = memory_safe_decimate(mesh, target_faces=20)
    assert decimated is not mesh
    np.testing.assert_array_equal(mesh.vertices, orig_verts)
    np.testing.assert_array_equal(mesh.faces, orig_faces)

    # 2. Over-threshold / memory-safe staged decimation
    decimated_staged, _ = memory_safe_decimate(
        mesh, target_faces=20, threshold_triangles=10
    )
    assert decimated_staged is not mesh
    np.testing.assert_array_equal(mesh.vertices, orig_verts)
    np.testing.assert_array_equal(mesh.faces, orig_faces)

    # 3. No-op decimation (target >= current faces)
    copied, _ = memory_safe_decimate(mesh, target_faces=len(mesh.faces) + 10)
    assert copied is not mesh
    np.testing.assert_array_equal(mesh.vertices, orig_verts)
    np.testing.assert_array_equal(mesh.faces, orig_faces)


def test_threshold_engagement_and_telemetry(tmp_path: Path):
    """Test that threshold engagement works with configurable lower threshold and records telemetry."""
    # Create icosphere with 1280 faces
    mesh = trimesh.creation.icosphere(subdivisions=3, radius=1.0)
    initial_faces = len(mesh.faces)
    assert initial_faces == 1280

    # Configure a custom lower threshold via YAML
    config_file = tmp_path / "custom_decimation.yaml"
    config_data = {
        "decimation": {
            "memory_safe_threshold_triangles": 500,
            "crease_angle_deg": 35.0,
            "max_deviation_deg": 45.0,
            "max_ram_fraction": 0.80,
        }
    }
    config_file.write_text(yaml.safe_dump(config_data), encoding="utf-8")

    # 1. When faces (1280) > threshold (500), memory safe mode MUST engage
    target_faces = 200
    decimated, telemetry = memory_safe_decimate(
        mesh,
        target_faces=target_faces,
        config_path=str(config_file),
    )

    assert telemetry["memory_safe_mode_engaged"] is True
    assert telemetry["triangles_before"] == initial_faces
    assert telemetry["triangles_after"] <= 500
    assert telemetry["triangles_after"] <= target_faces
    assert 0.0 < telemetry["reduction_ratio"] < 1.0
    assert telemetry["reduction_ratio"] == round(
        telemetry["triangles_after"] / initial_faces, 4
    )
    assert telemetry["peak_rss_mb"] > 0
    assert isinstance(telemetry["peak_rss_mb"], float)

    # 2. When threshold is raised to 2000 (> 1280), memory safe mode MUST NOT engage
    config_data_higher = {
        "decimation": {
            "memory_safe_threshold_triangles": 2000,
            "crease_angle_deg": 35.0,
            "max_deviation_deg": 45.0,
            "max_ram_fraction": 0.80,
        }
    }
    config_file_higher = tmp_path / "custom_decimation_higher.yaml"
    config_file_higher.write_text(yaml.safe_dump(config_data_higher), encoding="utf-8")

    decimated_std, telemetry_std = memory_safe_decimate(
        mesh,
        target_faces=target_faces,
        config_path=str(config_file_higher),
    )

    assert telemetry_std["memory_safe_mode_engaged"] is False
    assert telemetry_std["triangles_before"] == initial_faces
    assert telemetry_std["triangles_after"] < initial_faces



def test_memory_safe_low_ram_limiting_allocations(monkeypatch: pytest.MonkeyPatch):
    """Test that decimation prevents OOM by limiting intermediate allocations when RAM is constrained."""
    mesh = trimesh.creation.icosphere(subdivisions=3, radius=1.0)

    # Simulate host RAM at 95% usage (exceeding 80% threshold)
    mock_vm = MagicMock()
    mock_vm.total = 16 * 1024 * 1024 * 1024
    mock_vm.available = 500 * 1024 * 1024  # only ~3% available
    mock_vm.percent = 96.8
    monkeypatch.setattr("psutil.virtual_memory", lambda: mock_vm)

    # Run staged decimation under low RAM simulation
    decimated, telemetry = memory_safe_decimate(
        mesh,
        target_faces=300,
        threshold_triangles=500,
        max_ram_fraction=0.80,
    )

    assert telemetry["memory_safe_mode_engaged"] is True
    assert telemetry["triangles_after"] <= 300
    assert telemetry["peak_rss_mb"] > 0
