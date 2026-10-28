"""
Hunyuan3D-DiT-v2-mini-Turbo model adapter for low-VRAM image-to-mesh generation.

This adapter integrates the Hunyuan3D-DiT-v2-mini-Turbo (0.6B) model into
the ForMesh3D mesh generation framework, supporting low-resource shape generation.
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
from adapters.hunyuan3d_decoder_profile import configure_native_dense_decoder
from core.utils.file_utils import OutputPathGenerator
from core.utils.mesh_utils import MeshProcessor

logger = logging.getLogger(__name__)

# LOCKED / ACTIVE: values used by inference.
# BASELINE: previous effective runtime values (source_quality="max", octree_resolution=768, num_inference_steps=20, guidance_scale=7.5, num_chunks=80000, low_vram_mode=false, low_vram=false, enable_flashvdm=false, mc_algo="mc")
# EXPERIMENTAL: selected experimental values, snapshot (2026-10-20) for stress-test; use only for benchmarking.
# SUPPORTED BY: Hunyuan3D-DiT-v2-mini-Turbo adapter, EXPERIMENTAL-MODEL-SETTINGS.md section "Hunyuan3D-DiT-v2-Mini-Turbo".
# ROLLBACK: previous effective values; scheduler strips frontend overrides before adapter applies lock.
_LOCKED_INFERENCE_PROFILE = {
    "source_quality": "max",
    "octree_resolution": 512,
    "num_inference_steps": 20,
    "guidance_scale": 7.5,
    "num_chunks": 160000,
    "low_vram_mode": False,
    "low_vram": False,
    "enable_flashvdm": False,
    "mc_algo": "mc",
}


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


    def _load_model(self):
        """Load Hunyuan3D-DiT-v2-mini-Turbo with deterministic source resolution."""
        try:
            thirdparty_turbo = self.hunyuan3d_root.resolve()
            checkpoint_dir = self.model_path / "hunyuan3d-dit-v2-mini-turbo"
            source_files = (
                thirdparty_turbo / "hy3dgen" / "shapegen" / "pipelines.py",
                thirdparty_turbo / "hy3dgen" / "rembg.py",
            )
            missing = [str(path) for path in source_files if not path.is_file()]
            if missing:
                raise ModuleNotFoundError(
                    "Hunyuan3D Mini source files are missing: "
                    + ", ".join(missing)
                    + ". Initialize/update backend/thirdparty before loading the model."
                )
            if not self.model_path.is_dir():
                raise FileNotFoundError(
                    f"Hunyuan3D Mini checkpoint directory not found at {self.model_path}; "
                    "download it with backend/scripts/download_models.sh -m hunyuan3d_dit_v2_mini_turbo."
                )
            if not checkpoint_dir.is_dir():
                raise FileNotFoundError(
                    f"Hunyuan3D Mini checkpoint subfolder not found at {checkpoint_dir}; "
                    "expected the downloaded 'hunyuan3d-dit-v2-mini-turbo' directory."
                )

            # This vendored package must win over similarly named site-packages imports.
            sys.path[:] = [
                entry for entry in sys.path
                if Path(entry or os.getcwd()).resolve() != thirdparty_turbo
            ]
            sys.path.insert(0, str(thirdparty_turbo))
            loaded_package = sys.modules.get("hy3dgen")
            loaded_file = getattr(loaded_package, "__file__", None)
            if loaded_file and thirdparty_turbo not in Path(loaded_file).resolve().parents:
                for module_name in tuple(sys.modules):
                    if module_name == "hy3dgen" or module_name.startswith("hy3dgen."):
                        del sys.modules[module_name]

            logger.info(
                "Loading Hunyuan3D-DiT-v2-mini-Turbo (source=%s, checkpoint=%s)",
                thirdparty_turbo,
                checkpoint_dir,
            )
            if not torch.cuda.is_available():
                raise RuntimeError(
                    "Hunyuan3D-DiT-v2-mini-Turbo requires CUDA; refusing to initialize model weights on CPU."
                )
            device = getattr(self, "device", None)
            if device is None or device.startswith("cpu"):
                device = f"cuda:{self.gpu_id}" if self.gpu_id is not None else "cuda:0"
            self.device = device

            logger.info("Applying Mini Turbo torchvision and numba compatibility fix...")
            os.environ["NUMBA_DISABLE_CACHING"] = "1"
            os.environ.setdefault("NUMBA_CACHE_DIR", "/tmp/numba_cache")
            try:
                try:
                    from utils.torchvision_fix import apply_fix, fix_numba_caching
                except ImportError:
                    from torchvision_fix import apply_fix, fix_numba_caching
                apply_fix()
                fix_numba_caching()
            except Exception as e:
                logger.warning("Mini Turbo torchvision/numba compatibility fix was not applied: %s", e)

            logger.info("Importing Mini Turbo pipeline from %s", thirdparty_turbo / "hy3dgen")
            from hy3dgen.shapegen.pipelines import Hunyuan3DDiTFlowMatchingPipeline
            try:
                from hy3dgen.rembg import BackgroundRemover
            except RuntimeError as err:
                if "cannot cache function" in str(err) or "no locator available" in str(err):
                    logger.warning("Caught Numba cache error importing BackgroundRemover in Mini Turbo: %s; retrying...", err)
                    try:
                        try:
                            from utils.torchvision_fix import fix_numba_caching
                        except ImportError:
                            from torchvision_fix import fix_numba_caching
                        fix_numba_caching()
                    except Exception:
                        pass
                    for mod in list(sys.modules):
                        if "pymatting" in mod or "hy3dgen.rembg" in mod or "rembg" in mod:
                            sys.modules.pop(mod, None)
                    from hy3dgen.rembg import BackgroundRemover
                else:
                    raise

            logger.info("Loading Mini Turbo checkpoint on %s...", device)
            self.pipeline = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(
                str(self.model_path),
                subfolder="hunyuan3d-dit-v2-mini-turbo",
                device=device,
            )
            if hasattr(self.pipeline, "to"):
                self.pipeline.to(device)

            try:
                if hasattr(self.pipeline, "enable_model_cpu_offload"):
                    self.pipeline.enable_model_cpu_offload(device=device)
                    logger.info("Enabled model CPU offload for Mini Turbo pipeline")
            except Exception as offload_err:
                logger.warning("Could not enable CPU offload for Mini Turbo pipeline: %s", offload_err)

            logger.info("Initializing Mini Turbo background remover...")
            try:
                import rembg
                self.bg_remover = BackgroundRemover()
                self.bg_remover.session = rembg.new_session(
                    providers=["CUDAExecutionProvider", "CPUExecutionProvider"]
                )
            except RuntimeError as err:
                if "cannot cache function" in str(err) or "no locator available" in str(err):
                    logger.warning("Caught Numba caching RuntimeError initializing Mini Turbo rembg: %s. Retrying with cache=False...", err)
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
                        self.bg_remover.session = rembg.new_session(
                            providers=["CUDAExecutionProvider", "CPUExecutionProvider"]
                        )
                    except Exception as retry_err:
                        logger.warning("BackgroundRemover retry failed in Mini Turbo (%s). Using safe fallback.", retry_err)
                        try:
                            from utils.torchvision_fix import SafeBackgroundRemoverFallback
                            self.bg_remover = SafeBackgroundRemoverFallback()
                        except Exception:
                            class _SafeFallback:
                                def __call__(self, img):
                                    return img.convert("RGBA") if hasattr(img, "convert") else img
                            self.bg_remover = _SafeFallback()
                else:
                    logger.warning("Failed to initialize BackgroundRemover in Mini Turbo (%s). Using safe fallback.", err)
                    try:
                        from utils.torchvision_fix import SafeBackgroundRemoverFallback
                        self.bg_remover = SafeBackgroundRemoverFallback()
                    except Exception:
                        class _SafeFallback:
                            def __call__(self, img):
                                return img.convert("RGBA") if hasattr(img, "convert") else img
                        self.bg_remover = _SafeFallback()
            except Exception as bg_err:
                logger.warning("Failed to initialize BackgroundRemover in Mini Turbo (%s). Using safe fallback.", bg_err)
                try:
                    from utils.torchvision_fix import SafeBackgroundRemoverFallback
                    self.bg_remover = SafeBackgroundRemoverFallback()
                except Exception:
                    class _SafeFallback:
                        def __call__(self, img):
                            return img.convert("RGBA") if hasattr(img, "convert") else img
                    self.bg_remover = _SafeFallback()

            logger.info("Hunyuan3D-DiT-v2-mini-Turbo loaded successfully")
            return {"pipeline": self.pipeline, "bg_remover": self.bg_remover}

        except Exception as e:
            logger.exception(
                "Failed to load Hunyuan3D-DiT-v2-mini-Turbo (source=%s, checkpoint=%s)",
                self.hunyuan3d_root,
                self.model_path,
            )
            raise RuntimeError(
                f"Failed to load Hunyuan3D-DiT-v2-mini-Turbo: {type(e).__name__}: {e}"
            ) from e

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
        inputs = {**inputs, **_LOCKED_INFERENCE_PROFILE}
        try:
            if not torch.cuda.is_available():
                raise RuntimeError("Hunyuan3D-DiT-v2-mini-Turbo requires CUDA; CPU inference is not supported.")
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

            if not torch.cuda.is_available():
                raise RuntimeError("Hunyuan3D-DiT-v2-mini-Turbo requires CUDA; CPU inference is not supported.")

            device = getattr(self, "device", None)
            if not device or device.startswith("cpu"):
                device = getattr(self.pipeline, "device", None) or (f"cuda:{self.gpu_id}" if self.gpu_id is not None else "cuda:0")
            if str(device).startswith("cpu"):
                device = f"cuda:{self.gpu_id}" if self.gpu_id is not None else "cuda:0"
            self.device = str(device)

            if hasattr(self.pipeline, "device") and str(self.pipeline.device).startswith("cpu"):
                if hasattr(self.pipeline, "to"):
                    self.pipeline.to(self.device)

            logger.info(f"Generating 3D shape with Mini Turbo on {self.device}...")
            octree_res = inputs.get("octree_resolution")
            if octree_res is None:
                # EXPERIMENTAL: intentionally exceed trained 380; artifacts/OOM possible.
                octree_res = _LOCKED_INFERENCE_PROFILE["octree_resolution"]
            else:
                octree_res = int(octree_res)
                if octree_res > 380:
                    logger.warning("EXPERIMENTAL: passing Mini Turbo resolution %s above trained 380; artifacts/OOM possible.", octree_res)

            num_chunks = inputs.get("num_chunks", _LOCKED_INFERENCE_PROFILE["num_chunks"])
            if num_chunks is None:
                num_chunks = _LOCKED_INFERENCE_PROFILE["num_chunks"]
            else:
                num_chunks = int(num_chunks)

            num_steps = inputs.get("num_inference_steps", _LOCKED_INFERENCE_PROFILE["num_inference_steps"])
            if num_steps is None:
                num_steps = _LOCKED_INFERENCE_PROFILE["num_inference_steps"]
            else:
                num_steps = int(num_steps)

            guidance_scale = inputs.get("guidance_scale", _LOCKED_INFERENCE_PROFILE["guidance_scale"])
            if guidance_scale is None:
                guidance_scale = _LOCKED_INFERENCE_PROFILE["guidance_scale"]
            else:
                guidance_scale = float(guidance_scale)

            low_vram_mode = bool(inputs["low_vram_mode"])
            enable_flashvdm = bool(inputs["enable_flashvdm"])
            if enable_flashvdm:
                logger.warning("Ignoring enable_flashvdm=True: the raw-source fidelity profile uses the native dense decoder.")
            seed = int(inputs.get("seed", 42))
            generator = torch.Generator(device=self.device).manual_seed(seed)

            algo = inputs.get("mc_algo", "mc")
            # diso/DMC requires CUDA arch >= 8.0 (Ampere+). Only enable on SM >= 8.
            _dmc_allowed = False
            try:
                import diso
                if torch.cuda.is_available():
                    cap = torch.cuda.get_device_capability(
                        int(str(self.device).split(":")[-1]) if ":" in str(self.device) else 0
                    )
                    _dmc_allowed = (cap[0] >= 8)
            except Exception:
                pass
            if _dmc_allowed:
                algo = "dmc"
            else:
                algo = "mc"
            configure_native_dense_decoder(self.pipeline, "Hunyuan3D-DiT-v2-mini-Turbo", mc_algo=algo)
            mesh_result = self.pipeline(
                image=image,
                octree_resolution=octree_res,
                num_inference_steps=num_steps,
                guidance_scale=guidance_scale,
                num_chunks=num_chunks,
                mc_algo=algo,
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
                    "geometry_extractor": "Hunyuan3D-DiT-v2-mini-Turbo VanillaVolumeDecoder + MCSurfaceExtractor",
                    "requested_geometry_resolution": octree_res,
                    "effective_geometry_resolution": None,
                    "effective_geometry_resolution_status": "upstream exposes configured octree_resolution, not scalar achieved resolution",
                    "geometry_resolution_source": "verified VanillaVolumeDecoder + MCSurfaceExtractor; mc_algo=mc",
                    "voxel_size": 2.02 / octree_res,
                    "mc_algo": "mc",
                    "mesh_operations": [],
                    "octree_resolution": octree_res,
                    "note": "EXPERIMENTAL LIMIT CROSSING: resolution 768 and 20 steps exceed trained recipe; artifacts/OOM possible",
                    "num_chunks": num_chunks,
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
                    "description": "Adapter-locked geometry extraction resolution.",
                    "default": _LOCKED_INFERENCE_PROFILE["octree_resolution"],
                    "minimum": 64,
                    "maximum": 1024,
                    "readOnly": True,
                    "required": False,
                },
                "num_chunks": {
                    "type": "integer",
                    "description": "Chunk size for point evaluation during marching cubes",
                    "default": _LOCKED_INFERENCE_PROFILE["num_chunks"],
                    "readOnly": True,
                    "required": False,
                },
                "num_inference_steps": {
                    "type": "integer",
                    "description": "Adapter-locked inference step count.",
                    "default": _LOCKED_INFERENCE_PROFILE["num_inference_steps"],
                    "minimum": 1,
                    "maximum": 100,
                    "readOnly": True,
                    "required": False,
                },
                "guidance_scale": {
                    "type": "number",
                    "description": "Adapter-locked guidance scale.",
                    "default": _LOCKED_INFERENCE_PROFILE["guidance_scale"],
                    "readOnly": True,
                    "required": False,
                },
                "low_vram_mode": {
                    "type": "boolean",
                    "description": "Adapter-locked low-VRAM mode.",
                    "default": _LOCKED_INFERENCE_PROFILE["low_vram_mode"],
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
                "enable_flashvdm": {
                    "type": "boolean",
                    "description": "FlashVDM acceleration is bypassed for maximum-fidelity raw geometry.",
                    "default": False,
                    "readOnly": True,
                    "required": False,
                },
            }
        }

    def get_supported_formats(self) -> Dict[str, List[str]]:
        return {"input": ["png", "jpg", "jpeg"], "output": ["glb", "obj"]}
