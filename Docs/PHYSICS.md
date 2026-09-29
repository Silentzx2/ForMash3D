# ForMash3D Physics

## Current implementation status

Physics is an opt-in post-processing metadata layer plus viewer capability. It does not introduce a new AI generation model.

The existing collision pipeline remains authoritative for collision geometry. The Physics toggle controls physics readiness/metadata and the collision-quality budget. Normal post-processing still produces the collision artifact when Physics is off.

## Runtime flow

```text
AI generation
  ↓
immutable master/source.glb
  ↓
normal production post-processing
  ├─ game-ready / LOD / collision / QA
  └─ Physics ON?
       ├─ no → collision stays normal, no physics metadata
       └─ yes
           ├─ selected collision quality
           ├─ metadata/physics.json
           └─ Physics Ready result
                ↓
            Three.js viewer
                ↓
            Rapier rigid-body preview
```

## Generation contract

Mesh-generation requests accept:

- `physics_enabled`
- `physics_config`

These values are carried as job metadata rather than model-specific inference parameters.

The existing `generateCollision` frontend setting is the single generation intent flag. No second overlapping Physics enable flag is maintained.

## Controller

The pre-generation controller exposes:

- body behaviour: auto, dynamic, static, kinematic
- mass: automatic estimate or manual kilograms
- density: project default or manual kg/m³
- collision quality: fast, balanced, precise
- friction
- restitution / bounce
- linear damping
- angular damping
- gravity

All values are bounded before post-processing.

Automatic physical properties are explicitly marked as estimates. They are not treated as measured physical truth.

## Collision

Existing collision generation is reused.

Physics quality presets map to the existing service:

- Fast → convex hull
- Balanced → bounded CoACD decomposition
- Precise → higher-budget CoACD decomposition

No second collision implementation was added.

## Physics metadata

Physics-enabled jobs write:

`metadata/physics.json`

The metadata records rigid-body configuration, material response, collision statistics, property provenance, and capability flags.

The raw master is never rewritten.

## Viewer

The existing direct Three.js viewer exposes Physics mode only when an asset is marked Physics Ready.

Current rigid-body controls:

- Play / Pause
- Step
- Reset
- Collider debug visualization
- Drop
- Bounce
- Slide
- Spin

The viewer waits for the selected asset's mesh load to finish before binding physics, and disposes the runtime during asset reloads.

The simulation uses the canonical collision representation; the render mesh remains the visual object that follows the rigid body.

Jiggle / soft-body behaviour is capability-gated and is not faked by transform animation. The current production path remains rigid-body only.

## Shape → Paint

When Hunyuan Shape/Mini Turbo automatically chains into Paint, Physics preparation is skipped on the intermediate Shape result and generated only for the final Paint output. This avoids duplicate collision work.

## VRAM and dependency policy

No additional AI model is required for Physics.

Rapier runs in the browser/WASM layer, so it does not add an inference-model VRAM requirement. The normal selected generation model remains subject to ForMash3D's VRAM scheduler/budget.

The browser dependency is pinned to `@dimforge/rapier3d-compat` **0.19.3** for reproducible builds. The compat build embeds WASM for broad bundler support.

## Delivery

Physics metadata is available through:

`GET /api/v1/system/jobs/{job_id}/download?artifact_format=physics_json`

The existing complete-workspace ZIP also contains physics metadata and collision artifacts when they exist.

## Testing

Backend unit coverage:

`backend/tests/test_physics.py`

Production post-processing fixture coverage:

`backend/tests/test_postprocess_e2e.py`

The fixture test is opt-in because it exercises the full Blender/post-processing stack.

A real NVIDIA/Colab inference run remains required for complete production GPU validation.

## Extension boundary

Future joints, deformable/jiggle runtimes, native simulation providers, and engine-specific exporters must remain capability-driven. They must not replace the provider-neutral metadata contract or mutate the immutable master asset.
