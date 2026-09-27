# Hunyuan3D-Shape-v2-1 — COMPATIBILITY

## Python 3.10

- Target: Python 3.10.x
- Verified: Compatible with Python 3.10 via Conda env `3daigc-api`

## PyTorch 2.6

- Target: PyTorch 2.6.0
- Verified: `Hunyuan3DDiTFlowMatchingPipeline` loads under PyTorch 2.6
- Compatibility shim: `utils/torchvision_fix.py` applied

## CUDA/cu124

- Target: CUDA 12.4
- Verified: Model loads and runs under CUDA/cu124
- torchvision 0.21.0 compatible

## torchvision

- Version: 0.21.0
- Compatibility fix applied via `torchvision_fix.py`

## torchaudio

- Version: 2.6.0
- Not directly used by shape pipeline

## Native Extensions

- `hy3dpaint/custom_rasterizer` — Required for paint pipeline
- `hy3dpaint/DifferentiableRenderer` — Required for mesh painting
- Built via `backend/scripts/install.sh`

## Tested GPU

- NVIDIA GPU with CUDA 12.4 capability
- Minimum 10GB VRAM for shape generation

## Verified VRAM

- Shape-only: ~10 GB
- Shape + Paint: ~29 GB (sequential, not concurrent)

## Known Limitations

- Full pipeline requires ~29 GB VRAM when chaining shape + paint
- Low-VRAM mode not natively supported by Shape-v2-1 (unlike Mini Turbo)
- Model weights must be downloaded separately via `download_models.sh`
