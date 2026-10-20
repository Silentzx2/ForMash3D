# ForMash3D — New Feature & UI/UX Backlog (TASKS.md)

**Target repository:** `Silentzx2/ForMash3D`
**Target branch:** `main` (verify against current `Dev` HEAD before starting — branches may have diverged)
**Scope:** New UI/UX functions, workflow upgrades, and finishing real in-code stubs. This is **not** a bug list.
**Naming heads-up:** The repo already has `Docs/TASKS.md` (an existing upload/preprocessing/export bug-audit backlog). Do not overwrite it — place this file somewhere distinct (e.g. `Docs/FEATURE-TASKS.md`) when you merge it in, even though it's named `TASKS.md` here.
**Project nature:** Personal, self-hosted, single-GPU studio — not a commercial SaaS. Every task below must stay YAGNI, avoid subscription/multi-tenant/paywall-shaped UI, and avoid generic "AI wrapper" visual language (no stock gradients-on-cards, no fake loading-skeleton theater, no made-up usage counters). Match the existing glassmorphism / `surface-0..3` token system already defined in `Docs/DESIGN.md` §1 and §10.

## How this backlog was built
Read `RULES.md`, `Docs/PRD.md`, `Docs/DESIGN.md`, `Docs/CHANGELOG.md`, and actually opened the code in `features/workspace/`, `features/admin/`, `features/settings/`, `features/board/`, `components/ui/`, `hooks/`, `services/` on `main` — not just directory names. Every task is anchored to something real found in that code: an unused primitive, a literal "coming in a future update" stub, a missing persistence layer, or a workflow with no bridge between two features that already exist separately. Cross-checked current (2026) Tripo Studio / Meshy 6 / Hyper3D workflows for functional ideas only — never for UI copying.

**20 tasks, grouped into 4 batches of 5.** Feed one task at a time to a coding agent — never the whole batch in one turn. Finish and doc-sync a batch before starting the next; each batch is ordered low-risk-first.

---

# BATCH 1 — Core Workspace UX
*Daily-use, lowest-risk, highest-payoff. Do this batch first.*

## T-01 — Properties Panel Reorganization & Power-User UX

**1. Role:** Frontend Panel/Information-Architecture Engineer (React + Radix UI, existing `surface-0..3` tokens).
**2. Startup verification:** Confirm the panel still renders correctly for every `activeTool` state (Texture/PBR, Retopo/Remesh, Generation/Model, no-asset-selected) before restructuring — the dynamic Case A/B/D branches must keep working.
**3. Context-reading rules:** Read only `features/workspace/RightPanel/RightPropertyPanel.tsx` (all ~812 lines), `components/ui/accordion.tsx`, `components/ui/collapsible.tsx`, `stores/useUIStore.ts`, `Docs/DESIGN.md` §1/§2/§10.
**4. To-do:**
1. Convert the 7 flat always-rendered sections (Transform, Geometry Stats, Dynamic Context Inspector, Shading Overrides, Mesh Diff Viewer, Model Comparison Viewer, Production Export) into collapsible groups using the already-installed `components/ui/accordion.tsx` or `collapsible.tsx` — do not build a new primitive.
2. Persist collapsed/expanded state per section in `stores/useUIStore.ts`.
3. Auto-expand the section matching the current `activeTool`; manual toggle always overrides auto behavior afterward.
4. Add a client-side text filter at the top that filters visible property rows/sections by label.
5. Keep every data binding byte-identical — layout change only, not a logic change.
**5. Output rules:** Zero filler. Diffs only, exact paths. Root-cause ≤ 2 sentences. No reprinting unchanged code.
**6. Doc sync:** `Docs/DESIGN.md` §4 and §6, `Docs/CHANGELOG.md` (keep only last 3 entries).

---

## T-02 — Command Palette (⌘K)

**1. Role:** Frontend Interaction/Navigation Engineer — `components/ui/command.tsx` already exists and is unused; use it.
**2. Startup verification:** Confirm `Docs/DESIGN.md` §9's shortcut table (⌘1/⌘2/⌘3/⌘,/G/R/T/A/K/S) still matches the live keybinding handler before wiring the palette.
**3. Context-reading rules:** Read only `components/ui/command.tsx`, the global keybinding handler, `stores/useUIStore.ts`, `Docs/DESIGN.md` §9.
**4. To-do:**
1. Wire the existing `command.tsx` primitive into a global overlay.
2. Index: tool shortcuts (existing table), recent/favorite assets (reuse `RightAssetsPanel` data), and T-08/T-16 presets once shipped.
3. Bind ⌘K / Ctrl+K, Esc to close, must not steal focus from active text inputs.
4. No telemetry/analytics logging of palette queries.
**5. Output rules:** Same as T-01.
**6. Doc sync:** `Docs/DESIGN.md` §9, `Docs/CHANGELOG.md`.

---

## T-03 — Finish the Model Comparison Viewer (Real Picker + QA Score Diff)

**1. Role:** Viewport/Diagnostics Engineer.
**2. Startup verification:** Confirm the stub is still present at `RightPropertyPanel.tsx`, "6. Model Comparison Viewer (UX-02)" — its "Select Model to Compare" handler currently just does `assets.find(a => a.id !== currentAsset.id)` instead of opening a real picker.
**3. Context-reading rules:** Read only that block in `RightPropertyPanel.tsx`, the `ModelComparisonViewer`/`MeshDiffViewer` component files, the QA scoring module under `backend/postprocess/`, `Docs/PRD.md` §6.
**4. To-do:**
1. Replace the stub with a real picker — reuse `features/mesh-extras/AssetSelectorModal.jsx`, which already exists for this exact purpose elsewhere; do not build a second picker.
2. Allow comparing two artifacts from the same job lineage (e.g. `master/source.glb` vs. a chosen LOD/retopo stage), not only two top-level assets.
3. Surface the real QA score delta and which sub-scores changed (Topology/UV/Budget per `Docs/PRD.md` §6) from backend QA output — never estimate client-side, per `Docs/DESIGN.md`'s "Workspace Data Integrity" rule.
4. Keep reusing the existing viewer components; this is a wiring fix, not a rebuild.
**5. Output rules:** Same as T-01.
**6. Doc sync:** `Docs/DESIGN.md` (Component Interaction Flow / Viewport Inspect UX), `Docs/PRD.md` §6, `Docs/CHANGELOG.md`.

---

## T-04 — Custom Keyboard Shortcut Remapping

**1. Role:** Frontend Settings/Keybinding Engineer.
**2. Startup verification:** Confirm `features/settings/PreferencesSections.tsx` still shows the literal text *"Custom keybinding support is coming in a future update"* (`ShortcutsSection`, ~line 136) before starting — this task replaces that exact placeholder.
**3. Context-reading rules:** Read only `features/settings/PreferencesSections.tsx` (`ShortcutsSection`), the global keybinding handler used by T-02, `services/settingsPersistence.ts`.
**4. To-do:**
1. Make each listed shortcut's key combo editable in place (click-to-record new combo), with conflict detection against other active bindings.
2. Persist custom bindings via the existing `services/settingsPersistence.ts` pattern — no new storage mechanism.
3. Add a "Reset to Defaults" action per-shortcut and for the whole set.
4. Keep the existing default table as the fallback when no override is stored.
**5. Output rules:** Same as T-01.
**6. Doc sync:** `Docs/DESIGN.md` §9, `Docs/CHANGELOG.md`.

---

## T-05 — Workspace Session Snapshots

**1. Role:** Frontend State Persistence Engineer.
**2. Startup verification:** Read `services/taskPersistence.ts` and `services/settingsPersistence.ts` to confirm the existing local-persistence pattern before adding a new persisted slice.
**3. Context-reading rules:** Read only those two services, `stores/useUIStore.ts`, `stores/useViewerStore.ts`, `Docs/DESIGN.md` §6.
**4. To-do:**
1. Add "Save Workspace Snapshot": captures selected asset ID, active tool/panel, T-01's per-section collapsed state, and current viewport camera position/target.
2. Persist via the existing service pattern, named by the user, listed/restorable from a small dropdown (Header or Dashboard).
3. Restoring re-selects the asset (handle gracefully if deleted), reopens the tool/panel, reapplies panel state, reframes the camera.
4. Explicit save only — no auto-snapshotting on every change.
**5. Output rules:** Same as T-01.
**6. Doc sync:** `Docs/DESIGN.md` §6, `Docs/CHANGELOG.md`.

---

# BATCH 2 — Generation & Texturing Pipeline
*Touches the generation/texture core — start once Batch 1 is merged and stable.*

## T-06 — Pick-Best-of-N Candidate Generation

**1. Role:** Next.js/FastAPI 3D Generation Pipeline Engineer.
**2. Startup verification:** Read `scripts/start.sh`, `manager.sh`, and the job-submission entrypoint in `backend/core/scheduler/multiprocess_scheduler.py`; confirm sibling-job output isn't already supported. Do not break the single-GPU mutual-exclusion lock.
**3. Context-reading rules:** Read only `features/workspace/Panels/GeneratePanel.tsx` (batch queue logic, ~lines 270-840), `stores/useAppStore.ts` (batch slice), `backend/core/scheduler/multiprocess_scheduler.py`, the generation section of `Docs/ARCHITECTURE.md`.
**4. To-do:**
1. Add an optional `candidate_count` (2–4, default 1) param — same input, varied seed per candidate.
2. Scheduler runs candidates as one logical job with N sub-results; still one job at a time on the GPU.
3. Lightbox/grid in the Generation Preview showing N thumbnails with "Use this one".
4. On selection, promote the chosen candidate through the existing `master/source.glb` checkpoint path; garbage-collect unselected candidates — no orphan job directories.
5. Keep the existing `<image name>_<job id>` storage convention.
**5. Output rules:** Same as T-01.
**6. Doc sync:** `Docs/ARCHITECTURE.md`, `Docs/DESIGN.md` §4, `Docs/CHANGELOG.md`, `README.md` capability map if it changes.

---

## T-07 — Region-Masked Texture Repaint ("Spot Retexture")

**1. Role:** Three.js Viewport Interaction Engineer + PBR Texture Pipeline Integrator (Paint3D / Hunyuan3D-Paint-v2.1).
**2. Startup verification:** Confirm in `backend/adapters/` whether Paint3D or Hunyuan3D-Paint actually expose a **masked/inpainting** entrypoint vs. full-mesh-only repaint. If neither supports a mask, stop the backend-wiring half and say so explicitly — do not fake partial repaint by silently re-running full texturing.
**3. Context-reading rules:** Read only `features/workspace/Panels/TexturePanel.tsx`, `backend/adapters/` files with `paint`/`hunyuan` in the filename, `Docs/PRD.md` §2.
**4. To-do:**
1. Add a UV-space or screen-space paint-mask tool to the viewport (brush size, feather, erase) reusing existing gizmo/controls infra.
2. Serialize the mask aligned to the mesh's existing `xatlas` UV layout — do not re-unwrap.
3. Wire mask + localized prompt to the adapter's masked-repaint call if confirmed in step 2; otherwise ship the UI + mask capture only, with an honestly labeled stub.
4. Non-destructive: write to `textures/<name>_textured_v{n}.glb`, never overwrite a prior pass.
**5. Output rules:** Same as T-01.
**6. Doc sync:** `Docs/DESIGN.md` §5/§6, `Docs/PRD.md` §2, `Docs/CHANGELOG.md`, `Docs/api-documentation.md` if routes change.

**Verified implementation status (2026-10-19):** UV mask capture is isolated from surface paint, but neither Paint3D nor Hunyuan3D-Paint applies this user mask in inference. The localized-retexture action is disabled and the API returns HTTP 422 for mask-bearing requests until a genuine adapter-supported inpainting path and regression tests exist. Do not remove that guard or claim a localized repaint before the model call actually consumes the mask.

---

## T-08 — Quick Material Preset Swatches

**1. Role:** Frontend Texture/Material UX Engineer (full-mesh, no-mask — distinct from T-07).
**2. Startup verification:** Confirm the existing `TexturePanel.tsx` full-mesh texture-generation request contract before adding a shortcut on top of it.
**3. Context-reading rules:** Read only `features/workspace/Panels/TexturePanel.tsx`, `Docs/PRD.md` §2, `constants/models.ts` (for the declaration pattern to follow).
**4. To-do:**
1. Define 6–10 curated material prompt presets (brushed metal, weathered wood, matte plastic, rough stone, fabric, chrome) as swatch chips above the free-text prompt field.
2. Clicking a swatch pre-fills (still editable) the prompt — one single code path into the existing texture call, no parallel "preset mode" request type.
3. Store the preset list as a plain constant following `constants/models.ts` conventions.
4. Swatches use a small rendered/CSS thumbnail, not an externally fetched photo.
**5. Output rules:** Same as T-01.
**6. Doc sync:** `Docs/DESIGN.md` §4, `Docs/PRD.md` §2, `Docs/CHANGELOG.md`.

---

## T-09 — Physics Material Quick Presets

**1. Role:** Frontend Physics UX Engineer — `GeneratePanel.tsx` already has raw `friction`/`restitution` sliders (~lines 1966-1967) in the Physics Preparation drawer; this adds presets on top, it does not add physics from scratch.
**2. Startup verification:** Confirm the existing slider ranges/defaults (`friction: 0.5`, `restitution: 0.1`, friction range 0-2, restitution range 0-1) before adding preset buttons that set them.
**3. Context-reading rules:** Read only the Physics Preparation block in `features/workspace/Panels/GeneratePanel.tsx` (~lines 455-465 and ~1960-1975), `features/workspace/physics/PhysicsRuntime.ts`.
**4. To-do:**
1. Add named preset buttons (Rubber, Stone, Wood, Ice, Metal, Default) above the existing sliders, each setting a friction+restitution pair.
2. Clicking a preset updates the same two existing sliders — do not add a separate physics-parameter code path.
3. Selecting a preset is non-exclusive: the user can still fine-tune the sliders afterward (preset = starting point, not a lock).
**5. Output rules:** Same as T-01.
**6. Doc sync:** `Docs/DESIGN.md` (Physics UX section), `Docs/CHANGELOG.md`.

---

## T-10 — Board-to-Generate Bridge

**1. Role:** Frontend Cross-Feature Integration Engineer (Excalidraw board + Generate panel).
**2. Startup verification:** Confirm `features/board/pages/BoardPage.jsx`'s current export/asset path (`uploadAsset`, `toServedAssetPath` in `boardHelpers.js`) before adding a shortcut on top of it.
**3. Context-reading rules:** Read only `features/board/pages/BoardPage.jsx`, `features/board/utils/boardHelpers.js`, `features/board/components/BoardAiPanel.jsx`, `features/workspace/Panels/GeneratePanel.tsx` (image-intake entrypoint only).
**4. To-do:**
1. Add a "Send to Generate" action on a selected region/element of the Excalidraw board.
2. Export that selection through the existing `urlToDataURL`/`dataURLToFile` helpers already in `boardHelpers.js` — do not write a new image-export path.
3. Hand the resulting file to `GeneratePanel.tsx`'s existing single-image upload intake exactly as a manually uploaded image would be handled — no special-cased "board image" type in the backend contract.
4. Switch the workspace view to the Generate panel with the image pre-loaded; do not auto-trigger generation.
**5. Output rules:** Same as T-01.
**6. Doc sync:** `Docs/DESIGN.md` §8 (route map) if any route changes, `Docs/CHANGELOG.md`.

---

# BATCH 3 — Animation, Jobs & Asset Management
*Independent of Batch 2; can start once Batch 1 is stable.*

## T-11 — Quick-Apply Animation Preset Library

**1. Role:** Rigging/Animation Pipeline Engineer (UniRig skeleton + `AnimationLeftPanel.tsx`).
**2. Startup verification:** Confirm the current ARDY text-to-motion `motion.json` format and the UniRig bone-naming convention in `backend/core/` rigging code before adding retargeting.
**3. Context-reading rules:** Read only `features/workspace/Animation/AnimationLeftPanel.tsx`, `stores/useAnimationStore.ts`, `stores/useRiggingStore.ts`, the UniRig-related files under `backend/core/`, `Docs/DESIGN.md` §10 (Dual-Track Timeline, X-Mirror bone-naming guard).
**4. To-do:**
1. Curate 5–10 local generic humanoid clips (idle, walk, run, wave, jump) in the existing `motion.json` schema — only license-compatible/self-authored data.
2. Reuse the existing X-Mirror bone-naming guard to retarget a clip onto any asset's UniRig skeleton — no second bone-mapping table.
3. Add a thumbnail/preview strip in `AnimationLeftPanel.tsx`; "Quick Apply" drops a preset onto the existing Dual-Track Timeline, alongside ARDY generation, not replacing it.
4. Preset playback uses the existing Three.js animation mixer/viewer.
**5. Output rules:** Same as T-01.
**6. Doc sync:** `Docs/DESIGN.md` §10, `Docs/PRD.md` §8, `Docs/CHANGELOG.md`.

---

## T-12 — Clone & Re-run Job With Edited Parameters

**1. Role:** Jobs/Scheduler Frontend Engineer — `JobDetailView.tsx` already has `handleRetryPostprocess` (~line 163); this adds an edit-before-rerun path, not blind retry.
**2. Startup verification:** Confirm `handleRetryPostprocess` and `getApiClient().retryPostprocess(selectedJobId)` still work as-is before adding a second, parameter-editable entrypoint next to it.
**3. Context-reading rules:** Read only `features/workspace/Jobs/JobDetailView.tsx`, `services/apiClient.ts` (job-submission and retry methods only), `stores/useAppStore.ts` (job state slice).
**4. To-do:**
1. Add "Clone & Edit" next to the existing "Retry Production Processing" button: opens the clicked job's original parameters pre-filled in the relevant panel (Generate/Remesh/UV/etc., based on job type).
2. Submitting creates a **new** job referencing the same source lineage — never mutates or re-labels the original job/artifacts.
3. Reuse the existing per-tool panels' submission code paths; do not build a generic "edit any job" form.
**5. Output rules:** Same as T-01.
**6. Doc sync:** `Docs/DESIGN.md` (Pipeline Execution UX section), `Docs/CHANGELOG.md`.

---

## T-13 — Notification / Activity Center

**1. Role:** Frontend Notifications Architecture Engineer — the project has ephemeral `use-toast.ts` and a per-job `ProgressOverlay.tsx`, but no persistent history; this adds the missing persistent layer.
**2. Startup verification:** Confirm `hooks/use-toast.ts` and `features/workspace/Notifications/ProgressOverlay.tsx` current behavior before adding a history layer that listens alongside them.
**3. Context-reading rules:** Read only those two files, `services/taskPersistence.ts` (persistence pattern to reuse), `Docs/DESIGN.md` (Header/Resource-Status Header UI section).
**4. To-do:**
1. Add a bell-icon entrypoint in the Header opening a dropdown/panel listing completed jobs, failures, and exports — each item links to its asset/job.
2. Persist entries via the existing `services/taskPersistence.ts` pattern; cap history length (e.g. last 100) rather than growing unbounded.
3. Existing ephemeral toasts still fire for immediate feedback; the center is the durable record, not a replacement for toasts.
4. Unread-count badge on the bell; mark-all-read action.
**5. Output rules:** Same as T-01.
**6. Doc sync:** `Docs/DESIGN.md` (Header/Resource-Status section), `Docs/CHANGELOG.md`.

---

## T-14 — Asset Collections (Folders/Grouping)

**1. Role:** Frontend Asset Management Engineer — `RightAssetsPanel.tsx` already has tags and favorites; this adds grouping on top, not a new asset system.
**2. Startup verification:** Confirm the current `assetFilter`/`isFavorite`/`tags` data shape in `RightAssetsPanel.tsx` (~lines 16-104) before adding a `collectionId`-style field next to it.
**3. Context-reading rules:** Read only `features/workspace/RightPanel/RightAssetsPanel.tsx`, `stores/useAppStore.ts` (asset state), `types/state.ts`.
**4. To-do:**
1. Add an optional collection/group field to the existing asset record shape (e.g. "all variants of this character") — reuse the existing tag-storage mechanism if it already supports arbitrary string grouping, rather than adding a parallel system.
2. Add "New Collection" / "Add to Collection" actions in the asset grid's existing context menu.
3. Add a collection filter alongside the existing `all`/`models`/`textures` filter buttons — same filter-bar pattern, not a new UI region.
4. Deleting a collection ungroups its assets; it never deletes the assets themselves.
**5. Output rules:** Same as T-01.
**6. Doc sync:** `Docs/DESIGN.md` §4, `Docs/CHANGELOG.md`.

---

## T-15 — Viewport Turntable Capture (GIF/Video/Image Sequence)

**1. Role:** Three.js Viewport/Media Export Engineer — turntable rotation already exists in `MeshViewer.tsx` (`isTurntable`), this adds capture, not rotation.
**2. Startup verification:** Confirm the current turntable render-loop logic (`isTurntableRef`, ~lines 1048/2378-2443 in `MeshViewer.tsx`) runs smoothly before hooking a frame-capture pass onto it.
**3. Context-reading rules:** Read only the turntable-related blocks in `features/workspace/Viewport/MeshViewer.tsx`, `Docs/DESIGN.md` (Viewport Inspect UX section).
**4. To-do:**
1. Add a "Capture Turntable" action that, while `isTurntable` is active, records a fixed number of frames over one full rotation to an offscreen canvas.
2. Export as an animated GIF or short MP4 (pick whichever has a lighter in-browser dependency footprint — check `package.json` for anything already installed before adding a new encoding library) or, as a zero-dependency fallback, a numbered PNG sequence ZIP.
3. Respect the viewport's current shading/lighting/background settings exactly as shown — no separate "render settings" for capture.
4. This is for quick sharing/preview, not a production render pipeline — keep it simple and client-side only.
**5. Output rules:** Same as T-01.
**6. Doc sync:** `Docs/DESIGN.md` (Viewport Inspect UX section), `Docs/CHANGELOG.md`.

---

# BATCH 4 — Export, Admin & In-App Help
*Lower urgency polish; do last.*

## T-16 — Export Quick-Profiles (Saved Export Combos)

**1. Role:** Export Pipeline UX Engineer — builds on the existing format/LOD/collision toggle set in `ExportModal.tsx`/`GameReadyPanel.jsx`, does not add a new export mechanism.
**2. Startup verification:** Confirm the current toggle/format option set in `ExportModal.tsx` before adding a "save this combo" layer on top.
**3. Context-reading rules:** Read only `features/workspace/Modals/ExportModal.tsx`, `features/mesh-extras/GameReadyPanel.jsx`, `services/settingsPersistence.ts`.
**4. To-do:**
1. Add "Save as Quick-Profile" capturing the currently selected format + LOD + collision + texture-resolution toggles under a user-given name (e.g. "Unity Bundle", "Blender Review").
2. Persist via the existing `services/settingsPersistence.ts` pattern.
3. Add a one-click profile dropdown in `ExportModal.tsx` that applies a saved combo instantly, still editable before confirming export.
4. Reuse the single existing export code path — profiles only pre-fill toggles, they never bypass validation.
**5. Output rules:** Same as T-01.
**6. Doc sync:** `Docs/PRD.md` §7, `Docs/DESIGN.md` (Production Asset Delivery UI section), `Docs/CHANGELOG.md`.

---

## T-17 — Storage Usage Breakdown & Cleanup (Outputs Page)

**1. Role:** Frontend Dashboard Engineer + Storage API Integrator — `OutputsPage.tsx` currently has no visible storage/usage breakdown.
**2. Startup verification:** Confirm whether the backend already exposes a per-asset or per-category byte-size endpoint (check `backend/api/routers/` for anything storage-stats related) before adding a new one.
**3. Context-reading rules:** Read only `features/workspace/Dashboard/OutputsPage.tsx`, the relevant `backend/api/routers/` file if a storage-stats endpoint exists, `hooks/useBackendData.ts`.
**4. To-do:**
1. Add a storage breakdown view (by category: `master/`, `game_ready/`, `textures/`, `lods/`, `rigging/`) using real backend byte counts — never an estimated/client-guessed size, consistent with the project's "Workspace Data Integrity" rule.
2. If no backend endpoint exists yet, add the smallest possible one reusing the existing `get_storage_base_dir()` helper referenced elsewhere in the codebase — do not introduce a second storage-scanning mechanism.
3. Add a "Clean up old jobs" action listing jobs older than a user-chosen threshold with their sizes, requiring explicit per-item or batch confirmation before delete.
4. Never delete anything referenced by a current asset's lineage without an explicit warning.
**5. Output rules:** Same as T-01.
**6. Doc sync:** `Docs/ARCHITECTURE.md` (storage section), `Docs/DESIGN.md`, `Docs/CHANGELOG.md`.

---

## T-18 — Admin Queue Tab: Cancel & Manual Reorder

**1. Role:** Admin Panel / Job Queue Engineer.
**2. Startup verification:** Open `features/admin/tabs/QueueTab.tsx` and `backend/core/scheduler/multiprocess_scheduler.py` first and confirm what queue control actually exists today — this task's scope depends entirely on that finding; do not assume cancel/reorder are missing, verify it.
**3. Context-reading rules:** Read only `features/admin/tabs/QueueTab.tsx`, the scheduler's queue-management functions in `backend/core/scheduler/multiprocess_scheduler.py`.
**4. To-do:**
1. If cancel-a-queued-job is missing: add it, calling into the scheduler's existing job-state machine — do not bypass it with a direct process kill.
2. If manual reorder is missing: add drag-to-reorder for **queued** (not yet running) jobs only; the currently running job and the single-GPU lock are never affected by reorder.
3. Reflect queue position/estimated start live from backend state, per the project's existing "no synthetic progress" rule in `Docs/DESIGN.md`.
4. If this audit finds cancel/reorder already fully implemented, stop and report that instead of adding duplicate UI.
**5. Output rules:** Same as T-01.
**6. Doc sync:** `Docs/ARCHITECTURE.md` (scheduler section), `Docs/CHANGELOG.md`.

---

## T-19 — Contextual In-App Help (Tool-Aware Wiki)

**1. Role:** Frontend Docs Integration Engineer — `features/wiki/` already contains a full in-app wiki (content + pages + components); this wires it contextually, it does not author new documentation content.
**2. Startup verification:** Open `features/wiki/pages/` and `features/wiki/components/` first to see how wiki articles are currently addressed/routed before adding a lookup layer on top.
**3. Context-reading rules:** Read only `features/wiki/pages/`, `features/wiki/components/` (routing/addressing files only, not content files), the panel-registration code that defines `activeTool` (already read for T-01).
**4. To-do:**
1. Add a small "?" affordance in each major panel (Generate, Retopo, UV, Texture, Rigging, Segmentation) that opens the matching existing wiki article in a side drawer/popover — map by `activeTool`, reusing whatever addressing scheme the wiki already uses (slug/id), not a new one.
2. If a matching article doesn't exist for a given tool, show a graceful "no article yet" state — do not auto-generate placeholder content.
3. Keep the wiki's own existing rendering components; this task only adds the contextual entrypoint.
**5. Output rules:** Same as T-01.
**6. Doc sync:** `Docs/DESIGN.md` §4, `Docs/CHANGELOG.md`.

---

## T-20 — DCC Bridge Quick-Send (Right-Click, Skip the Modal)

**1. Role:** Frontend DCC Integration Engineer — `DccBridgeModal.tsx` already has working one-click "Send to {DCC}" per preset; this adds a shortcut entrypoint, not new bridge logic.
**2. Startup verification:** Confirm the existing `isSending`/"Send to {preset}" flow (~line 354 in `DccBridgeModal.tsx`) still works end-to-end locally before adding a second entrypoint into it.
**3. Context-reading rules:** Read only `features/workspace/Modals/DccBridgeModal.tsx`, `features/workspace/RightPanel/RightAssetsPanel.tsx` (context-menu definition only).
**4. To-do:**
1. Add "Send to {last-used DCC}" directly in an asset's existing right-click context menu in `RightAssetsPanel.tsx`.
2. Call the exact same send function `DccBridgeModal.tsx` already uses — do not duplicate the transmit logic.
3. Remember the last-used DCC target (reuse `services/settingsPersistence.ts`) so the quick-send has something sensible to default to; first-time use with no prior target still opens the full modal.
4. The full `DccBridgeModal.tsx` remains available for preset switching/configuration — this is an accelerator, not a replacement.
**5. Output rules:** Same as T-01.
**6. Doc sync:** `Docs/DESIGN.md` §11 (DCC Live Bridge section), `Docs/CHANGELOG.md`.

---

## Suggested execution order
Batch 1 → Batch 2 → Batch 3 → Batch 4, in that order, finishing and doc-syncing each batch before starting the next. Within Batch 2, budget for T-07's backend-adapter check possibly coming back negative. Within Batch 4, T-18 explicitly may turn out to need zero new code — verify before building.

## Hard constraints for every task in every batch
- Follow `RULES.md` (Ponytail) exactly: reuse before building, smallest correct diff, no speculative abstractions, no new dependency if avoidable.
- Never mutate `master/source.glb` lineage; every new feature writes derivatives.
- No feature here may introduce subscription gating, usage credits, multi-user auth tiers, or any other SaaS-shaped UI — this is a single-user local tool.
- Update documentation per `RULES.md` "Documentation" section after every task, every time, no exceptions.

---

## T-21 — Workspace UI Organization & Final UX Polish

**1. Role:** Workspace UI/UX and Information-Architecture Engineer. This is the final, small polish task for organizing the existing workspace—not a redesign or a feature-expansion project.

**2. Startup verification:** Confirm the current `dev` branch HEAD first and inspect the live workspace implementation before changing anything. Use this uploaded feature backlog as the task source. Do **not** replace, merge, or take tasks from the repository's already-completed `Docs/TASKS.md`; do not edit that file as part of this task. Follow `RULES.md` (Ponytail) and the current `Docs/DESIGN.md` conventions.

**3. Context to inspect:** Read only the parts needed from `features/workspace/WorkspaceShell.tsx`, `features/workspace/Navigation/LeftNavigation.tsx`, `features/workspace/Header/TopHeader.tsx`, `features/workspace/RightPanel/RightWorkspacePanel.tsx`, the relevant existing workspace panels and their action handlers, the applicable primitives under `components/ui/` (especially `button.tsx`, `accordion.tsx`, `collapsible.tsx`, `drawer.tsx`, `sheet.tsx`, `dropdown-menu.tsx`, `context-menu.tsx`, `tabs.tsx`, and `simple-tooltip.tsx`), plus `RULES.md` and the relevant sections of `Docs/DESIGN.md`. Confirm each path and component still exists on `dev`; do not rely on stale line numbers or this task's assumptions.

**4. To-do:**
1. Audit the actual workspace's buttons, tool actions, navigation entries, tabs, sections, drawers, overflow menus, and repeated controls. Identify clutter, confusing groupings, duplicate entry points, and actions shown when they are not relevant to the active tool before editing.
2. Organize existing controls around the real workflow and context: keep the active tool's main action(s) easy to find; group related settings into clearly named sections; place secondary or infrequent actions in an existing drawer, dropdown, context menu, or collapsible section when that is more appropriate. Keep important actions discoverable, avoid excessive nesting, and do not hide routine actions behind multiple clicks.
3. Reuse the project's existing buttons, drawers/sheets, accordion/collapsible sections, tabs, tooltips, navigation, stores, and handlers. Prefer improving or moving an existing control over creating a duplicate component, new state layer, new service, or new UI pattern. Add a new primitive or dependency only if inspection proves the existing options cannot meet the requirement.
4. Give related actions a consistent location and naming across workspace tools without forcing every tool to show irrelevant controls. Preserve the existing distinction between the viewport, left navigation/tool area, and right-side assets/properties/execution panels. Do not remove a feature merely because its current placement is inconvenient.
5. Keep the existing design language: reuse the current `surface-0..4` tokens, established spacing/type/icon patterns, and motion conventions from `Docs/DESIGN.md`. Avoid a new visual system, decorative cards, generic gradient styling, unnecessary labels, and ornamental UI that does not improve a workflow.
6. Preserve the current responsive behavior: desktop's docked workspace layout, tablet's overlay behavior, and mutually exclusive mobile panels/drawers. Check that controls remain usable without covering essential viewport actions or creating clipped/overlapping panels.
7. Preserve all existing behavior and contracts: `activeTool`, navigation, panel mode/open state, keyboard shortcuts, action callbacks, asset selection, job submission/state, progress reporting, backend/API payloads, and export paths. Do not fake progress, invent values, duplicate business logic, or mutate `master/source.glb` lineage. Keep destructive actions clearly separated and retain any existing confirmation safeguards.
8. Check interaction details: every button must perform its advertised action; icon-only buttons need accessible names and appropriate tooltips; drawer/sheet close and Escape/focus behavior must remain correct; keyboard shortcuts must not steal input from text fields. Reuse established accessibility patterns.
9. Verify the changes on the relevant desktop, tablet, and mobile layouts using the project's existing checks and `agent-browser` as required by `RULES.md`. Run the relevant lint/typecheck/tests/build scripts that are available, and fix regressions introduced by this task. Store any browser screenshots only under `/tmp/agent-browser-screenshots/` or another scratch directory—never in the project root.

**5. Guardrails / output rules:** Smallest correct diff; no unrelated cleanup and no rewrites of working panels. Do not mark a control as implemented unless its existing or updated handler works. If inspection shows an area is already well organized, leave it alone and report that rather than manufacturing changes. Report exact changed paths, checks actually run and their results, plus any verified blocker; do not claim tests or branch changes that did not happen.

**6. Acceptance criteria:**
- Existing workspace features and actions remain available and functional; no working feature is silently deleted.
- Buttons, tool actions, settings sections, drawers, and menus have clearer grouping, fewer confusing duplicates, and context-appropriate visibility.
- Existing components and design tokens are reused wherever practical; no parallel implementation of an existing interaction is introduced.
- Desktop/tablet/mobile layouts remain usable, with no broken panel, keyboard, focus, or viewport interactions.
- Relevant documentation is updated to match the shipped behavior.

**7. Doc sync:** Update the relevant workspace/layout and component-usage sections of `Docs/DESIGN.md`, and add a concise entry to `Docs/CHANGELOG.md` while retaining its last-three-entry convention. Update `README.md` or other documentation only if the actual user-facing workflow or documented capability map changes. Follow the documentation rules in `RULES.md` and do not modify the completed `Docs/TASKS.md`.

