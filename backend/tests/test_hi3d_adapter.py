"""
Comprehensive tests for Hi3D experimental model adapter and factory integration.
"""

from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
import json
import numpy as np
import pytest
import torch
import trimesh
from PIL import Image

from adapters.hi3d_adapter import (
    BaseAdapter,
    Hi3DAdapter,
    Hi3DImageToMeshAdapter,
    Hi3DImageToRawMeshAdapter,
    Hi3DImageToTexturedMeshAdapter,
    _LOCKED_INFERENCE_PROFILE,
    _apply_hi3d_fp16_profile,
    _has_local_hf_model_weights,
    export_untextured_raw_mesh,
)
from core.models.base import ModelStatus
from core.models.mesh_models import ImageToMeshModel
from core.scheduler.model_factory import ModelFactory
from core.config import get_settings


@pytest.fixture
def sample_image(tmp_path: Path) -> Path:
    img_path = tmp_path / "test_input.png"
    img = Image.new("RGB", (64, 64), color=(200, 100, 50))
    img.save(img_path)
    return img_path


@pytest.fixture
def sample_mesh(tmp_path: Path) -> Path:
    mesh_path = tmp_path / "coarse_input.glb"
    box = trimesh.creation.box(extents=(1.0, 1.0, 1.0))
    box.export(str(mesh_path), file_type="glb")
    return mesh_path


def test_base_adapter_inheritance():
    """Verify Hi3DAdapter inherits from BaseAdapter / ImageToMeshModel."""
    assert issubclass(BaseAdapter, ImageToMeshModel)
    assert issubclass(Hi3DAdapter, BaseAdapter)
    assert issubclass(Hi3DImageToRawMeshAdapter, Hi3DAdapter)
    assert issubclass(Hi3DImageToTexturedMeshAdapter, Hi3DAdapter)
    assert Hi3DImageToMeshAdapter is Hi3DImageToRawMeshAdapter


def test_experimental_flag():
    """Verify experimental flag is set across adapter attributes, properties, and metadata."""
    adapter = Hi3DImageToRawMeshAdapter()
    assert adapter.experimental is True
    assert adapter.is_experimental is True

    info = adapter.get_model_info()
    assert info["experimental"] is True
    assert info["model_id"] == "hi3d_image_to_raw_mesh"
    assert info["feature_type"] == "image_to_raw_mesh"


def test_model_factory_registration_and_instantiation():
    """Verify ModelFactory creates Hi3D adapters with experimental flag preserved."""
    assert "hi3d_image_to_raw_mesh" in ModelFactory.ADAPTER_REGISTRY
    assert "hi3d_image_to_textured_mesh" in ModelFactory.ADAPTER_REGISTRY
    assert "hi3d" in ModelFactory.ADAPTER_REGISTRY

    # Create raw mesh adapter
    raw_adapter = ModelFactory.create_model_from_config({
        "model_id": "hi3d_image_to_raw_mesh",
        "feature_type": "image_to_raw_mesh",
        "experimental": True,
        "vram_requirement": 16384,
    })
    assert isinstance(raw_adapter, Hi3DImageToRawMeshAdapter)
    assert raw_adapter.model_id == "hi3d_image_to_raw_mesh"
    assert raw_adapter.experimental is True
    assert raw_adapter.vram_requirement == 16384

    # Create textured mesh route adapter
    tex_adapter = ModelFactory.create_model_from_config({
        "model_id": "hi3d_image_to_textured_mesh",
        "feature_type": "image_to_textured_mesh",
        "experimental": True,
        "vram_requirement": 16384,
    })
    assert isinstance(tex_adapter, Hi3DImageToTexturedMeshAdapter)
    assert tex_adapter.model_id == "hi3d_image_to_textured_mesh"
    assert tex_adapter.experimental is True


def test_models_yaml_manifest_contract():
    """Verify backend/config/models.yaml registers Hi3D with experimental: true and 16GB VRAM."""
    settings = get_settings()
    raw_cfg = settings.get_model_config("image_to_raw_mesh", "hi3d_image_to_raw_mesh")
    assert raw_cfg is not None, "hi3d_image_to_raw_mesh missing from image_to_raw_mesh"
    assert raw_cfg.experimental is True
    assert raw_cfg.vram_requirement == 16384
    assert raw_cfg.model_path == "backend/pretrained/Hi3D"
    assert "image" in raw_cfg.supported_inputs
    assert "mesh" in raw_cfg.supported_inputs
    assert "glb" in raw_cfg.supported_outputs

    tex_cfg = settings.get_model_config("image_to_textured_mesh", "hi3d_image_to_textured_mesh")
    assert tex_cfg is not None, "hi3d_image_to_textured_mesh missing from image_to_textured_mesh"
    assert tex_cfg.experimental is True
    assert tex_cfg.vram_requirement == 16384


def test_lazy_loading_and_hardware_prerequisites(tmp_path: Path):
    """Verify lazy loading does not load weights at init, and hardware checks are enforced."""
    adapter = Hi3DImageToRawMeshAdapter()
    assert adapter.pipeline is None
    assert adapter.status == ModelStatus.UNLOADED

    # When CUDA is unavailable or compute capability < 7, _load_model raises RuntimeError
    with patch("torch.cuda.is_available", return_value=False):
        with pytest.raises(RuntimeError, match="CUDA capability >= 7.0"):
            adapter._load_model()

    # When CUDA is available but capability is insufficient (e.g. Pascal 6.1)
    with patch("torch.cuda.is_available", return_value=True), \
         patch("torch.cuda.get_device_capability", return_value=(6, 1)):
        with pytest.raises(RuntimeError, match="requires compute capability >= 7.0"):
            adapter._load_model()


def test_input_validation(sample_image: Path):
    """Verify input validation catches missing or malformed inputs."""
    adapter = Hi3DImageToRawMeshAdapter()

    # Missing image
    with pytest.raises(ValueError, match="Reference image"):
        adapter._process_request({})

    # Missing image file
    with pytest.raises(FileNotFoundError, match="Input image file not found"):
        adapter._process_request({"image_path": "/nonexistent/path/image.png"})

    # Missing coarse mesh file
    with pytest.raises(FileNotFoundError, match="Coarse mesh file not found"):
        adapter._process_request({
            "image_path": str(sample_image),
            "coarse_mesh_path": "/nonexistent/path/coarse.glb",
        })


def test_clean_untextured_raw_mesh_export(tmp_path: Path):
    """Verify export_untextured_raw_mesh strips vertex colors and outputs clean untextured geometry."""
    box = trimesh.creation.box()
    # Force synthetic vertex colors onto visual
    box.visual.vertex_colors = np.ones((len(box.vertices), 4), dtype=np.uint8) * 128
    assert box.visual.kind == "vertex"

    out_glb = tmp_path / "clean_export.glb"
    exported_path = export_untextured_raw_mesh(box, out_glb)
    assert Path(exported_path).exists()

    loaded = trimesh.load(exported_path, force="mesh", process=False)
    assert isinstance(loaded, trimesh.Trimesh)
    assert len(loaded.vertices) == len(box.vertices)
    assert len(loaded.faces) == len(box.faces)
    # Visual must not have vertex colors
    assert not hasattr(loaded.visual, "vertex_colors") or loaded.visual.vertex_colors is None or loaded.visual.kind != "vertex"


def test_mock_inference_with_coarse_mesh(sample_image: Path, sample_mesh: Path, tmp_path: Path):
    """Verify mock inference runs end-to-end, enforces locked profile, and produces valid output."""
    adapter = Hi3DImageToRawMeshAdapter()

    mock_pipeline = MagicMock()
    refined_sphere = trimesh.creation.icosphere(subdivisions=2, radius=1.0)
    mock_pipeline_output = MagicMock()
    mock_pipeline_output.mesh = refined_sphere
    mock_pipeline_output.resolution = 1024
    mock_pipeline.return_value = mock_pipeline_output

    adapter.pipeline = mock_pipeline
    adapter.status = ModelStatus.LOADED

    result = adapter._process_request({
        "image_path": str(sample_image),
        "coarse_mesh_path": str(sample_mesh),
        "output_format": "glb",
        "output_path": str(tmp_path / "test_hi3d_mock1.glb"),
    })

    assert result["success"] is True
    out_path = Path(result["output_mesh_path"])
    assert out_path.exists()

    # Verify mesh geometry
    loaded = trimesh.load(str(out_path), force="mesh", process=False)
    assert isinstance(loaded, trimesh.Trimesh)
    assert len(loaded.vertices) == len(refined_sphere.vertices)
    assert len(loaded.faces) == len(refined_sphere.faces)

    # Verify generation info
    info = result["generation_info"]
    assert info["experimental"] is True
    assert info["model_id"] == "hi3d_image_to_raw_mesh"
    assert info["resolution"] == _LOCKED_INFERENCE_PROFILE["resolution"]
    assert info["num_inference_steps"] == _LOCKED_INFERENCE_PROFILE["num_inference_steps"]
    assert info["apply_texture"] is False
    assert info["vertex_count"] == len(refined_sphere.vertices)
    assert info["face_count"] == len(refined_sphere.faces)


def test_mock_inference_coarse_mesh_fallback(sample_image: Path, tmp_path: Path):
    """Verify that when no coarse mesh is provided, Hi3D creates an initial coarse envelope."""
    adapter = Hi3DImageToRawMeshAdapter()

    mock_pipeline = MagicMock()
    refined_sphere = trimesh.creation.icosphere(subdivisions=2, radius=1.0)
    mock_pipeline.return_value = refined_sphere

    adapter.pipeline = mock_pipeline
    adapter.status = ModelStatus.LOADED

    result = adapter._process_request({
        "image_path": str(sample_image),
        "output_format": "glb",
        "output_path": str(tmp_path / "test_hi3d_mock2.glb"),
    })

    assert result["success"] is True
    # Verify mock_pipeline received a valid coarse mesh
    args, kwargs = mock_pipeline.call_args
    passed_image, passed_coarse_mesh = args[0], args[1]
    assert isinstance(passed_image, Image.Image)
    assert isinstance(passed_coarse_mesh, trimesh.Trimesh)
    assert len(passed_coarse_mesh.vertices) > 0


def test_parameter_schema_and_supported_formats():
    """Verify parameter schema and format reporting."""
    adapter = Hi3DImageToRawMeshAdapter()
    formats = adapter.get_supported_formats()
    assert formats["input"] == ["image", "mesh"]
    assert "glb" in formats["output"]
    assert "obj" in formats["output"]

    schema = adapter.get_parameter_schema()
    params = schema["parameters"]
    assert "resolution" in params
    assert params["resolution"]["default"] in (512, 1024)
    assert params["resolution"]["enum"] == [512, 1024, 1536]
    assert params["resolution"]["readOnly"] is True
    assert "num_inference_steps" in params
    assert "apply_texture" in params
    assert params["apply_texture"]["default"] is False


def test_unload_model():
    """Verify unloading releases pipeline reference and transitions status."""
    adapter = Hi3DImageToRawMeshAdapter()
    adapter.pipeline = MagicMock()
    adapter.status = ModelStatus.LOADED

    adapter._unload_model()
    assert adapter.pipeline is None
    assert adapter.status == ModelStatus.UNLOADED



def test_output_path_auto_generated(sample_image: Path, sample_mesh: Path, tmp_path: Path):
    """Verify requests without output_path use the configured path generator."""
    adapter = Hi3DImageToRawMeshAdapter()
    adapter.path_generator.base_output_dir = tmp_path / "outputs"

    mock_pipeline = MagicMock()
    refined = trimesh.creation.icosphere(subdivisions=1, radius=0.5)
    mock_output = MagicMock()
    mock_output.mesh = refined
    mock_output.resolution = _LOCKED_INFERENCE_PROFILE["resolution"]
    mock_pipeline.return_value = mock_output
    adapter.pipeline = mock_pipeline
    adapter.status = ModelStatus.LOADED

    result = adapter._process_request({
        "image_path": str(sample_image),
        "coarse_mesh_path": str(sample_mesh),
        # Intentionally omit output_path to exercise the production default.
    })

    output_path = Path(result["output_mesh_path"])
    assert result["success"] is True
    assert output_path.exists()
    assert output_path.suffix == ".glb"
    assert output_path.parent == tmp_path / "outputs" / "meshes"


def test_fp16_profile_casts_geometry_weights_and_keeps_high_res_lazy():
    class FakeTransformer:
        def __init__(self):
            self.config = SimpleNamespace(use_fp16=False)
            self.converted = False

        def convert_to_fp16(self):
            self.converted = True

    low_res = FakeTransformer()
    high_res = FakeTransformer()
    pipeline = MagicMock()
    pipeline.transformer_512 = low_res
    pipeline.vae = torch.nn.Linear(2, 2)
    pipeline._transformer_1024 = None
    pipeline._transformer_1024_loader = lambda: high_res

    _apply_hi3d_fp16_profile(pipeline)

    assert low_res.converted is True
    assert pipeline.vae.weight.dtype == torch.float16
    assert pipeline._transformer_1024 is None
    loaded = pipeline._transformer_1024_loader()
    assert loaded is high_res
    assert high_res.converted is True



def test_local_hf_encoder_requires_complete_weights(tmp_path: Path):
    model_dir = tmp_path / "encoder"
    model_dir.mkdir()
    (model_dir / "config.json").write_text("{}", encoding="utf-8")
    assert _has_local_hf_model_weights(model_dir) is False

    (model_dir / "model.safetensors").write_bytes(b"weights")
    assert _has_local_hf_model_weights(model_dir) is True


def test_local_hf_encoder_checks_all_sharded_files(tmp_path: Path):
    model_dir = tmp_path / "encoder"
    model_dir.mkdir()
    (model_dir / "config.json").write_text("{}", encoding="utf-8")
    (model_dir / "model-00001-of-00002.safetensors").write_bytes(b"part1")
    index = {
        "weight_map": {
            "layer.0.weight": "model-00001-of-00002.safetensors",
            "layer.1.weight": "model-00002-of-00002.safetensors",
        }
    }
    (model_dir / "model.safetensors.index.json").write_text(
        json.dumps(index), encoding="utf-8"
    )
    assert _has_local_hf_model_weights(model_dir) is False

    (model_dir / "model-00002-of-00002.safetensors").write_bytes(b"part2")
    assert _has_local_hf_model_weights(model_dir) is True
