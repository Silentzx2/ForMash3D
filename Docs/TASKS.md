# TASKS — CPU-Safe Setup + GitHub SEO / Contributor Growth (ForMash3D)

> COMPLETED 2026-10-23 — Production readiness pass: auth removed entirely from backend + frontend, feature improvements done, `bun test` 54 pass / 0 fail (10 files), `python3 -m pytest backend/tests/` 40 passed / 6 skipped (GPU-dependent), `npx tsc --noEmit` zero errors. Tree at green `dev` HEAD, pushed to `origin/dev`.

Repo: `Silentzx2/ForMash3D` · base commit read: `eca1d78` (main) · Apache-2.0
Branch rule: work on `main`; leave `dev` / `Dev` untouched.

---

## 0. AGENT OPERATING RULES (MANDATORY)

ROLE: Bash/Installer Engineer (conda/uv/PyTorch wheels, apt, CUDA detection) + GitHub OSS Growth Engineer.

1. FIRST verify startup flow: `scripts/setup.sh`, `scripts/start.sh`, `backend/scripts/install.sh`, `manager.sh`, `Dockerfile`, `docker-compose.yml`, `.env.example`. The existing GPU/CUDA path must behave EXACTLY as today (same commands, same order).
2. NO full-repo scan. Read only: `RULES.md`, `README.md`, `Docs/ARCHITECTURE.md`, `Docs/TASKS.md`, `Docs/api-documentation.md`, `CONTRIBUTING.md`, and the exact files named in this task.
3. Never invent features, metrics, or status. Unverifiable => write `TODO: user to confirm`.
4. Output: ZERO filler. No blank-line padding. Do not reprint unchanged code. Replacement-only diffs with exact file paths + line anchors. Explanations max 2 sentences per item.
5. Deliver ONE zip containing only new/modified files. Push to `main`/PR only if possible.
6. Final step: sync docs (section 5).

---

## 1. VERIFIED FINDINGS (read from repo; install NOT executed — no GPU/conda in review sandbox. `bash -n` syntax check passed on both scripts)

| # | Finding | Where |
|---|---------|-------|
| F1 | CPU-only detect only prints a warning ("proceeding with CPU fallback") and then continues the FULL CUDA install | `scripts/setup.sh` `detect_gpu()` |
| F2 | `detect_gpu` results (`GPU_AVAILABLE`, `CUDA_VERSION`) are NOT exported, so `install.sh` (separate process) never knows the mode | `scripts/setup.sh` -> `backend/scripts/install.sh` |
| F3 | `install.sh` hard-installs `torch==2.6.0 ... --index-url .../whl/cu124` and exits 1 on failure | `install.sh` ~L331-338 |
| F4 | CUDA-only wheels downloaded even on CPU (`download_release_wheels` in setup.sh, `ensure_release_wheels` in install.sh) | `setup.sh`, `install.sh` ~L124, L350 |
| F5 | All model stacks installed unconditionally: TRELLIS/TRELLIS.2 + kaolin (L369-455), Hunyuan3D shared/shape/paint/DiT (L457-590), UniRig, partuv, FastMesh (L592-640), Unique3D incl. pytorch3d source build + torch_scatter cu124 + xformers cu124 (L640-713), ARDY (L715), Paint3D (L728), TripoSG (L738), Pixal3D (L751), natten cu124 wheel (L767), TaoFlowForge (L802) | `install.sh` |
| F6 | `err` is called but never defined in setup.sh (only `log/info/warn/fail` exist) -> "command not found" on old NVIDIA driver path | `scripts/setup.sh` L242-243 |
| F7 | `ensure_thirdparty_submodule` runs `git submodule update --remote --merge` on every setup (moves to latest remote HEAD; non-reproducible, heavy) | `scripts/setup.sh` |
| F8 | `install.sh` has no `set -e`; failed model installs can be silently skipped | `install.sh` |
| F9 | `backend/requirements.txt` has `--extra-index-url .../cu124`; with `--index-strategy unsafe-best-match` a transitive `torch` dependency could replace a CPU torch with a `+cu124` build | `backend/requirements.txt` |
| F10 | Runtime already tolerates missing/CPU torch in core: guarded imports in `core/config.py`, `gpu_monitor.py`, `runtime_probe.py`, `api/routers/system.py`; adapters are lazy-loaded via `adapters/__init__.py` `_ADAPTER_MAP` | backend |
| F11 | ARDY is documented CPU-only (README) -> optional CPU-capable extra | README, `thirdparty/ardy` |
| F12 | Main repo has no `.gitattributes`; wheels now come from GitHub Release tag `Wheels` (not LFS). `ForMash3D-ThirdParty` README may still say "Git LFS mandatory" (not re-checked) | verify |
| F13 | `Dockerfile` base is `nvidia/cuda:12.4.1`, compose uses `runtime: nvidia` -> Docker has no CPU path | Docker |

---

## 2. TASK A — CPU-ONLY AUTO MODE FOR `setup.sh` / `install.sh`

GOAL: If no NVIDIA GPU is detected at start, setup skips ALL model/CUDA dependencies but still installs everything else (frontend, backend core API, postprocess, Redis, dirs, `.env`) so the app boots and the non-GPU parts work. UI/backend graceful-degradation is out of scope (see section 4).

STATUS: not started — planned only; no acceptance criteria met (A6 all [ ]). No scripts changed yet.

### A1. Single source of truth for compute mode
- Add `FORMASH3D_COMPUTE=auto|cpu|cuda` (default `auto`) + flags `--cpu`, `--gpu` in `setup.sh` and `install.sh` (same parse style as `--auto`, `--venv`).
- `auto`: `nvidia-smi -L` returns >=1 device -> `cuda`, else `cpu`. Keep `CUDA_FORCE_PRESENT=1` test hook working.
- Put the resolver in one shared file `scripts/lib/compute_mode.sh` (sourced by both scripts) to avoid duplicated logic. `install.sh` must also resolve on its own when run standalone.
- `export FORMASH3D_COMPUTE`, persist to `.env` (reuse `persist_env_config` pattern), print one clear line: `[SETUP] Compute mode: cpu (no NVIDIA GPU detected) — model dependencies will be skipped`.
- `REQUIRE_GPU=1` must still abort when mode resolves to `cpu`.

### A2. `scripts/setup.sh` changes (CPU mode only)
- SKIP: `setup_cuda_124`, `_sanitize_apt_cuda_sources`, `download_release_wheels`, `build_deps` (ninja/CUDA arch exports).
- `ensure_thirdparty_submodule`: SKIP init in CPU mode unless `--with-thirdparty`. (Also fix F7: use `git submodule update --init --recursive` only; make `--remote --merge` opt-in via `--update-thirdparty`.)
- KEEP: `require_commands`, `ensure_bun_or_npm`, `ensure_uv`, `ensure_redis`, `create_directories`, `install_frontend_deps`, `install_backend`, `summary`.
- Fix F6: define `err(){ printf "${RED}[ERROR]${NC} %s\n" "$*" >&2; }`.
- Replace the misleading "Generation jobs will fail" warning with an accurate CPU-mode message.
- Summary screen: show mode (`cpu`/`cuda`) and list what was skipped.

### A3. `backend/scripts/install.sh` changes
1. Torch step (F3): in `cpu` mode install CPU wheels: `torch==2.6.0 torchvision==0.21.0 torchaudio==2.6.0 --index-url https://download.pytorch.org/whl/cpu`. `cuda` mode: unchanged cu124 command.
2. Guard `ensure_release_wheels` (F4) -> `cuda` only. Keep `ensure_blender` (it is optional and already env-gated by `BLENDER_ENABLED`).
3. Wrap the model-specific blocks (F5: TRELLIS … TaoFlowForge, ~L369-815) in one function `install_model_stacks()`, call it only when mode = `cuda`. Keep outside the guard: `backend/requirements.txt` core install, test requirements (~L792-799), system runtime libs (~L826+), runtime validation (~L860+).
4. In CPU mode, optionally install ARDY (F11) only with `--cpu-extras` (default OFF); needs `--with-thirdparty`.
5. Split requirements to remove F9 risk without changing GPU flow:
   - `backend/requirements-core.txt` = API, postprocess, trimesh/open3d/pymeshlab/scipy/etc. (CPU-safe)
   - `backend/requirements-models.txt` = model-only packages (diffusers/transformers/realesrgan/peft/timm/kornia/accelerate/datasets… — agent must classify by reading imports, not guess)
   - `backend/requirements.txt` = `-r requirements-core.txt` + `-r requirements-models.txt` (GPU flow identical).
   - CPU mode installs `requirements-core.txt` with a constraints file pinning torch to the installed CPU build (`-c`), and WITHOUT the `cu124` extra-index-url.
6. Validation block: in CPU mode print `Compute mode: cpu` and do not warn about missing CUDA; do not call the `Paint3DAdapter` import check in CPU mode.
7. Do NOT add `set -e` globally (F8 would change GPU behavior). Instead make the CPU path fail loudly on core-install errors only.

### A4. `scripts/start.sh` / `manager.sh`
- Verify `start.sh` boots in CPU mode (it already skips `CUDA_VISIBLE_DEVICES` when `nvidia-smi` is absent). In CPU mode explicitly export `CUDA_VISIBLE_DEVICES=""` and `FORMASH3D_COMPUTE=cpu`.
- `manager.sh` option that runs setup (L313): pass through `--cpu/--gpu`.

### A5. Tests (CPU-only, no GPU needed)
- Extend `scripts/tests/script_test.sh`: resolver returns `cpu` when `nvidia-smi` is absent (PATH-stub), `cuda` with `CUDA_FORCE_PRESENT=1`, flags override env, `REQUIRE_GPU=1` aborts on cpu.
- Static grep test: in CPU mode the script text path contains no `cu124` / `kaolin` / `natten` / `pytorch3d` invocation reachable (guard check).
- `.github/workflows/backend-runtime-ci.yml`: add a job that runs the resolver tests on `ubuntu-latest` (it has no GPU, which is the CPU case).

### A6. Acceptance criteria
- [ ] On a machine WITHOUT NVIDIA: `bash scripts/setup.sh --auto` finishes with exit 0, no CUDA/torch-cu124/wheel/thirdparty downloads, `.env` has `FORMASH3D_COMPUTE=cpu`.
- [ ] `bash scripts/start.sh` -> frontend `:3000` and backend `:7842/health` respond; `/docs` loads; `GET /api/models` does not return 500.
- [ ] On a machine WITH NVIDIA (or `CUDA_FORCE_PRESENT=1` dry run): command sequence identical to current behavior (diff of executed commands = empty).
- [ ] `bash -n` passes on every edited script; `shellcheck` warnings not worse than before.
- [ ] `--gpu` forces the cuda path; `--cpu` forces cpu even if a GPU exists.

---

## 3. TASK B — GITHUB SEO + CONTRIBUTOR GROWTH

GOAL: more developers find the repo and can start contributing in under 10 minutes. Honest positioning: beta, contributors wanted.

STATUS: not started — planned only; no acceptance criteria met (B5 all [ ]). No community/SEO files added yet.

### B1. README.md (40 KB — too long above the fold)
- Replace H1 text with a keyword title: `ForMash3D — Open-Source Self-Hosted Image-to-3D AI Generator` (keywords: image to 3D, text to 3D, self-hosted, open source, game-ready, GLB, retopology, PBR, LODs, auto-rigging).
- First 160 characters of the README must contain the core pitch (they are used by search snippets).
- Quick Start line (L27) currently says `bun install` -> `bash scripts/start.sh`, which does not match the real flow (`scripts/setup.sh` first). Make Quick Start match reality; add a second line for CPU/no-GPU mode once Task A lands.
- Add above the fold: "Beta — contributors wanted" + links to `CONTRIBUTING.md` and `docs/GOOD_FIRST_ISSUES.md`.
- Add badges: GitHub stars, last commit, issues, `CPU mode supported` (only after A6 passes). Keep the existing CUDA badge.
- Add a table of contents; keep the architecture mermaid/diagram; add a "Choose your contributor path" block: (A) no GPU: UI/UX, docs, tests, API, postprocess; (B) GPU: adapters, quality pipeline.
- Replace remaining "AI Studio" wording in docs (backward-compatible env var names like `AI_STUDIO_ENV_MANAGER` stay).

### B2. New / extended community files
- `CONTRIBUTING.md` (exists, 3.7 KB): add dev setup (GPU + CPU), branch/PR flow, how to pick an issue, PR checklist.
- Create `CODE_OF_CONDUCT.md`, `SECURITY.md` (root; link to `Docs/SECURITY.md`), `.github/PULL_REQUEST_TEMPLATE.md`, `.github/labels.yml` (good first issue, help wanted, no-gpu, needs-gpu, adapter, ui/ux, docs, quality).
- Inspect `.github/ISSUE_TEMPLATE/repo.json` (unexpected file in a template folder); report, do not delete without confirmation. Add `config.yml` linking to Discussions.
- `docs/GOOD_FIRST_ISSUES.md`: 15-20 issue drafts derived from real gaps in `Docs/TASKS.md` (e.g. `1C.1` pending GPU benchmark), `Docs/MEMORY.md`, `RULES.md`. >=10 must be `no-gpu`. Each: title, files, acceptance criteria, difficulty, est. hours, labels.
- `docs/ARCHITECTURE_FOR_CONTRIBUTORS.md` (<=1.5 pages): folder map, request flow, where to add an adapter / UI panel / test.

### B3. Discoverability pack — `docs/GITHUB_SETUP.md` (copy-paste values; the agent CANNOT set these)
- Repo description (<=350 chars, keyword-rich), website URL.
- 15-20 topics (e.g. `image-to-3d`, `text-to-3d`, `3d-generation`, `generative-ai`, `self-hosted`, `fastapi`, `nextjs`, `glb`, `mesh-generation`, `retopology`, `game-assets`, `pytorch`, `hunyuan3d`, `trellis`, `help-wanted`, `good-first-issue`).
- Social preview image spec: 1280x640 PNG (`assets/banner.png` exists — check its size; create a variant if needed).
- Enable Discussions + categories; pin 3-5 starter issues; Release `v0.1.0-beta` notes draft (`docs/RELEASE_NOTES_DRAFT.md`).
- Verify `ForMash3D-ThirdParty` repo: rename any "AI Studio" text, fix Git LFS statements if LFS is gone (F12), add topics, link back to the main repo.

### B4. Outreach pack — `docs/OUTREACH.md`
- Ready-to-post drafts: Reddit (r/opensource, r/gamedev, r/StableDiffusion, r/LocalLLaMA, r/3Dprinting only if relevant), Hacker News "Show HN", Dev.to/Hashnode, X/LinkedIn, Hugging Face community.
- Lists to submit to: up-for-grabs.net, goodfirstissue.dev, awesome-lists for 3D generation / self-hosted.
- 60-second demo video script + GIF checklist (GIF/screenshots are the single biggest star driver; use only real captures — placeholders marked `TODO: user to add`).
- 30-day plan: wk1 setup+CPU mode, wk2 launch, wk3 first-PR welcome, wk4 recognition (all-contributors).

### B5. Acceptance criteria
- [ ] README top 160 chars + H1 contain target keywords; Quick Start is verified against real scripts.
- [ ] `CODE_OF_CONDUCT.md`, `SECURITY.md`, PR template, labels, >=15 issue drafts exist.
- [ ] `docs/GITHUB_SETUP.md` has ready-to-paste values; manual checklist <=10 lines at the end of the agent's reply.
- [ ] No claim in README/outreach that is not backed by `Docs/*` or code.

---

## 4. OUT OF SCOPE (LATER — per owner)
- UI: capability-aware model selector ("Requires NVIDIA GPU" badges, CPU-mode banner).
- Backend: `/api/capabilities`, `MockAdapter` (sample GLB, real postprocess on CPU), graceful job rejection on CPU, `FORMASH3D_COMPUTE` read by runtime.
- `Dockerfile.cpu` + compose `cpu` profile (F13).
- Optional remote GPU adapter (`REMOTE_GPU_URL`).

---

## 5. FINAL STEP — DOCUMENTATION SYNC (MANDATORY)

### 5A. CPU setup mode (Task A) — implemented
- `scripts/lib/compute_mode.sh` created — shared `FORMASH3D_COMPUTE` resolver (auto|cpu|cuda)
- `scripts/setup.sh` — `--cpu`/`--gpu` flags, skips CUDA steps in CPU mode, `err()` defined, thirdparty submodule opt-in, summary shows mode+skipped
- `scripts/start.sh` — CPU mode exports `CUDA_VISIBLE_DEVICES=""` and `FORMASH3D_COMPUTE=cpu`
- `manager.sh` — `setup` passes through `--cpu`/`--gpu`/`--with-thirdparty`/`--update-thirdparty`
- `backend/scripts/install.sh` — `--cpu`/`--gpu`/`--cpu-extras`/`--with-thirdparty` flags, CPU torch wheels, `ensure_release_wheels` cuda-only, model stacks wrapped in `install_model_stacks()`, requirements split into core+models
- `backend/requirements-core.txt` created — CPU-safe dependencies
- `backend/requirements-models.txt` created — model-only (GPU) dependencies
- `backend/requirements.txt` — now `-r requirements-core.txt` + `-r requirements-models.txt`
- `scripts/tests/script_test.sh` — resolver tests + static grep test added
- `.github/workflows/backend-runtime-ci.yml` — resolver test job added
- `bash -n` passes on all edited scripts
- Status: IMPLEMENTED (not pushed — pending user review)

### 5B. SEO / contributor growth pack (Task B) — implemented
- `README.md` — keyword H1 title, badges (stars, last commit, issues, CPU mode), table of contents, contributor path block, beta phase banner
- `CONTRIBUTING.md` — CPU-only setup section added
- `CODE_OF_CONDUCT.md` created (root)
- `SECURITY.md` created (root; links to Docs/SECURITY.md)
- `.github/PULL_REQUEST_TEMPLATE.md` created
- `.github/labels.yml` created
- `.github/config.yml` created (Discussions categories)
- `docs/GOOD_FIRST_ISSUES.md` created — 15 issue drafts (>=10 no-gpu)
- `docs/ARCHITECTURE_FOR_CONTRIBUTORS.md` created — folder map, request flow, where to add
- `docs/GITHUB_SETUP.md` created — copy-paste values, topics, social preview spec
- `docs/OUTREACH.md` created — post drafts, lists to submit, 30-day plan
- Zero `pre-alpha`/`prealpha` references remain
- Status: IMPLEMENTED (not pushed — pending user review)

Output exact updates (replacement-only) for: `README.md`, `RULES.md`, `Docs/ARCHITECTURE.md`, `Docs/TASKS.md` (new rows: `5A` CPU setup mode, `5B` SEO/community pack), `Docs/CHANGELOG.md`, `Docs/MEMORY.md`, `Docs/DECISIONS.md` (ADR: "CPU mode skips model dependency installation by design"). Re-read all edited `.md` top-to-bottom, then bottom-to-top; list any gap found. End with the manual GitHub-UI checklist (max 10 lines).
