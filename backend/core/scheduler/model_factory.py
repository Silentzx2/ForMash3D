"""
Model factory for dynamic model creation in multiprocessing environment.

This module provides utilities to create model instances from configuration
dictionaries, which is essential for worker processes that need to dynamically
load models without direct imports.
"""

import importlib
import logging
from pathlib import Path
from typing import Any, Dict, Optional

from ..models.base import BaseModel

logger = logging.getLogger(__name__)


def _resolve_configured_path(value: Optional[str]) -> Optional[str]:
    """Resolve manifest paths consistently from repo-root or backend workdirs."""
    if not value:
        return value
    path = Path(value).expanduser()
    if path.is_absolute():
        return str(path)

    repo_root = Path(__file__).resolve().parents[3]
    candidates = [
        Path.cwd() / path,
        Path.cwd() / "backend" / path,
        repo_root / path,
        repo_root / "backend" / path,
    ]
    for candidate in candidates:
        if candidate.exists():
            return str(candidate.resolve())
    return value


class ModelFactory:
    """Factory for creating model instances from configuration"""

    # Registry of known adapter modules and classes
    ADAPTER_REGISTRY = {
        # TRELLIS adapters
                "trellis_text_mesh_painting": {
            "module": "adapters.trellis_adapter",
            "class": "TrellisTextMeshPaintingAdapter",
        },
        "trellis_image_to_textured_mesh": {
            "module": "adapters.trellis_adapter",
            "class": "TrellisImageToTexturedMeshAdapter",
        },
        "trellis_image_to_raw_mesh": {
            "module": "adapters.trellis_adapter",
            "class": "TrellisImageToRawMeshAdapter",
        },
        "trellis_image_mesh_painting": {
            "module": "adapters.trellis_adapter",
            "class": "TrellisImageMeshPaintingAdapter",
        },
        # TRELLIS.2 adapters (image-only, no text support)
        "trellis2_image_to_textured_mesh": {
            "module": "adapters.trellis2_adapter",
            "class": "Trellis2ImageToTexturedMeshAdapter",
        },
        "trellis2_image_mesh_painting": {
            "module": "adapters.trellis2_adapter",
            "class": "Trellis2ImageMeshPaintingAdapter",
        },
        # Hunyuan3D adapters
        "hunyuan3d_shape_v21_image_to_raw_mesh": {
            "module": "adapters.hunyuan3d_shape_v21",
            "class": "Hunyuan3DShapeV21ImageToRawMeshAdapter",
        },
        "hunyuan3d_paint_v21_image_mesh_painting": {
            "module": "adapters.hunyuan3d_paint_v21",
            "class": "Hunyuan3DPaintV21ImageMeshPaintingAdapter",
        },
        "hunyuan3d_dit_v2_mini_turbo_image_to_raw_mesh": {
            "module": "adapters.hunyuan3d_dit_v2_mini_turbo",
            "class": "Hunyuan3DDiTV2MiniTurboImageToRawMeshAdapter",
        },
        # Hunyuan3D legacy adapters (deprecated)
        "hunyuan3dv21_image_to_raw_mesh": {
            "module": "adapters.hunyuan3d_adapter_v21",
            "class": "Hunyuan3DV21ImageToRawMeshAdapter",
        },
        "hunyuan3dv21_image_to_textured_mesh": {
            "module": "adapters.hunyuan3d_adapter_v21",
            "class": "Hunyuan3DV21ImageToTexturedMeshAdapter",
        },
        "hunyuan3dv21_image_mesh_painting": {
            "module": "adapters.hunyuan3d_adapter_v21",
            "class": "Hunyuan3DV21ImageMeshPaintingAdapter",
        },
        # PartField adapters
        "partfield_mesh_segmentation": {
            "module": "adapters.partfield_adapter",
            "class": "PartFieldSegmentationAdapter",
        },
        # P3-SAM adapters
        "p3sam_mesh_segmentation": {
            "module": "adapters.p3sam_adapter",
            "class": "P3SAMSegmentationAdapter",
        },
        # PartPacker adapters
        "partpacker_image_to_raw_mesh": {
            "module": "adapters.partpacker_adapter",
            "class": "PartPackerImageToRawMeshAdapter",
        },
        # UniRig adapters
        "unirig_auto_rig": {
            "module": "adapters.unirig_adapter",
            "class": "UniRigAdapter",
        },
        # FastMesh adapters
        "fastmesh_v1k_retopology": {
            "module": "adapters.fastmesh_adapter",
            "class": "FastMeshRetopologyAdapter",
        },
        "fastmesh_v4k_retopology": {
            "module": "adapters.fastmesh_adapter",
            "class": "FastMeshRetopologyAdapter",
        },
        # PartUV adapters
        "partuv_uv_unwrapping": {
            "module": "adapters.partuv_adapter",
            "class": "PartUVUnwrappingAdapter",
        },
        # UltraShape adapters
        "ultrashape_image_to_raw_mesh": {
            "module": "adapters.ultrashape_adapter",
            "class": "UltraShapeImageToRawMeshAdapter",
        },
        # VoxHammer adapters
        "voxhammer_text_mesh_editing": {
            "module": "adapters.voxhammer_adapter",
            "class": "VoxHammerTextMeshEditingAdapter",
        },
        "voxhammer_image_mesh_editing": {
            "module": "adapters.voxhammer_adapter",
            "class": "VoxHammerImageMeshEditingAdapter",
        },
        # TripoSR adapter
        "triposr_image_to_raw_mesh": {
            "module": "adapters.triposr_adapter",
            "class": "TripoSRImageToRawMeshAdapter",
        },
        # TripoSG adapter
        "triposg_image_to_raw_mesh": {
            "module": "adapters.triposg_adapter",
            "class": "TripoSGImageToRawMeshAdapter",
        },
        # TripoSF adapter
        "triposf_image_to_raw_mesh": {
            "module": "adapters.triposf_adapter",
            "class": "TripoSFImageToRawMeshAdapter",
        },
        # ARDY adapter
        "ardy_motion_generation": {
            "module": "adapters.ardy_adapter",
            "class": "ArdyMotionGenerationAdapter",
        },
        # Zero123++ Multi-View adapter
        "zero123plus_v12_image_to_multiview": {
            "module": "adapters.zero123plus_adapter",
            "class": "Zero123PlusAdapter",
        },
        # Unique3D adapter
        "unique3d_image_to_raw_mesh": {
            "module": "adapters.unique3d_adapter",
            "class": "Unique3DImageToRawMeshAdapter",
        },
    }

    @classmethod
    def register_adapter(cls, model_id: str, module_path: str, class_name: str):
        """Register a new adapter type"""
        cls.ADAPTER_REGISTRY[model_id] = {"module": module_path, "class": class_name}
        logger.info(f"Registered adapter: {model_id} -> {module_path}.{class_name}")

    @classmethod
    def create_model_from_config(cls, config: Dict[str, Any]) -> BaseModel:
        """
        Create a model instance from configuration dictionary.

        Args:
            config: Model configuration containing:
                - model_id: Unique identifier for the model
                - module: Python module path (optional, can be inferred)
                - class: Model class name (optional, can be inferred)
                - init_params: Parameters for model initialization
                - feature_type: Type of feature this model handles
                - vram_requirement: VRAM requirement in MB

        Returns:
            BaseModel: Instantiated model object
        """
        try:
            model_id = config["model_id"]

            # Try to get module and class from registry first
            if model_id in cls.ADAPTER_REGISTRY:
                adapter_info = cls.ADAPTER_REGISTRY[model_id]
                module_name = adapter_info["module"]
                class_name = adapter_info["class"]
            elif "module" in config and "class" in config:
                # Use explicit module and class from config
                module_name = config["module"]
                class_name = config["class"]
            else:
                raise ValueError(
                    f"No adapter registration found for {model_id} and no explicit module/class provided"
                )

            logger.info(f"Creating model {model_id} from {module_name}.{class_name}")

            # Dynamic import
            try:
                module = importlib.import_module(module_name)
                model_class = getattr(module, class_name)
            except ImportError as e:
                logger.error(f"Failed to import {module_name}: {e}")
                raise ImportError(f"Cannot import module {module_name}: {e}")
            except AttributeError as e:
                logger.error(f"Class {class_name} not found in {module_name}: {e}")
                raise AttributeError(
                    f"Class {class_name} not found in module {module_name}: {e}"
                )

            # Create instance with config parameters
            init_params = config.get("init_params", {})

            # Add any additional parameters from config
            if "vram_requirement" in config:
                init_params["vram_requirement"] = config["vram_requirement"]

            model_instance = model_class(**init_params)

            # Verify the model has the expected properties
            if not hasattr(model_instance, "model_id"):
                model_instance.model_id = model_id
            if not hasattr(model_instance, "feature_type") and "feature_type" in config:
                model_instance.feature_type = config["feature_type"]

            logger.info(f"Successfully created model {model_id}")
            return model_instance

        except Exception as e:
            logger.error(f"Failed to create model from config: {e}")
            logger.error(f"Config: {config}")
            raise Exception(
                f"Failed to create model {config.get('model_id', 'unknown')}: {e}"
            )

    @classmethod
    def create_model(cls, model_id: str, **kwargs) -> BaseModel:
        """Convenience method to create a model instance by model_id."""
        config = {"model_id": model_id, **kwargs}
        return cls.create_model_from_config(config)

    @classmethod
    def create_model_config(
        cls,
        model_id: str,
        feature_type: str,
        vram_requirement: int,
        max_workers: int = 1,
        init_params: Optional[Dict[str, Any]] = None,
        capabilities: Optional[Dict[str, Any]] = None,
        module_path: Optional[str] = None,
        class_name: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Create a model configuration dictionary.

        Args:
            model_id: Unique identifier for the model
            feature_type: Type of feature this model handles
            vram_requirement: VRAM requirement in MB
            init_params: Parameters for model initialization
            module_path: Optional module path (inferred if not provided)
            class_name: Optional class name (inferred if not provided)

        Returns:
            Dict: Model configuration dictionary
        """
        config = {
            "model_id": model_id,
            "feature_type": feature_type,
            "vram_requirement": vram_requirement,
            "init_params": init_params or {},
            "capabilities": capabilities or {},
        }

        # Add module and class if provided
        if module_path:
            config["module"] = module_path
        if class_name:
            config["class"] = class_name
        if max_workers:
            config["max_workers"] = max_workers

        return config

    @classmethod
    def get_available_adapters(cls) -> Dict[str, Dict[str, str]]:
        """Get list of available adapter types"""
        return cls.ADAPTER_REGISTRY.copy()

    @classmethod
    def validate_config(cls, config: Dict[str, Any]) -> bool:
        """
        Validate a model configuration.

        Args:
            config: Model configuration to validate

        Returns:
            bool: True if valid, raises exception if invalid
        """
        required_fields = ["model_id", "feature_type"]

        for field in required_fields:
            if field not in config:
                raise ValueError(f"Missing required field: {field}")

        model_id = config["model_id"]

        # Check if we can resolve the adapter
        if model_id not in cls.ADAPTER_REGISTRY:
            if "module" not in config or "class" not in config:
                raise ValueError(
                    f"Model {model_id} not in registry and no explicit module/class provided"
                )

        # Validate numeric fields
        if "vram_requirement" in config:
            if (
                not isinstance(config["vram_requirement"], int)
                or config["vram_requirement"] <= 0
            ):
                raise ValueError("vram_requirement must be a positive integer")

        return True


def create_model_from_config(config: Dict[str, Any]) -> BaseModel:
    """
    Convenience function to create a model from configuration.
    This is the function used by worker processes.
    """
    return ModelFactory.create_model_from_config(config)


def get_model_configs_from_settings(
    models_config: Dict[str, Dict[str, Any]],
) -> Dict[str, Dict[str, Any]]:
    """
    Generate model configurations from already-parsed settings models configuration.

    Args:
        models_config: Parsed models configuration from settings (feature_type -> model_id -> ModelConfig or dict)

    Returns:
        Dict: Mapping of model_id to configuration for enabled models only
    """
    configs = {}

    # Process each feature type and its models
    for feature_type, models in models_config.items():
        if not isinstance(models, dict):
            continue

        for model_id, model_config in models.items():
            # # Determine if it's a ModelConfig object or dict
            is_model_config_obj = hasattr(model_config, "vram_requirement")

            # Skip disabled models - handle both ModelConfig objects and dicts
            if is_model_config_obj:
                # It's a ModelConfig object
                enabled = getattr(model_config, "enabled", True)
                if not enabled:
                    logger.info(f"Skipping disabled model: {model_id}")
                    continue

                vram_requirement = getattr(model_config, "vram_requirement", None)
                model_path = getattr(model_config, "model_path", None)
                supported_inputs = getattr(model_config, "supported_inputs", [])
                supported_outputs = getattr(model_config, "supported_outputs", [])
                max_workers = getattr(model_config, "max_workers", 1)
                if vram_requirement is None:
                    raise ValueError(f"Model {model_id} is missing a manifest vram_requirement")
                init_params = dict(getattr(model_config, "init_params", {}) or {})
                capabilities = dict(getattr(model_config, "capabilities", {}) or {})
            elif isinstance(model_config, dict):
                # Handle dict-based configs from YAML
                enabled = model_config.get("enabled", True)
                if not enabled:
                    logger.info(f"Skipping disabled model: {model_id}")
                    continue

                vram_requirement = model_config.get("vram_requirement")
                model_path = model_config.get("model_path", None)
                supported_inputs = model_config.get("supported_inputs", [])
                supported_outputs = model_config.get("supported_outputs", [])
                max_workers = model_config.get("max_workers", 1)
                if vram_requirement is None:
                    raise ValueError(f"Model {model_id} is missing a manifest vram_requirement")
                init_params = dict(model_config.get("init_params", {}) or {})
                capabilities = dict(model_config.get("capabilities", {}) or {})
            else:
                logger.warning(f"Unknown model config type for {model_id}, skipping")
                continue

            # Check if model_id is in our adapter registry
            if model_id not in ModelFactory.ADAPTER_REGISTRY:
                logger.warning(
                    f"Model {model_id} not found in adapter registry, skipping"
                )
                continue

            # Create configuration dictionary
            config = ModelFactory.create_model_config(
                model_id=model_id,
                feature_type=feature_type,
                vram_requirement=vram_requirement,
                max_workers=max_workers,
                init_params=init_params,
            )

            # Add additional configuration
            if model_path:
                config["model_path"] = _resolve_configured_path(model_path)
            if supported_inputs:
                config["supported_inputs"] = supported_inputs
            if supported_outputs:
                config["supported_outputs"] = supported_outputs
            if capabilities:
                config["capabilities"] = capabilities

            configs[model_id] = config
            # logger.debug(f"Configured model {model_id} for feature {feature_type}")

    # logger.info(f"Configured {len(configs)} enabled models from settings")
    return configs


def get_default_model_configs() -> Dict[str, Dict[str, Any]]:
    """
    Load the canonical model manifest when callers need a default config mapping.

    There is intentionally no second hardcoded model/VRAM registry here. The YAML
    manifest remains the single source of truth for enabled models, capabilities,
    init parameters, paths, outputs, and resource requirements.
    """
    manifest_path = Path(__file__).resolve().parents[2] / "config" / "models.yaml"
    parsed = load_models_config(str(manifest_path))
    configs: Dict[str, Dict[str, Any]] = {}

    for feature_type, models in parsed.items():
        for model_id, model_config in models.items():
            if not model_config.enabled:
                continue
            if model_config.vram_requirement is None or model_config.vram_requirement <= 0:
                raise ValueError(
                    f"Model {model_id} is missing a valid manifest vram_requirement"
                )

            config = ModelFactory.create_model_config(
                model_id=model_id,
                feature_type=feature_type,
                vram_requirement=model_config.vram_requirement,
                max_workers=model_config.max_workers,
                init_params=dict(model_config.init_params or {}),
                capabilities=dict(model_config.capabilities or {}),
            )
            if model_config.model_path:
                config["model_path"] = _resolve_configured_path(model_config.model_path)
            if model_config.supported_inputs:
                config["supported_inputs"] = list(model_config.supported_inputs)
            if model_config.supported_outputs:
                config["supported_outputs"] = list(model_config.supported_outputs)

            configs[model_id] = config

    if not configs:
        raise RuntimeError(
            f"Canonical model manifest is empty or unavailable: {manifest_path}"
        )
    return configs
