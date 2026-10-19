import importlib.util
import os
import sys
import unittest
from pathlib import Path


# Load the module by file path so CPU-only contract tests don't import the
# heavyweight core.scheduler package (which also imports SQLAlchemy/database code).
_PLANNER_PATH = Path(__file__).resolve().parents[1] / "core" / "scheduler" / "resource_planner.py"
_PLANNER_NAME = "_formash3d_resource_planner_test"
_PLANNER_SPEC = importlib.util.spec_from_file_location(_PLANNER_NAME, _PLANNER_PATH)
if _PLANNER_SPEC is None or _PLANNER_SPEC.loader is None:
    raise ImportError(f"Cannot load resource planner from {_PLANNER_PATH}")
_PLANNER_MODULE = importlib.util.module_from_spec(_PLANNER_SPEC)
sys.modules[_PLANNER_NAME] = _PLANNER_MODULE
_PLANNER_SPEC.loader.exec_module(_PLANNER_MODULE)
ResourcePlanner = _PLANNER_MODULE.ResourcePlanner
configure_cpu_runtime = _PLANNER_MODULE.configure_cpu_runtime
cpu_threads_for_workers = _PLANNER_MODULE.cpu_threads_for_workers


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

    def test_strategy_without_explicit_multi_gpu_capability_is_rejected(self):
        monitor = FakeMonitor([
            {"id": 0, "name": "T4-0", "memory_total": 15360, "memory_free": 15000, "available_mb": 15000},
            {"id": 1, "name": "T4-1", "memory_total": 15360, "memory_free": 15000, "available_mb": 15000},
        ])
        planner = ResourcePlanner(monitor, safety_margin_mb=512)
        model_cfg = {
            "vram_requirement": 20000,
            "capabilities": {"multi_gpu_strategy": "accelerate_component_dispatch"},
        }
        self.assertTrue(planner.model_is_impossible(model_cfg))
        self.assertIsNone(planner.plan(model_cfg))

    def test_fastmesh_accelerate_map_can_be_scheduled_across_two_gpus(self):
        monitor = FakeMonitor([
            {"id": 0, "name": "T4-0", "memory_total": 15360, "memory_free": 15000, "available_mb": 15000},
            {"id": 1, "name": "T4-1", "memory_total": 15360, "memory_free": 15000, "available_mb": 15000},
        ])
        planner = ResourcePlanner(monitor, safety_margin_mb=512)
        model_cfg = {
            "vram_requirement": 16384,
            "capabilities": {
                "retopology": True,
                "multi_gpu": True,
                "multi_gpu_strategy": "accelerate_auto_device_map",
            },
        }
        self.assertFalse(planner.model_is_impossible(model_cfg))
        plan = planner.plan(model_cfg)
        self.assertIsNotNone(plan)
        self.assertTrue(plan.is_multi_gpu)
        self.assertEqual(plan.gpu_ids, (0, 1))
        self.assertEqual(plan.max_memory_mb["0"], 15000)
        self.assertEqual(plan.max_memory_mb["1"], 15000)

    def test_fastmesh_fails_closed_when_no_single_gpu_meets_its_budget(self):
        monitor = FakeMonitor([
            {"id": 0, "name": "T4-0", "memory_total": 15360, "memory_free": 15000, "available_mb": 15000},
            {"id": 1, "name": "T4-1", "memory_total": 15360, "memory_free": 15000, "available_mb": 15000},
        ])
        planner = ResourcePlanner(monitor, safety_margin_mb=512)
        # Without an explicit supported placement capability, aggregate VRAM alone
        # must not make either variant appear runnable on 2xT4.
        for required_mb, variant in ((16384, "V1K"), (24500, "V4K")):
            model_cfg = {
                "vram_requirement": required_mb,
                "capabilities": {"retopology": True, "target_variant": variant},
            }
            self.assertTrue(planner.model_is_impossible(model_cfg))
            self.assertIsNone(planner.plan(model_cfg))

        # A single GPU with sufficient capacity remains a valid placement.
        large_monitor = FakeMonitor([
            {"id": 0, "name": "Large GPU", "memory_total": 49152, "memory_free": 40000, "available_mb": 39000},
        ])
        large_plan = ResourcePlanner(large_monitor, safety_margin_mb=512).plan({
            "vram_requirement": 24500,
            "capabilities": {"retopology": True, "target_variant": "V4K"},
        })
        self.assertIsNotNone(large_plan)
        self.assertFalse(large_plan.is_multi_gpu)
        self.assertEqual(large_plan.kind, "single_gpu")

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
