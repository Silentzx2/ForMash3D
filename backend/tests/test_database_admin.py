"""Regression tests for the database admin router (/api/v1/system/database).

Storage is redirected to a temp directory via STORAGE_LOCAL_PATH so the clear
endpoints can never touch real assets during tests.
"""

import asyncio
import os
import tempfile
import unittest
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
            "result": {},
        }


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


if __name__ == "__main__":
    unittest.main()
