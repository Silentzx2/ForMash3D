"""
Verification tests for ForMash3D Main Repo Fix Plan:
- TripoSR adapter error handling, texture metadata, and output validation
- TripoSG adapter error handling, provenance, and output validation
- Multiprocess scheduler worker lifecycle, VRAM safety, and error propagation
"""

import asyncio
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

# Ensure backend is on sys.path
backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from adapters.triposr_adapter import TripoSRImageToRawMeshAdapter
from adapters.triposg_adapter import TripoSGImageToRawMeshAdapter
from core.scheduler.multiprocess_scheduler import (
    MultiprocessModelScheduler,
    WorkerConfig,
    WorkerResponse,
    retry_transient_errors_enabled,
    auto_unload_after_job_enabled,
)
from core.scheduler.job_queue import JobRequest


class TestTripoSRAdapter(unittest.TestCase):
    def setUp(self):
        self.adapter = TripoSRImageToRawMeshAdapter(vram_requirement=4096)

    def test_model_path_resolution(self):
        path = self.adapter._resolve_model_path()
        self.assertIsInstance(path, str)
        self.assertTrue(len(path) > 0)

    def test_load_native_import_error_preserved(self):
        """Native extension failure should be preserved in exception chain."""
        with patch.dict(sys.modules, {"tsr.system": None}):
            with self.assertRaises(RuntimeError) as ctx:
                self.adapter._load_model()
            self.assertIn("TripoSR", str(ctx.exception))
            # Verify exception chaining
            self.assertIsNotNone(ctx.exception.__cause__)

    def test_output_validation_rejects_empty_file(self):
        """Empty output mesh file must be rejected."""
        fake_mesh_path = backend_dir / "tests" / "empty_test.glb"
        fake_mesh_path.touch()
        try:
            self.adapter.tsr_model = MagicMock()
            self.adapter.tsr_model.extract_mesh.return_value = [MagicMock()]
            
            with patch.dict(sys.modules, {"tsr.utils": MagicMock()}):
                with patch.object(self.adapter.path_generator, "generate_mesh_path", return_value=str(fake_mesh_path)):
                    with patch("PIL.Image.open"):
                        with patch("core.utils.mesh_utils.MeshProcessor.load_mesh", return_value=None):
                            with self.assertRaises(RuntimeError) as ctx:
                                # inputs with dummy existing image
                                self.adapter._process_request({
                                    "image_path": str(Path(__file__)),
                                    "bake_texture": False,
                                    "no_remove_bg": True,
                                })
                            self.assertIn("output mesh", str(ctx.exception).lower())
        finally:
            if fake_mesh_path.exists():
                fake_mesh_path.unlink()


class TestTripoSGAdapter(unittest.TestCase):
    def setUp(self):
        self.adapter = TripoSGImageToRawMeshAdapter(vram_requirement=4096)

    def test_model_source_resolution(self):
        source = self.adapter._resolve_model_source()
        self.assertIsInstance(source, str)
        self.assertTrue(len(source) > 0)

    def test_load_import_error_preserved(self):
        """Import error in TripoSG should be preserved in exception chain."""
        with patch.dict(sys.modules, {"triposg.pipelines.pipeline_triposg": None}):
            with self.assertRaises(RuntimeError) as ctx:
                self.adapter._load_model()
            self.assertIn("TripoSG", str(ctx.exception))
            self.assertIsNotNone(ctx.exception.__cause__)


class TestRuntimeSchedulerToggles(unittest.TestCase):
    def test_scheduler_environment_switches_are_read_at_runtime(self):
        with patch.dict(os.environ, {"RETRY_TRANSIENT_ERRORS": "false", "AUTO_UNLOAD_AFTER_JOB": "false"}, clear=False):
            self.assertFalse(retry_transient_errors_enabled())
            self.assertFalse(auto_unload_after_job_enabled())
        with patch.dict(os.environ, {"RETRY_TRANSIENT_ERRORS": "true", "AUTO_UNLOAD_AFTER_JOB": "true"}, clear=False):
            self.assertTrue(retry_transient_errors_enabled())
            self.assertTrue(auto_unload_after_job_enabled())


class TestSchedulerResilience(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.scheduler = MultiprocessModelScheduler(enable_processing=False)

    def test_find_available_worker_checks_liveness(self):
        """Worker is only available if process is alive."""
        mock_proc_dead = MagicMock()
        mock_proc_dead.is_alive.return_value = False

        mock_proc_alive = MagicMock()
        mock_proc_alive.is_alive.return_value = True

        self.scheduler.workers["dead_worker"] = mock_proc_dead
        self.scheduler.worker_status["dead_worker"] = False

        self.scheduler.workers["alive_worker"] = mock_proc_alive
        self.scheduler.worker_status["alive_worker"] = False

        self.assertIsNone(self.scheduler._find_available_worker(["dead_worker"]))
        self.assertEqual(self.scheduler._find_available_worker(["dead_worker", "alive_worker"]), "alive_worker")

    async def test_dead_worker_cleanup_resolves_pending_futures(self):
        """Dead workers must resolve pending result futures via real _cleanup_dead_workers."""
        dead_worker_id = "test_dead_worker"
        mock_proc = MagicMock()
        mock_proc.is_alive.return_value = False

        self.scheduler.workers[dead_worker_id] = mock_proc
        self.scheduler.worker_current_job[dead_worker_id] = "job-123"
        self.scheduler.worker_current_callback[dead_worker_id] = "cb-123"
        self.scheduler.job_to_callback["job-123"] = "cb-123"

        # Register a pending future
        fut = asyncio.Future()
        self.scheduler.pending_results["cb-123"] = fut

        # Run real cleanup iteration
        with patch.object(self.scheduler, "_destroy_worker", return_value=None):
            with patch.object(self.scheduler.job_queue, "fail_job", return_value=None):
                await self.scheduler._cleanup_dead_workers(run_once=True)

        self.assertTrue(fut.done())
        res = fut.result()
        self.assertFalse(res["success"])
        self.assertEqual(res["job_id"], "job-123")
        self.assertIn("terminated unexpectedly", res["error"])

        # Test that cleanup removes the pending mapping
        self.assertNotIn("cb-123", self.scheduler.pending_results)
        self.assertNotIn("job-123", self.scheduler.job_to_callback)

        # Test that cleanup on an already-completed future does not raise InvalidStateError
        with patch.object(self.scheduler, "_destroy_worker", return_value=None):
            with patch.object(self.scheduler.job_queue, "fail_job", return_value=None):
                await self.scheduler._cleanup_dead_workers(run_once=True)

    async def test_model_load_failure_fails_job_immediately(self):
        """When worker model load fails, job must immediately fail without requeuing."""
        self.scheduler.register_model({
            "model_id": "triposr_image_to_raw_mesh",
            "feature_type": "image_to_raw_mesh",
            "module": "adapters.triposr_adapter",
            "class": "TripoSRImageToRawMeshAdapter",
            "vram_requirement": 0,
        })

        req = JobRequest(
            feature="image_to_raw_mesh",
            inputs={"image_path": "dummy.png"},
            model_preference="triposr_image_to_raw_mesh",
        )
        job_id = await self.scheduler.job_queue.enqueue(req)
        req.job_id = job_id
        self.scheduler.last_worker_error["triposr_image_to_raw_mesh"] = "torchmcubes CUDA mismatch"

        with patch.object(self.scheduler, "_find_or_create_worker_for_job", return_value="MODEL_LOAD_FAILED"):
            await self.scheduler._process_job_with_queue_integration(req)

        job = await self.scheduler.job_queue.get_job(job_id)
        self.assertEqual(job.status.value, "failed")
        self.assertIn("Model load failed", job.error)
        self.assertIn("torchmcubes", job.error)


if __name__ == "__main__":
    unittest.main()
