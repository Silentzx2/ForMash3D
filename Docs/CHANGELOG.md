## 2026-10-30 — Model readiness disclosure

- Documented that manifest registration and checkpoint presence do not guarantee successful pipeline loading or valid mesh output.
- Recorded reported pipeline initialization/loading failures and broken-mesh outputs as unresolved, not yet attributed to specific model IDs.
- Added model-by-model GPU validation, mesh-quality, and triage requirements.
- GPU inference, checkpoint-load coverage, peak VRAM, and visual quality remain unverified unless explicitly recorded on supported hardware.

## 2026-10-30 — Unique3D Poisson initialization depth

- Reduced Unique3D's `fast_geo()` Screened Poisson reconstruction depth from 8 to the helper's default value of 7 to avoid the unverified higher-detail closure setting while preserving the existing reconstruction pipeline. No TRELLIS.2 files or settings were changed. GPU visual verification: NOT RUN.

## 2026-10-29 — TRELLIS.2 geometry-only generation

- Set the adapter-owned sparse-structure and shape-SLat schedules to 25 steps while preserving the existing maximum-resolution cascade and token budget.
- Added an opt-in geometry-only path in the vendored TRELLIS.2 image-to-3D pipeline. Raw generation skips texture-SLat sampling and texture-latent decoding, while the dedicated painting adapter remains unchanged.
- Added source-contract coverage for the geometry-only boundary and locked profile. GPU inference, quality, VRAM and latency remain NOT RUN.

## 2026-10-29 — Restore Hi3D high-fidelity production inference settings

- Restored Hi3D production inference profile to high resolution `1024` and `25` flow steps following successful hardware pipeline verification.
- Updated `backend/config/models.yaml` and single-source-of-truth contract tests to active `1024` geometry resolution.

## 2026-10-29 — TRELLIS.2 FlexGEMM Triton 3.x neighbor map pointer fix

- Fixed `ValueError: Unsupported ptr type <[16, 16], int32> in tl.store` during TRELLIS.2 `sample_shape_slat_cascade` upsampling.
- In `backend/utils/torchvision_fix.py`, patched `str_to_ty` so `pointer_type` and `tensor` map to true pointer types (`tl.pointer_type`) rather than `int32`, ensuring destination addresses in `_hashmap_find_store_neighbor_map_inline` remain valid pointers.
- Enhanced disk-level `_patch_flex_gemm_sources()` to strip legacy non-constexpr parameter type annotations (`: tl.tensor`, `: tl.pointer_type`, `: tl.modifier_type`) from flex_gemm Triton kernels, allowing Triton 3.x to dynamically specialize pointer arguments from runtime PyTorch tensors.
- Added defensive `_fix_triton_store()` and Triton JIT disk cache eviction on source modification.
