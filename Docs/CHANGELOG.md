## 2026-10-19 — Multi-GPU Runtime, Paint OOM, and Rigged Preview Fixes

- Scheduler VRAM availability now accounts for live physical free memory as well as tracked reservations.
- FastMesh V1K/V4K use Accelerate automatic device maps when aggregate VRAM is needed; incomplete or single-GPU placement fails explicitly. Multi-GPU strategy strings alone no longer authorize aggregate admission.
- Hunyuan3D-Paint bounds interpolation and UV extraction to 128-row chunks and can place the renderer/super-resolution and multiview diffusion components on separate selected GPUs. The renderer honors the scheduler-selected CUDA device.
- UniRig now follows the scheduler-selected GPU when its default device was generic `cuda`; tensor-copy and softmax-dimension warnings in its third-party skinning helper were corrected.
- Rigged asset updates clear the stale thumbnail; the viewer resolves canonical `artifact_format` URLs rather than trusting stale asset format metadata.
- Paint3D remains single-GPU because its stages execute in isolated one-GPU subprocesses. This prevents misleading aggregate-VRAM admission.
- CPU source/scheduler contracts were added. GPU/checkpoint-backed inference and real peak-memory measurements still require the target hardware.

## 2026-10-19 — UniRig Runtime Fixes & FastMesh Admission/Attention Compatibility

- Fixed the lazy TorchCluster FPS fallback so it imports Torch and `Optional` before evaluating typed annotations.
- UniRig's vendored autoregressive model now checks Transformers' per-class SDPA support and uses eager attention for unsupported causal-LM classes; the main repo submodule pointer is synchronized.
- UniRig Pointcept now selects its non-FlashAttention implementation on pre-Ampere/unknown CUDA devices, and its dropout module is callable in both normal and kernel-error fallback paths.
- Scheduler worker startup now resolves the canonical backend compatibility helper.
- FastMesh no longer advertises unsupported multi-GPU dispatch. Downloader and model readiness reject missing, truncated, or variant-mismatched checkpoints; regression tests cover 2×T4 fail-closed admission.
- FastMesh now selects FlashAttention only on CUDA compute capability 8.0+ and uses Transformers' eager OPT attention plus a 4D causal mask on pre-Ampere GPUs, avoiding the reported T4/Turing FlashAttention runtime crash. Eager attention may use more VRAM and run slower; target-GPU inference still needs a smoke test.
- GPU model inference was not executed in CPU CI; actual peak VRAM still needs validation on the target accelerator.

## 2026-10-18 — Explicit Hunyuan3D-Paint Source Resolution

- Third-party Hunyuan Paint now distinguishes local checkpoint directories from Hugging Face repository IDs.
- Missing absolute paths, incomplete DINOv2 checkpoints, and invalid local Paint layouts fail clearly rather than silently switching to a remote default.
- Added dependency-light resolver regression tests and wired them into backend CI through the updated submodule revision. GPU inference still requires a GPU smoke environment.
