"""
Model adapters for integrating specific AI models into the framework.

This package contains adapters that bridge between our model specifications
and actual AI model implementations.
"""

"""
Model adapters for integrating specific AI models into the framework.

This package contains adapters that bridge between our model specifications
and actual AI model implementations.

Adapters are lazily loaded on attribute access to prevent cascading import failures
(e.g., a missing dependency in one specialized model will not prevent other models
from loading).
"""

from typing import Any

_ADAPTER_MAP = {
    # FastMesh
    "FastMeshRetopologyAdapter": ("fastmesh_adapter", "FastMeshRetopologyAdapter"),
    # Hunyuan3D Shape v2-1
    "Hunyuan3DShapeV21ImageToRawMeshAdapter": ("hunyuan3d_shape_v21", "Hunyuan3DShapeV21ImageToRawMeshAdapter"),
    "Hunyuan3DShapeV21ImageToTexturedMeshAdapter": ("hunyuan3d_shape_v21", "Hunyuan3DShapeV21ImageToTexturedMeshAdapter"),
    # Hunyuan3D Paint v2-1
    "Hunyuan3DPaintV21ImageMeshPaintingAdapter": ("hunyuan3d_paint_v21", "Hunyuan3DPaintV21ImageMeshPaintingAdapter"),
    # Hunyuan3D DiT v2 Mini Turbo
    "Hunyuan3DDiTV2MiniTurboImageToRawMeshAdapter": ("hunyuan3d_dit_v2_mini_turbo", "Hunyuan3DDiTV2MiniTurboImageToRawMeshAdapter"),
    # Hunyuan3D 2.1 legacy
    "Hunyuan3DV21ImageToMeshAdapterCommon": ("hunyuan3d_adapter_v21", "Hunyuan3DV21ImageToMeshAdapterCommon"),
    "Hunyuan3DV21ImageToRawMeshAdapter": ("hunyuan3d_adapter_v21", "Hunyuan3DV21ImageToRawMeshAdapter"),
    "Hunyuan3DV21ImageToTexturedMeshAdapter": ("hunyuan3d_adapter_v21", "Hunyuan3DV21ImageToTexturedMeshAdapter"),
    "Hunyuan3DV21ImageMeshPaintingAdapter": ("hunyuan3d_adapter_v21", "Hunyuan3DV21ImageMeshPaintingAdapter"),
    # P3-SAM
    "P3SAMSegmentationAdapter": ("p3sam_adapter", "P3SAMSegmentationAdapter"),
    # PartField
    "PartFieldSegmentationAdapter": ("partfield_adapter", "PartFieldSegmentationAdapter"),
    # PartPacker
    "PartPackerImageToRawMeshAdapter": ("partpacker_adapter", "PartPackerImageToRawMeshAdapter"),
    # PartUV
    "PartUVUnwrappingAdapter": ("partuv_adapter", "PartUVUnwrappingAdapter"),
    # TRELLIS
    "TrellisTextToMeshAdapterCommon": ("trellis_adapter", "TrellisTextToMeshAdapterCommon"),
    "TrellisImageToMeshAdapterCommon": ("trellis_adapter", "TrellisImageToMeshAdapterCommon"),
    "TrellisTextToTexturedMeshAdapter": ("trellis_adapter", "TrellisTextToTexturedMeshAdapter"),
    "TrellisTextMeshPaintingAdapter": ("trellis_adapter", "TrellisTextMeshPaintingAdapter"),
    "TrellisImageToTexturedMeshAdapter": ("trellis_adapter", "TrellisImageToTexturedMeshAdapter"),
    "TrellisImageToRawMeshAdapter": ("trellis_adapter", "TrellisImageToRawMeshAdapter"),
    "TrellisImageMeshPaintingAdapter": ("trellis_adapter", "TrellisImageMeshPaintingAdapter"),
    # TRELLIS.2
    "Trellis2ImageToTexturedMeshAdapter": ("trellis2_adapter", "Trellis2ImageToTexturedMeshAdapter"),
    "Trellis2ImageMeshPaintingAdapter": ("trellis2_adapter", "Trellis2ImageMeshPaintingAdapter"),
    # UltraShape
    "UltraShapeImageToRawMeshAdapter": ("ultrashape_adapter", "UltraShapeImageToRawMeshAdapter"),
    # UniRig
    "UniRigAdapter": ("unirig_adapter", "UniRigAdapter"),
    # VoxHammer
    "VoxHammerTextMeshEditingAdapter": ("voxhammer_adapter", "VoxHammerTextMeshEditingAdapter"),
    "VoxHammerImageMeshEditingAdapter": ("voxhammer_adapter", "VoxHammerImageMeshEditingAdapter"),
    # TripoSR
    "TripoSRImageToRawMeshAdapter": ("triposr_adapter", "TripoSRImageToRawMeshAdapter"),
    # TripoSG
    "TripoSGImageToRawMeshAdapter": ("triposg_adapter", "TripoSGImageToRawMeshAdapter"),
    # TripoSF
    "TripoSFImageToRawMeshAdapter": ("triposf_adapter", "TripoSFImageToRawMeshAdapter"),
    # ARDY
    "ArdyMotionGenerationAdapter": ("ardy_adapter", "ArdyMotionGenerationAdapter"),
}

__all__ = list(_ADAPTER_MAP.keys())


def __getattr__(name: str) -> Any:
    if name in _ADAPTER_MAP:
        module_name, class_name = _ADAPTER_MAP[name]
        module = __import__(f"adapters.{module_name}", fromlist=[class_name])
        attr = getattr(module, class_name)
        globals()[name] = attr
        return attr
    raise AttributeError(f"module 'adapters' has no attribute '{name}'")


def __dir__():
    return sorted(list(globals().keys()) + __all__)

