"""Frontend/backend output-preset parity.

backend/config/smart_presets.yaml is the source of truth for the output
presets. The Generate panel keeps a small fallback table (constants/
smartPresetFallback.json) for the case where the backend catalogue cannot be
fetched; this test fails when the two definitions drift apart.
"""

import json
import unittest
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[2]
SMART_PRESETS_PATH = REPO_ROOT / "backend" / "config" / "smart_presets.yaml"
FRONTEND_FALLBACK_PATH = REPO_ROOT / "constants" / "smartPresetFallback.json"

SHARED_FIELDS = (
    "label",
    "target_polycount",
    "texture_resolution",
    "generate_lod",
    "lod_preset",
    "lod_count",
    "collision",
    "enable_auto_rig",
    "enable_printability_check",
    "enable_auto_repair",
)


class TestSmartPresetParity(unittest.TestCase):
    def test_frontend_fallback_matches_backend_presets(self):
        with open(SMART_PRESETS_PATH, "r", encoding="utf-8") as handle:
            backend_presets = yaml.safe_load(handle)["intents"]
        with open(FRONTEND_FALLBACK_PATH, "r", encoding="utf-8") as handle:
            fallback_presets = json.load(handle)

        self.assertEqual(sorted(fallback_presets), sorted(backend_presets))

        for intent, backend_recipe in backend_presets.items():
            fallback_recipe = fallback_presets[intent]
            for field in SHARED_FIELDS:
                self.assertEqual(
                    fallback_recipe[field],
                    backend_recipe[field],
                    f"frontend fallback drifted from backend preset: {intent}.{field}",
                )


if __name__ == "__main__":
    unittest.main()
