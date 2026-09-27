# Hunyuan3D-Paint-v2-1 — MODEL CARD

## Model Identity

- **Model ID:** `hunyuan3d_paint_v21_image_mesh_painting`
- **Model Name:** Hunyuan3D-Paint-v2-1
- **Version:** 2.1
- **Parameters:** 2B
- **Type:** PBR Texture Generation (Multi-view Paint Diffusion)

## Capabilities

- Mesh texture painting from reference image
- PBR material output (Albedo, Metallic, Roughness, Normal)
- Multi-view generation (max_num_view: 6-12)
- Configurable texture resolution (512, 768)
- Requires existing mesh as input

## VRAM Requirements

- **Paint-only:** ~21 GB
- **Shape + Paint:** ~29 GB (sequential execution)
- **Minimum GPU:** NVIDIA with CUDA 12.4, 21GB+ VRAM

## Input/Output

- **Input:** Existing mesh (GLB, OBJ) + Reference image (PNG, JPG)
- **Output:** PBR textured mesh (GLB, OBJ)
- **Material maps:** Albedo, Metallic, Roughness, Normal

## Usage

```python
from adapters.hunyuan3d_shape_v21 import Hunyuan3DShapeV21ImageMeshPaintingAdapter

adapter = Hunyuan3DShapeV21ImageMeshPaintingAdapter()
result = adapter.generate({"mesh_path": "mesh.glb", "image_path": "ref.png"})
```

## License

Tencent Hunyuan Community License. See `LICENSE` and `Notice.txt` in the source directory.

## Upstream

- Repository: https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1
- Model: `tencent/Hunyuan3D-2.1` → `hunyuan3d-paintpbr-v2-1` subfolder
