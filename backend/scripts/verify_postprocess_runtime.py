#!/usr/bin/env python3
"""Verify the non-GPU runtime contract for ForMash3D post-processing."""

from __future__ import annotations

import importlib
import os
import shutil
import subprocess
import sys
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


REQUIRED_MODULES = {
    "numpy": "numpy",
    "trimesh": "trimesh",
    "Pillow": "PIL",
    "scipy": "scipy",
    "scikit-image": "skimage",
    "pymeshlab": "pymeshlab",
    "embreex": "embreex",
    "manifold3d": "manifold3d",
    "coacd": "coacd",
    "warp-lang": "warp",
    "rtree": "rtree",
    "matplotlib": "matplotlib",
}


def resolve_executable(value: str) -> str | None:
    path = Path(value).expanduser()
    if path.parent != Path("."):
        return str(path) if path.is_file() and os.access(path, os.X_OK) else None
    return shutil.which(value)


def main() -> int:
    failures: list[str] = []

    if sys.version_info[:2] != (3, 10):
        failures.append(
            f"Python 3.10 is required by the production baseline; found {sys.version.split()[0]}"
        )

    for package, module_name in REQUIRED_MODULES.items():
        try:
            importlib.import_module(module_name)
        except Exception as exc:
            failures.append(f"{package}: {type(exc).__name__}: {exc}")

    try:
        importlib.import_module("postprocess.pipeline")
    except Exception as exc:
        failures.append(f"postprocess.pipeline: {type(exc).__name__}: {exc}")

    blender_name = os.environ.get("BLENDER_EXECUTABLE", "blender")
    blender = resolve_executable(blender_name)
    if blender is None:
        failures.append(f"Blender executable not found: {blender_name}")
    else:
        probe = subprocess.run(
            [
                blender,
                "--background",
                "--python-expr",
                'import bpy; print("ForMash3D Blender runtime:", bpy.app.version_string)',
            ],
            capture_output=True,
            text=True,
            check=False,
            timeout=60,
        )
        if probe.returncode != 0:
            detail = (probe.stderr or probe.stdout or "").strip()
            failures.append(f"Blender runtime smoke test failed: {detail[-2000:]}")

    if failures:
        print("Post-processing runtime verification FAILED:", file=sys.stderr)
        for failure in failures:
            print(f"  - {failure}", file=sys.stderr)
        return 1

    print("Post-processing runtime verification PASSED.")
    print(f"Python: {sys.version.split()[0]}")
    print(f"Blender: {blender}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
