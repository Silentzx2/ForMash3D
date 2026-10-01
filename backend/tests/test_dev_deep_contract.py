from pathlib import Path


def test_mesh_tools_expose_all_migrated_operations():
    from backend.api.routers.mesh_tools import router

    paths = {route.path for route in router.routes}
    expected = {
        "/mesh-tools/inspect",
        "/mesh-tools/auto-uv",
        "/mesh-tools/auto-retopo",
        "/mesh-tools/repair",
        "/mesh-tools/optimize",
        "/mesh-tools/lods",
        "/mesh-tools/collision",
        "/mesh-tools/bake",
        "/mesh-tools/flatten",
        "/mesh-tools/convert",
        "/mesh-tools/segment",
    }
    assert expected <= paths


def test_canonical_result_manifest_marks_optional_exports_truthfully():
    from backend.postprocess.pipeline import MAX_PRODUCTION_FACES, _build_result

    generated = {
        "game_ready": {"glb": "/tmp/game.glb"},
        "lods": {0: "/tmp/lod0.glb"},
        "collision": None,
        "physics": None,
        "physics_metadata": None,
        "textures": {},
        "texture_status": "not_generated",
        "thumbnail": None,
    }
    result = _build_result(
        "job-test",
        Path("/tmp/asset_hash"),
        "asset",
        {"status": "pass"},
        generated,
        target_polycount=MAX_PRODUCTION_FACES,
        lod_enabled=True,
    )

    assert result["artifacts"]["master"]["required"] is True
    assert result["artifacts"]["game_ready"]["glb"]["status"] == "ready"
    assert result["artifacts"]["game_ready"]["fbx"]["status"] == "unavailable"
    assert result["artifacts"]["collision"]["status"] == "skipped"
    assert result["artifacts"]["qa_report"]["status"] == "ready"
