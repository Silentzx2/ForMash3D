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
