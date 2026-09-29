# ForMash3D Physics

## Current implementation status

Physics is now an opt-in post-processing and viewer capability on the review-postprocess line.

The feature does not add a new AI generation model. Physics preparation reuses the existing post-processing collision service, while interactive browser simulation uses Rapier 3D.

## Runtime flow

```text
AI generation
  ↓
immutable master/source.glb
  ↓
existing production post-processing
  ↓
Physics ON?
  ├─ OFF → no physics-specific preparation
  └─ ON
      ├─ existing collision service
      ├─ metadata/physics.json
      └─ Physics Ready result
           ↓
       Three.js viewer
           ↓
       Rapier rigid-body preview
```

## Generation contract

Primary mesh-generation requests accept:

- physics_enabled
- physics_config

The values are carried as job metadata rather than model-specific inference parameters. This prevents provider adapters from receiving physics fields they do not understand.

The existing generateCollision frontend setting is the single generation intent flag. A second overlapping physicsEnabled flag is intentionally not maintained.

## Physics configuration

The controller currently exposes:

- body behaviour: auto, dynamic, static, kinematic
- mass: automatic estimate or manual kilograms
- collision quality: fast, balanced, precise
- friction
- restitution / bounce
- linear damping
- angular damping
- gravity participation

Values are bounded before entering post-processing.

Automatic physical properties are explicitly marked as estimates. They are not treated as measured physical truth.

## Collision generation

The current collision service remains the source of collision geometry:

- Fast → convex hull
- Balanced → CoACD decomposition with bounded search
- Precise → higher-budget CoACD decomposition

No second collision generator is introduced.

## Physics metadata

Enabled jobs write metadata/physics.json.

The metadata records:

- rigid body configuration
- mass/density
- material response
- collision method and statistics
- deformable capability state
- provenance for estimated vs user values
- capability flags

The raw master is never rewritten.

## Viewer

The existing direct Three.js viewer now exposes a Physics mode when an asset is Physics Ready.

Current rigid-body controls:

- Play / Pause
- Step
- Reset
- Collider debug visualization
- Drop
- Bounce
- Slide
- Spin

The viewer loads the canonical collision artifact and converts its convex parts into Rapier convex colliders. Dynamic bodies use the collision representation rather than the high-resolution render mesh.

Jiggle / soft-body simulation is capability-gated and is not faked by transform animation. The current production path remains rigid-body only.

## VRAM / dependency policy

No additional AI model is required for Physics.

Rapier runs in the browser/WASM layer, so Physics does not add an inference model VRAM requirement. The existing selected 3D generation model remains subject to the project's normal VRAM budgeting and 1 GB safety margin.

The browser dependency is @dimforge/rapier3d-compat 0.21.x. The compat build embeds WASM for broad bundler support.

## Delivery

Physics metadata is available through GET /api/v1/system/jobs/{job_id}/download?artifact_format=physics_json.

The existing workspace ZIP also contains the generated physics metadata and collision artifacts when they exist.

## Testing

Backend unit coverage lives in backend/tests/test_physics.py.

Existing post-processing E2E coverage remains in backend/tests/test_postprocess_e2e.py.

A real NVIDIA/Colab inference run is still required for full production GPU validation.

## Extension boundary

Future deformable/jiggle, joints, native simulation providers, and engine-specific exporters must be added only when the current capability and runtime requirements justify them. They must not replace the provider-neutral metadata contract or mutate the immutable master asset.