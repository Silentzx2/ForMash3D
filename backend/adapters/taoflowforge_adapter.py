"""
TaoFlowForge model adapter for progressive native mesh generation.

Integrates Alibaba Taobao3D TaoFlowForge 3-stage flow matching pipeline
for generating native-topology raw 3D meshes directly from images.
"""

from __future__ import annotations

import logging
import os
import shutil
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

try:
    import torch
except ImportError:
    torch = None

from core.models.base import ModelStatus
from core.models.mesh_models import ImageToMeshModel
from core.utils.file_utils import OutputPathGenerator
from core.utils.mesh_utils import MeshProcessor

logger = logging.getLogger(__name__)


class TaoFlowForgeImageToRawMeshAdapter(ImageToMeshModel):
    """
    Adapter for TaoFlowForge progressive native mesh generation.

    Generates native-topology raw 3D meshes (GLB/OBJ) from a single image
    using a 3-stage progressive flow matching pipeline.
    """

    FEATURE_TYPE = "image_to_raw_mesh"
    MODEL_ID = "taoflowforge_image_to_raw_mesh"

    def __init__(
        self,
        model_id: str = "taoflowforge_image_to_raw_mesh",
        model_path: Optional[str] = None,
        vram_requirement: Optional[int] = None,
        taoflowforge_root: Optional[Union[str, Path]] = None,
        stage0_checkpoint: Optional[Union[str, Path]] = None,
        stage1_checkpoint: Optional[Union[str, Path]] = None,
        stage2_checkpoint: Optional[Union[str, Path]] = None,
        dino_checkpoint: Optional[Union[str, Path]] = None,
        offload: str = "auto",
        fill_holes: bool = True,
        **kwargs: Any,
    ):
        backend_dir = Path(__file__).resolve().parents[1]

        if taoflowforge_root is None:
            candidates = [
                backend_dir / "thirdparty" / "Taobao3D" / "TaoFlowForge",
                backend_dir / "thirdparty" / "TaoFlowForge",
            ]
            taoflowforge_root = next((c for c in candidates if c.exists()), candidates[0])
        self.taoflowforge_root = Path(taoflowforge_root).resolve()

        if model_path is None:
            model_path = str((backend_dir / "pretrained" / "Taobao3D" / "TaoFlowForge").resolve())
        else:
            p = Path(model_path)
            if not p.is_absolute():
                parts = list(p.parts)
                if parts and parts[0] == "backend":
                    p = Path(*parts[1:])
                for candidate in [backend_dir / p, backend_dir.parent / p, Path.cwd() / p]:
                    if candidate.exists():
                        p = candidate
                        break
                else:
                    p = backend_dir / p
            model_path = str(p.resolve())
        self.model_path = Path(model_path)

        if vram_requirement is None:
            vram_requirement = 20480

        super().__init__(
            model_id=model_id,
            model_path=str(self.model_path),
            vram_requirement=vram_requirement,
            supported_output_formats=["glb", "obj"],
            feature_type=self.FEATURE_TYPE,
        )

        self.native_topology: bool = True

        # Checkpoints
        self.stage0_checkpoint = (
            Path(stage0_checkpoint).resolve()
            if stage0_checkpoint is not None
            else (self.model_path / "stage0.pt").resolve()
        )
        self.stage1_checkpoint = (
            Path(stage1_checkpoint).resolve()
            if stage1_checkpoint is not None
            else (self.model_path / "stage1.pt").resolve()
        )
        self.stage2_checkpoint = (
            Path(stage2_checkpoint).resolve()
            if stage2_checkpoint is not None
            else (self.model_path / "stage2.pt").resolve()
        )
        self.dino_checkpoint = (
            Path(dino_checkpoint).resolve()
            if dino_checkpoint is not None
            else (
                (self.model_path / "dino.pt").resolve()
                if (self.model_path / "dino.pt").exists()
                else None
            )
        )

        self.offload = offload
        self.fill_holes = fill_holes
        self.pipeline = None
        self.mesh_processor = MeshProcessor()
        self.path_generator = OutputPathGenerator(base_output_dir="outputs")

    def is_installed(self) -> bool:
        """Check if TaoFlowForge thirdparty code is present."""
        init_file = self.taoflowforge_root / "taoflowforge" / "__init__.py"
        return self.taoflowforge_root.exists() and init_file.is_file()

    def is_available(self) -> bool:
        """Check if model is installed, torch with CUDA is available, and checkpoints exist on disk."""
        if not self.is_installed():
            return False

        torch_module = torch
        if torch_module is None:
            try:
                import torch as _torch
                torch_module = _torch
            except ImportError:
                return False

        if not torch_module.cuda.is_available():
            return False

        return (
            self.stage0_checkpoint.is_file()
            and self.stage1_checkpoint.is_file()
            and self.stage2_checkpoint.is_file()
        )

    def _load_model(self):
        """
        Load TaoFlowForge pipeline and required weights.
        """
        root_str = str(self.taoflowforge_root)
        if root_str not in sys.path:
            sys.path.insert(0, root_str)

        missing = []
        for stage_idx, ckpt in [
            (0, self.stage0_checkpoint),
            (1, self.stage1_checkpoint),
            (2, self.stage2_checkpoint),
        ]:
            if not ckpt.is_file():
                missing.append(f"Stage {stage_idx} checkpoint ({ckpt})")

        if missing:
            raise FileNotFoundError(
                f"TaoFlowForge checkpoints missing: {', '.join(missing)}. "
                f"Please download stage0.pt, stage1.pt, and stage2.pt to '{self.model_path}' "
                f"from https://github.com/alibaba/Taobao3D."
            )

        torch_module = torch
        if torch_module is None:
            try:
                import torch as _torch
                torch_module = _torch
            except ImportError as e:
                raise RuntimeError("PyTorch is required to run TaoFlowForge.") from e

        device = (
            f"cuda:{self.gpu_id}"
            if self.gpu_id is not None
            else ("cuda:0" if torch_module.cuda.is_available() else "cpu")
        )
        if device.startswith("cuda") and not torch_module.cuda.is_available():
            raise RuntimeError("TaoFlowForge requires CUDA; no GPU is available.")

        try:
            from taoflowforge.config import InferenceConfig, Stage0Config, Stage1Config, Stage2Config
            from taoflowforge.pipeline import TaoFlowForgePipeline
        except ImportError as e:
            raise RuntimeError(
                f"Failed to import TaoFlowForge pipeline components from {self.taoflowforge_root}: {e}"
            ) from e

        logger.info("Initializing TaoFlowForgePipeline on device=%s, offload=%s", device, self.offload)
        inference_config = InferenceConfig(
            stage0=Stage0Config(checkpoint=self.stage0_checkpoint),
            stage1=Stage1Config(checkpoint=self.stage1_checkpoint),
            stage2=Stage2Config(checkpoint=self.stage2_checkpoint),
            dino_checkpoint=self.dino_checkpoint,
            offload=self.offload,
            fill_holes=self.fill_holes,
        )
        self.pipeline = TaoFlowForgePipeline.from_config(inference_config, device=device)
        return self.pipeline

    def _unload_model(self):
        """Clean up pipeline and release GPU memory."""
        if self.pipeline is not None:
            try:
                if hasattr(self.pipeline, "close"):
                    self.pipeline.close()
            except Exception as e:
                logger.warning("Error closing TaoFlowForge pipeline: %s", e)
            self.pipeline = None

        torch_module = torch
        if torch_module is not None:
            try:
                if torch_module.cuda.is_available():
                    torch_module.cuda.empty_cache()
            except Exception:
                pass
        logger.info("TaoFlowForge model unloaded successfully")

    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """
        Process image-to-raw-mesh generation request with TaoFlowForge.

        Inputs:
            - image_paths: List of file paths or single file path
            - image_path: Single file path
            - image: Path or PIL Image / Tensor
            - output_format: 'glb' or 'obj' (default: 'glb')
            - seed: Optional random seed (default: 42)
            - fill_holes: Optional bool (default: self.fill_holes)
            - show_progress: Optional bool (default: False)
        """
        try:
            self.status = ModelStatus.PROCESSING

            image_input = inputs.get("image_path")
            if not image_input and "image_paths" in inputs:
                paths = inputs["image_paths"]
                image_input = paths[0] if isinstance(paths, list) else paths
            if not image_input and "image" in inputs:
                image_input = inputs["image"]

            if not image_input:
                raise ValueError("image_path, image_paths, or image is required for TaoFlowForge generation")

            if isinstance(image_input, (str, Path)):
                input_file = Path(image_input)
                if not input_file.exists():
                    raise FileNotFoundError(f"Input image not found: {input_file}")
                input_for_pipeline = str(input_file)
                stem = input_file.stem
            else:
                input_for_pipeline = image_input
                stem = "image"

            output_format = inputs.get("output_format", "glb").lower()
            if output_format not in self.supported_output_formats:
                raise ValueError(
                    f"Unsupported output format: {output_format}. Must be one of {self.supported_output_formats}"
                )

            if self.pipeline is None:
                self._load_model()

            seed = int(inputs.get("seed", 42))
            fill_holes = bool(inputs.get("fill_holes", self.fill_holes))
            show_progress = bool(inputs.get("show_progress", False))

            output_mesh_path = Path(
                self.path_generator.generate_mesh_path(
                    self.model_id, stem, output_format
                )
            )
            output_mesh_path.parent.mkdir(parents=True, exist_ok=True)

            run_dir = output_mesh_path.parent / f"_tff_{stem}_{seed}"
            run_dir.mkdir(parents=True, exist_ok=True)

            result = self.pipeline.run(
                input_for_pipeline,
                output_dir=run_dir,
                seed=seed,
                fill_holes=fill_holes,
                show_progress=show_progress,
            )

            if output_format == "glb" and result.glb_path is not None and Path(result.glb_path).exists():
                shutil.copy2(str(result.glb_path), str(output_mesh_path))
            elif output_format == "obj" and result.final_mesh_path is not None and Path(result.final_mesh_path).exists():
                shutil.copy2(str(result.final_mesh_path), str(output_mesh_path))
            elif result.mesh is not None:
                self.mesh_processor.save_mesh(result.mesh, output_mesh_path)
            else:
                raise RuntimeError("TaoFlowForge pipeline finished without producing a valid mesh.")

            if not output_mesh_path.exists() or output_mesh_path.stat().st_size == 0:
                raise RuntimeError(f"Output mesh file was not created or is empty: {output_mesh_path}")

            metadata: Dict[str, Any] = {}
            if result.metadata_path is not None and Path(result.metadata_path).exists():
                try:
                    import json
                    with open(result.metadata_path, "r", encoding="utf-8") as f:
                        metadata = json.load(f)
                except Exception as e:
                    logger.warning("Could not read TaoFlowForge metadata json: %s", e)

            vertex_count = len(result.mesh.vertices) if result.mesh is not None else 0
            face_count = len(result.mesh.faces) if result.mesh is not None else 0

            metadata.update({
                "model_id": self.model_id,
                "feature_type": self.FEATURE_TYPE,
                "native_topology": True,
                "output_format": output_format,
                "output_mesh_path": str(output_mesh_path),
                "seed": seed,
                "fill_holes": fill_holes,
                "vertex_count": vertex_count,
                "face_count": face_count,
                "native_vertex_count": vertex_count,
                "native_face_count": face_count,
                "raw_mesh_path": str(result.raw_mesh_path) if result.raw_mesh_path else None,
                "glb_path": str(result.glb_path) if result.glb_path else None,
            })

            self.status = ModelStatus.LOADED
            logger.info("TaoFlowForge mesh generation completed: %s", output_mesh_path)

            return {
                "output_mesh_path": str(output_mesh_path),
                "success": True,
                "metadata": metadata,
                "generation_info": metadata,
            }

        except Exception as e:
            self.status = ModelStatus.ERROR
            logger.error("TaoFlowForge generation failed: %s", e, exc_info=True)
            raise RuntimeError(f"TaoFlowForge generation failed: {e}") from e

    def get_supported_formats(self) -> Dict[str, List[str]]:
        """Return supported input/output formats."""
        return {"input": self.supported_input_formats, "output": self.supported_output_formats}

    def get_parameter_schema(self) -> Dict[str, Any]:
        """Return parameter schema for TaoFlowForge generation."""
        return {
            "parameters": {
                "seed": {
                    "type": "integer",
                    "description": "Random seed for deterministic generation",
                    "default": 42,
                    "required": False,
                },
                "fill_holes": {
                    "type": "boolean",
                    "description": "Apply postprocessing mesh repair and hole filling",
                    "default": True,
                    "required": False,
                },
                "offload": {
                    "type": "string",
                    "description": "Memory offloading mode across pipeline stages ('auto', 'on', 'off')",
                    "default": "auto",
                    "enum": ["auto", "on", "off"],
                    "required": False,
                },
                "output_format": {
                    "type": "string",
                    "description": "Format for output 3D mesh ('glb' or 'obj')",
                    "default": "glb",
                    "enum": ["glb", "obj"],
                    "required": False,
                },
            }
        }
