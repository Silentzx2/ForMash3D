import unittest

import trimesh

from core.quality.evaluation import compare_meshes, quality_gate


class MeshQualityEvaluationTests(unittest.TestCase):
    def test_identical_mesh(self):
        mesh = trimesh.creation.box(extents=(1, 1, 1))
        report = compare_meshes(mesh, mesh, sample_count=256)
        self.assertLess(report["chamfer_distance"], 1e-6)
        self.assertGreaterEqual(report["f_score"], 0.99)

    def test_different_mesh(self):
        a = trimesh.creation.box(extents=(1, 1, 1))
        b = trimesh.creation.box(extents=(2, 1, 1))
        report = compare_meshes(a, b, sample_count=256)
        self.assertGreater(report["chamfer_distance"], 0.0)
        self.assertLess(report["f_score"], 1.0)

    def test_quality_gate(self):
        result = quality_gate({"chamfer_distance": 0.01})
        self.assertIn(result["passed"], (True, False))


if __name__ == "__main__":
    unittest.main()
