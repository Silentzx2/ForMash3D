## 2026-10-18 — Canonical Hunyuan Helpers & Green CPU Contract CI

- Switched Hunyuan3D-Paint's adapter-level Numba and background-removal fallback helper calls to the canonical main-backend compatibility module.
- Added regression assertions against generic helper imports and updated the fallback test to mock the canonical loader.
- Verified backend Runtime Contract CI (compile + 12 CPU compatibility tests) and frontend CI passing at the preceding commit. GPU inference still needs a GPU smoke environment.

## 2026-10-18 — Canonical Runtime Compatibility Imports

- Added a path-based, cached loader for the main backend TorchVision/Transformers compatibility helper.
- Switched ModelFactory and UniRig to the canonical helper, avoiding accidental resolution to an identically named vendored Shape utility module.
- Updated CPU contracts to validate the main helper path and ensure the cache shim test does not require heavyweight Torch imports. No requirements files or mesh-generation adapters changed.

## 2026-10-18 — Isolated CPU Contract Tests & Additional Runtime Guards

- Changed the cache-shim test to import the main-repo helper directly, avoiding the legacy Hunyuan Shape utility module and its PyTorch runtime dependency.
- Added CPU-safe source contracts for BaseModel status/error causes, Paint3D preflight and UV validation, and loader exception chaining.
- Preserved the Hunyuan Shape utility path and kept the shared dependency requirements unchanged. Backend CI rerun is pending.
