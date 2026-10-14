#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

CYAN='\033[0;36m'; GREEN='\033[0;32m'; WHITE='\033[1;37m'; BOLD='\033[1m'; NC='\033[0m'

printf "${CYAN}${BOLD}\n  FORMASH 3D — RESTART\n${NC}"
printf "  Stopping current services...\n"
bash "$PROJECT_ROOT/scripts/stop.sh"
printf "\n  ${GREEN}✓${NC} Services stopped. Starting cleanly...\n\n"
bash "$PROJECT_ROOT/scripts/start.sh"
