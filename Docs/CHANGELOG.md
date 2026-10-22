## 2026-10-22 — Quality, topology and artifact contracts

- Final topology and master-drift checks now affect production status; missing required comparisons do not silently pass. Auto-Repair OFF preserves geometry, safe hole repair uses configured limits, and remaining defects are reported.
- Collision decomposition failures preserve render geometry and expose the convex-hull fallback method/reason. Artifact hashing uses the canonical streaming helper.
- Added regression coverage for topology, quality gates, collision artifact isolation, configured limits and artifact hashes.

## 2026-10-22 — Generation request and adapter ownership

- Sample SVGs now rasterize to PNG and use the existing upload path. Explicit model choice is retained, seed zero is preserved, and production controls remain separate from adapter-owned inference profiles.
- Adapter profile filtering/schema alignment and request-isolation tests were added without retuning active inference schedules. The unresolved TRELLIS requested/effective step mismatch remains approval-gated.
- Removed the disconnected jiggle/deformation control; documentation now distinguishes collision preparation from live simulation.

## 2026-10-22 — CI and documentation synchronization

- Backend Runtime Contract CI now runs the full backend CPU contract suite and declares the geometry/render dependencies imported by those tests. A clean Python 3.10 environment passed all 44 backend/third-party tests.
- Updated repository guidance for actual test commands, the generation UI/request boundary, post-processing bake behavior, and runtime-validation limits.
- GPU/model inference, deployed API smoke tests, production build/browser verification, Blender stages and UniRig execution were not run.
