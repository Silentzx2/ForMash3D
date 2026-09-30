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

## 2026-09-30 — Final Review Audit Gap Pass
- Added backend model readiness/capability metadata and removed frontend assumptions about a fixed 24GB GPU.
- Made FastMesh variants and VRAM reservation manifest-driven; hardened UltraShape/P3-SAM/PartUV runtime contracts.
- Added collision gating, adaptive LOD ratios, collision-safe artifact naming, and asset reproducibility metadata with input hashes.
- Wired the existing frontend batch queue to the scheduler-backed text batch API.
- Added shared Redis cancellation requests, machine-readable error codes, and parity for background post-processing result updates.
- Tightened localStorage/blob/file-index cleanup and explicitly disabled unsupported multiview generation.

## 2026-09-30 — Final Audit Gap Closure
- Fixed production Docker/RunPod dependency paths and release-wheel resolution so container paths match the repository layout and current Wheels release assets.
- Bounded async SQLite progress persistence, moved status reads/deletes off the event loop, and preserved terminal error-code persistence.
- Separated raw inference completion from background production post-processing without deleting request inputs before lineage hashing; tracked post-process status/progress/errors explicitly.
- Reconciled manifest-driven model readiness, capabilities, VRAM requirements, repository-relative adapter paths, and UUID-based artifact naming across the remaining adapters.
- Fixed frontend post-process rehydration/QA scoring, capability-based routing, LRU cache accounting, and explicit post-process failure messaging.
- No tests, builds, GPU stress, or load validation were run in this pass by request.
