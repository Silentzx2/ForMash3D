"""Auto-rigging and skeleton integration service.

Provides unified entrypoints for UniRig and FBX skeleton conversion/export.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Callable, Dict, Optional, Tuple

from .convert_fbx import run_convert_fbx
from ..schemas import ConvertOptions

logger = logging.getLogger(__name__)


def is_rigging_available() -> bool:
    """Check if UniRig model weights and code dependencies are present."""
    try:
        from adapters.unirig_adapter import UniRigAdapter
        return True
    except Exception:
        return False


def run_rigging_export(
    glb_bytes: bytes,
    options: Optional[ConvertOptions] = None,
    progress: Optional[Callable[[str, float, str], None]] = None,
) -> Tuple[bytes, Dict[str, Any]]:
    """Export or convert rigged asset to FBX."""
    opts = options or ConvertOptions(preset="generic", bake_fps=30, anim_simplify=1.0)
    return run_convert_fbx(glb_bytes, opts, progress=progress)
