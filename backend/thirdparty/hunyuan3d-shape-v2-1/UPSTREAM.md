# Hunyuan3D-Shape-v2-1 — UPSTREAM

## Upstream Repository

- **Repository:** https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1
- **Upstream revision:** Cloned with `--depth 1` from main branch
- **Source path:** `hy3dshape/`, `hunyuan3d-dit-v2-1/`
- **Model checkpoint path:** `tencent/Hunyuan3D-2.1` → `hunyuan3d-dit-v2-1` subfolder

## Relevant Source Path

- `hy3dshape/hy3dshape/pipelines.py` — Contains `Hunyuan3DDiTFlowMatchingPipeline`
- `hy3dshape/hy3dshape/rembg.py` — Background remover
- `hy3dpaint/textureGenPipeline.py` — Paint pipeline (for chained texture)

## Model Checkpoint Path

- Hugging Face: `tencent/Hunyuan3D-2.1` with subfolder `hunyuan3d-dit-v2-1`
- ForMash3D storage: `backend/pretrained/tencent/Hunyuan3D-2.1/`

## Integration Changes

- Removed `.git` directory to make this a plain source directory within ForMash3D
- Adapted adapter paths to use `backend/thirdparty/hunyuan3d-shape-v2-1/`
- Added `utils/torchvision_fix.py` compatibility shim if needed

## Compatibility Patches

- PyTorch 2.6 + CUDA/cu124 compatibility verified
- `torchvision_fix.py` applied for torchvision compatibility
- Model loading paths updated to match ForMash3D directory structure

## Patch Rationale

- Fresh checkout ensures no stale code from previous integration
- Plain directory (no .git) keeps the main repository clean
- Separate directory enables independent updates per model
