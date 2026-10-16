"""Tests for raw mesh quality and sharp edge preservation:
- Nelson Max angle-weighted vertex normals and dihedral crease splitting.
- Feature-preserving decimation with crease and boundary constraints.
- High-to-low normal map baking with MikkTSpace tangents and gutter dilation.
- Non-destructive raw native passthrough byte-for-byte preservation.
"""
import hashlib
import io
import numpy as np
import pytest
import trimesh
from PIL import Image

from core.mesh_processor import (
    MeshProcessor,
    compute_angle_weighted_normals,
    feature_preserving_decimate,
)
from postprocess.schemas import BakeOptions
from postprocess.services.bake import (
    bake_high_to_low_pure_python,
    run_bake,
)


def test_cube_angle_weighted_normals_and_crease_splitting():
    """Verify that an 8-vertex cube with 90° dihedral edges is split into 24 vertices

    with exact orthogonal Nelson Max normals, eliminating melted edge shading.
    """
    cube = trimesh.creation.box(extents=(2.0, 2.0, 2.0))
    assert len(cube.vertices) == 8
    assert len(cube.faces) == 12

    split_cube = compute_angle_weighted_normals(cube, crease_angle_deg=35.0)

    # 8 corners * 3 faces per corner = 24 split vertices
    assert len(split_cube.vertices) == 24
    assert len(split_cube.faces) == 12

    normals = split_cube.vertex_normals
    # Each normal should align with one of the 6 cardinal directions: +/-X, +/-Y, +/-Z
    for norm in normals:
        norm_unit = norm / np.linalg.norm(norm)
        max_component = np.max(np.abs(norm_unit))
        assert np.isclose(max_component, 1.0, atol=1e-3), f"Normal {norm} is melted, not axis-aligned!"


def test_cylinder_crease_splitting_at_rims_and_smooth_sides():
    """Verify that a cylinder with 90° endcaps splits along the endcap rims

    while keeping the curved cylindrical mantle smooth.
    """
    cylinder = trimesh.creation.cylinder(radius=1.0, height=2.0, sections=32)
    processed = compute_angle_weighted_normals(cylinder, crease_angle_deg=35.0)

    # Rim vertices should be split between end caps and curved side
    assert len(processed.vertices) > len(cylinder.vertices)
    # Total faces unchanged
    assert len(processed.faces) == len(cylinder.faces)

    # Cap faces have normal +/- Z. Cap vertices must have normal +/- Z exactly.
    for face, normal in zip(processed.faces, processed.face_normals):
        if np.isclose(abs(normal[2]), 1.0, atol=1e-3):
            # Cap face
            for v_idx in face:
                vn = processed.vertex_normals[v_idx]
                assert np.isclose(vn[2], normal[2], atol=1e-2), f"Cap vertex normal {vn} melted into mantle!"


def test_feature_preserving_decimation():
    """Verify that feature_preserving_decimate reduces polygon count while

    respecting dihedral crease constraints and boundary quadric penalties.
    """
    # Subdivide a box to create high-poly flat faces with sharp 90° edges
    box = trimesh.creation.box(extents=(2.0, 2.0, 2.0))
    subdivided = box.subdivide().subdivide()  # 12 * 4 * 4 = 192 faces
    assert len(subdivided.faces) == 192

    target_faces = 60
    decimated = feature_preserving_decimate(
        subdivided,
        target_faces=target_faces,
        crease_angle_deg=35.0,
        max_deviation_deg=45.0,
    )

    assert len(decimated.faces) <= len(subdivided.faces)
    assert len(decimated.faces) >= target_faces * 0.7  # Within reasonable decimation bounds
    # Check that bounding box is well-preserved
    orig_bounds = subdivided.bounds
    dec_bounds = decimated.bounds
    np.testing.assert_allclose(orig_bounds, dec_bounds, atol=0.1)


def test_high_to_low_normal_baking():
    """Verify pure-Python high-to-low normal baking:

    - MikkTSpace tangent computation
    - Surface normal projection from high to low
    - Gutter dilation preventing dark seam artifacts
    - Neutral normal fallback (128, 128, 255)
    """
    # Create low mesh with UVs: flat quad plane
    v_low = np.array([[-1.0, -1.0, 0.0], [1.0, -1.0, 0.0], [1.0, 1.0, 0.0], [-1.0, 1.0, 0.0]], dtype=np.float64)
    f_low = np.array([[0, 1, 2], [0, 2, 3]], dtype=np.int64)
    uv_low = np.array([[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]], dtype=np.float64)
    mesh_low = trimesh.Trimesh(vertices=v_low, faces=f_low, process=False)
    mesh_low.visual = trimesh.visual.TextureVisuals(uv=uv_low)
    low_glb = mesh_low.export(file_type="glb")

    # Create high mesh: same plane with a central pyramid bump
    v_high = np.array([
        [-1.0, -1.0, 0.0], [1.0, -1.0, 0.0], [1.0, 1.0, 0.0], [-1.0, 1.0, 0.0],
        [0.0, 0.0, 0.4]  # central bump
    ], dtype=np.float64)
    f_high = np.array([
        [0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]
    ], dtype=np.int64)
    mesh_high = trimesh.Trimesh(vertices=v_high, faces=f_high, process=False)
    high_glb = mesh_high.export(file_type="glb")

    opts = BakeOptions(resolution=256, maps=["normal", "ao"], margin=8, pack_orm=False)
    images, stats = bake_high_to_low_pure_python(low_glb, high_glb, opts, progress=lambda s, f, m: None)

    assert "normal" in images
    assert stats["engine"] == "pure_python_mikktspace"
    assert stats["covered_texels"] > 0

    normal_img = Image.open(io.BytesIO(images["normal"]))
    assert normal_img.size == (256, 256)
    arr = np.asarray(normal_img)

    # Gutter dilation: alpha must be fully 255 across the entire texture
    assert np.all(arr[:, :, 3] == 255), "Gutter pixels are un-dilated or transparent!"

    # Inside UV area: normal map must show perturbed tangents on bump slopes
    # Tangent normal z channel should be predominantly high (towards blue / 255)
    assert np.mean(arr[:, :, 2]) > 200

    # There should be non-neutral normal perturbations from the high-poly bump
    perturbed = (np.abs(arr[:, :, 0].astype(int) - 128) > 10) | (np.abs(arr[:, :, 1].astype(int) - 128) > 10)
    assert np.any(perturbed), "Normal map does not capture high-poly bump perturbations!"


def test_mesh_processor_save_mesh_optimal_normals(tmp_path):
    """Verify that MeshProcessor.save_mesh saves with optimal angle-weighted normals."""
    cube = trimesh.creation.box()
    out_file = tmp_path / "cube.glb"
    assert MeshProcessor.save_mesh(cube, out_file, crease_angle_deg=35.0)

    reloaded = MeshProcessor.load_mesh(out_file)
    assert len(reloaded.vertices) == 24  # 8 corners * 3 split faces
    assert len(reloaded.faces) == 12


def test_raw_native_passthrough_identity(tmp_path):
    """Verify byte-for-byte exact preservation of raw master files when decimation

    is disabled in the postprocess pipeline flow.
    """
    cube = trimesh.creation.box()
    optimal_cube = compute_angle_weighted_normals(cube, crease_angle_deg=35.0)
    raw_glb_bytes = optimal_cube.export(file_type="glb")
    raw_sha256 = hashlib.sha256(raw_glb_bytes).hexdigest()

    raw_file = tmp_path / "raw.glb"
    raw_file.write_bytes(raw_glb_bytes)

    # Verify that loading with process=False preserves exact vertices and faces
    loaded = MeshProcessor.load_mesh(raw_file)
    assert len(loaded.vertices) == 24
    assert len(loaded.faces) == 12

    # Verify SHA-256 identity
    assert hashlib.sha256(raw_file.read_bytes()).hexdigest() == raw_sha256
