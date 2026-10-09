"""
Hunyuan3D-DiT-v2-mini-Turbo model adapter for low-VRAM image-to-mesh generation.

This adapter integrates the Hunyuan3D-DiT-v2-mini-Turbo (0.6B) model into
the ForMash3D mesh generation framework, supporting low-resource shape generation.
"""

import logging
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
import torch
from PIL import Image

from core.models.base import ModelStatus
from core.models.mesh_models import ImageToMeshModel
from core.utils.file_utils import OutputPathGenerator
from core.utils.mesh_utils import MeshProcessor

logger = logging.getLogger(__name__)


class Hunyuan3DDiTV2MiniTurboImageToRawMeshAdapter(ImageToMeshModel):
    """
    Adapter for Hunyuan3D-DiT-v2-mini-Turbo image-to-raw-mesh generation.

    Uses the official 0.6B step-distilled Mini Turbo model with
    low-VRAM mode and FlashVDM support.
    """

    FEATURE_TYPE = "image_to_raw_mesh"
    MODEL_ID = "hunyuan3d_dit_v2_mini_turbo_image_to_raw_mesh"

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
            model_path = str(Path(__file__).resolve().parents[1] / "pretrained" / "tencent" / "Hunyuan3D-2mini")
        if hunyuan3d_root is None:
            hunyuan3d_root = str(Path(__file__).resolve().parents[1] / "thirdparty" / "hunyuan3d-dit-v2-mini-turbo")
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
        self.pipeline = None
        self.bg_remover = None
        self.mesh_processor = MeshProcessor()
        self.path_generator = OutputPathGenerator(base_output_dir="outputs")

        if str(self.hunyuan3d_root) not in sys.path:
            sys.path.append(str(self.hunyuan3d_root))
        if str(self.hunyuan3d_root / "hy3dgen") not in sys.path:
            sys.path.append(str(self.hunyuan3d_root / "hy3dgen"))

    def _load_model(self):
        """Load Hunyuan3D-DiT-v2-mini-Turbo pipeline."""
        try:
            logger.info(f"Loading Hunyuan3D-DiT-v2-mini-Turbo from {self.model_path}")

            try:
                from torchvision_fix import apply_fix
                apply_fix()
            except (ImportError, Exception) as e:
                logger.warning(f"torchvision_fix not applied: {e}")

            if not self.model_path.exists():
                raise FileNotFoundError(
                    f"Hunyuan3D-DiT-v2-mini-Turbo model directory not found at: {self.model_path}. "
                    f"Please download weights via download_models.sh."
                )

            from hy3dgen.shapegen.pipelines import (
                Hunyuan3DDiTFlowMatchingPipeline,
            )
            from hy3dgen.rembg import BackgroundRemover

            logger.info("Loading Mini Turbo pipeline...")
            self.pipeline = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(
                str(self.model_path), subfolder='hunyuan3d-dit-v2-mini-turbo'
            ).to(getattr(self, 'device', 'cuda' if torch.cuda.is_available() else 'cpu'))

            try:
                if hasattr(self.pipeline, "enable_model_cpu_offload"):
                    self.pipeline.enable_model_cpu_offload()
                    logger.info("Enabled model CPU offload for Mini Turbo pipeline")
            except Exception as offload_err:
                logger.warning(f"Could not enable CPU offload: {offload_err}")

            logger.info("Loading background remover...")
            import rembg
            self.bg_remover = BackgroundRemover()
            self.bg_remover.session = rembg.new_session(providers=["CUDAExecutionProvider", "CPUExecutionProvider"])

            logger.info("Hunyuan3D-DiT-v2-mini-Turbo loaded successfully")
            return {"pipeline": self.pipeline, "bg_remover": self.bg_remover}

        except Exception as e:
            import traceback
            traceback.print_exc()
            logger.error(f"Failed to load Hunyuan3D-DiT-v2-mini-Turbo: {str(e)}")
            raise Exception(f"Failed to load Hunyuan3D-DiT-v2-mini-Turbo: {str(e)}")

    def _unload_model(self):
        """Unload Hunyuan3D-DiT-v2-mini-Turbo models."""
        try:
            if self.pipeline is not None:
                del self.pipeline
                self.pipeline = None
            if self.bg_remover is not None:
                del self.bg_remover
                self.bg_remover = None
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
            logger.info("Hunyuan3D-DiT-v2-mini-Turbo models unloaded")
        except Exception as e:
            logger.error(f"Error unloading Hunyuan3D-DiT-v2-mini-Turbo: {str(e)}")

    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """Process image-to-raw-mesh generation using Hunyuan3D-DiT-v2-mini-Turbo."""
        try:
            if "image_path" not in inputs:
                raise ValueError("image_path is required")

            image_path = Path(inputs["image_path"])
            if not image_path.exists():
                raise FileNotFoundError(f"Input image not found: {image_path}")

            output_format = inputs.get("output_format", "glb")
            if output_format not in self.supported_output_formats:
                raise ValueError(f"Unsupported output format: {output_format}")

            logger.info(f"Generating raw mesh with Mini Turbo from: {image_path}")

            image = Image.open(image_path)
            has_useful_alpha = image.mode in ("RGBA", "LA", "PA") and np.array(image.getchannel("A")).min() < 255
            if has_useful_alpha:
                image = image.convert("RGBA")
            else:
                image = self.bg_remover(image.convert("RGB"))

            logger.info("Generating 3D shape with Mini Turbo...")
            octree_res = 512
            num_steps = inputs.get("num_inference_steps", 5)
            if num_steps is None:
                num_steps = 5
            guidance_scale = inputs.get("guidance_scale", 5.0)
            if guidance_scale is None:
                guidance_scale = 5.0
            low_vram_mode = bool(inputs.get("low_vram_mode", True))
            enable_flashvdm = bool(inputs.get("enable_flashvdm", True))
            seed = int(inputs.get("seed", 42))
            device = "cuda" if torch.cuda.is_available() else "cpu"
            generator = torch.Generator(device=device).manual_seed(seed)

            # Tencent exposes FlashVDM as a pipeline configuration method, not an
            # inference keyword. Match the official Turbo launch contract.
            if hasattr(self.pipeline, "enable_flashvdm"):
                self.pipeline.enable_flashvdm(enabled=enable_flashvdm)

            mesh_result = self.pipeline(
                image=image,
                octree_resolution=octree_res,
                num_inference_steps=num_steps,
                guidance_scale=guidance_scale,
                generator=generator,
            )[0]

            base_name = f"{self.model_id}_{image_path.stem}"
            output_path = self._generate_output_path(base_name, output_format)
            self.mesh_processor.save_mesh(mesh_result, output_path, do_normalise=False)

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
                    "low_vram_mode": low_vram_mode,
                    "enable_flashvdm": enable_flashvdm,
                    "seed": seed,
                },
            }

            logger.info(f"Mini Turbo raw mesh generation completed: {output_path}")
            self.status = ModelStatus.LOADED
            return response

        except Exception as e:
            self.status = ModelStatus.ERROR
            logger.error(f"Mini Turbo raw mesh generation failed: {str(e)}")
            raise Exception(f"Mini Turbo raw mesh generation failed: {str(e)}")

    def _get_output_mesh_path(self, safe_name: str, output_format: str) -> Path:
        return Path(
            self.path_generator.generate_mesh_path(
                self.model_id, safe_name, output_format
            )
        )

    def _generate_output_path(self, base_name: str, output_format: str) -> Path:
        safe_name = "".join(
            c for c in base_name[:50] if c.isalnum() or c in (" ", "_")
        ).strip().replace(" ", "_")
        return self._get_output_mesh_path(safe_name or "mesh", output_format)

    def get_parameter_schema(self) -> Dict[str, Any]:
        return {
            "parameters": {
                "octree_resolution": {
                    "type": "integer",
                    "description": "Fixed at 512 for maximum raw geometry detail; output polycount is a post-processing setting.",
                    "default": 512,
                    "required": False,
                    "readOnly": True,
                },
                "num_inference_steps": {
                    "type": "integer",
                    "description": "Number of inference steps; Tencent's Turbo preset uses 5.",
                    "default": 5,
                    "required": False,
                },
                "guidance_scale": {
                    "type": "number",
                    "description": "Guidance scale for generation",
                    "default": 5.0,
                    "required": False,
                },
                "low_vram_mode": {
                    "type": "boolean",
                    "description": "Enable low-VRAM mode for reduced memory usage",
                    "default": True,
                    "required": False,
                },
                "seed": {
                    "type": "integer",
                    "description": "Random seed for deterministic raw geometry generation",
                    "default": 42,
                    "minimum": 0,
                    "required": False,
                },
                "enable_flashvdm": {
                    "type": "boolean",
                    "description": "Enable FlashVDM for faster inference",
                    "default": True,
                    "required": False,
                },
            }
        }

    def get_supported_formats(self) -> Dict[str, List[str]]:
        return {"input": ["png", "jpg", "jpeg"], "output": ["glb", "obj"]}
