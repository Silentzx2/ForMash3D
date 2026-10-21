"""Regression tests for PBR baking, export links, and failure-status propagation."""
import io
import sys
from pathlib import Path
from types import SimpleNamespace

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

import numpy as np
import pytest
from PIL import Image
import trimesh

from postprocess.schemas import BakeOptions
from postprocess.services.bake import bake_high_to_low_pure_python
import postprocess.pipeline as pipeline


def _textured_triangle_mesh():
    mesh = trimesh.Trimesh(
        vertices=np.array([[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]], dtype=float),
        faces=np.array([[0, 1, 2], [0, 2, 3]], dtype=np.int64),
        process=False,
    )
    uv = np.array([[0.05, 0.05], [0.95, 0.05], [0.95, 0.95], [0.05, 0.95]], dtype=float)
    orm = np.zeros((32, 32, 3), dtype=np.uint8)
    orm[..., 0] = 255  # AO in R
    orm[..., 1] = 102  # roughness in G
    orm[..., 2] = 0    # metallic in B
    material = trimesh.visual.material.PBRMaterial(
        name="TestPBR",
        baseColorTexture=Image.new("RGB", (32, 32), (180, 140, 100)),
        normalTexture=Image.new("RGB", (32, 32), (128, 128, 255)),
        metallicRoughnessTexture=Image.fromarray(orm, mode="RGB"),
        occlusionTexture=Image.fromarray(orm, mode="RGB"),
    )
    mesh.visual = trimesh.visual.TextureVisuals(uv=uv, material=material)
    return mesh


def test_pbr_material_keeps_metallic_roughness_and_occlusion_links_after_glb_export():
    mesh = _textured_triangle_mesh()
    payload = mesh.export(file_type="glb")
    loaded = trimesh.load(io.BytesIO(payload), file_type="glb", process=False)
    if isinstance(loaded, trimesh.Scene):
        loaded_mesh = next(g for g in loaded.geometry.values() if isinstance(g, trimesh.Trimesh))
    else:
        loaded_mesh = loaded

    material = loaded_mesh.visual.material
    assert material.baseColorTexture is not None
    assert material.normalTexture is not None
    assert material.metallicRoughnessTexture is not None
    assert material.occlusionTexture is not None


def test_pure_python_baker_does_not_fake_semantic_pbr_maps():
    mesh = _textured_triangle_mesh()
    payload = mesh.export(file_type="glb")
    images, stats = bake_high_to_low_pure_python(
        low_glb=payload,
        high_glb=payload,
        opts=BakeOptions(
            resolution=64,
            maps=["normal", "ao", "base_color", "roughness", "metallic"],
        ),
    )

    assert "normal" in images
    assert "ao" in images
    assert not {"base_color", "roughness", "metallic", "orm"}.intersection(images)
    assert stats["unsupported_maps"] == ["base_color", "metallic", "roughness"]


def test_pbr_validator_exception_becomes_a_structured_report(monkeypatch, tmp_path):
    def fail(_path):
        raise RuntimeError("synthetic validator failure")

    monkeypatch.setattr(pipeline, "validate_pbr_asset", fail)
    report = pipeline._run_pbr_validation(tmp_path / "mesh.glb", required=True)

    assert report["valid"] is False
    assert report["status"] == "error"
    assert report["required"] is True
    assert report["error"] == "synthetic validator failure"
    assert report["warnings"]


def _build_result_for_pbr_report(tmp_path, report):
    asset_dir = tmp_path / "asset-job"
    glb = asset_dir / "game_ready" / "asset.glb"
    glb.parent.mkdir(parents=True)
    glb.write_bytes(_textured_triangle_mesh().export(file_type="glb"))
    return pipeline._build_result(
        job_id="pbr-status-test",
        asset_dir=asset_dir,
        asset_name="asset",
        qa_report={"qa": {"status": "pass"}, "warnings": []},
        generated={
            "game_ready": {"glb": str(glb)},
            "lods": {},
            "textures": {},
            "artifact_errors": {},
        },
        lod_enabled=False,
        pbr_validation_report=report,
    )


def test_required_invalid_pbr_marks_production_degraded(tmp_path):
    result = _build_result_for_pbr_report(
        tmp_path,
        {
            "required": True,
            "valid": False,
            "status": "error",
            "warnings": ["PBR validator could not complete."],
            "error": "validator failed",
        },
    )

    assert result["production_status"] == "degraded"
    assert result["postprocess_status"] == "degraded"
    assert "pbr_validation_failed" in result["degraded_reasons"]
    assert result["artifacts"]["pbr_validation"]["status"] == "failed"


def test_non_required_pbr_check_does_not_degrade_native_raw_output(tmp_path):
    result = _build_result_for_pbr_report(
        tmp_path,
        {
            "required": False,
            "valid": False,
            "status": "fail",
            "warnings": ["No UVs."],
        },
    )

    assert result["production_status"] == "ready"
    assert result["artifacts"]["pbr_validation"]["status"] == "skipped"
