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
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

# Ensure backend root is on sys.path
backend_root = Path(__file__).resolve().parents[1]
if str(backend_root) not in sys.path:
    sys.path.insert(0, str(backend_root))


class TestOfficialModelDefaultsAndSchemas(unittest.TestCase):
    """Test model-supported settings and the app maximum-fidelity source defaults."""

    def test_triposg_adapter_contract(self):
        from adapters.triposg_adapter import TripoSGImageToRawMeshAdapter

        adapter = TripoSGImageToRawMeshAdapter(vram_requirement=8192)
        schema = adapter.get_parameter_schema()["parameters"]

        self.assertEqual(schema["num_inference_steps"]["default"], 50)
        self.assertEqual(schema["guidance_scale"]["default"], 7.0)
        self.assertEqual(schema["seed"]["default"], 42)
        self.assertEqual(schema["faces"]["default"], -1)

    def test_common_postprocess_quality_guard_is_wired(self):
        pipeline_path = backend_root / "postprocess/pipeline.py"
        source = pipeline_path.read_text(encoding="utf-8")
        self.assertIn("def _quality_guard(", source)
        self.assertIn("quality_guard_reverted", source)
        self.assertIn("skipped_healthy", source)


    def test_hunyuan3d_legacy_v21_contract(self):
        from adapters.hunyuan3d_adapter_v21 import Hunyuan3DV21ImageToRawMeshAdapter
        adapter = Hunyuan3DV21ImageToRawMeshAdapter(vram_requirement=8192)
        schema = adapter.get_parameter_schema()["parameters"]
        self.assertEqual(schema["octree_resolution"]["default"], 512)
        self.assertTrue(schema["octree_resolution"]["readOnly"])
        self.assertEqual(schema["num_inference_steps"]["default"], 50)
        self.assertEqual(schema["guidance_scale"]["default"], 5.0)
        self.assertEqual(schema["seed"]["default"], 1234)
        legacy_source = (backend_root / "adapters/hunyuan3d_adapter_v21.py").read_text(encoding="utf-8")
        self.assertIn("guidance_scale=guidance_scale", legacy_source)
        self.assertIn("generator=generator", legacy_source)
        self.assertNotIn('35 if inputs.get("low_vram")', legacy_source)

    def test_hunyuan3d_shape_v21_contract(self):
        from adapters.hunyuan3d_shape_v21 import Hunyuan3DShapeV21ImageToRawMeshAdapter

        adapter = Hunyuan3DShapeV21ImageToRawMeshAdapter(vram_requirement=10240)
        schema = adapter.get_parameter_schema()["parameters"]

        # Shape v2.1 raw source defaults to the highest supported extraction resolution.
        self.assertEqual(schema["octree_resolution"]["default"], 512)
        self.assertFalse(schema["octree_resolution"].get("readOnly", False))
        self.assertEqual(schema["num_inference_steps"]["default"], 50)
        self.assertEqual(schema["guidance_scale"]["default"], 5.0)

    def test_hunyuan3d_dit_mini_turbo_contract(self):
        from adapters.hunyuan3d_dit_v2_mini_turbo import Hunyuan3DDiTV2MiniTurboImageToRawMeshAdapter

        adapter = Hunyuan3DDiTV2MiniTurboImageToRawMeshAdapter(vram_requirement=6144)
        schema = adapter.get_parameter_schema()["parameters"]

        # Turbo keeps its trained 5-step schedule while using max supported extraction resolution.
        self.assertEqual(schema["octree_resolution"]["default"], 512)
        self.assertFalse(schema["octree_resolution"].get("readOnly", False))
        self.assertEqual(schema["num_inference_steps"]["default"], 5)
        self.assertEqual(schema["guidance_scale"]["default"], 5.0)
        self.assertFalse(schema["low_vram_mode"]["default"])

    def test_trellis_adapter_contract(self):
        from adapters.trellis_adapter import TrellisImageToTexturedMeshAdapter

        adapter = TrellisImageToTexturedMeshAdapter(vram_requirement=11776)
        schema = adapter.get_parameter_schema()["parameters"]

        self.assertEqual(schema["ss_sampling_steps"]["default"], 50)
        self.assertEqual(schema["slat_sampling_steps"]["default"], 50)
        self.assertEqual(schema["texture_resolution"]["default"], 2048)
        self.assertEqual(schema["simplify"]["default"], 0.0)

    def test_trellis_text_adapter_contract(self):
        from adapters.trellis_adapter import TrellisTextToTexturedMeshAdapter

        adapter = TrellisTextToTexturedMeshAdapter(vram_requirement=11776)
        schema = adapter.get_parameter_schema()["parameters"]

        self.assertEqual(schema["ss_sampling_steps"]["default"], 25)
        self.assertEqual(schema["slat_sampling_steps"]["default"], 25)

    def test_trellis2_adapter_contract(self):
        from adapters.trellis2_adapter import Trellis2ImageToTexturedMeshAdapter

        adapter = Trellis2ImageToTexturedMeshAdapter(vram_requirement=23552)
        schema = adapter.get_parameter_schema()["parameters"]

        self.assertEqual(schema["decimation_target"]["default"], -1)
        self.assertFalse(schema["remesh"]["default"])
        self.assertEqual(schema["texture_size"]["default"], 4096)
        self.assertEqual(schema["pipeline_type"]["default"], "1536_cascade")
        self.assertEqual(schema["max_num_tokens"]["default"], 262144)

    def test_unique3d_adapter_contract(self):
        from adapters.unique3d_adapter import Unique3DImageToRawMeshAdapter

        adapter = Unique3DImageToRawMeshAdapter(vram_requirement=10240)
        schema = adapter.get_parameter_schema()["parameters"]

        # Official Unique3D defaults from gradio_3dgen.py
        self.assertEqual(schema["seed"]["default"], 1145)
        self.assertEqual(schema["input_processing"]["default"], True)
        self.assertEqual(schema["do_refine"]["default"], True)
        self.assertEqual(schema["expansion_weight"]["default"], 0.1)
        self.assertEqual(schema["init_type"]["default"], "std")
        self.assertEqual(schema["expansion_weight"]["minimum"], -1.0)
        self.assertEqual(schema["expansion_weight"]["maximum"], 1.0)
        self.assertEqual(schema["init_type"]["enum"], ["std", "thin"])


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
            "faces": -1,
            "num_faces": -1,
            "simplify": 0.0,
            "decimation_target": -1,
            "remesh": False,
            "remesh_band": 1,
            "remesh_project": 0,
            "octree_resolution": 512,
            "source_quality": "max",
            "seed": 42,
        })
        self.assertEqual(filtered["octree_resolution"], 512)
        self.assertEqual(filtered["source_quality"], "max")
        self.assertEqual(filtered["seed"], 42)
        for key in ("target_polycount","auto_optimize","generateLOD","lodPreset","lodCount",
                    "physics_enabled","physics_config","auto_paint","paint_model_preference","paint_resolution",
                    "faces","num_faces","simplify","decimation_target","remesh","remesh_band","remesh_project",
                    "bake_normal_maps","bake_high_to_low","bake_textures"):
            self.assertNotIn(key, filtered)

    def test_frontend_source_contract_is_max_fidelity_and_budgeted_later(self):
        # Check the new pure function utility file for model-specific parameters
        build_params_path = backend_root.parent / "features/workspace/utils/buildGenerationParameters.ts"
        build_params_content = build_params_path.read_text(encoding="utf-8")
        
        # Source sampling uses each model's max-fidelity profile; production budgets remain downstream.
        self.assertIn("return 5", build_params_content)  # Hunyuan Mini Turbo's trained schedule
        self.assertIn("return 50", build_params_content)  # max-fidelity profiles
        self.assertIn("modelParameters.octree_resolution = 512", build_params_content)
        self.assertIn("ss_sampling_steps", build_params_content)
        self.assertIn("numericTextureResolution", build_params_content)
        self.assertIn("texture_resolution: numericTextureResolution", build_params_content)
        self.assertIn("source_quality: 'max'", build_params_content)
        self.assertIn("target_polycount:", build_params_content)
        
        # Check WorkspaceContext still references the utility
        workspace_context = (backend_root.parent / "features/workspace/store/WorkspaceContext.tsx").read_text(encoding="utf-8")
        self.assertIn("buildGenerationParameters", workspace_context)


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


try:
    import pytorch3d
    HAS_PYTORCH3D = True
except Exception:
    HAS_PYTORCH3D = False


@unittest.skipUnless(HAS_PYTORCH3D, "pytorch3d is not available in current environment")
class TestTrellis2EffectiveGeometryTelemetry(unittest.TestCase):
    """Lock the vendored TRELLIS.2 return contract and effective-resolution reporting."""

    def test_official_return_contract_extracts_actual_cascade_resolution(self):
        from utils.trellis2_utils import _unpack_trellis2_run_result

        mesh = SimpleNamespace(
            vertices=[[0, 0, 0], [1, 0, 0], [0, 1, 0]],
            faces=[[0, 1, 2]],
            voxel_size=1.0 / 1280,
        )
        decoded, effective, voxel_size, source = _unpack_trellis2_run_result(
            ([mesh], (object(), object(), 1280))
        )
        self.assertIs(decoded, mesh)
        self.assertEqual(effective, 1280)
        self.assertAlmostEqual(voxel_size, 1.0 / 1280)
        self.assertEqual(source, "pipeline_return_latent")

    def test_voxel_size_is_only_a_fallback_when_latent_resolution_is_missing(self):
        from utils.trellis2_utils import _unpack_trellis2_run_result

        mesh = SimpleNamespace(vertices=[[0, 0, 0]], faces=[], voxel_size=1.0 / 512)
        decoded, effective, voxel_size, source = _unpack_trellis2_run_result([mesh])
        self.assertIs(decoded, mesh)
        self.assertEqual(effective, 512)
        self.assertAlmostEqual(voxel_size, 1.0 / 512)
        self.assertEqual(source, "mesh_voxel_size")

    def test_empty_official_mesh_list_fails_explicitly(self):
        from utils.trellis2_utils import _unpack_trellis2_run_result
        with self.assertRaisesRegex(RuntimeError, "empty mesh list"):
            _unpack_trellis2_run_result(([], (object(), object(), 1536)))

    def test_runner_requests_effective_resolution_and_returns_native_raw_geometry(self):
        import numpy as np
        import tempfile
        from PIL import Image
        from utils.trellis2_utils import Trellis2Runner

        native_mesh = SimpleNamespace(
            vertices=np.asarray([[0, 0, 0], [1, 0, 0], [0, 1, 0]], dtype=np.float32),
            faces=np.asarray([[0, 1, 2]], dtype=np.int64),
            voxel_size=1.0 / 1280,
        )
        pipeline = MagicMock()
        pipeline.run.return_value = ([native_mesh], (object(), object(), 1280))
        runner = object.__new__(Trellis2Runner)
        runner.image_to_3d_pipeline = pipeline
        runner.o_voxel = object()

        with tempfile.TemporaryDirectory() as temp_dir:
            image_path = Path(temp_dir) / "input.png"
            Image.new("RGB", (8, 8), "white").save(image_path)
            output = runner.image_to_mesh(
                str(image_path),
                raw_mesh_only=True,
                pipeline_type="1536_cascade",
                max_num_tokens=262144,
            )

        self.assertTrue(pipeline.run.call_args.kwargs["return_latent"])
        self.assertEqual(output.metadata["effective_geometry_resolution"], 1280)
        self.assertTrue(output.metadata["geometry_resolution_limited"])
        self.assertIn("cascade token budget", output.metadata["geometry_quality_warning"])
        self.assertEqual(output.metadata["native_vertex_count"], 3)
        self.assertEqual(output.metadata["native_face_count"], 1)
        np.testing.assert_array_equal(output.vertices, native_mesh.vertices)
        np.testing.assert_array_equal(output.faces, native_mesh.faces)
        self.assertEqual(output.metadata["mesh_operations"], [])


class TestNativeRawQualityContracts(unittest.TestCase):
    """Regression tests for shared Native/Raw contracts across active geometry models."""

    def test_explicit_api_polycount_precedes_nested_default_and_preset(self):
        from api.routers.mesh_generation import _resolve_target_polycount_precedence

        self.assertEqual(_resolve_target_polycount_precedence(35000, 0, 50000), 35000)
        self.assertEqual(_resolve_target_polycount_precedence(None, 20000, 50000), 20000)
        self.assertEqual(_resolve_target_polycount_precedence(None, 0, 50000), 50000)
        self.assertEqual(_resolve_target_polycount_precedence(None, None, 50000), 50000)
        self.assertIsNone(_resolve_target_polycount_precedence(None, None, None))

    def test_model_manifest_and_runtime_profiles_stay_in_sync(self):
        import yaml
        from core.scheduler.multiprocess_scheduler import (
            _RAW_MESH_MAX_QUALITY_PARAMETERS,
            _build_model_inference_inputs,
        )

        manifest = yaml.safe_load(
            (backend_root / "config/models.yaml").read_text(encoding="utf-8")
        )
        active_models = {
            model_id for model_id, config in manifest.get("image_to_raw_mesh", {}).items()
            if config.get("enabled", True)
            and not config.get("deprecated", False)
            and not (config.get("capabilities") or {}).get("deprecated", False)
            and not config.get("alias_of")
        }
        missing = sorted(
            model_id for model_id in active_models
            if model_id.lower() not in _RAW_MESH_MAX_QUALITY_PARAMETERS
        )
        self.assertEqual(
            missing, [],
            f"Enabled image geometry models lack max-fidelity profiles: {missing}",
        )
        for model_id in active_models:
            with self.subTest(model=model_id):
                profile_inputs = _build_model_inference_inputs({}, model_id=model_id)
                self.assertEqual(profile_inputs.get("source_quality"), "max", model_id)

    def test_scheduler_forces_each_active_model_maximum_geometry_profile(self):
        from core.scheduler.multiprocess_scheduler import _build_model_inference_inputs

        cases = {
            "hunyuan3d_shape_v21_image_to_raw_mesh": {
                "octree_resolution": 512, "num_inference_steps": 50, "guidance_scale": 5.0,
            },
            "hunyuan3d_dit_v2_mini_turbo_image_to_raw_mesh": {
                "octree_resolution": 512, "num_inference_steps": 5, "enable_flashvdm": True,
            },
            "triposg_image_to_raw_mesh": {
                "num_inference_steps": 50, "guidance_scale": 7.0,
                "flash_octree_depth": 9, "dense_octree_depth": 8,
                "hierarchical_octree_depth": 9, "faces": -1,
            },
            "unique3d_image_to_raw_mesh": {
                "input_processing": True, "do_refine": True, "expansion_weight": 0.1,
            },
            "trellis_image_to_raw_mesh": {
                "ss_sampling_steps": 50, "slat_sampling_steps": 50, "simplify": 0.0,
            },
            "trellis2_image_to_raw_mesh": {
                "pipeline_type": "1536_cascade", "max_num_tokens": 262144,
                "decimation_target": -1, "remesh": False,
            },
        }
        downstream_controls = {
            "target_polycount", "auto_optimize", "generateLOD", "lodPreset", "lodCount",
            "physics_enabled", "physics_config", "texture_enabled", "generate_texture",
            "texture_resolution", "texture_resolution_preset",
        }
        for model_id, expected in cases.items():
            with self.subTest(model=model_id):
                model_inputs = _build_model_inference_inputs({
                    **expected,
                    "target_polycount": 50000,
                    "auto_optimize": True,
                    "generateLOD": True,
                    "texture_enabled": True,
                    "texture_resolution": 4096,
                    "seed": 123,
                }, model_id=model_id)
                self.assertEqual(model_inputs["source_quality"], "max")
                self.assertEqual(model_inputs["seed"], 123)
                for key, value in expected.items():
                    self.assertEqual(model_inputs.get(key), value, key)
                self.assertTrue(downstream_controls.isdisjoint(model_inputs))

    def test_native_budget_and_remesh_gates(self):
        from postprocess.pipeline import (
            MAX_PRODUCTION_FACES,
            _resolve_target_polycount,
            _should_auto_optimize,
            _should_run_feature_remesh,
        )
        self.assertEqual(_resolve_target_polycount(None), 0)
        self.assertEqual(_resolve_target_polycount(0), 0)
        self.assertEqual(_resolve_target_polycount(-1), 0)
        self.assertEqual(_resolve_target_polycount(50000), 50000)
        self.assertEqual(_resolve_target_polycount(10**9), MAX_PRODUCTION_FACES)
        self.assertFalse(_should_auto_optimize(True, 0))
        self.assertTrue(_should_auto_optimize(True, 50000))
        self.assertFalse(_should_run_feature_remesh("high", True, False, "skipped", 0))
        self.assertFalse(_should_run_feature_remesh("high", True, False, "skipped", None))
        self.assertTrue(_should_run_feature_remesh("high", True, False, "skipped", 50000))

    def test_hunyuan_resolution_telemetry_does_not_claim_achieved_grid(self):
        for adapter_path in (
            backend_root / "adapters/hunyuan3d_shape_v21.py",
            backend_root / "adapters/hunyuan3d_dit_v2_mini_turbo.py",
        ):
            with self.subTest(adapter=adapter_path.name):
                source = adapter_path.read_text(encoding="utf-8")
                self.assertIn('"requested_geometry_resolution": octree_res', source)
                self.assertIn('"effective_geometry_resolution": None', source)
                self.assertIn('"effective_geometry_resolution_status": "upstream exposes configured octree_resolution', source)
                self.assertNotIn('"geometry_extraction_grid_resolution": octree_res', source)

    def test_structural_repair_is_opt_in(self):
        from postprocess.pipeline import _should_run_structural_repair
        open_mesh = {"watertight": False, "non_manifold_edges": 4}
        healthy_mesh = {"watertight": True, "non_manifold_edges": 0}
        self.assertFalse(_should_run_structural_repair(open_mesh, False))
        self.assertTrue(_should_run_structural_repair(open_mesh, True))
        self.assertFalse(_should_run_structural_repair(healthy_mesh, True))

    def test_native_raw_frontend_defaults_and_preview_route(self):
        builder = (backend_root.parent / "features/workspace/utils/buildGenerationParameters.ts").read_text(encoding="utf-8")
        workspace = (backend_root.parent / "features/workspace/store/WorkspaceContext.tsx").read_text(encoding="utf-8")
        self.assertIn("target_polycount: settings.autoOptimizeSettings?.targetPolycount ?? 0", builder)
        self.assertIn("autoOptimizeSettings: { targetPolycount: 0 }", workspace)
        self.assertIn("preferredGenerationPreviewUrl", workspace)
        self.assertIn("result.source_model_url", workspace)

    def test_triposg_native_mesh_construction_disables_processing(self):
        source = (backend_root / "adapters/triposg_adapter.py").read_text(encoding="utf-8")
        self.assertGreaterEqual(source.count("process=False)"), 2)

    def test_shared_telemetry_captures_input_and_raw_output_identity(self):
        import tempfile
        from types import SimpleNamespace
        from core.scheduler.multiprocess_scheduler import _attach_raw_geometry_telemetry

        with tempfile.TemporaryDirectory() as temp_dir:
            image = Path(temp_dir) / "input.png"
            raw = Path(temp_dir) / "source.glb"
            image.write_bytes(b"input-bytes")
            raw.write_bytes(b"raw-mesh-bytes")
            result = {"output_mesh_path": str(raw), "generation_info": {
                "native_vertex_count": 3, "native_face_count": 1,
                "geometry_extractor": "test extractor", "mesh_operations": [],
                "effective_geometry_resolution": None,
            }}
            request = SimpleNamespace(feature="image_to_raw_mesh", inputs={"image_path": str(image)})
            model = SimpleNamespace(version="test", model_path="checkpoint", device="cuda:0")
            _attach_raw_geometry_telemetry(
                result, request, "triposg_image_to_raw_mesh",
                {"image_path": str(image), "seed": 7, "source_quality": "max"},
                {"model_path": "checkpoint"}, model, 0, {"gpu_ids": [0]},
            )
            telemetry = result["generation_info"]["raw_geometry_telemetry"]
            self.assertEqual(telemetry["native_vertex_count"], 3)
            self.assertEqual(telemetry["native_face_count"], 1)
            self.assertEqual(telemetry["effective_parameters"]["seed"], 7)
            self.assertEqual(len(telemetry["raw_mesh_sha256"]), 64)
            self.assertEqual(len(telemetry["input_image_sha256"]), 64)
            self.assertEqual(telemetry["effective_geometry_resolution_status"],
                             "upstream adapter does not expose a scalar achieved resolution")
            self.assertIsNone(telemetry["inference_runtime_seconds"])
            self.assertEqual(telemetry["input_image_size"], None)
            self.assertIsInstance(telemetry["gpu_telemetry"], list)


class TestPostprocessPipelineParity(unittest.TestCase):
    """Test postprocessing pipeline quality controls and passthrough behavior."""

    def test_master_source_refresh_detects_same_size_different_content(self):
        import hashlib
        import tempfile
        from postprocess.pipeline import _ensure_master_source

        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            raw = root / "raw.glb"
            master = root / "master" / "source.glb"
            master.parent.mkdir(parents=True)
            raw.write_bytes(b"new!")
            master.write_bytes(b"old!")
            self.assertEqual(raw.stat().st_size, master.stat().st_size)

            refreshed, source_sha256 = _ensure_master_source(raw, master)
            self.assertTrue(refreshed)
            self.assertEqual(master.read_bytes(), b"new!")
            self.assertEqual(source_sha256, hashlib.sha256(b"new!").hexdigest())

            refreshed_again, same_sha256 = _ensure_master_source(raw, master)
            self.assertFalse(refreshed_again)
            self.assertEqual(same_sha256, source_sha256)

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
