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
