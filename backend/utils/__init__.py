"""
Utility functions for adapters.

This module provides shared utilities for adapters including mesh processing,
file handling, and common operations.
"""
from pathlib import Path

# Extend __path__ so vendored thirdparty utils (such as hy3dpaint's utils)
# are transparently found when imported as `from utils.<module> import ...`
_hy3dpaint_candidates = [
    Path(__file__).resolve().parents[1] / "thirdparty" / "hunyuan3d-paint-v2-1" / "hy3dpaint" / "utils",
    Path(__file__).resolve().parents[1] / "thirdparty" / "hunyuan3d-shape-v2-1" / "hy3dpaint" / "utils",
    Path("/kaggle/working/ForMash3D/backend/thirdparty/hunyuan3d-paint-v2-1/hy3dpaint/utils"),
]
for _candidate in _hy3dpaint_candidates:
    if _candidate.is_dir() and str(_candidate) not in __path__:
        __path__.insert(0, str(_candidate))

