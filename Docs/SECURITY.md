# 🔒 Security Policy — ForMash 3D

> **Version**: 0.1.0
> **Last Updated**: September 2026
> **Status**: Active development

The ForMash 3D project takes the security and safety of developers and users seriously. As an early experimental, pre-alpha project that incorporates local AI model runners, file processors, and system execution scripts, security vigilance is essential.

---

## 🛡️ Supported Versions

Only the latest commit on the `main` branch is actively monitored for security vulnerabilities and bug fixes.

| Version | Supported |
|---|---|
| `main` (0.1.0-prealpha) | :white_check_mark: |
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
ForMash 3D's FastAPI backend and Next.js frontend are designed by default for local development (`localhost`). If exposing instances to public networks:
- Place them behind a secure reverse proxy (e.g., NGINX/Caddy) with HTTPS and authentication enabled
- Enable CORS restrictions with `CORS_ORIGINS` in `.env`
- Use `P3D_USER_AUTH_ENABLED=true` for Redis-based authentication
- Enable rate limiting via `rate_limit_per_minute` in `system.yaml`

### 5. Dependency Security
- Third-party source code is in `backend/thirdparty/` — do not modify upstream code unless necessary
- All upstream attributions and licenses are preserved
- Wheels are in `backend/thirdparty/wheels/` (excluded via `.gitignore`)
- Run `pip audit` regularly to check for vulnerable dependencies
- All 94 bare `except:` clauses in upstream third-party code should not be modified

### 6. GPU & VRAM Security
- `VRAM_SAFETY_MARGIN_MB=1024` keeps 1GB free margin to prevent OOM
- `AUTO_UNLOAD_AFTER_JOB=true` frees VRAM between jobs
- GPU mutual exclusion prevents concurrent inference
- `MAX_VRAM_MB=0` enables auto-detection
- Hunyuan3D-Paint-v2-1 requires ~21GB VRAM

### 7. Data Privacy
- All processing runs locally; no data is sent to cloud services
- Generated assets are stored in `backend/storage/` on the local filesystem
- No telemetry or analytics are collected by default
- User-uploaded images are stored in `backend/storage/uploads/`

### 8. Container Security
- Use Docker for isolated environments
- The `backend/Dockerfile` builds the complete backend environment
- Ensure `backend/Dockerfile` includes Paint DifferentiableRenderer build step
- Use non-root user in production containers
- Scan images for vulnerabilities regularly

---

## ⚠️ Known Security Considerations

| Risk | Mitigation | Status |
|---|---|---|
| Third-party code vulnerabilities | Do not modify upstream code | ⚠️ 94 bare `except:` clauses in third-party |
| GPU OOM crashes | VRAM safety buffer + mutual exclusion | ✅ Mitigated |
| Unauthorized network access | Localhost by default + CORS | ✅ Mitigated |
| Secret exposure | `.env` excluded from git | ✅ Mitigated |
| Script execution risks | Inspect before running | ⚠️ User responsibility |
| No GPU runtime testing | All functionality unverified without GPU | ⚠️ Requires GPU |

---

## 📄 License

ForMash 3D's original source code is released under the **[Apache License 2.0](LICENSE)**. Third-party models, libraries, and checkpoints are governed by their respective author and academic licenses. See **[Docs/MODEL_LICENSES.md](Docs/MODEL_LICENSES.md)** for complete third-party licensing information.

## Asset Artifact Delivery — 2026-09-29

Post-process artifact downloads reuse the existing job authorization checks. The artifact selector is an explicit allowlist and is resolved beneath backend/storage/models/; arbitrary client filesystem paths are rejected.

ZIP files are built from the canonical asset workspace into a temporary directory and removed after the response completes. The canonical workspace never becomes an export archive directory.

The immutable master/source.glb is never overwritten by post-processing.

## Review Audit Hardening — Input Boundaries

Server filesystem paths supplied by generation APIs are no longer treated as arbitrary host paths. resolve_server_file_path() accepts only configured roots (outputs/ and uploads/ by default), with explicit ALLOWED_INPUT_ROOTS / ALLOW_LOCAL_SERVER_PATH_INPUTS overrides for self-hosted deployments that need wider access.

Multipart uploads enforce the byte limit while streaming rather than after the full file has been written. Base64 payloads are rejected using their encoded-size ceiling before allocating the decoded byte buffer.
