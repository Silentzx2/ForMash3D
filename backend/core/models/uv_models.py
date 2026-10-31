"""
UV unwrapping models for generating UV coordinates for 3D meshes.

This module provides models that can create optimized UV layouts for texturing.
"""

import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

from .base import BaseModel

logger = logging.getLogger(__name__)


class UVUnwrappingModel(BaseModel):
    """
    UV unwrapping model that generates UV coordinates for meshes.

    Inputs: A mesh file (obj, glb, etc.)
    Outputs: A mesh with optimized UV coordinates
    """

    def __init__(
        self,
        model_id: str,
        model_path: str,
        vram_requirement: int,
        supported_input_formats: Optional[List[str]] = None,
        supported_output_formats: Optional[List[str]] = None,
        distortion_threshold: float = 1.25,
    ):
        super().__init__(
            model_id=model_id,
            model_path=model_path,
            vram_requirement=vram_requirement,
            feature_type="uv_unwrapping",
        )

        self.supported_input_formats = supported_input_formats or ["obj", "glb"]
        self.supported_output_formats = supported_output_formats or ["obj", "glb"]
        self.distortion_threshold = distortion_threshold

    def _load_model(self):
        """Load the UV unwrapping model. To be implemented by adapters."""
        logger.info(f"Loading UV unwrapping model: {self.model_id}")
        pass

    def _unload_model(self):
        """Unload the UV unwrapping model."""
        logger.info(f"Unloading UV unwrapping model: {self.model_id}")
        pass

    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """
        Process UV unwrapping request.

        Args:
            inputs: Dictionary containing:
                - mesh_path: Path to input mesh file (required)
                - distortion_threshold: Maximum allowed distortion (optional)
                - pack_method: UV packing method (optional, 'blender', 'uvpackmaster', or 'none')
                - output_format: Output format (optional, defaults to obj)
                - save_individual_parts: Whether to save individual parts (optional)

        Returns:
            Dictionary containing:
                - output_mesh_path: Path to mesh with UV coordinates
                - packed_mesh_path: Path to packed UV mesh (if packing enabled)
                - num_components: Number of UV charts/components
                - distortion: Final distortion value
                - uv_info: Additional UV unwrapping metadata
        """
        if "mesh_path" not in inputs:
            raise ValueError("mesh_path is required for UV unwrapping")

        mesh_path = Path(inputs["mesh_path"])
        if not mesh_path.exists():
            raise FileNotFoundError(f"Input mesh file not found: {mesh_path}")

        input_format = mesh_path.suffix.lower().lstrip(".")
        if input_format not in self.supported_input_formats:
            raise ValueError(
                f"Unsupported input format: {input_format}. Supported: {self.supported_input_formats}"
            )

        output_format = inputs.get("output_format", "obj")
        if output_format not in self.supported_output_formats:
            raise ValueError(f"Unsupported output format: {output_format}")

        distortion_threshold = inputs.get(
            "distortion_threshold", self.distortion_threshold
        )
        pack_method = inputs.get("pack_method", "blender")

        logger.info(
            f"Processing UV unwrapping request for {mesh_path}, distortion threshold: {distortion_threshold}"
        )

        return {
            "output_mesh_path": str(
                mesh_path.parent / f"uv_{mesh_path.stem}.{output_format}"
            ),
            "packed_mesh_path": None,
            "num_components": 0,
            "distortion": 0.0,
            "uv_info": {
                "success": True,
                "distortion_threshold": distortion_threshold,
                "pack_method": pack_method,
            },
        }

    def get_supported_formats(self) -> Dict[str, List[str]]:
        """Return supported input/output formats."""
        return {
            "input": self.supported_input_formats,
            "output": self.supported_output_formats,
        }

    def get_model_info(self) -> Dict[str, Any]:
        """Get detailed model information."""
        info = self.get_info()
        info.update(
            {
                "model_type": "uv_unwrapping",
                "description": "UV unwrapping model for generating optimized UV coordinates",
                "distortion_threshold": self.distortion_threshold,
                "capabilities": [
                    "Part-based unwrapping",
                    "Distortion minimization",
                    "UV packing",
                ],
            }
        )
        return info

