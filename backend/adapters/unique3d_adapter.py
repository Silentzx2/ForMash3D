"""
Unique3D model adapter for image-to-raw-mesh generation.

Integrates Unique3D: High-Quality and Efficient 3D Mesh Generation from a Single Image.
Uses the official inference flow: input -> super-res -> multiview -> normal -> mesh -> refine -> color projection -> GLB.
"""

import logging
import os
import re
import shutil
import sys
import tempfile
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

# Prevent CUDA memory fragmentation
os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

logger = logging.getLogger(__name__)

# LOCKED / ACTIVE: values used by inference.
# BASELINE: previous effective runtime values (source_quality="max", input_processing=true, do_refine=true, expansion_weight=0.1, init_type="std", low_vram=false)
# EXPERIMENTAL: selected experimental values, snapshot (2026-10-20) for stress-test; use only for benchmarking.
# SUPPORTED BY: Unique3D adapter, EXPERIMENTAL-MODEL-SETTINGS.md section "Unique3D".
# ROLLBACK: previous effective values; scheduler strips frontend overrides before adapter applies lock.
_LOCKED_INFERENCE_PROFILE = {
    "source_quality": "max",
    "input_processing": True,
    "do_refine": True,
    "expansion_weight": 0.1,
    "init_type": "std",
    "low_vram": False,
}


# EXPERIMENTAL_MAX_DETAIL (2026-10-20): preserve upstream-supported seed=1145, input processing,
# refinement enabled, expansion_weight=0.1 and init_type="std". No configurable inference-step/CFG
# knobs are exposed by this adapter. Ask the user once before changing these locked settings.
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
        **kwargs,
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
        self._ensure_ckpt_symlinks()

        logger.info(f"Initialized Unique3D adapter with root: {unique3d_root}")

    @staticmethod
    def _sanitize_hf_tokens():
        """Sanitize HF_TOKEN, HUGGINGFACE_TOKEN, GITHUB_TOKEN to avoid 401 Unauthorized on public models."""
        for token_key in ["HF_TOKEN", "HUGGINGFACE_TOKEN"]:
            val = os.environ.get(token_key)
            if val is not None:
                val_clean = val.strip()
                is_invalid = (
                    not val_clean
                    or val_clean.lower() in ("none", "null", "false", "undefined", "dummy")
                    or val_clean.startswith("ghp_")
                    or val_clean.startswith("gho_")
                    or val_clean.startswith("github_pat_")
                )
                github_token = os.environ.get("GITHUB_TOKEN", "").strip()
                if is_invalid or (github_token and val_clean == github_token):
                    logger.info(f"Removing invalid/unauthorized {token_key} from environment")
                    os.environ.pop(token_key, None)

    def _find_local_img2mvimg(self) -> Optional[Path]:
        """Find local img2mvimg directory containing base SD weights."""
        candidates = [
            Path(self.model_path) / "ckpt" / "img2mvimg",
            self.unique3d_root / "ckpt" / "img2mvimg",
            Path("ckpt") / "img2mvimg",
            Path("./ckpt/img2mvimg"),
            Path("backend/ckpt") / "img2mvimg",
            Path(__file__).resolve().parents[1] / "pretrained" / "Unique3D" / "ckpt" / "img2mvimg",
        ]
        for candidate in candidates:
            try:
                resolved = candidate.resolve()
                if resolved.exists() and resolved.is_dir():
                    return resolved
            except Exception:
                continue
        return None

    def _create_normal_config_override(self, base_model: str) -> str:
        """Create a runtime image2normal YAML config overriding the base model path."""
        src_path = Path(self.normal_config)
        content = ""
        if src_path.exists():
            try:
                content = src_path.read_text(encoding="utf-8")
            except Exception:
                pass

        if not content:
            content = f"""pretrained_model_name_or_path: "{base_model}"
mixed_precision: "bf16"

init_config:
  enable_cross_attn_lora: False
  enable_cross_attn_ip: False
  enable_self_attn_lora: False
  enable_self_attn_ref: True
  enable_multiview_attn: False
  init_cross_attn_lora: False
  init_cross_attn_ip: False
  cross_attn_lora_rank: 512
  cross_attn_lora_only_kv: False
  ipadapter_pretrained_name: "h94/IP-Adapter"
  ipadapter_subfolder_name: "models"
  ipadapter_weight_name: "ip-adapter_sd15.safetensors"
  ipadapter_effect_on: "all"
  init_self_attn_lora: False
  self_attn_lora_rank: 512
  self_attn_lora_only_kv: False
  init_self_attn_ref: True
  self_attn_ref_position: "attn1"
  self_attn_ref_other_model_name: "${{pretrained_model_name_or_path}}"
  self_attn_ref_pixel_wise_crosspond: True
  self_attn_ref_effect_on: "all"
  init_unet_path: "${{pretrained_model_name_or_path}}"
  init_num_cls_label: 0
  cls_labels: []

trainers:
  - trainer_type: "image2image_trainer"
    trainer:
        pretrained_model_name_or_path: "${{pretrained_model_name_or_path}}"
        attn_config:
          cls_labels: []
          enable_cross_attn_lora: False
          enable_cross_attn_ip: False
          enable_self_attn_lora: False
          enable_self_attn_ref: True
          enable_multiview_attn: False
        resolution: "512"
        condition_image_resolution: "512"
        condition_image_column_name: "conditioning_image"
        image_column_name: "image"
"""
        else:
            # Replace pretrained_model_name_or_path at root level
            content = re.sub(
                r'^(pretrained_model_name_or_path:\s*).*$',
                f'\\1"{base_model}"',
                content,
                flags=re.MULTILINE,
            )
            # Ensure self_attn_ref_other_model_name points to ${pretrained_model_name_or_path}
            content = re.sub(
                r'(\bself_attn_ref_other_model_name:\s*).*$',
                '\\1"${pretrained_model_name_or_path}"',
                content,
                flags=re.MULTILINE,
            )
            # Ensure init_unet_path points to ${pretrained_model_name_or_path}
            content = re.sub(
                r'(\binit_unet_path:\s*).*$',
                '\\1"${pretrained_model_name_or_path}"',
                content,
                flags=re.MULTILINE,
            )

        candidate_paths = [
            self.unique3d_root / "app" / "custom_models" / "image2normal_runtime.yaml",
            Path("ckpt") / "image2normal_runtime.yaml",
            Path(tempfile.gettempdir()) / "image2normal_runtime.yaml",
        ]
        for dest in candidate_paths:
            try:
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_text(content, encoding="utf-8")
                return str(dest)
            except Exception as e:
                logger.debug(f"Could not write runtime config to {dest}: {e}")

        # Fallback to NamedTemporaryFile
        with tempfile.NamedTemporaryFile("w", suffix=".yaml", delete=False, encoding="utf-8") as tf:
            tf.write(content)
            return tf.name

    def _resolve_normal_config(self) -> str:
        """Resolve image2normal against its compatible 4-channel image-variation base.

        The trained img2mvimg UNet has 8 input channels; image2normal checkpoint
        weights have 4-channel conv_in tensors and must not use that model as a base.
        """
        base_model = "lambdalabs/sd-image-variations-diffusers"
        normal_cfg_path = Path(self.normal_config)
        cfg_content = ""
        if normal_cfg_path.is_file():
            try:
                cfg_content = normal_cfg_path.read_text(encoding="utf-8")
            except Exception as e:
                logger.warning(f"Could not read normal config {normal_cfg_path}: {e}")

        if (
            f'pretrained_model_name_or_path: "{base_model}"' in cfg_content
            and 'self_attn_ref_other_model_name: "${pretrained_model_name_or_path}"' in cfg_content
            and 'init_unet_path: "${pretrained_model_name_or_path}"' in cfg_content
        ):
            return str(normal_cfg_path)

        logger.info(
            "Resolving image2normal with the compatible 4-channel image-variation base; "
            "the 8-channel img2mvimg base is incompatible."
        )
        self._sanitize_hf_tokens()
        return self._create_normal_config_override(base_model=base_model)

    def _ensure_ckpt_symlinks(self):
        """Ensure ckpt symlinks exist so Unique3D relative './ckpt/...' paths resolve to pretrained weights."""
        ckpt_sources = [
            (Path(self.model_path) / "ckpt").resolve(),
            (self.unique3d_root / "ckpt").resolve(),
            Path("ckpt").resolve(),
            Path("backend/ckpt").resolve(),
            (Path(__file__).resolve().parents[1] / "pretrained" / "Unique3D" / "ckpt").resolve(),
        ]
        ckpt_src = next((p for p in ckpt_sources if p.exists() and not p.is_symlink()), None)
        if not ckpt_src:
            ckpt_src = next((p for p in ckpt_sources if p.exists()), None)

        if ckpt_src and ckpt_src.exists():
            targets = [self.unique3d_root / "ckpt"]
            # Only add backend/ckpt if inside backend directory or backend exists
            if Path("backend").is_dir() and not Path("package.json").exists():
                targets.append(Path("backend") / "ckpt")
            elif Path("core").is_dir() and Path("adapters").is_dir():
                targets.append(Path("ckpt"))

            for target in targets:
                try:
                    if target.is_symlink():
                        if target.resolve() != ckpt_src:
                            target.unlink()
                            target.symlink_to(ckpt_src)
                            logger.info(f"Updated ckpt symlink: {target} -> {ckpt_src}")
                    elif not target.exists():
                        target.symlink_to(ckpt_src)
                        logger.info(f"Created ckpt symlink: {target} -> {ckpt_src}")
                except Exception as e:
                    logger.debug(f"Could not symlink {target} -> {ckpt_src}: {e}")

        # Clean up any rogue/empty lambda directories that confuse diffusers into thinking it's a local repo
        for bogus_dir in [
            Path("lambda/sd-image-variations-diffusers"),
            self.unique3d_root / "lambda" / "sd-image-variations-diffusers",
            Path("backend/lambda/sd-image-variations-diffusers"),
        ]:
            if bogus_dir.exists() and bogus_dir.is_dir():
                if not (bogus_dir / "config.json").exists() and not (bogus_dir / "model_index.json").exists():
                    try:
                        logger.warning(f"Removing empty/invalid local directory {bogus_dir} causing diffusers collision.")
                        shutil.rmtree(bogus_dir)
                    except Exception as e:
                        logger.debug(f"Could not remove {bogus_dir}: {e}")

        # Ensure app symlink exists for any relative app/... lookups inside Unique3D
        app_src = (self.unique3d_root / "app").resolve()
        if app_src.exists():
            targets = []
            if Path("core").is_dir() and Path("adapters").is_dir():
                targets.append(Path("app"))
            for target in targets:
                try:
                    if target.is_symlink():
                        if target.resolve() != app_src:
                            target.unlink()
                            target.symlink_to(app_src)
                    elif not target.exists():
                        target.symlink_to(app_src)
                except Exception as e:
                    logger.debug(f"Could not symlink {target} -> {app_src}: {e}")

        # Check and resolve normal_config if local img2mvimg exists
        if hasattr(self, "normal_config") and self.normal_config:
            try:
                self.normal_config = self._resolve_normal_config()
            except Exception as e:
                logger.debug(f"Could not dynamically pre-resolve normal_config in symlink setup: {e}")

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
            self._ensure_ckpt_symlinks()
            
            # Apply torchvision fix if available
            try:
                import importlib.util as _ilu
                _tv_fix_path = Path(__file__).resolve().parent.parent / "utils" / "torchvision_fix.py"
                if _tv_fix_path.exists():
                    _spec = _ilu.spec_from_file_location("torchvision_fix", str(_tv_fix_path))
                    if _spec and _spec.loader:
                        _tv_mod = _ilu.module_from_spec(_spec)
                        _spec.loader.exec_module(_tv_mod)
                        _tv_mod.apply_fix()
                else:
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
            try:
                import app.custom_models.mvimg_prediction as mvimg_pred_mod
                mvimg_pred_mod.trainer = self.mvimg_trainer
                mvimg_pred_mod.pipeline = self.mvimg_pipeline
            except Exception as e:
                logger.debug(f"Failed to inject mvimg pipeline into mvimg_prediction module: {e}")

            # Load normal prediction pipeline (image2normal)
            logger.info("Loading normal prediction pipeline (image2normal)...")
            resolved_normal_config = self._resolve_normal_config()
            try:
                self.normal_trainer, self.normal_pipeline = load_pipeline(
                    resolved_normal_config, self.normal_checkpoint
                )
            except Exception as e:
                logger.warning(
                    f"Failed to load normal pipeline with config '{resolved_normal_config}': {e}. "
                    "Retrying with the alternate compatible 4-channel image-variation base..."
                )
                loaded = False
                self._sanitize_hf_tokens()
                for hf_repo in ["lambda/sd-image-variations-diffusers"]:
                    try:
                        fallback_cfg = self._create_normal_config_override(base_model=hf_repo)
                        logger.info(
                            f"Retrying load_pipeline for normal prediction using compatible base: {hf_repo}"
                        )
                        self.normal_trainer, self.normal_pipeline = load_pipeline(
                            fallback_cfg, self.normal_checkpoint
                        )
                        loaded = True
                        break
                    except Exception as hf_e:
                        logger.warning(f"Fallback to '{hf_repo}' failed: {hf_e}")

                if not loaded:
                    raise
            # self.normal_pipeline.enable_model_cpu_offload()
            loaded_models["normal_pipeline"] = self.normal_pipeline
            loaded_models["normal_trainer"] = self.normal_trainer
            try:
                import app.custom_models.normal_prediction as normal_pred_mod
                normal_pred_mod.trainer = self.normal_trainer
                normal_pred_mod.pipeline = self.normal_pipeline
            except Exception as e:
                logger.debug(f"Failed to inject normal pipeline into normal_prediction module: {e}")

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

            # Enable attention & VAE slicing if available to reduce peak activation memory with ZERO quality loss
            for pipe in [self.mvimg_pipeline, self.normal_pipeline]:
                if pipe is not None:
                    if hasattr(pipe, "enable_attention_slicing"):
                        try:
                            pipe.enable_attention_slicing()
                        except Exception:
                            pass
                    if hasattr(pipe, "enable_vae_slicing"):
                        try:
                            pipe.enable_vae_slicing()
                        except Exception:
                            pass

            # Dynamic VRAM detection:
            # If GPU has < 24GB VRAM (e.g. Colab T4 15GB, RTX 3080/4080, etc.),
            # use sequential stage offloading so only one diffusion model occupies VRAM at a time.
            total_vram_gb = 0.0
            if torch.cuda.is_available():
                try:
                    total_vram_gb = torch.cuda.get_device_properties(self.gpu_id or 0).total_memory / (1024**3)
                except Exception:
                    total_vram_gb = 0.0
            self.low_vram_mode = total_vram_gb < 24.0
            logger.info(f"Unique3D detected GPU VRAM: {total_vram_gb:.2f} GB (low_vram_mode={self.low_vram_mode})")

            if self.low_vram_mode and self.normal_pipeline is not None:
                # Keep normal pipeline on CPU initially until multiview prediction finishes
                try:
                    self.normal_pipeline.to("cpu")
                    torch.cuda.empty_cache()
                except Exception as e:
                    logger.debug(f"Could not offload normal pipeline to CPU: {e}")

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
            try:
                import app.custom_models.mvimg_prediction as mvimg_pred_mod
                mvimg_pred_mod.trainer = None
                mvimg_pred_mod.pipeline = None
            except Exception:
                pass
            try:
                import app.custom_models.normal_prediction as normal_pred_mod
                normal_pred_mod.trainer = None
                normal_pred_mod.pipeline = None
            except Exception:
                pass

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

    def _run_super_resolution(
        self,
        images: List[Image.Image],
        diagnostics: Optional[Dict[str, Any]] = None,
    ) -> List[Image.Image]:
        """Upscale input images and expose the actual backend used for provenance."""
        if self.sr_model is None:
            if diagnostics is not None:
                diagnostics["backend"] = "lanczos_resize_fallback"
                diagnostics["fallback_reason"] = "configured SR model is unavailable"
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
            
            if diagnostics is not None:
                diagnostics["backend"] = "configured_sr_model"
                diagnostics["fallback_reason"] = None
            return results
        except Exception as e:
            logger.warning(f"Super-resolution failed: {e}, using fallback resize")
            if diagnostics is not None:
                diagnostics["backend"] = "lanczos_resize_fallback"
                diagnostics["fallback_reason"] = str(e)
            return [img.resize((img.width * 2, img.height * 2), Image.LANCZOS) for img in images]

    def _run_multiview_prediction(
        self, 
        image: Image.Image, 
        remove_bg: bool = True, 
        seed: int = 1145,
        guidance_scale: float = 1.5
    ) -> tuple:
        """Run multiview image prediction (img2mvimg)."""
        # Use the adapter's already-loaded pipeline directly. The upstream wrapper imports
        # Gradio and eagerly initializes a duplicate module-level pipeline.
        from rembg import remove as rembg_remove
        from scripts.utils import session as rembg_session
        
        if remove_bg and (image.mode == "RGB" or np.array(image)[..., -1].mean() == 255.):
            image = rembg_remove(image, session=rembg_session)
        
        
        cuda_dev = f"cuda:{self.gpu_id}" if self.gpu_id is not None else "cuda:0"
        if self.mvimg_pipeline is not None:
            try:
                self.mvimg_pipeline.to(cuda_dev)
            except Exception:
                pass

        generator = torch.Generator(device=cuda_dev).manual_seed(int(seed)) if seed >= 0 else None
        
        # Simple preprocessing
        from app.utils import change_rgba_bg
        from scripts.utils import simple_preprocess
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
        cuda_dev = f"cuda:{self.gpu_id}" if self.gpu_id is not None else "cuda:0"
        if getattr(self, "low_vram_mode", False) and self.mvimg_pipeline is not None:
            try:
                self.mvimg_pipeline.to("cpu")
            except Exception:
                pass
            torch.cuda.empty_cache()

        if self.normal_pipeline is not None:
            try:
                self.normal_pipeline.to(cuda_dev)
            except Exception:
                pass

        if self.normal_trainer is not None and self.normal_pipeline is not None:
            from app.utils import rgba_to_rgb, simple_remove
            from scripts.utils import rotate_normals_torch
            img_list = images if isinstance(images, list) else [images]
            img_list = [rgba_to_rgb(i) if i.mode == 'RGBA' else i for i in img_list]
            predicted = self.normal_trainer.pipeline_forward(
                pipeline=self.normal_pipeline,
                image=img_list,
                num_inference_steps=num_inference_steps,
                guidance_scale=guidance_scale,
            ).images
            predicted = simple_remove(predicted)
            if do_rotate and len(predicted) > 1:
                predicted = rotate_normals_torch(predicted, return_types='pil')
            return predicted

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
        expansion_weight: float = 1.5,
        init_type: str = "std"
    ):
        """Run geometry reconstruction and refinement."""
        self._ensure_unique3d_in_path()
        # Import reconstruction modules
        from scripts.multiview_inference import geo_reconstruct

        effective_do_refine = do_refine
        try:
            from app.all_models import model_zoo
            if getattr(model_zoo, "pipe_disney_controlnet_tile_ipadapter_i2i", None) is None:
                effective_do_refine = False
        except Exception:
            effective_do_refine = False
        
        return geo_reconstruct(
            rgb_pils=rgb_pils,
            normal_pils=normal_pils,
            front_pil=front_pil,
            do_refine=effective_do_refine,
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
        inputs = {**inputs, **_LOCKED_INFERENCE_PROFILE}
        try:
            if not torch.cuda.is_available():
                raise RuntimeError("Unique3D requires CUDA; CPU fallback is not supported")
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
            original_input_size = [int(preview_img.width), int(preview_img.height)]
            super_resolution_requested = preview_img.size[0] <= 512
            super_resolution_diagnostics: Dict[str, Any] = {
                "backend": "not_used" if not super_resolution_requested else "not_run",
                "fallback_reason": None,
            }

            # Input upscaling can aid preprocessing but does not guarantee added geometric detail.
            if super_resolution_requested:
                logger.info(
                    "Running Unique3D input upscaling (sr_model_available=%s).",
                    self.sr_model is not None,
                )
                preview_img = self._run_super_resolution(
                    [preview_img], diagnostics=super_resolution_diagnostics
                )[0]
            super_resolution_backend = str(super_resolution_diagnostics.get("backend", "not_reported"))
            inference_input_size = [int(preview_img.width), int(preview_img.height)]

            # Step 2: Multiview prediction
            logger.info("Running multiview prediction...")
            rgb_pils, front_pil = self._run_multiview_prediction(
                preview_img,
                remove_bg=input_processing,
                seed=seed
            )

            # Move multiview pipeline to CPU to free VRAM for normal prediction & mesh reconstruction
            cuda_dev = f"cuda:{self.gpu_id}" if self.gpu_id is not None else "cuda:0"
            if getattr(self, "low_vram_mode", False):
                if self.mvimg_pipeline is not None:
                    try:
                        self.mvimg_pipeline.to("cpu")
                    except Exception:
                        pass
                torch.cuda.empty_cache()
                import gc
                gc.collect()

            # Ensure normal prediction pipeline is loaded onto GPU
            if self.normal_pipeline is not None:
                try:
                    self.normal_pipeline.to(cuda_dev)
                except Exception:
                    pass

            # Step 3: Geometry reconstruction and refinement (including high-res normal prediction)
            logger.info("Running geometry reconstruction and refinement...")
            new_meshes = self._run_geo_reconstruct(
                rgb_pils=rgb_pils,
                normal_pils=None,
                front_pil=front_pil,
                do_refine=do_refine,
                predict_normal=True,
                expansion_weight=expansion_weight,
                init_type=init_type
            )

            # Cleanup normal pipeline to CPU to free VRAM after reconstruction
            if getattr(self, "low_vram_mode", False):
                if self.normal_pipeline is not None:
                    try:
                        self.normal_pipeline.to("cpu")
                    except Exception:
                        pass
                torch.cuda.empty_cache()
                import gc
                gc.collect()

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
                    "has_vertex_color": True,
                    "vertex_color": True,
                    "seed": seed,
                    "source_quality": inputs.get("source_quality", "max"),
                    "native_vertex_count": mesh_stats["vertex_count"],
                    "native_face_count": mesh_stats["face_count"],
                    "geometry_extractor": "Unique3D multiview RGB/normal-guided reconstruction",
                    "effective_geometry_resolution": None,
                    "geometry_resolution_source": "reconstruction pipeline does not expose a scalar achieved grid resolution",
                    "mesh_operations": [],
                    "geometry_transforms": ["uniform scale", "axis orientation conversion"],
                    "original_input_size": original_input_size,
                    "inference_input_size": inference_input_size,
                    "super_resolution_requested": super_resolution_requested,
                    "super_resolution_backend": super_resolution_backend,
                    "super_resolution_fallback_reason": super_resolution_diagnostics.get("fallback_reason"),
                    "predicted_view_count": len(rgb_pils),
                    "predicted_normal_count": len(rgb_pils),
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
                    "readOnly": True,
                    "required": False
                },
                "do_refine": {
                    "type": "boolean",
                    "description": "Refine multiview details for higher quality",
                    "default": True,
                    "readOnly": True,
                    "required": False
                },
                "expansion_weight": {
                    "type": "number",
                    "description": "Expansion weight for mesh generation (-1.0 to 1.0)",
                    "default": 0.1,
                    "minimum": -1.0,
                    "maximum": 1.0,
                    "readOnly": True,
                    "required": False
                },
                "init_type": {
                    "type": "string",
                    "description": "Mesh initialization type",
                    "default": "std",
                    "enum": ["std", "thin"],
                    "readOnly": True,
                    "required": False
                }
            }
        }

# Import at function level where used, not module level (pytorch3d may not be available)
Unique3DAdapter = Unique3DImageToRawMeshAdapter
