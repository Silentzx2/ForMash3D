# Generation Control Audit

Last reviewed: 2026-10-27

| Control | Request field | Consumer | Status |
|---|---|---|---|
| Candidate variations | `candidate_count` | Scheduler seed plan and candidate scorer | Active |
| Output intent | `intent` | Smart preset resolver and production pipeline | Active |
| Target polycount | `target_polycount` | Derived-mesh optimization | Active |
| Triangle/quad target | `topology_mode`, `quad_topology` | Auto-retopo / OBJ export | Active |
| Normal baking | `bake_normal_maps` | Production bake stage | Active where Blender/bake runtime exists |
| LOD chain | `generate_lod`, `lod_preset`, `lod_count` | LOD service | Active |
| Auto-repair | `enable_auto_repair` | Topology repair stage | Active |
| Printability QA | `enable_printability_check` | Printability validation | Active |
| Physics preparation | `physics_enabled`, `physics_config` | Collision and physics metadata | Active |
| Auto-rig | `enable_auto_rig`, `auto_rig_mode` | UniRig child job | Runtime/checkpoint dependent |
| Texture generation | `texture_enabled`, `texture_resolution` | Paint3D/Hunyuan Paint stage | Runtime/checkpoint dependent |
| Inference schedule | none | Adapter `_LOCKED_INFERENCE_PROFILE` | Deliberately not user-controlled |
| Low-VRAM switch | none from active workspace UI | Scheduler/resource planner | Removed; placement is automatic |

The legacy API may accept older low-VRAM or inference-style fields for compatibility and planning admission, but the scheduler removes them before adapter execution. No client control should be reintroduced without a verified consumer and regression test.
