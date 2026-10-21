"""Contract test for the collision stats keys used by the postprocess pipeline.

`postprocess/services/collision.py` publishes the collision statistics as
`method`, `parts`, `faces` and `vertices`, and `postprocess/physics.py` reads
the same names. The pipeline stage-8 report used the stale names
(`hull_count`, `total_triangles`), so every collision run reported "N/A" for
the hull count and the triangle count even though the proxy existed.
"""
from __future__ import annotations

import unittest
from pathlib import Path

PIPELINE_PATH = Path(__file__).resolve().parents[1] / "postprocess" / "pipeline.py"
COLLISION_PATH = Path(__file__).resolve().parents[1] / "postprocess" / "services" / "collision.py"


class TestCollisionStatsContract(unittest.TestCase):
    def test_pipeline_reads_the_published_stats_keys(self):
        source = PIPELINE_PATH.read_text(encoding="utf-8")
        self.assertIn('collision_stats.get("parts"', source)
        self.assertIn('collision_stats.get("faces"', source)
        self.assertNotIn('collision_stats.get("hull_count"', source)
        self.assertNotIn('collision_stats.get("total_triangles"', source)

    def test_pipeline_fallback_publishes_the_same_keys(self):
        source = PIPELINE_PATH.read_text(encoding="utf-8")
        self.assertIn('"parts": 1', source)
        self.assertIn('"faces": int(len(getattr(hull, "faces", [])))', source)

    def test_collision_service_publishes_the_canonical_keys(self):
        source = COLLISION_PATH.read_text(encoding="utf-8")
        for key in ('"method": method', '"parts": len(hulls)', '"faces": int(sum(len(h.faces) for h in hulls))'):
            self.assertIn(key, source)


if __name__ == "__main__":
    unittest.main()
