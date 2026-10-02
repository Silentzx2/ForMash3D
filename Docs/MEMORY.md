## 2026-10-02 Viewer & Network Resilience Hardening (Large Model Load & Stream Protection)
- **Root Cause of Viewer / Proxy Crash:**
  - `app/api/v1/[...path]/route.ts` used a 30s `AbortSignal.timeout(30000)` on all GET requests. For 50-100MB textured GLB files over network or tunnel, the stream exceeded 30s, causing an abort that broke the pipe and threw an unhandled Next.js `failed to pipe response: TimeoutError`.
  - Duplicate concurrent fetches from `prefetchGLB` and `MeshViewer` doubled the proxy load.
  - Job thumbnails generated in `asset_root / "previews" / "thumbnail.png"` were not exposed under `result["thumbnail_path"]`, causing `GET /api/v1/system/jobs/{job_id}/thumbnail` to return 404.
  - Heavy polygon meshes (>150K faces) could trigger WebGL context loss, which without `event.preventDefault()` permanently crashed the browser viewport.
- **Remediation Implemented:**
  - In `route.ts`: 10-minute dynamic timeout for binary assets; response stream wrapped in `TransformStream` with `.catch()` to absorb client cancellations cleanly.
  - In `glbCache.ts`: In-flight Promise deduplication prevents duplicate downloads of the same URL; 3-attempt exponential backoff retry with 120s timeout and stream fallback.
  - In `pipeline.py` & `system.py`: Added `thumbnail_path` to `_build_result` and fallback search across `asset_root / previews / thumbnail.png`, `preview.jpg`, and adjacent `*_thumb.png`.
  - In `MeshViewer.tsx`: Attached `webglcontextlost` and `webglcontextrestored` handlers to `renderer.domElement`.

## 2026-10-02 Official Model Implementation Parity & Raw Quality Hardening
- Performed exhaustive parity audit across 10+ models between `backend/thirdparty/` and `backend/adapters/`.
- Key Architectural Rule Enforced:
  - Adapters must NEVER decimate, remesh, or rescale raw models before saving `output_mesh_path`. Decimation and post-processing are strictly downstream.
  - `master/source.glb` is immutable and byte-for-byte authentic to upstream neural output.
- Root Cause Deviations Fixed:
  - TripoSG: Removed PyMeshLab quadric edge collapse decimation in `triposg_adapter.py`.
  - PartPacker: Default `num_faces=-1`, `num_steps=50`, `cv2.INTER_AREA`, and `len(faces) > 10` noise filtering in `partpacker_utils.py` and `partpacker_adapter.py`.
  - Hunyuan3D Paint v2.1: Enforced `use_remesh=False` in `hunyuan3d_paint_v21.py` and `hunyuan3d_adapter_v21.py`, preventing silent 40,000 face decimation during texturing.
  - TRELLIS / TRELLIS.2: Default `simplify=0.0` across text, image, and painting adapters. Restored 12-step sampling schedules (`ss_sampling_steps=12`, `slat_sampling_steps=12`) and removed artificial 20-step clamping. Set `decimation_target=-1` and `remesh=False` in TRELLIS.2.
  - Hunyuan3D Shape & Mini Turbo: Updated default `octree_resolution` from 256 to official pipeline default `384`.
  - UltraShape: Restored official defaults (`num_latents=32768`, `octree_res=1024`, corrected `hunyuan3d_root` path to `hunyuan3d-shape-v2-1`).
  - Raw Model Scale Preservation: Enforced `do_normalise=False` across raw asset generators (`hunyuan3d_shape_v21.py`, `hunyuan3d_dit_v2_mini_turbo.py`, `trellis2_adapter.py`, `fastmesh_adapter.py`).
  - Production Pipeline: Expanded `MAX_PRODUCTION_FACES` from 50,000 to 200,000. Enabled `auto_optimize: false` passthrough check to preserve 100% of native topology in `game_ready` when requested. Fixed compound double decimation in LOD chain calculation. Added graceful fallback to `fast-simplification` / `trimesh` decimation when pymeshlab native OpenGL libraries are missing in headless environments.
  - UI & Telemetry: Added Model Quality presets (`low`, `medium`, `high`, `ultra`) mapped to official parameters, Native/Raw polycount chips, and 200,000 slider. Added exact runtime parameter logging in `multiprocess_scheduler.py`.
  - Verification: Created `backend/tests/test_official_model_parity_contract.py` covering model contracts, parameter schemas, postprocessing passthrough, LOD ratios, and viewer routing (100% pass).

## 2026-10-02 Post-Processing Textured Retopo Guard & Live Job Polling
- Fixed post-processing crash on textured meshes (`RuntimeError: Texture-aware optimization lost native material data`):
  - In `backend/postprocess/pipeline.py`, AutoRetopo is now skipped if `native_textures` is true, recording an explicit skip reason in `retopo_stats`.
  - Added a defensive fallback in `run_optimize`: if optimization drops native textures, the pipeline retains the `repaired` mesh rather than raising an unhandled exception.
  - In `features/workspace/Panels/GeneratePanel.tsx`, disabled the quad topology option when a textured model is chosen (`Quads (raw only)`).
  - In `features/workspace/store/WorkspaceContext.tsx`, added live polling against `/api/v1/system/jobs/{job_id}` for active jobs so status transitions (`failed`, `completed`, `interrupted`) and real-time step messages immediately propagate to the pipeline execution panel.

## 2026-10-01 Butter-Smooth Viewport & Real-Time Cursor Reticle
- Replaced React state `brushPointer` with direct DOM ref `translate3d` tracking (`will-change-transform`), eliminating re-renders on mousemove and removing the 75ms CSS transition lag.
- Integrated vector tool icons directly into the center reticle dot and badge for real-time cursor feedback.
- Optimized the sculpt deformation loop with squared-distance thresholding and eliminated intermediate object allocations.

## 2026-10-01 Hugeicons Standardization & Type System Remediation
- Remediated 47 TypeScript compilation errors across 11 files after migrating from `lucide-react` to `@hugeicons/react` and `@hugeicons/core-free-icons`.
- Replaced direct JSX rendering of `IconSvgObject` definitions with `<HugeiconsIcon icon={...} />` wrappers across admin tabs (`QueueTab`, `RuntimeTab`, `StorageTab`, `SettingsTab`).
- Fixed MetricCard icon prop contract across tabs to accept valid ReactNodes (`<HugeiconsIcon icon={...} size={16} className="..." />`).
- Reverted unintentional `THREE.Bone` -> `THREE.BoneIcon` replacement in `MeshViewer.tsx`.
- Restored `components/icons/hugeicons-mapping.ts` providing legacy lucide-to-hugeicons lookup reference.
- Verified 100% clean type-checking with `npx tsc --noEmit` and production build with `npm run build`.

## 2026-09-30 README Overhaul & Commercial SaaS License Boundary
- Eliminated all "#1" and "alternative of Tripo" claims; positioned ForMash3D respectfully as inspired by Tripo AI and Meshy workflows.
- Restyled Mermaid architecture diagram with vibrant Studio Gold theme, high-contrast dark/light mode compatibility, and strict node-to-node links.
- Documented 3DGenStudio port provenance in post-processing with Community License terms.
- Added explicit advisory: Apache 2.0 covers only ForMash3D core code; third-party neural model weights and 3DGenStudio have non-commercial and SaaS-hosting restrictions.

## 2026-09-30 Master Plan v2.1 Verification & Adapter Hardening
- Hunyuan octree extraction resolutions clamped to upstream range [64, 512] across shape, mini-turbo, and paint adapters.
- Fixed path string division syntax and changed thirdparty sys.path inserts to appends to prevent package shadowing.
- Guarded TRELLIS.2 GLB export against None/non-positive decimation targets by falling back safely to generated face count.
- Hardened PyMeshLab texture decimation in `simplify.py` with strict UV checks, texture image retention, and seamless fallback to passthrough on decimation failure.
- Cleaned legacy merge conflict artifact in TRELLIS `app_text.py` and brought backend compilation to 100% clean across all modules.
- Reworked public documentation to use a concise product-first structure, removed raw Schema.org markup from README rendering, and aligned project metadata with the actual self-hosted/open-source scope.
- Upgraded test suite coverage: wrapped `test_torchmcubes_scatter_fix.py` for pytest discovery; 25 tests passing cleanly across all backend suites.

## 2026-09-30 Deep Quality Audit — Second Gap Closure
- Found and fixed a real post-processing crash: normal jobs with Physics disabled could reference uninitialized `collision_stats` when writing `quality_report.json`.
- Tightened native-texture detection so UV-only `TextureVisuals` are not mistaken for actual texture payloads. This prevents raw meshes from incorrectly skipping AutoUV/using the textured optimizer.
- Changed the AutoRetopo trigger to use the largest connected boundary component rather than the total boundary-edge count, matching the per-hole repair threshold semantics.
- FastMesh was audited end-to-end: its V1K/V4K output is fixed by variant, while the UI/API previously exposed arbitrary poly budgets and silently ignored them. The UI now exposes the real V1K/V4K contract and tri/quad output selection; the API passes `poly_type`, and the adapter rejects unsupported arbitrary targets instead of silently ignoring them.
- Quality reports now carry stage snapshots for source, repaired, optimized, and game-ready geometry, alongside the existing source hash, topology/QA, texture state, and per-LOD metadata.
- GPU/model runtime validation remains external because the current container cannot resolve GitHub or provide the production NVIDIA runtime.

## 2026-09-30 Quality & Detail Restoration Audit
- The generation-to-post-processing quality boundary is now explicit: model-native output is preserved as immutable `master/source.glb`, and quality investigations compare source vs repaired/optimized/LOD artifacts before attributing loss to post-processing.
- Hunyuan frontend quality mapping now stays within the documented `octree_resolution` ceiling (Ultra/High 512, Medium 384, Low 256); the previous 640 Ultra value was removed.
- TRELLIS.2 raw export no longer relies on `decimation_target=-1` being an upstream no-op; the integration converts non-positive raw targets to the generated face count before GLB export.
- Textured meshes now use PyMeshLab's texture-aware decimator and reconstruct per-wedge UVs/materials after topology changes. Conditional AutoRetopo is used only for large structural boundary defects on untextured AI-generated assets.
- AutoUV normal rebuilding defaults to 60° and AutoRetopo defaults to lower smoothing with feature preservation. Quality metadata records source hash, retopo status, texture status, and per-LOD UV/material preservation.
- Frontend generation controls that had no backend consumer for detail/UV toggles were removed instead of being left as misleading no-op settings.
- Local container clone was blocked by GitHub DNS in this environment; static code verification was performed from the exact latest `main` source via the GitHub repository integration. GPU/CUDA/real-model validation remains a required external step.
 
## 2026-09-29 Production Post-Processing Integration
- Successful mesh-generation jobs now run post-processing automatically.
- Raw output is preserved byte-for-byte at backend/storage/models/<asset_name>_<job_hash>/master/source.glb.
- game_ready/ is the default user-facing deliverable; LOD, collision, textures, previews, and metadata are sibling artifact groups.
- ZIP export is generated on demand from the full canonical workspace.
- 3DGenStudio source is ported under backend/postprocess/ with upstream attribution/license preserved.
- Fresh GPU/end-to-end validation remains required because the current development environment has no production NVIDIA runtime.

## 2026-09-29 Tripo & Cross-Model Quality Audit
- TripoSG was passing a PIL image into upstream prepare_image(), but that function calls os.path.isfile() and therefore requires a path-like input. This was a runtime blocker, not a model-quality issue.
- TripoSR applied the upstream display-orientation transform and then added a second X-axis -90° rotation. The second transform could rotate the exported asset incorrectly in the Y-up Three.js viewer.
- The shared workspace request used octree_resolution, while TripoSR expects mc_resolution, TripoSF expects resolution, PartPacker expects grid_resolution, and UltraShape expects octree_res. Those adapters were therefore falling back to lower-resolution defaults.
- PartPacker was decimating generated geometry to 50K faces by default, and TRELLIS.2 enabled remeshing by default. Both now preserve raw output unless optimization is explicitly requested.
- TripoSF low-VRAM pruning remains active below 16GB GPUs because removing it can exceed the memory budget; this is an explicit quality/memory trade-off, not accidental decimation.
- Fresh GPU validation is still required after these changes.

## 2026-09-29 Runtime Syntax Finding — BaseModel Import
- The multi-worker backend failed during startup because `backend/core/models/base.py` used double quotes inside a double-quoted f-string expression (`else "cpu"`), which is invalid Python syntax.
- The logging expression now uses a single-quoted `cpu` literal inside the f-string expression. A fresh runtime syntax sweep is still required in Colab.

## 2026-09-29 Raw-Geometry Quality Findings — Generation vs Post-Processing
- The GeneratePanel was sending `target_polycount` together with `auto_optimize: true`; TripoSG and TRELLIS interpreted that as permission to decimate model output before the raw asset reached downstream tools.
- TRELLIS also ran its visibility/hole postprocess during normal generation, which can remove low-visibility faces. Raw-generation mode now preserves the native triangle mesh and skips that destructive cleanup.
- The topology selector does not change the AI decoder's face primitive. Raw model extraction remains triangle-based; quad conversion is a retopology/post-processing task and is kept separate from raw geometry preservation.
- Fresh GPU validation is still required after this change.

## 2026-09-29 Runtime Findings — Colab Generation and Frontend Stability
- TRELLIS image-to-textured-mesh reached generation success, GLB export, and scheduler completion. The subsequent thumbnail step failed in pyrender with `Cannot connect to "None"`, isolating that failure to headless thumbnail rendering.
- TripoSR failed because `trimesh` was referenced but not imported in the orientation path.
- TripoSG failed before inference because the standard image preprocessing path passed a filesystem path into `prepare_image()`, which then reached a tensor-only `permute` call with a string.
- Shared model lifecycle logs now include load, inference, unload, elapsed time, GPU id, and CUDA memory telemetry; worker jobs honor `AUTO_UNLOAD_AFTER_JOB` after success or failure.

## 2026-09-28 Runtime Findings — TripoSR Axis and TRELLIS Rasterizer Compatibility

- The uploaded TripoSR screenshot is consistent with a coordinate-system mismatch: the generated asset's Z dimension is larger than Y while the ForMash3D viewport treats Y as up. The TripoSR adapter now applies one additional X-axis -90° rotation after the upstream Gradio orientation so exported meshes are Y-up in the ForMash3D viewport.
- TRELLIS postprocessing failed after successful sampling because `GaussianRasterizationSettings` rejected `kernel_size`. The installer was allowing a generic local `diff_gaussian_rasterization` wheel to override the mip-splatting renderer expected by the bundled TRELLIS code. The installer now removes that generic package and installs the renderer directly from the mip-splatting source.
- These fixes are source-level; fresh Colab validation is still required.

## 2026-09-28 Colab Runtime Findings — Attention Backend and Tripo Dependencies

- TRELLIS reached sampling, then failed because the pre-Ampere adapter selection requested SDPA while bundled sparse attention still routed to FlashAttention. Full, serialized, and windowed sparse attention now have direct PyTorch SDPA paths.
- TripoSF accepted SDPA at the sparse-environment layer, but full/serialized attention imports rejected it. Those modules now accept SDPA and execute segmented attention through PyTorch SDPA.
- TripoSG declares diffusers 0.30.3 while the global baseline pins 0.24.0; the installer now re-applies TripoSG requirements after the global baseline.
- The supplied viewport screenshot was reviewed for the rough/tilted TripoSG result. No model-specific rotation or quality transform was found in the adapter path, and no arbitrary geometry fix was added without a reproducible runtime cause.
- GPU inference was not rerun after these changes; fresh Colab validation is still required.

# Project Memory — ForMash 3D

> **Version**: 0.1.0
> **Last Updated**: September 2026
> **Status**: Active development

---

## Current Status

ForMash 3D is in active development. The core architecture is complete with 23 model configurations across the current model catalog, full frontend UI, and comprehensive backend API. The Hunyuan3D-Paint-v2-1 pipeline has been fully integrated and audited.

## Completed

### Backend
- Current model adapter registry implemented with lazy loading
- VRAM-aware multiprocess scheduler with GPU mutual exclusion
- Redis job queue for multi-worker mode
- All API routers (system, file-upload, mesh-generation, mesh-editing, auto-rigging, segmentation, retopology, UV, motion)
- ORJSONResponse with graceful fallback
- GZipMiddleware, SSE streaming
- Install script with all dependencies
- Download models script with verification

### Frontend
- Next.js 16 App Router with all routes
- 3D Viewport with Three.js / R3F
- Workspace Shell with tabbed panels
- GeneratePanel with model selector, FlashVDM toggle, VRAM stats, plus a compact Advanced Generation drawer for Physics/quality controls
- MeshViewer includes a top quick-tool rail with Test Physics and an opt-in mirror/detail inspection peek
- TexturePanel with PBR controls and systemStats
- All workspace panels (Remesh, UV, Segment, Edit, Animation, Jobs)
- Zustand stores, TanStack Query, unified apiClient
- Studio gold design system with dark theme

### Paint-v2-1 Pipeline
- Hunyuan3D-Paint-v2-1 adapter with RealESRGAN x4+
- DifferentiableRenderer for PBR validation
- Shape→Paint automatic chaining
- Configurable texture resolution (512/768), max views (6-12)
- VRAM status tracking
- FlashVDM toggle
- Dockerfile Paint DifferentiableRenderer build fix

### Audit & Hardening
- Audit Pass 1: 18 fixes completed
- Audit Pass 2: Deep scan of 1080 third-party files
- All bare `except:` clauses fixed in project code
- All adapters import cleanly (verified by test suite)

### Documentation
- README.md fully updated with Paint-v2-1 info, model catalog, and documentation index
- CHANGELOG.md with last 3 changes only (Paint Audit, Third-Party Migration, Workspace Layout)
- ARCHITECTURE.md, PRD.md, DESIGN.md, TASKS.md, DECISIONS.md, MEMORY.md, SECURITY.md, SYSTEM-BLUEPRINT.md created in `Docs/`
- RULES.md created from AGENTS.md with extended ForMash3D-specific rules
- All docs in `Docs/` directory (uppercase)
- `docs/` (lowercase) directory removed
- `backup/` directory deleted
- `TEST_PLAN.md` deleted

### Git & Commits
- Previous audit history remains on `main`.
- Current Deep Runtime Contract Audit is prepared on `fix/deep-audit-runtime-contracts`.
- `TODO_AUDIT.md` remains excluded from git commits.

## Current Task

Deep Runtime Contract Audit completed on the current Hunyuan3D integration:
- Removed the non-functional direct Shape textured model registration.
- Enabled the Mini Turbo → Paint optional auto-chain when texture generation is requested.
- Fixed Shape→Paint file-ID and image-input handoff.
- Fixed in-progress job progress normalization in Admin Jobs.
- Fixed invalid API model defaults.
- Fixed release-wheel partial-cache detection.
- Aligned environment defaults with the documented Conda runtime.
- Corrected Docker helper API port output.
- Made verification clients exercise FastAPI lifespan startup/shutdown.
- Corrected dead RGB/background-removal branches in project-owned Hunyuan helpers.

## Known Issues

1. **No GPU environment available for runtime testing**: Paint adapter functionality, RealESRGAN native renderer build, real Paint inference, and Shape→Paint auto-chaining still require GPU verification.
2. **Full backend end-to-end coverage remains broader than the post-processing suite**: post-processing dependency, Blender runtime, canonical storage, and opt-in real-mesh fixture coverage now exist in `backend/tests/test_postprocess_e2e.py`.
3. **`POST /api/v1/project/export` does not exist**: Asset delivery is handled through existing file upload/download and storage routes.
4. **Colab scripts incomplete**: Only `scripts/colab.sh` exists; dedicated start/stop helpers are not implemented.
5. **P3-SAM installer path**: installer now tolerates the absent legacy `Hunyuan3DPart/P3SAM` checkout and installs P3-SAM runtime dependencies without requiring that source path.
6. **Hunyuan runtime ABI**: Hunyuan shared dependencies pin NumPy 1.26.4 and CuPy 13.4.0 to keep the CUDA 12.4/Python 3.10 CuPy binary ABI aligned.
7. **Workspace model selection**: GeneratePanel no longer auto-ranks TRELLIS and overwrite the user-selected model.

## Next Step

### Completed in Master Plan v2.1 Verification
1. Clamped Hunyuan octree extraction resolution to upstream range [64, 512].
2. Fixed string path division syntax and thirdparty sys.path shadowing in Hunyuan adapters.
3. Guarded TRELLIS.2 GLB export against None/non-positive decimation targets.
4. Hardened PyMeshLab texture decimation in `simplify.py` with UV integrity checks and safe passthrough fallback.
5. Resolved merge conflict artifact in TRELLIS `app_text.py` (100% clean compilation via `compileall`).
6. Verified `runTextureGeneration` uses `textureSettings` dependency array covering all parameters.
7. Verified `supportsFlashVDM` model scoping and `TexturePanel.tsx` VRAM status checks.
8. Verified full backend test suite: 25 passed across all unit/regression test suites.

### Testing (GPU-dependent)
1. If GPU becomes available: test Paint adapter import, Real-ESRGAN build, real Paint inference.
2. Run `bash backend/scripts/install.sh` to verify installer builds all Paint dependencies.
3. Verify `backend/scripts/download_models.sh` correctly copies RealESRGAN to thirdparty location.

### Features
9. Cloudflare tunneling for remote access
10. DCC Bridge (Blender, Unreal, Unity, Maya)
11. Advanced animation studio with timeline
12. CI/CD pipeline with GitHub Actions

## Environment

- **Python**: 3.10.x via Conda env `3daigc-api`
- **PyTorch**: 2.6.0 + CUDA 12.4
- **Frontend**: Next.js 16, React 19, TypeScript, Bun
- **GPU**: NVIDIA with CUDA 12.4 capability (not available in current environment)
- **Runtime**: Linux (Ubuntu 20.04/22.04/24.04)

## Key Files

- `backend/adapters/__init__.py` — Lazy model adapter registry
- `backend/config/models.yaml` — 23 model configurations
- `backend/config/system.yaml` — System settings
- `backend/scripts/install.sh` — Primary setup script
- `backend/scripts/download_models.sh` — Model download script
- `backend/Dockerfile` — Docker image build (needs Paint DifferentiableRenderer fix)
- `backend/adapters/hunyuan3d_paint_v21.py` — Paint-v2-1 adapter
- `backend/adapters/hunyuan3d_shape_v21.py` — Shape-v2-1 adapter
- `backend/adapters/hunyuan3d_dit_v2_mini_turbo.py` — DiT-v2-mini-Turbo adapter
- `Docs/` — All project documentation
- `RULES.md` — Agent rules and development guidelines

## Notable Patterns

- **Lazy adapter loading**: All adapters use `__getattr__` in `__init__.py` for lazy imports
- **VRAM-aware scheduling**: `VRAM_SAFETY_MARGIN_MB=1024`, `AUTO_UNLOAD_AFTER_JOB=true`
- **Source asset immutability**: `source.glb` is never modified
- **HSL design tokens**: All colors use HSL CSS variables, no hex literals
- **Studio gold accent**: `#FFCC00` (`48 100% 50%`) as primary
- **Bun for frontend, Conda for backend**: Separate package managers
- **SSE for progress**: Server-Sent Events for real-time generation updates
- **ORJSON with fallback**: Fast JSON serialization with graceful degradation

## Physics integration
- Physics is opt-in and reuses `generateCollision` as the single generation intent flag.
- Normal post-processing still generates the collision artifact when Physics is off; Physics controls physics readiness/metadata and collision quality.
- Enabled jobs write `metadata/physics.json` and expose `physics_json` through the protected artifact download route.
- Frontend camelCase and API snake_case physics keys are normalized to one bounded backend contract.
- Browser preview uses pinned Rapier `0.19.3`; no additional AI model or generation VRAM is required.
- Viewer physics binds only after the current asset finishes loading and is disposed during reloads.
- Auto-generated mass is now applied as the canonical rigid-body mass; collider density does not overwrite it.
- Shape→Paint auto-chain skips physics on the intermediate Shape result and prepares it only on final output.
- Full GPU/Colab inference validation remains outstanding.

- 2026-09-29: execution telemetry baseline now uses real backend stage logs, adaptive visibility-aware polling, truthful cancellation, and artifact-driven segmentation metadata; client-side sample mesh statistics are no longer treated as factual.

## 2026-09-30 Review Audit Hardening

- Redis priority/state/TTL contracts were corrected.
- SQLite persistence no longer performs synchronous writes directly on async scheduling paths.
- Processing jobs are recovered after restart; timeout/cancel terminate workers before finalization.
- Client filesystem inputs and upload/base64 memory are bounded.
- GLB L1 cache hydration and streaming now respect the existing memory budget.
- FastMesh V1K/V4K selection is explicit.
- GPU inference, stress testing, and remaining frontend multi-job/multiview runtime behavior still require target-environment validation.

## 2026-09-30 Review Audit Second Pass
- Raw inference completion is decoupled from production post-processing; background status is preserved on completed jobs.
- Workspace generation state is keyed by backend job ID and additional generations are not UI-blocked by an existing active job.
- Text batches now carry a scheduler-enforced max_parallel limit.
- Redis progress telemetry uses hot hashes and terminal cleanup uses a completion-time index.

## 2026-09-30 Review Audit Final Gap Pass

- Backend model manifest is now authoritative for runtime readiness/capabilities/VRAM.
- FastMesh variant propagation is explicit.
- UltraShape/P3-SAM/PartUV runtime defaults were hardened.
- Text batch state now reaches the real scheduler-backed batch endpoint.
- Native artifact naming and asset manifests are collision-safe and reproducible.
- Multiview is explicitly disabled until a real backend contract exists.
- Raw generation and production post-processing are separate lifecycle stages.
- Testing and target-GPU stress remain environment-dependent verification steps.


## 2026-09-30 Final Non-Testing Audit State
- Review branch finalization must retain exactly two implementation commits from the audited baseline; this pass is folded into the recreated second commit.
- Docker/RunPod dependency paths now resolve under `/app/backend`, with current release-wheel URLs rather than removed repository wheel paths.
- Scheduler raw completion and production post-processing are separate lifecycle states; request temp inputs survive until post-process lineage metadata is written.
- Adapter VRAM is manifest-only and remaining repository/model paths are CWD-independent; UUID naming closes timestamp collision windows.
- Frontend uses backend model capabilities for routing, treats QA scores as 0–100, and refreshes the same asset when post-processing completes or fails.
- Tests/build/GPU stress/load validation remain intentionally unrun in this pass.


## 2026-10-02 Deep Bug Closure
- Canonical asset roots are persisted before production post-processing so failed processing remains retryable from immutable `master/source.glb`.
- Shape→Paint child jobs inherit target polycount, LOD, and topology settings from the parent workflow.
- Optional export failures are explicit `failed` artifact states with error messages.
- Final QA uses the same resolved production triangle budget as optimization.
- Retention cleanup removes canonical asset workspaces before terminal job history is deleted.
- Multi-worker file metadata follows `FILE_METADATA_TTL_SECONDS` instead of a hidden 24-hour override.
- System status reports mesh-tools readiness instead of hard-coding success.
- GPU/end-to-end verification still requires the supported target runtime.


## Verification Status — 2026-10-02
The latest deep-audit fixes are source-level. Full compile, frontend build/lint/typecheck, and supported-GPU end-to-end verification must be rerun after this commit; older dated entries above describe earlier verification runs and are not evidence for this new commit.
