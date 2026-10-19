## 2026-10-19 — Animation ARDY IDs and Checkpoint Compatibility

- Root cause: the animation UI sent `ardy-core` / `ardy-g1` as scheduler model IDs, although the manifest registers only `ardy_motion_generation`; the right inspector also persisted three legacy labels instead of accepted checkpoint IDs.
- Fix: generation sends the canonical model ID and derives the target skeleton from a normalized checkpoint. Both selectors now use the four actual Core/G1 checkpoints; the API and adapter normalize legacy requests.
- Unique3D note: the supplied `Attempting fallback to local img2mvimg base pipeline` line is from pre-fix adapter code. Current `dev` no longer contains that fallback and the submodule points to the corrected ThirdParty `main`; pull/sync submodules and restart the API/workers to apply it.
- Validation boundary: backend source-contract CI and frontend type-check/build cover source contracts; actual ARDY/Unique3D checkpoint inference was not run in this editing environment.

## 2026-10-19 — Unique3D Normal Checkpoint Compatibility

- Root cause: the normal-prediction loader selected the trained `img2mvimg` UNet as its base (8 input channels), while `image2normal` checkpoint weights expect 4 input channels. A fallback repeated the incompatible load and could terminate model startup.
- Fix: the normal stage now resolves to the 4-channel Stable Diffusion image-variation base; local `img2mvimg` is no longer used as an `image2normal` fallback. The multiview pipeline and its 8-channel weights remain unchanged.
- Validation boundary: source-contract regression coverage was added. The checkpoint-backed Unique3D GPU load/inference was not run in this editing environment, so verify it with the installed model weights after pulling the synchronized submodule.

## 2026-10-19 — ARDY CPU-Only Runtime

- ARDY is explicitly scheduled on CPU with no GPU/VRAM reservation; its dedicated worker skips CUDA initialization and hides CUDA in-process.
- The adapter forces both the motion model and local LLM2Vec text encoder to CPU, seeds only CPU generators, and reports CPU mode truthfully.
- Vendored LLM2Vec does not spawn CUDA multiprocessing for CPU requests on multi-GPU hosts. Added CPU-only resource/source-contract tests.
- GPU-backed ARDY tests are intentionally not applicable; real CPU checkpoint inference and peak host RAM still need validation on a machine with access to the gated text encoder.

