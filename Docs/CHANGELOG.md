## 2026-10-09 — [Unified Runtime Logging & Mini Turbo Initialization]

- Fixed Mini Turbo's `NoneType is not callable` failure by passing `device` to `from_pretrained()` instead of chaining the upstream in-place `.to()` method.
- Added regression coverage for the pipeline initialization contract.
- Consolidated project-managed API, scheduler/worker, frontend, launcher, and local Redis output into repository-root `logs/master.log`; removed per-service log targets and rotating siblings.
- Updated the startup scripts, Supervisor, Docker/Compose mounts, manager log viewer, and Admin Logs API/client to use the master log.
- Updated the existing README, architecture, memory and changelog documentation.

## 2026-10-09 — [Studio Telemetry, Asset Preview Persistence & Queueing Hardening]

- **Header Telemetry Gauges**: Redesigned header hardware telemetry with vertical pipe meters, saturated glow indicators based on real-time load (Neon Emerald `<50%`, Gold `<75%`, Vivid Amber `<90%`, Crimson `≥90%`), percentage readouts, and outside-click auto-dismissal.
- **Upload & Thumbnail Persistence**: Replaced ephemeral blob URLs with backend persistent asset endpoints (`/api/v1/file-upload/download/{file_id}`, `/api/v1/file-upload/thumbnail/{file_id}`); thumbnail preview stays retained across tab switches, route navigation, and component unmounts.
- **Dual-Action Generation & Queueing**: Generation button provides active progress tracking while exposing a secondary "Queue Next" button to enqueue jobs when GPU/VRAM is busy. Jobs process concurrently if GPU resources permit or wait in the queue safely.
- **MeshViewer HUD Job Capsule**: Added top-right horizontal status capsule in 3D viewport displaying reference thumbnail, active spinner, progress %, stage details, and direct "View" action to load completed models into the viewport.
- **TripoSF Coarse Mesh VRAM Fix**: Passed explicit `vram_requirement=6144` when instantiating `TripoSRImageToRawMeshAdapter` in `triposf_adapter.py`, and added manifest fallback to `triposr_adapter.py` to prevent coarse mesh generation failures.
- **Quality Evaluation Export**: Implemented `compare_render_directories` in `backend/core/quality/evaluation.py` to eliminate `ImportError` during automated quality evaluation and pipeline verification.
- **Job Queue Deletion Consistency**: Fixed `delete_job` in `backend/core/scheduler/redis_job_queue.py` to purge job records from both Redis hot keys and SQLite database, eliminating `500 Internal Server Error: Failed to delete job from database`.


## 2026-10-08 — [Final Full-Stack Deep Audit Closure]

- Hardened capability semantics so generated multiview models do not masquerade as multiview reconstruction inputs; routing now recognizes explicit multi-image collections.
- Closed frontend/backend contract gaps for quality mode, production texture resolution, job progress/cancellation, production variants, runtime model metadata and same-origin asset URLs.
- Hardened Zero123++ readiness UX, multiview request validation, preprocessing provenance and max-view admission.
- Aligned frontend model capability flags with backend manifests, fixed custom-storage retention cleanup and retry defaults, and preserved GPU unload telemetry.
- Added regression coverage for multiview routing and capability normalization.
- Six-worker sub-agent execution was not available in the current runtime; workstreams were therefore completed sequentially and independently audited. Real CUDA/OOM/visual A/B execution remains user-hardware gated.

### [Unreleased] - 2026-10-08
- **Refactor (Ponytail Ultra)**: Stripped massive over-engineered logic from evaluation (removed pyrender, used fast trimesh.volume) and resource planner (used native accelerate auto device mapping).
- **Audit**: Completed final full stack task audit, ensuring no feature gaps remain from TASKS.md. All model routing and evaluation are now streamlined for performance and minimum lines of code.
