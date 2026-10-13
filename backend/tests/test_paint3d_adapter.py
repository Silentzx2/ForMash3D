"""
Tests for Paint3D Model Adapter and ModelFactory Integration.
"""
import sys
from pathlib import Path
import pytest

# Add backend directory to sys.path
backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from adapters.paint3d_adapter import Paint3DAdapter, Paint3DImageMeshPaintingAdapter
from core.scheduler.model_factory import ModelFactory, get_default_model_configs


def test_paint3d_adapter_instantiation():
    adapter = Paint3DAdapter(vram_requirement=12000)
    assert adapter.model_id == "paint3d"
    assert adapter.feature_type == "image_mesh_painting"
    assert adapter.vram_requirement == 12000

    schema = adapter.get_parameter_schema()
    assert "parameters" in schema
    assert "texture_resolution" in schema["parameters"]
    assert schema["parameters"]["texture_resolution"]["enum"] == [1024, 2048]
    assert schema["parameters"]["texture_resolution"]["default"] == 1024

    formats = adapter.get_supported_formats()
    assert "glb" in formats["output"]
    assert "obj" in formats["output"]

    vram_status = adapter.get_vram_status()
    assert vram_status["model_id"] == "paint3d"
    assert vram_status["vram_required_mb"] == 12000


def test_paint3d_adapter_alias():
    adapter = Paint3DImageMeshPaintingAdapter(vram_requirement=12000)
    assert isinstance(adapter, Paint3DAdapter)
    assert adapter.model_id == "paint3d"


def test_paint3d_model_factory_registry():
    registry = ModelFactory.get_available_adapters()
    assert "paint3d" in registry
    assert registry["paint3d"]["module"] == "adapters.paint3d_adapter"
    assert registry["paint3d"]["class"] == "Paint3DAdapter"

    assert "paint3d_image_mesh_painting" in registry
    assert registry["paint3d_image_mesh_painting"]["module"] == "adapters.paint3d_adapter"
    assert registry["paint3d_image_mesh_painting"]["class"] == "Paint3DAdapter"


def test_paint3d_manifest_configuration():
    configs = get_default_model_configs()
    assert "paint3d" in configs, "paint3d must be present in canonical models.yaml manifest"

    cfg = configs["paint3d"]
    assert cfg["model_id"] == "paint3d"
    assert cfg["feature_type"] == "image_mesh_painting"
    assert cfg["vram_requirement"] == 12000
    assert "mesh" in cfg["supported_inputs"]
    assert "image" in cfg["supported_inputs"]
    assert "glb" in cfg["supported_outputs"]
    assert "obj" in cfg["supported_outputs"]

    # Test instantiation via ModelFactory
    model_instance = ModelFactory.create_model_from_config(cfg)
    assert isinstance(model_instance, Paint3DAdapter)
    assert model_instance.model_id == "paint3d"


def test_paint3d_input_validation():
    adapter = Paint3DAdapter(vram_requirement=12000)

    # Missing mesh_path
    with pytest.raises(ValueError, match="mesh_path is required"):
        adapter._process_request({"image_path": "nonexistent.png"})

    # Missing image_path
    with pytest.raises(ValueError, match="image_path is required"):
        adapter._process_request({"mesh_path": "nonexistent.obj"})

    # Nonexistent mesh_path
    with pytest.raises(FileNotFoundError, match="Input mesh not found"):
        adapter._process_request({"mesh_path": "nonexistent.obj", "image_path": "nonexistent.png"})


def test_paint3d_prepare_job_mesh_applies_scene_transforms(tmp_path):
    """Verify _prepare_job_mesh applies GLB scene node transforms before exporting OBJ."""
    import numpy as np
    import trimesh

    adapter = Paint3DAdapter(vram_requirement=12000)
    job_dir = tmp_path / "job"
    job_dir.mkdir()

    box1 = trimesh.creation.box(extents=[1, 1, 1])
    box2 = trimesh.creation.box(extents=[1, 1, 1])

    transform2 = np.eye(4)
    transform2[0, 3] = 10.0  # translate 10 units along X

    scene = trimesh.Scene()
    scene.add_geometry(box1, node_name="box1")
    scene.add_geometry(box2, node_name="box2", transform=transform2)

    glb_path = tmp_path / "multi_part.glb"
    scene.export(str(glb_path), file_type="glb")

    prepared_obj = adapter._prepare_job_mesh(glb_path, job_dir)
    assert prepared_obj.exists()

    reloaded = trimesh.load(str(prepared_obj), process=False)
    # If transforms are applied, bounds along X span from ~ -0.5 to ~ 10.5 (extent >= 10.0)
    # If transforms were omitted, both boxes would sit at origin with extent ~ 1.0
    x_extent = reloaded.bounds[1][0] - reloaded.bounds[0][0]
    assert x_extent >= 10.0, f"Expected X extent >= 10.0 with transforms applied, got {x_extent}"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
