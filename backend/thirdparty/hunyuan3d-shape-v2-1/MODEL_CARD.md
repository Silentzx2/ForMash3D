# Hunyuan3D-Shape-v2-1 — MODEL CARD

## Model Identity

- **Model ID:** `hunyuan3d_shape_v21_image_to_raw_mesh`
- **Model Name:** Hunyuan3D-Shape-v2-1
- **Version:** 2.1
- **Parameters:** 3.3B
- **Type:** 3D Shape Generation (DiT Flow Matching)

## Capabilities

- Image-to-3D shape generation
- Background removal support
- Configurable inference steps
- Configurable guidance scale
- Octree resolution control
- Output formats: GLB, OBJ

## VRAM Requirements

- **Shape-only:** ~10 GB
- **Shape + Paint:** ~29 GB (sequential execution)
- **Minimum GPU:** NVIDIA with CUDA 12.4, 10GB+ VRAM

## Input/Output

- **Input:** Single image (PNG, JPG, JPEG)
- **Output:** Raw mesh (GLB, OBJ)
- **Optional:** Texture generation via Paint-v2-1 chaining

## Usage

```python
from adapters.hunyuan3d_shape_v21 import Hunyuan3DShapeV21ImageToRawMeshAdapter

adapter = Hunyuan3DShapeV21ImageToRawMeshAdapter()
result = adapter.generate({"image_path": "ref.png", "output_format": "glb"})
```

## License

Tencent Hunyuan Community License. See `LICENSE` and `Notice.txt` in the source directory.

## Upstream

- Repository: https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1
- Model: `tencent/Hunyuan3D-2.1` → `hunyuan3d-dit-v2-1` subfolder
