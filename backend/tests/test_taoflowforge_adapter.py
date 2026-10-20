"""
Tests for TaoFlowForge Image-to-Raw-Mesh Model Adapter.
"""

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch
import pytest

backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from adapters import TaoFlowForgeImageToRawMeshAdapter, _ADAPTER_MAP
from adapters.taoflowforge_adapter import TaoFlowForgeImageToRawMeshAdapter as DirectAdapter
from core.scheduler.model_factory import ModelFactory


def test_taoflowforge_adapter_registration():
    """Verify adapter is registered in _ADAPTER_MAP and ModelFactory."""
    assert "TaoFlowForgeImageToRawMeshAdapter" in _ADAPTER_MAP
    module_name, class_name = _ADAPTER_MAP["TaoFlowForgeImageToRawMeshAdapter"]
    assert module_name == "taoflowforge_adapter"
    assert class_name == "TaoFlowForgeImageToRawMeshAdapter"

    registry = ModelFactory.get_available_adapters()
    assert "taoflowforge_image_to_raw_mesh" in registry
    assert registry["taoflowforge_image_to_raw_mesh"]["class"] == "TaoFlowForgeImageToRawMeshAdapter"


def test_taoflowforge_adapter_instantiation_defaults():
    """Verify default initialization parameters."""
    adapter = TaoFlowForgeImageToRawMeshAdapter()
    assert adapter.model_id == "taoflowforge_image_to_raw_mesh"
    assert adapter.FEATURE_TYPE == "image_to_raw_mesh"
    assert adapter.feature_type == "image_to_raw_mesh"
    assert adapter.vram_requirement == 20480
    assert adapter.native_topology is True
    assert adapter.offload == "auto"
    assert adapter.fill_holes is True

    # Root path defaults to existing thirdparty checkout
    assert adapter.taoflowforge_root.exists()
    assert adapter.is_installed() is True

    # Checkpoints do not exist yet on disk
    assert adapter.is_available() is False

    # Formats & Schema
    formats = adapter.get_supported_formats()
    assert "glb" in formats["output"]
    assert "obj" in formats["output"]

    schema = adapter.get_parameter_schema()
    assert "parameters" in schema
    assert "seed" in schema["parameters"]
    assert "fill_holes" in schema["parameters"]
    assert "output_format" in schema["parameters"]


def test_taoflowforge_adapter_custom_paths(tmp_path):
    """Verify initialization with custom paths and parameters."""
    custom_root = tmp_path / "custom_tff"
    custom_root.mkdir()
    (custom_root / "taoflowforge").mkdir()
    (custom_root / "taoflowforge" / "__init__.py").touch()

    custom_model_dir = tmp_path / "custom_weights"
    custom_model_dir.mkdir()
    s0 = custom_model_dir / "stage0.pt"
    s1 = custom_model_dir / "stage1.pt"
    s2 = custom_model_dir / "stage2.pt"
    s0.touch()
    s1.touch()
    s2.touch()

    adapter = TaoFlowForgeImageToRawMeshAdapter(
        model_id="custom_tff",
        model_path=str(custom_model_dir),
        vram_requirement=16000,
        taoflowforge_root=str(custom_root),
        stage0_checkpoint=str(s0),
        stage1_checkpoint=str(s1),
        stage2_checkpoint=str(s2),
        offload="on",
        fill_holes=False,
    )

    assert adapter.model_id == "custom_tff"
    assert adapter.vram_requirement == 16000
    assert adapter.taoflowforge_root == custom_root.resolve()
    assert adapter.is_installed() is True
    assert adapter.offload == "on"
    assert adapter.fill_holes is False

    # When torch and cuda are mocked as available
    with patch(f"{TaoFlowForgeImageToRawMeshAdapter.__module__}.torch") as mock_torch:
        mock_torch.cuda.is_available.return_value = True
        assert adapter.is_available() is True

        # If a checkpoint is missing
        s0.unlink()
        assert adapter.is_available() is False


def test_taoflowforge_adapter_missing_checkpoints_raises(tmp_path):
    """Verify _load_model raises FileNotFoundError when checkpoints are missing."""
    empty_model_dir = tmp_path / "empty_models"
    empty_model_dir.mkdir()

    adapter = TaoFlowForgeImageToRawMeshAdapter(model_path=str(empty_model_dir))
    with pytest.raises(FileNotFoundError) as exc_info:
        adapter._load_model()

    assert "TaoFlowForge checkpoints missing" in str(exc_info.value)
    assert "stage0.pt" in str(exc_info.value)


def test_taoflowforge_adapter_process_request_validation(tmp_path):
    """Verify input validation in _process_request."""
    adapter = TaoFlowForgeImageToRawMeshAdapter()

    # Missing image
    with pytest.raises(RuntimeError) as exc_info:
        adapter._process_request({})
    assert "image_path, image_paths, or image is required" in str(exc_info.value)

    # Image file not found
    with pytest.raises(RuntimeError) as exc_info:
        adapter._process_request({"image_path": str(tmp_path / "nonexistent.png")})
    assert "Input image not found" in str(exc_info.value)

    # Unsupported format
    existing_img = tmp_path / "input.png"
    existing_img.touch()
    with pytest.raises(RuntimeError) as exc_info:
        adapter._process_request({
            "image_path": str(existing_img),
            "output_format": "unsupported_xyz",
        })
    assert "Unsupported output format" in str(exc_info.value)


def test_taoflowforge_adapter_process_request_mocked(tmp_path):
    """Verify successful end-to-end processing with mocked pipeline."""
    adapter = TaoFlowForgeImageToRawMeshAdapter()

    input_img = tmp_path / "test_input.png"
    input_img.touch()

    # Mock output mesh files produced by pipeline
    mock_pipeline = MagicMock()
    fake_glb = tmp_path / "fake_mesh.glb"
    fake_glb.write_bytes(b"GLB_DATA")
    fake_raw_obj = tmp_path / "fake_raw.obj"
    fake_raw_obj.write_text("v 0 0 0\n")
    fake_meta = tmp_path / "fake_meta.json"
    fake_meta.write_text('{"stages": {"stage0": {"seconds": 1.2}}}')

    mock_result = MagicMock()
    mock_result.glb_path = fake_glb
    mock_result.final_mesh_path = fake_glb
    mock_result.raw_mesh_path = fake_raw_obj
    mock_result.metadata_path = fake_meta
    mock_result.mesh = MagicMock()
    mock_result.mesh.vertices = [[0, 0, 0], [1, 0, 0], [0, 1, 0]]
    mock_result.mesh.faces = [[0, 1, 2]]

    mock_pipeline.run.return_value = mock_result
    adapter.pipeline = mock_pipeline

    response = adapter._process_request({
        "image_path": str(input_img),
        "output_format": "glb",
        "seed": 123,
    })

    assert response["success"] is True
    assert Path(response["output_mesh_path"]).exists()
    assert Path(response["output_mesh_path"]).name.endswith(".glb")
    assert response["metadata"]["seed"] == 123
    assert response["metadata"]["native_topology"] is True
    assert response["metadata"]["vertex_count"] == 3
    assert response["metadata"]["face_count"] == 1
    assert "generation_info" in response


def test_taoflowforge_unload_model():
    """Verify _unload_model cleans up pipeline and clears CUDA cache."""
    adapter = TaoFlowForgeImageToRawMeshAdapter()
    mock_pipe = MagicMock()
    adapter.pipeline = mock_pipe

    with patch(f"{TaoFlowForgeImageToRawMeshAdapter.__module__}.torch") as mock_torch:
        mock_torch.cuda.is_available.return_value = True
        adapter._unload_model()

        mock_pipe.close.assert_called_once()
        assert adapter.pipeline is None
        mock_torch.cuda.empty_cache.assert_called_once()
