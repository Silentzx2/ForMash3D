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
| Workspace tool types | 11 | 10 have explicit panel/render mappings; `environment` is a legacy alias to Generate, not a separate panel |

### Next.js page routes

- `/` — home / command center.
- `/admin` — admin console.
- `/animation` and `/rigging` — legacy aliases that render `WorkspaceShell`.
- `/dashboard`, `/outputs`, `/system` — view aliases that render `WorkspaceShell`.
- `/workspace` — default workspace shell.
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
5. **Unused wrapper retained intentionally.** `ApiClient.generateSmartGeneration()` targets an existing `/api/v1/smart-generation/generation` backend route, but no frontend caller was found in the source search. It remains an unused wrapper, not a mounted workspace action; decide separately whether to activate or remove it.

## Route mapping verification

- Production `main_multiworker` mounts system, database, users, file upload, mesh generation, image enhancement, smart generation, mesh editing, mesh tools, auto-rigging, mesh segmentation, mesh retopology, UV unwrapping and motion generation.
- `main_singleworker` now mounts the same router families.
- Workspace route segments are explicitly tested against the route allow-list; invalid names and malformed nested paths are rejected rather than silently opening Generate; UUID job deep links are explicitly preserved.
- Home links to Generate, Remesh, Texture, UV, Rigging, Animation, Segment, Outputs, Dashboard and System were checked against page aliases or workspace route mappings.
- Several route files are aliases, not separate feature implementations. Their shared shell is intentional and should not be counted as duplicate dead pages.

## Other unimplemented/conditional paths found

- Legacy admin/runtime methods in `services/apiClient.ts` explicitly report unsupported endpoints instead of silently claiming success; these are not considered mounted API capabilities.
- The motion inspector states that JSON-to-BVH conversion is not implemented and disables the action unless a real BVH artifact exists.
- Jiggle/deformation remains capability-gated; physics preparation produces collision geometry and metadata, not an interactive deformation stage.

## Verification boundary

The frontend CI route contract test, TypeScript check and production build are required for this change. The backend source-contract CI checks router parity. Live HTTP checks against the deployed app, auth integration, model inference, GPU jobs and artifact downloads still require a running deployment.
