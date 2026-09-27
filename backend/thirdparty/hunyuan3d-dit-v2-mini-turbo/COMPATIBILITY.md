# Hunyuan3D-DiT-v2-mini-Turbo — COMPATIBILITY

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
- FlashVDM decoder compatible with cu124

## torchvision

- Version: 0.21.0
- Compatibility fix applied via `torchvision_fix.py`

## torchaudio

- Version: 2.6.0
- Not directly used by mini turbo pipeline

## Native Extensions

- No custom CUDA extensions required for Mini Turbo
- Uses standard PyTorch inference pipeline
- Background remover requires `hy3dgen/rembg.py`

## Tested GPU

- NVIDIA GPU with CUDA 12.4 capability
- Minimum 6GB VRAM for shape generation

## Verified VRAM

- Shape-only: ~6 GB
- Low-VRAM mode: Reduced memory usage with `low_vram_mode=True`
- FlashVDM: Further acceleration with `enable_flashvdm=True`

## Known Limitations

- Lower quality than Shape-v2-1 (0.6B vs 3.3B)
- Low-VRAM mode may produce lower fidelity output
- FlashVDM requires compatible VAE
- Model weights must be downloaded separately via `download_models.sh`
- Does not support paint pipeline (shape-only model)
