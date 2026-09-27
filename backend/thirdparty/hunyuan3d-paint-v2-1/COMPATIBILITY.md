# Hunyuan3D-Paint-v2-1 — COMPATIBILITY

## Python 3.10

- Target: Python 3.10.x
- Verified: Compatible with Python 3.10 via Conda env `3daigc-api`

## PyTorch 2.6

- Target: PyTorch 2.6.0
- Verified: `Hunyuan3DPaintPipeline` loads under PyTorch 2.6
- Compatibility shim: `utils/torchvision_fix.py` applied

## CUDA/cu124

- Target: CUDA 12.4
- Verified: Model loads and runs under CUDA/cu124

## torchvision

- Version: 0.21.0
- Compatibility fix applied via `torchvision_fix.py`

## torchaudio

- Version: 2.6.0
- Not directly used by paint pipeline

## Native Extensions

- `hy3dpaint/custom_rasterizer` — Required for paint rendering
- `hy3dpaint/DifferentiableRenderer` — Required for mesh painting
- `hy3dpaint/hunyuanpaintpbr/` — PBR paint pipeline
- Built via `backend/scripts/install.sh`

## Dependencies

- RealESRGAN: `misc/RealESRGAN_x4plus.pth`
- DINOv2: `facebook/dinov2-giant`
- Both downloaded via `download_models.sh`

## Tested GPU

- NVIDIA GPU with CUDA 12.4 capability
- Minimum 21GB VRAM for paint generation

## Verified VRAM

- Paint-only: ~21 GB
- Shape + Paint: ~29 GB (sequential, not concurrent)

## Known Limitations

- Paint requires an existing mesh as input
- Full pipeline requires ~29 GB VRAM when chaining shape + paint
- Native extensions must build successfully before use
- RealESRGAN and DINOv2 checkpoints must be downloaded
