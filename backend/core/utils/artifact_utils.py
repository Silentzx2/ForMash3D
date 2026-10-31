import hashlib
from pathlib import Path
from typing import Any, Mapping, Optional


def first_result_path(result: Mapping[str, Any]) -> Optional[Any]:
    for key in ("output_mesh_path", "mesh_path", "output_path", "file_path"):
        if result.get(key):
            return result[key]
    return None


def sha256_file(path: str | Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def resolve_manifest_path(model_path: str | Path | None) -> Optional[Path]:
    """Resolve a manifest-declared path (for example ``backend/pretrained/TRELLIS``).

    Manifest paths are written relative to the repository root, but the API and
    scheduler processes do not run from the repository root, so the lookup must
    not depend on the current working directory.
    """
    if not model_path:
        return None
    path = Path(str(model_path)).expanduser()
    if path.is_absolute():
        return path if path.exists() else None

    repo_root = Path(__file__).resolve().parents[3]
    for candidate in (repo_root / path, repo_root / "backend" / path, Path.cwd() / path):
        if candidate.exists():
            return candidate.resolve()
    return None


def resolve_declared_artifact(
    asset_root: str | Path,
    declarations: Mapping[str, Any],
    artifact_key: str,
) -> Optional[Path]:
    entry = declarations.get(artifact_key)
    raw_path = entry.get("path") if isinstance(entry, Mapping) else None
    if not raw_path:
        return None

    root = Path(asset_root).resolve(strict=True)
    candidate = Path(raw_path)
    if not candidate.is_absolute():
        candidate = root / candidate
    try:
        resolved = candidate.resolve(strict=True)
        resolved.relative_to(root)
    except (OSError, ValueError):
        return None
    return resolved if resolved.is_file() else None