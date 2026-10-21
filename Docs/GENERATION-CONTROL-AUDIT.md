# Generate Panel Control Audit — 2026-10-21

## Scope and verification boundary

This audit follows the canonical image-to-3D generation request from `GeneratePanel.tsx` through `buildGenerationParameters.ts`, the FastAPI request schemas, scheduler, and production post-processing code. “Wired” means a request field and a backend consumer exist in source. It does **not** claim that every optional runtime dependency (Blender, UniRig weights, UV/retopology workers, or a GPU model) was exercised in this pass.

## Advanced controls

| Control | Request contract | Backend consumer | Finding |
|---|---|---|---|
| Candidate Variations (1–4) | `candidate_count` | Seed planner and scheduler candidate scoring/promotion | **Wired.** A candidate count requests multiple candidates; actual execution is still governed by the effective seed plan and runtime resources. |
| Triangles / Quads | `topology_mode`, `quad_topology` | `postprocess/pipeline.py` → AutoRetopo | **Wired, dependency-conditional.** Quad conversion is attempted only when requested. A retopology failure is reported in stage status and does not prove successful quad output. |
| Bake Normal Maps | `bake_normal_maps` | Post-processing bake stage and bake status/artifact reporting | **Wired, runtime-conditional.** Bake failure is surfaced as a degraded reason; an enabled toggle is a request, not a guarantee that a bake artifact was produced. |
| LOD toggle, preset, count | `generate_lod`, `lod_preset`, `lod_count` | Post-processing LOD builder (`run_lods`) | **Wired.** LOD is separately controlled from model inference and is limited to supported profiles/counts. |
| Printability | `enable_printability_check` | Topology/printability reporting in the production pipeline | **Wired.** Produces a QA result; does not certify the mesh for every printer/material or replace external slicer validation. |
| Auto-Repair | `enable_auto_repair` | Shared repair/topology gate in the production pipeline | **Wired.** Controls whether repair is allowed to mutate geometry; the topology gate itself is not a user toggle. |
| Auto-Rig and mode | `enable_auto_rig`, `auto_rig_mode` | Scheduler-managed UniRig child job after the canonical production mesh exists | **Wired, installation/weights-conditional.** Parent finalization waits for the child result; failed rigging is reported as degraded rather than as a successful rig. |
| Physics-ready asset | `physics_enabled`, `physics_config` | Collision hull stage and provider-neutral physics metadata | **Wired.** Body type, collision quality, density/mass, friction, bounce, damping and gravity are normalized and recorded. This is exportable rigid-body metadata plus collision geometry—not an in-app physics simulation. |
| Textured generation / atlas size | `texture_enabled`, `generate_texture`, `texture_resolution` | Texture stage / native texture-preservation path | **Wired, model/stage-conditional.** Atlas resolution is downstream production output configuration, not a model inference override. |
| Target Polycount | `target_polycount` | Production decimation/remesh budget | **Wired.** Native/Raw uses a non-positive budget and bypasses decimation; a positive value is a downstream output budget. |
| Post-processing master switch | `enable_postprocess` | API + scheduler fast/raw bypass | **Wired.** When OFF, texture/post-processing, target budget, LOD, QA/repair, rigging, collision, baking and quad retopology are suppressed. |
| Seed | `model_parameters.seed` | Adapter seed input and candidate seed plan | **Wired.** The seed is an allowed runtime adapter input; numerical inference schedules remain adapter-owned. |

## Controls intentionally not active

- **Jiggle / deformation:** This is an informational, capability-gated label—not an editable feature. The backend physics normalizer deliberately serializes `deformation: "off"`; there is no current deformation/jiggle stage to wire. Do not present it as working until a real provider and output contract exist.
- **Live simulation:** “Physics-ready” creates collision geometry and portable metadata. It does not start a simulation engine in the workspace viewer.
- **Generic workflow queue (outside Generate Panel):** `WorkspaceContext.tsx::queueWorkflow` currently fails explicitly because the backend has no generic workflow-queue endpoint. The canonical image-to-3D Generate and batch paths use their dedicated generation endpoint; this generic queue stub is not part of the advanced Generate drawer and remains a separate limitation.

## Hardening completed in Batch 5

- The request builder normalizes stale/legacy topology, LOD-preset and auto-rig-mode values before submission.
- Triangle/quad request fields are emitted from one canonical topology choice, avoiding contradictory `topology_mode` and `quad_topology` values when old saved state disagrees.
- Both raw and textured image-to-mesh API schemas validate `topology_mode`, `lod_preset` and `auto_rig_mode` against the supported contract.
- TypeScript generation settings no longer advertise the unsupported `adaptive` topology or `custom` LOD preset.

## Batch 6 verification

CI must be checked against the final pushed commit. Source checks and frontend contract tests do not substitute for GPU inference, Blender-stage verification, a UniRig runtime test, or mesh-quality A/B benchmarking; these were not run as part of this audit.
