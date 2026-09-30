## 2026-09-30 — README Overhaul, 3DGenStudio Attribution & SaaS Advisory
- Revamped README.md: eliminated hype claims (#1/alternatives), framed platform respectfully as inspired by Tripo AI and Meshy workflows.
- Restyled Mermaid architecture diagram with vibrant Studio Gold theme and verified node-to-node rendering compatibility.
- Documented post-processing provenance (ported from visualbruno/3DGenStudio under Community License).
- Added explicit legal warning: Apache 2.0 applies only to ForMash3D core code; third-party models and 3DGenStudio carry non-commercial/SaaS-hosting restrictions.

## 2026-09-30 — Master Plan v2.1 Verification & Adapter/Postprocess Hardening
- Clamped Hunyuan extraction resolution to upstream-supported contract range [64, 512] in shape, mini-turbo, and paint adapters.
- Fixed path string division syntax and changed thirdparty sys.path inserts to appends to prevent package shadowing.
- Guarded TRELLIS.2 GLB export against None/non-positive decimation targets by falling back safely to generated face count.
- Hardened PyMeshLab texture decimation in `simplify.py` with strict UV checks, texture image retention, and seamless fallback to passthrough on decimation failure.
- Cleaned legacy merge conflict artifact in TRELLIS `app_text.py` and brought backend compilation to 100% clean across all modules.
- Upgraded test suite coverage: wrapped `test_torchmcubes_scatter_fix.py` for pytest discovery; 25 tests passing cleanly across all backend suites.

## 2026-09-30 — Deep Quality Audit Gap Closure
- Fixed normal-job post-processing crash paths, hardened native texture detection, corrected AutoRetopo hole-size semantics, and added source/repaired/optimized/game-ready quality trace metadata.
- Reconciled FastMesh UI/API behavior with its fixed V1K/V4K model contract and wired explicit tri/quad output selection through the retopology API.
- Added regression coverage for boundary-component thresholds and UV-only meshes being treated as untextured.

## 2026-09-30 — Quality & Detail Restoration
- Corrected model/extractor quality contracts, preserved textured LOD materials through texture-aware decimation, added conditional structural retopology, source-asset integrity/quality accounting, and removed frontend quality controls without backend consumers.

## 2026-09-30 — Review Audit Hardening & Multi-Job Pipeline
- Corrected Redis queue ordering/state/TTL semantics, added restart recovery and worker termination for timeout/cancellation, moved SQLite persistence off async scheduling paths, made FastMesh variants explicit, and repaired verification commands.
