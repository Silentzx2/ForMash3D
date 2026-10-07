## 2026-10-08 — [High-Fidelity Generation & Resource Orchestration]

- Preserved every existing model while adding deterministic capability/resource-aware routing.
- Added an immutable-master fidelity contract and master-to-derivative quality diagnostics.
- Added centralized GPU/CPU resource planning, explicit supported multi-GPU placement, CPU thread scaling, and resource-aware fallback.
- Added high/ultra curvature-adaptive remeshing before UV/bake for untextured generated derivatives.
- Added TripoSG high/ultra hierarchical-extraction preference and TRELLIS.2 additive multi-GPU dispatch.
- Added mesh-quality diagnostics and a standalone benchmark CLI; final CUDA/visual smoke validation remains environment-gated.

## 2026-10-07 — [Unique3D Integration]

- Integrated official AiuniAI/Unique3D (upstream commit `6311af200ee197544e82e0f2557cd890edd60416`) as a first-class single-image → 3D model.
- Vendored source at `backend/thirdparty/Unique3D/` with MIT license preserved and nested Git metadata removed.
- Added model download/verification, manager registration, backend adapter/factory/config, frontend registry, parameter wiring, and documentation.
- VRAM requirement remains 10240 MB until real hardware measurement.

## 2026-10-05 — [Mini Turbo & TRELLIS generation fixes]

- Fixed Hunyuan3D-DiT-v2-mini-Turbo checkpoint subfolder resolution and local-weight path handling.
- Fixed TRELLIS texture optimization under PyTorch 2.x by avoiding an in-place autograd mutation.
- Added clearer missing-weight failures and retained source-fidelity behavior.
