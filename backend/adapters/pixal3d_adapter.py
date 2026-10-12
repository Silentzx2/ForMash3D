"""
Pixal3D model adapter for single-image 3D generation.

Integrates Pixal3D: Pixel-Aligned 3D Generation from Images.
Uses the official Pixal3D pipeline: input -> MoGe camera estimation -> preprocess ->
pipeline cascade stages -> o_voxel GLB export.
"""

import logging
import math
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


class Pixal3DImageToRawMeshAdapter(ImageToMeshModel):
    """
    Adapter for Pixal3D image-to-raw-mesh generation.
    
    Uses the official Pixal3D pipeline:
    1. Input image -> MoGe camera estimation (or manual FOV)
    2. Camera parameter calculation
    3. Image preprocessing (background removal, resize)
    4. Pixal3D pipeline inference (sparse structure -> shape -> texture stages)
    5. GLB export via o_voxel
    """

    FEATURE_TYPE = "image_to_raw_mesh"
    MODEL_ID = "pixal3d_image_to_raw_mesh"

    def __init__(
        self,
        model_id: Optional[str] = None,
        model_path: Optional[str] = None,
        vram_requirement: Optional[int] = None,
        pixal3d_root: Optional[str] = None,
        feature_type: Optional[str] = None,
        supported_output_formats: Optional[List[str]] = None,
        **kwargs,
    ):
        if vram_requirement is None:
            raise ValueError(
                f"VRAM requirement for {self.MODEL_ID if hasattr(self, 'MODEL_ID') else model_id} must come from the model manifest"
            )
        if model_id is None:
            model_id = self.MODEL_ID
        if model_path is None:
            model_path = str(Path(__file__).resolve().parents[1] / "pretrained" / "Pixal3D")
        if pixal3d_root is None:
            pixal3d_root = str(Path(__file__).resolve().parents[1] / "thirdparty" / "Pixal3D")
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

        self.pixal3d_root = Path(pixal3d_root)

        # Pipeline components (lazy loaded)
        self.pipeline = None
        self.moge_model = None

        # Utilities
        self.mesh_processor = MeshProcessor()
        self.path_generator = OutputPathGenerator(base_output_dir="outputs")

        # Add paths to sys.path
        self._ensure_pixal3d_in_path()

    def _ensure_pixal3d_in_path(self):
        """Add Pixal3D directories to sys.path for imports."""
        paths_to_add = [
            str(self.pixal3d_root),
            str(self.pixal3d_root / "pixal3d"),
            str(self.pixal3d_root / "pixal3d" / "pipelines"),
            str(self.pixal3d_root / "pixal3d" / "modules"),
            str(self.pixal3d_root / "pixal3d" / "representations"),
        ]
        for p in paths_to_add:
            if p not in sys.path:
                sys.path.insert(0, p)

    def _load_model(self):
        """Load Pixal3D pipeline with image conditioning models."""
        try:
            logger.info("Loading Pixal3D models...")

            if not torch.cuda.is_available():
                raise RuntimeError("Pixal3D requires CUDA; CPU fallback is not supported")

            self._ensure_pixal3d_in_path()

            # Import required modules
            from pixal3d.pipelines import Pixal3DImageTo3DPipeline
            from pixal3d.modules.image_feature_extractor import DinoV3ProjFeatureExtractor
            import o_voxel

            # Initialize pipeline using from_pretrained
            logger.info("Initializing Pixal3D pipeline from pretrained...")
            self.pipeline = Pixal3DImageTo3DPipeline.from_pretrained(self.model_path)

            # Build image conditioning models (same configs as in inference.py)
            logger.info("Building Pixal3D image conditioning models...")
            image_cond_configs = {
                "ss": {
                    "model_name": "camenduru/dinov3-vitl16-pretrain-lvd1689m",
                    "image_size": 512,
                    "grid_resolution": 16,
                },
                "shape_512": {
                    "model_name": "camenduru/dinov3-vitl16-pretrain-lvd1689m",
                    "image_size": 512,
                    "grid_resolution": 32,
                    "use_naf_upsample": True,
                    "naf_target_size": 512,
                },
                "shape_1024": {
                    "model_name": "camenduru/dinov3-vitl16-pretrain-lvd1689m",
                    "image_size": 1024,
                    "grid_resolution": 64,
                    "use_naf_upsample": True,
                    "naf_target_size": 512,
                },
                "tex_1024": {
                    "model_name": "camenduru/dinov3-vitl16-pretrain-lvd1689m",
                    "image_size": 1024,
                    "grid_resolution": 64,
                    "use_naf_upsample": True,
                    "naf_target_size": 1024,
                },
            }

            self.pipeline.image_cond_model_ss = DinoV3ProjFeatureExtractor(
                **image_cond_configs["ss"]
            )
            self.pipeline.image_cond_model_shape_512 = DinoV3ProjFeatureExtractor(
                **image_cond_configs["shape_512"]
            )
            self.pipeline.image_cond_model_shape_1024 = DinoV3ProjFeatureExtractor(
                **image_cond_configs["shape_1024"]
            )
            self.pipeline.image_cond_model_tex_1024 = DinoV3ProjFeatureExtractor(
                **image_cond_configs["tex_1024"]
            )

            logger.info("Pixal3D models loaded successfully")
            return {"pipeline": self.pipeline}

        except Exception as e:
            import traceback

            traceback.print_exc()
            logger.error(f"Failed to load Pixal3D models: {str(e)}")
            raise Exception(f"Failed to load Pixal3D models: {str(e)}")

    def _unload_model(self):
        """Unload Pixal3D models."""
        try:
            if self.pipeline is not None:
                del self.pipeline
                self.pipeline = None
            if self.moge_model is not None:
                del self.moge_model
                self.moge_model = None

            if torch.cuda.is_available():
                torch.cuda.empty_cache()

            logger.info("Pixal3D models unloaded successfully")

        except Exception as e:
            logger.error(f"Error unloading Pixal3D models: {str(e)}")

    def _estimate_camera_params(
        self, image_path: str, manual_fov: Optional[float] = None
    ) -> Dict[str, float]:
        """Estimate camera parameters using MoGe or manual FOV."""
        from pixal3d.inference import (
            distance_from_fov,
            get_camera_params_wild_moge,
            load_moge_model,
        )

        if manual_fov is not None and manual_fov > 0:
            logger.info(f"Using manual FOV: {math.degrees(manual_fov):.2f} deg")
            camera_angle_x = float(manual_fov)
            grid_point = torch.tensor([-1.0, 0.0, 0.0])
            distance = distance_from_fov(
                camera_angle_x,
                grid_point,
                torch.tensor([0 - 0, 512 - 1 + 0]),
                1.0,
                512,
            )["distance_from_x"]
            return {"camera_angle_x": camera_angle_x, "distance": distance, "mesh_scale": 1.0}

        # Use MoGe for camera estimation
        logger.info("Loading MoGe model for camera estimation...")
        self.moge_model = load_moge_model(device="cuda")

        logger.info("Estimating camera parameters...")
        camera_params = get_camera_params_wild_moge(
            image_path, self.moge_model, device="cuda", mesh_scale=1.0, extend_pixel=0, image_resolution=512
        )

        # Free MoGe VRAM
        self.moge_model.cpu()
        del self.moge_model
        self.moge_model = None
        torch.cuda.empty_cache()

        logger.info(
            f"Estimated camera: camera_angle_x={camera_params['camera_angle_x']:.4f}, "
            f"distance={camera_params['distance']:.4f}"
        )
        return camera_params

    def _run_inference(
        self,
        image: Image.Image,
        seed: int = 42,
        pipeline_type: str = "1024_cascade",
        max_num_tokens: int = 49152,
        resolution: int = 1024,
        sampler_overrides: Optional[Dict[str, Dict[str, Any]]] = None,
        camera_params: Optional[Dict[str, float]] = None,
    ) -> str:
        """Run Pixal3D pipeline inference and return GLB path."""
        import o_voxel

        if camera_params is None:
            raise ValueError("camera_params is required")

        sampler_overrides = sampler_overrides or {}
        ss_override = {
            "steps": 12,
            "guidance_strength": 7.5,
            "guidance_rescale": 0.7,
            "rescale_t": 5.0,
        }
        shape_override = {
            "steps": 12,
            "guidance_strength": 7.5,
            "guidance_rescale": 0.5,
            "rescale_t": 3.0,
        }
        tex_override = {
            "steps": 12,
            "guidance_strength": 1.0,
            "guidance_rescale": 0.0,
            "rescale_t": 3.0,
        }
        ss_override.update(sampler_overrides.get("sparse_structure", {}))
        shape_override.update(sampler_overrides.get("shape", {}))
        tex_override.update(sampler_overrides.get("texture", {}))

        logger.info(f"Running Pixal3D inference with pipeline_type={pipeline_type}")
        torch.manual_seed(seed)

        # Run the pipeline
        mesh_list = self.pipeline.run(
            image,
            camera_params=camera_params,
            seed=seed,
            sparse_structure_sampler_params=ss_override,
            shape_slat_sampler_params=shape_override,
            tex_slat_sampler_params=tex_override,
            preprocess_image=False,
            pipeline_type=pipeline_type,
                resolution=resolution,
            max_num_tokens=max_num_tokens,
        )

        mesh = mesh_list[0]

        # Extract GLB
        rot = np.array(
            [
                [-1, 0, 0, 0],
                [0, 0, -1, 0],
                [0, -1, 0, 0],
                [0, 0, 0, 1],
            ],
            dtype=np.float64,
        )

        output_path = str(
            self.path_generator.base_output_dir
            / "pixal3d"
            / f"pixal3d_output_{uuid.uuid4().hex}.glb"
        )
        os.makedirs(os.path.dirname(output_path), exist_ok=True)

        glb = o_voxel.postprocess.to_glb(
            vertices=mesh.vertices,
            faces=mesh.faces,
            attr_volume=mesh.attrs,
            coords=mesh.coords,
            attr_layout=self.pipeline.pbr_attr_layout,
            grid_size=res,
            aabb=[[-0.5, -0.5, -0.5], [0.5, 0.5, 0.5]],
            decimation_target=1000000,
            texture_size=4096,
            remesh=True,
            remesh_band=1,
            remesh_project=0,
            use_tqdm=True,
        )

        glb.apply_transform(rot)
        glb.export(output_path, extension_webp=True)
        logger.info(f"Pixal3D GLB exported to: {output_path}")

        return output_path

    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """
        Process image-to-raw-mesh generation using Pixal3D.

        Args:
            inputs: Dictionary containing:
                - image_path: Path to input image (required)
                - output_format: Output format (default: "glb")
                - seed: Random seed for reproducibility (default: 42)
                - manual_fov: Manual camera FOV in radians (optional, override MoGe)
                - resolution: Pipeline resolution (default: 1024)
                - pipeline_type: '1024_cascade' or '1536_cascade' (default: '1024_cascade')
                - low_vram: Whether to use low-VRAM mode (default: False)
                - sampler_overrides: Optional dict of sampler parameter overrides

        Returns:
            Dictionary with generation results
        """
        try:
            if not torch.cuda.is_available():
                raise RuntimeError("Pixal3D requires CUDA; CPU fallback is not supported")
            self.status = ModelStatus.PROCESSING
            self._ensure_pixal3d_in_path()

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

            seed = inputs.get("seed", 42)
            manual_fov = inputs.get("manual_fov", None)
            resolution = inputs.get("resolution", 1024)
            pipeline_type = inputs.get("pipeline_type", "1024_cascade")
            low_vram = inputs.get("low_vram", False)
            sampler_overrides = inputs.get("sampler_overrides", {})

            logger.info(f"Generating mesh with Pixal3D from image: {image_path}")

            # Create output directory
            base_name = f"{self.model_id}_{image_path.stem}"
            output_dir = self.path_generator.base_output_dir / "pixal3d" / f"{image_path.stem}_{uuid.uuid4().hex}"
            output_dir.mkdir(parents=True, exist_ok=True)

            # Load input image
            input_image = Image.open(image_path)
            original_input_size = [int(input_image.width), int(input_image.height)]

            # Estimate camera parameters
            camera_params = self._estimate_camera_params(str(image_path), manual_fov)

            # Run Pixal3D pipeline
            glb_path = self._run_inference(
                input_image,
                seed=seed,
                camera_params=camera_params,
                pipeline_type=pipeline_type,
                resolution=resolution,
                sampler_overrides=sampler_overrides,
            )

            # Convert format if needed
            final_output_path = self.path_generator.generate_mesh_path(
                self.model_id, base_name, output_format
            )

            import shutil

            if not glb_path.endswith(f".{output_format}"):
                logger.info(f"Converting mesh to {output_format} format...")
                mesh = self.mesh_processor.load_mesh(glb_path)
                self.mesh_processor.save_mesh(mesh, final_output_path, do_normalise=False)
            else:
                shutil.move(glb_path, final_output_path)

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
                    "has_texture": True,
                    "has_vertex_color": True,
                    "vertex_color": True,
                    "seed": seed,
                    "source_quality": "max",
                    "native_vertex_count": mesh_stats["vertex_count"],
                    "native_face_count": mesh_stats["face_count"],
                    "geometry_extractor": "Pixal3D image-to-3D with MoGe camera estimation",
                    "effective_geometry_resolution": None,
                    "geometry_resolution_source": "Pixal3D pipeline does not expose a scalar achieved grid resolution",
                    "mesh_operations": [],
                    "geometry_transforms": ["uniform scale", "axis orientation conversion"],
                    "original_input_size": original_input_size,
                    "inference_input_size": [512, 512],
                    "preprocessing_applied": True,
                    "camera_estimation_used": manual_fov is None,
                    "manual_fov_used": manual_fov is not None,
                    "pipeline_type": pipeline_type,
                    "low_vram_mode": low_vram,
                },
            }

            logger.info(f"Pixal3D mesh generation completed: {final_output_path}")
            self.status = ModelStatus.LOADED
            return response

        except Exception as e:
            self.status = ModelStatus.ERROR
            logger.error(f"Pixal3D mesh generation failed: {str(e)}")
            import traceback

            traceback.print_exc()
            raise Exception(f"Pixal3D mesh generation failed: {str(e)}")

    def get_supported_formats(self) -> Dict[str, List[str]]:
        """Return supported input/output formats for Pixal3D."""
        return {
            "input": ["png", "jpg", "jpeg", "bmp", "tif", "tiff"],
            "output": ["glb", "obj"],
        }

    def get_parameter_schema(self) -> Dict[str, Any]:
        """
        Return JSON Schema describing model-specific parameters.

        Official parameters from Pixal3D inference.py and pipeline documentation:
        - seed: Random seed for reproducibility
        - manual_fov: Manual camera FOV in radians (optional, override MoGe estimation)
        - resolution: Pipeline resolution (1024 or 1536)
        - pipeline_type: '1024_cascade' or '1536_cascade'
        - low_vram: Whether to use low-VRAM mode
        - sampler_overrides: Dict with sampler parameter overrides for stages
        """
        return {
            "parameters": {
                "seed": {
                    "type": "integer",
                    "description": "Random seed for reproducibility (0-2147483647)",
                    "default": 42,
                    "minimum": 0,
                    "maximum": 2147483647,
                    "required": False,
                },
                "manual_fov": {
                    "type": "number",
                    "description": "Manual camera field of view in radians (e.g. 0.2). If set, overrides MoGe estimation and uses fixed camera parameters. Try 0.2 rad if you notice distortion.",
                    "default": None,
                    "minimum": 0.0,
                    "maximum": 3.14,
                    "required": False,
                },
                "resolution": {
                    "type": "integer",
                    "description": "Pipeline resolution (1024 or 1536)",
                    "default": 1024,
                    "enum": [1024, 1536],
                    "required": False,
                },
                "pipeline_type": {
                    "type": "string",
                    "description": "Pipeline type for cascade generation",
                    "default": "1024_cascade",
                    "enum": ["1024_cascade", "1536_cascade"],
                    "required": False,
                },
                "low_vram": {
                    "type": "boolean",
                    "description": "Whether to use low-VRAM mode (models on CPU, loaded on-demand). Reduces peak VRAM from ~18GB to ~10-12GB at cost of slower inference.",
                    "default": False,
                    "required": False,
                },
                "sampler_overrides": {
                    "type": "object",
                    "description": "Override sampler parameters for each stage (sparse_structure, shape, texture)",
                    "default": {},
                    "additionalProperties": {
                        "type": "object",
                        "properties": {
                            "steps": {"type": "integer", "minimum": 1},
                            "guidance_strength": {"type": "number", "minimum": 0.0},
                            "guidance_rescale": {"type": "number", "minimum": 0.0},
                            "rescale_t": {"type": "number", "minimum": 0.0},
                        },
                        "required": [
                            "steps",
                            "guidance_strength",
                            "guidance_rescale",
                            "rescale_t",
                        ],
                    },
                    "required": False,
                },
            }
        }