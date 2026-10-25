import sys
import types
from pathlib import Path
from unittest.mock import MagicMock, patch
from importlib.abc import MetaPathFinder, Loader
from importlib.machinery import ModuleSpec
from PIL import Image
import pytest
torch = pytest.importorskip("torch", reason="torch is required for Unique3D tests")
pymeshlab = pytest.importorskip("pymeshlab", reason="pymeshlab is required for Unique3D tests")
if not hasattr(torch, "float16"):
    pytest.skip("torch does not have float16", allow_module_level=True)

# Ensure repo root and Unique3D paths are accessible
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
    MOCK_PREFIXES = ("pytorch3d", "diffusers", "transformers", "rembg", "nvdiffrast", "torch_scatter")

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
if "app.custom_models.normal_prediction" not in sys.modules:
    sys.modules["app.custom_models.normal_prediction"] = MockModule("app.custom_models.normal_prediction")


@pytest.fixture
def sample_rgbs():
    # 4 views: front, right, back, left (RGB)
    return [
        Image.new("RGB", (256, 256), color=(255, 0, 0)),
        Image.new("RGB", (256, 256), color=(0, 255, 0)),
        Image.new("RGB", (256, 256), color=(0, 0, 255)),
        Image.new("RGB", (256, 256), color=(255, 255, 0)),
    ]


@pytest.fixture
def sample_front():
    # Front RGBA image with some transparent background so mean alpha < 250
    img = Image.new("RGBA", (512, 512), color=(200, 200, 200, 200))
    return img


def test_refine_rgb_fallback_when_pipeline_is_none(sample_rgbs, sample_front):
    """Verify refine_rgb returns resized 512x512 images directly when pipe is None."""
    from scripts.multiview_inference import refine_rgb
    from app.all_models import model_zoo

    with patch.object(model_zoo, "pipe_disney_controlnet_tile_ipadapter_i2i", None):
        result = refine_rgb(sample_rgbs, sample_front)
        assert len(result) == 4
        for img in result:
            assert img.size == (512, 512)


def test_refine_rgb_fallback_when_pipeline_fails(sample_rgbs, sample_front):
    """Verify refine_rgb catches runtime errors in pipe/inference and cleanly falls back."""
    from scripts.multiview_inference import refine_rgb
    from app.all_models import model_zoo

    failing_pipe = MagicMock(side_effect=RuntimeError("CUDA OOM or model execution failed"))
    with patch.object(model_zoo, "pipe_disney_controlnet_tile_ipadapter_i2i", failing_pipe):
        result = refine_rgb(sample_rgbs, sample_front)
        assert len(result) == 4
        for img in result:
            assert img.size == (512, 512)


def test_geo_reconstruct_safeguard_when_pipe_is_none(sample_rgbs, sample_front):
    """Verify geo_reconstruct executes without TypeError when do_refine=True and pipe is None."""
    import scripts.multiview_inference as mvi
    from app.all_models import model_zoo

    dummy_normals = [
        Image.new("RGBA", (2048, 2048), color=(128, 128, 255, 200)) for _ in range(4)
    ]
    mock_mesh = MagicMock(name="MockSceneMesh")

    with patch.object(model_zoo, "pipe_disney_controlnet_tile_ipadapter_i2i", None), \
         patch.object(mvi, "run_sr_fast", side_effect=lambda imgs: [img.resize((2048, 2048)) for img in imgs]), \
         patch.object(mvi, "predict_normals", return_value=dummy_normals), \
         patch.object(mvi, "fast_geo", return_value=mock_mesh), \
         patch.object(mvi, "multiview_color_projection", return_value=mock_mesh), \
         patch.object(mvi, "from_py3d_mesh", return_value=(MagicMock(), MagicMock(), None)), \
         patch.object(mvi, "reconstruct_stage1", return_value=(MagicMock(), MagicMock())), \
         patch.object(mvi, "run_mesh_refine", return_value=(MagicMock(), MagicMock())), \
         patch.object(mvi, "to_pyml_mesh", return_value=MagicMock()), \
         patch.object(mvi, "simple_clean_mesh", return_value=MagicMock(to=MagicMock(return_value=mock_mesh))), \
         patch.object(mvi, "get_cameras_list", return_value=[]):

        mesh_out = mvi.geo_reconstruct(
            rgb_pils=sample_rgbs,
            normal_pils=None,
            front_pil=sample_front,
            do_refine=True,
            predict_normal=True,
        )
        assert mesh_out is mock_mesh


def test_unique3d_adapter_run_geo_reconstruct_safeguard(sample_rgbs, sample_front):
    """Verify Unique3DAdapter._run_geo_reconstruct disables refinement and executes safely."""
    from backend.adapters.unique3d_adapter import Unique3DAdapter
    from app.all_models import model_zoo

    adapter = Unique3DAdapter(
        model_path=str(REPO_ROOT / "pretrained" / "Unique3D"),
        vram_requirement=12,
    )
    mock_mesh = MagicMock(name="MockFinalMesh")

    with patch.object(model_zoo, "pipe_disney_controlnet_tile_ipadapter_i2i", None), \
         patch("scripts.multiview_inference.geo_reconstruct", return_value=mock_mesh) as mock_geo:

        result = adapter._run_geo_reconstruct(
            rgb_pils=sample_rgbs,
            normal_pils=None,
            front_pil=sample_front,
            do_refine=True,
            predict_normal=True,
            expansion_weight=0.1,
            init_type="std",
        )

        assert result is mock_mesh
        # Verify do_refine was demoted to False because pipe is None
        mock_geo.assert_called_once_with(
            rgb_pils=sample_rgbs,
            normal_pils=None,
            front_pil=sample_front,
            do_refine=False,
            predict_normal=True,
            expansion_weight=0.1,
            init_type="std",
        )
