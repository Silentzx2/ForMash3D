"""Zero123++ v1.2 Multi-View generation adapter for ForMash3D.

Integrates sudo-ai/zero123plus-v1.2 Diffusers pipeline to generate 6 canonical
camera views from a single input image.
Zero123++ v1.2 produces a 3x2 grid of 6 views at fixed azimuth/elevation angles:
  - Row 0, Col 0: Front Right (azimuth 30°, elevation +20°)
  - Row 0, Col 1: Right (azimuth 90°, elevation -10°)
  - Row 1, Col 0: Back Right (azimuth 150°, elevation +20°)
  - Row 1, Col 1: Back Left (azimuth 210°, elevation -10°)
  - Row 2, Col 0: Left (azimuth 270°, elevation +20°)
  - Row 2, Col 1: Front Left (azimuth 330°, elevation -10°)
Normalized FOV is 30°.
"""

from __future__ import annotations

import copy
import hashlib
import io
import json
import logging
import os
import shutil
import sys
import time
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

import numpy as np
import torch
from PIL import Image

from core.models.base import BaseModel, ModelStatus
from core.utils.file_utils import OutputPathGenerator, get_storage_base_dir, resolve_server_file_path
from core.utils.log_formatters import format_box, format_bytes

logger = logging.getLogger(__name__)


def _prepare_torchvision_and_pipeline_class(zero123plus_root: Path):
    """
    Safely prepare torchvision runtime and load Zero123PlusPipeline.
    Only registers stub operators if torchvision fails to import due to missing C++ ops,
    avoiding C++ dispatcher duplicate registration crashes on GPU workers.
    """
    try:
        import torchvision
    except RuntimeError as e:
        if "torchvision::nms" in str(e) or "operator torchvision::" in str(e):
            for _op, _schema in [
                ("torchvision::nms", "(Tensor dets, Tensor scores, float iou_threshold) -> Tensor"),
                ("torchvision::qnms", "(Tensor qdets, Tensor scores, float iou_threshold) -> Tensor"),
            ]:
                try:
                    torch.library.define(_op, _schema)
                except Exception:
                    pass
            try:
                import torchvision
            except Exception:
                pass
        else:
            raise

    diffusers_support = str(zero123plus_root / "diffusers-support")
    if diffusers_support not in sys.path:
        sys.path.insert(0, diffusers_support)

    try:
        from pipeline import Zero123PlusPipeline
        return Zero123PlusPipeline
    finally:
        if diffusers_support in sys.path and sys.path[0] == diffusers_support:
            sys.path.remove(diffusers_support)


CAMERA_RIG: List[Dict[str, Any]] = [
    {
        "name": "front_right_30",
        "filename": "front_right_30.png",
        "label": "Front Right",
        "azimuth_deg": 30.0,
        "elevation_deg": 20.0,
        "fov_deg": 30.0,
        "crop_box": (0, 0, 320, 320),
    },
    {
        "name": "right_90",
        "filename": "right_90.png",
        "label": "Right",
        "azimuth_deg": 90.0,
        "elevation_deg": -10.0,
        "fov_deg": 30.0,
        "crop_box": (320, 0, 640, 320),
    },
    {
        "name": "back_right_150",
        "filename": "back_right_150.png",
        "label": "Back Right",
        "azimuth_deg": 150.0,
        "elevation_deg": 20.0,
        "fov_deg": 30.0,
        "crop_box": (0, 320, 320, 640),
    },
    {
        "name": "back_left_210",
        "filename": "back_left_210.png",
        "label": "Back Left",
        "azimuth_deg": 210.0,
        "elevation_deg": -10.0,
        "fov_deg": 30.0,
        "crop_box": (320, 320, 640, 640),
    },
    {
        "name": "left_270",
        "filename": "left_270.png",
        "label": "Left",
        "azimuth_deg": 270.0,
        "elevation_deg": 20.0,
        "fov_deg": 30.0,
        "crop_box": (0, 640, 320, 960),
    },
    {
        "name": "front_left_330",
        "filename": "front_left_330.png",
        "label": "Front Left",
        "azimuth_deg": 330.0,
        "elevation_deg": -10.0,
        "fov_deg": 30.0,
        "crop_box": (320, 640, 640, 960),
    },
]


def derive_zip_filename(original_filename: str) -> str:
    """Derive canonical ZIP filename (<stem>.zip) from original upload name."""
    if not original_filename:
        return "multiview.zip"
    stem = Path(original_filename).stem
    safe_stem = "".join(c if (c.isalnum() or c in "-_.") else "_" for c in stem).strip("_")
    if not safe_stem:
        safe_stem = "multiview"
    return f"{safe_stem}.zip"


def expand_to_square(pil_img: Image.Image, background_color=(127, 127, 127, 0)) -> Image.Image:
    """Pad non-square PIL image into a centered square image."""
    width, height = pil_img.size
    if width == height:
        return pil_img
    max_side = max(width, height)
    mode = "RGBA" if len(background_color) == 4 else "RGB"
    if pil_img.mode != mode:
        pil_img = pil_img.convert(mode)
    result = Image.new(mode, (max_side, max_side), background_color)
    result.paste(pil_img, ((max_side - width) // 2, (max_side - height) // 2))
    return result


def compute_source_sha256(image_source: Union[str, Path, bytes, Image.Image]) -> str:
    """Compute deterministic SHA-256 digest of source image content."""
    if isinstance(image_source, (str, Path)):
        resolved = Path(image_source)
        if resolved.is_file():
            hasher = hashlib.sha256()
            with open(resolved, "rb") as f:
                for chunk in iter(lambda: f.read(1024 * 1024), b""):
                    hasher.update(chunk)
            return hasher.hexdigest()
        raise FileNotFoundError(f"Source image file not found: {image_source}")
    elif isinstance(image_source, bytes):
        return hashlib.sha256(image_source).hexdigest()
    elif isinstance(image_source, Image.Image):
        buf = io.BytesIO()
        image_source.save(buf, format="PNG")
        return hashlib.sha256(buf.getvalue()).hexdigest()
    raise TypeError(f"Unsupported image source type: {type(image_source)}")


def compute_request_sha256(source_or_params: Union[str, Dict[str, Any]], params: Optional[Dict[str, Any]] = None) -> str:
    """Compute deterministic SHA-256 digest from canonical parameters representation."""
    if isinstance(source_or_params, dict) and params is None:
        p = dict(source_or_params)
    else:
        p = dict(params or {})
        p["source_sha256"] = str(source_or_params)
    canonical_keys = [
        "source_sha256",
        "model_id",
        "model_version",
        "adapter_version",
        "inference_steps",
        "guidance_scale",
        "seed",
        "background_removal",
        "generate_masks",
        "generate_normals",
        "save_contact_sheet",
        "output_format",
    ]
    canonical_dict = {k: p.get(k) for k in canonical_keys if k in p}
    serialized = json.dumps(canonical_dict, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


class Zero123PlusAdapter(BaseModel):
    """
    Adapter for Zero123++ v1.2 multi-view image generation model.
    Produces 6 novel viewpoints from a single reference image without generating 3D mesh.
    """

    CAMERA_RIG = CAMERA_RIG
    FEATURE_TYPE = "image_to_multiview"
    MODEL_ID = "zero123plus_v12_image_to_multiview"
    MODEL_VERSION = "v1.2"
    ADAPTER_VERSION = "1.0.0"

    def __init__(
        self,
        model_id: str = "zero123plus_v12_image_to_multiview",
        model_path: Optional[str] = None,
        vram_requirement: Optional[int] = None,
        zero123plus_root: Optional[str] = None,
        normal_controlnet_path: Optional[str] = None,
    ):
        if vram_requirement is None:
            vram_requirement = 5120  # ~5GB VRAM requirement for 16-bit UNet

        if model_path is None:
            model_path = "backend/pretrained/zero123plus-v1.2"

        super().__init__(
            model_id=model_id,
            model_path=model_path,
            vram_requirement=vram_requirement,
            feature_type="image_to_multiview",
        )

        repo_root = Path(__file__).resolve().parents[2]
        if zero123plus_root is None:
            self.zero123plus_root = repo_root / "backend" / "thirdparty" / "zero123plus"
        else:
            self.zero123plus_root = Path(zero123plus_root)

        if normal_controlnet_path is None:
            self.normal_controlnet_path = repo_root / "backend" / "pretrained" / "controlnet-zp12-normal-gen-v1"
        else:
            self.normal_controlnet_path = Path(normal_controlnet_path)

        self.pipeline = None
        self.normal_pipeline = None
        self.rembg_session = None
        self.path_generator = OutputPathGenerator(base_output_dir="outputs")

    def _resolve_model_source(self) -> str:
        candidates = [
            Path(self.model_path),
            Path(__file__).resolve().parents[2] / "backend" / "pretrained" / "zero123plus-v1.2",
            Path(__file__).resolve().parents[2] / "pretrained" / "zero123plus-v1.2",
        ]
        for cand in candidates:
            if (cand / "model_index.json").exists():
                logger.info(f"Resolved local Zero123++ model path: {cand}")
                return str(cand.resolve())
        logger.info("Local Zero123++ weights not found; referencing remote 'sudo-ai/zero123plus-v1.2'")
        return "sudo-ai/zero123plus-v1.2"

    def _resolve_normal_controlnet_source(self) -> Optional[str]:
        candidates = [
            self.normal_controlnet_path,
            Path(__file__).resolve().parents[2] / "backend" / "pretrained" / "controlnet-zp12-normal-gen-v1",
            Path(__file__).resolve().parents[2] / "pretrained" / "controlnet-zp12-normal-gen-v1",
        ]
        for cand in candidates:
            if (cand / "config.json").exists():
                return str(cand.resolve())
        return "sudo-ai/controlnet-zp12-normal-gen-v1"

    def _ensure_vendored_pipeline_in_path(self):
        diffusers_support = str(self.zero123plus_root / "diffusers-support")
        if diffusers_support not in sys.path:
            sys.path.insert(0, diffusers_support)
        root_str = str(self.zero123plus_root)
        if root_str not in sys.path:
            sys.path.insert(0, root_str)

    def _load_model(self) -> Any:
        model_source = self._resolve_model_source()
        custom_pipeline_dir = str(self.zero123plus_root / "diffusers-support")

        logger.info(f"Loading Zero123++ pipeline from {model_source}")
        from diffusers import EulerAncestralDiscreteScheduler

        use_cuda = torch.cuda.is_available()
        dtype = torch.float16 if use_cuda else torch.float32
        is_local = os.path.exists(model_source)

        pipeline_cls = None
        try:
            pipeline_cls = _prepare_torchvision_and_pipeline_class(self.zero123plus_root)
        except Exception as e:
            logger.warning(f"Could not load Zero123PlusPipeline class directly ({e}); will try DiffusionPipeline fallback")

        pipeline = None
        if pipeline_cls is not None:
            try:
                pipeline = pipeline_cls.from_pretrained(
                    model_source,
                    torch_dtype=dtype,
                    local_files_only=is_local,
                )
            except Exception as e:
                logger.warning(f"pipeline_cls.from_pretrained failed ({e}); falling back to DiffusionPipeline")

        if pipeline is None:
            self._ensure_vendored_pipeline_in_path()
            from diffusers import DiffusionPipeline
            pipeline = DiffusionPipeline.from_pretrained(
                model_source,
                custom_pipeline=custom_pipeline_dir,
                torch_dtype=dtype,
                local_files_only=is_local,
            )

        pipeline.scheduler = EulerAncestralDiscreteScheduler.from_config(
            pipeline.scheduler.config,
            timestep_spacing="trailing",
        )

        device = f"cuda:{self.gpu_id}" if use_cuda and self.gpu_id is not None else ("cuda" if use_cuda else "cpu")
        pipeline.to(device, dtype=dtype)
        self.pipeline = pipeline
        return pipeline

    def _load_normal_controlnet(self):
        if self.normal_pipeline is not None:
            return self.normal_pipeline

        if self.pipeline is None:
            raise RuntimeError("Base Zero123++ pipeline must be loaded before initializing normal ControlNet")

        from diffusers import ControlNetModel

        net_source = self._resolve_normal_controlnet_source()
        logger.info(f"Loading normal generation ControlNet from {net_source}")
        is_local = os.path.exists(net_source) if net_source else False
        dtype = self.pipeline.vae.dtype

        controlnet = ControlNetModel.from_pretrained(
            net_source,
            torch_dtype=dtype,
            local_files_only=is_local,
        )
        normal_pipe = copy.copy(self.pipeline)
        normal_pipe.add_controlnet(controlnet, conditioning_scale=1.0)
        normal_pipe.to(self.pipeline.device, dtype=dtype)
        self.normal_pipeline = normal_pipe
        return normal_pipe

    def _unload_model(self) -> None:
        logger.info("Unloading Zero123++ pipeline and releasing GPU memory")
        self.pipeline = None
        self.normal_pipeline = None
        self.rembg_session = None
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """
        Execute multi-view generation for a single reference image.

        Args:
            inputs: Dictionary containing:
                - image_path: Path to source reference image
                - asset_name: (Optional) safe name for output directory
                - inference_steps: Number of diffusion steps (default: 28)
                - guidance_scale: Classifier-free guidance scale (default: 4.0)
                - seed: Random seed (default: 42)
                - background_removal: Whether to remove source background (default: False)
                - generate_masks: Whether to generate binary view masks (default: False)
                - generate_normals: Whether to generate View-Space Normals (default: False)
                - save_contact_sheet: Whether to save 3x2 contact sheet (default: True)
                - output_format: 'png' or 'zip' (default: 'png')
                - job_id: (Optional) Job ID string
        """
        logger.info("[ZERO123++ ADAPTER] _process_request started")
        raw_image_input = (
            inputs.get("image_path")
            or inputs.get("image")
            or inputs.get("file_path")
        )
        if not raw_image_input:
            raise ValueError("Zero123++ adapter requires an 'image_path' input")

        resolved_input_path = resolve_server_file_path(str(raw_image_input)) or str(raw_image_input)
        if not os.path.exists(resolved_input_path):
            raise FileNotFoundError(f"Input image not found: {resolved_input_path}")

        source_path = Path(resolved_input_path)
        source_sha256 = compute_source_sha256(source_path)

        inference_steps = int(inputs.get("inference_steps") or 28)
        guidance_scale = float(inputs.get("guidance_scale") or 4.0)
        raw_seed = inputs.get("seed")
        seed = 42 if raw_seed is None else int(raw_seed)
        background_removal = bool(inputs.get("background_removal", False))
        generate_masks = bool(inputs.get("generate_masks", False))
        generate_normals = bool(inputs.get("generate_normals", False))
        save_contact_sheet = bool(inputs.get("save_contact_sheet", True))
        output_format = str(inputs.get("output_format", "png")).lower()
        job_id = str(inputs.get("job_id") or f"mv_{int(time.time())}")

        logger.info(f"[ZERO123++ ADAPTER] Parsed inputs: seed={seed}, bg_removal={background_removal}, generate_masks={generate_masks}, generate_normals={generate_normals}, save_contact_sheet={save_contact_sheet}, output_format={output_format}")

        req_params = {
            "source_sha256": source_sha256,
            "model_id": self.MODEL_ID,
            "model_version": self.MODEL_VERSION,
            "adapter_version": self.ADAPTER_VERSION,
            "inference_steps": inference_steps,
            "guidance_scale": guidance_scale,
            "seed": seed,
            "background_removal": background_removal,
            "generate_masks": generate_masks,
            "generate_normals": generate_normals,
            "save_contact_sheet": save_contact_sheet,
            "output_format": output_format,
        }
        request_sha256 = compute_request_sha256(req_params)

        # Determine canonical asset workspace: storage/models/<asset_name>_<job_hash>/multiview/
        raw_stem = source_path.stem
        asset_name = inputs.get("asset_name") or raw_stem
        safe_asset_name = "".join(c if c.isalnum() or c in "._-" else "_" for c in asset_name).strip("._-") or "asset"
        job_hash = hashlib.sha256(job_id.encode("utf-8")).hexdigest()[:8]

        storage_root = get_storage_base_dir() / "models" / "meshes"
        asset_workspace = storage_root / f"{safe_asset_name}_{job_hash}"
        multiview_dir = asset_workspace / "multiview"
        multiview_dir.mkdir(parents=True, exist_ok=True)
        logger.info(f"[ZERO123++ ADAPTER] Created workspace: {multiview_dir}")

        # 1. Retain original single-image source as multiview/source.png
        canonical_source_path = multiview_dir / "source.png"
        if not canonical_source_path.exists():
            shutil.copy2(source_path, canonical_source_path)
            logger.info(f"[ZERO123++ ADAPTER] Copied source image to {canonical_source_path}")

        # 2. Prepare PIL input for inference
        input_pil = Image.open(source_path)
        logger.info(f"[ZERO123++ ADAPTER] Loaded input image: {input_pil.size}")
        if background_removal:
            logger.info("[ZERO123++ ADAPTER] Starting background removal")
            import rembg
            if self.rembg_session is None:
                self.rembg_session = rembg.new_session()
                logger.info("[ZERO123++ ADAPTER] Created rembg session")
            input_pil = rembg.remove(input_pil, session=self.rembg_session)
            logger.info(f"[ZERO123++ ADAPTER] Background removal completed, image size: {input_pil.size}")

        # Expand to square and resize to >= 320x320 (e.g. 512x512)
        input_pil = expand_to_square(input_pil, (127, 127, 127, 0))
        logger.info(f"[ZERO123++ ADAPTER] After expand_to_square: {input_pil.size}")
        if input_pil.width < 320 or input_pil.height < 320:
            input_pil = input_pil.resize((320, 320), Image.Resampling.LANCZOS)
            logger.info(f"[ZERO123++ ADAPTER] Resized to 320x320: {input_pil.size}")
        elif max(input_pil.size) > 1280:
            ratio = 1280.0 / max(input_pil.size)
            new_size = (int(input_pil.width * ratio), int(input_pil.height * ratio))
            input_pil = input_pil.resize(new_size, Image.Resampling.LANCZOS)
            logger.info(f"[ZERO123++ ADAPTER] Resized to {new_size}: {input_pil.size}")

        # 3. Run Diffusion Pipeline to generate the 3x2 contact sheet
        if self.pipeline is None:
            logger.info("[ZERO123++ ADAPTER] Loading pipeline")
            self._load_model()
            logger.info("[ZERO123++ ADAPTER] Pipeline loaded")

        device = self.pipeline.device
        logger.info(f"[ZERO123++ ADAPTER] Pipeline device: {device}")
        generator = torch.Generator(device).manual_seed(seed)
        self.pipeline.set_progress_bar_config(disable=True)

        logger.info(
            "\n" + format_box(
                "ZERO123++ MULTI-VIEW INFERENCE",
                [
                    ("Job ID", job_id),
                    ("Source Image", f"{source_path.name} ({input_pil.width}x{input_pil.height})"),
                    ("Background Removal", background_removal),
                    ("Inference Steps", inference_steps),
                    ("Guidance Scale (CFG)", guidance_scale),
                    ("Seed", seed),
                    ("Target Workspace", str(multiview_dir)),
                ],
            )
        )
        logger.info(f"[ZERO123++ ADAPTER] Running Zero123++ multi-view inference ({inference_steps} steps, cfg={guidance_scale})")
        logger.info(f"[ZERO123++ ADAPTER] Calling pipeline with input size {input_pil.size}")
        pipeline_output = self.pipeline(
            input_pil,
            prompt="",
            num_inference_steps=inference_steps,
            guidance_scale=guidance_scale,
            generator=generator,
            width=640,
            height=960,
        )
        logger.info(f"[ZERO123++ ADAPTER] Pipeline call completed, got {len(pipeline_output.images)} images")
        contact_sheet_img: Image.Image = pipeline_output.images[0]

        if save_contact_sheet:
            contact_sheet_img.save(multiview_dir / "contact_sheet.png")
            logger.info(f"[ZERO123++ ADAPTER] Saved contact sheet to {multiview_dir / 'contact_sheet.png'}")

        # 4. Optional View-Space Normals generation via ControlNet
        normal_contact_sheet: Optional[Image.Image] = None
        if generate_normals:
            logger.info("[ZERO123++ ADAPTER] Starting View-Space Normals generation via ControlNet")
            try:
                normal_pipe = self._load_normal_controlnet()
                logger.info("[ZERO123++ ADAPTER] Loaded normal controlnet")
                normal_gen = torch.Generator(device).manual_seed(seed)
                normal_output = normal_pipe(
                    input_pil,
                    depth_image=contact_sheet_img,
                    prompt="",
                    guidance_scale=guidance_scale,
                    num_inference_steps=inference_steps,
                    generator=normal_gen,
                    width=640,
                    height=960,
                )
                normal_contact_sheet = normal_output.images[0]
                logger.info(f"[ZERO123++ ADAPTER] View-Space Normals generation completed")
            except Exception as e:
                logger.warning(f"[ZERO123++ ADAPTER] View-Space Normals generation skipped or failed: {e}", exc_info=True)
                normal_contact_sheet = None

        # 5. Crop the 6 views and optional masks/normals
        views_manifest: List[Dict[str, Any]] = []
        masks_dir = multiview_dir / "masks" if generate_masks else None
        normals_dir = multiview_dir / "normals" if (generate_normals and normal_contact_sheet) else None

        if masks_dir:
            masks_dir.mkdir(parents=True, exist_ok=True)
            logger.info(f"[ZERO123++ ADAPTER] Created masks directory: {masks_dir}")
        if normals_dir:
            normals_dir.mkdir(parents=True, exist_ok=True)
            logger.info(f"[ZERO123++ ADAPTER] Created normals directory: {normals_dir}")

        for camera in CAMERA_RIG:
            file_name = f"{camera['name']}.png"
            crop_box = camera["crop_box"]
            view_img = contact_sheet_img.crop(crop_box)
            view_dest = multiview_dir / file_name
            view_img.save(view_dest)
            logger.debug(f"[ZERO123++ ADAPTER] Saved view {file_name} to {view_dest}")

            # Mask handling
            if masks_dir:
                try:
                    import rembg
                    if self.rembg_session is None:
                        self.rembg_session = rembg.new_session()
                    segmented = rembg.remove(view_img, session=self.rembg_session, only_mask=True)
                    segmented.save(masks_dir / file_name)
                    logger.debug(f"[ZERO123++ ADAPTER] Saved mask for {file_name}")
                except Exception as e:
                    logger.debug(f"[ZERO123++ ADAPTER] Failed to generate mask for {file_name}: {e}")

            # Normal handling
            if normals_dir and normal_contact_sheet:
                normal_view = normal_contact_sheet.crop(crop_box)
                normal_view.save(normals_dir / file_name)
                logger.debug(f"[ZERO123++ ADAPTER] Saved normal for {file_name}")

            view_entry = {
                "file": file_name,
                "label": camera["label"],
                "azimuth_deg": camera["azimuth_deg"],
                "elevation_deg": camera["elevation_deg"],
                "fov_deg": camera["fov_deg"],
                "path": str(view_dest.resolve()),
            }
            if masks_dir and (masks_dir / file_name).exists():
                view_entry["mask_file"] = f"masks/{file_name}"
            if normals_dir and (normals_dir / file_name).exists():
                view_entry["normal_file"] = f"normals/{file_name}"

            views_manifest.append(view_entry)

        # 6. Write manifest.json
        manifest_data = {
            "schema_version": 1,
            "source_filename": source_path.name,
            "source_sha256": source_sha256,
            "request_sha256": request_sha256,
            "model_id": self.MODEL_ID,
            "model_version": self.MODEL_VERSION,
            "adapter_version": self.ADAPTER_VERSION,
            "inference_steps": inference_steps,
            "guidance_scale": guidance_scale,
            "seed": seed,
            "output_fov_deg": 30.0,
            "view_count": len(views_manifest),
            "views": views_manifest,
            "contact_sheet": "contact_sheet.png" if save_contact_sheet else None,
            "masks_generated": bool(masks_dir and masks_dir.exists()),
            "view_space_normals_generated": bool(normals_dir and normals_dir.exists()),
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        manifest_path = multiview_dir / "manifest.json"
        with open(manifest_path, "w", encoding="utf-8") as f:
            json.dump(manifest_data, f, indent=2)
        logger.info(f"[ZERO123++ ADAPTER] Wrote manifest to {manifest_path}")

        sheet_file = multiview_dir / "contact_sheet.png"
        sheet_size_str = f"{format_bytes(sheet_file.stat().st_size)}" if sheet_file.exists() else "N/A"
        logger.info(
            "\n" + format_box(
                "ZERO123++ VIEWS GENERATED",
                [
                    ("Views Exported", f"{len(views_manifest)} perspective views (320x320 PNG)"),
                    ("Contact Sheet", f"{contact_sheet_img.size[0]}x{contact_sheet_img.size[1]} ({sheet_size_str})" if save_contact_sheet else "In-memory"),
                    ("Normals Generated", bool(normals_dir and normals_dir.exists())),
                    ("Masks Generated", bool(masks_dir and masks_dir.exists())),
                    ("Output Directory", str(multiview_dir)),
                ],
            )
        )

        # 7. Generate ZIP archive if requested or on demand
        zip_path = None
        if output_format == "zip":
            logger.info("[ZERO123++ ADAPTER] Creating ZIP archive")
            zip_filename = f"{safe_asset_name}.zip"
            zip_path = asset_workspace / zip_filename
            self.create_multiview_zip(multiview_dir, zip_path)
            logger.info(f"[ZERO123++ ADAPTER] Created ZIP archive at {zip_path}")

        logger.info(f"[ZERO123++ ADAPTER] Zero123++ multi-view generation completed successfully: {multiview_dir}")
        logger.info("[ZERO123++ ADAPTER] _process_request finished")
        return {
            "status": "success",
            "model_id": self.MODEL_ID,
            "asset_name": safe_asset_name,
            "asset_id": asset_workspace.name,
            "job_id": job_id,
            "asset_workspace": str(asset_workspace.resolve()),
            "multiview_dir": str(multiview_dir.resolve()),
            "manifest_path": str(manifest_path.resolve()),
            "source_path": str(canonical_source_path.resolve()),
            "views": views_manifest,
            "zip_path": str(zip_path.resolve()) if zip_path else None,
            "manifest": manifest_data,
        }

    def get_supported_formats(self) -> Dict[str, List[str]]:
        return {
            "inputs": ["png", "jpg", "jpeg", "webp"],
            "outputs": ["png", "zip"],
        }

    def get_parameter_schema(self) -> Dict[str, Any]:
        return {
            "parameters": {
                "inference_steps": {
                    "type": "integer",
                    "description": "Number of diffusion denoising steps",
                    "default": 28,
                    "minimum": 15,
                    "maximum": 100,
                    "required": False,
                },
                "guidance_scale": {
                    "type": "number",
                    "description": "Classifier-free guidance scale",
                    "default": 4.0,
                    "minimum": 1.0,
                    "maximum": 10.0,
                    "required": False,
                },
                "seed": {
                    "type": "integer",
                    "description": "Random seed for generation",
                    "default": 42,
                    "required": False,
                },
                "background_removal": {
                    "type": "boolean",
                    "description": "Remove background from input image before multi-view generation",
                    "default": False,
                    "required": False,
                },
                "generate_masks": {
                    "type": "boolean",
                    "description": "Generate alpha masks for each novel view",
                    "default": False,
                    "required": False,
                },
                "generate_normals": {
                    "type": "boolean",
                    "description": "Generate View-Space Normals for each novel view using normal ControlNet",
                    "default": False,
                    "required": False,
                },
                "save_contact_sheet": {
                    "type": "boolean",
                    "description": "Save 3x2 composite contact sheet image",
                    "default": True,
                    "required": False,
                },
                "output_format": {
                    "type": "string",
                    "description": "Output format: 'png' view files or 'zip' archive",
                    "default": "png",
                    "enum": ["png", "zip"],
                    "required": False,
                },
            }
        }

    @staticmethod
    def create_multiview_zip(multiview_dir: Path, output_zip_path: Path) -> Path:
        """
        Create a ZIP package containing the generated views and manifest.
        Derives from original image stem without extra random hashes.
        """
        output_zip_path.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(output_zip_path, "w", zipfile.ZIP_DEFLATED) as zip_file:
            for file_path in multiview_dir.rglob("*"):
                if file_path.is_file():
                    arcname = file_path.relative_to(multiview_dir)
                    zip_file.write(file_path, arcname)
        return output_zip_path
