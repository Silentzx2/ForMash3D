import os
import sys
from pathlib import Path
import pytest
import torch

# Add backend directory to sys.path
backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))


def test_grid_sample_3d_torch_trilinear():
    from utils.flex_gemm_fallback import grid_sample_3d_torch

    # Create dummy voxel grid data
    # feats: [N, C]
    # coords: [N, 4] where col 0 is batch_idx, col 1..3 are (x, y, z)
    feats = torch.randn(27, 8, dtype=torch.float32)
    coords_list = []
    idx = 0
    for x in range(3):
        for y in range(3):
            for z in range(3):
                coords_list.append([0, x, y, z])
                idx += 1
    coords = torch.tensor(coords_list, dtype=torch.int32)
    voxel_shape = [3, 3, 3]

    # Sample query points within [0, 2]
    # query_coords: [B, P, 3]
    query = torch.tensor([[[0.5, 0.5, 0.5], [1.0, 1.0, 1.0], [1.5, 1.2, 0.8]]], dtype=torch.float32)

    sampled = grid_sample_3d_torch(feats, coords, voxel_shape, query, mode="trilinear")
    assert sampled.shape == (1, 3, 8), f"Expected shape (1, 3, 8), got {sampled.shape}"
    assert not torch.isnan(sampled).any(), "Sampled output contains NaN"


def test_grid_sample_3d_torch_nearest():
    from utils.flex_gemm_fallback import grid_sample_3d_torch

    feats = torch.arange(8 * 4, dtype=torch.float32).reshape(8, 4)
    coords_list = []
    for x in range(2):
        for y in range(2):
            for z in range(2):
                coords_list.append([0, x, y, z])
    coords = torch.tensor(coords_list, dtype=torch.int32)
    voxel_shape = [2, 2, 2]

    query = torch.tensor([[[0.1, 0.1, 0.1], [0.9, 0.9, 0.9]]], dtype=torch.float32)
    sampled = grid_sample_3d_torch(feats, coords, voxel_shape, query, mode="nearest")
    assert sampled.shape == (1, 2, 4)
    # Point near (0,0,0) should equal feats[0]
    torch.testing.assert_close(sampled[0, 0], feats[0])
    # Point near (1,1,1) should equal feats[-1]
    torch.testing.assert_close(sampled[0, 1], feats[-1])


def test_install_flex_gemm_shim():
    from utils.flex_gemm_fallback import install_flex_gemm_shim

    assert install_flex_gemm_shim() is True
    assert "flex_gemm" in sys.modules
    assert "flex_gemm.ops" in sys.modules
    assert "flex_gemm.ops.grid_sample" in sys.modules

    # Test that standard import works seamlessly
    from flex_gemm.ops.grid_sample import grid_sample_3d
    assert callable(grid_sample_3d)


def test_torchvision_fix_flex_gemm():
    from utils.torchvision_fix import fix_flex_gemm, get_grid_sample_3d

    assert fix_flex_gemm() is True
    grid_sample_3d = get_grid_sample_3d()
    assert callable(grid_sample_3d)
