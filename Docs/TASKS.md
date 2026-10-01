# Tasks — ForMash 3D

> **Version**: 0.1.0
> **Status**: Active development
> **Last Updated**: September 2026

---

## ✅ Completed

### Backend
- [x] Current model adapter registry implemented and lazily loaded from `backend/adapters/__init__.py`
- [x] 23 model configurations in `backend/config/models.yaml`
- [x] VRAM-aware multiprocess scheduler with GPU mutual exclusion
- [x] Redis job queue for multi-worker mode
- [x] GPU monitor with VRAM/temperature polling
- [x] All API routers (system, file-upload, mesh-generation, mesh-editing, auto-rigging, segmentation, retopology, UV, motion)
- [x] ORJSONResponse with graceful fallback
- [x] GZipMiddleware, SSE streaming
- [x] Install script with all dependencies
- [x] Download models script with verification
- [x] Hunyuan3D-Paint-v2-1 adapter with RealESRGAN x4+
- [x] DifferentiableRenderer for PBR validation
- [x] Shape→Paint automatic chaining
- [x] FlashVDM toggle button
- [x] Dockerfile Paint DifferentiableRenderer build fix
- [x] All bare `except:` clauses fixed in project code
- [x] Current adapters import cleanly (verified by test suite)

### Runtime Contract Audit
- [x] Remove non-functional direct Hunyuan Shape textured model registration
- [x] Fix Shape/Mini Turbo → Paint generated mesh file-ID handoff
- [x] Fix Shape/Mini Turbo → Paint reference image input handoff
- [x] Fix invalid mesh-generation API model defaults
- [x] Normalize Admin Jobs progress from backend fraction to UI percentage
- [x] Fix partial release-wheel cache detection
- [x] Align environment defaults with documented Conda runtime
- [x] Correct Docker helper API port output
- [x] Make verification scripts exercise FastAPI lifespan
- [x] Fix dead RGB/background-removal branches in project-owned Hunyuan helpers

### Frontend & Studios
- [x] Next.js 16 App Router with all routes
- [x] 3D Viewport with Three.js / R3F (continuous background MeshViewer preserved)
- [x] Workspace Shell with unified left navigation rail and right property inspector
- [x] VFX Studio (`VfxStudio.tsx`, `/vfx`) with live 3D particle simulation viewport dock, HUD telemetry, and React Flow board
- [x] Procedural Tree Studio (`TreeStudio.tsx`, `/trees`) with live branch polyline preview, species presets, dice roll seed, and full mesh build
- [x] Procedural Building Studio (`BuildingStudio.tsx`, `/buildings`) with tabbed 2D footprint plan, 3D viewport, grammar inspector, and stylepacks
- [x] Character Assembly Studio (`AssemblyStudio.tsx`, `/assembly`) with multi-mesh kitbashing, conformal garment fit, and landmark alignment
- [x] Interactive Sculpt Brushes tab in `MeshEditPanel.tsx` (7 brushes, bilateral symmetry, stroke stabilizer, and falloff)
- [x] Interactive 3D Surface Paint tab in `TexturePanel.tsx` (drawing/erasing, color swatches, opacity, flow, tip profiles, and GPU texture bake)
- [x] Instant mesh file upload in `RemeshPanel.tsx`, `UVUnwrapPanel.tsx`, and `MeshSegmentPanel.tsx`
- [x] Two-Way PostProcess Pipeline (automatic AI generation chaining in scheduler + manual user panel triggers)
- [x] Standalone PostProcess microservice on port 8200 (`scripts/start_postprocess_service.sh`)
- [x] Cross-module import resolution matrix and compatibility symlinks (`features/utils/`, `features/config.js`)
- [x] GeneratePanel with model selector, FlashVDM toggle, VRAM stats
- [x] TexturePanel with PBR controls and systemStats
- [x] All workspace panels (Remesh, UV, Segment, Edit, Animation, Jobs)
- [x] Zustand stores, TanStack Query, unified apiClient
- [x] Studio gold design system with dark theme

### Documentation
- [x] README.md fully updated with Paint-v2-1 info, model catalog, and documentation index
- [x] CHANGELOG.md maintained as chronological project history
- [x] ARCHITECTURE.md with Paint-v2-1 pipeline details and flow charts
- [x] PRD.md with product requirements and flow charts
- [x] DESIGN.md with UI design system, flow charts, and component reference
- [x] RULES.md from AGENTS.md with extended ForMash3D-specific rules and doc update policy
- [x] TASKS.md with clear project task list
- [x] DECISIONS.md with architecture decisions (ADR-001 through ADR-018)
- [x] MEMORY.md with project current state and known issues
- [x] SECURITY.md with security requirements
- [x] SYSTEM-BLUEPRINT.md with complete system architecture
- [x] All docs in `Docs/` directory (uppercase)
- [x] `docs/` (lowercase) directory removed
- [x] `backup/` directory deleted
- [x] `TEST_PLAN.md` deleted

### Audit & Hardening
- [x] Audit Pass 1: 18 fixes
- [x] Audit Pass 2: Deep scan of 1080 third-party Python files
- [x] All adapters import cleanly
- [x] TripoSF/TripoSG/TripoSR compatibility fixes
- [x] Hunyuan3D-2.1 OOM crash fix
- [x] TRELLIS FlashAttention pre-Ampere GPU compatibility

### Git & Commits
- [x] Previous audit changes committed to `main`
- [x] `TODO_AUDIT.md` excluded from git commits
- [x] 625+ files committed in single commit

---

## 🔜 Future Work

### Quality Master Plan v2.1 Verification & Documentation Hardening
- [x] Clamp Hunyuan extraction octree resolution to upstream contract range [64, 512]
- [x] Guard TRELLIS.2 GLB export against None/non-positive decimation targets
- [x] Harden PyMeshLab texture decimation in `simplify.py` with UV integrity checks and safe passthrough fallback
- [x] Remove dead frontend detail fields from generation request payload
- [x] Fix thirdparty sys.path shadowing and path string division syntax in Hunyuan adapters
- [x] Fix merge conflict syntax error in TRELLIS `app_text.py`
- [x] Verify `runTextureGeneration` dependency array covers all texture settings
- [x] Verify `supportsFlashVDM` model scoping and `TexturePanel.tsx` VRAM status checks
- [x] Verify all shell scripts pass `bash -n`
- [x] Verify `python3 -m compileall` across entire backend passes with 0 errors
- [x] Verify full backend test suite with 25 passing tests
- [x] Redesign architecture & pipeline diagrams with Studio Gold theme (`#FFCC00`)
- [x] Optimize repository SEO and discoverability (Tripo AI & Meshy comparison, Schema.org JSON-LD, topics metadata)
- [x] Synchronize all project docs (`Docs/ARCHITECTURE.md`, `Docs/DESIGN.md`, `Docs/PRD.md`, `Docs/DECISIONS.md`, `Docs/MEMORY.md`, `Docs/SYSTEM-BLUEPRINT.md`)

### Critical
- [ ] If GPU becomes available: test Paint adapter import, Real-ESRGAN build, real Paint inference
- [ ] Run `bash backend/scripts/install.sh` to verify installer builds all Paint dependencies
- [ ] Verify `backend/scripts/download_models.sh` correctly copies RealESRGAN to thirdparty location

### Features
- [ ] Cloudflare tunneling for remote access
- [ ] DCC Bridge (Blender, Unreal, Unity, Maya)
- [ ] Advanced animation studio with timeline
- [ ] Model-specific fine-tuning UI
- [ ] Batch generation queue management
- [ ] CI/CD pipeline with GitHub Actions
- [ ] Performance benchmarking suite
- [ ] Mobile-responsive PWA support

### Documentation Maintenance
- [ ] After every code change, update all relevant .md documentation files
- [ ] Keep CHANGELOG.md to last 3 changes only
- [ ] Keep RULES.md synchronized with actual project state
- [ ] Keep MEMORY.md updated with current status

## Completed — Production Post-Processing Integration
- Ported the 3DGenStudio post-processing engine into backend/postprocess/.
- Wired automatic post-processing into successful raw mesh-generation jobs.
- Added canonical per-generation asset workspaces and protected artifact/ZIP delivery.
- Updated UI export behavior to prefer game-ready artifacts.
- Added post-processing dependencies under a dedicated backend/requirements.txt header.

## Physics integration status
- [x] Add opt-in Physics generation intent using the existing collision flag path
- [x] Add pre-generation Physics controller
- [x] Reuse existing collision service with Fast/Balanced/Precise presets
- [x] Add canonical `physics.json` metadata and artifact delivery
- [x] Add browser rigid-body viewer runtime and debug/test controls
- [x] Harden physics asset-load lifecycle, canonical mass application, and lockfile reproducibility
- [x] Add physics unit coverage
- [ ] GPU/Colab end-to-end verification
- [ ] Capability-gated soft-body/jiggle implementation when a real deformable requirement is justified
- [x] Compact Advanced Generation drawer for Physics and mesh-quality controls
- [x] Top-of-viewport rigid-body smoke test with bounds-based fallback
- [x] Opt-in low-rate mirror/detail inspection peek with hover/focus zoom
- [ ] Target-specific physics exporters only after tested mappings exist

- [x] Make generation pipeline telemetry stage-aware, ETA-aware, and artifact-aware without fake progress.
- [x] Fix queued-job cancellation to preserve job history and use the scheduler cancellation contract.
- [x] Remove fabricated uploaded/segmentation/UV mesh statistics.
- [x] Make Jobs polling visibility-aware and selected-job telemetry live.
- [x] Make segmentation inspector artifact-driven and wire segmented GLB download.

## Review Audit Hardening — 2026-09-30

Completed in this pass:
- Redis priority ordering, failure/cancellation semantics, and result TTL storage corrected.
- Processing jobs are recovered after backend restart.
- Scheduler timeout/cancel paths stop the owning worker before terminal state notification.
- SQLite persistence is dispatched off the async event loop.
- Queue metrics use the same canonical fields in single-worker and Redis modes.
- Client-supplied filesystem inputs are restricted to configured asset roots.
- Multipart/base64 input size limits are enforced during ingestion.
- GLB cache hydration and streaming respect the existing L1 memory budget.
- FastMesh V1K/V4K variants are explicit in models.yaml.
- Verification script syntax and the frontend test command are executable.
- Storage-side pagination is available for the SQLite-backed history path.

Still runtime-gated:
- GPU inference/load/stress validation.
- True multiview inference remains capability-dependent; the backend accepts only explicitly supported view contracts and does not silently collapse a multi-view request.

### Review Audit — Second Pass
- [x] Raw generation completes independently from production post-processing; postprocess status is tracked separately.
- [x] Workspace maintains independent job state by backend job ID and permits another generation while one is active.
- [x] Text batch endpoint submits independent jobs with scheduler-enforced `max_parallel`.
- [x] Redis progress/state hot fields no longer rewrite the full job document on every telemetry tick; terminal cleanup uses a time index.

## Review Audit — Deep Quality Gap Closure (2026-09-30)

Completed in the deep second pass:
- [x] Prevented normal post-processing jobs from referencing an uninitialized collision-stat object when Physics is disabled.
- [x] Native texture detection requires actual texture/image payload rather than UV presence alone.
- [x] AutoRetopo compares the largest boundary component against the per-hole repair threshold.
- [x] FastMesh V1K/V4K is exposed as a fixed variant contract; arbitrary target budgets are no longer presented as supported.
- [x] Retopology `poly_type` is forwarded end-to-end; incompatible FastMesh target requests are rejected.
- [x] Added source/repaired/optimized/game-ready quality snapshots to the quality report.
- [x] Added boundary-component and UV-only regression coverage.

Runtime-gated:
- [ ] NVIDIA/CUDA model inference and visual-quality validation.
- [ ] Full dependency/build validation in the unavailable cloned repository environment.

## Review Audit — Final Implementation Pass (2026-09-30)

Completed beyond the initial audit pass:
- [x] Backend model manifest now carries explicit capabilities and runtime readiness metadata.
- [x] Frontend model selection consumes backend readiness/VRAM data instead of assuming a GPU/24GB budget.
- [x] FastMesh V1K/V4K manifest parameters are propagated into adapter construction.
- [x] Adapter VRAM defaults for mismatched models are manifest-driven instead of silently invented.
- [x] P3-SAM/UltraShape CUDA requirements are explicit; CPU fallback is not advertised.
- [x] PartUV no longer silently substitutes a PartField checkpoint.
- [x] Native output filenames and model-specific artifact directories use collision-safe identifiers.
- [x] Physics collision generation is gated by the physics request.
- [x] LOD ratios respond to source face count/target polycount rather than one fixed universal chain.
- [x] Workspace batch queue is wired to the real text-generation batch API and scheduler max-parallel contract.
- [x] Redis and single-worker cancellation/error semantics expose the same terminal/error-code model.
- [x] Job manifests record asset lineage/reproducibility metadata including input hashes and generation settings.
- [x] GLB/blob/localStorage and stale Redis/FileStore cleanup boundaries are hardened.
- [x] Multiview is explicitly unavailable rather than silently reducing a multiview request to one image.

Testing/build/GPU stress verification remains intentionally outside this pass.

### Final Audit Gap Closure — 2026-09-30
- [x] Production Docker and RunPod dependency paths reconciled with backend repository layout and release wheels.
- [x] Async job-status/progress persistence bounded and non-blocking; terminal error codes remain durable.
- [x] Raw inference completion separated from background production post-processing with owned input cleanup and shutdown lifecycle.
- [x] Remaining model adapter paths and VRAM declarations reconciled with the canonical manifest; FastMesh/TRELLIS variants cannot override manifest VRAM.
- [x] Frontend post-processing state, QA score units, capability-based routing, L1 LRU accounting, and failure messaging synchronized with backend contracts.
- [ ] Runtime/GPU/test/build validation intentionally deferred for this review pass.
