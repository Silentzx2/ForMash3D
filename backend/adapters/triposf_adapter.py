"""
TripoSF model adapter for high-resolution arbitrary-topology 3D mesh reconstruction.

Integrates VAST-AI-Research/TripoSF with SparseFlex VAE for producing ultra-high
resolution arbitrary-topology 3D meshes (GLB/OBJ) up to 1024^3 resolution.
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


class TripoSFImageToRawMeshAdapter(ImageToMeshModel):
    """
    Adapter for TripoSF SparseFlex VAE 3D mesh modeling and reconstruction model.
    Produces high-resolution arbitrary-topology GLB/OBJ meshes.
    """

    FEATURE_TYPE = "image_to_raw_mesh"
    MODEL_ID = "triposf_image_to_raw_mesh"

    def __init__(
        self,
        model_id: str = "triposf_image_to_raw_mesh",
        model_path: Optional[str] = None,
        vram_requirement: Optional[int] = None,
        triposf_root: Optional[str] = None,
        resolution: int = 1024,
        sample_points_num: int = 1638400,
        pruning: bool = False,
        use_normals: bool = True,
    ):
        if vram_requirement is None:
            raise ValueError(
                f"VRAM requirement for {self.MODEL_ID if hasattr(self, 'MODEL_ID') else model_id} must come from the model manifest"
            )
        backend_dir = Path(__file__).resolve().parents[1]
        if model_path is None:
            model_path = str((backend_dir / "pretrained" / "TripoSF").resolve())
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

        if triposf_root is None:
            triposf_root = str(Path(__file__).resolve().parent.parent / "thirdparty" / "TripoSF")

        super().__init__(
            model_id=model_id,
            model_path=model_path,
            vram_requirement=vram_requirement,
            feature_type="image_to_raw_mesh",
            supported_input_formats=["png", "jpg", "jpeg", "webp", "obj", "glb", "ply"],
            supported_output_formats=["glb", "obj"],
        )

        self.triposf_root = Path(triposf_root)
        self.resolution = resolution
        self.sample_points_num = sample_points_num
        self.pruning = pruning
        self.use_normals = use_normals
        self.triposf_model = None
        self.mesh_processor = MeshProcessor()
        self.path_generator = OutputPathGenerator(base_output_dir="outputs")

    def _ensure_triposf_in_path(self):
        root_str = str(self.triposf_root)
        if root_str not in sys.path:
            sys.path.insert(0, root_str)

    def _resolve_checkpoint(self) -> Path:
        """Resolve pretrained checkpoint locally or from Hugging Face."""
        backend_dir = Path(__file__).resolve().parents[1]
        candidate_paths = [
            Path(self.model_path) / "pretrained_TripoSFVAE_256i1024o.safetensors",
            Path(self.model_path) / "vae" / "pretrained_TripoSFVAE_256i1024o.safetensors",
            backend_dir / "pretrained" / "TripoSF" / "pretrained_TripoSFVAE_256i1024o.safetensors",
            backend_dir / "pretrained" / "TripoSF" / "vae" / "pretrained_TripoSFVAE_256i1024o.safetensors",
            self.triposf_root / "ckpts" / "pretrained_TripoSFVAE_256i1024o.safetensors",
            Path(self.model_path),
        ]
        for p in candidate_paths:
            if p.is_file():
                return p

        # Attempt Hugging Face download if available
        try:
            from huggingface_hub import hf_hub_download
            logger.info("Downloading TripoSF VAE checkpoint from VAST-AI/TripoSF...")
            downloaded = hf_hub_download(
                repo_id="VAST-AI/TripoSF",
                filename="vae/pretrained_TripoSFVAE_256i1024o.safetensors",
                local_dir=str(Path(self.model_path)),
            )
            return Path(downloaded)
        except Exception as e:
            logger.warning(f"Could not auto-download TripoSF checkpoint: {e}")
            return candidate_paths[0]

    def _load_model(self):
        """Load TripoSF VAE model from repository code."""
        try:
            os.environ["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True"
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
            self._ensure_triposf_in_path()
            if torch.cuda.is_available():
                major, _ = torch.cuda.get_device_capability()
                if major < 8:
                    os.environ["ATTN_BACKEND"] = "sdpa"
                    os.environ["SPARSE_ATTN_BACKEND"] = "sdpa"
            logger.info(f"Loading TripoSF model from {self.triposf_root}")

            config_path = self.triposf_root / "configs" / "TripoSFVAE_1024.yaml"
            if not config_path.exists():
                raise FileNotFoundError(f"TripoSF config not found: {config_path}")

            from inference import TripoSFVAEInference
            from omegaconf import OmegaConf

            ckpt_path = self._resolve_checkpoint()
            config = OmegaConf.load(str(config_path))
            config.weight = str(ckpt_path) if ckpt_path.exists() else None
            cfg = OmegaConf.merge(OmegaConf.structured(TripoSFVAEInference.Config), config)

            device = "cuda" if torch.cuda.is_available() else "cpu"
            self.triposf_model = TripoSFVAEInference(cfg)
            self.triposf_model.to(device)
            self.triposf_model.eval()

            logger.info(f"TripoSF model loaded successfully on {device}")
            return self.triposf_model

        except Exception as e:
            logger.error(f"Failed to load TripoSF model: {e}")
            raise RuntimeError(f"Failed to load TripoSF model: {e}")

    def _unload_model(self):
        """Unload TripoSF model and free GPU memory."""
        try:
            self.triposf_model = None
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
            logger.info("TripoSF model unloaded successfully")
        except Exception as e:
            logger.error(f"Error unloading TripoSF model: {e}")

    def _generate_coarse_mesh(self, image_path: Path) -> str:
        """Generate a coarse 3D mesh from an input image to seed TripoSF VAE reconstruction."""
        try:
            from adapters.triposr_adapter import TripoSRImageToRawMeshAdapter
            tsr = TripoSRImageToRawMeshAdapter()
            tsr.load()
            result = tsr.generate_mesh({"image_path": str(image_path), "output_format": "obj"})
            return result["output_mesh_path"]
        except Exception as e:
            raise RuntimeError(f"Coarse mesh generation via TripoSR failed: {e}") from e

    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """
        Process mesh reconstruction request using TripoSF SparseFlex VAE.

        Inputs:
            - image_path / image_paths / mesh_path / mesh: Input file path
            - output_format: 'glb' or 'obj' (default: 'glb')
            - resolution: Voxel volume resolution (default: 256)
            - sample_points_num: Point sampling count (default: 819200)
            - pruning: bool (default: False, recommended True for open surfaces)
            - use_normals: bool (default: True)
        """
        try:
            self.status = ModelStatus.PROCESSING
            self._ensure_triposf_in_path()

            # Handle image or mesh input
            input_path = None
            is_mesh_input = False

            if "mesh_path" in inputs or "mesh" in inputs:
                input_path = inputs.get("mesh_path") or inputs.get("mesh")
                is_mesh_input = True
            elif "image_path" in inputs:
                input_path = inputs["image_path"]
            elif "image_paths" in inputs:
                paths = inputs["image_paths"]
                input_path = paths[0] if isinstance(paths, list) else paths

            if not input_path:
                raise ValueError("image_path or mesh_path is required for TripoSF")

            input_path = Path(input_path)
            if not input_path.exists():
                raise FileNotFoundError(f"Input file not found: {input_path}")

            if input_path.suffix.lower() in [".obj", ".glb", ".ply", ".stl"]:
                is_mesh_input = True

            output_format = inputs.get("output_format", "glb").lower()
            if output_format not in self.supported_output_formats:
                raise ValueError(f"Unsupported output format: {output_format}")

            # Start raw extraction at the highest configured density. The existing
            # VRAM safety guard may downshift these values on constrained hardware.
            resolution = 1024
            sample_points_num = 1_638_400
            pruning = bool(inputs.get("pruning", self.pruning))
            use_normals = bool(inputs.get("use_normals", self.use_normals))

            device = "cuda" if torch.cuda.is_available() else "cpu"

            # VRAM safety check - only downshift if user explicitly requests low_vram_mode
            # This prevents silent geometry fidelity loss. Users on constrained GPUs must opt-in.
            if device == "cuda":
                torch.cuda.empty_cache()
                total_vram_mb = torch.cuda.get_device_properties(0).total_memory // (1024 ** 2)
                allocated_mb = torch.cuda.memory_allocated(0) // (1024 ** 2)
                free_vram_mb = total_vram_mb - allocated_mb
                
                # Check if user requested low VRAM mode
                low_vram_mode = bool(inputs.get("low_vram_mode", False))
                
                if low_vram_mode:
                    pruning = True
                    resolution = min(resolution, 256)
                    sample_points_num = min(sample_points_num, 409_600)
                    logger.info(
                        "TripoSF low_vram_mode enabled: resolution=%d, pruning=True, sample_points=%d (total_vram=%dMB, free_vram=%dMB)",
                        resolution, sample_points_num, total_vram_mb, free_vram_mb,
                    )
                elif total_vram_mb <= 16384 or free_vram_mb < 12288:
                    # Warn but don't silently downshift - let user decide
                    logger.warning(
                        "TripoSF: GPU has limited VRAM (total=%dMB, free=%dMB). Consider enabling low_vram_mode to avoid OOM. "
                        "Proceeding with full resolution (1024) and sample_points (1,638,400).",
                        total_vram_mb, free_vram_mb,
                    )

            from inference import normalize_mesh, load_quantized_mesh_original

            # 1. Obtain coarse mesh if starting from an image
            if not is_mesh_input:
                coarse_mesh_path = self._generate_coarse_mesh(input_path)
            else:
                coarse_mesh_path = str(input_path)

            # 2. Normalize mesh to standard coordinates [-0.5, 0.5]
            mesh_gt = normalize_mesh(coarse_mesh_path)
            temp_gt_path = self.path_generator.generate_mesh_path(
                self.model_id, f"{input_path.stem}_normalized", "obj"
            )
            Path(temp_gt_path).parent.mkdir(parents=True, exist_ok=True)
            gt_verts = mesh_gt.vertices
            if hasattr(gt_verts, "detach"):
                gt_verts = gt_verts.detach().cpu().numpy()
            elif hasattr(gt_verts, "numpy"):
                gt_verts = gt_verts.numpy()
            gt_faces = mesh_gt.faces
            if hasattr(gt_faces, "detach"):
                gt_faces = gt_faces.detach().cpu().numpy()
            elif hasattr(gt_faces, "numpy"):
                gt_faces = gt_faces.numpy()

            trimesh.Trimesh(
                vertices=gt_verts,
                faces=gt_faces,
            ).export(temp_gt_path)

            # 3. Load quantized voxels and sample points
            sparse_voxels, points_sample = load_quantized_mesh_original(
                str(temp_gt_path),
                volume_resolution=resolution,
                use_normals=use_normals,
                pc_sample_number=sample_points_num,
            )

            sparse_voxels = sparse_voxels.to(device)
            points_sample = points_sample.to(device)
            sparse_voxels_sp = torch.cat(
                [torch.zeros_like(sparse_voxels[..., :1]), sparse_voxels], dim=-1
            ).int()

            # 4. Model inference
            self.triposf_model.cfg.pruning = pruning
            self.triposf_model.cfg.resolution = resolution
            self.triposf_model.cfg.sample_points_num = sample_points_num

            if device == "cuda":
                torch.cuda.empty_cache()

            with torch.no_grad():
                if device == "cuda":
                    with torch.cuda.amp.autocast(dtype=torch.float16):
                        mesh_recon = self.triposf_model(points_sample[None], sparse_voxels_sp)[0]
                else:
                    mesh_recon = self.triposf_model(points_sample[None], sparse_voxels_sp)[0]

            if device == "cuda":
                del sparse_voxels, points_sample, sparse_voxels_sp
                torch.cuda.empty_cache()

            # 5. Export mesh to requested format
            output_path = self.path_generator.generate_mesh_path(
                self.model_id, input_path.stem, output_format
            )
            output_path = Path(output_path)
            output_path.parent.mkdir(parents=True, exist_ok=True)

            recon_verts = mesh_recon.vertices
            if hasattr(recon_verts, "detach"):
                recon_verts = recon_verts.detach().cpu().numpy()
            elif hasattr(recon_verts, "numpy"):
                recon_verts = recon_verts.numpy()
            recon_faces = mesh_recon.faces
            if hasattr(recon_faces, "detach"):
                recon_faces = recon_faces.detach().cpu().numpy()
            elif hasattr(recon_faces, "numpy"):
                recon_faces = recon_faces.numpy()

            final_trimesh = trimesh.Trimesh(
                vertices=recon_verts,
                faces=recon_faces,
            )
            # Revert the -90 deg X rotation from normalize_mesh so output is upright Y-up
            final_trimesh.apply_transform(trimesh.transformations.rotation_matrix(np.pi / 2, [1, 0, 0]))
            final_trimesh.export(str(output_path))

            final_mesh = self.mesh_processor.load_mesh(output_path)
            mesh_stats = self.mesh_processor.get_mesh_stats(final_mesh)

            response = {
                "output_mesh_path": str(output_path),
                "success": True,
                "generation_info": {
                    "model": self.model_id,
                    "input": str(input_path),
                    "output_format": output_format,
                    "vertex_count": mesh_stats.get("vertex_count", len(final_trimesh.vertices)),
                    "face_count": mesh_stats.get("face_count", len(final_trimesh.faces)),
                    "resolution": resolution,
                    "sample_points_num": sample_points_num,
                    "pruning": pruning,
                },
            }

            self.status = ModelStatus.LOADED
            logger.info(f"TripoSF mesh generation completed: {output_path}")
            return response

        except Exception as e:
            self.status = ModelStatus.ERROR
            logger.error(f"TripoSF generation failed: {e}")
            raise RuntimeError(f"TripoSF generation failed: {e}")

    def get_supported_formats(self) -> Dict[str, List[str]]:
        return {"input": self.supported_input_formats, "output": self.supported_output_formats}

    def get_parameter_schema(self) -> Dict[str, Any]:
        return {
            "parameters": {
                "resolution": {
                    "type": "integer",
                    "description": "Fixed at the official 1024 raw-extraction ceiling; constrained GPUs may be downshifted by the runtime guard.",
                    "default": 1024,
                    "minimum": 1024,
                    "maximum": 1024,
                    "readOnly": True,
                    "required": False,
                },
                "sample_points_num": {
                    "type": "integer",
                    "description": "Fixed at the high-density 1,638,400 raw-extraction path.",
                    "default": 1638400,
                    "minimum": 1638400,
                    "maximum": 1638400,
                    "readOnly": True,
                    "required": False,
                },
                "pruning": {
                    "type": "boolean",
                    "description": "Enable pruning for open-surface geometries (e.g. cloth, leaves)",
                    "default": False,
                    "required": False,
                },
                "use_normals": {
                    "type": "boolean",
                    "description": "Use surface normals during point sampling",
                    "default": True,
                    "required": False,
                },
                "seed": {
                    "type": "integer",
                    "description": "Random seed for generation reproducibility",
                    "default": 0,
                    "required": False,
                },
                "low_vram_mode": {
                    "type": "boolean",
                    "description": "Enable low VRAM mode (downshifts resolution to 256, sample_points to 409,600). Required for GPUs with <12GB free VRAM to avoid OOM.",
                    "default": False,
                    "required": False,
                },
            }
        }
