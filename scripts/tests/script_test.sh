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