# Generation control-to-consumer audit

This inventory follows the standard Generate panel request through the backend. The UI owns presentation and serialization; backend configuration and processing stages own behavior. A control is only supported when its request value reaches a verified consumer.

| User choice | Request contract | Verified consumer |
|---|---|---|
| Image upload or sample image | `image_file_id` (or valid `image_base64`) | `mesh_generation.image_to_raw_mesh` resolves the file input; SVG samples are rasterized and use the standard upload flow. |
| Model selection | `model_preference`, `auto_mode` | The API resolves explicit choices; the scheduler validates feature support and selects an automatic model when no explicit model is supplied. |
| Seed | `model_parameters.seed` | Scheduler seed planning passes the resolved seed to the adapter; explicit zero is preserved. |
| Intent and target triangle budget | `intent`, `target_polycount` | API preset resolution and `postprocess.pipeline` production-budget handling. Preset recipes are owned by `backend/config/smart_presets.yaml`. |
| Candidate count | `candidate_count` | Scheduler candidate/seed planning; it is removed from model-specific inference inputs. |
| Texture toggle and atlas resolution | `texture_enabled`, `texture_resolution` | Centralized texture stage in production post-processing; not a shape-inference control. |
| LOD toggle/profile/count | `generate_lod`, `lod_preset`, `lod_count` | Production pipeline LOD generation and validation. |
| Triangle/quad topology | `topology_mode`, `quad_topology` | Production retopology path; unsupported/native cases are reported instead of changing adapter inference. |
| Printability and repair | `enable_printability_check`, `enable_auto_repair` | Final topology/printability checks and the configured repair services. |
| Collision/physics | `physics_enabled`, `physics_config` | Physics preparation and collision services; physics defaults, bounds, and collision profile recipes are in `backend/config/quality.yaml`. |
| Auto-rig | `enable_auto_rig`, `auto_rig_mode` | Rigging stage, subject to installed UniRig/runtime requirements. A requested stage is not a claim that UniRig ran successfully. |
| Normal-map baking | `bake_normal_maps` | Post-processing bake stage, with status and validation returned in the result. |
| Enhancement / approved preprocessing | `enhancement_enabled`, `preprocessing_artifact_id`, `preprocessing_review_override` | API input-preparation flow; approved artifacts are reused as generation inputs. |

## Controls intentionally not exposed

The Generate panel does not expose model-specific step counts, guidance scales, samplers, decoders, or octree resolutions. Those values are adapter-owned. Legacy saved override values are filtered instead of being treated as active controls.

Deformation/jiggle simulation is not implemented as part of generation. The rigid-body physics controls configure metadata and collision preparation; they do not promise a live simulation engine. Unsupported settings must remain disabled or be described honestly rather than receiving cosmetic UI.

## Verification boundary

The frontend tests cover request serialization, bounds, legacy override filtering, sample uploads, and route contracts. Backend CPU contract tests cover seed routing, adapter profile isolation, quality gates, collision artifacts, hashing, and topology behavior. Browser interaction, production deployment, GPU/model inference, Blender-dependent stages, and checkpoint-specific output validation are separate runtime checks and are not inferred from those tests.
