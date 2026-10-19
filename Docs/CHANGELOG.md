## 2026-10-20 — Experimental Max-Detail Model Settings

- Added dated upstream/community-backed experimental profiles for Hunyuan3D, TRELLIS/TRELLIS.2, Pixal3D, Hunyuan Paint and the remaining active model/tool entries.
- Updated parameter defaults across the frontend builder, scheduler and adapters; retained supported checkpoint limits and unsimplified raw master geometry.
- Added a per-model evidence/limits guide and a one-time explicit user-confirmation rule before future changes. Source-contract tests were updated; actual GPU A/B quality remains unverified.

## 2026-10-19 — Animation Export and Polling

- BVH download is limited to existing BVH artifacts; unsupported JSON conversion is disabled and labelled honestly.
- Motion status polling stops after repeated request failures and allows reconnecting to the same stored job ID.
- Manual Armature selection cannot submit an accidental UniRig job.
- Regression source contracts added; no browser or model run is claimed without CI/runtime results.

## 2026-10-19 — UV Inspector and Rigging Controls

- UV Inspector now draws sampled UV edges from the active viewport mesh and shows measured counts/bounds instead of sample artwork or hard-coded metrics; fullscreen is functional.
- Removed unsupported UniRig topology/IK/weight controls and their no-op payload; protected manual mode from launching UniRig and honored armature save failure.
- Added source-contract regression coverage; no browser/GPU success is claimed without an actual run.
