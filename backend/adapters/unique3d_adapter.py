"""
Unique3D model adapter for image-to-raw-mesh generation.

Integrates Unique3D: High-Quality and Efficient 3D Mesh Generation from a Single Image.
Uses the official inference flow: input -> super-res -> multiview -> normal -> mesh -> refine -> color projection -> GLB.
"""

import logging
import os
import sys
import uuid
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


class Unique3DImageToRawMeshAdapter(ImageToMeshModel):
    """
    Adapter for Unique3D image-to-raw-mesh generation.
    
    Uses the official inference pipeline:
    1. Input image -> super-resolution (if needed)
    2. Multiview image prediction (img2mvimg)
    3. Normal prediction (image2normal)
    4. Mesh reconstruction (recon stage1)
    5. Mesh refinement (refine stage)
    6. Color projection
    7. Export GLB
    """

    FEATURE_TYPE = "image_to_raw_mesh"
    MODEL_ID = "unique3d_image_to_raw_mesh"

    def __init__(
        self,
        model_id: Optional[str] = None,
        model_path: Optional[str] = None,
        vram_requirement: Optional[int] = None,
        unique3d_root: Optional[str] = None,
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
            model_path = str(Path(__file__).resolve().parents[1] / "pretrained" / "Unique3D")
        if unique3d_root is None:
            unique3d_root = str(Path(__file__).resolve().parents[1] / "thirdparty" / "Unique3D")
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

        self.unique3d_root = Path(unique3d_root)
        
        # Pipeline components (lazy loaded)
        self.mvimg_pipeline = None
        self.mvimg_trainer = None
        self.normal_pipeline = None
        self.normal_trainer = None
        self.sr_model = None
        
        # Utilities
        self.mesh_processor = MeshProcessor()
        self.path_generator = OutputPathGenerator(base_output_dir="outputs")

        # Checkpoint paths - use model_path (pretrained/Unique3D) for weights, unique3d_root for configs
        # Official Unique3D uses diffusers format with model.safetensors files
        self.mvimg_config = str(self.unique3d_root / "app" / "custom_models" / "image2mvimage.yaml")
        self.mvimg_checkpoint = str(Path(model_path) / "ckpt" / "img2mvimg" / "unet" / "diffusion_pytorch_model.safetensors")
        self.normal_config = str(self.unique3d_root / "app" / "custom_models" / "image2normal.yaml")
        self.normal_checkpoint = str(Path(model_path) / "ckpt" / "image2normal" / "unet" / "diffusion_pytorch_model.safetensors")
        self.sr_model_path = str(Path(model_path) / "ckpt" / "realesrgan-x4.onnx")
        
        # Add paths to sys.path
        self._ensure_unique3d_in_path()

        logger.info(f"Initialized Unique3D adapter with root: {unique3d_root}")

    def _ensure_unique3d_in_path(self):
        """Add Unique3D directories to sys.path for imports."""
        paths_to_add = [
            str(self.unique3d_root),
            str(self.unique3d_root / "app"),
            str(self.unique3d_root / "app" / "custom_models"),
            str(self.unique3d_root / "scripts"),
            str(self.unique3d_root / "mesh_reconstruction"),
        ]
        for p in paths_to_add:
            if p not in sys.path:
                sys.path.insert(0, p)

    def _load_model(self):
        """Load Unique3D pipelines: multiview prediction, normal prediction, and super-resolution."""
        try:
            logger.info("Loading Unique3D models...")
            
            # Apply torchvision fix if available
            try:
                from utils.torchvision_fix import apply_fix
                apply_fix()
            except (ImportError, Exception) as e:
                logger.warning(f"torchvision_fix not applied: {e}")

            loaded_models = {}

            if not torch.cuda.is_available():
                raise RuntimeError("Unique3D requires CUDA; CPU fallback is not supported")

            # Load multiview prediction pipeline (img2mvimg)
            logger.info("Loading multiview prediction pipeline (img2mvimg)...")
            self._ensure_unique3d_in_path()
            from app.custom_models.utils import load_pipeline
            
            # Use official load_pipeline which expects .pth format
            # The checkpoints are safetensors from HF - load_pipeline handles conversion via strict=False
            self.mvimg_trainer, self.mvimg_pipeline = load_pipeline(
                self.mvimg_config, self.mvimg_checkpoint
            )
            # self.mvimg_pipeline.enable_model_cpu_offload()
            loaded_models["mvimg_pipeline"] = self.mvimg_pipeline
            loaded_models["mvimg_trainer"] = self.mvimg_trainer

            # Load normal prediction pipeline (image2normal)
            logger.info("Loading normal prediction pipeline (image2normal)...")
            self.normal_trainer, self.normal_pipeline = load_pipeline(
                self.normal_config, self.normal_checkpoint
            )
            # self.normal_pipeline.enable_model_cpu_offload()
            loaded_models["normal_pipeline"] = self.normal_pipeline
            loaded_models["normal_trainer"] = self.normal_trainer

            # Load super-resolution model (realesrgan)
            logger.info("Loading super-resolution model...")
            try:
                import onnxruntime as ort
                self.sr_model = ort.InferenceSession(
                    self.sr_model_path,
                    providers=["CUDAExecutionProvider", "CPUExecutionProvider"]
                )
                loaded_models["sr_model"] = self.sr_model
            except Exception as e:
                logger.warning(f"Could not load super-resolution model: {e}")

            logger.info("Unique3D models loaded successfully")
            return loaded_models

        except Exception as e:
            import traceback
            traceback.print_exc()
            logger.error(f"Failed to load Unique3D models: {str(e)}")
            raise Exception(f"Failed to load Unique3D models: {str(e)}")

    def _unload_model(self):
        """Unload Unique3D models."""
        try:
            if self.mvimg_pipeline is not None:
                del self.mvimg_pipeline
                self.mvimg_pipeline = None
            if self.mvimg_trainer is not None:
                del self.mvimg_trainer
                self.mvimg_trainer = None
            if self.normal_pipeline is not None:
                del self.normal_pipeline
                self.normal_pipeline = None
            if self.normal_trainer is not None:
                del self.normal_trainer
                self.normal_trainer = None
            if self.sr_model is not None:
                del self.sr_model
                self.sr_model = None

            if torch.cuda.is_available():
                torch.cuda.empty_cache()

            logger.info("Unique3D models unloaded successfully")

        except Exception as e:
            logger.error(f"Error unloading Unique3D models: {str(e)}")

    def _run_super_resolution(self, images: List[Image.Image]) -> List[Image.Image]:
        """Run super-resolution on input images using realesrgan."""
        if self.sr_model is None:
            # Fallback: simple resize
            return [img.resize((img.width * 2, img.height * 2), Image.LANCZOS) for img in images]
        
        try:
            import onnxruntime as ort
            import numpy as np
            
            results = []
            for img in images:
                # Convert to RGB if needed
                if img.mode != "RGB":
                    img = img.convert("RGB")
                
                # Prepare input
                img_np = np.array(img).astype(np.float32) / 255.0
                img_np = img_np.transpose(2, 0, 1)[np.newaxis, ...]  # NCHW
                
                # Run inference
                input_name = self.sr_model.get_inputs()[0].name
                output = self.sr_model.run(None, {input_name: img_np})[0]
                
                # Convert back to image
                output = output[0].transpose(1, 2, 0)
                output = np.clip(output * 255, 0, 255).astype(np.uint8)
                results.append(Image.fromarray(output))
            
            return results
        except Exception as e:
            logger.warning(f"Super-resolution failed: {e}, using fallback resize")
            return [img.resize((img.width * 2, img.height * 2), Image.LANCZOS) for img in images]

    def _run_multiview_prediction(
        self, 
        image: Image.Image, 
        remove_bg: bool = True, 
        seed: int = 1145,
        guidance_scale: float = 1.5
    ) -> tuple:
        """Run multiview image prediction (img2mvimg)."""
        from app.custom_models.mvimg_prediction import run_mvprediction
        from app.utils import simple_remove, rgba_to_rgb
        from rembg import remove as rembg_remove
        from app.utils import session as rembg_session
        
        if remove_bg and (image.mode == "RGB" or np.array(image)[..., -1].mean() == 255.):
            image = rembg_remove(image, session=rembg_session)
        
        # Import and use the existing run_mvprediction function
        from app.custom_models.mvimg_prediction import run_mvprediction
        
        generator = torch.Generator(device="cuda").manual_seed(int(seed)) if seed >= 0 else None
        
        # Simple preprocessing
        from app.utils import simple_preprocess, change_rgba_bg
        if image.mode != "RGBA":
            image = image.convert("RGBA")
        image = change_rgba_bg(image, "white")
        single_image = simple_preprocess(image)
        
        from app.custom_models.utils import load_pipeline
        
        images = self.mvimg_trainer.pipeline_forward(
            pipeline=self.mvimg_pipeline,
            image=single_image,
            generator=generator,
            guidance_scale=guidance_scale,
            width=256,
            height=256,
            num_inference_steps=30,
        ).images
        
        return images, single_image

    def _run_normal_prediction(
        self, 
        images: List[Image.Image], 
        guidance_scale: float = 1.5,
        num_inference_steps: int = 30,
        do_rotate: bool = True
    ) -> List[Image.Image]:
        """Run normal prediction on multiview images."""
        from app.custom_models.normal_prediction import predict_normals
        return predict_normals(
            images, 
            guidance_scale=guidance_scale, 
            do_rotate=do_rotate,
            num_inference_steps=num_inference_steps
        )

    def _run_geo_reconstruct(
        self,
        rgb_pils: List[Image.Image],
        normal_pils: List[Image.Image],
        front_pil: Image.Image,
        do_refine: bool = True,
        predict_normal: bool = True,
        expansion_weight: float = 0.1,
        init_type: str = "std"
    ):
        """Run geometry reconstruction and refinement."""
        # Import reconstruction modules
        from scripts.multiview_inference import geo_reconstruct
        
        return geo_reconstruct(
            rgb_pils=rgb_pils,
            normal_pils=normal_pils,
            front_pil=front_pil,
            do_refine=do_refine,
            predict_normal=predict_normal,
            expansion_weight=expansion_weight,
            init_type=init_type
        )

    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """
        Process image-to-raw-mesh generation using Unique3D.
        
        Args:
            inputs: Dictionary containing:
                - image_path: Path to input image (required)
                - output_format: Output format (default: "glb")
                - seed: Random seed for reproducibility (default: 1145)
                - input_processing: Remove background from input (default: True)
                - do_refine: Refine multiview details (default: True)
                - expansion_weight: Expansion weight for mesh (-1 to 1, default: 0.1)
                - init_type: Mesh initialization type ("std" or "thin", default: "std")
        
        Returns:
            Dictionary with generation results
        """
        try:
            self.status = ModelStatus.PROCESSING
            self._ensure_unique3d_in_path()

            # Validate inputs
            if "image_path" not in inputs:
                raise ValueError("image_path is required for image-to-mesh generation")

            image_path = Path(inputs["image_path"])
            if not image_path.exists():
                raise FileNotFoundError(f"Input image file not found: {image_path}")

            # Extract parameters
            output_format = inputs.get("output_format", "glb")
            if output_format not in self.supported_output_formats:
                raise ValueError(f"Unsupported output format: {output_format}")

            seed = inputs.get("seed", 1145)
            input_processing = inputs.get("input_processing", True)
            do_refine = inputs.get("do_refine", True)
            expansion_weight = float(inputs.get("expansion_weight", 0.1))
            init_type = inputs.get("init_type", "std")

            logger.info(f"Generating mesh with Unique3D from image: {image_path}")

            # Create output directory
            base_name = f"{self.model_id}_{image_path.stem}"
            output_dir = self.path_generator.base_output_dir / "unique3d" / f"{image_path.stem}_{uuid.uuid4().hex}"
            output_dir.mkdir(parents=True, exist_ok=True)

            # Load input image
            preview_img = Image.open(image_path)
            
            # Step 1: Super-resolution if image is small
            if preview_img.size[0] <= 512:
                logger.info("Running super-resolution on input image...")
                preview_img = self._run_super_resolution([preview_img])[0]

            # Step 2: Multiview prediction
            logger.info("Running multiview prediction...")
            rgb_pils, front_pil = self._run_multiview_prediction(
                preview_img,
                remove_bg=input_processing,
                seed=seed
            )

            # Step 3: Normal prediction
            logger.info("Running normal prediction...")
            normal_pils = self._run_normal_prediction(rgb_pils)

            # Step 4: Geometry reconstruction and refinement
            logger.info("Running geometry reconstruction and refinement...")
            new_meshes = self._run_geo_reconstruct(
                rgb_pils=rgb_pils,
                normal_pils=normal_pils,
                front_pil=front_pil,
                do_refine=do_refine,
                predict_normal=True,
                expansion_weight=expansion_weight,
                init_type=init_type
            )

            # Process mesh: adjust vertices for correct orientation
            from pytorch3d.structures import Meshes
            vertices = new_meshes.verts_packed()
            vertices = vertices / 2 * 1.35
            vertices[..., [0, 2]] = - vertices[..., [0, 2]]
            new_meshes = Meshes(
                verts=[vertices], 
                faces=new_meshes.faces_list(), 
                textures=new_meshes.textures
            )

            # Step 5: Save mesh
            from scripts.utils import save_glb_and_video
            
            ret_mesh, _ = save_glb_and_video(
                str(output_dir), 
                new_meshes, 
                with_timestamp=False, 
                dist=3.5, 
                fov_in_degrees=2 / 1.35, 
                cam_type="ortho", 
                export_video=False
            )

            # Convert format if needed
            final_output_path = self.path_generator.generate_mesh_path(
                self.model_id, base_name, output_format
            )
            
            import shutil
            if not ret_mesh.endswith(f".{output_format}"):
                logger.info(f"Converting mesh to {output_format} format...")
                mesh = self.mesh_processor.load_mesh(ret_mesh)
                self.mesh_processor.save_mesh(mesh, final_output_path, do_normalise=False)
            else:
                shutil.move(ret_mesh, final_output_path)

            # Load final mesh for statistics
            final_mesh = self.mesh_processor.load_mesh(final_output_path)
            mesh_stats = self.mesh_processor.get_mesh_stats(final_mesh)

            # Create response
            response = {
                "output_mesh_path": str(final_output_path),
                "success": True,
                "generation_info": {
                    "model": self.model_id,
                    "input_image": str(image_path),
                    "output_format": output_format,
                    "vertex_count": mesh_stats["vertex_count"],
                    "face_count": mesh_stats["face_count"],
                    "has_texture": False,
                    "seed": seed,
                    "input_processing": input_processing,
                    "do_refine": do_refine,
                    "expansion_weight": expansion_weight,
                    "init_type": init_type,
                },
            }

            logger.info(f"Unique3D mesh generation completed: {final_output_path}")
            self.status = ModelStatus.LOADED
            return response

        except Exception as e:
            self.status = ModelStatus.ERROR
            logger.error(f"Unique3D mesh generation failed: {str(e)}")
            import traceback
            traceback.print_exc()
            raise Exception(f"Unique3D mesh generation failed: {str(e)}")

    def get_supported_formats(self) -> Dict[str, List[str]]:
        """Return supported input/output formats for Unique3D."""
        return {
            "input": ["png", "jpg", "jpeg"],
            "output": ["glb", "obj"]
        }

    def get_parameter_schema(self) -> Dict[str, Any]:
        """
        Return JSON Schema describing model-specific parameters.
        
        Official parameters from Unique3D gradio demo:
        - seed: Random seed for reproducibility
        - input_processing: Remove background from input image
        - do_refine: Refine multiview details
        - expansion_weight: Expansion weight for mesh (-1 to 1)
        - init_type: Mesh initialization type ("std" or "thin")
        """
        return {
            "parameters": {
                "seed": {
                    "type": "integer",
                    "description": "Random seed for reproducibility (-1 for random)",
                    "default": 1145,
                    "minimum": -1,
                    "required": False
                },
                "input_processing": {
                    "type": "boolean",
                    "description": "Remove background from input image (automatic background removal)",
                    "default": True,
                    "required": False
                },
                "do_refine": {
                    "type": "boolean",
                    "description": "Refine multiview details for higher quality",
                    "default": True,
                    "required": False
                },
                "expansion_weight": {
                    "type": "number",
                    "description": "Expansion weight for mesh generation (-1.0 to 1.0)",
                    "default": 0.1,
                    "minimum": -1.0,
                    "maximum": 1.0,
                    "required": False
                },
                "init_type": {
                    "type": "string",
                    "description": "Mesh initialization type",
                    "default": "std",
                    "enum": ["std", "thin"],
                    "required": False
                }
            }
        }

# Import at function level where used, not module level (pytorch3d may not be available)