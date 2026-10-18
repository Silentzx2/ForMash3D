"""
Proxy module for simplify_mesh_utils forwarding to Hunyuan3D-Paint-v2-1.
Prevents 'No module named utils.simplify_mesh_utils' when backend/utils shadows hy3dpaint.
"""
import sys
import importlib.util
from pathlib import Path

_candidates = [
    Path(__file__).resolve().parents[1] / "thirdparty" / "hunyuan3d-paint-v2-1" / "hy3dpaint" / "utils" / "simplify_mesh_utils.py",
    Path(__file__).resolve().parents[1] / "thirdparty" / "hunyuan3d-shape-v2-1" / "hy3dpaint" / "utils" / "simplify_mesh_utils.py",
    Path(__file__).resolve().parents[1] / "thirdparty" / "hunyuan3d-dit-v2-mini-turbo" / "hy3dgen" / "texgen" / "utils" / "simplify_mesh_utils.py",
    Path("/kaggle/working/ForMash3D/backend/thirdparty/hunyuan3d-paint-v2-1/hy3dpaint/utils/simplify_mesh_utils.py"),
]

_target = next((p for p in _candidates if p.exists()), None)
if _target:
    _spec = importlib.util.spec_from_file_location("_hy3d_simplify_mesh_utils_impl", str(_target))
    if _spec and _spec.loader:
        _mod = importlib.util.module_from_spec(_spec)
        _spec.loader.exec_module(_mod)
        for _k, _v in _mod.__dict__.items():
            if not _k.startswith("__"):
                globals()[_k] = _v
