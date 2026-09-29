- 2026-09-29 — Physics Integration
- Added opt-in Physics preparation through the existing generation collision intent.
- Reused the existing collision pipeline while preserving collision generation for all post-processed assets.
- Added provider-neutral `metadata/physics.json`, secure physics artifact delivery, and a pre-generation Physics controller.
- Added a Rapier rigid-body browser preview with collider debug and Drop/Bounce/Slide/Spin tests.
- Physics is skipped for intermediate Shape output during Shape→Paint auto-chaining and generated only for the final stage.
- Added physics unit coverage and hardened async viewer binding, key normalization, collider validation, and dependency locks.

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

