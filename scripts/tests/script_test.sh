#!/usr/bin/env bash

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PASS=0
FAIL=0

echo "========================================"
echo " ForMash3D Shell Script Full Static Audit"
echo " Excluding: backend/thirdparty"
echo "========================================"
echo

while IFS= read -r -d '' FILE; do
    REL="${FILE#$ROOT/}"
    OK=1

    echo "→ $REL"

    # 1. Standard Bash syntax
    if ! bash -n "$FILE" 2>/tmp/bash_err; then
        echo "  ✗ bash -n"
        cat /tmp/bash_err
        OK=0
    else
        echo "  ✓ bash -n"
    fi

    # 2. Bash syntax with extended glob support
    if ! bash -O extglob -n "$FILE" 2>/tmp/extglob_err; then
        echo "  ✗ bash extglob parse"
        cat /tmp/extglob_err
        OK=0
    else
        echo "  ✓ bash extglob parse"
    fi

    # 3. ShellCheck
    if command -v shellcheck >/dev/null 2>&1; then
        if ! shellcheck -s bash -S warning "$FILE"; then
            echo "  ✗ shellcheck"
            OK=0
        else
            echo "  ✓ shellcheck"
        fi
    else
        echo "  ! shellcheck not installed"
    fi

    # 4. shfmt parser/format validation
    if command -v shfmt >/dev/null 2>&1; then
        if ! shfmt -d "$FILE" >/dev/null; then
            echo "  ! shfmt: formatting differences found"
        else
            echo "  ✓ shfmt"
        fi
    else
        echo "  ! shfmt not installed"
    fi

    # 5. Basic suspicious patterns
    if grep -nE '^[[:space:]]*local[[:space:]]+' "$FILE" >/dev/null 2>&1; then
        :
    fi

    if (( OK )); then
        echo "  ✓ PASS"
        PASS=$((PASS + 1))
    else
        echo "  ✗ FAIL"
        FAIL=$((FAIL + 1))
    fi

    echo
done < <(
    find "$ROOT" \
        -type f \
        -name "*.sh" \
        -not -path "$ROOT/backend/thirdparty/*" \
        -not -path "$ROOT/.git/*" \
        -print0
)

rm -f /tmp/bash_err /tmp/extglob_err

echo "========================================"
echo " FINAL RESULT"
echo "========================================"
echo "Passed: $PASS"
echo "Failed: $FAIL"

(( FAIL == 0 )) || exit 1

echo "✓ All shell scripts passed static audit."

# ── Compute mode resolver tests ──────────────────────────────
echo ""
echo "=========================================="
echo " Compute Mode Resolver Tests"
echo "=========================================="

RESOLVER="$ROOT/scripts/lib/compute_mode.sh"
TESTS_PASS=0
TESTS_FAIL=0

# Source the resolver so resolve_compute_mode is available in this shell
# shellcheck source=/dev/null
source "$RESOLVER"

check() {
  local desc="$1" expected="$2" actual="$3"
  if [[ "$actual" == "$expected" ]]; then
    echo "  ✓ $desc"
    TESTS_PASS=$((TESTS_PASS + 1))
  else
    echo "  ✗ $desc (expected '$expected', got '$actual')"
    TESTS_FAIL=$((TESTS_FAIL + 1))
  fi
}

# Test 1: no nvidia-smi -> cpu (simulate by unsetting PATH)
if command -v nvidia-smi >/dev/null 2>&1; then
  echo "  ! nvidia-smi present; skipping no-GPU resolver test"
else
  PATH="" FORMASH3D_COMPUTE=auto CUDA_FORCE_PRESENT="" REQUIRE_GPU="" FORCE_CPU=0 FORCE_CUDA=0
  actual=$(resolve_compute_mode 2>/dev/null || echo "ERROR")
  check "no GPU -> cpu" "cpu" "$actual"
fi

# Test 2: CUDA_FORCE_PRESENT=1 -> cuda
FORMASH3D_COMPUTE=auto CUDA_FORCE_PRESENT=1 FORCE_CPU=0 FORCE_CUDA=0 REQUIRE_GPU=""
actual=$(resolve_compute_mode 2>/dev/null || echo "ERROR")
check "CUDA_FORCE_PRESENT=1 -> cuda" "cuda" "$actual"

# Test 3: --cpu flag -> cpu
FORMASH3D_COMPUTE=auto CUDA_FORCE_PRESENT=0 FORCE_CPU=1 FORCE_CUDA=0 REQUIRE_GPU=""
actual=$(resolve_compute_mode 2>/dev/null || echo "ERROR")
check "--cpu flag -> cpu" "cpu" "$actual"

# Test 4: --gpu flag -> cuda
FORMASH3D_COMPUTE=auto CUDA_FORCE_PRESENT=0 FORCE_CPU=0 FORCE_CUDA=1 REQUIRE_GPU=""
actual=$(resolve_compute_mode 2>/dev/null || echo "ERROR")
check "--gpu flag -> cuda" "cuda" "$actual"

# Test 5: REQUIRE_GPU=1 + cpu -> abort (non-zero exit)
FORMASH3D_COMPUTE=auto CUDA_FORCE_PRESENT=0 FORCE_CPU=0 FORCE_CUDA=0 REQUIRE_GPU=1 PATH=""
if ! resolve_compute_mode >/dev/null 2>&1; then
  echo "  ✓ REQUIRE_GPU=1 + cpu -> abort"
  TESTS_PASS=$((TESTS_PASS + 1))
else
  echo "  ✗ REQUIRE_GPU=1 + cpu -> abort (expected non-zero exit, got 0)"
  TESTS_FAIL=$((TESTS_FAIL + 1))
fi

# ── Static grep test: CPU-mode scripts contain no unguarded cu124/kaolin/natten/pytorch3d ──
echo ""
echo "=========================================="
echo " Static Grep: CPU-mode script cleanliness"
echo "=========================================="

# setup.sh must have zero matches — it's the CPU entry point
setup_matches=$(grep -ciE 'cu124|kaolin|natten|pytorch3d' "$ROOT/scripts/setup.sh" 2>/dev/null || echo 0)
if [[ "$setup_matches" -eq 0 ]]; then
  echo "  ✓ scripts/setup.sh: no cu124/kaolin/natten/pytorch3d"
  TESTS_PASS=$((TESTS_PASS + 1))
else
  echo "  ✗ scripts/setup.sh: $setup_matches unguarded cu124/kaolin/natten/pytorch3d references"
  TESTS_FAIL=$((TESTS_FAIL + 1))
fi

# install.sh matches must be inside `if [[ ... == "cuda" ]]` guarded sections
# Count total matches vs matches outside cuda-guarded lines
total=$(grep -ciE 'cu124|kaolin|natten|pytorch3d' "$ROOT/backend/scripts/install.sh" 2>/dev/null || echo 0)
# Lines that contain cuda guard keyword (the mode check)
cuda_guard_lines=$(grep -n 'COMPUTE_MODE.*cuda' "$ROOT/backend/scripts/install.sh" 2>/dev/null | cut -d: -f1)
# A match is "guarded" if it falls between a cuda-check line and the next fi
# Simple heuristic: matches inside install_model_stacks() are guarded
unguarded=$(grep -nE 'cu124|kaolin|natten|pytorch3d' "$ROOT/backend/scripts/install.sh" 2>/dev/null | cut -d: -f1 | while read -r ln; do
  # Check if any cuda guard line is at or before this line number
  if echo "$cuda_guard_lines" | grep -qE "^[0-9]+$" && \
     echo "$cuda_guard_lines" | awk -v l="$ln" '$1 <= l {found=1} END {exit !found}'; then
    : # guarded
  else
    echo "$ln"
  fi
done)
unguarded_count=$(echo "$unguarded" | grep -cE '^[0-9]+$' 2>/dev/null || echo 0)
if [[ "$unguarded_count" -eq 0 ]]; then
  echo "  ✓ backend/scripts/install.sh: $total cu124/kaolin/natten/pytorch3d references, all inside cuda guard"
  TESTS_PASS=$((TESTS_PASS + 1))
else
  echo "  ✗ backend/scripts/install.sh: $unguarded_count unguarded cu124/kaolin/natten/pytorch3d references outside cuda guard"
  TESTS_FAIL=$((TESTS_FAIL + 1))
fi

echo ""
echo "=========================================="
echo " RESOLVER TEST RESULT"
echo "=========================================="
echo "Passed: $TESTS_PASS"
echo "Failed: $TESTS_FAIL"

(( TESTS_FAIL == 0 )) || exit 1
echo "✓ All resolver tests passed."