"""Unit tests for mesh quality metrics, feature-edge retention, master immutability, and parity scorecard."""
from __future__ import annotations

import json
from pathlib import Path
import shutil

import numpy as np
import pytest
import trimesh

from core.quality.metrics import (
    audit_master_immutability,
    compute_mesh_metrics,
    sha256_file,
)
from core.quality.parity_scorecard import (
    SCORECARD_COLUMNS,
    SCORECARD_ROWS,
    create_parity_scorecard_template,
    generate_parity_scorecard,
)


def test_compute_mesh_metrics_clean_cube():
    """Verify compute_mesh_metrics on a canonical watertight cube."""
    cube = trimesh.creation.box()
    metrics = compute_mesh_metrics(cube)

    # 14 mandatory fields
    expected_fields = [
        "triangle_count",
        "vertex_count",
        "is_watertight",
        "non_manifold_edges",
        "non_manifold_vertices",
        "hole_count",
        "boundary_loop_sizes",
        "connected_components",
        "floater_ratio",
        "degenerate_faces",
        "aspect_ratio_p1",
        "aspect_ratio_p5",
        "uv_island_count",
        "feature_edge_retention",
    ]
    for field in expected_fields:
        assert field in metrics, f"Missing metric {field}"

    assert metrics["triangle_count"] == 12
    assert metrics["vertex_count"] == 8
    assert metrics["is_watertight"] is True
    assert metrics["non_manifold_edges"] == 0
    assert metrics["non_manifold_vertices"] == 0
    assert metrics["hole_count"] == 0
    assert metrics["boundary_loop_sizes"] == []
    assert metrics["connected_components"] == 1
    assert metrics["floater_ratio"] == 0.0
    assert metrics["degenerate_faces"] == 0
    assert metrics["aspect_ratio_p1"] > 0.5
    assert metrics["aspect_ratio_p5"] > 0.5
    assert metrics["uv_island_count"] == 0
    assert metrics["feature_edge_retention"] == 1.0


def test_compute_mesh_metrics_holes_and_floaters():
    """Verify detection of boundary loops (holes), floaters, and degenerate faces."""
    cube = trimesh.creation.box()

    # 1. Mesh with 1 hole (1 triangle face removed)
    m_hole = trimesh.Trimesh(vertices=cube.vertices, faces=cube.faces[:-1], process=False)
    metrics_hole = compute_mesh_metrics(m_hole)
    assert metrics_hole["is_watertight"] is False
    assert metrics_hole["hole_count"] == 1
    assert metrics_hole["boundary_loop_sizes"] == [3]
    assert metrics_hole["non_manifold_edges"] == 0

    # 2. Mesh with multiple holes (2 disjoint faces removed)
    m_2holes = trimesh.Trimesh(vertices=cube.vertices, faces=cube.faces[1:-1], process=False)
    metrics_2holes = compute_mesh_metrics(m_2holes)
    assert metrics_2holes["hole_count"] == 2
    assert metrics_2holes["boundary_loop_sizes"] == [3, 3]

    # 3. Mesh with a tiny disconnected component (floater < 0.5% vertices)
    sphere = trimesh.creation.icosphere(subdivisions=4, radius=1.0)
    # Add a small disconnected triangle far away
    floater_verts = np.array([[10.0, 10.0, 10.0], [10.1, 10.0, 10.0], [10.0, 10.1, 10.0]])
    v_combined = np.vstack([sphere.vertices, floater_verts])
    base_idx = len(sphere.vertices)
    f_combined = np.vstack([sphere.faces, [[base_idx, base_idx + 1, base_idx + 2]]])
    mesh_floater = trimesh.Trimesh(vertices=v_combined, faces=f_combined, process=False)

    metrics_floater = compute_mesh_metrics(mesh_floater)
    assert metrics_floater["connected_components"] == 2
    assert metrics_floater["floater_ratio"] > 0.0
    expected_ratio = 3.0 / len(v_combined)
    assert metrics_floater["floater_ratio"] == pytest.approx(expected_ratio, rel=1e-3)

    # 4. Mesh with degenerate (collinear / zero-area) faces
    v_degen = np.vstack([cube.vertices, [[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [2.0, 0.0, 0.0]]])
    f_degen = np.vstack([cube.faces, [[len(cube.vertices), len(cube.vertices) + 1, len(cube.vertices) + 2]]])
    m_degen = trimesh.Trimesh(vertices=v_degen, faces=f_degen, process=False)
    metrics_degen = compute_mesh_metrics(m_degen)
    assert metrics_degen["degenerate_faces"] >= 1

    # 5. Mesh with non-manifold edges and non-manifold vertices
    # 3 faces sharing edge [0, 1]
    f_nm = np.vstack([cube.faces, [[0, 1, 6]]])
    m_nm = trimesh.Trimesh(vertices=cube.vertices, faces=f_nm, process=False)
    metrics_nm = compute_mesh_metrics(m_nm)
    assert metrics_nm["non_manifold_edges"] >= 1
    assert metrics_nm["non_manifold_vertices"] >= 2


def test_compute_mesh_metrics_uv_charts():
    """Verify UV chart / island counting when visual UVs are present."""
    cube = trimesh.creation.box()
    # Unpack 6 quad faces into separate disconnected UV charts
    faces_unwrapped = []
    for i in range(6):
        base = i * 4
        faces_unwrapped.append([base, base + 1, base + 2])
        faces_unwrapped.append([base, base + 2, base + 3])
    faces_unwrapped = np.array(faces_unwrapped)
    verts_unwrapped = np.zeros((24, 3))
    uv_unwrapped = np.zeros((24, 2))

    mesh_uv = trimesh.Trimesh(vertices=verts_unwrapped, faces=faces_unwrapped, process=False)
    mesh_uv.visual = trimesh.visual.TextureVisuals(uv=uv_unwrapped)

    metrics = compute_mesh_metrics(mesh_uv)
    assert metrics["uv_island_count"] == 6


def test_feature_edge_retention_cube_vs_smoothed_and_decimated():
    """Verify feature edge retention on cube vs subdivided, smoothed, and decimated meshes."""
    cube = trimesh.creation.box()

    # 1. Cube vs identical cube -> 100% retention
    retention_self = compute_mesh_metrics(cube, reference_master=cube)["feature_edge_retention"]
    assert retention_self == 1.0

    # 2. Cube vs flat subdivided cube (crease dihedral angle 90° retained along edges) -> 1.0
    sub_cube = cube.subdivide()
    retention_sub = compute_mesh_metrics(sub_cube, reference_master=cube)["feature_edge_retention"]
    assert retention_sub == 1.0

    # 3. Cube vs smoothed sphere (no sharp edges remaining) -> retention collapses towards 0.0
    sphere = trimesh.creation.icosphere(subdivisions=3, radius=0.5)
    retention_sphere = compute_mesh_metrics(sphere, reference_master=cube)["feature_edge_retention"]
    assert retention_sphere < 0.1

    # 4. Reference with no sharp edges (sphere) -> returns 1.0 by definition
    retention_no_sharp = compute_mesh_metrics(cube, reference_master=sphere)["feature_edge_retention"]
    assert retention_no_sharp == 1.0

    # 5. None reference_master -> returns 1.0
    assert compute_mesh_metrics(cube, reference_master=None)["feature_edge_retention"] == 1.0


def test_master_immutability_audit(tmp_path: Path):
    """1A.1 Audit: verify copying master/source.glb to a working copy preserves exact sha256 hash."""
    asset_root = tmp_path / "asset_001"
    master_dir = asset_root / "master"
    master_dir.mkdir(parents=True, exist_ok=True)
    master_path = master_dir / "source.glb"

    # Create dummy master source asset
    cube = trimesh.creation.box()
    cube.export(master_path)
    assert master_path.is_file()

    initial_master_hash = sha256_file(master_path)
    assert len(initial_master_hash) == 64

    # Working copy creation before any mutating operation
    working_dir = asset_root / "working"
    working_dir.mkdir(parents=True, exist_ok=True)
    working_path = working_dir / "source_work.glb"
    shutil.copy2(master_path, working_path)

    # Master audit immediately after copy
    assert audit_master_immutability(master_path, working_path) is True
    assert sha256_file(working_path) == initial_master_hash
    assert sha256_file(master_path) == initial_master_hash

    # Simulate mutating downstream operations on the working copy (retopo / decimation / bake)
    work_mesh = trimesh.load(working_path, process=False)
    if isinstance(work_mesh, trimesh.Scene):
        work_mesh = trimesh.util.concatenate(
            [g for g in work_mesh.geometry.values() if isinstance(g, trimesh.Trimesh)]
        )
    work_mesh.vertices += 0.5
    work_mesh.export(working_path)

    # Verify working copy has changed while master remains strictly untouched
    mutated_working_hash = sha256_file(working_path)
    assert mutated_working_hash != initial_master_hash
    assert sha256_file(master_path) == initial_master_hash
    assert audit_master_immutability(master_path, working_path) is False


def test_parity_scorecard_generator(tmp_path: Path):
    """Verify parity_scorecard.json template generation with required rows and columns."""
    out_file = tmp_path / "parity_scorecard.json"
    scorecard_data = generate_parity_scorecard(
        output_path=out_file,
        entries={
            "sharpness": {"ForMash3D": 0.95, "Tripo": 0.82},
            "speed": {"ForMash3D": 18.5},
        },
    )

    assert out_file.is_file()
    loaded = json.loads(out_file.read_text(encoding="utf-8"))

    assert "metadata" in loaded
    assert "scorecard" in loaded
    assert loaded["metadata"]["columns"] == SCORECARD_COLUMNS
    assert loaded["metadata"]["rows"] == SCORECARD_ROWS

    # Check rows and columns
    scorecard = loaded["scorecard"]
    for row in SCORECARD_ROWS:
        assert row in scorecard
        for col in SCORECARD_COLUMNS:
            assert col in scorecard[row]

    assert scorecard["sharpness"]["ForMash3D"] == 0.95
    assert scorecard["sharpness"]["Tripo"] == 0.82
    assert scorecard["sharpness"]["Meshy"] is None
    assert scorecard["speed"]["ForMash3D"] == 18.5
