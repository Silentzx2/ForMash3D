#!/bin/bash

# Multi-Worker Deployment Script for 3D Generative Models Backend
# This script starts both the scheduler service and multiple FastAPI workers
#
# Usage:
#   ./scripts/run_multiworker.sh [OPTIONS]
#
# Options:
#   --user-auth-enabled     Enable user authentication (default: false)
#   --debug                 Enable debug mode (default: false)
#   --help                  Show this help message

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_ROOT="$(cd "$BACKEND_DIR/.." && pwd)"
cd "$BACKEND_DIR"

# Auto-copy .env from .env.example if missing and load it
if [[ ! -f "$PROJECT_ROOT/.env" && -f "$PROJECT_ROOT/.env.example" ]]; then
    cp "$PROJECT_ROOT/.env.example" "$PROJECT_ROOT/.env"
fi
if [[ -f "$PROJECT_ROOT/.env" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "$PROJECT_ROOT/.env"
    set +a
    # Unset empty or whitespace-only tokens so torch.hub and huggingface_hub don't fail with HTTP 401 Unauthorized
    [[ -z "${GITHUB_TOKEN:-}" || -z "${GITHUB_TOKEN// /}" ]] && unset GITHUB_TOKEN
    [[ -z "${GH_TOKEN:-}" || -z "${GH_TOKEN// /}" ]] && unset GH_TOKEN
    [[ -z "${HF_TOKEN:-}" || -z "${HF_TOKEN// /}" ]] && unset HF_TOKEN
    [[ -z "${HUGGINGFACE_TOKEN:-}" || -z "${HUGGINGFACE_TOKEN// /}" ]] && unset HUGGINGFACE_TOKEN
fi

# Parse command line arguments
USER_AUTH_ENABLED="false"
DEBUG_MODE="false"

while [[ $# -gt 0 ]]; do
    case $1 in
        --user-auth-enabled)
            USER_AUTH_ENABLED="true"
            shift
            ;;
        --debug)
            DEBUG_MODE="true"
            shift
            ;;
        --workers)
            CLI_WORKERS="$2"
            shift 2
            ;;
        --help)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --workers N             Number of API workers (VPS: 4, Colab: 1)"
            echo "  --user-auth-enabled     Enable user authentication (default: false)"
            echo "  --debug                 Enable debug mode (default: false)"
            echo "  --help                  Show this help message"
            echo ""
            echo "Environment Variables:"
            echo "  P3D_REDIS_URL          Redis connection URL (default: redis://localhost:6379)"
            echo "  P3D_HOST               API host address (default: 0.0.0.0)"
            echo "  P3D_PORT               API port (default: 7842)"
            echo "  P3D_WORKERS            Number of API workers (default: 4)"
            echo "  P3D_LOG_LEVEL          Logging level (default: info)"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

echo "🚀 Starting 3D Generative Models Backend (Multi-Worker Mode)..."
echo ""

# Check if configuration files exist
if [ ! -f "config/system.yaml" ]; then
    echo "❌ Configuration file config/system.yaml not found"
    echo "Please run ./scripts/setup.sh to create configuration files"
    exit 1
fi

if [ ! -f "config/models.yaml" ]; then
    echo "❌ Configuration file config/models.yaml not found"
    echo "Please run ./scripts/setup.sh to create configuration files"
    exit 1
fi

# Set environment variables
export PYTHONPATH="${PYTHONPATH}:$(pwd)"
export PYTHONUNBUFFERED="1"
export PYTORCH_CUDA_ALLOC_CONF="expandable_segments:True"

# Essential configuration parameters
export P3D_USER_AUTH_ENABLED="$USER_AUTH_ENABLED"
export P3D_DEBUG="$DEBUG_MODE"

# Configuration
REDIS_URL=${P3D_REDIS_URL:-"redis://localhost:6379"}
API_HOST=${P3D_HOST:-"0.0.0.0"}
API_PORT=${P3D_PORT:-7842}

# Worker configuration:
# On Colab (limited 12GB RAM), 1 worker prevents CUDA OOM.
# On VPS / Linux Server (16GB+ RAM), 4 workers handle concurrent API throughput cleanly.
is_colab() {
    [[ -n "${COLAB_GPU:-}" ]] || \
    [[ -n "${COLAB_RELEASE_TAG:-}" ]] || \
    [[ -n "${COLAB_BACKEND_VERSION:-}" ]] || \
    [[ -d "/content" && ! -d "/teamspace" ]] || \
    grep -q -i "colab" /etc/hosts 2>/dev/null || \
    (command -v hostname >/dev/null 2>&1 && hostname 2>/dev/null | grep -q -i "colab")
}

WORKERS_OVERRIDE="${CLI_WORKERS:-${P3D_WORKERS:-${API_WORKERS:-${WORKERS:-}}}}"
if [ -n "$WORKERS_OVERRIDE" ]; then
    API_WORKERS="$WORKERS_OVERRIDE"
elif is_colab; then
    API_WORKERS=1
else
    API_WORKERS=4
fi
export P3D_WORKERS="$API_WORKERS"

LOG_LEVEL=${P3D_LOG_LEVEL:-"info"}

echo "📋 Configuration:"
echo "   Redis URL: $REDIS_URL"
echo "   API Host: $API_HOST"
echo "   API Port: $API_PORT"
echo "   API Workers: $API_WORKERS"
echo "   Log Level: $LOG_LEVEL"
echo "   User Auth: $USER_AUTH_ENABLED"
echo "   Debug Mode: $DEBUG_MODE"
echo ""

# Check if Redis is running
echo "🔍 Checking Redis connection..."
if command -v redis-cli &> /dev/null; then
    if ! redis-cli -u "$REDIS_URL" ping > /dev/null 2>&1; then
        echo "❌ Cannot connect to Redis at $REDIS_URL"
        echo ""
        echo "Please start Redis first:"
        echo "   docker run -d -p 6379:6379 redis:latest"
        echo "   # or"
        echo "   redis-server --daemonize yes"
        exit 1
    fi
    echo "✅ Redis is running"
else
    echo "⚠️  redis-cli not found, skipping Redis check"
fi
echo ""

# Create PID and log directories for tracking processes
PID_DIR="./run"
LOG_DIR="./logs"
mkdir -p "$PID_DIR" "$LOG_DIR"

SCHEDULER_PID_FILE="$PID_DIR/scheduler.pid"
API_PID_FILE="$PID_DIR/api.pid"

# Locate Python 3.10 binary
PYTHON_BIN=""

# 1. Direct explicit override via .env or environment
if [ -n "${PYTHON_EXEC:-}" ] && [ -x "$PYTHON_EXEC" ]; then
    PYTHON_BIN="$PYTHON_EXEC"
fi

ENV_PREF="${FORMASH3D_ENV_MANAGER:-${AI_STUDIO_ENV_MANAGER:-${ENV_MANAGER:-conda}}}"

# 2. Conda lookup (checked first when manager preference is conda or unset)
if [ -z "$PYTHON_BIN" ] && [ "$ENV_PREF" != "venv" ]; then
    CONDA_ROOT=""
    for cand in \
        "$(command -v conda >/dev/null 2>&1 && conda info --base 2>/dev/null || true)" \
        "${CONDA_HOME:-}" \
        "${CONDA_PREFIX:-}" \
        "$HOME/miniconda3" \
        "/opt/conda" \
        "$HOME/anaconda3" \
        "/root/miniconda3" \
        "/content/miniconda3" \
        "$HOME/miniconda" \
        "/usr/local/miniconda3" \
        "/usr/local/anaconda3"; do
        if [ -n "$cand" ] && [ -d "$cand" ]; then
            if [ -f "$cand/etc/profile.d/conda.sh" ] || [ -x "$cand/bin/conda" ]; then
                CONDA_ROOT="$cand"
                break
            fi
        fi
    done

    if [ -n "$CONDA_ROOT" ]; then
        [ -f "$CONDA_ROOT/etc/profile.d/conda.sh" ] && source "$CONDA_ROOT/etc/profile.d/conda.sh" 2>/dev/null || true
        export PATH="$CONDA_ROOT/bin:$PATH"
    fi

    # Check known candidate paths for conda env 3daigc-api
    for py_candidate in \
        "${CONDA_PREFIX:-}/bin/python" \
        "${CONDA_ROOT:-}/envs/3daigc-api/bin/python"; do
        if [ -n "$py_candidate" ] && [ -x "$py_candidate" ]; then
            PYTHON_BIN="$py_candidate"
            break
        fi
    done

    # If still not located directly, query conda env list
    if [ -z "$PYTHON_BIN" ] && command -v conda >/dev/null 2>&1; then
        eval "$(conda shell.bash hook 2>/dev/null || true)"
        env_dir="$(conda info --envs 2>/dev/null | awk '$1 == "3daigc-api" {print $NF}')"
        if [ -n "$env_dir" ] && [ -x "$env_dir/bin/python" ]; then
            PYTHON_BIN="$env_dir/bin/python"
        fi
    fi
fi

# 3. Virtualenv lookup (checked if conda was not found, or if venv was preferred)
if [ -z "$PYTHON_BIN" ]; then
    for venv_py in \
        "$PROJECT_ROOT/3daigc-api/bin/python" \
        "$PROJECT_ROOT/.venv/bin/python" \
        "$PROJECT_ROOT/backend/.venv/bin/python" \
        "${VIRTUAL_ENV:-}/bin/python"; do
        if [ -n "$venv_py" ] && [ -x "$venv_py" ]; then
            PYTHON_BIN="$venv_py"
            break
        fi
    done
fi

# 4. Fallback check: system Python 3.10 with installed backend packages
if [ -z "$PYTHON_BIN" ]; then
    for sys_py in $(command -v python3.10 2>/dev/null || true) $(command -v python3 2>/dev/null || true); do
        if [ -x "$sys_py" ]; then
            if "$sys_py" -c "import sys; assert sys.version_info[:2] == (3, 10); import fastapi, yaml" >/dev/null 2>&1; then
                PYTHON_BIN="$sys_py"
                break
            fi
        fi
    done
fi

# If no environment was found, do NOT create a blind .venv that fills disk space
if [ -z "$PYTHON_BIN" ]; then
    echo "❌ Python 3.10 environment '3daigc-api' not found."
    echo "   Neither Conda environment '3daigc-api' nor virtualenv in '$PROJECT_ROOT/3daigc-api' / '$PROJECT_ROOT/.venv' exists."
    echo "💡 Please run the setup script first to configure the environment:"
    echo "   ./manager.sh (option 1: Run Full Setup)"
    echo "   # or: bash scripts/setup.sh"
    echo "   # or: cd backend && bash scripts/install.sh"
    exit 1
fi

# Activate environment paths for current process and spawned child workers
ENV_DIR="$(dirname "$(dirname "$PYTHON_BIN")")"
export PATH="$ENV_DIR/bin:$PATH"
if [ -d "$ENV_DIR/conda-meta" ]; then
    export CONDA_PREFIX="$ENV_DIR"
    if command -v conda >/dev/null 2>&1; then
        eval "$(conda shell.bash hook 2>/dev/null || true)"
        conda activate 3daigc-api 2>/dev/null || true
    fi
else
    export VIRTUAL_ENV="$ENV_DIR"
fi

echo "🐍 Using Python runtime: $PYTHON_BIN"

# Verify Python version strictly conforms to Python 3.10
PY_VER="$("$PYTHON_BIN" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>/dev/null || echo "unknown")"
if [ "$PY_VER" != "3.10" ]; then
    echo "⚠️  Warning: Python version is $PY_VER (expected 3.10). 3D AI dependencies require Python 3.10."
fi

# Verify core dependencies are present
if ! "$PYTHON_BIN" -c "import fastapi, uvicorn, yaml, pydantic_settings" >/dev/null 2>&1; then
    echo "❌ Core backend dependencies (fastapi, uvicorn, pyyaml, pydantic-settings) missing in $PYTHON_BIN."
    echo "💡 Please run installation: cd backend && bash scripts/install.sh"
    exit 1
fi



# Function to cleanup processes on exit
cleanup() {
    echo ""
    echo "🛑 Shutting down services..."
    
    # Stop API workers
    if [ -f "$API_PID_FILE" ]; then
        API_PID=$(cat "$API_PID_FILE")
        if ps -p "$API_PID" > /dev/null 2>&1; then
            echo "   Stopping API workers (PID: $API_PID)..."
            kill "$API_PID" 2>/dev/null || true
            sleep 2
            if ps -p "$API_PID" > /dev/null 2>&1; then
                kill -9 "$API_PID" 2>/dev/null || true
            fi
        fi
        rm -f "$API_PID_FILE"
    fi
    
    # Stop scheduler service
    if [ -f "$SCHEDULER_PID_FILE" ]; then
        SCHEDULER_PID=$(cat "$SCHEDULER_PID_FILE")
        if ps -p "$SCHEDULER_PID" > /dev/null 2>&1; then
            echo "   Stopping scheduler service (PID: $SCHEDULER_PID)..."
            kill "$SCHEDULER_PID" 2>/dev/null || true
            sleep 2
            if ps -p "$SCHEDULER_PID" > /dev/null 2>&1; then
                kill -9 "$SCHEDULER_PID" 2>/dev/null || true
            fi
        fi
        rm -f "$SCHEDULER_PID_FILE"
    fi
    
    echo "✅ Services stopped"
    exit 0
}

# Set up signal handlers: in background daemon mode (started by start.sh / manager.sh),
# ignore SIGINT so terminal interrupts or Ctrl+C in manager do not shut down backend.
if [ ! -t 0 ]; then
    trap cleanup SIGTERM
    trap '' SIGINT
else
    trap cleanup SIGINT SIGTERM
fi

# Start scheduler service
echo "🔧 Starting scheduler service ($PYTHON_BIN)..."
"$PYTHON_BIN" scripts/scheduler_service.py --redis-url "$REDIS_URL" --log-level "$LOG_LEVEL" > logs/scheduler.log 2>&1 &
SCHEDULER_PID=$!
echo $SCHEDULER_PID > "$SCHEDULER_PID_FILE"
echo "   Scheduler service started (PID: $SCHEDULER_PID)"
echo "   Logs: logs/scheduler.log"

# Wait for scheduler to initialize
echo "   Waiting for scheduler to initialize..."
sleep 4

# Check if scheduler is still running
if ! ps -p "$SCHEDULER_PID" > /dev/null 2>&1; then
    echo "❌ Scheduler service failed to start"
    echo "━━━━━━━━━━━━ Scheduler Log ━━━━━━━━━━━━"
    tail -n 30 logs/scheduler.log 2>/dev/null || true
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    cleanup
    exit 1
fi
echo "✅ Scheduler service ready"
echo ""

# Start FastAPI with multiple workers
echo "🌐 Starting FastAPI with $API_WORKERS workers ($PYTHON_BIN -m uvicorn)..."
"$PYTHON_BIN" -m uvicorn api.main_multiworker:app \
    --host "$API_HOST" \
    --port "$API_PORT" \
    --workers "$API_WORKERS" \
    --timeout-keep-alive 65 \
    --log-level "$LOG_LEVEL" \
    > logs/api.log 2>&1 &
API_PID=$!
echo $API_PID > "$API_PID_FILE"
echo "   API workers started (PID: $API_PID)"
echo "   Logs: logs/api.log"
echo ""

# Wait for API to initialize
echo "   Waiting for API to initialize..."
sleep 3

# Check if API is still running
if ! ps -p "$API_PID" > /dev/null 2>&1; then
    echo "❌ API workers failed to start"
    echo "━━━━━━━━━━━━ API Log ━━━━━━━━━━━━"
    tail -n 30 logs/api.log 2>/dev/null || true
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    cleanup
    exit 1
fi

echo "✅ API workers ready"
echo ""

echo "═══════════════════════════════════════════════════════════════"
echo "✅ Multi-Worker Deployment Started Successfully!"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "📊 Service Status:"
echo "   Scheduler Service: Running (PID: $SCHEDULER_PID)"
echo "   API Workers:       Running (PID: $API_PID, $API_WORKERS workers)"
echo ""
echo "🔗 Endpoints:"
echo "   API:     http://$API_HOST:$API_PORT"
echo "   Docs:    http://$API_HOST:$API_PORT/docs"
echo "   Health:  http://$API_HOST:$API_PORT/health"
echo ""
echo "📝 Logs:"
echo "   Scheduler: tail -f logs/scheduler.log"
echo "   API:       tail -f logs/api.log"
echo ""
echo "🛑 To stop services: Press Ctrl+C or run: kill $API_PID $SCHEDULER_PID"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Monitor processes and keep script running
echo "📊 Monitoring services... (Press Ctrl+C to stop)"
echo ""

while true; do
    # Check if scheduler is still running
    if ! ps -p "$SCHEDULER_PID" > /dev/null 2>&1; then
        echo "❌ Scheduler service has stopped unexpectedly!"
        echo "━━━━━━━━━━━━ Scheduler Log Tail ━━━━━━━━━━━━"
        tail -n 40 logs/scheduler.log 2>/dev/null || true
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        cleanup
        exit 1
    fi
    
    # Check if API is still running
    if ! ps -p "$API_PID" > /dev/null 2>&1; then
        echo "❌ API workers have stopped unexpectedly!"
        echo "━━━━━━━━━━━━ API Log Tail ━━━━━━━━━━━━"
        tail -n 40 logs/api.log 2>/dev/null || true
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        cleanup
        exit 1
    fi
    
    # Sleep and check again
    sleep 5
done

