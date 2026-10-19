## 2026-10-19 — UniRig Compatibility & FastMesh Admission Integrity

- Fixed the lazy TorchCluster FPS fallback so it imports Torch and `Optional` before evaluating typed annotations.
- UniRig's vendored autoregressive model now checks Transformers' per-class SDPA support and uses eager attention for unsupported causal-LM classes; the main repo submodule pointer is synchronized.
- Scheduler worker startup now resolves the canonical backend compatibility helper.
- FastMesh no longer advertises unsupported multi-GPU dispatch. Downloader and model readiness reject missing, truncated, or variant-mismatched checkpoints; regression tests cover 2×T4 fail-closed admission.
- GPU model inference was not executed in CPU CI; actual peak VRAM still needs validation on the target accelerator.

## 2026-10-18 — Explicit Hunyuan3D-Paint Source Resolution

- Third-party Hunyuan Paint now distinguishes local checkpoint directories from Hugging Face repository IDs.
- Missing absolute paths, incomplete DINOv2 checkpoints, and invalid local Paint layouts fail clearly rather than silently switching to a remote default.
- Added dependency-light resolver regression tests and wired them into backend CI through the updated submodule revision. GPU inference still requires a GPU smoke environment.

## 2026-10-18 — Verified Runtime Fixes & Green CI

- Switched Hunyuan3D-Paint's adapter-level Numba and background-removal fallback helper calls to the canonical main-backend compatibility module.
- Added regression assertions against generic helper imports and updated the fallback test to mock the canonical loader.
- Verified at code commit `cb02d5df21b7fc34e77be10947b95ac526799594`: backend Python compilation and all 12 CPU compatibility contracts passed, and frontend CI passed. GPU inference still needs a GPU smoke environment.

