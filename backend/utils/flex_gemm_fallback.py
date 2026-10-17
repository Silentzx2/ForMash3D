"""
Fallback implementation for `flex_gemm.ops.grid_sample` (grid_sample_3d).

Provides a pure-PyTorch implementation of 3D sparse voxel grid sampling (trilinear and nearest)
when `flex_gemm` is not installed or the installed wheel lacks `flex_gemm.ops.grid_sample`.
"""

from __future__ import annotations

import logging
import sys
import types
from typing import Optional, Tuple, Union

import torch
import torch.nn.functional as F

logger = logging.getLogger(__name__)

HASHMAP_RATIO = 2.0


def set_hashmap_ratio(ratio: float):
    global HASHMAP_RATIO
    HASHMAP_RATIO = ratio


def grid_sample_3d_torch(
    feats: torch.Tensor,
    coords: torch.Tensor,
    shape: Union[torch.Size, Tuple[int, ...]],
    grid: torch.Tensor,
    mode: str = "trilinear",
) -> torch.Tensor:
    """
    Pure-PyTorch implementation of 3D sparse voxel grid sampling using parallel binary search.

    Args:
        feats: [N, C] tensor containing sparse voxel features
        coords: [N, 4] (batch, x, y, z) or [N, 3] coordinates
        shape: Spatial shape [B, C, W, H, D] or [W, H, D]
        grid: [B, L, 3] query coordinates
        mode: 'trilinear' or 'nearest'

    Returns:
        [B, L, C] tensor of sampled features
    """
    if coords.shape[-1] == 3:
        b_idx = torch.zeros_like(coords[..., :1])
        coords = torch.cat([b_idx, coords], dim=-1)

    if len(shape) == 5:
        B_shp, C_shp, W, H, D = shape
    elif len(shape) == 3:
        W, H, D = shape
    else:
        W, H, D = shape[-3:]

    W = int(W)
    H = int(H)
    D = int(D)

    stride_z = 1
    stride_y = D
    stride_x = H * D
    stride_b = W * H * D

    b = coords[:, 0].long()
    x = coords[:, 1].long()
    y = coords[:, 2].long()
    z = coords[:, 3].long()

    # Compute unique linear keys for sparse voxels and sort
    sparse_keys = b * stride_b + x * stride_x + y * stride_y + z
    sort_keys, sort_perm = torch.sort(sparse_keys)
    sorted_feats = feats[sort_perm]

    B_grid, L, _ = grid.shape
    q_b = torch.arange(B_grid, device=grid.device).view(B_grid, 1, 1).expand(B_grid, L, 1).long()

    if mode == "nearest":
        qx = torch.round(grid[..., 0]).long()
        qy = torch.round(grid[..., 1]).long()
        qz = torch.round(grid[..., 2]).long()
        valid_range = (qx >= 0) & (qx < W) & (qy >= 0) & (qy < H) & (qz >= 0) & (qz < D)
        query_keys = q_b.squeeze(-1) * stride_b + qx * stride_x + qy * stride_y + qz

        pos = torch.searchsorted(sort_keys, query_keys)
        pos = torch.clamp(pos, 0, max(0, len(sort_keys) - 1))
        matched = (sort_keys[pos] == query_keys) & valid_range

        out = torch.where(
            matched.unsqueeze(-1),
            sorted_feats[pos],
            torch.zeros(1, dtype=feats.dtype, device=feats.device),
        )
        return out
    else:
        # Trilinear interpolation
        x0 = torch.floor(grid[..., 0]).long()
        y0 = torch.floor(grid[..., 1]).long()
        z0 = torch.floor(grid[..., 2]).long()

        wx = (grid[..., 0] - x0.float()).unsqueeze(-1)
        wy = (grid[..., 1] - y0.float()).unsqueeze(-1)
        wz = (grid[..., 2] - z0.float()).unsqueeze(-1)

        C = feats.shape[-1]
        accum_feats = torch.zeros(B_grid, L, C, dtype=feats.dtype, device=feats.device)
        accum_weights = torch.zeros(B_grid, L, 1, dtype=feats.dtype, device=feats.device)

        for dx in (0, 1):
            cx = x0 + dx
            weight_x = wx if dx == 1 else (1.0 - wx)
            for dy in (0, 1):
                cy = y0 + dy
                weight_y = wy if dy == 1 else (1.0 - wy)
                for dz in (0, 1):
                    cz = z0 + dz
                    weight_z = wz if dz == 1 else (1.0 - wz)

                    corner_w = weight_x * weight_y * weight_z
                    valid_range = (cx >= 0) & (cx < W) & (cy >= 0) & (cy < H) & (cz >= 0) & (cz < D)
                    q_key = q_b.squeeze(-1) * stride_b + cx * stride_x + cy * stride_y + cz

                    pos = torch.searchsorted(sort_keys, q_key)
                    pos = torch.clamp(pos, 0, max(0, len(sort_keys) - 1))
                    matched = (sort_keys[pos] == q_key) & valid_range

                    f = torch.where(
                        matched.unsqueeze(-1),
                        sorted_feats[pos],
                        torch.zeros(1, dtype=feats.dtype, device=feats.device),
                    )
                    w = torch.where(
                        matched.unsqueeze(-1),
                        corner_w,
                        torch.zeros(1, dtype=feats.dtype, device=feats.device),
                    )

                    accum_feats = accum_feats + f * w
                    accum_weights = accum_weights + w

        return accum_feats / torch.clamp_min(accum_weights, 1e-12)


class GridSample3dFunction(torch.autograd.Function):
    @staticmethod
    def forward(ctx, feats, coords, shape, grid, mode="trilinear"):
        return grid_sample_3d_torch(feats, coords, shape, grid, mode=mode)

    @staticmethod
    def backward(ctx, grad_output):
        return None, None, None, None, None


def grid_sample_3d(
    feats: torch.Tensor,
    coords: torch.Tensor,
    shape: Union[torch.Size, Tuple[int, ...]],
    grid: torch.Tensor,
    mode: str = "trilinear",
) -> torch.Tensor:
    """Primary 3D grid sampling entrypoint."""
    try:
        # Check if native compiled flex_gemm kernel is available
        import flex_gemm.ops.grid_sample as fg_gs
        if hasattr(fg_gs, "grid_sample_3d") and fg_gs.grid_sample_3d is not grid_sample_3d:
            return fg_gs.grid_sample_3d(feats, coords, shape, grid, mode=mode)
    except Exception:
        pass
    return grid_sample_3d_torch(feats, coords, shape, grid, mode=mode)


def install_flex_gemm_shim():
    """
    Ensure `flex_gemm`, `flex_gemm.ops`, and `flex_gemm.ops.grid_sample` are registered in sys.modules.
    Prevents `No module named 'flex_gemm.ops.grid_sample'`.
    """
    # 1. Check if flex_gemm is already imported and has ops.grid_sample
    try:
        import flex_gemm.ops.grid_sample as fg_gs
        if hasattr(fg_gs, "grid_sample_3d"):
            return True
    except (ImportError, ModuleNotFoundError, AttributeError):
        pass

    # 2. Construct / augment flex_gemm modules
    if "flex_gemm" not in sys.modules:
        mod_flex_gemm = types.ModuleType("flex_gemm")
        mod_flex_gemm.__package__ = "flex_gemm"
        sys.modules["flex_gemm"] = mod_flex_gemm
    else:
        mod_flex_gemm = sys.modules["flex_gemm"]

    if "flex_gemm.ops" not in sys.modules:
        mod_ops = types.ModuleType("flex_gemm.ops")
        mod_ops.__package__ = "flex_gemm.ops"
        sys.modules["flex_gemm.ops"] = mod_ops
        setattr(mod_flex_gemm, "ops", mod_ops)
    else:
        mod_ops = sys.modules["flex_gemm.ops"]

    if "flex_gemm.ops.grid_sample" not in sys.modules or not hasattr(sys.modules["flex_gemm.ops.grid_sample"], "grid_sample_3d"):
        mod_grid_sample = types.ModuleType("flex_gemm.ops.grid_sample")
        mod_grid_sample.grid_sample_3d = grid_sample_3d
        mod_grid_sample.grid_sample_3d_torch = grid_sample_3d_torch
        mod_grid_sample.GridSample3dFunction = GridSample3dFunction
        mod_grid_sample.set_hashmap_ratio = set_hashmap_ratio
        mod_grid_sample.HASHMAP_RATIO = HASHMAP_RATIO
        sys.modules["flex_gemm.ops.grid_sample"] = mod_grid_sample
        setattr(mod_ops, "grid_sample", mod_grid_sample)

    logger.info("Installed flex_gemm.ops.grid_sample fallback shim into sys.modules")
    return True
