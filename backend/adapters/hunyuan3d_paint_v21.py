"""
Hunyuan3D-Paint-v2-1 model adapter for mesh painting.

This adapter integrates the Hunyuan3D-Paint-v2-1 (2B PBR texture checkpoint)
into the ForMash3D mesh painting framework, supporting PBR texture generation.
"""

import logging
import os
import sys
import shutil
from pathlib import Path
from typing import Any, Dict, List, Optional

import torch
from PIL import Image, ImageOps

from core.models.base import ModelStatus
from core.models.mesh_models import ImageToMeshModel
from core.utils.file_utils import OutputPathGenerator
from core.utils.mesh_utils import MeshProcessor

logger = logging.getLogger(__name__)


class Hunyuan3DPaintV21ImageMeshPaintingAdapter(ImageToMeshModel):
    """
    Adapter for Hunyuan3D-Paint-v2-1 mesh texture painting.

    Takes an existing mesh and reference image to generate PBR textured mesh.
    """

    FEATURE_TYPE = "image_mesh_painting"
    MODEL_ID = "hunyuan3d_paint_v21_image_mesh_painting"

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
            hunyuan3d_root = str(Path(__file__).resolve().parents[1] / "thirdparty" / "hunyuan3d-paint-v2-1")
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
        self.paint_pipeline = None
        self.bg_remover = None
        self.mesh_processor = MeshProcessor()
        self.path_generator = OutputPathGenerator(base_output_dir="outputs")

        # insert(0) not append: backend/utils (CWD) must not shadow hy3dpaint's utils package
        if str(self.hunyuan3d_root) not in sys.path:
            sys.path.insert(0, str(self.hunyuan3d_root))
        if str(self.hunyuan3d_root / "hy3dpaint") not in sys.path:
            sys.path.insert(0, str(self.hunyuan3d_root / "hy3dpaint"))

    def _resolve_realesrgan_path(self) -> str:
        """Resolve RealESRGAN checkpoint path, checking both thirdparty and pretrained locations."""
        candidates = [
            self.hunyuan3d_root / "hy3dpaint" / "ckpt" / "RealESRGAN_x4plus.pth",
            Path(__file__).resolve().parents[1] / "thirdparty" / "hunyuan3d-paint-v2-1" / "hy3dpaint" / "ckpt" / "RealESRGAN_x4plus.pth",
            Path(__file__).resolve().parents[1] / "pretrained" / "misc" / "RealESRGAN_x4plus.pth",
        ]
        for p in candidates:
            if p.exists() and p.stat().st_size > 1000000:
                return str(p)
        raise FileNotFoundError(
            f"RealESRGAN_x4plus.pth not found. Tried: {[str(c) for c in candidates]}"
        )

    def _load_model(self):
        """Load Hunyuan3D-Paint-v2-1 pipeline."""
        try:
            if not torch.cuda.is_available():
                raise RuntimeError("Hunyuan3D-Paint-v2-1 requires CUDA; CPU inference is not supported.")
            logger.info("Loading Hunyuan3D-Paint-v2-1 pipeline")

            try:
                from torchvision_fix import apply_fix
                apply_fix()
            except (ImportError, Exception) as e:
                logger.warning(f"torchvision_fix not applied: {e}")

            from hy3dpaint.textureGenPipeline import (
                Hunyuan3DPaintConfig,
                Hunyuan3DPaintPipeline,
            )
            from hy3dshape.hy3dshape.rembg import BackgroundRemover

            max_num_view = 6
            resolution = 512
            conf = Hunyuan3DPaintConfig(max_num_view, resolution)

            conf.multiview_cfg_path = str(
                self.hunyuan3d_root / "hy3dpaint/cfgs/hunyuan-paint-pbr.yaml"
            )
            conf.custom_pipeline = str(
                self.hunyuan3d_root / "hy3dpaint/hunyuanpaintpbr"
            )
            conf.multiview_pretrained_path = str(self.model_path)
            conf.dino_ckpt_path = str(
                self.model_path / ".." / ".." / "dinov2-giant"
            )
            conf.realesrgan_ckpt_path = self._resolve_realesrgan_path()

            self.bg_remover = BackgroundRemover()
            self.paint_pipeline = Hunyuan3DPaintPipeline(conf)

            logger.info("Hunyuan3D-Paint-v2-1 loaded successfully")
            return {"paint": self.paint_pipeline, "bg_remover": self.bg_remover}

        except Exception as e:
            import traceback
            traceback.print_exc()
            logger.error(f"Failed to load Hunyuan3D-Paint-v2-1: {str(e)}")
            raise Exception(f"Failed to load Hunyuan3D-Paint-v2-1: {str(e)}")

    def get_vram_status(self, gpu_id: Optional[int] = None) -> Dict[str, Any]:
        """Return VRAM eligibility status for this model."""
        vram_mb = self.vram_requirement

        target_gpu_id = gpu_id
        if target_gpu_id is None:
            target_gpu_id = getattr(self, "gpu_id", None)
        if target_gpu_id is None:
            device_str = getattr(self, "device", None)
            if isinstance(device_str, str) and device_str.startswith("cuda:"):
                try:
                    target_gpu_id = int(device_str.split(":")[1])
                except (ValueError, IndexError):
                    target_gpu_id = 0
            else:
                target_gpu_id = 0

        if not torch.cuda.is_available():
            return {
                "model_id": self.model_id,
                "vram_required_mb": vram_mb,
                "vram_available_mb": None,
                "eligible": False,
                "status": "ineligible",
                "gpu_id": target_gpu_id,
                "error": "CUDA is unavailable",
            }

        try:
            device_count = torch.cuda.device_count()
            if target_gpu_id < 0 or target_gpu_id >= device_count:
                return {
                    "model_id": self.model_id,
                    "vram_required_mb": vram_mb,
                    "vram_available_mb": None,
                    "eligible": False,
                    "status": "ineligible",
                    "gpu_id": target_gpu_id,
                    "error": f"GPU {target_gpu_id} out of range (device count: {device_count})",
                }

            torch_vram = torch.cuda.get_device_properties(target_gpu_id).total_memory / (1024 * 1024)
            is_eligible = torch_vram >= vram_mb
            return {
                "model_id": self.model_id,
                "vram_required_mb": vram_mb,
                "vram_available_mb": torch_vram,
                "eligible": is_eligible,
                "status": "eligible" if is_eligible else "insufficient_vram",
                "gpu_id": target_gpu_id,
            }
        except Exception as e:
            return {
                "model_id": self.model_id,
                "vram_required_mb": vram_mb,
                "vram_available_mb": None,
                "eligible": False,
                "status": "ineligible",
                "gpu_id": target_gpu_id,
                "error": str(e),
            }

    def _verify_pbr_output(self, output_path: str) -> Dict[str, Any]:
        """Inspect exported GLB materials and the actual embedded base-colour atlas."""
        pbr_materials = {}
        base_color_dimensions = None
        try:
            import trimesh

            loaded = trimesh.load(output_path, file_type="glb", process=False)
            geometries = (
                loaded.geometry.values()
                if isinstance(loaded, trimesh.Scene)
                else [loaded]
            )
            for index, geometry in enumerate(geometries):
                material = getattr(getattr(geometry, "visual", None), "material", None)
                if material is None:
                    continue
                name = getattr(material, "name", None) or f"material_{index}"
                base_color = (
                    getattr(material, "baseColorTexture", None)
                    or getattr(material, "image", None)
                )
                dimensions = (
                    [int(base_color.width), int(base_color.height)]
                    if isinstance(base_color, Image.Image)
                    else None
                )
                if dimensions and base_color_dimensions is None:
                    base_color_dimensions = dimensions
                pbr_materials[name] = {
                    "has_albedo": base_color is not None,
                    "base_color_dimensions": dimensions,
                    "has_normal": getattr(material, "normalTexture", None) is not None
                        or getattr(material, "normal", None) is not None,
                    "has_roughness": getattr(material, "roughnessFactor", None) is not None
                        or getattr(material, "roughnessTexture", None) is not None,
                    "has_metallic": getattr(material, "metallicFactor", None) is not None
                        or getattr(material, "metallicRoughnessTexture", None) is not None,
                    "has_ao": getattr(material, "occlusionTexture", None) is not None,
                }
        except Exception as e:
            logger.warning("Could not inspect exported PBR materials: %s", e)
        return {
            "output_path": output_path,
            "has_pbr_materials": bool(pbr_materials),
            "has_base_color_texture": base_color_dimensions is not None,
            "base_color_dimensions": base_color_dimensions,
            "pbr_materials": pbr_materials,
            "material_count": len(pbr_materials),
        }

    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """Process mesh painting using Hunyuan3D-Paint-v2-1."""
        cancel_checker = inputs.get("cancel_checker")
        try:
            if not torch.cuda.is_available():
                raise RuntimeError("Hunyuan3D-Paint-v2-1 requires CUDA; CPU inference is not supported.")
            if self.bg_remover is None:
                raise ValueError("Background remover is not loaded")
            if self.paint_pipeline is None:
                raise ValueError("Paint pipeline is not loaded")

            if "mesh_path" not in inputs:
                raise ValueError("mesh_path is required")
            if "image_path" not in inputs:
                raise ValueError("image_path is required")

            mesh_path = Path(inputs["mesh_path"])
            image_path = Path(inputs["image_path"])
            if not mesh_path.exists():
                raise FileNotFoundError(f"Input mesh not found: {mesh_path}")
            if not image_path.exists():
                raise FileNotFoundError(f"Input image not found: {image_path}")

            output_format = inputs.get("output_format", "glb")
            max_num_view = inputs.get("max_num_view", 6)
            resolution = int(inputs.get("resolution", 512))
            texture_resolution = int(inputs.get("texture_resolution", 4096))
            if texture_resolution not in (1024, 2048, 4096, 8192):
                raise ValueError("texture_resolution must be one of 1024, 2048, 4096, or 8192")

            if output_format not in self.supported_output_formats:
                raise ValueError(f"Unsupported output format: {output_format}")

            logger.info(f"Painting mesh with Hunyuan3D-Paint-v2-1: {mesh_path}")

            if cancel_checker and cancel_checker():
                raise InterruptedError("Hunyuan3D-Paint processing cancelled by user")

            if hasattr(self.paint_pipeline.config, "max_selected_view_num"):
                self.paint_pipeline.config.max_selected_view_num = max_num_view
            if hasattr(self.paint_pipeline.config, "resolution"):
                self.paint_pipeline.config.resolution = resolution
            # RealESRGAN is part of this pipeline, not a user-selectable extra pass.
            if hasattr(self.paint_pipeline.config, "enable_realesrgan"):
                self.paint_pipeline.config.enable_realesrgan = True
            if hasattr(self.paint_pipeline.config, "texture_size"):
                self.paint_pipeline.config.texture_size = texture_resolution
            renderer = getattr(self.paint_pipeline, "render", None)
            if renderer is not None:
                if hasattr(renderer, "texture_size"):
                    renderer.texture_size = texture_resolution
                if hasattr(renderer, "set_default_texture_resolution"):
                    renderer.set_default_texture_resolution(texture_resolution)

            base_name = f"{self.model_id}_{mesh_path.stem}_{image_path.stem}"
            output_path = self.path_generator.generate_mesh_path(
                self.model_id, base_name, output_format
            )

            use_remesh = bool(inputs.get("use_remesh", False))
            with Image.open(image_path) as reference_image:
                reference_image = self._prepare_reference_image(reference_image)

            if cancel_checker and cancel_checker():
                raise InterruptedError("Hunyuan3D-Paint processing cancelled by user")

            final_mesh_path = self.paint_pipeline(
                str(mesh_path), reference_image, str(output_path), use_remesh=use_remesh
            )

            if cancel_checker and cancel_checker():
                raise InterruptedError("Hunyuan3D-Paint processing cancelled by user")

            if final_mesh_path != str(output_path):
                shutil.move(final_mesh_path, output_path)

            final_mesh = self.mesh_processor.load_mesh(output_path)
            mesh_stats = self.mesh_processor.get_mesh_stats(final_mesh)

            pbr_verification = self._verify_pbr_output(output_path)
            if not pbr_verification.get("has_base_color_texture"):
                raise RuntimeError("Hunyuan3D-Paint output has no verifiable embedded base-colour texture.")
            if pbr_verification.get("base_color_dimensions") != [texture_resolution, texture_resolution]:
                raise RuntimeError(
                    "Hunyuan3D-Paint exported atlas dimensions "
                    f"{pbr_verification.get('base_color_dimensions')} do not match requested "
                    f"{texture_resolution}x{texture_resolution}."
                )

            response = {
                "output_mesh_path": str(output_path),
                "success": True,
                "painting_info": {
                    "model": self.model_id,
                    "input_mesh": str(mesh_path),
                    "input_image": str(image_path),
                    "output_format": output_format,
                    "vertex_count": mesh_stats["vertex_count"],
                    "face_count": mesh_stats["face_count"],
                    "max_num_view": max_num_view,
                    "resolution": resolution,
                    "texture_resolution": texture_resolution,
                    "base_color_dimensions": pbr_verification["base_color_dimensions"],
                    "reference_aspect_ratio_preserved": True,
                },
                "pbr_verification": pbr_verification,
            }

            logger.info(f"Hunyuan3D-Paint-v2-1 mesh painting completed: {output_path}")
            self.status = ModelStatus.LOADED
            return response

        except Exception as e:
            self.status = ModelStatus.ERROR
            logger.error(f"Hunyuan3D-Paint-v2-1 mesh painting failed: {str(e)}")
            raise Exception(f"Hunyuan3D-Paint-v2-1 mesh painting failed: {str(e)}")

    @staticmethod
    def _prepare_reference_image(image):
        image = image.convert("RGBA")
        white_background = Image.new("RGBA", image.size, "white")
        white_background.alpha_composite(image)
        image = ImageOps.contain(white_background.convert("RGB"), (512, 512))
        canvas = Image.new("RGB", (512, 512), "white")
        canvas.paste(image, ((512 - image.width) // 2, (512 - image.height) // 2))
        return canvas

    def get_parameter_schema(self) -> Dict[str, Any]:
        return {
            "parameters": {
                "max_num_view": {
                    "type": "integer",
                    "description": "Maximum number of views for texture generation",
                    "default": 6,
                    "minimum": 6,
                    "maximum": 12,
                    "required": False,
                },
                "resolution": {
                    "type": "integer",
                    "description": "Texture generation resolution per view",
                    "default": 512,
                    "enum": [512, 768],
                    "required": False,
                },
            },
            "vram_requirement_mb": self.vram_requirement,
            "vram_eligible": self.get_vram_status()["eligible"],
        }

    def get_supported_formats(self) -> Dict[str, List[str]]:
        return {"input": ["glb", "obj"], "output": ["glb", "obj"]}
