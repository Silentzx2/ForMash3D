"""Stable access to the main backend compatibility helpers.

The repository contains vendored packages that also expose a top-level `utils`
package. Importing `utils.torchvision_fix` by name can therefore resolve to a
third-party copy depending on package search order. This loader resolves the
main backend helper by its source path and caches it under a private module name.
"""
from __future__ import annotations

import sys
import threading
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
from types import ModuleType

_MODULE_NAME = "_formash3d_backend_torchvision_fix"
_MODULE_LOCK = threading.Lock()


def get_backend_torchvision_fix() -> ModuleType:
    """Load the main backend compatibility module independent of generic imports."""
    existing = sys.modules.get(_MODULE_NAME)
    if existing is not None:
        return existing

    with _MODULE_LOCK:
        existing = sys.modules.get(_MODULE_NAME)
        if existing is not None:
            return existing

        backend_root = Path(__file__).resolve().parents[2]
        module_path = backend_root / "utils" / "torchvision_fix.py"
        if not module_path.is_file():
            raise FileNotFoundError(
                f"Backend compatibility helper not found at {module_path}"
            )

        spec = spec_from_file_location(_MODULE_NAME, module_path)
        if spec is None or spec.loader is None:
            raise ImportError(f"Unable to create module spec for {module_path}")

        module = module_from_spec(spec)
        sys.modules[_MODULE_NAME] = module
        try:
            spec.loader.exec_module(module)
        except Exception:
            sys.modules.pop(_MODULE_NAME, None)
            raise
        return module
