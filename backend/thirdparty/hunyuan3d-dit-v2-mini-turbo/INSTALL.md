# Hunyuan3D-DiT-v2-mini-Turbo — INSTALL

## Model-Specific Integration Steps

### 1. Source Directory

The source is located at `backend/thirdparty/hunyuan3d-dit-v2-mini-turbo/`.

### 2. Dependencies

Install via the main installer:

```bash
bash backend/scripts/install.sh
```

This handles:
- PyTorch 2.6 + CUDA/cu124
- Model requirements from `requirements.txt`

### 3. No Native Extensions Required

Unlike Shape-v2-1 and Paint-v2-1, Mini Turbo does not require custom CUDA extensions.
The pipeline runs on standard PyTorch inference.

### 4. Model Weights

Download via:

```bash
bash backend/scripts/download_models.sh -m hunyuan3d_dit_v2_mini_turbo
```

Or manually:

```bash
hf_download tencent/Hunyuan3D-2mini --include "hunyuan3d-dit-v2-mini-turbo/*" --local-dir backend/pretrained/tencent/Hunyuan3D-2mini
```

### 5. Verification

```bash
python3 -c "
import sys
sys.path.insert(0, 'backend/thirdparty/hunyuan3d-dit-v2-mini-turbo')
from hy3dgen.shapegen.pipelines import Hunyuan3DDiTFlowMatchingPipeline
print('Mini Turbo pipeline imported successfully')
"
```

## Do Not Create a Separate Installation Architecture

All installation is handled through the existing `backend/scripts/install.sh` and `scripts/setup.sh`.
