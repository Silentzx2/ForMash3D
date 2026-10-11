## 2026-10-11 — [Backend Cancellation & Redis/SQLite Consistency]

- **Redis update_job_progress terminal status guard**: `update_job_progress` now checks job status first; if already terminal (`completed`, `failed`, `cancelled`), progress, stage, message, and logs are preserved without mutation.
- **SQLite cancellation persistence**: `cancel_job` now durably persists confirmed cancellation to SQLite via `db_manager.save_job` mirroring `complete_job` and `fail_job`.
- **Truthful cancellation response**: `cancel_mesh_generation` propagates real scheduler outcomes instead of forcing queue cancellation (`force=True`); accurately reports `cancelled=True` or `cancelled=False` with `cancel_requested=True`.
- **Frontend polling cancel sync**: `cancelExecution` updates `jobsById` and `jobsByIdRef.current` with `status: 'interrupted'`, preventing the polling loop from reactivating cancelled jobs.
- Docs updated: MEMORY, CHANGELOG.

## 2026-10-10 — [Database Durability: WAL Mode & Orphaned Job Reconciliation]

- **SQLite ran without WAL** while three processes (API, scheduler, workers) wrote the same file — readers could block on writers and long writes risked lock timeouts. `DatabaseManager` now sets `journal_mode=WAL`, `busy_timeout=30s`, `synchronous=NORMAL` on connect (persistent in the DB file).
- **Queued/processing rows were orphaned forever** by restarts or Redis-side deletes (SQLite stayed `queued`/`processing`, UI showed stuck jobs; 4 such rows existed). `recover_orphaned_jobs` now reconciles SQLite transient rows with no queue presence (jobs hash + pending zset) and marks them failed with "Job orphaned: no queue presence at scheduler startup" via a new single-transaction `DatabaseManager.mark_jobs_failed`. Terminal rows (history) are never touched. Verified live: exactly the 4 stale rows failed, the in-flight job preserved.
- **Scheduler startup temp cleanup broke in-flight jobs**: `_cleanup_stale_input_dirs` deleted every `/tmp/mesh_gen_*` dir, but the API process holds those dirs for jobs still queued — a scheduler restart mid-job deleted the base64 image temp file and the worker failed with `[Errno 2] No such file or directory: /tmp/mesh_gen_*/b64_*.webp`. Cleanup now only removes dirs untouched for 6+ hours ("previous crashed sessions" semantics).

