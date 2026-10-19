import logging
import time
from abc import ABC, abstractmethod
from enum import Enum
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

try:
    import torch
except ImportError:
    torch = None

logger = logging.getLogger(__name__)


class ModelStatus(Enum):
    UNLOADED = "unloaded"
    LOADING = "loading"
    LOADED = "loaded"
    PROCESSING = "processing"
    ERROR = "error"


class BaseModel(ABC):
    """Base class for all AI models"""

    def __init__(
        self,
        model_id: str,
        model_path: str,
        vram_requirement: int,
        feature_type: str = "unknown",
    ):
        self.model_id = model_id
        self.model_path = Path(model_path)
        self.vram_requirement = vram_requirement  # MB
        self.feature_type = feature_type
        self.status = ModelStatus.UNLOADED
        self.gpu_id: Optional[int] = None
        self.gpu_ids: List[int] = []
        self.resource_plan: Optional[Dict[str, Any]] = None
        self.model = None

    @abstractmethod
    def _load_model(self) -> Any:
        """Load the actual model. Override in subclasses."""
        pass

    @abstractmethod
    def _unload_model(self) -> None:
        """Unload the actual model. Override in subclasses."""
        pass

    @abstractmethod
    def _process_request(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """Process a single request. Override in subclasses."""
        pass

    def load(self, gpu_id: Optional[int], resource_plan: Optional[Dict[str, Any]] = None) -> bool:
        """Load model on the scheduler-selected CPU or GPU device."""
        if self.status == ModelStatus.LOADED:
            return True

        start_time = time.time()
        device_label = f"GPU {gpu_id}" if gpu_id is not None else "CPU"
        logger.info("[MODEL LOAD START] model=%s device=%s", self.model_id, device_label)
        try:
            self.status = ModelStatus.LOADING
            self.gpu_id = gpu_id
            self.resource_plan = dict(resource_plan or {})
            planned_gpu_ids = self.resource_plan.get("gpu_ids")
            if planned_gpu_ids is None:
                planned_gpu_ids = [] if gpu_id is None else [gpu_id]
            self.gpu_ids = [int(x) for x in planned_gpu_ids if x is not None]

            # Only GPU-backed plans initialize a CUDA context.
            if gpu_id is not None and torch is not None and torch.cuda.is_available():
                torch.cuda.set_device(gpu_id)

            # Load model
            self.model = self._load_model()
            self.status = ModelStatus.LOADED
            elapsed = time.time() - start_time
            memory = ""
            if gpu_id is not None and torch is not None and torch.cuda.is_available():
                try:
                    allocated = torch.cuda.memory_allocated(gpu_id) / (1024 ** 2)
                    reserved = torch.cuda.memory_reserved(gpu_id) / (1024 ** 2)
                    memory = f" allocated_mb={allocated:.0f} reserved_mb={reserved:.0f}"
                except Exception:
                    pass
            logger.info(
                "[MODEL LOAD SUCCESS] model=%s device=%s elapsed=%.2fs%s",
                self.model_id, device_label, elapsed, memory,
            )
            return True

        except Exception as e:
            self.status = ModelStatus.ERROR
            logger.exception("[MODEL LOAD FAILED] model=%s device=%s", self.model_id, device_label)
            raise RuntimeError(f"Failed to load model {self.model_id}: {e}") from e

    def unload(self) -> bool:
        """Unload model and release device resources."""
        if self.status == ModelStatus.UNLOADED:
            return True

        start_time = time.time()
        logger.info(f"[MODEL UNLOAD START] model={self.model_id}")
        previous_gpu_ids = list(self.gpu_ids)
        try:
            self._unload_model()
            self.model = None
            self.status = ModelStatus.UNLOADED

            # Clear GPU cache before capturing final memory state.
            if previous_gpu_ids and torch is not None and torch.cuda.is_available():
                torch.cuda.empty_cache()

            elapsed = time.time() - start_time
            memory = ""
            if previous_gpu_ids and torch is not None and torch.cuda.is_available():
                try:
                    samples = []
                    for gpu_id in previous_gpu_ids:
                        allocated = torch.cuda.memory_allocated(gpu_id) / (1024 ** 2)
                        reserved = torch.cuda.memory_reserved(gpu_id) / (1024 ** 2)
                        samples.append(f"gpu{gpu_id}:allocated_mb={allocated:.0f} reserved_mb={reserved:.0f}")
                    memory = " " + " ".join(samples)
                except Exception:
                    pass

            self.gpu_id = None
            self.gpu_ids = []
            self.resource_plan = None
            logger.info(
                f"[MODEL UNLOAD SUCCESS] model={self.model_id} "
                f"elapsed={elapsed:.2f}s{memory}"
            )
            return True

        except Exception as e:
            self.status = ModelStatus.ERROR
            logger.error(f"[GPU UNLOAD FAILED] model={self.model_id}: {e}", exc_info=True)
            raise Exception(f"Failed to unload model {self.model_id}: {str(e)}")

    def process(self, inputs: Dict[str, Any], progress_callback: Optional[Callable[[str, float, str], None]] = None) -> Dict[str, Any]:
        """Process input and return results"""
        if self.status in [ModelStatus.UNLOADED, ModelStatus.LOADING]:
            raise Exception(
                f"Model {self.model_id} is not loaded, its status {self.status}"
            )

        start_time = time.time()
        succeeded = False
        logger.info(
            f"[MODEL INFERENCE START] model={self.model_id} "
            f"gpu={self.gpu_id if self.gpu_id is not None else 'cpu'}"
        )
        try:
            self.status = ModelStatus.PROCESSING
            # Pass progress_callback through inputs for adapters that support it
            if progress_callback:
                inputs = {**inputs, "progress_callback": progress_callback}
            result = self._process_request(inputs)
            elapsed = time.time() - start_time
            memory = ""
            if self.gpu_id is not None and torch is not None and torch.cuda.is_available():
                try:
                    allocated = torch.cuda.memory_allocated(self.gpu_id) / (1024 ** 2)
                    reserved = torch.cuda.memory_reserved(self.gpu_id) / (1024 ** 2)
                    memory = f" allocated_mb={allocated:.0f} reserved_mb={reserved:.0f}"
                except Exception:
                    pass
            logger.info(
                f"[MODEL INFERENCE SUCCESS] model={self.model_id} "
                f"elapsed={elapsed:.2f}s{memory}"
            )
            succeeded = True
            return result
        except Exception as e:
            self.status = ModelStatus.ERROR
            logger.error(f"[MODEL INFERENCE FAILED] model={self.model_id}: {e}", exc_info=True)
            raise
        finally:
            # Only successful requests restore readiness; failures remain visible.
            if succeeded:
                self.status = ModelStatus.LOADED

    @abstractmethod
    def get_supported_formats(self) -> Dict[str, List[str]]:
        """Return supported input/output formats"""
        pass
    
    @abstractmethod
    def get_parameter_schema(self) -> Dict[str, Any]:
        """
        Return JSON Schema describing model-specific parameters.
        
        This method should return a dictionary with parameter specifications including:
        - type: Parameter data type (integer, number, string, boolean)
        - description: Human-readable description
        - default: Default value
        - minimum/maximum: For numeric types
        - enum: List of allowed values
        - required: Whether the parameter is required
        
        Returns:
            Dictionary with "parameters" key containing parameter specifications
        
        Example:
            {
                "parameters": {
                    "seed": {
                        "type": "integer",
                        "description": "Random seed for reproducibility",
                        "default": 42,
                        "minimum": 0,
                        "required": False
                    }
                }
            }
        """
        pass

    def get_info(self) -> Dict[str, Any]:
        """Get model information"""
        return {
            "model_id": self.model_id,
            "feature_type": self.feature_type,
            "status": self.status.value,
            "gpu_id": self.gpu_id,
            "gpu_ids": list(self.gpu_ids),
            "resource_plan": dict(self.resource_plan or {}),
            "vram_requirement": self.vram_requirement,
            "supported_formats": self.get_supported_formats(),
        }
