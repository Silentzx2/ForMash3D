import os
import unittest

from core.scheduler.resource_planner import ResourcePlanner, configure_cpu_runtime, cpu_threads_for_workers


class FakeMonitor:
    def __init__(self, gpus):
        self.gpus = gpus

    def get_gpu_status(self):
        return list(self.gpus)

    def get_gpu_available_vram(self, gpu_id):
        return next(g["available_mb"] for g in self.gpus if g["id"] == gpu_id)


class ResourcePlannerTests(unittest.TestCase):
    def test_single_gpu(self):
        monitor = FakeMonitor([
            {"id": 0, "name": "A", "memory_total": 14336, "memory_free": 12000, "available_mb": 12000},
            {"id": 1, "name": "B", "memory_total": 14336, "memory_free": 7000, "available_mb": 7000},
        ])
        plan = ResourcePlanner(monitor, safety_margin_mb=512).plan({"vram_requirement": 9000, "capabilities": {}})
        self.assertIsNotNone(plan)
        self.assertEqual(plan.kind, "single_gpu")
        self.assertEqual(plan.primary_gpu, 0)

    def test_multi_gpu_requires_capability(self):
        monitor = FakeMonitor([
            {"id": 0, "name": "A", "memory_total": 14336, "memory_free": 14000, "available_mb": 14000},
            {"id": 1, "name": "B", "memory_total": 14336, "memory_free": 14000, "available_mb": 14000},
        ])
        plan = ResourcePlanner(monitor, safety_margin_mb=512).plan({
            "vram_requirement": 20000,
            "capabilities": {
                "multi_gpu": True,
                "multi_gpu_strategy": "accelerate_component_dispatch",
            },
        })
        self.assertIsNotNone(plan)
        self.assertTrue(plan.is_multi_gpu)
        self.assertEqual(sum(plan.reservation_mb.values()), 20000)

    def test_pixal3d_multi_gpu_load_sharing(self):
        monitor = FakeMonitor([
            {"id": 0, "name": "GPU0", "memory_total": 15360, "memory_free": 15000, "available_mb": 15000},
            {"id": 1, "name": "GPU1", "memory_total": 15360, "memory_free": 15000, "available_mb": 15000},
        ])
        planner = ResourcePlanner(monitor, safety_margin_mb=512)
        model_cfg = {
            "vram_requirement": 18432,
            "capabilities": {
                "multi_gpu": True,
                "multi_gpu_strategy": "accelerate_component_dispatch",
                "low_vram_supported": True,
            },
            "low_vram_requirement": 10240,
        }
        self.assertFalse(planner.model_is_impossible(model_cfg))
        plan = planner.plan(model_cfg)
        self.assertIsNotNone(plan)
        self.assertTrue(plan.is_multi_gpu)
        self.assertEqual(plan.gpu_ids, (0, 1))
        self.assertEqual(sum(plan.reservation_mb.values()), 18432)

    def test_pixal3d_single_gpu_low_vram(self):
        monitor = FakeMonitor([
            {"id": 0, "name": "GPU0", "memory_total": 15360, "memory_free": 14000, "available_mb": 14000},
        ])
        planner = ResourcePlanner(monitor, safety_margin_mb=512)
        model_cfg = {
            "vram_requirement": 18432,
            "capabilities": {
                "multi_gpu": True,
                "multi_gpu_strategy": "accelerate_component_dispatch",
                "low_vram_supported": True,
            },
            "low_vram_requirement": 10240,
        }
        self.assertFalse(planner.model_is_impossible(model_cfg))
        plan = planner.plan(model_cfg)
        self.assertIsNotNone(plan)
        self.assertFalse(plan.is_multi_gpu)
        self.assertEqual(plan.strategy, "single_gpu_low_vram")
        self.assertEqual(plan.reservation_mb, {0: 10240})

    def test_fastmesh_multi_gpu(self):
        monitor = FakeMonitor([
            {"id": 0, "name": "GPU0", "memory_total": 15360, "memory_free": 15000, "available_mb": 15000},
            {"id": 1, "name": "GPU1", "memory_total": 15360, "memory_free": 15000, "available_mb": 15000},
        ])
        planner = ResourcePlanner(monitor, safety_margin_mb=512)
        model_cfg = {
            "vram_requirement": 24500,
            "capabilities": {
                "retopology": True,
                "target_variant": "V4K",
                "multi_gpu": True,
                "multi_gpu_strategy": "accelerate_component_dispatch",
            },
        }
        self.assertFalse(planner.model_is_impossible(model_cfg))
        plan = planner.plan(model_cfg)
        self.assertIsNotNone(plan)
        self.assertTrue(plan.is_multi_gpu)
        self.assertEqual(sum(plan.reservation_mb.values()), 24500)

    def test_impossible_model_exceeds_all_capacity(self):
        monitor = FakeMonitor([
            {"id": 0, "name": "GPU0", "memory_total": 15360, "memory_free": 15000, "available_mb": 15000},
            {"id": 1, "name": "GPU1", "memory_total": 15360, "memory_free": 15000, "available_mb": 15000},
        ])
        planner = ResourcePlanner(monitor, safety_margin_mb=512)
        model_cfg = {
            "vram_requirement": 40000,
            "capabilities": {
                "multi_gpu": True,
                "multi_gpu_strategy": "accelerate_component_dispatch",
            },
        }
        self.assertTrue(planner.model_is_impossible(model_cfg))
        self.assertIsNone(planner.plan(model_cfg))

    def test_quality_router_prefers_quality_model_when_available(self):
        registry = {
            "fast": {
                "vram_requirement": 6000,
                "capabilities": {"quality_priority": 10},
            },
            "hq": {
                "vram_requirement": 12000,
                "capabilities": {"quality_priority": 100},
            },
        }
        chosen = ResourcePlanner.choose_model(
            registry,
            ["fast", "hq"],
            {"quality": "ultra"},
        )
        self.assertEqual(chosen, "hq")

    def test_quality_routing_uses_polycount_and_latency_signals(self):
        registry = {
            "fast": {
                "vram_requirement": 6000,
                "capabilities": {
                    "quality_priority": 10,
                    "latency_class": "fast",
                    "high_fidelity_geometry": False,
                },
            },
            "hero": {
                "vram_requirement": 12000,
                "capabilities": {
                    "quality_priority": 100,
                    "latency_class": "quality",
                    "high_fidelity_geometry": True,
                },
            },
        }
        chosen = ResourcePlanner.choose_model(
            registry,
            ["fast", "hero"],
            {"quality": "ultra", "target_polycount": 150000},
        )
        self.assertEqual(chosen, "hero")

    def test_multiview_routing_rejects_single_view_models(self):
        registry = {
            "single": {
                "vram_requirement": 4000,
                "capabilities": {"quality_priority": 200, "single_view": True},
            },
            "multi": {
                "vram_requirement": 8000,
                "capabilities": {"quality_priority": 100, "multiview_input": True},
            },
        }
        chosen = ResourcePlanner.choose_model(
            registry,
            ["single", "multi"],
            {"multiview_input": True, "available_gpu_count": 2},
        )
        self.assertEqual(chosen, "multi")

    def test_multiview_generation_capability_is_not_treated_as_input(self):
        registry = {
            "view_generator": {
                "vram_requirement": 5000,
                "capabilities": {"quality_priority": 200, "multiview": True, "generated_multiview": True, "multiview_input": False},
            },
            "reconstruction": {
                "vram_requirement": 9000,
                "capabilities": {"quality_priority": 100, "multiview_input": True},
            },
        }
        chosen = ResourcePlanner.choose_model(
            registry,
            ["view_generator", "reconstruction"],
            {"multiview_input": True, "available_gpu_count": 2},
        )
        self.assertEqual(chosen, "reconstruction")

    def test_image_collection_triggers_multiview_routing(self):
        registry = {
            "single": {
                "vram_requirement": 4000,
                "capabilities": {"quality_priority": 200, "single_view": True},
            },
            "multi": {
                "vram_requirement": 8000,
                "capabilities": {"quality_priority": 100, "multiview_input": True},
            },
        }
        chosen = ResourcePlanner.choose_model(
            registry,
            ["single", "multi"],
            {"images": [{"file": "a.png"}, {"file": "b.png"}], "available_gpu_count": 2},
        )
        self.assertEqual(chosen, "multi")

    def test_cpu_override(self):
        previous = os.environ.get("FORMSH3D_CPU_THREADS")
        try:
            os.environ["FORMSH3D_CPU_THREADS"] = "7"
            self.assertEqual(cpu_threads_for_workers(32), 7)
            self.assertEqual(configure_cpu_runtime(2), 2)
        finally:
            if previous is None:
                os.environ.pop("FORMSH3D_CPU_THREADS", None)
            else:
                os.environ["FORMSH3D_CPU_THREADS"] = previous


if __name__ == "__main__":
    unittest.main()
