# Deep Engineering Audit — Texture Generation, UV, Rigging & Animation

**Audit date:** 2026-10-19  
**Main repository:** [Silentzx2/ForMash3D](https://github.com/Silentzx2/ForMash3D)  
**Audited branch / HEAD:** `dev` — `d8903e3137115ff677a24bc457da3b5d14d61590`  
**Third-party repository:** [Silentzx2/ForMash3D-ThirdParty](https://github.com/Silentzx2/ForMash3D-ThirdParty)  
**Submodule pointer in dev:** `2650d55ca7b18b6a1280ab4abbfea00cd9e95331`  
**Third-party main HEAD:** `2650d55ca7b18b6a1280ab4abbfea00cd9e95331` — matches the pinned pointer.  
**Mode:** Static source audit followed by minimal implementation fixes. GPU inference and browser end-to-end execution are still unverified.

## Executive summary

The audit followed the four requested workflows from UI controls through workspace state, API request schemas/routes, scheduler inputs, model adapters, and the relevant vendored functions. The findings below are grounded in the current source paths and line ranges linked in each item.

| ID | Severity | Area | Confirmed finding |
|---|---|---|---|
| TEX-01 | P2 | Spot retexture | The user-supplied UV mask does not reach either selected texture pipeline as an effective inpainting mask; the text prompt is also not propagated by the image-painting API contract. |
| TEX-02 | P2 | Paint baking | “BAKE PAINT TO TEXTURE” only displays a success toast and does not invoke a bake operation. |
| UV-01 | P2 | UV Inspector | The inspector draws procedural sample islands and hard-coded UV statistics instead of showing the selected asset's actual UV data. Its channel selector and Fit/Fullscreen controls are not connected to viewer behavior. |
| UV-02 | P2 | UV settings | UV settings supplied by the UI are placed into the request but are not consumed by the PartUV adapter; the requested distortion threshold is also not forwarded into the PartUV runner. |
| UV-03 | P2 | UV output files | Setting save-individual-parts to false hides the returned directory but does not stop PartUV from writing every individual-part OBJ. |
| UV-04 | P2 | UV packing | Packing errors are downgraded to warnings and an un-packed mesh is returned as an ordinary result while metadata still records the requested pack method. |
| RIG-01 | P2 | Rigging options | Several visible topology/rigging options are sent in model parameters but never read by the UniRig adapter; reuse-existing-weights is not sent in the request at all. |
| RIG-02 | P2 | Save armature | The legacy Rigging inspector ignores the boolean failure returned by the store's localStorage save function and still reports success/navigates to Animation. |
| RIG-03 | P2 | Manual rig mode | The legacy left panel allowed Manual Armature selection but still invoked the UniRig generation action. |
| ANIM-01 | P2 | BVH export | When the active clip is not already a BVH file, the BVH export handler only displays an informational toast; it does not convert, queue, or download a BVH artifact. |
| ANIM-02 | P3 | Motion polling | Transient job-status polling failures are only logged. Polling continues indefinitely with no bounded retry/error state while the component remains mounted. |

**P2** means a visible action, displayed data, generated artifact, or user-configured behavior does not match the actual code path. **P3** means a reliability/termination defect whose impact depends on a runtime failure. These are source-audit severities, not a substitute for production incident prioritization.

## Audit method and limits

- Read the repository's mandatory RULES.md before reviewing the flows; retained its root-cause/minimal-diff discipline.
- Traced Texture Generation through TexturePanel and WorkspaceContext into the image-mesh-painting request, router, adapter configuration, and the vendored Paint3D stage-two implementation.
- Traced UV generation through UVUnwrapPanel, WorkspaceContext, the UV request model/router, PartUV adapter/utility, and vendored PartUV result-saving logic.
- Traced Rigging through RiggingStudio/RiggingRightInspector, useRiggingStore, the auto-rigging API, UniRig adapter, and UniRig helper module/import paths.
- Traced Animation through AnimationLeftPanel and AnimationRightInspector, including ARDY job polling and export handlers.
- Inspected the existing adapter-import and source-contract tests, then checked the pinned third-party tree and the exact vendored files that the reviewed paths call.

This is a **static source audit**, not a claim that GPU inference, Blender, browser UI, or end-to-end jobs were run. No test/build/runtime command was executed through the connected GitHub interface. The repository currently contains import and source-contract tests, but their existence is not reported here as a passing run. The third-party tree contains 4,102 entries; the review was focused on the vendored implementations invoked by these four workflows and on relevant import-path resolution, not a line-by-line audit of all vendored files.

## Implementation progress

| Finding | Current status on dev |
|---|---|
| TEX-01 | **Mitigated** — UV masks use a separate capture canvas; model-based mask retexture is disabled and mask-bearing API requests fail with 422 until adapters support it. Paint3D prompt forwarding is fixed. |
| TEX-02 | **Fixed** — the paint action exports the live-painted viewport mesh as GLB and reports exporter success/failure. |
| UV-01 | **Fixed** — inspector requests the loaded mesh UV channel, renders actual UV triangle edges (sampled for responsiveness), shows measured geometry/UV counts and bounds, and implements fullscreen. Unsupported metrics are not shown. |
| UV-02 | **Fixed** — threshold is passed into PartUV; settings the algorithm does not consume were removed from the UI. |
| UV-03 | **Fixed** — individual part files are not written when the opt-out is false. |
| UV-04 | **Fixed** — packing failure or missing output now fails the UV task. |
| RIG-01 | **Fixed** — unsupported UniRig topology/IK/weight override controls were removed instead of submitting ignored parameters; manual mirror remains editor-only. |
| RIG-02 | **Fixed** — legacy armature inspector checks the persisted-save result before success notification/navigation. |
| RIG-03 | **Fixed** — Manual Armature mode no longer dispatches a UniRig AI job. |
| ANIM-01 | **Mitigated** — BVH download is enabled only when the selected clip already contains a BVH artifact; unsupported JSON conversion is no longer presented as a generation action. |
| ANIM-02 | **Fixed** — status polling stops after five consecutive failures, retains the existing job ID, and exposes a retry that does not resubmit generation. |

## Detailed findings

### TEX-01 — Spot retexture does not apply the submitted user mask

**Severity:** P2  
**Relevant code:**
- [TexturePanel.tsx, spot-retexture action](https://github.com/Silentzx2/ForMash3D/blob/dev/features/workspace/Panels/TexturePanel.tsx#L1248-L1278)
- [WorkspaceContext.tsx, runTextureGeneration](https://github.com/Silentzx2/ForMash3D/blob/dev/features/workspace/store/WorkspaceContext.tsx#L1848-L1952)
- [ImageMeshPaintingRequest and validators](https://github.com/Silentzx2/ForMash3D/blob/dev/backend/api/routers/mesh_generation.py#L357-L436)
- [Image painting route and queued input payload](https://github.com/Silentzx2/ForMash3D/blob/dev/backend/api/routers/mesh_generation.py#L1250-L1328)
- [Paint3D adapter mask/config wiring](https://github.com/Silentzx2/ForMash3D/blob/dev/backend/adapters/paint3d_adapter.py#L810-L855)
- [Pinned Paint3D stage-two mask handling](https://github.com/Silentzx2/ForMash3D-ThirdParty/blob/2650d55ca7b18b6a1280ab4abbfea00cd9e95331/Paint3D/pipeline_paint3d_stage2.py#L31-L42)
- [Hunyuan3D-Paint processing path](https://github.com/Silentzx2/ForMash3D/blob/dev/backend/adapters/hunyuan3d_paint_v21.py#L470-L555)

**Evidence / root cause**

1. The UI button updates React texture settings and immediately calls runTextureGeneration in the same click handler. That callback reads the settings captured by its current render, so it cannot rely on the just-scheduled state update to supply the new spot prompt/mask on that first invocation.
2. The selected image-painting request schema defines mask fields but no text_prompt field. The route constructs queued inputs from the request fields and model parameters without forwarding a request-level text prompt. The UI's spot prompt therefore does not make it to the adapter via this endpoint contract.
3. Paint3D accepts mask_path into its generated stage-two configuration, but the pinned third-party pipeline's UV_inpaint function regenerates a mask from its current albedo image and assigns that newly generated path to p_cfg.mask_path. This replaces the user-supplied mask before inference.
4. Hunyuan3D-Paint reads/logs mask_path, but its paint_pipeline invocation receives mesh, reference image, output path, and use_remesh/save_glb options—not the user mask. The logged mask does not affect the shown call.

The audit also added RIG-03 after a further pass discovered that Manual Armature selection still entered the UniRig submit handler; this is now guarded and documented below.

The UI already displays a limitation notice saying these adapters perform full-mesh texturing. That notice is useful, but the adjacent enabled action is still labelled “Generate Retexture with Mask” and sends fields that do not achieve the advertised targeted repaint.

**Impact**

The operation may retexture the entire mesh rather than just the selected region; the spot prompt can also be absent from the submitted job. A mask path appearing in a request or log must not be treated as proof that inpainting used it.

**Minimal correction direction**

Do not advertise/enable mask-based retexture until there is a real adapter-supported mask path. If implementing it, construct the full request from the intended immediate values rather than depending on a just-scheduled React state update, add an explicit prompt field to the request contract and queued inputs, then preserve the user mask through each selected adapter and the vendored Paint3D stage-two path. Add route/adapter tests asserting that a supplied mask reaches the inference call unchanged. Keep full-mesh texturing available separately.

### TEX-02 — The paint-bake button reports success without baking anything

**Severity:** P2  
**Relevant code:** [TexturePanel.tsx, Bake & Action Controls](https://github.com/Silentzx2/ForMash3D/blob/dev/features/workspace/Panels/TexturePanel.tsx#L1522-L1537)

**Evidence / root cause**

The BAKE PAINT TO TEXTURE onClick handler only calls toast.success with text claiming viewport projections were successfully baked. The handler does not invoke a bake function, API route, export method, or event dispatch.

The repository contains separate mesh baking code and a mesh-tools bake API contract, so the current handler is disconnected from an existing feature area rather than evidence that baking completed.

**Impact**

A user can receive a success message and proceed under the false assumption that paint was written to a material texture. It can silently lose expected output because no baking action occurred.

**Minimal correction direction**

Wire this button to the existing appropriate bake workflow and show success only after the returned artifact/material update is verified. If there is no compatible operation for viewport paint projections, disable the action or report that limitation instead of returning success. Add a small handler-level regression test proving the action invokes the intended operation.

### UV-01 — The UV Inspector shows sample artwork and fabricated statistics

**Severity:** P2  
**Relevant code:** [UVInspector.tsx, canvas renderer and controls](https://github.com/Silentzx2/ForMash3D/blob/dev/features/workspace/RightPanel/UVInspector.tsx#L12-L107), [channel/view controls](https://github.com/Silentzx2/ForMash3D/blob/dev/features/workspace/RightPanel/UVInspector.tsx#L150-L225)

**Evidence / root cause**

- The canvas effect manually draws stylized torso, helmet, limb, and shield shapes. It does not read the selected asset's geometry, UV attribute, or UV result artifact; the effect is keyed only on activeTab.
- The UV Channel selector updates uvChannel state, but the displayed canvas does not use that state and the drawing effect does not depend on it.
- UV Islands, min/average/max texel density, coverage and overlap values are literal values (48, 512 px/m, 87.4%, 2,048 px/m, 0 and 1,024 px/m), not calculations from the selected asset.
- Fit to View and Fullscreen have no click handlers.

**Impact**

The inspector can display a plausible-looking but unrelated layout and apparently authoritative metrics. It cannot be used to validate the UV result from the selected mesh.

**Minimal correction direction**

Render UVs from the selected mesh's actual UV attribute or the generated UV artifact, update when the asset/channel changes, and derive statistics only from real UV/mesh data. Until those values are connected, label the canvas as a preview/mock and do not present hard-coded metrics as measured output. Either implement Fit/Fullscreen or remove the controls.

### UV-02 — UV model parameters and the requested distortion threshold are not applied

**Severity:** P2  
**Relevant code:**
- [UVUnwrapPanel.tsx, request parameters](https://github.com/Silentzx2/ForMash3D/blob/dev/features/workspace/Panels/UVUnwrapPanel.tsx#L25-L42)
- [WorkspaceContext.tsx, request construction](https://github.com/Silentzx2/ForMash3D/blob/dev/features/workspace/store/WorkspaceContext.tsx#L1955-L1978)
- [UV request model and route payload](https://github.com/Silentzx2/ForMash3D/blob/dev/backend/api/routers/mesh_uv_unwrapping.py#L55-L110) and [job inputs](https://github.com/Silentzx2/ForMash3D/blob/dev/backend/api/routers/mesh_uv_unwrapping.py#L190-L210)
- [PartUV adapter parameter extraction and runner call](https://github.com/Silentzx2/ForMash3D/blob/dev/backend/adapters/partuv_adapter.py#L135-L185)
- [PartUV runner threshold usage](https://github.com/Silentzx2/ForMash3D/blob/dev/backend/utils/partuv_utils.py#L138-L225)

**Evidence / root cause**

The UI sends seam_angle, island_margin, iterations, prevent_overlaps, fill_holes, and resolution through model_parameters. WorkspaceContext includes those fields in the request and the route spreads them into scheduler JobRequest inputs. However, PartUVAdapter._process_request only extracts output format, distortion threshold, pack method, save options, and hierarchy path; it does not read or forward those six model parameters. They have no effect on the shown PartUV call.

Separately, PartUVAdapter reads distortion_threshold from the job inputs, but the call to PartUVRunner.generate_uv_from_mesh does not pass the requested value. The runner uses its instance-level distortion threshold instead, so a non-default API request threshold is ignored.

The router validator also restricts pack_method to blender, notwithstanding lower-level adapter/helper support for other strings. The active UI currently asks for blender, so that mismatch is not listed as a separate user-visible defect.

**Impact**

Changing model parameters in the UV request does not change PartUV behavior as the UI suggests. External clients using a non-default distortion threshold also receive output generated with the runner's configured threshold, not their requested value.

**Minimal correction direction**

Map only settings genuinely supported by the installed PartUV pipeline. If PartUV does not implement a setting, stop sending it as an effective option or label it unsupported rather than passing inert fields. Forward the requested distortion threshold into the runner in one consistent place and test both default and non-default values end to end through the request → job inputs → adapter → runner boundary.

### UV-03 — save_individual_parts=false still writes all individual OBJ parts

**Severity:** P2  
**Relevant code:**
- [UV panel setting](https://github.com/Silentzx2/ForMash3D/blob/dev/features/workspace/Panels/UVUnwrapPanel.tsx#L28-L38)
- [PartUV adapter pass-through](https://github.com/Silentzx2/ForMash3D/blob/dev/backend/adapters/partuv_adapter.py#L165-L185)
- [PartUV utility result saving](https://github.com/Silentzx2/ForMash3D/blob/dev/backend/utils/partuv_utils.py#L228-L280)
- [Pinned PartUV save_results implementation](https://github.com/Silentzx2/ForMash3D-ThirdParty/blob/2650d55ca7b18b6a1280ab4abbfea00cd9e95331/PartUV/partuv/preprocess.py#L77-L100)

**Evidence / root cause**

The UI explicitly passes saveIndividualParts=false. The API and adapter preserve that flag and pass it to generate_uv_from_mesh. But the utility always calls save_results for every generated result. In the pinned third-party function, save_results unconditionally creates individual_parts and iterates through individual_parts, exporting each part OBJ. The flag is consulted later only to decide whether the result dictionary exposes individual_parts_dir.

**Impact**

Every run writes per-part OBJ files even when the caller opted out. Large meshes with many parts can produce unnecessary disk writes and retained output files; the response hides the directory rather than preventing file creation.

**Minimal correction direction**

Honor save_individual_parts at the point individual part files are written. Prefer a minimal compatible change that avoids changing the third-party public result contract unnecessarily; if the vendored function must change, follow RULES.md by synchronizing both repositories. Add a test with the flag false that asserts no individual-part files are created, and a true case that asserts they are.

### UV-04 — Packing can fail yet return an apparently normal result

**Severity:** P2  
**Relevant code:** [PartUV utility packing and result metadata](https://github.com/Silentzx2/ForMash3D/blob/dev/backend/utils/partuv_utils.py#L245-L281)

**Evidence / root cause**

When Blender/UVPackMaster packing is requested, exceptions from pack_mesh are caught and logged as a warning only. The utility then selects final_components.obj when packed_mesh_path is still empty and returns it as output_mesh_path. The metadata continues to report the requested pack_method (for non-none methods) and does not mark packing as failed.

**Impact**

The scheduler/caller receives a usable mesh result but cannot distinguish “UV unwrapped and packed” from “UV unwrapped but packing failed.” The UI advertises an automatic packing workflow and zero overlap, so the distinction matters for downstream texturing and quality validation.

**Minimal correction direction**

Track packing status independently from the requested method. Either fail the task when packing is a required contract, or return an explicit degraded/failed packing status and a truthful warning so the UI cannot present packing as completed. Test by forcing pack_mesh to raise and asserting the returned status/output metadata accurately reports that outcome.

### RIG-01 — UniRig silently ignores several UI rigging settings

**Severity:** P2  
**Relevant code:**
- [RiggingStudio.tsx, topology and options](https://github.com/Silentzx2/ForMash3D/blob/dev/features/workspace/Rigging/RiggingStudio.tsx#L595-L635)
- [useRiggingStore.ts, submitted parameters](https://github.com/Silentzx2/ForMash3D/blob/dev/stores/useRiggingStore.ts#L286-L319)
- [auto_rigging route, scheduler inputs](https://github.com/Silentzx2/ForMash3D/blob/dev/backend/api/routers/auto_rigging.py#L151-L205)
- [UniRigAdapter, extracted parameters and inference calls](https://github.com/Silentzx2/ForMash3D/blob/dev/backend/adapters/unirig_adapter.py#L210-L290)

**Evidence / root cause**

The frontend exposes skeleton topology values biped/humanoid/quadruped and options including IK creation and weight optimization. The store submits target_skeleton, optimize_weights, create_ik and symmetry in model_parameters. The route correctly spreads model_parameters into the scheduled job inputs.

The UniRig adapter's processing method reads rig_mode, output_format, seed, with_skinning, skeleton_config and skin_config. It does not read target_skeleton, optimize_weights, create_ik or symmetry before calling the UniRig inference engine. The engine calls shown in this path receive the existing skeleton/skin config arguments, not these UI values. In addition, reuseExistingWeights is stored in the frontend store but is not included in the request payload.

This finding concerns settings passed through this UniRig path. It does not claim the separate manual editor armature workflow is entirely nonfunctional.

**Impact**

Those controls can look like real inference settings while the generated rig ignores their requested values. The caller cannot infer that a quadruped target or IK/weight option was honored just because it appears in the queued request.

**Minimal correction direction**

Confirm which options the pinned UniRig implementation genuinely supports, map supported ones to its config/inference calls, and remove or explicitly disable unsupported controls. Add a request-to-adapter contract test for every retained option. Do not pretend that the model supports target skeletons or generated IK if the underlying model does not expose that capability.

### RIG-02 — Legacy Rigging inspector ignores save failure

**Severity:** P2  
**Relevant code:** [RiggingRightInspector.tsx](https://github.com/Silentzx2/ForMash3D/blob/dev/features/workspace/Rigging/RiggingRightInspector.tsx#L65-L75), [useRiggingStore.ts](https://github.com/Silentzx2/ForMash3D/blob/dev/stores/useRiggingStore.ts#L344-L362)

**Evidence / root cause**

The inspector awaits applyAndSaveRig, then immediately displays “Rig applied successfully” and navigates to Animation. The store catches a localStorage failure and returns false rather than throwing. Because the caller ignores that return value, the catch block does not run and the UI reports success on a failed save.

The newer RiggingStudio save handler checks the boolean result; this finding is limited to the legacy right-inspector handler.

**Impact**

A full localStorage quota, privacy/storage restriction, or other persistence failure can lead to false success and navigation away from the saved editor state.

**Minimal correction direction**

Check the returned boolean and navigate only when true, matching the existing RiggingStudio caller. Add a focused test that forces storage failure and asserts that no success notification/navigation is triggered.

### RIG-03 — Manual Armature selection could launch UniRig anyway

**Severity:** P2  
**Relevant code:** [RiggingLeftPanel.tsx](https://github.com/Silentzx2/ForMash3D/blob/dev/features/workspace/Rigging/RiggingLeftPanel.tsx#L120-L245), [useRiggingStore.ts](https://github.com/Silentzx2/ForMash3D/blob/dev/stores/useRiggingStore.ts#L285-L320)

**Evidence / root cause**

The left panel exposed an Auto Rig / Manual Armature selector, but its Generate button always called `generateRig`, which submits a `unirig_auto_rig` scheduler job. The selected `riggingMethod` was not checked in that handler.

**Fix**

The handler now guards manual mode, the UniRig generation button is disabled when Manual Armature is selected, and the label/notification no longer imply a manual action starts neural inference. Manual editor symmetry remains local to the editor.

### ANIM-01 — BVH export is an informational toast, not an export

**Severity:** P2  
**Relevant code:** [AnimationRightInspector.tsx, handleExportMotion](https://github.com/Silentzx2/ForMash3D/blob/dev/features/workspace/Animation/AnimationRightInspector.tsx#L107-L155), [BVH export button](https://github.com/Silentzx2/ForMash3D/blob/dev/features/workspace/Animation/AnimationRightInspector.tsx#L830-L850)

**Evidence / root cause**

If the selected clip URL already ends with .bvh, the handler opens that URL. Otherwise, it only displays “Generating BVH MoCap Stream” with a description about exporting the skeletal trajectory. The shown handler does not call a converter, backend route, job submission, or file download in that branch. ARDY-generated clips use the job-download JSON URL, so they follow this no-operation branch rather than the already-BVH branch.

**Impact**

The button sounds like it creates an artifact but no BVH output is produced by the handler for ordinary generated motion JSON clips.

**Minimal correction direction**

Either route the clip through an actual JSON-to-BVH conversion/export path and download the generated file, or disable/rename the unsupported action until conversion exists. Do not use a generation/export toast as a substitute for a completed operation. Test both an already-BVH input and the JSON motion path.

### ANIM-02 — ARDY polling never bounds repeated transient failures

**Severity:** P3  
**Relevant code:** [AnimationLeftPanel.tsx, motion job polling](https://github.com/Silentzx2/ForMash3D/blob/dev/features/workspace/Animation/AnimationLeftPanel.tsx#L230-L290)

**Evidence / root cause**

The interval polls job status every 1.5 seconds and clears itself for completed, failed, or cancelled statuses. The catch block only logs the polling error. It does not count repeated failures, set an actionable error state, stop after a retry policy, or otherwise terminate polling while the component remains mounted. The component-unmount cleanup clears the timer, but that does not handle a still-mounted page with a persistently failing status endpoint.

**Impact**

The UI can remain in generating state indefinitely during a sustained API/network error, continuously retrying with no recovery guidance.

**Minimal correction direction**

Retain retries for temporary failures, but bound them or use a backoff and expose a recoverable “status unavailable” state. Keep the job ID so the user can resume polling without submitting duplicate motion generation. Test intermittent success after a failed poll and persistent failure after the chosen limit.

## Import/function audit verdict

No broken Python import was confirmed in the specific PartUV and UniRig paths traced here:

- The main repository contains backend/utils/partuv_utils.py and backend/utils/unirig_utils.py, matching the adapter imports from utils.partuv_utils and utils.unirig_utils under the backend import context.
- The pinned third-party tree contains PartUV/partuv/preprocess.py and PartUV/pack/pack.py, matching the helper imports inspected.
- The pinned third-party UniRig tree contains the src/data, src/inference, src/model, src/system and src/tokenizer modules imported by backend/utils/unirig_utils.py.

This is not a claim that every optional dependency, checkpoint, Python environment, or GPU-time import succeeds. The existing backend/tests/test_adapter_imports.py imports and instantiates adapters, but does not prove every adapter's _load_model path or full inference works with the installed runtime and weights. The checked Paint3D tests cover adapter setup, routing, mesh transforms, and child-stage import preflight; they do not contain a spot-mask regression test. No test run was executed for this audit.

## Recommended fix order

1. **Stop false success first:** TEX-02 and ANIM-01; these actions currently claim/broadcast successful work without doing it.
2. **Restore truthful pipeline behavior:** TEX-01, UV-02, UV-03, UV-04 and RIG-01, each with a small request-to-adapter/runner regression test.
3. **Remove misleading viewer data:** UV-01; display actual asset data or clearly label the inspector as a non-data preview until the real UV viewer is connected.
4. **Close persistence/polling gaps:** RIG-02 and ANIM-02.

## Validation checklist for follow-up implementation

- [ ] Texture Generation: test request schema → route → scheduler inputs → each adapter; assert prompt and mask behavior for each supported model, and assert unsupported masks are explicitly rejected or disabled.
- [ ] Paint baking: test that clicking the action invokes the bake operation and success only follows a verified result.
- [ ] UV: parameter tests for default/non-default distortion threshold and each supported setting; false/true individual-part file-output test; forced packing exception test; result metadata matches actual artifacts.
- [ ] UV Inspector: select two different meshes and confirm displayed UVs/metrics change to their actual data; verify channel, Fit and Fullscreen controls.
- [ ] Rigging: assert each retained option reaches a supported UniRig configuration; force localStorage failure and verify the inspector remains truthful.
- [ ] Animation: verify only existing BVH artifacts enable download; verify repeated status failures stop at the configured limit and user retry reconnects to the same job ID.
- [ ] Runtime: run adapter import tests plus environment-appropriate model-load and GPU-backed smoke tests on a machine with installed dependencies/weights. Report skipped tests distinctly from passing tests.

**Bottom line:** The inspected PartUV/UniRig import mappings did not show a confirmed broken Python import. Texture export/mask handling and PartUV threshold/output contracts have been corrected or explicitly disabled where model support does not exist. UV inspector, rigging and bounded animation polling findings were fixed in the latest source changes. JSON-to-BVH conversion remains unsupported and is now clearly disabled for clips without a BVH artifact. Runtime GPU/Blender verification is still required.
