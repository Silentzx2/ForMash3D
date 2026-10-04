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

## 2026-10-04 — [Source-Fidelity Contract Verification]
- Verified BQ-01..BQ-12 and the bug-registry fixes against the live code; closed the remaining drift without treating test scripts as the source of truth.
- TRELLIS image-path `generation_info` now records actual sampling stages, texture resolution, and bake mode (BQ-11 parity with the text path).
- Fixed a stale official-parity assertion (TRELLIS image `texture_resolution` default 1024 → 2048) and the TripoSR `mc_resolution` docstring (fixed 320 official ceiling).
- Docs/TASKS.md now records the TripoSG Y-up rotation as rejected/reverted per the 2026-10-03 parity audit; cross-bug pattern and summary table reconciled.

## 2026-10-03 — [Deep Adapter Parity & Source-Fidelity Closure]
- Centralized raw-source fidelity in the scheduler by stripping adapter-level extraction, decimation, and remesh controls before model inference.
- Closed legacy Hunyuan3D-2.1 parity gaps: seeded 50-step / 5.0-guidance source generation is shared by raw and Shape→Paint paths.
- Fixed TRELLIS source texture/metadata contracts and fixed maximum source texture profiles for TRELLIS/TRELLIS.2.
- Expanded regression coverage and reconciled relevant documentation; CUDA/NVIDIA visual A/B remains runtime-gated.

## 2026-10-03 — [Adapter Raw-Quality / Official-Parity Fix]
- Fixed raw `source.glb` quality drift caused by a global 75-step inference contract; generation now follows model-specific upstream/tuned schedules.
- Corrected TripoSR raw extraction to 320 and TripoSF to 1024³ + 1,638,400 samples, with the existing VRAM safety cap retained.
- Added Hunyuan seeded generators, connected Mini Turbo FlashVDM to its official pipeline method, and restored TRELLIS hole filling + Z-up→Y-up extraction parity.
- Added the adapter quality bug report, replaced `Docs/TASKS.md`, and expanded official-parity regression coverage.

