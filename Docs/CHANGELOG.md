## 2026-09-30 — Deep Quality Audit Gap Closure
- Fixed normal-job post-processing crash paths, hardened native texture detection, corrected AutoRetopo hole-size semantics, and added source/repaired/optimized/game-ready quality trace metadata.
- Reconciled FastMesh UI/API behavior with its fixed V1K/V4K model contract and wired explicit tri/quad output selection through the retopology API.
- Added regression coverage for boundary-component thresholds and UV-only meshes being treated as untextured.

## 2026-09-30 — Quality & Detail Restoration
- Corrected model/extractor quality contracts, preserved textured LOD materials through texture-aware decimation, added conditional structural retopology, source-asset integrity/quality accounting, and removed frontend quality controls without backend consumers.

## 2026-09-30 — Review Audit Hardening & Multi-Job Pipeline
- Corrected Redis queue ordering/state/TTL semantics, added restart recovery and worker termination for timeout/cancellation, moved SQLite persistence off async scheduling paths, made FastMesh variants explicit, and repaired verification commands.
