## 2026-10-26 — Studio UI/UX Overhaul & Pipeline Stability

- **Tripo AI Benchmark Design Tokens**: Modernized `globals.css` with dark studio palette (Obsidian `#08090D`, `#16171B`, `#1D1F26` surfaces, `white/[0.06]` specular borders, warm Studio Gold `#F5C542` replacing legacy `#FFCC00`).
- **Viewport-First Full-Bleed Architecture**: 100vw x 100vh Three.js viewport canvas with radial vignette background (`#23262D` to `#111215`), 12px floating docks (320px left generation dock, 280px right inspector dock), floating vertical Viewport HUD pill (`ViewportHUD.tsx`), and persistent studio header (`TopHeader.tsx`).
- **GeneratePanel Modular Decomposition**: Deconstructed monolithic 2,736-line `GeneratePanel.tsx` down to 1,337 lines (net reduction of 1,399 lines) across 5 memoized subcomponents (`PromptAndImageDropzone`, `ModelSelectorBento`, `ProductionOptionsSection`, `AdvancedGenerationDrawer`, `GenerateActionFooter`), eliminating cascading re-renders on 2-core machines.
- **Strict Pipeline Scoping**: Preserved native single image-to-3D workflows with zero text-to-3d creep, zero multi-view creep, and zero fake SaaS credit/pricing buttons.
- **Pipeline Workflow Stepper**: Updated 56px command rail (`LeftNavigation.tsx`) with 7-stage asset creation journey (`[ 🖼️ Image ]` -> `[ 📦 Generate ]` -> `[ ✂️ Segment ]` -> `[ 🕸️ Retopo ]` -> `[ 🎨 Texture ]` -> `[ 🦴 Rig ]` -> `[ 📤 Export ]`).
- **Refactored Texture & Remesh Studios**: Streamlined `TexturePanel.tsx` into 3 organized tabs (PBR Generation, Material Overrides, Environment Lighting), and `RemeshPanel.tsx` with one-click polycount budget chips (5k, 20k, 100k) and embedded header wireframe toggle.
- **Optimistic State & Zero CLS**: Added `ActiveJobFloatingCard.tsx` with radial SVG progress ring, live elapsed timer, stage indicator, and instant cancel action; fixed container aspect ratios (`h-32`, `h-20`) to eliminate cumulative layout shift.
- **Pipeline Freezes & Detail Preserved**: Fixed TripoSG dense octree grid stall by locking depth 8/10, enabled loaded-model VRAM reuse in `planner.py`, and preserved analytical normals in Hunyuan3D/Unique3D for crisp micro-geometry definition.
- **Quality & Verification Passed**: All verification gates verified green: TypeScript (`tsc --noEmit` 0 errors), generation parameters contract (20/20 PASS), backend adapter regressions (8/8 PASS), request/seed contract (22/22 PASS), and SSOT parity (2/2 PASS). Total backend suite 69 passed / 7 skipped / 0 failed. Net code deletion: -2,034 lines across workspace frontend.

## 2026-10-24 — Postprocess texture, retopo fidelity and viewer shading guards

- Auto-rig job scheduling now uses the canonical streaming SHA-256 helper instead of importing a deleted private pipeline symbol.
- Textured GLBs receive safe metallic/roughness defaults only when omitted for albedo-only materials; UVs and degenerate base-colour atlases are checked before the texture stage is marked complete. Final game-ready export preserves the painter's original GLB scene/material bindings instead of flattening and re-exporting it.
- Auto-retopology now rejects candidates that exceed the configured normalized surface-drift gate, allowing pipeline callers to retain the previous valid derivative. Invalid imported vertex normals are recomputed, and wireframe shading uses a depth-writing surface so rear edges do not masquerade as internal duplicate geometry.
- Regression tests cover the hash import contract, retopo drift rejection, GLB JSON chunk preservation, and invalid viewport normals. Tests are added; runtime/CI results must be checked separately.

## 2026-10-23 — Production readiness verification

- All test gates green: backend `pytest` 40 passed / 6 skipped, Bun frontend 54 passed / 0 failed, `npx tsc --noEmit` zero errors; no mock data is served by production API paths.
- Auth removed entirely from backend + frontend (personal/self-hosted use, no paid SaaS).
- Feature improvements: quad topology, multi-variant candidates (1-4), part segmentation presets (3-6/6-15/15+), rig types, export formats, 3D print slicer handoff, quad-compatible smart UV.
- `dev` verified ahead of `upstream/dev` and pushed to `origin/dev`.

## 2026-10-22 — Quality, topology and artifact contracts

- Final topology and master-drift checks now affect production status; missing required comparisons do not silently pass. Auto-Repair OFF preserves geometry, safe hole repair uses configured limits, and remaining defects are reported.
- Collision decomposition failures preserve render geometry and expose the convex-hull fallback method/reason. Artifact hashing uses the canonical streaming helper.
- Added regression coverage for topology, quality gates, collision artifact isolation, configured limits and artifact hashes.

## 2026-10-22 — Generation request and adapter ownership

- Sample SVGs now rasterize to PNG and use the existing upload path. Explicit model choice is retained, seed zero is preserved, and production controls remain separate from adapter-owned inference profiles.
- Adapter profile filtering/schema alignment and request-isolation tests were added without retuning active inference schedules. The unresolved TRELLIS requested/effective step mismatch remains approval-gated.
- Removed the disconnected jiggle/deformation control; documentation now distinguishes collision preparation from live simulation.
