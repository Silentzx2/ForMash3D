## 2026-10-18 — Backend CI Checkout & Texture Fallback Validation

- Updated backend CPU CI to initialize submodules so reference-contract tests have access to the declared third-party source metadata.
- Required DINOv2 local checkpoints to include both config and weight files before selecting the cache; incomplete caches now log the remote fallback.
- Preserved Hunyuan3D-Paint processing error chains and added regression tests for these behaviors. CI rerun is pending.

## 2026-10-18 — Scoped Imports, ARDY Diagnostics & Backend CI

- Scoped Hunyuan3D-Paint's temporary utility path to initialization, restored import state in `finally`, and stopped broad shared module-cache deletion during retry.
- Added warnings for missing local texture/DINO checkpoints before remote fallbacks; kept degraded background-removal state visible.
- Added ARDY dependency-contract diagnostics from its vendored `pyproject.toml` and preserved the original `BaseModel.load()` exception chain.
- Added CPU backend Python compilation and compatibility-contract CI without changing requirements files. GPU inference remains outside this CPU lane.

## 2026-10-18 — Runtime Compatibility, Path Resolution & Fallback Visibility

- Replaced the empty HybridCache subclass with a real cache-class import fallback that reports its semantic limitation.
- Made TorchVision compatibility helper import resilient to runtime/native load errors; compatibility setup failures now retain tracebacks and cause chains.
- Resolved UniRig default paths independently of current working directory and preserved ARDY/UniRig loader exception chains.
- Exposed Hunyuan3D-Paint background-removal fallback mode and reason in job results.
- Added regression tests for these contracts. Backend tests are awaiting CI execution; no test-pass claim is made here.
