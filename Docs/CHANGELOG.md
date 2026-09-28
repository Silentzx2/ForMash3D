# ForMash 3D — Changelog

All notable changes, architectural updates, and feature implementations for ForMash 3D are documented in this file.

## [Unreleased]

### 🔧 Deep Runtime Contract Audit (2026-09-28)
- Removed the non-functional direct `hunyuan3d_shape_v21_image_to_textured_mesh` registry/UI path; canonical Hunyuan texture generation is Shape-v2-1 or Mini Turbo raw mesh → optional Paint.
- Fixed Shape→Paint handoff to use the generated job `file_id` plus the original upload `image_file_id` or `image_base64`.
- Fixed invalid mesh-generation request defaults, Admin Jobs progress scaling, partial release-wheel cache detection, Conda default selection, Docker helper port output, and FastAPI lifespan verification.
- Fixed dead RGB/background-removal branches in project-owned Hunyuan adapters/helpers.
- Updated architecture, API, task, memory, decision, and README documentation to match the current runtime contracts.

### 🔧 Hunyuan Unified Dependency Structure (2026-09-28)
- Unified Shape v2.1, Paint v2.1, and DiT v2 Mini Turbo runtime dependencies under `backend/thirdparty/hunyuan-requirements.txt`.
- Kept global PyTorch/CUDA ownership in `backend/requirements.txt` and `install.sh`.

### 🔧 CUDA 12.4 Dependency Consistency (2026-09-28)
- Aligned UniRig and VoxHammer runtime dependencies with the project PyTorch 2.6 + CUDA 12.4 baseline.
- Fixed local wheelhouse handling to prefer prebuilt compatible wheels before source builds.
