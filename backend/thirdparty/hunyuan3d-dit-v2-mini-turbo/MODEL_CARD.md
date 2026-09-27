# Hunyuan3D-DiT-v2-mini-Turbo — MODEL CARD

## Model Identity

- **Model ID:** `hunyuan3d_dit_v2_mini_turbo_image_to_raw_mesh`
- **Model Name:** Hunyuan3D-DiT-v2-mini-Turbo
- **Version:** 2.0 Mini
- **Parameters:** 0.6B
- **Type:** Low-VRAM 3D Shape Generation (Step-Distilled DiT)

## Capabilities

- Image-to-3D shape generation
- Low-VRAM mode (`low_vram_mode=True`)
- FlashVDM acceleration (`enable_flashvdm=True`)
- Background removal support
- Configurable inference steps (fewer than Shape-v2-1)
- Configurable guidance scale
- Octree resolution control
- Output formats: GLB, OBJ

## VRAM Requirements

- **Standard:** ~6 GB
- **Low-VRAM mode:** Reduced memory usage
- **FlashVDM mode:** Further acceleration
- **Minimum GPU:** NVIDIA with CUDA 12.4, 6GB+ VRAM

## Input/Output

- **Input:** Single image (PNG, JPG, JPEG)
- **Output:** Raw mesh (GLB, OBJ)
- **Note:** Shape-only model. No paint capability.

## Usage

```python
from adapters.hunyuan3d_dit_v2_mini_turbo import Hunyuan3DDiTV2MiniTurboImageToRawMeshAdapter

adapter = Hunyuan3DDiTV2MiniTurboImageToRawMeshAdapter()
result = adapter.generate({
    "image_path": "ref.png",
    "output_format": "glb",
    "low_vram_mode": True,
    "enable_flashvdm": True
})
```

## License

Tencent Hunyuan Community License. See `LICENSE` and `NOTICE` in the source directory.

## Upstream

- Repository: https://github.com/Tencent-Hunyuan/Hunyuan3D-2
- Model: `tencent/Hunyuan3D-2mini` → `hunyuan3d-dit-v2-mini-turbo` subfolder
- Official model zoo: https://github.com/Tencent-Hunyuan/Hunyuan3D-2/blob/main/docs/source/modelzoo.md
