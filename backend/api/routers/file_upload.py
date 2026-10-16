"""
File upload API endpoints.

Provides endpoints for uploading images and meshes with unique identifiers
that can be used in other API endpoints.

Supports two deployment modes:
- Single-worker mode: Uses in-memory storage (fast, but not shared across workers)
- Multi-worker mode: Uses Redis-backed FileStore (shared across all workers)
"""

import hashlib
import json
import logging
import mimetypes
import os
import re
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional
from urllib.parse import parse_qs, unquote, urlparse

import anyio
import aiofiles
from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from api.dependencies import get_file_store
from core.file_store import FileStore
from core.utils.artifact_utils import resolve_declared_artifact
from core.utils.file_utils import (
    MAX_MESH_FACES,
    MAX_MESH_VERTICES,
    SUPPORTED_IMAGE_FORMATS,
    SUPPORTED_MESH_FORMATS,
    FileUploadError,
    get_storage_base_dir,
    save_upload_file,
    validate_image_file,
    validate_mesh_file,
    get_file_type_from_extension,
)
from core.utils.thumbnail_utils import generate_mesh_thumbnail

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/file-upload", tags=["file_upload"])

# Configuration: store uploaded files under canonical backend/storage/uploads
UPLOAD_BASE_DIR = get_storage_base_dir() / "uploads"
UPLOAD_BASE_DIR.mkdir(parents=True, exist_ok=True)
MAX_IMAGE_UPLOAD_SIZE_MB = 50
MAX_MESH_UPLOAD_SIZE_MB = 200
MESH_VALIDATION_CONCURRENCY = 2
_MESH_VALIDATION_LIMITER = anyio.CapacityLimiter(MESH_VALIDATION_CONCURRENCY)


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
    thumbnail_url: Optional[str] = Field(None, description="Thumbnail URL for the file")


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
) -> bool:
    """
    Store file metadata using Redis (multi-worker) or in-memory (single-worker).
    """
    if file_store is None:
        return False

    durable = bool(file_info.get("durable", False))
    upload_time = file_info.get("upload_time", datetime.now().isoformat())
    metadata = {
        "file_id": file_id,
        "filename": file_info["original_filename"],
        "file_path": file_info["file_path"],
        "file_type": file_info["file_type"],
        "file_size_mb": file_info["file_size_mb"],
        "file_size_bytes": file_info.get("file_size_bytes"),
        "sha256": file_info.get("sha256"),
        "original_format": file_info.get("original_format"),
        "durable": durable,
        "upload_time": upload_time,
        "expires_at": None if durable else (datetime.now() + timedelta(hours=24)).isoformat(),
        "is_available": True,
    }

    return await file_store.store_file_metadata(file_id, metadata) is True


def _storage_path(path: str | Path) -> Optional[Path]:
    """Resolve an existing file only when it remains inside configured storage."""
    try:
        resolved = Path(path).resolve(strict=True)
        resolved.relative_to(get_storage_base_dir().resolve())
        return resolved if resolved.is_file() else None
    except (OSError, TypeError, ValueError):
        return None


def _is_uploaded_source(file_id: str, file_type: str, file_path: Path) -> bool:
    if not re.fullmatch(r"[0-9a-fA-F-]{36}", file_id):
        return False
    storage_base = get_storage_base_dir().resolve()
    uploads_root = UPLOAD_BASE_DIR / file_type / file_id[:2]
    if file_type == "image" and file_path.parent == uploads_root:
        return (
            file_path.stem == f"upload_{file_id}"
            and file_path.suffix.lower() in SUPPORTED_IMAGE_FORMATS
        )
    if file_type == "mesh":
        if file_path.parent == uploads_root:
            return (
                file_path.stem == f"upload_{file_id}"
                and file_path.suffix.lower() in SUPPORTED_MESH_FORMATS
            )
        workspace = storage_base / "models" / "meshes" / f"upload_{file_id}"
        return (
            file_path.parent == workspace / "master"
            and file_path.stem == "source"
            and file_path.suffix.lower() in SUPPORTED_MESH_FORMATS
        )
    return False


def _upload_manifest_path(file_id: str, file_type: str) -> Path:
    storage_base = get_storage_base_dir()
    if file_type == "mesh":
        return storage_base / "models" / "meshes" / f"upload_{file_id}" / "metadata" / "asset.json"
    return UPLOAD_BASE_DIR / file_type / file_id[:2] / f"upload_{file_id}.json"


def _write_upload_manifest(
    file_id: str,
    file_info: Dict,
    manifest_path: Path,
) -> None:
    storage_base = get_storage_base_dir().resolve()
    source_path = Path(file_info["file_path"]).resolve(strict=True)
    source_path.relative_to(storage_base)
    manifest = {
        "manifest_version": "1",
        "asset_id": file_id,
        "file_id": file_id,
        "file_type": file_info["file_type"],
        "durable": True,
        "original_filename": file_info["original_filename"],
        "original_format": file_info["original_format"],
        "source_path": source_path.relative_to(storage_base).as_posix(),
        "file_size_bytes": file_info["file_size_bytes"],
        "file_size_mb": file_info["file_size_mb"],
        "sha256": file_info["sha256"],
        "upload_time": file_info["upload_time"],
        "expires_at": None,
        "is_available": True,
    }
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = manifest_path.with_name(f"{manifest_path.name}.tmp")
    try:
        temporary_path.write_text(json.dumps(manifest), encoding="utf-8")
        temporary_path.replace(manifest_path)
    finally:
        temporary_path.unlink(missing_ok=True)


def _read_upload_manifest(file_id: str) -> Optional[Dict]:
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", file_id):
        return None
    storage_base = get_storage_base_dir().resolve()
    candidates = (
        ("mesh", _upload_manifest_path(file_id, "mesh")),
        ("image", _upload_manifest_path(file_id, "image")),
    )
    for expected_type, manifest_path in candidates:
        try:
            safe_manifest_path = _storage_path(manifest_path)
            if safe_manifest_path is None or safe_manifest_path != manifest_path.absolute():
                continue
            manifest = json.loads(safe_manifest_path.read_text(encoding="utf-8"))
            file_type = manifest["file_type"]
            source_relative = Path(manifest["source_path"])
            if (
                manifest.get("manifest_version") != "1"
                or manifest.get("asset_id") != file_id
                or manifest.get("file_id") != file_id
                or manifest.get("durable") is not True
                or file_type != expected_type
                or source_relative.is_absolute()
            ):
                continue
            source_path = (storage_base / source_relative).resolve(strict=True)
            source_path.relative_to(storage_base)
            if source_path != (storage_base / source_relative).absolute():
                continue
            file_size_bytes = manifest["file_size_bytes"]
            original_format = manifest["original_format"]
            sha256 = manifest["sha256"]
            if (
                not source_path.is_file()
                or not _is_uploaded_source(file_id, file_type, source_path)
                or isinstance(file_size_bytes, bool)
                or not isinstance(file_size_bytes, int)
                or file_size_bytes < 0
                or source_path.stat().st_size != file_size_bytes
                or not isinstance(original_format, str)
                or original_format.lower() != source_path.suffix.lower()
                or not isinstance(sha256, str)
                or not re.fullmatch(r"[0-9a-f]{64}", sha256)
            ):
                continue
            return {
                "file_id": file_id,
                "filename": manifest["original_filename"],
                "file_path": str(source_path),
                "file_type": file_type,
                "durable": True,
                "file_size_mb": manifest["file_size_mb"],
                "file_size_bytes": file_size_bytes,
                "sha256": sha256,
                "original_format": original_format,
                "upload_time": manifest["upload_time"],
                "expires_at": None,
                "is_available": True,
            }
        except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError):
            continue

    # Pre-manifest uploads used an exact UUID filename in this directory layout.
    uploads_root = get_storage_base_dir() / "uploads"
    legacy_matches = []
    for file_type in ("image", "mesh"):
        directory = uploads_root / file_type / file_id[:2]
        if not directory.is_dir():
            continue
        for candidate in directory.iterdir():
            if candidate.stem == f"upload_{file_id}" and candidate.is_file():
                safe_path = _storage_path(candidate)
                if safe_path:
                    legacy_matches.append((safe_path, file_type))
    if len(legacy_matches) == 1:
        source_path, file_type = legacy_matches[0]
        stat = source_path.stat()
        return {
            "file_id": file_id,
            "filename": source_path.name.removeprefix(f"upload_{file_id}"),
            "file_path": str(source_path),
            "file_type": file_type,
            "durable": True,
            "file_size_mb": stat.st_size / (1024 * 1024),
            "file_size_bytes": stat.st_size,
            "upload_time": datetime.fromtimestamp(stat.st_mtime).isoformat(),
            "expires_at": None,
            "is_available": True,
        }
    return None


def _list_upload_manifests(file_type: Optional[str] = None) -> List[Dict]:
    """Read only canonical upload manifests; never infer assets from broad globs."""
    manifest_ids = set()
    if file_type in (None, "mesh"):
        mesh_root = get_storage_base_dir() / "models" / "meshes"
        if mesh_root.is_dir():
            for manifest_path in mesh_root.glob("upload_*/metadata/asset.json"):
                match = re.fullmatch(
                    r"upload_([0-9a-fA-F-]{36})", manifest_path.parents[1].name
                )
                if match:
                    manifest_ids.add(match.group(1))
    if file_type in (None, "image"):
        image_root = UPLOAD_BASE_DIR / "image"
        if image_root.is_dir():
            for manifest_path in image_root.glob("*/*.json"):
                match = re.fullmatch(
                    r"upload_([0-9a-fA-F-]{36})\.json", manifest_path.name
                )
                if match:
                    manifest_ids.add(match.group(1))

    return [
        metadata
        for file_id in manifest_ids
        if (metadata := _read_upload_manifest(file_id)) is not None
        and (file_type is None or metadata["file_type"] == file_type)
    ]


def _upload_thumbnail_path(file_id: str) -> Optional[Path]:
    if not re.fullmatch(r"[0-9a-fA-F-]{36}", file_id):
        return None
    storage_base = get_storage_base_dir().resolve()
    expected_parent = storage_base / "uploads" / "thumbnails"
    try:
        thumbnail_parent = _THUMBNAIL_DIR.resolve(strict=False)
        thumbnail_parent.relative_to(storage_base)
        if thumbnail_parent != expected_parent:
            return None
        return _THUMBNAIL_DIR / f"{file_id}.png"
    except (OSError, ValueError):
        return None


async def get_file_metadata_impl(
    file_store: Optional[FileStore],
    file_id: str,
) -> Optional[Dict]:
    """
    Get file metadata from Redis (multi-worker) or in-memory (single-worker).
    """
    if file_store is not None:
        metadata = await file_store.get_file_metadata(file_id)
        if metadata:
            return metadata
    return _read_upload_manifest(file_id)


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
    cached = (
        await file_store.list_file_metadata(file_type=file_type, limit=limit)
        if file_store is not None
        else []
    )
    metadata_by_id = {
        item["file_id"]: item for item in cached if item.get("file_id")
    }
    for item in _list_upload_manifests(file_type):
        metadata_by_id.setdefault(item["file_id"], item)

    def upload_timestamp(metadata: Dict) -> float:
        value = metadata.get("upload_time")
        try:
            timestamp = datetime.fromisoformat(value) if isinstance(value, str) else value
            return timestamp.timestamp() if timestamp else 0.0
        except (TypeError, ValueError, OverflowError):
            return 0.0

    return sorted(
        metadata_by_id.values(), key=upload_timestamp, reverse=True
    )[:max(0, limit)]


async def count_files_impl(
    file_store: Optional[FileStore],
    file_type: Optional[str] = None,
) -> int:
    """
    Count files from Redis (multi-worker) or in-memory (single-worker).
    """
    cached_count = (
        await file_store.count_files(file_type=file_type) if file_store is not None else 0
    )
    return max(cached_count, len(_list_upload_manifests(file_type)))


async def get_file_path_impl(
    file_store: Optional[FileStore],
    file_id: str,
    artifact_format: Optional[str] = None,
) -> Optional[str]:
    """
    Get file path by ID, checking if file exists on disk.
    """
    metadata = await get_file_metadata_impl(file_store, file_id)
    if metadata and metadata.get("is_available", True):
        file_path = _storage_path(metadata.get("file_path", ""))
        if file_path:
            if artifact_format is None:
                return str(file_path)
            resolved = _resolve_job_artifact(file_id, file_path, artifact_format)
            if resolved:
                return str(resolved)

    disk_metadata = _read_upload_manifest(file_id)
    if disk_metadata and artifact_format is None:
        return disk_metadata["file_path"]

    clean_id = file_id.removeprefix("job-")
    if re.fullmatch(r"[A-Za-z0-9_-]{1,128}", clean_id):
        workspace = _find_job_workspace(clean_id, file_id, metadata)
        if workspace:
            resolved = _artifact_path(workspace, artifact_format or "glb", clean_id)
            if resolved:
                return str(resolved)

    if artifact_format is not None:
        return None

    disk_metadata = disk_metadata or _read_upload_manifest(clean_id)
    return disk_metadata.get("file_path") if disk_metadata else None


_JOB_ARTIFACT_FORMATS = {
    "master", "glb", "gltf", "fbx", "obj", "stl", "ply", "quad_obj",
    "lod0", "lod1", "lod2", "lod3", "textured", "rigged", "derived", "collision",
    "thumbnail", "qa_report", "job_json", "asset_json", "physics_json",
    "texture_base_color", "texture_normal", "texture_ao", "texture_roughness",
    "texture_metallic", "texture_orm",
}


def _find_job_workspace(job_id: str, raw_id: str, metadata: Optional[Dict]) -> Optional[Path]:
    models_root = (get_storage_base_dir() / "models").resolve()
    possible_roots = []
    if metadata:
        metadata_path = metadata.get("file_path")
        safe_path = _storage_path(metadata_path) if metadata_path else None
        if safe_path:
            for parent in safe_path.parents:
                manifest = parent / "metadata" / "job.json"
                if manifest.is_file():
                    possible_roots.append(parent)
                    break

    meshes_root = models_root / "meshes"
    if meshes_root.is_dir():
        for child in meshes_root.iterdir():
            if child.is_dir() and any(
                child.name == identifier or child.name.endswith(f"_{identifier}")
                for identifier in (job_id, raw_id)
            ):
                possible_roots.append(child)

    matching_roots = []
    for root in possible_roots:
        try:
            resolved_root = root.resolve(strict=True)
            resolved_root.relative_to(models_root)
            manifest = json.loads((resolved_root / "metadata" / "job.json").read_text(encoding="utf-8"))
            if manifest.get("job_id") in {job_id, raw_id}:
                matching_roots.append(resolved_root)
        except (OSError, ValueError, json.JSONDecodeError):
            continue
    return matching_roots[0] if len(set(matching_roots)) == 1 else None


def _artifact_path(workspace: Path, artifact_format: str, job_id: str) -> Optional[Path]:
    selector = (artifact_format or "").strip().lower()
    if selector not in _JOB_ARTIFACT_FORMATS:
        return None
    try:
        manifest = json.loads((workspace / "metadata" / "job.json").read_text(encoding="utf-8"))
        asset_name = manifest.get("asset_id")
    except (OSError, json.JSONDecodeError):
        asset_name = None

    if selector == "master":
        candidates = [workspace / "master" / "source.glb"]
    elif selector in {"glb", "gltf", "fbx", "obj", "stl", "ply", "quad_obj"}:
        extension = "obj" if selector == "quad_obj" else selector
        stems = list(dict.fromkeys(stem for stem in (asset_name, workspace.name) if stem))
        candidates = [workspace / "game_ready" / f"{stem}.{extension}" for stem in stems]
    elif selector.startswith("lod"):
        candidates = [workspace / "lods" / f"{selector}.glb"]
    elif selector == "textured":
        names = ["textured.glb"]
        if asset_name:
            names.append(f"{asset_name}_textured.glb")
        candidates = [workspace / "textures" / name for name in names]
    else:
        fixed_paths = {
            "rigged": workspace / "rigging" / "game_ready_rigged.glb",
            "collision": workspace / "collision" / "collision.glb",
            "thumbnail": workspace / "previews" / "thumbnail.png",
            "qa_report": workspace / "metadata" / "quality_report.json",
            "job_json": workspace / "metadata" / "job.json",
            "asset_json": workspace / "metadata" / "asset.json",
            "physics_json": workspace / "metadata" / "physics.json",
        }
        if selector.startswith("texture_"):
            candidates = [workspace / "textures" / f"{selector.removeprefix('texture_')}.png"]
        else:
            candidates = [fixed_paths[selector]]
    for candidate in candidates:
        safe_path = _storage_path(candidate)
        if safe_path:
            return safe_path
    return None


def _resolve_job_artifact(job_id: str, file_path: Path, artifact_format: str) -> Optional[Path]:
    clean_id = job_id.removeprefix("job-")
    workspace = _find_job_workspace(clean_id, job_id, {"file_path": str(file_path)})
    if workspace:
        return _artifact_path(workspace, artifact_format, clean_id)

    selector = (artifact_format or "").strip().lower()
    expected_suffix = {"glb": ".glb", "gltf": ".gltf", "fbx": ".fbx", "obj": ".obj", "stl": ".stl", "ply": ".ply"}.get(selector)
    models_root = (get_storage_base_dir() / "models").resolve()
    if expected_suffix and file_path.suffix.lower() == expected_suffix:
        try:
            file_path.relative_to(models_root)
            return file_path
        except ValueError:
            pass
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

    # Mesh assets live in an immutable per-upload workspace. Other uploads retain
    # the legacy UUID directory layout for compatibility.
    file_id = generate_file_id()
    workspace = None
    manifest_path = _upload_manifest_path(file_id, file_type)
    if file_type == "mesh":
        workspace = get_storage_base_dir() / "models" / "meshes" / f"upload_{file_id}"
        upload_dir = workspace / "master"
    else:
        upload_dir = UPLOAD_BASE_DIR / file_type / file_id[:2]
    file_path = None
    registered = False
    try:
        upload_dir.mkdir(parents=True, exist_ok=True)
        file_ext = Path(file.filename).suffix
        filename = f"source{file_ext}" if file_type == "mesh" else f"upload_{file_id}{file_ext}"
        file_path = upload_dir / filename

        max_size_bytes = max_size_mb * 1024 * 1024
        total_bytes = 0
        digest = hashlib.sha256()
        async with aiofiles.open(file_path, "wb") as handle:
            while chunk := await file.read(1024 * 1024):
                total_bytes += len(chunk)
                if total_bytes > max_size_bytes:
                    raise FileUploadError(
                        file.filename,
                        f"File size exceeds limit ({max_size_bytes} bytes / {max_size_mb} MiB)",
                    )
                digest.update(chunk)
                await handle.write(chunk)
        file_size_mb = total_bytes / (1024 * 1024)

        # Validate content if requested
        validation_info = {}
        if file.filename:
            file_type_detected = get_file_type_from_extension(file.filename)
            if file_type_detected == "image":
                validation_info = validate_image_file(str(file_path), optimize_large=False)
                if not validation_info.get("valid", False):
                    os.remove(file_path)
                    raise FileUploadError(
                        file.filename or "unknown",
                        validation_info.get("error", "Invalid image file"),
                    )
            elif file_type_detected == "mesh":
                validation_info = await anyio.to_thread.run_sync(
                    validate_mesh_file,
                    str(file_path),
                    limiter=_MESH_VALIDATION_LIMITER,
                )
                if not validation_info.get("valid", False):
                    os.remove(file_path)
                    raise FileUploadError(
                        file.filename or "unknown",
                        validation_info.get("error", "Invalid mesh file"),
                    )

        file_info = {
            "file_path": str(file_path),
            "original_filename": file.filename or "unknown",
            "saved_filename": filename,
            "file_size_mb": file_size_mb,
            "content_type": file.content_type or "application/octet-stream",
            "file_type": file_type,
            "validation_info": validation_info,
            "file_size_bytes": total_bytes,
            "sha256": digest.hexdigest(),
            "original_format": Path(file.filename).suffix,
            "upload_time": datetime.now().isoformat(),
            "durable": True,
        }

        _write_upload_manifest(file_id, file_info, manifest_path)
        if not await store_file_metadata_impl(file_store, file_id, file_info):
            raise HTTPException(status_code=503, detail="File metadata could not be registered")
        registered = True

        logger.info(f"Uploaded {file_type} file {file_id}: {file.filename}")

        return {
            "file_id": file_id,
            "file_path": str(file_path),
            "filename": file.filename,
            "file_type": file_type,
            "file_size_mb": file_info["file_size_mb"],
            "upload_time": datetime.now(),
            "expires_at": None,
            "url": f"/api/v1/file-upload/download/{file_id}",
        }
    except HTTPException:
        raise
    except FileUploadError as e:
        logger.error(f"Failed to upload {file_type} file {file.filename}: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))

    except Exception as e:
        logger.error(f"Failed to upload {file_type} file {file.filename}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to upload file: {str(e)}")
    finally:
        if not registered:
            if file_store is not None:
                try:
                    await file_store.delete_file_metadata(file_id)
                except Exception:
                    logger.warning("Failed to remove partial metadata for upload %s", file_id)
            manifest_path.unlink(missing_ok=True)
            if file_path:
                file_path.unlink(missing_ok=True)
            if workspace:
                for directory in (workspace / "master", workspace / "metadata", workspace):
                    try:
                        directory.rmdir()
                    except OSError:
                        pass


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
        file, "image", SUPPORTED_IMAGE_FORMATS, file_store, max_size_mb=MAX_IMAGE_UPLOAD_SIZE_MB
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
        file, "mesh", SUPPORTED_MESH_FORMATS, file_store, max_size_mb=MAX_MESH_UPLOAD_SIZE_MB
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
    cached_metadata = (
        await file_store.get_file_metadata(file_id) if file_store is not None else None
    )
    metadata = cached_metadata or _read_upload_manifest(file_id)

    if not metadata:
        raise HTTPException(status_code=404, detail="File not found")

    # Check if file still exists on disk
    file_path = metadata.get("file_path")
    is_available = metadata.get("is_available", True) and _storage_path(file_path or "") is not None

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
    if not re.fullmatch(r"[0-9a-fA-F-]{36}", file_id):
        raise HTTPException(status_code=400, detail="Only uploaded files can be deleted")
    cached_metadata = (
        await file_store.get_file_metadata(file_id) if file_store is not None else None
    )
    metadata = cached_metadata or _read_upload_manifest(file_id)
    if not metadata:
        return {"message": f"File {file_id} is already deleted"}

    file_path = _storage_path(metadata.get("file_path", ""))
    if not file_path or not _is_uploaded_source(
        file_id, metadata.get("file_type", ""), file_path
    ):
        manifest_path = _upload_manifest_path(file_id, metadata.get("file_type", ""))
        if metadata.get("is_available") is False and not manifest_path.exists():
            return {"message": f"File {file_id} is already deleted"}
        raise HTTPException(status_code=404, detail="File not found on disk")
    thumbnail_path = _upload_thumbnail_path(file_id)
    manifest_path = _upload_manifest_path(file_id, metadata.get("file_type", ""))
    if thumbnail_path is None:
        raise HTTPException(status_code=500, detail="Upload thumbnail path is outside configured storage")
    try:
        manifest_path.parent.resolve(strict=False).relative_to(
            get_storage_base_dir().resolve()
        )
    except (OSError, ValueError) as exc:
        raise HTTPException(status_code=500, detail="Upload manifest path is outside configured storage") from exc
    try:
        thumbnail_path.unlink(missing_ok=True)
        file_path.unlink(missing_ok=True)
        manifest_path.unlink(missing_ok=True)
        if metadata.get("file_type") == "mesh":
            workspace = get_storage_base_dir() / "models" / "meshes" / f"upload_{file_id}"
            for directory in (workspace / "master", workspace / "metadata", workspace):
                try:
                    directory.rmdir()
                except OSError:
                    pass
    except OSError as exc:
        logger.warning("Failed to clean uploaded file %s: %s", file_id, exc)
        raise HTTPException(status_code=500, detail="Failed to clean uploaded file") from exc

    deleted = await delete_file_metadata_impl(file_store, file_id) if cached_metadata else True
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
        file_path = _storage_path(metadata.get("file_path", ""))
        is_available = metadata.get("is_available", True) and file_path is not None
        
        upload_time = metadata.get("upload_time")
        expires_at = metadata.get("expires_at")
        
        if isinstance(upload_time, str):
            upload_time = datetime.fromisoformat(upload_time)
        if isinstance(expires_at, str):
            expires_at = datetime.fromisoformat(expires_at)
        
        thumb_url = f"/api/v1/file-upload/thumbnail/{metadata['file_id']}" if metadata.get("file_type") == "mesh" else None

        result.append(FileMetadataResponse(
            file_id=metadata["file_id"],
            filename=metadata["filename"],
            file_type=metadata["file_type"],
            file_size_mb=metadata["file_size_mb"],
            upload_time=upload_time,
            expires_at=expires_at,
            is_available=is_available,
            thumbnail_url=thumb_url,
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

    file_path = _storage_path(metadata.get("file_path", ""))
    if metadata.get("file_type") != "mesh" or not file_path or not _is_uploaded_source(
        file_id, metadata.get("file_type", ""), file_path
    ):
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

    file_path = _storage_path(metadata.get("file_path", ""))
    if not file_path or not _is_uploaded_source(
        file_id, metadata.get("file_type", ""), file_path
    ):
        raise HTTPException(status_code=404, detail="File not found on disk")

    return FileResponse(
        path=str(file_path),
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
            "max_size_mb": MAX_IMAGE_UPLOAD_SIZE_MB,
            "max_size_bytes": MAX_IMAGE_UPLOAD_SIZE_MB * 1024 * 1024,
            "description": "Supported image formats for upload",
        },
        "mesh": {
            "formats": SUPPORTED_MESH_FORMATS,
            "max_size_mb": MAX_MESH_UPLOAD_SIZE_MB,
            "max_size_bytes": MAX_MESH_UPLOAD_SIZE_MB * 1024 * 1024,
            "max_vertices": MAX_MESH_VERTICES,
            "max_faces": MAX_MESH_FACES,
            "validation_concurrency": MESH_VALIDATION_CONCURRENCY,
            "description": "Supported mesh formats for upload",
        },
        "retention": {
            "expires_at": None,
            "description": "Uploaded files are retained until explicitly deleted",
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


async def resolve_input_reference_async(
    input_ref: Optional[str],
    file_store: Optional[FileStore] = None,
) -> Optional[str]:
    """
    Resolve an input reference (URL or bare id path) to its actual file path.

    Accepts an input that may be an /api/v1/file-upload/download/{file_id} URL
    (absolute or relative, with optional query string), an
    /api/v1/system/jobs/{job_id}/download... URL, or a bare /{uuid} path.
    Lookup is performed via the file store using the identifier, then
    "job-{identifier}".

    This function can be imported and used by other modules that accept a
    URL-or-path reference pointing at an uploaded or job-produced file.

    Args:
        input_ref: The URL, path, or identifier to resolve
        file_store: Optional FileStore instance (for multi-worker mode)

    Returns:
        The file path if resolvable via the file store, None otherwise
    """
    if not input_ref:
        return None

    parsed = urlparse(str(input_ref).strip())
    path_str = unquote(parsed.path if parsed.scheme or parsed.netloc else parsed.path)
    query = parse_qs(parsed.query, keep_blank_values=True)
    artifact_values = query.get("artifact_format", [])
    if len(artifact_values) > 1:
        return None
    artifact_format = artifact_values[0].strip().lower() if artifact_values else None
    path_str = path_str.strip().strip("/")

    if not path_str:
        return None

    identifier: Optional[str] = None
    is_job_download = False
    if path_str.startswith("api/v1/system/jobs/"):
        parts = path_str[len("api/v1/system/jobs/"):].split("/", 1)
        identifier = parts[0]
        is_job_download = len(parts) > 1 and parts[1] == "download"
    elif path_str.startswith("api/v1/file-upload/download/"):
        identifier = path_str[len("api/v1/file-upload/download/"):].strip("/")
    elif "/" not in path_str:
        identifier = path_str

    if not identifier or "." in identifier:
        return None

    candidates = (identifier,) if is_job_download else (identifier, f"job-{identifier}")
    for candidate in candidates:
        resolved = await get_file_path_impl(
            file_store,
            candidate,
            artifact_format=(artifact_format or "glb") if is_job_download else None,
        )
        if resolved:
            return resolved
    return None


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