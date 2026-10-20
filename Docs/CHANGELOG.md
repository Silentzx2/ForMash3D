## 2026-10-20 — Generation Experiment Presets

- Added the Generation Experiment Lab drawer with local preset save/update/delete, seed/guidance controls, schema-driven parameters, advanced JSON overrides, revision metadata, import/export, and running through the existing queue.
- Applied explicit overrides after model-specific defaults and corrected schema caching to use field defaults rather than descriptor objects.
- Added regression coverage for final request overrides and malformed/unsafe JSON. Browser/UI and GPU checks remain unverified.

## 2026-10-20 — Experimental Max-Detail Model Settings

- Added dated upstream/community-backed experimental profiles for Hunyuan3D, TRELLIS/TRELLIS.2, Pixal3D, Hunyuan Paint and the remaining active model/tool entries.
- Updated parameter defaults across the frontend builder, scheduler and adapters; retained supported checkpoint limits and unsimplified raw master geometry.
- Added a per-model evidence/limits guide and a one-time explicit user-confirmation rule before future changes. Source-contract tests were updated; actual GPU A/B quality remains unverified.



## 2026-10-19 — Animation Export and Polling

- BVH download is limited to existing BVH artifacts; unsupported JSON conversion is disabled and labelled honestly.
- Motion status polling stops after repeated request failures and allows reconnecting to the same stored job ID.
- Manual Armature selection cannot submit an accidental UniRig job.
- Regression source contracts added; no browser or model run is claimed without CI/runtime results.
