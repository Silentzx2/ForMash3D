"""
Unit and regression contract tests for Zero123++ Multi-View feature.

Verifies:
1. Model isolation: Zero123++ is hidden from general 3D selectors and confined to image_to_multiview.
2. Adapter contract: Zero123PlusAdapter schema, defaults, formats, camera rig geometry.
3. Deterministic hashing: Source SHA256 and Request SHA256 repeatability.
4. ZIP export naming contract: <stem>.zip without extra random suffixes.
5. Router endpoints & capability gate: Rejection of models without multiview: true.
6. Manifest schema: Presence of camera rig, azimuths, elevations, and FOV metadata.
"""

import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch
import yaml
from fastapi import FastAPI
from fastapi.testclient import TestClient

backend_root = Path(__file__).resolve().parents[1]
project_root = backend_root.parent
if str(backend_root) not in sys.path:
    sys.path.insert(0, str(backend_root))
if str(project_root) not in sys.path:
    sys.path.insert(0, str(project_root))


class TestZero123PlusModelIsolation(unittest.TestCase):
    """Verify Zero123++ manifest isolation in models.yaml and ModelFactory."""

    def setUp(self):
        models_yaml_path = backend_root / "config" / "models.yaml"
        with open(models_yaml_path, "r", encoding="utf-8") as f:
            self.config = yaml.safe_load(f)

    def test_model_isolation_in_models_yaml(self):
        # image_to_multiview must exist as a feature category
        self.assertIn("image_to_multiview", self.config)
        mv_category = self.config["image_to_multiview"]
        self.assertIn("zero123plus_v12_image_to_multiview", mv_category)

        mv_model = mv_category["zero123plus_v12_image_to_multiview"]
        capabilities = mv_model.get("capabilities", {})
        self.assertTrue(capabilities.get("image_to_multiview", False))
        self.assertTrue(capabilities.get("hidden_from_model_selector", False))
        self.assertTrue(capabilities.get("multiview", False))
        self.assertEqual(capabilities.get("fixed_view_count"), 6)

        # Must NOT exist under image_to_raw_mesh or image_to_textured_mesh
        raw_models = self.config.get("image_to_raw_mesh", {})
        textured_models = self.config.get("image_to_textured_mesh", {})
        text_models = self.config.get("text_to_textured_mesh", {})

        self.assertNotIn("zero123plus_v12_image_to_multiview", raw_models)
        self.assertNotIn("zero123plus_v12_image_to_multiview", textured_models)
        self.assertNotIn("zero123plus_v12_image_to_multiview", text_models)

    def test_model_factory_registration(self):
        from core.scheduler.model_factory import ModelFactory
        from adapters.zero123plus_adapter import Zero123PlusAdapter

        factory = ModelFactory()
        adapter = factory.create_model("zero123plus_v12_image_to_multiview")
        self.assertIsInstance(adapter, Zero123PlusAdapter)
        self.assertEqual(adapter.model_id, "zero123plus_v12_image_to_multiview")


class TestZero123PlusAdapterContract(unittest.TestCase):
    """Verify Zero123PlusAdapter schema, parameter defaults, and camera rig."""

    def setUp(self):
        from adapters.zero123plus_adapter import Zero123PlusAdapter
        self.adapter = Zero123PlusAdapter(vram_requirement=5120)

    def test_supported_formats(self):
        formats = self.adapter.get_supported_formats()
        self.assertIn("inputs", formats)
        self.assertIn("png", formats["inputs"])
        self.assertIn("jpeg", formats["inputs"])
        self.assertIn("webp", formats["inputs"])

    def test_parameter_schema(self):
        schema = self.adapter.get_parameter_schema()
        self.assertIn("parameters", schema)
        params = schema["parameters"]

        self.assertEqual(params["inference_steps"]["default"], 28)
        self.assertEqual(params["guidance_scale"]["default"], 4.0)
        self.assertEqual(params["seed"]["default"], 42)
        self.assertFalse(params["background_removal"]["default"])
        self.assertFalse(params["generate_masks"]["default"])
        self.assertFalse(params["generate_normals"]["default"])
        self.assertTrue(params["save_contact_sheet"]["default"])

    def test_camera_rig_geometry(self):
        rig = self.adapter.CAMERA_RIG
        self.assertEqual(len(rig), 6)

        expected_azimuths = [30.0, 90.0, 150.0, 210.0, 270.0, 330.0]
        expected_elevations = [20.0, -10.0, 20.0, -10.0, 20.0, -10.0]
        expected_filenames = [
            "front_right_30.png",
            "right_90.png",
            "back_right_150.png",
            "back_left_210.png",
            "left_270.png",
            "front_left_330.png",
        ]

        for i, cam in enumerate(rig):
            self.assertEqual(cam["azimuth_deg"], expected_azimuths[i])
            self.assertEqual(cam["elevation_deg"], expected_elevations[i])
            self.assertEqual(cam["fov_deg"], 30.0)
            self.assertEqual(cam["filename"], expected_filenames[i])


class TestDeterministicHashingAndNaming(unittest.TestCase):
    """Verify deterministic hash derivation and ZIP naming contracts."""

    def test_source_sha256(self):
        from adapters.zero123plus_adapter import compute_source_sha256
        data1 = b"test-image-content-for-multiview"
        data2 = b"test-image-content-for-multiview"
        data3 = b"different-image-content"

        self.assertEqual(compute_source_sha256(data1), compute_source_sha256(data2))
        self.assertNotEqual(compute_source_sha256(data1), compute_source_sha256(data3))

    def test_request_sha256_determinism(self):
        from adapters.zero123plus_adapter import compute_request_sha256
        source_hash = "abcdef1234567890"
        params_a = {"inference_steps": 28, "guidance_scale": 4.0, "seed": 42}
        params_b = {"guidance_scale": 4.0, "seed": 42, "inference_steps": 28}
        params_c = {"inference_steps": 30, "guidance_scale": 4.0, "seed": 42}

        hash_a = compute_request_sha256(source_hash, params_a)
        hash_b = compute_request_sha256(source_hash, params_b)
        hash_c = compute_request_sha256(source_hash, params_c)

        self.assertEqual(hash_a, hash_b)
        self.assertNotEqual(hash_a, hash_c)

    def test_zip_filename_contract(self):
        from adapters.zero123plus_adapter import derive_zip_filename
        self.assertEqual(derive_zip_filename("car.png"), "car.zip")
        self.assertEqual(derive_zip_filename("Spaceship Alpha.jpg"), "Spaceship_Alpha.zip")
        self.assertEqual(derive_zip_filename("robot_v2.1.webp"), "robot_v2.1.zip")
        self.assertEqual(derive_zip_filename(""), "multiview.zip")


class TestMultiViewRouterAndCapabilityGate(unittest.TestCase):
    """Verify API endpoints and backend capability gating."""

    def setUp(self):
        from api.routers.multiview import router
        app = FastAPI()
        app.include_router(router, prefix="/api/v1/multiview")
        self.client = TestClient(app)

    def test_router_endpoints_registered(self):
        from api.routers.multiview import router
        paths = {route.path for route in router.routes if hasattr(route, "path")}
        expected = {
            "/generate",
            "/upload",
            "/{asset_id}",
            "/{asset_id}/zip",
            "/reconstruct-3d",
        }
        self.assertTrue(expected.issubset(paths), f"Missing paths: {expected - paths}")

    def test_capability_gate_rejects_unsupported_model(self):
        # Trellis has multiview: false in models.yaml
        response = self.client.post(
            "/api/v1/multiview/reconstruct-3d",
            json={
                "asset_id": "test_asset_123",
                "model_preference": "trellis_image_to_textured_mesh",
                "images": [{"file_id": "front", "view": "front"}],
            },
        )
        self.assertEqual(response.status_code, 400)
        data = response.json()
        self.assertIn("does not support multi-view reconstruction", data["detail"])

    def test_capability_gate_rejects_unregistered_model(self):
        response = self.client.post(
            "/api/v1/multiview/reconstruct-3d",
            json={
                "asset_id": "test_asset_123",
                "model_preference": "nonexistent_model_id",
                "images": [{"file_id": "front", "view": "front"}],
            },
        )
        self.assertEqual(response.status_code, 404)
        data = response.json()
        self.assertIn("is not registered", data["detail"])


if __name__ == "__main__":
    unittest.main()
