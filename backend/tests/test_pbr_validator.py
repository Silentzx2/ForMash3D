"""Tests for game-ready PBR asset validation and bake configuration."""
import io
from pathlib import Path

import numpy as np
import pytest
from PIL import Image
import trimesh

try:
    from backend.postprocess.services.pbr_validator import (
        load_bake_config,
        validate_pbr_asset,
    )
except ImportError:
    from postprocess.services.pbr_validator import (
        load_bake_config,
        validate_pbr_asset,
    )


@pytest.fixture
def sample_quad_mesh():
    """Create a simple 2-triangle quad mesh covering ~81% of [0, 1] UV space."""
    verts = np.array([
        [0.0, 0.0, 0.0],
        [1.0, 0.0, 0.0],
        [1.0, 1.0, 0.0],
        [0.0, 1.0, 0.0],
    ], dtype=np.float64)
    faces = np.array([
        [0, 1, 2],
        [0, 2, 3],
    ], dtype=np.int64)
    # UVs covering [0.05, 0.95] x [0.05, 0.95], area = 0.9 * 0.9 = 0.81
    uvs = np.array([
        [0.05, 0.05],
        [0.95, 0.05],
        [0.95, 0.95],
        [0.05, 0.95],
    ], dtype=np.float64)
    mesh = trimesh.Trimesh(vertices=verts, faces=faces)
    mesh.visual = trimesh.visual.TextureVisuals(uv=uvs)
    return mesh


@pytest.fixture
def valid_pbr_textures():
    """Generate synthetic valid PBR textures."""
    # Tangent-space OpenGL normal map: flat (128, 128, 255) with slight detail
    norm_arr = np.full((64, 64, 3), (128, 128, 255), dtype=np.uint8)
    norm_arr[10:20, 10:20, 0] = 135
    norm_arr[10:20, 10:20, 1] = 135
    norm_img = Image.fromarray(norm_arr, mode="RGB")

    # glTF packed metallic-roughness: R=unused/AO, G=roughness (0.4), B=metallic (0.8)
    mr_arr = np.zeros((64, 64, 3), dtype=np.uint8)
    mr_arr[..., 0] = 255  # Occlusion / unused
    mr_arr[..., 1] = 102  # Roughness ~ 0.4
    mr_arr[..., 2] = 204  # Metallic ~ 0.8
    mr_img = Image.fromarray(mr_arr, mode="RGB")

    base_color_img = Image.new("RGB", (64, 64), (180, 140, 100))

    return {
        "normal": norm_img,
        "metallic_roughness": mr_img,
        "base_color": base_color_img,
    }


def test_load_bake_config():
    """Verify loading bake configuration from backend/config/bake_config.yaml."""
    cfg = load_bake_config()
    assert cfg["normal_space"] == "TANGENT"
    assert cfg["convention"] == "OPENGL"
    assert cfg["min_uv_utilization"] == 0.60
    assert cfg["max_ray_distance"] == 0.05
    assert cfg["cage_extrusion"] == 0.02


def test_synthetic_valid_pbr_material(sample_quad_mesh, valid_pbr_textures):
    """Test validation with synthetic valid PBR material: OpenGL normal, packed MR, valid UVs."""
    report = validate_pbr_asset(sample_quad_mesh, texture_images=valid_pbr_textures)

    assert report["valid"] is True
    assert report["uv_valid"] is True
    assert report["uv_utilization"] >= 0.60
    assert report["normal_convention"] == "OPENGL"
    assert report["roughness_metallic_packed"] is True
    assert "normal" in report["maps_checked"]
    assert "roughness" in report["maps_checked"]
    assert "metallic" in report["maps_checked"]
    assert report["uv_overlap_fraction"] == 0.0

    # Channel stats verification
    stats = report["channel_stats"]
    assert "roughness" in stats
    assert "metallic" in stats
    assert 0.35 <= stats["roughness"]["mean"] <= 0.45
    assert 0.75 <= stats["metallic"]["mean"] <= 0.85


def test_glb_file_with_pbr_material(tmp_path, sample_quad_mesh, valid_pbr_textures):
    """Test validation directly on a GLB file containing PBRMaterial."""
    pbr_mat = trimesh.visual.material.PBRMaterial(
        name="GameReady",
        normalTexture=valid_pbr_textures["normal"],
        baseColorTexture=valid_pbr_textures["base_color"],
        metallicRoughnessTexture=valid_pbr_textures["metallic_roughness"],
    )
    sample_quad_mesh.visual = trimesh.visual.TextureVisuals(
        uv=sample_quad_mesh.visual.uv,
        material=pbr_mat,
    )

    glb_file = tmp_path / "game_ready.glb"
    glb_bytes = sample_quad_mesh.export(file_type="glb")
    glb_file.write_bytes(glb_bytes)

    report = validate_pbr_asset(str(glb_file))

    assert report["valid"] is True
    assert report["uv_valid"] is True
    assert report["normal_convention"] == "OPENGL"
    assert report["roughness_metallic_packed"] is True
    assert "normal" in report["maps_checked"]
    assert "metallic_roughness" in report["maps_checked"]


def test_degenerate_all_zero_map_fails_validation(sample_quad_mesh, valid_pbr_textures):
    """Test that a degenerate map with all 0s fails validation."""
    degen_normal = Image.new("RGB", (64, 64), (0, 0, 0))
    textures = dict(valid_pbr_textures)
    textures["normal"] = degen_normal

    report = validate_pbr_asset(sample_quad_mesh, texture_images=textures)

    assert report["valid"] is False
    assert any("Degenerate" in w or "all texels are 0" in w for w in report["warnings"])


def test_degenerate_all_255_map_fails_validation(sample_quad_mesh, valid_pbr_textures):
    """Test that a degenerate map with all 255s fails validation."""
    degen_map = Image.new("RGB", (64, 64), (255, 255, 255))
    textures = dict(valid_pbr_textures)
    textures["base_color"] = degen_map

    report = validate_pbr_asset(sample_quad_mesh, texture_images=textures)

    assert report["valid"] is False
    assert any("Degenerate" in w or "all texels are 255" in w for w in report["warnings"])


def test_out_of_bounds_uvs_flags_invalid(valid_pbr_textures):
    """Test that vertices with UV coordinates outside [0, 1] flag uv_valid as False."""
    verts = np.array([
        [0.0, 0.0, 0.0],
        [1.0, 0.0, 0.0],
        [1.0, 1.0, 0.0],
        [0.0, 1.0, 0.0],
    ], dtype=np.float64)
    faces = np.array([
        [0, 1, 2],
        [0, 2, 3],
    ], dtype=np.int64)
    # Deliberately out-of-bounds UV coordinates
    bad_uvs = np.array([
        [-0.15, 0.0],
        [1.0, 0.0],
        [1.25, 1.0],
        [0.0, 1.0],
    ], dtype=np.float64)

    bad_mesh = trimesh.Trimesh(vertices=verts, faces=faces)
    bad_mesh.visual = trimesh.visual.TextureVisuals(uv=bad_uvs)

    report = validate_pbr_asset(bad_mesh, texture_images=valid_pbr_textures)

    assert report["uv_valid"] is False
    assert report["valid"] is False
    assert any("out of [0, 1]" in w for w in report["warnings"])


def test_uv_overlap_detection(valid_pbr_textures):
    """Test that overlapping UV faces are detected in uv_overlap_fraction."""
    verts = np.array([
        [0.0, 0.0, 0.0],
        [1.0, 0.0, 0.0],
        [1.0, 1.0, 0.0],
    ], dtype=np.float64)
    # 2 faces with identical UV coordinates -> 50% overlap
    faces = np.array([
        [0, 1, 2],
        [0, 1, 2],
    ], dtype=np.int64)
    uvs = np.array([
        [0.1, 0.1],
        [0.8, 0.1],
        [0.5, 0.8],
    ], dtype=np.float64)

    ov_mesh = trimesh.Trimesh(vertices=verts, faces=faces)
    ov_mesh.visual = trimesh.visual.TextureVisuals(uv=uvs)

    report = validate_pbr_asset(ov_mesh, texture_images=valid_pbr_textures)
    assert report["uv_valid"] is True
    assert report["uv_overlap_fraction"] > 0.40


def test_unpacked_roughness_metallic(sample_quad_mesh):
    """Test handling when roughness and metallic are separate maps instead of packed."""
    norm_img = Image.new("RGB", (64, 64), (128, 128, 255))
    r_img = Image.new("L", (64, 64), 100)
    m_img = Image.new("L", (64, 64), 200)

    report = validate_pbr_asset(
        sample_quad_mesh,
        texture_images={"normal": norm_img, "roughness": r_img, "metallic": m_img},
    )

    assert report["roughness_metallic_packed"] is False
    assert any("separate maps" in w for w in report["warnings"])
    assert "roughness" in report["channel_stats"]
    assert "metallic" in report["channel_stats"]


def test_invalid_normal_space(sample_quad_mesh, valid_pbr_textures):
    """Test normal map with non-tangent (low blue) coordinates fails convention check."""
    # Flat neutral object space normal (128, 128, 128) -> Nz=0
    obj_normal = Image.new("RGB", (64, 64), (128, 128, 128))
    textures = dict(valid_pbr_textures)
    textures["normal"] = obj_normal

    report = validate_pbr_asset(sample_quad_mesh, texture_images=textures)

    assert report["normal_convention"] != "OPENGL"
    assert report["valid"] is False


def test_dielectric_uniform_metallic_no_false_positive_warning(sample_quad_mesh, valid_pbr_textures):
    """Test that pure dielectric (metallic=0.0) does not trigger false positive warning."""
    mr_dielectric = np.zeros((64, 64, 3), dtype=np.uint8)
    mr_dielectric[..., 0] = 255
    mr_dielectric[..., 1] = 128  # roughness ~ 0.5
    mr_dielectric[..., 2] = 0    # pure dielectric metallic = 0.0

    textures = dict(valid_pbr_textures)
    textures["metallic_roughness"] = Image.fromarray(mr_dielectric, mode="RGB")

    report = validate_pbr_asset(sample_quad_mesh, texture_images=textures)
    assert report["valid"] is True
    # Should NOT have uniform warning for pure dielectric
    assert not any("uniform intermediate value" in w for w in report["warnings"])

