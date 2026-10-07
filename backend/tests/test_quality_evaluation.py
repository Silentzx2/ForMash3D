import unittest

import trimesh

from core.quality.evaluation import compare_meshes, compare_model_runs, compare_render_directories, quality_gate


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

    def test_ab_benchmark_requires_same_input_protocol(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            baseline = root / "baseline"
            candidate = root / "candidate"
            for asset, model in ((baseline, "model_a"), (candidate, "model_b")):
                (asset / "metadata").mkdir(parents=True)
                (asset / "master").mkdir()
                mesh = trimesh.creation.box(extents=(1, 1, 1))
                mesh.export(asset / "master" / "source.glb")
                (asset / "metadata" / "job.json").write_text(
                    json.dumps({
                        "model_id": model,
                        "input_sha256": {"image": "same"},
                        "target_polycount": 50000,
                        "texture_resolution": 1024,
                    }),
                    encoding="utf-8",
                )
                (asset / "metadata" / "quality_report.json").write_text("{}", encoding="utf-8")
            result = compare_model_runs(baseline, candidate)
            self.assertEqual(result["status"], "ok")
            self.assertEqual(result["baseline_model"], "model_a")
            self.assertEqual(result["candidate_model"], "model_b")

    def test_inspect_rejects_nonfinite_vertices(self):
        import numpy as np
        from postprocess.schemas import InspectOptions
        from postprocess.services.inspect import run_inspect

        mesh = trimesh.Trimesh(
            vertices=np.array([[0, 0, 0], [1, 0, 0], [np.nan, 1, 0]], dtype=float),
            faces=np.array([[0, 1, 2]], dtype=np.int64),
            process=False,
        )
        report = run_inspect(trimesh.Scene(mesh), mesh, InspectOptions(tri_budget=100))
        checks = {check["id"]: check for check in report["checks"]}
        self.assertEqual(checks["finite_vertices"]["status"], "fail")

    def test_standardized_render_comparison(self):
        from PIL import Image

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            base = root / "baseline"
            candidate = root / "candidate"
            base.mkdir()
            candidate.mkdir()
            image = Image.new("RGB", (4, 4), (255, 0, 0))
            image.save(base / "view_00.png")
            image.save(candidate / "view_00.png")
            result = compare_render_directories(base, candidate)
            self.assertEqual(result["status"], "ok")
            self.assertEqual(result["mean_absolute_rgb_error"], 0.0)
            self.assertEqual(result["mean_silhouette_iou"], 1.0)

    def test_quality_gate(self):
        result = quality_gate({"chamfer_distance": 0.01})
        self.assertIn(result["passed"], (True, False))


if __name__ == "__main__":
    unittest.main()
