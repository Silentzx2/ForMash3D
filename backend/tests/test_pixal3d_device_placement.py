"""Source-contract tests for the custom Pixal3D multi-GPU device handoff."""

from pathlib import Path


def test_custom_pixal3d_encoders_use_their_model_device():
    repository_root = Path(__file__).resolve().parents[2]
    thirdparty_root = repository_root / "backend" / "thirdparty" / "Pixal3D"
    source = (
        thirdparty_root
        / "pixal3d"
        / "trainers"
        / "flow_matching"
        / "mixins"
        / "image_conditioned_proj.py"
    ).read_text(encoding="utf-8")

    assert "torch.stack(image).cuda()" not in source
    assert "torch.stack(image).to(device=next(self.model.parameters()).device)" in source
    assert "torch.stack(image).to(device=next(self.dino_model.parameters()).device)" in source


def test_custom_pixal3d_projection_tensors_follow_condition_encoder_device():
    repository_root = Path(__file__).resolve().parents[2]
    source = (
        repository_root
        / "backend"
        / "thirdparty"
        / "Pixal3D"
        / "pixal3d"
        / "pipelines"
        / "pixal3d_image_to_3d.py"
    ).read_text(encoding="utf-8")

    assert source.count("device = next(image_cond_model.parameters()).device") >= 2
    assert "coords_on_device = coords.to(device)" in source
    assert "SparseTensor(feats=z_proj_sparse, coords=coords_on_device)" in source


def test_main_adapter_places_conditioners_with_their_flow_stage():
    repository_root = Path(__file__).resolve().parents[2]
    source = (
        repository_root
        / "backend"
        / "adapters"
        / "pixal3d_adapter.py"
    ).read_text(encoding="utf-8")

    for stage, conditioner in (
        ("sparse_structure_flow_model", "image_cond_model_ss"),
        ("shape_slat_flow_model_512", "image_cond_model_shape_512"),
        ("shape_slat_flow_model_1024", "image_cond_model_shape_1024"),
        ("tex_slat_flow_model_1024", "image_cond_model_tex_1024"),
    ):
        assert f'("{stage}", "{conditioner}")' in source

    assert "Could not place Pixal3D condition model" in source
    assert "Pixal3D failed to load a required NAF upsampler" in source



def test_pixal_custom_encoder_accepts_explicit_hf_cache():
    repository_root = Path(__file__).resolve().parents[2]
    thirdparty_root = repository_root / "backend" / "thirdparty" / "Pixal3D"
    encoder = (
        thirdparty_root
        / "pixal3d"
        / "trainers"
        / "flow_matching"
        / "mixins"
        / "image_conditioned_proj.py"
    ).read_text(encoding="utf-8")
    adapter = (
        repository_root
        / "backend"
        / "adapters"
        / "pixal3d_adapter.py"
    ).read_text(encoding="utf-8")

    assert "cache_dir: Optional[str] = None" in encoder
    assert "DINOv3ViTModel.from_pretrained(model_name, cache_dir=cache_dir)" in encoder
    assert 'config["cache_dir"] = str(hf_cache_dir)' in adapter
    assert "torch.hub.set_dir(str(torch_hub_cache_dir))" in adapter
    assert "Pixal3D requires writable model cache directories" in adapter
