## 2026-10-18 — Explicit Hunyuan3D-Paint Source Resolution

- Third-party Hunyuan Paint now distinguishes local checkpoint directories from Hugging Face repository IDs.
- Missing absolute paths, incomplete DINOv2 checkpoints, and invalid local Paint layouts fail clearly rather than silently switching to a remote default.
- Added dependency-light resolver regression tests and wired them into backend CI through the updated submodule revision. GPU inference still requires a GPU smoke environment.

## 2026-10-18 — Verified Runtime Fixes & Green CI

- Switched Hunyuan3D-Paint's adapter-level Numba and background-removal fallback helper calls to the canonical main-backend compatibility module.
- Added regression assertions against generic helper imports and updated the fallback test to mock the canonical loader.
- Verified at code commit `cb02d5df21b7fc34e77be10947b95ac526799594`: backend Python compilation and all 12 CPU compatibility contracts passed, and frontend CI passed. GPU inference still needs a GPU smoke environment.

## 2026-10-18 — Canonical Runtime Compatibility Imports

- Added a path-based, cached loader for the main backend TorchVision/Transformers compatibility helper.
- Switched ModelFactory and UniRig to the canonical helper, avoiding accidental resolution to an identically named vendored Shape utility module.
- Updated CPU contracts to validate the main helper path and ensure the cache shim test does not require heavyweight Torch imports. No requirements files or mesh-generation adapters changed.

