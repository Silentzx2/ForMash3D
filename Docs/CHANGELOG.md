- 2026-09-29 — Full Pipeline Telemetry & Workspace Audit
- Reworked live pipeline telemetry to surface the real backend stage/message stream, execution ETA, completed-stage count, and artifact readiness without fake progress values.
- Fixed generation cancellation so queued jobs use the dedicated cancel contract instead of deleting the job record.
- Made Jobs detail polling visibility-aware and stopped using fabricated 15% progress.
- Removed fabricated uploaded/segmentation/UV mesh statistics and made the Segmentation inspector derive from real backend part statistics.
- Added real segmented-result download wiring and execution timeline telemetry.
- Guarded the Generate page against presenting the current single-image backend as a functional multi-view request path.
- Hardened hidden-tab polling and log rendering to reduce idle network traffic and UI jank.

- 2026-09-29 — Viewport & Generation UX Hardening
- Moved advanced Physics/Mesh generation controls into an on-demand drawer to keep the primary generation path compact and responsive.
- Added a functional top-of-viewport Physics smoke test with canonical-runtime fallback plus a lightweight bounds-based test for ordinary loaded meshes.
- Added an opt-in mirror inspection peek that captures at a low rate, temporarily focus-zooms the main viewer on hover/focus, and exposes an enlarged detail preview.
- Added adaptive renderer quality for very dense meshes by lowering pixel ratio and disabling dynamic shadows above the heavy-mesh threshold.

- 2026-09-29 — Generation/Post-Process/UI Integration Hardening
- Removed mandatory texture baking from the production generation pipeline; textures now come only from model-native textured generation or the dedicated Texture page.
- Preserved native textured model materials/UVs instead of running texture-destructive optimize/Auto UV stages.
- Promoted successful generation outputs into the canonical storage workspace and removed legacy output copies after post-process completion.
- Persisted backend pipeline stage/message/log telemetry through Redis and the DB-backed queue; fixed dynamic progress from overrunning real post-processing progress.
- Integrated the live pipeline panel with real backend stages and detailed post-process logs.

- 2026-09-29 — Physics Final Audit
- Preserved the normal collision artifact when Physics is off; Physics now controls physics readiness/metadata and collision quality.
- Hardened camelCase/snake_case physics config handling, canonical mass application, collider coordinate transforms, async viewer binding, and pre-ready control guards.
- Pinned Rapier to 0.19.3 and aligned Bun/npm lockfiles.
- Extended real post-processing fixture coverage through the Physics metadata/delivery path.

- 2026-09-29 — Post-Processing Validation Hardening
- Added Blender provisioning/runtime smoke validation and a real-mesh post-processing fixture test.
- Hardened canonical artifact path resolution and prevented invalid format fallbacks in the UI.
- Removed the obsolete missing P3-SAM Docker workdir.

## 2026-09-29 — Production Post-Processing Integration
- Automatically run the production mesh-finishing pipeline after successful raw mesh generation.
- Added canonical per-generation workspaces with immutable master, game-ready formats, LODs, collision, textures, previews, and metadata.
- Added protected artifact download and on-demand complete-workspace ZIP delivery.
- Updated Workspace exports to use canonical game-ready artifacts.

## 2026-09-29 — 3DGenStudio Post-Processing Pipeline Port
- Ported Auto UV, Auto Retopo, Repair, Bake, Collision, Game-Ready inspection, Blender-isolated conversion, thumbnails, and supporting utilities into backend/postprocess/.
- Added the required Python 3.10-compatible post-processing dependency block.
- Preserved upstream source attribution and Community License terms.

## 2026-09-29 — Tripo & Cross-Model Quality Pipeline Hardening
- Fixed TripoSG preprocessing to pass the filesystem path required by upstream prepare_image().
- Removed the duplicate TripoSR orientation transform.
- Wired model-specific extraction resolution for TripoSR, TripoSF, PartPacker, and UltraShape.
- Disabled PartPacker and TRELLIS.2 raw-stage face reduction/remeshing.