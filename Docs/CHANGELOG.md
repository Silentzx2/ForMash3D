## 2026-09-29 — Raw-Geometry-First Generation
- Disabled model-stage polycount decimation by default so generated meshes keep the model-native geometry for downstream post-processing.
- TRELLIS raw generation no longer removes invisible faces or simplifies the mesh unless optimization is explicitly enabled.
- TripoSG no longer decimates against the UI target polycount unless optimization is explicitly enabled.
- Clarified that the GeneratePanel topology selector is a post-processing target; raw AI model output remains triangle-based where the model/extractor emits triangles.

## 2026-09-29 — Runtime Lifecycle, Tripo Input & Headless Thumbnail Hardening
- Fixed TripoSR's runtime `trimesh` NameError in the Y-up orientation path.
- Fixed TripoSG standard preprocessing to pass a decoded RGB image to `prepare_image()`.
- Added shared model load/inference/unload timing and CUDA-memory telemetry.
- Enabled deterministic post-job GPU model unload when `AUTO_UNLOAD_AFTER_JOB` is enabled.
- Prefer EGL for headless pyrender thumbnail rendering; thumbnail failure remains non-fatal.

# Changelog

## 2026-09-28 — 3D Orientation & TRELLIS Renderer Compatibility
- Corrected TripoSR Z-up output to the ForMash3D Y-up viewport convention.
- Prevented an incompatible generic diff-gaussian-rasterization wheel from overriding TRELLIS's required mip-splatting renderer.
- TRELLIS installation now prefers a valid `diff_gaussian_rasterization` wheel from `backend/thirdparty/wheels/` and only builds Mip-Splatting from source when no usable local wheel is available.
- Fresh GPU validation remains required.

## 2026-09-28 — Pre-Ampere Attention & Model Dependency Hardening
- Added PyTorch SDPA support to bundled TRELLIS sparse full, serialized, and windowed attention.
- Completed TripoSF SDPA support where its runtime already selected that backend.
- Fixed installer ordering so TripoSG's declared diffusers 0.30.3 / transformer compatibility is restored after the global baseline.
- Static verification remains required; GPU inference still needs a fresh Colab run.

# ForMash 3D — Changelog

All notable changes, architectural updates, and feature implementations for ForMash 3D are documented in this file.

## [Unreleased]

### 🔧 Colab Runtime & Model Selection Fixes (2026-09-28)
- Removed the stale P3-SAM installer dependency on `backend/thirdparty/Hunyuan3DPart/P3SAM`; the installer now handles the current `P3-SAM` checkout layout without failing on a missing legacy path.
- Pinned Hunyuan shared runtime NumPy/CuPy versions to `numpy==1.26.4` and `cupy-cuda12x==13.4.0` to prevent the observed CuPy/NumPy ABI import failure.
- Stopped GeneratePanel from silently overriding an explicit model selection with TRELLIS.


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
