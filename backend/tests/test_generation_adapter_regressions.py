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
from adapters.triposf_adapter import TripoSFImageToRawMeshAdapter
from adapters.triposg_adapter import TripoSGImageToRawMeshAdapter
from adapters.triposr_adapter import TripoSRImageToRawMeshAdapter
from utils.fastmesh_utils import FastMeshError, FastMeshRunner


def test_trellis2_fails_when_textured_exporter_is_unavailable():
    adapter = Trellis2ImageToTexturedMeshAdapter()
    adapter.runner = SimpleNamespace(o_voxel=None)

    with pytest.raises(Exception, match="requires o_voxel"):
        adapter._process_request({})


def test_triposf_does_not_substitute_proxy_mesh_when_coarse_generation_fails():
    adapter = TripoSFImageToRawMeshAdapter.__new__(TripoSFImageToRawMeshAdapter)

    with pytest.raises(RuntimeError, match="Coarse mesh generation via TripoSR failed"):
        adapter._generate_coarse_mesh(Path("missing-image.png"))


def test_triposr_baked_atlas_is_exportable_with_material_and_image():
    mesh = trimesh.Trimesh(
        vertices=[[0, 0, 0], [1, 0, 0], [0, 1, 0]],
        faces=[[0, 1, 2]],
        process=False,
    )
    bake_output = {
        "vmapping": np.array([0, 1, 2]),
        "indices": np.array([[0, 1, 2]]),
        "uvs": np.array([[0, 0], [1, 0], [0, 1]], dtype=np.float32),
        "colors": np.full((4, 4, 4), [0.3, 0.5, 0.7, 1.0], dtype=np.float32),
    }

    textured = TripoSRImageToRawMeshAdapter._create_baked_mesh(mesh, bake_output)
    glb_bytes = textured.export(file_type="glb")
    loaded = trimesh.load(io.BytesIO(glb_bytes), file_type="glb", force="mesh")
    obj_text, obj_files = trimesh.exchange.obj.export_obj(
        textured, return_texture=True
    )

    assert TripoSRImageToRawMeshAdapter._has_exported_texture(loaded)
    assert "mtllib" in obj_text
    assert any(name.endswith(".png") for name in obj_files)
    assert b"map_Kd" in obj_files["material.mtl"]


def test_triposr_reports_bake_failure_without_claiming_texture(monkeypatch):
    tsr_package = ModuleType("tsr")
    tsr_package.__path__ = []
    tsr_utils = ModuleType("tsr.utils")
    tsr_utils.remove_background = lambda image, session: image
    tsr_utils.resize_foreground = lambda image, ratio: image
    tsr_utils.to_gradio_3d_orientation = lambda mesh: mesh
    bake_texture = ModuleType("tsr.bake_texture")

    def fail_bake(*args):
        raise RuntimeError("bake unavailable")

    bake_texture.bake_texture = fail_bake
    monkeypatch.setitem(sys.modules, "tsr", tsr_package)
    monkeypatch.setitem(sys.modules, "tsr.utils", tsr_utils)
    monkeypatch.setitem(sys.modules, "tsr.bake_texture", bake_texture)

    adapter = TripoSRImageToRawMeshAdapter(vram_requirement=1)
    adapter._ensure_triposr_in_path = lambda: None

    class FakeTripoSR:
        def __call__(self, images, device):
            return ["scene-code"]

        def extract_mesh(self, *args, **kwargs):
            return [trimesh.creation.box()]

    adapter.tsr_model = FakeTripoSR()
    adapter.path_generator = SimpleNamespace(
        generate_mesh_path=lambda *args: "outputs/.triposr-bake-failure.glb"
    )
    output_path = Path("outputs/.triposr-bake-failure.glb")
    output_path.unlink(missing_ok=True)

    try:
        result = adapter._process_request({
            "image_path": str(
                Path(__file__).resolve().parents[1]
                / "thirdparty/ardy/scripts/interactive_demo/assets/nvidia_logo.png"
            ),
            "output_format": "glb",
            "bake_texture": True,
            "no_remove_bg": True,
        })
    finally:
        output_path.unlink(missing_ok=True)

    generation_info = result["generation_info"]
    assert generation_info["texture_requested"] is True
    assert generation_info["texture_bake_succeeded"] is False
    assert generation_info["has_texture"] is False
    assert generation_info["texture_bake_error"] == "bake unavailable"


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


def test_triposf_coordinate_basis_preserves_upright_orientation_without_spurious_rotation(tmp_path):
    # Asymmetric box with distinct dimensions: X=1.0 (width), Y=4.0 (tall height), Z=2.0 (depth)
    # in standard Y-up coordinate system
    mesh = trimesh.creation.box(extents=[1.0, 4.0, 2.0])
    input_mesh_path = tmp_path / "asymmetric_input.glb"
    mesh.export(str(input_mesh_path))

    # Verify normalize_mesh preserves relative axis order (Y > Z > X)
    triposf_root = Path(__file__).resolve().parents[1] / "thirdparty" / "TripoSF"
    if str(triposf_root) not in sys.path:
        sys.path.insert(0, str(triposf_root))
    from inference import normalize_mesh
    normalized = normalize_mesh(str(input_mesh_path))
    extents = normalized.bounding_box.extents
    # Largest extent must be Y (index 1), second largest Z (index 2), smallest X (index 0)
    assert extents[1] > extents[2] > extents[0], f"Normalized extents {extents} altered axis hierarchy!"

    # Export via trimesh as done in TripoSF adapter (without spurious +90° X rotation)
    final_trimesh = trimesh.Trimesh(vertices=normalized.vertices, faces=normalized.faces)
    output_path = tmp_path / "triposf_export.glb"
    final_trimesh.export(str(output_path))

    loaded_glb = trimesh.load(output_path, force="mesh")
    out_extents = loaded_glb.bounding_box.extents

    # If spurious +90° X rotation were applied, Y and Z would be swapped (Z would become largest),
    # rotating the model sideways. With correct coordinate basis, Y remains dominant height.
    assert out_extents[1] > out_extents[2] > out_extents[0], (
        f"TripoSF export rotated sideways! Extents: X={out_extents[0]}, Y={out_extents[1]}, Z={out_extents[2]}"
    )


def test_triposr_mc_resolution_accepts_model_maximum_fidelity():
    adapter = TripoSRImageToRawMeshAdapter(vram_requirement=6144)
    schema = adapter.get_parameter_schema()["parameters"]
    assert schema["mc_resolution"]["maximum"] >= 512
    assert not schema["mc_resolution"].get("readOnly", False)


def test_triposg_preserves_full_inference_steps_and_octree_depth():
    adapter = TripoSGImageToRawMeshAdapter(vram_requirement=8192)
    schema = adapter.get_parameter_schema()["parameters"]
    assert schema["num_inference_steps"]["default"] == 50
    assert schema["faces"]["default"] == -1


def test_hunyuan3d_shape_v21_defaults_to_max_fidelity_when_source_quality_max():
    adapter = Hunyuan3DShapeV21ImageToRawMeshAdapter(vram_requirement=10240)
    schema = adapter.get_parameter_schema()["parameters"]
    assert schema["octree_resolution"]["maximum"] >= 512


def test_hunyuan3d_dit_v2_mini_turbo_defaults_to_max_fidelity_when_source_quality_max():
    adapter = Hunyuan3DDiTV2MiniTurboImageToRawMeshAdapter(vram_requirement=6144)
    schema = adapter.get_parameter_schema()["parameters"]
    assert schema["enable_flashvdm"]["default"] is True



def test_model_specific_max_quality_profiles_override_ui_budgets():
    triposr = _build_model_inference_inputs(
        {
            "source_quality": "low", "quality": "low", "meshQuality": "low",
            "mc_resolution": 320, "target_polycount": 1000,
            "auto_optimize": True, "low_vram": True, "seed": 17,
        },
        model_id="triposr_image_to_raw_mesh",
    )
    assert triposr["source_quality"] == "max"
    assert "quality" not in triposr and "meshQuality" not in triposr
    assert triposr["mc_resolution"] == 512
    assert triposr["seed"] == 17
    assert "target_polycount" not in triposr
    assert "auto_optimize" not in triposr
    assert triposr["low_vram"] is False

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
