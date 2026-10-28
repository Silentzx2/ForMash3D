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
from copy import deepcopy
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import torch
from PIL import Image

from core.models.base import ModelStatus
from core.models.mesh_models import ImageToMeshModel
from core.utils.file_utils import OutputPathGenerator
from core.utils.mesh_utils import MeshProcessor

logger = logging.getLogger(__name__)


_PIXAL_INFERENCE_MODULE_NAME = "_formesh3d_pixal3d_inference"


def _load_pixal3d_inference_module(pixal3d_root: Path) -> Optional[Any]:
    """Load camera helpers from the custom Pixal3D checkout under a collision-safe name."""
    import importlib.util

    inference_path = (Path(pixal3d_root) / "inference.py").resolve()
    if not inference_path.is_file():
        return None

    cached = sys.modules.get(_PIXAL_INFERENCE_MODULE_NAME)
    cached_path = getattr(cached, "__file__", None) if cached is not None else None
    if cached_path and Path(cached_path).resolve() == inference_path:
        return cached

    spec = importlib.util.spec_from_file_location(
        _PIXAL_INFERENCE_MODULE_NAME, str(inference_path)
    )
    if spec is None or spec.loader is None:
        raise ImportError(f"Unable to load Pixal3D inference helpers from {inference_path}")

    module = importlib.util.module_from_spec(spec)
    sys.modules[_PIXAL_INFERENCE_MODULE_NAME] = module
    try:
        spec.loader.exec_module(module)
    except Exception:
        sys.modules.pop(_PIXAL_INFERENCE_MODULE_NAME, None)
        raise
    return module

# LOCKED / ACTIVE: values used by inference.
# BASELINE: previous effective runtime values (source_quality="max", resolution=2048, pipeline_type="1536_cascade", sampler_overrides: sparse_structure/100/10.0/0.9/8.0, shape/100/10.0/0.8/8.0, texture/100/3.5/0.5/8.0, low_vram=false)
# EXPERIMENTAL: selected experimental values, snapshot (2026-10-20) for stress-test; use only for benchmarking.
# SUPPORTED BY: Pixal3D adapter, EXPERIMENTAL-MODEL-SETTINGS.md section "Pixal3D".
# ROLLBACK: previous effective values; scheduler strips frontend overrides before adapter applies lock.
# SHORTCUT / PIPELINE STABILITY TEST: Low resolution (512) and 1 step for ultra-fast validation (~5s).
# AFTER PIPELINE IS STABLE: Change "resolution" back to 2048 and sampler "steps" back to 100!
_LOCKED_INFERENCE_PROFILE = {
    "source_quality": "max",
    "resolution": 512,  # AFTER PIPELINE IS STABLE: Change back to 2048
    "pipeline_type": "1536_cascade",
    "max_num_tokens": 524288,
    "sampler_overrides": {
        "sparse_structure": {
            "steps": 1,  # AFTER PIPELINE IS STABLE: Change back to 100
            "guidance_strength": 10.0,
            "guidance_rescale": 0.9,
            "rescale_t": 8.0,
        },
        "shape": {
            "steps": 1,  # AFTER PIPELINE IS STABLE: Change back to 100
            "guidance_strength": 10.0,
            "guidance_rescale": 0.8,
            "rescale_t": 8.0,
        },
        "texture": {
            "steps": 1,  # AFTER PIPELINE IS STABLE: Change back to 100
            "guidance_strength": 3.5,
            "guidance_rescale": 0.5,
            "rescale_t": 8.0,
        },
    },
    "low_vram": False,
}


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
            str(self.pixal3d_root / "pixal3d" / "trainers"),
            str(self.pixal3d_root / "pixal3d" / "trainers" / "flow_matching" / "mixins"),
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

            # Put Hugging Face and Torch Hub caches under the project pretrained tree.
            # Model inference must not depend on ~/.cache being writable in containers.
            if self.model_path.is_absolute() or self.model_path.exists():
                cache_root = self.model_path.parent.resolve()
            else:
                cache_root = (Path(__file__).resolve().parents[1] / "pretrained").resolve()
            hf_cache_dir = cache_root / "huggingface"
            torch_hub_cache_dir = cache_root / "torch_hub"
            try:
                for cache_dir in (hf_cache_dir, torch_hub_cache_dir):
                    cache_dir.mkdir(parents=True, exist_ok=True)
                    probe = cache_dir / (".write-check-" + uuid.uuid4().hex)
                    try:
                        probe.write_bytes(b"ok")
                    finally:
                        probe.unlink(missing_ok=True)
            except OSError as cache_err:
                raise PermissionError(
                    f"Pixal3D requires writable model cache directories under {cache_root}: {cache_err}"
                ) from cache_err

            import torch.hub
            torch.hub.set_dir(str(torch_hub_cache_dir))

            # Import required modules
            from pixal3d.pipelines import Pixal3DImageTo3DPipeline
            try:
                from pixal3d.trainers.flow_matching.mixins.image_conditioned_proj import DinoV3ProjFeatureExtractor
            except ImportError:
                from pixal3d.modules.image_feature_extractor import DinoV3ProjFeatureExtractor
            import o_voxel

            # When configured with a local absolute path, report an incomplete download clearly
            # instead of letting the custom loader reinterpret that path as a Hugging Face repo ID.
            if self.model_path.is_absolute() and not (self.model_path / "pipeline.json").is_file():
                raise FileNotFoundError(
                    f"Pixal3D checkpoint is missing pipeline.json at {self.model_path}. "
                    "Download it with the project's model downloader before loading Pixal3D."
                )

            # Initialize pipeline using from_pretrained
            logger.info("Initializing Pixal3D pipeline from pretrained...")
            self.pipeline = Pixal3DImageTo3DPipeline.from_pretrained(str(self.model_path))

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
            for config in image_cond_configs.values():
                config["cache_dir"] = str(hf_cache_dir)

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

            # Determine primary device
            device = getattr(self, "device", None)
            if device is None or device.startswith("cpu"):
                device = f"cuda:{self.gpu_id}" if getattr(self, "gpu_id", None) is not None else "cuda:0"
            self.device = device

            # Determine if low-VRAM mode should be activated
            strategy = (getattr(self, "resource_plan", None) or {}).get("strategy", "")
            use_low_vram = strategy == "single_gpu_low_vram"

            gpu_ids = getattr(self, "gpu_ids", [])
            is_multi_gpu = len(gpu_ids) > 1

            if not is_multi_gpu and not use_low_vram:
                try:
                    gpu_idx = self.gpu_id if getattr(self, "gpu_id", None) is not None else 0
                    props = torch.cuda.get_device_properties(gpu_idx)
                    total_vram_mb = props.total_memory / (1024 * 1024)
                    if total_vram_mb < 18432:
                        logger.info(
                            "Single GPU %s VRAM (%.0fMB) is less than 18GB; enabling low-VRAM mode",
                            gpu_idx,
                            total_vram_mb,
                        )
                        use_low_vram = True
                except Exception as ex:
                    logger.debug("Could not query GPU properties: %s", ex)

            self.low_vram_mode = use_low_vram

            if is_multi_gpu:
                from core.scheduler.resource_planner import ResourcePlan, dispatch_pipeline_across_gpus
                rp = getattr(self, "resource_plan", None) or {}
                self.pipeline.low_vram = False
                self.pipeline._device = torch.device(device)
                dispatch_pipeline_across_gpus(
                    self.pipeline,
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
                # Keep each projector beside the flow model that consumes its output.
                # The custom pipeline moves conditioning tensors between stage devices,
                # while its projection grid/camera tensors must share the encoder device.
                condition_stages = (
                    ("sparse_structure_flow_model", "image_cond_model_ss"),
                    ("shape_slat_flow_model_512", "image_cond_model_shape_512"),
                    ("shape_slat_flow_model_1024", "image_cond_model_shape_1024"),
                    ("tex_slat_flow_model_1024", "image_cond_model_tex_1024"),
                )
                models_by_name = getattr(self.pipeline, "models", {})
                for idx, (flow_name, cond_attr) in enumerate(condition_stages):
                    cond_model = getattr(self.pipeline, cond_attr, None)
                    if cond_model is None or not callable(getattr(cond_model, "to", None)):
                        raise RuntimeError(
                            f"Pixal3D condition model {cond_attr!r} was not initialized"
                        )

                    fallback_device = f"cuda:{self.gpu_ids[idx % len(self.gpu_ids)]}"
                    flow_model = (
                        models_by_name.get(flow_name)
                        if isinstance(models_by_name, dict)
                        else None
                    )
                    target_device = fallback_device
                    if flow_model is not None and callable(getattr(flow_model, "parameters", None)):
                        try:
                            target_device = str(next(flow_model.parameters()).device)
                        except StopIteration:
                            pass

                    if target_device != "cuda" and not target_device.startswith("cuda:"):
                        raise RuntimeError(
                            f"Pixal3D flow stage {flow_name!r} was not dispatched to CUDA "
                            f"(device={target_device})"
                        )
                    try:
                        cond_model.to(target_device)
                    except Exception as ex:
                        logger.exception(
                            "Failed placing Pixal3D condition model %s beside %s on %s",
                            cond_attr,
                            flow_name,
                            target_device,
                        )
                        raise RuntimeError(
                            f"Could not place Pixal3D condition model {cond_attr!r} "
                            f"on flow stage device {target_device}"
                        ) from ex
                    logger.info(
                        "Placed Pixal3D condition model %s beside %s on %s",
                        cond_attr,
                        flow_name,
                        target_device,
                    )
                for attr in [
                    "image_cond_model_ss",
                    "image_cond_model_shape_512",
                    "image_cond_model_shape_1024",
                    "image_cond_model_tex_1024",
                ]:
                    m = getattr(self.pipeline, attr, None)
                    if m is not None and getattr(m, "use_naf_upsample", False) and hasattr(m, "_load_naf"):
                        try:
                            m._load_naf()
                        except Exception as e:
                            logger.exception("Pixal3D required NAF upsampler failed to load")
                            raise RuntimeError("Pixal3D failed to load a required NAF upsampler") from e
                logger.info("Pixal3D pipeline dispatched across GPUs %s", self.gpu_ids)
            elif use_low_vram:
                self.pipeline._device = torch.device(device)
                self.pipeline.low_vram = True
                for attr in [
                    "image_cond_model_ss",
                    "image_cond_model_shape_512",
                    "image_cond_model_shape_1024",
                    "image_cond_model_tex_1024",
                ]:
                    m = getattr(self.pipeline, attr, None)
                    if m is not None and getattr(m, "use_naf_upsample", False) and hasattr(m, "_load_naf"):
                        try:
                            m._load_naf()
                        except Exception as e:
                            logger.exception("Pixal3D required NAF upsampler failed to pre-load in low-VRAM mode")
                            raise RuntimeError("Pixal3D failed to pre-load a required NAF upsampler") from e
                logger.info("Pixal3D loaded in low-VRAM mode on %s (peak VRAM ~10-12GB)", device)
            else:
                self.pipeline.low_vram = False
                self.pipeline.to(torch.device(device))
                for attr in [
                    "image_cond_model_ss",
                    "image_cond_model_shape_512",
                    "image_cond_model_shape_1024",
                    "image_cond_model_tex_1024",
                ]:
                    m = getattr(self.pipeline, attr, None)
                    if m is not None:
                        if hasattr(m, "to"):
                            m.to(torch.device(device))
                        if getattr(m, "use_naf_upsample", False) and hasattr(m, "_load_naf"):
                            try:
                                m._load_naf()
                            except Exception as e:
                                logger.exception("Pixal3D required NAF upsampler failed to load")
                                raise RuntimeError("Pixal3D failed to load a required NAF upsampler") from e
                logger.info("Pixal3D loaded in standard mode on %s", device)

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
        try:
            self._ensure_pixal3d_in_path()
            distance_from_fov = None
            get_camera_params_wild_moge = None
            load_moge_model = None
            try:
                inference_module = _load_pixal3d_inference_module(self.pixal3d_root)
                if inference_module is not None:
                    distance_from_fov = getattr(inference_module, "distance_from_fov", None)
                    get_camera_params_wild_moge = getattr(
                        inference_module, "get_camera_params_wild_moge", None
                    )
                    load_moge_model = getattr(inference_module, "load_moge_model", None)
            except Exception as helper_err:
                logger.warning(
                    "Unable to load camera helpers from the custom Pixal3D checkout: %s",
                    helper_err,
                )

            if manual_fov is not None and manual_fov > 0:
                logger.info(f"Using manual FOV: {math.degrees(manual_fov):.2f} deg")
                camera_angle_x = float(manual_fov)
                if callable(distance_from_fov):
                    try:
                        grid_point = torch.tensor([-1.0, 0.0, 0.0])
                        distance = distance_from_fov(
                            camera_angle_x,
                            grid_point,
                            torch.tensor([0, 511]),
                            1.0,
                            512,
                        )["distance_from_x"]
                    except Exception:
                        distance = 1.0 / (2.0 * math.tan(camera_angle_x / 2.0))
                else:
                    distance = 1.0 / (2.0 * math.tan(camera_angle_x / 2.0))
                return {"camera_angle_x": camera_angle_x, "distance": distance, "mesh_scale": 1.0}

            # Use MoGe for camera estimation with safe fallback
            dev = self.device if hasattr(self, "device") and self.device else "cuda"
            if callable(load_moge_model) and callable(get_camera_params_wild_moge):
                try:
                    logger.info("Loading MoGe model for camera estimation...")
                    self.moge_model = load_moge_model(device=dev)

                    logger.info("Estimating camera parameters...")
                    camera_params = get_camera_params_wild_moge(
                        image_path, self.moge_model, device=dev, mesh_scale=1.0, extend_pixel=0, image_resolution=512
                    )

                    # Free MoGe VRAM
                    if hasattr(self.moge_model, "cpu"):
                        self.moge_model.cpu()
                    del self.moge_model
                    self.moge_model = None
                    if torch.cuda.is_available():
                        torch.cuda.empty_cache()

                    logger.info(
                        f"Estimated camera: camera_angle_x={camera_params['camera_angle_x']:.4f}, "
                        f"distance={camera_params['distance']:.4f}"
                    )
                    return camera_params
                except Exception as moge_err:
                    logger.warning("MoGe camera estimation failed (%s); falling back to default FOV (49.13°)", moge_err)
                    if self.moge_model is not None:
                        try:
                            if hasattr(self.moge_model, "cpu"):
                                self.moge_model.cpu()
                            del self.moge_model
                        except Exception:
                            pass
                        self.moge_model = None

            # Fallback default FOV: ~49.13 degrees
            camera_angle_x = 0.8575560450553894
            if callable(distance_from_fov):
                try:
                    grid_point = torch.tensor([-1.0, 0.0, 0.0])
                    distance = distance_from_fov(
                        camera_angle_x,
                        grid_point,
                        torch.tensor([0, 511]),
                        1.0,
                        512,
                    )["distance_from_x"]
                except Exception:
                    distance = 1.0 / (2.0 * math.tan(camera_angle_x / 2.0))
            else:
                distance = 1.0 / (2.0 * math.tan(camera_angle_x / 2.0))
            return {"camera_angle_x": camera_angle_x, "distance": distance, "mesh_scale": 1.0}

        except Exception as e:
            logger.warning("Camera parameter estimation failed completely (%s); using default fallback", e)
            camera_angle_x = 0.8575560450553894
            distance = 1.0 / (2.0 * math.tan(camera_angle_x / 2.0))
            return {"camera_angle_x": camera_angle_x, "distance": distance, "mesh_scale": 1.0}

    def _run_inference(
        self,
        image: Image.Image,
        seed: int = 42,
        camera_params: Optional[Dict[str, float]] = None,
    ) -> Tuple[str, int]:
        """Run Pixal3D pipeline inference and return GLB path."""
        import o_voxel

        if camera_params is None:
            raise ValueError("camera_params is required")

        # Keep model settings adapter-owned; seed and camera parameters remain caller-controlled.
        pipeline_type = _LOCKED_INFERENCE_PROFILE["pipeline_type"]
        max_num_tokens = _LOCKED_INFERENCE_PROFILE["max_num_tokens"]
        locked_samplers = _LOCKED_INFERENCE_PROFILE["sampler_overrides"]
        ss_override = deepcopy(locked_samplers["sparse_structure"])
        shape_override = deepcopy(locked_samplers["shape"])
        tex_override = deepcopy(locked_samplers["texture"])

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
            max_num_tokens=max_num_tokens,
        )

        if isinstance(mesh_list, (list, tuple)):
            if not mesh_list:
                raise RuntimeError("Pixal3D pipeline returned no meshes")
            mesh = mesh_list[0]
        else:
            mesh = mesh_list

        # Derive the actual voxel grid resolution from the custom pipeline result.
        voxel_size = float(getattr(mesh, "voxel_size", 0.0))
        if not math.isfinite(voxel_size) or voxel_size <= 0:
            raise ValueError("Pixal3D pipeline output must expose a positive voxel_size")
        grid_size = int(round(1.0 / voxel_size))

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
            grid_size=grid_size,
            aabb=[[-0.5, -0.5, -0.5], [0.5, 0.5, 0.5]],
            decimation_target=1000000,
            texture_size=4096,
            remesh=False,
            remesh_band=1,
            remesh_project=0,
            use_tqdm=True,
        )

        glb.apply_transform(rot)
        glb.export(output_path, extension_webp=True)
        logger.info("Pixal3D GLB exported to: %s (grid_size=%s)", output_path, grid_size)

        return output_path, grid_size

    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """
        Process image-to-raw-mesh generation using Pixal3D.

        Args:
            inputs: Dictionary containing:
                - image_path: Path to input image (required)
                - output_format: Output format (default: "glb")
                - seed: Random seed for reproducibility (default: 42)
                - manual_fov: Manual camera FOV in radians (optional, override MoGe)
                - resolution, pipeline_type, low_vram, and sampler_overrides: adapter-locked inference profile

        Returns:
            Dictionary with generation results
        """
        inputs = {**inputs, **deepcopy(_LOCKED_INFERENCE_PROFILE)}
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
            # EXPERIMENTAL_MAX_DETAIL default follows official Pixal3D standard mode. Ask user before later profile changes.
            pipeline_type = _LOCKED_INFERENCE_PROFILE["pipeline_type"]
            low_vram = _LOCKED_INFERENCE_PROFILE["low_vram"]

            logger.info(f"Generating mesh with Pixal3D from image: {image_path}")

            # Create output directory
            base_name = f"{self.model_id}_{image_path.stem}"
            output_dir = self.path_generator.base_output_dir / "pixal3d" / f"{image_path.stem}_{uuid.uuid4().hex}"
            output_dir.mkdir(parents=True, exist_ok=True)

            # Load and preprocess the image using the custom vendored Pixal3D pipeline.
            with Image.open(image_path) as source_image:
                input_image = source_image.convert("RGBA")
            original_input_size = [int(input_image.width), int(input_image.height)]

            try:
                input_image = self.pipeline.preprocess_image(input_image)
            except Exception as bg_err:
                logger.warning(
                    "Pixal3D image preprocessing failed (%s); using the source image as-is",
                    bg_err,
                )

            # The custom inference entry point estimates camera parameters from this same
            # cropped/preprocessed image, not from the unprocessed upload.
            camera_image_path = output_dir / ("_camera_input_" + uuid.uuid4().hex + ".png")
            try:
                input_image.save(camera_image_path)
                camera_params = self._estimate_camera_params(
                    str(camera_image_path), manual_fov
                )
            finally:
                camera_image_path.unlink(missing_ok=True)
                try:
                    output_dir.rmdir()
                except OSError:
                    pass

            # Standardize model input to 512x512 without distorting the aspect ratio.
            input_image = input_image.convert("RGBA")
            target = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
            thumb = input_image.copy()
            thumb.thumbnail((512, 512), Image.Resampling.LANCZOS)
            offset = ((512 - thumb.width) // 2, (512 - thumb.height) // 2)
            target.paste(thumb, offset, mask=thumb.getchannel("A"))
            input_image = target

            # Run Pixal3D pipeline
            glb_path, effective_geometry_resolution = self._run_inference(
                input_image,
                seed=seed,
                camera_params=camera_params,
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
                    "effective_geometry_resolution": effective_geometry_resolution,
                    "geometry_resolution_source": "Inferred from custom Pixal3D MeshWithVoxel.voxel_size",
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
        - resolution, pipeline_type, low_vram and sampler_overrides are adapter-locked.
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
                    "description": "Adapter-locked pipeline resolution.",
                    "default": _LOCKED_INFERENCE_PROFILE["resolution"],
                    "enum": [1024, 1536, 2048],
                    "readOnly": True,
                    "required": False,
                },
                "pipeline_type": {
                    "type": "string",
                    "description": "Adapter-locked pipeline type for cascade generation.",
                    "default": _LOCKED_INFERENCE_PROFILE["pipeline_type"],
                    "enum": ["1024_cascade", "1536_cascade"],
                    "readOnly": True,
                    "required": False,
                },
                "low_vram": {
                    "type": "boolean",
                    "description": "Adapter-locked low-VRAM mode.",
                    "default": _LOCKED_INFERENCE_PROFILE["low_vram"],
                    "readOnly": True,
                    "required": False,
                },
                "sampler_overrides": {
                    "type": "object",
                    "description": "Experimental quality-first sampler parameters for sparse_structure, shape and texture. Adapted from TRELLIS.2 community issue #92; not benchmarked directly on Pixal3D.",
                    "default": {
                        "sparse_structure": deepcopy(_LOCKED_INFERENCE_PROFILE["sampler_overrides"]["sparse_structure"]),
                        "shape": deepcopy(_LOCKED_INFERENCE_PROFILE["sampler_overrides"]["shape"]),
                        "texture": deepcopy(_LOCKED_INFERENCE_PROFILE["sampler_overrides"]["texture"]),
                    },
                    "readOnly": True,
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