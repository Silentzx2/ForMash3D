#!/usr/bin/env bash
# Start the Standalone Mesh Tools / PostProcess Microservice
# Service: FastAPI running on port 8200
# Endpoints: /api/meshes/* (Auto UV, Auto Retopo, Repair, Bake, Segment)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
POSTPROCESS_DIR="$(cd "${SCRIPT_DIR}/../backend/postprocess" && pwd)"

echo "=========================================================="
echo " Starting Standalone PostProcess Microservice on port 8200"
echo " Directory: ${POSTPROCESS_DIR}"
echo "=========================================================="

cd "${POSTPROCESS_DIR}"

if [ -f "run.sh" ]; then
    bash run.sh
else
    export MESHTOOLS_PORT=${MESHTOOLS_PORT:-8200}
    uvicorn main:app --host 0.0.0.0 --port "${MESHTOOLS_PORT}" --reload
fi
