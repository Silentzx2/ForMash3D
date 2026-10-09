
## [Unreleased] - 2026-10-09
### Added
- **Unified Master Logging**: Consolidated all backend and multi-process worker logs into a single `logs/master.log` with real-time FastApi SSE streaming endpoint `/api/v1/system/logs/stream`.
- **VS Code Terminal UI**: Completely redesigned the `LogsTab.tsx` to resemble a minimal, smooth, and authentic VS Code/Linux terminal environment (pure dark mode, Consolas monospace, strict ANSI-like color formatting, and butter-smooth auto-scroll).

### Changed
- **Mesh Viewer Job Queue UI**: Upgraded the right panel generation list to stack line-by-line horizontally without overlapping, overflowing into a neat drawer UI if more than 4 jobs are actively queued.
- **Tab Switching Unblocked**: Removed the active-generation lock that prevented users from switching between "Properties", "Assets", and "Running" tabs while a job was in progress.

### Fixed
- **TRELLIS Gradient Baking Crash**: Resolved `RuntimeError: element 0 of tensors does not require grad` during Trellis mesh extraction by ensuring `torch.enable_grad()` is explicitly called within the isolated post-processing step (overriding the parent inference_mode context).
- **Hunyuan3D CPU Hanging**: Fixed an issue where the Hunyuan3D 2.1 pipeline and Rembg component would silently fail over to the CPU, locking up system resources for 11+ minutes without progress. Pipelines now strictly enforce `.to("cuda")` initialization.
- **Unique3D Adapter Initialization Crash**: Resolved `TypeError: Unique3DImageToRawMeshAdapter.__init__() got an unexpected keyword argument 'seed'` by widening the signature constraints to accept `**kwargs` from the dynamically routed job config.
- **README Mermaid Syntax Error**: Corrected `subgraph` title formatting to strictly adhere to Mermaid compiler specifications, fixing rendering drops.
