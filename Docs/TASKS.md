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

### Frontend
- [x] Next.js 16 App Router with all routes
- [x] 3D Viewport with Three.js / R3F
- [x] Workspace Shell with tabbed panels
- [x] GeneratePanel with model selector, FlashVDM toggle, VRAM stats
- [x] TexturePanel with PBR controls and systemStats
- [x] All workspace panels (Remesh, UV, Segment, Edit, Animation, Jobs)
- [x] Zustand stores, TanStack Query, unified apiClient
- [x] Studio gold design system with dark theme

### Documentation
- [x] README.md fully updated with Paint-v2-1 info, model catalog, and documentation index
- [x] CHANGELOG.md with last 3 changes only (Paint Audit, Third-Party Migration, Workspace Layout)
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

### Critical
- [ ] Verify `runTextureGeneration` dependency array includes `generationSettings.maxNumView`, `generationSettings.resolution`, `generationSettings.generatePBR`
- [ ] Add `supportsFlashVDM` to `isTexturePaintingModel` if needed
- [ ] Verify `TexturePanel.tsx` `getTextureStatusInfo` checks VRAM status

### Testing
- [ ] If GPU becomes available: test Paint adapter import, Real-ESRGAN build, real Paint inference
- [ ] Run `bash backend/scripts/install.sh` to verify installer builds all Paint dependencies
- [ ] Verify `backend/scripts/download_models.sh` correctly copies RealESRGAN to thirdparty location
- [ ] Implement `backend/tests/test_backend_e2e.py`
- [ ] Run `npx tsc --noEmit` and `python3 -m compileall` for verification
- [ ] Run `bash -n` on all shell scripts

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
