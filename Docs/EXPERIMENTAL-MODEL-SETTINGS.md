# Experimental Model Settings

This document records change-control policy and verification boundaries for experimental adapter profiles. The numerical source of truth is each adapter's `_LOCKED_INFERENCE_PROFILE`; values are intentionally not duplicated here.

## Change control

1. Establish the upstream source, revision, license, checkpoint, and hardware prerequisites.
2. Make one isolated adapter change only after explicit owner approval for a locked-profile change.
3. Run source-contract and CPU tests first, then the same-input GPU benchmark with the required checkpoints.
4. Record effective runtime values, peak VRAM, latency, output validity, and geometry comparisons. Requested values are not evidence of effective values.
5. Revert a profile when it causes invalid output, unacceptable memory behavior, or measurable quality regression.

## Current verification boundary

CPU CI verifies imports, contracts, configuration, scheduling, and deterministic geometry helpers. It does not verify CUDA kernels, model checkpoints, peak VRAM, Blender operations, or visual quality. Those results must be reported as `NOT RUN` until executed on a supported host.

## Hi3D (Experimental)

Hi3D v1.0 has been integrated as an **experimental model** following explicit user approval.

- **Upstream Repository:** `https://github.com/hi3d-official/Hi3Dv1.0`
- **Reviewed Revision:** `13657ad09afaa92e350b461a1cd66399e44a59c4` (pinned)
- **License:** `LicenseRef-Hi3D-1.0`
- **Vendored Location:** `backend/thirdparty/Hi3D` (clean source vendoring without `.git` metadata)
- **Registered Model IDs:**
  - `hi3d_image_to_raw_mesh` (Primary: Image → High-Resolution Raw Geometry Refinement)
  - `hi3d_image_to_textured_mesh` (Alias: routes to raw geometry with untextured export when `apply_texture=False`)
- **Experimental Flag:** Explicitly marked `experimental: true` across backend manifests, model factory, adapter instance, and frontend definitions (`[Experimental]` label/badge).
- **Locked Inference Profile:**
  - `resolution`: `1024` (adapter-enforced; request-side resolution values are ignored)
  - `num_inference_steps`: `25` (Heun flow-matching scheduler; request-side overrides are ignored)
  - `seed`: `42` default (a caller-supplied seed is forwarded)
  - `sequential_cpu_offload`: `False` (supported for memory-constrained environments)
  - `fp16`: `True`
  - `apply_texture`: `False` (produces geometry only; untextured raw mesh exported)
- **Hardware Prerequisites:** Linux, Python 3.10, NVIDIA GPU, and a 16 GB VRAM reservation in the model manifest. The current adapter guard enforces CUDA compute capability >= 7.0 (Volta+); that guard is not a guarantee that every CUDA/runtime combination is compatible. No CPU inference path is provided. Verify actual pipeline loading and inference on the target GPU before deployment.



## TRELLIS.2 raw-geometry path

The TRELLIS.2 raw adapter opts into the pipeline's backward-compatible geometry-only mode. Sparse-structure and shape-latent inference remain active, while texture-latent sampling and decoding are skipped. The existing maximum-resolution cascade and its token-budget-based downshift behavior remain unchanged. Texturing stays in the separate TRELLIS.2 painting adapter. The adapter remains the single source of truth for numeric inference settings; GPU output quality, VRAM and latency are unverified until benchmarked on the supported runtime.
