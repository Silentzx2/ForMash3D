# ForMash3D - Deep Production Audit - Fixes Applied

**Date:** 2026-10-04
**Branch:** Dev
**Status:** Critical Issues Fixed

---

## Summary

Applied critical fixes from the production audit (TASKS.md) to address:
1. **TRELLIS raw mesh micro-detail loss** - hole-filling mincut was destroying up to 30% geometry
2. **Scheduler worker race condition** - non-atomic check-then-set allowed double-submission
3. **API Proxy SSE abort handling** - incomplete cleanup on client disconnect
4. **TRELLIS postprocess mode** - added "none" mode to preserve raw model-native geometry
5. **TripoSF silent VRAM downshift** - made low-VRAM mode explicit opt-in with warning
6. **Auto UV texture preservation** - preserve source materials/textures/vertex_colors
7. **Text-to-3D raw vs textured alignment** - hide/disable `generateTexture` toggle for text-to-3D mode

---

## Changes Made

### 1. TRELLIS Adapter - Raw Extraction Preservation (`backend/adapters/trellis_adapter.py`)

**Issue:** `fill_holes=True` + mincut in `to_trimesh()` was removing "invisible" faces (up to 30% geometry loss) even when `simplify=0.0`. The `simplify=0.0` only disabled QEM decimation, NOT the hole-filling mincut.

**Fix:** Added `postprocess_mode="none"` when `simplify=0.0` to disable ALL post-processing (hole filling + mincut) for raw extraction:

```python
# In both TrellisTextToMeshAdapterCommon and TrellisImageToMeshAdapterCommon:
postprocess_mode = "none" if simplify == 0.0 else "simplify"
fill_holes = simplify != 0.0

mesh = self.postprocessing_utils.to_trimesh(
    outputs["gaussian"][0],
    candidate_mesh,
    simplify=simplify,
    fill_holes=fill_holes,
    texture_size=texture_resolution,
    texture_bake_mode=texture_bake_mode,
    forward_rot=True,
    postprocess_mode=postprocess_mode,  # NEW
)
```

---

### 2. TRELLIS postprocessing_utils.py - "none" Mode (`backend/thirdparty/TRELLIS/trellis/utils/postprocessing_utils.py`)

**Change:** Added "none" to `postprocess_mode` Literal type and early return:

```python
def postprocess_mesh(
    vertices: np.array,
    faces: np.array,
    postprocess_mode: Literal["none", "simplify", "remesh", "subdivision"] = "simplify",
    ...
):
    # "none" mode: skip all post-processing to preserve raw model-native geometry
    if postprocess_mode == "none":
        if verbose:
            tqdm.write("Postprocess mode: none - preserving raw model-native geometry")
        return vertices, faces
    ...
```

---

### 3. Scheduler Worker Race Condition (`backend/core/scheduler/multiprocess_scheduler.py`)

**Issue:** Worker busy check used stale `processing_job` - race condition allowed double-submission when job completed between check and mark.

**Fix:** Added per-worker `asyncio.Lock` and async check-and-mark:

```python
# Added worker_locks dict
self.worker_locks: Dict[str, asyncio.Lock] = {}

# Async find available worker with lock
async def _find_available_worker_async(self, worker_ids: List[str]) -> Optional[str]:
    for worker_id in worker_ids:
        if worker_id not in self.worker_locks:
            self.worker_locks[worker_id] = asyncio.Lock()
        
        async with self.worker_locks[worker_id]:
            proc = self.workers.get(worker_id)
            if proc and proc.is_alive() and not self.worker_status.get(worker_id, False):
                # Tentatively mark as busy to prevent race
                self.worker_status[worker_id] = True
                self.worker_last_used[worker_id] = time.time()
                return worker_id
    return None

# Async mark busy with double-check
async def _mark_worker_busy_async(self, worker_id: str, ...):
    async with self.worker_locks[worker_id]:
        if self.worker_status.get(worker_id, False):
            return False  # Already busy
        self.worker_status[worker_id] = True
        ...
        return True
```

---

### 4. API Proxy SSE Abort Handling (`app/api/v1/[...path]/route.ts`)

**Issue:** `streamResponse` didn't properly clean up on client disconnect, leaked connections.

**Fix:** Added client disconnect detection and upstream cancellation using ReadableStream:

```typescript
async function streamResponse(targetUrl: string, request: NextRequest): Promise<NextResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 1800000);
  
  // Track client disconnect
  let clientDisconnected = false;
  const onDisconnect = () => {
    clientDisconnected = true;
    controller.abort();
  };
  request.signal?.addEventListener('abort', onDisconnect);
  
  try {
    const response = await fetchWithBackendFallback(targetUrl, {
      method: 'GET',
      headers: { 'accept': 'text/event-stream', 'cache-control': 'no-cache', ...getAuthHeader(request) },
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    request.signal?.removeEventListener('abort', onDisconnect);
    
    // Wrap response body with ReadableStream that handles client disconnect
    if (response.body) {
      const reader = response.body.getReader();
      const stream = new ReadableStream({
        async start(controller) {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                controller.close();
                break;
              }
              controller.enqueue(value);
            }
          } catch (error) {
            controller.error(error);
          }
        },
        cancel() {
          // Client disconnected - cancel the upstream reader
          reader.cancel().catch(() => {});
        }
      });
      
      return new NextResponse(stream, { status: 200, headers });
    }
    ...
  } catch (error) {
    clearTimeout(timeoutId);
    request.signal?.removeEventListener('abort', onDisconnect);
    controller.abort();
    ...
  }
}
```

---

### 5. TripoSF Silent VRAM Downshift (`backend/adapters/triposf_adapter.py`)

**Issue:** On GPUs ≤16GB total VRAM or <12GB free VRAM, the adapter silently downshifted `resolution=1024→256` and `sample_points=1,638,400→409,600` with no user consent or UI warning. This permanently reduced geometric fidelity.

**Fix:** Made low-VRAM mode explicit opt-in with warning:

```python
# Check if user requested low VRAM mode
low_vram_mode = bool(inputs.get("low_vram_mode", False))

if low_vram_mode:
    pruning = True
    resolution = min(resolution, 256)
    sample_points_num = min(sample_points_num, 409_600)
    logger.info(
        "TripoSF low_vram_mode enabled: resolution=%d, pruning=True, sample_points=%d (total_vram=%dMB, free_vram=%dMB)",
        resolution, sample_points_num, total_vram_mb, free_vram_mb,
    )
elif total_vram_mb <= 16384 or free_vram_mb < 12288:
    # Warn but don't silently downshift - let user decide
    logger.warning(
        "TripoSF: GPU has limited VRAM (total=%dMB, free=%dMB). Consider enabling low_vram_mode to avoid OOM. "
        "Proceeding with full resolution (1024) and sample_points (1,638,400).",
        total_vram_mb, free_vram_mb,
    )
```

**Added `low_vram_mode` parameter to schema:**
```python
"low_vram_mode": {
    "type": "boolean",
    "description": "Enable low VRAM mode (downshifts resolution to 256, sample_points to 409,600). Required for GPUs with <12GB free VRAM to avoid OOM.",
    "default": False,
    "required": False,
},
```

---

### 6. Auto UV Texture Preservation (`backend/postprocess/services/auto_uv.py`)

**Issue:** UV unwrapping created a brand new Trimesh with ONLY new UVs + default PBRMaterial, completely discarding original materials/textures/vertex_colors.

**Fix:** Preserve native textures/materials from source mesh:

```python
# Preserve native textures/materials from the source mesh
source_visual = getattr(mesh, "visual", None)
source_material = getattr(source_visual, "material", None)
source_image = getattr(source_visual, "image", None)
source_vertex_colors = getattr(source_visual, "vertex_colors", None)

out.visual = trimesh.visual.TextureVisuals(
    uv=np.asarray(result.uv),
    material=source_material if source_material is not None else trimesh.visual.material.PBRMaterial(name="autouv"),
    image=source_image if source_image is not None else None,
)
if source_vertex_colors is not None:
    out.visual.vertex_colors = source_vertex_colors
```

---

### 7. Text-to-3D Raw vs Textured Alignment (`features/workspace/Panels/GeneratePanel.tsx`)

**Issue:** The `generateTexture` toggle was visible and could be disabled for text-to-3D models (like `trellis_text_to_textured_mesh`), but these models ALWAYS generate textures - the toggle was meaningless and misleading.

**Fix:** 
- Hide the PBR Texture toggle for text-to-3D models
- Force `generateTexture=true` for text-to-3D models
- Disable quad topology option when textures are generated (text-to-3D or user-enabled)
- Show "PBR TEXTURED" badge for text-to-3D models regardless of toggle state

```typescript
// Text-to-3D models (like trellis_text_to_textured_mesh) always generate textures - no toggle needed
const isTextTo3DModel = activeModelObj?.id === 'trellis_text_to_textured_mesh';
const supportsTextureGeneration = activeModelObj?.supports_texture ?? false;
const showTextureToggle = supportsTextureGeneration && !isTextTo3DModel;

// In handleGenerate:
generateTexture: isTextTo3DModel ? true : (prev.generateTexture !== false)

// In model selection:
generateTexture: m.supports_texture ? true : false, // text-to-3D always generates textures

// Conditional render:
{showTextureToggle && ( <PBR Texture Toggle /> )}

// Quad topology disabled when textures active:
disabled={Boolean(activeModelObj?.supports_texture && (generationSettings.generateTexture !== false || isTextTo3DModel))}
```

---

### 8. Pipeline Auto-Bake for Native Textures (`backend/postprocess/pipeline.py`)

**Issue:** When models produced native textures (TRELLIS image-to-textured, TripoSR+Paint, etc.), the post-processing pipeline didn't auto-bake those native textures to the game-ready UV layout.

**Fix:** Auto-enable bake when `native_textures=True` so native detail bakes to game-ready UVs:

```python
should_bake = (
    bool(job_inputs.get("bake_normal_maps"))
    or bool(job_inputs.get("bake_high_to_low"))
    or bool(job_inputs.get("bake_textures"))
    or bool(job_metadata.get("bake_normal_maps"))
    or bool(job_metadata.get("bake_textures"))
    # Auto-enable bake for native-textured models so native detail bakes to game-ready UVs
    or native_textures
)
```

---

## Verification

All tests pass:
```
Backend Tests: 89 passed, 3 skipped (runtime-gated)
TypeScript:    npx tsc --noEmit → clean
Next.js Build: ✓ Compiled successfully in 68s
```

---

## Remaining Work (Per TASKS.md)

| Issue | Status | Priority |
|-------|--------|----------|
| Model parameters schema | Pending | HIGH |
| Conditional feature toggles (UI-001) | Partial | HIGH |
| Mock/placeholder sweep (UI-003) | Pending | MEDIUM |

---

## Files Modified

| File | Issues Addressed |
|------|-----------------|
| `backend/adapters/trellis_adapter.py` | CRIT-007 (TRELLIS raw extraction) |
| `backend/thirdparty/TRELLIS/trellis/utils/postprocessing_utils.py` | CRIT-007 (postprocess "none" mode) |
| `backend/core/scheduler/multiprocess_scheduler.py` | CRIT-002 (worker race condition) |
| `app/api/v1/[...path]/route.ts` | CRIT-001 (SSE abort handling) |
| `backend/adapters/triposf_adapter.py` | CRIT-008 (TripoSF VRAM downshift) |
| `backend/postprocess/services/auto_uv.py` | CRIT-009 (Auto UV texture preservation) |
| `backend/postprocess/pipeline.py` | CRIT-010 (Pipeline auto-bake native textures) |
| `features/workspace/Panels/GeneratePanel.tsx` | CRIT-011 (Text-to-3D alignment) |

---

## Next Steps

1. **Model parameters schema** - Transform config to JSON Schema format
2. **UI-001** - Apply conditional feature toggles to all 6 panels (GeneratePanel done)
3. **UI-003** - Mock/placeholder sweep across all panels