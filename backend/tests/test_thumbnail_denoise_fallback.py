"""Regression tests for the Cycles denoiser fallback in the thumbnail worker.

The bpy wheel and some distribution builds ship without OpenImageDenoise, and
Cycles then aborts the whole preview render with
"Error: Build without OpenImageDenoiser". The worker must detect that and
render without denoising instead of losing the preview.
"""
from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path

WORKER_PATH = Path(__file__).resolve().parents[1] / "postprocess" / "tools" / "thumbnail_worker.py"


def _load_worker():
    spec = importlib.util.spec_from_file_location("thumbnail_worker_under_test", WORKER_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class _BuildOptions:
    def __init__(self, **flags):
        for name, value in flags.items():
            setattr(self, name, value)


class TestDenoiserAvailability(unittest.TestCase):
    def setUp(self):
        self.worker = _load_worker()

    def test_build_flag_disables_denoising(self):
        available = self.worker._denoiser_available(
            _BuildOptions(openimagedenoise=False), ["OPENIMAGEDENOISE", "OPTIX"]
        )
        self.assertFalse(available)

    def test_build_flag_enables_denoising(self):
        available = self.worker._denoiser_available(
            _BuildOptions(openimagedenoise=True), ["OPENIMAGEDENOISE"]
        )
        self.assertTrue(available)

    def test_missing_flag_falls_back_to_the_denoiser_enum(self):
        self.assertFalse(
            self.worker._denoiser_available(_BuildOptions(), ["NONE"])
        )
        self.assertTrue(
            self.worker._denoiser_available(_BuildOptions(), ["OPENIMAGEDENOISE"])
        )

    def test_unknown_build_assumes_denoising(self):
        self.assertTrue(self.worker._denoiser_available(None, []))
        self.assertTrue(self.worker._denoiser_available(_BuildOptions(), []))

    def test_worker_disables_denoising_on_a_build_without_it(self):
        source = WORKER_PATH.read_text(encoding="utf-8")
        self.assertIn("_denoiser_available(", source)
        self.assertIn("SAMPLES_WITHOUT_DENOISER", source)
        self.assertIn("use_denoising = False", source)


if __name__ == "__main__":
    unittest.main()
