# ForMash3D Post-Processing

Production mesh-finishing pipeline ported from 3DGenStudio and adapted to the ForMash3D backend boundary.

## Layout

- `services/autouv/` — Auto UV charting, parameterization, packing and weld helpers.
- `services/autoretopo/` — watertight shell, adaptive remesh, projection and retopology metrics.
- `services/repair.py` — targeted topology repair.
- `services/bake.py` — high-to-low texture baking driver.
- `services/collision.py` — convex/decomposition collision generation.
- `services/inspect.py` — read-only game-ready QA inspection.
- `services/convert_fbx.py` — FBX conversion driver using the existing ForMash3D Blender executable.
- `services/mesh_thumbnail.py` — preview generation driver.
- `tools/` — isolated Blender workers used by bake/FBX/thumbnail operations.

The master asset is never modified by these services. Integration code in the next stage owns the ForMash3D asset workspace and lifecycle.