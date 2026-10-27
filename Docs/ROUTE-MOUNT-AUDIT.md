# Route and Mount Audit

Last reviewed: 2026-10-27

## Next.js pages

- `/` — command center
- `/dashboard`, `/outputs`, `/system`, `/admin`, `/animation`, `/rigging`
- `/workspace` — persistent workspace shell
- `/workspace/[...tool]` — explicit allow-listed workspace tool/view and optional job detail routes
- `/api/v1/[...path]` — same-origin backend proxy
- `/api/wiki/[id]` — contextual wiki content
- `/static/[...path]` — authorized static delivery

The workspace allow-list and deep-link behavior are covered by `features/workspace/lib/workspaceRouteContract.test.mjs`.

## FastAPI router parity

Both `main_singleworker.py` and `main_multiworker.py` mount the same router groups under `/api/v1`: system/database, file upload, mesh generation, image enhancement, smart generation, mesh editing, mesh tools, auto-rigging, segmentation, retopology, UV unwrapping, and motion generation.

## Verification boundary

Static route inventories and contract tests do not prove deployed proxy behavior, browser navigation, GPU inference, or DCC runtime availability. Those require the corresponding runtime environment.
