# Single All-in-One Dockerfile for ForMash3D Studio
# Contains: CUDA 12.4, Python 3.10 Conda Env (3daigc-api), PyTorch 2.6.0,
#           All Generative 3D Model Adapters, Headless Blender Post-processing,
#           Embedded Redis Queue, Multi-Worker FastAPI Backend (Port 7842),
#           and Next.js Web Frontend (Port 3000) under Supervisor.

FROM nvidia/cuda:12.4.0-devel-ubuntu20.04 AS base

# Set environment variables
ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV CUDA_HOME=/usr/local/cuda
ENV PATH=${CUDA_HOME}/bin:${PATH}
ENV LD_LIBRARY_PATH=${CUDA_HOME}/lib64:${LD_LIBRARY_PATH}
ENV TORCH_CUDA_ARCH_LIST="6.0 6.1 7.0 7.5 8.0 8.6 8.9 9.0+PTX"

# Install system dependencies, Blender, Redis, and Supervisor
RUN apt-get update && apt-get install -y \
    wget \
    curl \
    git \
    build-essential \
    cmake \
    ninja-build \
    libgl1-mesa-dev \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgomp1 \
    libegl1 \
    libegl1-mesa \
    libgl1-mesa-dev \
    libjpeg-dev \
    libwebp-dev \
    libgles2-mesa-dev \
    libosmesa6-dev \
    libxi6 \
    libxkbcommon-dev \
    xvfb \
    blender \
    redis-server \
    supervisor \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 20 and Bun for Next.js frontend
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

# Install Miniconda
RUN wget https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh -O miniconda.sh && \
    bash miniconda.sh -b -p /opt/conda && \
    rm miniconda.sh
ENV PATH="/opt/conda/bin:${PATH}"

# Initialize conda
RUN conda init bash

# Create conda environment with Python 3.10
RUN conda tos accept --override-channels --channel https://repo.anaconda.com/pkgs/main || true
RUN conda tos accept --override-channels --channel https://repo.anaconda.com/pkgs/r || true
RUN conda create -n 3daigc-api python=3.10 -y

# Make conda environment activation persistent for RUN steps
SHELL ["conda", "run", "-n", "3daigc-api", "/bin/bash", "-c"]

# Install PyTorch with CUDA 12.4 support
RUN pip install torch==2.6.0 torchvision==0.21.0 torchaudio==2.6.0 --index-url https://download.pytorch.org/whl/cu124

# Set working directory
WORKDIR /app

# Copy the entire project
COPY . .

# Setup proxy settings passed via build args if any
ARG http_proxy
ARG https_proxy
ARG no_proxy
ENV http_proxy=$http_proxy
ENV https_proxy=$https_proxy
ENV no_proxy=$no_proxy

# Install TRELLIS.2 dependencies
WORKDIR /app/backend/thirdparty/TRELLIS.2
RUN bash setup.sh --basic --flash-attn --nvdiffrast --nvdiffrec --cumesh --o-voxel || true
RUN pip install kaolin -f https://nvidia-kaolin.s3.us-east-2.amazonaws.com/torch-2.6.0_cu124.html || true

# Install TRELLIS(v1) requirements on top of TRELLIS.2
RUN pip install pymeshfix igraph || true
RUN git clone https://github.com/autonomousvision/mip-splatting.git /tmp/extensions/mip-splatting && \
    pip install /tmp/extensions/mip-splatting/submodules/diff-gaussian-rasterization/ --no-build-isolation || true && \
    rm -rf /tmp/extensions/mip-splatting

# Install PartField dependencies
WORKDIR /app/backend/thirdparty/PartField
RUN pip install lightning==2.2 h5py yacs trimesh scikit-image loguru boto3 || true
RUN pip install mesh2sdf tetgen pymeshlab plyfile einops libigl polyscope potpourri3d simple_parsing arrgh open3d psutil || true
RUN mkdir -p /app/backend/thirdparty/wheels && \
    curl -fL --retry 3 "https://github.com/Silentzx2/ForMash3D/releases/download/Wheels/torch_scatter-2.1.2-cp310-cp310-linux_x86_64.whl" \
    -o /app/backend/thirdparty/wheels/torch_scatter-2.1.2-cp310-cp310-linux_x86_64.whl || true
RUN if [ -f /app/backend/thirdparty/wheels/torch_scatter-2.1.2-cp310-cp310-linux_x86_64.whl ]; then \
        pip install /app/backend/thirdparty/wheels/torch_scatter-2.1.2-cp310-cp310-linux_x86_64.whl --no-deps || true; \
    fi
RUN pip install torch-sparse==0.6.18 -f https://data.pyg.org/whl/torch-2.6.0+cu124.html || true
RUN pip install torch-cluster==1.6.3 -f https://data.pyg.org/whl/torch-2.6.0+cu124.html || true

# Install Hunyuan3D unified runtime dependencies
WORKDIR /app/backend/thirdparty
RUN pip install -r hunyuan-requirements.txt || true

# Build Hunyuan3D-Shape-v2-1 native components
WORKDIR /app/backend/thirdparty/hunyuan3d-shape-v2-1/hy3dpaint/custom_rasterizer
RUN pip install -e . --no-build-isolation || true
WORKDIR /app/backend/thirdparty/hunyuan3d-shape-v2-1/hy3dpaint/DifferentiableRenderer
RUN bash compile_mesh_painter.sh || true

# Build Hunyuan3D-Paint-v2-1 native components
WORKDIR /app/backend/thirdparty/hunyuan3d-paint-v2-1/hy3dpaint/custom_rasterizer
RUN pip install -e . --no-build-isolation || true
WORKDIR /app/backend/thirdparty/hunyuan3d-paint-v2-1/hy3dpaint/DifferentiableRenderer
RUN bash compile_mesh_painter.sh || true

# Install UniRig dependencies
WORKDIR /app/backend/thirdparty/UniRig
RUN pip install spconv-cu124 pyrender fast-simplification python-box timm || true

# Install PartPacker dependencies
WORKDIR /app/backend/thirdparty/PartPacker
RUN pip install pybind11==3.0.1 || true
RUN pip install meshiki kiui fpsample pymcubes einops || true

# Install PartUV dependencies
RUN pip install seaborn partuv blenderproc || true

# Install P3-SAM dependencies
RUN pip install numba scikit-learn fpsample || true

# Install FastMesh dependencies
WORKDIR /app/backend/thirdparty/FastMesh
RUN if [ -f "requirement_extra.txt" ]; then pip install -r requirement_extra.txt || true; fi

# Install UltraShape dependencies
WORKDIR /app/backend/thirdparty/UltraShape
RUN pip install git+https://github.com/ashawkey/cubvh --no-build-isolation || true

# Install VoxHammer dependencies
WORKDIR /app/backend/thirdparty/VoxHammer
RUN pip install git+https://github.com/huanngzh/bpy-renderer.git || true
RUN pip install pysdf sentencepiece || true

# Install main project dependencies
WORKDIR /app
RUN pip install -r /app/backend/requirements.txt
RUN python backend/scripts/verify_postprocess_runtime.py || true
RUN pip install -r /app/backend/thirdparty/TripoSG/requirements.txt
RUN pip install -r /app/backend/requirements-test.txt

# Build Next.js Frontend
WORKDIR /app
RUN /root/.bun/bin/bun install --frozen-lockfile || /root/.bun/bin/bun install
ENV NEXT_TELEMETRY_DISABLED=1
RUN /root/.bun/bin/bun run build

# Create necessary directories
RUN mkdir -p /app/backend/uploads /app/backend/data /app/backend/logs /app/backend/outputs /app/backend/storage /app/logs

# Setup Supervisor configuration
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Configure bash environment so interactive shells auto-activate conda
RUN echo "source /opt/conda/etc/profile.d/conda.sh && conda activate 3daigc-api" >> /root/.bashrc && \
    echo "export PATH=\"/root/.bun/bin:/opt/conda/envs/3daigc-api/bin:\$PATH\"" >> /root/.bashrc && \
    echo "export PYTHONPATH=\"/app/backend:/app\"" >> /root/.bashrc

# Set runtime environment variables
ENV PYTHONPATH="/app/backend:/app"
ENV CONDA_DEFAULT_ENV=3daigc-api
ENV ENVIRONMENT=production

ENV http_proxy=""
ENV https_proxy=""
ENV no_proxy=""
ENV HTTP_PROXY=""
ENV HTTPS_PROXY=""
ENV NO_PROXY=""

# Expose Next.js Frontend (3000) and FastAPI Backend (7842)
EXPOSE 3000 7842

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:7842/health && curl -f http://localhost:3000 || exit 1

# Start Supervisor managing Redis, Scheduler, API, and Frontend
CMD ["/bin/bash", "-c", "rm -f /var/run/supervisord.pid /var/run/supervisor.sock && exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf"]
