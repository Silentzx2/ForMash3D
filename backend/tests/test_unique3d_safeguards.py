import sys
import types
from pathlib import Path
from unittest.mock import MagicMock, patch
from importlib.abc import MetaPathFinder, Loader
from importlib.machinery import ModuleSpec
from PIL import Image
import pytest
torch = pytest.importorskip("torch", reason="torch is required for Unique3D tests")
try:
    import pymeshlab
except ImportError:
    pymeshlab = None
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
    MOCK_PREFIXES = ("pytorch3d", "diffusers", "transformers", "rembg", "nvdiffrast", "torch_scatter", "pymeshlab")

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
if "app.custom_models" not in sys.modules:
    cm_mock = MockModule("app.custom_models")
    sys.modules["app.custom_models"] = cm_mock
    try:
        import app
        app.custom_models = cm_mock
    except Exception:
        pass
if "app.custom_models.normal_prediction" not in sys.modules:
    np_mock = MockModule("app.custom_models.normal_prediction")
    sys.modules["app.custom_models.normal_prediction"] = np_mock
    if "app.custom_models" in sys.modules:
        setattr(sys.modules["app.custom_models"], "normal_prediction", np_mock)


@pytest.fixture(scope="module", autouse=True)
def cleanup_sys_modules():
    yield
    for key in ["app.custom_models.normal_prediction", "app.custom_models"]:
        sys.modules.pop(key, None)
    if sys.meta_path and isinstance(sys.meta_path[0], MockFinder):
        sys.meta_path.pop(0)


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


def test_unique3d_adapter_run_geo_reconstruct_under_no_grad(sample_rgbs, sample_front):
    """Verify Unique3DAdapter._run_geo_reconstruct enables grad when called within torch.no_grad()."""
    from backend.adapters.unique3d_adapter import Unique3DAdapter

    adapter = Unique3DAdapter(
        model_path=str(REPO_ROOT / "pretrained" / "Unique3D"),
        vram_requirement=12,
    )
    
    grad_enabled_during_call = None
    def mock_geo(*args, **kwargs):
        nonlocal grad_enabled_during_call
        grad_enabled_during_call = torch.is_grad_enabled()
        return MagicMock()

    with torch.no_grad():
        with patch("scripts.multiview_inference.geo_reconstruct", side_effect=mock_geo):
            adapter._run_geo_reconstruct(
                rgb_pils=sample_rgbs,
                normal_pils=None,
                front_pil=sample_front,
                do_refine=False,
                predict_normal=False,
            )

    assert grad_enabled_during_call is True


def test_geo_reconstruct_enables_grad_around_stage1(sample_rgbs, sample_front):
    """Verify geo_reconstruct executes reconstruct_stage1 with grad enabled even when called under no_grad."""
    import scripts.multiview_inference as mvi
    from app.all_models import model_zoo

    dummy_normals = [
        Image.new("RGBA", (2048, 2048), color=(128, 128, 255, 200)) for _ in range(4)
    ]
    mock_mesh = MagicMock(name="MockSceneMesh")

    grad_enabled_in_stage1 = None
    def mock_stage1(*args, **kwargs):
        nonlocal grad_enabled_in_stage1
        grad_enabled_in_stage1 = torch.is_grad_enabled()
        return (MagicMock(), MagicMock())

    with torch.no_grad():
        with patch.object(model_zoo, "pipe_disney_controlnet_tile_ipadapter_i2i", None), \
             patch.object(mvi, "run_sr_fast", side_effect=lambda imgs: [img.resize((2048, 2048)) for img in imgs]), \
             patch.object(mvi, "predict_normals", return_value=dummy_normals), \
             patch.object(mvi, "fast_geo", return_value=mock_mesh), \
             patch.object(mvi, "multiview_color_projection", return_value=mock_mesh), \
             patch.object(mvi, "from_py3d_mesh", return_value=(MagicMock(), MagicMock(), None)), \
             patch.object(mvi, "reconstruct_stage1", side_effect=mock_stage1), \
             patch.object(mvi, "run_mesh_refine", return_value=(MagicMock(), MagicMock())), \
             patch.object(mvi, "to_pyml_mesh", return_value=MagicMock()), \
             patch.object(mvi, "simple_clean_mesh", return_value=MagicMock(to=MagicMock(return_value=mock_mesh))), \
             patch.object(mvi, "get_cameras_list", return_value=[]):

            mvi.geo_reconstruct(
                rgb_pils=sample_rgbs,
                normal_pils=None,
                front_pil=sample_front,
                do_refine=False,
                predict_normal=True,
            )

    assert grad_enabled_in_stage1 is True


def test_reconstruct_stage1_backward_under_outer_no_grad(sample_rgbs):
    """Verify reconstruct_stage1 loss.backward() succeeds when called within torch.no_grad()."""
    import mesh_reconstruction.recon as recon_mod

    verts = torch.randn(8, 3, requires_grad=True)
    verts.to = MagicMock(return_value=verts)
    faces = torch.tensor([[0, 1, 2], [2, 3, 0]], dtype=torch.long)
    faces.to = MagicMock(return_value=faces)

    class MockRenderer:
        def __init__(self, *args, **kwargs):
            pass
        def render(self, vertices, normals, faces):
            return (vertices.sum() * 0.01).unsqueeze(0).unsqueeze(0).unsqueeze(0).expand(4, 32, 32, 4)

    class MockMeshOptimizer:
        def __init__(self, vertices, faces, *args, **kwargs):
            self.vertices = vertices
            self.faces = faces
            self._lr = 0.3

        def zero_grad(self):
            self.vertices.grad = None

        def step(self):
            pass

        def remesh(self, poisson=False):
            return self.vertices, self.faces

    mock_target = torch.zeros(4, 32, 32, 4)

    with torch.no_grad():
        assert not torch.is_grad_enabled()
        with patch.object(recon_mod, "make_star_cameras_orthographic", return_value=(None, None)), \
             patch.object(recon_mod, "NormalsRenderer", MockRenderer), \
             patch.object(recon_mod, "MeshOptimizer", MockMeshOptimizer), \
             patch.object(recon_mod, "init_target", return_value=mock_target), \
             patch.object(recon_mod, "calc_vertex_normals", return_value=torch.zeros_like(verts)):

            out_verts, out_faces = recon_mod.reconstruct_stage1(
                sample_rgbs,
                steps=2,
                vertices=verts,
                faces=faces,
                return_mesh=False,
            )
            assert out_verts is not None
            assert out_faces is not None


def test_calc_w_over_h_clamping():
    """Verify calc_w_over_h prevents wafer collapse by clamping scale to [0.25, 0.85]."""
    import numpy as np
    from scripts.mesh_init import calc_w_over_h

    # Very thin image (ratio 0.05) should be clamped to at least 0.25
    thin_arr = np.zeros((400, 400, 4), dtype=np.uint8)
    thin_arr[50:350, 195:205, 3] = 255  # 10px wide by 300px tall
    scale_thin = calc_w_over_h(thin_arr)
    assert scale_thin >= 0.25

    # Very wide image (ratio 2.0) should be clamped to at most 0.85
    wide_arr = np.zeros((400, 400, 4), dtype=np.uint8)
    wide_arr[190:210, 50:350, 3] = 255
    scale_wide = calc_w_over_h(wide_arr)
    assert scale_wide <= 0.85


def test_save_py3dmesh_untextured_raw(tmp_path):
    """Verify save_py3dmesh_with_trimesh_fast produces clean untextured raw geometry when requested."""
    from scripts.utils import save_py3dmesh_with_trimesh_fast
    import trimesh

    verts = torch.tensor([[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]], dtype=torch.float32)
    faces = torch.tensor([[0, 1, 2]], dtype=torch.int64)

    mock_mesh = MagicMock()
    mock_mesh.verts_packed.return_value = verts
    mock_mesh.faces_packed.return_value = faces
    mock_mesh.verts_normals_packed.return_value = torch.empty(0)
    mock_mesh.textures = None

    out_file = str(tmp_path / "raw_mesh.glb")
    save_py3dmesh_with_trimesh_fast(mock_mesh, out_file, include_vertex_color=False)

    loaded = trimesh.load(out_file, force="mesh", process=False)
    assert isinstance(loaded, trimesh.Trimesh)
    assert len(loaded.vertices) == 3
    assert len(loaded.faces) == 1
    # Verify no vertex colors are forced onto raw untextured geometry
    assert not hasattr(loaded.visual, "vertex_colors") or loaded.visual.vertex_colors is None or loaded.visual.kind != "vertex"



