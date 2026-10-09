## 2026-10-05 Frontend Dependency Version Upgrade
- Upgraded all frontend dependencies to the latest stable versions verified against the npm registry and peer requirements: next 16.3.8, react/react-dom 19.3.0, three 0.186.1, @react-three/fiber 9.8.1, @react-three/drei 10.7.9, all 27 Radix packages at latest 1.x/2.x, tailwindcss 4.3.3 / @tailwindcss/postcss 4.3.3, typescript 7.0.2, @types/node 24.19.1 / @types/react 19.3.0 / @types/react-dom 19.3.0 / @types/three 0.186.0, eslint 9.39.5 / eslint-config-next 16.3.8, zustand 5.0.15, @tanstack/react-query 5.104.1, motion 13.4.6, lucide-react 1.52.0, axios 1.20.0, react-hook-form 7.89.0, sonner 2.0.8, input-otp 1.5.0, vaul 1.1.2, cmdk 1.1.1, embla-carousel-react 8.6.0, recharts 3.10.1, clipper-lib 6.4.2, clsx 2.1.1, class-variance-authority 0.7.1, tailwind-merge 3.7.0, three-mesh-bvh 0.9.15, three-bvh-csg 0.0.18, @dimforge/rapier3d-compat 0.21.0, meshoptimizer 1.3.0, @hugeicons/react 1.1.10, @dnd-kit/* at latest. Runtime locked: Node.js 24.21.0 LTS, npm 11.19.0, Bun 1.4.2 (package.json engines + "_runtime" field + scripts/setup.sh _ensure_* functions).
- Regenerated bun.lock with Bun 1.4.2; removed the stale package-lock.json. All 60 dependencies + 10 devDependencies resolved with zero peer conflicts.
- Compatibility decisions: react-day-picker pinned at 8.10.2 (v9/v10 renamed the custom-component/classname API and removed IconLeft/IconRight used by the workspace calendar) and react-resizable-panels pinned at 3.0.6 (v4 renamed PanelGroup→Group, PanelResizeHandle→Separator); both pinned at the latest versions still compatible with existing code to avoid out-of-scope app-code changes. motion kept at 13.4.6 (14.0.0 was <1 week old at upgrade time — avoidable risk on the 20+ file animation stack). eslint kept at 9.39.5 (eslint-plugin-react, a dependency of eslint-config-next, caps ESLint at ^9.7, so 10.x would be a peer conflict). @types/node kept at 24.19.1 (latest 24.x line; matches the pinned Node 24 LTS runtime, not the newer 26.x typings).
- Validation: `bun run test` (tsc --noEmit) — clean. `bun run build` (Next.js 16.3.8 / Turbopack) — passes, 13 static pages generated (/, _not-found, /admin, /animation, /dashboard, /apple-icon.png, /icon.svg, /outputs, /rigging, /system, /workspace, /api/v1/[...path], /static/[...path], /workspace/[...tool]). `bun run lint` — fails with the pre-existing typescript-eslint / TypeScript 7.0.0 incompatibility (typescript-eslint versions <=8.71.0 all reject the TS 7.0.0 API surface; reproduces identically on HEAD before any upgrade). Recorded as a compatibility issue for the debugging phase; no app-code changes made.

## 2026-10-05 SG-01 Smart Generation Closure
- Smart Generation now has a real `/api/v1/smart-generation/generation` submission contract that delegates to the existing image raw/textured generation endpoints, avoiding a duplicate scheduler or inference path.
- GeneratePanel intent buttons remain backend-owned and deterministic; when an uploaded image is ready they now trigger the normal generation lifecycle after applying the preset, with model/VRAM explainability shown inline.
- Added focused regression coverage for smart intent resolution, preprocessing provenance, built-in preset inventory, and printability reporting.

## 2026-10-05 Model Registry & Download Manager Parity Audit
- Cross-checked the 23 backend model manifest entries against the 22 user-selectable frontend entries, the root manager.sh, and backend/scripts/download_models.sh.
- VoxHammer was the only registered model family missing from the download manager. Added its image- and text-conditioned TRELLIS checkpoints using the adapter-compatible Hugging Face cache layout.
- Corrected shared-checkpoint handling for Hunyuan3D-2.1 and Hunyuan3D-2mini so model-specific entries cannot falsely report readiness from an unrelated partial directory; FastMesh no longer re-downloads a verified V1K bundle.
- Runtime CUDA/model visual validation remains environment-gated and is not represented as passed.

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
- Phase 0 Q1–Q8 are source-level verified. Full NVIDIA/model visual A/B and 22 user-facing-model GPU smoke validation remain explicitly environment-gated.
- Future agents must independently verify the current implementation and tests; TASKS.md status labels are not evidence.

## Phase 1 Workflow Closure — 2026-10-05

- SG-06 uses one shared deterministic preprocessing artifact rather than adapter-specific parallel pipelines.
- SG-07 uses existing repair/topology infrastructure and the common post-process lifecycle.
- SG-08 uses the existing UniRig adapter as a scheduler-managed child workflow after final production processing.
- SG-02.2 uses one YAML source of truth and deterministic model priority/readiness/VRAM filtering.
- Phase1 status labels are not evidence; future agents must independently verify source paths and tests.
- Full CUDA/model runtime validation remains environment-gated and is not represented as passed.

## 2026-10-08 — Fidelity + Resource Orchestration Hardening

- Added `backend/core/scheduler/resource_planner.py` for deterministic model routing, GPU/VRAM placement, supported multi-GPU planning, and CPU-thread scaling.
- Added `backend/core/quality/evaluation.py` plus `backend/scripts/run_mesh_quality_benchmark.py` for reference-aware CD/F-Score/DCD diagnostics, master-to-derivative drift checks, and deterministic multi-view rendering.
- High/ultra untextured generated assets now use the existing curvature-adaptive AutoRetopo path as a derivative-target builder before UV/bake; native-textured masters preserve their native mapping.
- TripoSG high/ultra routes disable the fast decoder so the upstream hierarchical extraction path is used when supported.
- TRELLIS.2 is retained as an additive multi-GPU-capable path using explicit Accelerate component dispatch. Combined VRAM is never treated as implicit model parallelism.
- Existing models remain registered; automatic routing can fall back to another retained compatible model after an automatic model-load failure.
- Final GPU/model visual validation remains user-hardware-gated. Non-hardware tests cover resource planning and quality diagnostics.

### User GPU validation package

Run from the repository root:

```bash
cd backend
python -c "import torch; print('CUDA:', torch.cuda.is_available()); print('GPUs:', torch.cuda.device_count()); [print(i, torch.cuda.get_device_name(i), round(torch.cuda.get_device_properties(i).total_memory/1024**3, 2), 'GB') for i in range(torch.cuda.device_count())]"
python -m unittest backend/tests/test_resource_planner.py backend/tests/test_quality_evaluation.py
```

For a two-GPU resource-discovery check:

```bash
CUDA_VISIBLE_DEVICES=0,1 python - <<'PY'
from core.scheduler.gpu_monitor import GPUMonitor
from core.scheduler.resource_planner import ResourcePlanner
m = GPUMonitor(tracking_mode=False)
p = ResourcePlanner(m)
print(p.gpu_capacity_snapshot())
print('GPUs detected:', len(p.gpu_capacity_snapshot()))
PY
```

Use the normal ForMash3D workspace generation flow for final visual/VRAM validation. Confirm that a model whose declared footprint exceeds one card but fits the supported aggregate placement is assigned multiple GPUs, that no existing model disappears from model selection, and that the generated master remains available separately from the optimized derivative.

## 2026-10-08 — Deep Task Gap Closure

- Normalized the model capability contract at configuration load time. The contract now includes modality, multiview input/output semantics, texture/PBR/vertex-color state, preprocessing/extraction preferences, resolution/face-budget hints, VRAM/CPU requirements, multi-GPU strategy, postprocess profile, latency class and output formats.
- Smart intent resolution now considers per-GPU free VRAM plus aggregate free VRAM for explicitly multi-GPU-capable models, then uses the shared deterministic quality/polycount/texture/latency router instead of blindly taking the first YAML candidate.
- Optional image enhancement now supports model-selected preprocessing profiles and records subject occupancy/profile/target resolution in provenance.
- Final QA rejects invalid/non-finite geometry, validates LOD lineage, and marks production degraded when final quality inspection or master-to-derivative fidelity gates fail.
- Added a controlled model A/B benchmark CLI. It requires identical input hashes and production protocol and does not treat one generated result as ground truth.
- Added FORMSH3D_CPU_THREADS=auto and FORMSH3D_CPU_WORKERS=auto; scheduler admission uses the shared CPU worker cap.
- Unique3D readiness/download capability reporting now includes the existing model ID.
- Hi3DGen remains explicitly evaluation-gated; no unsupported dependency/runtime was added just to satisfy the task text.

### 2026-10-08 Deep Audit & Optimization
- Conducted Ponytail Ultra audit on recent high-fidelity commits.
- Stripped speculative rendering abstractions (pyrender) and custom module wrappers (accelerate wrapper) in favor of fast standard library equivalents (`trimesh.volume`, native `dispatch_model`).
- 100% of the TASKS.md requirements verified in place and hardened against resource exhaustion.

## 2026-10-09 Studio Telemetry, Preview Persistence, Multi-Job Queueing & Engine Fixes
- **Telemetry UI**: Upgraded Header resource meters to vertical pipe mini-gauges with dynamic saturated status colors: Neon Emerald (`#00FF88`), Gold (`#FFD700`), Vivid Amber (`#FF9900`), Crimson (`#FF3366`), percentage readouts, and outside-click auto-dismissal.
- **Persistent Asset Storage**: Replaced fragile `URL.createObjectURL(file)` across workspace tabs with backend persistent endpoints (`/api/v1/file-upload/download/{file_id}`, `/api/v1/file-upload/thumbnail/{file_id}`). Previews and reference thumbnails remain durable when switching between single-view, multiview, and assets panels.
- **Continuous Generation & Background Queueing**: Added dual-action generation button: primary button shows active progress while secondary "Queue Next" button enqueues subsequent generation jobs without blocking the studio. If VRAM is full, jobs wait in the scheduler queue safely; if multiple GPUs are available, concurrent jobs execute.
- **MeshViewer HUD Job Capsule**: Added top-right horizontal mini-capsule in the 3D viewport displaying reference thumbnail, active spinner, progress %, stage details, and an interactive "View" button to load completed models directly into the viewport.
- **TripoSF/TripoSR VRAM Manifest Fix**: Fixed `ValueError: VRAM requirement for triposr_image_to_raw_mesh must come from the model manifest` during coarse mesh generation by passing `vram_requirement=6144` explicitly from `triposf_adapter.py` and adding a manifest/default fallback in `triposr_adapter.py`.
- **Quality Evaluation Export**: Implemented `compare_render_directories` in `backend/core/quality/evaluation.py` to fix `ImportError: cannot import name 'compare_render_directories'`.
- **Redis Job Queue Deletion**: Fixed `delete_job` in `backend/core/scheduler/redis_job_queue.py` to delete from both Redis and SQLite (`db_manager`), preventing `500 Failed to delete job from database`.


### Update 2026-10-09
- Fixed multiple critical backend adapter crashes (Trellis autograd baking, Unique3D seed initialization, Hunyuan3D CPU hardware offloading).
- Refactored frontend UI for logs tab to mirror an authentic, low-latency VS Code style terminal (`features/admin/tabs/LogsTab.tsx`).
- Streamlined unified master logging across backend and multiprocess workers.
- Addressed active generation UI blocking and rendering anomalies in MeshViewer queue.
- Implemented deep-linked dynamic routing for generations (`/workspace/[tool]/[job_id]`) to persist user context across reloads and shares.
