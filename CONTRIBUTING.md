# Contributing to ForMash3D

Thank you for contributing to ForMash3D.

ForMash3D is an active pre-alpha project combining a Next.js 16 frontend, FastAPI backend, GPU model adapters, and production-oriented 3D post-processing. Contributions should preserve the existing architecture and keep changes focused.

## Before changing code

1. Read [RULES.md](RULES.md) first.
2. Read the relevant document in [Docs/](Docs/) before changing architecture, APIs, UI conventions, or runtime behavior.
3. Trace the existing flow and identify the root cause before adding a workaround.
4. Prefer existing helpers, services, dependencies, and contracts.
5. Keep the smallest correct diff.
6. Update relevant documentation in the same change.

## Development baseline

- Linux
- NVIDIA GPU with a CUDA 12.4-compatible driver for model inference
- Python 3.10
- Conda environment: `3daigc-api`
- PyTorch 2.6.0 + CUDA 12.4
- Bun
- Git

## Setup

```bash
git clone https://github.com/Silentzx2/ForMash3D.git
cd ForMash3D
bash scripts/setup.sh
```

Third-party model integrations are maintained under `backend/thirdparty/` in this repository. A normal checkout does not require a separate third-party repository.

The maintained Wheels release is used for compatible prebuilt Python wheels; the installer falls back to source/index installation when a compatible wheel is unavailable.

## Backend development

- Model adapters belong in `backend/adapters/`.
- API routes belong in `backend/api/routers/`.
- Scheduler code belongs in `backend/core/scheduler/`.
- Configuration belongs in `backend/config/`.
- Backend scripts belong in `backend/scripts/`.
- Keep adapter imports lazy.
- Preserve upstream source, license notices, and attribution.
- Reuse canonical model configuration and registry contracts rather than adding parallel registration paths.

## Frontend development

- Routes live under `app/`.
- Workspace features live under `features/workspace/`.
- API calls use `services/apiClient.ts`.
- Global client state uses Zustand.
- Server state uses TanStack Query.
- Heavy workspace panels should use `next/dynamic` where appropriate.
- Use the HSL design tokens defined by `app/globals.css`; do not introduce isolated color literals.

## Verification

Run checks relevant to your change:

```bash
bun run test
bun run lint
bun run build
python3 -m compileall -q backend/
python3 scripts/verify_contracts.py
bash -n backend/scripts/*.sh scripts/*.sh
```

GPU/model inference and full production post-processing require an appropriate NVIDIA environment. Static checks do not replace GPU validation. The repository currently has no GitHub Actions workflow under `.github/workflows/`, so local verification is the authoritative pre-push check.

## Pull requests

Keep pull requests focused. Include:

- What changed and why.
- Root cause for bug fixes.
- Verification performed.
- GPU/runtime validation performed, if available.
- Breaking changes or known limitations.
- Screenshots for UI changes when useful.

Never commit credentials, model checkpoints, private URLs, or generated secrets.

## Security

Do not disclose security vulnerabilities in public issues. Follow [Docs/SECURITY.md](Docs/SECURITY.md).

## Documentation

When behavior, configuration, architecture, API contracts, installation, or UI conventions change, update the relevant documentation before the change is considered complete.

## 2026-10-08 Implementation Note

Changes in the high-fidelity generation path must preserve all existing model adapters, keep master assets immutable, and route multi-GPU loading only through declared supported strategies. Resource and quality changes should include non-hardware tests and update the relevant `Docs/` documentation in the same commit.
