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

### 🔧 Hunyuan Unified Dependency Structure (2026-09-28)
- Created `backend/thirdparty/hunyuan-requirements.txt` as the single unified dependency file for all 3 Hunyuan models (Shape v2.1, Paint v2.1, DiT v2 Mini Turbo).
- Removed three model-specific `requirements.txt` files from `hunyuan3d-shape-v2-1/`, `hunyuan3d-paint-v2-1/`, and `hunyuan3d-dit-v2-mini-turbo/`. `backend/thirdparty/hunyuan-requirements.txt` is now the single source of truth. No `requirements.txt` files remain in model directories.
- Updated `backend/scripts/install.sh` to install `hunyuan-requirements.txt` exactly once before model-specific setup, removing three separate `requirements.txt` installs.
- Added `safetensors>=0.4.4` and `tqdm>=4.66.0` to `hunyuan-requirements.txt` — verified as imported by Hunyuan model source code (`safetensors.torch.load_file` in pipelines.py, `from tqdm import tqdm` in multiple files).
- Fixed `basicsr>=1.4.2` → `basicsr>=1.3.3.3` in `hunyuan-requirements.txt` — `basicsr==1.4.2` has no wheels for Python 3.10.
- **Packages moved to unified file**: `scipy`, `einops`, `pandas`, `tqdm`, `safetensors`, `imageio`, `rembg`, `pymeshlab`, `pygltflib`, `xatlas`, `omegaconf`, `configargparse`, `timm`, `torchdiffeq`, `cupy-cuda12x`, `onnxruntime`, `opencv-python`, `basicsr`, `torchmetrics`, `pythreejs`, `gradio`.
- **Packages intentionally kept global** (in `backend/requirements.txt`): `torch`, `torchvision`, `torchaudio`, `transformers`, `diffusers`, `accelerate`, `huggingface_hub`, `fastapi`, `uvicorn`, `pydantic`, `PyYAML`, `psutil`, `trimesh`, `open3d`, `numpy`, `scikit-image`, `realesrgan`, `opencv-python-headless`.
- **Packages unique to Shape/Paint**: `basicsr`, `torchmetrics`, `pythreejs`, `gradio`.
- **Packages unique to Mini Turbo**: None (DiT uses only shared dependencies).
- **Version conflicts resolved**: `cupy-cuda124` → `cupy-cuda12x` (PyPI package name); `basicsr>=1.4.2` → `basicsr>=1.3.3.3` (Python 3.10 wheel availability).

### 🔧 Dependency Fix: cupy-cuda124 → cupy-cuda12x (2026-09-28)
- Fixed `cupy-cuda124>=13.4.0` → `cupy-cuda12x>=13.4.0` in all three Hunyuan3D requirements.txt files: `backend/thirdparty/hunyuan3d-shape-v2-1/requirements.txt`, `backend/thirdparty/hunyuan3d-paint-v2-1/requirements.txt`, and `backend/thirdparty/hunyuan3d-dit-v2-mini-turbo/requirements.txt`.
- `cupy-cuda124` does not exist on any PyPI mirror; the correct package name is `cupy-cuda12x` which provides the same CUDA 12.x GPU computing support and has cp310 wheels available.

### 🔧 Hunyuan Model Dependency Deduplication (2026-09-28)
- Removed `torch==2.6.0+cu124`, `torchvision==0.21.0+cu124`, `torchaudio==2.6.0+cu124` from all three Hunyuan model requirements.txt files. These are installed centrally by `install.sh` line 268 and `backend/requirements.txt`.
- Removed `--extra-index-url https://download.pytorch.org/whl/cu124` from Hunyuan requirements.txt files (no longer needed after removing Torch packages).
- Removed `deepspeed` from `hunyuan3d-shape-v2-1/requirements.txt` and `hunyuan3d-paint-v2-1/requirements.txt`. Verified: `deepspeed` is not imported anywhere in the ForMash3D backend inference path — it is a training-only dependency.
- **Dependency ownership**: `backend/requirements.txt` and `install.sh` are the single source of truth for global runtime dependencies (torch, torchvision, torchaudio, transformers, diffusers, accelerate, etc.). Model-specific requirements.txt files contain only model-specific dependencies (cupy-cuda12x, basicsr, realesrgan, pymeshlab, etc.).

### 🔧 CUDA 12.4 Consistency & Dependency Fixes (2026-09-28)
- Fixed `basicsr>=1.4.2` → `basicsr>=1.3.3.3` in both Hunyuan3D requirements.txt files. `basicsr==1.4.2` has no wheels for Python 3.10; `1.3.3.3` is the latest version with cp310 wheels.
- Fixed `spconv-cu120` → `spconv-cu124` in `backend/scripts/install.sh` for UniRig to match project's CUDA 12.4 baseline.
- Fixed `backend/thirdparty/VoxHammer/requirements.txt`: updated `torch==2.4.0+cu118` → `torch==2.6.0+cu124`, `spconv-cu118` → `spconv-cu124`, `kaolin==0.18.0` → `kaolin==0.17.0` to match project's CUDA 12.4/PyTorch 2.6 baseline.
- Added prebuilt wheel copy step in `install.sh` to copy wheels from `backend/assets/wheels/` to `backend/thirdparty/wheels/` before installation.

### 🔧 Third-Party Source Code Migration
- **ForMash3D-thirdparty Repository**: Cloned `https://github.com/Silentzx2/ForMash3D-thirdparty` into `backend/thirdparty/`. All third-party model source code (TRELLIS, TRELLIS.2, TripoSF, TripoSG, TripoSR, UltraShape, UniRig, VoxHammer, FastMesh, Hunyuan3D-Shape-v2-1, Hunyuan3D-Paint-v2-1, Hunyuan3D-DiT-v2-mini-Turbo, PartField, PartPacker, PartUV, ardy) is now tracked as part of the main ForMash3D repository. The `wheels/` directory is excluded via `backend/.gitignore`.

---

## Versioning

This project follows [Semantic Versioning](https://semver.org/).
