# FORMASH3D — COMPETE WITH TRIPO / MESHY / HYPER3D — MASTER AGENT PROMPT (v2)

Repo: github.com/Silentzx2/ForMash3D. Work on `Dev`; compare against `main`.
Vision: ForMash3D produces sharp, crisp, production-ready meshes that compete with Tripo AI, Meshy AI, and Hyper3D (Rodin). Priority: (A) sharpness, (B) clean topology, (C) reliability (no OOM, few failed jobs).
Known problem: raw Hunyuan3D 2.1 output is smooth, has holes, loses sharp detail. The raw mesh itself is smooth, so postprocess alone is not the cause.

---

## 1. ROLE

You are the **Orchestrator**: Senior 3D Generative Pipeline Engineer (PyTorch/diffusion 3D adapters, trimesh/PyMeshLab/Open3D, xatlas/PartUV, FastAPI/Celery, Docker/VPS automation, Next.js UI).
Spawn one **sub-agent per task** (section 9). Sub-agents own disjoint file sets. You own integration, gates, docs, and the final zip.

## 2. STARTUP & INITIALIZATION VERIFICATION (MANDATORY FIRST STEP)

Inspect: Docker entrypoints, compose files, bash setup/start scripts, requirements/pyproject, env templates, model download scripts.
- Every new dependency/weight MUST be wired into the installer/entrypoint so 1-click start still works.
- GPU VRAM is unknown and variable. Detect at runtime (`torch.cuda.mem_get_info`). Never hardcode VRAM. Measure peak (`torch.cuda.max_memory_allocated`) and store measured budgets in `models.yaml`.
- If a change could break startup: do not apply it; report it.

**Runtime detection contract**

Use (or create) a single module `backend/core/runtime_probe.py` returning this exact dict. Nothing else calls CUDA/NVML/psutil directly for planning.

```python
{
  "has_cuda": bool,
  "cuda_device_name": str | None,
  "total_vram_gb": float | None,
  "free_vram_gb": float | None,
  "total_ram_gb": float,
  "free_ram_gb": float,
  "peak_vram_gb_last_run": float | None,
  "installed_adapters": list[str],   # _ADAPTER_REGISTRY keys
  "enabled_adapters": list[str],     # models.yaml enabled:true AND license opt-in satisfied
  "license_optins": dict[str, bool], # adapter_id -> user accepted
  "torch_version": str,
  "cuda_version": str | None,
}
```
- `free_vram_gb`: `torch.cuda.mem_get_info` at call time, never cached across jobs. `peak_vram_gb_last_run`: `torch.cuda.max_memory_allocated`, reset per job.
- Call it inside the GPU worker process (e.g. Celery worker), not the API process, which may have no CUDA context.
- If the scheduler already does this, verify the shape and add missing fields. Do not duplicate scheduler logic: refactor into `runtime_probe.py` and have the scheduler consume it.
- The planner (section 8) consumes exactly this dict.

## 3. CONTEXT-READING RULES (DEEP DOCS, NO FULL CODE SCAN)

PHASE A — docs only, before any plan or code:
1. Read `RULES.md` FIRST, then every other `.md` (README, ARCHITECTURE, API, `docs/`, changelogs, adapter/model docs).
2. Read top-to-bottom, then bottom-to-top.
3. Extract: hard rules, forbidden actions, doc-update duties, branch/PR rules, storage layout, current adapter list, current UV/retopo/bake tools.
4. Do NOT scan the 300+ file codebase. Open source files only when a doc or this prompt names them; use targeted grep and line ranges.
4a. Exceptions to rule 4 (targeted reads ALLOWED, full scans NOT):
   - To modify a file, read its header + the specific function/class the task targets (bounded range, ≤300 lines per read).
   - To verify a filter name / parameter / API signature, read only the module the task names.
   - To check VRAM/scheduler wiring, read only `backend/core/scheduler.py` and `backend/core/runtime_probe.py` (section 2).
   - NEVER read other adapters "for context". Pre-justified: base adapter + adapter interface (1D, 1E). Any other cross-adapter read must be stated and justified in the sub-agent report.
5. Report every doc-vs-code disagreement in the PLAN.
6. Before outputting the plan (section 9, Step 2), cross-check every batch task against RULES.md forbidden actions and hard constraints. If a task would violate a RULES.md rule:
   - List it in the plan under "BLOCKED BY RULES.md" with the exact citation.
   - Do not silently drop it; report it to the user.
   - If RULES.md forbids an edit this plan requires (e.g. `models.yaml`), propose the smallest policy-compliant alternative (e.g. a new config file merged by the plan) and wait for approval before Batch 1.

## 4. PROJECT INVARIANTS & HARD RULES

- Flow: raw mesh at max model quality → immutable `master/source.glb` → postprocess (retopo, UV, PBR bake, LOD) to the user's target polycount → game_ready formats only after postprocess.
- `master/source.glb` is NEVER mutated. All processing runs on working copies. Verify sha256 before/after every pipeline run.
- Job storage dir stays `<image name>_<job id>` under backend storage models; inner structure unchanged. No new dirs in job folders unless RULES.md allows.
- Do NOT: add TripoSF (TRELLIS.2 already covers high-res), use an LLM planner, rewrite the postprocess pipeline (add the gate as an additive layer; the existing repair/retopo/UV/bake/LOD/physics/QA chain stays), bypass the VRAM scheduler, break the licensing advisory system.
- Existing adapters (Hunyuan3D Shape v2.1, TRELLIS.2, TripoSG) keep working. Default behavior changes only where the benchmark proves a gain.
- All thresholds, presets and routing rules live in config, never hardcoded.
- **Concurrent jobs:** the scheduler MUST serialize VRAM-hungry jobs (FIFO queue) when their combined `vram_budget_gb` exceeds `runtime.free_vram_gb`. Never run two generative adapters in parallel. Postprocess tools (UV, bake, decimate) may overlap a generative job ONLY if free VRAM, after reserving the active job's full `vram_budget_gb`, still covers the tool's measured peak. If unsure, serialize. Log every queue event (as a file in the job folder only if RULES.md allows).
- Update docs after every change (section 13).
- STOP and report if: RULES.md conflicts with a task, startup breaks, master hash changes, or a license forbids use.

## 5. TARGET PIPELINE PATHS

Paradigm shift: stop treating every generated mesh as broken. Generate better meshes first, repair only what the gate says needs repair.
- **Path A (native/clean):** native-topology adapter (only if TaoFlowForge passes verification) → gate → skip repair/retopo if clean → UV → bake.
- **Path B (high detail):** TRELLIS.2 (up to 1024³) → gate → if clean skip retopo, else existing repair chain → feature-aware retopo → normal bake from master.
- **Path C (fast/fallback):** Hunyuan3D / TripoSG → hole-targeted repair → existing chain; must keep working.
- Infrastructure: memory-safe decimation, conditional PartUV, rule-based planner, best-of-N seeds, quality report.

## 6. SOURCE-PLAN COVERAGE MAP & KNOWN DEFECTS

The agent must treat the third-party plan as a hypothesis. Coverage:

| Source item | Where handled |
| :--- | :--- |
| Paradigm shift, paths A/B/C | Section 5 |
| Bottleneck: adapters output dense geometry | 1C (Hunyuan audit), 3A (native adapter) |
| Bottleneck: repair/retopo run unconditionally | 2A (gate), 2E |
| Bottleneck: xatlas fragmentation/CPU | 2D |
| Bottleneck: decimation OOM | 2B |
| Bottleneck: deterministic model selection | 1E, 3B (planner, section 8) |
| `native_topology` + `output_resolution` flags on ALL adapters (trellis2 false/1024, hunyuan false) | 1E |
| `_ADAPTER_REGISTRY` entry, `thirdparty/LICENSE` entry | 3A |
| Gate `strict` flag, thresholds tuned on a test set | 2A |
| PartUV: auto threshold 500k tris, ~7 GB, runs after generator VRAM released, CUDA fallback | 2D |
| Decimation: threshold 2M tris, unchanged below it | 2B |
| Priorities P0/P1/P2 | Tags in section 9 |
| Risk table | Section 10 |
| Test plan, 20–50 image benchmark (UV island count, texture fidelity, time, OOM) | Section 11, 1A, 3D |
| README pipeline diagram | 3E |

Defects in the source plan (do NOT copy):
1. Orchestrator passes `source_glb` into unwrap/bake → mutates master. Use a working copy.
2. Gate rejects on one sliver (`min_quality < 0.1`). Use percentiles / bad-face fraction.
3. Gate only runs for `native_topology` adapters. It must run for ALL adapters (the plan itself says TRELLIS.2 gets evaluated, but its code does not).
4. Gate measures boundary edges (holes) but never uses them.
5. "Chunked" decimation isn't chunked, overwrites input in place, and the second call with `target_ratio=1.0` is a no-op.
6. Planner fallback rewrites `plan` but keeps the old `adapter` and `skip_retopo=True`.
7. `"high"` quality defaults to an unverified 20 GB adapter. It must be opt-in.
8. `uv_backend="auto"` is not resolved in the orchestrator fallback path.
9. `symmetry` is collected by the planner but never used.
10. The plan never addresses Hunyuan3D 2.1 smoothness, the user's actual problem.

## 7. UNVERIFIED CLAIMS — VERIFY BEFORE CODING

If unverifiable, do not invent an API: stub behind a disabled flag and report.
- **TaoFlowForge** (Alibaba Taobao3D, cascaded flow matching): the paper exists. Code, weights, license, Python API, and the VRAM numbers (6–20 GB) are unconfirmed.
- **PartUV**: real API (`unwrap_gpu` was a guess), CUDA need, speed claims, the "7 GB" figure (README claim: verify).
- **xatlas**: real API takes vertex/face arrays, not a file path.
- **PyMeshLab**: filter/metric names (`compute_quality`, aspect ratio) against the pinned version; GLB loading.
- **Open3D / any decimation lib**: NOT streaming; loads the full mesh.
- **FastMesh**: which crease/boundary-preserving options it supports.

---

## 8. PLANNER SPECIFICATION (rule-based, no LLM)

The planner is the spine of the pipeline: every quality knob flows through its output. Build it early (1E) and tune it late (3B).

**Design rules**
- Pure function: `plan_generation(request: dict, runtime: dict, rules: dict) -> Plan`. No GPU calls inside; runtime facts are injected. Deterministic and unit-testable.
- Routing rules live in config (`planner_rules` file in the existing config location), not in Python.
- Plan carries `schema_version` and `reasons[]` (why each choice, why each candidate was skipped); it is saved into the quality report (3C).

**Inputs (explicit, defaulted)**
| Field | Values | Default |
| :--- | :--- | :--- |
| `mesh_style` | `clean` (topology-first) / `detailed` (detail-first) / `auto` | `auto` |
| `requested_quality` | `fast` / `balanced` / `high` | `balanced` |
| `object_type` | `mechanical` / `organic` / `character` / `general` (user-provided only, never guessed) | `general` |
| `symmetry` | `bilateral` / `radial` / `none` | `none` (recorded in the report only; no behavior unless a benchmark justifies it) |
| `target_polycount` | int \| None | `None` (LOD target left to postprocess defaults) |
| `input_type` | `image` / `text` | inferred from request payload; unknown → `image` |
| `runtime` | exact dict from `runtime_probe.py` (section 2 contract) | detected |

If the existing API does not expose `target_polycount`, the planner accepts it as optional and MUST NOT crash on `None`. If `input_type` is `text` and the selected adapter does not support text, treat it as a fallback trigger ("input type not supported" in the fallback rules). Never coerce silently.

**Outputs (Plan)**
`adapter`, `fallback_chain[]`, `preset` (fast/balanced/high → Hunyuan/TRELLIS params from 1C), `num_seeds` (1D), `input_prep` flags (1B), `skip_retopo_allowed` (permission only; the gate makes the final decision), `uv_backend` (`auto`/`partuv`/`xatlas`), `bake` options (normal from master), `reasons[]`, `warnings[]`.

**Initial routing hypothesis (starting config; 3B must replace it with benchmark-driven rules)**
| Condition | Adapter | Seeds | Notes |
| :--- | :--- | :--- | :--- |
| `fast` | Hunyuan3D v2.1 (fast preset) | 1 | fallback of last resort |
| `balanced` | TRELLIS.2 if free VRAM ≥ its measured budget, else Hunyuan (balanced preset) | 2 | |
| `high` | TRELLIS.2 (high preset), else Hunyuan (high preset) | 3 | |
| `mesh_style=clean` or `mechanical` | native adapter ONLY if enabled + verified (3A); else dense route with feature-aware retopo | per quality | native is opt-in, never default |
| `character`/`organic` | same as quality tier | per quality | |

**Fallback rules**
For each candidate in order, check: registered, enabled flag, license opt-in satisfied, measured VRAM budget ≤ free VRAM, input type supported. If any check fails, record the reason and take the next candidate. The last fallback is always Hunyuan fast. On any fallback, RECOMPUTE the whole plan (adapter, preset, seeds, retopo permission, UV backend). Never patch a single field.

**Wiring**
API/UI → planner → scheduler (reserves the plan adapter's budget; on failure re-plans with the next candidate) → generation (best-of-N per plan) → gate (`skip_retopo_allowed`) → UV (`uv_backend`) → bake → quality report. UI: Quality and Mesh style selectors in the job-creation form (defaults balanced/auto); object type under "Advanced".

**Planner tests (table-driven)**: every quality × mesh_style × object_type combo; no-CUDA; low-VRAM; license not opted in; native adapter disabled; determinism (same input → same plan); fallback recomputes the full plan.

---

## 9. EXECUTION PROTOCOL

Step 1 — PHASE A (section 3). Step 2 — OUTPUT THE PLAN (compact): doc-vs-code gap table, file-ownership map per sub-agent, risks, proposed thresholds. Step 3 — run Batches 1→3 sequentially. Sub-agents in a batch run in parallel only when file sets are disjoint and dependencies are met. A failed gate blocks the next batch.

Sub-agent report format (mandatory):
```
[SUBAGENT <id>] STATUS: done|blocked
ROOT CAUSE: <≤2 sentences>
CHANGES: <path>:<anchor/lines> → <replacement snippet>
VERIFY: <command> → <result>
RISKS: <≤2 lines>
```

### BATCH 1 — Foundation + sharpness at the source (P0)
Dependency order: 1A → 1E → (1B, 1C, 1D in parallel).

- **1A Baseline + metrics lib + parity scorecard (P0).** Benchmark script on 10–20 images for iteration (final run uses 20–50): mechanical, organic, character, hard-edged props. Shared metrics module: triangle count, non-manifold edges/vertices, hole count + boundary-loop sizes, connected components + floater ratio, degenerate faces, aspect-ratio p1/p5, UV island count, texture fidelity, **feature-edge retention** (share of master edges with dihedral >30° still present within tolerance in the final mesh), generation time, peak VRAM/RSS, OOM count. Save `baseline.json` BEFORE any change. Also generate a parity scorecard template (rows: sharpness, topology cleanliness, UV quality, texture quality, speed, failure rate; columns: ForMash3D / Tripo / Meshy / Hyper3D). If the user provides competitor GLBs for the same inputs, run the same metrics module on them; the agent cannot call those services.
  **1A.1 Pre-existing master immutability audit.** Before generating `baseline.json`: (1) pick 3 benchmark inputs; (2) run the CURRENT pipeline end-to-end on `Dev`; (3) sha256 `master/source.glb` right after generation and again after postprocess; (4) if hashes differ, that is a pre-existing bug: do not run the benchmark, report file path, line range and the minimal fix (usually: copy master to a working copy before any writing tool), and block Batch 2 until fixed; (5) if equal, record `"master_immutability": "verified"` in `baseline.json`.
- **1E Planner v0 + capability flags (P0).** `runtime_probe.py` (section 2 contract), plan schema, config-driven rules (section 8), scheduler wiring with full-plan fallback (fixes defect 6), `native_topology` / `output_resolution` / measured VRAM fields for ALL adapters in `models.yaml`, `native_topology` attribute on the base adapter.
- **1B Input image prep (P0).** Per-job toggles driven by the plan: improved background removal/alpha cleanup, tight centered crop with margin, resize to the adapter's expected size, upscale only if the shorter side < threshold. Original image untouched. Prefer installed models; verify the license of any new model; wire new weights into the installer.
- **1C Hunyuan3D 2.1 audit + hole repair (P0).** Compare adapter parameters with upstream defaults: grid/octree resolution, steps, guidance, marching-cubes threshold/algorithm, chunking, bounds, and any floater/degenerate-face/face-reduction steps applied BEFORE saving master. Remove anything that smooths or reduces the master. Sweep on the benchmark set; define `fast/balanced/high` presets in config with measured time/VRAM. Add hole-targeted repair (fill boundary loops, small-hole threshold in config) as the first repair level; full remesh only as fallback. Run the same smoothness check on TripoSG and TRELLIS.2 outputs (report only).
  **1C.1 Escalation if smoothness is intrinsic (do NOT skip).** After the sweep, compare `feature_edge_retention` and p95 local curvature on Hunyuan vs TRELLIS.2 outputs for the same inputs. If Hunyuan retention is ≤ 60% of TRELLIS.2's, or the best preset improves retention by < 5% over baseline (both thresholds in config):
  - STOP tuning Hunyuan. Mark Hunyuan Path C "smooth by design" in the docs.
  - Planner default: `balanced` → TRELLIS.2; Hunyuan stays as OOM/fallback (matches the section 8 hypothesis).
  - Write `docs/hunyuan_smoothness_report.md`: sweep table, plateau evidence, and 2–3 external detail-boost options found by search, each with source URL + license status. Name only options you can verify; do not invent tool names.
  - Report as "blocked — needs a different backbone", not a failure.
- **1D Best-of-N seeds (P1).** N from the plan; sequential; early stop when score ≥ threshold; VRAM/time aware. Only the best becomes `master/source.glb`; other candidates are deleted from the job folder; all raw metrics + composite scores go to the report data.
  Score = weighted sum of 1A metrics, higher = better. Weights/ranges in the existing config location per docs (suggested `seed_scoring.yaml`). Normalize each metric to [0,1] with FIXED reference ranges derived from `baseline.json` (NOT across candidates), so early stop works after the first candidate.
  ```yaml
  seed_scoring:
    weights:
      feature_edge_retention: 0.40    # sharpness = priority #1
      hole_count: 0.20                # inverted: fewer = higher
      component_floater_ratio: 0.15   # inverted
      degenerate_face_ratio: 0.10     # inverted
      triangle_count: 0.05            # inverted (leaner at equal quality)
      aspect_ratio_p5: 0.10           # inverted
    ranges: {}                        # per-metric [worst, best], filled from baseline.json (1A)
    early_stop_score: 0.85
  ```
  If two candidates are within 2% composite, prefer higher `feature_edge_retention`; then lower triangle count.

**GATE 1:** startup intact; 1A.1 audit green; Hunyuan presets beat `baseline.json` (holes ↓, feature-edge retention ↑) OR the 1C.1 escalation is documented; planner tests pass; master unmodified; docs updated.

### BATCH 2 — Postprocess: gate, sharp retopo, normal bake, UV
- **2A Topology gate, all adapters (P0).** Runs on a working copy. Checks: non-manifold edges/vertices, hole count/size, components + tiny-floater ratio, degenerate faces, aspect-ratio percentiles, optional sampled self-intersection. Output: `skip_repair | minimal_repair (hole fill) | full_repair` and `skip_retopo`. Honors `plan.skip_retopo_allowed`. `strict` flag. Thresholds in config, tuned on the benchmark set (document false-reject rate). Report object saved for 3C.
- **2B Feature-aware retopo + decimation + memory safety (P1).** Preserve crease edges and boundaries (verify FastMesh/PyMeshLab options). Never decimate in place. Memory-safe path above a configurable threshold (suggested 2M tris; unchanged behavior below it), RAM detection via psutil, measure peak RSS on a 5M+ tri mesh.
- **2C Normal-map detail bake from master (P0).** Use the existing baker per docs. Bake high-poly `master/source.glb` → retopo mesh: tangent-space normal map (glTF = OpenGL convention), cage/max-ray-distance from config, optional AO/curvature. Verify visually on 3 meshes plus numeric normal deviation vs master.
  **PBR checks (run on the final game-ready asset, not master):**
  - Albedo, normal, roughness, metallic, AO (if produced) exist and are non-degenerate (not all-0 / all-255). glTF packs roughness=G, metallic=B in one map: check channels, not files.
  - Normal map is tangent-space, OpenGL (Y+): a flat region decodes to ≈(0,0,1), and a fixture bump mesh shows the expected green-channel direction.
  - UV validity: every face has UVs inside [0,1]; overlap fraction ≈ 0 unless intended; UV-space utilization ≥ config threshold (suggested 70%, packing-realistic); report unmapped faces/islands.
  - Metallic/roughness sanity: on benchmark items where applicable, at least one metallic and one non-metallic region; otherwise flag for manual review.
  - Save a per-asset PBR report JSON in the job folder (if RULES.md allows); aggregate it into the 3C quality report.
- **2D UV backend (P1).** Verify PartUV API and CUDA need; `auto` picks PartUV for ≥ threshold tris (suggested 500k, config) and falls back to xatlas when CUDA is unavailable or the call fails. Fix xatlas to its real array API. Resolve `auto` in exactly one function. PartUV runs after generator VRAM is released.
- **2E Orchestrator integration (P0).** Wire 2A–2D on working copies; assert master sha256 unchanged at the end of every run.

**GATE 2:** benchmark rerun beats Gate 1 on feature-edge retention and holes; 5M+ tri mesh does not OOM; Path C still works; master hash unchanged; docs updated.

### BATCH 3 — Native adapter, planner tuning, reporting, UI, release
- **3A TaoFlowForge spike (P1).** Check the project page and arXiv for a public repo, weights, license, requirements, torch/CUDA compatibility. ONLY if code + weights are public, the license permits personal use, and the env is compatible: implement the adapter (`_ADAPTER_REGISTRY` entry, `models.yaml` entry with `enabled: false`, opt-in, never default), measure real VRAM, add to the licensing advisory and `thirdparty/LICENSE`. Otherwise write a "blocked" note in the docs and stop. No web access = report blocked.
- **3B Planner v1 (P1).** Replace the hypothesis table with benchmark-driven rules per object type/quality (config). API fields, UI additions are scoped: two selectors (`Quality` = fast/balanced/high; `Mesh style` = clean/detailed/auto) on the job-creation form, defaults `balanced` / `auto`; `Object type` and `symmetry` in a collapsed "Advanced" disclosure. Reuse existing components and the existing design system; new controls and the 3C badge get the project's premium SaaS look (Tripo/Meshy-style), but do NOT restyle existing screens, do NOT touch unrelated screens, and add design tokens only if the system lacks an equivalent. Full planner test suite (section 8).
- **3C Quality report + UI badge (P1).** JSON report in the existing job folder structure: 1A metrics, plan + reasons, gate decision, seed scores, before/after poly counts. API field. UI badge on job card + viewer panel (Sharp / Clean / Needs review; tooltip with key metrics).
- **3D Tests + final benchmark (P2).** Section 11. Final table: baseline vs now on every metric, plus the filled parity scorecard.
- **3E Docs sync + release (P2).** Section 13, README pipeline diagram, commit per sub-agent task, push to `Dev` / PR if possible.
- **3F Optional, report only (P2):** evaluate a quad-dominant export option (Tripo/Rodin offer quad topology). No implementation without user approval.

**GATE 3:** all tests pass; startup verified; final benchmark + parity scorecard delivered; docs re-read and gap-verified.

**On gate failure (applies to Gates 1–3):**
- Do NOT proceed to the next batch.
- Revert ALL changes of the failed batch on `Dev` (`git revert` per sub-agent commit, reverse order).
- Preserve the batch's sub-agent reports and the failing metric table in `docs/gate_failures/<batch_id>.md`.
- Re-run the previous gate's verification (for Gate 1: `baseline.json`) to confirm the repo is green again.
- Report to the user: which gate, which metric, delta vs the prior gate, recommended fix scope. No second fix attempt in the same session.

---

## 10. RISK REGISTER

| Risk | Mitigation |
| :--- | :--- |
| Native adapter VRAM exceeds the GPU | Measured budget in `models.yaml`; scheduler reserves it; offload only if verified; planner falls back |
| TaoFlowForge license unclear or code unreleased | Verify first; opt-in; blocked note if unverifiable |
| Gate falsely rejects good meshes (or accepts bad ones) | Percentile thresholds tuned on the benchmark set; `strict` flag; report false-reject rate |
| PartUV is CUDA-only or API differs | Verify; gate on `torch.cuda.is_available()`; xatlas fallback |
| Memory-safe decimation alters topology | Only above the threshold; unchanged below it; feature-edge retention measured |
| Planner misroutes inputs | Explicit user inputs; default balanced/auto; reasons logged; fallback recomputes the full plan |
| Best-of-N multiplies generation time | Early stop, N per tier, time/VRAM budget |
| New dependencies break 1-click start | Section 2 check; installer wiring; stop and report |

## 11. TESTING PLAN

- **Unit:** gate on a known-clean vs known-dense mesh; planner table (section 8); `unwrap(auto)` selects PartUV for high-poly and xatlas for low-poly; input-prep steps; seed scoring; PBR checks (known-good asset passes, asset with missing metallic fails).
- **Integration:** 3 inputs (mechanical, organic, character) through each planner plan; master sha256 unchanged after texturing; scheduler reserves the adapter budget and falls back when VRAM is insufficient; Path C works exactly as before.
- **Benchmark:** 20–50 images across categories; all section 9/1A metrics; pre-change vs post-change; optional competitor GLBs through the same metrics.

## 12. STRICT OUTPUT & TOKEN-OPTIMIZATION RULES

- ZERO conversational filler. No empty-line padding, no re-printing unchanged code, no full-file rewrites.
- Output ONLY replacement-only snippets with exact file path + anchor, or diffs.
- Root cause ≤2 short sentences. Tables compact. Report results in the sub-agent format, never narrate intent.

## 13. AUTOMATIC DOCUMENTATION SYNC (END OF EVERY BATCH)

Per RULES.md duties, output exact updates for: README (pipeline diagram), ARCHITECTURE, API.md (new fields/options, planner inputs, quality report), model/adapter docs, config docs (planner rules, presets, thresholds), CHANGELOG, RULES.md only if its own rules permit edits.
At the end: re-read all `.md` files top-to-bottom then bottom-to-top and verify no gaps against the code changes. List remaining gaps.

## 14. FINAL DELIVERABLE

1. Zip containing:
   - `CHANGED_FILES.txt`: every modified/new/deleted file with a one-line reason.
   - The changed files only, preserving directory structure under the repo root.
   - `DIFF.patch` (`git diff` output) so the merge can be reviewed or applied via `git apply`.
2. Commit strategy:
   - One commit per sub-agent task on `Dev`: `<batch>/<task-id>: <one-line summary>` (e.g. `2A/2A-gate: add topology gate with percentile thresholds`).
   - After a batch's gate passes, tag it: `git tag batch-<N>-pass`.
   - After Gate 3 passes, open a PR `Dev → main` only if the user gave PR instructions; otherwise leave `Dev` as-is and report the final commit hash.
3. Final report: gate results, benchmark table (before/after), parity scorecard, unresolved risks, blocked items (e.g. TaoFlowForge status).
