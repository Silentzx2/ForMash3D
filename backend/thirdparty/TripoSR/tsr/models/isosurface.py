from typing import Callable, Optional, Tuple

import numpy as np
import torch
import torch.nn as nn
try:
    from torchmcubes import marching_cubes
except (ImportError, OSError):
    try:
        from skimage.measure import marching_cubes as ski_mc
        def marching_cubes(level, isovalue=0.0):
            arr = level.detach().cpu().numpy()
            v, f, _, _ = ski_mc(arr, level=isovalue)
            return torch.from_numpy(v.copy().astype(np.float32)), torch.from_numpy(f.copy().astype(np.int64))
    except Exception:
        marching_cubes = None


class IsosurfaceHelper(nn.Module):
    points_range: Tuple[float, float] = (0, 1)

    @property
    def grid_vertices(self) -> torch.FloatTensor:
        raise NotImplementedError


class MarchingCubeHelper(IsosurfaceHelper):
    def __init__(self, resolution: int) -> None:
        super().__init__()
        self.resolution = resolution
        self.mc_func: Optional[Callable] = marching_cubes
        self._grid_vertices: Optional[torch.FloatTensor] = None

    @property
    def grid_vertices(self) -> torch.FloatTensor:
        if self._grid_vertices is None:
            # keep the vertices on CPU so that we can support very large resolution
            x, y, z = (
                torch.linspace(*self.points_range, self.resolution),
                torch.linspace(*self.points_range, self.resolution),
                torch.linspace(*self.points_range, self.resolution),
            )
            x, y, z = torch.meshgrid(x, y, z, indexing="ij")
            verts = torch.cat(
                [x.reshape(-1, 1), y.reshape(-1, 1), z.reshape(-1, 1)], dim=-1
            ).reshape(-1, 3)
            self._grid_vertices = verts
        return self._grid_vertices

    def forward(
        self,
        level: torch.FloatTensor,
    ) -> Tuple[torch.FloatTensor, torch.LongTensor]:
        if self.mc_func is None:
            raise ImportError("marching cubes implementation unavailable")
        level = -level.view(self.resolution, self.resolution, self.resolution)
        try:
            v_pos, t_pos_idx = self.mc_func(level.detach(), 0.0)
        except Exception:
            v_pos, t_pos_idx = self.mc_func(level.detach().cpu(), 0.0)
        v_pos = v_pos[..., [2, 1, 0]] / (self.resolution - 1.0)
        return v_pos.to(level.device), t_pos_idx.to(level.device)
