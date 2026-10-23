#!/usr/bin/env bash
# scripts/lib/compute_mode.sh — shared compute-mode resolver for setup.sh and install.sh.
#
# Sourced by both scripts; each defines FORMASH3D_COMPUTE and exports it.
#
# Resolution order (first match wins):
#   1. Explicit --cpu / --gpu flag  -> FORCE_CPU / FORCE_CUDA env vars
#   2. FORMASH3D_COMPUTE env var    -> auto|cpu|cuda
#   3. CUDA_FORCE_PRESENT=1         -> cuda (test hook)
#   4. nvidia-smi -L >= 1 device    -> cuda
#   5. otherwise                    -> cpu
#
# REQUIRE_GPU=1 aborts when mode resolves to cpu.

resolve_compute_mode() {
  local mode="${FORMASH3D_COMPUTE:-auto}"

  # Explicit --cpu / --gpu flags (set by the caller before sourcing)
  if [[ "${FORCE_CPU:-0}" == "1" ]]; then
    mode="cpu"
  elif [[ "${FORCE_CUDA:-0}" == "1" ]]; then
    mode="cuda"
  fi

  if [[ "$mode" == "auto" ]]; then
    if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi -L >/dev/null 2>&1; then
      local gpu_count
      gpu_count=$(nvidia-smi -L 2>/dev/null | wc -l | tr -d ' ')
      if [[ "$gpu_count" -ge 1 ]]; then
        mode="cuda"
      else
        mode="cpu"
      fi
    else
      mode="cpu"
    fi
  fi

  # Test hook: simulate CUDA presence
  if [[ "${CUDA_FORCE_PRESENT:-}" == "1" ]]; then
    mode="cuda"
  fi

  # REQUIRE_GPU=1 must abort when mode resolves to cpu
  if [[ "${REQUIRE_GPU:-}" == "1" && "$mode" == "cpu" ]]; then
    printf '%s\n' "[ERROR] REQUIRE_GPU=1 is set but no NVIDIA GPU detected — aborting." >&2
    return 1
  fi

  FORMASH3D_COMPUTE="$mode"
  export FORMASH3D_COMPUTE
  echo "$mode"
}
