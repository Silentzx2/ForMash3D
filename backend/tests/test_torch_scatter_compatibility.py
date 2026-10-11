"""
Regression coverage for the shared torch_scatter compatibility shim in core.config.
The test intentionally exercises only the generic backend fallback behavior.
"""

import sys
from pathlib import Path

import torch

backend_root = Path(__file__).resolve().parents[1]
if str(backend_root) not in sys.path:
    sys.path.insert(0, str(backend_root))


def test_torch_scatter_shim():
    import core.config  # noqa: F401 - registers compatibility shim before import
    import torch_scatter

    src = torch.randn(2, 64, 100)
    index = torch.randint(0, 20, (2, 1, 100))
    out = torch.zeros(2, 64, 20)

    mean_res = torch_scatter.scatter_mean(src, index, dim=-1, out=out)
    assert mean_res.shape == (2, 64, 20)
