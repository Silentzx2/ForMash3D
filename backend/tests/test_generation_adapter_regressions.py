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


def test_trellis2_fails_when_textured_exporter_is_unavailable(monkeypatch):
    monkeypatch.setattr("torch.cuda.is_available", lambda: True)
    adapter = Trellis2ImageToTexturedMeshAdapter()
    adapter.runner = SimpleNamespace(o_voxel=None)

    with pytest.raises(Exception, match="requires o_voxel"):
        adapter._process_request({})


def test_hunyuan_paint_defaults_to_experimental_max_view_resolution():
    adapter = Hunyuan3DPaintV21ImageMeshPaintingAdapter(vram_requirement=12000)
    schema = adapter.get_parameter_schema()["parameters"]
    assert schema["max_num_view"]["default"] == 9
    assert schema["max_num_view"]["maximum"] == 12
    assert schema["resolution"]["default"] == 768


@pytest.mark.parametrize(
    ("size", "content_box"),
    [
        ((1200, 600), (0, 128, 512, 384)),
        ((600, 1200), (128, 0, 384, 512)),
    ],
)
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

    (tmp_path / "hy3dgen/shapegen").mkdir(parents=True, exist_ok=True)
    (tmp_path / "hy3dgen/shapegen/pipelines.py").touch()
    (tmp_path / "hy3dgen/rembg.py").touch()
    (tmp_path / "hunyuan3d-dit-v2-mini-turbo").mkdir(parents=True, exist_ok=True)

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
    monkeypatch.setattr(adapter_module.torch.cuda, "is_available", lambda: True)

    adapter = Hunyuan3DDiTV2MiniTurboImageToRawMeshAdapter(
        model_path=str(tmp_path),
        hunyuan3d_root=str(tmp_path),
        vram_requirement=1,
    )
    loaded = adapter._load_model()

    assert adapter.pipeline is loaded["pipeline"]
    assert callable(adapter.pipeline)
    assert adapter.pipeline.device == "cuda:0"
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


def test_triposg_schema_uses_adapter_owned_inference_profile():
    adapter = TripoSGImageToRawMeshAdapter(vram_requirement=8192)
    schema = adapter.get_parameter_schema()["parameters"]
    assert schema["num_inference_steps"]["default"] == 100
    assert schema["num_inference_steps"]["readOnly"] is True
    assert schema["guidance_scale"]["default"] == 9.0
    assert schema["guidance_scale"]["readOnly"] is True
    assert "faces" not in schema
    assert schema["use_flash_decoder"]["default"] is False
    assert schema["dense_octree_depth"]["default"] == 10
    assert schema["hierarchical_octree_depth"]["default"] == 11


def test_scheduler_strips_inference_overrides_for_adapter_owned_profiles():
    inputs = {
        "image_path": "/tmp/source.png", "seed": 123,
        "source_quality": "low", "requested_quality": "fast", "quality": "fast",
        "meshQuality": "low", "num_inference_steps": 1, "num_steps": 2,
        "guidance_scale": 99.0, "octree_resolution": 256, "num_chunks": 1,
        "flash_octree_depth": 5, "dense_octree_depth": 8, "hierarchical_octree_depth": 8,
        "use_flash_decoder": True, "low_vram": True, "target_polycount": 5000,
        "pipeline_type": "512", "max_num_tokens": 49152,
        "sparse_structure_sampler_params": {"steps": 12},
        "shape_slat_sampler_params": {"steps": 12},
        "resolution": 1024, "input_processing": False, "do_refine": False,
        "fill_holes": False, "offload": "off", "simplify": 0.5,
    }
    for model_id in (
        "hunyuan3d_shape_v21_image_to_raw_mesh",
        "hunyuan3d_shape_v21_image_to_3d",
        "hunyuan3d_shape_v21_image_to_textured_mesh",
        "hunyuan3d_dit_v2_mini_turbo_image_to_raw_mesh",
        "hunyuan3d_dit_v2_mini_turbo_image_to_3d",
        "triposg_image_to_raw_mesh",
        "trellis_image_to_raw_mesh",
        "trellis_image_to_3d",
        "trellis_image_to_textured_mesh",
        "trellis2_image_to_raw_mesh",
        "trellis2_image_to_3d",
        "trellis2_image_to_textured_mesh",
        "trellis2_image_mesh_painting",
        "pixal3d_image_to_raw_mesh",
        "unique3d_image_to_raw_mesh",
        "taoflowforge_image_to_raw_mesh",
    ):
        forwarded = _build_model_inference_inputs(inputs, model_id=model_id)
        assert forwarded == {"image_path": "/tmp/source.png", "seed": 123, "source_quality": "max"}

    root = Path(__file__).resolve().parents[1]
    for path in (
        "adapters/hunyuan3d_shape_v21.py",
        "adapters/hunyuan3d_dit_v2_mini_turbo.py",
        "adapters/triposg_adapter.py",
        "adapters/trellis_adapter.py",
        "adapters/trellis2_adapter.py",
        "adapters/pixal3d_adapter.py",
        "adapters/unique3d_adapter.py",
        "adapters/taoflowforge_adapter.py",
    ):
        source = (root / path).read_text(encoding="utf-8")
        assert "inputs = {**inputs, **_LOCKED_INFERENCE_PROFILE}" in source


def test_triposg_locked_depth_does_not_auto_downgrade_from_vram_estimate():
    for free_gib, total_gib in ((26, 40), (20, 24)):
        depth, reason = _resolve_hierarchical_octree_depth(
            11, 10, "cuda:0", free_memory_bytes=free_gib * 1024**3, total_memory_bytes=total_gib * 1024**3,
        )
        assert depth == 11
        assert reason is None




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

def test_hunyuan3d_shape_v21_uses_adapter_owned_inference_profile():
    from adapters.hunyuan3d_shape_v21 import _LOCKED_INFERENCE_PROFILE

    adapter = Hunyuan3DShapeV21ImageToRawMeshAdapter(vram_requirement=10240)
    schema = adapter.get_parameter_schema()["parameters"]
    assert _LOCKED_INFERENCE_PROFILE == {
        "source_quality": "max", "octree_resolution": 1300,
        "num_inference_steps": 150, "guidance_scale": 5.0,
        "num_chunks": 80000, "mc_algo": "mc",
    }
    assert schema["octree_resolution"]["default"] == 1300
    assert schema["octree_resolution"]["maximum"] == 2048
    assert schema["octree_resolution"]["readOnly"] is True
    assert schema["num_chunks"]["default"] == 80000
    assert schema["num_chunks"]["readOnly"] is True
    assert schema["num_inference_steps"]["default"] == 150
    assert schema["num_inference_steps"]["readOnly"] is True
    assert schema["guidance_scale"]["readOnly"] is True


def test_hunyuan3d_dit_v2_mini_turbo_uses_adapter_owned_inference_profile():
    from adapters.hunyuan3d_dit_v2_mini_turbo import _LOCKED_INFERENCE_PROFILE

    adapter = Hunyuan3DDiTV2MiniTurboImageToRawMeshAdapter(vram_requirement=6144)
    schema = adapter.get_parameter_schema()["parameters"]
    assert _LOCKED_INFERENCE_PROFILE == {
        "source_quality": "max", "octree_resolution": 768,
        "num_inference_steps": 20, "guidance_scale": 7.5,
        "num_chunks": 80000, "low_vram_mode": False, "low_vram": False,
        "enable_flashvdm": False, "mc_algo": "mc",
    }
    assert schema["octree_resolution"]["default"] == 768
    assert schema["octree_resolution"]["readOnly"] is True
    assert schema["num_chunks"]["default"] == 80000
    assert schema["num_chunks"]["readOnly"] is True
    assert schema["num_inference_steps"]["default"] == 20
    assert schema["num_inference_steps"]["readOnly"] is True
    assert schema["guidance_scale"]["default"] == 7.5
    assert schema["guidance_scale"]["readOnly"] is True
    assert schema["enable_flashvdm"]["default"] is False
    assert schema["enable_flashvdm"]["readOnly"] is True


def test_trellis_and_trellis2_use_adapter_owned_inference_profiles():
    from adapters.trellis_adapter import _LOCKED_INFERENCE_PROFILE as trellis_profile, TrellisImageToRawMeshAdapter
    from adapters.trellis2_adapter import (
        _LOCKED_INFERENCE_PROFILE as trellis2_profile,
        _LOCKED_PAINTING_INFERENCE_PROFILE as trellis2_paint_profile,
        Trellis2ImageToRawMeshAdapter,
    )

    assert trellis_profile == {
        "source_quality": "max", "num_inference_steps": 100,
        "ss_sampling_steps": 100, "slat_sampling_steps": 100,
        "guidance_scale": 7.5, "simplify": 0.0, "low_vram": False,
    }
    t_adapter = TrellisImageToRawMeshAdapter(vram_requirement=11776)
    t_schema = t_adapter.get_parameter_schema()["parameters"]
    assert t_schema["ss_sampling_steps"]["default"] == 100
    assert t_schema["ss_sampling_steps"]["readOnly"] is True
    assert t_schema["slat_sampling_steps"]["default"] == 100
    assert t_schema["slat_sampling_steps"]["readOnly"] is True
    assert t_schema["simplify"]["default"] == 0.0
    assert t_schema["simplify"]["readOnly"] is True

    assert trellis2_profile == {
        "source_quality": "max", "pipeline_type": "1536_cascade",
        "max_num_tokens": 524288,
        "sparse_structure_sampler_params": {
            "steps": 100, "guidance_strength": 10.0, "guidance_rescale": 0.9, "rescale_t": 8.0,
        },
        "shape_slat_sampler_params": {
            "steps": 100, "guidance_strength": 10.0, "guidance_rescale": 0.8, "rescale_t": 8.0,
        },
        "tex_slat_sampler_params": {
            "steps": 100, "guidance_strength": 3.5, "guidance_rescale": 0.5, "rescale_t": 8.0,
        },
        "decimation_target": -1, "remesh": False, "low_vram": False,
    }
    assert trellis2_paint_profile == {
        "tex_slat_sampler_params": {
            "steps": 100, "guidance_strength": 3.5, "guidance_rescale": 0.5, "rescale_t": 8.0,
        },
        "texture_size": 4096,
    }
    t2_adapter = Trellis2ImageToRawMeshAdapter(vram_requirement=23552)
    t2_schema = t2_adapter.get_parameter_schema()["parameters"]
    assert t2_schema["pipeline_type"]["default"] == "1536_cascade"
    assert t2_schema["pipeline_type"]["readOnly"] is True
    assert t2_schema["max_num_tokens"]["default"] == 524288
    assert t2_schema["max_num_tokens"]["readOnly"] is True
    assert t2_schema["decimation_target"]["default"] == -1
    assert t2_schema["decimation_target"]["readOnly"] is True
    assert t2_schema["remesh"]["default"] is False
    assert t2_schema["remesh"]["readOnly"] is True


def test_pixal3d_and_unique3d_and_taoflowforge_use_adapter_owned_profiles():
    from adapters.pixal3d_adapter import _LOCKED_INFERENCE_PROFILE as pixal_profile, Pixal3DImageToRawMeshAdapter
    from adapters.unique3d_adapter import _LOCKED_INFERENCE_PROFILE as unique_profile, Unique3DImageToRawMeshAdapter
    from adapters.taoflowforge_adapter import _LOCKED_INFERENCE_PROFILE as tff_profile, TaoFlowForgeImageToRawMeshAdapter

    assert pixal_profile["resolution"] == 2048
    assert pixal_profile["pipeline_type"] == "1536_cascade"
    assert pixal_profile["low_vram"] is False
    assert pixal_profile["sampler_overrides"]["sparse_structure"]["steps"] == 100
    p_adapter = Pixal3DImageToRawMeshAdapter(vram_requirement=16384)
    p_schema = p_adapter.get_parameter_schema()["parameters"]
    assert p_schema["resolution"]["default"] == 2048
    assert p_schema["resolution"]["readOnly"] is True
    assert p_schema["pipeline_type"]["default"] == "1536_cascade"
    assert p_schema["pipeline_type"]["readOnly"] is True
    assert p_schema["low_vram"]["default"] is False
    assert p_schema["low_vram"]["readOnly"] is True

    assert unique_profile == {
        "source_quality": "max", "input_processing": True, "do_refine": True,
        "expansion_weight": 0.1, "init_type": "std", "low_vram": False,
    }
    u_adapter = Unique3DImageToRawMeshAdapter(vram_requirement=10240)
    u_schema = u_adapter.get_parameter_schema()["parameters"]
    assert u_schema["input_processing"]["default"] is True
    assert u_schema["input_processing"]["readOnly"] is True
    assert u_schema["do_refine"]["default"] is True
    assert u_schema["do_refine"]["readOnly"] is True
    assert u_schema["expansion_weight"]["default"] == 0.1
    assert u_schema["expansion_weight"]["readOnly"] is True

    assert tff_profile == {
        "source_quality": "max", "fill_holes": True, "offload": "auto", "low_vram": False,
    }
    tff_adapter = TaoFlowForgeImageToRawMeshAdapter(vram_requirement=20480)
    tff_schema = tff_adapter.get_parameter_schema()["parameters"]
    assert tff_schema["fill_holes"]["default"] is True
    assert tff_schema["fill_holes"]["readOnly"] is True
    assert tff_schema["offload"]["default"] == "auto"
    assert tff_schema["offload"]["readOnly"] is True


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
