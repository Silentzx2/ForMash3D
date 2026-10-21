"""Regression tests for CWD-independent manifest path resolution.

Manifest model paths are written relative to the repository root (for example
``backend/pretrained/TRELLIS``). The API and scheduler processes do not run
from the repository root (Docker supervisord uses ``/app/backend`` and
``backend/scripts/run_server.sh`` changes into ``backend/``), so the lookup
must not depend on the current working directory. A wrong lookup made every
model look "not installed" and failed mesh generation with HTTP 400 on
``POST /api/v1/smart-generation/resolve``.
"""
from __future__ import annotations

import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from core.utils.artifact_utils import resolve_manifest_path

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = REPO_ROOT / "backend"


class TestResolveManifestPath(unittest.TestCase):
    def test_resolves_repo_relative_path(self):
        resolved = resolve_manifest_path("backend/config")
        self.assertIsNotNone(resolved)
        self.assertTrue(resolved.is_dir())
        self.assertEqual(resolved, (REPO_ROOT / "backend" / "config").resolve())

    def test_resolves_path_without_backend_prefix(self):
        resolved = resolve_manifest_path("config")
        self.assertIsNotNone(resolved)
        self.assertEqual(resolved, (REPO_ROOT / "backend" / "config").resolve())

    def test_resolution_is_independent_of_working_directory(self):
        previous_cwd = Path.cwd()
        try:
            os.chdir(BACKEND_DIR)
            resolved = resolve_manifest_path("backend/config")
        finally:
            os.chdir(previous_cwd)
        self.assertIsNotNone(resolved)
        self.assertEqual(resolved, (REPO_ROOT / "backend" / "config").resolve())

    def test_missing_and_empty_paths_return_none(self):
        self.assertIsNone(resolve_manifest_path(None))
        self.assertIsNone(resolve_manifest_path(""))
        self.assertIsNone(resolve_manifest_path("backend/does-not-exist"))
        self.assertIsNone(resolve_manifest_path(str(BACKEND_DIR / "does-not-exist")))


class TestSmartPresetReadinessUsesSharedResolver(unittest.TestCase):
    def test_smart_presets_uses_the_shared_resolver(self):
        source = (BACKEND_DIR / "core" / "smart_presets.py").read_text(encoding="utf-8")
        self.assertIn("resolve_manifest_path", source)
        self.assertNotIn('replace("backend/"', source)

    def test_model_ready_follows_the_resolved_path(self):
        try:
            import core.smart_presets as smart_presets
        except ImportError as exc:  # optional runtime dependency (pyyaml)
            self.skipTest(f"core.smart_presets is unavailable in this environment: {exc}")

        class _Config:
            enabled = True
            model_path = "backend/pretrained/some-model"

        original = smart_presets.resolve_manifest_path
        try:
            with TemporaryDirectory() as tmp:
                model_dir = Path(tmp) / "model"
                model_dir.mkdir()
                (model_dir / "model.safetensors").write_bytes(b"0" * 16)
                smart_presets.resolve_manifest_path = lambda _path: model_dir
                self.assertTrue(smart_presets._model_ready(_Config()))

            with TemporaryDirectory() as tmp:
                empty_dir = Path(tmp) / "model"
                empty_dir.mkdir()
                smart_presets.resolve_manifest_path = lambda _path: empty_dir
                self.assertFalse(smart_presets._model_ready(_Config()))
        finally:
            smart_presets.resolve_manifest_path = original


if __name__ == "__main__":
    unittest.main()
