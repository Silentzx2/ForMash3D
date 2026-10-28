"""Focused regression tests for Pixal3D image preprocessing and mesh output handling."""

import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import MagicMock

import numpy as np
import pytest
import torch
import trimesh
from PIL import Image

import adapters.pixal3d_adapter as pixal_module
from adapters.pixal3d_adapter import Pixal3DImageToRawMeshAdapter


def _make_adapter(tmp_path: Path) -> Pixal3DImageToRawMeshAdapter:
    adapter = Pixal3DImageToRawMeshAdapter(
        vram_requirement=8192,
        model_path=str(tmp_path / "pretrained"),
        pixal3d_root=str(tmp_path / "thirdparty" / "Pixal3D"),
    )
    adapter.path_generator.base_output_dir = tmp_path / "outputs"
    return adapter


def test_process_request_preprocesses_and_centers_image(monkeypatch, tmp_path: Path):
    image_path = tmp_path / "wide_input.png"
    Image.new("RGB", (1200, 300), color=(220, 140, 80)).save(image_path)

    pipeline_calls = []
    adapter = _make_adapter(tmp_path)
    adapter.pipeline = SimpleNamespace(
        preprocess_image=lambda image: (
            pipeline_calls.append((image.mode, image.size))
            or Image.new("RGB", (220, 100), color=(40, 40, 40))
        )
    )
    monkeypatch.setattr(pixal_module.torch.cuda, "is_available", lambda: True)

    generated_glb = tmp_path / "mock_output.glb"
    trimesh.creation.box().export(str(generated_glb), file_type="glb")
    captured = {}

    def fake_run(image, *, seed, camera_params):
        captured["image"] = image.copy()
        captured["seed"] = seed
        captured["camera_params"] = camera_params
        return str(generated_glb), 1536

    camera_calls = []
    monkeypatch.setattr(
        adapter,
        "_estimate_camera_params",
        lambda path, manual_fov: (
            camera_calls.append((path, manual_fov))
            or {"camera_angle_x": 0.8, "distance": 1.0, "mesh_scale": 1.0}
        ),
    )
    monkeypatch.setattr(adapter, "_run_inference", fake_run)

    result = adapter._process_request({"image_path": str(image_path)})

    assert result["success"] is True
    assert pipeline_calls == [("RGBA", (1200, 300))]
    assert camera_calls == [(str(image_path), None)]
    assert captured["image"].mode == "RGBA"
    assert captured["image"].size == (512, 512)
    assert result["generation_info"]["original_input_size"] == [1200, 300]
    assert result["generation_info"]["inference_input_size"] == [512, 512]
    assert result["generation_info"]["effective_geometry_resolution"] == 1536


def _install_fake_o_voxel(monkeypatch):
    class FakeGLB:
        def apply_transform(self, transform):
            self.transform = transform

        def export(self, path, extension_webp=True):
            Path(path).write_bytes(b"mock glb")

    glb_calls = []
    voxel = ModuleType("o_voxel")
    voxel.postprocess = SimpleNamespace(
        to_glb=lambda **kwargs: (glb_calls.append(kwargs) or FakeGLB())
    )
    monkeypatch.setitem(sys.modules, "o_voxel", voxel)
    return glb_calls


def test_run_inference_accepts_single_mesh_and_rejects_empty_output(monkeypatch, tmp_path: Path):
    glb_calls = _install_fake_o_voxel(monkeypatch)
    adapter = _make_adapter(tmp_path)
    mesh = SimpleNamespace(
        vertices=np.zeros((3, 3), dtype=np.float32),
        faces=np.array([[0, 1, 2]], dtype=np.int32),
        attrs=np.zeros((3, 4), dtype=np.float32),
        coords=np.zeros((3, 3), dtype=np.int32),
        voxel_size=1.0 / 1536,
    )
    pipeline_results = [[mesh]]

    def custom_pipeline_run(
        image,
        camera_params,
        num_samples=1,
        seed=42,
        sparse_structure_sampler_params=None,
        shape_slat_sampler_params=None,
        tex_slat_sampler_params=None,
        preprocess_image=True,
        return_latent=False,
        pipeline_type=None,
        max_num_tokens=49152,
    ):
        return pipeline_results[0]

    pipeline = SimpleNamespace(run=custom_pipeline_run, pbr_attr_layout={})
    adapter.pipeline = pipeline

    output_path, effective_resolution = adapter._run_inference(
        Image.new("RGB", (512, 512)),
        seed=42,
        camera_params={"camera_angle_x": 0.8, "distance": 1.0, "mesh_scale": 1.0},
    )
    assert Path(output_path).is_file()
    assert effective_resolution == 1536
    assert glb_calls[0]["grid_size"] == 1536

    pipeline_results[0] = []
    with pytest.raises(RuntimeError, match="returned no meshes"):
        adapter._run_inference(
            Image.new("RGB", (512, 512)),
            seed=42,
            camera_params={"camera_angle_x": 0.8, "distance": 1.0, "mesh_scale": 1.0},
        )
