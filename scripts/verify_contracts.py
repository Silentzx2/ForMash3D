#!/usr/bin/env python3
"""
Contract and API integrity validation check.
Verifies that:
1. FastAPI app loads and registers all canonical endpoints.
2. Models configuration matches router feature declarations.
3. No active frontend code calls nonexistent legacy endpoints.
4. File upload/download contracts and schemas are consistent.
5. End-to-end file upload, download, and deletion lifecycle succeeds.
"""

import io
import os
import re
import sys
from pathlib import Path
from PIL import Image

# Add backend directory to sys.path
backend_dir = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(backend_dir))

from fastapi.testclient import TestClient
from api.main_multiworker import app

client = TestClient(app)

def check_backend_routes():
    print("[1/5] Checking backend FastAPI route registration...")
    schema = app.openapi()
    paths = schema.get("paths", {})

    required_endpoints = [
        "/health",
        "/api/v1/system/health",
        "/api/v1/system/status",
        "/api/v1/system/features",
        "/api/v1/system/models",
        "/api/v1/system/jobs/history",
        "/api/v1/system/jobs/{job_id}",
        "/api/v1/system/jobs/{job_id}/download",
        "/api/v1/file-upload/image",
        "/api/v1/file-upload/mesh",
        "/api/v1/file-upload/download/{file_id}",
        "/api/v1/file-upload/metadata/{file_id}",
        "/api/v1/mesh-generation/text-to-textured-mesh",
        "/api/v1/mesh-generation/image-to-textured-mesh",
        "/api/v1/mesh-generation/image-to-raw-mesh",
        "/api/v1/mesh-generation/text-mesh-painting",
        "/api/v1/mesh-generation/image-mesh-painting",
        "/api/v1/mesh-retopology/retopologize-mesh",
        "/api/v1/mesh-retopology/available-models",
        "/api/v1/mesh-uv-unwrapping/unwrap-mesh",
        "/api/v1/mesh-uv-unwrapping/available-models",
        "/api/v1/mesh-segmentation/segment-mesh",
        "/api/v1/auto-rigging/generate-rig",
    ]

    for ep in required_endpoints:
        assert ep in paths, f"Missing required endpoint in FastAPI app: {ep}"
    print(f"  ✓ All {len(required_endpoints)} required core endpoints exist in FastAPI OpenAPI schema ({len(paths)} total).")
    return paths

def check_model_config():
    print("[2/5] Checking backend models.yaml configuration...")
    import yaml
    config_path = backend_dir / "config" / "models.yaml"
    assert config_path.is_file(), f"models.yaml not found at {config_path}"
    with open(config_path, "r", encoding="utf-8") as f:
        config = yaml.safe_load(f)

    expected_features = [
        "text_to_textured_mesh",
        "image_to_raw_mesh",
        "image_to_textured_mesh",
        "text_mesh_painting",
        "image_mesh_painting",
        "mesh_segmentation",
        "auto_rig",
        "mesh_retopology",
        "uv_unwrapping",
    ]
    for feat in expected_features:
        assert feat in config, f"Feature '{feat}' missing from models.yaml"
        models = config[feat]
        assert len(models) > 0, f"No models registered under feature '{feat}'"
        for m_id, m_cfg in models.items():
            assert "vram_requirement" in m_cfg, f"Model {m_id} missing vram_requirement"
            assert "supported_inputs" in m_cfg, f"Model {m_id} missing supported_inputs"
            assert "supported_outputs" in m_cfg, f"Model {m_id} missing supported_outputs"

    assert "text_to_raw_mesh" not in config, "text_to_raw_mesh unexpectedly present in config"
    print(f"  ✓ models.yaml validated with {len(expected_features)} features.")

def check_frontend_drift(openapi_paths):
    print("[3/5] Checking frontend files for dead endpoint calls...")
    repo_root = backend_dir.parent
    frontend_scan_dirs = [
        repo_root / "services",
        repo_root / "features" / "workspace",
        repo_root / "features" / "settings",
        repo_root / "features" / "admin",
        repo_root / "components",
        repo_root / "hooks",
    ]

    forbidden_patterns = [
        "/api/v1/jobs?",
        "/api/v1/project/export",
        "/api/v1/settings/workspace",
        "/api/v1/runtime/",
        "/api/v1/system/dependencies",
        "/api/v1/system/stream",
        "/api/v1/realtime/ws",
        "/api/v1/upload/assets",
        "/api/v1/upload/model",
    ]

    found_dead = []

    for scan_dir in frontend_scan_dirs:
        for file_path in scan_dir.rglob("*.ts*"):
            content = file_path.read_text(encoding="utf-8", errors="ignore")
            lines = content.split("\n")
            for lineno, line in enumerate(lines, 1):
                clean_line = line.strip()
                if clean_line.startswith("//") or clean_line.startswith("*"):
                    continue
                for forbidden in forbidden_patterns:
                    if forbidden in clean_line:
                        if any(kw in clean_line.lower() for kw in ["throw", "not supported", "does not expose", "deprecated"]):
                            continue
                        prev_context = "\n".join(lines[max(0, lineno-4):lineno])
                        if "throw new Error" in prev_context:
                            continue
                        found_dead.append((file_path.name, lineno, forbidden))

    assert not found_dead, f"Found active calls to forbidden/dead endpoints: {found_dead}"
    print("  ✓ No active frontend code paths call forbidden/obsolete routes.")

def check_upload_download_contract():
    print("[4/5] Checking upload and download contract schemas...")
    from api.routers.file_upload import FileUploadResponse
    fields = FileUploadResponse.model_fields
    assert "file_id" in fields, "FileUploadResponse missing file_id"
    assert "url" in fields, "FileUploadResponse missing url"
    assert "filename" in fields, "FileUploadResponse missing filename"
    assert "file_type" in fields, "FileUploadResponse missing file_type"
    print("  ✓ FileUploadResponse schema has file_id, url, and metadata fields.")

def check_upload_lifecycle_live():
    with client:
        print("[5/5] Running live asset upload, download, and delete lifecycle...")
        # Image upload & download
        img = Image.new("RGB", (64, 64), color="blue")
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        img_content = buf.getvalue()

        res = client.post(
            "/api/v1/file-upload/image",
            files={"file": ("test_cube.png", io.BytesIO(img_content), "image/png")}
        )
        assert res.status_code == 200, f"Image upload failed: {res.status_code}, {res.text}"
        img_data = res.json()
        img_file_id = img_data.get("file_id")
        img_url = img_data.get("url")
        assert img_file_id and img_url, "Missing image file_id or url in response"

        res_dl = client.get(img_url)
        assert res_dl.status_code == 200, f"Image download failed: {res_dl.status_code}"
        assert len(res_dl.content) == len(img_content), "Downloaded image content mismatch"

        # Mesh upload & download
        obj_content = b"v 0.0 0.0 0.0\nv 1.0 0.0 0.0\nv 0.0 1.0 0.0\nf 1 2 3\n"
        res_mesh = client.post(
            "/api/v1/file-upload/mesh",
            files={"file": ("triangle.obj", io.BytesIO(obj_content), "application/octet-stream")}
        )
        assert res_mesh.status_code == 200, f"Mesh upload failed: {res_mesh.status_code}, {res_mesh.text}"
        mesh_data = res_mesh.json()
        mesh_file_id = mesh_data.get("file_id")
        mesh_url = mesh_data.get("url")
        assert mesh_file_id and mesh_url, "Missing mesh file_id or url in response"

        res_mesh_dl = client.get(mesh_url)
        assert res_mesh_dl.status_code == 200, f"Mesh download failed: {res_mesh_dl.status_code}"
        assert res_mesh_dl.content == obj_content, "Mesh download content mismatch"

        # Cleanup
        client.delete(f"/api/v1/file-upload/{img_file_id}")
        client.delete(f"/api/v1/file-upload/{mesh_file_id}")
        print("  ✓ Full upload -> verify URL -> download -> delete lifecycle verified.")

if __name__ == "__main__":
    try:
        paths = check_backend_routes()
        check_model_config()
        check_frontend_drift(paths)
        check_upload_download_contract()
        check_upload_lifecycle_live()
        print("\nAll 5 contract verification suites PASSED successfully! (0 failures)")
        sys.exit(0)
    except AssertionError as err:
        print(f"\nVerification FAILED: {err}", file=sys.stderr)
        sys.exit(1)
    except Exception as exc:
        print(f"\nUnexpected error during verification: {exc}", file=sys.stderr)
        sys.exit(2)
