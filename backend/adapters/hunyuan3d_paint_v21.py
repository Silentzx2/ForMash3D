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

# LOCKED / ACTIVE: values used by inference.
# BASELINE: previous effective runtime values (max_num_view=9, resolution=768)
# EXPERIMENTAL: selected experimental values, snapshot (2026-10-20) for stress-test; use only for benchmarking.
# SUPPORTED BY: Hunyuan3D-Paint-v2-1 adapter, EXPERIMENTAL-MODEL-SETTINGS.md section "Hunyuan3D-Paint-v2.1".
# ROLLBACK: previous effective values; scheduler strips frontend overrides before adapter applies lock.
_LOCKED_INFERENCE_PROFILE = {
    "max_num_view": 9,
    "resolution": 1536,
}


def _format_background_remover_import_error(error: BaseException) -> ImportError:
    """Build an actionable diagnostic for BackgroundRemover import-time failures."""
    failing_module = getattr(error, "name", None)
    module_detail = f" (module: {failing_module})" if failing_module else ""
    return ImportError(
        "Unable to import Hunyuan3D-Paint BackgroundRemover: "
        f"{type(error).__name__}{module_detail}: {error}"
    )


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
        self._model_path_was_explicit = model_path is not None
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
        self.bg_remover_mode = "uninitialized"
        self.bg_remover_fallback_reason = None
        self.mesh_processor = MeshProcessor()
        self.path_generator = OutputPathGenerator(base_output_dir="outputs")

    def _use_safe_background_remover(self, error: BaseException) -> None:
        """Use a safe fallback while explicitly preserving the degraded runtime state."""
        reason = f"{type(error).__name__}: {error}"
        try:
            from core.utils.runtime_compat import get_backend_torchvision_fix
            compatibility = get_backend_torchvision_fix()
            self.bg_remover = compatibility.SafeBackgroundRemoverFallback()
            self.bg_remover_mode = "safe_fallback"
        except Exception as fallback_error:
            class _IdentityBackgroundRemover:
                def __call__(self, img):
                    return img.convert("RGBA") if hasattr(img, "convert") else img

            self.bg_remover = _IdentityBackgroundRemover()
            self.bg_remover_mode = "identity"
            reason += (
                f"; SafeBackgroundRemoverFallback unavailable: "
                f"{type(fallback_error).__name__}: {fallback_error}"
            )

        self.bg_remover_fallback_reason = reason
        logger.warning(
            "Hunyuan3D-Paint background removal is degraded (mode=%s): %s",
            self.bg_remover_mode,
            reason,
        )

    @staticmethod
    def _has_local_dino_checkpoint(path: Path) -> bool:
        """Return true only when a local Transformers checkpoint has config and weights."""
        if not path.is_dir() or not (path / "config.json").is_file():
            return False
        weight_patterns = (
            "*.safetensors",
            "pytorch_model*.bin",
            "model*.bin",
        )
        return any(
            weight_file.is_file()
            for pattern in weight_patterns
            for weight_file in path.glob(pattern)
        )

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
        """Load Hunyuan3D-Paint-v2-1 pipeline with scoped import-path changes."""
        added_sys_paths: List[str] = []
        utils_package = None
        original_utils_path = None
        try:
            if not torch.cuda.is_available():
                raise RuntimeError("Hunyuan3D-Paint-v2-1 requires CUDA; CPU inference is not supported.")
            logger.info("Loading Hunyuan3D-Paint-v2-1 pipeline")

            # Keep Paint3D's generic `utils.*` imports scoped to initialization.
            # The shared backend.utils package must not retain this third-party path.
            import importlib

            paint_root = str(self.hunyuan3d_root)
            paint_sub = str(self.hunyuan3d_root / "hy3dpaint")
            paint_utils = str(self.hunyuan3d_root / "hy3dpaint" / "utils")
            for path_entry in (paint_sub, paint_root):
                if path_entry not in sys.path:
                    sys.path.insert(0, path_entry)
                    added_sys_paths.append(path_entry)

            utils_package = importlib.import_module("utils")
            package_path = getattr(utils_package, "__path__", None)
            if package_path is None:
                raise ImportError("The shared backend utils module is not a package.")
            original_utils_path = list(package_path)
            if paint_utils not in package_path:
                package_path.insert(0, paint_utils)

            os.environ["NUMBA_DISABLE_CACHING"] = "1"
            os.environ.setdefault("NUMBA_CACHE_DIR", "/tmp/numba_cache")
            try:
                from core.utils.runtime_compat import get_backend_torchvision_fix
                compatibility = get_backend_torchvision_fix()
                compatibility.apply_fix()
                compatibility.fix_numba_caching()
            except Exception as e:
                logger.warning(
                    "Backend compatibility/Numba cache fix did not apply during Hunyuan3D-Paint load: %s",
                    e,
                    exc_info=True,
                )

            from hy3dpaint.textureGenPipeline import (
                Hunyuan3DPaintConfig,
                Hunyuan3DPaintPipeline,
            )
            try:
                from hy3dshape.hy3dshape.rembg import BackgroundRemover
            except RuntimeError as err:
                if "cannot cache function" in str(err) or "no locator available" in str(err):
                    logger.warning("Caught Numba cache error importing BackgroundRemover in paint: %s; retrying...", err)
                    try:
                        from core.utils.runtime_compat import get_backend_torchvision_fix
                        get_backend_torchvision_fix().fix_numba_caching()
                    except Exception:
                        pass
                    # Retain shared module-cache entries; don't duplicate live classes during retry.
                    from hy3dshape.hy3dshape.rembg import BackgroundRemover
                else:
                    raise
            except (ImportError, OSError) as err:
                raise _format_background_remover_import_error(err) from err

            # EXPERIMENTAL_MAX_DETAIL: upstream Hunyuan3D-Paint demo supports up to 9 views and 768 per-view resolution.
            # Ask the user once and require explicit confirmation before future changes to these locked defaults.
            max_num_view = _LOCKED_INFERENCE_PROFILE["max_num_view"]
            resolution = _LOCKED_INFERENCE_PROFILE["resolution"]
            conf = Hunyuan3DPaintConfig(max_num_view, resolution)
            planned_gpus = [
                int(gpu) for gpu in (getattr(self, "resource_plan", None) or {}).get("gpu_ids", [])
            ]
            if not planned_gpus and self.gpu_id is not None:
                planned_gpus = [int(self.gpu_id)]
            if planned_gpus:
                conf.device = f"cuda:{planned_gpus[0]}"
            if len(planned_gpus) > 1:
                conf.component_devices = [f"cuda:{gpu}" for gpu in planned_gpus]
                logger.info(
                    "Hunyuan3D-Paint multi-GPU component placement: %s",
                    conf.component_devices,
                )

            conf.multiview_cfg_path = str(
                self.hunyuan3d_root / "hy3dpaint/cfgs/hunyuan-paint-pbr.yaml"
            )
            conf.custom_pipeline = str(
                self.hunyuan3d_root / "hy3dpaint/hunyuanpaintpbr"
            )
            paint_pbr_sub = self.model_path / "hunyuan3d-paintpbr-v2-1"
            if self._model_path_was_explicit:
                # Respect an explicitly configured local path or Hugging Face repo ID.
                # The third-party resolver raises on missing/invalid local paths instead
                # of silently replacing the user's source with a different remote model.
                from hy3dpaint.utils.runtime_path_utils import resolve_model_source

                _source_kind, source_value = resolve_model_source(
                    self.model_path,
                    default_repo_id="tencent/Hunyuan3D-2.1",
                    nested_dir="hunyuan3d-paintpbr-v2-1",
                )
                conf.multiview_pretrained_path = source_value
            elif paint_pbr_sub.is_dir():
                conf.multiview_pretrained_path = str(paint_pbr_sub)
            elif self.model_path.is_dir():
                conf.multiview_pretrained_path = str(self.model_path)
            else:
                logger.warning(
                    "Default local Hunyuan3D-Paint checkpoint path %s (including %s) was not found; "
                    "using the documented remote repository tencent/Hunyuan3D-2.1.",
                    self.model_path, paint_pbr_sub,
                )
                conf.multiview_pretrained_path = "tencent/Hunyuan3D-2.1"

            dino_local = (self.model_path / ".." / ".." / "dinov2-giant").resolve()
            if self._has_local_dino_checkpoint(dino_local):
                conf.dino_ckpt_path = str(dino_local)
            else:
                logger.warning(
                    "Local DINOv2 checkpoint at %s is missing config.json or model weight files; "
                    "using remote repository facebook/dinov2-giant instead.",
                    dino_local,
                )
                conf.dino_ckpt_path = "facebook/dinov2-giant"
            conf.realesrgan_ckpt_path = self._resolve_realesrgan_path()

            self.bg_remover_mode = "primary"
            self.bg_remover_fallback_reason = None
            try:
                self.bg_remover = BackgroundRemover()
            except RuntimeError as err:
                if "cannot cache function" in str(err) or "no locator available" in str(err):
                    logger.warning(
                        "Caught Numba cache RuntimeError initializing BackgroundRemover; retrying: %s",
                        err,
                    )
                    try:
                        from core.utils.runtime_compat import get_backend_torchvision_fix
                        get_backend_torchvision_fix().fix_numba_caching()
                    except Exception:
                        logger.debug("Numba cache patch could not be reapplied", exc_info=True)
                    # Retain shared module-cache entries; don't duplicate live classes during retry.
                    try:
                        self.bg_remover = BackgroundRemover()
                    except Exception as retry_err:
                        self._use_safe_background_remover(retry_err)
                else:
                    self._use_safe_background_remover(err)
            except Exception as bg_err:
                self._use_safe_background_remover(bg_err)

            self.paint_pipeline = Hunyuan3DPaintPipeline(conf)

            logger.info("Hunyuan3D-Paint-v2-1 loaded successfully")
            return {"paint": self.paint_pipeline, "bg_remover": self.bg_remover}

        except Exception as e:
            logger.exception("Failed to load Hunyuan3D-Paint-v2-1")
            raise RuntimeError(f"Failed to load Hunyuan3D-Paint-v2-1: {e}") from e
        finally:
            # Restore shared import state regardless of success or failure.
            if utils_package is not None and original_utils_path is not None:
                utils_package.__path__[:] = original_utils_path
            for path_entry in added_sys_paths:
                while path_entry in sys.path:
                    sys.path.remove(path_entry)

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
        inputs = {**inputs, **_LOCKED_INFERENCE_PROFILE}
        cancel_checker = inputs.get("cancel_checker")
        temp_mesh_dir = None
        try:
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

            output_format = inputs.get("output_format", "glb").lower()
            if output_format not in self.supported_output_formats:
                raise ValueError(f"Unsupported output format: {output_format}")

            max_num_view = inputs["max_num_view"]
            resolution = int(inputs["resolution"])

            # Strictly enforce 4K (4096) and 8K (8192) resolution routing for Hunyuan3D-Paint-v2-1
            raw_tex_res = inputs.get("texture_resolution", 4096)
            if isinstance(raw_tex_res, str):
                res_str = raw_tex_res.upper().strip()
                if res_str in ("4K", "4096"):
                    texture_resolution = 4096
                elif res_str in ("8K", "8192"):
                    texture_resolution = 8192
                else:
                    raise ValueError(
                        f"Hunyuan3D-Paint-v2-1 only supports 4K (4096) and 8K (8192) texture resolution, got '{raw_tex_res}'. "
                        f"1K/2K must route strictly to Paint3D."
                    )
            else:
                int_res = int(raw_tex_res)
                if int_res in (4096, 8192):
                    texture_resolution = int_res
                else:
                    raise ValueError(
                        f"Hunyuan3D-Paint-v2-1 only supports 4K (4096) and 8K (8192) texture resolution, got {int_res}. "
                        f"1K/2K must route strictly to Paint3D."
                    )

            if not torch.cuda.is_available():
                raise RuntimeError("Hunyuan3D-Paint-v2-1 requires CUDA; CPU inference is not supported.")
            if self.bg_remover is None:
                raise ValueError("Background remover is not loaded")
            if self.paint_pipeline is None:
                raise ValueError("Paint pipeline is not loaded")

            mask_path = inputs.get("mask_path")
            if mask_path:
                logger.info("Spot retexture mask provided for Hunyuan3D-Paint: %s", mask_path)

            logger.info(f"Painting mesh with Hunyuan3D-Paint-v2-1: {mesh_path} at {texture_resolution}x{texture_resolution}")

            if cancel_checker and cancel_checker():
                raise InterruptedError("Hunyuan3D-Paint processing cancelled by user")

            # Support FBX and multi-part GLB with scene node transforms
            actual_mesh_path = mesh_path
            if mesh_path.suffix.lower() == ".fbx":
                import tempfile
                from core.utils.format_utils import fbx_to_glb_headless
                temp_mesh_dir = Path(tempfile.mkdtemp(prefix="hy3d_fbx_"))
                temp_glb = temp_mesh_dir / f"{mesh_path.stem}.glb"
                fbx_to_glb_headless(str(mesh_path), str(temp_glb))
                actual_mesh_path = temp_glb
            elif mesh_path.suffix.lower() == ".glb":
                import trimesh
                mesh_obj = trimesh.load(str(mesh_path), process=False)
                if isinstance(mesh_obj, trimesh.Scene):
                    from postprocess.meshio import scene_to_mesh
                    import tempfile
                    temp_mesh_dir = Path(tempfile.mkdtemp(prefix="hy3d_glb_"))
                    actual_mesh_path = temp_mesh_dir / f"{mesh_path.stem}_flattened.glb"
                    flattened = scene_to_mesh(mesh_obj)
                    flattened.export(str(actual_mesh_path), file_type="glb")

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
            output_path = Path(self.path_generator.generate_mesh_path(
                self.model_id, base_name, output_format
            ))

            use_remesh = bool(inputs.get("use_remesh", False))
            with Image.open(image_path) as reference_image:
                reference_image = self._prepare_reference_image(reference_image)

            if cancel_checker and cancel_checker():
                raise InterruptedError("Hunyuan3D-Paint processing cancelled by user")

            # Intermediate path passed to paint_pipeline: if glb, paint_pipeline creates .obj then converts to .glb
            if output_format == "glb":
                inter_obj_path = output_path.with_suffix(".obj")
                self.paint_pipeline(
                    str(actual_mesh_path), reference_image, str(inter_obj_path), use_remesh=use_remesh, save_glb=True
                )
                inter_glb = inter_obj_path.with_suffix(".glb")
                if inter_glb.exists() and inter_glb.resolve() != output_path.resolve():
                    shutil.move(str(inter_glb), str(output_path))
                # Clean up intermediate OBJ and MTL
                inter_obj_path.unlink(missing_ok=True)
                inter_obj_path.with_suffix(".mtl").unlink(missing_ok=True)
            else:
                self.paint_pipeline(
                    str(actual_mesh_path), reference_image, str(output_path), use_remesh=use_remesh, save_glb=False
                )

            if cancel_checker and cancel_checker():
                raise InterruptedError("Hunyuan3D-Paint processing cancelled by user")

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
                "background_removal": {
                    "mode": self.bg_remover_mode,
                    "degraded": self.bg_remover_mode != "primary",
                    "fallback_reason": self.bg_remover_fallback_reason,
                },
            }

            logger.info(f"Hunyuan3D-Paint-v2-1 mesh painting completed: {output_path}")
            self.status = ModelStatus.LOADED
            return response

        except (ValueError, FileNotFoundError, InterruptedError):
            self.status = ModelStatus.ERROR
            raise
        except Exception as e:
            self.status = ModelStatus.ERROR
            logger.exception("Hunyuan3D-Paint-v2-1 mesh painting failed")
            raise RuntimeError(f"Hunyuan3D-Paint-v2-1 mesh painting failed: {e}") from e
        finally:
            if temp_mesh_dir:
                shutil.rmtree(temp_mesh_dir, ignore_errors=True)

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
                    "description": "Experimental max-detail default follows the upstream demo's supported 6-9 view range; ask before changing the locked profile.",
                    "default": _LOCKED_INFERENCE_PROFILE["max_num_view"],
                    "minimum": 6,
                    "maximum": 12,
                    "readOnly": True,
                    "required": False,
                },
                "resolution": {
                    "type": "integer",
                    "description": "Per-view inference resolution; experimental max-detail default is the upstream demo ceiling of 768.",
                    "default": _LOCKED_INFERENCE_PROFILE["resolution"],
                    "enum": [512, 768, 1024, 1536],
                    "readOnly": True,
                    "required": False,
                },
            },
            "vram_requirement_mb": self.vram_requirement,
            "vram_eligible": self.get_vram_status()["eligible"],
        }

    def get_supported_formats(self) -> Dict[str, List[str]]:
        return {"input": ["glb", "obj"], "output": ["glb", "obj"]}


# Alias for backward-compatibility and clean imports
Hunyuan3DPaintV21Adapter = Hunyuan3DPaintV21ImageMeshPaintingAdapter
