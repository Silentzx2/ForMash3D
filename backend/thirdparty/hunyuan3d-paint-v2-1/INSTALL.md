# Hunyuan3D-Paint-v2-1 — INSTALL

## Model-Specific Integration Steps

### 1. Source Directory

The source is located at `backend/thirdparty/hunyuan3d-paint-v2-1/`.

### 2. Dependencies

Install via the main installer:

```bash
bash backend/scripts/install.sh
```

This handles:
- PyTorch 2.6 + CUDA/cu124
- Custom rasterizer build
- Differentiable renderer build
- Model requirements from `requirements-inference.txt`

### 3. Native Extensions

```bash
cd backend/thirdparty/hunyuan3d-paint-v2-1/hy3dpaint/custom_rasterizer
pip install -e . --no-build-isolation

cd hy3dpaint/DifferentiableRenderer
bash compile_mesh_painter.sh
```

### 4. Model Weights

Download via:

```bash
bash backend/scripts/download_models.sh -m hunyuan3d_paint_v21
```

Or manually:

```bash
hf_download tencent/Hunyuan3D-2.1 --include "hunyuan3d-paintpbr-v2-1/*" --local-dir backend/pretrained/tencent/Hunyuan3D-2.1
```

Also download required checkpoints:

```bash
bash backend/scripts/download_models.sh -m misc
```

### 5. Verification

```bash
python3 -c "
import sys
sys.path.insert(0, 'backend/thirdparty/hunyuan3d-paint-v2-1')
from hy3dpaint.textureGenPipeline import Hunyuan3DPaintPipeline, Hunyuan3DPaintConfig
print('Paint pipeline imported successfully')
"
```

## Do Not Create a Separate Installation Architecture

All installation is handled through the existing `backend/scripts/install.sh` and `scripts/setup.sh`.
