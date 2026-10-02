"""
TripoSG model adapter for high-fidelity image-to-3D mesh reconstruction.

Integrates VAST-AI-Research/TripoSG (and optional scribble variant)
for producing browser-loadable GLB meshes.
"""

import logging
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
import torch
import trimesh
from PIL import Image

from core.models.base import ModelStatus
from core.models.mesh_models import ImageToMeshModel
from core.utils.file_utils import OutputPathGenerator
from core.utils.mesh_utils import MeshProcessor

logger = logging.getLogger(__name__)


class TripoSGImageToRawMeshAdapter(ImageToMeshModel):
    """
    Adapter for TripoSG single-image 3D generation model.
    Produces high-fidelity GLB/OBJ meshes with optional scribble+prompt support.
    """

    FEATURE_TYPE = "image_to_raw_mesh"
    MODEL_ID = "triposg_image_to_raw_mesh"

    def __init__(
        self,
        model_id: str = "triposg_image_to_raw_mesh",
        model_path: Optional[str] = None,
        vram_requirement: Optional[int] = None,
        triposg_root: Optional[str] = None,
        rmbg_path: Optional[str] = None,
        num_inference_steps: int = 50,
        guidance_scale: float = 7.0,
    ):
        if vram_requirement is None:
            raise ValueError(
                f"VRAM requirement for {self.MODEL_ID if hasattr(self, 'MODEL_ID') else model_id} must come from the model manifest"
            )
        if model_path is None:
            model_path = "backend/pretrained/TripoSG"

        if triposg_root is None:
            triposg_root = str(Path(__file__).resolve().parent.parent / "thirdparty" / "TripoSG")

        if rmbg_path is None:
            rmbg_path = "backend/pretrained/RMBG-1.4"

        super().__init__(
            model_id=model_id,
            model_path=model_path,
            vram_requirement=vram_requirement,
            feature_type="image_to_raw_mesh",
            supported_input_formats=["png", "jpg", "jpeg", "webp"],
            supported_output_formats=["glb", "obj"],
        )

        self.triposg_root = Path(triposg_root)
        self.rmbg_path = Path(rmbg_path)
        self.num_inference_steps = num_inference_steps
        self.guidance_scale = guidance_scale

        self.pipe = None
        self.rmbg_net = None
        self.mesh_processor = MeshProcessor()
        self.path_generator = OutputPathGenerator(base_output_dir="outputs")

    def _ensure_triposg_in_path(self):
        root_str = str(self.triposg_root)
        scripts_str = str(self.triposg_root / "scripts")
        for p in [root_str, scripts_str]:
            if p not in sys.path:
                sys.path.insert(0, p)

    def _resolve_rmbg_source(self) -> str:
        candidates = [Path(self.rmbg_path), Path(__file__).resolve().parent.parent / "pretrained" / "RMBG-1.4"]
        local_cand = next((str(cand) for cand in candidates if cand.exists()), None)
        if local_cand:
            logger.info(f"Resolved local RMBG source at: {local_cand}")
            return local_cand
        logger.info("Using remote RMBG source: 'briaai/RMBG-1.4'")
        return "briaai/RMBG-1.4"

    def _resolve_model_source(self) -> str:
        candidates = [
            Path(self.model_path),
            Path(__file__).resolve().parent.parent / "pretrained" / "TripoSG",
        ]
        for cand in candidates:
            if cand.exists() and (cand / "model_index.json").exists():
                logger.info(f"Resolved local TripoSG snapshot at: {cand}")
                return str(cand)

        # Attempt to populate local snapshot first so Diffusers loads custom pipeline components locally
        target_dir = Path(__file__).resolve().parent.parent / "pretrained" / "TripoSG"
        try:
            from huggingface_hub import snapshot_download
            logger.info(f"Local TripoSG snapshot missing; downloading weights snapshot to {target_dir}...")
            target_dir.mkdir(parents=True, exist_ok=True)
            snapshot_download(
                repo_id="VAST-AI/TripoSG",
                local_dir=str(target_dir),
                local_dir_use_symlinks=False,
            )
            if (target_dir / "model_index.json").exists():
                logger.info(f"Successfully downloaded TripoSG weights snapshot to {target_dir}")
                return str(target_dir)
        except Exception as dl_err:
            logger.warning(f"Failed downloading local TripoSG snapshot ({dl_err}); attempting direct load from 'VAST-AI/TripoSG'")

        return "VAST-AI/TripoSG"

    def _load_model(self):
        """Load TripoSG pipeline and RMBG background remover."""
        try:
            self._ensure_triposg_in_path()
            triposg_source = self._resolve_model_source()
            logger.info(f"Loading TripoSG from source '{triposg_source}' (root: {self.triposg_root})")

            device = "cuda" if torch.cuda.is_available() else "cpu"
            dtype = torch.float16 if torch.cuda.is_available() else torch.float32

            # 1. Background remover
            rmbg_source = self._resolve_rmbg_source()
            try:
                from briarmbg import BriaRMBG
                self.rmbg_net = BriaRMBG.from_pretrained(rmbg_source).to(device)
                self.rmbg_net.eval()
                logger.info(f"✓ TripoSG RMBG network loaded from {rmbg_source}")
            except Exception as rmbg_err:
                logger.warning(f"RMBG-1.4 model failed to load ({rmbg_err}); background removal will use fallback")
                self.rmbg_net = None

            # 2. TripoSG Pipeline
            try:
                from triposg.pipelines.pipeline_triposg import TripoSGPipeline
            except (ImportError, OSError) as e:
                err_msg = f"TripoSG code dependency import failed ({e}) from root {self.triposg_root}"
                logger.error(err_msg)
                raise RuntimeError(err_msg) from e

            try:
                self.pipe = TripoSGPipeline.from_pretrained(triposg_source).to(device, dtype)
            except Exception as pipe_err:
                err_msg = f"TripoSG model load failed for source '{triposg_source}': {pipe_err}"
                logger.error(err_msg)
                raise RuntimeError(err_msg) from pipe_err

            logger.info(f"✓ TripoSGPipeline loaded on {device} ({dtype}) from {triposg_source}")
            return self.pipe

        except Exception as e:
            logger.error(f"Failed to load TripoSG model: {e}")
            raise RuntimeError(f"Failed to load TripoSG model: {e}") from e

    def _unload_model(self):
        """Unload TripoSG pipeline and free CUDA memory."""
        try:
            self.pipe = None
            self.rmbg_net = None

            if torch.cuda.is_available():
                torch.cuda.empty_cache()

            logger.info("TripoSG model unloaded successfully")
        except Exception as e:
            logger.error(f"Error unloading TripoSG model: {e}")

    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """
        Process image-to-mesh request with TripoSG.

        Inputs:
            - image_path: Path to input image (or image_paths)
            - prompt: Optional text prompt (used for scribble mode)
            - is_scribble: Optional bool for scribble+prompt generation
            - seed: Optional int (default: 42)
            - num_inference_steps: Optional int (default: 50)
            - guidance_scale: Optional float (default: 7.0)
            - faces: Optional int for post-processing decimation (-1 for no reduction)
            - auto_optimize: Optional bool; when false, preserve the model-native mesh without decimation
            - output_format: 'glb' or 'obj' (default: 'glb')
        """
        try:
            self.status = ModelStatus.PROCESSING
            self._ensure_triposg_in_path()

            # Handle image_path or image_paths
            image_path_str = inputs.get("image_path")
            if not image_path_str and "image_paths" in inputs:
                paths = inputs["image_paths"]
                image_path_str = paths[0] if isinstance(paths, list) else paths

            if not image_path_str:
                raise ValueError("image_path or image_paths is required for TripoSG")

            image_path = Path(image_path_str)
            if not image_path.exists():
                raise FileNotFoundError(f"Input image not found: {image_path}")

            output_format = inputs.get("output_format", "glb").lower()
            if output_format not in self.supported_output_formats:
                raise ValueError(f"Unsupported output format: {output_format}")

            seed = int(inputs.get("seed", 42))
            steps = int(inputs.get("num_inference_steps", self.num_inference_steps))
            guidance = float(inputs.get("guidance_scale", self.guidance_scale))
            faces = int(inputs.get("target_polycount", inputs.get("faces", -1)))
            auto_optimize = bool(inputs.get("auto_optimize", False))
            is_scribble = bool(inputs.get("is_scribble", False))
            prompt = str(inputs.get("prompt", "")).strip()

            device = "cuda" if torch.cuda.is_available() else "cpu"
            use_flash_decoder = device == "cuda" and torch.cuda.get_device_capability()[0] >= 8

            if is_scribble and prompt:
                # Run scribble pipeline
                from triposg.pipelines.pipeline_triposg_scribble import TripoSGScribblePipeline
                scribble_source = (
                    str(self.model_path) + "-scribble"
                    if Path(str(self.model_path) + "-scribble").exists()
                    else "VAST-AI/TripoSG-scribble"
                )
                dtype = torch.float16 if torch.cuda.is_available() else torch.float32
                scribble_pipe = TripoSGScribblePipeline.from_pretrained(scribble_source).to(device, dtype)

                img_pil = Image.open(image_path).convert("RGB")
                generator = torch.Generator(device=device).manual_seed(seed)
                outputs = scribble_pipe(
                    image=img_pil,
                    prompt=prompt,
                    generator=generator,
                    num_inference_steps=min(steps, 25),
                    guidance_scale=0,
                    dense_octree_depth=8,
                    hierarchical_octree_depth=8,
                ).samples[0]
                mesh = trimesh.Trimesh(outputs[0].astype(np.float32), np.ascontiguousarray(outputs[1]))
            else:
                # Run standard TripoSG pipeline
                from image_process import prepare_image

                img_pil = prepare_image(
                    str(image_path),
                    bg_color=np.array([1.0, 1.0, 1.0]),
                    rmbg_net=self.rmbg_net,
                )

                generator = torch.Generator(device=device).manual_seed(seed)
                outputs = self.pipe(
                    image=img_pil,
                    generator=generator,
                    num_inference_steps=steps,
                    guidance_scale=guidance,
                    use_flash_decoder=use_flash_decoder,
                ).samples[0]
                mesh = trimesh.Trimesh(outputs[0].astype(np.float32), np.ascontiguousarray(outputs[1]))

            # Model-native mesh is preserved for source.glb; optimization belongs strictly to downstream post-processing
            logger.info(
                f"TripoSG raw extraction completed: {len(mesh.vertices)} vertices, {len(mesh.faces)} faces"
            )

            # Save output
            output_path = self.path_generator.generate_mesh_path(
                self.model_id, image_path.stem, output_format
            )
            output_path = Path(output_path)
            output_path.parent.mkdir(parents=True, exist_ok=True)
            mesh.export(str(output_path))

            # Validate output mesh file
            if not output_path.exists() or output_path.stat().st_size == 0:
                raise RuntimeError(f"TripoSG failed to write output mesh or file is empty: {output_path}")

            final_mesh = self.mesh_processor.load_mesh(output_path)
            if final_mesh is None:
                raise RuntimeError(f"TripoSG generated output mesh could not be parsed: {output_path}")

            mesh_stats = self.mesh_processor.get_mesh_stats(final_mesh)
            vertex_count = mesh_stats.get("vertex_count", 0)
            face_count = mesh_stats.get("face_count", 0)
            if vertex_count <= 0 or face_count <= 0:
                raise RuntimeError(f"TripoSG generated an invalid empty mesh (vertices: {vertex_count}, faces: {face_count})")

            response = {
                "output_mesh_path": str(output_path),
                "success": True,
                "generation_info": {
                    "model": self.model_id,
                    "input_image": str(image_path),
                    "output_format": output_format,
                    "vertex_count": vertex_count,
                    "face_count": face_count,
                    "steps": steps,
                    "guidance_scale": guidance,
                    "seed": seed,
                    "is_scribble": is_scribble,
                },
            }

            self.status = ModelStatus.LOADED
            logger.info(f"TripoSG generation completed: {output_path}")
            return response

        except Exception as e:
            self.status = ModelStatus.ERROR
            logger.error(f"TripoSG generation failed: {e}")
            raise RuntimeError(f"TripoSG generation failed: {e}") from e

    def get_supported_formats(self) -> Dict[str, List[str]]:
        return {"input": self.supported_input_formats, "output": self.supported_output_formats}

    def get_parameter_schema(self) -> Dict[str, Any]:
        return {
            "parameters": {
                "prompt": {
                    "type": "string",
                    "description": "Text prompt for guidance or scribble generation",
                    "default": "",
                    "required": False,
                },
                "seed": {
                    "type": "integer",
                    "description": "Random seed for reproducibility",
                    "default": 42,
                    "required": False,
                },
                "num_inference_steps": {
                    "type": "integer",
                    "description": "Number of denoising inference steps",
                    "default": 50,
                    "minimum": 10,
                    "maximum": 100,
                    "required": False,
                },
                "guidance_scale": {
                    "type": "number",
                    "description": "Classifier-free guidance scale",
                    "default": 7.0,
                    "minimum": 1.0,
                    "maximum": 20.0,
                    "required": False,
                },
                "faces": {
                    "type": "integer",
                    "description": "Target face count for decimation (-1 for no reduction)",
                    "default": -1,
                    "required": False,
                },
                "is_scribble": {
                    "type": "boolean",
                    "description": "Treat input image as a scribble sketch with prompt",
                    "default": False,
                    "required": False,
                },
            }
        }
