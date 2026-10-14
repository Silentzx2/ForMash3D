"""Explicit fidelity-first volume/surface decoder contract for Hunyuan3D adapters."""
import logging
from typing import Any, Dict

logger = logging.getLogger(__name__)

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
    configure_decoder(enabled=False)
    volume_name = type(getattr(vae, "volume_decoder", None)).__name__
    surface_name = type(getattr(vae, "surface_extractor", None)).__name__
    if volume_name != "VanillaVolumeDecoder" or surface_name != "MCSurfaceExtractor":
        raise RuntimeError(
            f"{model_name} did not enter the native dense extraction profile "
            f"(volume_decoder={volume_name}, surface_extractor={surface_name})."
        )
    logger.info("%s raw geometry profile: volume_decoder=%s, surface_extractor=%s",
                model_name, volume_name, surface_name)
    return {"volume_decoder": volume_name, "surface_extractor": surface_name}
