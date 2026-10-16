import hashlib
import json
import sys
import types
import asyncio
import base64
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from starlette.datastructures import UploadFile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# Import only the routers under test; api/__init__.py otherwise starts the full
# model runtime and requires the optional CUDA/PyTorch stack during collection.
backend_root = Path(__file__).resolve().parents[1]
api_package = types.ModuleType("api")
api_package.__path__ = [str(backend_root / "api")]
sys.modules.setdefault("api", api_package)
router_package = types.ModuleType("api.routers")
router_package.__path__ = [str(backend_root / "api" / "routers")]
sys.modules.setdefault("api.routers", router_package)
dependencies = types.ModuleType("api.dependencies")
dependencies.get_file_store = lambda *args, **kwargs: None
dependencies.get_current_user_or_none = lambda *args, **kwargs: None
dependencies.get_scheduler = lambda *args, **kwargs: None
sys.modules.setdefault("api.dependencies", dependencies)

scheduler_package = types.ModuleType("core.scheduler")
scheduler_package.__path__ = [str(backend_root / "core" / "scheduler")]
sys.modules.setdefault("core.scheduler", scheduler_package)
job_queue = types.ModuleType("core.scheduler.job_queue")
class JobRequest:
    def __init__(self, **values):
        self.__dict__.update(values)


job_queue.JobRequest = JobRequest
sys.modules.setdefault("core.scheduler.job_queue", job_queue)
multiprocess_scheduler = types.ModuleType("core.scheduler.multiprocess_scheduler")
multiprocess_scheduler.MultiprocessModelScheduler = type("MultiprocessModelScheduler", (), {})
sys.modules.setdefault("core.scheduler.multiprocess_scheduler", multiprocess_scheduler)


class MetadataStore:
    def __init__(self, result=True):
        self.result = result
        self.values = {}

    async def store_file_metadata(self, file_id, metadata):
        if self.result:
            self.values[file_id] = metadata
        return self.result

    async def get_file_metadata(self, file_id):
        return self.values.get(file_id)

    async def delete_file_metadata(self, file_id):
        self.values.pop(file_id, None)
        return True


def _configure_storage(monkeypatch, tmp_path):
    from api.routers import file_upload

    storage = tmp_path / "storage"
    storage.mkdir()
    monkeypatch.setattr(file_upload, "get_storage_base_dir", lambda: storage)
    monkeypatch.setattr(file_upload, "UPLOAD_BASE_DIR", storage / "uploads")
    monkeypatch.setattr(file_upload, "_THUMBNAIL_DIR", storage / "uploads" / "thumbnails")
    return file_upload, storage


@pytest.mark.asyncio
async def test_mesh_upload_is_canonical_byte_preserving_and_restart_resolvable(monkeypatch, tmp_path):
    from api.routers import file_upload

    module, storage = _configure_storage(monkeypatch, tmp_path)
    payload = b"# original source bytes\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n"
    monkeypatch.setattr(module, "validate_mesh_file", lambda path: {"valid": True, "vertex_count": 3})
    store = MetadataStore()
    result = await module.upload_file_with_validation(
        UploadFile(filename="same.obj", file=__import__("io").BytesIO(payload)),
        "mesh",
        module.SUPPORTED_MESH_FORMATS,
        store,
    )

    source = Path(result["file_path"])
    assert source == storage / "models" / "meshes" / f"upload_{result['file_id']}" / "master" / "source.obj"
    assert source.read_bytes() == payload
    manifest = source.parents[1] / "metadata" / "asset.json"
    data = json.loads(manifest.read_text())
    assert data["sha256"] == hashlib.sha256(payload).hexdigest()
    assert data["file_size_bytes"] == len(payload)
    assert data["original_format"] == ".obj"

    restarted_metadata = await module.get_file_metadata_impl(None, result["file_id"])
    assert restarted_metadata["file_path"] == str(source)
    assert await module.resolve_file_id_async(result["file_id"], None) == str(source)
    response = module.FileUploadResponse(**result)
    assert "file_path" not in response.model_dump()

    duplicate = await module.upload_file_with_validation(
        UploadFile(filename="same.obj", file=__import__("io").BytesIO(payload)),
        "mesh",
        module.SUPPORTED_MESH_FORMATS,
        store,
    )
    assert duplicate["file_id"] != result["file_id"]


@pytest.mark.asyncio
async def test_upload_metadata_failure_removes_source_and_manifest(monkeypatch, tmp_path):
    from api.routers import file_upload

    module, storage = _configure_storage(monkeypatch, tmp_path)
    monkeypatch.setattr(module, "validate_mesh_file", lambda path: {"valid": True})
    with pytest.raises(HTTPException) as error:
        await module.upload_file_with_validation(
            UploadFile(filename="failed.obj", file=__import__("io").BytesIO(b"mesh")),
            "mesh",
            module.SUPPORTED_MESH_FORMATS,
            MetadataStore(result=False),
        )
    assert error.value.status_code == 503
    assert not list((storage / "models" / "meshes").rglob("source.obj"))
    assert not list((storage / "models" / "meshes").rglob("asset.json"))


@pytest.mark.asyncio
async def test_delete_removes_only_matching_mesh_source_manifest_and_thumbnail(monkeypatch, tmp_path):
    from api.routers import file_upload

    module, storage = _configure_storage(monkeypatch, tmp_path)
    monkeypatch.setattr(module, "validate_mesh_file", lambda path: {"valid": True})
    store = MetadataStore()
    result = await module.upload_file_with_validation(
        UploadFile(filename="delete.obj", file=__import__("io").BytesIO(b"mesh")),
        "mesh",
        module.SUPPORTED_MESH_FORMATS,
        store,
    )
    source = Path(result["file_path"])
    workspace = source.parents[1]
    thumbnail = module._THUMBNAIL_DIR / f"{result['file_id']}.png"
    thumbnail.parent.mkdir(parents=True, exist_ok=True)
    thumbnail.write_bytes(b"thumbnail")
    unrelated = storage / "models" / "meshes" / "other" / "master" / "source.obj"
    unrelated.parent.mkdir(parents=True)
    unrelated.write_bytes(b"keep")

    await module.delete_file(result["file_id"], store)
    assert not source.exists()
    assert not (workspace / "metadata" / "asset.json").exists()
    assert not thumbnail.exists()
    assert unrelated.read_bytes() == b"keep"
    assert "already deleted" in (await module.delete_file(result["file_id"], store))["message"]


@pytest.mark.asyncio
async def test_segmentation_base64_temp_input_is_tracked_and_cleaned_on_cancellation(monkeypatch):
    from api.routers import mesh_segmentation

    monkeypatch.setattr(mesh_segmentation, "validate_mesh_file", lambda path: {"valid": True})
    registered = []
    unregistered = []

    class Scheduler:
        def validate_model_preference(self, *args):
            return True

        def get_available_models(self, *args):
            return {"mesh_segmentation": ["test"]}

        def _register_managed_input_dir(self, path):
            registered.append(Path(path))

        def _unregister_managed_input_dir(self, path):
            unregistered.append(Path(path))

        async def schedule_job(self, job_request):
            self.job_request = job_request
            raise asyncio.CancelledError()

    mesh_data = b"v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n"
    request = mesh_segmentation.MeshSegmentationRequest(
        mesh_base64=base64.b64encode(mesh_data).decode("ascii")
    )
    scheduler = Scheduler()
    with pytest.raises(asyncio.CancelledError):
        await mesh_segmentation.segment_mesh(request, scheduler, None, None)

    assert len(registered) == 1
    assert not registered[0].exists()
    assert unregistered == registered


@pytest.mark.asyncio
async def test_durable_file_metadata_ignores_configured_redis_ttl():
    from core.file_store import FileStore

    class Pipeline:
        def __init__(self):
            self.set_calls = []

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        def set(self, *args, **kwargs):
            self.set_calls.append(kwargs)

        def zadd(self, *args, **kwargs):
            pass

        async def execute(self):
            return []

    class Redis:
        def __init__(self):
            self.pipelines = []

        def pipeline(self):
            pipeline = Pipeline()
            self.pipelines.append(pipeline)
            return pipeline

    redis = Redis()
    store = FileStore(redis, default_ttl_seconds=60)
    await store.store_file_metadata("durable-id", {"file_type": "mesh", "durable": True})
    await store.store_file_metadata("temporary-id", {"file_type": "mesh"})
    assert "ex" not in redis.pipelines[0].set_calls[0]
    assert redis.pipelines[1].set_calls[0]["ex"] == 60


@pytest.mark.asyncio
async def test_upload_mesh_validation_runs_in_threadpool(monkeypatch, tmp_path):
    import threading
    from api.routers import file_upload

    module, _ = _configure_storage(monkeypatch, tmp_path)
    event_thread = threading.get_ident()
    parser_threads = []
    monkeypatch.setattr(
        module,
        "validate_mesh_file",
        lambda path: parser_threads.append(threading.get_ident()) or {"valid": True},
    )
    await module.upload_file_with_validation(
        UploadFile(filename="thread.obj", file=__import__("io").BytesIO(b"mesh")),
        "mesh",
        module.SUPPORTED_MESH_FORMATS,
        MetadataStore(),
    )
    assert parser_threads and parser_threads[0] != event_thread


@pytest.mark.asyncio
async def test_job_download_reference_honors_artifact_format_without_globbing(monkeypatch, tmp_path):
    from api.routers import file_upload

    module, storage = _configure_storage(monkeypatch, tmp_path)
    workspace = storage / "models" / "meshes" / "dragon_job-123"
    (workspace / "metadata").mkdir(parents=True)
    (workspace / "master").mkdir()
    (workspace / "game_ready").mkdir()
    (workspace / "metadata" / "job.json").write_text(
        json.dumps({"job_id": "job-123", "asset_id": "dragon"})
    )
    master = workspace / "master" / "source.glb"
    game_ready = workspace / "game_ready" / "dragon.glb"
    master.write_bytes(b"master")
    game_ready.write_bytes(b"game-ready")
    store = MetadataStore()
    store.values["job-123"] = {"file_id": "job-123", "file_path": str(game_ready), "is_available": True}

    assert await module.resolve_input_reference_async(
        "/api/v1/system/jobs/job-123/download?artifact_format=master", store
    ) == str(master)
    assert await module.resolve_input_reference_async(
        "https://example.test/api/v1/system/jobs/job-123/download?artifact_format=glb", store
    ) == str(game_ready)
    assert await module.resolve_input_reference_async(
        "/api/v1/system/jobs/job-123/download?artifact_format=unknown", store
    ) is None


def test_gltf_classification_and_external_dependencies_are_explicitly_rejected(tmp_path):
    from core.utils.file_utils import get_file_type_from_extension, validate_mesh_file

    assert get_file_type_from_extension("model.gltf") == "mesh"
    gltf = tmp_path / "external.gltf"
    gltf.write_text(json.dumps({"asset": {"version": "2.0"}, "buffers": [{"uri": "../outside.bin"}]}))
    result = validate_mesh_file(str(gltf))
    assert result["valid"] is False
    assert "External GLTF dependencies are not supported" in result["error"]


def test_gltf_accepts_embedded_single_file_resources(monkeypatch, tmp_path):
    import trimesh
    from core.utils.file_utils import validate_mesh_file

    mesh = trimesh.Trimesh(
        vertices=[[0, 0, 0], [1, 0, 0], [0, 1, 0]],
        faces=[[0, 1, 2]],
        process=False,
    )
    monkeypatch.setattr(trimesh, "load", lambda *args, **kwargs: mesh)
    gltf = tmp_path / "embedded.gltf"
    gltf.write_text(json.dumps({
        "asset": {"version": "2.0"},
        "buffers": [{"uri": "data:application/octet-stream;base64,AAAA", "byteLength": 3}],
        "bufferViews": [{"buffer": 0, "byteLength": 3}],
        "images": [{"bufferView": 0, "mimeType": "image/png"}],
    }))

    assert validate_mesh_file(str(gltf))["valid"] is True


@pytest.mark.parametrize("resource", [
    {"buffers": [{"byteLength": 3}]},
    {"buffers": [{"uri": "data:application/octet-stream;base64,", "byteLength": 0}]},
    {"images": [{"uri": "../outside.png"}]},
    {"images": [{"bufferView": 4}], "bufferViews": []},
])
def test_gltf_rejects_missing_or_external_dependencies(tmp_path, resource):
    from core.utils.file_utils import validate_mesh_file

    gltf = tmp_path / "incomplete.gltf"
    gltf.write_text(json.dumps({"asset": {"version": "2.0"}, **resource}))
    result = validate_mesh_file(str(gltf))
    assert result["valid"] is False
    assert "GLTF" in result["error"]


@pytest.mark.asyncio
async def test_segmentation_rejects_oversized_base64_before_decode(monkeypatch):
    from api.routers import mesh_segmentation
    from core.utils import file_utils

    monkeypatch.setattr(mesh_segmentation, "MAX_MESH_BASE64_BYTES", 3)
    monkeypatch.setattr(
        file_utils.base64,
        "b64decode",
        lambda *args, **kwargs: pytest.fail("oversized data reached base64 decoder"),
    )
    scheduler = SimpleNamespace(
        validate_model_preference=lambda *args: True,
        get_available_models=lambda *args: {"mesh_segmentation": ["test"]},
    )
    request = mesh_segmentation.MeshSegmentationRequest(mesh_base64="A" * 8)
    with pytest.raises(HTTPException) as error:
        await mesh_segmentation.segment_mesh(request, scheduler, None, None)
    assert error.value.status_code == 400


def test_base64_helper_accepts_exact_decoded_limit_and_rejects_next_byte_before_decode(monkeypatch):
    from core.utils import file_utils

    exact = base64.b64encode(b"1234").decode("ascii")
    assert file_utils.validate_base64_data(exact, max_bytes=4) == (True, None, b"1234")

    oversized = base64.b64encode(b"12345").decode("ascii")
    monkeypatch.setattr(
        file_utils.base64,
        "b64decode",
        lambda *args, **kwargs: pytest.fail("over-limit data reached base64 decoder"),
    )
    assert file_utils.validate_base64_data(oversized, max_bytes=4) == (False, None, None)


def test_base64_helper_rejects_malformed_payload():
    from core.utils.file_utils import validate_base64_data

    assert validate_base64_data("not-base64!", max_bytes=32) == (False, None, None)


@pytest.mark.asyncio
async def test_upload_manifests_restore_list_and_count_after_restart(monkeypatch, tmp_path):
    from api.routers import file_upload

    module, _ = _configure_storage(monkeypatch, tmp_path)
    monkeypatch.setattr(module, "validate_mesh_file", lambda _path: {"valid": True})
    result = await module.upload_file_with_validation(
        UploadFile(filename="listed.obj", file=__import__("io").BytesIO(b"mesh")),
        "mesh",
        module.SUPPORTED_MESH_FORMATS,
        MetadataStore(),
    )

    restored = await module.list_file_metadata_impl(None)
    assert [item["file_id"] for item in restored] == [result["file_id"]]
    assert await module.count_files_impl(None, "mesh") == 1


@pytest.mark.asyncio
async def test_image_manifest_restores_source_and_listing_after_restart(monkeypatch, tmp_path):
    import io
    from PIL import Image
    from api.routers import file_upload

    module, storage = _configure_storage(monkeypatch, tmp_path)
    image_bytes = io.BytesIO()
    Image.new("RGB", (2, 2), (40, 80, 120)).save(image_bytes, format="PNG")
    payload = image_bytes.getvalue()
    result = await module.upload_file_with_validation(
        UploadFile(filename="reference.png", file=io.BytesIO(payload)),
        "image",
        module.SUPPORTED_IMAGE_FORMATS,
        MetadataStore(),
    )
    source = Path(result["file_path"])

    assert source.read_bytes() == payload
    assert await module.resolve_file_id_async(result["file_id"], None) == str(source)
    assert [item["file_id"] for item in await module.list_file_metadata_impl(None)] == [result["file_id"]]
    assert await module.count_files_impl(None, "image") == 1
    assert source.is_relative_to(storage)


@pytest.mark.asyncio
async def test_manifest_cannot_redirect_an_upload_id_to_another_storage_file(monkeypatch, tmp_path):
    from api.routers import file_upload

    module, storage = _configure_storage(monkeypatch, tmp_path)
    monkeypatch.setattr(module, "validate_mesh_file", lambda _path: {"valid": True})
    result = await module.upload_file_with_validation(
        UploadFile(filename="identity.obj", file=__import__("io").BytesIO(b"source")),
        "mesh",
        module.SUPPORTED_MESH_FORMATS,
        MetadataStore(),
    )
    source = Path(result["file_path"])
    unrelated = storage / "models" / "meshes" / "unrelated" / "master" / "source.obj"
    unrelated.parent.mkdir(parents=True)
    unrelated.write_bytes(b"source")
    manifest_path = source.parents[1] / "metadata" / "asset.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["source_path"] = unrelated.relative_to(storage).as_posix()
    manifest_path.write_text(json.dumps(manifest))

    assert await module.get_file_metadata_impl(None, result["file_id"]) is None
    assert unrelated.read_bytes() == b"source"


@pytest.mark.asyncio
async def test_mesh_validation_concurrency_is_bounded(monkeypatch, tmp_path):
    import threading
    from api.routers import file_upload

    module, _ = _configure_storage(monkeypatch, tmp_path)
    active = 0
    peak = 0
    lock = threading.Lock()

    def slow_validator(_path):
        nonlocal active, peak
        with lock:
            active += 1
            peak = max(peak, active)
        threading.Event().wait(0.03)
        with lock:
            active -= 1
        return {"valid": True}

    monkeypatch.setattr(module, "validate_mesh_file", slow_validator)
    await asyncio.gather(*(
        module.upload_file_with_validation(
            UploadFile(filename=f"parallel-{index}.obj", file=__import__("io").BytesIO(b"mesh")),
            "mesh",
            module.SUPPORTED_MESH_FORMATS,
            MetadataStore(),
        )
        for index in range(5)
    ))
    assert 1 < peak <= module.MESH_VALIDATION_CONCURRENCY


@pytest.mark.asyncio
async def test_cancelled_mesh_validation_waits_for_worker_then_cleans_upload(monkeypatch, tmp_path):
    import threading
    from api.routers import file_upload

    module, storage = _configure_storage(monkeypatch, tmp_path)
    started = threading.Event()
    release = threading.Event()

    def blocking_validator(_path):
        started.set()
        release.wait()
        return {"valid": True}

    monkeypatch.setattr(module, "validate_mesh_file", blocking_validator)
    upload = asyncio.create_task(module.upload_file_with_validation(
        UploadFile(filename="cancel.obj", file=__import__("io").BytesIO(b"mesh")),
        "mesh",
        module.SUPPORTED_MESH_FORMATS,
        MetadataStore(),
    ))
    assert await asyncio.to_thread(started.wait, 2)
    upload.cancel()
    release.set()
    with pytest.raises(asyncio.CancelledError):
        await upload

    assert not list((storage / "models" / "meshes").glob("upload_*/master/source.obj"))
    assert not list((storage / "models" / "meshes").glob("upload_*/metadata/asset.json"))


@pytest.mark.asyncio
async def test_upload_byte_limit_boundary_and_over_limit_cleanup(monkeypatch, tmp_path):
    from api.routers import file_upload

    module, storage = _configure_storage(monkeypatch, tmp_path)
    monkeypatch.setattr(module, "validate_mesh_file", lambda _path: {"valid": True})
    exact = b"x" * (1024 * 1024)
    await module.upload_file_with_validation(
        UploadFile(filename="limit.obj", file=__import__("io").BytesIO(exact)),
        "mesh",
        module.SUPPORTED_MESH_FORMATS,
        MetadataStore(),
        max_size_mb=1,
    )

    with pytest.raises(HTTPException) as error:
        await module.upload_file_with_validation(
            UploadFile(filename="over-limit.obj", file=__import__("io").BytesIO(exact + b"x")),
            "mesh",
            module.SUPPORTED_MESH_FORMATS,
            MetadataStore(),
            max_size_mb=1,
        )
    assert error.value.status_code == 400
    assert len(list((storage / "models" / "meshes").glob("upload_*/metadata/asset.json"))) == 1


def test_mesh_geometry_limits_and_non_finite_vertices(tmp_path, monkeypatch):
    import trimesh
    from core.utils.file_utils import validate_mesh_file

    source = tmp_path / "mesh.obj"
    source.write_text("mesh")
    triangle = trimesh.Trimesh(
        vertices=[[0, 0, 0], [1, 0, 0], [0, 1, 0]],
        faces=[[0, 1, 2]],
        process=False,
    )
    monkeypatch.setattr(trimesh, "load", lambda *_args, **_kwargs: triangle)
    assert validate_mesh_file(str(source), max_vertices=3, max_faces=1)["valid"] is True
    over_vertices = validate_mesh_file(str(source), max_vertices=2, max_faces=1)
    assert over_vertices["valid"] is False
    assert "exceeds maximum 2" in over_vertices["error"]

    triangle.vertices[0, 0] = float("nan")
    non_finite = validate_mesh_file(str(source), max_vertices=3, max_faces=1)
    assert non_finite["valid"] is False
    assert "non-finite" in non_finite["error"]


@pytest.mark.asyncio
async def test_gltf_upload_is_classified_and_validated_as_mesh(monkeypatch, tmp_path):
    from api.routers import file_upload

    module, _ = _configure_storage(monkeypatch, tmp_path)
    validations = []
    monkeypatch.setattr(
        module,
        "validate_mesh_file",
        lambda path: validations.append(path) or {"valid": True},
    )
    result = await module.upload_file_with_validation(
        UploadFile(filename="single-file.gltf", file=__import__("io").BytesIO(b"{}")),
        "mesh",
        module.SUPPORTED_MESH_FORMATS,
        MetadataStore(),
    )
    assert Path(result["file_path"]).suffix == ".gltf"
    assert validations == [result["file_path"]]


@pytest.mark.asyncio
async def test_delete_is_idempotent_with_single_worker_metadata(monkeypatch, tmp_path):
    from api.routers import file_upload

    class RetainingMetadataStore(MetadataStore):
        async def delete_file_metadata(self, file_id):
            self.values[file_id]["is_available"] = False
            return True

    module, _ = _configure_storage(monkeypatch, tmp_path)
    monkeypatch.setattr(module, "validate_mesh_file", lambda _path: {"valid": True})
    store = RetainingMetadataStore()
    result = await module.upload_file_with_validation(
        UploadFile(filename="twice.obj", file=__import__("io").BytesIO(b"mesh")),
        "mesh",
        module.SUPPORTED_MESH_FORMATS,
        store,
    )

    await module.delete_file(result["file_id"], store)
    second_delete = await module.delete_file(result["file_id"], store)
    assert "already deleted" in second_delete["message"]


def test_supported_mesh_extensions_classify_consistently():
    from core.utils.file_utils import SUPPORTED_MESH_FORMATS, get_file_type_from_extension

    assert {".glb", ".gltf", ".obj", ".fbx", ".ply", ".stl"} == set(SUPPORTED_MESH_FORMATS)
    for extension in SUPPORTED_MESH_FORMATS:
        assert get_file_type_from_extension(f"asset{extension}") == "mesh"
