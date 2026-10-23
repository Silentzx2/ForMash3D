# Utilities module
from importlib import import_module

from .exceptions import InsufficientVRAMError, JobTimeoutError, ModelNotFoundError

__all__ = [
    "validate_image", "validate_text", "validate_file_size",
    "save_upload_file", "cleanup_temp_files", "generate_filename",
    "ModelNotFoundError", "InsufficientVRAMError", "JobTimeoutError"
]

# ponytail: the helpers are exposed lazily so importing one light submodule (for
# example artifact_utils) does not pull in the optional upload/image dependencies
# (aiofiles, Pillow) that file_utils and validation require.
_LAZY_ATTRIBUTES = {
    "validate_image": ".validation",
    "validate_text": ".validation",
    "validate_file_size": ".validation",
    "save_upload_file": ".file_utils",
    "cleanup_temp_files": ".file_utils",
    "generate_filename": ".file_utils",
}


def __getattr__(name):
    module_name = _LAZY_ATTRIBUTES.get(name)
    if module_name is None:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    value = getattr(import_module(module_name, __name__), name)
    globals()[name] = value
    return value
