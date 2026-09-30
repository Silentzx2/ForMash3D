"""Post-processing runtime and opt-in end-to-end coverage.

The full fixture test is opt-in because it exercises Blender and the production
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


def test_native_texture_detection_requires_real_texture_payload():
    import trimesh
    from postprocess.pipeline import _has_native_textures

    mesh = trimesh.creation.box()
    uv = np.zeros((len(mesh.vertices), 2), dtype=float)
    mesh.visual = trimesh.visual.TextureVisuals(uv=uv)

    assert _has_native_textures(mesh) is False


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
    """Run a real generated GLB fixture through the canonical production pipeline."""
    import trimesh
    import postprocess.pipeline as pipeline

    raw_path = tmp_path / "fixture.glb"
    fixture = trimesh.creation.box(extents=(1.0, 1.0, 1.0))
    raw_bytes = fixture.export(file_type="glb")
    assert isinstance(raw_bytes, bytes)
    raw_path.write_bytes(raw_bytes)

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
    quality_report = asset_root / "metadata" / "quality_report.json"
    asset_manifest = asset_root / "metadata" / "asset.json"
    physics_metadata = asset_root / "metadata" / "physics.json"

    assert master.read_bytes() == raw_bytes
    assert game_ready_glb.is_file()
    assert quality_report.is_file()
    assert asset_manifest.is_file()
    assert physics_metadata.is_file() is physics_enabled
    assert all((asset_root / "lods" / f"lod{i}.glb").is_file() for i in range(4))
    assert result["postprocess_status"] == "completed"
    assert result["texture_status"] in {"native", "not_generated"}
    assert result["physics_ready"] is physics_enabled
    assert result["physics_url"].endswith("artifact_format=physics_json")
    assert result["game_ready_formats"]["glb"].endswith("artifact_format=glb")
    assert result["zip_url"].endswith("artifact_format=zip")
    quality = json.loads(quality_report.read_text(encoding="utf-8"))
    assert quality["source_sha256"]
    assert set(quality["quality_trace"]) == {"source", "repaired", "optimized", "game_ready"}
    assert quality["collision"] is not None if physics_enabled else quality["collision"] is None
    assert len(quality["source_sha256"]) == 64
    assert set(quality["lods"]) >= {"0", "1", "2", "3"}
