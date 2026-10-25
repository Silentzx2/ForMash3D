# ForMesh3D Post-Processing

Production mesh-finishing pipeline ported from 3DGenStudio and adapted to the ForMesh3D backend boundary.

## Layout

- `services/autouv/` — Auto UV charting, parameterization, packing and weld helpers.
- `services/autoretopo/` — watertight shell, adaptive remesh, projection and retopology metrics.
- `services/repair.py` — targeted topology repair.
- `services/bake.py` — isolated high-to-low baking utility used by both the generation post-process path and explicit bake workflows.
- `services/collision.py` — convex/decomposition collision generation.
- `services/inspect.py` — read-only game-ready QA inspection.
- `services/convert_fbx.py` — FBX conversion driver using the existing ForMesh3D Blender executable.
- `services/mesh_thumbnail.py` — preview generation driver.
- `tools/` — isolated Blender workers used by explicit bake/FBX/thumbnail operations.

The master asset is never modified by these services. The production pipeline can bake normal maps when requested and supported; it does not synthesize a new base-color texture during post-processing. Textured models retain the material/UV data produced by the selected model, while the dedicated Texture page owns AI painting. Integration code in the next stage owns the ForMesh3D asset workspace and lifecycle.

`pipeline.py` is the production orchestrator; it promotes the immutable master and evaluates derivative, topology, quality, and artifact status. Tunable mesh comparison policy, physics defaults/bounds, and collision quality profiles are read from `backend/config/quality.yaml` through `backend/core/config.py`, not defined as duplicate code-level recipes.

## Runtime boundary

The root `backend/postprocess` tree is the single production implementation. Interactive mesh tools are mounted by the main FastAPI application under `/api/v1/mesh-tools/*`; the retired `backend/postprocess/app` sidecar implementation and Python 3.13 runtime are not part of the default product path.
