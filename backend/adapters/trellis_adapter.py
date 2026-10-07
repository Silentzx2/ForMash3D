"""
TRELLIS model adapter for text-to-mesh generation.

This adapter integrates the TRELLIS model into our mesh generation framework.
"""

import logging
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
import torch
import trimesh
from PIL import Image

from core.models.base import ModelStatus
from core.models.mesh_models import ImageToMeshModel, TextToMeshModel
from core.utils.file_utils import OutputPathGenerator
from core.utils.log_formatters import format_box, format_bytes
from core.utils.thumbnail_utils import generate_mesh_thumbnail
from core.utils.mesh_utils import MeshProcessor

logger = logging.getLogger(__name__)

"""
NOTE: Mesh Painting in TRELLIS expects the mesh in Z-Up conventions
"""


class TrellisTextConditionedMeshAdapterCommon(TextToMeshModel):
    """
    Adapter for TRELLIS text-to-mesh model.

    Integrates the TRELLIS model from the thirdparty/TRELLIS directory
    into our standardized mesh generation framework.
    """

    FEATURE_TYPE = "text_mesh_painting"  # Default for the text-conditioned painting adapter.
    MODEL_ID = "trellis_text_mesh_painting"

    def __init__(
        self,
        model_path: Optional[str] = None,
        vram_requirement: Optional[int] = None,
        trellis_root: Optional[str] = None,
    ):
        if vram_requirement is None:
            vram_requirement = 12000
        # Set default paths
        if model_path is None:
            model_path = str(Path(__file__).resolve().parents[1] / "pretrained" / "TRELLIS")

        if trellis_root is None:
            trellis_root = str(Path(__file__).resolve().parents[1] / "thirdparty" / "TRELLIS")

        super().__init__(
            model_id=self.MODEL_ID,
            model_path=model_path,
            vram_requirement=vram_requirement,
            supported_output_formats=["glb", "obj"],
            feature_type=self.FEATURE_TYPE,
        )

        self.trellis_root = Path(trellis_root)
        self.model_path = Path(model_path)
        self.skip_models = [
            "slat_decoder_rf"
        ]  # Skip some models conditionally to save VRAM
        self.pipeline = None
        self.mesh_processor = MeshProcessor()
        self.path_generator = OutputPathGenerator(base_output_dir="outputs")

        # Add TRELLIS to Python path if not already there
        if str(self.trellis_root) not in sys.path:
            sys.path.insert(0, str(self.trellis_root))

    def _load_model(self):
        """Load the TRELLIS model pipeline."""
        try:
            logger.info(f"Loading TRELLIS model from {self.trellis_root}")

            # Sanitize token env vars: empty/whitespace tokens cause HTTP 401 in torch.hub and huggingface_hub
            for k in ("GITHUB_TOKEN", "GH_TOKEN", "HF_TOKEN", "HUGGINGFACE_TOKEN"):
                if k in os.environ and not os.environ[k].strip():
                    os.environ.pop(k, None)

            # Auto-configure attention backend for pre-Ampere GPUs (T4, V100, RTX 20xx)
            if "ATTN_BACKEND" not in os.environ and torch.cuda.is_available():
                try:
                    major, _ = torch.cuda.get_device_capability()
                    if major < 8:
                        logger.info(f"GPU compute capability {major}.x < 8.0 (pre-Ampere): defaulting TRELLIS to ATTN_BACKEND=sdpa")
                        os.environ["ATTN_BACKEND"] = "sdpa"
                        os.environ["SPARSE_ATTN_BACKEND"] = "sdpa"
                except Exception:
                    pass

            # Import TRELLIS modules
            from trellis.pipelines import TrellisTextTo3DPipeline
            from trellis.utils import postprocessing_utils

            # Initialize the pipeline
            self.pipeline: TrellisTextTo3DPipeline = (
                TrellisTextTo3DPipeline.from_pretrained(
                    "microsoft/TRELLIS-text-xlarge",
                    cache_dir=str(self.model_path / "TRELLIS-text-xlarge"),
                )
            )
            self.pipeline.cuda()
            self.postprocessing_utils = postprocessing_utils

            logger.info("TRELLIS model loaded successfully")
            return self.pipeline

        except Exception as e:
            if ("401" in str(e) or "Unauthorized" in str(e)) and ("GITHUB_TOKEN" in os.environ or "GH_TOKEN" in os.environ):
                logger.warning("TRELLIS text load failed with 401 Unauthorized; retrying without GITHUB_TOKEN...")
                os.environ.pop("GITHUB_TOKEN", None)
                os.environ.pop("GH_TOKEN", None)
                return self._load_model()
            logger.error(f"Failed to load TRELLIS model: {str(e)}")
            raise Exception(f"Failed to load TRELLIS model: {str(e)}")

    def _unload_model(self):
        """Unload the TRELLIS model."""
        try:
            if self.pipeline is not None:
                # Move to CPU and clear cache
                self.pipeline.cpu()
                del self.pipeline
                self.pipeline = None

                # Clear CUDA cache
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()

                logger.info("TRELLIS model unloaded successfully")

        except Exception as e:
            logger.error(f"Error unloading TRELLIS model: {str(e)}")

    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """
        Process text-to-mesh generation using TRELLIS.

        Args:
            inputs: Dictionary containing:
                - text_prompt: Text description (required)
                - texture_text_prompt: Text description for texture generation
                - quality: Generation quality ("low",  "high")
                - texture_resolution: Texture resolution
                - output_format: Output format
                - seed: Random seed for reproducibility
                - mesh_path: Optional input path of the mesh

        Returns:
            Dictionary with generated mesh information
        """
        try:
            # Validate inputs using parent class
            output_format = self._validate_common_inputs(inputs)

            # Extract parameters
            text_prompt = inputs["text_prompt"]
            mesh_path = inputs.get("mesh_path", "")
            texture_text_prompt = inputs.get("texture_text_prompt", "")
            seed = inputs.get("seed", 42)
            texture_resolution = inputs.get("texture_resolution", 2048)
            num_steps = inputs.get("num_inference_steps", 25)
            if num_steps is None:
                num_steps = 25
            target_polycount = inputs.get("target_polycount", None)
            simplify = inputs.get("simplify", None)
            auto_optimize = bool(inputs.get("auto_optimize", False))
            texture_bake_mode = inputs.get("texture_bake_mode", "opt")
            guidance = inputs.get("guidance_scale", 7.5)
            if guidance is None:
                guidance = 7.5

            ss_steps = max(1, min(50, int(num_steps)))
            slat_steps = max(1, min(50, int(num_steps)))

            logger.info(f"Generating high-fidelity mesh with TRELLIS for prompt: '{text_prompt}' (steps={ss_steps}, res={texture_resolution})")

            # Set random seed for reproducibility
            torch.manual_seed(seed)
            if torch.cuda.is_available():
                torch.cuda.manual_seed(seed)

            # Different Conditions
            if mesh_path:
                input_mesh = trimesh.load(mesh_path, force="mesh")
                # Notice that the input is assumed to be Y-UP, but trellis mesh painting requires it to be Z-UP
                # Convert mesh from y-up to z-up coordinate system
                # Transformation matrix: [[1,0,0,0], [0,0,1,0], [0,-1,0,0], [0,0,0,1]]
                transform = np.array([
                    [1, 0, 0, 0],
                    [0, 0, -1, 0],
                    [0, 1, 0, 0],
                    [0, 0, 0, 1]
                ])
                input_mesh.apply_transform(transform)
                logger.info(f"Loaded input mesh from {mesh_path} and converted from z-up to y-up")
                outputs = self.pipeline.run_variant(
                    input_mesh,
                    prompt=text_prompt,
                    slat_sampler_params={"steps": slat_steps, "cfg_strength": 3.0},
                    formats=["gaussian"],
                )
                # get ready for later texturing
                mesh = input_mesh
            else:
                logger.info(
                    "\n" + format_box(
                        "TRELLIS: PIPELINE SAMPLING",
                        [
                            ("Text Prompt", text_prompt or str(mesh_path)),
                            ("Texture Prompt", texture_text_prompt or "None"),
                            ("Sparse Structure Steps", ss_steps),
                            ("SLAT Steps", slat_steps),
                            ("Guidance Scale (CFG)", guidance),
                            ("Seed", seed),
                            ("Texture Resolution", f"{texture_resolution}x{texture_resolution}"),
                        ],
                    )
                )
                # Generate 3D representation
                outputs = self.pipeline.run(
                    text_prompt,
                    texture_prompt=texture_text_prompt,
                    sparse_structure_sampler_params={"steps": ss_steps, "cfg_strength": guidance},
                    slat_sampler_params={"steps": slat_steps, "cfg_strength": 3.0},
                    seed=seed,
                    formats=["gaussian", "mesh"],
                )
                mesh = None

            candidate_mesh = mesh or outputs["mesh"][0]
            if simplify is None:
                # Raw-generation mode keeps the model-native mesh intact; optimization belongs to post-processing.
                simplify = 0.0

            # Extract mesh from Gaussian representation
            # For raw extraction, disable post-processing (hole filling + mincut) to preserve micro-details
            postprocess_mode = "none" if simplify == 0.0 else "simplify"
            fill_holes = simplify != 0.0
            
            mesh = self.postprocessing_utils.to_trimesh(
                outputs["gaussian"][0],
                candidate_mesh,
                simplify=simplify,
                fill_holes=fill_holes,
                texture_size=texture_resolution,
                texture_bake_mode=texture_bake_mode,
                forward_rot=True,
                postprocess_mode=postprocess_mode,
            )

            # Save mesh in requested format
            output_path = self._generate_output_path(text_prompt, output_format)
            self.mesh_processor.save_mesh(mesh, output_path, do_normalise=False)

            logger.info(
                "\n" + format_box(
                    "TRELLIS: MESH CONVERTED",
                    [
                        ("Output Faces", f"{len(mesh.faces):,} faces"),
                        ("Output Vertices", f"{len(mesh.vertices):,} vertices"),
                        ("Output Path", str(output_path)),
                        ("Output Size", format_bytes(os.path.getsize(output_path)) if os.path.exists(output_path) else "N/A"),
                    ],
                )
            )

            # Generate thumbnail
            thumbnail_path = self._generate_thumbnail_path(output_path)
            thumbnail_generated = generate_mesh_thumbnail(
                str(output_path), str(thumbnail_path)
            )

            # Create response
            response = self._create_common_response(inputs, output_format)
            response.update(
                {
                    "output_mesh_path": str(output_path),
                    "thumbnail_path": str(thumbnail_path)
                    if thumbnail_generated
                    else None,
                    "generation_info": {
                        "model": "TRELLIS",
                        "text_prompt": text_prompt,
                        "texture_prompt": texture_text_prompt,
                        "seed": seed,
                        "num_inference_steps": ss_steps,
                        "ss_sampling_steps": ss_steps,
                        "slat_sampling_steps": slat_steps,
                        "guidance_scale": guidance,
                        "vertex_count": len(mesh.vertices),
                        "face_count": len(mesh.faces),
                        "texture_resolution": texture_resolution,
                        "texture_bake_mode": texture_bake_mode,
                        "simplify_ratio": simplify,
                        "thumbnail_generated": thumbnail_generated,
                        "slat_cfg_strength": 3.0,
                        "texture_size": texture_resolution,
                        "bake_mode": texture_bake_mode,
                    },
                }
            )

            logger.info(f"TRELLIS mesh generation completed: {output_path}")
            self.status = ModelStatus.LOADED
            return response

        except Exception as e:
            self.status = ModelStatus.ERROR
            logger.error(f"TRELLIS mesh generation failed: {str(e)}")
            raise Exception(f"TRELLIS mesh generation failed: {str(e)}")

    def _get_output_mesh_path(self, safe_name: str, output_format: str) -> Path:
        return Path(
            self.path_generator.generate_mesh_path(
                self.model_id, safe_name, output_format
            )
        )

    def _generate_output_path(self, prompt: str, output_format: str) -> Path:
        """Generate output file path based on prompt and format."""
        safe_name = "".join(
            c for c in prompt[:50] if c.isalnum() or c in (" ", "_")
        ).strip().replace(" ", "_")
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
        """Return supported input/output formats for TRELLIS."""
        return {"input": ["text"], "output": ["glb", "obj"]}
    
    def get_parameter_schema(self) -> Dict[str, Any]:
        """
        Return JSON Schema describing model-specific parameters.
        
        Returns:
            Parameter schema dictionary
        """
        return {
            "parameters": {
                "seed": {
                    "type": "integer",
                    "description": "Random seed for reproducibility",
                    "default": 42,
                    "minimum": 0,
                    "required": False
                },
                "ss_sampling_steps": {
                    "type": "integer",
                    "description": "Sparse structure sampling steps (official text demo default: 25)",
                    "default": 25,
                    "minimum": 1,
                    "maximum": 50,
                    "required": False
                },
                "slat_sampling_steps": {
                    "type": "integer",
                    "description": "Structured latent sampling steps (official text demo default: 25)",
                    "default": 25,
                    "minimum": 1,
                    "maximum": 50,
                    "required": False
                },
                "texture_resolution": {
                    "type": "integer",
                    "description": "Output texture resolution for source generation",
                    "default": 2048,
                    "enum": [512, 1024, 2048, 4096],
                    "required": False
                },
                "simplify": {
                    "type": "number",
                    "description": "Mesh simplification ratio (0 for raw native output, or 0.01-1.0)",
                    "default": 0.0,
                    "minimum": 0.0,
                    "maximum": 1.0,
                    "required": False
                },
                "texture_bake_mode": {
                    "type": "string",
                    "description": "Texture baking quality mode",
                    "default": "opt",
                    "enum": ["fast", "opt"],
                    "required": False
                }
            }
        }


class TrellisImageToMeshAdapterCommon(ImageToMeshModel):
    """
    Adapter for TRELLIS image-to-mesh model.

    Integrates the TRELLIS model from the thirdparty/TRELLIS directory
    into our standardized mesh generation framework.
    """

    FEATURE_TYPE = "image_to_textured_mesh"
    MODEL_ID = "trellis_image_to_textured_mesh"

    def __init__(
        self,
        model_path: Optional[str] = None,
        vram_requirement: Optional[int] = None,
        trellis_root: Optional[str] = None,
    ):
        if vram_requirement is None:
            vram_requirement = 12000
        # Set default paths
        if model_path is None:
            model_path = str(Path(__file__).resolve().parents[1] / "pretrained" / "TRELLIS")

        if trellis_root is None:
            trellis_root = str(Path(__file__).resolve().parents[1] / "thirdparty" / "TRELLIS")

        super().__init__(
            model_id=self.MODEL_ID,
            model_path=model_path,
            vram_requirement=vram_requirement,
            supported_output_formats=["glb", "obj"],
            feature_type=self.FEATURE_TYPE,
        )

        self.trellis_root = Path(trellis_root)
        self.model_path = Path(model_path)
        # skip some models conditionally to save VRAM (overwrite by subclass adapaters)
        self.skip_models = ["slat_decoder_rf"]
        self.pipeline = None
        self.mesh_processor = MeshProcessor()
        self.path_generator = OutputPathGenerator(base_output_dir="outputs")
        # Add TRELLIS to Python path if not already there
        if str(self.trellis_root) not in sys.path:
            sys.path.insert(0, str(self.trellis_root))

    def _load_model(self):
        """Load the TRELLIS model pipeline."""
        try:
            logger.info(f"Loading TRELLIS model from {self.trellis_root}")

            # Sanitize token env vars: empty/whitespace tokens cause HTTP 401 in torch.hub and huggingface_hub
            for k in ("GITHUB_TOKEN", "GH_TOKEN", "HF_TOKEN", "HUGGINGFACE_TOKEN"):
                if k in os.environ and not os.environ[k].strip():
                    os.environ.pop(k, None)

            # Auto-configure attention backend for pre-Ampere GPUs (T4, V100, RTX 20xx)
            if "ATTN_BACKEND" not in os.environ and torch.cuda.is_available():
                try:
                    major, _ = torch.cuda.get_device_capability()
                    if major < 8:
                        logger.info(f"GPU compute capability {major}.x < 8.0 (pre-Ampere): defaulting TRELLIS to ATTN_BACKEND=sdpa")
                        os.environ["ATTN_BACKEND"] = "sdpa"
                        os.environ["SPARSE_ATTN_BACKEND"] = "sdpa"
                except Exception:
                    pass

            # Import TRELLIS modules
            from trellis.pipelines import TrellisImageTo3DPipeline
            from trellis.utils import postprocessing_utils

            # Initialize the pipeline
            pretrained_id = "microsoft/TRELLIS-image-large"
            local_checkpoint = self.model_path / "TRELLIS-image-large"
            if local_checkpoint.exists():
                logger.info(f"Loading local TRELLIS checkpoint from {local_checkpoint}...")
                self.pipeline = TrellisImageTo3DPipeline.from_pretrained(
                    str(local_checkpoint),
                    skip_models=self.skip_models,
                )
            elif self.model_path.exists():
                logger.info(f"Loading TRELLIS with cache_dir {self.model_path}...")
                self.pipeline = TrellisImageTo3DPipeline.from_pretrained(
                    pretrained_id,
                    cache_dir=str(self.model_path),
                    skip_models=self.skip_models,
                )
            else:
                logger.info(f"Loading TRELLIS from HuggingFace ({pretrained_id})...")
                self.pipeline = TrellisImageTo3DPipeline.from_pretrained(
                    pretrained_id,
                    skip_models=self.skip_models,
                )
            self.pipeline.cuda()

            # Store utility modules for later use
            self.postprocessing_utils = postprocessing_utils

            logger.info("✓ TRELLIS model loaded successfully into GPU memory")
            return self.pipeline

        except Exception as e:
            if ("401" in str(e) or "Unauthorized" in str(e)) and ("GITHUB_TOKEN" in os.environ or "GH_TOKEN" in os.environ):
                logger.warning("TRELLIS image load failed with 401 Unauthorized; retrying without GITHUB_TOKEN...")
                os.environ.pop("GITHUB_TOKEN", None)
                os.environ.pop("GH_TOKEN", None)
                return self._load_model()
            logger.error(f"Failed to load TRELLIS model: {str(e)}")
            raise Exception(f"Failed to load TRELLIS model: {str(e)}")

    def _unload_model(self):
        """Unload the TRELLIS model."""
        try:
            if self.pipeline is not None:
                # Move to CPU and clear cache
                self.pipeline.cpu()
                del self.pipeline
                self.pipeline = None

                # Clear CUDA cache
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()

                logger.info("TRELLIS model unloaded successfully")

        except Exception as e:
            logger.error(f"Error unloading TRELLIS model: {str(e)}")

    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """
        Process image-to-mesh generation using TRELLIS.

        Args:
            inputs: Dictionary containing:
                - image_path: Text description (required)
                - texture_resolution: Texture resolution
                - output_format: Output format
                - seed: Random seed for reproducibility

        Returns:
            Dictionary with generated mesh information
        """
        try:
            if self.pipeline is None:
                raise ValueError("TRELLIS model is not loaded")

            # Validate inputs using parent class
            output_format = self._validate_common_inputs(inputs)

            # Extract parameters
            image_path = inputs["image_path"]
            seed = inputs.get("seed", 42)
            texture_resolution = inputs.get("texture_resolution", 2048)
            num_steps = inputs.get("num_inference_steps", 25)
            target_polycount = inputs.get("target_polycount", None)
            mesh_path = inputs.get("mesh_path", None)
            simplify = inputs.get("simplify", None)
            auto_optimize = bool(inputs.get("auto_optimize", False))
            tex_bake_mode = inputs.get("texture_bake_mode", "opt")
            guidance = inputs.get("guidance_scale", 7.5)

            ss_steps = int(inputs.get("ss_sampling_steps", inputs.get("num_inference_steps", 12)))
            slat_steps = int(inputs.get("slat_sampling_steps", inputs.get("num_inference_steps", 12)))
            ss_steps = max(1, min(50, ss_steps))
            slat_steps = max(1, min(50, slat_steps))

            logger.info(f"Generating high-fidelity mesh with TRELLIS for image path: '{image_path}' (ss_steps={ss_steps}, slat_steps={slat_steps}, res={texture_resolution})")

            # Set random seed for reproducibility
            torch.manual_seed(seed)
            if torch.cuda.is_available():
                torch.cuda.manual_seed(seed)

            # Generate 3D representation
            if mesh_path:
                input_mesh = trimesh.load(mesh_path, force="mesh")
                # Notice that the input is assumed to be Y-UP, but trellis mesh painting requires it to be Z-UP
                # Convert mesh from y-up to z-up coordinate system
                # Transformation matrix: [[1,0,0,0], [0,0,-1,0], [0,1,0,0], [0,0,0,1]]
                transform = np.array([
                    [1, 0, 0, 0],
                    [0, 0, -1, 0],
                    [0, 1, 0, 0],
                    [0, 0, 0, 1]
                ])
                input_mesh.apply_transform(transform)
                logger.info(f"Loaded input mesh from {mesh_path} and converted from z-up to y-up")
                # do the voxelization
                outputs = self.pipeline.run_detail_variation(
                    input_mesh,
                    Image.open(image_path),
                    seed=seed,
                    slat_sampler_params={"steps": slat_steps, "cfg_strength": 3.0},
                    formats=["gaussian"],
                )
                # get ready for later texturing
                mesh = input_mesh
            else:
                outputs = self.pipeline.run(
                    Image.open(image_path),
                    preprocess_image=True,
                    sparse_structure_sampler_params={"steps": ss_steps, "cfg_strength": guidance},
                    slat_sampler_params={"steps": slat_steps, "cfg_strength": 3.0},
                    seed=seed,
                    formats=["gaussian", "mesh"],
                )
                mesh = None

            candidate_mesh = mesh or outputs["mesh"][0]
            if simplify is None:
                # Raw-generation mode keeps the model-native mesh intact; optimization belongs to post-processing.
                simplify = 0.0

            # Extract mesh from Gaussian representation
            # For raw extraction, disable post-processing (hole filling + mincut) to preserve micro-details
            postprocess_mode = "none" if simplify == 0.0 else "simplify"
            fill_holes = simplify != 0.0
            
            mesh = self.postprocessing_utils.to_trimesh(
                outputs["gaussian"][0],
                candidate_mesh,
                simplify=simplify,
                fill_holes=fill_holes,
                texture_size=texture_resolution,
                texture_bake_mode=tex_bake_mode,
                forward_rot=True,
                postprocess_mode=postprocess_mode,
            )

            # Save mesh in requested format
            output_path = self._generate_output_path(
                image_path, output_format, is_prompt=False
            )
            self.mesh_processor.save_mesh(mesh, output_path, do_normalise=False)

            # Generate thumbnail
            thumbnail_path = self._generate_thumbnail_path(output_path)
            thumbnail_generated = generate_mesh_thumbnail(
                str(output_path), str(thumbnail_path)
            )

            # Create response
            response = self._create_common_response(inputs, output_format)
            response.update(
                {
                    "output_mesh_path": str(output_path),
                    "thumbnail_path": str(thumbnail_path)
                    if thumbnail_generated
                    else None,
                    "generation_info": {
                        "model": "TRELLIS",
                        "image_path": image_path,
                        "seed": seed,
                        "num_inference_steps": ss_steps,
                        "ss_sampling_steps": ss_steps,
                        "slat_sampling_steps": slat_steps,
                        "guidance_scale": guidance,
                        "vertex_count": len(mesh.vertices),
                        "face_count": len(mesh.faces),
                        "texture_resolution": texture_resolution,
                        "texture_bake_mode": tex_bake_mode,
                        "simplify_ratio": simplify,
                        "thumbnail_generated": thumbnail_generated,
                        "slat_cfg_strength": 3.0,
                        "texture_size": texture_resolution,
                        "bake_mode": tex_bake_mode,
                    },
                }
            )

            logger.info(f"TRELLIS mesh generation completed: {output_path}")
            self.status = ModelStatus.LOADED
            return response

        except Exception as e:
            import traceback

            traceback.print_exc()
            self.status = ModelStatus.ERROR
            logger.error(f"TRELLIS mesh generation failed: {str(e)}")
            raise Exception(f"TRELLIS mesh generation failed: {str(e)}")

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
        """Return supported input/output formats for TRELLIS."""
        return {"input": ["str"], "output": ["glb", "obj"]}
    
    def get_parameter_schema(self) -> Dict[str, Any]:
        """
        Return JSON Schema describing model-specific parameters.
        
        Returns:
            Parameter schema dictionary
        """
        return {
            "parameters": {
                "seed": {
                    "type": "integer",
                    "description": "Random seed for reproducibility",
                    "default": 42,
                    "minimum": 0,
                    "required": False
                },
                "ss_sampling_steps": {
                    "type": "integer",
                    "description": "Sparse structure sampling steps (official default: 12)",
                    "default": 12,
                    "minimum": 1,
                    "maximum": 50,
                    "required": False
                },
                "slat_sampling_steps": {
                    "type": "integer",
                    "description": "Structured latent sampling steps (official default: 12)",
                    "default": 12,
                    "minimum": 1,
                    "maximum": 50,
                    "required": False
                },
                "texture_resolution": {
                    "type": "integer",
                    "description": "Output texture resolution for source generation",
                    "default": 2048,
                    "enum": [512, 1024, 2048, 4096],
                    "required": False
                },
                "simplify": {
                    "type": "number",
                    "description": "Mesh simplification ratio (0 for raw native output, or 0.01-1.0)",
                    "default": 0.0,
                    "minimum": 0.0,
                    "maximum": 1.0,
                    "required": False
                },
                "texture_bake_mode": {
                    "type": "string",
                    "description": "Texture baking quality mode",
                    "default": "opt",
                    "enum": ["fast", "opt"],
                    "required": False
                }
            }
        }


class TrellisTextMeshPaintingAdapter(TrellisTextConditionedMeshAdapterCommon):
    """
    Adapter for TRELLIS text-conditioned mesh painting model.

    This adapter uses the TRELLIS model to texture meshes from text prompts.
    """

    FEATURE_TYPE = "text_mesh_painting"  # Feature type for this adapter
    MODEL_ID = "trellis_text_mesh_painting"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.supported_output_formats = ["obj", "glb"]
        self.skip_models = [
            "sparse_structure_decoder",
            "sparse_structure_flow_model",
            "slat_decoder_mesh",
        ]

    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """
        Process text-conditioned mesh generation using TRELLIS.
        """
        try:
            # override the simplify parameter (don't do decimation on the painting task)
            inputs["simplify"] = 0.0
            return super()._process_request(inputs)
        except Exception as e:
            logger.error(f"TRELLIS text-to-mesh generation failed: {str(e)}")
            raise Exception(f"TRELLIS text-to-mesh generation failed: {str(e)}")


class TrellisImageToTexturedMeshAdapter(TrellisImageToMeshAdapterCommon):
    """
    Adapter for TRELLIS image-to-textured-mesh model.

    This adapter uses the TRELLIS model to generate textured meshes from input images
    """

    FEATURE_TYPE = "image_to_textured_mesh"
    MODEL_ID = "trellis_image_to_textured_mesh"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.skip_models = ["slat_decoder_rf"]


class TrellisImageToRawMeshAdapter(TrellisImageToMeshAdapterCommon):
    """
    Adapter for TRELLIS image-to-raw-mesh model.

    This adapter uses the TRELLIS model to generate meshes from input images.
    """

    FEATURE_TYPE = "image_to_raw_mesh"
    MODEL_ID = "trellis_image_to_raw_mesh"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.skip_models = ["slat_decoder_rf"]


class TrellisImageMeshPaintingAdapter(TrellisImageToMeshAdapterCommon):
    """
    Adapter for TRELLIS image conditioned mesh painting model.

    This adapter uses the TRELLIS model to conditionally paint meshes based on input images.
    """

    FEATURE_TYPE = "image_mesh_painting"
    MODEL_ID = "trellis_image_mesh_painting"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.skip_models = [
            "sparse_structure_decoder",
            "sparse_structure_flow_model",
            "slat_decoder_mesh",
        ]

    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """
        Process image-conditioned texture generation using TRELLIS.
        """
        try:
            # override the simplify parameter (don't do decimation on the painting task)
            inputs["simplify"] = 0.0
            return super()._process_request(inputs)
        except Exception as e:
            logger.error(f"TRELLIS image-conditioned texture generation failed: {str(e)}")
            raise Exception(f"TRELLIS image-conditioned texture generation failed: {str(e)}")


# Aliases matching various naming conventions
TRELLISImageToTexturedMeshAdapter = TrellisImageToTexturedMeshAdapter
TRELLISImageToRawMeshAdapter = TrellisImageToRawMeshAdapter
TRELLISTextConditionedMeshAdapterCommon = TrellisTextConditionedMeshAdapterCommon
TRELLISImageToMeshAdapterCommon = TrellisImageToMeshAdapterCommon
TRELLISImageMeshPaintingAdapter = TrellisImageMeshPaintingAdapter
TRELLISTextMeshPaintingAdapter = TrellisTextMeshPaintingAdapter

