import os
import sys
import types
from pathlib import Path
from unittest.mock import MagicMock, patch, call
from importlib.abc import MetaPathFinder, Loader
from importlib.machinery import ModuleSpec
from PIL import Image
import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
UNIQUE3D_ROOT = REPO_ROOT / "backend" / "thirdparty" / "Unique3D"
for p in [
    str(REPO_ROOT),
    str(REPO_ROOT / "backend"),
    str(UNIQUE3D_ROOT),
    str(UNIQUE3D_ROOT / "app"),
    str(UNIQUE3D_ROOT / "scripts"),
]:
    if p not in sys.path:
        sys.path.insert(0, p)


class MockModule(types.ModuleType):
    def __init__(self, name):
        super().__init__(name)
        self.__path__ = []

    def __getattr__(self, name):
        val = MagicMock(name=f"{self.__name__}.{name}")
        setattr(self, name, val)
        return val


class MockFinder(MetaPathFinder):
    MOCK_PREFIXES = (
        "pytorch3d",
        "diffusers",
        "transformers",
        "rembg",
        "nvdiffrast",
        "torch_scatter",
        "pymeshlab",
        "datasets",
        "wandb",
        "omegaconf",
        "jaxtyping",
        "typeguard",
    )

    def find_spec(self, fullname, path, target=None):
        if any(fullname == p or fullname.startswith(p + ".") for p in self.MOCK_PREFIXES):
            return ModuleSpec(fullname, MockLoader(), is_package=True)
        return None


class MockLoader(Loader):
    def create_module(self, spec):
        return MockModule(spec.name)

    def exec_module(self, module):
        pass


sys.meta_path.insert(0, MockFinder())

if "app.custom_models.utils" not in sys.modules:
    sys.modules["app.custom_models.utils"] = MockModule("app.custom_models.utils")


def test_pytorch_cuda_alloc_conf_expandable_segments():
    """Verify PYTORCH_CUDA_ALLOC_CONF includes expandable_segments:True."""
    from backend.adapters import unique3d_adapter
    alloc_conf = os.environ.get("PYTORCH_CUDA_ALLOC_CONF", "")
    assert "expandable_segments:True" in alloc_conf


def test_predict_normals_sequential_batching_and_slicing():
    """Verify predict_normals iterates sequentially per image to avoid 4GiB+ OOM spikes."""
    import app.custom_models.normal_prediction as np_mod

    mock_pipe = MagicMock()
    mock_pipe.device.type = "cuda"
    mock_trainer = MagicMock()

    dummy_out_img = Image.new("RGB", (512, 512), color=(128, 128, 255))
    mock_trainer.pipeline_forward.side_effect = lambda pipeline, image, **kwargs: MagicMock(
        images=[dummy_out_img]
    )

    test_imgs = [
        Image.new("RGB", (512, 512), color=(255, 0, 0)),
        Image.new("RGB", (512, 512), color=(0, 255, 0)),
        Image.new("RGB", (512, 512), color=(0, 0, 255)),
        Image.new("RGB", (512, 512), color=(255, 255, 0)),
    ]

    with patch.object(np_mod, "get_pipeline", return_value=(mock_trainer, mock_pipe)), \
         patch("app.custom_models.normal_prediction.rotate_normals_torch", side_effect=lambda x, **kw: x), \
         patch("app.custom_models.normal_prediction.simple_remove", side_effect=lambda x: x), \
         patch("torch.cuda.is_available", return_value=True), \
         patch("torch.cuda.empty_cache") as mock_empty_cache:

        results = np_mod.predict_normals(test_imgs, guidance_scale=1.5, num_inference_steps=20)

        # Ensure attention slicing and VAE slicing/tiling were attempted
        mock_pipe.enable_attention_slicing.assert_called_with(1)
        mock_pipe.enable_vae_slicing.assert_called_once()
        mock_pipe.enable_vae_tiling.assert_called_once()

        # Ensure pipeline_forward was called exactly 4 times, each with 1 image
        assert mock_trainer.pipeline_forward.call_count == 4
        for call_args in mock_trainer.pipeline_forward.call_args_list:
            assert len(call_args.kwargs["image"]) == 1

        # Ensure empty_cache was called per iteration
        assert mock_empty_cache.call_count >= 4
        assert len(results) == 4


def test_unique3d_adapter_unconditional_cpu_offload(tmp_path):
    """Verify unique3d adapter unconditionally offloads mvimg and normal models to CPU."""
    from backend.adapters.unique3d_adapter import Unique3DAdapter

    adapter = Unique3DAdapter(
        model_path=str(REPO_ROOT / "pretrained" / "Unique3D"),
        vram_requirement=12,
    )
    # Explicitly test when low_vram_mode is False (high VRAM GPU like 16GB/24GB)
    adapter.low_vram_mode = False

    mock_mvimg_pipe = MagicMock()
    mock_mvimg_trainer = MagicMock()
    mock_normal_pipe = MagicMock()
    mock_normal_trainer = MagicMock()

    adapter.mvimg_pipeline = mock_mvimg_pipe
    adapter.mvimg_trainer = mock_mvimg_trainer
    adapter.normal_pipeline = mock_normal_pipe
    adapter.normal_trainer = mock_normal_trainer

    dummy_img = Image.new("RGBA", (512, 512), color=(200, 200, 200, 200))
    img_file = tmp_path / "test_input.png"
    dummy_img.save(img_file)
    glb_file = tmp_path / "output.glb"
    glb_file.write_text("dummy glb")

    mock_mesh = MagicMock()
    mock_mesh.verts_packed.return_value = MagicMock(__truediv__=MagicMock(return_value=MagicMock(__mul__=MagicMock(return_value=MagicMock()))))
    mock_mesh.faces_list.return_value = []
    mock_mesh.textures = None

    with patch.object(adapter, "_run_super_resolution", return_value=[dummy_img]), \
         patch.object(adapter, "_run_multiview_prediction", return_value=([dummy_img]*4, dummy_img)), \
         patch.object(adapter, "_run_geo_reconstruct", return_value=mock_mesh), \
         patch("scripts.utils.save_glb_and_video", return_value=(str(glb_file), None)), \
         patch("pytorch3d.structures.Meshes", return_value=mock_mesh), \
         patch("torch.cuda.is_available", return_value=True), \
         patch("torch.cuda.empty_cache") as mock_empty_cache, \
         patch("torch.cuda.ipc_collect") as mock_ipc_collect, \
         patch.object(adapter.mesh_processor, "get_mesh_stats", return_value={"vertex_count": 100, "face_count": 200}), \
         patch.object(adapter.mesh_processor, "load_mesh", return_value=MagicMock()):

        adapter._process_request({
            "image_path": str(img_file),
            "seed": 1145,
            "input_processing": True,
            "do_refine": False,
            "expansion_weight": 0.1,
            "init_type": "std"
        })

        # Multiview pipeline and trainer must be offloaded to CPU after mvimg prediction
        mock_mvimg_pipe.to.assert_called_with("cpu")
        mock_mvimg_trainer.to.assert_called_with("cpu")

        # Normal pipeline and trainer must be moved to cuda for reconstruction, then offloaded to CPU
        assert call("cpu") in mock_normal_pipe.to.call_args_list
        assert call("cpu") in mock_normal_trainer.to.call_args_list
        assert mock_empty_cache.call_count >= 2
        assert mock_ipc_collect.call_count >= 2
