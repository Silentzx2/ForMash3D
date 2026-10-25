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
from adapters.hunyuan3d_decoder_profile import configure_native_dense_decoder
from core.utils.file_utils import OutputPathGenerator
from core.utils.mesh_utils import MeshProcessor

logger = logging.getLogger(__name__)

# LOCKED / ACTIVE: values used by inference.
# BASELINE: previous effective runtime values (source_quality="max", octree_resolution=1200, num_inference_steps=100, guidance_scale=7.0, num_chunks=80000, mc_algo="mc")
# EXPERIMENTAL: selected experimental values, snapshot (2026-10-20) for stress-test; use only for benchmarking.
# SUPPORTED BY: Hunyuan3D-Shape-v2-1 adapter, EXPERIMENTAL-MODEL-SETTINGS.md section "Hunyuan3D-Shape-v2.1".
# ROLLBACK: previous effective values; scheduler strips frontend overrides before adapter applies lock.
_LOCKED_INFERENCE_PROFILE = {
    "source_quality": "max", "octree_resolution": 512,
    "num_inference_steps": 50, "guidance_scale": 7.0,
    "num_chunks": 160000, "mc_algo": "mc",
}


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

        # The vendored torchvision compatibility patch lives at the model root.
        if str(self.hunyuan3d_root) not in sys.path:
            sys.path.append(str(self.hunyuan3d_root))

    def _load_model(self):
        """Load Hunyuan3D-Shape-v2-1 pipeline."""
        try:
            logger.info(f"Loading Hunyuan3D-Shape-v2-1 from {self.model_path}")

            os.environ["NUMBA_DISABLE_CACHING"] = "1"
            os.environ.setdefault("NUMBA_CACHE_DIR", "/tmp/numba_cache")
            try:
                try:
                    from utils.torchvision_fix import apply_fix, fix_numba_caching
                except ImportError:
                    from torchvision_fix import apply_fix, fix_numba_caching
                apply_fix()
                fix_numba_caching()
            except (ImportError, Exception) as e:
                logger.warning(f"torchvision_fix / numba_fix not applied: {e}")

            if not self.model_path.exists():
                raise FileNotFoundError(
                    f"Hunyuan3D-Shape-v2-1 model directory not found at: {self.model_path}. "
                    f"Please download weights via download_models.sh."
                )

            package_root = (self.hunyuan3d_root / "hy3dshape").resolve()
            pipeline_source = package_root / "hy3dshape" / "pipelines.py"
            rembg_source = package_root / "hy3dshape" / "rembg.py"
            missing = [str(path) for path in (pipeline_source, rembg_source) if not path.is_file()]
            if missing:
                raise ModuleNotFoundError(
                    "Hunyuan3D-Shape source files are missing: "
                    + ", ".join(missing)
                    + ". Update backend/thirdparty with the project setup script."
                )

            # Load this model's vendored package, not a similarly named package already on sys.path.
            sys.path[:] = [
                entry for entry in sys.path
                if Path(entry or os.getcwd()).resolve() != package_root
            ]
            sys.path.insert(0, str(package_root))
            loaded_package = sys.modules.get("hy3dshape")
            loaded_file = getattr(loaded_package, "__file__", None)
            if loaded_file and package_root not in Path(loaded_file).resolve().parents:
                for module_name in tuple(sys.modules):
                    if module_name == "hy3dshape" or module_name.startswith("hy3dshape."):
                        del sys.modules[module_name]

            logger.info("Resolved Hunyuan3D-Shape Python package root: %s", package_root)
            os.environ["NUMBA_DISABLE_CACHING"] = "1"
            try:
                try:
                    from utils.torchvision_fix import fix_numba_caching
                except ImportError:
                    from torchvision_fix import fix_numba_caching
                fix_numba_caching()
            except Exception:
                pass

            from hy3dshape.pipelines import Hunyuan3DDiTFlowMatchingPipeline
            try:
                from hy3dshape.rembg import BackgroundRemover
            except RuntimeError as err:
                if "cannot cache function" in str(err) or "no locator available" in str(err):
                    logger.warning("Caught Numba cache error importing BackgroundRemover: %s; retrying with fix_numba_caching...", err)
                    try:
                        try:
                            from utils.torchvision_fix import fix_numba_caching
                        except ImportError:
                            from torchvision_fix import fix_numba_caching
                        fix_numba_caching()
                    except Exception:
                        pass
                    for mod in list(sys.modules):
                        if "pymatting" in mod or "hy3dshape.rembg" in mod or "rembg" in mod:
                            sys.modules.pop(mod, None)
                    from hy3dshape.rembg import BackgroundRemover
                else:
                    raise

            if not torch.cuda.is_available():
                raise RuntimeError("Hunyuan3D-Shape-v2-1 requires CUDA; CPU inference is not supported.")
            device = getattr(self, "device", None)
            if device is None or device.startswith("cpu"):
                device = f"cuda:{self.gpu_id}" if self.gpu_id is not None else "cuda:0"
            self.device = device
            logger.info(f"Loading shape generation pipeline on {device}...")
            self.pipeline_shapegen = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(
                str(self.model_path),
                device=device,
            )
            if hasattr(self.pipeline_shapegen, "to"):
                self.pipeline_shapegen.to(device)
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
                    self.pipeline_shapegen.enable_model_cpu_offload(device=device)
                    logger.info("Enabled model CPU offload for shape pipeline")
            except Exception as offload_err:
                logger.warning(f"Could not enable CPU offload: {offload_err}")

            logger.info("Loading background remover...")
            try:
                import rembg
                self.bg_remover = BackgroundRemover()
                self.bg_remover.session = rembg.new_session(providers=["CUDAExecutionProvider", "CPUExecutionProvider"])
            except RuntimeError as err:
                if "cannot cache function" in str(err) or "no locator available" in str(err):
                    logger.warning("Caught Numba caching RuntimeError during rembg init: %s. Retrying with cache=False...", err)
                    try:
                        try:
                            from utils.torchvision_fix import fix_numba_caching
                        except ImportError:
                            from torchvision_fix import fix_numba_caching
                        fix_numba_caching()
                    except Exception:
                        pass
                    for mod in list(sys.modules):
                        if "pymatting" in mod or "rembg" in mod:
                            sys.modules.pop(mod, None)
                    try:
                        import rembg
                        self.bg_remover = BackgroundRemover()
                        self.bg_remover.session = rembg.new_session(providers=["CUDAExecutionProvider", "CPUExecutionProvider"])
                    except Exception as retry_err:
                        logger.warning("BackgroundRemover retry failed (%s). Using safe fallback.", retry_err)
                        try:
                            from utils.torchvision_fix import SafeBackgroundRemoverFallback
                            self.bg_remover = SafeBackgroundRemoverFallback()
                        except Exception:
                            class _SafeFallback:
                                def __call__(self, img):
                                    return img.convert("RGBA") if hasattr(img, "convert") else img
                            self.bg_remover = _SafeFallback()
                else:
                    logger.warning("Failed to initialize BackgroundRemover (%s). Using safe fallback.", err)
                    try:
                        from utils.torchvision_fix import SafeBackgroundRemoverFallback
                        self.bg_remover = SafeBackgroundRemoverFallback()
                    except Exception:
                        class _SafeFallback:
                            def __call__(self, img):
                                return img.convert("RGBA") if hasattr(img, "convert") else img
                        self.bg_remover = _SafeFallback()
            except Exception as bg_err:
                logger.warning("Failed to initialize BackgroundRemover (%s). Using safe fallback.", bg_err)
                try:
                    from utils.torchvision_fix import SafeBackgroundRemoverFallback
                    self.bg_remover = SafeBackgroundRemoverFallback()
                except Exception:
                    class _SafeFallback:
                        def __call__(self, img):
                            return img.convert("RGBA") if hasattr(img, "convert") else img
                    self.bg_remover = _SafeFallback()

            logger.info("Hunyuan3D-Shape-v2-1 loaded successfully")
            return {"shapegen": self.pipeline_shapegen, "bg_remover": self.bg_remover}

        except Exception as e:
            logger.exception(
                "Failed to load Hunyuan3D-Shape-v2-1 (source=%s, checkpoint=%s)",
                self.hunyuan3d_root,
                self.model_path,
            )
            raise RuntimeError(f"Failed to load Hunyuan3D-Shape-v2-1: {type(e).__name__}: {e}") from e

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
        inputs = {**inputs, **_LOCKED_INFERENCE_PROFILE}
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

            if not torch.cuda.is_available():
                raise RuntimeError("Hunyuan3D-Shape-v2-1 requires CUDA; CPU inference is not supported.")

            device = getattr(self, "device", None)
            if not device or device.startswith("cpu"):
                device = getattr(self.pipeline_shapegen, 'device', None) or (f"cuda:{self.gpu_id}" if self.gpu_id is not None else "cuda:0")
            if str(device).startswith("cpu"):
                device = f"cuda:{self.gpu_id}" if self.gpu_id is not None else "cuda:0"
            self.device = str(device)

            # Ensure pipeline is loaded and on GPU
            if self.pipeline_shapegen is None:
                raise RuntimeError("Hunyuan3D-Shape-v2-1 pipeline not loaded. Call _load_model() first or check model weights.")

            if hasattr(self.pipeline_shapegen, "device") and str(self.pipeline_shapegen.device).startswith("cpu"):
                if hasattr(self.pipeline_shapegen, "to"):
                    self.pipeline_shapegen.to(self.device)

            logger.info(f"Generating 3D shape with Hunyuan3D-Shape-v2-1 on {self.device}...")
            octree_res = inputs.get("octree_resolution") or inputs.get("octree_res") or inputs.get("grid_resolution")
            if octree_res is None:
                octree_res = 512 if inputs.get("source_quality", "max") == "max" else 256
            else:
                octree_res = int(octree_res)

            num_chunks = inputs.get("num_chunks", _LOCKED_INFERENCE_PROFILE["num_chunks"])
            if num_chunks is None:
                num_chunks = _LOCKED_INFERENCE_PROFILE["num_chunks"]
            else:
                num_chunks = int(num_chunks)

            # EXPERIMENTAL_MAX_DETAIL (2026-10-20): upstream UI permits 100 steps; guidance 5.0 is the upstream default.
            # Before any later change to the locked profile, ask the user once and require explicit confirmation.
            num_steps = inputs.get("num_inference_steps") or inputs.get("num_steps")
            if num_steps is None:
                num_steps = 150 if inputs.get("source_quality", "max") == "max" else 30
            else:
                num_steps = int(num_steps)

            guidance_scale = inputs.get("guidance_scale", 5.0)
            if guidance_scale is None:
                guidance_scale = 5.0
            else:
                guidance_scale = float(guidance_scale)

            seed = int(inputs.get("seed", 42))
            generator = torch.Generator(device=self.device).manual_seed(seed)

            configure_native_dense_decoder(self.pipeline_shapegen, "Hunyuan3D-Shape-v2.1")
            mesh_result = self.pipeline_shapegen(
                image=image,
                octree_resolution=octree_res,
                num_inference_steps=num_steps,
                guidance_scale=guidance_scale,
                num_chunks=num_chunks,
                mc_algo=inputs["mc_algo"],
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
                    "native_vertex_count": mesh_stats["vertex_count"],
                    "native_face_count": mesh_stats["face_count"],
                    "has_texture": False,
                    "source_quality": inputs.get("source_quality", "max"),
                    "geometry_extractor": "Hunyuan3D-Shape-v2.1 VanillaVolumeDecoder + MCSurfaceExtractor",
                    "requested_geometry_resolution": octree_res,
                    "effective_geometry_resolution": None,
                    "effective_geometry_resolution_status": "upstream exposes configured octree_resolution, not scalar achieved resolution",
                    "geometry_resolution_source": "verified VanillaVolumeDecoder + MCSurfaceExtractor; mc_algo=mc",
                    "voxel_size": 2.02 / octree_res,
                    "mc_algo": inputs["mc_algo"],
                    "mesh_operations": [],
                    "octree_resolution": octree_res,
                    "num_chunks": num_chunks,
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
                    "description": "Locked adapter-owned extraction resolution; edit only after profile review.",
                    "default": _LOCKED_INFERENCE_PROFILE["octree_resolution"],
                    "minimum": 64,
                    "maximum": 2048,
                    "readOnly": True,
                    "required": False,
                },
                "num_chunks": {
                    "type": "integer",
                    "description": "Locked adapter-owned chunk size for marching-cubes evaluation.",
                    "default": _LOCKED_INFERENCE_PROFILE["num_chunks"],
                    "readOnly": True,
                    "required": False,
                },
                "num_inference_steps": {
                    "type": "integer",
                    "description": "Locked adapter-owned inference step count; edit only after profile review.",
                    "default": _LOCKED_INFERENCE_PROFILE["num_inference_steps"],
                    "minimum": 1,
                    "maximum": 200,
                    "readOnly": True,
                    "required": False,
                },
                "guidance_scale": {
                    "type": "number",
                    "description": "Locked adapter-owned guidance scale; edit only after profile review.",
                    "default": _LOCKED_INFERENCE_PROFILE["guidance_scale"],
                    "readOnly": True,
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


class Hunyuan3DShapeV21ImageToTexturedMeshAdapter(Hunyuan3DShapeV21ImageToRawMeshAdapter):
    """
    Deprecated adapter for Hunyuan3D-Shape-v2-1 image-to-textured-mesh generation.

    Per Docs/TASKS.md Section 4, auto-chaining wrapper is deprecated.
    Shape generation produces raw geometry only without internally calling Hunyuan Paint.
    """

    FEATURE_TYPE = "image_to_raw_mesh"
    MODEL_ID = "hunyuan3d_shape_v21_image_to_textured_mesh"

    def __init__(self, *args, **kwargs):
        logger.warning(
            "Hunyuan3DShapeV21ImageToTexturedMeshAdapter is deprecated. "
            "Normal generation produces raw geometry only. Texturing is handled by the centralized texture stage."
        )
        super().__init__(*args, **kwargs)


# Backward-compatible alias for raw geometry generation
Hunyuan3DShapeV21ImageToMeshAdapter = Hunyuan3DShapeV21ImageToRawMeshAdapter
