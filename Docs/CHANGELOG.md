- 2026-09-29 — Physics Integration
- Added opt-in Physics preparation through the existing generation collision intent.
- Reused the existing collision pipeline and added portable physics metadata plus secure artifact delivery.
- Added a Rapier browser rigid-body preview with collider debug, Drop/Bounce/Slide/Spin tests, and a pre-generation Physics controller.
- Added physics unit coverage and documented the rigid-first, provider-neutral boundary.

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