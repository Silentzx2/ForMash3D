# Hunyuan3D-Paint-v2-1 — UPSTREAM

## Upstream Repository

- **Repository:** https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1
- **Upstream revision:** Cloned with `--depth 1` from main branch
- **Source path:** `hy3dpaint/`, `hunyuan3d-paintpbr-v2-1/`
- **Model checkpoint path:** `tencent/Hunyuan3D-2.1` → `hunyuan3d-paintpbr-v2-1` subfolder

## Relevant Source Path

- `hy3dpaint/textureGenPipeline.py` — Contains `Hunyuan3DPaintPipeline`, `Hunyuan3DPaintConfig`
- `hy3dpaint/custom_rasterizer/` — Custom rasterizer extension
- `hy3dpaint/DifferentiableRenderer/` — Differentiable mesh renderer
- `hy3dpaint/hunyuanpaintpbr/` — PBR paint pipeline
- `hy3dpaint/cfgs/hunyuan-paint-pbr.yaml` — Paint configuration

## Model Checkpoint Path

- Hugging Face: `tencent/Hunyuan3D-2.1` with subfolder `hunyuan3d-paintpbr-v2-1`
- ForMash3D storage: `backend/pretrained/tencent/Hunyuan3D-2.1/`

## Integration Changes

- Removed `.git` directory to make this a plain source directory within ForMash3D
- Adapted adapter paths to use `backend/thirdparty/hunyuan3d-paint-v2-1/`
- Paint pipeline takes existing mesh + reference image as input

## Compatibility Patches

- PyTorch 2.6 + CUDA/cu124 compatibility verified
- Native extensions built via `backend/scripts/install.sh`
- RealESRGAN checkpoint path configured
- DINOv2 checkpoint path configured

## Patch Rationale

- Fresh checkout ensures no stale code from previous integration
- Plain directory (no .git) keeps the main repository clean
- Separate directory enables independent updates per model
