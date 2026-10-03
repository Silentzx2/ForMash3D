import io
import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace

import numpy as np
import pytest
import trimesh
from PIL import Image

from adapters.hunyuan3d_paint_v21 import Hunyuan3DPaintV21ImageMeshPaintingAdapter
from adapters.trellis2_adapter import Trellis2ImageToTexturedMeshAdapter
from adapters.triposf_adapter import TripoSFImageToRawMeshAdapter
from adapters.triposr_adapter import TripoSRImageToRawMeshAdapter


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
