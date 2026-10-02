"""Runtime configuration for the mesh-processing services.

All values can be overridden with environment variables so the services can run
in different deployment environments.
"""
from __future__ import annotations

import os
import tempfile
from pathlib import Path


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    try:
        return int(raw) if raw is not None and raw != "" else default
    except ValueError:
        return default


# Scratch space for temp files when a tool needs real paths on disk
WORK_DIR: Path = Path(
    os.environ.get("FORMASH_POSTPROCESS_WORK_DIR", str(Path(tempfile.gettempdir()) / "formash3d-postprocess"))
)

# ForMash3D already exposes the Blender executable through BLENDER_EXECUTABLE.
BLENDER_EXECUTABLE: str = os.environ.get("BLENDER_EXECUTABLE", "blender")

# Upload guard rail.
MAX_UPLOAD_BYTES: int = _env_int("FORMASH_POSTPROCESS_MAX_UPLOAD_BYTES", 512 * 1024 * 1024)

# GLB -> FBX conversion (headless Blender subprocess).
CONVERT_TIMEOUT_S: int = _env_int("FORMASH_POSTPROCESS_CONVERT_TIMEOUT", 600)

# Thumbnail render (headless Blender subprocess).
THUMBNAIL_TIMEOUT_S: int = _env_int("FORMASH_POSTPROCESS_THUMBNAIL_TIMEOUT", 180)

# High-to-low texture bake (headless Blender subprocess).
BAKE_TIMEOUT_S: int = _env_int("FORMASH_POSTPROCESS_BAKE_TIMEOUT", 1800)

WORK_DIR.mkdir(parents=True, exist_ok=True)
