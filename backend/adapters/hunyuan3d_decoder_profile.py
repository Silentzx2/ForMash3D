"""Explicit fidelity-first volume/surface decoder contract for Hunyuan3D adapters."""
import logging
from typing import Any, Dict

logger = logging.getLogger(__name__)

REQUIRED_VOLUME_DECODER = "VanillaVolumeDecoder"
REQUIRED_SURFACE_EXTRACTOR = "MCSurfaceExtractor"


def configure_native_dense_decoder(pipeline: Any, model_name: str) -> Dict[str, str]:
    """Force the upstream VAE to use vanilla dense decoding and marching cubes.

    Not calling the FlashVDM enable method is insufficient to prove which decoder is
    active. Fail fast if the vendored API cannot establish the intended extraction contract.
    """
    vae = getattr(pipeline, "vae", None)
    if vae is None:
        raise RuntimeError(f"{model_name} pipeline has no VAE; cannot guarantee native dense extraction.")

    configure_decoder = getattr(vae, "enable_flashvdm_decoder", None)
    if not callable(configure_decoder):
        raise RuntimeError(
            f"{model_name} VAE does not expose enable_flashvdm_decoder(enabled=False). "
            "Verify backend/thirdparty is pinned to a compatible upstream revision."
        )

    logger.info(f"[{model_name}] Disabling FlashVDM, enforcing native dense decoder...")
    configure_decoder(enabled=False)

    volume_name = type(getattr(vae, "volume_decoder", None)).__name__
    surface_name = type(getattr(vae, "surface_extractor", None)).__name__

    logger.info(f"[{model_name}] Active decoder: volume={volume_name}, surface={surface_name}")

    if volume_name != REQUIRED_VOLUME_DECODER:
        raise RuntimeError(
            f"{model_name} volume decoder mismatch: expected {REQUIRED_VOLUME_DECODER}, got {volume_name}. "
            "The VAE did not switch to native dense decoding. Check thirdparty compatibility."
        )
    if surface_name != REQUIRED_SURFACE_EXTRACTOR:
        raise RuntimeError(
            f"{model_name} surface extractor mismatch: expected {REQUIRED_SURFACE_EXTRACTOR}, got {surface_name}. "
            "The VAE did not switch to marching cubes extraction. Check thirdparty compatibility."
        )

    logger.info(
        f"[{model_name}] ✓ Native dense extraction profile ACTIVE: "
        f"volume_decoder={volume_name}, surface_extractor={surface_name}"
    )
    return {"volume_decoder": volume_name, "surface_extractor": surface_name}
