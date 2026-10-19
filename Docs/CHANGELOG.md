## 2026-10-19 — UV Inspector and Rigging Controls

- UV Inspector now draws sampled UV edges from the active viewport mesh and shows measured counts/bounds instead of sample artwork or hard-coded metrics; fullscreen is functional.
- Removed unsupported UniRig topology/IK/weight controls and their no-op payload; protected manual mode from launching UniRig and honored armature save failure.
- Added source-contract regression coverage; no browser/GPU success is claimed without an actual run.

## 2026-10-19 — Texture, UV and Export Contract Fixes

- The paint action exports the live viewport material texture to GLB and reports the exporter result; UV mask capture is isolated from the opaque albedo canvas.
- Mask-based model inference is rejected until adapters implement it, and Paint3D prompt input is forwarded.
- PartUV honors the requested distortion threshold and individual-part opt-out, and fails when packing fails or the expected output is missing. Inert UV options were removed; source-contract regression tests were added.

## 2026-10-19 — Animation ARDY IDs and Checkpoint Compatibility

- Root cause: the animation UI sent `ardy-core` / `ardy-g1` as scheduler model IDs, although the manifest registers only `ardy_motion_generation`; the right inspector also persisted three legacy labels instead of accepted checkpoint IDs.
- Fix: generation sends the canonical model ID and derives the target skeleton from a normalized checkpoint. Both selectors now use the four actual Core/G1 checkpoints; the API and adapter normalize legacy requests.
- Unique3D note: the supplied `Attempting fallback to local img2mvimg base pipeline` line is from pre-fix adapter code. Current `dev` no longer contains that fallback and the submodule points to the corrected ThirdParty `main`; pull/sync submodules and restart the API/workers to apply it.
- Validation boundary: backend source-contract CI and frontend type-check/build cover source contracts; actual ARDY/Unique3D checkpoint inference was not run in this editing environment.
