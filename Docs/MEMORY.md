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
- GeneratePanel with model selector, FlashVDM toggle, VRAM stats
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

### Critical
1. Verify `runTextureGeneration` dependency array includes `generationSettings.maxNumView`, `generationSettings.resolution`, `generationSettings.generatePBR`
3. Add `supportsFlashVDM` to `isTexturePaintingModel` if needed
4. Verify `TexturePanel.tsx` `getTextureStatusInfo` checks VRAM status

### Testing
5. If GPU becomes available: test Paint adapter import, Real-ESRGAN build, real Paint inference
6. Run `bash backend/scripts/install.sh` to verify installer builds all Paint dependencies
7. Broaden `backend/tests/test_backend_e2e.py` only when full backend integration coverage is required; post-processing coverage is already separated into `backend/tests/test_postprocess_e2e.py`.
8. Run `npx tsc --noEmit` and `python3 -m compileall` for verification

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
