"""
Verification tests for API router preset alignment and database persistence.
Tests:
1. _resolve_target_polycount_precedence ensures 0 does not clobber preset values.
2. generate_mesh_from_image (single and batch) ensures intent presets (game_ready, cinematic, animation, 3d_print, mobile)
   set target_polycount, generateLOD, lodPreset, lodCount, auto_uv, and quality without being overridden by frontend defaults.
3. auto_uv and quality are passed properly in job_request.inputs and job_request.metadata.
4. check_job_asset_persistence verifies postprocessing outputs (LODs, collisions, formats, quad OBJ, FBX) and metadata.
"""

import unittest
from unittest.mock import AsyncMock, MagicMock, patch
from pathlib import Path
import tempfile
import yaml

from api.routers.mesh_generation import (
    _resolve_target_polycount_precedence,
    generate_mesh_from_image,
    generate_mesh_from_image_batch,
    image_to_raw_mesh,
    image_to_textured_mesh,
    ImageToRawMeshRequest,
    ImageToTexturedMeshRequest,
    BatchImageToMeshRequest,
)
from api.routers.database import check_job_asset_persistence

CONFIG_DIR = Path(__file__).resolve().parents[1] / "config"
with open(CONFIG_DIR / "smart_presets.yaml", "r", encoding="utf-8") as f:
    SMART_PRESETS = yaml.safe_load(f)


async def mock_resolve_generation_plan(request, *, default_model: str, default_feature: str, scheduler=None):
    preset = dict(SMART_PRESETS.get("intents", {}).get(request.intent, {}))
    preset_metadata = {
        "intent": request.intent,
        "smart_preset_version": SMART_PRESETS.get("version", 1),
        "applied_preset": preset,
        "chosen_model": request.model_preference or default_model,
        "candidate_order": [request.model_preference or default_model],
        "vram_budget_mb": 16000,
    }
    return request.model_preference or default_model, default_feature, preset, preset_metadata


class TestPresetPrecedence(unittest.TestCase):
    def test_target_polycount_precedence_with_zero(self):
        # 0 must not clobber preset
        self.assertEqual(_resolve_target_polycount_precedence(None, 0, 50000), 50000)
        self.assertEqual(_resolve_target_polycount_precedence(0, 0, 50000), 50000)
        self.assertEqual(_resolve_target_polycount_precedence(0, None, 200000), 200000)

        # explicit > 0 overrides preset
        self.assertEqual(_resolve_target_polycount_precedence(75000, 0, 50000), 75000)
        self.assertEqual(_resolve_target_polycount_precedence(None, 40000, 50000), 40000)
        self.assertEqual(_resolve_target_polycount_precedence(60000, 40000, 50000), 60000)

        # 3d_print preset (target_polycount=0) returns 0 when no explicit override
        self.assertEqual(_resolve_target_polycount_precedence(None, 0, 0), 0)
        self.assertEqual(_resolve_target_polycount_precedence(None, None, 0), 0)


class TestIntentPresetsInMeshGeneration(unittest.IsolatedAsyncioTestCase):
    @patch("api.routers.mesh_generation._resolve_generation_plan", side_effect=mock_resolve_generation_plan)
    async def test_all_five_intent_presets_in_generate_mesh_from_image(self, _mock_plan):
        b64_png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

        intents_expected = {
            "game_ready": {
                "target_polycount": 50000,
                "generateLOD": True,
                "lodPreset": "high",
                "lodCount": 4,
                "auto_uv": True,
                "quality": "high",
            },
            "cinematic": {
                "target_polycount": 200000,
                "generateLOD": True,
                "lodPreset": "high",
                "lodCount": 4,
                "auto_uv": True,
                "quality": "ultra",
            },
            "animation": {
                "target_polycount": 30000,
                "generateLOD": True,
                "lodPreset": "high",
                "lodCount": 4,
                "auto_uv": True,
                "quality": "high",
            },
            "3d_print": {
                "target_polycount": 0,
                "generateLOD": False,
                "lodPreset": "high",
                "lodCount": 0,
                "auto_uv": False,
                "quality": "high",
            },
            "mobile": {
                "target_polycount": 20000,
                "generateLOD": True,
                "lodPreset": "mobile",
                "lodCount": 4,
                "auto_uv": True,
                "quality": "high",
            },
        }

        for intent_name, expected in intents_expected.items():
            mock_scheduler = MagicMock()
            mock_scheduler.validate_model_preference.return_value = True
            mock_scheduler.model_registry = {}
            scheduled_job = None

            async def fake_schedule(job_req):
                nonlocal scheduled_job
                scheduled_job = job_req
                return f"job-{intent_name}-123"

            mock_scheduler.schedule_job = AsyncMock(side_effect=fake_schedule)

            # Frontend defaults sent via autoOptimizeSettings: target_polycount=0, generateLOD=True, lodPreset='high', lodCount=4
            req = ImageToRawMeshRequest(
                image_base64=b64_png,
                intent=intent_name,
                model_parameters={
                    "target_polycount": 0,
                    "generateLOD": True,
                    "lodPreset": "high",
                    "lodCount": 4,
                },
            )

            resp = await generate_mesh_from_image(req, scheduler=mock_scheduler)
            self.assertEqual(resp.job_id, f"job-{intent_name}-123")
            self.assertIsNotNone(scheduled_job)

            inputs = scheduled_job.inputs
            self.assertEqual(inputs.get("target_polycount"), expected["target_polycount"], f"Failed target_polycount for {intent_name}")
            self.assertEqual(inputs.get("generateLOD"), expected["generateLOD"], f"Failed generateLOD for {intent_name}")
            self.assertEqual(inputs.get("lodPreset"), expected["lodPreset"], f"Failed lodPreset for {intent_name}")
            self.assertEqual(inputs.get("lodCount"), expected["lodCount"], f"Failed lodCount for {intent_name}")
            self.assertEqual(inputs.get("auto_uv"), expected["auto_uv"], f"Failed auto_uv for {intent_name}")
            self.assertEqual(inputs.get("quality"), expected["quality"], f"Failed quality for {intent_name}")

            meta = scheduled_job.metadata
            self.assertEqual(meta.get("target_polycount"), expected["target_polycount"], f"Failed metadata target_polycount for {intent_name}")
            self.assertEqual(meta.get("generateLOD"), expected["generateLOD"], f"Failed metadata generateLOD for {intent_name}")
            self.assertEqual(meta.get("lodPreset"), expected["lodPreset"], f"Failed metadata lodPreset for {intent_name}")
            self.assertEqual(meta.get("lodCount"), expected["lodCount"], f"Failed metadata lodCount for {intent_name}")
            self.assertEqual(meta.get("auto_uv"), expected["auto_uv"], f"Failed metadata auto_uv for {intent_name}")
            self.assertEqual(meta.get("quality"), expected["quality"], f"Failed metadata quality for {intent_name}")

    @patch("api.routers.mesh_generation._resolve_generation_plan", side_effect=mock_resolve_generation_plan)
    async def test_image_to_textured_mesh_presets(self, _mock_plan):
        b64_png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

        mock_scheduler = MagicMock()
        mock_scheduler.validate_model_preference.return_value = True
        mock_scheduler.model_registry = {}
        scheduled_job = None

        async def fake_schedule(job_req):
            nonlocal scheduled_job
            scheduled_job = job_req
            return "job-textured-cinematic"

        mock_scheduler.schedule_job = AsyncMock(side_effect=fake_schedule)

        req = ImageToTexturedMeshRequest(
            image_base64=b64_png,
            intent="cinematic",
            model_parameters={"target_polycount": 0, "generateLOD": True},
        )
        resp = await image_to_textured_mesh(req, scheduler=mock_scheduler)
        self.assertEqual(resp.job_id, "job-textured-cinematic")
        self.assertIsNotNone(scheduled_job)
        self.assertEqual(scheduled_job.inputs.get("target_polycount"), 200000)
        self.assertEqual(scheduled_job.inputs.get("quality"), "ultra")
        self.assertEqual(scheduled_job.inputs.get("auto_uv"), True)
        self.assertEqual(scheduled_job.metadata.get("target_polycount"), 200000)
        self.assertEqual(scheduled_job.metadata.get("quality"), "ultra")
        self.assertEqual(scheduled_job.metadata.get("auto_uv"), True)

    @patch("api.routers.mesh_generation._resolve_generation_plan", side_effect=mock_resolve_generation_plan)
    async def test_batch_generate_mesh_from_image(self, _mock_plan):
        b64_png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

        mock_scheduler = MagicMock()
        mock_scheduler.validate_model_preference.return_value = True
        mock_scheduler.model_registry = {}
        scheduled_jobs = []

        async def fake_schedule(job_req):
            scheduled_jobs.append(job_req)
            return f"job-batch-{len(scheduled_jobs)}"

        mock_scheduler.schedule_job = AsyncMock(side_effect=fake_schedule)

        batch_req = BatchImageToMeshRequest(
            items=[
                ImageToRawMeshRequest(image_base64=b64_png, intent="mobile", model_parameters={"target_polycount": 0}),
                ImageToRawMeshRequest(image_base64=b64_png, intent="cinematic", model_parameters={"target_polycount": 0}),
            ]
        )

        resp = await generate_mesh_from_image_batch(batch_req, scheduler=mock_scheduler)
        self.assertEqual(len(resp.job_ids), 2)
        self.assertEqual(len(scheduled_jobs), 2)

        self.assertEqual(scheduled_jobs[0].inputs["target_polycount"], 20000)
        self.assertEqual(scheduled_jobs[0].inputs["lodPreset"], "mobile")
        self.assertEqual(scheduled_jobs[0].inputs["quality"], "high")
        self.assertEqual(scheduled_jobs[0].metadata["target_polycount"], 20000)
        self.assertEqual(scheduled_jobs[0].metadata["lodPreset"], "mobile")
        self.assertEqual(scheduled_jobs[0].metadata["quality"], "high")

        self.assertEqual(scheduled_jobs[1].inputs["target_polycount"], 200000)
        self.assertEqual(scheduled_jobs[1].inputs["quality"], "ultra")
        self.assertEqual(scheduled_jobs[1].metadata["target_polycount"], 200000)
        self.assertEqual(scheduled_jobs[1].metadata["quality"], "ultra")


class TestDatabasePersistenceCheck(unittest.TestCase):
    def test_check_job_asset_persistence(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            asset_root = Path(tmpdir)
            meta_dir = asset_root / "metadata"
            meta_dir.mkdir(parents=True)
            (meta_dir / "asset.json").write_text("{}")
            (meta_dir / "job.json").write_text("{}")

            job_status = {
                "status": "completed",
                "result": {
                    "asset_root": str(asset_root),
                    "output_mesh_path": str(asset_root / "game_ready" / "model.glb"),
                    "game_ready_formats": {
                        "glb": "/download?format=glb",
                        "obj": "/download?format=obj",
                        "fbx": "/download?format=fbx",
                    },
                    "lods": ["lod0.glb", "lod1.glb"],
                    "collision": "collision.glb",
                    "artifacts": {
                        "qa_report": {"status": "ready"},
                    },
                },
            }

            check = check_job_asset_persistence(job_status)
            self.assertTrue(check["has_result"])
            self.assertTrue(check["lods_persisted"])
            self.assertTrue(check["collision_persisted"])
            self.assertTrue(check["formats_persisted"])
            self.assertTrue(check["quad_obj_persisted"])
            self.assertTrue(check["fbx_persisted"])
            self.assertTrue(check["metadata_persisted"])
            self.assertTrue(check["asset_record_on_disk"])
            self.assertTrue(check["job_record_on_disk"])


class TestEnablePostprocessToggle(unittest.IsolatedAsyncioTestCase):
    """Verify that toggling off postprocess from UI/API bypasses postprocessing after mesh gen."""

    @patch("api.routers.mesh_generation._resolve_generation_plan", side_effect=mock_resolve_generation_plan)
    async def test_enable_postprocess_false_sets_postprocess_mode_none(self, _mock_plan):
        b64_png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
        mock_scheduler = MagicMock()
        mock_scheduler.validate_model_preference.return_value = True
        scheduled_jobs = []

        async def capture_job(job_request):
            scheduled_jobs.append(job_request)
            return "job-bypass-123"

        mock_scheduler.schedule_job = AsyncMock(side_effect=capture_job)

        req = ImageToRawMeshRequest(
            image_base64=b64_png,
            intent="game_ready",
            enable_postprocess=False,
        )

        resp = await generate_mesh_from_image(req, scheduler=mock_scheduler, file_store=MagicMock())
        self.assertEqual(resp.job_id, "job-bypass-123")
        self.assertEqual(len(scheduled_jobs), 1)

        job = scheduled_jobs[0]
        self.assertFalse(job.inputs["enable_postprocess"])
        self.assertFalse(job.metadata["enable_postprocess"])
        self.assertEqual(job.metadata["postprocess_mode"], "none")

    @patch("api.routers.mesh_generation._resolve_generation_plan", side_effect=mock_resolve_generation_plan)
    async def test_enable_postprocess_true_by_default(self, _mock_plan):
        b64_png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
        mock_scheduler = MagicMock()
        mock_scheduler.validate_model_preference.return_value = True
        scheduled_jobs = []

        async def capture_job(job_request):
            scheduled_jobs.append(job_request)
            return "job-prod-456"

        mock_scheduler.schedule_job = AsyncMock(side_effect=capture_job)

        req = ImageToRawMeshRequest(
            image_base64=b64_png,
            intent="game_ready",
        )

        resp = await generate_mesh_from_image(req, scheduler=mock_scheduler, file_store=MagicMock())
        self.assertEqual(resp.job_id, "job-prod-456")
        self.assertEqual(len(scheduled_jobs), 1)

        job = scheduled_jobs[0]
        self.assertTrue(job.inputs["enable_postprocess"])
        self.assertTrue(job.metadata["enable_postprocess"])
        self.assertEqual(job.metadata["postprocess_mode"], "production_mesh")


class TestCanonicalPresetsAndOverrides(unittest.IsolatedAsyncioTestCase):
    def test_canonical_intents_validation(self):
        from pydantic import ValidationError
        b64_png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
        canonical = ["mobile", "game_ready", "cinematic", "animation", "3d_print", "native"]
        for intent in canonical:
            req = ImageToRawMeshRequest(image_base64=b64_png, intent=intent)
            self.assertEqual(req.intent, intent)

        with self.assertRaises(ValidationError):
            ImageToRawMeshRequest(image_base64=b64_png, intent="invalid_preset_id")

    def test_candidate_count_boundaries(self):
        from pydantic import ValidationError
        b64_png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
        for c in [1, 2, 4]:
            req = ImageToRawMeshRequest(image_base64=b64_png, candidate_count=c)
            self.assertEqual(req.candidate_count, c)

        with self.assertRaises(ValidationError):
            ImageToRawMeshRequest(image_base64=b64_png, candidate_count=0)

        with self.assertRaises(ValidationError):
            ImageToRawMeshRequest(image_base64=b64_png, candidate_count=5)

    def test_target_polycount_and_fake_fields_isolated_from_inference(self):
        from core.scheduler.multiprocess_scheduler import _build_model_inference_inputs
        job_inputs = {
            "image_path": "/tmp/test.png",
            "seed": 42,
            "target_polycount": 50000,
            "mesh_style": "clean",
            "requested_quality": "high",
            "object_type": "mechanical",
            "symmetry": "radial",
            "generateLOD": True,
        }
        inference_inputs = _build_model_inference_inputs(job_inputs, "hunyuan3d_shape_v21_image_to_raw_mesh")
        self.assertNotIn("target_polycount", inference_inputs)
        self.assertNotIn("mesh_style", inference_inputs)
        self.assertNotIn("requested_quality", inference_inputs)
        self.assertNotIn("object_type", inference_inputs)
        self.assertNotIn("symmetry", inference_inputs)
        self.assertNotIn("generateLOD", inference_inputs)
        self.assertEqual(inference_inputs.get("image_path"), "/tmp/test.png")

    @patch("api.routers.mesh_generation._resolve_generation_plan", side_effect=mock_resolve_generation_plan)
    async def test_native_preset_bypasses_decimation(self, _mock_plan):
        b64_png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
        mock_scheduler = MagicMock()
        mock_scheduler.validate_model_preference.return_value = True
        scheduled_jobs = []

        async def capture_job(job_request):
            scheduled_jobs.append(job_request)
            return "job-native-1"

        mock_scheduler.schedule_job = AsyncMock(side_effect=capture_job)
        req = ImageToRawMeshRequest(
            image_base64=b64_png,
            intent="native",
        )
        resp = await generate_mesh_from_image(req, scheduler=mock_scheduler, file_store=MagicMock())
        self.assertEqual(resp.job_id, "job-native-1")
        self.assertEqual(len(scheduled_jobs), 1)

        job = scheduled_jobs[0]
        # Native intent enforces -1 budget to bypass downstream decimation/remesh
        self.assertEqual(job.inputs["target_polycount"], -1)
        self.assertEqual(job.metadata["target_polycount"], -1)
        self.assertFalse(job.inputs["generateLOD"])
        self.assertFalse(job.inputs["auto_uv"])
        self.assertFalse(job.inputs["texture_enabled"])

    @patch("api.routers.mesh_generation._resolve_generation_plan", side_effect=mock_resolve_generation_plan)
    async def test_explicit_caller_overrides_preset_defaults(self, _mock_plan):
        b64_png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
        mock_scheduler = MagicMock()
        mock_scheduler.validate_model_preference.return_value = True
        scheduled_jobs = []

        async def capture_job(job_request):
            scheduled_jobs.append(job_request)
            return "job-override-1"

        mock_scheduler.schedule_job = AsyncMock(side_effect=capture_job)
        # game_ready preset defaults target_polycount to 50000, texture_enabled to False
        # Explicit caller overrides: target_polycount=120000, texture_enabled=True
        req = ImageToRawMeshRequest(
            image_base64=b64_png,
            intent="game_ready",
            target_polycount=120000,
            texture_enabled=True,
            candidate_count=3,
        )
        resp = await generate_mesh_from_image(req, scheduler=mock_scheduler, file_store=MagicMock())
        self.assertEqual(resp.job_id, "job-override-1")
        self.assertEqual(len(scheduled_jobs), 1)

        job = scheduled_jobs[0]
        self.assertEqual(job.inputs["target_polycount"], 120000)
        self.assertEqual(job.metadata["target_polycount"], 120000)
        self.assertTrue(job.inputs["texture_enabled"])
        self.assertTrue(job.metadata["texture_enabled"])
        self.assertEqual(job.inputs["candidate_count"], 3)
        self.assertEqual(job.metadata["candidate_count"], 3)


class TestPlannerExplicitModelPreservation(unittest.TestCase):
    def test_planner_preserves_explicit_model(self):
        from core.planner import plan_generation
        mock_runtime = {
            "has_cuda": True,
            "free_vram_gb": 24.0,
            "installed_adapters": [
                "Hunyuan3DShapeV21ImageToRawMeshAdapter",
                "TripoSGImageToRawMeshAdapter",
            ],
            "enabled_adapters": [
                "hunyuan3d_shape_v21_image_to_raw_mesh",
                "triposg_image_to_raw_mesh",
            ],
            "license_optins": {},
        }
        # Explicit model: triposg_image_to_raw_mesh
        plan = plan_generation({
            "model_preference": "triposg_image_to_raw_mesh",
            "requested_quality": "high",
        }, mock_runtime)

        self.assertEqual(plan["adapter"], "triposg_image_to_raw_mesh")
        self.assertEqual(plan["would_have_chosen"], "triposg_image_to_raw_mesh")

    def test_planner_rejects_unavailable_explicit_model_when_not_auto(self):
        from core.planner import plan_generation
        mock_runtime = {
            "has_cuda": True,
            "free_vram_gb": 24.0,
            "installed_adapters": ["Hunyuan3DShapeV21ImageToRawMeshAdapter"],
            "enabled_adapters": ["hunyuan3d_shape_v21_image_to_raw_mesh"],
            "license_optins": {},
        }
        # Non-installed model should raise ValueError rather than silently selecting hunyuan3d
        with self.assertRaises(ValueError) as ctx:
            plan_generation({
                "model_preference": "uninstalled_super_model",
                "auto_mode": False,
            }, mock_runtime)
        self.assertIn("Explicit model 'uninstalled_super_model' is unavailable", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()

