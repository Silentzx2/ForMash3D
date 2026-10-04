## 2026-10-04 Source-Fidelity Contract Verification Pass
- Re-verified BUG-REPORT-ADAPTER-QUALITY.md (BQ-01..BQ-12), the Docs/TASKS.md bug registry, and all project docs against the live adapters, scheduler firewall, postprocess pipeline, and frontend schedules.
- Closed the TRELLIS image-path response metadata gap: `generation_info` now records the actual ss/slat sampling stages, guidance, texture resolution, bake mode, and simplify ratio, matching the text path and BQ-11.
- Corrected a stale official-parity regression assertion (TRELLIS image `texture_resolution` schema default 1024 → 2048 per BQ-11/BQ-12/ADR-039) and the TripoSR `mc_resolution` docstring (fixed 320, not "default: 256").
- Corrected Docs/TASKS.md: the TripoSG Y-up rotation (BUG-004) is now recorded as reverted — the 2026-10-03 parity audit rejected the extra transform because the current upstream extraction is natively Y-up.
- Verification: backend pytest passes with 0 failures (3 runtime-gated skips); `npx tsc --noEmit` clean.

## 2026-10-03 Deep Adapter Parity & Source-Fidelity Firewall Audit
- Re-audited frontend generation contracts, scheduler sanitization, legacy Hunyuan3D-2.1, TRELLIS runtime metadata/schemas, PartPacker docs, and the source-fidelity documentation chain.
- Added a centralized scheduler firewall for adapter-level source-reduction controls: faces, num_faces, simplify, decimation_target, remesh, remesh_band, and remesh_project.
- Unified legacy Hunyuan3D-2.1 raw and Shape→Paint source generation on seeded 50-step / 5.0-guidance inference without low-VRAM step reduction.
- Fixed TRELLIS source texture schema/metadata drift and locked source texture generation to 2048; TRELLIS.2 source texture is locked to 4096.
- Expanded regression tests and reconciled the relevant project docs. CUDA/NVIDIA A/B visual validation remains runtime-gated.

## 2026-10-03 Adapter Raw-Quality / Official-Parity Audit
- Confirmed root cause for the reported raw `source.glb` quality gap: the frontend used a generic 75-step inference contract across models with materially different official/tuned schedules.
- Fixed model-specific schedules: Hunyuan Mini Turbo 5, Hunyuan Shape 50, TripoSG 50, TRELLIS image 12/12, TRELLIS text 25/25, UltraShape 50.
- Fixed raw extraction ceilings: TripoSR 320; TripoSF 1024³ + 1,638,400 samples, while preserving the existing constrained-VRAM safety downshift.
- Added deterministic generators to Hunyuan Shape and Mini Turbo; Mini Turbo now applies FlashVDM through the official pipeline method.
- TRELLIS extraction now enables hole filling and the official forward Z-up→Y-up conversion while keeping source simplification disabled.
- Rejected unsupported earlier TripoSG rotation/Flash-Decoder changes and the blanket TripoSR 0.9 foreground-ratio claim after checking current upstream code.
- CUDA/visual A/B validation remains runtime-gated.

## 2026-10-03 Zero123++ Multi-View Architecture, Canonical Mesh Storage, Physics & Tripo Alignment
- Vendored upstream Zero123++ v1.2 into `backend/thirdparty/zero123plus` without `.git` repository metadata; verified authoritative PyTorch 2.6 / CUDA 12.4 environment. Dependency installation simplified via cleaned requirements without temp files.
- Canonical storage layout: models are stored in separate directories under `storage/models/meshes/<image_name>_<job_id>/`. Game-ready exports produce exclusively `glb` and `fbx` named `<image_name>_<job_id>.glb` and `<image_name>_<job_id>.fbx`. Legacy formats (`obj`, `stl`, `ply`, `gltf`) convert on-demand on download.
- Physics: replaced placeholder fallback with automatic CoACD multi-hull convex decomposition (`collision/collision.glb`) and rigid-body physical properties (`metadata/physics.json`).
- Model orientation: eliminated unwanted rotation matrix in TripoSG and aligned TripoSF to enforce upright Y-up coordinates in Three.js viewport.
- Adapter `Zero123PlusAdapter` encapsulates 6 novel viewpoints at 30° azimuth intervals (30°, 90°, 150°, 210°, 270°, 330°), deterministic request hashing (`source_sha256`, `request_sha256`), canonical storage in `storage/models/meshes/<safe_asset_name>_<job_id>/multiview/`, view masks, and on-demand ZIP delivery (`<stem>.zip`).
- Capability gate: 3D generation models default to `capabilities.multiview: false`. The frontend action button and backend router (`/reconstruct-3d`) enforce strict rejection when attempting multi-view 3D reconstruction with incompatible engines.
- Model management: the root manager offers separate Zero123++ checkpoint and optional View-Space Normals ControlNet downloads; the model API reports Zero123++ weights as downloadable.
- Frontend: fixed `(h.artifacts.lods || []).slice is not a function` error by normalizing array and object LOD dictionaries; `MultiViewWorkspace.tsx` provides single-image automatic reuse, 6-view inspection gallery, full keyboard/mouse pan and zoom modal, advanced inference drawer, and manual view-set uploads.
- Verification: full backend suite passes (67 passed, 3 runtime-gated skips) and TypeScript compilation (`npx tsc --noEmit`) passes.

## 2026-10-03 Source Fidelity + Downstream Polycount Contract Hardening
- Root cause: target_polycount was intended as a post-process budget but was forwarded into adapters; TripoSG/TRELLIS/PartPacker could interpret it as an early decimation target.
- Fix: multiprocess_scheduler.py now builds a separate adapter-input dictionary and removes production-only budget/orchestration controls before _process_request().
- Maximum source fidelity: generation explicitly marks source_quality: max and uses the existing maximum geometry settings for each registered model. The visible quality selector no longer lowers source geometry.
- Canonical safety: master/source.glb is the untouched model-native checkpoint. Positive poly budgets are applied only in canonical post-processing; Native/Raw is target 0.
- Multi-part GLBs are flattened with their scene-graph node transforms applied in world space; unsupported mixed geometry conversion fails instead of silently dropping transforms.
- Adapter truthfulness: TripoSR's optional bake exports a real image material or reports failure, TRELLIS.2 rejects missing textured-export dependencies, TripoSF no longer substitutes a generic proxy, and Hunyuan Paint preserves reference-image aspect ratio. Shape-only models intentionally do not promise textures; UV generation alone is not a texture bake.
- Docker Compose now builds with repository-root paths and shares the canonical weights and storage directories between API/scheduler. Root `.dockerignore` excludes local weights/runtime data while retaining vendored model source.
- Dependency compatibility: the shared backend pins now intersect TripoSG's Transformers, Diffusers, and Hugging Face Hub requirements; install.sh and both Docker builds apply TripoSG requirements after the shared baseline. This environment has CPU-only Python 3.14, so CUDA inference and full image builds remain unverified.
- Verification: Added scheduler firewall + frontend source-contract regression tests. NVIDIA/CUDA generation and visual comparison remain runtime-gated.

## 2026-10-03 Workspace Production Controls & Viewport Performance Pass
- **Retopology poly budget:** Added `target_polycount` to the mesh-retopology API and `RemeshSettings`. The FastMesh V1K/V4K target remains model-fixed; the new slider controls the final production triangle budget downstream.
- **Generation workflow recipes:** Added Mobile / Game Ready / Cinematic / Native presets that synchronize model quality, final triangle budget, LOD generation, and optional physics in one action.
- **Viewport artifact inspection:** Added quick switching between Game Ready, immutable Source, and generated LOD artifacts directly in the viewport.
- **Viewport performance modes:** Added Auto / Fast / Detail rendering modes that adjust pixel ratio and shadow cost, with automatic heavy-mesh detection preserved for the default mode.
- **Research basis:** Current Tripo, Meshy, and Hyper3D workflows emphasize integrated generation, remesh/retopology, texture, rigging/animation, artifact review, and fast post-generation controls; the implementation keeps only the useful local/self-hosted subset.


## 2026-10-05 Phase 0 Raw-Mesh Quality Closure
- The production post-processing path now applies a shared geometry-fidelity guard after optimization. It rejects non-finite results, unexpected face growth, excessive vertex growth, and material bounding-box drift, then retains the repaired mesh instead.
- Already-watertight/manifold source meshes skip the repair mutation entirely, preserving native topology when no repair is required.
- Phase 0 Q1–Q8 are source-level verified. Full NVIDIA/model visual A/B and 22-model GPU smoke validation remain explicitly environment-gated.
- Future agents must independently verify the current implementation and tests; TASKS.md status labels are not evidence.
