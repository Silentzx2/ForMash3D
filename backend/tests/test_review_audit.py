import tempfile
import unittest

from core.scheduler.job_queue import JobQueue, JobRequest, JobStatus


class JobQueueRegressionTests(unittest.IsolatedAsyncioTestCase):
    async def test_status_reads_are_side_effect_free(self):
        with tempfile.TemporaryDirectory() as tmp:
            queue = JobQueue(database_url=f"sqlite:///{tmp}/jobs.db")
            job = JobRequest(feature="image_to_raw_mesh", inputs={"image_file_id": "x"})
            await queue.enqueue(job)
            await queue.dequeue()
            await queue.mark_job_started(job.job_id, "triposr_image_to_raw_mesh")
            current = await queue.get_job(job.job_id)
            self.assertEqual(current.progress, 0.25)
            self.assertEqual(current.metadata.get("stage"), "loading_model")

    async def test_restart_recovery_requeues_processing_jobs(self):
        with tempfile.TemporaryDirectory() as tmp:
            url = f"sqlite:///{tmp}/jobs.db"
            queue1 = JobQueue(database_url=url)
            job = JobRequest(feature="image_to_raw_mesh", inputs={"image_file_id": "x"})
            await queue1.enqueue(job)
            await queue1.dequeue()
            await queue1.mark_job_started(job.job_id, "triposr_image_to_raw_mesh")

            queue2 = JobQueue(database_url=url)
            self.assertEqual((await queue2.get_job(job.job_id)).status, JobStatus.PROCESSING)
            self.assertEqual(await queue2.recover_processing_jobs(), 1)
            recovered = await queue2.get_job(job.job_id)
            self.assertEqual(recovered.status, JobStatus.QUEUED)
            self.assertEqual(recovered.metadata.get("stage"), "recovering")

    async def test_failure_and_cancellation_remain_distinct(self):
        with tempfile.TemporaryDirectory() as tmp:
            queue = JobQueue(database_url=f"sqlite:///{tmp}/jobs.db")

            failed = JobRequest(feature="image_to_raw_mesh", inputs={"image_file_id": "a"})
            await queue.enqueue(failed)
            await queue.fail_job(failed.job_id, "boom")
            self.assertEqual((await queue.get_job(failed.job_id)).status, JobStatus.FAILED)

            cancelled = JobRequest(feature="image_to_raw_mesh", inputs={"image_file_id": "b"})
            await queue.enqueue(cancelled)
            self.assertTrue(await queue.cancel_job(cancelled.job_id))
            self.assertEqual((await queue.get_job(cancelled.job_id)).status, JobStatus.CANCELLED)


if __name__ == "__main__":
    unittest.main()
