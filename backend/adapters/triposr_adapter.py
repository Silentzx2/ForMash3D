"""
TripoSR model adapter for fast feedforward image-to-mesh reconstruction.

Integrates VAST-AI-Research/TripoSR for single-image 3D mesh generation.
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
from core.utils.log_formatters import format_box, format_bytes
from core.utils.mesh_utils import MeshProcessor

logger = logging.getLogger(__name__)


class TripoSRImageToRawMeshAdapter(ImageToMeshModel):
    """
    Adapter for TripoSR single-image 3D reconstruction model.
    Generates high-speed raw or textured 3D meshes (GLB/OBJ) from input images.
    """

    FEATURE_TYPE = "image_to_raw_mesh"
    MODEL_ID = "triposr_image_to_raw_mesh"

    def __init__(
        self,
        model_id: str = "triposr_image_to_raw_mesh",
        model_path: Optional[str] = None,
        vram_requirement: Optional[int] = None,
        triposr_root: Optional[str] = None,
        chunk_size: int = 8192,
        mc_resolution: int = 512,
    ):
        if vram_requirement is None:
            try:
                from core.models.model_manifest import ModelManifest
                manifest = ModelManifest()
                meta = manifest.get_model_metadata(model_id) or manifest.get_model_metadata(self.MODEL_ID)
                if meta and meta.vram_requirement:
                    vram_requirement = meta.vram_requirement
            except Exception:
                pass
            if vram_requirement is None:
                vram_requirement = 6144
        if model_path is None:
            model_path = "backend/pretrained/TripoSR"

        if triposr_root is None:
            triposr_root = str(Path(__file__).resolve().parent.parent / "thirdparty" / "TripoSR")

        super().__init__(
            model_id=model_id,
            model_path=model_path,
            vram_requirement=vram_requirement,
            feature_type="image_to_raw_mesh",
            supported_input_formats=["png", "jpg", "jpeg", "webp"],
            supported_output_formats=["glb", "obj"],
        )

        self.triposr_root = Path(triposr_root)
        self.chunk_size = chunk_size
        self.mc_resolution = mc_resolution
        self.tsr_model = None
        self.rembg_session = None
        self.mesh_processor = MeshProcessor()
        self.path_generator = OutputPathGenerator(base_output_dir="outputs")

    def _resolve_model_path(self) -> str:
        candidates = [Path(self.model_path), Path(__file__).resolve().parent.parent / "pretrained" / "TripoSR"]
        local_path = next((str(cand) for cand in candidates if (cand / "config.yaml").exists()), None)
        if local_path:
            logger.info(f"Resolved local TripoSR model path: {local_path}")
            return local_path
        logger.info("Local TripoSR weights not found; falling back to remote 'stabilityai/TripoSR'")
        return "stabilityai/TripoSR"

    def _ensure_triposr_in_path(self):
        root_str = str(self.triposr_root)
        if root_str not in sys.path:
            sys.path.insert(0, root_str)

    def _load_model(self):
        """Load TripoSR model from local weights or Hugging Face repository."""
        try:
            self._ensure_triposr_in_path()
            model_source = self._resolve_model_path()
            logger.info(f"Loading TripoSR model from {model_source} (root: {self.triposr_root})")

            try:
                from tsr.system import TSR
            except (ImportError, OSError) as e:
                err_msg = (
                    f"TripoSR native/code dependency import failed ({e}). "
                    "If this is torchmcubes or libcudart, ensure native extensions match the current CUDA/PyTorch environment."
                )
                logger.error(err_msg)
                raise RuntimeError(err_msg) from e

            if not torch.cuda.is_available():
                raise RuntimeError("TripoSR requires CUDA; CPU inference is not supported.")
            device = f"cuda:{self.gpu_id}" if self.gpu_id is not None else "cuda:0"

            try:
                self.tsr_model = TSR.from_pretrained(
                    model_source,
                    config_name="config.yaml",
                    weight_name="model.ckpt",
                )
            except Exception as load_err:
                err_msg = f"TripoSR checkpoint load failed for source '{model_source}': {load_err}"
                logger.error(err_msg)
                raise RuntimeError(err_msg) from load_err

            self.tsr_model.renderer.set_chunk_size(self.chunk_size)
            self.tsr_model.to(device)
            self.tsr_model.eval()

            logger.info(f"TripoSR model loaded successfully on {device} from {model_source}")
            return self.tsr_model

        except Exception as e:
            logger.error(f"Failed to load TripoSR model: {e}")
            raise RuntimeError(f"Failed to load TripoSR model: {e}") from e

    def _unload_model(self):
        """Unload TripoSR model and free GPU memory."""
        try:
            self.tsr_model = None
            self.rembg_session = None

            if torch.cuda.is_available():
                torch.cuda.empty_cache()

            logger.info("TripoSR model unloaded successfully")
        except Exception as e:
            logger.error(f"Error unloading TripoSR model: {e}")

    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """
        Process single-image to mesh request using TripoSR.

        Inputs:
            - image_path: Path to input image (or image_paths)
            - output_format: 'glb' or 'obj' (default: 'glb')
            - mc_resolution: Marching cubes extraction resolution (up to 512; max-fidelity default)
            - bake_texture: bool (default: False)
            - no_remove_bg: bool (default: False)
            - foreground_ratio: float (default: 0.85)
        """
        try:
            self.status = ModelStatus.PROCESSING
            self._ensure_triposr_in_path()

            # Handle image_path or image_paths
            image_path_str = inputs.get("image_path")
            if not image_path_str and "image_paths" in inputs:
                paths = inputs["image_paths"]
                image_path_str = paths[0] if isinstance(paths, list) else paths

            if not image_path_str:
                raise ValueError("image_path or image_paths is required for TripoSR")

            image_path = Path(image_path_str)
            if not image_path.exists():
                raise FileNotFoundError(f"Input image not found: {image_path}")

            output_format = inputs.get("output_format", "glb").lower()
            if output_format not in self.supported_output_formats:
                raise ValueError(f"Unsupported output format: {output_format}")

            # Canonical raw source uses maximum model-supported extraction fidelity by default,
            # respecting caller/input settings up to 512.
            mc_resolution = int(inputs.get("mc_resolution") or self.mc_resolution or 512)
            mc_resolution = max(32, min(512, mc_resolution))
            bake_texture = bool(inputs.get("bake_texture", False))
            no_remove_bg = bool(inputs.get("no_remove_bg", False))
            foreground_ratio = float(inputs.get("foreground_ratio", 0.85))

            if not torch.cuda.is_available():
                raise RuntimeError("TripoSR requires CUDA; CPU inference is not supported.")
            device = f"cuda:{self.gpu_id}" if self.gpu_id is not None else "cuda:0"

            # Preprocess image
            from tsr.utils import remove_background, resize_foreground, to_gradio_3d_orientation

            # Preserve an existing alpha channel so pre-matted uploads are not background-removed twice.
            img = Image.open(image_path)
            has_useful_alpha = img.mode in ("RGBA", "LA", "PA") and np.array(img.getchannel("A")).min() < 255
            raw_image = img.convert("RGBA")
            background_removal_failed = False
            if no_remove_bg or has_useful_alpha:
                resized = resize_foreground(self._binarize_alpha_mask(raw_image), foreground_ratio)
                arr = np.array(resized).astype(np.float32) / 255.0
                if arr.shape[-1] == 4:
                    arr = arr[:, :, :3] * arr[:, :, 3:4] + (1 - arr[:, :, 3:4]) * 0.5
                proc_image = Image.fromarray((arr * 255.0).astype(np.uint8))
            else:
                try:
                    import rembg
                    if self.rembg_session is None:
                        self.rembg_session = rembg.new_session()
                    bg_removed = remove_background(raw_image, self.rembg_session)
                    resized = resize_foreground(self._binarize_alpha_mask(bg_removed), foreground_ratio)
                    arr = np.array(resized).astype(np.float32) / 255.0
                    if arr.shape[-1] == 4:
                        arr = arr[:, :, :3] * arr[:, :, 3:4] + (1 - arr[:, :, 3:4]) * 0.5
                    proc_image = Image.fromarray((arr * 255.0).astype(np.uint8))
                except Exception as bg_err:
                    logger.warning(
                        f"Background removal failed ({bg_err}); proceeding on the un-cropped raw image. "
                        "Geometry conditioning will be degraded for full-scene inputs."
                    )
                    background_removal_failed = True
                    proc_image = raw_image.convert("RGB")

            logger.info(
                "\n" + format_box(
                    "TRIPOSR: INPUT PREPROCESSING",
                    [
                        ("Source Image", f"{image_path.name} ({format_bytes(image_path.stat().st_size)})"),
                        ("Dimensions", f"{raw_image.width}x{raw_image.height}"),
                        ("Alpha Channel", f"{has_useful_alpha} (preserved)"),
                        ("Background Removal", "Skipped" if (no_remove_bg or has_useful_alpha) else "Executed via rembg"),
                        ("Foreground Ratio", foreground_ratio),
                        ("Marching Cubes Res", mc_resolution),
                    ],
                )
            )

            # Run inference
            with torch.no_grad():
                scene_codes = self.tsr_model([proc_image], device=device)
                meshes = self.tsr_model.extract_mesh(
                    scene_codes, not bake_texture, resolution=mc_resolution
                )

            # Generate output path
            output_path = self.path_generator.generate_mesh_path(
                self.model_id, image_path.stem, output_format
            )
            output_path = Path(output_path)
            output_path.parent.mkdir(parents=True, exist_ok=True)

            mesh = meshes[0]
            # Rotate from TripoSR NeRF space to standard upright Y-up / 3D space
            try:
                mesh = to_gradio_3d_orientation(mesh)
            except Exception as orient_err:
                logger.warning(f"to_gradio_3d_orientation failed ({orient_err}), falling back to trimesh rotation")
                mesh.apply_transform(trimesh.transformations.rotation_matrix(-np.pi / 2, [1, 0, 0]))
                mesh.apply_transform(trimesh.transformations.rotation_matrix(np.pi / 2, [0, 1, 0]))

            mesh = self._drop_noise_components(mesh)

            logger.info(
                "\n" + format_box(
                    "TRIPOSR: MESH EXTRACTED",
                    [
                        ("Raw Triangles", f"{len(mesh.faces):,} faces"),
                        ("Raw Vertices", f"{len(mesh.vertices):,} vertices"),
                        ("Texture Baking", f"Enabled ({inputs.get('texture_resolution', 2048)}px)" if bake_texture else "Disabled (vertex color)"),
                        ("Output Target", str(output_path)),
                    ],
                )
            )

            texture_requested = bake_texture
            texture_bake_succeeded = False
            texture_bake_error = None
            untextured_mesh = mesh

            if texture_requested:
                try:
                    from tsr.bake_texture import bake_texture as do_bake

                    tex_res = int(inputs.get("texture_resolution", 2048))
                    bake_output = do_bake(mesh, self.tsr_model, scene_codes[0], tex_res)
                    mesh = self._create_baked_mesh(mesh, bake_output)
                    mesh.export(str(output_path))
                    texture_bake_succeeded = True
                except Exception as bake_err:
                    texture_bake_error = str(bake_err)
                    logger.warning(
                        f"Texture baking/export failed ({bake_err}), exporting unbaked mesh"
                    )
                    untextured_mesh.export(str(output_path))
            else:
                mesh.export(str(output_path))

            # Validate output mesh file
            if not output_path.exists() or output_path.stat().st_size == 0:
                raise RuntimeError(f"TripoSR failed to write output mesh or file is empty: {output_path}")

            final_mesh = self.mesh_processor.load_mesh(output_path)
            if final_mesh is None:
                raise RuntimeError(f"TripoSR generated output mesh could not be parsed: {output_path}")

            if texture_bake_succeeded and not self._has_exported_texture(final_mesh):
                texture_bake_succeeded = False
                texture_bake_error = "Exported mesh contains no texture image/material"
                logger.warning(f"Texture baking/export failed: {texture_bake_error}")

            mesh_stats = self.mesh_processor.get_mesh_stats(final_mesh)
            vertex_count = mesh_stats.get("vertex_count", 0)
            face_count = mesh_stats.get("face_count", 0)
            if vertex_count <= 0 or face_count <= 0:
                raise RuntimeError(f"TripoSR generated an invalid empty mesh (vertices: {vertex_count}, faces: {face_count})")

            has_texture = texture_bake_succeeded

            response = {
                "output_mesh_path": str(output_path),
                "success": True,
                "generation_info": {
                    "model": self.model_id,
                    "input_image": str(image_path),
                    "output_format": output_format,
                    "vertex_count": vertex_count,
                    "face_count": face_count,
                    "texture_requested": texture_requested,
                    "texture_bake_succeeded": texture_bake_succeeded,
                    "has_texture": has_texture,
                    "texture_bake_error": texture_bake_error,
                    "background_removal_failed": background_removal_failed,
                    "mc_resolution": mc_resolution,
                },
            }

            self.status = ModelStatus.LOADED
            logger.info(f"TripoSR mesh generation completed: {output_path}")
            return response

        except Exception as e:
            self.status = ModelStatus.ERROR
            logger.error(f"TripoSR generation failed: {e}")
            raise RuntimeError(f"TripoSR generation failed: {e}") from e

    @staticmethod
    def _binarize_alpha_mask(image: Image.Image, threshold: int = 128) -> Image.Image:
        """Harden a soft RGBA mask before foreground cropping.

        The vendored resize_foreground() treats any non-zero alpha as
        foreground (tsr/utils.py), so soft rembg masks leak the entire frame
        as foreground and the subject is never actually cropped/centered.
        """
        rgba = image.convert("RGBA")
        arr = np.array(rgba)
        if arr.shape[-1] == 4:
            arr[..., 3] = np.where(arr[..., 3] >= threshold, 255, 0).astype(np.uint8)
        return Image.fromarray(arr, "RGBA")

    @staticmethod
    def _drop_noise_components(mesh, min_fraction: float = 0.001, min_faces: int = 32) -> trimesh.Trimesh:
        """Drop disconnected isosurface fragments left by marching cubes."""
        components = mesh.split(only_watertight=False)
        if len(components) <= 1:
            return mesh
        largest = max(len(c.faces) for c in components)
        floor = max(min_faces, int(largest * min_fraction))
        kept = [c for c in components if len(c.faces) >= floor]
        if len(kept) == len(components):
            return mesh
        logger.info(
            "TripoSR: dropped %d noise components (< %d faces); kept %d of %d",
            len(components) - len(kept), floor, len(kept), len(components),
        )
        return kept[0] if len(kept) == 1 else trimesh.util.concatenate(kept)

    @staticmethod
    def _create_baked_mesh(mesh, bake_output):
        colors = np.asarray(bake_output["colors"])
        if colors.dtype != np.uint8:
            if np.issubdtype(colors.dtype, np.floating):
                colors = np.clip(colors, 0.0, 1.0) * 255
            colors = np.clip(colors, 0, 255).astype(np.uint8)

        textured_mesh = trimesh.Trimesh(
            vertices=mesh.vertices[bake_output["vmapping"]],
            faces=bake_output["indices"],
            vertex_normals=mesh.vertex_normals[bake_output["vmapping"]],
            process=False,
        )
        textured_mesh.visual = trimesh.visual.texture.TextureVisuals(
            uv=bake_output["uvs"],
            material=trimesh.visual.material.PBRMaterial(
                baseColorTexture=Image.fromarray(colors),
                metallicFactor=0.0,
                roughnessFactor=1.0,
            ),
        )
        return textured_mesh

    @staticmethod
    def _has_exported_texture(mesh):
        material = getattr(getattr(mesh, "visual", None), "material", None)
        return any(
            getattr(material, attribute, None) is not None
            for attribute in ("baseColorTexture", "image")
        )

    def get_supported_formats(self) -> Dict[str, List[str]]:
        return {"input": self.supported_input_formats, "output": self.supported_output_formats}

    def get_parameter_schema(self) -> Dict[str, Any]:
        return {
            "parameters": {
                "mc_resolution": {
                    "type": "integer",
                    "description": "Marching cubes grid resolution (up to 512 for maximum geometry fidelity).",
                    "default": 512,
                    "minimum": 32,
                    "maximum": 512,
                    "readOnly": False,
                    "required": False,
                },
                "bake_texture": {
                    "type": "boolean",
                    "description": "Bake texture atlas",
                    "default": False,
                    "required": False,
                },
                "no_remove_bg": {
                    "type": "boolean",
                    "description": "Disable automatic background removal",
                    "default": False,
                    "required": False,
                },
                "foreground_ratio": {
                    "type": "number",
                    "description": "Foreground ratio",
                    "default": 0.85,
                    "minimum": 0.5,
                    "maximum": 1.0,
                    "required": False,
                },
            }
        }
