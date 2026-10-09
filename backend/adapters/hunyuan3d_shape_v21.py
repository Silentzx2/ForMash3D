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

import numpy as np
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

        # Clean any spurious empty outer __init__.py if present on disk
        outer_init = self.hunyuan3d_root / "hy3dshape" / "__init__.py"
        if outer_init.exists() and outer_init.stat().st_size < 10:
            try:
                outer_init.unlink()
            except Exception:
                pass

        # hy3dshape repository root has hy3dshape/ package inside it
        hy3dshape_parent = str(self.hunyuan3d_root / "hy3dshape")
        if hy3dshape_parent in sys.path:
            sys.path.remove(hy3dshape_parent)
        sys.path.insert(0, hy3dshape_parent)

        if str(self.hunyuan3d_root) not in sys.path:
            sys.path.append(str(self.hunyuan3d_root))

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

            # Ensure hy3dshape package is loaded correctly and hy3dshape.models is accessible
            hy3dshape_parent = str(self.hunyuan3d_root / "hy3dshape")
            if hy3dshape_parent in sys.path:
                sys.path.remove(hy3dshape_parent)
            sys.path.insert(0, hy3dshape_parent)

            if "hy3dshape" in sys.modules and not hasattr(sys.modules["hy3dshape"], "pipelines"):
                del sys.modules["hy3dshape"]

            try:
                from hy3dshape.pipelines import (
                    Hunyuan3DDiTFlowMatchingPipeline,
                )
                from hy3dshape.rembg import BackgroundRemover
            except ImportError:
                from hy3dshape.hy3dshape.pipelines import (
                    Hunyuan3DDiTFlowMatchingPipeline,
                )
                from hy3dshape.hy3dshape.rembg import BackgroundRemover

            import hy3dshape
            inner_pkg = self.hunyuan3d_root / "hy3dshape" / "hy3dshape"
            if inner_pkg.exists() and hasattr(hy3dshape, "__path__"):
                if str(inner_pkg) not in hy3dshape.__path__:
                    hy3dshape.__path__.append(str(inner_pkg))
            sys.modules["hy3dshape.hy3dshape"] = hy3dshape

            logger.info("Loading shape generation pipeline...")
            self.pipeline_shapegen = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(
                str(self.model_path)
            ).to(getattr(self, 'device', 'cuda' if torch.cuda.is_available() else 'cpu'))
            multi_gpu_applied = False
            if len(getattr(self, "gpu_ids", [])) > 1:
                from core.scheduler.resource_planner import dispatch_pipeline_across_gpus
                from core.scheduler.resource_planner import ResourcePlan
                rp = self.resource_plan or {}
                dispatch_pipeline_across_gpus(
                    self.pipeline_shapegen,
                    ResourcePlan(
                        kind="multi_gpu",
                        gpu_ids=tuple(self.gpu_ids),
                        primary_gpu=self.gpu_ids[0],
                        reservation_mb={int(k): int(v) for k, v in rp.get("reservation_mb", {}).items()},
                        max_memory_mb={str(k): int(v) for k, v in rp.get("max_memory_mb", {}).items()},
                        cpu_threads=int(rp.get("cpu_threads", 1)),
                        strategy=str(rp.get("strategy", "accelerate_component_dispatch")),
                        reason=str(rp.get("reason", "scheduler resource plan")),
                    ),
                )
                multi_gpu_applied = True
                logger.info("Hunyuan3D-Shape-v2-1 dispatched across GPUs %s", self.gpu_ids)
            try:
                if not multi_gpu_applied and hasattr(self.pipeline_shapegen, "enable_model_cpu_offload"):
                    self.pipeline_shapegen.enable_model_cpu_offload()
                    logger.info("Enabled model CPU offload for shape pipeline")
            except Exception as offload_err:
                logger.warning(f"Could not enable CPU offload: {offload_err}")

            logger.info("Loading background remover...")
            import rembg
            self.bg_remover = BackgroundRemover()
            self.bg_remover.session = rembg.new_session(providers=["CUDAExecutionProvider", "CPUExecutionProvider"])

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
            has_useful_alpha = image.mode in ("RGBA", "LA", "PA") and np.array(image.getchannel("A")).min() < 255
            if has_useful_alpha:
                image = image.convert("RGBA")
            else:
                image = self.bg_remover(image.convert("RGB"))

            logger.info("Generating 3D shape...")
            octree_res = 512
            num_steps = inputs.get("num_inference_steps", 50)
            guidance_scale = inputs.get("guidance_scale", 5.0)
            seed = int(inputs.get("seed", 42))
            # Use same device as pipeline to avoid tensor device mismatch
            device = "cuda" if torch.cuda.is_available() else "cpu"
            # If pipeline has device attribute, use it; otherwise fallback
            if hasattr(self.pipeline_shapegen, 'device'):
                device = self.pipeline_shapegen.device
            logger.info(f"Using device '{device}' for generator")
            generator = torch.Generator(device=device).manual_seed(seed)

            # Ensure pipeline is loaded
            if self.pipeline_shapegen is None:
                raise RuntimeError("Hunyuan3D-Shape-v2-1 pipeline not loaded. Call _load_model() first or check model weights.")

            mesh_result = self.pipeline_shapegen(
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
                    "seed": seed,
                },
            }

            logger.info(f"Hunyuan3D-Shape-v2-1 raw mesh generation completed: {output_path}")
            self.status = ModelStatus.LOADED
            return response

        except Exception as e:
            self.status = ModelStatus.ERROR
            logger.error(f"Hunyuan3D-Shape-v2-1 raw mesh generation failed: {str(e)}")
            raise Exception(f"Hunyuan3D-Shape-v2-1 raw mesh generation failed: {str(e)}")

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
                "seed": {
                    "type": "integer",
                    "description": "Random seed for deterministic raw geometry generation",
                    "default": 42,
                    "minimum": 0,
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
