"""Generation-preview API."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from api.dependencies import get_file_store
from api.routers.mesh_generation import process_file_input
from core.file_store import FileStore
from core.preprocess.image_enhancement import load_preprocessed_artifact, preprocess_image

router = APIRouter(prefix="/image-enhancement", tags=["Image Enhancement"])


class EnhancementRequest(BaseModel):
    image_path: Optional[str] = None
    image_base64: Optional[str] = None
    image_file_id: Optional[str] = None
    remove_background: bool = True
    auto_crop: bool = True
    upscale: bool = True
    sharpen: bool = False


def _preview_result(result):
    result = dict(result)
    result["preview_url"] = (
        f"/api/v1/image-enhancement/artifacts/{result['artifact_id']}?variant=preview"
    )
    result["approved_url"] = (
        f"/api/v1/image-enhancement/artifacts/{result['artifact_id']}?variant=approved"
    )
    return result


@router.post("/preview")
async def preview(
    request: EnhancementRequest,
    file_store: Optional[FileStore] = Depends(get_file_store),
):
    try:
        source = await process_file_input(
            file_path=request.image_path,
            base64_data=request.image_base64,
            file_id=request.image_file_id,
            input_type="image",
            file_store=file_store,
        )
        return _preview_result(
            preprocess_image(
                source,
                remove_background=request.remove_background,
                auto_crop=request.auto_crop,
                upscale=request.upscale,
                sharpen=request.sharpen,
            )
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Image enhancement failed: {exc}") from exc


@router.get("/artifacts/{artifact_id}")
async def artifact(artifact_id: str, variant: str = "approved"):
    try:
        path, metadata = load_preprocessed_artifact(artifact_id, variant)
        return FileResponse(
            str(path),
            media_type="image/png",
            filename=path.name,
            headers={
                "Cache-Control": "public, max-age=86400, immutable",
                "X-Preprocess-Artifact-ID": artifact_id,
                "X-Approved-SHA256": metadata["approved_sha256"],
            },
        )
    except Exception as exc:
        raise HTTPException(status_code=404, detail=f"Preprocessed artifact not found: {exc}") from exc
