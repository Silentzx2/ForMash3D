## 2026-10-19 — Animation Export and Polling

- BVH download is limited to existing BVH artifacts; unsupported JSON conversion is disabled and labelled honestly.
- Motion status polling stops after repeated request failures and allows reconnecting to the same stored job ID.
- Manual Armature selection cannot submit an accidental UniRig job.
- Regression source contracts added; no browser or model run is claimed without CI/runtime results.

## 2026-10-19 — UV Inspector and Rigging Controls

- UV Inspector now draws sampled UV edges from the active viewport mesh and shows measured counts/bounds instead of sample artwork or hard-coded metrics; fullscreen is functional.
- Removed unsupported UniRig topology/IK/weight controls and their no-op payload; protected manual mode from launching UniRig and honored armature save failure.
- Added source-contract regression coverage; no browser/GPU success is claimed without an actual run.

## 2026-10-19 — Texture, UV and Export Contract Fixes

- The paint action exports the live viewport material texture to GLB and reports the exporter result; UV mask capture is isolated from the opaque albedo canvas.
- Mask-based model inference is rejected until adapters implement it, and Paint3D prompt input is forwarded.
- PartUV honors the requested distortion threshold and individual-part opt-out, and fails when packing fails or the expected output is missing. Inert UV options were removed; source-contract regression tests were added.
