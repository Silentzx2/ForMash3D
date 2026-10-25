"""Runtime configuration for the mesh-processing services.

All values can be overridden with environment variables so the services can run
in different deployment environments.
"""
from __future__ import annotations

import importlib.util
import os
import shutil
import sys
import tempfile
from pathlib import Path
from typing import List


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

# ForMesh3D already exposes the Blender executable through BLENDER_EXECUTABLE.
BLENDER_EXECUTABLE: str = os.environ.get("BLENDER_EXECUTABLE", "blender")


def blender_runtime_available() -> bool:
    """True when headless Blender work is possible (executable or bpy module)."""
    if shutil.which(BLENDER_EXECUTABLE):
        return True
    return importlib.util.find_spec("bpy") is not None


def blender_worker_argv(worker: Path, worker_args: List[str]) -> List[str]:
    """argv to run a Blender worker script headlessly.

    Prefers a real Blender executable when BLENDER_EXECUTABLE resolves on PATH;
    otherwise runs the worker under the current interpreter, which ships the full
    Blender runtime via the bpy wheel. Raises when neither is available.
    """
    if shutil.which(BLENDER_EXECUTABLE):
        return [BLENDER_EXECUTABLE, "--background", "--python", str(worker), "--", *worker_args]
    if importlib.util.find_spec("bpy") is not None:
        return [sys.executable, str(worker), "--", *worker_args]
    raise RuntimeError(
        f"Blender runtime not found: '{BLENDER_EXECUTABLE}' is not on PATH and bpy is not "
        "importable in this interpreter. Install the bpy wheel or set BLENDER_EXECUTABLE."
    )


def blender_expr_argv(expr: str) -> List[str]:
    """argv to run a one-line Blender Python expression headlessly."""
    if shutil.which(BLENDER_EXECUTABLE):
        return [BLENDER_EXECUTABLE, "--background", "--python-expr", expr]
    if importlib.util.find_spec("bpy") is not None:
        return [sys.executable, "-c", expr]
    raise RuntimeError(
        f"Blender runtime not found: '{BLENDER_EXECUTABLE}' is not on PATH and bpy is not "
        "importable in this interpreter. Install the bpy wheel or set BLENDER_EXECUTABLE."
    )

# Upload guard rail.
MAX_UPLOAD_BYTES: int = _env_int("FORMASH_POSTPROCESS_MAX_UPLOAD_BYTES", 512 * 1024 * 1024)

# GLB -> FBX conversion (headless Blender subprocess).
CONVERT_TIMEOUT_S: int = _env_int("FORMASH_POSTPROCESS_CONVERT_TIMEOUT", 600)

# Thumbnail render (headless Blender subprocess).
THUMBNAIL_TIMEOUT_S: int = _env_int("FORMASH_POSTPROCESS_THUMBNAIL_TIMEOUT", 180)

# High-to-low texture bake (headless Blender subprocess).
BAKE_TIMEOUT_S: int = _env_int("FORMASH_POSTPROCESS_BAKE_TIMEOUT", 1800)

WORK_DIR.mkdir(parents=True, exist_ok=True)
