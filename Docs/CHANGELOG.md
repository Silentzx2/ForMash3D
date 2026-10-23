## 2026-10-23 — Production readiness verification

- All test gates green: backend `pytest` 40 passed / 6 skipped, Bun frontend 54 passed / 0 failed, `npx tsc --noEmit` zero errors; no mock data is served by production API paths.
- End-to-end auth wiring confirmed: API proxy forwards `Authorization` on GET/POST/PUT/DELETE and SSE; `verify_api_key` validates stored user tokens when user auth is enabled; multi-worker Redis rate-limit fallback restored.
- `dev` verified ahead of `upstream/dev` and pushed to `origin/dev`.

## 2026-10-22 — Quality, topology and artifact contracts

- Final topology and master-drift checks now affect production status; missing required comparisons do not silently pass. Auto-Repair OFF preserves geometry, safe hole repair uses configured limits, and remaining defects are reported.
- Collision decomposition failures preserve render geometry and expose the convex-hull fallback method/reason. Artifact hashing uses the canonical streaming helper.
- Added regression coverage for topology, quality gates, collision artifact isolation, configured limits and artifact hashes.

## 2026-10-22 — Generation request and adapter ownership

- Sample SVGs now rasterize to PNG and use the existing upload path. Explicit model choice is retained, seed zero is preserved, and production controls remain separate from adapter-owned inference profiles.
- Adapter profile filtering/schema alignment and request-isolation tests were added without retuning active inference schedules. The unresolved TRELLIS requested/effective step mismatch remains approval-gated.
- Removed the disconnected jiggle/deformation control; documentation now distinguishes collision preparation from live simulation.

## 2026-10-22 — CI and documentation synchronization

- Backend Runtime Contract CI runs the full backend CPU contract suite and declares the dependencies imported by those tests. The Python 3.10 full run passed 50 backend/third-party tests with one SQLAlchemy deprecation warning; the subsequently added config-mirror parity check passed with both config tests under Python 3.14, but the complete backend suite was not rerun in that environment.
- Frontend CI runs all Bun contract tests rather than a hand-selected subset; all 52 local tests, the TypeScript check, and production build passed. Targeted ESLint on changed frontend files reported 0 errors and 58 warnings.
- Updated repository guidance for actual test commands, the generation UI/request boundary, post-processing bake behavior, and runtime-validation limits.
- GPU/model inference, browser interaction, deployed API smoke tests, Blender stages and UniRig execution were not run.
