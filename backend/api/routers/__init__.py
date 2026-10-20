"""Router module initialization"""
import importlib

__all__ = [
    "auto_rigging",
    "database",
    "file_upload",
    "mesh_editing",
    "mesh_generation",
    "mesh_retopology",
    "mesh_segmentation",
    "mesh_uv_unwrapping",
    "mesh_tools",
    "motion_generation",
    "system",
]


def __getattr__(name: str):
    if name in __all__:
        return importlib.import_module(f".{name}", __name__)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
