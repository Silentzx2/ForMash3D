## 2026-10-19 — Texture, UV and Export Contract Fixes

- The paint action exports the live viewport material texture to GLB and reports the exporter result; UV mask capture is isolated from the opaque albedo canvas.
- Mask-based model inference is rejected until adapters implement it, and Paint3D prompt input is forwarded.
- PartUV honors the requested distortion threshold and individual-part opt-out, and fails when packing fails or the expected output is missing. Inert UV options were removed; source-contract regression tests were added.

## 2026-10-19 — Animation ARDY IDs and Checkpoint Compatibility

- Root cause: the animation UI sent `ardy-core` / `ardy-g1` as scheduler model IDs, although the manifest registers only `ardy_motion_generation`; the right inspector also persisted three legacy labels instead of accepted checkpoint IDs.
- Fix: generation sends the canonical model ID and derives the target skeleton from a normalized checkpoint. Both selectors now use the four actual Core/G1 checkpoints; the API and adapter normalize legacy requests.
- Unique3D note: the supplied `Attempting fallback to local img2mvimg base pipeline` line is from pre-fix adapter code. Current `dev` no longer contains that fallback and the submodule points to the corrected ThirdParty `main`; pull/sync submodules and restart the API/workers to apply it.
- Validation boundary: backend source-contract CI and frontend type-check/build cover source contracts; actual ARDY/Unique3D checkpoint inference was not run in this editing environment.

## 2026-10-19 — Unique3D Normal Checkpoint Compatibility

- Root cause: the normal-prediction loader selected the trained `img2mvimg` UNet as its base (8 input channels), while `image2normal` checkpoint weights expect 4 input channels. A fallback repeated the incompatible load and could terminate model startup.
- Fix: the normal stage now resolves to the 4-channel Stable Diffusion image-variation base; local `img2mvimg` is no longer used as an `image2normal` fallback. The multiview pipeline and its 8-channel weights remain unchanged.
- Validation boundary: source-contract regression coverage was added. The checkpoint-backed Unique3D GPU load/inference was not run in this editing environment, so verify it with the installed model weights after pulling the synchronized submodule.
