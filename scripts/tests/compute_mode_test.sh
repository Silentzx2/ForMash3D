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
total="$(grep -ciE 'cu124|kaolin|natten|pytorch3d' "$INSTALL" 2>/dev/null || true)"
cuda_guard_lines="$(grep -n 'COMPUTE_MODE.*cuda' "$INSTALL" 2>/dev/null | cut -d: -f1 || true)"
unguarded="$(
  grep -nE 'cu124|kaolin|natten|pytorch3d' "$INSTALL" 2>/dev/null |
    cut -d: -f1 |
    while read -r line_no; do
      if echo "$cuda_guard_lines" | grep -qE '^[0-9]+$' &&
        echo "$cuda_guard_lines" | awk -v line="$line_no" '$1 <= line {found=1} END {exit !found}'; then
        :
      else
        echo "$line_no"
      fi
    done
)"
unguarded_count="$(printf '%s\n' "$unguarded" | grep -cE '^[0-9]+$' 2>/dev/null || true)"
if [[ "$unguarded_count" -eq 0 ]]; then
  echo "  ✓ backend/scripts/install.sh: $total CUDA-only dependency references follow a CUDA guard"
  PASS=$((PASS + 1))
else
  echo "  ✗ backend/scripts/install.sh: $unguarded_count possible unguarded CUDA-only dependency references"
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
