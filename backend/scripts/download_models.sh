#!/bin/bash

# 3DAIGC Model Download Script
# Usage: ./download_models.sh [OPTIONS]
# 
# Available models:
#   partfield, hunyuan2mini, hunyuan21, trellis, trellis-text, trellis2,
#   p3sam, unirig, partpacker, partuv, fastmesh, ultrashape, voxhammer, misc, all
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
    if command -v hf >/dev/null 2>&1; then
        hf download "${HF_EXTRA_ARGS[@]}" "$@"
    elif command -v huggingface-cli >/dev/null 2>&1; then
        huggingface-cli download "${HF_EXTRA_ARGS[@]}" "$@"
    else
        local py_bin="${PYTHON_EXEC:-$(command -v python3 || command -v python)}"
        "$py_bin" -m huggingface_hub.cli.download "${HF_EXTRA_ARGS[@]}" "$@"
    fi
}

# Default values
MODELS_TO_DOWNLOAD="all"
VERIFY_ONLY=false
FORCE_DOWNLOAD=false

# Available models
AVAILABLE_MODELS=("partfield" "hunyuan2mini" "hunyuan21" "hunyuan3d_shape_v21" "hunyuan3d_paint_v21" "hunyuan3d_dit_v2_mini_turbo" "trellis" "trellis-text" "trellis2" "p3sam" "unirig" "partpacker" "partuv" "fastmesh" "ultrashape" "triposr" "triposg" "triposf" "ardy" "zero123plus" "zero123plus_normal_controlnet" "voxhammer" "misc" "all")

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
    partfield          - PartField model for mesh segmentation
    hunyuan2mini       - Hunyuan3D 2.0 mini models
    hunyuan21          - Hunyuan3D 2.1 models  
    hunyuan3d_shape_v21 - Hunyuan3D-Shape-v2-1 (3.3B shape)
    hunyuan3d_paint_v21 - Hunyuan3D-Paint-v2-1 (2B PBR texture)
    hunyuan3d_dit_v2_mini_turbo - Hunyuan3D-DiT-v2-mini-Turbo (0.6B low-VRAM)
    trellis            - TRELLIS image-large model
    trellis-text       - TRELLIS text-xlarge model (optional)
    trellis2           - TRELLIS.2-4B model (image-based only)
    p3sam              - P3-SAM mesh segmentation model
    unirig             - UniRig model for auto-rigging
    partpacker         - PartPacker model
    partuv             - PartUV model
    fastmesh           - FastMesh model
    ultrashape         - UltraShape model
    triposr            - TripoSR fast single-image reconstruction model
    triposg            - TripoSG and RMBG models
    triposf            - TripoSF VAE checkpoint
    ardy               - ARDY motion generation models
    zero123plus        - Zero123++ v1.2 multi-view image generation model
    zero123plus_normal_controlnet - Normal generation ControlNet for Zero123++ v1.2 (optional)
    voxhammer          - VoxHammer text/image mesh-editing TRELLIS checkpoints
    misc               - Miscellaneous utility models (RealESRGAN, DINOv2)
    all                - All core models (excluding optional normal ControlNet)

Examples:
    $0                                    # Download all models
    $0 -m trellis                         # Download only TRELLIS
    $0 -v                                # Verify all existing models
    $0 -m partfield -f                   # Force re-download PartField model
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

# Function to download PartField model
download_partfield() {
    print_info "========================================"
    print_info "Downloading PartField Model"
    print_info "========================================"
    
    local model_path="$PRETRAINED_DIR/PartField/model_objaverse.pt"
    
    if [ "$FORCE_DOWNLOAD" = false ] && verify_file "$model_path" 50000000; then # 50MB minimum
        print_info "PartField model already exists and verified"
        return 0
    fi
    
    mkdir -p $PRETRAINED_DIR/PartField
    download_with_verify \
        "https://huggingface.co/mikaelaangel/partfield-ckpt/resolve/main/model_objaverse.ckpt" \
        "$model_path" \
        "PartField model"
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
    
    mkdir -p "$model_dir"
    print_info "Downloading Hunyuan3D 2.0 mini (geometry/vae)..."
    if hf_download  tencent/Hunyuan3D-2mini \
        --include "hunyuan3d-dit-v2-mini-turbo/*" "hunyuan3d-vae-v2-mini-turbo/*" \
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
    
    if [ "$FORCE_DOWNLOAD" = false ] \
       && verify_directory "$model_dir/hunyuan3d-dit-v2-1" 3 \
       && verify_directory "$model_dir/hunyuan3d-vae-v2-1" 3 \
       && verify_directory "$model_dir/hunyuan3d-paintpbr-v2-1" 3; then
        print_info "Hunyuan3D 2.1 shared checkpoint is complete and verified"
        return 0
    fi
    
    mkdir -p "$model_dir"
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
        download_with_verify \
            "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth" \
            "$realesrgan_path" \
            "RealESRGAN_x4plus model"
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

    # The pipeline root requires both the DiT and VAE components.
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
    
    mkdir -p "$model_dir"
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
    
    mkdir -p "$model_dir"
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
    
    mkdir -p "$model_dir"
    print_info "Downloading TRELLIS.2-4B model (image-based generation only)..."
    if hf_download  microsoft/TRELLIS.2-4B --local-dir "$model_dir"; then
        print_success "TRELLIS.2-4B model downloaded successfully"
    else
        print_error "Failed to download TRELLIS.2-4B model"
        return 1
    fi
}

# Function to download P3-SAM model
download_p3sam() {
    print_info "========================================"
    print_info "Downloading P3-SAM Model"
    print_info "========================================"
    
    local model_dir="$PRETRAINED_DIR/P3-SAM"
    local checkpoint_path="$model_dir/p3sam.safetensors"
    
    if [ "$FORCE_DOWNLOAD" = false ] && verify_file "$checkpoint_path" 50000000; then
        print_info "P3-SAM model already exists and verified"
        return 0
    fi
    
    mkdir -p "$model_dir"
    print_info "Downloading P3-SAM checkpoint..."
    if hf_download tencent/Hunyuan3D-Part \
        --include "p3sam/p3sam.safetensors" \
        --local-dir "$model_dir"; then
        if [ -f "$model_dir/p3sam/p3sam.safetensors" ] && [ ! -f "$checkpoint_path" ]; then
            mv "$model_dir/p3sam/p3sam.safetensors" "$checkpoint_path"
            rmdir "$model_dir/p3sam" 2>/dev/null || true
        fi
        print_success "P3-SAM model downloaded successfully"
    else
        print_error "Failed to download P3-SAM model"
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
    
    mkdir -p "$model_dir"
    print_info "Downloading UniRig model..."
    if hf_download  VAST-AI/UniRig --local-dir "$model_dir"; then
        print_success "UniRig model downloaded successfully"
    else
        print_error "Failed to download UniRig model"
        return 1
    fi
}

# Function to download PartPacker model
download_partpacker() {
    print_info "========================================"
    print_info "Downloading PartPacker Model"
    print_info "========================================"
    
    local model_dir="$PRETRAINED_DIR/PartPacker"
    
    if [ "$FORCE_DOWNLOAD" = false ] && verify_directory "$model_dir" 3; then
        print_info "PartPacker model already exists and verified"
        return 0
    fi
    
    mkdir -p "$model_dir"
    print_info "Downloading PartPacker model..."
    if hf_download  nvidia/PartPacker --local-dir "$model_dir"; then
        print_success "PartPacker model downloaded successfully"
    else
        print_error "Failed to download PartPacker model"
        return 1
    fi
}

# Function to download FastMesh model
download_fastmesh() {
    print_info "========================================"
    print_info "Downloading FastMesh Models"
    print_info "========================================"

    local model_dir_v1k="$PRETRAINED_DIR/FastMesh-V1K"
    local model_dir_v4k="$PRETRAINED_DIR/FastMesh-V4K"

    if [ "$FORCE_DOWNLOAD" = false ] && verify_directory "$model_dir_v1k" 3; then
        print_info "FastMesh v1k model already exists and verified"
    else
        mkdir -p "$model_dir_v1k"
        print_info "Downloading FastMesh v1k model..."
        if hf_download "WopperSet/FastMesh-V1K" --local-dir "$model_dir_v1k"; then
            print_success "FastMesh v1k model downloaded successfully"
        else
            print_error "Failed to download FastMesh v1k model"
            return 1
        fi
    fi

    if [ "$FORCE_DOWNLOAD" = false ] && verify_directory "$model_dir_v4k" 3; then
        print_info "FastMesh v4k model already exists and verified"
    else
        mkdir -p "$model_dir_v4k"
        print_info "Downloading FastMesh v4k model..."
        if hf_download "WopperSet/FastMesh-V4K" --local-dir "$model_dir_v4k"; then
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

    local partfield_model_path="$PRETRAINED_DIR/PartUV/model_objaverse.ckpt"
    if [ "$FORCE_DOWNLOAD" = false ] && verify_file "$partfield_model_path" 50000000; then
        print_info "PartUV model already exists and verified"
        return 0
    else
        mkdir -p $PRETRAINED_DIR/PartUV
        download_with_verify \
            "https://huggingface.co/mikaelaangel/partfield-ckpt/resolve/main/model_objaverse.ckpt" \
            "$partfield_model_path" \
            "PartUV model"
        print_success "PartUV model downloaded successfully"
    fi
}

# Function to download UltraShape model
download_ultrashape() {
    print_info "========================================"
    print_info "Downloading UltraShape Model"
    print_info "========================================"

    local model_dir="$PRETRAINED_DIR/UltraShape"
    local checkpoint_path="$model_dir/ultrashape_v1.pt"
    if [ "$FORCE_DOWNLOAD" = false ] && verify_file "$checkpoint_path" 100000000; then
        print_info "UltraShape checkpoint already exists and verified"
        return 0
    fi

    mkdir -p "$model_dir"
    print_info "Downloading UltraShape checkpoint..."
    if hf_download infinith/UltraShape \
        --include "ultrashape_v1.pt" \
        --local-dir "$model_dir"; then
        print_success "UltraShape checkpoint downloaded successfully"
    else
        print_error "Failed to download UltraShape checkpoint"
        return 1
    fi
}

# Function to download TripoSR model
download_triposr() {
    print_info "========================================"
    print_info "Downloading TripoSR Model"
    print_info "========================================"

    local model_dir="$PRETRAINED_DIR/TripoSR"
    if [ "$FORCE_DOWNLOAD" = false ] && verify_file "$model_dir/model.ckpt" 50000000; then
        print_info "TripoSR model already exists and verified"
        return 0
    fi

    mkdir -p "$model_dir"
    print_info "Downloading TripoSR from stabilityai/TripoSR..."
    if hf_download stabilityai/TripoSR --local-dir "$model_dir"; then
        print_success "TripoSR model downloaded successfully"
    else
        print_error "Failed to download TripoSR model"
        return 1
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
        hf_download briaai/RMBG-1.4 --local-dir "$rmbg_dir" || print_warning "RMBG-1.4 download warning"
    fi

    mkdir -p "$triposg_dir"
    if [ "$FORCE_DOWNLOAD" = false ] && verify_directory "$triposg_dir" 3; then
        print_info "TripoSG already exists and verified"
    else
        print_info "Downloading TripoSG..."
        hf_download VAST-AI/TripoSG --local-dir "$triposg_dir" || print_warning "TripoSG download warning"
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

# Function to download TripoSF model
download_triposf() {
    print_info "========================================"
    print_info "Downloading TripoSF Model"
    print_info "========================================"

    local triposf_dir="$PRETRAINED_DIR/TripoSF"
    mkdir -p "$triposf_dir"

    local ckpt_path="$triposf_dir/pretrained_TripoSFVAE_256i1024o.safetensors"
    local vae_path="$triposf_dir/vae/pretrained_TripoSFVAE_256i1024o.safetensors"

    if [ "$FORCE_DOWNLOAD" = false ] && { verify_file "$ckpt_path" 50000000 2>/dev/null || verify_file "$vae_path" 50000000 2>/dev/null; }; then
        print_info "TripoSF model already exists and verified"
        return 0
    fi

    print_info "Downloading TripoSF VAE checkpoint from VAST-AI/TripoSF..."
    if hf_download VAST-AI/TripoSF vae/pretrained_TripoSFVAE_256i1024o.safetensors --local-dir "$triposf_dir"; then
        if [ -f "$vae_path" ] && [ ! -f "$ckpt_path" ]; then
            cp "$vae_path" "$ckpt_path" 2>/dev/null || true
        fi
        print_success "TripoSF model downloaded successfully"
    else
        print_error "Failed to download TripoSF model"
        return 1
    fi
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

    print_info "Downloading ARDY checkpoints from nv-tlabs/ardy..."
    if hf_download nv-tlabs/ardy --local-dir "$ardy_dir" 2>/dev/null; then
        print_success "ARDY checkpoints downloaded successfully"
    else
        print_warning "ARDY Hugging Face repository requires Meta-Llama gated access or HF token."
        print_warning "If you have a token, run: export HF_TOKEN=<token> and re-run this script."
    fi
}

# Function to download Zero123++ v1.2 multi-view model
download_zero123plus() {
    print_info "========================================"
    print_info "Downloading Zero123++ v1.2 Multi-View Model"
    print_info "========================================"

    local model_dir="$PRETRAINED_DIR/zero123plus-v1.2"
    if [ "$FORCE_DOWNLOAD" = false ] && [ -f "$model_dir/model_index.json" ] && verify_directory "$model_dir" 3; then
        print_info "Zero123++ v1.2 model already exists and verified"
        return 0
    fi

    mkdir -p "$model_dir"
    print_info "Downloading Zero123++ v1.2 from sudo-ai/zero123plus-v1.2..."
    if hf_download sudo-ai/zero123plus-v1.2 --local-dir "$model_dir"; then
        print_success "Zero123++ v1.2 model downloaded successfully"
    else
        print_error "Failed to download Zero123++ v1.2 model"
        return 1
    fi
}

# Function to download optional normal ControlNet for Zero123++ v1.2
download_zero123plus_normal_controlnet() {
    print_info "========================================"
    print_info "Downloading Zero123++ v1.2 Normal ControlNet (Optional)"
    print_info "========================================"

    local model_dir="$PRETRAINED_DIR/controlnet-zp12-normal-gen-v1"
    if [ "$FORCE_DOWNLOAD" = false ] && [ -f "$model_dir/config.json" ] && verify_directory "$model_dir" 2; then
        print_info "Normal ControlNet already exists and verified"
        return 0
    fi

    mkdir -p "$model_dir"
    print_info "Downloading normal ControlNet from sudo-ai/controlnet-zp12-normal-gen-v1..."
    if hf_download sudo-ai/controlnet-zp12-normal-gen-v1 --local-dir "$model_dir"; then
        print_success "Normal ControlNet downloaded successfully"
    else
        print_error "Failed to download Normal ControlNet"
        return 1
    fi
}

# Function to download VoxHammer model checkpoints
download_voxhammer() {
    print_info "========================================"
    print_info "Downloading VoxHammer Model Checkpoints"
    print_info "========================================"

    local model_dir="$PRETRAINED_DIR/VoxHammer"
    local image_cache="$model_dir/models--FishWoWater--TRELLIS-image-large-voxhammer"
    local text_cache="$model_dir/models--FishWoWater--TRELLIS-text-large-voxhammer"

    if [ "$FORCE_DOWNLOAD" = false ] &&        verify_directory "$image_cache" 2 &&        verify_directory "$text_cache" 2; then
        print_info "VoxHammer checkpoints already exist and verified"
        return 0
    fi

    mkdir -p "$model_dir"

    # VoxHammer text editing depends on the base TRELLIS image checkpoint.
    download_trellis

    print_info "Downloading VoxHammer image-conditioned TRELLIS checkpoint..."
    if ! hf_download FishWoWater/TRELLIS-image-large-voxhammer --cache-dir "$model_dir"; then
        print_error "Failed to download VoxHammer image checkpoint"
        return 1
    fi

    print_info "Downloading VoxHammer text-conditioned TRELLIS checkpoint..."
    if ! hf_download FishWoWater/TRELLIS-text-large-voxhammer --cache-dir "$model_dir"; then
        print_error "Failed to download VoxHammer text checkpoint"
        return 1
    fi

    print_success "VoxHammer model checkpoints downloaded successfully"
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
    
    # DINOv2-giant used in PartPacker or elsewhere
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
    
    print_info "Checking PartField..."
    verify_file "$PRETRAINED_DIR/PartField/model_objaverse.pt" 50000000 || all_verified=false
    
    print_info "Checking Hunyuan3D 2.1 shared checkpoint..."
    verify_directory "$PRETRAINED_DIR/tencent/Hunyuan3D-2.1/hunyuan3d-dit-v2-1" 3 || all_verified=false
    verify_directory "$PRETRAINED_DIR/tencent/Hunyuan3D-2.1/hunyuan3d-vae-v2-1" 3 || all_verified=false
    verify_directory "$PRETRAINED_DIR/tencent/Hunyuan3D-2.1/hunyuan3d-paintpbr-v2-1" 3 || all_verified=false
    
    print_info "Checking Hunyuan3D-DiT-v2-mini-Turbo..."
    verify_directory "$PRETRAINED_DIR/tencent/Hunyuan3D-2mini/hunyuan3d-dit-v2-mini-turbo" 3 || all_verified=false
    verify_directory "$PRETRAINED_DIR/tencent/Hunyuan3D-2mini/hunyuan3d-vae-v2-mini-turbo" 3 || all_verified=false
    
    print_info "Checking TRELLIS image-large..."
    verify_directory "$PRETRAINED_DIR/TRELLIS/TRELLIS-image-large" 5 || all_verified=false
    
    print_info "Checking TRELLIS text-xlarge (optional)..."
    verify_directory "$PRETRAINED_DIR/TRELLIS/TRELLIS-text-xlarge" 5 || print_warning "TRELLIS text-xlarge not found (optional)"
    
    print_info "Checking UniRig..."
    verify_directory "$PRETRAINED_DIR/UniRig" 3 || all_verified=false
    
    print_info "Checking PartPacker..."
    verify_directory "$PRETRAINED_DIR/PartPacker" 3 || all_verified=false

    print_info "Checking PartUV..."
    verify_directory "$PRETRAINED_DIR/PartUV" 1 || all_verified=false
    print_info "Checking FastMesh v1k..."
    verify_directory "$PRETRAINED_DIR/FastMesh-V1K" 3 || all_verified=false
    print_info "Checking FastMesh v4k..."
    verify_directory "$PRETRAINED_DIR/FastMesh-V4K" 3 || all_verified=false
    
    print_info "Checking TRELLIS.2-4B..."
    verify_directory "$PRETRAINED_DIR/TRELLIS.2/TRELLIS.2-4B" 5 || all_verified=false

    print_info "Checking VoxHammer image checkpoint..."
    verify_directory "$PRETRAINED_DIR/VoxHammer/models--FishWoWater--TRELLIS-image-large-voxhammer" 2 || all_verified=false

    print_info "Checking VoxHammer text checkpoint..."
    verify_directory "$PRETRAINED_DIR/VoxHammer/models--FishWoWater--TRELLIS-text-large-voxhammer" 2 || all_verified=false
    
    print_info "Checking P3-SAM..."
    verify_file "$PRETRAINED_DIR/P3-SAM/p3sam.safetensors" 50000000 || all_verified=false
    
    print_info "Checking UltraShape..."
    verify_file "$PRETRAINED_DIR/UltraShape/ultrashape_v1.pt" 100000000 || all_verified=false
    
    print_info "Checking TripoSR..."
    verify_file "$PRETRAINED_DIR/TripoSR/model.ckpt" 50000000 || all_verified=false

    print_info "Checking TripoSG..."
    verify_directory "$PRETRAINED_DIR/TripoSG" 2 || all_verified=false

    print_info "Checking TripoSF..."
    { verify_file "$PRETRAINED_DIR/TripoSF/pretrained_TripoSFVAE_256i1024o.safetensors" 50000000 2>/dev/null || \
      verify_file "$PRETRAINED_DIR/TripoSF/vae/pretrained_TripoSFVAE_256i1024o.safetensors" 50000000 2>/dev/null; } || all_verified=false

    print_info "Checking ARDY..."
    verify_directory "$PRETRAINED_DIR/ardy" 1 || all_verified=false

    print_info "Checking Zero123++ v1.2..."
    if [ -f "$PRETRAINED_DIR/zero123plus-v1.2/model_index.json" ]; then
        verify_directory "$PRETRAINED_DIR/zero123plus-v1.2" 3 || all_verified=false
    else
        print_warning "Zero123++ v1.2 not found (can be downloaded via -m zero123plus)"
    fi

    print_info "Checking miscellaneous models..."
    verify_file "$PRETRAINED_DIR/misc/RealESRGAN_x4plus.pth" 50000000 || all_verified=false
    verify_directory "$PRETRAINED_DIR/dinov2-giant" 5 || all_verified=false
    
    print_info "Checking Hunyuan3D-Paint-v2-1 RealESRGAN dependency..."
    verify_file "$PRETRAINED_DIR/misc/RealESRGAN_x4plus.pth" 50000000 || all_verified=false
    # Also verify the thirdparty copy expected by the Paint adapter.
    verify_file "$PROJECT_ROOT/backend/thirdparty/hunyuan3d-paint-v2-1/hy3dpaint/ckpt/RealESRGAN_x4plus.pth" 50000000 || all_verified=false
    
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

# Check if hf is available
if ! command -v hf &> /dev/null; then
    print_error "hf is not installed. Please install it first:"
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
for model in "${MODELS_ARRAY[@]}"; do
    case "$model" in
        "partfield")
            download_partfield
            ;;
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
        "p3sam")
            download_p3sam
            ;;
        "unirig")
            download_unirig
            ;;
        "partpacker")
            download_partpacker
            ;;
        "partuv")
            download_partuv
            ;;
        "fastmesh")
            download_fastmesh
            ;;
        "ultrashape")
            download_ultrashape
            ;;
        "triposr")
            download_triposr
            ;;
        "triposg")
            download_triposg
            ;;
        "triposf")
            download_triposf
            ;;
        "ardy")
            download_ardy
            ;;
        "zero123plus")
            download_zero123plus
            ;;
        "zero123plus_normal_controlnet")
            download_zero123plus_normal_controlnet
            ;;
        "voxhammer")
            download_voxhammer
            ;;
        "misc")
            download_misc
            ;;
        "all")
            download_partfield
            download_hunyuan21
            download_hunyuan3d_paint_v21
            download_hunyuan2mini
            download_trellis
            download_trellis_text
            download_trellis2
            download_voxhammer
            download_p3sam
            download_unirig
            download_partpacker
            download_partuv
            download_fastmesh
            download_ultrashape
            download_triposr
            download_triposg
            download_triposf
            download_ardy
            download_zero123plus
            download_misc
            ;;
        *)
            print_error "Unknown model: $model"
            print_error "Available models: $(IFS=', '; echo "${AVAILABLE_MODELS[*]}")"
            exit 1
            ;;
    esac
done

print_success "========================================"
print_success "Model Download Complete!"
print_success "========================================"
print_info "All requested models have been downloaded successfully."
print_info "You can verify the downloads by running: $0 -v"