## 2026-10-18 — Dependency Contract Test Alignment & Shape Path Safety

- Updated dependency-contract tests to match the existing shared Transformers/Diffusers pins without modifying any requirement file.
- Removed only the Hunyuan Paint utility path from global utils initialization while retaining the existing Hunyuan Shape path for compatibility.
- Kept backend CI submodule checkout enabled and documented that the stale-contract test failure is being corrected by the updated test expectations.

## 2026-10-18 — Backend CI Checkout & Texture Fallback Validation

- Updated backend CPU CI to initialize submodules so reference-contract tests have access to the declared third-party source metadata.
- Required DINOv2 local checkpoints to include both config and weight files before selecting the cache; incomplete caches now log the remote fallback.
- Preserved Hunyuan3D-Paint processing error chains and added regression tests for these behaviors. CI rerun is pending.

## 2026-10-18 — Scoped Imports, ARDY Diagnostics & Backend CI

- Scoped Hunyuan3D-Paint's temporary utility path to initialization, restored import state in `finally`, and stopped broad shared module-cache deletion during retry.
- Added warnings for missing local texture/DINO checkpoints before remote fallbacks; kept degraded background-removal state visible.
- Added ARDY dependency-contract diagnostics from its vendored `pyproject.toml` and preserved the original `BaseModel.load()` exception chain.
- Added CPU backend Python compilation and compatibility-contract CI without changing requirements files. GPU inference remains outside this CPU lane.
