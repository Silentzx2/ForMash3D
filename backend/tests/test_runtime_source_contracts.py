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


def test_unirig_respects_scheduler_selected_gpu():
    source = (ROOT / "backend" / "adapters" / "unirig_adapter.py").read_text(encoding="utf-8")
    assert 'self.device in {"cuda", "cuda:0"}' in source
    assert 'self.device = f"cuda:{self.gpu_id}"' in source
