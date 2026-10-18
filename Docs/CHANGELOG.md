## 2026-10-18 — Canonical Runtime Compatibility Imports

- Added a path-based, cached loader for the main backend TorchVision/Transformers compatibility helper.
- Switched ModelFactory and UniRig to the canonical helper, avoiding accidental resolution to an identically named vendored Shape utility module.
- Updated CPU contracts to validate the main helper path and ensure the cache shim test does not require heavyweight Torch imports. No requirements files or mesh-generation adapters changed.

## 2026-10-18 — Isolated CPU Contract Tests & Additional Runtime Guards

- Changed the cache-shim test to import the main-repo helper directly, avoiding the legacy Hunyuan Shape utility module and its PyTorch runtime dependency.
- Added CPU-safe source contracts for BaseModel status/error causes, Paint3D preflight and UV validation, and loader exception chaining.
- Preserved the Hunyuan Shape utility path and kept the shared dependency requirements unchanged. Backend CI rerun is pending.

## 2026-10-18 — Dependency Contract Test Alignment & Shape Path Safety

- Updated dependency-contract tests to match the existing shared Transformers/Diffusers pins without modifying any requirement file.
- Removed only the Hunyuan Paint utility path from global utils initialization while retaining the existing Hunyuan Shape path for compatibility.
- Kept backend CI submodule checkout enabled and documented that the stale-contract test failure is being corrected by the updated test expectations.
