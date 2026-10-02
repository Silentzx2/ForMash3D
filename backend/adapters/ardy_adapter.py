"""
ARDY model adapter for autoregressive human and humanoid motion generation.

Integrates nv-tlabs/ardy for interactive text-to-motion generation,
producing browser-playable motion.json artifacts and raw .npz files.
"""

import logging
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
import torch

from core.animation.ardy_converter import (
    convert_ardy_output_to_motion_json,
    save_motion_json,
    validate_skeleton_compatibility,
    CORE_SKELETON_27_BONES,
    G1_SKELETON_34_BONES,
)
from core.models.base import BaseModel, ModelStatus
from core.utils.file_utils import OutputPathGenerator

logger = logging.getLogger(__name__)

CHECKPOINT_VARIANTS = {
    "core40": "ARDY-Core-RP-20FPS-Horizon40",
    "core8": "ARDY-Core-RP-20FPS-Horizon8",
    "g1_52": "ARDY-G1-RP-25FPS-Horizon52",
    "g1_8": "ARDY-G1-RP-25FPS-Horizon8",
    "ARDY-Core-RP-20FPS-Horizon40": "ARDY-Core-RP-20FPS-Horizon40",
    "ARDY-Core-RP-20FPS-Horizon8": "ARDY-Core-RP-20FPS-Horizon8",
    "ARDY-G1-RP-25FPS-Horizon52": "ARDY-G1-RP-25FPS-Horizon52",
    "ARDY-G1-RP-25FPS-Horizon8": "ARDY-G1-RP-25FPS-Horizon8",
}

DEFAULT_CHECKPOINT = "ARDY-Core-RP-20FPS-Horizon40"


class ArdyMotionGenerationAdapter(BaseModel):
    """
    Adapter for NVIDIA ARDY interactive text-to-motion generation.
    Supports Core human skeleton (20 FPS) and Unitree G1 humanoid (25 FPS).
    """

    FEATURE_TYPE = "motion_generation"
    MODEL_ID = "ardy_motion_generation"

    def __init__(
        self,
        model_id: str = "ardy_motion_generation",
        model_path: Optional[str] = None,
        vram_requirement: Optional[int] = None,
        ardy_root: Optional[str] = None,
        default_checkpoint: str = DEFAULT_CHECKPOINT,
    ):
        if vram_requirement is None:
            raise ValueError(
                f"VRAM requirement for {self.MODEL_ID if hasattr(self, 'MODEL_ID') else model_id} must come from the model manifest"
            )
        if model_path is None:
            model_path = "backend/pretrained/ardy"

        if ardy_root is None:
            ardy_root = str(Path(__file__).resolve().parent.parent / "thirdparty" / "ardy")

        super().__init__(
            model_id=model_id,
            model_path=model_path,
            vram_requirement=vram_requirement,
            feature_type="motion_generation",
        )

        self.ardy_root = Path(ardy_root)
        self.default_checkpoint = default_checkpoint
        self.current_checkpoint = default_checkpoint
        self.ardy_model = None
        self.path_generator = OutputPathGenerator(base_output_dir="outputs")

    def _ensure_ardy_in_path(self):
        root_str = str(self.ardy_root)
        if root_str not in sys.path:
            sys.path.insert(0, root_str)

    def _resolve_checkpoint(self, requested: Optional[str]) -> str:
        if not requested:
            return self.default_checkpoint
        return CHECKPOINT_VARIANTS.get(requested, requested)

    def _load_model(self):
        """Load ARDY model with specified checkpoint."""
        try:
            self._ensure_ardy_in_path()
            logger.info(f"Loading ARDY model from {self.ardy_root} (checkpoint: {self.current_checkpoint})")

            device = "cuda" if torch.cuda.is_available() else "cpu"

            from ardy.model import load_model as ardy_load
            from ardy.model.registry import resolve_model_name

            checkpoints_dir = (
                str(self.model_path)
                if Path(self.model_path).exists()
                else os.environ.get("CHECKPOINTS_DIR", None)
            )

            resolved = resolve_model_name(self.current_checkpoint, checkpoints_dir=checkpoints_dir)
            self.ardy_model = ardy_load(resolved, device=device, checkpoints_dir=checkpoints_dir)

            logger.info(f"✓ ARDY model loaded successfully on {device}: {resolved}")
            return self.ardy_model

        except Exception as e:
            logger.error(f"Failed to load ARDY model: {e}")
            raise RuntimeError(f"Failed to load ARDY model: {e}")

    def _unload_model(self):
        """Unload ARDY model and release VRAM."""
        try:
            self.ardy_model = None
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
            logger.info("ARDY model unloaded successfully")
        except Exception as e:
            logger.error(f"Error unloading ARDY model: {e}")

    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """
        Process text-to-motion generation request.

        Inputs:
            - prompt: Text description of motion (required)
            - duration: Length of motion in seconds (default: 5.0)
            - seed: Optional integer seed
            - checkpoint: Optional checkpoint name (e.g. core40, core8, g1_52, g1_8)
            - post_process: Optional bool to apply motion cleanup
            - target_skeleton: Optional skeleton ID ("core", "g1")
            - target_bones: Optional list of bone names for compatibility check
            - constraints: Optional kinematic constraints
        """
        try:
            self.status = ModelStatus.PROCESSING
            self._ensure_ardy_in_path()

            prompt = inputs.get("prompt", "").strip()
            if not prompt:
                raise ValueError("prompt is required for motion generation")

            duration = float(inputs.get("duration", 5.0))
            if duration <= 0:
                raise ValueError("duration must be greater than 0")

            requested_cp = inputs.get("checkpoint")
            resolved_cp = self._resolve_checkpoint(requested_cp)
            seed = inputs.get("seed")
            post_process = bool(inputs.get("post_process", True))
            target_bones = inputs.get("target_bones")

            device = "cuda" if torch.cuda.is_available() else "cpu"

            # Determine skeleton type from checkpoint
            is_g1 = "g1" in resolved_cp.lower()
            skeleton_id = "g1" if is_g1 else "core"

            # Validate target skeleton compatibility before expensive generation
            source_bones = G1_SKELETON_34_BONES if is_g1 else CORE_SKELETON_27_BONES
            if target_bones:
                is_compat, coverage, _ = validate_skeleton_compatibility(
                    source_bones, target_bones, min_coverage=0.5
                )
                if not is_compat:
                    raise ValueError(
                        f"Incompatible skeleton for '{skeleton_id}' motion: "
                        f"only {coverage*100:.1f}% bone coverage with target rig (minimum 50% required)."
                    )

            # Check if model needs reloading due to different checkpoint
            if self.ardy_model is None or self.current_checkpoint != resolved_cp:
                self.current_checkpoint = resolved_cp
                self._load_model()

            fps = float(getattr(self.ardy_model.motion_rep, "fps", 20.0))
            num_frames = int(duration * fps)

            if seed is not None:
                from ardy.tools import seed_everything
                seed_everything(int(seed))

            # Run ARDY inference
            from ardy.motion_rep.tools import length_to_mask
            from ardy.tools import to_numpy

            texts = [prompt]
            lengths = torch.tensor([num_frames], device=device)
            pad_mask = length_to_mask(lengths)
            first_heading_angle = torch.zeros(1, device=device)

            with torch.no_grad():
                motion = self.ardy_model(
                    texts,
                    num_frames,
                    pad_mask=pad_mask,
                    first_heading_angle=first_heading_angle,
                )
                output = self.ardy_model.motion_rep.inverse(motion, is_normalized=True)

            # Post-processing
            if post_process and not is_g1:
                try:
                    from ardy.postprocess import post_process_motion
                    corrected = post_process_motion(
                        output["local_rot_mats"],
                        output["root_positions"],
                        output["foot_contacts"],
                        self.ardy_model.skeleton,
                    )
                    output.update(corrected)
                except Exception as pp_err:
                    logger.warning(f"Motion post-processing skipped: {pp_err}")

            output_np = to_numpy(output)

            # Generate output filenames
            import uuid
            unique_id = uuid.uuid4().hex
            safe_name = f"motion_{skeleton_id}_{unique_id}"
            
            output_dir = Path(self.path_generator.base_output_dir) / "motions" / safe_name
            output_dir.mkdir(parents=True, exist_ok=True)

            npz_path = output_dir / f"{safe_name}.npz"
            json_path = output_dir / "motion.json"

            # 1. Save raw NPZ
            arrays = {k: np.asarray(v) for k, v in output_np.items()}
            arrays["fps"] = np.asarray(fps)
            arrays["text"] = np.asarray(prompt)
            np.savez(str(npz_path), **arrays)

            # 2. Convert and save browser-playable motion.json
            motion_doc = convert_ardy_output_to_motion_json(
                output_data=output_np,
                skeleton_id=skeleton_id,
                fps=fps,
                prompt=prompt,
                target_bones=target_bones,
            )
            save_motion_json(motion_doc, json_path)

            rel_motion_url = f"/outputs/motions/{safe_name}/motion.json"
            rel_source_url = f"/outputs/motions/{safe_name}/{safe_name}.npz"

            response = {
                "success": True,
                "motion_url": rel_motion_url,
                "source_motion_url": rel_source_url,
                "output_mesh_path": rel_motion_url,  # Bridge for generic job result consumers
                "fps": motion_doc["fps"],
                "duration": motion_doc["duration"],
                "num_frames": motion_doc["num_frames"],
                "skeleton_id": motion_doc["skeleton_id"],
                "joint_names": motion_doc["joint_names"],
                "model_id": self.model_id,
                "checkpoint": resolved_cp,
                "prompt": prompt,
                "generation_info": {
                    "model": self.model_id,
                    "checkpoint": resolved_cp,
                    "fps": fps,
                    "num_frames": motion_doc["num_frames"],
                    "skeleton_id": motion_doc["skeleton_id"],
                    "post_processed": post_process and not is_g1,
                },
            }

            self.status = ModelStatus.LOADED
            logger.info(f"✓ ARDY motion generation completed: {rel_motion_url}")
            return response

        except Exception as e:
            self.status = ModelStatus.ERROR
            logger.error(f"ARDY generation failed: {e}")
            raise RuntimeError(f"ARDY generation failed: {e}")

    def get_supported_formats(self) -> Dict[str, List[str]]:
        return {"input": ["text"], "output": ["json", "npz"]}

    def get_parameter_schema(self) -> Dict[str, Any]:
        return {
            "parameters": {
                "prompt": {
                    "type": "string",
                    "description": "Text description of the motion to generate",
                    "required": True,
                },
                "duration": {
                    "type": "number",
                    "description": "Duration of the motion in seconds",
                    "default": 5.0,
                    "minimum": 0.5,
                    "maximum": 30.0,
                    "required": False,
                },
                "checkpoint": {
                    "type": "string",
                    "description": "ARDY model checkpoint variant",
                    "enum": list(CHECKPOINT_VARIANTS.keys()),
                    "default": DEFAULT_CHECKPOINT,
                    "required": False,
                },
                "seed": {
                    "type": "integer",
                    "description": "Random seed for reproducibility",
                    "default": None,
                    "required": False,
                },
                "post_process": {
                    "type": "boolean",
                    "description": "Apply foot skating contact cleanup",
                    "default": True,
                    "required": False,
                },
                "target_skeleton": {
                    "type": "string",
                    "description": "Target skeleton identifier ('core' or 'g1')",
                    "default": "core",
                    "required": False,
                },
            }
        }
