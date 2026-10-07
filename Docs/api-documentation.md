# ForMash 3D — Complete API Documentation

> **Version**: 0.1.0
> **Base URL**: `http://localhost:7842` (Backend API)
> **API Prefix**: `/api/v1`
> **Documentation**: Interactive docs at `/docs` (Swagger UI)

---

## Table of Contents

1. [Overview](#overview)
2. [Authentication](#authentication)
3. [System APIs](#system-apis)
4. [File Upload APIs](#file-upload-apis)
5. [Mesh Generation APIs](#mesh-generation-apis)
6. [Mesh Editing APIs](#mesh-editing-apis)
7. [Auto Rigging APIs](#auto-rigging-apis)
8. [Motion Generation APIs](#motion-generation-apis)
9. [Mesh Tools APIs](#mesh-tools-apis)
10. [Mesh Segmentation APIs](#mesh-segmentation-apis)
11. [Mesh Retopology APIs](#mesh-retopology-apis)
12. [Mesh UV Unwrapping APIs](#mesh-uv-unwrapping-apis)
13. [Users APIs](#users-apis)
14. [Error Handling](#error-handling)
15. [Deployment Modes](#deployment-modes)

---

## Overview

The ForMash 3D REST API follows RESTful conventions and returns JSON responses. All endpoints are prefixed with `/api/v1`.

### Standard Response Format

```json
{
  "job_id": "gen_abc123",
  "status": "queued",
  "message": "Generation job queued"
}
```

### Error Response Format

```json
{
  "error": "ERROR_CODE",
  "message": "Error description",
  "detail": "Detailed error information"
}
```

### HTTP Status Codes

| Code | Meaning | Usage |
|------|---------|-------|
| `200` | OK | Successful GET, PUT, DELETE |
| `201` | Created | Resource created successfully |
| `202` | Accepted | Async task started |
| `400` | Bad Request | Invalid parameters |
| `401` | Unauthorized | Authentication required |
| `403` | Forbidden | Insufficient permissions |
| `404` | Not Found | Resource doesn't exist |
| `422` | Validation Error | Invalid request body |
| `429` | Too Many Requests | Rate limit exceeded |
| `500` | Internal Server Error | Server-side error |

---

## Authentication

The API supports two authentication modes controlled by `P3D_USER_AUTH_ENABLED`:

- **Simple Mode** (default): No authentication required. All clients can see all jobs.
- **Authenticated Mode**: Redis-based user authentication with API key support.

### Set API Key

```bash
POST /api/v1/users/register
Content-Type: application/json

{ "username": "admin", "password": "secret" }
```

---

## System APIs

### Health Check

```http
GET /api/v1/system/health
```

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2026-09-21T00:00:00Z",
  "uptime": 12345.67
}
```
This endpoint reports service liveness only; it does not imply inference models
are available. Use `GET /api/v1/system/models` for non-loading model readiness
and CUDA availability.

### System Information

```http
GET /api/v1/system/info
```

**Response:**
```json
{
  "system": {
    "platform": "Linux-6.8.0-60-generic-x86_64",
    "python_version": "3.10.x",
    "cpu_count": 8,
    "memory_total": 32000000000,
    "memory_available": 16000000000
  },
  "application": {
    "version": "0.1.0",
    "environment": "development"
  }
}
```

### Auth Status

```http
GET /api/v1/system/auth-status
```

**Response:**
```json
{
  "user_auth_enabled": false,
  "api_key_required": false,
  "mode": "simple",
  "description": "Simple mode - All clients can see all jobs"
}
```

---

## File Upload APIs

### Upload Image

```http
POST /api/v1/file-upload/image
Content-Type: multipart/form-data

{
  "file": "<binary image file>",
  "file_type": "image"
}
```

**Response (200):**
```json
{
  "file_id": "img_abc123",
  "filename": "reference.png",
  "file_type": "image",
  "file_size_mb": 2.5,
  "upload_time": "2026-09-21T00:00:00Z",
  "expires_at": "2026-09-22T00:00:00Z",
  "url": "/api/v1/file-upload/download/img_abc123"
}
```

### Upload Mesh

```http
POST /api/v1/file-upload/mesh
Content-Type: multipart/form-data

{
  "file": "<binary mesh file>",
  "file_type": "mesh"
}
```

**Response (200):**
```json
{
  "file_id": "mesh_abc123",
  "filename": "model.obj",
  "file_type": "mesh",
  "file_size_mb": 15.3,
  "upload_time": "2026-09-21T00:00:00Z",
  "expires_at": "2026-09-22T00:00:00Z",
  "url": "/api/v1/file-upload/download/mesh_abc123"
}
```

### Download File

```http
GET /api/v1/file-upload/download/{file_id}
```

**Response (200):** Direct binary stream of the uploaded file or registered output mesh asset.

### Get File Metadata

```http
GET /api/v1/file-upload/metadata/{file_id}
```

**Response:**
```json
{
  "file_id": "img_abc123",
  "filename": "reference.png",
  "file_type": "image",
  "file_size_mb": 2.5,
  "upload_time": "2026-09-21T00:00:00Z",
  "is_available": true
}
```

### Delete File

```http
DELETE /api/v1/file-upload/{file_id}
```

---

## Smart Generation APIs

### Smart Generation
`POST /api/v1/smart-generation/generation` accepts an image input, one of the five built-in intent IDs, an optional explicit model override, preprocessing/auto-rig/printability controls, and safe preset overrides. It resolves a ready image-capable model deterministically, submits through the existing image raw/textured generation scheduler path, and returns `job_id`, selected model, applied preset, candidate order, and effective configuration.

`GET /api/v1/smart-generation/presets` returns the versioned YAML preset definitions. `POST /api/v1/smart-generation/resolve` returns the deterministic model-selection decision without submitting a job.

## Mesh Generation APIs

```http
POST /api/v1/mesh-generation/image-to-raw-mesh
Content-Type: application/json

{
  "image_file_id": "img_abc123",
  "output_format": "glb",
  "model_preference": "hunyuan3d_shape_v21_image_to_raw_mesh",
  "model_parameters": {}
}
```

**Response (202):**
```json
{
  "job_id": "gen_abc123",
  "status": "queued",
  "message": "Generation job queued"
}
```

### Image-to-Raw Mesh

Generate a 3D mesh from an uploaded image.

```http
POST /api/v1/mesh-generation/image-to-raw-mesh
Content-Type: application/json

{
  "image_file_id": "img_abc123",
  "output_format": "glb",
  "model_preference": "hunyuan3d_shape_v21_image_to_raw_mesh",
  "model_parameters": {}
}
```

### Image-to-Textured Mesh

Generate a textured 3D mesh from an uploaded image.

```http
POST /api/v1/mesh-generation/image-to-textured-mesh
Content-Type: application/json

{
  "image_file_id": "img_abc123",
  "output_format": "glb",
  "model_preference": "trellis_image_to_textured_mesh",
  "model_parameters": {}
}
```

### Text Mesh Painting

Paint textures onto an existing mesh using text prompts.

```http
POST /api/v1/mesh-generation/text-mesh-painting
Content-Type: application/json

{
  "mesh_file_id": "mesh_abc123",
  "text_prompt": "Apply metallic red paint",
  "model_preference": "trellis_text_mesh_painting"
}
```

### Image Mesh Painting

Paint textures onto an existing mesh using an image reference. Supports Hunyuan3D-Paint-v2-1 with configurable texture resolution (512/768), max view counts (6-12), and PBR state tracking.

```http
POST /api/v1/mesh-generation/image-mesh-painting
Content-Type: application/json

{
  "mesh_file_id": "mesh_abc123",
  "image_file_id": "img_abc123",
  "model_preference": "hunyuan3d_paint_v21_image_mesh_painting",
  "model_parameters": {
    "resolution": 512,
    "max_num_view": 6,
    "generate_pbr": true
  }
}
```

### Image-to-Textured Mesh

For Hunyuan3D, texture generation is a two-stage workflow: submit Shape-v2-1 or DiT-v2-mini-Turbo through `image-to-raw-mesh`; when texture generation is enabled in the Workspace, the client automatically chains the resulting mesh into `hunyuan3d_paint_v21_image_mesh_painting`. The generic `image-to-textured-mesh` endpoint remains available for models that natively implement that feature, such as TRELLIS.

### Get Job Status

```http
GET /api/v1/mesh-generation/status/{job_id}
```

**Response:**
```json
{
  "job_id": "gen_abc123",
  "status": "processing",
  "stage": "inference",
  "progress": 0.45,
  "output_path": null,
  "error": null
}
```

### Cancel Job

```http
POST /api/v1/mesh-generation/cancel/{job_id}
```

### Available Models

```http
GET /api/v1/mesh-generation/models
```

**Response:**
```json
{
  "image_to_raw_mesh": ["hunyuan3d_shape_v21_image_to_raw_mesh", "hunyuan3d_dit_v2_mini_turbo_image_to_raw_mesh", "triposr_image_to_raw_mesh", "triposg_image_to_raw_mesh", "triposf_image_to_raw_mesh", "partpacker_image_to_raw_mesh", "ultrashape_image_to_raw_mesh", "unique3d_image_to_raw_mesh"],
  "image_to_textured_mesh": ["trellis_image_to_textured_mesh", "trellis2_image_to_textured_mesh"],
  "text_mesh_painting": ["trellis_text_mesh_painting"],
  "image_mesh_painting": ["trellis_image_mesh_painting", "trellis2_image_mesh_painting", "hunyuan3d_paint_v21_image_mesh_painting"],
  "mesh_segmentation": ["partfield_mesh_segmentation", "p3sam_mesh_segmentation"],
  "auto_rig": ["unirig_auto_rig"],
  "motion_generation": ["ardy_motion_generation"],
  "mesh_retopology": ["fastmesh_v1k_retopology", "fastmesh_v4k_retopology"],
  "uv_unwrapping": ["partuv_uv_unwrapping"],
  "text_mesh_editing": ["voxhammer_text_mesh_editing"],
  "image_mesh_editing": ["voxhammer_image_mesh_editing"],
  "image_to_multiview": ["zero123plus_v12_image_to_multiview"]
}
```

### Model Parameters Schema

```http
GET /api/v1/mesh-generation/models/{model_id}/parameters
```

---

## Mesh Editing APIs

### Text Edit

Edit an existing mesh using a text prompt.

```http
POST /api/v1/mesh-editing/text-edit
Content-Type: application/json

{
  "mesh_file_id": "mesh_abc123",
  "text_prompt": "Add a horn to the top",
  "model_preference": "voxhammer_text_mesh_editing"
}
```

### Image Edit

Edit an existing mesh using an image reference.

```http
POST /api/v1/mesh-editing/image-edit
Content-Type: application/json

{
  "mesh_file_id": "mesh_abc123",
  "image_file_id": "img_abc123",
  "model_preference": "voxhammer_image_mesh_editing"
}
```

---

## Auto Rigging APIs

### Generate Rig

Generate a bipedal armature for a mesh.

```http
POST /api/v1/auto-rigging/generate-rig
Content-Type: application/json

{
  "mesh_file_id": "mesh_abc123",
  "rig_mode": "biped",
  "output_format": "fbx",
  "model_preference": "unirig_auto_rig"
}
```

**Response:**
```json
{
  "job_id": "rig_abc123",
  "status": "queued"
}
```

---

## Motion Generation APIs

### Generate Motion (ARDY)

Synthesize kinematically valid 3D human motion from a natural language text prompt using ARDY. Produces browser-playable `motion.json` format for Three.js.

```http
POST /api/v1/motion-generation/generate-motion
Content-Type: application/json

{
  "prompt": "Character walks forward and waves with the right hand",
  "duration": 4.0,
  "seed": 42,
  "output_format": "json",
  "model_preference": "ardy_motion_generation",
  "model_parameters": {
    "checkpoint": "ardy_lite",
    "post_process": true
  }
}
```

**Response:**
```json
{
  "job_id": "motion_abc123",
  "status": "queued",
  "message": "Motion generation job queued successfully"
}
```

### Available Checkpoints

Query installed and supported ARDY motion checkpoints.

```http
GET /api/v1/motion-generation/checkpoints
```

**Response:**
```json
{
  "checkpoints": ["ardy_full", "ardy_lite"],
  "default": "ardy_lite"
}
```

---

## Mesh Tools APIs

The migrated mesh-processing tools are exposed by the main FastAPI process. Browser requests use the same-origin `/api/v1` proxy; there is no direct port 8200 dependency.

| Endpoint | Method | Contract |
|---|---|---|
| `/api/v1/mesh-tools/inspect` | POST | JSON game-ready inspection |
| `/api/v1/mesh-tools/auto-uv` | POST | SSE mesh result |
| `/api/v1/mesh-tools/auto-retopo` | POST | SSE mesh result |
| `/api/v1/mesh-tools/repair` | POST | SSE mesh result |
| `/api/v1/mesh-tools/optimize` | POST | JSON optimized mesh |
| `/api/v1/mesh-tools/lods` | POST | JSON LOD set |
| `/api/v1/mesh-tools/collision` | POST | SSE collision scene |
| `/api/v1/mesh-tools/bake` | POST | SSE texture maps |
| `/api/v1/mesh-tools/flatten` | POST | SSE texture map |
| `/api/v1/mesh-tools/convert` | POST | SSE FBX result |
| `/api/v1/mesh-tools/segment` | POST | SSE segmentation hierarchy |

### Production post-process retry

`POST /api/v1/system/jobs/{job_id}/postprocess/retry` rebuilds derived artifacts from immutable `master/source.glb` without re-running model inference.

### Canonical artifact manifest

Mesh-producing terminal results include `result.artifacts`. Each artifact declares `status`, `url`, and `required`. The successful production contract requires the master, game-ready GLB, and quality report; optional exports are explicitly represented as unavailable, skipped, or ready.


## Mesh Segmentation APIs

### Segment Mesh

Segment a mesh into semantic parts.

```http
POST /api/v1/mesh-segmentation
Content-Type: application/json

{
  "mesh_file_id": "mesh_abc123",
  "model_preference": "partfield_mesh_segmentation"
}
```

---

## Mesh Retopology APIs

### Retopologize Mesh

Retopologize a mesh using the fixed FastMesh V1K/V4K variant contract.

```http
POST /api/v1/mesh-retopology/retopologize-mesh
Content-Type: application/json

{
  "mesh_file_id": "mesh_abc123",
  "model_preference": "fastmesh_v4k_retopology",
  "poly_type": "quad",
  "target_vertex_count": 4000,
  "target_polycount": 35000,
  "output_format": "glb"
}
```

FastMesh does not support arbitrary model vertex targets. V1K is the ~1K-vertex variant and V4K is the ~4K-vertex variant; when target_vertex_count is supplied, it must match the selected variant. `target_polycount` is the final production triangle budget applied by the canonical post-processing stage after FastMesh; it accepts 5,000–200,000 triangles. `poly_type` controls triangle vs quad output.

For generation jobs, `target_polycount` is **never an inference-quality control**. The scheduler removes this production-only field (along with `auto_optimize` and LOD/physics controls) before neural model adapters run. The raw model output is requested at the registered model's maximum supported geometry fidelity, persisted unchanged as `master/source.glb`, and only then reduced to the requested production budget.

---

## Mesh UV Unwrapping APIs

### Unwrap Mesh UVs

Unwrap a mesh's UV coordinates.

```http
POST /api/v1/mesh-uv-unwrapping
Content-Type: application/json

{
  "mesh_file_id": "mesh_abc123",
  "model_preference": "partuv_uv_unwrapping",
  "pack_method": "default"
}
```

---

## Users APIs (Multi-Worker Mode)

### Register

```http
POST /api/v1/users/register
Content-Type: application/json

{
  "username": "admin",
  "password": "secret"
}
```

### Login

```http
POST /api/v1/users/login
Content-Type: application/json

{
  "username": "admin",
  "password": "secret"
}
```

**Response:**
```json
{
  "token": "jwt_token",
  "user_id": "user_abc123"
}
```

### Get Current User

```http
GET /api/v1/users/me
Authorization: Bearer <token>
```

---

## Error Handling

| Error Code | Condition |
|------------|-----------|
| `MODEL_NOT_FOUND` | Model preference is not available for the feature |
| `MODEL_NOT_READY` | Model is not installed or weights are missing |
| `INSUFFICIENT_VRAM` | Not enough VRAM for the requested generation |
| `FILE_NOT_FOUND` | Uploaded file ID does not exist or has expired |
| `INVALID_FORMAT` | Output format is not supported |
| `RATE_LIMITED` | Too many requests within the rate limit window |
| `AUTH_REQUIRED` | Authentication is required but not provided |

---

## Deployment Modes

### Single-Worker Mode

```bash
cd backend && conda activate 3daigc-api
uvicorn api.main_singleworker:app --workers 1 --port 7842
```

- Embedded async scheduler
- No external broker needed
- Best for simple deployments

### Multi-Worker Mode

```bash
# Terminal 1: Start Redis
redis-server

# Terminal 2: Start scheduler service
conda activate 3daigc-api
python backend/scripts/scheduler_service.py

# Terminal 3: Start API workers
cd backend && conda activate 3daigc-api
uvicorn api.main_multiworker:app --workers 4 --port 7842
```

- Redis-backed job queue
- Multiple uvicorn workers
- Cross-worker file metadata sharing
- Optional Redis-based authentication

---

## WebSocket/SSE Events

The frontend observes durable job state by polling `GET /api/v1/system/jobs/{job_id}`. Mesh-tool operations use Server-Sent Events (SSE) for operation-level progress.

Event types:
- `queued`: Job has been accepted and queued
- `processing`: Job is currently executing
- `progress`: Stage progress update (0.0–1.0)
- `completed`: Job finished successfully with output path
- `failed`: Job failed with error message
- `cancelled`: Job was cancelled by the user

## Phase 1 Generation Workflow APIs

- POST /api/v1/image-enhancement/preview creates a deterministic Generation Preview artifact and returns preview/approved URLs plus provenance metadata.
- GET /api/v1/image-enhancement/artifacts/{artifact_id}?variant=preview|approved serves the exact preview/approved artifact.
- GET /api/v1/smart-generation/presets returns the versioned intent definitions.
- POST /api/v1/smart-generation/resolve resolves an intent to a ready, compatible Image → 3D model and applied preset; an explicit model is validated as an override.
- Image→raw and image→textured requests accept intent, preprocessing_artifact_id, enhancement_enabled, enable_printability_check, enable_auto_repair, enable_auto_rig, and auto_rig_mode.
- Completed auto-rig workflows expose rigged_model_url and the standard download endpoint accepts artifact_format=rigged.

## High-Fidelity Result and Resource Metadata — 2026-10-08

Production mesh-generation results may additionally expose:
- `high_fidelity_url`: immutable master download URL
- `quality_mode`: selected quality profile
- `texture_resolution`: resolved bake/UV resolution
- `master_to_derivative`: diagnostic fidelity report
- `quality_trace`: per-stage quality metadata

System/status responses now expose resource planning metadata including CPU count, per-worker CPU-thread policy and GPU capacity snapshots. Multi-GPU placement is only reported when the selected adapter declares a supported strategy.
