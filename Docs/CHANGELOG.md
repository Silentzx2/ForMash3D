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