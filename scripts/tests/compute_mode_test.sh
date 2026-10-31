#!/usr/bin/env bash

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RESOLVER="$ROOT/scripts/lib/compute_mode.sh"
PASS=0
FAIL=0

# shellcheck source=../lib/compute_mode.sh
source "$RESOLVER"

check() {
  local desc="$1" expected="$2" actual="$3"
  if [[ "$actual" == "$expected" ]]; then
    echo "  ✓ $desc"
    PASS=$((PASS + 1))
  else
    echo "  ✗ $desc (expected '$expected', got '$actual')"
    FAIL=$((FAIL + 1))
  fi
}

echo "=========================================="
echo " Compute Mode Resolver Tests"
echo "=========================================="

# Keep each case in a subshell so test environment changes cannot leak.
actual=$(
  (
    PATH=""
    FORMASH3D_COMPUTE=auto
    CUDA_FORCE_PRESENT=""
    REQUIRE_GPU=""
    FORCE_CPU=0
    FORCE_CUDA=0
    resolve_compute_mode
  ) 2>/dev/null
)
check "no GPU -> cpu" "cpu" "$actual"

actual=$(
  (
    FORMASH3D_COMPUTE=auto
    CUDA_FORCE_PRESENT=1
    FORCE_CPU=0
    FORCE_CUDA=0
    REQUIRE_GPU=""
    resolve_compute_mode
  ) 2>/dev/null
)
check "CUDA_FORCE_PRESENT=1 -> cuda" "cuda" "$actual"

actual=$(
  (
    FORMASH3D_COMPUTE=auto
    CUDA_FORCE_PRESENT=0
    FORCE_CPU=1
    FORCE_CUDA=0
    REQUIRE_GPU=""
    resolve_compute_mode
  ) 2>/dev/null
)
check "--cpu flag -> cpu" "cpu" "$actual"

actual=$(
  (
    FORMASH3D_COMPUTE=auto
    CUDA_FORCE_PRESENT=0
    FORCE_CPU=0
    FORCE_CUDA=1
    REQUIRE_GPU=""
    resolve_compute_mode
  ) 2>/dev/null
)
check "--gpu flag -> cuda" "cuda" "$actual"

if (
  PATH=""
  FORMASH3D_COMPUTE=auto
  CUDA_FORCE_PRESENT=0
  FORCE_CPU=0
  FORCE_CUDA=0
  REQUIRE_GPU=1
  resolve_compute_mode >/dev/null 2>&1
); then
  echo "  ✗ REQUIRE_GPU=1 + cpu -> abort (expected non-zero exit, got 0)"
  FAIL=$((FAIL + 1))
else
  echo "  ✓ REQUIRE_GPU=1 + cpu -> abort"
  PASS=$((PASS + 1))
fi

echo
echo "=========================================="
echo " Static Grep: CPU-mode script cleanliness"
echo "=========================================="

setup_matches="$(grep -ciE 'cu124|kaolin|natten|pytorch3d' "$ROOT/scripts/setup.sh" 2>/dev/null || true)"
if [[ "$setup_matches" -eq 0 ]]; then
  echo "  ✓ scripts/setup.sh: no cu124/kaolin/natten/pytorch3d"
  PASS=$((PASS + 1))
else
  echo "  ✗ scripts/setup.sh: $setup_matches cu124/kaolin/natten/pytorch3d references"
  FAIL=$((FAIL + 1))
fi

INSTALL="$ROOT/backend/scripts/install.sh"

# Verify the CPU branch selects CPU PyTorch wheels and the CUDA index is in its else branch.
if awk '
  /^[[:space:]]*if[[:space:]].*COMPUTE_MODE.*== "cpu"/ { in_torch=1; next }
  in_torch {
    if (/whl\/cpu/) cpu_index=1
    if (cpu_index && /^[[:space:]]*else[[:space:]]*$/) else_seen=1
    if (else_seen && /whl\/cu124/) cuda_index=1
    if (cuda_index && /^[[:space:]]*fi[[:space:]]*$/) { branch_closed=1; exit }
  }
  END { exit !(cpu_index && else_seen && cuda_index && branch_closed) }
' "$INSTALL"; then
  echo "  ✓ backend/scripts/install.sh: PyTorch CPU/CUDA indexes are separated by compute mode"
  PASS=$((PASS + 1))
else
  echo "  ✗ backend/scripts/install.sh: PyTorch CPU/CUDA indexes are not correctly guarded"
  FAIL=$((FAIL + 1))
fi

# Check the guarded model dependencies anywhere in the file, including after the guard closes.
if awk '
  {
    if (/^[[:space:]]*if[[:space:]].*COMPUTE_MODE.*== "cuda"/) {
      cuda_guard_count++
      if (cuda_guard_count == 2) { in_stack=1; depth=1; next }
    }
    if (in_stack) {
      if (/^[[:space:]]*if[[:space:]]/) depth++
      if (/^[[:space:]]*fi[[:space:]]*$/) {
        depth--
        if (depth == 0) { in_stack=0; guard_closed=1 }
      }
    }
    if (/(kaolin -f|spconv-cu124|pytorch3d-|torch_scatter|xformers.*cu124|NATTEN_PREBUILT_URL=.*natten)/) {
      seen_dependency=1
      if (!in_stack || depth < 1) unguarded=1
    }
  }
  END { exit !(cuda_guard_count >= 2 && guard_closed && seen_dependency && !unguarded) }
' "$INSTALL"; then
  echo "  ✓ backend/scripts/install.sh: CUDA-only model dependencies are inside the CUDA-mode guard"
  PASS=$((PASS + 1))
else
  echo "  ✗ backend/scripts/install.sh: CUDA-only model dependencies are not protected by the CUDA-mode guard"
  FAIL=$((FAIL + 1))
fi

echo
echo "=========================================="
echo " RESOLVER TEST RESULT"
echo "=========================================="
echo "Passed: $PASS"
echo "Failed: $FAIL"

(( FAIL == 0 )) || exit 1
echo "✓ All compute mode resolver tests passed."
