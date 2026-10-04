"""Post-processing runtime and opt-in end-to-end coverage.

The full fixture test is opt-in because it exercises the production
mesh-processing stack and can take materially longer than the normal test suite.
"""

from __future__ import annotations

import importlib
import json
import os
import shutil
import subprocess
from pathlib import Path
import sys

import pytest


backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))


POSTPROCESS_MODULES = {
    "numpy": "numpy",
    "trimesh": "trimesh",
    "Pillow": "PIL",
    "scipy": "scipy",
    "scikit-image": "skimage",
    "pymeshlab": "pymeshlab",
    "embreex": "embreex",
    "manifold3d": "manifold3d",
    "coacd": "coacd",
    "warp-lang": "warp",
    "rtree": "rtree",
    "matplotlib": "matplotlib",
}


def test_postprocess_dependencies_import():
    """All packages declared for post-processing must import successfully."""
    failures = []
    for package, module_name in POSTPROCESS_MODULES.items():
        try:
            importlib.import_module(module_name)
        except Exception as exc:
            failures.append(f"{package}: {type(exc).__name__}: {exc}")
    assert not failures, "Post-processing dependency failures:\n" + "\n".join(failures)

    importlib.import_module("postprocess.pipeline")


def test_textured_lod_simplification_preserves_uv_material():
    """Texture-aware decimation must keep UVs and material data attached."""
    pymeshlab = pytest.importorskip("pymeshlab")
    import numpy as np
    import trimesh
    from postprocess.services.simplify import _simplify

    mesh = trimesh.creation.icosphere(subdivisions=3)
    mins = mesh.vertices.min(axis=0)
    span = np.maximum(mesh.vertices.max(axis=0) - mins, 1e-9)
    uv = (mesh.vertices[:, :2] - mins[:2]) / span[:2]
    material = trimesh.visual.material.PBRMaterial(
        baseColorFactor=np.array([180, 180, 180, 255], dtype=np.uint8),
    )
    mesh.visual = trimesh.visual.TextureVisuals(uv=uv, material=material)

    reduced, stats = _simplify(mesh, max(100, len(mesh.faces) // 4))
    assert stats["texture_preserved"] is True
    assert reduced.visual.uv is not None
    assert len(reduced.visual.uv) == len(reduced.vertices)
    assert reduced.visual.material is not None


def test_topology_counts_exposes_largest_boundary_component():
    import numpy as np
    from postprocess.services.repair import topology_counts

    # Two disconnected tetrahedral shells, each with one face removed.
    tetra_v = np.array([
        [0.0, 0.0, 0.0], [1.0, 0.0, 0.0],
        [0.0, 1.0, 0.0], [0.0, 0.0, 1.0],
    ])
    tetra_f = np.array([
        [0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3],
    ])
    v = np.vstack([tetra_v, tetra_v + np.array([3.0, 0.0, 0.0])])
    f = np.vstack([tetra_f[:3], tetra_f[:3] + 4])

    stats = topology_counts(v, f)
    assert stats["boundary_edges"] == 6
    assert stats["largest_boundary_component_edges"] == 3
    assert stats["watertight"] is False


def test_healthy_mesh_repair_is_a_noop():
    import numpy as np
    import trimesh
    from postprocess.services.repair import RepairOptions, run_repair

    mesh = trimesh.creation.icosphere(subdivisions=2)
    result, stats, _ = run_repair(
        mesh,
        RepairOptions(method="remove", preserve_uv=True, close_holes=True, max_hole_size=30, weld=True),
    )
    assert stats["before"]["watertight"] is True
    assert result.vertices.shape == mesh.vertices.shape
    assert result.faces.shape == mesh.faces.shape
    np.testing.assert_allclose(result.vertices, mesh.vertices)
    np.testing.assert_array_equal(result.faces, mesh.faces)


def test_quality_guard_rejects_geometry_envelope_drift():
    import trimesh
    from postprocess.pipeline import _quality_guard

    source = trimesh.creation.box(extents=(2.0, 2.0, 2.0))
    shifted = source.copy()
    shifted.apply_translation([0.25, 0.0, 0.0])

    guard = _quality_guard(source, shifted)
    assert guard["passed"] is False
    assert "bounds drifted" in guard["reason"]


def test_native_texture_detection_requires_real_texture_payload():
    import numpy as np
    import trimesh
    from postprocess.pipeline import _has_native_textures

    mesh = trimesh.creation.box()
    uv = np.zeros((len(mesh.vertices), 2), dtype=float)
    mesh.visual = trimesh.visual.TextureVisuals(uv=uv)

    assert _has_native_textures(mesh) is False


def test_load_mesh_applies_scene_transforms_and_preserves_textures():
    import io

    import numpy as np
    import trimesh
    from PIL import Image
    from postprocess.meshio import load_mesh
    from postprocess.pipeline import _has_native_textures_scene

    scene = trimesh.Scene()
    for index, color in enumerate(((255, 0, 0), (0, 255, 0))):
        mesh = trimesh.creation.box()
        image = np.empty((16, 16, 3), dtype=np.uint8)
        image[:] = color
        mesh.visual = trimesh.visual.TextureVisuals(
            uv=np.tile([0.5, 0.5], (len(mesh.vertices), 1)),
            material=trimesh.visual.material.PBRMaterial(
                baseColorTexture=Image.fromarray(image),
                name=f"material-{index}",
            ),
        )
        scene.add_geometry(
            mesh,
            node_name=f"part-{index}",
            geom_name=f"part-{index}",
            transform=trimesh.transformations.translation_matrix([index * 3, 0, 0]),
        )

    source = scene.export(file_type="glb")
    source_scene = trimesh.load(io.BytesIO(source), file_type="glb", process=False)
    flattened = load_mesh(source, "fixture.glb")

    np.testing.assert_allclose(flattened.bounds, source_scene.bounds)
    assert flattened.visual.uv is not None
    assert _has_native_textures_scene(flattened.export(file_type="glb"))


def test_load_mesh_vertex_normals_follow_scene_transforms():
    import io

    import numpy as np
    import trimesh
    from postprocess.meshio import load_mesh_vertex_normals

    mesh = trimesh.creation.icosphere(subdivisions=1)
    _ = mesh.vertex_normals
    transform = trimesh.transformations.rotation_matrix(np.pi / 2, [0, 0, 1])
    scene = trimesh.Scene()
    scene.add_geometry(mesh, node_name="rotated", geom_name="rotated", transform=transform)
    raw = scene.export(file_type="glb")

    loaded_scene = trimesh.load(io.BytesIO(raw), file_type="glb", process=False)
    geometry_name = next(iter(loaded_scene.geometry))
    exported_normals = loaded_scene.geometry[geometry_name]._cache.cache["vertex_normals"]
    expected = exported_normals @ np.linalg.inv(transform[:3, :3])
    expected /= np.linalg.norm(expected, axis=1)[:, None]
    actual = load_mesh_vertex_normals(raw, "rotated.glb")

    np.testing.assert_allclose(actual, expected, atol=1e-6)


def test_blender_runtime_smoke():
    """Blender, when installed, must be able to start headlessly and import bpy."""
    executable = os.environ.get("BLENDER_EXECUTABLE", "blender")
    if shutil.which(executable) is None and not Path(executable).is_file():
        pytest.skip("Blender is not installed in this test environment.")

    result = subprocess.run(
        [
            executable,
            "--background",
            "--python-expr",
            'import bpy; print("ForMash3D Blender runtime:", bpy.app.version_string)',
        ],
        capture_output=True,
        text=True,
        check=False,
        timeout=60,
    )
    assert result.returncode == 0, result.stderr[-4000:] or result.stdout[-4000:]


@pytest.mark.skipif(
    os.environ.get("FORMASH_POSTPROCESS_E2E") != "1",
    reason="Set FORMASH_POSTPROCESS_E2E=1 to run the production mesh fixture smoke test.",
)
@pytest.mark.parametrize("physics_enabled", [False, True])
def test_real_mesh_fixture_through_pipeline(tmp_path, monkeypatch, physics_enabled):
    """Run a textured multi-part GLB fixture through the canonical pipeline."""
    import numpy as np
    import trimesh
    from PIL import Image
    import postprocess.pipeline as pipeline
    from postprocess.meshio import scene_to_mesh

    raw_path = tmp_path / "fixture.glb"
    fixture = trimesh.Scene()
    for index, color in enumerate(((255, 0, 0), (0, 255, 0))):
        part = trimesh.creation.box(extents=(1.0, 1.0, 1.0))
        image = np.empty((16, 16, 3), dtype=np.uint8)
        image[:] = color
        part.visual = trimesh.visual.TextureVisuals(
            uv=np.tile([0.5, 0.5], (len(part.vertices), 1)),
            material=trimesh.visual.material.PBRMaterial(
                baseColorTexture=Image.fromarray(image),
                name=f"fixture-material-{index}",
            ),
        )
        fixture.add_geometry(
            part,
            node_name=f"fixture-part-{index}",
            geom_name=f"fixture-part-{index}",
            transform=trimesh.transformations.translation_matrix([index * 3, 0, 0]),
        )
    raw_bytes = fixture.export(file_type="glb")
    assert isinstance(raw_bytes, bytes)
    raw_path.write_bytes(raw_bytes)
    source_scene = trimesh.load(raw_path, file_type="glb", process=False)
    source_mesh = scene_to_mesh(source_scene)

    models_root = tmp_path / "models"
    monkeypatch.setattr(pipeline, "_storage_root", lambda: models_root)
    monkeypatch.setattr(
        pipeline,
        "resolve_server_file_path",
        lambda value: str(Path(value).resolve()),
    )

    result = pipeline.run_postprocess_job(
        "postprocess-fixture-smoke",
        {"output_mesh_path": str(raw_path)},
        {"asset_name": "fixture"},
        {
            "model_id": "fixture",
            "feature": "image_to_raw_mesh",
            "physics_enabled": physics_enabled,
            "physics_config": {"collision_quality": "fast"},
        },
    )

    asset_root = Path(result["asset_root"])
    master = asset_root / "master" / "source.glb"
    game_ready_glb = next((asset_root / "game_ready").glob("*.glb"))
    game_ready_scene = trimesh.load(game_ready_glb, file_type="glb", process=False)
    game_ready_mesh = scene_to_mesh(game_ready_scene)
    quality_report = asset_root / "metadata" / "quality_report.json"
    asset_manifest = asset_root / "metadata" / "asset.json"
    physics_metadata = asset_root / "metadata" / "physics.json"

    assert master.read_bytes() == raw_bytes
    np.testing.assert_allclose(game_ready_mesh.bounds, source_mesh.bounds)
    assert len(game_ready_mesh.faces) == len(source_mesh.faces)
    assert pipeline._has_native_textures_scene(game_ready_glb.read_bytes())
    assert game_ready_glb.is_file()
    assert quality_report.is_file()
    assert asset_manifest.is_file()
    assert physics_metadata.is_file() is physics_enabled
    assert all((asset_root / "lods" / f"lod{i}.glb").is_file() for i in range(4))
    assert result["postprocess_status"] == "completed"
    assert result["texture_status"] in {"native", "not_generated"}
    assert result["physics_ready"] is physics_enabled
    if physics_enabled:
        assert result["physics_url"].endswith("artifact_format=physics_json")
    else:
        assert result["physics_url"] is None
    assert result["game_ready_formats"]["glb"].endswith("artifact_format=glb")
    assert result["zip_url"].endswith("artifact_format=zip")
    quality = json.loads(quality_report.read_text(encoding="utf-8"))
    assert quality["source_sha256"]
    assert set(quality["quality_trace"]) == {"source", "repaired", "optimized", "game_ready"}
    assert quality["collision"] is not None if physics_enabled else quality["collision"] is None
    assert len(quality["source_sha256"]) == 64
    assert set(quality["lods"]) >= {"0", "1", "2", "3"}


def test_high_to_low_bake_integration(tmp_path, monkeypatch):
    import io
    import trimesh
    from unittest.mock import MagicMock
    from postprocess import pipeline

    monkeypatch.setenv("STORAGE_LOCAL_PATH", str(tmp_path / "storage"))
    monkeypatch.setenv("ALLOW_LOCAL_SERVER_PATH_INPUTS", "true")
    box = trimesh.creation.box()
    raw_path = tmp_path / "high_poly.glb"
    box.export(str(raw_path))

    mock_baked_maps = {
        "normal": b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDRmock_normal",
        "ao": b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDRmock_ao",
    }
    mock_stats = {"maps": {"normal": "normal.png", "ao": "ao.png"}}

    with monkeypatch.context() as m:
        m.setattr("postprocess.services.bake.run_bake", lambda **kwargs: (mock_baked_maps, mock_stats))
        # Also patch run_bake where it's imported in pipeline
        import postprocess.services.bake
        postprocess.services.bake.run_bake = MagicMock(return_value=(mock_baked_maps, mock_stats))

        result = pipeline.run_postprocess_job(
            "test_bake_job",
            {"output_mesh_path": str(raw_path)},
            {"asset_name": "baked_asset", "bake_normal_maps": True, "generateLOD": False},
            {"model_id": "test_model", "feature": "image_to_raw_mesh"},
        )

    asset_root = Path(result["asset_root"])
    textures_dir = asset_root / "textures"
    assert textures_dir.is_dir()
    assert (textures_dir / "normal.png").read_bytes() == mock_baked_maps["normal"]
    assert (textures_dir / "ao.png").read_bytes() == mock_baked_maps["ao"]
    assert result["texture_status"] == "baked"
    assert "normal" in result["textures"]

