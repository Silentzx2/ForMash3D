"""Lightweight source contracts for production PBR failure and export wiring."""
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]


def test_pbr_validator_exceptions_are_structured_and_affect_production_status():
    source = (BACKEND_ROOT / "postprocess" / "pipeline.py").read_text(encoding="utf-8")
    assert "def _run_pbr_validation(" in source
    assert '"status": "error"' in source
    assert 'pbr_report = _run_pbr_validation(glb_path, required=pbr_validation_required)' in source
    assert "pbr_validation_report=pbr_report" in source
    assert "pbr_validation_failed" in source
    assert '"pbr_validation_failed"' in source
    assert "pbr_validation_report.get(\"valid\") is not True" in source


def test_bake_export_links_genuine_orm_and_occlusion_channels():
    source = (BACKEND_ROOT / "postprocess" / "pipeline.py").read_text(encoding="utf-8")
    baker = (BACKEND_ROOT / "postprocess" / "services" / "bake.py").read_text(encoding="utf-8")
    assert "metallicRoughnessTexture=orm_img" in source
    assert "occlusionTexture=orm_img if orm_img is not None else ao_img" in source
    assert '"missing_requested_maps"' in source
    assert '"unsupported_maps": sorted(set(requested_maps) - set(images)' in baker
    # The pure-Python fallback must not manufacture semantic maps it cannot bake.
    assert 'images["roughness"]' not in baker
    assert 'images["metallic"]' not in baker
    assert 'images["base_color"]' not in baker

def test_locked_adapter_documentation_does_not_claim_different_active_profiles():
    manifest = (BACKEND_ROOT / "config" / "models.yaml").read_text(encoding="utf-8")
    paint_adapter = (BACKEND_ROOT / "adapters" / "paint3d_adapter.py").read_text(encoding="utf-8")
    settings_doc = (BACKEND_ROOT.parent / "Docs" / "EXPERIMENTAL-MODEL-SETTINGS.md").read_text(encoding="utf-8")

    assert "preserve distilled 5-step schedule, guidance=5.0" not in manifest
    assert "steps=50 and guidance=7.0 follow upstream defaults" not in manifest
    assert "supported two-stage recipe (20 steps; guidance 7.0 then 3.0)" not in manifest
    assert "atlas refinement 20 / CFG 3.0" not in paint_adapter
    assert "stage-2 UV inpaint 40 / CFG 3.0" in paint_adapter
    assert "adapter clamps the effective sparse and SLAT call arguments to 50" in settings_doc
