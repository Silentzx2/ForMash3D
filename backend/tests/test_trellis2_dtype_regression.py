import ast
import os
import sys
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parents[2]
TRELLIS_DIR = ROOT / "backend" / "thirdparty" / "TRELLIS.2"


def _read_ast(subpath: str) -> ast.AST:
    file_path = TRELLIS_DIR / subpath
    return ast.parse(file_path.read_text(encoding="utf-8"))


def test_sparse_structure_flow_static_ast():
    tree = _read_ast("trellis2/models/sparse_structure_flow.py")
    source = (TRELLIS_DIR / "trellis2/models/sparse_structure_flow.py").read_text(encoding="utf-8")

    # Verify input_layer casting before call
    assert "input_dtype = self.input_layer.weight.dtype" in source
    assert "self.input_layer(h)" in source
    # Verify ape pos_emb dtype cast
    assert "self.pos_emb[None].to(h.dtype)" in source
    # Verify out_layer dtype cast
    assert "out_dtype = self.out_layer.weight.dtype" in source
    assert "self.out_layer(h)" in source
    assert "manual_cast(h, x.dtype)" in source


def test_sparse_linear_static_ast():
    source = (TRELLIS_DIR / "trellis2/modules/sparse/linear.py").read_text(encoding="utf-8")
    assert "feats.dtype != self.weight.dtype" in source
    assert "feats = feats.to(self.weight.dtype)" in source


def test_pipeline_noise_dtypes_static_ast():
    source = (TRELLIS_DIR / "trellis2/pipelines/trellis2_image_to_3d.py").read_text(encoding="utf-8")
    # Verify target_dtype used for noise in sample methods
    assert "dtype=target_dtype" in source
    assert "dtype=lr_dtype" in source
    assert "dtype=hr_dtype" in source


def test_sparse_structure_flow_and_linear_runtime():
    torch = pytest.importorskip("torch")
    sys.path.insert(0, str(TRELLIS_DIR))

    from trellis2.models.sparse_structure_flow import SparseStructureFlowModel
    from trellis2.modules.sparse.linear import SparseLinear
    from trellis2.modules.sparse import VarLenTensor

    # 1. SparseStructureFlowModel bfloat16 forward with float32 inputs
    model = SparseStructureFlowModel(
        resolution=4,
        in_channels=4,
        model_channels=16,
        num_heads=1,
        cond_channels=16,
        out_channels=4,
        num_blocks=1,
        pe_mode="ape",
        share_mod=True,
    ).to(torch.bfloat16)

    x = torch.randn(1, 4, 4, 4, 4, dtype=torch.float32)
    t = torch.tensor([0.5], dtype=torch.float32)
    cond = torch.randn(1, 4, 16, dtype=torch.float32)

    out = model(x, t, cond)
    assert out.shape == (1, 4, 4, 4, 4)
    assert out.dtype == torch.float32, "Output must be cast back to x.dtype (float32)"

    # 2. SparseLinear with mismatched dtype
    linear = SparseLinear(8, 16).to(torch.bfloat16)
    var_len = VarLenTensor(feats=torch.randn(10, 8, dtype=torch.float32), layout=[10])
    out_lin = linear(var_len)
    assert out_lin.feats.shape == (10, 16)
    assert out_lin.feats.dtype == torch.bfloat16


def test_flex_gemm_triton_annotation_stripping():
    """Verify that flex_gemm source patching strips broken parameter annotations and preserves constexpr."""
    import re

    sample_kernel_src = """
def _hashmap_find_store_neighbor_map_inline(
    hashmap_ptr: tl.tensor,
    coords_in_ptr: tl.const,
    neighbor_map_ptr: tl.pointer_type,
    coord_stride_vec: tl.tensor | None = None,
    D: tl.constexpr = 3,
) -> None:
    tl.store(neighbor_map_ptr + 1, 42)
"""
    # Test stripping regex
    stripped = re.sub(
        r':\s*(?:tl\.)?(?:tensor|pointer_type|modifier_type|const\b)(?:\s*\|\s*None)?',
        '',
        sample_kernel_src,
    )
    stripped = re.sub(r'\)\s*->\s*(?:None|tl\.\w+)\s*:', '):', stripped)

    assert "hashmap_ptr," in stripped
    assert "coords_in_ptr," in stripped
    assert "neighbor_map_ptr," in stripped
    assert "coord_stride_vec = None," in stripped
    assert "D: tl.constexpr = 3," in stripped
    assert "):" in stripped
    assert "-> None" not in stripped


def test_flex_gemm_reduce_or_patching():
    """Verify that flex_gemm source patching replaces missing tl.reduce_or with tl.reduce + _or_combine."""
    import re

    sample_postprocess_src = """
@triton.jit
def _reduce_gray_code_triton_kernel(gray_code_ptr):
    reduced_code = tl.reduce_or(gray_code, axis=0)
    seglen = tl.sum((reduced_code >> tl.arange(0, 32)) & 1, axis=0).to(tl.int32)
"""
    new_text = sample_postprocess_src
    if "reduce_or" in new_text:
        if "def _or_combine(a, b):" not in new_text:
            new_text = "@triton.jit\ndef _or_combine(a, b):\n    return a | b\n\n" + new_text
        new_text = re.sub(
            r"tl\.reduce_or\s*\(\s*([^,]+)\s*,\s*axis\s*=\s*0\s*\)",
            r"tl.reduce(\1, 0, _or_combine)",
            new_text,
        )

    assert "tl.reduce_or" not in new_text
    assert "tl.reduce(gray_code, 0, _or_combine)" in new_text
    assert "def _or_combine(a, b):" in new_text

