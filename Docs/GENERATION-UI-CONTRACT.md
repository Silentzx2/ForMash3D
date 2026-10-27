# Generation UI ⇄ Request ⇄ Pipeline Contract

## Ownership

`GeneratePanel.tsx` owns user intent and production choices. `buildGenerationParameters.ts` is the pure serializer. `backend/api/routers/mesh_generation.py` validates and resolves the request. The scheduler admits resources and strips request-only controls before the adapter. Adapters own model-native inference profiles. `backend/postprocess/pipeline.py` creates derivatives from the immutable master.

## Request invariants

- The input is one image reference: file ID, data URI, or server-resolved path.
- `model_parameters` carries the caller-controlled seed only.
- Intent, target polycount, topology, texture, normal baking, LOD, repair, rigging, physics, and export settings are production controls.
- Inference steps, guidance, samplers, extraction resolution, decoder choice, and low-VRAM mode are not UI controls or request-side adapter overrides. Resource placement is selected from runtime capability and scheduler resource plans.
- `enable_postprocess: false` returns raw model output and disables derivative-only controls.
- The raw result is persisted as `master/source.glb` before any derivative operation; post-processing never mutates it.

## Effective flow

```text
image + production intent
  → request builder
  → FastAPI validation/preset precedence
  → scheduler resource plan and input firewall
  → adapter-owned native inference
  → immutable master
  → optional repair / decimation / UV / bake / texture / LOD / collision / QA
  → artifact manifest and viewer URLs
```

## Verification

Every visible control must have a serialized field and a backend consumer. Contract tests cover request serialization, preset precedence, adapter-input filtering, master immutability, and artifact status. GPU inference, checkpoint loading, Blender execution, and visual quality comparisons remain hardware-dependent checks.
