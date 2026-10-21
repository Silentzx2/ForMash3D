import asyncio
import json
from pathlib import Path
import sys
from types import SimpleNamespace

import pytest
from fastapi import HTTPException


BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

import types

if "torch" not in sys.modules:
    torch = types.ModuleType("torch")
    torch.__path__ = []
    torch.cuda = SimpleNamespace(
        is_available=lambda: False,
        device_count=lambda: 0,
        empty_cache=lambda: None,
        get_device_properties=lambda idx: SimpleNamespace(total_memory=0),
    )
    torch.float8_e8m0fnu = None
    torch.Tensor = type("Tensor", (), {})
    sys.modules["torch"] = torch

# Router package isolation to avoid initializing full server runtime in headless tests
api_package = types.ModuleType("api")
api_package.__path__ = [str(BACKEND / "api")]
sys.modules.setdefault("api", api_package)
router_package = types.ModuleType("api.routers")
router_package.__path__ = [str(BACKEND / "api" / "routers")]
sys.modules.setdefault("api.routers", router_package)
setattr(api_package, "routers", router_package)
dependencies = sys.modules.get("api.dependencies")
if dependencies is None:
    dependencies = types.ModuleType("api.dependencies")
    sys.modules["api.dependencies"] = dependencies
for attr in [
    "get_file_store",
    "get_current_user_or_none",
    "get_current_user_optional",
    "get_scheduler",
    "get_current_settings",
    "verify_api_key",
]:
    if not hasattr(dependencies, attr):
        setattr(dependencies, attr, lambda *args, **kwargs: None)
setattr(api_package, "dependencies", dependencies)
# Ensure real core.scheduler.multiprocess_scheduler is loaded
if (
    "core.scheduler.multiprocess_scheduler" not in sys.modules
    or not hasattr(sys.modules["core.scheduler.multiprocess_scheduler"], "get_storage_base_dir")
):
    for k in list(sys.modules.keys()):
        if k.startswith("core.scheduler"):
            del sys.modules[k]
    import core.scheduler.multiprocess_scheduler


@pytest.mark.parametrize("key", ["output_mesh_path", "mesh_path", "output_path", "file_path"])
def test_result_path_fallback_checks_every_declared_key(key):
    from core.utils.artifact_utils import first_result_path

    assert first_result_path({key: "/storage/result.glb"}) == "/storage/result.glb"


def test_result_path_fallback_preserves_preferred_key_order():
    from core.utils.artifact_utils import first_result_path

    assert first_result_path({"file_path": "late.glb", "mesh_path": "preferred.obj"}) == "preferred.obj"


def test_result_path_fallback_returns_none_for_empty_result():
    from core.utils.artifact_utils import first_result_path

    assert first_result_path({"output_mesh_path": None, "mesh_path": ""}) is None


def test_standalone_unirig_output_written_to_canonical_workspace(monkeypatch, tmp_path):
    """RIG-10: UniRig artifacts written to selected asset's canonical workspace (rigging/<job-id>/)."""
    from adapters import unirig_adapter
    from adapters.unirig_adapter import UniRigAdapter
    from core.models.base import ModelStatus
    from core.utils import file_utils

    storage = tmp_path / "storage"
    monkeypatch.setattr(file_utils, "get_storage_base_dir", lambda: storage)
    monkeypatch.setattr(unirig_adapter, "get_storage_base_dir", lambda: storage)

    workspace = storage / "models" / "meshes" / "hero_upload-123"
    workspace.mkdir(parents=True)
    master = workspace / "master"
    master.mkdir()
    source_glb = master / "source.glb"
    source_glb.write_bytes(b"glb-source-content")

    job_output_dir = workspace / "rigging" / "rig-job-456"

    adapter = UniRigAdapter.__new__(UniRigAdapter)
    adapter.model_id = "unirig_auto_rig"
    adapter.gpu_id = None
    adapter.device = "cuda:0"
    adapter.status = ModelStatus.LOADED
    adapter.mesh_processor = type("MeshProcessor", (), {
        "load_mesh": lambda self, p: None,
        "get_mesh_stats": lambda self, m: {"vertex_count": 100, "face_count": 50},
    })()
    adapter._estimate_bone_count = lambda p: 25

    fake_engine = type("FakeEngine", (), {})()
    adapter.inference_engine = fake_engine

    import torch
    if torch is None:
        monkeypatch.setattr("adapters.unirig_adapter.torch", SimpleNamespace(cuda=SimpleNamespace(is_available=lambda: True)))
    else:
        monkeypatch.setattr("adapters.unirig_adapter.torch.cuda.is_available", lambda: True)

    def fake_fbx_to_glb(fbx_path):
        glb_path = Path(fbx_path).with_suffix(".glb")
        glb_path.write_bytes(b"converted-glb-bytes")
        return str(glb_path)

    monkeypatch.setattr("adapters.unirig_adapter.fbx_to_glb", fake_fbx_to_glb)

    def fake_full_pipeline(mesh_path, out_dir, out_file):
        fbx_p = Path(out_dir) / "rigged.fbx"
        fbx_p.write_bytes(b"Kaydara FBX binary data")
        return str(fbx_p)

    fake_engine.full_pipeline = fake_full_pipeline

    result = adapter._process_request({
        "mesh_path": str(source_glb),
        "output_dir": str(job_output_dir),
        "rig_mode": "full",
    })

    assert result["success"] is True
    assert Path(result["output_mesh_path"]) == job_output_dir / "rigged.glb"
    assert Path(result["output_fbx_path"]) == job_output_dir / "rigged.fbx"
    shared_rigged_dir = storage / "models" / "rigged"
    assert not shared_rigged_dir.exists()


@pytest.mark.anyio
async def test_generated_asset_auto_rig_preserves_native_fbx(monkeypatch, tmp_path):
    """RIG-11: Parent generated auto-rig child workflow preserves native FBX alongside GLB preview."""
    if not hasattr(sys.modules.get("core.scheduler.multiprocess_scheduler"), "get_storage_base_dir"):
        for k in list(sys.modules.keys()):
            if k.startswith("core.scheduler"):
                del sys.modules[k]
        import core.scheduler.multiprocess_scheduler
    from core.scheduler import multiprocess_scheduler
    from core.scheduler.multiprocess_scheduler import MultiprocessModelScheduler
    from core.utils import file_utils
    import postprocess.pipeline as post_pipeline

    storage = tmp_path / "storage"
    monkeypatch.setattr(file_utils, "get_storage_base_dir", lambda: storage)
    monkeypatch.setattr(multiprocess_scheduler, "get_storage_base_dir", lambda: storage)
    monkeypatch.setattr(post_pipeline, "_storage_root", lambda: storage / "models" / "meshes")

    asset_root = storage / "models" / "meshes" / "knight_gen-1"
    (asset_root / "master").mkdir(parents=True)
    (asset_root / "game_ready").mkdir(parents=True)
    master_source = asset_root / "master" / "source.glb"
    master_source.write_bytes(b"master-glb")
    game_ready = asset_root / "game_ready" / "knight.glb"
    game_ready.write_bytes(b"game-ready-glb")

    child_dir = asset_root / "rigging" / "child-job-1"
    child_dir.mkdir(parents=True)
    child_glb = child_dir / "temp_rigged.glb"
    child_glb.write_bytes(b"child-rigged-glb")
    child_fbx = child_dir / "temp_rigged.fbx"
    child_fbx.write_bytes(b"child-native-fbx")

    base_result = {
        "asset_root": str(asset_root),
        "output_mesh_path": str(game_ready),
        "source_model_path": str(master_source),
    }

    scheduler = MultiprocessModelScheduler.__new__(MultiprocessModelScheduler)
    completed_jobs = {}

    class FakeQueue:
        async def get_job(self, jid):
            if jid == "child-job-1":
                return {
                    "status": "completed",
                    "result": {
                        "output_mesh_path": str(child_glb),
                        "output_fbx_path": str(child_fbx),
                        "bone_count": 48,
                    },
                }
            return {"status": "processing"}

        async def update_job_progress(self, *args, **kwargs):
            pass

        async def complete_job(self, jid, result):
            completed_jobs[jid] = result

        async def cancel_job(self, jid):
            pass

    scheduler.job_queue = FakeQueue()

    await scheduler._watch_auto_rig("parent-job-1", "child-job-1", base_result)

    final = completed_jobs["parent-job-1"]
    expected_fbx = asset_root / "rigging" / "child-job-1" / "rigged.fbx"
    expected_glb = asset_root / "rigging" / "child-job-1" / "rigged.glb"

    assert final["output_fbx_path"] == str(expected_fbx)
    assert final["rigging"]["fbx_path"] == str(expected_fbx)
    assert final["rigging"]["fbx_status"] == "ready"
    assert final["artifacts"]["rigged_fbx"]["path"] == str(expected_fbx)
    assert expected_fbx.is_file()
    assert expected_glb.is_file()

    manifest_file = asset_root / "metadata" / "jobs" / "parent-job-1.json"
    assert manifest_file.is_file()
    manifest_data = json.loads(manifest_file.read_text(encoding="utf-8"))
    assert "fbx" in manifest_data["artifacts"]
    assert "rigged" in manifest_data["artifacts"]


@pytest.mark.anyio
async def test_unified_download_resolver_direct_and_generated(monkeypatch, tmp_path):
    """RIG-12: Unified artifact manifest resolver for direct and generated rig jobs."""
    from api.routers import system
    from api.routers.system import download_job_result
    import api.dependencies as api_deps

    storage = tmp_path / "storage"
    monkeypatch.setattr(system, "get_storage_base_dir", lambda: storage)

    models_dir = storage / "models" / "meshes"
    models_dir.mkdir(parents=True)

    # 1. Direct Rig Job
    direct_root = models_dir / "hero_direct-1"
    (direct_root / "master").mkdir(parents=True)
    (direct_root / "rigging" / "direct-1").mkdir(parents=True)
    (direct_root / "master" / "source.glb").write_bytes(b"master-bytes")
    direct_glb = direct_root / "rigging" / "direct-1" / "rigged.glb"
    direct_glb.write_bytes(b"rigged-glb-bytes")
    direct_fbx = direct_root / "rigging" / "direct-1" / "rigged.fbx"
    direct_fbx.write_bytes(b"rigged-fbx-bytes")

    direct_job_status = {
        "status": "completed",
        "result": {
            "asset_root": str(direct_root),
            "output_mesh_path": str(direct_glb),
            "output_fbx_path": str(direct_fbx),
            "artifacts": {
                "rigged": {"path": str(direct_glb), "format": "glb"},
                "rigged_fbx": {"path": str(direct_fbx), "format": "fbx"},
            },
            "rigging": {"artifact_path": str(direct_glb), "fbx_path": str(direct_fbx)},
        },
    }

    # 2. Generated Asset with Auto-rig
    gen_root = models_dir / "hero_gen-1"
    (gen_root / "master").mkdir(parents=True)
    (gen_root / "game_ready").mkdir(parents=True)
    (gen_root / "rigging" / "child-1").mkdir(parents=True)
    (gen_root / "master" / "source.glb").write_bytes(b"master-bytes")
    gen_game_ready = gen_root / "game_ready" / "hero_gen-1.glb"
    gen_game_ready.write_bytes(b"game-ready-bytes")
    gen_rigged_glb = gen_root / "rigging" / "child-1" / "rigged.glb"
    gen_rigged_glb.write_bytes(b"child-rigged-glb-bytes")
    gen_rigged_fbx = gen_root / "rigging" / "child-1" / "rigged.fbx"
    gen_rigged_fbx.write_bytes(b"child-rigged-fbx-bytes")

    gen_job_status = {
        "status": "completed",
        "result": {
            "asset_root": str(gen_root),
            "output_mesh_path": str(gen_game_ready),
            "output_fbx_path": str(gen_rigged_fbx),
            "artifacts": {
                "rigged": {"path": str(gen_rigged_glb), "format": "glb"},
                "rigged_fbx": {"path": str(gen_rigged_fbx), "format": "fbx"},
            },
            "rigging": {"artifact_path": str(gen_rigged_glb), "fbx_path": str(gen_rigged_fbx)},
        },
    }

    # 3. Generated Asset WITHOUT Rigging
    unrigged_root = models_dir / "hero_unrigged-1"
    (unrigged_root / "master").mkdir(parents=True)
    (unrigged_root / "game_ready").mkdir(parents=True)
    (unrigged_root / "master" / "source.glb").write_bytes(b"master-bytes")
    unrigged_glb = unrigged_root / "game_ready" / "hero_unrigged-1.glb"
    unrigged_glb.write_bytes(b"game-ready-bytes")

    unrigged_job_status = {
        "status": "completed",
        "result": {
            "asset_root": str(unrigged_root),
            "output_mesh_path": str(unrigged_glb),
        },
    }

    jobs = {
        "direct-1": direct_job_status,
        "gen-1": gen_job_status,
        "unrigged-1": unrigged_job_status,
    }

    async def fake_get_job_status(jid):
        return jobs.get(jid)

    scheduler = SimpleNamespace(get_job_status=fake_get_job_status)

    async def fake_get_scheduler(r):
        return scheduler

    async def fake_get_user(*a, **k):
        return None

    monkeypatch.setattr(system, "get_scheduler", fake_get_scheduler)
    monkeypatch.setattr(api_deps, "get_current_user_optional", fake_get_user)

    request = SimpleNamespace(headers=SimpleNamespace(get=lambda *_: None))

    # Test Direct Rig Job downloads
    resp_glb = await download_job_result("direct-1", request, artifact_format="glb")
    assert resp_glb.path == str(direct_glb)
    resp_rigged = await download_job_result("direct-1", request, artifact_format="rigged")
    assert resp_rigged.path == str(direct_glb)
    resp_fbx = await download_job_result("direct-1", request, artifact_format="fbx")
    assert resp_fbx.path == str(direct_fbx)

    # Test Generated Rig Job downloads
    resp_gen_glb = await download_job_result("gen-1", request, artifact_format="glb")
    assert resp_gen_glb.path == str(gen_game_ready)
    resp_gen_rigged = await download_job_result("gen-1", request, artifact_format="rigged")
    assert resp_gen_rigged.path == str(gen_rigged_glb)
    resp_gen_fbx = await download_job_result("gen-1", request, artifact_format="fbx")
    assert resp_gen_fbx.path == str(gen_rigged_fbx)

    # Unrigged job requesting FBX must fail with 422
    with pytest.raises(HTTPException) as exc:
        await download_job_result("unrigged-1", request, artifact_format="fbx")
    assert exc.value.status_code == 422
    assert "requires rigging" in exc.value.detail

    # Unknown format must fail with 400
    with pytest.raises(HTTPException) as exc:
        await download_job_result("gen-1", request, artifact_format="unknown_format")
    assert exc.value.status_code == 400


@pytest.mark.anyio
async def test_asset_08_resolve_input_reference_preserves_query_params(monkeypatch, tmp_path):
    """ASSET-08: Preserve artifact_format query param in system download and job resolvers."""
    from api.routers import file_upload

    storage = tmp_path / "storage"
    monkeypatch.setattr(file_upload, "get_storage_base_dir", lambda: storage)

    workspace = storage / "models" / "meshes" / "warrior_job-100"
    (workspace / "metadata").mkdir(parents=True)
    (workspace / "master").mkdir(parents=True)
    (workspace / "game_ready").mkdir(parents=True)
    (workspace / "rigging" / "job-100").mkdir(parents=True)

    master = workspace / "master" / "source.glb"
    master.write_bytes(b"master-source")
    game_ready = workspace / "game_ready" / "warrior_job-100.glb"
    game_ready.write_bytes(b"game-ready")
    rigged_glb = workspace / "rigging" / "job-100" / "rigged.glb"
    rigged_glb.write_bytes(b"rigged-glb")
    rigged_fbx = workspace / "rigging" / "job-100" / "rigged.fbx"
    rigged_fbx.write_bytes(b"rigged-fbx")

    (workspace / "metadata" / "job.json").write_text(
        json.dumps({"job_id": "job-100", "asset_id": "warrior"}), encoding="utf-8"
    )

    class Store:
        async def get_file_metadata(self, fid):
            return {"file_id": fid, "file_path": str(game_ready), "is_available": True}

    store = Store()

    res_master = await file_upload.resolve_input_reference_async(
        "/api/v1/system/jobs/job-100/download?artifact_format=master", store
    )
    assert res_master == str(master)

    res_rigged = await file_upload.resolve_input_reference_async(
        "/api/v1/system/jobs/job-100/download?artifact_format=rigged", store
    )
    assert res_rigged == str(rigged_glb)

    res_fbx = await file_upload.resolve_input_reference_async(
        "/api/v1/system/jobs/job-100/download?artifact_format=fbx", store
    )
    assert res_fbx == str(rigged_fbx)

    res_glb = await file_upload.resolve_input_reference_async(
        "/api/v1/system/jobs/job-100/download?artifact_format=glb", store
    )
    assert res_glb == str(game_ready)


def test_asset_09_manual_mesh_tools_preserve_immutable_master_and_source_format(monkeypatch, tmp_path):
    """ASSET-09: Separate raw generation output from manual mesh-tool lineage."""
    import postprocess.pipeline as post_pipeline
    from postprocess.pipeline import persist_manual_mesh_result, _sha256_file
    from core.utils import file_utils

    storage = tmp_path / "storage"
    monkeypatch.setattr(post_pipeline, "_storage_root", lambda: storage / "models" / "meshes")
    monkeypatch.setattr(file_utils, "get_storage_base_dir", lambda: storage)

    input_dir = tmp_path / "inputs"
    input_dir.mkdir()
    source_obj = input_dir / "character.obj"
    obj_content = b"# OBJ file\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n"
    source_obj.write_bytes(obj_content)
    source_hash = _sha256_file(source_obj)

    tool_output_obj = tmp_path / "retopo_output.obj"
    retopo_content = b"# Retopo OBJ\nv 0 0 0\nv 0.5 0 0\nv 0 0.5 0\nf 1 2 3\n"
    tool_output_obj.write_bytes(retopo_content)

    final_result = persist_manual_mesh_result(
        job_id="tool-job-1",
        result={"output_mesh_path": str(tool_output_obj)},
        job_inputs={"mesh_path": str(source_obj)},
        job_metadata={"source_sha256": source_hash},
    )

    asset_root = Path(final_result["asset_root"])
    master_source = asset_root / "master" / "source.obj"
    assert master_source.is_file(), "Original format .obj must be preserved in master, not renamed to .glb"
    assert master_source.read_bytes() == obj_content

    derivative = Path(final_result["output_mesh_path"])
    assert derivative.is_file()
    assert derivative.read_bytes() == retopo_content
    assert derivative.suffix.lower() == ".obj"
    assert "derived" in derivative.parts

    # Source must remain immutable
    assert source_obj.read_bytes() == obj_content
    assert _sha256_file(source_obj) == source_hash


@pytest.mark.anyio
async def test_auto_rig_download_returns_rigged_glb_even_with_game_ready(monkeypatch, tmp_path):
    """RIG-13: Direct auto_rig jobs download rigged.glb rather than unrigged game_ready mesh."""
    from api.routers import system
    from api.routers.system import download_job_result
    import api.dependencies as api_deps

    storage = tmp_path / "storage"
    monkeypatch.setattr(system, "get_storage_base_dir", lambda: storage)

    workspace = storage / "models" / "meshes" / "hero_rig_job-1"
    (workspace / "master").mkdir(parents=True)
    (workspace / "game_ready").mkdir(parents=True)
    (workspace / "rigging" / "rig-999").mkdir(parents=True)

    unrigged_game_ready = workspace / "game_ready" / "hero_rig_job-1.glb"
    unrigged_game_ready.write_bytes(b"unrigged-mesh-bytes")

    rigged_glb = workspace / "rigging" / "rig-999" / "rigged.glb"
    rigged_glb.write_bytes(b"rigged-glb-bytes")

    rigged_fbx = workspace / "rigging" / "rig-999" / "rigged.fbx"
    rigged_fbx.write_bytes(b"rigged-fbx-bytes")

    auto_rig_job_status = {
        "status": "completed",
        "feature": "auto_rig",
        "result": {
            "asset_root": str(workspace),
            "output_mesh_path": str(rigged_glb),
            "output_fbx_path": str(rigged_fbx),
            "artifacts": {
                "rigged": {"path": str(rigged_glb), "format": "glb"},
                "rigged_fbx": {"path": str(rigged_fbx), "format": "fbx"},
            },
            "rigging": {"artifact_path": str(rigged_glb), "fbx_path": str(rigged_fbx)},
        },
    }

    async def fake_get_job_status(jid):
        return auto_rig_job_status

    scheduler = SimpleNamespace(get_job_status=fake_get_job_status)

    async def fake_get_scheduler(r):
        return scheduler

    async def fake_get_user(*a, **k):
        return None

    monkeypatch.setattr(system, "get_scheduler", fake_get_scheduler)
    monkeypatch.setattr(api_deps, "get_current_user_optional", fake_get_user)

    request = SimpleNamespace(headers=SimpleNamespace(get=lambda *_: None))

    # Default download (artifact_format=None -> glb) must return rigged.glb, NOT unrigged game_ready
    resp_default = await download_job_result("rig-999", request, artifact_format=None)
    assert resp_default.path == str(rigged_glb)

    # Explicit glb must return rigged.glb
    resp_glb = await download_job_result("rig-999", request, artifact_format="glb")
    assert resp_glb.path == str(rigged_glb)

    # Explicit rigged must return rigged.glb
    resp_rigged = await download_job_result("rig-999", request, artifact_format="rigged")
    assert resp_rigged.path == str(rigged_glb)

    # Explicit fbx and rigged_fbx must return rigged.fbx
    resp_fbx = await download_job_result("rig-999", request, artifact_format="fbx")
    assert resp_fbx.path == str(rigged_fbx)

    resp_rigged_fbx = await download_job_result("rig-999", request, artifact_format="rigged_fbx")
    assert resp_rigged_fbx.path == str(rigged_fbx)


def test_auto_rig_request_supports_both_fbx_and_glb():
    """RIG-14: AutoRigRequest accepts both fbx and glb formats."""
    from api.routers.auto_rigging import AutoRigRequest

    req_fbx = AutoRigRequest(mesh_path="/test.glb", output_format="fbx")
    assert req_fbx.output_format == "fbx"

    req_glb = AutoRigRequest(mesh_path="/test.glb", output_format="glb")
    assert req_glb.output_format == "glb"

    req_upper = AutoRigRequest(mesh_path="/test.glb", output_format="GLB")
    assert req_upper.output_format == "glb"