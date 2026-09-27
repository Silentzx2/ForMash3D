# ForMash 3D — Changelog

All notable changes, architectural updates, and feature implementations for ForMash 3D are documented in this file.

---

## [Unreleased]

### 📝 Documentation Reorganization & Extension (2026-09-27)
- Reorganized all documentation into `Docs/` directory (uppercase).
- Created `Docs/PRD.md`, `Docs/ARCHITECTURE.md`, `Docs/DESIGN.md`, `Docs/RULES.md`, `Docs/TASKS.md`, `Docs/DECISIONS.md`, `Docs/MEMORY.md`, `Docs/SECURITY.md`, `Docs/SYSTEM-BLUEPRINT.md`.
- Renamed `AGENTS.md` to `RULES.md` with extended ForMash3D-specific rules.
- Added flow charts and proper sections to all documentation files.
- Updated `README.md` with complete documentation index and current project state.
- Updated `RULES.md` with rules requiring doc updates after every change.
- Deleted `TEST_PLAN.md` and `backup/` directory.

### 🎨 Hunyuan3D-Paint-v2-1 Pipeline Audit & Full Integration (2026-09-27)
- **Paint-v2-1 Pipeline Verification & Audit Pass 1 (18 fixes)**:
  - Moved `isFlashVDMModel` to component scope in `GeneratePanel.tsx`; added `Zap` import and `supports_flashvdm` to `DiscoveredModel`.
  - Updated all model IDs to `hunyuan3d_shape_v21_*` and added `hunyuan3d_dit_v2_mini_turbo_image_to_raw_mesh`.
  - Added FlashVDM toggle button to the Generate Panel for models supporting flash-decoupled video diffusion.
  - Added `systemStats` to `TexturePanel.tsx` for real-time VRAM and system monitoring.
  - Fixed `isPaintModel` to include `paint_v21` model ID for correct Paint model detection.
  - Fixed `let` declarations in `WorkspaceContext.tsx` for proper variable scoping.
  - Replaced `logger.info()` with `console.log()` in adapter code for consistent logging.
  - Added `paintResolution` to `GenerationSettings` for texture resolution control (512/768).
  - Removed deprecated `baseUrl` from `tsconfig.json`.
  - Changed bare `except:` → `except Exception:` in `partfield_utils.py`, `thumbnail_utils.py`, `multiprocess_scheduler.py`.
  - Added `resolution` to `image_mesh_painting` job inputs for Paint-v2-1 pipeline compatibility.
  - Added RealESRGAN and DifferentiableRenderer verification to `install.sh`, `download_models.sh`, `system.py`, `model_factory.py`.
  - Added `_resolve_realesrgan_path()`, `get_vram_status()`, `_verify_pbr_output()` to `hunyuan3d_paint_v21.py` adapter.
- **Paint-v2-1 Pipeline Audit Pass 2 (Deep Scan)**:
  - Scanned 1080 third-party Python files for bare `except:` clauses and compatibility issues.
  - Fixed bare `except:` → `except ImportError:` in both `MeshRender.py` files.
  - Fixed `compile_mesh_painter.sh` portability (`python` → `python3`).
  - Created missing `__init__.py` files for `hy3dpaint` and `hy3dshape` in both paint and shape models.
  - Fixed bare `except:` in `surface_extractors.py` (`ImportError`), `integrators.py` (`KeyError`), `render.py` (`Exception`), `watertight_and_sample.py` (`Exception`), `train.py` (`Exception`).
- **Dockerfile Paint DifferentiableRenderer Build Fix**:
  - Identified that `backend/Dockerfile` builds DifferentiableRenderer for `Hunyuan3D-2.1` (shape model) but NOT for `hunyuan3d-paint-v2-1` (Paint model).
  - `compile_mesh_painter.sh` exists at `/app/thirdparty/hunyuan3d-paint-v2-1/hy3dpaint/DifferentiableRenderer/` but was never executed in the Dockerfile.
  - `install.sh` does build it (lines 523-534); Dockerfile needs corresponding Paint model build step.

### 🔧 Third-Party Source Code Migration
- **ForMash3D-thirdparty Repository**: Cloned `https://github.com/Silentzx2/ForMash3D-thirdparty` into `backend/thirdparty/`. All third-party model source code (TRELLIS, TRELLIS.2, TripoSF, TripoSG, TripoSR, UltraShape, UniRig, VoxHammer, FastMesh, Hunyuan3D-Shape-v2-1, Hunyuan3D-Paint-v2-1, Hunyuan3D-DiT-v2-mini-Turbo, PartField, PartPacker, PartUV, ardy) is now tracked as part of the main ForMash3D repository. The `wheels/` directory is excluded via `backend/.gitignore`.

---

## Versioning

This project follows [Semantic Versioning](https://semver.org/).
