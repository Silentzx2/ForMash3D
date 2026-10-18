"""
Utility functions for adapters.

The Hunyuan Shape utility path is retained for the existing shape adapter.
Hunyuan3D-Paint temporarily scopes its own generic `utils.*` imports during
load instead of registering the Paint package globally here.
"""
from pathlib import Path

_hunyuan_shape_utils = (
    Path(__file__).resolve().parents[1]
    / "thirdparty"
    / "hunyuan3d-shape-v2-1"
    / "hy3dpaint"
    / "utils"
)
if _hunyuan_shape_utils.is_dir() and str(_hunyuan_shape_utils) not in __path__:
    __path__.insert(0, str(_hunyuan_shape_utils))
