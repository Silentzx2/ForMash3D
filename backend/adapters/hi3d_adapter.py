"""
Hi3D v1.0 Experimental Model Adapter.

Integrates hi3d-official/Hi3Dv1.0 (SPARC3D) for high-resolution 3D geometry
refinement from image and coarse mesh inputs. Marked as experimental.
"""

from __future__ import annotations

import json
import logging
import os
import sys
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

import numpy as np
import torch
import trimesh
from PIL import Image

from core.models.base import ModelStatus
from core.models.mesh_models import ImageToMeshModel
from core.utils.file_utils import OutputPathGenerator
from core.utils.mesh_utils import MeshProcessor

logger = logging.getLogger(__name__)

# BaseAdapter alias pointing to ImageToMeshModel for framework interoperability
BaseAdapter = ImageToMeshModel

CHECKPOINT_LICENSE = "LicenseRef-Hi3D-1.0"
DEFAULT_VRAM_REQUIREMENT = 16384  # 16 GB


def _has_local_hf_model_weights(model_dir: Path) -> bool:
    """Return true only when a local Transformers directory has its config and complete weights."""
    if not (model_dir / "config.json").is_file():
        return False

    for filename in ("model.safetensors", "pytorch_model.bin"):
        weight_file = model_dir / filename
        if weight_file.is_file() and weight_file.stat().st_size > 0:
            return True

    # Sharded checkpoints must have their index and every referenced shard.
    for index_name in ("model.safetensors.index.json", "pytorch_model.bin.index.json"):
        index_path = model_dir / index_name
        if not index_path.is_file():
            continue
        try:
            index_data = json.loads(index_path.read_text(encoding="utf-8"))
            weight_map = index_data.get("weight_map")
            if isinstance(weight_map, dict) and weight_map:
                shards = {str(name) for name in weight_map.values()}
                if all(
                    (model_dir / shard).is_file()
                    and (model_dir / shard).stat().st_size > 0
                    for shard in shards
                ):
                    return True
        except (OSError, ValueError, TypeError):
            continue
    return False

# Hi3D high-fidelity geometry refinement locked inference profile (original production setting)
_LOCKED_INFERENCE_PROFILE = {
    "resolution": 1024,
    "num_inference_steps": 25,
    "seed": 42,
    "sequential_cpu_offload": False,
    "fp16": True,
    "apply_texture": False,
}


def export_untextured_raw_mesh(mesh: trimesh.Trimesh, output_path: Union[str, Path]) -> str:
    """
    Export mesh as clean untextured raw geometry with no forced vertex colors or textures.
    """
    out_p = Path(output_path)
    out_p.parent.mkdir(parents=True, exist_ok=True)

    clean_mesh = mesh.copy()
    clean_mesh.visual = trimesh.visual.ColorVisuals(mesh=clean_mesh)

    ext = out_p.suffix.lower()
    if ext == ".glb":
        clean_mesh.export(str(out_p), file_type="glb")
    elif ext == ".obj":
        clean_mesh.export(str(out_p), file_type="obj")
    else:
        clean_mesh.export(str(out_p))

    return str(out_p)


def install_flash_attn_shim() -> None:
    """
    Provide PyTorch native scaled_dot_product_attention (SDPA) fallback for flash_attn.
    Enables Sparc3D / Hi3D to run on Turing (Tesla T4 compute capability 7.5) and non-Ampere GPUs.
    """
    import sys
    import types
    import torch
    import torch.nn.functional as F

    def _sdpa_varlen_qkvpacked(qkv, cu_seqlens, max_seqlen=None, dropout_p=0.0, softmax_scale=None, **kwargs):
        if isinstance(cu_seqlens, torch.Tensor):
            cu_list = cu_seqlens.tolist()
        else:
            cu_list = list(cu_seqlens)
        seqlens = [cu_list[i + 1] - cu_list[i] for i in range(len(cu_list) - 1)]

        q = qkv[:, 0]
        k = qkv[:, 1]
        v = qkv[:, 2]

        q_chunks = torch.split(q, seqlens, dim=0)
        k_chunks = torch.split(k, seqlens, dim=0)
        v_chunks = torch.split(v, seqlens, dim=0)

        outputs = []
        for qc, kc, vc in zip(q_chunks, k_chunks, v_chunks):
            if qc.shape[0] == 0:
                continue
            qc = qc.transpose(0, 1).unsqueeze(0)
            kc = kc.transpose(0, 1).unsqueeze(0)
            vc = vc.transpose(0, 1).unsqueeze(0)
            out = F.scaled_dot_product_attention(
                qc, kc, vc,
                dropout_p=dropout_p if kwargs.get("training", False) else 0.0,
                scale=softmax_scale,
            )
            outputs.append(out.squeeze(0).transpose(0, 1))

        if outputs:
            return torch.cat(outputs, dim=0)
        return torch.empty((0, q.shape[1], q.shape[2]), device=q.device, dtype=q.dtype)

    def _sdpa_varlen_kvpacked(q, kv, cu_seqlens_q, cu_seqlens_k, max_seqlen_q=None, max_seqlen_k=None, dropout_p=0.0, softmax_scale=None, **kwargs):
        if isinstance(cu_seqlens_q, torch.Tensor):
            q_list = cu_seqlens_q.tolist()
        else:
            q_list = list(cu_seqlens_q)
        if isinstance(cu_seqlens_k, torch.Tensor):
            k_list = cu_seqlens_k.tolist()
        else:
            k_list = list(cu_seqlens_k)

        q_seqlens = [q_list[i + 1] - q_list[i] for i in range(len(q_list) - 1)]
        k_seqlens = [k_list[i + 1] - k_list[i] for i in range(len(k_list) - 1)]

        k = kv[:, 0]
        v = kv[:, 1]

        q_chunks = torch.split(q, q_seqlens, dim=0)
        k_chunks = torch.split(k, k_seqlens, dim=0)
        v_chunks = torch.split(v, k_seqlens, dim=0)

        outputs = []
        for qc, kc, vc in zip(q_chunks, k_chunks, v_chunks):
            if qc.shape[0] == 0:
                continue
            qc = qc.transpose(0, 1).unsqueeze(0)
            kc = kc.transpose(0, 1).unsqueeze(0)
            vc = vc.transpose(0, 1).unsqueeze(0)
            out = F.scaled_dot_product_attention(
                qc, kc, vc,
                dropout_p=dropout_p if kwargs.get("training", False) else 0.0,
                scale=softmax_scale,
            )
            outputs.append(out.squeeze(0).transpose(0, 1))

        if outputs:
            return torch.cat(outputs, dim=0)
        return torch.empty((0, q.shape[1], q.shape[2]), device=q.device, dtype=q.dtype)

    try:
        import transformers.utils.import_utils as tiu
        tiu.is_flash_attn_2_available = lambda: False
        tiu.is_flash_attn_available = lambda: False
    except Exception:
        pass

    try:
        import flash_attn  # noqa: F401
        if torch.cuda.is_available():
            major, _ = torch.cuda.get_device_capability()
            if major < 8:
                raise ImportError("Pre-Ampere GPU; use SDPA fallback")
    except Exception:
        import importlib.machinery
        mod = types.ModuleType("flash_attn")
        mod.__spec__ = importlib.machinery.ModuleSpec("flash_attn", None)
        mod.__file__ = "flash_attn_shim.py"
        mod.__version__ = "2.0.0"
        mod.flash_attn_varlen_qkvpacked_func = _sdpa_varlen_qkvpacked
        mod.flash_attn_varlen_kvpacked_func = _sdpa_varlen_kvpacked
        mod.flash_attn_func = lambda *a, **k: None
        mod.flash_attn_varlen_func = lambda *a, **k: None

        bp_mod = types.ModuleType("flash_attn.bert_padding")
        bp_mod.__spec__ = importlib.machinery.ModuleSpec("flash_attn.bert_padding", None)
        bp_mod.index_first_axis = lambda *a, **k: None
        bp_mod.pad_input = lambda *a, **k: None
        bp_mod.unpad_input = lambda *a, **k: None
        mod.bert_padding = bp_mod

        sys.modules["flash_attn"] = mod
        sys.modules["flash_attn.bert_padding"] = bp_mod



def _cast_hi3d_fp16_component(component: Any, component_name: str) -> Any:
    """Apply FP16 using the supported conversion path for this vendored component."""
    if component is None:
        raise RuntimeError(f"Hi3D FP16 profile is missing component {component_name!r}")

    config = getattr(component, "config", None)
    if getattr(config, "use_fp16", False):
        return component

    convert_to_fp16 = getattr(component, "convert_to_fp16", None)
    if callable(convert_to_fp16):
        # Preserve the custom transformer's FP32 input/output projections.
        convert_to_fp16()
    else:
        half = getattr(component, "half", None)
        if not callable(half):
            raise TypeError(
                f"Hi3D component {component_name!r} does not support FP16 conversion"
            )
        half()
    return component


def _apply_hi3d_fp16_profile(pipeline: Any) -> None:
    """Apply FP16 to loaded geometry weights and wrap the lazy high-resolution loader."""
    # Custom Sparc3DPipeline uses native mixed-precision on transformers.
    # The VAE requires float32 for geometric precision and force_fp32 point ops.
    for component_name in ("transformer_512",):
        _cast_hi3d_fp16_component(getattr(pipeline, component_name, None), component_name)

    transformer_1024 = getattr(pipeline, "_transformer_1024", None)
    if transformer_1024 is not None:
        pipeline._transformer_1024 = _cast_hi3d_fp16_component(
            transformer_1024, "transformer_1024"
        )

    lazy_loader = getattr(pipeline, "_transformer_1024_loader", None)
    if callable(lazy_loader):
        pipeline._transformer_1024_loader = lambda: _cast_hi3d_fp16_component(
            lazy_loader(), "transformer_1024"
        )


class Hi3DAdapter(ImageToMeshModel):
    """
    Base adapter for Hi3D v1.0 experimental geometry refinement model.
    """

    EXPERIMENTAL = True
    MODEL_ID = "hi3d_image_to_raw_mesh"
    FEATURE_TYPE = "image_to_raw_mesh"

    def __init__(
        self,
        model_id: Optional[str] = None,
        model_path: Optional[str] = None,
        vram_requirement: Optional[int] = None,
        hi3d_root: Optional[str] = None,
        feature_type: Optional[str] = None,
        supported_output_formats: Optional[List[str]] = None,
        sequential_cpu_offload: bool = False,
        fp16: bool = True,
        **kwargs,
    ):
        if vram_requirement is None:
            vram_requirement = DEFAULT_VRAM_REQUIREMENT
        if model_id is None:
            model_id = self.MODEL_ID

        backend_dir = Path(__file__).resolve().parents[1]
        if model_path is None:
            model_path = str((backend_dir / "pretrained" / "Hi3D").resolve())
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

        if hi3d_root is None:
            hi3d_root = str((backend_dir / "thirdparty" / "Hi3D").resolve())

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

        self.experimental = True
        self.hi3d_root = Path(hi3d_root)
        self.model_path = Path(model_path)
        self.sequential_cpu_offload = sequential_cpu_offload
        self.fp16 = fp16

        # Pipeline is lazily loaded
        self.pipeline: Optional[Any] = None

        # Utilities
        self.mesh_processor = MeshProcessor()
        self.path_generator = OutputPathGenerator(base_output_dir="outputs")

    @property
    def is_experimental(self) -> bool:
        """Indicates whether this model is flagged as experimental."""
        return True

    def _ensure_hi3d_in_path(self) -> None:
        """Ensure Hi3D vendored directory is available in sys.path."""
        hi3d_str = str(self.hi3d_root.resolve())
        if hi3d_str not in sys.path:
            sys.path.insert(0, hi3d_str)

        # Patch sparc3d postprocess _simplify to prevent hard crash if pyfqmr is not installed
        try:
            import sparc3d.sparcubes.postprocess as pp
            orig_simplify = getattr(pp, "_simplify", None)
            if orig_simplify is not None and not getattr(orig_simplify, "_safe_patched", False):
                def safe_simplify(mesh, target_face_count):
                    try:
                        import pyfqmr
                        simplifier = pyfqmr.Simplify()
                        simplifier.setMesh(mesh.vertices, mesh.faces)
                        simplifier.simplify_mesh(
                            target_count=target_face_count,
                            aggressiveness=5,
                            preserve_border=True,
                            verbose=False,
                        )
                        vertices, faces, _ = simplifier.getMesh()
                        return trimesh.Trimesh(vertices=vertices, faces=faces, process=False)
                    except Exception:
                        try:
                            if hasattr(mesh, "simplify_quadric_decimation") and len(mesh.faces) > target_face_count:
                                return mesh.simplify_quadric_decimation(face_count=target_face_count)
                        except Exception:
                            pass
                        return mesh

                safe_simplify._safe_patched = True
                pp._simplify = safe_simplify
        except Exception:
            pass

        # Patch sparc3d autoencoder blocks to prevent Float vs Half mismatch under autocast or FP16
        try:
            import sparc3d.models.autoencoders.blocks as ae_blocks
            if not getattr(ae_blocks.LayerNormFP32, "_safe_dtype_patched", False):
                def _safe_ln_forward(self, x: torch.Tensor) -> torch.Tensor:
                    weight = self.weight.to(x.dtype) if self.weight is not None else None
                    bias = self.bias.to(x.dtype) if self.bias is not None else None
                    return torch.nn.functional.layer_norm(x, self.normalized_shape, weight, bias, self.eps)
                ae_blocks.LayerNormFP32.forward = ae_blocks.force_fp32(mode="convert_back")(_safe_ln_forward)
                ae_blocks.LayerNormFP32._safe_dtype_patched = True
        except Exception:
            pass

    def _load_model(self) -> None:
        """
        Lazily load Hi3D pipeline from model weights.
        Validates hardware prerequisites (NVIDIA GPU with compute capability >= 8.0).
        """
        if self.pipeline is not None:
            return

        self._ensure_hi3d_in_path()

        if not torch.cuda.is_available():
            raise RuntimeError(
                "Hi3D requires an NVIDIA GPU with CUDA capability >= 7.0 (Volta+); "
                "CUDA device is not available."
            )

        major_cap, _ = torch.cuda.get_device_capability(getattr(self, "gpu_id", None))
        if major_cap < 7:
            raise RuntimeError(
                f"Hi3D requires compute capability >= 7.0 (Volta+), "
                f"but current device has capability {major_cap}.x"
            )

        install_flash_attn_shim()

        try:
            from sparc3d import Sparc3DPipeline
        except ImportError as e:
            raise ImportError(
                f"Failed to import Sparc3DPipeline from {self.hi3d_root}: {e}"
            ) from e

        device = (
            f"cuda:{self.gpu_id}"
            if hasattr(self, "gpu_id") and self.gpu_id is not None
            else "cuda"
        )

        has_local_weights = (self.model_path / "model_index.json").exists()
        if not has_local_weights and not self.model_path.exists():
            raise FileNotFoundError(
                f"Hi3D pretrained weights directory not found at {self.model_path}. "
                "Please download weights via download_models.sh -m hi3d from https://huggingface.co/hi3d-official/Hi3Dv1.0"
            )

        model_source = str(self.model_path) if has_local_weights else "hi3d-official/Hi3Dv1.0"
        # If main weights are local but DINOv2/CLIP are not, cache Hub downloads in the
        # writable pretrained tree instead of relying on ~/.cache being writable.
        cache_dir = str(self.model_path.parent) if has_local_weights else str(self.model_path)
        logger.info("Loading Sparc3DPipeline from %s onto %s", model_source, device)

        # Vision encoders (DINOv2-large and CLIP-large) may reside in pretrained/ or be fetched from HF Hub
        dino_dir = self.model_path.parent / "dinov2-large"
        clip_dir = self.model_path.parent / "clip-vit-large-patch14"
        has_local_dino = _has_local_hf_model_weights(dino_dir)
        has_local_clip = _has_local_hf_model_weights(clip_dir)
        dino_id = str(dino_dir.resolve()) if has_local_dino else "facebook/dinov2-large"
        clip_id = str(clip_dir.resolve()) if has_local_clip else "openai/clip-vit-large-patch14"

        # Never point Transformers at a half-downloaded local directory: use the Hub
        # repository for any encoder whose config/weight set is incomplete.
        local_only = bool(has_local_weights and has_local_dino and has_local_clip)

        self.pipeline = Sparc3DPipeline.from_pretrained(
            model_source,
            cache_dir=cache_dir,
            local_files_only=local_only,
            dino_model_id=dino_id,
            clip_model_id=clip_id,
        )
        if self.fp16:
            _apply_hi3d_fp16_profile(self.pipeline)

        is_offload = bool(self.sequential_cpu_offload)
        if hasattr(self, "resource_plan") and self.resource_plan:
            strategy = str(self.resource_plan.get("strategy", ""))
            if "low_vram" in strategy or "offload" in strategy:
                is_offload = True
        if not is_offload and torch.cuda.is_available():
            try:
                target_gpu = self.gpu_id if getattr(self, "gpu_id", None) is not None else 0
                total_mb = torch.cuda.get_device_properties(target_gpu).total_memory / (1024 * 1024)
                if total_mb < 20480:
                    is_offload = True
            except Exception:
                pass

        if is_offload:
            if hasattr(self.pipeline, "enable_sequential_cpu_offload"):
                self.pipeline.enable_sequential_cpu_offload(device)
                logger.info("Hi3D enabled sequential CPU offload on %s", device)
            elif hasattr(self.pipeline, "enable_model_cpu_offload"):
                self.pipeline.enable_model_cpu_offload(device)
                logger.info("Hi3D enabled model CPU offload on %s", device)
            else:
                self.pipeline.to(device)
        else:
            self.pipeline.to(device)

        self.status = ModelStatus.LOADED

    def _unload_model(self) -> None:
        """Unload pipeline and release GPU memory."""
        if self.pipeline is not None:
            del self.pipeline
            self.pipeline = None

        if torch.cuda.is_available():
            torch.cuda.empty_cache()

        self.status = ModelStatus.UNLOADED

    def _generate_dummy_coarse_mesh(self) -> trimesh.Trimesh:
        """
        Generate an initial coarse bounding mesh when no prior coarse mesh is provided.
        """
        sphere = trimesh.creation.icosphere(subdivisions=2, radius=0.5)
        return sphere

    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """
        Process mesh generation / refinement request.

        Args:
            inputs: Dictionary containing:
                - image_paths / reference_image_path / image_path: Image input (required)
                - coarse_mesh_path / coarse_mesh / mesh_path: Coarse mesh input (optional)
                - resolution: Adapter-locked production resolution (1024); request overrides are ignored
                - num_inference_steps: Adapter-locked production schedule (25); request overrides are ignored
                - seed: Caller-controlled random seed (default 42)
                - apply_texture: When False (default), exports clean untextured raw mesh
                - output_format: 'glb' or 'obj' (default: 'glb')

        Returns:
            Dictionary containing success, output_mesh_path, and generation_info.
        """
        requested_seed = inputs.get("seed")
        inputs = {**inputs, **_LOCKED_INFERENCE_PROFILE}
        if requested_seed is not None:
            inputs["seed"] = requested_seed
        self.status = ModelStatus.PROCESSING

        # Resolve image
        image_path = (
            inputs.get("reference_image_path")
            or inputs.get("image_path")
            or inputs.get("image")
        )
        if not image_path and "image_paths" in inputs:
            img_list = inputs["image_paths"]
            if isinstance(img_list, (list, tuple)) and len(img_list) > 0:
                image_path = img_list[0]
            elif isinstance(img_list, str):
                image_path = img_list

        if not image_path:
            raise ValueError(
                "Reference image ('reference_image_path', 'image_path', or 'image_paths') "
                "is required for Hi3D"
            )

        if isinstance(image_path, (str, Path)):
            img_p = Path(image_path)
            if not img_p.exists():
                raise FileNotFoundError(f"Input image file not found: {img_p}")
            # Preserve alpha and EXIF metadata: the custom SPARC3D prepare_image()
            # uses transparency to crop the subject before conditioning.
            with Image.open(str(img_p)) as source_image:
                image = source_image.copy()
        elif isinstance(image_path, Image.Image):
            image = image_path.copy()
        else:
            raise ValueError(f"Invalid image type: {type(image_path)}")

        # Resolve coarse mesh
        coarse_mesh_input = (
            inputs.get("coarse_mesh_path")
            or inputs.get("coarse_mesh")
            or inputs.get("mesh_path")
            or inputs.get("input_mesh_path")
        )
        if coarse_mesh_input:
            if isinstance(coarse_mesh_input, (str, Path)):
                c_path = Path(coarse_mesh_input)
                if not c_path.exists():
                    raise FileNotFoundError(f"Coarse mesh file not found: {c_path}")
                coarse_mesh = trimesh.load(str(c_path), force="mesh", process=False)
            elif isinstance(coarse_mesh_input, trimesh.Trimesh):
                coarse_mesh = coarse_mesh_input
            else:
                raise ValueError(f"Invalid coarse mesh type: {type(coarse_mesh_input)}")
        else:
            logger.info("No coarse mesh provided for Hi3D; generating initial coarse envelope")
            coarse_mesh = self._generate_dummy_coarse_mesh()

        resolution = inputs.get("resolution", _LOCKED_INFERENCE_PROFILE["resolution"])
        if resolution not in (512, 1024, 1536):
            resolution = 1024

        num_inference_steps = inputs.get(
            "num_inference_steps", _LOCKED_INFERENCE_PROFILE["num_inference_steps"]
        )
        seed = inputs.get("seed", _LOCKED_INFERENCE_PROFILE["seed"])
        apply_texture = inputs.get("apply_texture", _LOCKED_INFERENCE_PROFILE["apply_texture"])
        output_format = inputs.get("output_format", "glb").lower()
        if output_format not in self.supported_output_formats:
            output_format = "glb"

        # Ensure pipeline is loaded
        if self.pipeline is None:
            self._load_model()

        try:
            result = self.pipeline(
                image,
                coarse_mesh,
                resolution=resolution,
                num_inference_steps=num_inference_steps,
                seed=seed,
            )
            refined_mesh = getattr(result, "mesh", result)
        except Exception as e:
            logger.exception("Hi3D inference failed: %s", e)
            raise RuntimeError(f"Hi3D inference failed: {e}") from e

        if not isinstance(refined_mesh, trimesh.Trimesh):
            # If pipeline returned a scene or unexpected mesh container, convert
            if hasattr(refined_mesh, "geometry") and isinstance(refined_mesh.geometry, dict):
                meshes = [m for m in refined_mesh.geometry.values() if isinstance(m, trimesh.Trimesh)]
                if meshes:
                    refined_mesh = trimesh.util.concatenate(meshes)
                else:
                    raise RuntimeError("Failed to extract valid Trimesh from Hi3D output")

        if "output_path" in inputs and inputs["output_path"]:
            output_path = Path(inputs["output_path"])
            output_path.parent.mkdir(parents=True, exist_ok=True)
        else:
            output_path = self.path_generator.generate_mesh_path(
                self.model_id,
                f"hi3d_{uuid.uuid4().hex[:8]}",
                output_format,
            )

        if not apply_texture:
            export_untextured_raw_mesh(refined_mesh, output_path)
        else:
            if output_format == "glb":
                refined_mesh.export(str(output_path), file_type="glb")
            else:
                refined_mesh.export(str(output_path), file_type="obj")

        self.status = ModelStatus.LOADED

        return {
            "success": True,
            "output_mesh_path": str(output_path),
            "generation_info": {
                "model_id": self.model_id,
                "experimental": True,
                "checkpoint_license": CHECKPOINT_LICENSE,
                "resolution": resolution,
                "num_inference_steps": num_inference_steps,
                "seed": seed,
                "apply_texture": apply_texture,
                "sequential_cpu_offload": self.sequential_cpu_offload,
                "fp16": self.fp16,
                "vertex_count": len(refined_mesh.vertices),
                "face_count": len(refined_mesh.faces),
            },
        }

    def get_supported_formats(self) -> Dict[str, List[str]]:
        """Return supported input and output formats."""
        return {"input": ["image", "mesh"], "output": ["glb", "obj"]}

    def get_parameter_schema(self) -> Dict[str, Any]:
        """Return JSON Schema describing model-specific parameters."""
        return {
            "parameters": {
                "resolution": {
                    "type": "integer",
                    "description": "Adapter-locked Hi3D production resolution; request overrides are ignored",
                    "default": _LOCKED_INFERENCE_PROFILE["resolution"],
                    "enum": [_LOCKED_INFERENCE_PROFILE["resolution"]],
                    "readOnly": True,
                    "required": False,
                },
                "num_inference_steps": {
                    "type": "integer",
                    "description": "Adapter-locked flow matching scheduler steps per pass; request overrides are ignored",
                    "default": _LOCKED_INFERENCE_PROFILE["num_inference_steps"],
                    "readOnly": True,
                    "required": False,
                },
                "seed": {
                    "type": "integer",
                    "description": "Random seed for reproducible refinement",
                    "default": _LOCKED_INFERENCE_PROFILE["seed"],
                    "required": False,
                },
                "apply_texture": {
                    "type": "boolean",
                    "description": "Export clean untextured raw geometry when False",
                    "default": _LOCKED_INFERENCE_PROFILE["apply_texture"],
                    "readOnly": True,
                    "required": False,
                },
            }
        }

    def get_model_info(self) -> Dict[str, Any]:
        """Return metadata describing model identity and status."""
        return {
            "model_id": self.model_id,
            "feature_type": self.feature_type,
            "experimental": True,
            "checkpoint_license": CHECKPOINT_LICENSE,
            "vram_requirement": self.vram_requirement,
            "status": self.status.value if hasattr(self.status, "value") else str(self.status),
        }


class Hi3DImageToRawMeshAdapter(Hi3DAdapter):
    """
    Adapter for Hi3D image-to-raw-mesh refinement.
    Produces high-fidelity untextured raw meshes.
    """

    MODEL_ID = "hi3d_image_to_raw_mesh"
    FEATURE_TYPE = "image_to_raw_mesh"


class Hi3DImageToTexturedMeshAdapter(Hi3DAdapter):
    """
    Adapter for Hi3D image-to-textured-mesh route.
    Note: Hi3D produces geometry only. Untextured raw mesh is cleanly exported
    when apply_texture=False.
    """

    MODEL_ID = "hi3d_image_to_textured_mesh"
    FEATURE_TYPE = "image_to_textured_mesh"


# Backward-compatible alias
Hi3DImageToMeshAdapter = Hi3DImageToRawMeshAdapter
