"""Regression tests for the database admin router (/api/v1/system/database).

Storage is redirected to a temp directory via STORAGE_LOCAL_PATH so the clear
endpoints can never touch real assets during tests.
"""

import asyncio
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from api.dependencies import verify_api_key
from api.routers import database as database_router
from core.scheduler.job_queue import JobQueue, JobRequest, JobStatus


class _FakeScheduler:
    """Minimal scheduler surface used by the database router."""

    def __init__(self, queue: JobQueue):
        self.job_queue = queue

    async def get_job_status(self, job_id: str):
        job = await self.job_queue.get_job(job_id)
        if job is None:
            return None
        return {
            "job_id": job.job_id,
            "status": job.status.value
            if hasattr(job.status, "value")
            else str(job.status),
            "feature": job.feature,
            "result": job.result or {},
        }

    async def cancel_job(self, job_id: str, force: bool = False):
        return await self.job_queue.cancel_job(job_id, force=force)


class DatabaseAdminRouterTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        os.environ["STORAGE_LOCAL_PATH"] = self.tmp.name
        self.addCleanup(lambda: os.environ.pop("STORAGE_LOCAL_PATH", None))

        self.queue = JobQueue(database_url=f"sqlite:///{self.tmp.name}/jobs.db")
        self.app = FastAPI()
        self.app.include_router(
            database_router.router,
            prefix="/api/v1/system/database",
            tags=["Database"],
        )

        async def fake_scheduler(request: Request):
            return _FakeScheduler(self.queue)

        self.app.dependency_overrides[database_router.get_scheduler] = fake_scheduler
        self.app.dependency_overrides[verify_api_key] = lambda: True

        async def no_user(authorization=None, request=None):
            return None

        patcher = mock.patch.object(
            database_router, "get_current_user_optional", no_user
        )
        patcher.start()
        self.addCleanup(patcher.stop)
        self.client = TestClient(self.app)

    async def _seed(self, status: JobStatus, feature: str = "image_to_raw_mesh") -> str:
        job = JobRequest(feature=feature, inputs={"image_file_id": "seed"})
        await self.queue.enqueue(job)
        if status == JobStatus.COMPLETED:
            await self.queue.dequeue()
            await self.queue.complete_job(job.job_id, {"mesh_path": "x"})
        elif status == JobStatus.FAILED:
            await self.queue.dequeue()
            await self.queue.fail_job(job.job_id, "boom")
        elif status == JobStatus.CANCELLED:
            await self.queue.cancel_job(job.job_id)
        return job.job_id

    async def test_stats_reports_both_stores(self):
        await self._seed(JobStatus.COMPLETED)
        res = self.client.get("/api/v1/system/database/stats")
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertIn("sqlite", body)
        self.assertIn("queue", body)
        self.assertIn("disk", body)
        self.assertTrue(body["sqlite"]["available"])
        self.assertGreaterEqual(body["sqlite"].get("total_jobs", 0), 1)
        self.assertGreater(body["sqlite"]["database_size_bytes"], 0)
        self.assertEqual(body["disk"]["storage_root"], self.tmp.name)

    async def test_keys_requires_redis(self):
        res = self.client.get("/api/v1/system/database/keys")
        self.assertEqual(res.status_code, 503)

    async def test_bulk_delete_requires_confirmation(self):
        await self._seed(JobStatus.COMPLETED)
        res = self.client.request("DELETE", "/api/v1/system/database/jobs", json={})
        self.assertEqual(res.status_code, 400)

    async def test_bulk_delete_skips_running_jobs_without_force(self):
        await self._seed(JobStatus.COMPLETED)
        await self._seed(JobStatus.FAILED)
        running = JobRequest(feature="image_to_raw_mesh", inputs={})
        await self.queue.enqueue(running)
        await self.queue.dequeue()

        res = self.client.request(
            "DELETE", "/api/v1/system/database/jobs", json={"confirm": True}
        )
        self.assertEqual(res.status_code, 400)  # needs a selector

        res = self.client.request(
            "DELETE",
            "/api/v1/system/database/jobs",
            json={"confirm": True, "feature": "image_to_raw_mesh"},
        )
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body["deleted"], 2)
        self.assertEqual(body["skipped"], 1)
        # The processing job is skipped, not deleted, without force.
        self.assertIsNotNone(await self.queue.get_job(running.job_id))

    async def test_clear_all_jobs_requires_typed_confirmation(self):
        await self._seed(JobStatus.COMPLETED)
        # A durable row that never reached the queue: only the SQLite sweep removes it.
        direct = JobRequest(feature="image_to_raw_mesh", inputs={"direct": True})
        self.queue.db_manager.save_job(direct)
        res = self.client.post(
            "/api/v1/system/database/jobs/clear", json={"confirm": "nope"}
        )
        self.assertEqual(res.status_code, 400)

        res = self.client.post(
            "/api/v1/system/database/jobs/clear",
            json={"confirm": "CLEAR_ALL_JOBS"},
        )
        self.assertEqual(res.status_code, 200)
        body = res.json()
        # Both the seeded job and the direct SQLite-only row are enumerated and removed.
        self.assertEqual(body["jobs_deleted"], 2)
        self.assertGreaterEqual(body["sqlite_rows_deleted"], 0)
        self.assertEqual(body["workspaces_removed"], 0)

        stats = self.queue.db_manager.get_queue_statistics()
        self.assertEqual(stats.get("total_jobs", 0), 0)

    async def test_clear_all_jobs_removes_workspaces_under_temp_storage(self):
        meshes_root = os.path.join(self.tmp.name, "models", "meshes")
        os.makedirs(os.path.join(meshes_root, "house_a190654b-2b8e-432b-8be1-b88df5df9ff8"))
        os.makedirs(os.path.join(meshes_root, "mug_b250654b-2b8e-432b-8be1-b88df5df9ff8"))
        (await self._seed(JobStatus.COMPLETED))

        res = self.client.post(
            "/api/v1/system/database/jobs/clear",
            json={"confirm": "CLEAR_ALL_JOBS"},
        )
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body["workspaces_removed"], 2)
        self.assertFalse(os.path.isdir(os.path.join(meshes_root, "house_a190654b-2b8e-432b-8be1-b88df5df9ff8")))

    async def test_clear_all_files_requires_typed_confirmation(self):
        res = self.client.request(
            "DELETE", "/api/v1/system/database/files/clear", json={"confirm": "nope"}
        )
        self.assertEqual(res.status_code, 400)

        uploads = os.path.join(self.tmp.name, "uploads")
        os.makedirs(os.path.join(uploads, "image", "ab"))
        with open(os.path.join(uploads, "image", "ab", "upload_ab12.png"), "wb") as fh:
            fh.write(b"x")

        res = self.client.request(
            "DELETE",
            "/api/v1/system/database/files/clear",
            json={"confirm": "CLEAR_ALL_FILES"},
        )
        self.assertEqual(res.status_code, 200)
        self.assertFalse(os.path.exists(os.path.join(uploads, "image", "ab", "upload_ab12.png")))

    async def test_models_root_derived_from_storage_root(self):
        """BUG-025: _models_root must dynamically derive from _storage_root() / 'models'."""
        self.assertEqual(
            database_router._models_root(),
            (Path(self.tmp.name) / "models").resolve(),
        )

    async def test_delete_tree_handles_files_and_directories(self):
        """BUG-003: _delete_tree handles both files and directories, and guards against escaping root."""
        root = Path(self.tmp.name)
        test_file = root / "sample.txt"
        test_file.write_text("hello")
        self.assertIsNone(database_router._delete_tree(test_file, root))
        self.assertFalse(test_file.exists())

        test_dir = root / "sample_dir"
        test_dir.mkdir()
        (test_dir / "nested.txt").write_text("nested")
        self.assertIsNone(database_router._delete_tree(test_dir, root))
        self.assertFalse(test_dir.exists())

        # Outside root refusal
        outside = Path(tempfile.gettempdir())
        res = database_router._delete_tree(outside, root)
        self.assertIsNotNone(res)
        self.assertIn("Refusing", res)

    async def test_delete_job_distinguishes_workspace_status(self):
        """BUG-005: _delete_job_with_workspace distinguishes deleted, missing, and not_recorded workspace."""
        # 1. Job without asset_root
        job_id_no_ws = await self._seed(JobStatus.COMPLETED)
        res_no_ws = await database_router._delete_job_with_workspace(
            _FakeScheduler(self.queue), job_id_no_ws
        )
        self.assertTrue(res_no_ws["deleted"])
        self.assertEqual(res_no_ws["asset_workspace_status"], "not_recorded")
        self.assertFalse(res_no_ws["asset_workspace_deleted"])

        # 2. Job with missing asset_root
        job_missing = JobRequest(feature="image_to_raw_mesh", inputs={})
        await self.queue.enqueue(job_missing)
        await self.queue.dequeue()
        missing_path = str(Path(self.tmp.name) / "models" / "nonexistent_ws")
        await self.queue.complete_job(job_missing.job_id, {"asset_root": missing_path})
        res_missing = await database_router._delete_job_with_workspace(
            _FakeScheduler(self.queue), job_missing.job_id
        )
        self.assertTrue(res_missing["deleted"])
        self.assertEqual(res_missing["asset_workspace_status"], "missing")
        self.assertFalse(res_missing["asset_workspace_deleted"])

        # 3. Job with existing asset_root that gets deleted
        job_real = JobRequest(feature="image_to_raw_mesh", inputs={})
        await self.queue.enqueue(job_real)
        await self.queue.dequeue()
        real_ws = Path(self.tmp.name) / "models" / "real_ws"
        real_ws.mkdir(parents=True, exist_ok=True)
        (real_ws / "mesh.glb").write_text("mesh")
        await self.queue.complete_job(job_real.job_id, {"asset_root": str(real_ws)})
        res_real = await database_router._delete_job_with_workspace(
            _FakeScheduler(self.queue), job_real.job_id
        )
        self.assertTrue(res_real["deleted"])
        self.assertEqual(res_real["asset_workspace_status"], "deleted")
        self.assertTrue(res_real["asset_workspace_deleted"])
        self.assertFalse(real_ws.exists())

    async def test_collect_job_ids_applies_status_and_feature_to_redis(self):
        """BUG-014: _collect_job_ids applies status and feature selectors to Redis jobs."""
        fake_redis = mock.AsyncMock()
        fake_redis.hgetall.return_value = {
            b"j1": json.dumps({"status": "completed", "feature": "image_to_raw_mesh"}).encode(),
            b"j2": json.dumps({"status": "failed", "feature": "image_to_raw_mesh"}).encode(),
            b"j3": json.dumps({"status": "completed", "feature": "text_to_3d"}).encode(),
        }
        fake_sched = mock.MagicMock()
        fake_sched.job_queue = mock.MagicMock(redis=fake_redis)

        # Filter by status and feature
        ids = await database_router._collect_job_ids(
            fake_sched, None, status="completed", feature="image_to_raw_mesh"
        )
        self.assertEqual(ids, ["j1"])

        # Filter by status only
        ids_status = await database_router._collect_job_ids(
            fake_sched, None, status="completed", feature=None
        )
        self.assertEqual(set(ids_status), {"j1", "j3"})

    async def test_filestore_cleans_stale_ids_from_global_and_per_type_sets(self):
        """BUG-016: list_file_metadata cleans stale IDs from both global and per-type sorted sets."""
        from core.file_store import FileStore

        mock_redis = mock.AsyncMock()
        # zrevrange returns one stale ID
        mock_redis.zrevrange.return_value = [b"stale_file_1"]
        # get returns None -> stale
        mock_redis.get.return_value = None

        # scan_iter yields per-type keys
        async def fake_scan(match):
            for k in [b"3daigc:files:all", b"3daigc:files:image", b"3daigc:files:mesh"]:
                yield k

        mock_redis.scan_iter = fake_scan

        pipeline_mock = mock.MagicMock()
        class FakePipelineCtx:
            async def __aenter__(self):
                return pipeline_mock
            async def __aexit__(self, *args):
                pass
        mock_redis.pipeline = mock.MagicMock(return_value=FakePipelineCtx())

        store = FileStore(redis_client=mock_redis)
        files = await store.list_file_metadata(file_type=None)
        self.assertEqual(files, [])

        # Verify zrem was called for global and per-type keys
        zrem_calls = [call[0] for call in pipeline_mock.zrem.call_args_list]
        keys_cleaned = {c[0] for c in zrem_calls}
        self.assertIn("3daigc:files:all", keys_cleaned)
        self.assertIn("3daigc:files:image", keys_cleaned)
        self.assertIn("3daigc:files:mesh", keys_cleaned)

    async def test_clear_all_files_paginates_and_reports_authoritative_count(self):
        """BUG-004: clear_all_files paginates and reports authoritative removed count without skipping."""
        mock_store = mock.AsyncMock()
        total_files = 2500
        all_metadata = [{"file_id": f"file_{i}"} for i in range(total_files)]

        async def fake_list(limit=1000, offset=0):
            return all_metadata[offset:offset + limit]

        mock_store.list_file_metadata.side_effect = fake_list
        mock_store.delete_file_metadata.return_value = True

        self.app.state.file_store = mock_store
        res = self.client.request(
            "DELETE",
            "/api/v1/system/database/files/clear",
            json={"confirm": "CLEAR_ALL_FILES"},
        )
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body["file_metadata_removed"], total_files)
        self.assertEqual(mock_store.delete_file_metadata.call_count, total_files)


if __name__ == "__main__":
    unittest.main()
