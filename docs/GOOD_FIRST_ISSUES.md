# Good First Issues — ForMesh3D

Issue drafts derived from real gaps in `Docs/TASKS.md`, `Docs/MEMORY.md`, and `RULES.md`.
Issues marked `no-gpu` can be completed without an NVIDIA GPU.

---

## 1. CPU-only setup mode — verify `bash -n` on all scripts
**Label:** `no-gpu`, `tests`, `cpu-mode`  
**Difficulty:** Easy  
**Est. hours:** 1  
**Acceptance criteria:**
- `bash -n` passes on `scripts/setup.sh`, `scripts/start.sh`, `backend/scripts/install.sh`
- All shell scripts pass `shellcheck` (if installed)
- No new dependencies added

**Files:** `scripts/setup.sh`, `scripts/start.sh`, `backend/scripts/install.sh`

---

## 2. Add CPU mode badge to README
**Label:** `no-gpu`, `documentation`, `good first issue`  
**Difficulty:** Easy  
**Est. hours:** 0.5  
**Acceptance criteria:**
- README displays a "CPU mode supported" badge
- Badge links to CPU setup documentation

**Files:** `README.md`

---

## 3. Add contributing path block to README
**Label:** `no-gpu`, `documentation`, `good first issue`  
**Difficulty:** Easy  
**Est. hours:** 1  
**Acceptance criteria:**
- README has a "Choose your contributor path" block
- Path A (no GPU): UI/UX, docs, tests, API, postprocess
- Path B (GPU): adapters, quality pipeline

**Files:** `README.md`

---

## 4. Fix misleading "Generation jobs will fail" warning
**Label:** `no-gpu`, `bug fix`, `cpu-mode`  
**Difficulty:** Easy  
**Est. hours:** 0.5  
**Acceptance criteria:**
- Warning message in `detect_gpu()` is accurate for CPU mode
- Says "Model/CUDA dependencies will be skipped" instead of "Generation jobs will fail"

**Files:** `scripts/setup.sh`

---

## 5. Define `err()` function in setup.sh
**Label:** `no-gpu`, `bug fix`, `cpu-mode`  
**Difficulty:** Easy  
**Est. hours:** 0.25  
**Acceptance criteria:**
- `err()` function is defined in `scripts/setup.sh`
- Used in `setup_cuda_124()` for driver version check

**Files:** `scripts/setup.sh`

---

## 6. Make thirdparty submodule update opt-in
**Label:** `no-gpu`, `cpu-mode`  
**Difficulty:** Easy  
**Est. hours:** 0.5  
**Acceptance criteria:**
- `ensure_thirdparty_submodule()` uses `--init --recursive` by default
- `--remote --merge` only runs with `--update-thirdparty` flag
- `--with-thirdparty` flag forces init even in CPU mode

**Files:** `scripts/setup.sh`

---

## 7. Add `FORMASH3D_COMPUTE` env var documentation
**Label:** `no-gpu`, `documentation`, `cpu-mode`  
**Difficulty:** Easy  
**Est. hours:** 1  
**Acceptance criteria:**
- `.env.example` documents `FORMASH3D_COMPUTE=auto|cpu|cuda`
- `Docs/TASKS.md` updated with CPU mode section

**Files:** `.env.example`, `Docs/TASKS.md`

---

## 8. Create `CODE_OF_CONDUCT.md` (root)
**Label:** `no-gpu`, `documentation`  
**Difficulty:** Easy  
**Est. hours:** 0.5  
**Acceptance criteria:**
- File exists at repo root
- Links to Contributor Covenant v2.1

**Files:** `CODE_OF_CONDUCT.md`

---

## 9. Add GitHub issue templates
**Label:** `no-gpu`, `documentation`  
**Difficulty:** Easy  
**Est. hours:** 1  
**Acceptance criteria:**
- `.github/ISSUE_TEMPLATE/config.yml` exists linking to Discussions
- Existing templates (`bug_report.yml`, `feature_request.yml`, `model_issue.yml`) are valid

**Files:** `.github/ISSUE_TEMPLATE/config.yml`

---

## 10. Add `docs/ARCHITECTURE_FOR_CONTRIBUTORS.md`
**Label:** `no-gpu`, `documentation`  
**Difficulty:** Medium  
**Est. hours:** 2  
**Acceptance criteria:**
- <= 1.5 pages
- Folder map of the project
- Request flow diagram (text-based)
- Where to add: adapter, UI panel, test

**Files:** `docs/ARCHITECTURE_FOR_CONTRIBUTORS.md`

---

## 11. Add 15 good first issues (no-gpu)
**Label:** `no-gpu`, `documentation`, `good first issue`  
**Difficulty:** Medium  
**Est. hours:** 3  
**Acceptance criteria:**
- `docs/GOOD_FIRST_ISSUES.md` exists with 15+ issue drafts
- Each has: title, files, acceptance criteria, difficulty, est. hours, labels
- At least 10 are marked `no-gpu`

**Files:** `docs/GOOD_FIRST_ISSUES.md`

---

## 12. Add `docs/GITHUB_SETUP.md` with copy-paste values
**Label:** `no-gpu`, `documentation`  
**Difficulty:** Easy  
**Est. hours:** 1  
**Acceptance criteria:**
- Repo description <= 350 chars, keyword-rich
- 15-20 topics listed
- Social preview image spec (1280x640 PNG)
- Release v0.1.0-beta notes draft

**Files:** `docs/GITHUB_SETUP.md`, `docs/RELEASE_NOTES_DRAFT.md`

---

## 13. Add `docs/OUTREACH.md` with post drafts
**Label:** `no-gpu`, `documentation`  
**Difficulty:** Easy  
**Est. hours:** 2  
**Acceptance criteria:**
- Ready-to-post drafts for Reddit, HN, Dev.to, X, LinkedIn, HF
- Lists to submit: up-for-grabs.net, goodfirstissue.dev, awesome-lists
- 30-day plan included

**Files:** `docs/OUTREACH.md`

---

## 14. Verify no `pre-alpha` or `prealpha` remains in docs
**Label:** `no-gpu`, `documentation`  
**Difficulty:** Easy  
**Est. hours:** 0.5  
**Acceptance criteria:**
- `grep -ri "pre-alpha\|prealpha"` returns no results in `.md` files
- All docs reference "beta" phase

**Files:** All `.md` files

---

## 15. Add `bun test` and `pytest` to CI
**Label:** `no-gpu`, `tests`, `ci`  
**Difficulty:** Medium  
**Est. hours:** 2  
**Acceptance criteria:**
- `.github/workflows/` has a workflow running `bun test`
- `.github/workflows/` has a workflow running `python -m pytest backend/tests/`
- Both pass on `ubuntu-latest` (no GPU)

**Files:** `.github/workflows/*.yml`
