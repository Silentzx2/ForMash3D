## 2026-09-30 — Review Audit Hardening & Multi-Job Pipeline
- Corrected Redis priority/state/TTL semantics; moved hot progress fields out of the large job JSON and added time-indexed cleanup.
- Added restart recovery and actual worker termination for timeout/cancel paths; moved SQLite persistence off async scheduling paths.
- Made raw inference results immediately available while production post-processing runs in the background with separate status.
- Added scheduler-enforced batch `max_parallel` and independent workspace job state so new generations are not blocked by an existing job.
- Hardened path/upload/cache boundaries, explicit FastMesh variants, and release verification commands.
- Repaired integration verification and the frontend false-success test command.

## 2026-09-29 — Full Pipeline Telemetry & Workspace Audit
- Reworked live pipeline telemetry to surface backend stages, execution ETA, completed-stage count, and artifact readiness.
- Fixed queued-job cancellation to use the dedicated cancel contract.
- Guarded the Generate page against presenting the current single-image backend as functional multiview.

## 2026-09-29 — Viewport & Generation UX Hardening
- Moved advanced Physics/Mesh generation controls into an on-demand drawer.
- Added physics and viewer smoke validation paths.
- Added adaptive renderer quality for very dense meshes.
