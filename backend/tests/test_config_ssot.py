import json
from pathlib import Path

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
