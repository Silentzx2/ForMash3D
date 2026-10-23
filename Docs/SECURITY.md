# 🔒 Security Policy — ForMash 3D

> **Version**: 0.1.0
> **Last Updated**: October 2026
> **Status**: Active development

The ForMash 3D project takes the security and safety of developers and users seriously. As an early experimental, beta project that incorporates local AI model runners, file processors, and system execution scripts, security vigilance is essential.

---

## 🛡️ Supported Versions

Only the latest commit on the `main` branch is actively monitored for security vulnerabilities and bug fixes.

| Version | Supported |
|---|---|
| `main` (0.1.0-beta) | :white_check_mark: |
| Older commits / forks | :x: |

---

## 🚨 Reporting a Vulnerability

If you discover a security vulnerability or sensitive security issue within ForMash 3D (such as remote code execution, arbitrary file writes/path traversals, unauthorized credential exposure, or injection vulnerabilities):

**Please do NOT open a public GitHub issue or disclose the vulnerability publicly.**

Instead, please report the vulnerability privately through one of the following methods:

1. **GitHub Private Vulnerability Reporting**: Use the "Report a vulnerability" button under the **Security** tab of the GitHub repository.
2. **Direct Maintainer Contact**: Send an email to the repository maintainer with:
   - A description of the vulnerability and its potential impact.
   - Step-by-step reproduction steps or a minimal proof-of-concept (PoC).
   - The affected files, routes, or scripts.
   - Any recommended remediation steps.

---

## 📋 What We Ask of Reporters

- Allow a reasonable amount of time for the maintainers to investigate and patch the issue before any public disclosure.
- Make a good faith effort to avoid privacy violations, data destruction, and service interruption during your research.
- Do not exploit the vulnerability beyond what is strictly necessary to demonstrate its presence.

---

## 🔐 Security Best Practices for Users & Developers

### 1. Environment Isolation
Because generative 3D modeling relies on custom C++/CUDA kernels, deep system bindings, and third-party research code, **always run ForMash 3D in an isolated container, disposable VM, or dedicated workstation**.

### 2. Review Setup Scripts
Always inspect shell scripts (such as `scripts/setup.sh` and `backend/scripts/install.sh`) before execution. These scripts may:
- Install system packages via `apt` (requiring `sudo`)
- Modify or sanitize system APT CUDA repository sources in `/etc/apt/sources.list.d/`
- Create or modify Conda/venv virtual environments named `3daigc-api`
- Download and install multi-gigabyte PyTorch CUDA wheels
- Modify local environment variables (`PATH`, `LD_LIBRARY_PATH`)

### 3. Protect API Keys and Tokens
- Keep your `.env` file private and never commit your Hugging Face API token (`HF_TOKEN`) or other credentials to version control
- Use `.env.example` as a template — never commit `.env`
- All secrets are excluded via `.gitignore`

### 4. Network Exposure
The FastAPI backend **binds to all interfaces by default** (`--host 0.0.0.0` in `backend/scripts/run_server.sh` via `P3D_HOST`, and in the container's `supervisord.conf`), and the Next.js frontend is served on port 3000. The system is intended for local or trusted-network use; if an instance is reachable beyond the host:
- Place it behind a secure reverse proxy (e.g., NGINX/Caddy) with HTTPS and authentication enabled, and bind the API to a private interface if it should not be directly reachable
- Restrict CORS by editing `security.cors_origins` in `backend/config/system.yaml` (the shipped default is `["*"]`, i.e. all origins are accepted; there is **no** `CORS_ORIGINS` environment variable). The value is read into `settings.security.cors_origins` and applied by `configure_cors()` in `backend/api/main_singleworker.py` and `backend/api/main_multiworker.py`
- Use `P3D_USER_AUTH_ENABLED=true` for Redis-backed user authentication. When `security.api_key_required` is enabled, `verify_api_key()` accepts either the configured server-wide `P3D_API_KEY` (constant-time comparison) or a valid, active, unexpired Redis-backed user token. If `security.api_key_required=true` but user auth is disabled, configure `P3D_API_KEY`; otherwise protected endpoints fail closed with a configuration error. Treat `P3D_API_KEY` as a privileged server credential and keep it in a secret manager/environment, never in source control.
- The API enforces `security.rate_limit_per_minute` for `/api/*` routes. Multi-worker mode uses an atomic fixed-window counter in the existing Redis queue connection; single-worker mode uses process-local counters. Both return HTTP `429` with `Retry-After` when the limit is exceeded, and reject requests with `503` if an available shared rate-limit store fails. The immediate TCP peer address is the key; behind a reverse proxy, configure trusted-proxy handling at the ASGI/server layer rather than trusting arbitrary `X-Forwarded-For` headers. Keep reverse-proxy limits as an additional perimeter control.
- In `production` mode the backend also adds `TrustedHostMiddleware` with `allowed_hosts=["*"]`; narrow this if you expose the service publicly

### 5. Dependency Security
- Third-party source code is in `backend/thirdparty/` — do not modify upstream code unless necessary
- All upstream attributions and licenses are preserved
- Wheels are in `backend/thirdparty/wheels/` (excluded via `.gitignore`)
- Run `pip audit` regularly to check for vulnerable dependencies
- All 90 bare `except:` clauses in upstream third-party code should not be modified

### 6. GPU & VRAM Security
- `VRAM_SAFETY_MARGIN_MB=1024` keeps 1GB free margin to prevent OOM
- `AUTO_UNLOAD_AFTER_JOB=true` frees VRAM between jobs
- GPU memory is reserved per device through the scheduler's resource planner, and per-worker locks prevent the same worker from running two jobs at once; the manifest also caps `max_workers: 1` per model
- `MAX_VRAM_MB=0` enables auto-detection
- Hunyuan3D-Paint-v2-1 uses a 12GB configured scheduler reservation, not a guaranteed peak-memory minimum; chunked raster intermediates reduce temporary allocations, but requests still require live VRAM admission and target-GPU validation

### 7. Data Privacy
- All generation and post-processing runs locally; no user data is sent to cloud services (model weights are downloaded from Hugging Face / ModelScope, but no asset or input is uploaded)
- Generated assets are stored in `backend/storage/` on the local filesystem
- No third-party telemetry or analytics are collected; the only telemetry is local generation diagnostics written to the local log
- User-uploaded images are stored in `backend/storage/uploads/`

### 8. Container Security
- Use Docker for isolated environments
- The repository ships a single all-in-one `Dockerfile` at the repository root (CUDA 12.4, conda env `3daigc-api`, Blender, Redis, backend on port 7842, frontend on port 3000 under Supervisor). There is no separate `backend/Dockerfile`
- The Hunyuan3D-Paint DifferentiableRenderer native module is built by `backend/scripts/install.sh` (invoked from `scripts/setup.sh`, which the root `Dockerfile` runs); the image build fails loudly if the module cannot be built
- The shipped `Dockerfile` does not set a `USER`, so the container runs as root — add a non-root user for production deployments
- Scan images for vulnerabilities regularly

---

## ⚠️ Known Security Considerations

| Risk | Mitigation | Status |
|---|---|---|
| Third-party code vulnerabilities | Do not modify upstream code | ⚠️ 90 bare `except:` clauses in third-party |
| GPU OOM crashes | VRAM safety buffer + per-GPU reservation | ✅ Mitigated |
| Unauthorized network access | API binds `0.0.0.0` by default + CORS | ⚠️ Restrict `security.cors_origins` in `backend/config/system.yaml` and firewall the port |
| Brute-force / abuse | API fixed-window limit; reverse-proxy limit recommended as an additional boundary | ✅ API-level limit enforced; single-worker counters reset on restart |
| Secret exposure | `.env` excluded from git | ✅ Mitigated |
| Script execution risks | Inspect before running | ⚠️ User responsibility |
| No GPU runtime testing | All functionality unverified without GPU | ⚠️ Requires GPU |

---

## 📄 License

ForMash 3D's original source code is released under the **[Apache License 2.0](LICENSE)**. Third-party models, libraries, and checkpoints are governed by their respective author and academic licenses. See **[backend/thirdparty/LICENSE](backend/thirdparty/LICENSE)** and **[backend/postprocess/THIRD_PARTY_LICENSE.md](backend/postprocess/THIRD_PARTY_LICENSE.md)** for complete third-party licensing information.

## Asset Artifact Delivery — 2026-09-29

Post-process artifact downloads reuse the existing job authorization checks. The artifact selector is an explicit allowlist and is resolved beneath backend/storage/models/; arbitrary client filesystem paths are rejected.

ZIP files are built from the canonical asset workspace into a temporary directory and removed after the response completes. The canonical workspace never becomes an export archive directory.

The immutable master/source.glb is never overwritten by post-processing.

## Review Audit Hardening — Input Boundaries

Server filesystem paths supplied by generation APIs are no longer treated as arbitrary host paths. resolve_server_file_path() (backend/core/utils/file_utils.py) accepts only configured roots — the `outputs/`, `uploads/` and backend `storage/` roots by default, overridable with the `ALLOWED_INPUT_ROOTS` environment variable, or `ALLOW_LOCAL_SERVER_PATH_INPUTS` for self-hosted deployments that need wider access. A small set of protected system paths (`/proc`, `/sys`, `/dev`, `/etc/shadow`, `/etc/passwd`) is always rejected.

Multipart uploads enforce the byte limit while streaming rather than after the full file has been written. Mesh segmentation base64 input is capped at 200 MiB decoded; the shared validator checks encoded length and projected decoded size before allocating the decoded byte buffer, then validates the decoded result. Textual `.gltf` uploads are single-file only: every buffer must use an embedded data URI, and images must use an embedded data URI or a valid embedded buffer view. Relative, remote, and missing dependencies are rejected; clients never fetch or guess sidecars.

## Review Audit — Final Boundary Hardening

Generation file inputs are restricted to configured asset roots. Upload and base64 limits are enforced during ingestion. Artifact downloads use enumerated artifact selectors rather than arbitrary paths.

Running-job cancellation in Redis mode is a shared control-plane request; the scheduler owning the worker performs the actual process termination. This prevents a request handled by one web worker from merely changing state while the GPU worker continues running.


## Final Audit Hardening — September 30, 2026

The final non-testing audit pass tightened the security boundary around operational state as well as input data. Client-supplied server paths remain root-restricted; bounded upload/base64 handling remains enforced; request temporary directories are cleaned on successful completion, cancellation/failure, enqueue failure, and stale-process recovery.

Artifact naming uses UUIDs for mesh, segmentation, and rigged outputs to reduce collision and overwrite risk. Model readiness is derived from manifest paths and actual local checkpoint payloads rather than optimistic model identifiers. The scheduler does not expose an in-progress SQLite write through status reads, and background post-processing errors are retained as job-level metadata instead of being silently converted into false success.

## Durable Upload Intake — 2026-10-16

Uploaded assets are retained until explicitly deleted. Mesh uploads keep their original bytes and extension at `models/meshes/upload_<file-id>/master/source.<ext>`; the adjacent asset manifest records the exact source path, byte length, SHA-256, original filename, and format. Both manifest creation and file-store registration must succeed before an upload is reported as successful. The manifest is the durable record; Redis or the single-worker in-memory store is an index/cache. Exact UUID manifests restore metadata, file listing, counts, and download resolution after restart, while legacy lookup remains limited to the prior exact UUID filename layout.

Multipart limits are 50 MiB for images and 200 MiB for meshes (the API also reports exact byte counts). Mesh validation separately caps vertices and faces at 10,000,000 each by default (`MAX_MESH_VERTICES` / `MAX_MESH_FACES` in `backend/core/utils/file_utils.py`, overridable via the `FORMASH_MAX_MESH_VERTICES` / `FORMASH_MAX_MESH_FACES` environment variables); these limits are returned by the supported-formats endpoint. Geometry parsing runs in an AnyIO worker thread with at most two concurrent parsers, preserves cancellation cleanup, and rejects non-finite or empty geometry. `.gltf` is a supported single-file format only when buffers and images are embedded as data URIs; external, relative, and remote dependencies are rejected rather than fetched or guessed. Deletion removes only the registered source, its manifest, and the matching thumbnail after validating their storage paths; retries are idempotent and generated job workspaces are not deleted through the upload endpoint.

## Resource and Model Integrity — 2026-10-08

Resource planning must fail closed for unsupported multi-GPU strategies. Do not treat combined VRAM as proof that an arbitrary model can be split. Model/weight selection must remain restricted to registered open-weight assets and existing trusted model-management paths. User-provided paths remain validated before processing, and quality diagnostics must never mutate the immutable master.

## Resource Admission Integrity — 2026-10-08

Aggregate VRAM is considered only for model adapters that explicitly declare a supported multi-GPU strategy and actually apply its placement plan. Accelerate maps must use at least two selected GPUs; incomplete component placement raises instead of silently proceeding. Live physical free VRAM limits the scheduler ledger. Paint3D child-stage subprocesses remain single-GPU and are not declared multi-GPU capable. CPU worker/thread policies are bounded by the host logical-core count, with optional FORMSH3D_CPU_WORKERS and FORMSH3D_CPU_THREADS overrides.

## Image Foreground Approval — 2026-10-16

Image preprocessing must verify actual alpha transparency and preserve the mask through crop/upscale before exposing an approved artifact. Foreground occupancy, crop bounds, border coverage, connected regions, and mask survival are recorded. Provider failure never produces an approved artifact or inference input. A suspicious preview is available for inspection but is accepted by generation only when the caller explicitly sets `preprocessing_review_override`; failed artifacts remain blocked even with that flag. Selecting the original image remains a separate explicit path.
