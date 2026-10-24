from __future__ import annotations

import logging
import os
import logging.config
import functools
from pathlib import Path
from typing import Any, Dict, List, Optional

# ── Compatibility shim: torch 2.8.0 does not have float8_e8m0fnu ──
# transformers >=4.44 references torch.float8_e8m0fnu which causes
# AttributeError on torch 2.8.0. Patch it before transformers imports.
try:
    import torch
    if not hasattr(torch, "float8_e8m0fnu"):
        try:
            torch.float8_e8m0fnu = torch.float8_e4m3fn
        except Exception:
            pass
    if not hasattr(torch, "float8_e5m2"):
        try:
            torch.float8_e5m2 = torch.float8_e4m3fn
        except Exception:
            pass
except ImportError:
    torch = None

# ── Compatibility shim: torch_scatter C++ ABI mismatch or missing ──
import sys, types
try:
    import torch_scatter
except (ImportError, OSError):
    _ts = types.ModuleType("torch_scatter")

    if torch is not None:
        def _py_scatter_sum(src: torch.Tensor, index: torch.Tensor, dim: int = -1, out: Optional[torch.Tensor] = None, dim_size: Optional[int] = None) -> torch.Tensor:
            if dim < 0:
                dim += src.dim()
            idx = index.expand_as(src) if index.dim() < src.dim() else index
            if out is None:
                size = list(src.size())
                size[dim] = dim_size if dim_size is not None else (int(index.max()) + 1 if index.numel() > 0 else 0)
                out = torch.zeros(size, dtype=src.dtype, device=src.device)
            return out.scatter_add_(dim, idx, src)

        def _py_scatter_mean(src: torch.Tensor, index: torch.Tensor, dim: int = -1, out: Optional[torch.Tensor] = None, dim_size: Optional[int] = None) -> torch.Tensor:
            res = _py_scatter_sum(src, index, dim, out, dim_size)
            idx = index.expand_as(src) if index.dim() < src.dim() else index
            counts = torch.zeros_like(res).scatter_add_(dim if dim >= 0 else dim + src.dim(), idx, torch.ones_like(src))
            return res / counts.clamp_(min=1)

        _ts.scatter_sum = _py_scatter_sum
        _ts.scatter_add = _py_scatter_sum
        _ts.scatter_mean = _py_scatter_mean
        _ts.scatter = _py_scatter_mean
    else:
        _dummy = lambda *args, **kwargs: None
        _ts.scatter_sum = _dummy
        _ts.scatter_add = _dummy
        _ts.scatter_mean = _dummy
        _ts.scatter = _dummy

    _ts.__version__ = "2.1.2"
    sys.modules["torch_scatter"] = _ts

# ── High-Performance PyTorch Tensor Core & cuDNN Tuning ──
if torch is not None and torch.cuda.is_available():
    try:
        torch.backends.cuda.matmul.allow_tf32 = True
        torch.backends.cudnn.allow_tf32 = True
        torch.backends.cudnn.benchmark = True
    except Exception:
        pass

import yaml
from pydantic import Field, field_validator
try:
    from pydantic_settings import BaseSettings, SettingsConfigDict
except ImportError:
    from pydantic import BaseModel as BaseSettings
    SettingsConfigDict = dict

logger = logging.getLogger(__name__)

class LoggingConfig(BaseSettings):
    """Enhanced logging configuration that supports both simple and dictConfig formats"""

    level: str = "INFO"
    format: str = "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
    file: Optional[str] = None
    # For dictConfig support
    use_dict_config: bool = False
    dict_config_path: Optional[str] = None
    dict_config: Optional[Dict] = None


class SecurityConfig(BaseSettings):
    rate_limit_enabled: bool = False
    rate_limit_per_minute: int = 0
    cors_origins: List[str] = ["*"]
    api_key_required: bool = False
    # Optional privileged server credential; injected from P3D_API_KEY at runtime.
    api_key: Optional[str] = Field(default=None, repr=False, exclude=True)


class ModelConfig(BaseSettings):
    """Configuration for a single model"""
    vram_requirement: int
    supported_inputs: List[str]
    supported_outputs: List[str]
    max_workers: int = 1
    model_path: Optional[str] = None
    enabled: bool = True
    model_parameters: Optional[Dict] = None
    init_params: Dict[str, Any] = Field(default_factory=dict)
    capabilities: Dict[str, Any] = Field(default_factory=dict)

    model_config = SettingsConfigDict(protected_namespaces=("settings_",), extra="allow")


def normalize_model_capabilities(
    feature: str,
    model_id: str,
    config: "ModelConfig",
) -> "ModelConfig":
    """Fill the shared capability contract without inventing model behavior.

    Explicit manifest values win. Defaults describe only facts derivable from the
    existing model registration (feature, supported inputs/outputs, VRAM).
    Model-specific quality/extraction/preprocessing fields remain explicit opt-ins.
    """
    caps = dict(config.capabilities or {})
    inputs = {str(value).lower() for value in (config.supported_inputs or [])}
    outputs = list(config.supported_outputs or [])

    # Only true image/text -> 3D generation features should advertise 3D capability.
    # Related pipelines such as Zero123++ generate conditioning views, not meshes.
    image_to_3d_features = {"image_to_raw_mesh", "image_to_textured_mesh"}
    text_to_3d_features = {"text_to_raw_mesh", "text_to_textured_mesh"}
    caps.setdefault("image_to_3d", feature in image_to_3d_features and "image" in inputs)
    caps.setdefault("text_to_3d", feature in text_to_3d_features and "text" in inputs)
    caps.setdefault("multiview", feature == "image_to_multiview" or "multiview" in inputs)
    caps.setdefault("multiview_input", "multiview" in inputs or "multiview_image" in inputs)
    caps.setdefault("generated_multiview", feature == "image_to_multiview")
    caps.setdefault(
        "single_view",
        feature in image_to_3d_features and "image" in inputs and not bool(caps.get("multiview_input", False)),
    )
    caps.setdefault(
        "texture_generation",
        feature in {"image_to_textured_mesh", "image_mesh_painting", "text_mesh_painting"},
    )
    caps.setdefault("native_pbr", False)
    caps.setdefault("vertex_color", False)
    caps.setdefault("mesh_quality_characteristics", [])
    caps.setdefault("preferred_preprocessing", "default")
    caps.setdefault("preferred_extraction", "model_native")
    caps.setdefault("preferred_resolution", None)
    caps.setdefault("preferred_face_budget", "auto")
    caps.setdefault("minimum_vram_mb", int(config.vram_requirement or 0))
    caps.setdefault("cpu_requirements", {"threads": "auto"})
    caps.setdefault("multi_gpu", False)
    caps.setdefault("multi_gpu_strategy", None)
    caps.setdefault("recommended_postprocess_profile", "default")
    caps.setdefault("latency_class", "balanced")
    caps.setdefault("supported_output_formats", outputs)

    config.capabilities = caps
    return config


class Settings(BaseSettings):
    """Main settings class
    
    Environment variables:
        P3D_DEBUG: Enable debug mode (default: False)
        P3D_USER_AUTH_ENABLED: Enable user authentication (default: False)
    """
    # Core configurations
    # server: ServerConfig = ServerConfig()
    # gpu: GPUConfig = GPUConfig()
    # scheduler: SchedulerConfig = SchedulerConfig()
    # storage: StorageConfig = StorageConfig()
    logging: LoggingConfig = LoggingConfig()
    security: SecurityConfig = SecurityConfig()

    # Model configurations
    models: Dict[str, Dict[str, ModelConfig]] = Field(default_factory=dict)

    # Environment
    environment: str = "development"
    debug: bool = False

    # Redis configuration (for multi-worker deployments)
    redis_url: str = "redis://localhost:6379"
    redis_enabled: bool = False  # Enable Redis-based job queue for multi-worker support
    
    # Essential configuration parameters (exposed via CLI/env vars)
    user_auth_enabled: bool = False  # Top-level for easier CLI access

    model_config = SettingsConfigDict(env_prefix="P3D_", case_sensitive=False)

    @field_validator("models")
    def parse_models(cls, v):
        """Parse model configurations from nested dict"""
        if isinstance(v, dict):
            parsed = {}
            for feature, models in v.items():
                parsed[feature] = {}
                for model_id, config in models.items():
                    if isinstance(config, dict):
                        parsed_config = ModelConfig(**config)
                    else:
                        parsed_config = config
                    parsed[feature][model_id] = normalize_model_capabilities(
                        feature,
                        model_id,
                        parsed_config,
                    )
            return parsed
        return v

    def get_model_config(self, feature: str, model_id: str) -> Optional[ModelConfig]:
        """Get model configuration by feature and model ID"""
        if feature in self.models and model_id in self.models[feature]:
            return self.models[feature][model_id]
        return None

    def get_feature_models(self, feature: str) -> Dict[str, ModelConfig]:
        """Get all models for a specific feature"""
        return self.models.get(feature, {})

    def list_available_models(self) -> Dict[str, List[str]]:
        """List all available models by feature"""
        result = {}
        for feature, models in self.models.items():
            result[feature] = [
                model_id for model_id, config in models.items() if config.enabled
            ]
        return result


def load_config_from_file(config_path: str) -> Settings:
    """Load configuration from YAML file"""
    config_file = Path(config_path)

    if not config_file.exists():
        logger.warning(f"Config file {config_path} not found, using defaults")
        return Settings()

    try:
        with open(config_file, "r") as f:
            config_data = yaml.safe_load(f)

        # Load system config
        settings = Settings()

        # Update configurations if they exist in the file
        # if "server" in config_data:
            # settings.server = ServerConfig(**config_data["server"])
        # if "gpu" in config_data:
            # settings.gpu = GPUConfig(**config_data["gpu"])
        # if "scheduler" in config_data:
            # settings.scheduler = SchedulerConfig(**config_data["scheduler"])
        # if "storage" in config_data:
            # settings.storage = StorageConfig(**config_data["storage"])
        if "logging" in config_data:
            settings.logging = LoggingConfig(**config_data["logging"])
        if "security" in config_data:
            settings.security = SecurityConfig(**config_data["security"])

        # Load models config
        if "models" in config_data:
            settings.models = config_data["models"]
            settings = Settings(**settings.dict())  # Re-validate

        # Update other settings
        if "environment" in config_data:
            settings.environment = config_data["environment"]
        if "debug" in config_data:
            settings.debug = config_data["debug"]

        logger.info(f"Successfully loaded configuration from {config_path}")
        return settings

    except Exception as e:
        logger.error(f"Error loading config from {config_path}: {str(e)}")
        logger.info("Using default configuration")
        return Settings()


def load_models_config(models_config_path: str) -> Dict[str, Dict[str, ModelConfig]]:
    """Load models configuration from separate YAML file"""
    config_file = Path(models_config_path)

    if not config_file.exists():
        logger.warning(f"Models config file {models_config_path} not found")
        return {}

    try:
        with open(config_file, "r") as f:
            models_data = yaml.safe_load(f)

        parsed_models = {}
        for feature, models in models_data.items():
            parsed_models[feature] = {}
            for model_id, config in models.items():
                if isinstance(config, dict) and "alias_of" in config:
                    target_id = config["alias_of"]
                    target_cfg = models.get(target_id)
                    if not target_cfg:
                        for other_f, other_m in models_data.items():
                            if isinstance(other_m, dict) and target_id in other_m:
                                target_cfg = other_m[target_id]
                                break
                    if isinstance(target_cfg, dict):
                        merged = dict(target_cfg)
                        merged.update(config)
                        config = merged
                parsed_models[feature][model_id] = normalize_model_capabilities(
                    feature,
                    model_id,
                    ModelConfig(**config),
                )

        logger.info(
            f"Successfully loaded models configuration from {models_config_path}"
        )
        return parsed_models

    except Exception as e:
        logger.error(f"Error loading models config from {models_config_path}: {str(e)}")
        return {}


def load_logging_dict_config(config_path: str) -> Optional[Dict]:
    """Load logging configuration from YAML file in dictConfig format"""
    config_file = Path(config_path)

    if not config_file.exists():
        logger.warning(f"Logging config file {config_path} not found")
        return None

    try:
        with open(config_file, "r") as f:
            logging_config = yaml.safe_load(f)

        # Runtime logs live only in the repository-root logs/ directory.
        (Path(__file__).resolve().parents[2] / "logs").mkdir(parents=True, exist_ok=True)
        return logging_config
    except Exception as e:
        logger.error(f"Error loading logging config from {config_path}: {str(e)}")
        return None


# Global settings instance
settings: Optional[Settings] = None


def get_settings() -> Settings:
    """Get global settings instance"""
    global settings
    if settings is None:
        # Try to load from config files
        config_dir = Path(__file__).parent.parent / "config"
        system_config = config_dir / "system.yaml"
        models_config = config_dir / "models.yaml"

        settings = load_config_from_file(str(system_config))

        # Static API credentials come only from the runtime environment, never YAML.
        configured_api_key = os.getenv("P3D_API_KEY")
        if configured_api_key:
            settings.security.api_key = configured_api_key

        # If user authorization is turned on, force API key
        if settings.user_auth_enabled:
            settings.security.api_key_required = True

        # Load models separately if exists
        if models_config.exists():
            models = load_models_config(str(models_config))
            if models:
                settings.models = models
            else:
                from core.scheduler.model_factory import get_default_model_configs
                settings.models = get_default_model_configs()
        else:
            from core.scheduler.model_factory import get_default_model_configs
            settings.models = get_default_model_configs()

    return settings



_QUALITY_REQUIRED_KEYS = (
    "shared.feature_edge_angle_deg",
    "holes.max_hole_vertices", "holes.max_hole_perimeter",
    "gate.strict", "gate.max_non_manifold_edges", "gate.max_non_manifold_vertices",
    "gate.max_native_mesh_normalized_drift",
    "gate.max_holes", "gate.max_floater_ratio", "gate.max_degenerate_faces",
    "gate.min_aspect_ratio_p1", "gate.min_aspect_ratio_p5",
    "surface_comparison.sample_count",
    "surface_comparison.fscore_diagonal_fraction",
    "surface_comparison.minimum_fscore_threshold",
    "surface_comparison.local_density_neighbor_count",
    "physics.defaults.body_type",
    "physics.defaults.mass_mode",
    "physics.defaults.mass_kg",
    "physics.defaults.density_mode",
    "physics.defaults.density_kg_m3",
    "physics.defaults.friction",
    "physics.defaults.restitution",
    "physics.defaults.linear_damping",
    "physics.defaults.angular_damping",
    "physics.defaults.gravity_enabled",
    "physics.defaults.fallback_volume_m3",
    "physics.thresholds.minimum_valid_volume_m3",
    "physics.limits.mass_kg.min",
    "physics.limits.mass_kg.max",
    "physics.limits.density_kg_m3.min",
    "physics.limits.density_kg_m3.max",
    "physics.limits.friction.min",
    "physics.limits.friction.max",
    "physics.limits.restitution.min",
    "physics.limits.restitution.max",
    "physics.limits.linear_damping.min",
    "physics.limits.linear_damping.max",
    "physics.limits.angular_damping.min",
    "physics.limits.angular_damping.max",
    "physics.default_collision_quality",
    "physics.collision_quality_profiles.fast.method",
    "physics.collision_quality_profiles.fast.max_hulls",
    "physics.collision_quality_profiles.fast.threshold",
    "physics.collision_quality_profiles.fast.input_faces",
    "physics.collision_quality_profiles.fast.max_hull_vertices",
    "physics.collision_quality_profiles.fast.resolution",
    "physics.collision_quality_profiles.fast.mcts_nodes",
    "physics.collision_quality_profiles.fast.mcts_iterations",
    "physics.collision_quality_profiles.fast.mcts_max_depth",
    "physics.collision_quality_profiles.fast.preprocess_resolution",
    "physics.collision_quality_profiles.fast.seed",
    "physics.collision_quality_profiles.balanced.method",
    "physics.collision_quality_profiles.balanced.max_hulls",
    "physics.collision_quality_profiles.balanced.threshold",
    "physics.collision_quality_profiles.balanced.input_faces",
    "physics.collision_quality_profiles.balanced.max_hull_vertices",
    "physics.collision_quality_profiles.balanced.resolution",
    "physics.collision_quality_profiles.balanced.mcts_nodes",
    "physics.collision_quality_profiles.balanced.mcts_iterations",
    "physics.collision_quality_profiles.balanced.mcts_max_depth",
    "physics.collision_quality_profiles.balanced.preprocess_resolution",
    "physics.collision_quality_profiles.balanced.seed",
    "physics.collision_quality_profiles.precise.method",
    "physics.collision_quality_profiles.precise.max_hulls",
    "physics.collision_quality_profiles.precise.threshold",
    "physics.collision_quality_profiles.precise.input_faces",
    "physics.collision_quality_profiles.precise.max_hull_vertices",
    "physics.collision_quality_profiles.precise.resolution",
    "physics.collision_quality_profiles.precise.mcts_nodes",
    "physics.collision_quality_profiles.precise.mcts_iterations",
    "physics.collision_quality_profiles.precise.mcts_max_depth",
    "physics.collision_quality_profiles.precise.preprocess_resolution",
    "physics.collision_quality_profiles.precise.seed",
    "decimation.memory_safe_threshold_triangles", "decimation.max_deviation_deg",
    "decimation.max_ram_fraction",
    "uv.partuv_triangle_threshold", "uv.partuv_vram_requirement_gb",
    "uv.default_backend", "uv.fallback_backend", "uv.max_chart_size",
    "bake.normal_space", "bake.convention", "bake.max_ray_distance",
    "bake.cage_extrusion", "bake.texture_size", "bake.gutter_dilation_pixels",
    "bake.min_uv_utilization",
    "seeds.base_seed", "seeds.seed_step", "seeds.max_candidates",
    "seeds.seed_count_by_tier", "seeds.early_stop_score", "seeds.weights",
    "seeds.ranges", "seeds.inverted",
    "limits.max_production_faces", "limits.memory_safe_dispatch_triangles",
    "limits.uv_scan_max_faces",
    "badge.sharp_min_score", "badge.clean_min_score",
    "tiers", "default_tier",
)


def _quality_nested_value(config: Dict[str, Any], dotted_key: str) -> Any:
    value: Any = config
    for part in dotted_key.split("."):
        if not isinstance(value, dict) or part not in value:
            raise KeyError(dotted_key)
        value = value[part]
    return value


@functools.lru_cache(maxsize=4)
def get_quality_config(config_path: Optional[str] = None) -> Dict[str, Any]:
    """Load the single canonical quality/pipeline config.

    No numeric fallback defaults are used: invalid or incomplete configuration
    stops initialization instead of silently allowing different pipeline behavior.
    """
    path = (
        Path(config_path).expanduser().resolve()
        if config_path
        else Path(__file__).resolve().parent.parent / "config" / "quality.yaml"
    )
    if not path.is_file():
        raise FileNotFoundError(f"Required quality configuration not found: {path}")
    try:
        config = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        raise ValueError(f"Invalid quality configuration YAML at {path}: {exc}") from exc
    if not isinstance(config, dict):
        raise ValueError(f"Quality configuration at {path} must be a YAML mapping")
    missing = []
    for key in _QUALITY_REQUIRED_KEYS:
        try:
            _quality_nested_value(config, key)
        except KeyError:
            missing.append(key)
    if missing:
        raise ValueError(
            f"Quality configuration at {path} is missing required keys: "
            + ", ".join(missing)
        )
    tiers = config["tiers"]
    if not isinstance(tiers, list) or not tiers or config["default_tier"] not in tiers:
        raise ValueError("quality.tiers must be non-empty and contain default_tier")
    if not isinstance(config["seeds"]["seed_count_by_tier"], dict):
        raise ValueError("quality.seeds.seed_count_by_tier must be a mapping")
    if set(config["seeds"]["seed_count_by_tier"]) != set(tiers):
        raise ValueError("quality.seeds.seed_count_by_tier keys must match quality.tiers")
    if not isinstance(config["seeds"]["weights"], dict) or abs(sum(config["seeds"]["weights"].values()) - 1.0) > 1e-6:
        raise ValueError("quality.seeds.weights must sum to 1.0")
    return config


def validate_quality_tier(value: Optional[str]) -> Optional[str]:
    """Validate request tier strings against the canonical quality configuration."""
    if value is None:
        return None
    normalized = str(value).strip().lower()
    tiers = get_quality_config()["tiers"]
    if normalized not in tiers:
        raise ValueError(f"requested_quality must be one of: {', '.join(tiers)}")
    return normalized


def reload_settings() -> Settings:
    """Reload settings from config files, discarding cached instance."""
    global settings
    settings = None
    get_quality_config.cache_clear()
    return get_settings()


def setup_logging(config: LoggingConfig):
    """Route Python application, API, scheduler and worker logs to one master file."""
    master_log = Path(__file__).resolve().parents[2] / "logs" / "master.log"
    master_log.parent.mkdir(parents=True, exist_ok=True)

    logging_yaml_path = Path(__file__).resolve().parent.parent / "config" / "logging.yaml"
    dict_config = load_logging_dict_config(str(logging_yaml_path)) if logging_yaml_path.exists() else None
    if dict_config:
        # Resolve the configured path against the repository rather than process CWD.
        for handler in dict_config.get("handlers", {}).values():
            if "filename" in handler:
                handler["filename"] = str(master_log)
        try:
            logging.config.dictConfig(dict_config)
            logging.getLogger(__name__).info("Logging configured: %s", master_log)
            return
        except Exception:
            logging.getLogger(__name__).exception("Failed to load YAML logging config; using the same master log")

    logging.basicConfig(
        level=getattr(logging, config.level.upper(), logging.INFO),
        format=config.format,
        handlers=[logging.FileHandler(master_log, mode="a", encoding="utf-8")],
        force=True,
    )
    logging.getLogger(__name__).info("Logging configured: %s", master_log)


# def create_directories(storage_config: StorageConfig):
#     """Create necessary directories"""
#     directories = [
#         storage_config.input_dir,
#         storage_config.output_dir,
#         storage_config.log_dir,
#     ]

#     for directory in directories:
#         Path(directory).mkdir(parents=True, exist_ok=True)
#         logger.debug(f"Created/verified directory: {directory}")
