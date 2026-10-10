"""
Mesh processing utilities for adapters.
"""

import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Union

import trimesh

from core.mesh_processor import (
    MeshProcessor,
    decimate_mesh,
    get_optimal_thread_count,
    marching_cubes,
    smooth_mesh,
)

logger = logging.getLogger(__name__)

__all__ = [
    "MeshProcessor",
    "marching_cubes",
    "smooth_mesh",
    "decimate_mesh",
    "get_optimal_thread_count",
]