import io
import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace

import numpy as np
import pytest
import trimesh
from core.scheduler.multiprocess_scheduler import _build_model_inference_inputs
from PIL import Image

from adapters.hunyuan3d_dit_v2_mini_turbo import Hunyuan3DDiTV2MiniTurboImageToRawMeshAdapter
from adapters.hunyuan3d_paint_v21 import Hunyuan3DPaintV21ImageMeshPaintingAdapter
from adapters.hunyuan3d_shape_v21 import Hunyuan3DShapeV21ImageToRawMeshAdapter
from adapters.trellis2_adapter import Trellis2ImageToTexturedMeshAdapter
from adapters.triposg_adapter import TripoSGImageToRawMeshAdapter, _resolve_hierarchical_octree_depth
from adapters.hunyuan3d_decoder_profile import configure_native_dense_decoder
from utils.fastmesh_utils import FastMeshError, FastMeshRunner


def test_trellis2_fails_when_textured_exporter_is_unavailable():
    adapter = Trellis2ImageToTexturedMeshAdapter()
    adapter.runner = SimpleNamespace(o_voxel=None)

    with pytest.raises(Exception, match="requires o_voxel"):
        adapter._process_request({})


def test_hunyuan_reference_resize_preserves_aspect_ratio(size, content_box):
    image = Image.new("RGB", size, (255, 0, 0))

    prepared = Hunyuan3DPaintV21ImageMeshPaintingAdapter._prepare_reference_image(image)

    assert prepared.size == (512, 512)
    assert prepared.getpixel((255, 255)) == (255, 0, 0)
    left, top, right, bottom = content_box
    assert prepared.getpixel((left, top)) == (255, 0, 0)
    assert prepared.getpixel((right - 1, bottom - 1)) == (255, 0, 0)
    if top:
        assert prepared.getpixel((0, top - 1)) == (255, 255, 255)
        assert prepared.getpixel((0, bottom)) == (255, 255, 255)
    if left:
        assert prepared.getpixel((left - 1, 0)) == (255, 255, 255)
        assert prepared.getpixel((right, 0)) == (255, 255, 255)



def test_hunyuan_mini_turbo_keeps_pipeline_when_to_returns_none(monkeypatch, tmp_path):
    import adapters.hunyuan3d_dit_v2_mini_turbo as adapter_module

    class FakePipeline:
        @classmethod
        def from_pretrained(cls, *args, device, **kwargs):
            pipeline = cls()
            pipeline.to(device)
            return pipeline

        def to(self, device):
            self.device = device
            # Mirrors the upstream API: in-place mutation, no return value.

        def __call__(self, **kwargs):
            return [object()]

    class FakeBackgroundRemover:
        session = None

    package = ModuleType("hy3dgen")
    package.__path__ = []
    shapegen = ModuleType("hy3dgen.shapegen")
    shapegen.__path__ = []
    pipelines = ModuleType("hy3dgen.shapegen.pipelines")
    pipelines.Hunyuan3DDiTFlowMatchingPipeline = FakePipeline
    rembg_package = ModuleType("hy3dgen.rembg")
    rembg_package.BackgroundRemover = FakeBackgroundRemover
    rembg_module = ModuleType("rembg")
    rembg_module.new_session = lambda **kwargs: object()

    for name, module in {
        "hy3dgen": package,
        "hy3dgen.shapegen": shapegen,
        "hy3dgen.shapegen.pipelines": pipelines,
        "hy3dgen.rembg": rembg_package,
        "rembg": rembg_module,
    }.items():
        monkeypatch.setitem(sys.modules, name, module)
    monkeypatch.setattr(adapter_module.torch.cuda, "is_available", lambda: False)

    adapter = Hunyuan3DDiTV2MiniTurboImageToRawMeshAdapter(
        model_path=str(tmp_path),
        hunyuan3d_root=str(tmp_path),
        vram_requirement=1,
    )
    loaded = adapter._load_model()

    assert adapter.pipeline is loaded["pipeline"]
    assert callable(adapter.pipeline)
    assert adapter.pipeline.device == "cpu"
    assert adapter.pipeline() is not None



def test_fastmesh_normalization_rejects_empty_mesh():
    runner = FastMeshRunner.__new__(FastMeshRunner)
    empty = trimesh.Trimesh(vertices=np.empty((0, 3)), faces=np.empty((0, 3), dtype=np.int64), process=False)
    with pytest.raises(FastMeshError, match="empty mesh"):
        runner._apply_normalize(empty)


def test_fastmesh_normalization_rejects_zero_extent_mesh():
    runner = FastMeshRunner.__new__(FastMeshRunner)
    flat = trimesh.Trimesh(
        vertices=np.zeros((3, 3)),
        faces=np.array([[0, 1, 2]], dtype=np.int64),
        process=False,
    )
    with pytest.raises(FastMeshError, match="zero or invalid extent"):
        runner._apply_normalize(flat)



def test_centralized_texture_settings_do_not_reach_geometry_adapters():
    inputs = {
        "image_path": "/tmp/reference.png",
        "texture_enabled": True,
        "generate_texture": True,
        "generateTexture": True,
        "auto_paint": True,
        "texture_resolution": "8K",
        "production_texture_resolution": 8192,
        "enable_realesrgan": False,
        "bake_normal_maps": True,
        "octree_resolution": 512,
    }
    forwarded = _build_model_inference_inputs(inputs)
    assert forwarded == {
        "image_path": "/tmp/reference.png",
        "octree_resolution": 512,
    }


def test_triposg_preserves_full_inference_steps_and_octree_depth():
    adapter = TripoSGImageToRawMeshAdapter(vram_requirement=8192)
    schema = adapter.get_parameter_schema()["parameters"]
    assert schema["num_inference_steps"]["default"] == 50
    assert schema["faces"]["default"] == -1
    assert schema["use_flash_decoder"]["default"] is False
    assert schema["dense_octree_depth"]["default"] == 8
    assert schema["hierarchical_octree_depth"]["default"] == 10


def test_triposg_depth10_requires_sufficient_gpu_memory():
    depth, reason = _resolve_hierarchical_octree_depth(
        10, 8, "cuda:0", free_memory_bytes=26 * 1024**3, total_memory_bytes=40 * 1024**3,
    )
    assert depth == 10
    assert reason is None

    depth, reason = _resolve_hierarchical_octree_depth(
        10, 8, "cuda:0", free_memory_bytes=20 * 1024**3, total_memory_bytes=24 * 1024**3,
    )
    assert depth == 9
    assert "conservative" in reason




def test_hunyuan_native_decoder_profile_resets_volume_and_surface_extractors():
    class VanillaVolumeDecoder:
        pass

    class MCSurfaceExtractor:
        pass

    class FakeVAE:
        def __init__(self):
            self.volume_decoder = object()
            self.surface_extractor = object()

        def enable_flashvdm_decoder(self, enabled=True):
            assert enabled is False
            self.volume_decoder = VanillaVolumeDecoder()
            self.surface_extractor = MCSurfaceExtractor()

    profile = configure_native_dense_decoder(SimpleNamespace(vae=FakeVAE()), "test")
    assert profile == {
        "volume_decoder": "VanillaVolumeDecoder",
        "surface_extractor": "MCSurfaceExtractor",
    }

def test_hunyuan3d_shape_v21_defaults_to_max_fidelity_when_source_quality_max():
    adapter = Hunyuan3DShapeV21ImageToRawMeshAdapter(vram_requirement=10240)
    schema = adapter.get_parameter_schema()["parameters"]
    assert schema["octree_resolution"]["default"] == 512
    assert schema["octree_resolution"]["maximum"] == 512


def test_hunyuan3d_dit_v2_mini_turbo_defaults_to_max_fidelity_when_source_quality_max():
    adapter = Hunyuan3DDiTV2MiniTurboImageToRawMeshAdapter(vram_requirement=6144)
    schema = adapter.get_parameter_schema()["parameters"]
    assert schema["octree_resolution"]["default"] == 512
    assert schema["enable_flashvdm"]["default"] is False



def test_model_specific_max_quality_profiles_override_ui_budgets():
    trellis2 = _build_model_inference_inputs(
        {
            "pipeline_type": "512", "max_num_tokens": 49152,
            "sparse_structure_sampler_params": {"steps": 12},
            "shape_slat_sampler_params": {"steps": 12},
            "target_polycount": 2000, "decimation_target": 1000, "remesh": True,
        },
        model_id="trellis2_image_to_raw_mesh",
    )
    assert trellis2["pipeline_type"] == "1536_cascade"
    assert trellis2["max_num_tokens"] == 262144
    assert trellis2["sparse_structure_sampler_params"]["steps"] == 50
    assert trellis2["shape_slat_sampler_params"]["steps"] == 50
    assert trellis2["decimation_target"] == -1
    assert trellis2["remesh"] is False
    assert "target_polycount" not in trellis2


def test_trellis2_raw_mesh_path_skips_render_only_simplification(tmp_path):
    import numpy as np
    import trimesh
    from PIL import Image
    from utils.trellis2_utils import Trellis2Runner

    calls = {}

    class FakeMesh:
        vertices = np.array([[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]])
        faces = np.array([[0, 1, 2]])

        def simplify(self, target):
            calls["simplified"] = target

    class FakePipeline:
        def run(self, image, **kwargs):
            calls["run_kwargs"] = kwargs
            return [FakeMesh()]

    image_path = tmp_path / "source.png"
    Image.new("RGB", (8, 8), (255, 255, 255)).save(image_path)
    runner = Trellis2Runner.__new__(Trellis2Runner)
    runner.image_to_3d_pipeline = FakePipeline()
    runner._load_image_to_3d_pipeline = lambda: None

    mesh = runner.image_to_mesh(
        str(image_path), raw_mesh_only=True,
        pipeline_type="1536_cascade", max_num_tokens=262144,
        sparse_structure_sampler_params={"steps": 50},
        shape_slat_sampler_params={"steps": 50},
    )

    assert isinstance(mesh, trimesh.Trimesh)
    assert len(mesh.faces) == 1
    assert "simplified" not in calls
    assert calls["run_kwargs"]["pipeline_type"] == "1536_cascade"
    assert calls["run_kwargs"]["max_num_tokens"] == 262144
    assert calls["run_kwargs"]["sparse_structure_sampler_params"]["steps"] == 50
    assert calls["run_kwargs"]["shape_slat_sampler_params"]["steps"] == 50


def test_ultrashape_requests_max_quality_for_its_hunyuan_coarse_stage(tmp_path):
    import trimesh
    from PIL import Image
    from utils.ultrashape_pipeline_helper import UltraShapeInferenceHelper

    image_path = tmp_path / "source.png"
    Image.new("RGB", (8, 8), (180, 180, 180)).save(image_path)
    calls = {}

    def fake_hunyuan_pipeline(**kwargs):
        calls.update(kwargs)
        return [trimesh.creation.box()]

    helper = UltraShapeInferenceHelper.__new__(UltraShapeInferenceHelper)
    helper.pipeline = object()
    helper.rembg = lambda image: image
    helper.refine_mesh = lambda **kwargs: trimesh.creation.box()

    output_path, info = helper.generate_and_refine(
        image_path=str(image_path),
        hunyuan_pipeline=fake_hunyuan_pipeline,
        hunyuan_bg_remover=lambda image: image,
        output_dir=str(tmp_path / "output"),
        coarse_num_inference_steps=50,
        coarse_octree_resolution=512,
        coarse_guidance_scale=5.0,
        coarse_num_chunks=20000,
        num_inference_steps=50,
        num_latents=32768,
        octree_res=2048,
    )

    assert calls["num_inference_steps"] == 50
    assert calls["octree_resolution"] == 512
    assert calls["guidance_scale"] == 5.0
    assert calls["num_chunks"] == 20000
    assert Path(output_path).exists()
    assert info["face_count"] > 0
