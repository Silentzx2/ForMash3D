## 2026-10-05 — [Phase 1 Generation Workflows]

- SG-06: shared Generation Preview/preprocessing artifacts with provenance and adaptive enhancement fallback.
- SG-07: deterministic printability QA and optional repair in the common post-process path.
- SG-08: canonical post-production UniRig child workflow with durable rigged artifact delivery and explicit degraded failures.
- SG-02.2: five deterministic YAML-backed smart intents with readiness and VRAM-aware model resolution.
- Verification: source-level cross-check completed; CUDA/model-weight visual validation remains environment-gated and is not marked as passed.

## 2026-10-05 — [Phase 0 Raw-Mesh Quality Closure]
- **Common post-process quality guard:** Added a shared geometry-fidelity guard to the normal production pipeline. Optimization results are rejected when they contain non-finite geometry, increase face count, exceed the allowed vertex-growth envelope, or materially drift the asset bounds; the repaired mesh is retained instead.
- **Healthy-mesh repair bypass:** Already-watertight/manifold source meshes now skip unnecessary topology repair, preventing cleanup code from mutating otherwise-valid native geometry.
- **Phase 0 contract:** Q1–Q8 source-fidelity, downstream-budget, texture-preservation, coordinate/provenance, model-schedule, and shared-pipeline contracts are explicitly tracked and regression-tested. Runtime GPU visual A/B remains environment-gated.

## 2026-10-04 — [Production Gap Closure]
- Corrected normal Image-to-3D routing so the selected model's backend capabilities determine raw vs textured endpoint selection; the previous path forced all generation through raw-mesh routing.
- Reduced workspace system telemetry refresh from 20 seconds to 5 seconds.
- Removed the remaining Text-to-3D generation route, client/type mappings, task mapping, and model-factory registration while retaining text mesh painting and text-to-motion.
- Hardened native-texture preservation: unrecoverable texture loss now fails the production pipeline instead of silently shipping an untextured game-ready asset; optional LOD texture loss is surfaced as an artifact error.
- Made scheduler retry/unload switches runtime-evaluated instead of import-time constants.
- Reconciled `Docs/TASKS.md` and core architecture/API documentation with the current `Dev` implementation.
