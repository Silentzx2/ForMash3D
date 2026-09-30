"""
Self-check for torchmcubes fallback and torch_scatter compatibility shims.
Validates that TripoSR isosurface extraction and TripoSF pointnet scatter operations
run cleanly even without torchmcubes or with C++ ABI-mismatched torch_scatter.
"""

import sys
from pathlib import Path
import torch
import numpy as np

# Ensure backend root is on sys.path
backend_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "thirdparty" / "TripoSR"))
sys.path.insert(0, str(backend_root / "thirdparty" / "TripoSF"))

def test_torch_scatter_shim():
    # 1. Test core.config loading and torch_scatter shim
    import core.config
    import torch_scatter

    # Verify torch_scatter functions exist and work
    src = torch.randn(2, 64, 100)
    index = torch.randint(0, 20, (2, 1, 100))
    out = torch.zeros(2, 64, 20)

    mean_res = torch_scatter.scatter_mean(src, index, dim=-1, out=out)
    assert mean_res.shape == (2, 64, 20), f"Unexpected scatter_mean shape: {mean_res.shape}"


def test_triposf_pointnet_execution():
    # 2. Test TripoSF pointnet import and execution directly
    import importlib.util
    pointnet_path = backend_root / "thirdparty" / "TripoSF" / "triposf" / "modules" / "pointclouds" / "pointnet.py"
    spec = importlib.util.spec_from_file_location("triposf.modules.pointclouds.pointnet", str(pointnet_path))
    pointnet_mod = importlib.util.module_from_spec(spec)
    sys.modules["triposf.modules.pointclouds.pointnet"] = pointnet_mod
    spec.loader.exec_module(pointnet_mod)

    LocalPoolPointnet = pointnet_mod.LocalPoolPointnet
    pn = LocalPoolPointnet(in_channels=3, out_channels=32, hidden_dim=32)
    sparse_coords = torch.zeros((50, 4), dtype=torch.int64)
    c = torch.randn(1, 50, 32)
    index_p = torch.randint(0, 50, (1, 1, 50))
    pooled = pn.pool_sparse_local(index_p, c, max_coord_num=50)
    assert pooled.shape == (1, 50, 32), f"Unexpected pool_sparse_local shape: {pooled.shape}"


def test_triposr_marchingcubehelper_fallback():
    # 3. Test TripoSR MarchingCubeHelper fallback
    from tsr.models.isosurface import MarchingCubeHelper
    mc = MarchingCubeHelper(resolution=16)
    # Generate level values with an isosurface passing through 0
    level = torch.randn(16, 16, 16)
    v_pos, t_pos_idx = mc(level)
    assert v_pos.dim() == 2 and v_pos.shape[-1] == 3, f"Unexpected v_pos shape: {v_pos.shape}"
    assert t_pos_idx.dim() == 2 and t_pos_idx.shape[-1] == 3, f"Unexpected t_pos_idx shape: {t_pos_idx.shape}"


if __name__ == "__main__":
    test_torch_scatter_shim()
    print("✓ torch_scatter shim checks passed")
    test_triposf_pointnet_execution()
    print("✓ TripoSF PointNet execution check passed")
    test_triposr_marchingcubehelper_fallback()
    print("✓ TripoSR MarchingCubeHelper fallback check passed")
    print("All checks passed successfully!")

