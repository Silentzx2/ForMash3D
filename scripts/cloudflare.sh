#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# ForMash 3D — Cloudflare Tunnel Manager
# ═══════════════════════════════════════════════════════════════════════════

set -euo pipefail

# ── Colors ────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
WHITE='\033[1;37m'
GRAY='\033[0;90m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

# ── Helpers ───────────────────────────────────────────────────────────────
log()   { echo -e "${GREEN}[✓]${NC} $*"; }
info()  { echo -e "${CYAN}[→]${NC} $*"; }
warn()  { echo -e "${YELLOW}[⚠]${NC} $*"; }
err()   { echo -e "${RED}[✗]${NC} $*" >&2; }

# ── Banner ─────────────────────────────────────────────────────────────────
print_banner() {
    echo -e "${BLUE}"
    echo "  ╔════════════════════════════════════════════════════════════╗"
    echo "  ║                                                            ║"
    echo -e "  ║           ${WHITE}${BOLD}Cloudflare Tunnel Manager${BLUE}                       ║"
    echo -e "  ║        ${DIM}══════════════════════════════════${BLUE}                   ║"
    echo -e "  ║   ${GRAY}Secure external access for ForMash 3D${BLUE}                   ║"
    echo "  ║                                                            ║"
    echo "  ╚════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

# Directory to store tunnel PID/URL/log files
# ponytail: single flat dir is enough; no need for a DB or registry
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/.cloudflare_tunnels"
mkdir -p "$DIR"

install_cf() {
    if command -v cloudflared > /dev/null 2>&1; then
        log "cloudflared already installed"
        return
    fi

    info "Installing cloudflared..."

    # dpkg --print-architecture matches cloudflared release naming (amd64, arm64)
    local ARCH; ARCH=$(dpkg --print-architecture 2>/dev/null || echo "amd64")
    local DEB="/tmp/cloudflared-$$.deb"
    if ! wget -q "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${ARCH}.deb" -O "$DEB"; then
        err "Failed to download cloudflared (arch: $ARCH)"
        rm -f "$DEB"
        return 1
    fi
    sudo dpkg -i "$DEB"
    rm -f "$DEB"

    log "Installed"
}

create_tunnel() {

    read -rp "  Port: " PORT

    [[ ! "$PORT" =~ ^[0-9]+$ ]] && {
        err "Invalid Port"
        return
    }

    if [ -f "$DIR/$PORT.pid" ] && kill -0 "$(cat "$DIR/$PORT.pid")" 2>/dev/null; then
        warn "Tunnel already running."
        return
    fi

    info "Starting tunnel..."

    nohup cloudflared tunnel \
        --url "http://localhost:$PORT" \
        --no-autoupdate \
        >"$DIR/$PORT.log" 2>&1 &

    PID=$!
    echo "$PID" > "$DIR/$PORT.pid"

    sleep 5

    URL=$(grep -o 'https://[-a-zA-Z0-9]*\.trycloudflare\.com' "$DIR/$PORT.log" | head -1)

    if [ -n "$URL" ]; then
        echo "$URL" > "$DIR/$PORT.url"
        echo ""
        log "Tunnel Started"
        echo -e "  ${GRAY}Port :${NC} $PORT"
        echo -e "  ${GRAY}URL  :${NC} ${GREEN}$URL${NC}"
    else
        warn "Tunnel started but URL not ready."
    fi
}

list_tunnels() {

    echo ""
    echo -e "  ${BOLD}${GRAY}PORT     STATUS     URL${NC}"
    echo -e "  ${GRAY}────────────────────────────────────────────${NC}"

    shopt -s nullglob

    for f in "$DIR"/*.pid; do

        PORT=$(basename "$f" .pid)
        PID=$(cat "$f")

        if kill -0 "$PID" 2>/dev/null; then
            STATUS="${GREEN}Running${NC}"
        else
            STATUS="${RED}Stopped${NC}"
        fi

        URL="-"
        [ -f "$DIR/$PORT.url" ] && URL=$(cat "$DIR/$PORT.url")

        echo -e "  ${CYAN}${PORT}${NC}     ${STATUS}     ${GRAY}${URL}${NC}"
    done

    shopt -u nullglob
}

stop_tunnel() {

    read -rp "  Port: " PORT

    if [ ! -f "$DIR/$PORT.pid" ]; then
        warn "Tunnel not found."
        return
    fi

    PID=$(cat "$DIR/$PORT.pid")

    kill "$PID" 2>/dev/null || true

    rm -f "$DIR/$PORT.pid"

    log "Tunnel Stopped"
}

delete_tunnel() {

    read -rp "  Port: " PORT

    [ -f "$DIR/$PORT.pid" ] && kill "$(cat "$DIR/$PORT.pid")" 2>/dev/null || true

    rm -f \
        "$DIR/$PORT.pid" \
        "$DIR/$PORT.url" \
        "$DIR/$PORT.log"

    log "Tunnel Deleted"
}

_cf_menu_item() {
  local key="$1"
  local desc="$2"
  local box_width=56
  local key_part
  if [[ "$key" == *"["*"]"* ]]; then
    key_part=$(echo -e "${CYAN}${key}${NC}")
  else
    key_part=$(echo -e "${RED}${key}${NC}")
  fi
  local line="  ${key_part}  ${desc}"
  local visible_stripped
  visible_stripped=$(echo -e "$line" | sed 's/\x1b\[[0-9;]*m//g')
  local pad=$((box_width - ${#visible_stripped}))
  if ((pad < 1)); then pad=1; fi
  printf "  ║%s%*s║\n" "$line" "$pad" ""
}

while true; do

clear

print_banner

echo -e "${BOLD}${BLUE}  ╔════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${BLUE}  ║${NC}                  ${BOLD}${WHITE}Tunnel Menu${NC}                         ${BLUE}║${NC}"
echo -e "${BOLD}${BLUE}  ╠════════════════════════════════════════════════════════╣${NC}"
_cf_menu_item "[1]" "Install Cloudflared"
_cf_menu_item "[2]" "Create Tunnel"
_cf_menu_item "[3]" "List Tunnels"
_cf_menu_item "[4]" "Stop Tunnel"
_cf_menu_item "[5]" "Delete Tunnel"
echo -e "${BOLD}${BLUE}  ╠════════════════════════════════════════════════════════╣${NC}"
_cf_menu_item "[6]" "Exit"
echo -e "${BOLD}${BLUE}  ╚════════════════════════════════════════════════════════╝${NC}"
echo ""
read -rp "  Choose: " CH

case "$CH" in

1) install_cf ;;
2) create_tunnel ;;
3) list_tunnels ;;
4) stop_tunnel ;;
5) delete_tunnel ;;
6) echo ""; echo -e "${GREEN}  Goodbye! 👋${NC}"; echo ""; exit 0 ;;

*) echo -e "${RED}  Invalid Option${NC}" ;;

esac

echo
read -rp "  Press Enter..."

done
