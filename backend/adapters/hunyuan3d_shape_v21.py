"""
Hunyuan3D-Shape-v2-1 model adapter for image-to-mesh generation.

This adapter integrates the Hunyuan3D-Shape-v2-1 (3.3B) model into the
ForMash3D mesh generation framework, supporting high-quality shape generation.
"""

import logging
import os
import sys
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional

import torch
from PIL import Image

from core.models.base import ModelStatus
from core.models.mesh_models import ImageToMeshModel
from core.utils.file_utils import OutputPathGenerator
from core.utils.mesh_utils import MeshProcessor

logger = logging.getLogger(__name__)


class Hunyuan3DShapeV21ImageToRawMeshAdapter(ImageToMeshModel):
    """
    Adapter for Hunyuan3D-Shape-v2-1 image-to-raw-mesh generation.

    Uses the official 3.3B shape checkpoint with the Hunyuan3D-2.1 shape pipeline.
    """

    FEATURE_TYPE = "image_to_raw_mesh"
    MODEL_ID = "hunyuan3d_shape_v21_image_to_raw_mesh"

    def __init__(
        self,
        model_id: Optional[str] = None,
        model_path: Optional[str] = None,
        vram_requirement: Optional[int] = None,
        hunyuan3d_root: Optional[str] = None,
        feature_type: Optional[str] = None,
        supported_output_formats: Optional[List[str]] = None,
    ):
        if vram_requirement is None:
            raise ValueError(
                f"VRAM requirement for {self.MODEL_ID if hasattr(self, 'MODEL_ID') else model_id} must come from the model manifest"
            )
        if model_id is None:
            model_id = self.MODEL_ID
        if model_path is None:
            model_path = str(Path(__file__).resolve().parents[1] / "pretrained" / "tencent" / "Hunyuan3D-2.1")
        if hunyuan3d_root is None:
            hunyuan3d_root = str(Path(__file__).resolve().parents[1] / "thirdparty" / "hunyuan3d-shape-v2-1")
        if feature_type is None:
            feature_type = self.FEATURE_TYPE
        if supported_output_formats is None:
            supported_output_formats = ["glb", "obj"]

        super().__init__(
            model_id=model_id,
            model_path=model_path,
            vram_requirement=vram_requirement,
            supported_output_formats=supported_output_formats,
            feature_type=feature_type,
        )

        self.hunyuan3d_root = Path(hunyuan3d_root)
        self.pipeline_shapegen = None
        self.bg_remover = None
        self.mesh_processor = MeshProcessor()
        self.path_generator = OutputPathGenerator(base_output_dir="outputs")

        if str(self.hunyuan3d_root) not in sys.path:
            sys.path.append(str(self.hunyuan3d_root))
        if str(self.hunyuan3d_root / "hy3dshape") not in sys.path:
            sys.path.append(str(self.hunyuan3d_root / "hy3dshape"))

    def _load_model(self):
        """Load Hunyuan3D-Shape-v2-1 pipeline."""
        try:
            logger.info(f"Loading Hunyuan3D-Shape-v2-1 from {self.model_path}")

            try:
                from torchvision_fix import apply_fix
                apply_fix()
            except (ImportError, Exception) as e:
                logger.warning(f"torchvision_fix not applied: {e}")

            if not self.model_path.exists():
                raise FileNotFoundError(
                    f"Hunyuan3D-Shape-v2-1 model directory not found at: {self.model_path}. "
                    f"Please download weights via download_models.sh."
                )

            from hy3dshape.pipelines import (
                Hunyuan3DDiTFlowMatchingPipeline,
            )
            from hy3dshape.rembg import BackgroundRemover

            logger.info("Loading shape generation pipeline...")
            self.pipeline_shapegen = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(
                str(self.model_path)
            )
            try:
                if hasattr(self.pipeline_shapegen, "enable_model_cpu_offload"):
                    self.pipeline_shapegen.enable_model_cpu_offload()
                    logger.info("Enabled model CPU offload for shape pipeline")
            except Exception as offload_err:
                logger.warning(f"Could not enable CPU offload: {offload_err}")

            logger.info("Loading background remover...")
            self.bg_remover = BackgroundRemover()

            logger.info("Hunyuan3D-Shape-v2-1 loaded successfully")
            return {"shapegen": self.pipeline_shapegen, "bg_remover": self.bg_remover}

        except Exception as e:
            import traceback
            traceback.print_exc()
            logger.error(f"Failed to load Hunyuan3D-Shape-v2-1: {str(e)}")
            raise Exception(f"Failed to load Hunyuan3D-Shape-v2-1: {str(e)}")

    def _unload_model(self):
        """Unload Hunyuan3D-Shape-v2-1 models."""
        try:
            if self.pipeline_shapegen is not None:
                del self.pipeline_shapegen
                self.pipeline_shapegen = None
            if self.bg_remover is not None:
                del self.bg_remover
                self.bg_remover = None
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
            logger.info("Hunyuan3D-Shape-v2-1 models unloaded")
        except Exception as e:
            logger.error(f"Error unloading Hunyuan3D-Shape-v2-1: {str(e)}")

    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """Process image-to-raw-mesh generation using Hunyuan3D-Shape-v2-1."""
        try:
            if "image_path" not in inputs:
                raise ValueError("image_path is required")

            image_path = Path(inputs["image_path"])
            if not image_path.exists():
                raise FileNotFoundError(f"Input image not found: {image_path}")

            output_format = inputs.get("output_format", "glb")
            if output_format not in self.supported_output_formats:
                raise ValueError(f"Unsupported output format: {output_format}")

            logger.info(f"Generating raw mesh with Hunyuan3D-Shape-v2-1 from: {image_path}")

            image = Image.open(image_path)
            if image.mode == "RGB":
                image = self.bg_remover(image)
            else:
                image = image.convert("RGBA")

            logger.info("Generating 3D shape...")
            octree_res = min(512, max(64, int(inputs.get("octree_resolution", 256))))
            num_steps = inputs.get("num_inference_steps", 50)
            guidance_scale = inputs.get("guidance_scale", 5.0)

            mesh_result = self.pipeline_shapegen(
                image=image,
                octree_resolution=octree_res,
                num_inference_steps=num_steps,
                guidance_scale=guidance_scale,
            )[0]

            base_name = f"{self.model_id}_{image_path.stem}"
            output_path = self._generate_output_path(base_name, output_format)
            self.mesh_processor.save_mesh(mesh_result, output_path)

            final_mesh = self.mesh_processor.load_mesh(output_path)
            mesh_stats = self.mesh_processor.get_mesh_stats(final_mesh)

            response = {
                "output_mesh_path": str(output_path),
                "success": True,
                "generation_info": {
                    "model": self.model_id,
                    "input_image": str(image_path),
                    "output_format": output_format,
                    "vertex_count": mesh_stats["vertex_count"],
                    "face_count": mesh_stats["face_count"],
                    "has_texture": False,
                    "octree_resolution": octree_res,
                    "num_inference_steps": num_steps,
                    "guidance_scale": guidance_scale,
                },
            }

            logger.info(f"Hunyuan3D-Shape-v2-1 raw mesh generation completed: {output_path}")
            self.status = ModelStatus.LOADED
            return response

        except Exception as e:
            self.status = ModelStatus.ERROR
            logger.error(f"Hunyuan3D-Shape-v2-1 raw mesh generation failed: {str(e)}")
            raise Exception(f"Hunyuan3D-Shape-v2-1 raw mesh generation failed: {str(e)}")

    def get_parameter_schema(self) -> Dict[str, Any]:
        return {
            "parameters": {
                "octree_resolution": {
                    "type": "integer",
                    "description": "Octree resolution for mesh decoding",
                    "default": 256,
                    "required": False,
                },
                "num_inference_steps": {
                    "type": "integer",
                    "description": "Number of inference steps",
                    "default": 50,
                    "required": False,
                },
                "guidance_scale": {
                    "type": "number",
                    "description": "Guidance scale for generation",
                    "default": 5.0,
                    "required": False,
                },
            }
        }

    def get_supported_formats(self) -> Dict[str, List[str]]:
        return {"input": ["png", "jpg", "jpeg"], "output": ["glb", "obj"]}


class Hunyuan3DShapeV21ImageToTexturedMeshAdapter(ImageToMeshModel):
    """
    Adapter for Hunyuan3D-Shape-v2-1 image-to-textured-mesh generation.

    Chains shape generation followed by Paint-v2-1 texture painting.
    """

    FEATURE_TYPE = "image_to_textured_mesh"
    MODEL_ID = "hunyuan3d_shape_v21_image_to_textured_mesh"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.vram_requirement = 29000
        self.supported_output_formats = ["glb", "obj"]

    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """Chain shape generation + paint."""
        raise NotImplementedError(
            "Use shape + paint pipeline chaining via scheduler. "
            "This adapter requires separate shape and paint stages."
        )
