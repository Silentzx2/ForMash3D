import json
from pathlib import Path

import yaml

from core.config import _QUALITY_REQUIRED_KEYS, get_quality_config


def test_quality_config_contains_every_required_single_source_key():
    config = get_quality_config()
    missing = []
    for dotted_key in _QUALITY_REQUIRED_KEYS:
        value = config
        for key in dotted_key.split("."):
            if not isinstance(value, dict) or key not in value:
                missing.append(dotted_key)
                break
            value = value[key]

    assert not missing, f"Required quality config keys are missing: {missing}"


def test_frontend_physics_defaults_mirror_backend_quality_config():
    repository_root = Path(__file__).resolve().parents[2]
    frontend_mirror = json.loads(
        (repository_root / "constants" / "physicsDefaults.json").read_text()
    )
    backend_policy = get_quality_config()["physics"]

    assert frontend_mirror == {
        "defaults": backend_policy["defaults"],
        "limits": backend_policy["limits"],
        "default_collision_quality": backend_policy["default_collision_quality"],
    }



def test_hi3d_manifest_disables_unimplemented_multi_gpu_dispatch():
    repository_root = Path(__file__).resolve().parents[2]
    manifest = yaml.safe_load(
        (repository_root / "backend" / "config" / "models.yaml").read_text(encoding="utf-8")
    )
    for section, model_id in (
        ("image_to_raw_mesh", "hi3d_image_to_raw_mesh"),
        ("image_to_textured_mesh", "hi3d_image_to_textured_mesh"),
    ):
        capabilities = manifest[section][model_id]["capabilities"]
        assert capabilities["multi_gpu"] is False
        assert "multi_gpu_strategy" not in capabilities



def test_hi3d_and_pixal_manifest_resolutions_match_active_adapter_profiles():
    repository_root = Path(__file__).resolve().parents[2]
    manifest = yaml.safe_load(
        (repository_root / "backend" / "config" / "models.yaml").read_text(encoding="utf-8")
    )
    assert manifest["image_to_raw_mesh"]["pixal3d_image_to_raw_mesh"]["capabilities"]["output_resolution"] == 1536
    assert manifest["image_to_raw_mesh"]["pixal3d_image_to_raw_mesh"]["capabilities"]["preferred_resolution"] == 1536
    assert manifest["image_to_raw_mesh"]["pixal3d_image_to_3d"]["capabilities"]["output_resolution"] == 1536
    assert manifest["image_to_raw_mesh"]["pixal3d_image_to_3d"]["capabilities"]["preferred_resolution"] == 1536
    assert manifest["image_to_raw_mesh"]["hi3d_image_to_raw_mesh"]["capabilities"]["output_resolution"] == 1024
    assert manifest["image_to_raw_mesh"]["hi3d_image_to_raw_mesh"]["capabilities"]["preferred_resolution"] == 1024
    assert manifest["image_to_textured_mesh"]["hi3d_image_to_textured_mesh"]["capabilities"]["output_resolution"] == 1024
    assert manifest["image_to_textured_mesh"]["hi3d_image_to_textured_mesh"]["capabilities"]["preferred_resolution"] == 1024
