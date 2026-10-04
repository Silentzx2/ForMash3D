# ForMash3D — Engineering Task Ledger

**Status:** Audited and reconciled  
**Date:** 2026-10-04  
**Branch:** `Dev`  
**Authoritative task file:** `Docs/TASKS.md`

> The repository has no root `TASK.md`. This file is the maintained task ledger referenced by `RULES.md`.

## Scope

ForMash3D's generation contract is **Image → 3D**. Text input remains valid for mesh painting/editing and motion generation, but **Text → 3D generation is not an active product path**.

The production generation path is:

`image upload → model capability routing → maximum-fidelity source inference → durable master mesh → repair/conditional retopo → target polycount → UV/texture preservation → optional PBR bake → LODs → collision/physics → QA → game-ready/export artifacts`

## Verified fixes

| Area | Result | Verification |
|---|---|---|
| Model-aware generation routing | DONE | `generate3DModel()` now passes the selected model's backend capabilities into `buildGenerationParameters()`; raw/textured endpoint selection is no longer hard-coded. |
| Source-fidelity contract | DONE | Production-only budgets are stripped from neural inference by the scheduler before adapter execution. |
| Telemetry refresh | DONE | Workspace system telemetry refreshes every 5 seconds. |
| Low-VRAM control visibility | DONE | The generation UI uses the selected model's `low_vram_supported` capability. |
| Image-only 3D generation | DONE | Text-to-3D route/client/type/task mappings were removed. Text mesh painting and text-to-motion remain supported. |
| Native texture preservation | DONE | Production optimization falls back to the repaired textured mesh and now raises when native texture data cannot be restored. Optional LOD texture loss is recorded as an artifact error instead of being silently shipped. |
| Runtime scheduler toggles | DONE | Retry and post-job VRAM unload settings are read at decision time instead of being frozen at module import. |
| Job cancellation / worker cleanup | DONE | Existing scheduler cleanup and cancellation paths were re-checked; current code terminates the owning worker before terminal cancellation/failure publication. |
| Progress contract | DONE | Backend progress remains a 0..1 fraction; the workspace normalization converts it once to a 0..100 display value. |
| Model parameter defaults | DONE | Frontend generation parameter construction prefers backend model schemas and falls back only when the schema is unavailable. |
| OpenAPI contract validation | DONE | `scripts/verify_contracts.py` now checks current image-generation/paining/processing endpoints and rejects legacy Text-to-3D endpoint references. |
| Source model registry | DONE | The canonical frontend registry contains 22 active model definitions; the stale 19-model comment was corrected. |

## Current feature status

| Feature | Status | Notes |
|---|---|---|
| Image → Raw 3D | DONE | Capability-driven routing to `image-to-raw-mesh`. |
| Image → Textured 3D | DONE | Capability-driven routing to `image-to-textured-mesh`; native model texture support controls the UI. |
| Multi-view reconstruction | DONE | Generate button is gated by model multiview capability and supplied views. |
| Mesh painting | DONE | Text/image painting remains separate from generation. |
| Physics / collision preparation | DONE | Production post-processing emits collision/physics metadata when enabled. |
| LOD generation | DONE | Up to four configurable LOD artifacts are generated; optional texture-loss failures are surfaced. |
| Auto UV | DONE | Native textured assets preserve UV/material data; untextured assets receive production UVs. |
| Game-ready export | DONE | Canonical GLB is required; FBX is generated when conversion succeeds. |
| Text → 3D | REMOVED | No active backend route, frontend client/type, task mapping, or model registration. |
| Text → Motion | SUPPORTED | Remains intentionally separate from 3D generation. |

## Verification performed in this audit

- Re-read `RULES.md`, the complete `Docs/` documentation set, the current `Dev` branch tree, generation routing, scheduler, post-processing, and contract-test code.
- Cross-checked the current frontend model registry against the backend feature/capability contract.
- Cross-checked documented Text-to-3D routes against the actual backend route surface and removed stale documentation.
- Added runtime-toggle regression coverage and removed a stale Text-to-3D topology test.
- Python syntax checks are required for the modified backend modules before release.

## Verification that remains environment-gated

These items are **not marked complete without the required runtime environment**:

| Check | Status | Reason |
|---|---|---|
| Full 22-model GPU smoke test | NOT RUN | Requires the actual model weights and compatible CUDA environment. |
| 50 concurrent jobs on 4×A100 | NOT RUN | No 4×A100 load-test environment is available in this workspace. |
| Redis multi-worker live integration | NOT RUN | Requires a running Redis service plus multi-worker runtime. |
| SAST/DAST vendor scan | NOT RUN | No external scanner result is available; this ledger does not fabricate a pass. |
| Mobile/responsive visual sweep | NOT RUN | Requires browser/device interaction. |

## Dependency baseline

Current repository manifests are authoritative:

- Frontend: Next.js `^16.2.11`, React `^19.2.8`, Axios `^1.8.1`, TypeScript `^7.0.2`.
- Backend: FastAPI `0.104.1`, Pydantic `>=2.10`, PyTorch `2.6.0+cu124`.

No GitHub Actions workflow is currently present in `.github/workflows/`; local contract verification is therefore not described as a CI gate.

## Release checklist

- [x] Single-image generation uses capability-aware endpoint routing.
- [x] Production polycount budgets remain downstream-only.
- [x] Telemetry refresh is 5 seconds.
- [x] Legacy Text-to-3D generation route/client mappings are removed.
- [x] Native texture loss cannot silently become a successful game-ready asset.
- [x] Scheduler runtime toggles are not import-time constants.
- [x] Core documentation agrees with the current route and model surfaces.
- [ ] Full GPU model smoke suite.
- [ ] 4×A100 concurrency load test.
- [ ] Live Redis multi-worker integration.
- [ ] External SAST/DAST report.
