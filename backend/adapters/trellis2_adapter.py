"""
TRELLIS.2 model adapters for image-to-mesh generation and mesh painting.

TRELLIS.2 ONLY supports image-based operations (no text conditioning).
This adapter integrates TRELLIS.2 into our mesh generation framework.
"""

import logging
import os
import uuid
from copy import deepcopy
from pathlib import Path
from typing import Any, Dict, List, Optional

import torch

from core.models.base import ModelStatus
from core.models.mesh_models import ImageToMeshModel
from core.utils.file_utils import OutputPathGenerator
from core.utils.thumbnail_utils import generate_mesh_thumbnail
from core.utils.mesh_utils import MeshProcessor

logger = logging.getLogger(__name__)

# LOCKED / ACTIVE: values used by inference.
# NOTE (DEBUGGING / FAST TESTING):
# Output mesh 200-byte (faces=0) problem ke baad pipeline extraction aur mesh conversion logic ko
# fast iterate & debug karne ke liye steps ko temporarily 1 par set kiya gaya hai.
# IMPORTANT: Pipeline verify hone ke baad isse vapas 25 ya 50 steps par revert kiya jayega.
# Ye step=1 setting sirf fast debug verification ke liye hai, 200-byte mesh issue setting low hone ki wajah se nahi tha!
_LOCKED_INFERENCE_PROFILE = {
    "source_quality": "max",
    "pipeline_type": "1536_cascade",
    "max_num_tokens": 524288,
    "texture_size": 4096,
    "sparse_structure_sampler_params": {
        "steps": 1,  # Temporary fast debug step (default: 25)
        "guidance_strength": 10.0,
        "guidance_rescale": 0.9,
        "rescale_t": 8.0,
    },
    "shape_slat_sampler_params": {
        "steps": 1,  # Temporary fast debug step (default: 25)
        "guidance_strength": 10.0,
        "guidance_rescale": 0.8,
        "rescale_t": 8.0,
    },
    "decimation_target": -1,
    "remesh": False,
}

# LOCKED / ACTIVE: values used by inference (painting path only).
# BASELINE: previous effective runtime values (tex_slat_sampler_params: steps=50, guidance_strength=3.5, guidance_rescale=0.5, rescale_t=8.0, texture_size=4096)
# EXPERIMENTAL: selected experimental values, snapshot (2026-10-20) for stress-test; use only for benchmarking.
# SUPPORTED BY: TRELLIS.2 painting adapter, EXPERIMENTAL-MODEL-SETTINGS.md section "TRELLIS.2 (raw/image geometry aliases)".
# ROLLBACK: previous effective values; scheduler strips frontend overrides before adapter applies lock.
_LOCKED_PAINTING_INFERENCE_PROFILE = {
    "tex_slat_sampler_params": {
        "steps": 50,
        "guidance_strength": 3.5,
        "guidance_rescale": 0.5,
        "rescale_t": 8.0,
    },
    "texture_size": 4096,
}


class Trellis2ImageToRawMeshAdapter(ImageToMeshModel):
    """
    Adapter for TRELLIS.2 image-to-mesh model.
    
    Integrates TRELLIS.2 for generating untextured raw 3D meshes from images.
    Note: TRELLIS.2 does NOT support text conditioning.
    """
    
    FEATURE_TYPE = "image_to_raw_mesh"
    MODEL_ID = "trellis2_image_to_raw_mesh"
    
    def __init__(
        self,
        model_id: Optional[str] = None,
        model_path: Optional[str] = None,
        vram_requirement: Optional[int] = None,
        trellis2_root: Optional[str] = None,
        feature_type: Optional[str] = None,
        supported_output_formats: Optional[List[str]] = None,
    ):
        if vram_requirement is None:
            vram_requirement = 23552
        if model_id is None:
            model_id = self.MODEL_ID
        # Set default paths
        if model_path is None:
            model_path = str(Path(__file__).resolve().parents[1] / "pretrained" / "TRELLIS.2")
        
        if trellis2_root is None:
            trellis2_root = str(Path(__file__).resolve().parents[1] / "thirdparty" / "TRELLIS.2")
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
        
        self.trellis2_root = Path(trellis2_root)
        self.model_path = Path(model_path)
        self.runner: Optional[Any] = None
        self.mesh_processor = MeshProcessor()
        self.path_generator = OutputPathGenerator(base_output_dir="outputs")
    
    def _load_model(self):
        """Load the TRELLIS.2 model pipeline."""
        try:
            logger.info(f"Loading TRELLIS.2 model from {self.trellis2_root}")

            # Apply runtime compatibility fixes (transformers, dinov3, numba, etc.)
            try:
                from utils.torchvision_fix import apply_fix
                apply_fix()
            except Exception as fix_err:
                logger.debug(f"apply_fix notice: {fix_err}")

            # Sanitize token env vars: empty/whitespace tokens cause HTTP 401 in torch.hub and huggingface_hub
            for k in ("GITHUB_TOKEN", "GH_TOKEN", "HF_TOKEN", "HUGGINGFACE_TOKEN"):
                if k in os.environ and not os.environ[k].strip():
                    os.environ.pop(k, None)

            if not torch.cuda.is_available():
                raise RuntimeError("TRELLIS.2 requires CUDA; CPU inference is not supported.")
            device = f"cuda:{self.gpu_id}" if self.gpu_id is not None else "cuda:0"

            # Auto-route to SDPA on pre-Ampere GPUs (e.g. Tesla T4 SM 7.5, V100 SM 7.0)
            target_gpu = self.gpu_id if self.gpu_id is not None else 0
            try:
                cap = torch.cuda.get_device_capability(target_gpu)
                if cap[0] < 8:
                    os.environ["ATTN_BACKEND"] = "sdpa"
                    os.environ["SPARSE_ATTN_BACKEND"] = "sdpa"
                    logger.info(f"GPU {target_gpu} compute capability {cap[0]}.{cap[1]} < 8.0 (pre-Ampere, e.g. T4/V100). Defaulted ATTN_BACKEND to 'sdpa'.")
            except Exception:
                pass

            # Pass explicit low_vram setting based on resource_plan or GPU memory (<20GB)
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

            # Pre-load the image-to-3D pipeline
            self.runner._load_image_to_3d_pipeline()

            logger.info("TRELLIS.2 model loaded successfully")
            return self.runner

        except Exception as e:
            if ("401" in str(e) or "Unauthorized" in str(e)) and ("GITHUB_TOKEN" in os.environ or "GH_TOKEN" in os.environ):
                logger.warning("TRELLIS.2 load failed with 401 Unauthorized; retrying without GITHUB_TOKEN...")
                os.environ.pop("GITHUB_TOKEN", None)
                os.environ.pop("GH_TOKEN", None)
                return self._load_model()
            logger.error(f"Failed to load TRELLIS.2 model: {str(e)}")
            raise Exception(f"Failed to load TRELLIS.2 model: {str(e)}")
    
    def _unload_model(self):
        """Unload the TRELLIS.2 model."""
        try:
            if self.runner is not None:
                self.runner.cleanup()
                self.runner = None
            
            # Clear CUDA cache
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
            
            logger.info("TRELLIS.2 model unloaded successfully")
        
        except Exception as e:
            logger.error(f"Error unloading TRELLIS.2 model: {str(e)}")
    
    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """
        Process image-to-raw-mesh generation using TRELLIS.2.
        
        Args:
            inputs: Dictionary containing:
                - image_path: Path to input image (required)
                - decimation_target: Target number of faces for optional post-processing (default: -1)
                - texture_size: Texture resolution (default: 4096)
                - remesh: Whether to remesh output (default: False)
                - remesh_band: Remesh band parameter (default: 1)
                - remesh_project: Remesh project parameter (default: 0)
                - seed: Random seed for reproducibility (default: None)
                - output_format: Output format (default: "glb")
        
        Returns:
            Dictionary with generated mesh information
        """
        inputs = {**inputs, **deepcopy(_LOCKED_INFERENCE_PROFILE)}
        try:
            if not torch.cuda.is_available():
                raise RuntimeError("TRELLIS.2 requires CUDA; CPU inference is not supported.")
            if self.runner is None:
                raise ValueError("TRELLIS.2 model is not loaded")
            if getattr(self.runner, "o_voxel", None) is None:
                raise RuntimeError(
                    "TRELLIS.2 generation requires o_voxel for mesh extraction"
                )
            
            # Validate inputs using parent class
            output_format = self._validate_common_inputs(inputs)
            
            # Extract parameters
            image_path = inputs["image_path"]
            auto_optimize = bool(inputs.get("auto_optimize", False))
            decimation_target = int(inputs.get("decimation_target", -1))
            texture_size = inputs.get("texture_size", 4096)
            remesh = bool(inputs.get("remesh", False))
            remesh_band = inputs.get("remesh_band", 1)
            remesh_project = inputs.get("remesh_project", 0)
            seed = inputs.get("seed", None)
            pipeline_type = str(inputs.get("pipeline_type") or "1536_cascade")
            max_num_tokens = int(inputs.get("max_num_tokens", _LOCKED_INFERENCE_PROFILE["max_num_tokens"]))
            sparse_structure_sampler_params = inputs["sparse_structure_sampler_params"]
            shape_slat_sampler_params = inputs["shape_slat_sampler_params"]
            
            logger.info(
                "Generating high-fidelity untextured TRELLIS.2 mesh (pipeline=%s, max_num_tokens=%s, steps=%s)",
                pipeline_type, max_num_tokens, sparse_structure_sampler_params.get("steps", 50),
            )
            
            low_vram = inputs.get("low_vram") if inputs.get("low_vram") is not None else inputs.get("low_vram_mode")

            # Generate untextured raw 3D mesh
            mesh = self.runner.image_to_mesh(
                image_path=image_path,
                decimation_target=decimation_target,
                texture_size=texture_size,
                remesh=remesh,
                remesh_band=remesh_band,
                remesh_project=remesh_project,
                seed=seed,
                verbose=True,
                raw_mesh_only=True,
                pipeline_type=pipeline_type,
                max_num_tokens=max_num_tokens,
                sparse_structure_sampler_params=sparse_structure_sampler_params,
                shape_slat_sampler_params=shape_slat_sampler_params,
                low_vram=low_vram,
            )
            
            mesh_metadata = dict(getattr(mesh, "metadata", {}) or {})

            # Save mesh in requested format
            output_path = self._generate_output_path(image_path, output_format, is_prompt=False)
            self.mesh_processor.save_mesh(mesh, output_path, do_normalise=False)
            
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
                    "model": "TRELLIS.2",
                    "image_path": image_path,
                    "seed": seed,
                    "vertex_count": len(mesh.vertices),
                    "face_count": len(mesh.faces),
                    "native_vertex_count": mesh_metadata.get("native_vertex_count", len(mesh.vertices)),
                    "native_face_count": mesh_metadata.get("native_face_count", len(mesh.faces)),
                    "requested_geometry_resolution_path": mesh_metadata.get("requested_geometry_resolution_path", pipeline_type),
                    "requested_geometry_resolution": mesh_metadata.get("requested_geometry_resolution"),
                    "effective_geometry_resolution": mesh_metadata.get("effective_geometry_resolution"),
                    "geometry_resolution_source": mesh_metadata.get("geometry_resolution_source"),
                    "geometry_resolution_limited": mesh_metadata.get("geometry_resolution_limited", False),
                    "geometry_resolution_limit_reason": mesh_metadata.get("geometry_resolution_limit_reason"),
                    "geometry_quality_warning": mesh_metadata.get("geometry_quality_warning"),
                    "voxel_size": mesh_metadata.get("voxel_size"),
                    "geometry_extractor": mesh_metadata.get("geometry_extractor", "TRELLIS.2 O-Voxel native decoder"),
                    "mesh_operations": mesh_metadata.get("mesh_operations", []),
                    "has_texture": False,
                    "decimation_target": decimation_target,
                    "texture_size": None,
                    "remesh": remesh,
                    "pipeline_type": pipeline_type,
                    "max_num_tokens": max_num_tokens,
                    "sparse_structure_steps": sparse_structure_sampler_params.get("steps", "pipeline_default"),
                    "shape_slat_steps": shape_slat_sampler_params.get("steps", "pipeline_default"),
                    "low_vram": getattr(getattr(self.runner, "image_to_3d_pipeline", None), "low_vram", low_vram),
                    "thumbnail_generated": thumbnail_generated,
                }
            })
            
            logger.info(f"TRELLIS.2 raw mesh generation completed: {output_path}")
            self.status = ModelStatus.LOADED
            return response
        
        except Exception as e:
            import traceback
            traceback.print_exc()
            self.status = ModelStatus.ERROR
            logger.error(f"TRELLIS.2 mesh generation failed: {str(e)}")
            raise Exception(f"TRELLIS.2 mesh generation failed: {str(e)}")
    
    def _get_output_mesh_path(self, safe_name: str, output_format: str) -> Path:
        return Path(
            self.path_generator.generate_mesh_path(
                self.model_id, safe_name, output_format
            )
        )

    def _generate_output_path(
        self, prompt: str, output_format: str, is_prompt: bool = True
    ) -> Path:
        """Generate output file path based on prompt and format."""
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
        """Return supported input/output formats for TRELLIS.2."""
        return {"input": ["image"], "output": ["glb", "obj"]}
    
    def get_parameter_schema(self) -> Dict[str, Any]:
        """
        Return JSON Schema describing model-specific parameters.
        
        Returns:
            Parameter schema dictionary
        """
        return {
            "parameters": {
                "pipeline_type": {
                    "type": "string",
                    "description": "TRELLIS.2 source geometry resolution path; max-fidelity uses the 1536 cascade.",
                    "default": "1536_cascade",
                    "enum": ["512", "1024", "1024_cascade", "1536_cascade"],
                    "readOnly": True,
                    "required": False
                },
                "max_num_tokens": {
                    "type": "integer",
                    "description": "Max cascade token budget; a higher budget prevents silent resolution reduction.",
                    "default": _LOCKED_INFERENCE_PROFILE["max_num_tokens"],
                    "minimum": 49152,
                    "maximum": 1048576,
                    "readOnly": True,
                    "required": False
                },
                "decimation_target": {
                    "type": "integer",
                    "description": "Target number of faces after decimation (-1 for raw full resolution)",
                    "default": -1,
                    "minimum": -1,
                    "maximum": 10000000,
                    "readOnly": True,
                    "required": False
                },
                "texture_size": {
                    "type": "integer",
                    "description": "Locked model-side texture size; production atlas resolution is configured separately.",
                    "default": _LOCKED_INFERENCE_PROFILE["texture_size"],
                    "enum": [1024, 2048, 4096, 8192, 16384],
                    "readOnly": True,
                    "required": False
                },
                "remesh": {
                    "type": "boolean",
                    "description": "Whether to remesh the output mesh",
                    "default": False,
                    "readOnly": True,
                    "required": False
                },
                "remesh_band": {
                    "type": "integer",
                    "description": "Remesh band parameter (controls remeshing behavior)",
                    "default": 1,
                    "minimum": 0,
                    "maximum": 10,
                    "required": False
                },
                "remesh_project": {
                    "type": "integer",
                    "description": "Remesh project parameter (controls projection)",
                    "default": 0,
                    "minimum": 0,
                    "maximum": 10,
                    "required": False
                },
                "seed": {
                    "type": "integer",
                    "description": "Random seed for reproducibility (None for random)",
                    "default": None,
                    "minimum": 0,
                    "required": False
                }
            }
        }


class Trellis2ImageToTexturedMeshAdapter(Trellis2ImageToRawMeshAdapter):
    """
    Deprecated adapter for TRELLIS.2 image-to-textured-mesh model.

    Legacy model ID alias routing to raw geometry per Docs/TASKS.md Section 4.
    """

    FEATURE_TYPE = "image_to_raw_mesh"
    MODEL_ID = "trellis2_image_to_textured_mesh"

    def __init__(self, *args, **kwargs):
        logger.warning(
            "Trellis2ImageToTexturedMeshAdapter is deprecated. "
            "Routing to raw geometry generation. Texturing is handled by the centralized texture stage."
        )
        super().__init__(*args, **kwargs)


# Backward-compatible aliases for raw geometry generation
Trellis2ImageToMeshAdapter = Trellis2ImageToRawMeshAdapter
TRELLIS2ImageToRawMeshAdapter = Trellis2ImageToRawMeshAdapter
TRELLIS2ImageToMeshAdapter = Trellis2ImageToRawMeshAdapter
TRELLIS2ImageToTexturedMeshAdapter = Trellis2ImageToTexturedMeshAdapter


from adapters.trellis2_paint_adapter import (
    Trellis2ImageMeshPaintingAdapter,
    TRELLIS2ImageMeshPaintingAdapter,
)
