"""CPU-only source contracts for runtime source selection."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ADAPTER = ROOT / "backend" / "adapters" / "hunyuan3d_paint_v21.py"


def test_hunyuan_adapter_preserves_explicit_checkpoint_source():
    source = ADAPTER.read_text(encoding="utf-8")
    assert "self._model_path_was_explicit = model_path is not None" in source
    assert "from hy3dpaint.utils.runtime_path_utils import resolve_model_source" in source
    assert "if self._model_path_was_explicit:" in source
    assert "falling back to remote repository tencent/Hunyuan3D-2.1" not in source


def test_backend_ci_runs_third_party_path_contracts():
    workflow = (ROOT / ".github" / "workflows" / "backend-runtime-ci.yml").read_text(encoding="utf-8")
    assert "branches: [main, dev]" in workflow
    assert "backend/thirdparty/tests/test_runtime_path_utils.py" in workflow


def test_scheduler_vram_admission_uses_physical_free_memory():
    source = (ROOT / "backend" / "core" / "scheduler" / "gpu_monitor.py").read_text(encoding="utf-8")
    assert "torch.cuda.mem_get_info(gpu_id)" in source
    assert "min(tracked_available, physical_available)" in source


def test_multigpu_dispatch_uses_reserved_budget_and_fails_closed():
    source = (ROOT / "backend" / "core" / "scheduler" / "resource_planner.py").read_text(encoding="utf-8")
    assert "max_memory=max_memory or None" in source
    assert "Multi-GPU resource plan could not be applied" in source
    assert "model exposes no dispatchable components" in source


def test_fastmesh_manifest_matches_real_layer_sharding():
    runner = (ROOT / "backend" / "utils" / "fastmesh_utils.py").read_text(encoding="utf-8")
    adapter = (ROOT / "backend" / "adapters" / "fastmesh_adapter.py").read_text(encoding="utf-8")
    manifest = (ROOT / "backend" / "config" / "models.yaml").read_text(encoding="utf-8")
    assert "infer_auto_device_map" in runner
    assert "dispatch_model" in runner
    assert 'resource_plan=getattr(self, "resource_plan", None)' in adapter
    assert 'multi_gpu_strategy: accelerate_auto_device_map' in manifest


def test_hunyuan_paint_chunks_raster_work_and_uses_reserved_devices():
    renderer = (
        ROOT / "backend" / "thirdparty" / "hunyuan3d-paint-v2-1"
        / "hy3dpaint" / "DifferentiableRenderer" / "MeshRender.py"
    ).read_text(encoding="utf-8")
    pipeline = (
        ROOT / "backend" / "thirdparty" / "hunyuan3d-paint-v2-1"
        / "hy3dpaint" / "textureGenPipeline.py"
    ).read_text(encoding="utf-8")
    adapter = (ROOT / "backend" / "adapters" / "hunyuan3d_paint_v21.py").read_text(encoding="utf-8")
    assert "chunk_rows = 128" in renderer
    assert "row_chunk = 128" in renderer
    assert "device=self.config.device" in pipeline
    assert "conf.component_devices" in adapter


def test_rigged_preview_invalidates_thumbnail_and_resolves_artifact_format():
    types = (ROOT / "features" / "workspace" / "types.ts").read_text(encoding="utf-8")
    viewer = (ROOT / "features" / "workspace" / "Viewport" / "MeshViewer.tsx").read_text(encoding="utf-8")
    assert "thumbnail: ''" in types
    assert "artifact_format" in viewer
    assert "artifactFormat === 'rigged'" in viewer
    assert "artifactFormat === 'fbx'" in viewer


def test_ardy_is_cpu_only_from_manifest_through_vendored_text_encoder():
    adapter = (ROOT / "backend" / "adapters" / "ardy_adapter.py").read_text(encoding="utf-8")
    scheduler = (ROOT / "backend" / "core" / "scheduler" / "multiprocess_scheduler.py").read_text(encoding="utf-8")
    register_model = scheduler.split("def register_model", 1)[1].split("def unregister_model", 1)[0]
    planner = (ROOT / "backend" / "core" / "scheduler" / "resource_planner.py").read_text(encoding="utf-8")
    base_model = (ROOT / "backend" / "core" / "models" / "base.py").read_text(encoding="utf-8")
    manifest = (ROOT / "backend" / "config" / "models.yaml").read_text(encoding="utf-8")
    llm2vec = (ROOT / "backend" / "thirdparty" / "ardy" / "ardy" / "model" / "llm2vec" / "llm2vec.py").read_text(encoding="utf-8")

    ardy_config = manifest.split("  ardy_motion_generation:", 1)[1].split("\n# ", 1)[0]
    assert "cpu_only: true" in ardy_config
    assert "vram_requirement: 0" in ardy_config
    assert 'self.device = "cpu"' in adapter
    assert 'os.environ["TEXT_ENCODER_DEVICE"] = "cpu"' in adapter
    assert 'text_encoder_mode="local"' in adapter
    assert "text_encoder_fp32=True" in adapter
    assert "ARDY requires CUDA" not in adapter
    assert "rel_motion_url" not in adapter
    assert 'if not str(device).startswith("cuda") or torch.cuda.device_count() <= 1:' in llm2vec
    assert 'if caps.get("cpu_only") is True:' in planner
    assert 'kind="cpu"' in planner
    assert 'os.environ["CUDA_VISIBLE_DEVICES"] = ""' in scheduler
    assert scheduler.index('os.environ["CUDA_VISIBLE_DEVICES"] = ""') < scheduler.index("from core.config import get_settings, setup_logging")
    assert 'import core.config  # Initialize PyTorch compatibility shims & settings in worker processes' not in scheduler
    assert 'cpu_only = capabilities.get("cpu_only") is True' in register_model
    assert 'gpu_count = 1 if cpu_only else max(len(self.gpu_monitor.get_gpu_status()), 1)' in register_model
    assert '(resource_plan or {}).get("kind") == "cpu"' in scheduler
    assert "if gpu_id is not None and torch is not None and torch.cuda.is_available():" in base_model


def test_unirig_respects_scheduler_selected_gpu():
    source = (ROOT / "backend" / "adapters" / "unirig_adapter.py").read_text(encoding="utf-8")
    assert 'self.device in {"cuda", "cuda:0"}' in source
    assert 'self.device = f"cuda:{self.gpu_id}"' in source

def test_unique3d_normal_checkpoint_uses_four_channel_compatible_base():
    adapter = (ROOT / "backend" / "adapters" / "unique3d_adapter.py").read_text(encoding="utf-8")
    resolver = adapter.split("def _resolve_normal_config", 1)[1].split("def _ensure_ckpt_symlinks", 1)[0]
    normal_load = adapter.split("# Load normal prediction pipeline (image2normal)", 1)[1].split("# self.normal_pipeline.enable_model_cpu_offload()", 1)[0]
    config = (ROOT / "backend" / "thirdparty" / "Unique3D" / "app" / "custom_models" / "image2normal.yaml").read_text(encoding="utf-8")

    assert 'pretrained_model_name_or_path: "lambdalabs/sd-image-variations-diffusers"' in config
    assert 'base_model = "lambdalabs/sd-image-variations-diffusers"' in resolver
    assert "local_img2mvimg" not in resolver
    assert "local_img2mvimg" not in normal_load
    assert "Retrying with the alternate compatible 4-channel image-variation base" in normal_load
    assert "Attempting fallback to local img2mvimg base" not in normal_load
    assert 'self.mvimg_config = str(self.unique3d_root / "app" / "custom_models" / "image2mvimage.yaml")' in adapter
    assert 'self.mvimg_checkpoint = str(Path(model_path) / "ckpt" / "img2mvimg" / "unet" / "diffusion_pytorch_model.safetensors")' in adapter
