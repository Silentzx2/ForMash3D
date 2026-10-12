"""
Paint3D model adapter for 1K/2K texture generation.

Integrates OpenTexture/Paint3D into the ForMash3D mesh painting framework,
performing coarse texture generation followed by UV texture refinement to
produce 1024x1024 or 2048x2048 UV-mapped textured meshes.
"""

import logging
import os
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

import numpy as np
import torch
from PIL import Image

from core.models.base import ModelStatus
from core.models.mesh_models import ImageToMeshModel
from core.utils.file_utils import OutputPathGenerator
from core.utils.mesh_utils import MeshProcessor

logger = logging.getLogger(__name__)

# Standard compatibility aliases
MeshToMeshModel = ImageToMeshModel
ModelAdapter = ImageToMeshModel


class Paint3DAdapter(ImageToMeshModel):
    """
    Adapter for Paint3D coarse-to-fine texture painting.

    Takes an existing raw untextured mesh and reference image, and generates
    high-quality 1K or 2K UV-textured GLB/OBJ with albedo texture maps.
    """

    FEATURE_TYPE = "image_mesh_painting"
    MODEL_ID = "paint3d"

    def __init__(
        self,
        model_id: Optional[str] = None,
        model_path: Optional[str] = None,
        vram_requirement: Optional[int] = None,
        paint3d_root: Optional[str] = None,
        device: str = "cuda:0",
        feature_type: Optional[str] = None,
        supported_output_formats: Optional[List[str]] = None,
        **kwargs: Any,
    ):
        if vram_requirement is None:
            vram_requirement = 12000
        if model_id is None:
            model_id = self.MODEL_ID
        if model_path is None:
            model_path = str(
                Path(__file__).resolve().parents[1] / "pretrained" / "Paint3D"
            )
        if paint3d_root is None:
            paint3d_root = str(
                Path(__file__).resolve().parents[1] / "thirdparty" / "Paint3D"
            )
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

        self.paint3d_root = Path(paint3d_root)
        self.device = device
        self.mesh_processor = MeshProcessor()
        self.path_generator = OutputPathGenerator(base_output_dir="outputs")

        # Ensure Paint3D root is in sys.path
        if str(self.paint3d_root) not in sys.path:
            sys.path.insert(0, str(self.paint3d_root))

    def _resolve_checkpoints(self) -> Dict[str, str]:
        """Resolve paths to required ControlNet and base model checkpoints."""
        candidates = {
            "uv_pos": [
                self.model_path / "UVPos_Control",
                self.model_path / "Paint3d_UVPos_Control",
                self.model_path,
            ],
            "sd15": [
                self.model_path / "stable-diffusion-v1-5",
                self.model_path / "v1-5-pruned-emaonly",
            ],
            "depth": [
                self.model_path / "control_v11f1p_sd15_depth",
            ],
            "inpaint": [
                self.model_path / "control_v11p_sd15_inpaint",
            ],
            "tile": [
                self.model_path / "control_v11f1e_sd15_tile",
            ],
        }

        resolved = {
            "uv_pos": "GeorgeQi/Paint3d_UVPos_Control",
            "sd15": "runwayml/stable-diffusion-v1-5",
            "depth": "lllyasviel/control_v11f1p_sd15_depth",
            "inpaint": "lllyasviel/control_v11p_sd15_inpaint",
            "tile": "lllyasviel/control_v11f1e_sd15_tile",
        }

        for key, paths in candidates.items():
            for p in paths:
                if p.exists() and (any(p.glob("*.bin")) or any(p.glob("*.safetensors"))):
                    resolved[key] = str(p)
                    break

        return resolved

    def _load_model(self) -> Dict[str, Any]:
        """Verify GPU environment and Paint3D dependencies (lazy loading)."""
        if not torch.cuda.is_available():
            raise RuntimeError(
                "Paint3D requires CUDA; CPU inference is not supported under strict GPU policy."
            )

        if not self.paint3d_root.exists():
            raise FileNotFoundError(
                f"Paint3D root directory not found at: {self.paint3d_root}"
            )

        # Enforce strict CUDA device
        target_device = f"cuda:{self.gpu_id}" if self.gpu_id is not None else "cuda:0"
        self.device = target_device

        logger.info(f"Paint3D initialized on device {self.device}")
        self.status = ModelStatus.LOADED
        return {
            "model_id": self.model_id,
            "paint3d_root": str(self.paint3d_root),
            "model_path": str(self.model_path),
            "device": self.device,
        }

    def _unload_model(self) -> None:
        """Unload model resources and clear GPU cache."""
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        self.status = ModelStatus.UNLOADED
        logger.info("Paint3D unloaded")

    def get_vram_status(self, gpu_id: Optional[int] = None) -> Dict[str, Any]:
        """Return VRAM eligibility status for Paint3D."""
        vram_mb = self.vram_requirement

        target_gpu_id = gpu_id
        if target_gpu_id is None:
            target_gpu_id = getattr(self, "gpu_id", None)
        if target_gpu_id is None:
            device_str = getattr(self, "device", None)
            if isinstance(device_str, str) and device_str.startswith("cuda:"):
                try:
                    target_gpu_id = int(device_str.split(":")[1])
                except (ValueError, IndexError):
                    target_gpu_id = 0
            else:
                target_gpu_id = 0

        if not torch.cuda.is_available():
            return {
                "model_id": self.model_id,
                "vram_required_mb": vram_mb,
                "vram_available_mb": None,
                "eligible": False,
                "status": "ineligible",
                "gpu_id": target_gpu_id,
                "error": "CUDA is unavailable",
            }

        try:
            device_count = torch.cuda.device_count()
            if target_gpu_id < 0 or target_gpu_id >= device_count:
                return {
                    "model_id": self.model_id,
                    "vram_required_mb": vram_mb,
                    "vram_available_mb": None,
                    "eligible": False,
                    "status": "ineligible",
                    "gpu_id": target_gpu_id,
                    "error": f"GPU {target_gpu_id} out of range (device count: {device_count})",
                }

            torch_vram = torch.cuda.get_device_properties(target_gpu_id).total_memory / (1024 * 1024)
            is_eligible = torch_vram >= vram_mb
            return {
                "model_id": self.model_id,
                "vram_required_mb": vram_mb,
                "vram_available_mb": torch_vram,
                "eligible": is_eligible,
                "status": "eligible" if is_eligible else "insufficient_vram",
                "gpu_id": target_gpu_id,
            }
        except Exception as e:
            return {
                "model_id": self.model_id,
                "vram_required_mb": vram_mb,
                "vram_available_mb": None,
                "eligible": False,
                "status": "ineligible",
                "gpu_id": target_gpu_id,
                "error": str(e),
            }

    def get_parameter_schema(self) -> Dict[str, Any]:
        """Return parameter schema for Paint3D."""
        return {
            "parameters": {
                "texture_resolution": {
                    "type": "integer",
                    "description": "Output texture resolution (1024 for 1K, 2048 for 2K)",
                    "default": 1024,
                    "enum": [1024, 2048],
                    "required": False,
                },
                "prompt": {
                    "type": "string",
                    "description": "Optional conditioning text prompt",
                    "default": "",
                    "required": False,
                },
                "output_format": {
                    "type": "string",
                    "description": "Output mesh format (glb, obj)",
                    "default": "glb",
                    "enum": ["glb", "obj"],
                    "required": False,
                },
            },
            "vram_requirement_mb": self.vram_requirement,
            "vram_eligible": self.get_vram_status()["eligible"],
        }

    def get_supported_formats(self) -> Dict[str, List[str]]:
        """Return supported input and output file formats."""
        return {"input": ["glb", "obj", "ply"], "output": ["glb", "obj"]}

    def _prepare_job_mesh(self, mesh_path: Path, job_dir: Path) -> Path:
        """Convert input mesh to OBJ format with UV unwrapping if necessary."""
        import trimesh
        target_obj = job_dir / "input_mesh.obj"

        mesh = trimesh.load(str(mesh_path), process=False)
        if isinstance(mesh, trimesh.Scene):
            from postprocess.meshio import scene_to_mesh
            mesh = scene_to_mesh(mesh)

        # Check for UV coordinates, unwrap if missing
        has_uv = hasattr(mesh.visual, "uv") and mesh.visual.uv is not None and len(mesh.visual.uv) > 0
        if not has_uv:
            logger.info("Mesh lacks UV coordinates; unwrapping using xatlas/trimesh...")
            try:
                import xatlas
                v = mesh.vertices
                f = mesh.faces
                atlas = xatlas.Atlas()
                atlas.add_mesh(v, f)
                atlas.generate()
                vmapping, indices, uvs = atlas.get_mesh(0)
                mesh = trimesh.Trimesh(
                    vertices=v[vmapping],
                    faces=indices,
                    visual=trimesh.visual.TextureVisuals(uv=uvs),
                    process=False,
                )
            except Exception as uv_err:
                logger.warning(
                    f"Automatic UV unwrapping via xatlas had an issue: {uv_err}; proceeding with default mesh."
                )

        mesh.export(str(target_obj))
        return target_obj

    def _prepare_reference_image(self, image_path: Path, job_dir: Path) -> Path:
        """Standardize reference image to RGB PNG."""
        target_img = job_dir / "reference_image.png"
        with Image.open(image_path) as img:
            rgb_img = img.convert("RGB")
            rgb_img.save(str(target_img), format="PNG")
        return target_img

    def _generate_configs(
        self,
        job_dir: Path,
        mesh_path: Path,
        resolution: int,
        prompt: str,
        ckpts: Dict[str, str],
    ) -> Tuple[Path, Path, Path]:
        """Generate render_config.py and stage1/2 yaml configs in job-scoped dir."""
        render_cfg_path = job_dir / "render_config.py"
        stage1_cfg_path = job_dir / "stage1_sd_config.yaml"
        stage2_cfg_path = job_dir / "stage2_sd_config.yaml"

        render_cfg_content = f'''import numpy as np
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional, Tuple, List

@dataclass
class RenderConfig:
    grid_size: int = {resolution}
    radius: float = 1.5
    look_at_height: float = 0.25
    base_theta: float = 60
    fov_para: float = np.pi / 3 * 0.9
    remove_mesh_part_names: List[str] = field(default_factory=list)
    remove_unsupported_buffers: List[str] = field(default_factory=list)
    n_views: int = 16
    views_before: List[Tuple[float, float]] = field(default_factory=list)
    views_after: List[Tuple[float, float]] = field(default_factory=lambda: [[180, 30], [180, 150]])
    alternate_views: bool = True
    calcu_uncolored_mode: str = "WarpGrid"
    projection_mode: str = "Pinhole"
    texture_interpolation_mode: str = 'bilinear'
    texture_default_color: List[float] = field(default_factory=lambda: [0.8, 0.8, 0.8])
    texturify_blend_alpha: float = 1.0
    render_angle_thres: float = 68
    views_init: List[float] = field(default_factory=lambda: [0, 15])
    views_inpaint: List[Tuple[float, float]] = field(default_factory=lambda: [(4, 5), (16, 17)])

@dataclass
class GuideConfig:
    shape_path: str = "{mesh_path.as_posix()}"
    initial_texture: Path = None
    texture_resolution: List[int] = field(default_factory=lambda: [{resolution}, {resolution}])
    append_direction: bool = True
    shape_scale: float = 0.6
    z_update_thr: float = 0.2
    strict_projection: bool = True
    force_run_xatlas: bool = False

@dataclass
class OptimConfig:
    seed: int = 42
    lr: float = 1e-2
    train_step: int = 100

@dataclass
class LogConfig:
    exp_path: str = "{job_dir.as_posix()}"
    full_eval_size: int = 50
    cache_path: str = "paint3d_cache"

@dataclass
class TrainConfig:
    log: LogConfig = field(default_factory=LogConfig)
    render: RenderConfig = field(default_factory=RenderConfig)
    optim: OptimConfig = field(default_factory=OptimConfig)
    guide: GuideConfig = field(default_factory=GuideConfig)
'''
        render_cfg_path.write_text(render_cfg_content)

        clean_prompt = prompt or "high quality, clean lighting-less albedo texture, detailed"
        neg_prompt = "strong light, bright light, intense illumination, shade, darkness, silhouette, shadow"

        stage1_content = f'''txt2img:
  sd_model_key: "{ckpts['sd15']}"
  ip_adapter_image_path: ""
  prompt: "{clean_prompt}"
  negative_prompt: "{neg_prompt}"
  seed: 42
  width: {min(resolution, 1024)}
  height: 512
  num_images_per_prompt: 1
  guidance_scale: 7.0
  num_inference_steps: 20
  controlnet_units:
    - preprocessor: "none"
      controlnet_key: "{ckpts['depth']}"
      condition_image_path: ""
      weight: 1.0

inpaint:
  sd_model_key: "{ckpts['sd15']}"
  image_path: ""
  mask_path: ""
  ip_adapter_image_path: ""
  prompt: "{clean_prompt}"
  negative_prompt: "{neg_prompt}"
  seed: 42
  width: {min(resolution, 1024)}
  height: 512
  num_images_per_prompt: 1
  guidance_scale: 3.0
  num_inference_steps: 20
  denoising_strength: 1.0
  controlnet_units:
    - preprocessor: "none"
      controlnet_key: "{ckpts['depth']}"
      condition_image_path: ""
      weight: 1.0
    - preprocessor: "inpaint_global_harmonious"
      controlnet_key: "{ckpts['inpaint']}"
      condition_image_path: ""
      weight: 0.5
'''
        stage1_cfg_path.write_text(stage1_content)

        stage2_content = f'''inpaint:
  sd_model_key: "{ckpts['sd15']}"
  image_path: ""
  mask_path: ""
  ip_adapter_image_path: ""
  prompt: "UV map, {clean_prompt}"
  negative_prompt: "{neg_prompt}"
  seed: 42
  width: {resolution}
  height: {resolution}
  num_images_per_prompt: 1
  guidance_scale: 3.0
  num_inference_steps: 20
  denoising_strength: 1.0
  controlnet_units:
    - preprocessor: "none"
      controlnet_key: "{ckpts['uv_pos']}"
      condition_image_path: ""
      weight: 1.0
    - preprocessor: "inpaint_global_harmonious"
      controlnet_key: "{ckpts['inpaint']}"
      condition_image_path: ""
      weight: 0.5

img2img:
  sd_model_key: "{ckpts['sd15']}"
  image_path: ""
  ip_adapter_image_path: ""
  prompt: "UV map, {clean_prompt}"
  negative_prompt: "blur, low quality, noisy, over-exposed, shadow"
  seed: 42
  width: {resolution}
  height: {resolution}
  num_images_per_prompt: 1
  guidance_scale: 7.0
  num_inference_steps: 20
  denoising_strength: 0.75
  controlnet_units:
    - preprocessor: "none"
      controlnet_key: "{ckpts['uv_pos']}"
      condition_image_path: ""
      weight: 1.0
    - preprocessor: "none"
      controlnet_key: "{ckpts['tile']}"
      condition_image_path: ""
      weight: 1.0
'''
        stage2_cfg_path.write_text(stage2_content)

        return render_cfg_path, stage1_cfg_path, stage2_cfg_path

    def _execute_stage(
        self,
        script_name: str,
        sd_config: Path,
        render_config: Path,
        mesh_path: Path,
        image_path: Path,
        outdir: Path,
        texture_path: Optional[Path] = None,
        timeout_seconds: int = 600,
        progress_callback: Optional[Callable[[str, float, str], None]] = None,
    ) -> None:
        """Run a Paint3D pipeline stage using isolated subprocess with validated argv."""
        cmd = [
            sys.executable,
            str(self.paint3d_root / script_name),
            "--sd_config", str(sd_config),
            "--render_config", str(render_config),
            "--mesh_path", str(mesh_path),
            "--ip_adapter_image_path", str(image_path),
            "--outdir", str(outdir),
        ]
        if texture_path is not None:
            cmd.extend(["--texture_path", str(texture_path)])

        env = os.environ.copy()
        env["CUDA_VISIBLE_DEVICES"] = str(self.gpu_id if self.gpu_id is not None else "0")
        env["PYTHONPATH"] = f"{self.paint3d_root}:{env.get('PYTHONPATH', '')}"

        logger.info(f"Running Paint3D stage: {script_name} -> {outdir}")
        # Use explicit UTF-8 encoding with error handling to prevent UnicodeDecodeError
        # Stream output to capture progress
        proc = subprocess.Popen(
            cmd,
            cwd=str(self.paint3d_root),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding='utf-8',
            errors='replace',
            bufsize=1,  # line buffered
        )
        
        # Read output line by line and report progress
        output_lines = []
        stage_name = "stage1" if "stage1" in script_name else "stage2"
        for line in proc.stdout:
            line = line.rstrip()
            output_lines.append(line)
            logger.debug(f"[Paint3D {stage_name}] {line}")
            
            # Parse progress from output if available
            if progress_callback:
                self._parse_and_report_progress(line, stage_name, progress_callback)
        
        proc.wait(timeout=timeout_seconds)
        stdout = "\n".join(output_lines)
        
        if proc.returncode != 0:
            err_msg = stdout.strip()
            logger.error(f"Paint3D {script_name} failed (code {proc.returncode}):\n{err_msg}")
            raise RuntimeError(f"Paint3D {script_name} execution failed: {err_msg}")

    def _parse_and_report_progress(self, line: str, stage_name: str, progress_callback: Callable[[str, float, str], None]) -> None:
        """Parse Paint3D subprocess output for progress indicators and report via callback."""
        line_lower = line.lower()
        
        # Stage 1: Coarse multi-view texture generation progress patterns
        if stage_name == "stage1":
            if "sampling" in line_lower or "denoising" in line_lower or "step" in line_lower:
                # Look for patterns like "Step 5/20" or "sampling step 5 of 20"
                import re
                step_match = re.search(r'step\s*(\d+)\s*[/|of]\s*(\d+)', line_lower)
                if step_match:
                    current = int(step_match.group(1))
                    total = int(step_match.group(2))
                    if total > 0:
                        frac = current / total
                        progress_callback("texture", 0.68 + frac * 0.14, f"Stage 1: Sampling step {current}/{total}")
                        return
                # Generic sampling progress
                if "sampling" in line_lower:
                    progress_callback("texture", 0.68, "Stage 1: Sampling coarse textures...")
                    return
            elif "loading" in line_lower and ("model" in line_lower or "checkpoint" in line_lower):
                progress_callback("texture", 0.68, "Stage 1: Loading models...")
                return
            elif "rendering" in line_lower or "view" in line_lower:
                progress_callback("texture", 0.72, "Stage 1: Rendering multi-view...")
                return
        
        # Stage 2: UV inpainting & tile refinement progress patterns
        elif stage_name == "stage2":
            if "inpaint" in line_lower or "uv" in line_lower or "tile" in line_lower:
                import re
                step_match = re.search(r'step\s*(\d+)\s*[/|of]\s*(\d+)', line_lower)
                if step_match:
                    current = int(step_match.group(1))
                    total = int(step_match.group(2))
                    if total > 0:
                        frac = current / total
                        progress_callback("texture", 0.82 + frac * 0.10, f"Stage 2: UV inpainting step {current}/{total}")
                        return
                if "inpaint" in line_lower:
                    progress_callback("texture", 0.82, "Stage 2: UV inpainting...")
                    return
                elif "uv" in line_lower and "tile" in line_lower:
                    progress_callback("texture", 0.86, "Stage 2: UV tile refinement...")
                    return
            elif "loading" in line_lower and ("model" in line_lower or "checkpoint" in line_lower):
                progress_callback("texture", 0.80, "Stage 2: Loading models...")
                return
        
        # Generic progress fallback - look for percentage or step patterns
        import re
        pct_match = re.search(r'(\d+)%', line)
        if pct_match:
            pct = int(pct_match.group(1))
            base = 0.68 if stage_name == "stage1" else 0.80
            progress_callback("texture", min(0.95, base + pct / 100 * 0.15), f"{stage_name.capitalize()}: {pct}%")
            return
            
        step_match = re.search(r'step\s*(\d+)\s*[/|of]\s*(\d+)', line_lower)
        if step_match:
            current = int(step_match.group(1))
            total = int(step_match.group(2))
            if total > 0:
                frac = current / total
                base = 0.68 if stage_name == "stage1" else 0.80
                progress_callback("texture", min(0.95, base + frac * 0.15), f"{stage_name.capitalize()}: Step {current}/{total}")

    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """
        Process mesh painting using Paint3D.

        Inputs:
            mesh_path: Path to validated raw mesh (required)
            image_path: Path to reference conditioning image (required)
            texture_resolution: 1024 or 2048 (default: 1024)
            output_path: Optional target mesh path
            output_format: 'glb' or 'obj' (default: 'glb')
            prompt: Optional text prompt
        """
        if not torch.cuda.is_available():
            raise RuntimeError(
                "Paint3D requires CUDA; CPU inference is not supported under strict GPU policy."
            )

        if "mesh_path" not in inputs:
            raise ValueError("mesh_path is required for Paint3D texturing")
        if "image_path" not in inputs:
            raise ValueError("image_path is required for Paint3D texturing")

        mesh_path = Path(inputs["mesh_path"])
        image_path = Path(inputs["image_path"])

        if not mesh_path.exists():
            raise FileNotFoundError(f"Input mesh not found: {mesh_path}")
        if not image_path.exists():
            raise FileNotFoundError(f"Input image not found: {image_path}")

        # Parse and normalize texture resolution
        raw_res = inputs.get("texture_resolution", 1024)
        if isinstance(raw_res, str):
            res_str = raw_res.upper().strip()
            if "2K" in res_str or "2048" in res_str:
                texture_resolution = 2048
            else:
                texture_resolution = 1024
        else:
            texture_resolution = 2048 if int(raw_res) >= 2048 else 1024

        output_format = inputs.get("output_format", "glb").lower()
        if output_format not in self.supported_output_formats:
            raise ValueError(f"Unsupported output format: {output_format}")

        prompt = inputs.get("prompt", "")
        job_id = inputs.get("job_id") or uuid.uuid4().hex[:12]
        # Get progress callback from inputs (passed by pipeline)
        progress_callback = inputs.get("progress_callback")

        # Destination mesh output path
        explicit_output = inputs.get("output_path")
        if explicit_output:
            final_output_mesh = Path(explicit_output)
            final_output_mesh.parent.mkdir(parents=True, exist_ok=True)
        else:
            base_name = f"{self.model_id}_{mesh_path.stem}_{image_path.stem}_{texture_resolution}"
            final_output_mesh = Path(
                self.path_generator.generate_mesh_path(
                    self.model_id, base_name, output_format
                )
            )

        final_texture_dir = final_output_mesh.parent / "textures"
        final_texture_dir.mkdir(parents=True, exist_ok=True)
        final_albedo_map = final_texture_dir / f"{final_output_mesh.stem}_albedo.png"

        job_dir = Path(tempfile.mkdtemp(prefix=f"paint3d_job_{job_id}_"))
        start_time = time.time()

        try:
            logger.info(
                f"[Paint3D] Starting texture generation: mesh={mesh_path.name}, "
                f"image={image_path.name}, res={texture_resolution}"
            )

            job_mesh = self._prepare_job_mesh(mesh_path, job_dir)
            job_image = self._prepare_reference_image(image_path, job_dir)
            ckpts = self._resolve_checkpoints()

            render_cfg_path, stage1_cfg_path, stage2_cfg_path = self._generate_configs(
                job_dir=job_dir,
                mesh_path=job_mesh,
                resolution=texture_resolution,
                prompt=prompt,
                ckpts=ckpts,
            )

            stage1_outdir = job_dir / "stage1"
            stage2_outdir = job_dir / "stage2"

            # Execute Stage 1: Coarse multi-view texture generation
            self._execute_stage(
                script_name="pipeline_paint3d_stage1.py",
                sd_config=stage1_cfg_path,
                render_config=render_cfg_path,
                mesh_path=job_mesh,
                image_path=job_image,
                outdir=stage1_outdir,
                progress_callback=progress_callback,
            )

            # Find stage 1 albedo output
            s1_candidates = list(stage1_outdir.glob("**/albedo.png")) + list(stage1_outdir.glob("albedo.png"))
            if not s1_candidates:
                raise RuntimeError("Stage 1 did not produce expected albedo.png coarse texture.")
            s1_albedo = s1_candidates[0]

# Execute Stage 2: UV inpainting & tile refinement
            self._execute_stage(
                script_name="pipeline_paint3d_stage2.py",
                sd_config=stage2_cfg_path,
                render_config=render_cfg_path,
                mesh_path=job_mesh,
                image_path=job_image,
                outdir=stage2_outdir,
                texture_path=s1_albedo,
                progress_callback=progress_callback,
            )

            # Locate refined albedo texture
            s2_candidates = (
                list(stage2_outdir.glob("**/UV_tile_res_0.png"))
                + list(stage2_outdir.glob("**/albedo.png"))
                + list(stage2_outdir.glob("**/UV_inpaint_res_0.png"))
            )
            refined_albedo = s2_candidates[0] if s2_candidates else s1_albedo

            # Copy refined albedo map to durable destination
            shutil.copy2(refined_albedo, final_albedo_map)

            # Locate generated OBJ mesh
            obj_candidates = list(stage2_outdir.glob("**/mesh.obj")) + list(stage1_outdir.glob("**/mesh.obj"))
            source_obj = obj_candidates[0] if obj_candidates else job_mesh

            # Package output mesh
            import trimesh
            textured_mesh = trimesh.load(str(source_obj), process=False)
            with Image.open(final_albedo_map) as alb_im:
                alb_rgb = alb_im.convert("RGB")
                if hasattr(textured_mesh, "visual"):
                    textured_mesh.visual = trimesh.visual.TextureVisuals(
                        uv=getattr(textured_mesh.visual, "uv", None),
                        image=alb_rgb,
                    )

            if output_format == "glb":
                textured_mesh.export(str(final_output_mesh), file_type="glb")
            else:
                textured_mesh.export(str(final_output_mesh), file_type="obj")

            mesh_stats = self.mesh_processor.get_mesh_stats(textured_mesh)
            elapsed_time = time.time() - start_time

            response = {
                "output_mesh_path": str(final_output_mesh),
                "texture_map_paths": {
                    "albedo": str(final_albedo_map),
                },
                "texture_resolution": texture_resolution,
                "metadata": {
                    "model_id": self.model_id,
                    "feature_type": self.feature_type,
                    "texture_resolution": texture_resolution,
                    "input_mesh": str(mesh_path),
                    "input_image": str(image_path),
                    "output_format": output_format,
                    "vertex_count": mesh_stats.get("vertex_count", len(textured_mesh.vertices)),
                    "face_count": mesh_stats.get("face_count", len(textured_mesh.faces)),
                    "has_uv": hasattr(textured_mesh.visual, "uv") and textured_mesh.visual.uv is not None,
                    "device": self.device,
                    "elapsed_seconds": round(elapsed_time, 2),
                    "stages_completed": ["stage1_coarse", "stage2_uv_refinement"],
                },
                "success": True,
                "painting_info": {
                    "model": self.model_id,
                    "texture_resolution": texture_resolution,
                    "albedo_path": str(final_albedo_map),
                    "output_mesh": str(final_output_mesh),
                },
            }

            logger.info(
                f"[Paint3D] Texturing completed in {elapsed_time:.1f}s: {final_output_mesh}"
            )
            self.status = ModelStatus.LOADED
            return response

        except Exception as e:
            self.status = ModelStatus.ERROR
            logger.error(f"[Paint3D] Mesh texturing failed: {e}", exc_info=True)
            raise RuntimeError(f"Paint3D mesh texturing failed: {e}") from e

        finally:
            # Ensure job-scoped directory cleanup
            shutil.rmtree(job_dir, ignore_errors=True)


# Registration alias
Paint3DImageMeshPaintingAdapter = Paint3DAdapter
