## 2026-10-18 — Isolated CPU Contract Tests & Additional Runtime Guards

- Changed the cache-shim test to import the main-repo helper directly, avoiding the legacy Hunyuan Shape utility module and its PyTorch runtime dependency.
- Added CPU-safe source contracts for BaseModel status/error causes, Paint3D preflight and UV validation, and loader exception chaining.
- Preserved the Hunyuan Shape utility path and kept the shared dependency requirements unchanged. Backend CI rerun is pending.

## 2026-10-18 — Dependency Contract Test Alignment & Shape Path Safety

- Updated dependency-contract tests to match the existing shared Transformers/Diffusers pins without modifying any requirement file.
- Removed only the Hunyuan Paint utility path from global utils initialization while retaining the existing Hunyuan Shape path for compatibility.
- Kept backend CI submodule checkout enabled and documented that the stale-contract test failure is being corrected by the updated test expectations.

## 2026-10-18 — Backend CI Checkout & Texture Fallback Validation

- Updated backend CPU CI to initialize submodules so reference-contract tests have access to the declared third-party source metadata.
- Required DINOv2 local checkpoints to include both config and weight files before selecting the cache; incomplete caches now log the remote fallback.
- Preserved Hunyuan3D-Paint processing error chains and added regression tests for these behaviors. CI rerun is pending.
