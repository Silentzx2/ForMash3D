# ForMash3D Post-Processing

Production mesh-finishing pipeline ported from 3DGenStudio and adapted to the ForMash3D backend boundary.

## Layout

- `services/autouv/` — Auto UV charting, parameterization, packing and weld helpers.
- `services/autoretopo/` — watertight shell, adaptive remesh, projection and retopology metrics.
- `services/repair.py` — targeted topology repair.
- `services/bake.py` — isolated high-to-low baking utility kept for explicit bake workflows; it is not part of the generation post-process path.
- `services/collision.py` — convex/decomposition collision generation.
- `services/inspect.py` — read-only game-ready QA inspection.
- `services/convert_fbx.py` — FBX conversion driver using the existing ForMash3D Blender executable.
- `services/mesh_thumbnail.py` — preview generation driver.
- `tools/` — isolated Blender workers used by explicit bake/FBX/thumbnail operations.

The master asset is never modified by these services. The generation pipeline does not synthesize textures during post-processing: textured models keep the material/UV data produced by the selected model, while the dedicated Texture page owns AI painting. Integration code in the next stage owns the ForMash3D asset workspace and lifecycle.