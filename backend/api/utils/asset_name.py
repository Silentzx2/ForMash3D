"""
Asset name resolution utility.

Provides a pure function to resolve asset names from request parameters
with consistent fallback logic across all mesh generation endpoints.
"""

from pathlib import Path
from typing import Optional, Dict, Any, TYPE_CHECKING

if TYPE_CHECKING:
    from core.file_store import FileStore

# Runtime imports to avoid circular dependencies
async def _get_file_metadata_impl(file_store: "FileStore", file_id: str) -> Optional[Dict]:
    """Get file metadata from file store."""
    try:
        from api.routers.file_upload import get_file_metadata_impl as impl
        return await impl(file_store, file_id)
    except ImportError:
        return None


async def resolve_asset_name(
    request: Any,
    file_store: Optional["FileStore"] = None,
    file_path: Optional[str] = None,
    file_id: Optional[str] = None,
) -> str:
    """
    Resolve asset name from request with consistent fallback logic.
    
    Fallback priority:
    1. request.asset_name (explicit asset name)
    2. request.image_name (image name)
    3. File metadata from file_store (using file_id)
    4. File path stem (if not starting with "upload_")
    5. "asset" (default)
    
    Args:
        request: Request object with asset_name, image_name, image_file_id attributes
        file_store: Optional FileStore instance for multi-worker mode
        file_path: Optional file path for fallback
        file_id: Optional file ID for metadata lookup
        
    Returns:
        Resolved asset name stem
    """
    # Priority 1: explicit asset_name
    chosen_stem = getattr(request, "asset_name", None)
    if chosen_stem:
        return chosen_stem
    
    # Priority 2: image_name
    chosen_stem = getattr(request, "image_name", None)
    if chosen_stem:
        return chosen_stem
    
    # Priority 3: file metadata from file_store
    file_id_to_check = getattr(request, "image_file_id", None) or file_id
    if file_id_to_check and file_store is not None:
        meta = await _get_file_metadata_impl(file_store, file_id_to_check)
        if meta and meta.get("filename"):
            return Path(meta["filename"]).stem
    
    # Priority 4: file path stem
    file_path_to_check = file_path or getattr(request, "image_path", None)
    if file_path_to_check:
        p_stem = Path(file_path_to_check).stem
        if not p_stem.startswith("upload_"):
            return p_stem
    
    # Priority 5: default
    return "asset"


def resolve_asset_name_sync(
    asset_name: Optional[str],
    image_name: Optional[str],
    image_file_id: Optional[str],
    image_file_path: Optional[str],
    local_file_metadata: Optional[Dict[str, Dict]] = None,
) -> str:
    """
    Synchronous version for single-worker mode with in-memory metadata.
    
    Fallback priority:
    1. asset_name (explicit asset name)
    2. image_name (image name)
    3. File metadata from local_file_metadata (using image_file_id)
    4. File path stem (if not starting with "upload_")
    5. "asset" (default)
    
    Args:
        asset_name: Explicit asset name from request
        image_name: Image name from request
        image_file_id: File ID for metadata lookup
        image_file_path: File path for fallback
        local_file_metadata: In-memory file metadata dict
        
    Returns:
        Resolved asset name stem
    """
    # Priority 1: explicit asset_name
    if asset_name:
        return asset_name
    
    # Priority 2: image_name
    if image_name:
        return image_name
    
    # Priority 3: file metadata
    if image_file_id and local_file_metadata is not None:
        meta = local_file_metadata.get(image_file_id)
        if meta and meta.get("filename"):
            return Path(meta["filename"]).stem
    
    # Priority 4: file path stem
    if image_file_path:
        p_stem = Path(image_file_path).stem
        if not p_stem.startswith("upload_"):
            return p_stem
    
    # Priority 5: default
    return "asset"