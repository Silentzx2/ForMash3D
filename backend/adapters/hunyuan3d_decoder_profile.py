"""Explicit fidelity-first volume/surface decoder contract for Hunyuan3D adapters."""
import logging
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

REQUIRED_VOLUME_DECODER = "VanillaVolumeDecoder"
REQUIRED_SURFACE_EXTRACTOR = "MCSurfaceExtractor"


def configure_native_dense_decoder(
    pipeline: Any, model_name: str, mc_algo: Optional[str] = None
) -> Dict[str, str]:
    """Configure VAE decoding pipeline with FlashVDM and sharp surface extraction.

    Prioritizes FlashVDM + DMC (if diso is available) for sharpest geometric feature preservation.
    Falls back gracefully to MC if DMC/diso is absent.
    """
    vae = getattr(pipeline, "vae", None)
    if vae is None:
        raise RuntimeError(f"{model_name} pipeline has no VAE; cannot guarantee native extraction.")

    configure_decoder = getattr(vae, "enable_flashvdm_decoder", None)
    if not callable(configure_decoder):
        logger.warning(f"{model_name} VAE does not expose enable_flashvdm_decoder")
        return {}

    # Check DMC availability (requires diso)
    chosen_algo = mc_algo or "mc"
    if chosen_algo == "dmc":
        try:
            import diso
        except ImportError:
            chosen_algo = "mc"
    elif chosen_algo != "mc":
        try:
            import diso
            chosen_algo = "dmc"
        except ImportError:
            chosen_algo = "mc"

    try:
        configure_decoder(enabled=True, mc_algo=chosen_algo)
        logger.info(f"[{model_name}] FlashVDM decoder active with mc_algo='{chosen_algo}'")
    except Exception as err:
        logger.warning(f"[{model_name}] FlashVDM enable failed ({err}), falling back to vanilla decoder")
        configure_decoder(enabled=False)

    volume_name = type(getattr(vae, "volume_decoder", None)).__name__
    surface_name = type(getattr(vae, "surface_extractor", None)).__name__

    logger.info(
        f"[{model_name}] Active decoder: volume_decoder={volume_name}, surface_extractor={surface_name}"
    )
    return {"volume_decoder": volume_name, "surface_extractor": surface_name}
