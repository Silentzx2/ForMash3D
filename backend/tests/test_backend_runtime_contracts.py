import asyncio
import base64
import importlib
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from api.routers.auto_rigging import AutoRigRequest
from api.routers.mesh_editing import ImageMeshEditingRequest, TextMeshEditingRequest
from api.routers.mesh_generation import (
    ImageMeshPaintingRequest,
    ImageToTexturedMeshRequest,
    TextMeshPaintingRequest,
)
from api.routers.mesh_retopology import MeshRetopologyRequest
from api.routers.mesh_segmentation import MeshSegmentationRequest
from api.routers.mesh_uv_unwrapping import MeshUVUnwrappingRequest
from core.scheduler.resource_planner import ResourcePlanner
from core.utils import file_utils


@pytest.mark.parametrize(
    ("request_model", "payload"),
    [
        (AutoRigRequest, {}),
        (MeshRetopologyRequest, {}),
        (MeshUVUnwrappingRequest, {}),
        (MeshSegmentationRequest, {}),
        (
            TextMeshEditingRequest,
            {"source_prompt": "old", "target_prompt": "new"},
        ),
        (ImageMeshEditingRequest, {}),
        (TextMeshPaintingRequest, {"text_prompt": "paint"}),
        (ImageToTexturedMeshRequest, {}),
        (ImageMeshPaintingRequest, {}),
    ],
)
def test_file_backed_requests_reject_missing_inputs(request_model, payload):
    with pytest.raises(ValidationError):
        request_model(**payload)


def test_file_backed_requests_accept_one_declared_input():
    assert AutoRigRequest(mesh_path="mesh.glb").mesh_path == "mesh.glb"
    assert MeshRetopologyRequest(mesh_file_id="mesh-id").mesh_file_id == "mesh-id"
    assert MeshUVUnwrappingRequest(mesh_path="mesh.glb").mesh_path == "mesh.glb"
    assert MeshSegmentationRequest(mesh_base64="encoded").mesh_base64 == "encoded"
    assert TextMeshPaintingRequest(
        text_prompt="paint", mesh_path="mesh.glb"
    ).mesh_path == "mesh.glb"
    assert ImageToTexturedMeshRequest(image_path="image.png").image_path == "image.png"
    assert ImageMeshPaintingRequest(
        image_path="image.png", mesh_path="mesh.glb"
    ).mesh_path == "mesh.glb"


def test_smart_generation_dispatches_through_existing_route_contract(monkeypatch):
    module = importlib.import_module("api.routers.smart_generation")
    request = module.SmartGenerationRequest(
        image_path="image.png",
        intent="native",
    )
    resolved = {
        "preset": {},
        "model_id": "test-model",
        "feature": "image_to_raw_mesh",
        "version": 1,
        "candidate_order": [],
        "vram_budget_mb": 1,
    }
    queued = SimpleNamespace(
        job_id="job-1",
        status="queued",
        message="queued",
    )
    called = {}

    monkeypatch.setattr(module, "resolve_intent", lambda *args, **kwargs: resolved)

    async def fake_image_to_raw_mesh(payload, *, scheduler, file_store):
        called.update(
            payload=payload,
            scheduler=scheduler,
            file_store=file_store,
        )
        return queued

    monkeypatch.setattr(module, "image_to_raw_mesh", fake_image_to_raw_mesh)

    result = asyncio.run(
        module.smart_generation(
            request,
            scheduler="scheduler",
            file_store="file-store",
            settings="settings",
        )
    )

    assert result["job_id"] == "job-1"
    assert called["scheduler"] == "scheduler"
    assert called["file_store"] == "file-store"
    assert called["payload"].model_preference is None


def test_resource_planner_marks_non_cpu_models_impossible_without_gpu():
    monitor = SimpleNamespace(get_gpu_status=lambda: [])
    planner = ResourcePlanner(monitor, safety_margin_mb=256)

    assert planner.model_is_impossible(
        {"vram_requirement": 1024, "capabilities": {}}
    ) is True
    assert planner.model_is_impossible(
        {"vram_requirement": 0, "capabilities": {"cpu_only": True}}
    ) is False


def test_job_download_rejects_result_path_outside_storage(monkeypatch, tmp_path):
    module = importlib.import_module("api.routers.system")
    external_result = tmp_path / "not-an-asset.glb"
    external_result.write_bytes(b"not a real mesh")

    class Scheduler:
        async def get_job_status(self, job_id):
            return {
                "status": "completed",
                "result": {"output_mesh_path": str(external_result)},
            }

    async def fake_get_scheduler(request):
        return Scheduler()

    monkeypatch.setattr(module, "get_scheduler", fake_get_scheduler)

    with pytest.raises(module.HTTPException) as exc_info:
        asyncio.run(module.download_job_result("job-1", object()))

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "Invalid artifact path"


def test_base64_file_type_detection_does_not_use_racy_temp_name(monkeypatch, tmp_path):
    monkeypatch.setattr(
        file_utils.tempfile,
        "mktemp",
        lambda: pytest.fail("unsafe tempfile.mktemp must not be used"),
    )
    png_data = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
    )

    result = asyncio.run(
        file_utils.save_base64_file(
            base64.b64encode(png_data).decode("ascii"),
            "input-image",
            str(tmp_path),
            validate_content=False,
        )
    )

    assert result["file_path"].endswith(".png")
