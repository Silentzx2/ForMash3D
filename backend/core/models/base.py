import logging
import time
from abc import ABC, abstractmethod
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional

import torch

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

    def load(self, gpu_id: int) -> bool:
        """Load model on specified GPU"""
        if self.status == ModelStatus.LOADED:
            return True

        start_time = time.time()
        logger.info(f"[GPU LOAD START] model={self.model_id} gpu={gpu_id}")
        try:
            self.status = ModelStatus.LOADING
            self.gpu_id = gpu_id

            # Set CUDA device
            if torch.cuda.is_available():
                torch.cuda.set_device(gpu_id)

            # Load model
            self.model = self._load_model()
            self.status = ModelStatus.LOADED
            elapsed = time.time() - start_time
            memory = ""
            if torch.cuda.is_available():
                try:
                    allocated = torch.cuda.memory_allocated(gpu_id) / (1024 ** 2)
                    reserved = torch.cuda.memory_reserved(gpu_id) / (1024 ** 2)
                    memory = f" allocated_mb={allocated:.0f} reserved_mb={reserved:.0f}"
                except Exception:
                    pass
            logger.info(
                f"[GPU LOAD SUCCESS] model={self.model_id} gpu={gpu_id} "
                f"elapsed={elapsed:.2f}s{memory}"
            )
            return True

        except Exception as e:
            self.status = ModelStatus.ERROR
            logger.error(f"[GPU LOAD FAILED] model={self.model_id} gpu={gpu_id}: {e}", exc_info=True)
            raise Exception(f"Failed to load model {self.model_id}: {str(e)}")

    def unload(self) -> bool:
        """Unload model from GPU"""
        if self.status == ModelStatus.UNLOADED:
            return True

        start_time = time.time()
        logger.info(f"[GPU UNLOAD START] model={self.model_id}")
        try:
            self._unload_model()
            self.model = None
            self.status = ModelStatus.UNLOADED
            self.gpu_id = None

            # Clear GPU cache
            if torch.cuda.is_available():
                torch.cuda.empty_cache()

            elapsed = time.time() - start_time
            memory = ""
            if torch.cuda.is_available() and self.gpu_id is not None:
                try:
                    allocated = torch.cuda.memory_allocated(self.gpu_id) / (1024 ** 2)
                    reserved = torch.cuda.memory_reserved(self.gpu_id) / (1024 ** 2)
                    memory = f" allocated_mb={allocated:.0f} reserved_mb={reserved:.0f}"
                except Exception:
                    pass
            logger.info(
                f"[GPU UNLOAD SUCCESS] model={self.model_id} "
                f"elapsed={elapsed:.2f}s{memory}"
            )
            return True

        except Exception as e:
            self.status = ModelStatus.ERROR
            logger.error(f"[GPU UNLOAD FAILED] model={self.model_id}: {e}", exc_info=True)
            raise Exception(f"Failed to unload model {self.model_id}: {str(e)}")

    def process(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """Process input and return results"""
        if self.status in [ModelStatus.UNLOADED, ModelStatus.LOADING]:
            raise Exception(
                f"Model {self.model_id} is not loaded, its status {self.status}"
            )

        start_time = time.time()
        logger.info(
            f"[MODEL INFERENCE START] model={self.model_id} "
            f"gpu={self.gpu_id if self.gpu_id is not None else "cpu"}"
        )
        try:
            self.status = ModelStatus.PROCESSING
            result = self._process_request(inputs)
            elapsed = time.time() - start_time
            memory = ""
            if torch.cuda.is_available() and self.gpu_id is not None:
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
            return result
        except Exception as e:
            logger.error(f"[MODEL INFERENCE FAILED] model={self.model_id}: {e}", exc_info=True)
            raise
        finally:
            # Reset status to loaded after processing
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
            "vram_requirement": self.vram_requirement,
            "supported_formats": self.get_supported_formats(),
        }
