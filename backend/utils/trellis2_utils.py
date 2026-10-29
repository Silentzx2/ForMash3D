"""
TRELLIS.2 utility wrapper for mesh generation and texturing.

This module provides a high-level interface to TRELLIS.2 pipelines,
wrapping the inference logic from thirdparty/TRELLIS.2/example.py and example_texturing.py
"""

import logging
import math
import os
import sys
from pathlib import Path
from typing import Any, Dict, Optional, Union

try:
    import cv2
except ImportError:
    cv2 = None
import torch
import numpy as np
try:
    import trimesh
except ImportError:
    trimesh = None
from PIL import Image

logger = logging.getLogger(__name__)


def _unpack_trellis2_run_result(
    result: Any,
) -> tuple[Any, Optional[int], Optional[float], Optional[str]]:
    """Normalize the official TRELLIS.2 return contract and report achieved geometry resolution."""
    decoded_meshes = result
    effective_resolution = None
    resolution_source = None

    # The vendored official pipeline returns (meshes, (shape_slat, tex_slat, resolution))
    # when return_latent=True. The cascade may reduce its target resolution to fit the token budget.
    if isinstance(result, tuple) and len(result) == 2:
        decoded_meshes, latent_result = result
        if isinstance(latent_result, (tuple, list)) and len(latent_result) >= 3:
            try:
                value = latent_result[2]
                if hasattr(value, "item"):
                    value = value.item()
                value = int(value)
                if value > 0:
                    effective_resolution = value
                    resolution_source = "pipeline_return_latent"
            except (TypeError, ValueError, OverflowError):
                pass

    if isinstance(decoded_meshes, (tuple, list)):
        if not decoded_meshes:
            raise RuntimeError("TRELLIS.2 pipeline returned an empty mesh list.")
        mesh = decoded_meshes[0]
    else:
        mesh = decoded_meshes
    if mesh is None or not hasattr(mesh, "vertices") or not hasattr(mesh, "faces"):
        raise TypeError("TRELLIS.2 pipeline output did not contain a decoded mesh.")

    voxel_size = None
    try:
        candidate_voxel_size = float(getattr(mesh, "voxel_size"))
        if math.isfinite(candidate_voxel_size) and candidate_voxel_size > 0:
            voxel_size = candidate_voxel_size
    except (AttributeError, TypeError, ValueError, OverflowError):
        pass

    # Older pipeline builds may omit returned latent metadata. Infer only when the decoded mesh
    # explicitly carries a usable voxel pitch; never pretend the requested path is achieved res.
    if effective_resolution is None and voxel_size is not None:
        inferred_resolution = int(round(1.0 / voxel_size))
        if inferred_resolution > 0:
            effective_resolution = inferred_resolution
            resolution_source = "mesh_voxel_size"

    return mesh, effective_resolution, voxel_size, resolution_source


class Trellis2Runner:
    """
    Wrapper for TRELLIS.2 inference pipelines.
    
    Supports:
    - Image to 3D mesh generation
    - Image-guided mesh texturing
    """
    
    def __init__(
        self,
        trellis2_root: Optional[str] = None,
        model_cache_dir: Optional[str] = None,
        device: str = "cuda",
        resource_plan: Optional[Dict[str, Any]] = None,
        low_vram: Optional[bool] = None,
    ):
        """
        Initialize TRELLIS.2 runner.
        
        Args:
            trellis2_root: Path to thirdparty/TRELLIS.2 directory
            model_cache_dir: Path to model cache directory
            device: Device to run on ('cuda' or 'cpu')
            resource_plan: Hardware allocation plan from scheduler
            low_vram: If True, uses sequential offloading (<= 15GB VRAM). If False, runs full 24GB pipeline in VRAM.
        """
        if trellis2_root is None:
            trellis2_root = os.path.join(
                os.getcwd(), "thirdparty", "TRELLIS.2"
            )
        
        self.trellis2_root = Path(trellis2_root)
        self.device = device
        self.resource_plan = dict(resource_plan or {})

        # Resolve low_vram mode: explicit param > scheduler strategy > hardware detection (<20GB)
        if low_vram is not None:
            self.low_vram = bool(low_vram)
        elif self.resource_plan.get("strategy") == "single_gpu_low_vram":
            self.low_vram = True
        else:
            low_vram_needed = False
            if torch.cuda.is_available():
                try:
                    dev_idx = int(self.device.split(":")[-1]) if ":" in str(self.device) else (torch.cuda.current_device() if str(self.device).startswith("cuda") else 0)
                    total_mb = torch.cuda.get_device_properties(dev_idx).total_memory / (1024 * 1024)
                    if total_mb < 20480:
                        low_vram_needed = True
                except Exception:
                    low_vram_needed = True
            self.low_vram = low_vram_needed
        
        if model_cache_dir is None:
            model_cache_dir = os.path.join(
                os.getcwd(), "pretrained", "TRELLIS.2"
            )
        self.model_cache_dir = Path(model_cache_dir)
        
        # Add TRELLIS.2 to Python path
        if str(self.trellis2_root) not in sys.path:
            sys.path.insert(0, str(self.trellis2_root))

        # Apply runtime compatibility fixes (transformers, dinov3, numba, etc.)
        try:
            from utils.torchvision_fix import apply_fix
            apply_fix()
        except Exception as fix_err:
            logger.debug(f"apply_fix notice: {fix_err}")
        
        # Set environment variables
        os.environ['OPENCV_IO_ENABLE_OPENEXR'] = '1'
        os.environ["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True"
        if torch.cuda.is_available():
            try:
                dev_idx = int(self.device.split(":")[-1]) if ":" in str(self.device) else (torch.cuda.current_device() if str(self.device).startswith("cuda") else 0)
                if torch.cuda.get_device_capability(dev_idx)[0] < 8:
                    os.environ["ATTN_BACKEND"] = "sdpa"
                    os.environ["SPARSE_ATTN_BACKEND"] = "sdpa"
            except Exception:
                pass
        
        # Pipelines (lazy loaded)
        self.image_to_3d_pipeline = None
        self.texturing_pipeline = None
        self.envmap = None
        
        # Import o_voxel for GLB export
        try:
            import o_voxel
            self.o_voxel = o_voxel
        except ImportError:
            logger.error("Failed to import o_voxel. GLB export will not be available.")
            self.o_voxel = None
    
    def _load_image_to_3d_pipeline(self):
        """Load TRELLIS.2 image-to-3D pipeline."""
        if self.image_to_3d_pipeline is not None:
            return
        
        try:
            logger.info("Loading TRELLIS.2 image-to-3D pipeline...")
            from trellis2.pipelines import Trellis2ImageTo3DPipeline
            
            # Resolve checkpoint directory checking TRELLIS.2-4B subdirectory
            candidates = [
                self.model_cache_dir / "TRELLIS.2-4B",
                self.model_cache_dir,
                Path(__file__).resolve().parents[1] / "pretrained" / "TRELLIS.2" / "TRELLIS.2-4B",
                Path(__file__).resolve().parents[1] / "pretrained" / "TRELLIS.2",
                Path(__file__).resolve().parents[2] / "pretrained" / "TRELLIS.2" / "TRELLIS.2-4B",
                Path(__file__).resolve().parents[2] / "pretrained" / "TRELLIS.2",
            ]
            if os.environ.get("PRETRAINED_DIR"):
                p_dir = Path(os.environ["PRETRAINED_DIR"])
                candidates.extend([p_dir / "TRELLIS.2" / "TRELLIS.2-4B", p_dir / "TRELLIS.2"])

            resolved_path = None
            for c in candidates:
                if (c / "pipeline.json").is_file():
                    ckpts_dir = c / "ckpts"
                    if (ckpts_dir.is_dir() and any(ckpts_dir.iterdir())) or any(c.glob("*.safetensors")):
                        resolved_path = str(c.resolve())
                        break

            pretrained_path = resolved_path or "microsoft/TRELLIS.2-4B"
            logger.info(f"Loading TRELLIS.2 image-to-3D pipeline from: {pretrained_path}")
            self.image_to_3d_pipeline = Trellis2ImageTo3DPipeline.from_pretrained(
                pretrained_path
            )

            # Auto-align sparse structure decoder input dtype with weights and guard native C++ extensions
            try:
                from utils.torchvision_fix import fix_trellis2_sparse_vae_dtype, fix_trellis2_flexible_dual_grid, fix_trellis2_cumesh_fallback
                fix_trellis2_sparse_vae_dtype()
                fix_trellis2_flexible_dual_grid()
                fix_trellis2_cumesh_fallback()
            except Exception as patch_err:
                try:
                    from backend.utils.torchvision_fix import fix_trellis2_sparse_vae_dtype, fix_trellis2_flexible_dual_grid, fix_trellis2_cumesh_fallback
                    fix_trellis2_sparse_vae_dtype()
                    fix_trellis2_flexible_dual_grid()
                    fix_trellis2_cumesh_fallback()
                except Exception:
                    logger.debug(f"fix_trellis2 notice: {patch_err}")

            if self.low_vram:
                self.image_to_3d_pipeline.low_vram = True
                self.image_to_3d_pipeline._device = self.device
                logger.info(f"TRELLIS.2 enabled low-VRAM mode (sequential offload <= 15GB) on {self.device} while preserving full fidelity")
            elif len(self.resource_plan.get("gpu_ids", [])) > 1:
                from core.scheduler.resource_planner import ResourcePlan, dispatch_pipeline_across_gpus
                dispatch_pipeline_across_gpus(
                    self.image_to_3d_pipeline,
                    ResourcePlan(
                        kind="multi_gpu",
                        gpu_ids=tuple(int(x) for x in self.resource_plan["gpu_ids"]),
                        primary_gpu=int(self.resource_plan["gpu_ids"][0]),
                        reservation_mb={int(k): int(v) for k, v in self.resource_plan.get("reservation_mb", {}).items()},
                        max_memory_mb={str(k): int(v) for k, v in self.resource_plan.get("max_memory_mb", {}).items()},
                        cpu_threads=int(self.resource_plan.get("cpu_threads", 1)),
                        strategy=str(self.resource_plan.get("strategy", "accelerate_component_dispatch")),
                        reason=str(self.resource_plan.get("reason", "scheduler resource plan")),
                    ),
                )
                primary_dev = f"cuda:{self.resource_plan['gpu_ids'][0]}"
                self.image_to_3d_pipeline._device = primary_dev
                if hasattr(self.image_to_3d_pipeline, "image_cond_model") and self.image_to_3d_pipeline.image_cond_model is not None:
                    self.image_to_3d_pipeline.image_cond_model.to(primary_dev)
                if getattr(self.image_to_3d_pipeline, "rembg_model", None) is not None:
                    self.image_to_3d_pipeline.rembg_model.to(primary_dev)
            elif str(self.device).startswith("cuda"):
                self.image_to_3d_pipeline.to(self.device)
                self.image_to_3d_pipeline._device = self.device
                if hasattr(self.image_to_3d_pipeline, "image_cond_model") and self.image_to_3d_pipeline.image_cond_model is not None:
                    self.image_to_3d_pipeline.image_cond_model.to(self.device)
                if getattr(self.image_to_3d_pipeline, "rembg_model", None) is not None:
                    self.image_to_3d_pipeline.rembg_model.to(self.device)

            import gc
            gc.collect()
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
            
            logger.info("TRELLIS.2 image-to-3D pipeline loaded successfully")
            
        except Exception as e:
            logger.error(f"Failed to load TRELLIS.2 image-to-3D pipeline: {e}")
            raise
    
    def _load_texturing_pipeline(self):
        """Load TRELLIS.2 texturing pipeline."""
        if self.texturing_pipeline is not None:
            return
        
        try:
            logger.info("Loading TRELLIS.2 texturing pipeline...")
            from trellis2.pipelines import Trellis2TexturingPipeline
            
            # Resolve checkpoint directory checking TRELLIS.2-4B subdirectory
            candidates = [
                self.model_cache_dir / "TRELLIS.2-4B",
                self.model_cache_dir,
                Path(__file__).resolve().parents[1] / "pretrained" / "TRELLIS.2" / "TRELLIS.2-4B",
                Path(__file__).resolve().parents[1] / "pretrained" / "TRELLIS.2",
                Path(__file__).resolve().parents[2] / "pretrained" / "TRELLIS.2" / "TRELLIS.2-4B",
                Path(__file__).resolve().parents[2] / "pretrained" / "TRELLIS.2",
            ]
            if os.environ.get("PRETRAINED_DIR"):
                p_dir = Path(os.environ["PRETRAINED_DIR"])
                candidates.extend([p_dir / "TRELLIS.2" / "TRELLIS.2-4B", p_dir / "TRELLIS.2"])

            resolved_path = None
            for c in candidates:
                if (c / "texturing_pipeline.json").is_file():
                    ckpts_dir = c / "ckpts"
                    if (ckpts_dir.is_dir() and any(ckpts_dir.iterdir())) or any(c.glob("*.safetensors")):
                        resolved_path = str(c.resolve())
                        break

            tex_model_path = resolved_path or "microsoft/TRELLIS.2-4B"
            self.texturing_pipeline = Trellis2TexturingPipeline.from_pretrained(
                tex_model_path,
                config_file="texturing_pipeline.json"
            )
            if self.low_vram:
                self.texturing_pipeline.low_vram = True
                self.texturing_pipeline._device = self.device
                logger.info(f"TRELLIS.2 enabled low-VRAM mode for texturing on {self.device}")
            elif str(self.device).startswith("cuda"):
                self.texturing_pipeline.low_vram = False
                self.texturing_pipeline.to(self.device)
                logger.info(f"TRELLIS.2 enabled full 24GB mode for texturing on {self.device}")

            import gc
            gc.collect()
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
            
            logger.info("TRELLIS.2 texturing pipeline loaded successfully")
            
        except Exception as e:
            logger.error(f"Failed to load TRELLIS.2 texturing pipeline: {e}")
            raise
    
    def _load_envmap(self, envmap_path: Optional[str] = None):
        """Load environment map for rendering."""
        if self.envmap is not None:
            return
        
        try:
            from trellis2.renderers import EnvMap
            
            if envmap_path is None:
                # Use default environment map from TRELLIS.2 assets
                envmap_path = str(self.trellis2_root / "assets" / "hdri" / "forest.exr")
            
            if not os.path.exists(envmap_path):
                logger.warning(f"Environment map not found: {envmap_path}")
                return
            
            envmap_data = cv2.cvtColor(
                cv2.imread(envmap_path, cv2.IMREAD_UNCHANGED),
                cv2.COLOR_BGR2RGB
            )
            
            self.envmap = EnvMap(
                torch.tensor(envmap_data, dtype=torch.float32, device=self.device)
            )
            
            logger.info(f"Environment map loaded from {envmap_path}")
            
        except Exception as e:
            logger.warning(f"Failed to load environment map: {e}")
            self.envmap = None
    
    def image_to_mesh(
        self,
        image_path: str,
        decimation_target: int = 1000000,
        texture_size: int = 4096,
        remesh: bool = True,
        remesh_band: int = 1,
        remesh_project: int = 0,
        seed: Optional[int] = None,
        verbose: bool = True,
        raw_mesh_only: bool = True,
        pipeline_type: str = "1536_cascade",
        max_num_tokens: int = 524288,
        sparse_structure_sampler_params: Optional[Dict[str, Any]] = None,
        shape_slat_sampler_params: Optional[Dict[str, Any]] = None,
        tex_slat_sampler_params: Optional[Dict[str, Any]] = None,
        low_vram: Optional[bool] = None,
    ) -> trimesh.Trimesh:
        """
        Generate 3D mesh from image using TRELLIS.2.
        
        Args:
            image_path: Path to input image
            decimation_target: Target number of faces after decimation
            texture_size: Output texture resolution
            remesh: Whether to remesh the output
            remesh_band: Remesh band parameter
            remesh_project: Remesh project parameter
            seed: Random seed for reproducibility
            verbose: Whether to show progress
            raw_mesh_only: If True, return untextured raw mesh without texture bake
            pipeline_type: Resolution path; 1536_cascade is the high-fidelity path.
            max_num_tokens: Token budget that controls when the cascade falls back to lower resolution.
            sparse_structure_sampler_params: Model sampler overrides for sparse structure.
            shape_slat_sampler_params: Model sampler overrides for geometry latents.
            tex_slat_sampler_params: Model sampler overrides for texture latents.
            low_vram: If True, sequentially offloads models between CPU and GPU (<=15GB VRAM). If False, runs full 24GB pipeline in VRAM.
        
        Returns:
            Generated trimesh.Trimesh object
        """
        self._load_image_to_3d_pipeline()

        # Dynamic low_vram mode switch per request
        if low_vram is not None and hasattr(self.image_to_3d_pipeline, "low_vram"):
            req_low_vram = bool(low_vram)
            if self.image_to_3d_pipeline.low_vram != req_low_vram:
                self.image_to_3d_pipeline.low_vram = req_low_vram
                if not req_low_vram and str(self.device).startswith("cuda"):
                    self.image_to_3d_pipeline.to(self.device)
                logger.info(f"TRELLIS.2 switched low_vram={req_low_vram} for request")
        
        # Load image
        image = Image.open(image_path)
        
        # Set random seed if provided
        if seed is not None:
            torch.manual_seed(seed)
            if torch.cuda.is_available():
                torch.cuda.manual_seed(seed)
        
        # Ask the official pipeline for latent metadata so cascade fallback is observable.
        logger.info(
            "Generating TRELLIS.2 mesh from image: %s (pipeline=%s, max_num_tokens=%s)",
            image_path, pipeline_type, max_num_tokens,
        )
        try:
            from utils.torchvision_fix import fix_flex_gemm
            fix_flex_gemm()
        except Exception:
            try:
                from backend.utils.torchvision_fix import fix_flex_gemm
                fix_flex_gemm()
            except Exception:
                pass
        pipeline_result = self.image_to_3d_pipeline.run(
            image,
            seed=42 if seed is None else int(seed),
            pipeline_type=pipeline_type,
            max_num_tokens=int(max_num_tokens),
            sparse_structure_sampler_params=dict(sparse_structure_sampler_params or {}),
            shape_slat_sampler_params=dict(shape_slat_sampler_params or {}),
            tex_slat_sampler_params=dict(tex_slat_sampler_params or {}),
            geometry_only=raw_mesh_only,
            return_latent=True,
        )
        mesh, effective_resolution, voxel_size, resolution_source = (
            _unpack_trellis2_run_result(pipeline_result)
        )
        del pipeline_result
        requested_resolution = {
            "512": 512,
            "1024": 1024,
            "1024_cascade": 1024,
            "1536_cascade": 1536,
        }.get(pipeline_type)
        resolution_limited = (
            requested_resolution is not None
            and effective_resolution is not None
            and effective_resolution < requested_resolution
        )
        resolution_limit_reason = (
            "cascade token budget reduced the achieved geometry resolution"
            if resolution_limited and pipeline_type in {"1024_cascade", "1536_cascade"}
            else "effective resolution differs from the requested path"
            if resolution_limited
            else None
        )
        mesh_metadata = {
            "requested_geometry_resolution_path": pipeline_type,
            "requested_geometry_resolution": requested_resolution,
            "effective_geometry_resolution": effective_resolution,
            "geometry_resolution_source": resolution_source,
            "geometry_resolution_limited": resolution_limited,
            "geometry_resolution_limit_reason": resolution_limit_reason,
            "geometry_quality_warning": (
                f"Requested {requested_resolution}, achieved {effective_resolution}: {resolution_limit_reason}"
                if resolution_limited else None
            ),
            "voxel_size": voxel_size,
            "geometry_extractor": "TRELLIS.2 O-Voxel native decoder",
            "native_vertex_count": len(mesh.vertices),
            "native_face_count": len(mesh.faces),
            "raw_mesh_only": bool(raw_mesh_only),
            "mesh_operations": [] if raw_mesh_only else ["o_voxel.postprocess.to_glb"],
        }
        logger.info(
            "TRELLIS.2 geometry telemetry: requested_path=%s effective_resolution=%s "
            "resolution_source=%s resolution_limited=%s limit_reason=%s voxel_size=%s vertices=%d faces=%d raw_mesh_only=%s",
            pipeline_type,
            effective_resolution,
            resolution_source or "unavailable",
            resolution_limited,
            resolution_limit_reason or "none",
            voxel_size,
            len(mesh.vertices),
            len(mesh.faces),
            raw_mesh_only,
        )

        if raw_mesh_only:
            logger.info("Extracting untextured raw mesh (texture baking skipped)")
            verts = mesh.vertices.cpu().numpy() if hasattr(mesh.vertices, 'cpu') else np.array(mesh.vertices)
            faces = mesh.faces.cpu().numpy() if hasattr(mesh.faces, 'cpu') else np.array(mesh.faces)
            # Replace NaN/Inf vertices: GLB accessor min/max with NaN is invalid JSON and breaks viewers
            bad = ~np.isfinite(verts).all(axis=1)
            if bad.any():
                logger.warning("TRELLIS.2 raw mesh has %d NaN/Inf vertices; replacing with (0,0,0)", bad.sum())
                verts = verts.copy()
                verts[bad] = 0.0
            raw_mesh = trimesh.Trimesh(vertices=verts, faces=faces, process=False)
            raw_mesh.metadata.update(mesh_metadata)
            return raw_mesh

        # This cap only exists for the texture/render path (nvdiffrast limitation).
        # Never apply it to raw_mesh_only: source geometry must stay model-native.
        if hasattr(mesh, "simplify"):
            mesh.simplify(16777216)

        # Export to GLB format
        if self.o_voxel is not None:
            raw_target = -1 if decimation_target is None else int(decimation_target)
            effective_decimation_target = (
                int(len(mesh.faces)) if raw_target <= 0 else raw_target
            )
            if raw_target <= 0:
                logger.info(
                    "TRELLIS.2 raw export requested without decimation; "
                    "using the generated face count as the exporter target."
                )
            logger.info("Exporting mesh to GLB format...")
            glb = self.o_voxel.postprocess.to_glb(
                vertices=mesh.vertices,
                faces=mesh.faces,
                attr_volume=mesh.attrs,
                coords=mesh.coords,
                attr_layout=mesh.layout,
                voxel_size=mesh.voxel_size,
                aabb=[[-0.5, -0.5, -0.5], [0.5, 0.5, 0.5]],
                decimation_target=effective_decimation_target,
                texture_size=texture_size,
                remesh=remesh,
                remesh_band=remesh_band,
                remesh_project=remesh_project,
                verbose=verbose
            )
            
            # Convert GLB to trimesh
            import tempfile
            with tempfile.NamedTemporaryFile(suffix=".glb", delete=False) as tmp:
                glb.export(tmp.name)
                output_mesh = trimesh.load(tmp.name, force="mesh")
                os.unlink(tmp.name)
            
            output_mesh.metadata.update(mesh_metadata)
            return output_mesh
        else:
            logger.warning("o_voxel not available, returning raw mesh")
            # Return a basic conversion (without proper texture baking)
            output_mesh = trimesh.Trimesh(
                vertices=mesh.vertices.cpu().numpy() if hasattr(mesh.vertices, 'cpu') else mesh.vertices,
                faces=mesh.faces.cpu().numpy() if hasattr(mesh.faces, 'cpu') else mesh.faces
            )
            output_mesh.metadata.update(mesh_metadata)
            return output_mesh
    
    def texture_mesh(
        self,
        mesh_path: str,
        image_path: str,
        output_format: str = "glb",
        extension_webp: bool = True,
        low_vram: Optional[bool] = None,
    ) -> trimesh.Trimesh:
        """
        Apply texture to mesh using image guidance.
        
        Args:
            mesh_path: Path to input mesh file
            image_path: Path to reference image for texturing
            output_format: Output format ('glb' or 'obj')
            extension_webp: Whether to use WebP extension in GLB
            low_vram: If True, uses sequential offloading (<= 15GB VRAM). If False, runs full 24GB pipeline in VRAM.
        
        Returns:
            Textured trimesh.Trimesh object
        """
        self._load_texturing_pipeline()

        # Dynamic low_vram switch for texturing
        if low_vram is not None and hasattr(self.texturing_pipeline, "low_vram"):
            req_low_vram = bool(low_vram)
            if self.texturing_pipeline.low_vram != req_low_vram:
                self.texturing_pipeline.low_vram = req_low_vram
                if not req_low_vram and str(self.device).startswith("cuda"):
                    self.texturing_pipeline.to(self.device)
                logger.info(f"TRELLIS.2 switched texturing low_vram={req_low_vram} for request")
        
        # Load mesh and image
        mesh = trimesh.load(mesh_path, force="mesh")
        image = Image.open(image_path)
        
        # Run texturing pipeline
        logger.info(f"Texturing mesh with image: {image_path}")
        output = self.texturing_pipeline.run(mesh, image)
        
        # Export to temporary file and reload
        import tempfile
        with tempfile.NamedTemporaryFile(suffix=f".{output_format}", delete=False) as tmp:
            output.export(tmp.name, extension_webp=extension_webp)
            textured_mesh = trimesh.load(tmp.name, force="mesh")
            os.unlink(tmp.name)
        
        return textured_mesh
    
    def cleanup(self):
        """Clean up resources and free GPU memory."""
        if self.image_to_3d_pipeline is not None:
            if hasattr(self.image_to_3d_pipeline, 'cpu'):
                self.image_to_3d_pipeline.cpu()
            del self.image_to_3d_pipeline
            self.image_to_3d_pipeline = None
        
        if self.texturing_pipeline is not None:
            if hasattr(self.texturing_pipeline, 'cpu'):
                self.texturing_pipeline.cpu()
            del self.texturing_pipeline
            self.texturing_pipeline = None
        
        if self.envmap is not None:
            del self.envmap
            self.envmap = None
        
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        
        logger.info("TRELLIS.2 runner cleaned up")

