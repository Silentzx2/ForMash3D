# Mesh Quality Deep Audit — Implementation Report

**Repository:** `Silentzx2/ForMash3D`  
**Branch:** `Dev`  
**Audit base:** `22673a531fafc8f9484e697790023fbba72df5c5`  
**Scope:** All six active image-conditioned geometry adapters, the common scheduler, production post-processing, and workspace output selection.

## Confirmed shared causes

The shared path explains why the reported symptom appeared across model choices; the issue was not specific to TRELLIS.2.

1. **Native output was not the default.** The workspace and app-store state defaulted to a 50,000-triangle target. The generation-parameter builder also treated an absent target as auto-optimize enabled and sent a 50,000 target. The API accepted a top-level target field but selected the nested parameter/preset without honoring that top-level value.
2. **A missing backend target could become a 200,000-face production budget.** The post-processing pipeline resolved an absent target to `MAX_PRODUCTION_FACES`, not Native/Raw. Its high/ultra adaptive remesh stage uses shell remeshing/smoothing, so a mesh could lose fine geometry in a shared path after inference.
3. **Structural repair was not fully opt-in.** Non-watertight/open source meshes could enter repair even when automatic repair was not requested; a large-open-defect branch could then trigger further structural rebuilding.
4. **The default viewport selected a derived asset.** The workspace preferred `active_model_url`, `textured_model_url`, or `model_url`, which resolve to the processed/game-ready output, even when the user was trying to inspect raw geometry.

These are source-confirmed defects in the shared path. They can explain cross-model smoothing/feature loss and misleading comparisons. They do **not** prove that every missing micro-detail originated in post-processing; an individual model may also fail to reconstruct a feature absent or ambiguous in the input image.

## Implemented in this commit

- Native/Raw is now the frontend and app-store default: a missing target resolves to `0`, and auto-optimize is false unless a positive production budget is selected.
- The API respects the explicit top-level `target_polycount` ahead of an intent-preset fallback.
- A missing/nonpositive backend target resolves to Native/Raw. Adaptive shell remeshing and structural repair are gated by an explicit production budget/optimize or repair request; the immutable master is still maintained separately from derivatives.
- The workspace routes Native/Raw generation, completed jobs, job re-selection, and history previews to `master/source.glb` when the result identifies a Native/Raw request. Budgeted workflows continue to preview their game-ready/textured result. Raw preview statistics use the source quality trace.
- TripoSG creates its generated mesh with `process=False`, avoiding implicit Trimesh processing at construction time.
- The active Hunyuan3D Shape, Hunyuan3D Turbo, TripoSG, Unique3D, TRELLIS, and TRELLIS.2 output paths now expose or receive common raw-geometry provenance. The shared scheduler records the model/checkpoint, effective adapter parameters, GPU context, native counts where available, input/output SHA-256, output byte size, geometry extractor and mesh operations. It does not invent a scalar geometry resolution for models that do not expose one.
- Unique3D records original/inference image dimensions, multiview/normal counts and whether the small-image upscaling path uses a configured SR model or a resize fallback; resize is not described as proof of new geometric detail.
- TRELLIS logging labels texture resolution as texture resolution. TRELLIS.2 reports requested versus effective cascade resolution and flags a lower-than-requested result with a structured token-budget warning.
- Regression tests were added for all six active model inference profiles, production-only parameter isolation, Native/Raw budget and remesh gates, opt-in structural repair, raw-preview routing, TripoSG native mesh construction, common provenance hashing and TRELLIS.2 cascade fallback.

## Validation status and remaining gates

**Static source audit:** Complete for the shared path and the six active image-conditioned geometry adapters in scope.

**Automated tests:** Regression tests are added, but they were not executed in this environment. The source was inspected and changed through GitHub's remote repository API because a local checkout/runtime was not available in this session.

**GPU image-to-3D/A-B benchmark:** Not run. No claim is made here that generated meshes are visually sharper or that one model has beaten another. A defensible per-model quality conclusion still requires the same high-detail inputs, raw-only mode, fixed seed/protocol, wireframe/flat-clay renders and (when available) a ground-truth mesh on a compatible CUDA environment.

**Step1X-3D:** Not added to the shared model environment. Its upstream environment requirements are not a drop-in match for the current shared stack; adding it without isolation and runtime parity checks would risk breaking the working models rather than safely improving quality.

**Multi-view input and evidence-guided detail refinement:** Not enabled in the default path. These should remain gated until the benchmark identifies which inputs/models are genuinely detail-limited. Synthetic subdivision or an unconditional detail hallucination stage would not establish source-faithful geometry.

**Acceptance conclusion:** The shared production-path and preview-routing defects identified by the static audit are addressed and covered by new regression tests. Universal neural reconstruction quality and measured micro-detail improvement remain unverified until the GPU benchmark is run.

## 2026-10-12 — Follow-up Audit and Gap Closure

The follow-up audit started from `461a2816665c1f8a89247d7a401ebe5349bfc182` and re-read the research plan, the last implementation commit, the model manifest, scheduler, API request contracts, post-processing path, UI target summaries, and quality evaluation tooling.

### Additional defects corrected

- **API budget precedence:** an explicit top-level `target_polycount` now wins over a nested parameter and preset default. An explicit `0` therefore remains a deliberate Native/Raw request instead of being masked by a preset.
- **Mutually consistent Native/Raw controls:** auto-optimization now requires a positive production budget, and adaptive shell remesh runs only with a positive explicit target. The workspace defaults the LOD chain off for a Native/Raw request. This prevents an inconsistent combination such as “Native/Raw + auto optimize”.
- **Truthful Hunyuan resolution metadata:** Hunyuan Shape v2.1 and Mini-Turbo report the configured `octree_resolution` as requested/configured metadata and leave achieved resolution unset because their adapter path does not report the achieved output grid. TRELLIS.2 keeps reporting its actual returned resolution.
- **End-to-end provenance:** schema-v2 raw-geometry telemetry includes adapter/checkpoint identity, runtime duration, raw-output/input hashes, input dimensions, requested versus reported-effective resolution, resolution downgrade warnings, per-GPU peak allocated/reserved VRAM when CUDA exposes it, and geometry operation metadata. The post-processing quality report and final job result now retain the adapter generation metadata plus a comparison of adapter output SHA-256 with the canonical immutable master SHA-256.
- **Unique3D upscaling diagnostics:** metadata now says which SR path actually ran and includes the reason when a model path fails and falls back to Lanczos resizing.
- **UI budget labels:** two advanced generation summaries no longer display a false 50K target when the real setting is Native/Raw (zero).

### Regression coverage added in the follow-up

- explicit top-level / nested / preset budget precedence;
- every enabled, non-deprecated image-to-raw model in `backend/config/models.yaml` has a scheduler fidelity profile;
- Native/Raw cannot enable automatic decimation and the shell-remesh gate requires a positive target;
- telemetry metadata shape and Hunyuan requested-versus-achieved resolution semantics.

### Verification and explicit remaining limits

**Static review:** the follow-up source and changed-blob contracts were inspected against the current `Dev` head before commit. `Docs/TASKS.md` remains unchanged, as previously requested.

**Automated execution:** the current session does not have the repository checkout/runtime needed to execute the test suite, frontend typecheck, or formatter. Tests are added but are **not marked as passing**.

**GPU quality benchmark:** not run. Per-model micro-detail quality, inference-time comparisons, and actual peak VRAM observations still need controlled CUDA runs on the same input corpus and seed/protocol. The new telemetry makes those runs auditable; it is not a substitute for them.

**Still intentionally gated:** Step1X-3D remains unintegrated because its runtime/dependency and checkpoint-license compatibility have not been verified in the shared environment; multi-view input and evidence-guided detail refinement remain disabled until an A/B corpus demonstrates a genuine geometry gain without source drift. No artificial subdivision or unconditional detail hallucination was added.

**Acceptance:** the additional shared-path/API/telemetry correctness gaps found in the follow-up are patched in source and covered with new regression tests. Model-level sharpness improvement and benchmark acceptance remain unverified until the tests and GPU comparison are executed.
