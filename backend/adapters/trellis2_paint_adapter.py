"""
TRELLIS.2 model adapter for mesh painting / texturing.

Takes an existing untextured or raw 3D mesh and a reference image to generate
high-fidelity PBR textures using the TRELLIS.2 texturing pipeline.
"""

import logging
from copy import deepcopy
from pathlib import Path
from typing import Any, Dict, List, Optional

import torch

from core.models.base import ModelStatus
from core.models.mesh_models import ImageToMeshModel
from core.utils.file_utils import OutputPathGenerator
from core.utils.mesh_utils import MeshProcessor
from core.utils.thumbnail_utils import generate_mesh_thumbnail

logger = logging.getLogger(__name__)

# LOCKED / ACTIVE: values used by inference for TRELLIS.2 painting.
# BASELINE: previous effective runtime values (tex_slat_sampler_params: steps=50, guidance_strength=3.5, guidance_rescale=0.5, rescale_t=8.0, texture_size=4096)
# SUPPORTED BY: TRELLIS.2 painting adapter, EXPERIMENTAL-MODEL-SETTINGS.md section "TRELLIS.2 (raw/image geometry aliases)".
_LOCKED_INFERENCE_PROFILE = {
    "tex_slat_sampler_params": {
        "steps": 50,
        "guidance_strength": 3.5,
        "guidance_rescale": 0.5,
        "rescale_t": 8.0,
    },
    "texture_size": 4096,
}


class Trellis2ImageMeshPaintingAdapter(ImageToMeshModel):
    """
    Adapter for TRELLIS.2 image-guided mesh texturing / painting.
    
    Uses TRELLIS.2 to apply high-resolution textures to raw meshes based on reference images.
    """
    
    FEATURE_TYPE = "image_mesh_painting"
    MODEL_ID = "trellis2_image_mesh_painting"
    
    def __init__(
        self,
        model_path: Optional[str] = None,
        vram_requirement: Optional[int] = None,
        trellis2_root: Optional[str] = None,
    ):
        if vram_requirement is None:
            vram_requirement = 16000
        # Set default paths
        if model_path is None:
            model_path = str(Path(__file__).resolve().parents[1] / "pretrained" / "TRELLIS.2")
        
        if trellis2_root is None:
            trellis2_root = str(Path(__file__).resolve().parents[1] / "thirdparty" / "TRELLIS.2")
        
        super().__init__(
            model_id=self.MODEL_ID,
            model_path=model_path,
            vram_requirement=vram_requirement,
            supported_output_formats=["glb", "obj"],
            feature_type=self.FEATURE_TYPE,
        )
        
        self.trellis2_root = Path(trellis2_root)
        self.model_path = Path(model_path)
        self.runner: Optional[Any] = None
        self.mesh_processor = MeshProcessor()
        self.path_generator = OutputPathGenerator(base_output_dir="outputs")
    
    def _load_model(self):
        """Load the TRELLIS.2 texturing pipeline."""
        try:
            logger.info(f"Loading TRELLIS.2 texturing pipeline from {self.trellis2_root}")

            # Apply runtime compatibility fixes (transformers, dinov3, numba, etc.)
            try:
                from utils.torchvision_fix import apply_fix
                apply_fix()
            except Exception as fix_err:
                logger.debug(f"apply_fix notice: {fix_err}")
            
            if not torch.cuda.is_available():
                raise RuntimeError("TRELLIS.2 requires CUDA; CPU inference is not supported.")
            device = f"cuda:{self.gpu_id}" if self.gpu_id is not None else "cuda:0"

            is_low_vram = False
            if self.resource_plan:
                strategy = str(self.resource_plan.get("strategy", ""))
                if "low_vram" in strategy:
                    is_low_vram = True
            if not is_low_vram and torch.cuda.is_available():
                try:
                    target_gpu = self.gpu_id if self.gpu_id is not None else 0
                    total_mb = torch.cuda.get_device_properties(target_gpu).total_memory / (1024 * 1024)
                    if total_mb < 20480:
                        is_low_vram = True
                except Exception:
                    pass

            # Initialize TRELLIS.2 runner
            from utils.trellis2_utils import Trellis2Runner
            self.runner = Trellis2Runner(
                trellis2_root=str(self.trellis2_root),
                model_cache_dir=str(self.model_path),
                device=device,
                resource_plan=self.resource_plan,
                low_vram=is_low_vram,
            )
            
            # Pre-load the texturing pipeline
            self.runner._load_texturing_pipeline()
            
            logger.info("TRELLIS.2 texturing pipeline loaded successfully")
            return self.runner
        
        except Exception as e:
            logger.error(f"Failed to load TRELLIS.2 texturing pipeline: {str(e)}")
            raise Exception(f"Failed to load TRELLIS.2 texturing pipeline: {str(e)}")
    
    def _unload_model(self):
        """Unload the TRELLIS.2 texturing model."""
        try:
            if self.runner is not None:
                self.runner.cleanup()
                self.runner = None
            
            # Clear CUDA cache
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
            
            logger.info("TRELLIS.2 texturing model unloaded successfully")
        
        except Exception as e:
            logger.error(f"Error unloading TRELLIS.2 texturing model: {str(e)}")
    
    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """
        Process image-guided mesh texturing using TRELLIS.2.
        
        Args:
            inputs: Dictionary containing:
                - mesh_path: Path to input mesh (required)
                - image_path: Path to reference image (required)
                - output_format: Output format (default: "glb")
                - extension_webp: Use WebP extension in GLB (default: True)
        
        Returns:
            Dictionary with textured mesh information
        """
        inputs = {**inputs, **deepcopy(_LOCKED_INFERENCE_PROFILE)}
        try:
            if self.runner is None:
                raise ValueError("TRELLIS.2 texturing model is not loaded")
            
            # Validate inputs
            output_format = self._validate_common_inputs(inputs)
            
            # Extract parameters
            mesh_path = inputs.get("mesh_path")
            image_path = inputs["image_path"]
            extension_webp = inputs.get("extension_webp", True)
            
            if not mesh_path:
                raise ValueError("mesh_path is required for mesh painting")
            
            logger.info(f"Texturing mesh with TRELLIS.2: mesh={mesh_path}, image={image_path}")
            low_vram = inputs.get("low_vram") if inputs.get("low_vram") is not None else inputs.get("low_vram_mode")
            
            # Apply texture to mesh
            textured_mesh = self.runner.texture_mesh(
                mesh_path=mesh_path,
                image_path=image_path,
                output_format=output_format,
                extension_webp=extension_webp,
                low_vram=low_vram,
            )
            
            # Save mesh in requested format
            output_path = self._generate_output_path(mesh_path, output_format, is_prompt=False)
            self.mesh_processor.save_mesh(textured_mesh, output_path, do_normalise=False)
            
            # Generate thumbnail
            thumbnail_path = self._generate_thumbnail_path(output_path)
            thumbnail_generated = generate_mesh_thumbnail(
                str(output_path), str(thumbnail_path)
            )
            
            # Create response
            response = self._create_common_response(inputs, output_format)
            response.update({
                "output_mesh_path": str(output_path),
                "thumbnail_path": str(thumbnail_path) if thumbnail_generated else None,
                "generation_info": {
                    "model": "TRELLIS.2-Texturing",
                    "mesh_path": mesh_path,
                    "image_path": image_path,
                    "vertex_count": len(textured_mesh.vertices),
                    "face_count": len(textured_mesh.faces),
                    "extension_webp": extension_webp,
                    "low_vram": getattr(getattr(self.runner, "texturing_pipeline", None), "low_vram", low_vram),
                    "thumbnail_generated": thumbnail_generated,
                }
            })
            
            logger.info(f"TRELLIS.2 mesh texturing completed: {output_path}")
            self.status = ModelStatus.LOADED
            return response
        
        except Exception as e:
            import traceback
            traceback.print_exc()
            self.status = ModelStatus.ERROR
            logger.error(f"TRELLIS.2 mesh texturing failed: {str(e)}")
            raise Exception(f"TRELLIS.2 mesh texturing failed: {str(e)}")
    
    def _get_output_mesh_path(self, safe_name: str, output_format: str) -> Path:
        return Path(
            self.path_generator.generate_mesh_path(
                self.model_id, safe_name, output_format
            )
        )

    def _generate_output_path(
        self, prompt: str, output_format: str, is_prompt: bool = True
    ) -> Path:
        """Generate output file path based on input and format."""
        if is_prompt:
            safe_name = "".join(
                c for c in prompt[:50] if c.isalnum() or c in (" ", "_")
            ).strip().replace(" ", "_")
        else:
            safe_name = Path(prompt).stem[:50]

        return self._get_output_mesh_path(safe_name or "mesh", output_format)

    def _generate_thumbnail_path(self, mesh_path: Path) -> Path:
        """Generate thumbnail file path based on mesh path."""
        thumbnail_dir = Path(self.path_generator.base_output_dir) / "thumbnails"
        thumbnail_dir.mkdir(parents=True, exist_ok=True)
        return thumbnail_dir / (mesh_path.stem + "_thumb.png")

    def _get_thumbnail_path(self, filename: str) -> Path:
        thumbnail_dir = Path(self.path_generator.base_output_dir) / "thumbnails"
        thumbnail_dir.mkdir(parents=True, exist_ok=True)
        return thumbnail_dir / filename
    
    def get_supported_formats(self) -> Dict[str, List[str]]:
        """Return supported input/output formats for TRELLIS.2 texturing."""
        return {"input": ["mesh", "image"], "output": ["glb", "obj"]}
    
    def get_parameter_schema(self) -> Dict[str, Any]:
        """
        Return JSON Schema describing model-specific parameters.
        
        Returns:
            Parameter schema dictionary
        """
        return {
            "parameters": {
                "extension_webp": {
                    "type": "boolean",
                    "description": "Use WebP extension for textures in GLB format",
                    "default": True,
                    "required": False
                }
            }
        }


# Aliases
Trellis2PaintAdapter = Trellis2ImageMeshPaintingAdapter
TRELLIS2ImageMeshPaintingAdapter = Trellis2ImageMeshPaintingAdapter
TRELLIS2PaintAdapter = Trellis2ImageMeshPaintingAdapter
