## 2026-10-18 — Runtime Compatibility, Path Resolution & Fallback Visibility

- Replaced the empty HybridCache subclass with a real cache-class import fallback that reports its semantic limitation.
- Made TorchVision compatibility helper import resilient to runtime/native load errors; compatibility setup failures now retain tracebacks and cause chains.
- Resolved UniRig default paths independently of current working directory and preserved ARDY/UniRig loader exception chains.
- Exposed Hunyuan3D-Paint background-removal fallback mode and reason in job results.
- Added regression tests for these contracts. Backend tests are awaiting CI execution; no test-pass claim is made here.

## 2026-10-18 — Runtime Import Diagnostics, Readiness & UV Guardrails

- Fixed BaseModel.process state transitions so inference failures remain visible as ERROR and successful requests restore LOADED.
- Replaced UniRig's hardcoded Blender-missing explanation with the underlying import exception and missing-module name.
- Added Hunyuan3D-Paint BackgroundRemover import/native error reporting with exception chaining.
- Paint3D now preflights both child-stage import graphs before reporting the runtime ready and refuses to continue with invalid/missing UVs after a failed unwrap.
- Added regression tests for state transitions, diagnostic content, child-stage readiness, and UV failure. Test execution is pending CI verification; no pass claim is made here.

## 2026-10-17 — Lossless, Offset-Resumable Master Log Streaming

- **Canonical raw text stream**: The admin Logs view reads the complete `logs/master.log` as ordered UTF-8 text chunks, preserving blank lines, CR/CRLF characters, partial lines, whitespace, and progress output without parsing or filtering entries.
- **Reconnect without replay or gaps**: Each SSE event carries its ending byte offset plus the current file identity; the proxy forwards `Last-Event-ID`, and pause/resume continues at the last received offset. Rotation/truncation emits a reset event so the view follows the current canonical file.
- **UI delivery**: Chunks are appended in animation-frame batches without a line cap or silent pending-queue drops. SSE proxy buffering is disabled and regression tests cover control characters, Unicode chunk boundaries, and immediate upstream forwarding.
