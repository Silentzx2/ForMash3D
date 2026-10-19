"""
UniRig model adapter for automatic rigging of 3D meshes.

This adapter integrates the UniRig fast inference engine for automatic
mesh rigging with skeleton generation and skin weight computation.
"""

import logging
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

import torch

from core.models.base import ModelStatus
from core.models.rig_models import AutoRigModel
from core.utils.file_utils import OutputPathGenerator, get_storage_base_dir
from core.utils.format_utils import fbx_to_glb
from core.utils.mesh_utils import MeshProcessor

logger = logging.getLogger(__name__)


class UniRigAdapter(AutoRigModel):
    """
    Adapter for UniRig automatic rigging model.

    Integrates UniRig's fast inference engine for automatic mesh rigging
    with skeleton generation and skin weight computation.
    """

    def __init__(
        self,
        model_id: str = "unirig_auto_rig",
        model_path: Optional[str] = None,
        vram_requirement: Optional[int] = None,
        unirig_root: Optional[str] = None,
        device: str = "cuda",
    ):
        if vram_requirement is None:
            raise ValueError(
                f"VRAM requirement for {self.MODEL_ID if hasattr(self, 'MODEL_ID') else model_id} must come from the model manifest"
            )
        backend_root = Path(__file__).resolve().parents[1]
        if model_path is None:
            model_path = str(backend_root / "pretrained" / "UniRig")

        if unirig_root is None:
            unirig_root = str(backend_root / "thirdparty" / "UniRig")

        super().__init__(
            model_id=model_id,
            model_path=model_path,
            vram_requirement=vram_requirement,
            supported_input_formats=["fbx", "obj", "glb"],
            supported_output_formats=["fbx", "glb"],
        )

        self.unirig_root = Path(unirig_root)
        self.device = device
        self.inference_engine: Optional[Any] = None
        self.mesh_processor = MeshProcessor()
        self.path_generator = OutputPathGenerator(base_output_dir="outputs")

    def _load_model(self):
        """Load UniRig inference engine."""
        try:
            if not torch.cuda.is_available():
                raise RuntimeError("UniRig requires CUDA; CPU inference is not supported.")
            if self.gpu_id is not None and self.device in {"cuda", "cuda:0"}:
                self.device = f"cuda:{self.gpu_id}"
            elif not self.device or self.device.startswith("cpu"):
                self.device = f"cuda:{self.gpu_id}" if self.gpu_id is not None else "cuda:0"
            logger.info(f"Loading UniRig model from {self.unirig_root}")

            # Verify UniRig installation
            if not self.unirig_root.exists():
                raise FileNotFoundError(f"UniRig not found at: {self.unirig_root}")

            # Add UniRig to Python path
            if str(self.unirig_root) not in sys.path:
                sys.path.insert(0, str(self.unirig_root))

            try:
                from core.utils.runtime_compat import get_backend_torchvision_fix
                get_backend_torchvision_fix().apply_fix()
            except Exception as fix_err:
                logger.warning(
                    "Backend runtime compatibility setup failed before UniRig initialization: %s",
                    fix_err,
                    exc_info=True,
                )

            from utils.unirig_utils import InferenceConfig, UniRigInferenceEngine

            use_bf16 = False
            if torch.cuda.is_available():
                use_bf16 = getattr(torch.cuda, "is_bf16_supported", lambda: False)()

            # Create inference configuration with VRAM-conscious settings
            config = InferenceConfig(
                device=self.device,
                compile_model=False,  # Fallback to eager mode to conserve VRAM
                cache_dir=str(
                    self.path_generator.base_output_dir / "temp" / "unirig_cache"
                ),
                precision="bf16-mixed" if use_bf16 else "fp16",
            )

            # Initialize inference engine
            self.inference_engine = UniRigInferenceEngine(config)

            # Preload models for faster inference
            self.inference_engine.preload_systems()

            logger.info("UniRig model loaded successfully")
            return self.inference_engine

        except Exception as e:
            logger.exception("Failed to load UniRig model from %s", self.unirig_root)
            raise RuntimeError(f"Failed to load UniRig model: {e}") from e

    def _unload_model(self):
        """Unload UniRig model."""
        try:
            if self.inference_engine is not None:
                # Clear model cache
                self.inference_engine.clear_cache()
                self.inference_engine = None

            # Clear CUDA cache
            if torch.cuda.is_available():
                torch.cuda.empty_cache()

            logger.info("UniRig model unloaded successfully")

        except Exception as e:
            logger.error(f"Error unloading UniRig model: {str(e)}")

    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """
        Process auto-rigging request using UniRig.

        Args:
            inputs: Dictionary containing:
                - mesh_path: Path to input mesh (required)
                - rig_mode: Rigging mode ("skeleton", "skin", "full") (default: "full")
                - output_format: Output format ("fbx", "glb") (default: "fbx")
                - seed: Random seed for generation (default: None)
                - with_skinning: Whether to apply skinning weights (default: True)
                - skeleton_config: Path to skeleton task config (default: None)
                - skin_config: Path to skin task config (default: None)

        Returns:
            Dictionary with rigging results
        """
        try:
            if not torch.cuda.is_available():
                raise RuntimeError("UniRig requires CUDA; CPU inference is not supported.")
            if self.gpu_id is not None and self.device in {"cuda", "cuda:0"}:
                self.device = f"cuda:{self.gpu_id}"
            elif not self.device or self.device.startswith("cpu"):
                self.device = f"cuda:{self.gpu_id}" if self.gpu_id is not None else "cuda:0"
            if self.inference_engine is None:
                raise ValueError("UniRig inference engine is not loaded")

            # Validate inputs
            if "mesh_path" not in inputs:
                raise ValueError("mesh_path is required for auto-rigging")

            mesh_path = Path(inputs["mesh_path"]).resolve()
            if mesh_path.is_dir():
                candidate = None
                for sub in [
                    mesh_path / "game_ready" / "game_ready.fbx",
                    mesh_path / "game_ready" / "game_ready.glb",
                    mesh_path / "master" / "source.fbx",
                    mesh_path / "master" / "source.glb",
                    mesh_path / "source.fbx",
                    mesh_path / "source.glb",
                ]:
                    if sub.is_file():
                        candidate = sub
                        break
                if candidate is None:
                    all_fbx = sorted(mesh_path.rglob("*.fbx"))
                    all_glb = sorted(mesh_path.rglob("*.glb"))
                    if all_fbx:
                        candidate = all_fbx[0]
                    elif all_glb:
                        candidate = all_glb[0]
                if candidate:
                    logger.info(f"Resolved mesh directory {mesh_path} to file: {candidate}")
                    mesh_path = candidate
                else:
                    raise FileNotFoundError(f"No valid 3D mesh (.glb or .fbx) found in directory: {mesh_path}")
            elif not mesh_path.is_file():
                for alt_ext in [".glb", ".fbx", ".obj"]:
                    alt_path = mesh_path.with_suffix(alt_ext)
                    if alt_path.is_file():
                        mesh_path = alt_path
                        break
                if not mesh_path.is_file():
                    raise FileNotFoundError(f"Input mesh file not found: {mesh_path}")

            # If input is a GLB, prefer companion FBX if it exists in the same folder
            if mesh_path.suffix.lower() == ".glb":
                companion_fbx = mesh_path.with_suffix(".fbx")
                if companion_fbx.is_file():
                    logger.info(f"Using companion FBX file for rigging: {companion_fbx}")
                    mesh_path = companion_fbx

            # EXPERIMENTAL_MAX_DETAIL: UniRig exposes rig_mode and optional seed, not CFG/denoising steps.
            # Upstream recommends refining an inaccurate predicted skeleton before skinning. Ask before changing profile defaults.
            rig_mode = inputs.get("rig_mode", "full")
            raw_output_format = str(inputs.get("output_format", "fbx")).lower().strip()
            output_format = raw_output_format if raw_output_format in ["fbx", "glb"] else "fbx"
            seed = inputs.get("seed", None)
            with_skinning = inputs.get("with_skinning", True)
            skeleton_config = inputs.get("skeleton_config", None)
            skin_config = inputs.get("skin_config", None)

            # Validate rig mode
            if rig_mode not in ["skeleton", "skin", "full"]:
                raise ValueError(
                    f"Invalid rig_mode: {rig_mode}. Must be 'skeleton', 'skin', or 'full'"
                )

            logger.info(f"Auto-rigging mesh with UniRig: {mesh_path}, mode: {rig_mode}")

            # Load and validate mesh
            try:
                mesh = self.mesh_processor.load_mesh(mesh_path)
                # if not self.mesh_processor.validate_mesh(mesh):
                # logger.warning("Input mesh validation failed, proceeding anyway")
                mesh_stats = self.mesh_processor.get_mesh_stats(mesh)
            except Exception as e:
                logger.warning(f"Failed to analyze input mesh: {e}")
                mesh_stats = {"vertex_count": 0, "face_count": 0}

            output_dir_value = inputs.get("output_dir")
            if not output_dir_value:
                raise ValueError("output_dir is required for canonical UniRig artifacts")
            output_dir = Path(output_dir_value).resolve()
            meshes_root = (get_storage_base_dir() / "models" / "meshes").resolve()
            try:
                output_dir.relative_to(meshes_root)
            except ValueError as exc:
                raise ValueError("UniRig output_dir must be inside a canonical asset workspace") from exc

            output_dir.mkdir(parents=True, exist_ok=True)
            output_path = output_dir / "rigged.fbx"

            if rig_mode == "skeleton":
                # NOTE: using await here will make blender context incorrect
                result_path = self.inference_engine.generate_skeleton(
                    str(mesh_path),
                    str(output_dir),
                    str(output_path),
                    skeleton_config,
                )
                has_skinning = False

            elif rig_mode == "skin":
                result_path = self.inference_engine.generate_skin_weights(
                    str(mesh_path),
                    str(output_dir),
                    str(output_path),
                    skin_config,
                )
                has_skinning = True

            else:  # full pipeline
                result_path = self.inference_engine.full_pipeline(
                    str(mesh_path),
                    str(output_dir),
                    str(output_path),
                )
                has_skinning = with_skinning

            # Keep native FBX for download and convert a separate GLB for the viewport.
            output_fbx_path = Path(result_path).resolve()
            if output_fbx_path.suffix.lower() != ".fbx" or not output_fbx_path.is_file():
                raise RuntimeError(f"UniRig did not produce the requested FBX artifact: {output_fbx_path}")
            result_path = fbx_to_glb(str(output_fbx_path))
            result_path = Path(result_path).resolve()
            try:
                result_path.relative_to(output_dir)
            except ValueError as exc:
                raise RuntimeError("UniRig GLB preview was written outside its canonical job directory") from exc

            # Verify output was created
            if result_path.suffix.lower() != ".glb" or not result_path.is_file():
                raise Exception(f"UniRig failed to generate output file: {result_path}")

            # Estimate bone count from output (simplified approach)
            bone_count = self._estimate_bone_count(Path(result_path))

            # Create rig info
            rig_info = {
                "rig_type": "auto_detected",
                "has_skinning": has_skinning,
                "skeleton_only": rig_mode == "skeleton",
                "generation_method": "unirig_fast_inference",
                "bone_count": bone_count,
                "rig_mode": rig_mode,
            }

            # Create response
            response = {
                "output_mesh_path": str(result_path),
                "output_fbx_path": str(output_fbx_path),
                "bone_count": bone_count,
                "rig_info": rig_info,
                "format": output_format,
                "success": True,
                "generation_info": {
                    "model": self.model_id,
                    "input_mesh": str(mesh_path),
                    "vertex_count": mesh_stats.get("vertex_count", 0),
                    "face_count": mesh_stats.get("face_count", 0),
                    "rig_mode": rig_mode,
                    "device": self.device,
                    "seed": seed,
                },
            }

            logger.info(f"UniRig auto-rigging completed: {result_path}")
            self.status = ModelStatus.LOADED
            return response

        except Exception as e:
            import traceback

            traceback.print_exc()
            self.status = ModelStatus.ERROR
            logger.error(f"UniRig auto-rigging failed: {str(e)}")
            raise Exception(f"UniRig auto-rigging failed: {str(e)}")
        finally:
            if torch.cuda.is_available():
                torch.cuda.empty_cache()

    def _generate_thumbnail_path(self, mesh_path: Path) -> Path:
        """Generate thumbnail file path based on mesh path."""
        thumbnail_dir = Path(self.path_generator.base_output_dir) / "thumbnails"
        thumbnail_dir.mkdir(parents=True, exist_ok=True)
        return thumbnail_dir / (mesh_path.stem + "_thumb.png")

    def _get_thumbnail_path(self, filename: str) -> Path:
        thumbnail_dir = Path(self.path_generator.base_output_dir) / "thumbnails"
        thumbnail_dir.mkdir(parents=True, exist_ok=True)
        return thumbnail_dir / filename

    def _estimate_bone_count(self, rigged_file: Path) -> int:
        """
        Estimate bone count from rigged file.

        This is a simplified implementation. In practice, you would
        parse the file format to count actual bones.
        """
        try:
            # For FBX files, we could parse and count bones
            # For now, return a reasonable estimate based on file size
            file_size = rigged_file.stat().st_size

            # Rough heuristic: larger files typically have more bones
            if file_size > 10 * 1024 * 1024:  # > 10MB
                return 50  # Complex rig
            elif file_size > 5 * 1024 * 1024:  # > 5MB
                return 30  # Medium rig
            elif file_size > 1 * 1024 * 1024:  # > 1MB
                return 20  # Simple rig
            else:
                return 15  # Minimal rig

        except Exception as e:
            logger.warning(f"Failed to estimate bone count: {e}")
            return 20  # Default estimate

    def get_supported_formats(self) -> Dict[str, List[str]]:
        """Return supported input/output formats for UniRig."""
        return {"input": ["fbx", "obj", "glb"], "output": ["fbx", "glb"]}

    def get_model_info(self) -> Dict[str, Any]:
        """Get detailed model information for UniRig."""
        info = super().get_model_info()
        info.update(
            {
                "model_name": "UniRig",
                "version": "1.0",
                "description": "Unified automatic rigging using fast inference engine",
                "capabilities": [
                    "Automatic skeleton generation",
                    "Skin weight prediction",
                ],
                "stages": [
                    "Skeleton prediction using autoregressive transformer",
                    "Skin weight computation using bone-point cross attention",
                ],
                "requirements": {
                    "vram_gb": 8,
                    "pytorch_version": ">=2.3.1",
                    "cuda_required": True,
                },
                "interface": "fast_inference_engine",
                "supported_modes": ["skeleton", "skin", "full"],
                "performance": {
                    "skeleton_generation": "~30-60 seconds",
                    "skin_generation": "~60-120 seconds",
                    "full_pipeline": "~90-180 seconds",
                },
            }
        )
        return info
    
    def get_parameter_schema(self) -> Dict[str, Any]:
        """
        Return JSON Schema describing model-specific parameters.
        
        Returns:
            Parameter schema dictionary
        """
        return {
            "parameters": {
                "rig_mode": {
                    "type": "string",
                    "description": "Rigging mode: skeleton only, skin weights only, or full pipeline",
                    "default": "full",
                    "enum": ["skeleton", "skin", "full"],
                    "required": False
                },
                "seed": {
                    "type": "integer",
                    "description": "Random seed for reproducibility",
                    "default": None,
                    "minimum": 0,
                    "required": False
                },
                "with_skinning": {
                    "type": "boolean",
                    "description": "Whether to apply skinning weights (only for full mode)",
                    "default": True,
                    "required": False
                }
            }
        }
