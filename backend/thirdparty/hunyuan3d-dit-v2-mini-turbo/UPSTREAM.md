# Hunyuan3D-DiT-v2-mini-Turbo — UPSTREAM

## Upstream Repository

- **Repository:** https://github.com/Tencent-Hunyuan/Hunyuan3D-2
- **Upstream revision:** Cloned with `--depth 1` from main branch
- **Source path:** `hy3dgen/`, `hunyuan3d-dit-v2-mini-turbo/`
- **Model checkpoint path:** `tencent/Hunyuan3D-2mini` → `hunyuan3d-dit-v2-mini-turbo` subfolder

## Relevant Source Path

- `hy3dgen/shapegen/pipelines.py` — Contains `Hunyuan3DDiTFlowMatchingPipeline`
- `hy3dgen/shapegen/models/` — Model definitions
- `hy3dgen/rembg.py` — Background remover
- `hy3dgen/__init__.py` — Package initialization

## Model Checkpoint Path

- Hugging Face: `tencent/Hunyuan3D-2mini` with subfolder `hunyuan3d-dit-v2-mini-turbo`
- ForMash3D storage: `backend/pretrained/tencent/Hunyuan3D-2mini/`

## Integration Changes

- Removed `.git` directory to make this a plain source directory within ForMash3D
- Adapted adapter paths to use `backend/thirdparty/hunyuan3d-dit-v2-mini-turbo/`
- Added low_vram_mode and enable_flashvdm support

## Compatibility Patches

- PyTorch 2.6 + CUDA/cu124 compatibility verified
- FlashVDM support enabled for faster inference
- Low-VRAM mode support for reduced memory usage

## Patch Rationale

- Fresh checkout ensures no stale code from previous integration
- Plain directory (no .git) keeps the main repository clean
- Separate directory enables independent updates per model
- Low-VRAM and FlashVDM features are the primary differentiators
