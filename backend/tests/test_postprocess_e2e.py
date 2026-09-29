"""Post-processing runtime and opt-in end-to-end coverage.

The full fixture test is opt-in because it exercises Blender and the production
mesh-processing stack and can take materially longer than the normal test suite.
"""

from __future__ import annotations

import importlib
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
def test_real_mesh_fixture_through_pipeline(tmp_path, monkeypatch):
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
            "physics_enabled": True,
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
    assert all((asset_root / "lods" / f"lod{i}.glb").is_file() for i in range(4))
    assert physics_metadata.is_file()
    assert result["postprocess_status"] == "completed"
    assert result["physics_ready"] is True
    assert result["physics_url"].endswith("artifact_format=physics_json")
    assert result["game_ready_formats"]["glb"].endswith("artifact_format=glb")
    assert result["zip_url"].endswith("artifact_format=zip")
