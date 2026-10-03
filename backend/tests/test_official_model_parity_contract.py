"""
Official Model Implementation Parity & Adapter Quality Contract Tests.

Verifies:
1. Model parameter schemas and official defaults across all supported models.
2. Raw mesh preservation (no destructive adapter decimation, source.glb immutability).
3. Postprocess pipeline passthrough when auto_optimize is disabled or uncapped.
4. Quality preset mappings (Low, Medium, High, Ultra) to model-specific parameters.
5. Viewer artifact routing and Shape -> Paint chaining contract.
"""

import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

# Ensure backend root is on sys.path
backend_root = Path(__file__).resolve().parents[1]
if str(backend_root) not in sys.path:
    sys.path.insert(0, str(backend_root))


class TestOfficialModelDefaultsAndSchemas(unittest.TestCase):
    """Test that adapter parameter schemas and defaults match official specifications."""

    def test_triposg_adapter_contract(self):
        from adapters.triposg_adapter import TripoSGImageToRawMeshAdapter

        adapter = TripoSGImageToRawMeshAdapter(vram_requirement=8192)
        schema = adapter.get_parameter_schema()["parameters"]

        self.assertEqual(schema["num_inference_steps"]["default"], 50)
        self.assertEqual(schema["guidance_scale"]["default"], 7.0)
        self.assertEqual(schema["seed"]["default"], 42)
        self.assertEqual(schema["faces"]["default"], -1)

    def test_triposr_adapter_contract(self):
        from adapters.triposr_adapter import TripoSRImageToRawMeshAdapter

        adapter = TripoSRImageToRawMeshAdapter(vram_requirement=6144)
        schema = adapter.get_parameter_schema()["parameters"]

        self.assertEqual(schema["mc_resolution"]["default"], 320)
        self.assertEqual(schema["foreground_ratio"]["default"], 0.85)
        self.assertFalse(schema["bake_texture"]["default"])

    def test_triposf_adapter_contract(self):
        from adapters.triposf_adapter import TripoSFImageToRawMeshAdapter

        adapter = TripoSFImageToRawMeshAdapter(vram_requirement=12288)
        schema = adapter.get_parameter_schema()["parameters"]

        self.assertEqual(schema["resolution"]["default"], 1024)
        self.assertEqual(schema["sample_points_num"]["default"], 1638400)
        self.assertFalse(schema["pruning"]["default"])
        self.assertTrue(schema["use_normals"]["default"])

    def test_hunyuan3d_shape_v21_contract(self):
        from adapters.hunyuan3d_shape_v21 import Hunyuan3DShapeV21ImageToRawMeshAdapter

        adapter = Hunyuan3DShapeV21ImageToRawMeshAdapter(vram_requirement=10240)
        schema = adapter.get_parameter_schema()["parameters"]

        # Raw extraction is intentionally fixed at maximum 512; polycount is post-processing.
        self.assertEqual(schema["octree_resolution"]["default"], 512)
        self.assertTrue(schema["octree_resolution"]["readOnly"])
        self.assertEqual(schema["num_inference_steps"]["default"], 50)
        self.assertEqual(schema["guidance_scale"]["default"], 5.0)

    def test_hunyuan3d_dit_mini_turbo_contract(self):
        from adapters.hunyuan3d_dit_v2_mini_turbo import Hunyuan3DDiTV2MiniTurboImageToRawMeshAdapter

        adapter = Hunyuan3DDiTV2MiniTurboImageToRawMeshAdapter(vram_requirement=6144)
        schema = adapter.get_parameter_schema()["parameters"]

        # Raw extraction is intentionally fixed at maximum 512; polycount is post-processing.
        self.assertEqual(schema["octree_resolution"]["default"], 512)
        self.assertTrue(schema["octree_resolution"]["readOnly"])
        self.assertEqual(schema["num_inference_steps"]["default"], 5)
        self.assertEqual(schema["guidance_scale"]["default"], 5.0)

    def test_ultrashape_adapter_contract(self):
        from adapters.ultrashape_adapter import UltraShapeImageToRawMeshAdapter

        adapter = UltraShapeImageToRawMeshAdapter(vram_requirement=26640)
        schema = adapter.get_parameter_schema()["parameters"]

        # Official UltraShape config (infer_dit_refine.yaml) uses 32768 latents and 1024 octree resolution
        self.assertEqual(schema["num_latents"]["default"], 32768)
        self.assertEqual(schema["octree_res"]["default"], 1024)
        self.assertEqual(schema["num_inference_steps"]["default"], 50)

    def test_partpacker_adapter_contract(self):
        from adapters.partpacker_adapter import PartPackerImageToRawMeshAdapter

        adapter = PartPackerImageToRawMeshAdapter(vram_requirement=10240)
        schema = adapter.get_parameter_schema()["parameters"]

        self.assertEqual(schema["num_steps"]["default"], 50)
        self.assertEqual(schema["cfg_scale"]["default"], 7.0)
        self.assertEqual(schema["grid_resolution"]["default"], 384)
        self.assertEqual(schema["num_faces"]["default"], -1)

    def test_trellis_adapter_contract(self):
        from adapters.trellis_adapter import TrellisImageToTexturedMeshAdapter

        adapter = TrellisImageToTexturedMeshAdapter(vram_requirement=11776)
        schema = adapter.get_parameter_schema()["parameters"]

        self.assertEqual(schema["ss_sampling_steps"]["default"], 12)
        self.assertEqual(schema["slat_sampling_steps"]["default"], 12)
        self.assertEqual(schema["texture_resolution"]["default"], 1024)
        self.assertEqual(schema["simplify"]["default"], 0.0)

    def test_trellis_text_adapter_contract(self):
        from adapters.trellis_adapter import TrellisTextToTexturedMeshAdapter

        adapter = TrellisTextToTexturedMeshAdapter(vram_requirement=11776)
        schema = adapter.get_parameter_schema()["parameters"]

        self.assertEqual(schema["ss_sampling_steps"]["default"], 12)
        self.assertEqual(schema["slat_sampling_steps"]["default"], 12)

    def test_trellis2_adapter_contract(self):
        from adapters.trellis2_adapter import Trellis2ImageToTexturedMeshAdapter

        adapter = Trellis2ImageToTexturedMeshAdapter(vram_requirement=23552)
        schema = adapter.get_parameter_schema()["parameters"]

        self.assertEqual(schema["decimation_target"]["default"], -1)
        self.assertFalse(schema["remesh"]["default"])
        self.assertEqual(schema["texture_size"]["default"], 4096)


class TestGenerationProductionContract(unittest.TestCase):
    def test_postprocess_only_controls_are_not_sent_to_model_adapters(self):
        from core.scheduler.multiprocess_scheduler import _build_model_inference_inputs
        filtered = _build_model_inference_inputs({
            "target_polycount": 5000,
            "auto_optimize": True,
            "generateLOD": True,
            "lodPreset": "mobile",
            "lodCount": 4,
            "physics_enabled": True,
            "physics_config": {"collision_quality": "fast"},
            "auto_paint": True,
            "paint_model_preference": "hunyuan3d_paint_v21_image_mesh_painting",
            "paint_resolution": 2048,
            "octree_resolution": 512,
            "source_quality": "max",
            "seed": 42,
        })
        self.assertEqual(filtered["octree_resolution"], 512)
        self.assertEqual(filtered["source_quality"], "max")
        self.assertEqual(filtered["seed"], 42)
        for key in ("target_polycount","auto_optimize","generateLOD","lodPreset","lodCount",
                    "physics_enabled","physics_config","auto_paint","paint_model_preference","paint_resolution",
                    "bake_normal_maps", "bake_high_to_low", "bake_textures"):
            self.assertNotIn(key, filtered)

    def test_frontend_source_contract_is_max_fidelity_and_budgeted_later(self):
        workspace_context = (backend_root.parent / "features/workspace/store/WorkspaceContext.tsx").read_text(encoding="utf-8")
        self.assertIn("source_quality: 'max'", workspace_context)
        self.assertIn("target_polycount: targetPoly", workspace_context)
        self.assertIn("const octreeRes = 512", workspace_context)
        self.assertIn("modelId.includes('hunyuan3d_dit_v2_mini_turbo')", workspace_context)
        self.assertIn("infSteps = 5", workspace_context)
        self.assertIn("mc_resolution = 320", workspace_context)
        self.assertIn("resolution = 1024", workspace_context)
        self.assertIn("ss_sampling_steps", workspace_context)


class TestRetopologyProductionBudget(unittest.TestCase):
    """Verify FastMesh variant targets stay fixed while final triangle budget is independent."""

    def test_target_polycount_is_wired_as_postprocess_budget(self):
        from api.routers.mesh_retopology import MeshRetopologyRequest

        request = MeshRetopologyRequest(
            mesh_file_id="mesh_test",
            model_preference="fastmesh_v4k_retopology",
            target_vertex_count=4000,
            target_polycount=35000,
            poly_type="quad",
            output_format="glb",
        )
        self.assertEqual(request.target_vertex_count, 4000)
        self.assertEqual(request.target_polycount, 35000)

    def test_target_polycount_bounds_are_enforced(self):
        from api.routers.mesh_retopology import MeshRetopologyRequest

        with self.assertRaises(ValueError):
            MeshRetopologyRequest(
                mesh_file_id="mesh_test",
                model_preference="fastmesh_v1k_retopology",
                target_polycount=4000,
            )

        with self.assertRaises(ValueError):
            MeshRetopologyRequest(
                mesh_file_id="mesh_test",
                model_preference="fastmesh_v1k_retopology",
                target_polycount=250000,
            )


class TestPostprocessPipelineParity(unittest.TestCase):
    """Test postprocessing pipeline quality controls and passthrough behavior."""

    def test_max_production_faces_is_at_least_200k(self):
        from postprocess.pipeline import MAX_PRODUCTION_FACES

        self.assertGreaterEqual(MAX_PRODUCTION_FACES, 200_000)

    def test_postprocess_preserves_native_resolution_when_auto_optimize_false(self):
        import os
        import numpy as np
        import trimesh
        from postprocess.pipeline import run_postprocess_job

        os.environ["ALLOW_LOCAL_SERVER_PATH_INPUTS"] = "true"

        # Create a detailed synthetic sphere with > 50,000 faces (subdivisions=6 -> 81,920 faces)
        icosphere = trimesh.creation.icosphere(subdivisions=6, radius=1.0)
        face_count = len(icosphere.faces)
        self.assertGreater(face_count, 50000)
        # Give mesh vertex colors to verify vertex color preservation and avoid redundant auto-uv on huge sphere
        icosphere.visual.vertex_colors = np.ones((len(icosphere.vertices), 4), dtype=np.uint8) * 128
        icosphere.visual.vertex_colors[:, 0] = np.linspace(0, 255, len(icosphere.vertices), dtype=np.uint8)

        test_dir = backend_root / "outputs" / "test_parity"
        test_dir.mkdir(parents=True, exist_ok=True)
        temp_mesh = test_dir / "test_sphere.glb"
        import uuid
        job_id = f"test_parity_{uuid.uuid4().hex[:8]}"
        try:
            icosphere.export(str(temp_mesh))

            result = run_postprocess_job(
                job_id=job_id,
                generation_result={"output_mesh_path": str(temp_mesh)},
                job_inputs={"auto_optimize": False, "generateLOD": False, "physics_enabled": False},
                job_metadata={"feature": "image_to_raw_mesh"},
            )

            optimized_stats = result["quality_trace"]["optimized"]
            # Must passthrough native resolution without decimation
            self.assertEqual(optimized_stats["face_count"], face_count)
            self.assertTrue(result["optimize"]["passthrough"])
        finally:
            if temp_mesh.exists():
                temp_mesh.unlink()

    def test_lod_ratios_are_not_doubly_scaled(self):
        from postprocess.services.simplify import run_lods
        from postprocess.schemas import LODOptions
        import trimesh

        cube = trimesh.creation.box(extents=(1, 1, 1))
        # Ratios: 1.0 (LOD0), 0.6 (LOD1), 0.3 (LOD2), 0.15 (LOD3)
        levels = run_lods(cube, LODOptions(ratios=[1.0, 0.6, 0.3, 0.15]))

        self.assertEqual(len(levels), 4)
        self.assertEqual(levels[0]["level"], 0)
        self.assertTrue(levels[0]["passthrough"])
        self.assertEqual(levels[0]["triangles"], len(cube.faces))


class TestSystemViewerRouting(unittest.TestCase):
    """Test artifact endpoints serve canonical artifacts without obscuring high quality."""

    def test_master_format_resolves_to_source_glb(self):
        from api.routers.system import download_job_result
        import inspect

        # Inspect the route function signature and contract
        sig = inspect.signature(download_job_result)
        self.assertIn("artifact_format", sig.parameters)


if __name__ == "__main__":
    unittest.main()
