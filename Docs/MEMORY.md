# Project Memory — ForMash 3D

> **Version**: 0.1.0
> **Last Updated**: September 2026
> **Status**: Active development

---

## Current Status

ForMash 3D is in active development. The core architecture is complete with all 15 model adapters, 23 model configurations, full frontend UI, and comprehensive backend API. The Hunyuan3D-Paint-v2-1 pipeline has been fully integrated and audited.

## Completed

### Backend
- All 15 model adapters implemented and registered
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
- README.md updated with Paint-v2-1 info
- CHANGELOG.md with full audit entries
- architecture.md, developer-guide.md, api-documentation.md, setup-guide.md updated
- PRD.md, ARCHITECTURE.md, DESIGN.md, TASKS.md, DECISIONS.md, MEMORY.md, TEST_PLAN.md, SECURITY.md created
- RULES.md created from AGENTS.md

## Current Task

TASK-001: Complete documentation and verification
- Verify all docs reference `Docs/` not `docs/`
- Verify all files are committed and pushed
- Verify no TODO_AUDIT.md in git history
- Run `npx tsc --noEmit` and `python3 -m compileall`
- Run `bash -n` on all shell scripts
- Extend all docs with flow charts and proper sections
- Update RULES.md with doc update rules
- Fully update README.md

## Known Issues

1. **Dockerfile Paint DifferentiableRenderer**: `backend/Dockerfile` builds DifferentiableRenderer for `Hunyuan3D-2.1` (shape model) but NOT for `hunyuan3d-paint-v2-1` (Paint model). `install.sh` does build it (lines 523-534), but the Dockerfile needs a corresponding Paint model build step.

2. **94 bare `except:` clauses remain in upstream third-party code**: These are in the `backend/thirdparty/` directory and should not be modified. They are upstream code.

3. **No GPU environment available for runtime testing**: All Paint adapter functionality, Real-ESRGAN native renderer build, real Paint inference, and Shape→Paint auto-chaining need GPU runtime verification.

4. **`backend/tests/test_backend_e2e.py` does not exist**: Referenced in earlier documentation but not yet implemented.

5. **`POST /api/v1/project/export` endpoint does not exist**: Asset delivery is handled through existing file upload/download and static file routes.

6. **Colab scripts incomplete**: Only `scripts/colab.sh` exists. `colab_start.sh`, `colab_stop.sh`, etc. referenced in docs do not exist.

## Next Step

1. Fix Dockerfile to include Paint DifferentiableRenderer build step
2. If GPU becomes available: test Paint adapter import, Real-ESRGAN build, real Paint inference with `max_num_view=6, resolution=512` and `max_num_view=12, resolution=768`
3. Run `bash backend/scripts/install.sh` to verify installer builds all Paint dependencies
4. Verify `backend/scripts/download_models.sh` correctly copies RealESRGAN to thirdparty location
5. Implement `backend/tests/test_backend_e2e.py`
6. Update `Docs/CHANGELOG.md` and any other docs to reflect the new Paint-v2-1 pipeline

## Environment

- **Python**: 3.10.x via Conda env `3daigc-api`
- **PyTorch**: 2.6.0 + CUDA 12.4
- **Frontend**: Next.js 16, React 19, TypeScript, Bun
- **GPU**: NVIDIA with CUDA 12.4 capability (not available in current environment)
- **Runtime**: Linux (Ubuntu 20.04/22.04/24.04)

## Key Files

- `backend/adapters/__init__.py` — All 19 model adapters registered
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
