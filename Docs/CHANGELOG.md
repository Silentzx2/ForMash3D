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
