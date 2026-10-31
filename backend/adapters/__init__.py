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

import sys
from pathlib import Path
from typing import Any

_backend_dir = str(Path(__file__).resolve().parent.parent)
if _backend_dir not in sys.path:
    sys.path.insert(0, _backend_dir)

_ADAPTER_MAP = {
    # FastMesh
    "FastMeshRetopologyAdapter": ("fastmesh_adapter", "FastMeshRetopologyAdapter"),
    # Hunyuan3D Shape v2-1
    "Hunyuan3DShapeV21ImageToRawMeshAdapter": ("hunyuan3d_shape_v21", "Hunyuan3DShapeV21ImageToRawMeshAdapter"),
    "Hunyuan3DShapeV21ImageToMeshAdapter": ("hunyuan3d_shape_v21", "Hunyuan3DShapeV21ImageToMeshAdapter"),
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
    # PartUV
    "PartUVUnwrappingAdapter": ("partuv_adapter", "PartUVUnwrappingAdapter"),
    # TRELLIS
    "TrellisImageToMeshAdapterCommon": ("trellis_adapter", "TrellisImageToMeshAdapterCommon"),
    "TrellisImageToMeshAdapter": ("trellis_adapter", "TrellisImageToMeshAdapter"),
    "TrellisTextMeshPaintingAdapter": ("trellis_adapter", "TrellisTextMeshPaintingAdapter"),
    "TrellisImageToTexturedMeshAdapter": ("trellis_adapter", "TrellisImageToTexturedMeshAdapter"),
    "TrellisImageToRawMeshAdapter": ("trellis_adapter", "TrellisImageToRawMeshAdapter"),
    "TrellisImageMeshPaintingAdapter": ("trellis_adapter", "TrellisImageMeshPaintingAdapter"),
    # TRELLIS.2
    "Trellis2ImageToRawMeshAdapter": ("trellis2_adapter", "Trellis2ImageToRawMeshAdapter"),
    "Trellis2ImageToMeshAdapter": ("trellis2_adapter", "Trellis2ImageToMeshAdapter"),
    "Trellis2ImageToTexturedMeshAdapter": ("trellis2_adapter", "Trellis2ImageToTexturedMeshAdapter"),
    "Trellis2ImageMeshPaintingAdapter": ("trellis2_adapter", "Trellis2ImageMeshPaintingAdapter"),
    # UniRig
    "UniRigAdapter": ("unirig_adapter", "UniRigAdapter"),
    # TripoSG
    "TripoSGImageToRawMeshAdapter": ("triposg_adapter", "TripoSGImageToRawMeshAdapter"),
    # ARDY
    "ArdyMotionGenerationAdapter": ("ardy_adapter", "ArdyMotionGenerationAdapter"),
    # Unique3D
    "Unique3DImageToRawMeshAdapter": ("unique3d_adapter", "Unique3DImageToRawMeshAdapter"),
    # Paint3D
    "Paint3DAdapter": ("paint3d_adapter", "Paint3DAdapter"),
    "Paint3DImageMeshPaintingAdapter": ("paint3d_adapter", "Paint3DImageMeshPaintingAdapter"),
    # Pixal3D
    "Pixal3DImageToRawMeshAdapter": ("pixal3d_adapter", "Pixal3DImageToRawMeshAdapter"),
    # TaoFlowForge
    "TaoFlowForgeImageToRawMeshAdapter": ("taoflowforge_adapter", "TaoFlowForgeImageToRawMeshAdapter"),
    # Hi3D (Experimental)
    "Hi3DAdapter": ("hi3d_adapter", "Hi3DAdapter"),
    "Hi3DImageToRawMeshAdapter": ("hi3d_adapter", "Hi3DImageToRawMeshAdapter"),
    "Hi3DImageToTexturedMeshAdapter": ("hi3d_adapter", "Hi3DImageToTexturedMeshAdapter"),
    "Hi3DImageToMeshAdapter": ("hi3d_adapter", "Hi3DImageToMeshAdapter"),
}

__all__ = list(_ADAPTER_MAP.keys())


def __getattr__(name: str) -> Any:
    if name in _ADAPTER_MAP:
        module_name, class_name = _ADAPTER_MAP[name]
        try:
            module = __import__(f"{__name__}.{module_name}", fromlist=[class_name])
        except ModuleNotFoundError:
            try:
                module = __import__(f"backend.adapters.{module_name}", fromlist=[class_name])
            except ModuleNotFoundError:
                module = __import__(f"adapters.{module_name}", fromlist=[class_name])
        attr = getattr(module, class_name)
        globals()[name] = attr
        return attr
    raise AttributeError(f"module 'adapters' has no attribute '{name}'")


def __dir__():
    return sorted(list(globals().keys()) + __all__)

