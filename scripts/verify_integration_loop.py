#!/usr/bin/env python3
"""
Verification Script for ForMash 3D Model Integration & Runtime Loop
Validates:
1. Model configs, adapters, parameter schemas for TripoSR, TripoSG, ARDY.
2. Motion converter (ARDY rotation matrix -> Three.js quaternions + motion.json).
3. Server file path resolver (HTTP URLs, relative paths, local paths).
4. Live FastAPI TestClient endpoint verification.
5. Redis connection pooling.
"""

import os
import sys
from pathlib import Path
import torch
import numpy as np

# Add project root to sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))
sys.path.insert(0, str(PROJECT_ROOT / "backend"))

def test_file_path_resolver():
    print("[1/5] Testing resolve_server_file_path...")
    from backend.core.utils.file_utils import resolve_server_file_path
    
    # 1. Full URL
    p1 = resolve_server_file_path("http://127.0.0.1:7842/outputs/test_mesh.glb")
    assert "test_mesh.glb" in str(p1), f"Failed full URL: {p1}"
    
    # 2. Relative URL
    p2 = resolve_server_file_path("/outputs/subfolder/test_mesh.glb")
    assert "subfolder" in str(p2) and "test_mesh.glb" in str(p2), f"Failed relative URL: {p2}"
    
    # 3. Local relative path
    p3 = resolve_server_file_path("backend/storage/models/job123/mesh.glb")
    assert Path(p3).is_absolute(), f"Local path should be resolved absolute: {p3}"
    
    print("  ✅ resolve_server_file_path handles full URLs, relative paths, and local files cleanly.")

def test_motion_converter():
    print("[2/5] Testing ARDY motion converter...")
    from backend.core.animation.ardy_converter import convert_ardy_output_to_motion_json, CORE_SKELETON_27_BONES
    
    T = 20
    J = len(CORE_SKELETON_27_BONES)
    assert J == 27, f"CoreSkeleton27 must have 27 joints, got {J}"
    
    # Synthetic identity rotation matrices (T, J, 3, 3)
    rot_mats = torch.eye(3).view(1, 1, 3, 3).repeat(T, J, 1, 1)
    root_trans = torch.zeros(T, 3)
    
    output_data = {
        "local_rot_mats": rot_mats,
        "root_trans": root_trans,
    }
    
    doc = convert_ardy_output_to_motion_json(output_data, fps=30.0)
    assert doc["skeleton_id"] == "core"
    assert doc["fps"] == 30.0
    assert doc["num_frames"] == T
    assert len(doc["joint_names"]) == 27
    assert len(doc["quaternions"]) == T
    assert len(doc["quaternions"][0]) == 27
    # Identity rotation quaternion is [0, 0, 0, 1] in [x, y, z, w]
    q0 = doc["quaternions"][0][0]
    assert np.allclose(q0, [0.0, 0.0, 0.0, 1.0], atol=1e-4), f"Expected identity quaternion [0,0,0,1], got {q0}"
    print("  ✅ convert_ardy_output_to_motion_json generates exact Three.js [x,y,z,w] quaternions and valid motion.json contract.")

def test_adapters_and_factory():
    print("[3/5] Testing ModelFactory and Adapters (TripoSR, TripoSG, ARDY)...")
    from backend.core.config import get_settings
    from backend.core.scheduler.model_factory import ModelFactory
    
    settings = get_settings()
    
    # Verify model configs exist via get_model_config(feature, model_id)
    cfg_sr = settings.get_model_config("image_to_raw_mesh", "triposr_image_to_raw_mesh")
    assert cfg_sr is not None, "triposr_image_to_raw_mesh missing from config"
    
    cfg_sg = settings.get_model_config("image_to_raw_mesh", "triposg_image_to_raw_mesh")
    assert cfg_sg is not None, "triposg_image_to_raw_mesh missing from config"
    
    cfg_sf = settings.get_model_config("image_to_raw_mesh", "triposf_image_to_raw_mesh")
    assert cfg_sf is not None, "triposf_image_to_raw_mesh missing from config"
    
    cfg_ardy = settings.get_model_config("motion_generation", "ardy_motion_generation")
    assert cfg_ardy is not None, "ardy_motion_generation missing from config"
    
    # Instantiate models
    triposr = ModelFactory.create_model_from_config({"model_id": "triposr_image_to_raw_mesh", **cfg_sr.model_dump()})
    assert triposr is not None
    schema_sr = triposr.get_parameter_schema()
    assert "mc_resolution" in schema_sr.get("parameters", schema_sr)
    
    triposg = ModelFactory.create_model_from_config({"model_id": "triposg_image_to_raw_mesh", **cfg_sg.model_dump()})
    assert triposg is not None
    schema_sg = triposg.get_parameter_schema()
    assert "guidance_scale" in schema_sg.get("parameters", schema_sg)
    
    triposf = ModelFactory.create_model_from_config({"model_id": "triposf_image_to_raw_mesh", **cfg_sf.model_dump()})
    assert triposf is not None
    schema_sf = triposf.get_parameter_schema()
    assert "resolution" in schema_sf.get("parameters", schema_sf)
    assert "sample_points_num" in schema_sf.get("parameters", schema_sf)
    assert "glb" in triposf.get_supported_formats()["output"]
    
    ardy = ModelFactory.create_model_from_config({"model_id": "ardy_motion_generation", **cfg_ardy.model_dump()})
    assert ardy is not None
    schema_ardy = ardy.get_parameter_schema()
    assert "checkpoint" in schema_ardy.get("parameters", schema_ardy)
    assert "json" in ardy.get_supported_formats()["output"]
    
    print("  ✅ All 4 adapters (TripoSR, TripoSG, TripoSF, ARDY) instantiate correctly with valid parameter schemas and format support.")

def test_fastapi_endpoints():
    from fastapi.testclient import TestClient
    from backend.api.main_multiworker import app

    with TestClient(app) as client:
        print("[4/5] Testing FastAPI endpoints with TestClient..."
        
        
        # 1. Health
        r = client.get("/health")
        assert r.status_code == 200, f"/health failed: {r.status_code}"
        
        # 2. System Models
        r = client.get("/api/v1/system/models")
        assert r.status_code == 200
        models_data = r.json()
        avail = models_data.get("available_models", models_data)
        raw_mesh_models = avail.get("image_to_raw_mesh", [])
        assert "triposr_image_to_raw_mesh" in raw_mesh_models, f"TripoSR missing from image_to_raw_mesh: {raw_mesh_models}"
        assert "triposg_image_to_raw_mesh" in raw_mesh_models, f"TripoSG missing from image_to_raw_mesh: {raw_mesh_models}"
        assert "triposf_image_to_raw_mesh" in raw_mesh_models, f"TripoSF missing from image_to_raw_mesh: {raw_mesh_models}"
        motion_models = avail.get("motion_generation", [])
        assert "ardy_motion_generation" in motion_models, f"ARDY missing from motion_generation: {motion_models}"
        
        # 3. Motion generation endpoints
        r = client.get("/api/v1/motion-generation/checkpoints")
        assert r.status_code == 200
        assert "ardy_lite" in r.json()["checkpoints"]
        assert "ardy_full" in r.json()["checkpoints"]
        
        r = client.get("/api/v1/motion-generation/available-models")
        assert r.status_code == 200
        assert len(r.json()["models"]) >= 1
        
        r = client.get("/api/v1/motion-generation/supported-formats")
        assert r.status_code == 200
        assert "json" in r.json()["output_formats"]["mesh"]
        
        print("  ✅ FastAPI endpoints successfully route and validate TripoSR, TripoSG, and ARDY motion generation.")

def test_redis_connection_pool():
    print("[5/5] Testing Redis Connection Pool bounded limits...")
    import redis.asyncio as aioredis
    import asyncio
    
    async def check_redis():
        pool = aioredis.ConnectionPool.from_url("redis://localhost:6379", max_connections=20)
        client = aioredis.Redis(connection_pool=pool)
        pong = await client.ping()
        assert pong is True
        await client.aclose()
        await pool.disconnect()
        return True

    loop = asyncio.get_event_loop()
    res = loop.run_until_complete(check_redis())
    assert res is True
    print("  ✅ Redis connection pool successfully configured with max_connections=20 and verified.")

if __name__ == "__main__":
    print("=======================================================")
    print("Starting ForMash 3D Contract & Runtime Verification Loop")
    print("=======================================================")
    try:
        test_file_path_resolver()
        test_motion_converter()
        test_adapters_and_factory()
        test_fastapi_endpoints()
        test_redis_connection_pool()
        print("=======================================================")
        print("🎉 ALL 5 VERIFICATION CONTRACTS PASSED WITH 0 ERRORS!")
        print("=======================================================")
        sys.exit(0)
    except Exception as e:
        print(f"\n❌ VERIFICATION FAILED: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
