#!/bin/bash

# 3DAIGC Model Download Script
# Usage: ./download_models.sh [OPTIONS]
# 
# Available models:
#   hunyuan2mini, hunyuan21, trellis, trellis-text, trellis2,
#   unirig, partuv, fastmesh, triposg, ardy, unique3d, paint3d, pixal3d, taoflowforge, misc, all
#
# Options:
#   -h, --help              Show this help message
#   -m, --models MODEL      Comma-separated list of models to download (default: all)
#   -v, --verify            Verify existing models without downloading
#   -f, --force             Force re-download even if files exist
#   --list                  List all available models

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_ROOT="$(cd "$BACKEND_DIR/.." && pwd)"
PRETRAINED_DIR="$SCRIPT_DIR/../pretrained"

# Add 3daigc-api virtual environment to PATH if present
if [[ -d "$PROJECT_ROOT/3daigc-api/bin" ]]; then
    export PATH="$PROJECT_ROOT/3daigc-api/bin:$PATH"
fi

# Load .env if present
if [[ -f "$PROJECT_ROOT/.env" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "$PROJECT_ROOT/.env"
    set +a
elif [[ -f "$BACKEND_DIR/.env" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "$BACKEND_DIR/.env"
    set +a
fi

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Print colored output
print_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
print_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
print_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
print_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Check for Hugging Face Token in environment
HF_TOKEN="${HUGGINGFACE_TOKEN:-${HF_TOKEN:-}}"
# Strip quotes and whitespace to avoid 401 on empty/quoted tokens
HF_TOKEN="$(echo "$HF_TOKEN" | tr -d '\"'\'' ')"
HF_EXTRA_ARGS=()

if [ -n "$HF_TOKEN" ]; then
    print_info "🔑 Hugging Face token detected in environment. Using authenticated downloads."
    HF_EXTRA_ARGS=(--token "$HF_TOKEN")
    export HF_TOKEN="$HF_TOKEN"
    export HUGGINGFACE_TOKEN="$HF_TOKEN"
else
    unset HF_TOKEN HUGGINGFACE_TOKEN
    print_info "ℹ️ No Hugging Face token found in .env. Proceeding with anonymous/public downloads."
fi

# Helper for running hf download with token if available
hf_download() {
    # Prevent hf-transfer Rust extension segfaults on I/O interruptions
    export HF_HUB_ENABLE_HF_TRANSFER=0

    # 1. Primary: Use modern 'hf' CLI
    if command -v hf >/dev/null 2>&1; then
        if hf download "${HF_EXTRA_ARGS[@]}" "$@"; then
            return 0
        fi
        print_warning "'hf download' encountered an issue, trying fallback..."
    fi

    # 2. Secondary: Fallback to Python module CLI
    local py_bin="${PYTHON_EXEC:-$(command -v python3 || command -v python)}"
    if [ -n "$py_bin" ]; then
        if "$py_bin" -m huggingface_hub.cli.download "${HF_EXTRA_ARGS[@]}" "$@" 2>/dev/null; then
            return 0
        fi
    fi

    # 3. Tertiary: Fallback to legacy huggingface-cli
    if command -v huggingface-cli >/dev/null 2>&1; then
        if huggingface-cli download "${HF_EXTRA_ARGS[@]}" "$@"; then
            return 0
        fi
    fi

    return 1
}

# Default values
MODELS_TO_DOWNLOAD="all"
VERIFY_ONLY=false
FORCE_DOWNLOAD=false

# Available models
AVAILABLE_MODELS=("hunyuan2mini" "hunyuan21" "hunyuan3d_shape_v21" "hunyuan3d_paint_v21" "hunyuan3d_dit_v2_mini_turbo" "trellis" "trellis-text" "trellis2" "unirig" "partuv" "fastmesh" "triposg" "ardy" "unique3d" "paint3d" "pixal3d" "taoflowforge" "hi3d" "misc" "all")

show_help() {
    cat << EOF
3DAIGC Model Download Script

Usage: $0 [OPTIONS]

Options:
    -h, --help              Show this help message
    -m, --models MODELS     Comma-separated list of models to download (default: all)
    -v, --verify            Verify existing models without downloading
    -f, --force             Force re-download even if files exist
    --list                  List all available models

Available models:
    hunyuan2mini       - Hunyuan3D 2.0 mini models
    hunyuan21          - Hunyuan3D 2.1 models
    hunyuan3d_shape_v21 - Hunyuan3D-Shape-v2-1 (3.3B shape)
    hunyuan3d_paint_v21 - Hunyuan3D-Paint-v2-1 (2B PBR texture)
    hunyuan3d_dit_v2_mini_turbo - Hunyuan3D-DiT-v2-mini-Turbo (0.6B low-VRAM)
    trellis            - TRELLIS image-large model
    trellis-text       - TRELLIS text-xlarge model (optional)
    trellis2           - TRELLIS.2-4B model (image-based only)
    unirig             - UniRig model for auto-rigging
    partuv             - PartUV model
    fastmesh           - FastMesh model
    triposg            - TripoSG and RMBG models
    ardy               - ARDY motion generation models
    unique3d           - Unique3D high-fidelity single-image to 3D model
    paint3d            - Paint3D 1K/2K UV texture diffusion model
    pixal3d            - Pixal3D pixel-aligned image to 3D generation model
    taoflowforge       - TaoFlowForge progressive native mesh generation model (Alibaba)
    hi3d               - Hi3D v1.0 high-resolution refinement model (Experimental)
    misc               - Miscellaneous utility models (RealESRGAN, DINOv2)
    all                - All core models (excluding optional normal ControlNet)

Examples:
    $0                                    # Download all models
    $0 -m trellis                         # Download only TRELLIS
    $0 -v                                # Verify all existing models
    $0 --list                           # List available models

EOF
}

list_models() {
    echo "Available models:"
    for model in "${AVAILABLE_MODELS[@]}"; do
        if [ "$model" != "all" ]; then
            echo "  - $model"
        fi
    done
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            show_help
            exit 0
            ;;
        -m|--models)
            MODELS_TO_DOWNLOAD="$2"
            shift 2
            ;;
        -v|--verify)
            VERIFY_ONLY=true
            shift
            ;;
        -f|--force)
            FORCE_DOWNLOAD=true
            shift
            ;;
        --list)
            list_models
            exit 0
            ;;
        *)
            print_error "Unknown option: $1"
            show_help
            exit 1
            ;;
    esac
done

# Function to check if file exists and get its size
verify_file() {
    local file_path="$1"
    local min_size="${2:-1000}"  # Minimum size in bytes (default 1KB)
    
    if [ -f "$file_path" ]; then
        local file_size=$(stat -c%s "$file_path" 2>/dev/null || stat -f%z "$file_path" 2>/dev/null || echo "0")
        if [ "$file_size" -gt "$min_size" ]; then
            print_success "✓ $file_path ($(numfmt --to=iec-i --suffix=B $file_size))"
            return 0
        else
            print_warning "✗ $file_path exists but is too small ($(numfmt --to=iec-i --suffix=B $file_size))"
            return 1
        fi
    else
        print_warning "✗ $file_path not found"
        return 1
    fi
}

# Function to verify directory exists and has content
verify_directory() {
    local dir_path="$1"
    local min_files="${2:-1}"
    
    if [ -d "$dir_path" ]; then
        local file_count=$(find "$dir_path" -type f | wc -l)
        if [ "$file_count" -ge "$min_files" ]; then
            print_success "✓ $dir_path ($file_count files)"
            return 0
        else
            print_warning "✗ $dir_path exists but has insufficient files ($file_count files, need $min_files)"
            return 1
        fi
    else
        print_warning "✗ $dir_path not found"
        return 1
    fi
}

# Function to ensure a model target directory is writable, converting read-only symlinks if needed
ensure_writable_model_dir() {
    local target_dir="$1"

    # Try chmod first in case it's a simple permission issue
    chmod -R u+w "$target_dir" 2>/dev/null || true

    mkdir -p "$target_dir" 2>/dev/null || true
    local test_file="$target_dir/.writable_test_$$"
    if touch "$test_file" 2>/dev/null; then
        rm -f "$test_file" 2>/dev/null
        return 0
    fi

    print_warning "Directory '$target_dir' is read-only (e.g. Kaggle /kaggle/input or read-only mount)."

    # Case 1: target_dir is a symlink pointing to a read-only directory
    if [ -L "$target_dir" ]; then
        local ro_target
        ro_target="$(readlink -f "$target_dir" 2>/dev/null || echo "")"
        local parent_dir
        parent_dir="$(dirname "$target_dir")"
        if [ -w "$parent_dir" ]; then
            print_info "Replacing read-only symlink with writable local directory: $target_dir"
            rm -f "$target_dir"
            mkdir -p "$target_dir"
            if [ -n "$ro_target" ] && [ -d "$ro_target" ]; then
                print_info "Copying existing files from read-only target into writable directory..."
                cp -rn "$ro_target"/* "$target_dir/" 2>/dev/null || true
            fi
            return 0
        fi
    fi

    # Case 2: Parent directory (e.g. PRETRAINED_DIR) is a symlink to a read-only directory
    local parent_dir
    parent_dir="$(dirname "$target_dir")"
    if [ -L "$parent_dir" ]; then
        local ro_parent
        ro_parent="$(readlink -f "$parent_dir" 2>/dev/null || echo "")"
        local grand_parent
        grand_parent="$(dirname "$parent_dir")"
        if [ -w "$grand_parent" ]; then
            print_info "Parent directory '$parent_dir' is a symlink to read-only '$ro_parent'."
            print_info "Converting parent into a writable directory with per-model symlinks..."
            rm -f "$parent_dir"
            mkdir -p "$parent_dir"
            if [ -n "$ro_parent" ] && [ -d "$ro_parent" ]; then
                for item in "$ro_parent"/*; do
                    [ -e "$item" ] || continue
                    local base
                    base="$(basename "$item")"
                    if [ "$parent_dir/$base" != "$target_dir" ]; then
                        ln -s "$item" "$parent_dir/$base" 2>/dev/null || true
                    fi
                done
            fi
            mkdir -p "$target_dir"
            if [ -d "$ro_parent/$(basename "$target_dir")" ]; then
                print_info "Copying existing files for $(basename "$target_dir") into writable directory..."
                cp -rn "$ro_parent/$(basename "$target_dir")"/* "$target_dir/" 2>/dev/null || true
            fi
            return 0
        fi
    fi

    print_error "Cannot make '$target_dir' writable. Please check filesystem permissions."
    return 1
}

# Function to download with verification
download_with_verify() {
    local url="$1"
    local output_path="$2"
    local description="$3"
    
    print_info "Downloading $description..."
    print_info "URL: $url"
    print_info "Output: $output_path"
    
    # Create directory if it doesn't exist
    mkdir -p "$(dirname "$output_path")"
    
    # Download the file (with HF auth header if token exists and URL is huggingface)
    local wget_args=("-O" "$output_path")
    if [ -n "$HF_TOKEN" ] && [[ "$url" =~ huggingface.co ]]; then
        wget_args+=("--header=Authorization: Bearer $HF_TOKEN")
    fi

    if wget "${wget_args[@]}" "$url"; then
        # Verify the download
        if verify_file "$output_path"; then
            print_success "Successfully downloaded $description"
        else
            print_error "Downloaded file verification failed for $description"
            return 1
        fi
    else
        print_error "Failed to download $description"
        return 1
    fi
}

# Function to download Hunyuan3D 2.0 mini models
download_hunyuan2mini() {
    print_info "========================================"
    print_info "Downloading Hunyuan3D 2.0 Mini Models"
    print_info "========================================"
    
    local model_dir="$PRETRAINED_DIR/tencent/Hunyuan3D-2mini"
    
    if [ "$FORCE_DOWNLOAD" = false ] && verify_directory "$model_dir" 5; then
        print_info "Hunyuan3D 2.0 mini models already exist and verified"
        return 0
    fi
    
    mkdir -p "$model_dir" 2>/dev/null || true
    ensure_writable_model_dir "$model_dir" || return 1
    print_info "Downloading Hunyuan3D 2.0 mini (geometry)..."
    if hf_download  tencent/Hunyuan3D-2mini \
        --include "hunyuan3d-dit-v2-mini-turbo/*" \
        --local-dir "$model_dir"; then
        print_success "Hunyuan3D 2.0 mini models downloaded successfully"
    else
        print_error "Failed to download Hunyuan3D 2.0 mini models"
        return 1
    fi
}

# Function to download Hunyuan3D 2.1 models
download_hunyuan21() {
    print_info "========================================"
    print_info "Downloading Hunyuan3D 2.1 Models"
    print_info "========================================"
    
    local model_dir="$PRETRAINED_DIR/tencent/Hunyuan3D-2.1"
    
    if [ "$FORCE_DOWNLOAD" = false ] &&        verify_directory "$model_dir/hunyuan3d-dit-v2-1" 3 &&        verify_directory "$model_dir/hunyuan3d-vae-v2-1" 3 &&        verify_directory "$model_dir/hunyuan3d-paintpbr-v2-1" 3; then
        print_info "Hunyuan3D 2.1 shared checkpoint is complete and verified"
        return 0
    fi
    
    mkdir -p "$model_dir" 2>/dev/null || true
    ensure_writable_model_dir "$model_dir" || return 1
    print_info "Downloading Hunyuan3D 2.1 models..."
    if hf_download tencent/Hunyuan3D-2.1 --local-dir "$model_dir"; then
        print_success "Hunyuan3D 2.1 models downloaded successfully"
    else
        print_error "Failed to download Hunyuan3D 2.1 models"
        return 1
    fi
}

# Function to download Hunyuan3D-Shape-v2-1 models
download_hunyuan3d_shape_v21() {
    print_info "========================================"
    print_info "Downloading Hunyuan3D-Shape-v2-1 Models"
    print_info "========================================"

    # Shape-v2-1 shares the full Hunyuan3D-2.1 pipeline root with Paint.
    download_hunyuan21
}

# Function to download Hunyuan3D-Paint-v2-1 models
download_hunyuan3d_paint_v21() {
    print_info "========================================"
    print_info "Downloading Hunyuan3D-Paint-v2-1 Models"
    print_info "========================================"

    # Paint uses the same Hunyuan3D-2.1 root checkpoint as Shape.
    download_hunyuan21

    local realesrgan_path="$PRETRAINED_DIR/misc/RealESRGAN_x4plus.pth"
    local thirdparty_realesrgan_path="$PROJECT_ROOT/backend/thirdparty/hunyuan3d-paint-v2-1/hy3dpaint/ckpt/RealESRGAN_x4plus.pth"

    if [ "$FORCE_DOWNLOAD" = false ] && verify_file "$realesrgan_path" 50000000; then
        print_info "RealESRGAN_x4plus already exists and verified"
    else
        print_info "Downloading RealESRGAN_x4plus.pth..."
        mkdir -p "$PRETRAINED_DIR/misc"
        download_with_verify             "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth"             "$realesrgan_path"             "RealESRGAN_x4plus model"
    fi

    mkdir -p "$(dirname "$thirdparty_realesrgan_path")"
    if [ ! -f "$thirdparty_realesrgan_path" ] || [ "$FORCE_DOWNLOAD" = true ]; then
        cp "$realesrgan_path" "$thirdparty_realesrgan_path"
    fi
    print_success "Hunyuan3D-Paint-v2-1 models and RealESRGAN dependency are ready"
}

# Function to download Hunyuan3D-DiT-v2-mini-Turbo models
download_hunyuan3d_dit_v2_mini_turbo() {
    print_info "========================================"
    print_info "Downloading Hunyuan3D-DiT-v2-mini-Turbo Models"
    print_info "========================================"

    # The mini-turbo pipeline root is the DiT checkpoint; the bundled
    # checkpoint already contains the VAE weights, so only the DiT
    # subfolder needs to be downloaded.
    download_hunyuan2mini
}

# Function to download TRELLIS models
download_trellis() {
    print_info "========================================"
    print_info "Downloading TRELLIS Image-Large Model"
    print_info "========================================"
    
    local model_dir="$PRETRAINED_DIR/TRELLIS/TRELLIS-image-large"
    
    if [ "$FORCE_DOWNLOAD" = false ] && verify_directory "$model_dir" 5; then
        print_info "TRELLIS image-large model already exists and verified"
        return 0
    fi
    
    mkdir -p "$model_dir" 2>/dev/null || true
    ensure_writable_model_dir "$model_dir" || return 1
    print_info "Downloading TRELLIS image-large model..."
    if hf_download  microsoft/TRELLIS-image-large --local-dir "$model_dir"; then
        print_success "TRELLIS image-large model downloaded successfully"
    else
        print_error "Failed to download TRELLIS image-large model"
        return 1
    fi
}

# Function to download TRELLIS text model (optional)
download_trellis_text() {
    print_info "========================================"
    print_info "Downloading TRELLIS Text-XLarge Model"
    print_info "========================================"
    
    local model_dir="$PRETRAINED_DIR/TRELLIS/TRELLIS-text-xlarge"
    
    if [ "$FORCE_DOWNLOAD" = false ] && verify_directory "$model_dir" 5; then
        print_info "TRELLIS text-xlarge model already exists and verified"
        return 0
    fi
    
    mkdir -p "$model_dir" 2>/dev/null || true
    ensure_writable_model_dir "$model_dir" || return 1
    print_info "Downloading TRELLIS text-xlarge model (optional, for text-conditioned part re-texturing)..."
    if hf_download  microsoft/TRELLIS-text-xlarge --local-dir "$model_dir"; then
        print_success "TRELLIS text-xlarge model downloaded successfully"
    else
        print_error "Failed to download TRELLIS text-xlarge model"
        return 1
    fi
}

# Function to download TRELLIS.2 model
download_trellis2() {
    print_info "========================================"
    print_info "Downloading TRELLIS.2-4B Model"
    print_info "========================================"
    
    local model_dir="$PRETRAINED_DIR/TRELLIS.2/TRELLIS.2-4B"
    
    if [ "$FORCE_DOWNLOAD" = false ] && verify_directory "$model_dir" 5; then
        print_info "TRELLIS.2-4B model already exists and verified"
        return 0
    fi
    
    mkdir -p "$model_dir" 2>/dev/null || true
    ensure_writable_model_dir "$model_dir" || return 1
    print_info "Downloading TRELLIS.2-4B model (image-based generation only)..."
    if hf_download  microsoft/TRELLIS.2-4B --local-dir "$model_dir"; then
        print_success "TRELLIS.2-4B model downloaded successfully"
        print_info "Ensuring TRELLIS.2 image conditioning (DinoV3) model is cached..."
        hf_download camenduru/dinov3-vitl16-pretrain-lvd1689m || true
        print_info "Ensuring TRELLIS.2 background removal (BiRefNet) model is cached..."
        hf_download ZhengPeng7/BiRefNet || true
    else
        print_error "Failed to download TRELLIS.2-4B model"
        return 1
    fi
}

# Function to download UniRig model
download_unirig() {
    print_info "========================================"
    print_info "Downloading UniRig Model"
    print_info "========================================"
    
    local model_dir="$PRETRAINED_DIR/UniRig"
    
    if [ "$FORCE_DOWNLOAD" = false ] && verify_directory "$model_dir" 3; then
        print_info "UniRig model already exists and verified"
        return 0
    fi
    
    mkdir -p "$model_dir" 2>/dev/null || true
    ensure_writable_model_dir "$model_dir" || return 1
    print_info "Downloading UniRig model..."
    if hf_download  VAST-AI/UniRig --local-dir "$model_dir"; then
        print_success "UniRig model downloaded successfully"
    else
        print_error "Failed to download UniRig model"
        return 1
    fi
}

# Verify the actual FastMesh variant and full checkpoint, not directory entry count.
# Both public V1K/V4K safetensors files are larger than 4 GB; truncated weights are not ready.
verify_fastmesh_model() {
    local model_dir="$1"
    if ! verify_file "$model_dir/config.json" 100; then
        return 1
    fi
    if ! verify_file "$model_dir/model.safetensors" 4000000000; then
        return 1
    fi
    return 0
}

# Function to download FastMesh model
download_fastmesh() {
    print_info "========================================"
    print_info "Downloading FastMesh Models"
    print_info "========================================"

    local model_dir_v1k="$PRETRAINED_DIR/FastMesh-V1K"
    local model_dir_v4k="$PRETRAINED_DIR/FastMesh-V4K"

    if [ "$FORCE_DOWNLOAD" = false ] && verify_fastmesh_model "$model_dir_v1k"; then
        print_info "FastMesh v1k model already exists and verified"
    else
        mkdir -p "$model_dir_v1k"
        print_info "Downloading FastMesh v1k model..."
        if hf_download "WopperSet/FastMesh-V1K" --local-dir "$model_dir_v1k"; then
            if ! verify_fastmesh_model "$model_dir_v1k"; then
                print_error "FastMesh V1K download did not contain a complete checkpoint"
                return 1
            fi
            print_success "FastMesh v1k model downloaded successfully"
        else
            print_error "Failed to download FastMesh v1k model"
            return 1
        fi
    fi

    if [ "$FORCE_DOWNLOAD" = false ] && verify_fastmesh_model "$model_dir_v4k"; then
        print_info "FastMesh v4k model already exists and verified"
    else
        mkdir -p "$model_dir_v4k"
        print_info "Downloading FastMesh v4k model..."
        if hf_download "WopperSet/FastMesh-V4K" --local-dir "$model_dir_v4k"; then
            if ! verify_fastmesh_model "$model_dir_v4k"; then
                print_error "FastMesh V4K download did not contain a complete checkpoint"
                return 1
            fi
            print_success "FastMesh v4k model downloaded successfully"
        else
            print_error "Failed to download FastMesh v4k model"
            return 1
        fi
    fi
}

# Function to download PartUV models 
download_partuv() {
    print_info "========================================"
    print_info "Downloading PartUV Model"
    print_info "========================================"

    local partuv_checkpoint_path="$PRETRAINED_DIR/PartUV/model_objaverse.ckpt"
    if [ "$FORCE_DOWNLOAD" = false ] && verify_file "$partuv_checkpoint_path" 50000000; then
        print_info "PartUV checkpoint already exists and verified"
        return 0
    else
        mkdir -p $PRETRAINED_DIR/PartUV
        download_with_verify \
            "https://huggingface.co/mikaelaangel/partfield-ckpt/resolve/main/model_objaverse.ckpt" \
            "$partuv_checkpoint_path" \
            "PartUV checkpoint"
        print_success "PartUV checkpoint downloaded successfully"
    fi
}

# Function to download TripoSG and RMBG models
download_triposg() {
    print_info "========================================"
    print_info "Downloading TripoSG and RMBG Models"
    print_info "========================================"

    local triposg_dir="$PRETRAINED_DIR/TripoSG"
    local rmbg_dir="$PRETRAINED_DIR/RMBG-1.4"
    local scribble_dir="$PRETRAINED_DIR/TripoSG-scribble"

    mkdir -p "$rmbg_dir"
    if [ "$FORCE_DOWNLOAD" = false ] && verify_directory "$rmbg_dir" 2; then
        print_info "RMBG-1.4 already exists and verified"
    else
        print_info "Downloading RMBG-1.4..."
        if ! hf_download briaai/RMBG-1.4 --local-dir "$rmbg_dir" || ! verify_directory "$rmbg_dir" 2; then
            print_error "Failed to download RMBG-1.4"
            return 1
        fi
    fi

    mkdir -p "$triposg_dir"
    if [ "$FORCE_DOWNLOAD" = false ] && verify_directory "$triposg_dir" 3; then
        print_info "TripoSG already exists and verified"
    else
        print_info "Downloading TripoSG..."
        if ! hf_download VAST-AI/TripoSG --local-dir "$triposg_dir" || ! verify_directory "$triposg_dir" 3; then
            print_error "Failed to download TripoSG"
            return 1
        fi
    fi

    mkdir -p "$scribble_dir"
    if [ "$FORCE_DOWNLOAD" = false ] && verify_directory "$scribble_dir" 3; then
        print_info "TripoSG-scribble already exists and verified"
    else
        print_info "Downloading TripoSG-scribble..."
        hf_download VAST-AI/TripoSG-scribble --local-dir "$scribble_dir" 2>/dev/null || true
    fi

    print_success "TripoSG models ready"
}

# Function to download ARDY checkpoints
download_ardy() {
    print_info "========================================"
    print_info "Downloading ARDY Motion Checkpoints"
    print_info "========================================"

    local ardy_dir="$PRETRAINED_DIR/ardy"
    mkdir -p "$ardy_dir"
    if [ "$FORCE_DOWNLOAD" = false ] && verify_directory "$ardy_dir" 1; then
        print_info "ARDY models already exist and verified"
        return 0
    fi

    print_info "Downloading ARDY checkpoints from nvidia/ARDY-Core-RP-20FPS-Horizon40..."
    if hf_download nvidia/ARDY-Core-RP-20FPS-Horizon40 --local-dir "$ardy_dir" && verify_directory "$ardy_dir" 1; then
        print_success "ARDY checkpoints downloaded successfully"
    else
        print_error "Failed to download ARDY checkpoints"
        print_warning "The nvidia/ARDY-* repositories may require acceptance of the NVIDIA Open Model Agreement."
        print_warning "Visit https://huggingface.co/collections/nvidia/ardy and agree to the terms, then run: export HF_TOKEN=<token> and re-run this script."
        return 1
    fi
}

# Function to download Unique3D models
download_unique3d() {
    print_info "========================================"
    print_info "Downloading Unique3D Model"
    print_info "========================================"

    # Download to Unique3D root, not ckpt subdir - HF repo has ckpt/ prefix
    local model_dir="$PRETRAINED_DIR/Unique3D"
    
    if [ "$FORCE_DOWNLOAD" = false ] && \
       verify_file "$model_dir/ckpt/controlnet-tile/diffusion_pytorch_model.safetensors" 100000000 && \
       verify_file "$model_dir/ckpt/image2normal/unet/diffusion_pytorch_model.safetensors" 100000000 && \
       verify_file "$model_dir/ckpt/img2mvimg/unet/diffusion_pytorch_model.safetensors" 100000000 && \
       verify_file "$model_dir/ckpt/realesrgan-x4.onnx" 50000000 && \
       verify_file "$model_dir/ckpt/v1-inference.yaml" 1000; then
        print_info "Unique3D model already exists and verified"
        return 0
    fi

    mkdir -p "$model_dir" 2>/dev/null || true
    ensure_writable_model_dir "$model_dir" || return 1

    # Download all Unique3D checkpoints recursively from Wuvin/Unique3D space
    print_info "Downloading Unique3D checkpoints (including UNet, VAE, ControlNet, ONNX)..."
    if ! hf_download --repo-type space Wuvin/Unique3D \
        --include "ckpt/*" \
        --include "ckpt/**/*" \
        --local-dir "$model_dir"; then
        print_error "Failed to download Unique3D checkpoints"
        return 1
    fi

    # Symlink ckpt to project root and Unique3D thirdparty dir for runtime compatibility
    ln -sfn "$model_dir/ckpt" "$PROJECT_ROOT/ckpt" 2>/dev/null || true
    ln -sfn "$model_dir/ckpt" "$THIRDPARTY_DIR/Unique3D/ckpt" 2>/dev/null || true

    print_success "Unique3D model downloaded successfully"
}

# Function to download Pixal3D models
pixal3d_checkpoint_complete() {
    local model_dir="$1"
    python3 - "$model_dir" <<'PY'
import json
import sys
from pathlib import Path

root = Path(sys.argv[1])
required = (
    "sparse_structure_flow_model",
    "sparse_structure_decoder",
    "shape_slat_flow_model_512",
    "shape_slat_flow_model_1024",
    "shape_slat_decoder",
    "tex_slat_flow_model_512",
    "tex_slat_flow_model_1024",
    "tex_slat_decoder",
)
try:
    config = json.loads((root / "pipeline.json").read_text(encoding="utf-8"))
    models = config["args"]["models"]
    if not isinstance(models, dict):
        raise ValueError("pipeline args.models is not an object")
    for name in required:
        relative_prefix = models.get(name)
        if not isinstance(relative_prefix, str) or not relative_prefix:
            raise ValueError(f"pipeline.json is missing model {name}")
        prefix = Path(relative_prefix)
        if not prefix.is_absolute():
            prefix = root / prefix
        config_path = Path(str(prefix) + ".json")
        weights_path = Path(str(prefix) + ".safetensors")
        if not config_path.is_file() or config_path.stat().st_size < 100:
            raise ValueError(f"missing or truncated config for {name}: {config_path}")
        if not weights_path.is_file() or weights_path.stat().st_size < 1000000:
            raise ValueError(f"missing or truncated weights for {name}: {weights_path}")
except Exception as exc:
    print(f"Pixal3D checkpoint incomplete: {exc}", file=sys.stderr)
    sys.exit(1)
sys.exit(0)
PY
}

hf_encoder_weights_present() {
    local model_dir="$1"
    [ -f "$model_dir/config.json" ] || return 1
    find "$model_dir" -maxdepth 1 -type f \
        \( -name "*.safetensors" -o -name "pytorch_model*.bin" \) \
        -size +1000000c -print -quit 2>/dev/null | grep -q .
}

download_pixal3d() {
    print_info "========================================"
    print_info "Downloading Pixal3D Model"
    print_info "========================================"

    # Pixal3D model weights live in the TencentARC/Pixal3D HF repo.
    # The pipeline uses from_pretrained() which expects {path}.json and {path}.safetensors.
    local model_dir="$PRETRAINED_DIR/Pixal3D"

    if [ "$FORCE_DOWNLOAD" = false ] && \
       verify_directory "$model_dir" 1 && \
       verify_file "$model_dir/pipeline.json" 1000 && \
       pixal3d_checkpoint_complete "$model_dir"; then
        print_info "Pixal3D model already exists and all eight pipeline checkpoints are verified"
        return 0
    fi

    mkdir -p "$model_dir" 2>/dev/null || true
    ensure_writable_model_dir "$model_dir" || return 1

    # Download the full Pixal3D model repo (pipeline.json plus every model config and weight).
    print_info "Downloading Pixal3D model from Hugging Face (TencentARC/Pixal3D)..."
    if ! hf_download TencentARC/Pixal3D --local-dir "$model_dir"; then
        print_error "Failed to download Pixal3D model"
        print_warning "The model requires ~18GB of weights. Check your disk space and network connection."
        return 1
    fi

    if ! pixal3d_checkpoint_complete "$model_dir"; then
        print_error "Pixal3D download did not produce all required pipeline checkpoints"
        return 1
    fi

    print_success "Pixal3D model downloaded and verified successfully"
}

# Function to download Paint3D models
download_paint3d() {
    print_info "========================================"
    print_info "Downloading Paint3D Models"
    print_info "========================================"

    local model_dir="$PRETRAINED_DIR/Paint3D"
    local uv_control_dir="$model_dir/UVPos_Control"

    if [ "$FORCE_DOWNLOAD" = false ] && \
       verify_file "$uv_control_dir/diffusion_pytorch_model.bin" 100000000 && \
       verify_file "$uv_control_dir/config.json"; then
        print_info "Paint3D UV position ControlNet checkpoint already exists and verified"
        return 0
    fi

    mkdir -p "$uv_control_dir"
    print_info "Downloading Paint3D checkpoints from Hugging Face..."

    local download_success=false
    # First attempt: official GeorgeQi/Paint3d_UVPos_Control checkpoint
    if hf_download GeorgeQi/Paint3d_UVPos_Control --local-dir "$uv_control_dir"; then
        download_success=true
        print_success "Paint3D UV Position ControlNet checkpoint downloaded"
    fi

    # Fallback or additional files from OpenTexture/Paint3D if available
    if [ "$download_success" = false ]; then
        print_info "Trying OpenTexture/Paint3D repository..."
        if hf_download OpenTexture/Paint3D --local-dir "$model_dir"; then
            download_success=true
            if [ -f "$model_dir/diffusion_pytorch_model.bin" ]; then
                cp -f "$model_dir/diffusion_pytorch_model.bin" "$uv_control_dir/"
                [ -f "$model_dir/config.json" ] && cp -f "$model_dir/config.json" "$uv_control_dir/"
            fi
            print_success "Paint3D downloaded from OpenTexture/Paint3D"
        fi
    fi

    # Verification logic checking mandatory files exist
    if verify_file "$uv_control_dir/diffusion_pytorch_model.bin" 100000000 && \
       verify_file "$uv_control_dir/config.json"; then
        print_success "Paint3D mandatory checkpoint files verified"
        return 0
    elif [ -f "$model_dir/diffusion_pytorch_model.bin" ]; then
        cp -f "$model_dir/diffusion_pytorch_model.bin" "$uv_control_dir/"
        [ -f "$model_dir/config.json" ] && cp -f "$model_dir/config.json" "$uv_control_dir/"
        print_success "Paint3D checkpoint files verified"
        return 0
    else
        print_error "Paint3D mandatory checkpoint verification failed: required model files not found"
        return 1
    fi
}

# Function to download TaoFlowForge models
download_taoflowforge() {
    print_info "========================================"
    print_info "Downloading TaoFlowForge Models"
    print_info "========================================"

    local model_dir="$PRETRAINED_DIR/Taobao3D/TaoFlowForge"

    if [ "$FORCE_DOWNLOAD" = false ] && \
       [ -d "$model_dir" ] && \
       verify_directory "$model_dir" 3 && \
       verify_file "$model_dir/stage0.pt" 1000000000 && \
       verify_file "$model_dir/stage1.pt" 1000000000 && \
       verify_file "$model_dir/stage2.pt" 1000000000; then
        print_info "TaoFlowForge models already exist and verified"
        return 0
    fi

    mkdir -p "$model_dir" 2>/dev/null || true
    ensure_writable_model_dir "$model_dir" || return 1

    print_info "Downloading TaoFlowForge checkpoints from ModelScope (Taobao3D/TaoFlowForge)..."
    local download_success=false

    # 1. Primary: ModelScope CLI if available
    if command -v modelscope >/dev/null 2>&1; then
        print_info "Using modelscope CLI..."
        if modelscope download --model Taobao3D/TaoFlowForge --local_dir "$model_dir"; then
            download_success=true
        fi
    fi

    # 2. Secondary: Python snapshot_download from modelscope
    if [ "$download_success" = false ]; then
        local py_bin="${PYTHON_EXEC:-$(command -v python3 || command -v python)}"
        if [ -n "$py_bin" ]; then
            print_info "Attempting download via python modelscope snapshot_download..."
            if "$py_bin" -c "from modelscope import snapshot_download; snapshot_download('Taobao3D/TaoFlowForge', local_dir='$model_dir')" 2>/dev/null || \
               "$py_bin" -c "from modelscope import snapshot_download; snapshot_download('Taobao3D/TaoFlowForge', cache_dir='$model_dir')" 2>/dev/null; then
                download_success=true
            fi
        fi
    fi

    # 3. Tertiary: Direct download via wget/curl from ModelScope resolve URLs
    if [ "$download_success" = false ]; then
        print_info "Attempting direct download of stage checkpoints from ModelScope..."
        local base_url="https://modelscope.cn/models/Taobao3D/TaoFlowForge/resolve/master"
        local files=("stage0.pt" "stage1.pt" "stage2.pt")
        local direct_failed=false

        for file in "${files[@]}"; do
            local file_path="$model_dir/$file"
            if [ -f "$file_path" ] && [ "$FORCE_DOWNLOAD" = false ]; then
                print_info "$file already exists, skipping."
                continue
            fi
            print_info "Downloading $file from ModelScope..."
            if command -v wget >/dev/null 2>&1; then
                if ! wget -c --show-progress -O "$file_path" "$base_url/$file"; then
                    direct_failed=true
                    break
                fi
            elif command -v curl >/dev/null 2>&1; then
                if ! curl -L -C - --progress-bar -o "$file_path" "$base_url/$file"; then
                    direct_failed=true
                    break
                fi
            else
                direct_failed=true
                break
            fi
        done

        if [ "$direct_failed" = false ]; then
            download_success=true
        fi
    fi

    # Flatten nested directory if created by cache_dir snapshot_download
    if [ -f "$model_dir/Taobao3D/TaoFlowForge/stage0.pt" ]; then
        mv "$model_dir/Taobao3D/TaoFlowForge"/* "$model_dir/" 2>/dev/null || true
        rm -rf "$model_dir/Taobao3D" 2>/dev/null || true
    fi

    if [ -f "$model_dir/stage0.pt" ] && [ -f "$model_dir/stage1.pt" ] && [ -f "$model_dir/stage2.pt" ]; then
        print_success "TaoFlowForge models downloaded successfully"
        return 0
    else
        print_error "Failed to download TaoFlowForge models (Taobao3D/TaoFlowForge)"
        print_warning "Note: TaoFlowForge checkpoints (~26GB total: stage0.pt, stage1.pt, stage2.pt) require sufficient disk space."
        return 1
    fi
}

# Function to download Hi3D model
download_hi3d() {
    print_info "========================================"
    print_info "Downloading Hi3D Model (Experimental)"
    print_info "========================================"

    local model_dir="$PRETRAINED_DIR/Hi3D"
    local weights_complete=false

    if [ "$FORCE_DOWNLOAD" = false ] && \
       verify_directory "$model_dir" 1 && \
       verify_file "$model_dir/model_index.json" 100 && \
       verify_file "$model_dir/scheduler/scheduler_config.json" 10 && \
       verify_file "$model_dir/vae/config.json" 100 && \
       verify_file "$model_dir/vae/model.safetensors" 1000000 && \
       verify_file "$model_dir/transformer_512/config.json" 100 && \
       verify_file "$model_dir/transformer_512/model.safetensors" 1000000 && \
       verify_file "$model_dir/transformer_1024/config.json" 100 && \
       verify_file "$model_dir/transformer_1024/model.safetensors" 1000000; then
        weights_complete=true
    fi

    if [ "$weights_complete" = true ]; then
        print_info "Hi3D checkpoint files already exist and are verified"
    else
        mkdir -p "$model_dir" 2>/dev/null || true
        ensure_writable_model_dir "$model_dir" || return 1

        print_info "Downloading Hi3D model from Hugging Face (hi3d-official/Hi3Dv1.0)..."
        if ! hf_download hi3d-official/Hi3Dv1.0 --local-dir "$model_dir"; then
            print_error "Failed to download Hi3D model"
            print_warning "Hi3D requires ~8GB of weights. Check your disk space and network connection."
            return 1
        fi

        if ! verify_file "$model_dir/model_index.json" 100 || \
           ! verify_file "$model_dir/scheduler/scheduler_config.json" 10 || \
           ! verify_file "$model_dir/vae/config.json" 100 || \
           ! verify_file "$model_dir/vae/model.safetensors" 1000000 || \
           ! verify_file "$model_dir/transformer_512/config.json" 100 || \
           ! verify_file "$model_dir/transformer_512/model.safetensors" 1000000 || \
           ! verify_file "$model_dir/transformer_1024/config.json" 100 || \
           ! verify_file "$model_dir/transformer_1024/model.safetensors" 1000000; then
            print_error "Hi3D download is incomplete; the custom Sparc3D loader requires all listed artifacts"
            return 1
        fi
    fi

    # Encoder downloads are mandatory for the local-only inference setup.
    local dino_dir="$PRETRAINED_DIR/dinov2-large"
    if ! hf_encoder_weights_present "$dino_dir"; then
        mkdir -p "$dino_dir" 2>/dev/null || true
        ensure_writable_model_dir "$dino_dir" || return 1
        print_info "Downloading DINOv2-large vision encoder..."
        if ! hf_download facebook/dinov2-large --local-dir "$dino_dir"; then
            print_error "Failed to download DINOv2-large vision encoder"
            return 1
        fi
    fi
    if ! hf_encoder_weights_present "$dino_dir"; then
        print_error "DINOv2-large download is incomplete"
        return 1
    fi

    local clip_dir="$PRETRAINED_DIR/clip-vit-large-patch14"
    if ! hf_encoder_weights_present "$clip_dir"; then
        mkdir -p "$clip_dir" 2>/dev/null || true
        ensure_writable_model_dir "$clip_dir" || return 1
        print_info "Downloading CLIP-large vision encoder..."
        if ! hf_download openai/clip-vit-large-patch14 --local-dir "$clip_dir"; then
            print_error "Failed to download CLIP-large vision encoder"
            return 1
        fi
    fi
    if ! hf_encoder_weights_present "$clip_dir"; then
        print_error "CLIP-large download is incomplete"
        return 1
    fi

    print_success "Hi3D checkpoint weights and vision encoders verified successfully"
}

# Function to download miscellaneous models
download_misc() {
    print_info "========================================"
    print_info "Downloading Miscellaneous Models"
    print_info "========================================"
    
    # RealESRGAN_x4plus for Hunyuan3D-2.1
    local realesrgan_path="$PRETRAINED_DIR/misc/RealESRGAN_x4plus.pth"
    if [ "$FORCE_DOWNLOAD" = false ] && verify_file "$realesrgan_path" 50000000; then # 50MB minimum
        print_info "RealESRGAN_x4plus already exists and verified"
    else
        mkdir -p $PRETRAINED_DIR/misc
        download_with_verify \
            "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth" \
            "$realesrgan_path" \
            "RealESRGAN_x4plus model"
    fi
    
    local dinov2_dir="$PRETRAINED_DIR/dinov2-giant"
    if [ "$FORCE_DOWNLOAD" = false ] && verify_directory "$dinov2_dir" 5; then
        print_info "DINOv2-giant model already exists and verified"
    else
        mkdir -p "$dinov2_dir"
        print_info "Downloading DINOv2-giant model..."
        if hf_download  facebook/dinov2-giant \
            --local-dir "$dinov2_dir" --exclude "*.bin"; then
            print_success "DINOv2-giant model downloaded successfully"
        else
            print_error "Failed to download DINOv2-giant model"
            return 1
        fi
    fi
}

# Function to verify all models
verify_all_models() {
    print_info "========================================"
    print_info "Verifying All Models"
    print_info "========================================"
    
    local all_verified=true
    
    print_info "Checking Hunyuan3D 2.1 shared checkpoint..."
    verify_directory "$PRETRAINED_DIR/tencent/Hunyuan3D-2.1/hunyuan3d-dit-v2-1" 3 || all_verified=false
    verify_directory "$PRETRAINED_DIR/tencent/Hunyuan3D-2.1/hunyuan3d-vae-v2-1" 3 || all_verified=false
    verify_directory "$PRETRAINED_DIR/tencent/Hunyuan3D-2.1/hunyuan3d-paintpbr-v2-1" 3 || all_verified=false
    
    print_info "Checking Hunyuan3D-Shape-v2-1..."
    verify_directory "$PRETRAINED_DIR/tencent/Hunyuan3D-2.1" 5 || all_verified=false
    
    print_info "Checking Hunyuan3D-Paint-v2-1..."
    verify_directory "$PRETRAINED_DIR/tencent/Hunyuan3D-2.1" 5 || all_verified=false
    
    print_info "Checking Hunyuan3D-DiT-v2-mini-Turbo..."
    verify_directory "$PRETRAINED_DIR/tencent/Hunyuan3D-2mini/hunyuan3d-dit-v2-mini-turbo" 3 || all_verified=false
    
    print_info "Checking TRELLIS image-large..."
    verify_directory "$PRETRAINED_DIR/TRELLIS/TRELLIS-image-large" 5 || all_verified=false
    
    print_info "Checking TRELLIS text-xlarge (optional)..."
    verify_directory "$PRETRAINED_DIR/TRELLIS/TRELLIS-text-xlarge" 5 || print_warning "TRELLIS text-xlarge not found (optional)"
    
    print_info "Checking UniRig..."
    verify_directory "$PRETRAINED_DIR/UniRig" 3 || all_verified=false
    
    print_info "Checking PartUV..."
    verify_directory "$PRETRAINED_DIR/PartUV" 1 || all_verified=false
    print_info "Checking FastMesh v1k..."
    verify_fastmesh_model "$PRETRAINED_DIR/FastMesh-V1K" || all_verified=false
    print_info "Checking FastMesh v4k..."
    verify_fastmesh_model "$PRETRAINED_DIR/FastMesh-V4K" || all_verified=false
    
    print_info "Checking TRELLIS.2-4B..."
    verify_directory "$PRETRAINED_DIR/TRELLIS.2/TRELLIS.2-4B" 5 || all_verified=false

    print_info "Checking Unique3D..."
    verify_file "$PRETRAINED_DIR/Unique3D/ckpt/controlnet-tile/diffusion_pytorch_model.safetensors" 100000000 || all_verified=false
    verify_file "$PRETRAINED_DIR/Unique3D/ckpt/image2normal/unet/diffusion_pytorch_model.safetensors" 100000000 || all_verified=false
    verify_file "$PRETRAINED_DIR/Unique3D/ckpt/img2mvimg/unet/diffusion_pytorch_model.safetensors" 100000000 || all_verified=false
    verify_file "$PRETRAINED_DIR/Unique3D/ckpt/realesrgan-x4.onnx" 50000000 || all_verified=false
    verify_file "$PRETRAINED_DIR/Unique3D/ckpt/v1-inference.yaml" 1000 || all_verified=false
    
    print_info "Checking TripoSG..."
    verify_directory "$PRETRAINED_DIR/TripoSG" 2 || all_verified=false

    print_info "Checking ARDY..."
    verify_directory "$PRETRAINED_DIR/ardy" 1 || all_verified=false

    print_info "Checking miscellaneous models..."
    verify_file "$PRETRAINED_DIR/misc/RealESRGAN_x4plus.pth" 50000000 || all_verified=false
    verify_directory "$PRETRAINED_DIR/dinov2-giant" 5 || all_verified=false
    
    print_info "Checking Hunyuan3D-Paint-v2-1 RealESRGAN dependency..."
    verify_file "$PRETRAINED_DIR/misc/RealESRGAN_x4plus.pth" 50000000 || all_verified=false
    # Also verify the thirdparty copy expected by the Paint adapter.
    verify_file "$PROJECT_ROOT/backend/thirdparty/hunyuan3d-paint-v2-1/hy3dpaint/ckpt/RealESRGAN_x4plus.pth" 50000000 || all_verified=false

    print_info "Checking Paint3D..."
    if [ -d "$PRETRAINED_DIR/Paint3D" ]; then
        verify_directory "$PRETRAINED_DIR/Paint3D" 1 || all_verified=false
    else
        print_warning "Paint3D not found (can be downloaded via -m paint3d)"
    fi

    print_info "Checking TaoFlowForge..."
    if [ -d "$PRETRAINED_DIR/Taobao3D/TaoFlowForge" ]; then
        verify_directory "$PRETRAINED_DIR/Taobao3D/TaoFlowForge" 3 || all_verified=false
    fi

    print_info "Checking Hi3D..."
    if [ -d "$PRETRAINED_DIR/Hi3D" ]; then
        verify_directory "$PRETRAINED_DIR/Hi3D" 2 || all_verified=false
    fi
    
    if [ "$all_verified" = true ]; then
        print_success "All required models are present and verified!"
    else
        print_warning "Some models are missing or corrupted. Run without -v flag to download them."
    fi
}

# Main execution
print_info "========================================"
print_info "3DAIGC Model Download Script"
print_info "========================================"

# Check if hf or huggingface-cli is available
if ! command -v hf &> /dev/null && ! command -v huggingface-cli &> /dev/null; then
    print_error "hf CLI is not installed. Please install it first:"
    print_error "uv pip --python ${UV_PYTHON:-python3.10} install huggingface_hub"
    exit 1
fi

# Check if wget is available
if ! command -v wget &> /dev/null; then
    print_error "wget is not installed. Please install it first."
    exit 1
fi

# If verify only mode
if [ "$VERIFY_ONLY" = true ]; then
    verify_all_models
    exit 0
fi

# Parse models to download
IFS=',' read -ra MODELS_ARRAY <<< "$MODELS_TO_DOWNLOAD"

# Download requested models
failed=false
for model in "${MODELS_ARRAY[@]}"; do
    case "$model" in
        "hunyuan2mini")
            download_hunyuan2mini
            ;;
        "hunyuan3d_shape_v21")
            download_hunyuan3d_shape_v21
            ;;
        "hunyuan3d_paint_v21")
            download_hunyuan3d_paint_v21
            ;;
        "hunyuan3d_dit_v2_mini_turbo")
            download_hunyuan3d_dit_v2_mini_turbo
            ;;
        "hunyuan21")
            download_hunyuan21
            ;;
        "trellis")
            download_trellis
            ;;
        "trellis-text")
            download_trellis_text
            ;;
        "trellis2")
            download_trellis2
            ;;
        "unirig")
            download_unirig
            ;;
        "partuv")
            download_partuv
            ;;
        "fastmesh")
            download_fastmesh
            ;;
        "triposg")
            download_triposg
            ;;
        "ardy")
            download_ardy
            ;;
        "unique3d")
            download_unique3d
            ;;
        "paint3d")
            download_paint3d
            ;;
        "pixal3d")
            download_pixal3d
            ;;
        "taoflowforge")
            download_taoflowforge
            ;;
        "hi3d")
            download_hi3d
            ;;
        "misc")
            download_misc
            ;;
        "all")
            download_hunyuan21
            download_hunyuan3d_paint_v21
            download_hunyuan2mini
            download_trellis
            download_trellis_text
            download_trellis2
            download_unirig
            download_partuv
            download_fastmesh
            download_triposg
            download_ardy
            download_unique3d
            download_paint3d
            download_pixal3d
            download_misc
            ;;
        *)
            print_error "Unknown model: $model"
            print_error "Available models: $(IFS=', '; echo "${AVAILABLE_MODELS[*]}")"
            exit 1
            ;;
    esac
    [ $? -ne 0 ] && failed=true
done

if [ "$failed" = true ]; then
    print_error "========================================"
    print_error "Some model downloads FAILED — see the errors above."
    print_error "========================================"
    print_info "Fix the access/token issue and re-run this script for the failed models only."
    print_info "You can verify existing downloads by running: $0 -v"
    exit 1
fi

print_success "========================================"
print_success "Model Download Complete!"
print_success "========================================"
print_info "All requested models have been downloaded successfully."
print_info "You can verify the downloads by running: $0 -v"