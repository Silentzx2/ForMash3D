# ForMesh 3D — Complete API Documentation

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

The ForMesh 3D REST API follows RESTful conventions and returns JSON responses. All endpoints are prefixed with `/api/v1`.

### Standard Response Format

```json
{
  "api_version": "1",
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

This shape is returned by the custom exception handlers (`BaseAPIException`, `ValueError`, 404 and 500). Plain FastAPI `HTTPException` responses use the standard `{"detail": "..."}` body.

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
| `409` | Conflict | Preprocessing artifact is not approved (or is flagged and no review override was supplied) |
| `422` | Validation Error | Invalid request body |
| `429` | Too Many Requests | Rate limit exceeded |
| `500` | Internal Server Error | Server-side error |

---

## Authentication

The API supports simple mode and optional authentication, controlled by `P3D_USER_AUTH_ENABLED` and `security.api_key_required`:

- **Simple Mode**: endpoints do not require a bearer credential, but the API-level request-rate limit still applies.
- **Authenticated Mode**: user tokens are checked against the Redis-backed auth store, including active status and expiry.
- **Server API key**: set the secret environment variable `P3D_API_KEY` when `security.api_key_required: true`. Send it as `Authorization: Bearer <P3D_API_KEY>`. The key is compared in constant time and must never be committed to the repository. If API-key protection is required but neither a configured server key nor usable user auth service is available, protected endpoints fail closed rather than accepting an arbitrary token.

### Rate limiting

Rate limiting is controlled by `security.rate_limit_enabled` and `security.rate_limit_per_minute` in `backend/config/system.yaml`. In personal/self-hosted deployment, rate limiting is disabled by default (`rate_limit_enabled: false`, `rate_limit_per_minute: 0`) so local frontend polling (job status, telemetry HUD, client logging) is never blocked. When enabled, requests are limited per immediate peer IP; exceeding the fixed-window limit returns HTTP `429` and a `Retry-After` header. Multi-worker deployments use an atomic counter in the existing Redis connection; single-worker deployments use a process-local counter. Reverse-proxy limits are recommended as an additional perimeter control. When deployed behind a reverse proxy, configure trusted-proxy behavior at the ASGI/server layer; arbitrary `X-Forwarded-For` values are not trusted.

---

## System APIs

### Live Log Stream (SSE)

```http
GET /api/v1/system/logs/stream?file=master.log&tail=<N>
Accept: text/event-stream
```

The Admin Logs tab consumes this endpoint as raw UTF-8 text. On a fresh connection, `tail` selects recent lines and is clamped to the configured range; omitting it uses `logging.stream.default_tail_lines` from `backend/config/system.yaml`. `tail=0` seeks to EOF and only follows new writes. The initial seek scans backward up to `logging.stream.max_tail_scan_bytes`, so normal first-paint cost does not depend on older file history.

Query parameters:

- `file` (string, default `master.log`): a strict allowlisted `.log` basename inside the repository `logs/` directory. Missing or invalid files return `404`.
- `tail` (integer, optional): initial line count; bounded by `logging.stream.max_tail_lines`. Applied only to a fresh connection.
- `offset` (integer, optional): byte offset used when starting or resuming explicitly.
- `identity` (string, optional): file identity paired with `offset` to detect replacement.
- `Last-Event-ID` (request header): automatically sent by `EventSource` on reconnect and takes precedence over query offsets.

Each message carries a JSON payload with `identity`, the next byte `offset`, and unmodified `chunk` text. SSE event IDs retain the `device:inode:offset` form. A named `reset` event tells the client to clear its view after truncation or replacement; the client then resumes from the new file identity. Partial lines, CR/CRLF progress output, blank lines and Unicode are not parsed into records.

The transport is SSE-only and uses the non-buffering Next.js proxy. The legacy WebSocket transport is not exposed. Existing `GET /api/v1/system/logs/files`, `GET /api/v1/system/logs/files/{filename}?lines=...`, and `DELETE /api/v1/system/logs/files/master.log` endpoints remain available; Clear truncates the active file in place.


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
    "version": "1.0.0",
    "environment": "development",
    "debug": false
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
  "description": "Simple mode - All clients can see all jobs",
  "features": {
    "job_isolation": false,
    "user_management": false,
    "role_based_access": false
  },
  "timestamp": "2026-09-21T00:00:00Z"
}
```

### Database Administration

Mounted at `/api/v1/system/database` and backing the admin Database tab (`/admin?tab=database`). Every endpoint requires the API key (`verify_api_key`); when a user is authenticated, the **admin** role is required (`403` otherwise).

**Safety model**: every destructive endpoint requires an explicit typed confirmation token in the JSON body. A job's canonical asset workspace under `backend/storage/models/meshes/<asset>_<job_id>/` is removed **only after** the durable dual-store deletion (Redis hot keys + SQLite row, ADR-062) succeeds, and every path is validated against the storage root before removal. The job-key sweep never touches user/token auth keys.

#### Database Statistics

```http
GET /api/v1/system/database/stats
```

**Response (200):** Combined view of both stores plus on-disk footprint.
```json
{
  "sqlite": {
    "available": true,
    "queued_jobs": 2,
    "processing_jobs": 1,
    "completed_jobs": 10,
    "failed_jobs": 1,
    "cancelled_jobs": 0,
    "total_jobs": 14,
    "database_size_bytes": 204800
  },
  "redis": {
    "available": true,
    "used_memory": 1048576,
    "used_memory_human": "1.00M",
    "keys": 42
  },
  "queue": {
    "queued_jobs": 2,
    "processing_jobs": 1
  },
  "file_metadata": {
    "available": true,
    "count": 7
  },
  "disk": {
    "storage_root": "/app/backend/storage",
    "job_queue_db_bytes": 204800,
    "meshes_bytes": 52428800,
    "uploads_bytes": 1048576
  }
}
```

#### Inspect Redis Keys

```http
GET /api/v1/system/database/keys?pattern=3daigc:*&limit=500
```

**Query Parameters:**
- `pattern` (string, default `3daigc:*`): Redis SCAN match pattern.
- `limit` (int, 1..1000, default 500): Maximum keys returned.

**Response (200):**
```json
{
  "pattern": "3daigc:*",
  "keys": [
    { "key": "3daigc:jobs", "type": "hash", "size": 14, "ttl": -1 }
  ],
  "count": 1,
  "truncated": false
}
```
Read-only. Returns `503` when Redis is unavailable.

#### Bulk Delete Jobs

```http
DELETE /api/v1/system/database/jobs
Content-Type: application/json

{
  "confirm": true,
  "job_ids": ["gen_abc123"],
  "status": "completed",
  "feature": "image_to_raw_mesh",
  "force": false
}
```

- **Body**: `confirm` must be `true`; a selector of `job_ids` (explicit list), `status`, or `feature` is required (`400` without one; an explicit `job_ids` list takes precedence over `status`/`feature`).
- **Safety**: running/queued (non-terminal) jobs are **skipped** unless `force: true`; each selected job is removed from Redis hot keys and the SQLite jobs table (reusing `RedisJobQueue.delete_job`, ADR-062) and its asset workspace is deleted only after the durable delete succeeds.
- **Response (200):** `{"deleted": n, "skipped": n, "failed": n, "results": [...]}` where each result carries `job_id`, `deleted`, a `reason` (e.g. `status=processing (not terminal)`, `not_found`), and `asset_workspace_deleted` / `cleanup_error` when deleted.
- **400**: Missing `confirm`, or no selector provided.

#### Clear All Jobs

```http
POST /api/v1/system/database/jobs/clear
Content-Type: application/json

{
  "confirm": "CLEAR_ALL_JOBS"
}
```

**Safety:** requires the exact typed token `CLEAR_ALL_JOBS` (`400` otherwise). Enumerates every job id from Redis + SQLite, deletes each with its asset workspace, sweeps remaining job-owned Redis keys (`3daigc:jobs`, `3daigc:progress`, `3daigc:stage`, `3daigc:message`, `3daigc:queue:*`, `3daigc:completed_at`, `3daigc:cancel_requested`, `3daigc:result:*` — **never** `3daigc:user*` / `3daigc:token*` / `3daigc:users:all` auth keys), deletes every SQLite job row, removes every job workspace directory under `storage/models/meshes`, then VACUUMs SQLite. **Uploads and file metadata are preserved.**

**Response (200):** `{"jobs_deleted", "jobs_failed", "redis_keys_swept", "sqlite_rows_deleted", "workspaces_removed", "workspace_errors", "vacuum_error", "message"}`

#### Clear All Files

```http
DELETE /api/v1/system/database/files/clear
Content-Type: application/json

{
  "confirm": "CLEAR_ALL_FILES"
}
```

**Safety:** requires the exact typed token `CLEAR_ALL_FILES` (`400` otherwise). Deletes all file metadata (Redis `3daigc:file:*` / `3daigc:files:*`) and the referenced upload files on disk. **Job records and asset workspaces are preserved.**

**Response (200):** `{"file_metadata_removed", "redis_keys_swept", "errors", "message"}`

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
  "expires_at": null,
  "url": "/api/v1/file-upload/download/mesh_abc123"
}
```

Textual `.gltf` uploads must be self-contained single files: buffers use embedded data URIs, and images use embedded data URIs or valid buffer views. Relative/remote dependencies and missing sidecars are rejected; upload a self-contained GLB or embed the resources before uploading.

### Download File

```http
GET /api/v1/file-upload/download/{file_id}
```

**Response (200):** Direct binary stream of the uploaded file or registered output mesh asset.

### Get Thumbnail

```http
GET /api/v1/file-upload/thumbnail/{file_id}
```

**Response (200):** Direct binary stream of the persistent 256x256 thumbnail preview for the uploaded image or asset. If a dedicated thumbnail does not yet exist, generates or falls back to the original source image stream.

### List Uploaded Files

```http
GET /api/v1/file-upload/list
```

**Response (200):** List of metadata objects for all registered uploaded assets, including `url` and `thumbnail_url`.

```json
[
  {
    "file_id": "img_abc123",
    "filename": "reference.png",
    "file_type": "image",
    "file_size_mb": 2.5,
    "upload_time": "2026-10-09T00:00:00Z",
    "url": "/api/v1/file-upload/download/img_abc123",
    "thumbnail_url": "/api/v1/file-upload/thumbnail/img_abc123"
  }
]
```

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
`POST /api/v1/smart-generation/generation` accepts an image input, one of the six canonical intent IDs (`mobile`, `game_ready`, `cinematic`, `animation`, `3d_print`, `native`), an optional explicit model override, preprocessing/auto-rig/printability controls, and safe preset overrides. It resolves a ready image-capable model deterministically, submits through the existing image raw/textured generation scheduler path, and returns `job_id`, selected model, applied preset, candidate order, and effective configuration.

`GET /api/v1/smart-generation/presets` returns the versioned YAML preset definitions. `POST /api/v1/smart-generation/resolve` returns the deterministic model-selection decision without submitting a job. It answers `400` with an actionable `detail` when the intent is unknown, when an explicit model is not registered or is incompatible with the intent, when that model's weights are missing, or when it does not fit the currently free VRAM. The endpoint is a report, not a gate: a client may submit generation without it, because the generation endpoints re-resolve the intent and the scheduler owns model readiness and resource admission (ADR-094).

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
  "api_version": "1",
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
  "candidate_count": 1,
  "intent": "game_ready",
  "enable_postprocess": true,
  "target_polycount": 35000,
  "topology_mode": "triangle",
  "quad_topology": false,
  "bake_normal_maps": true,
  "generate_lod": true,
  "lod_preset": "high",
  "lod_count": 4,
  "enable_auto_repair": true,
  "physics_enabled": false,
  "texture_enabled": false,
  "model_parameters": { "seed": 42 }
}
```

`model_parameters` carries the runtime seed only; an explicit seed of `0` is valid. Model-specific steps, guidance, samplers, and extraction settings are adapter-owned and are not user request overrides. Production fields are resolved separately from inference inputs.

`texture_resolution` is only sent when the texture stage is enabled; it is a numeric atlas size (1024/2048/4096/8192).

#### Request Fields Specification

| Field | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `image_file_id` / `image_base64` / `image_path` | string | *required (exactly one)* | Uploaded reference image file ID, data URI, or local path |
| `asset_name` | string | `null` | Asset base stem name |
| `image_name` | string | `null` | Original image filename |
| `output_format` | string | `"glb"` | Only `glb` is accepted |
| `model_preference` | string | `null` | Explicit model override; the intent preset chooses a model when omitted |
| `auto_mode` | boolean | `null` | Enable smart auto-selection of the generation model. `false` with an explicit `model_preference` pins that model |
| `intent` | string | `null` | Smart-generation intent: `mobile`, `game_ready`, `cinematic`, `animation`, `3d_print`, `native` |
| `candidate_count` | integer | `1` | Candidate variations to generate (1 to 4). Seeds step deterministically |
| `model_parameters` | object | `null` | Model-specific parameters. Only `seed` is forwarded to the adapter |
| `target_polycount` | integer | `null` | Target triangle budget. See the precedence rules below for `> 0`, `0` and `-1` |
| `enable_postprocess` | boolean | `true` | Run the production post-processing pipeline. `false` bypasses it and yields the raw/native output |
| `texture_enabled` / `generate_texture` | boolean | `null` | Run the post-processing texture stage on the generated master |
| `texture_resolution` | integer | `null` | Texture atlas size (1024/2048/4096/8192). The named presets `1K`/`2K`/`4K`/`8K` are normalized to those sizes |
| `bake_normal_maps` | boolean | `true` | Bake high-frequency detail normal maps from the master source |
| `topology_mode` | string | `"triangle"` | `triangle` or `quad` |
| `quad_topology` | boolean | `false` | Request quad-dominant topology |
| `generate_lod` | boolean | `null` | Build the multi-resolution chain (LOD0 through LOD3) |
| `lod_preset` | string | `null` | LOD ratio preset: `mobile`, `low`, `medium`, `high` or `cinematic` |
| `lod_count` | integer | `null` | Number of LOD levels to build (0 to 4); `0` disables the LOD chain |
| `physics_enabled` | boolean | `null` | Request physics-ready post-processing (watertight CoACD convex hull collision mesh) |
| `physics_config` | object | `null` | Provider-neutral physics controller values |
| `enable_printability_check` | boolean | `null` | Run the final printability QA |
| `enable_auto_repair` | boolean | `null` | Allow the shared repair stage to mutate the mesh for printability |
| `enable_auto_rig` | boolean | `null` | Run UniRig after production processing |
| `auto_rig_mode` | string | `"full"` | UniRig mode: `full`, `skeleton`, or `skin` |
| `preprocessing_artifact_id` | string | `null` | Approved preprocessing artifact ID |
| `preprocessing_review_override` | boolean | `false` | Explicitly allow a `needs_review` preview after review |
| `enhancement_enabled` | boolean | `false` | Use the approved preprocessing artifact |
| `quality_mode` | string | `"high"` | Target quality budget (`fast`, `balanced`, `high`; other values fall back to `balanced` for planner routing) |
| `input_prep` | object | `null` | Input image preparation overrides (background removal, crop, resize, upscale) |
| `mesh_style`, `requested_quality`, `object_type`, `symmetry` | string | *deprecated* | Accepted for planner routing only; never used for inference |

There is no `output_preset`, `auto_optimize` or `physics_collider` request field, and no camelCase `generateLOD` / `lodPreset` / `lodCount` request field.

#### Preset Precedence Rules
Per production option the resolution order is: **explicit request value > intent preset > backend default**.

1. **Explicit request value wins**: If a field is provided in the request body (e.g. `target_polycount: 15000`), it overrides the preset default.
2. **Intent preset fills omitted fields**: Unspecified fields take their default from the matching intent preset in `backend/config/smart_presets.yaml`.
3. **Backend default is the last fallback**: When neither the request nor the intent preset supplies a value, the backend default applies.
4. **Tri-state (optional) fields**: `texture_resolution`, `enable_printability_check`, `enable_auto_repair`, `enable_auto_rig`, `physics_enabled`, `generate_lod`, `lod_preset` and `lod_count` default to "not supplied". Omitting them lets the intent preset provide the default; supplying an explicit value (including `false` or `0`) always wins.
5. **`target_polycount`**: an explicit value greater than `0` wins, and the `-1` native sentinel also wins. `0` means "no explicit budget" and falls back to the intent preset. The Native/Raw output is expressed with `intent: native` or `enable_postprocess: false`.
6. **Legacy `model_parameters` keys are ignored**: `generateLOD`, `lodPreset` and `lodCount` are popped from `model_parameters` and never reach job inputs.
7. **Deprecated routing fields**: `requested_quality`, `mesh_style`, `object_type` and `symmetry` are still accepted, but they are used only for planner routing and never for inference. The scheduler strips them from adapter inputs.
8. **Adapter inference profiles are immutable**: Frontend or request-side inference keys (`num_inference_steps`, `guidance_scale`, `octree_resolution`, `sampler_overrides`, `requested_quality`, `meshQuality`) are stripped by the scheduler before invoking the model adapter. Adapters execute their locked native inference schedule (`_LOCKED_INFERENCE_PROFILE`).

#### Intent Presets (`backend/config/smart_presets.yaml`, version 1)

| Intent | `target_polycount` | `texture_resolution` | LOD | Other |
|---|---|---|---|---|
| `mobile` | 20000 | 1024 | `mobile` preset, 4 levels | — |
| `game_ready` | 50000 | 1024 | `high` preset, 4 levels | collision on |
| `cinematic` | 200000 | 2048 | `high` preset, 4 levels | — |
| `animation` | 30000 | 1024 | `high` preset, 4 levels | auto-rig on |
| `3d_print` | 0 (no explicit budget) | 0 (no atlas) | LOD off | printability check + auto-repair on |
| `native` | `-1` (backend-only sentinel) | 0 (no atlas) | LOD off | raw/native output |

#### LOD Behaviour
The pipeline builds at most 4 levels (LOD0-LOD3) and clamps `lod_count` to 1-4. The `lod_preset` ratio presets are `mobile` `[1.0, 0.35, 0.12, 0.05]`, `low` `[1.0, 0.5, 0.2, 0.08]`, `medium` `[1.0, 0.5, 0.25, 0.125]`, `high` `[1.0, 0.6, 0.3, 0.15]` and `cinematic` `[1.0, 0.75, 0.5, 0.25]`.

#### Output Semantics & Artifact Tree
The API returns HTTP 202 with `{"api_version": "1", "job_id": "...", "status": "queued"}`. When execution completes:
- `master/source.glb`: Immutable raw mesh with SHA-256 hash in metadata.
- `game_ready/<name>.glb`: Production engine-ready model satisfying the target budget.
- `lods/lod[0-3].glb`: Multi-resolution chain (when `generate_lod` is enabled).
- `collision/collision.glb`: Watertight CoACD collision geometry (when `physics_enabled` is enabled).
- `metadata/asset.json`: Canonical manifest with stage trace and QA scores.


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

Paint textures onto an existing mesh using an image reference. The model's internal per-view settings (512/768) are independent from the requested final atlas dimension (1K/2K/4K/8K). RealESRGAN is enabled internally for Hunyuan Paint; there is no separate user-facing toggle.

```http
POST /api/v1/mesh-generation/image-mesh-painting
Content-Type: application/json

{
  "mesh_file_id": "mesh_abc123",
  "image_file_id": "img_abc123",
  "texture_resolution": 4096,
  "model_preference": "hunyuan3d_paint_v21_image_mesh_painting",
  "model_parameters": {}
}
```

`texture_resolution` selects the final atlas size (1024/2048/4096/8192); 1K/2K routes to Paint3D and 4K/8K to Hunyuan3D-Paint v2.1. Adapter-owned inference keys such as `resolution` or `max_num_view` are stripped by the scheduler before the adapter runs.

### Textured Generation Flow

Normal image-to-3D generation always submits the selected geometry model to `image-to-raw-mesh`. When Textured Generation is enabled, centralized post-processing receives the raw mesh, original reference-image file reference, and requested atlas preset: 1K/2K uses Paint3D; 4K/8K uses Hunyuan3D-Paint v2.1 with its internal RealESRGAN path enabled. The API accepts named presets (`"1K"`, `"2K"`, `"4K"`, `"8K"`) or numeric dimensions (1024/2048/4096/8192). The stage inspects the embedded base-colour texture in the exported GLB and reports success only when its observed square dimensions match the requested target. If texturing fails or the atlas cannot be verified, the immutable raw master is preserved and the texture-stage result reports failure. The legacy `image-to-textured-mesh` path remains for API compatibility; legacy geometry IDs resolve to raw-only aliases rather than re-enabling model-native texture generation.

### Get Job Status

```http
GET /api/v1/system/jobs/{job_id}
```

**Response:**
```json
{
  "api_version": "1",
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

`POST /api/v1/system/jobs/{job_id}/cancel` is the equivalent system-scoped route.

### Available Models

```http
GET /api/v1/system/models
```

**Response:**
```json
{
  "api_version": "1",
  "available_models": {
    "text_mesh_painting": ["trellis_text_mesh_painting"],
    "image_to_raw_mesh": [
      "hunyuan3d_shape_v21_image_to_raw_mesh",
      "hunyuan3d_dit_v2_mini_turbo_image_to_raw_mesh",
      "triposg_image_to_raw_mesh",
      "unique3d_image_to_raw_mesh",
      "pixal3d_image_to_raw_mesh",
      "pixal3d_image_to_3d",
      "trellis_image_to_3d",
      "trellis_image_to_raw_mesh",
      "trellis2_image_to_3d",
      "trellis2_image_to_raw_mesh"
    ],
    "image_to_textured_mesh": ["trellis_image_to_textured_mesh", "trellis2_image_to_textured_mesh"],
    "image_mesh_painting": [
      "trellis_image_mesh_painting",
      "trellis2_image_mesh_painting",
      "hunyuan3d_paint_v21_image_mesh_painting",
      "paint3d"
    ],
    "mesh_segmentation": [],
    "auto_rig": ["unirig_auto_rig"],
    "motion_generation": ["ardy_motion_generation"],
    "mesh_retopology": ["fastmesh_v1k_retopology", "fastmesh_v4k_retopology"],
    "uv_unwrapping": ["partuv_uv_unwrapping"]
  },
  "weights_status": { "...": true },
  "model_details": { "...": {} },
  "total_features": 9,
  "total_models": 22
}
```

Only models with `enabled: true` in `backend/config/models.yaml` are listed; `taoflowforge_image_to_raw_mesh` is registered but disabled. `GET /api/v1/system/models?feature=<feature>` narrows the response to one feature, and `GET /api/v1/system/features` lists the supported features with their model counts.

> **Important:** this endpoint is a manifest/catalog view. An entry in `available_models` or a positive weights indicator is not proof that all runtime dependencies are importable, the full checkpoint can load, the model fits the current GPU, or the produced geometry passes quality checks. Some model pipelines are reported to fail during initialization/loading; some others can return broken geometry. See [MODEL-STATUS.md](MODEL-STATUS.md) before treating a catalog entry as production-ready.

### Production generation controls

The image-to-raw and image-to-textured generation contracts accept the same production controls used by the workspace:

- `quality_mode`: the target quality budget (`fast`, `balanced`, `high`). A `cinematic` intent or a resolved target of at least 150,000 triangles raises the resolved quality to `ultra`.
- `target_polycount`: a downstream derivative budget; the immutable high-fidelity master is never reduced to satisfy it.
- `texture_resolution`: production atlas/bake resolution as a numeric atlas size (1024/2048/4096/8192). Model-native source texture settings remain separate from this downstream target.
- `generate_lod`, `lod_preset`, `lod_count`: derivative LOD controls. At most 4 levels (LOD0-LOD3) are built and `lod_count` is clamped to 1-4.
- `preprocessing_artifact_id` and `enhancement_enabled`: model-aware preprocessing provenance. Only validated artifacts are approved; failed artifacts are rejected. `preprocessing_review_override: true` explicitly allows a `needs_review` preview and is recorded in job provenance. It cannot override a failed preprocessing status.
- `enable_printability_check`, `enable_auto_repair`, `enable_auto_rig`, `auto_rig_mode`, and provider-neutral `physics_config`.

`texture_resolution`, `enable_printability_check`, `enable_auto_repair`, `enable_auto_rig`, `physics_enabled`, `generate_lod`, `lod_preset` and `lod_count` are tri-state: omit them to let the intent preset supply the default.

Completed jobs expose production metadata through `GET /api/v1/system/jobs/{job_id}`, including `source_model_url`, `high_fidelity_url`, `game_ready_url`, `production_status`, `degraded_reasons`, `quality_mode`, `target_polycount`, `texture_resolution`, `master_to_derivative`, `quality_trace`, `lod_validation`, and artifact status.

### Delete Job

```http
DELETE /api/v1/system/jobs/{job_id}
```

Purges the job from both the active Redis queue/hot keys and the persistent SQLite database store. Guarantees safe atomic removal without throwing 500 internal errors for previously completed, cancelled, or failed jobs.

### Job History

```http
GET /api/v1/system/jobs/history?limit=100&offset=0&status=completed&feature=image_to_raw_mesh
```

Returns durable job history (SQLite page, falling back to the Redis job listing when the SQLite page is empty). Every completed job carries canonical production artifact URLs regardless of what was persisted, so the workspace can resolve models and thumbnails from the backend after a page refresh or backend restart:

- `model_url`, `game_ready_url`, `download_url` — `/api/v1/system/jobs/{job_id}/download?artifact_format=glb` (game-ready GLB; the default viewer artifact)
- `source_model_url`, `high_fidelity_url` — `/api/v1/system/jobs/{job_id}/download?artifact_format=master` (immutable `master/source.glb`)
- `GET /api/v1/system/jobs/{job_id}/download?artifact_format=fbx` — native FBX from a completed rigging job or an already-baked game-ready FBX. Generic on-demand `trimesh` FBX conversion is unsupported and returns HTTP 422 when no actual FBX is available.
- `thumbnail_url` — `/api/v1/system/jobs/{job_id}/thumbnail` (rendered preview, input-image, or placeholder fallback)

Values populated by production post-processing are never overwritten; only missing URLs are backfilled.

### Multi-view APIs (Removed 2026-10-11)

The dedicated Zero123++ generation and multi-view reconstruction endpoints have been removed from the active API. Use the single-image `/api/v1/mesh-generation/image-to-raw-mesh` route for current image-to-3D requests.

### Model Parameters Schema

```http
GET /api/v1/system/models/{model_id}/parameters
```

---

## Mesh Editing APIs

### Text Edit

Edit an existing mesh using a text prompt.

```http
POST /api/v1/mesh-editing/text-mesh-editing
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
  "rig_mode": "full",
  "output_format": "fbx",
  "model_preference": "unirig_auto_rig"
}
```

`rig_mode` accepts `skeleton`, `skin` or `full` and defaults to `skeleton`; `output_format` accepts `fbx` or `glb` and defaults to `fbx`.

**Response:**
```json
{
  "job_id": "rig_abc123",
  "status": "queued",
  "message": "Auto-rigging job queued successfully"
}
```

---

## Motion Generation APIs

### Generate Motion (ARDY)

Synthesize kinematically valid 3D human motion from a natural language text prompt using ARDY. Produces browser-playable `motion.json` format for Three.js. ForMesh3D runs ARDY and its local LLM2Vec text encoder in CPU-only mode; no GPU VRAM is reserved, and inference is slower and bounded by host CPU/RAM.

```http
POST /api/v1/motion-generation/generate-motion
Content-Type: application/json

{
  "prompt": "Character walks forward and waves with the right hand",
  "duration": 4.0,
  "seed": 42,
  "checkpoint": "ARDY-Core-RP-20FPS-Horizon40",
  "post_process": true,
  "target_skeleton": "core",
  "model_preference": "ardy_motion_generation"
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
  "checkpoints": [
    "ARDY-Core-RP-20FPS-Horizon40",
    "ARDY-Core-RP-20FPS-Horizon8",
    "ARDY-G1-RP-25FPS-Horizon52",
    "ARDY-G1-RP-25FPS-Horizon8",
    "ardy_lite",
    "ardy_full"
  ],
  "default": "ARDY-Core-RP-20FPS-Horizon40",
  "checkpoint_details": [
    {
      "id": "ARDY-Core-RP-20FPS-Horizon40",
      "nickname": "core40",
      "skeleton": "core",
      "fps": 20,
      "horizon": 40,
      "description": "Core human skeleton, 20 FPS, 40-step horizon (recommended for standard characters)"
    }
  ]
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
POST /api/v1/mesh-uv-unwrapping/unwrap-mesh
Content-Type: application/json

{
  "mesh_file_id": "mesh_abc123",
  "model_preference": "partuv_uv_unwrapping",
  "pack_method": "blender"
}
```

`pack_method` accepts `blender`, `uvpackmaster` or `none` and defaults to `blender`; `distortion_threshold` defaults to `1.25`.

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
| `MODEL_LOAD_ERROR` | The model failed to load |
| `PROCESSING_ERROR` | The model failed while processing the request |
| `FILE_UPLOAD_ERROR` | An uploaded file could not be stored |
| `VALIDATION_ERROR` | A request field failed validation |
| `INVALID_VALUE` | An unsupported value was supplied |
| `CONFIG_ERROR` | The runtime configuration is invalid |
| `JOB_TIMEOUT` | A job exceeded its timeout |
| `CUDA_OOM` | The GPU ran out of memory during the job |
| `INPUT_NOT_FOUND` | The referenced input file could not be found |
| `JOB_CANCELLED` | The job was cancelled |
| `JOB_FAILED` | Any other job failure |
| `NOT_FOUND` | The requested resource does not exist |
| `INTERNAL_ERROR` | Unhandled server-side error |

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

- POST /api/v1/image-enhancement/preview creates a deterministic Generation Preview and returns `approval_status`, foreground-validation metrics, provenance, and a preview URL. An approved URL is returned only for validated foregrounds.
- GET /api/v1/image-enhancement/artifacts/{artifact_id}?variant=preview|approved serves the preview; requesting an unapproved artifact returns HTTP 409.
- GET /api/v1/smart-generation/presets returns the versioned intent definitions.
- POST /api/v1/smart-generation/resolve resolves an intent to a ready, compatible Image → 3D model and applied preset; an explicit model is validated as an override.
- Image→raw and image→textured requests accept intent, preprocessing_artifact_id, enhancement_enabled, preprocessing_review_override, enable_printability_check, enable_auto_repair, enable_auto_rig, and auto_rig_mode. A review override is required only for `needs_review`; `failed` artifacts cannot enter inference.
- Completed auto-rig workflows expose a GLB `rigged_model_url` for viewport display and retain the original native FBX separately for download. The `artifact_format=fbx` download option serves a real pre-exported FBX only; assets without one receive HTTP 422 rather than an unsupported generic `trimesh` conversion.

## High-Fidelity Result and Resource Metadata — 2026-10-08

Production mesh-generation results may additionally expose:
- `high_fidelity_url`: immutable master download URL
- `quality_mode`: selected quality profile
- `texture_resolution`: resolved bake/UV resolution
- `master_to_derivative`: diagnostic fidelity report
- `quality_trace`: per-stage quality metadata

System/status responses now expose resource planning metadata including CPU count, per-worker CPU-thread policy and GPU capacity snapshots. Multi-GPU placement is only reported when the selected adapter declares a supported strategy.

## Capability-Aware Generation and Quality Metadata — 2026-10-08

The runtime model-details response exposes a normalized capability contract. Relevant fields include modality, texture/PBR/vertex-color support, preprocessing/extraction preferences, preferred resolution/face budget, minimum VRAM, CPU policy, multi-GPU strategy, latency class and supported output formats.

Production generation results can include production_status, degraded_reasons, master_to_derivative, quality_trace, lod_validation, quality_mode, texture_resolution, cpu_threads, and high_fidelity_url.

### Offline A/B benchmark

The repository includes backend/scripts/run_model_ab_benchmark.py. It compares two completed asset directories only when input hashes and target production protocol match.

Command:

    cd backend
    python -m scripts.run_model_ab_benchmark --baseline-asset <baseline_asset_dir> --candidate-asset <candidate_asset_dir> --output <report.json>

Add --reference <reference_mesh.glb> only when a real ground-truth mesh exists. Without a reference, generated-vs-generated geometry metrics are explicitly diagnostic rather than absolute quality measurements.
