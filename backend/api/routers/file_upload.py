"""
File upload API endpoints.

Provides endpoints for uploading images and meshes with unique identifiers
that can be used in other API endpoints.

Supports two deployment modes:
- Single-worker mode: Uses in-memory storage (fast, but not shared across workers)
- Multi-worker mode: Uses Redis-backed FileStore (shared across all workers)
"""

import hashlib
import logging
import mimetypes
import os
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from api.dependencies import get_file_store
from core.file_store import FileStore
from core.utils.file_utils import (
    SUPPORTED_IMAGE_FORMATS,
    SUPPORTED_MESH_FORMATS,
    FileUploadError,
    get_storage_base_dir,
    save_upload_file,
)
from core.utils.thumbnail_utils import generate_mesh_thumbnail

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/file-upload", tags=["file_upload"])

# Configuration: store uploaded files under canonical backend/storage/uploads
UPLOAD_BASE_DIR = get_storage_base_dir() / "uploads"
UPLOAD_BASE_DIR.mkdir(parents=True, exist_ok=True)


class FileUploadResponse(BaseModel):
    """Response for file upload requests"""

    file_id: str = Field(..., description="Unique identifier for the uploaded file")
    filename: str = Field(..., description="Original filename")
    file_type: str = Field(..., description="Type of file (image/mesh)")
    file_size_mb: float = Field(..., description="File size in MB")
    upload_time: datetime = Field(..., description="Upload timestamp")
    expires_at: Optional[datetime] = Field(None, description="File expiration time")
    url: Optional[str] = Field(None, description="Direct download/view URL for the uploaded file")
    thumbnail_url: Optional[str] = Field(None, description="URL to the generated thumbnail image (meshes only)")


class FileMetadataResponse(BaseModel):
    """Response for file metadata requests"""

    file_id: str = Field(..., description="Unique identifier for the file")
    filename: str = Field(..., description="Original filename")
    file_type: str = Field(..., description="Type of file (image/mesh)")
    file_size_mb: float = Field(..., description="File size in MB")
    upload_time: datetime = Field(..., description="Upload timestamp")
    expires_at: Optional[datetime] = Field(None, description="File expiration time")
    is_available: bool = Field(..., description="Whether the file is still available")


def validate_file_type(filename: str, allowed_types: List[str]) -> bool:
    """Validate file type based on extension"""
    file_ext = Path(filename).suffix.lower()
    return file_ext in allowed_types


def generate_file_id() -> str:
    """Generate unique file identifier"""
    return str(uuid.uuid4())


# ============================================================================
# Storage Layer Abstraction
# ============================================================================

async def store_file_metadata_impl(
    file_store: Optional[FileStore],
    file_id: str,
    file_info: Dict,
) -> None:
    """
    Store file metadata using Redis (multi-worker) or in-memory (single-worker).
    """
    metadata = {
        "file_id": file_id,
        "filename": file_info["original_filename"],
        "file_path": file_info["file_path"],
        "file_type": file_info["file_type"],
        "file_size_mb": file_info["file_size_mb"],
        "upload_time": datetime.now().isoformat(),
        "expires_at": (datetime.now() + timedelta(hours=24)).isoformat(),
        "is_available": True,
    }
    
    if file_store is not None:
        # Multi-worker mode: use Redis
        await file_store.store_file_metadata(file_id, metadata)
    else:
        # Single-worker mode: the app.state.file_store is an InMemoryFileStore
        await file_store.store_file_metadata(file_id, metadata)


async def get_file_metadata_impl(
    file_store: Optional[FileStore],
    file_id: str,
) -> Optional[Dict]:
    """
    Get file metadata from Redis (multi-worker) or in-memory (single-worker).
    """
    if file_store is not None:
        return await file_store.get_file_metadata(file_id)
    else:
        return None


async def delete_file_metadata_impl(
    file_store: Optional[FileStore],
    file_id: str,
) -> bool:
    """
    Delete file metadata from Redis (multi-worker) or in-memory (single-worker).
    """
    if file_store is not None:
        return await file_store.delete_file_metadata(file_id)
    else:
        return False


async def list_file_metadata_impl(
    file_store: Optional[FileStore],
    file_type: Optional[str] = None,
    limit: int = 100,
) -> List[Dict]:
    """
    List file metadata from Redis (multi-worker) or in-memory (single-worker).
    """
    if file_store is not None:
        return await file_store.list_file_metadata(file_type=file_type, limit=limit)
    else:
        return []


async def count_files_impl(
    file_store: Optional[FileStore],
    file_type: Optional[str] = None,
) -> int:
    """
    Count files from Redis (multi-worker) or in-memory (single-worker).
    """
    if file_store is not None:
        return await file_store.count_files(file_type=file_type)
    else:
        return 0


async def get_file_path_impl(
    file_store: Optional[FileStore],
    file_id: str,
) -> Optional[str]:
    """
    Get file path by ID, checking if file exists on disk.
    """
    metadata = await get_file_metadata_impl(file_store, file_id)
    if metadata and metadata.get("is_available", True):
        file_path = metadata.get("file_path")
        if file_path and os.path.exists(file_path):
            return file_path

    # Fallback 1: check if file_id corresponds to a job output in canonical storage
    clean_id = file_id.removeprefix("job-")
    id_hash = hashlib.sha256(clean_id.encode("utf-8")).hexdigest()[:8]
    storage_base = get_storage_base_dir()
    for base in [storage_base, Path("backend/storage"), Path("/app/backend/storage")]:
        models_dir = Path(base) / "models"
        if not models_dir.is_dir():
            continue
        # Direct folder match or hash-suffixed folder match
        candidates = list(models_dir.glob(f"*{clean_id}*")) + list(models_dir.glob(f"*{id_hash}*"))
        for candidate_dir in candidates:
            if candidate_dir.is_dir():
                for glb in candidate_dir.glob("game_ready/*.glb"):
                    return str(glb)
                for obj in candidate_dir.glob("game_ready/*.obj"):
                    return str(obj)
                for glb in candidate_dir.glob("master/*.glb"):
                    return str(glb)
                for glb in candidate_dir.glob("*.glb"):
                    return str(glb)
                for obj in candidate_dir.glob("*.obj"):
                    return str(obj)

    # Fallback 2: check uploads directory (for uploaded images/meshes when metadata is lost)
    # Files are stored in uploads/{file_type}/{file_id[:2]}/
    upload_prefix = file_id[:2]
    for base in [storage_base, Path("backend/storage"), Path("/app/backend/storage")]:
        uploads_dir = Path(base) / "uploads"
        if not uploads_dir.is_dir():
            continue
        # Search in both image and mesh subdirectories
        for file_type_dir in ["image", "mesh"]:
            type_dir = uploads_dir / file_type_dir / upload_prefix
            if not type_dir.is_dir():
                continue
            # Look for any file with this file_id in the filename
            candidates = list(type_dir.glob(f"*{file_id}*"))
            for candidate in candidates:
                if candidate.is_file() and os.path.exists(candidate):
                    return str(candidate)

    return None


# ============================================================================
# File Upload Logic
# ============================================================================

_THUMBNAIL_DIR = UPLOAD_BASE_DIR / "thumbnails"
_THUMBNAIL_DIR.mkdir(parents=True, exist_ok=True)


def _generate_thumbnail_for_mesh(file_path: str, file_id: str) -> Optional[str]:
    """Generate a thumbnail PNG for a mesh file. Returns thumbnail path or None on failure."""
    try:
        thumbnail_path = _THUMBNAIL_DIR / f"{file_id}.png"
        success = generate_mesh_thumbnail(file_path, str(thumbnail_path))
        if success and thumbnail_path.exists():
            return str(thumbnail_path)
    except Exception as exc:
        logger.warning(f"Thumbnail generation failed for {file_id}: {exc}")
    return None


async def upload_file_with_validation(
    file: UploadFile,
    file_type: str,
    allowed_extensions: List[str],
    file_store: Optional[FileStore],
    max_size_mb: int = 100,
) -> Dict:
    """Upload file with validation and return metadata"""

    # Validate file type
    if not file.filename:
        raise HTTPException(status_code=400, detail="Filename is required")

    if not validate_file_type(file.filename, allowed_extensions):
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type. Allowed extensions: {allowed_extensions}",
        )

    # Generate file ID and create directory
    file_id = generate_file_id()
    upload_dir = (
        UPLOAD_BASE_DIR / file_type / file_id[:2]
    )  # Use first 2 chars for subdirectory
    upload_dir.mkdir(parents=True, exist_ok=True)

    try:
        # Save file
        file_info = await save_upload_file(
            file, str(upload_dir), max_size_mb=max_size_mb, validate_content=True
        )

        # Store metadata (uses Redis in multi-worker mode, in-memory otherwise)
        await store_file_metadata_impl(file_store, file_id, file_info)

        logger.info(f"Uploaded {file_type} file {file_id}: {file.filename}")

        return {
            "file_id": file_id,
            "filename": file.filename,
            "file_type": file_type,
            "file_size_mb": file_info["file_size_mb"],
            "upload_time": datetime.now(),
            "expires_at": datetime.now() + timedelta(hours=24),
            "url": f"/api/v1/file-upload/download/{file_id}",
        }
    except FileUploadError as e:
        logger.error(f"Failed to upload {file_type} file {file.filename}: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))

    except Exception as e:
        logger.error(f"Failed to upload {file_type} file {file.filename}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to upload file: {str(e)}")


# ============================================================================
# API Endpoints
# ============================================================================

@router.post("/image", response_model=FileUploadResponse)
async def upload_image(
    file: UploadFile = File(..., description="Image file to upload"),
    file_store: Optional[FileStore] = Depends(get_file_store),
):
    """
    Upload an image file.

    Returns a unique file ID that can be used in other API endpoints.
    Supported formats: PNG, JPG, JPEG, WebP, BMP, TIFF
    """
    return await upload_file_with_validation(
        file, "image", SUPPORTED_IMAGE_FORMATS, file_store, max_size_mb=50
    )


@router.post("/mesh", response_model=FileUploadResponse)
async def upload_mesh(
    file: UploadFile = File(..., description="Mesh file to upload"),
    file_store: Optional[FileStore] = Depends(get_file_store),
    background_tasks: BackgroundTasks = None,
):
    """
    Upload a mesh file.

    Returns a unique file ID that can be used in other API endpoints.
    Supported formats: GLB, OBJ, FBX, PLY, STL, GLTF
    """
    result = await upload_file_with_validation(
        file, "mesh", SUPPORTED_MESH_FORMATS, file_store, max_size_mb=200
    )

    file_path = result.get("file_path")
    file_id = result.get("file_id")
    if file_path and file_id:
        background_tasks.add_task(
            _generate_thumbnail_for_mesh, str(file_path), str(file_id)
        )
        result["thumbnail_url"] = f"/api/v1/file-upload/thumbnail/{file_id}"

    return result


@router.get("/metadata/{file_id}", response_model=FileMetadataResponse)
async def get_file_metadata_endpoint(
    file_id: str,
    file_store: Optional[FileStore] = Depends(get_file_store),
):
    """
    Get metadata for an uploaded file.

    Args:
        file_id: Unique file identifier

    Returns:
        File metadata including availability status
    """
    metadata = await get_file_metadata_impl(file_store, file_id)

    if not metadata:
        raise HTTPException(status_code=404, detail="File not found")

    # Check if file still exists on disk
    file_path = metadata.get("file_path")
    is_available = metadata.get("is_available", True) and (
        file_path and os.path.exists(file_path)
    )

    # Parse datetime strings if they're strings (from Redis)
    upload_time = metadata.get("upload_time")
    expires_at = metadata.get("expires_at")
    
    if isinstance(upload_time, str):
        upload_time = datetime.fromisoformat(upload_time)
    if isinstance(expires_at, str):
        expires_at = datetime.fromisoformat(expires_at)

    return FileMetadataResponse(
        file_id=metadata["file_id"],
        filename=metadata["filename"],
        file_type=metadata["file_type"],
        file_size_mb=metadata["file_size_mb"],
        upload_time=upload_time,
        expires_at=expires_at,
        is_available=is_available,
    )


@router.delete("/{file_id}")
async def delete_file(
    file_id: str,
    file_store: Optional[FileStore] = Depends(get_file_store),
):
    """
    Delete an uploaded file.

    Args:
        file_id: Unique file identifier
    """
    metadata = await get_file_metadata_impl(file_store, file_id)
    if not metadata:
        raise HTTPException(status_code=404, detail="File not found")

    file_path = metadata.get("file_path")
    if file_path and os.path.exists(file_path):
        try:
            os.remove(file_path)
        except OSError as e:
            logger.warning(f"Failed to delete file {file_path}: {e}")

    deleted = await delete_file_metadata_impl(file_store, file_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="File metadata not found")

    return {"message": f"File {file_id} deleted successfully"}


@router.get("/list", response_model=List[FileMetadataResponse])
async def list_files(
    file_type: Optional[str] = None,
    limit: int = 100,
    file_store: Optional[FileStore] = Depends(get_file_store),
):
    """
    List uploaded files.

    Args:
        file_type: Filter by file type (image/mesh)
        limit: Maximum number of files to return
    """
    files = await list_file_metadata_impl(file_store, file_type=file_type, limit=limit)
    
    result = []
    for metadata in files:
        file_path = metadata.get("file_path")
        is_available = metadata.get("is_available", True) and (
            file_path and os.path.exists(file_path)
        )
        
        upload_time = metadata.get("upload_time")
        expires_at = metadata.get("expires_at")
        
        if isinstance(upload_time, str):
            upload_time = datetime.fromisoformat(upload_time)
        if isinstance(expires_at, str):
            expires_at = datetime.fromisoformat(expires_at)
        
        result.append(FileMetadataResponse(
            file_id=metadata["file_id"],
            filename=metadata["filename"],
            file_type=metadata["file_type"],
            file_size_mb=metadata["file_size_mb"],
            upload_time=upload_time,
            expires_at=expires_at,
            is_available=is_available,
        ))
    
    return result


@router.get("/count")
async def count_files(
    file_type: Optional[str] = None,
    file_store: Optional[FileStore] = Depends(get_file_store),
):
    """
    Count uploaded files.
    """
    count = await count_files_impl(file_store, file_type=file_type)
    return {"count": count}


@router.get("/thumbnail/{file_id}", summary="Get uploaded mesh thumbnail")
async def get_thumbnail(
    file_id: str,
    file_store: Optional[FileStore] = Depends(get_file_store),
):
    """
    Get thumbnail for an uploaded mesh file.
    """
    metadata = await get_file_metadata_impl(file_store, file_id)
    if not metadata:
        raise HTTPException(status_code=404, detail="File not found")

    file_path = metadata.get("file_path")
    if not file_path or not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found on disk")

    # Look for thumbnail
    thumbnail_path = _THUMBNAIL_DIR / f"{file_id}.png"
    if thumbnail_path.exists():
        return FileResponse(
            path=str(thumbnail_path),
            media_type="image/png",
            filename=f"{file_id}_thumb.png",
        )
    
    # Generate thumbnail on-demand
    try:
        thumbnail_path_str = _generate_thumbnail_for_mesh(file_path, file_id)
        if thumbnail_path_str and os.path.exists(thumbnail_path_str):
            return FileResponse(
                path=thumbnail_path_str,
                media_type="image/png",
                filename=f"{file_id}_thumb.png",
            )
    except Exception as exc:
        logger.warning(f"Thumbnail generation failed for {file_id}: {exc}")

    raise HTTPException(status_code=404, detail="Thumbnail not available")


@router.get("/download/{file_id}")
async def download_file(
    file_id: str,
    file_store: Optional[FileStore] = Depends(get_file_store),
):
    """
    Download an uploaded file.
    """
    metadata = await get_file_metadata_impl(file_store, file_id)
    if not metadata:
        raise HTTPException(status_code=404, detail="File not found")

    file_path = metadata.get("file_path")
    if not file_path or not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found on disk")

    return FileResponse(
        path=file_path,
        filename=metadata["filename"],
        media_type=mimetypes.guess_type(file_path)[0] or "application/octet-stream",
    )


@router.get("/supported-formats")
async def get_supported_formats():
    """
    Get supported file formats for upload.

    Returns:
        Dictionary of supported formats and limits
    """
    return {
        "image": {
            "formats": SUPPORTED_IMAGE_FORMATS,
            "max_size_mb": 50,
            "description": "Supported image formats for upload",
        },
        "mesh": {
            "formats": SUPPORTED_MESH_FORMATS,
            "max_size_mb": 200,
            "description": "Supported mesh formats for upload",
        },
        "retention": {
            "default_hours": 24,
            "description": "Files are automatically deleted after 24 hours",
        },
    }


# ============================================================================
# Utility Functions (for use by other modules)
# ============================================================================

async def resolve_file_id_async(
    file_id: str,
    file_store: Optional[FileStore] = None,
) -> Optional[str]:
    """
    Resolve a file ID to its actual file path (async version).

    This function can be imported and used by other modules
    to convert file IDs to file paths.
    
    Args:
        file_id: The unique file identifier
        file_store: Optional FileStore instance (for multi-worker mode)
       
    Returns:
        The file path if found and available, None otherwise
    """
    return await get_file_path_impl(file_store, file_id)


def resolve_file_id(file_id: str) -> Optional[str]:
    """
    Resolve a file ID to its actual file path (sync version, single-worker only).

    This function uses the in-memory storage and should only be used
    in single-worker mode. For multi-worker mode, use resolve_file_id_async.
    
    Args:
        file_id: The unique file identifier
       
    Returns:
        The file path if found and available, None otherwise
    """
    # This is now deprecated - file_store is always available via dependency injection
    return None