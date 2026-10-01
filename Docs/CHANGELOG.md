## 2026-10-01 — [Active Development] Studio Wiring: VfxStudio, Sculpt Brushes, 3D Paint & Two-Way PostProcess Pipeline
- **Two-Way PostProcess Pipeline:** Verified and integrated automatic postprocessing on raw AI mesh completion in `multiprocess_scheduler.py` alongside on-demand manual triggers in `RemeshPanel.tsx`, `UVUnwrapPanel.tsx`, and `MeshSegmentPanel.tsx` with instant mesh file upload support (`.glb`, `.obj`, `.stl`, `.ply`).
- **Interactive Sculpt Brushes:** Injected 7 interactive 3D sculpting brushes (`Standard`, `Clay`, `Inflate`, `Smooth`, `Flatten`, `Pinch`, `Grab`) into `MeshEditPanel.tsx` with bilateral mirror symmetry (X/Y/Z), lazy-mouse stabilization, and auto-smooth factor.
- **3D Surface Paint:** Injected interactive viewport surface paint into `TexturePanel.tsx` with draw/erase modes, color swatches, opacity, flow, tip profiles, layer blend modes, and GPU texture baking trigger.
- **VFX Studio Integration:** Integrated `VfxStudio.tsx` into `WorkspaceShell.tsx` and created `app/vfx/page.tsx` with live 3D particle simulation viewport dock, R3F WebGL canvas, HUD telemetry, and React Flow graph node board.
- **No ComfyUI & Non-destructive Migration:** Strictly preserved existing ForMash3D components (`MeshViewer.tsx`, Zustand stores) without ComfyUI dependencies; maintained working JS/JSX files under `allowJs: true`.

## 2026-10-01 — [Active Development] 3DGenStudio Modular Tooling Staging & Architecture Realignment
- **VFX Studio Ecosystem:** Migrated complete particle graph editor, timeline, Bezier/Gradient editors, WebGL particle simulator, Unity VFX Graph package, and Unreal Niagara plugin.
- **Procedural Studios:** Integrated 2D-to-3D procedural building generator, grammar compiler, stylepacks, and procedural tree generator with dual-preview viewport.
- **Assembly & Kitbashing:** Staged multi-mesh character outfitter, landmark alignment, and conformal garment fitting service.
- **Advanced Sculpt & Mesh Extras:** Staged 7 interactive sculpting brushes, 3D surface paint, CSG booleans, gltfpack LOD generation, semantic mesh segmentation, and game-readiness audits.
- **Standalone PostProcess Microservice (Port 8200):** Formalized mesh processing tools into dedicated FastAPI microservice on port 8200 with `scripts/start_postprocess_service.sh`.
- **Comprehensive Guide:** Added `MIGRATION_AND_WIRING_GUIDE.md` detailing App Router integration, TypeScript conversion roadmap, and relative import resolution matrix.

## 2026-09-30 — README Overhaul, 3DGenStudio Attribution & SaaS Advisory
- Revamped README.md: eliminated hype claims (#1/alternatives), framed platform respectfully as inspired by Tripo AI and Meshy workflows.
- Restyled Mermaid architecture diagram with vibrant Studio Gold theme and verified node-to-node rendering compatibility.
- Documented post-processing provenance (ported from visualbruno/3DGenStudio under Community License).
- Added explicit legal warning: Apache 2.0 applies only to ForMash3D core code; third-party models and 3DGenStudio carry non-commercial/SaaS-hosting restrictions.
