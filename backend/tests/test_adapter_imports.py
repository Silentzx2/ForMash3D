"""
Test that all model adapters in backend/adapters can be cleanly imported
and their concrete classes instantiated without missing dependency crashes at startup.
"""
import importlib
import inspect
import sys
from pathlib import Path

# Add backend directory to sys.path
backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from core.models.base import BaseModel


def test_all_adapters_import_and_init():
    adapter_dir = backend_dir / "adapters"
    adapter_files = sorted(
        p.stem
        for p in adapter_dir.glob("*.py")
        if not p.name.startswith("__") and not p.name.startswith("test_")
    )

    failures = []
    classes_checked = 0

    for name in adapter_files:
        try:
            mod = importlib.import_module(f"adapters.{name}")
        except Exception as e:
            failures.append(f"Import failure in {name}: {e}")
            continue

        for attr_name in dir(mod):
            attr = getattr(mod, attr_name)
            if (
                inspect.isclass(attr)
                and issubclass(attr, BaseModel)
                and attr is not BaseModel
                and not inspect.isabstract(attr)
                and not attr_name.endswith("Common")
                and attr.__module__ == f"adapters.{name}"
            ):
                try:
                    instance = attr()
                    classes_checked += 1
                except Exception as e:
                    failures.append(f"Init failure in {name}.{attr_name}: {e}")

    assert not failures, f"Failed adapter imports/inits:\n" + "\n".join(failures)
    assert classes_checked >= 20, f"Expected at least 20 model classes, found {classes_checked}"
    print(f"✓ All {len(adapter_files)} adapters and {classes_checked} model classes successfully imported and initialized.")


if __name__ == "__main__":
    test_all_adapters_import_and_init()
