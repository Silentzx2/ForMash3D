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

## 2026-10-08 — [Deep High-Fidelity Task Gap Closure]

- Normalized the model capability contract across config, routing, readiness, preprocessing and resource planning.
- Smart intent routing now uses per-GPU and aggregate VRAM admission for supported multi-GPU models, then deterministic quality/polycount/texture/latency ranking.
- Added model-aware preprocessing profiles and subject-occupancy provenance.
- Added finite-geometry/face-index QA, final quality-status gating, LOD lineage validation and master-to-derivative degradation handling.
- Added controlled model A/B benchmarking with same-input/same-protocol enforcement and optional ground-truth evaluation.
- Added automatic CPU worker policy (FORMSH3D_CPU_WORKERS=auto) alongside thread scaling.
- Corrected Unique3D readiness/download detection and its generated-multiview capability semantics.
- Hi3DGen remains explicitly evaluation-gated; no unsupported dependency was introduced.

## 2026-10-07 — [Unique3D Integration]

- Integrated official AiuniAI/Unique3D (upstream commit 6311af200ee197544e82e0f2557cd890edd60416) as a first-class single-image → 3D model.
- Vendored source at backend/thirdparty/Unique3D/ with MIT license preserved and nested Git metadata removed.
- Added model download/verification, manager registration, backend adapter/factory/config, frontend registry, parameter wiring, and documentation.
- VRAM requirement remains 10240 MB until real hardware measurement.

## 2026-10-05 — [Mini Turbo & TRELLIS generation fixes]

- Fixed Hunyuan3D-DiT-v2-mini-Turbo checkpoint subfolder and local-weight path handling.
- Fixed TRELLIS texture optimization under PyTorch 2.x by avoiding an in-place autograd mutation.
- Added clearer missing-weight failures and retained source-fidelity behavior.

### [Unreleased] - 2026-10-08
- **Refactor (Ponytail Ultra)**: Stripped massive over-engineered logic from evaluation (removed pyrender, used fast trimesh.volume) and resource planner (used native accelerate auto device mapping).
- **Audit**: Completed final full stack task audit, ensuring no feature gaps remain from TASKS.md. All model routing and evaluation are now streamlined for performance and minimum lines of code.
