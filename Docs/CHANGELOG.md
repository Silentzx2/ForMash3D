## 2026-10-19 — Unique3D Normal Checkpoint Compatibility

- Root cause: the normal-prediction loader selected the trained `img2mvimg` UNet as its base (8 input channels), while `image2normal` checkpoint weights expect 4 input channels. A fallback repeated the incompatible load and could terminate model startup.
- Fix: the normal stage now resolves to the 4-channel Stable Diffusion image-variation base; local `img2mvimg` is no longer used as an `image2normal` fallback. The multiview pipeline and its 8-channel weights remain unchanged.
- Validation boundary: source-contract regression coverage was added. The checkpoint-backed Unique3D GPU load/inference was not run in this editing environment, so verify it with the installed model weights after pulling the synchronized submodule.

## 2026-10-19 — ARDY CPU-Only Runtime

- ARDY is explicitly scheduled on CPU with no GPU/VRAM reservation; its dedicated worker skips CUDA initialization and hides CUDA in-process.
- The adapter forces both the motion model and local LLM2Vec text encoder to CPU, seeds only CPU generators, and reports CPU mode truthfully.
- Vendored LLM2Vec does not spawn CUDA multiprocessing for CPU requests on multi-GPU hosts. Added CPU-only resource/source-contract tests.
- GPU-backed ARDY tests are intentionally not applicable; real CPU checkpoint inference and peak host RAM still need validation on a machine with access to the gated text encoder.

## 2026-10-19 — Multi-GPU Runtime, Paint OOM, and Rigged Preview Fixes

- Scheduler VRAM availability now accounts for live physical free memory as well as tracked reservations.
- FastMesh V1K/V4K use Accelerate automatic device maps when aggregate VRAM is needed; incomplete or single-GPU placement fails explicitly. Multi-GPU strategy strings alone no longer authorize aggregate admission.
- Hunyuan3D-Paint bounds interpolation and UV extraction to 128-row chunks and can place the renderer/super-resolution and multiview diffusion components on separate selected GPUs. The renderer honors the scheduler-selected CUDA device.
- UniRig now follows the scheduler-selected GPU when its default device was generic `cuda`; tensor-copy and softmax-dimension warnings in its third-party skinning helper were corrected.
- Rigged asset updates clear the stale thumbnail; the viewer resolves canonical `artifact_format` URLs rather than trusting stale asset format metadata.
- Paint3D remains single-GPU because its stages execute in isolated one-GPU subprocesses. This prevents misleading aggregate-VRAM admission.
- CPU source/scheduler contracts were added. GPU/checkpoint-backed inference and real peak-memory measurements still require the target hardware.

