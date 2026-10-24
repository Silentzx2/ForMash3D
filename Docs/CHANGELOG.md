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
