"""Tests verifying BUG-002, BUG-012, BUG-013, BUG-018, and BUG-023."""
import asyncio
import base64
import io
import os
import shutil
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from PIL import Image
from pydantic import ValidationError

from adapters.hunyuan3d_paint_v21 import (
    Hunyuan3DPaintV21ImageMeshPaintingAdapter as Hunyuan3DPaintV21Adapter,
)
from adapters.paint3d_adapter import Paint3DAdapter
from api.routers.mesh_generation import (
    ImageMeshPaintingRequest,
    ImageToRawMeshRequest,
    ImageToTexturedMeshRequest,
    TextMeshPaintingRequest,
    _normalize_texture_resolution,
    image_to_raw_mesh,
    image_to_textured_mesh,
    process_file_input,
)
from core.scheduler.job_queue import JobRequest
from core.scheduler.multiprocess_scheduler import MultiprocessModelScheduler
from postprocess.pipeline import _resolve_reference_image, resolve_texture_preset


def _create_test_png(path: Path) -> Path:
    """Create a valid PNG image on disk."""
    img = Image.new("RGB", (64, 64), color="blue")
    img.save(path, format="PNG")
    return path


def _get_test_png_b64() -> str:
    """Return a valid base64 data URI for a PNG image."""
    buf = io.BytesIO()
    img = Image.new("RGB", (64, 64), color="red")
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


# ---------------------------------------------------------------------------
# BUG-002: Legacy nested texture resolution single pop & precedence
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_bug002_nested_texture_resolution_precedence(monkeypatch, tmp_path):
    monkeypatch.setenv("ALLOW_LOCAL_SERVER_PATH_INPUTS", "true")
    dummy_img = _create_test_png(tmp_path / "input.png")

    mock_scheduler = MagicMock()
    mock_scheduler.validate_model_preference.return_value = True
    captured_request = None

    async def fake_schedule(req):
        nonlocal captured_request
        captured_request = req
        return "job-test-123"

    mock_scheduler.schedule_job = AsyncMock(side_effect=fake_schedule)

    # 1. Request with resolution supplied ONLY in model_parameters as integer
    req1 = ImageToTexturedMeshRequest(
        image_path=str(dummy_img),
        texture_resolution=None,
        model_parameters={"texture_resolution": 4096},
    )
    resp1 = await image_to_textured_mesh(req1, scheduler=mock_scheduler)
    assert resp1.job_id == "job-test-123"
    assert captured_request.inputs["texture_resolution"] == 4096
    assert captured_request.metadata["texture_resolution"] == 4096
    # Texture resolution must not leak into model inference params
    assert "texture_resolution" not in captured_request.inputs.get("model_parameters", {})

    # 2. Request with resolution supplied in model_parameters as preset string
    req2 = ImageToTexturedMeshRequest(
        image_path=str(dummy_img),
        texture_resolution=None,
        model_parameters={"texture_resolution": "1K"},
    )
    await image_to_textured_mesh(req2, scheduler=mock_scheduler)
    assert captured_request.inputs["texture_resolution"] == 1024

    # 3. Request with resolution supplied via legacy texture_resolution_preset
    req3 = ImageToTexturedMeshRequest(
        image_path=str(dummy_img),
        texture_resolution=None,
        model_parameters={"texture_resolution_preset": "8K"},
    )
    await image_to_textured_mesh(req3, scheduler=mock_scheduler)
    assert captured_request.inputs["texture_resolution"] == 8192

    # 4. Top-level texture_resolution takes precedence over nested model_parameters
    req4 = ImageToTexturedMeshRequest(
        image_path=str(dummy_img),
        texture_resolution=2048,
        model_parameters={"texture_resolution": 4096},
    )
    await image_to_textured_mesh(req4, scheduler=mock_scheduler)
    assert captured_request.inputs["texture_resolution"] == 2048


# ---------------------------------------------------------------------------
# BUG-012: Approved enhancement preserves original reference image for texturing
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_bug012_enhancement_preserves_reference_image(monkeypatch, tmp_path):
    monkeypatch.setenv("ALLOW_LOCAL_SERVER_PATH_INPUTS", "true")
    orig_img = _create_test_png(tmp_path / "original.png")
    enhanced_img = _create_test_png(tmp_path / "enhanced.png")

    mock_scheduler = MagicMock()
    mock_scheduler.validate_model_preference.return_value = True
    captured_raw = None
    captured_textured = None

    async def fake_schedule_raw(req):
        nonlocal captured_raw
        captured_raw = req
        return "job-raw"

    async def fake_schedule_tex(req):
        nonlocal captured_textured
        captured_textured = req
        return "job-tex"

    mock_scheduler.schedule_job = AsyncMock(side_effect=fake_schedule_raw)

    with patch("api.routers.mesh_generation.load_preprocessed_artifact") as mock_load:
        mock_load.return_value = (str(enhanced_img), {"enhanced": True})

        # Test image-to-raw-mesh
        req_raw = ImageToRawMeshRequest(
            image_path=str(orig_img),
            preprocessing_artifact_id="art-456",
            enhancement_enabled=True,
        )
        await image_to_raw_mesh(req_raw, scheduler=mock_scheduler)
        assert captured_raw.inputs["image_path"] == str(enhanced_img)
        assert captured_raw.inputs["reference_image_path"] == str(orig_img)
        assert captured_raw.metadata["reference_image_path"] == str(orig_img)

        # Test image-to-textured-mesh
        mock_scheduler.schedule_job = AsyncMock(side_effect=fake_schedule_tex)
        req_tex = ImageToTexturedMeshRequest(
            image_path=str(orig_img),
            preprocessing_artifact_id="art-456",
            enhancement_enabled=True,
        )
        await image_to_textured_mesh(req_tex, scheduler=mock_scheduler)
        assert captured_textured.inputs["image_path"] == str(enhanced_img)
        assert captured_textured.inputs["reference_image_path"] == str(orig_img)
        assert captured_textured.metadata["reference_image_path"] == str(orig_img)


def test_bug012_resolve_reference_image_precedence(tmp_path):
    orig = _create_test_png(tmp_path / "orig.png")
    enhanced = _create_test_png(tmp_path / "enhanced.png")
    texture = _create_test_png(tmp_path / "texture.png")

    # When both image_path (enhanced) and reference_image_path (orig) exist,
    # reference_image_path must be resolved for texturing stage.
    job_inputs = {
        "image_path": str(enhanced),
        "reference_image_path": str(orig),
    }
    resolved = _resolve_reference_image(job_inputs, {})
    assert resolved == orig

    # When explicit texture_image_path is provided, it has top priority
    job_inputs_with_tex = {
        "image_path": str(enhanced),
        "reference_image_path": str(orig),
        "texture_image_path": str(texture),
    }
    resolved_tex = _resolve_reference_image(job_inputs_with_tex, {})
    assert resolved_tex == texture


# ---------------------------------------------------------------------------
# BUG-013: Temporary input directories tracked and cleaned up
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_bug013_temp_dirs_tracked_and_cleaned():
    b64_png = _get_test_png_b64()

    mock_scheduler = MagicMock()
    mock_scheduler.validate_model_preference.return_value = True
    captured_req = None

    async def fake_schedule(req):
        nonlocal captured_req
        captured_req = req
        return "job-b64-123"

    mock_scheduler.schedule_job = AsyncMock(side_effect=fake_schedule)

    req = ImageToRawMeshRequest(image_base64=b64_png)
    await image_to_raw_mesh(req, scheduler=mock_scheduler)

    assert captured_req is not None
    temp_dirs = captured_req.metadata.get("temp_input_dirs", [])
    assert len(temp_dirs) > 0
    temp_dir = Path(temp_dirs[0])
    assert temp_dir.exists()
    assert temp_dir.name.startswith("mesh_gen_")

    # Verify scheduler cleanup removes the tracked temp dir
    scheduler = MultiprocessModelScheduler()
    scheduler._cleanup_temporary_inputs(captured_req)
    assert not temp_dir.exists()


@pytest.mark.asyncio
async def test_bug013_temp_dirs_cleaned_on_scheduling_failure():
    b64_png = _get_test_png_b64()

    mock_scheduler = MagicMock()
    mock_scheduler.validate_model_preference.return_value = True
    mock_scheduler.schedule_job = AsyncMock(side_effect=RuntimeError("Scheduler queue crashed"))

    created_dirs = []
    orig_mkdtemp = tempfile.mkdtemp

    def tracking_mkdtemp(*args, **kwargs):
        d = orig_mkdtemp(*args, **kwargs)
        created_dirs.append(Path(d))
        return d

    with patch("tempfile.mkdtemp", side_effect=tracking_mkdtemp):
        req = ImageToRawMeshRequest(image_base64=b64_png)
        with pytest.raises(Exception):
            await image_to_raw_mesh(req, scheduler=mock_scheduler)

    assert len(created_dirs) > 0
    for d in created_dirs:
        assert not d.exists(), f"Temp directory {d} should have been cleaned up on failure"


# ---------------------------------------------------------------------------
# BUG-018: VRAM status checks CUDA availability & assigned gpu_id
# ---------------------------------------------------------------------------

def test_bug018_vram_status_ineligible_when_cuda_unavailable():
    paint3d = Paint3DAdapter(vram_requirement=12000)
    hunyuan = Hunyuan3DPaintV21Adapter(vram_requirement=16000)

    with patch("torch.cuda.is_available", return_value=False):
        p_status = paint3d.get_vram_status()
        assert p_status["eligible"] is False
        assert p_status["status"] == "ineligible"
        assert p_status["vram_available_mb"] is None

        h_status = hunyuan.get_vram_status()
        assert h_status["eligible"] is False
        assert h_status["status"] == "ineligible"
        assert h_status["vram_available_mb"] is None


def test_bug018_vram_status_checks_assigned_gpu_id():
    paint3d = Paint3DAdapter(vram_requirement=12000, device="cuda:1")

    mock_prop_0 = SimpleNamespace(total_memory=16000 * 1024 * 1024)  # 16GB
    mock_prop_1 = SimpleNamespace(total_memory=8000 * 1024 * 1024)   # 8GB

    def mock_props(device_id):
        return mock_prop_1 if device_id == 1 else mock_prop_0

    with patch("torch.cuda.is_available", return_value=True), \
         patch("torch.cuda.device_count", return_value=2), \
         patch("torch.cuda.get_device_properties", side_effect=mock_props):

        # Checking GPU 1 (8GB VRAM) against 12GB requirement -> insufficient
        status_gpu1 = paint3d.get_vram_status(gpu_id=1)
        assert status_gpu1["eligible"] is False
        assert status_gpu1["status"] == "insufficient_vram"
        assert status_gpu1["gpu_id"] == 1

        # Checking GPU 0 (16GB VRAM) against 12GB requirement -> eligible
        status_gpu0 = paint3d.get_vram_status(gpu_id=0)
        assert status_gpu0["eligible"] is True
        assert status_gpu0["status"] == "eligible"
        assert status_gpu0["gpu_id"] == 0


# ---------------------------------------------------------------------------
# BUG-023: Reject unsupported texture resolutions with 422 / ValueError
# ---------------------------------------------------------------------------

def test_bug023_normalize_texture_resolution_accepts_valid():
    for val, expected in [
        (1024, 1024), ("1024", 1024), ("1K", 1024), ("1k", 1024),
        (2048, 2048), ("2048", 2048), ("2K", 2048), ("2k", 2048),
        (4096, 4096), ("4096", 4096), ("4K", 4096), ("4k", 4096),
        (8192, 8192), ("8192", 8192), ("8K", 8192), ("8k", 8192),
        (None, None),
    ]:
        assert _normalize_texture_resolution(val) == expected


def test_bug023_normalize_texture_resolution_rejects_unsupported():
    for invalid in [256, 300, 512, 1536, 3000, 5000, "300", "3K", "invalid", 0, -1]:
        with pytest.raises(ValueError, match="Unsupported texture resolution"):
            _normalize_texture_resolution(invalid)


def test_bug023_request_models_validation_rejects_arbitrary_sizes():
    for req_cls in [
        TextMeshPaintingRequest,
        ImageToRawMeshRequest,
        ImageToTexturedMeshRequest,
        ImageMeshPaintingRequest,
    ]:
        # Valid preset
        assert req_cls.normalize_texture_resolution("2K") == 2048
        # Invalid numeric or string preset raises ValueError (FastAPI converts to 422)
        with pytest.raises(ValueError):
            req_cls.normalize_texture_resolution(300)
        with pytest.raises(ValueError):
            req_cls.normalize_texture_resolution("3K")


def test_bug023_pipeline_resolve_texture_preset_rejects_unsupported():
    # Valid
    assert resolve_texture_preset(None) == ("2K", 2048)
    assert resolve_texture_preset("1K") == ("1K", 1024)
    assert resolve_texture_preset("2K") == ("2K", 2048)
    assert resolve_texture_preset("4K") == ("4K", 4096)
    assert resolve_texture_preset("8K") == ("8K", 8192)

    # Unsupported values must raise ValueError rather than silent bucketing
    for invalid in [300, 512, 1536, 3000, 5000, "3K", "custom"]:
        with pytest.raises(ValueError, match="Unsupported texture resolution"):
            resolve_texture_preset(invalid)
