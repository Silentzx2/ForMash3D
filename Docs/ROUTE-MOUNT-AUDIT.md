# Route, Page and Function Mount Audit — 2026-10-21

## Scope and method

Static source audit of the `dev` tree: Next.js App Router files, workspace route-to-tool mapping, workspace panel render switch, frontend API client references, FastAPI router decorators and both FastAPI app entrypoints. The production Docker Supervisor configuration starts `api.main_multiworker:app`.

This audit proves source-level wiring, not live deployment availability. The backend/GPU service was not running inside this source audit, so HTTP smoke tests against a deployed instance are not claimed.

## Inventory

| Surface | Count | Result |
|---|---:|---|
| Next.js page files | 9 | Mounted routes; several intentionally share `WorkspaceShell` |
| Next.js route handlers | 3 | API proxy, wiki article endpoint, static artifact proxy |
| FastAPI router modules | 14 | All are mounted in production `main_multiworker` |
| Decorator-defined FastAPI route handlers | 113 | 36 in the first 7 routers + 77 in the remaining 7 routers |
| Workspace tool types | 11 | 10 explicit panel/render mappings; `environment` remains a legacy alias to Generate and `/workspace/pbr` aliases the Mesh Tools panel |

### Next.js page routes

- `/` — home / command center.
- `/admin` — admin console.
- `/animation` and `/rigging` — legacy aliases that render `WorkspaceShell`.
- `/dashboard`, `/outputs`, `/system` — view aliases that render `WorkspaceShell`.
- `/workspace` — default workspace shell.
- `/workspace/tools` — dedicated Mesh Tools panel for inspection, optimization, Auto UV, auto-retopology, repair, collision generation, LOD 1 generation, FBX conversion, flattened albedo and high-to-low texture baking.
- `/workspace/pbr` — backward-compatible alias to the functional Mesh Tools panel and its two-mesh texture bake.
- `/workspace/upscale` — no longer accepted as a workspace route; it previously displayed only disabled buttons and has no real 3D-upscale backend.
- `/workspace/[...tool]` — workspace tool/view/job-detail route, now validated against an allow-list.

### Next.js route handlers

- `/api/v1/[...path]` — runtime proxy to FastAPI.
- `/api/wiki/[id]` — local wiki article file handler.
- `/static/[...path]` — static artifact proxy with local storage fallback.

## Confirmed issues and changes

1. **Unknown workspace paths fell back to Generate.** The catch-all page always rendered `WorkspaceShell`; the shell maps unknown tool segments to `model`. Added a shared route allow-list and `notFound()` handling. Known tool aliases and main-view aliases remain supported; UUID job deep links `/workspace/{tool}/{job_id}` and `/workspace/jobs/{id}` remain valid.
2. **Single-worker router parity was incomplete.** `main_singleworker.py` did not import or mount `users.router`, unlike production `main_multiworker.py`. Mounted `/api/v1/users` in both entrypoints and added a backend source-contract test.
3. **Orphaned part-completion client method.** `ApiClient.partCompletion()` called `/api/v1/mesh-generation/part-completion`, but the active mesh-generation router has no such route and the method had no caller. Removed the phantom method and its request type rather than leaving a guaranteed 404 path.
4. **Generic workflow queue stub.** `WorkspaceContext.queueWorkflow` unconditionally threw “not supported”, and no caller was found. Removed it from the context contract and exposed action object; dedicated generation and batch endpoints remain.
5. **Mesh tools were backend-mounted but lacked a reachable workspace entry point.** Added `/workspace/tools` and wired its existing API helpers for `inspect`, `optimize`, `auto-uv`, `auto-retopo`, `repair`, `collision`, `lods`, `convert`, `flatten` and high-to-low `bake`. Derived meshes are downloaded as GLB/FBX; texture maps are downloaded as PNG; input assets are never overwritten. `/workspace/pbr` now aliases this real panel.
6. **Duplicate and placeholder secondary panels.** Deleted the unreachable Segment/Remesh/Edit branches rather than keeping duplicate UI. Removed the unsupported 3D-upscale route from the allow-list so it returns 404 instead of presenting non-functional disabled controls; it can be restored when a real backend capability is available.

## Route mapping verification

- Production `main_multiworker` mounts system, database, users, file upload, mesh generation, image enhancement, smart generation, mesh editing, mesh tools, auto-rigging, mesh segmentation, mesh retopology, UV unwrapping and motion generation.
- `main_singleworker` now mounts the same router families.
- Workspace route segments are explicitly tested against the route allow-list; `/workspace/tools` is mounted and tested, invalid names and malformed nested paths are rejected rather than silently opening Generate; UUID job deep links are explicitly preserved.
- The unused frontend wrapper `generateSmartGeneration()` was removed; smart presets and explicit intent resolution APIs remain available to the active Generate flow.
- `/workspace/pbr` is intentionally remapped to the supported tool suite; its bake workflow requires different low-poly target and high-poly source assets, and the backend validates UV/overlap requirements.
- Home links to Generate, Remesh, Texture, UV, Rigging, Animation, Segment, Outputs, Dashboard and System were checked against page aliases or workspace route mappings.
- Several route files are aliases, not separate feature implementations. Their shared shell is intentional and should not be counted as duplicate dead pages.

## Other unimplemented/conditional paths found

- The legacy `features/image-editor`, `features/board`, `features/graph`, and `features/wiki` page modules are still not mounted by the Next.js App Router. They depend on React Router and legacy project/notification/settings contexts that are not present in the current tree, so they need a deliberate migration rather than being falsely reported as working routes.
- A dedicated neural 3D-upscale model/API is still not implemented. Its old route and button placeholders were removed rather than presented as working.
- The motion inspector states that JSON-to-BVH conversion is not implemented and disables the action unless a real BVH artifact exists.
- Jiggle/deformation remains capability-gated; physics preparation produces collision geometry and metadata, not an interactive deformation stage.

## Verification boundary

The frontend CI route contract test, TypeScript check and production build are required for this change. The backend source-contract CI checks router parity. Live HTTP checks against the deployed app, auth integration, model inference, GPU jobs and artifact downloads still require a running deployment.
