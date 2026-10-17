"""
Standalone implementation of DINOv3 Vision Transformer (DINOv3ViTModel & DINOv3ViTConfig).

This module provides a pure-PyTorch implementation of Meta AI's DINOv3 architecture
for TRELLIS.2, Pixal3D, and downstream models when running in environments where
the installed `transformers` package does not yet export `DINOv3ViTModel` (transformers < 4.50/4.56).
"""

from __future__ import annotations

import json
import logging
import math
import os
from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

import torch
import torch.nn as nn
import torch.nn.functional as F

logger = logging.getLogger(__name__)


# -----------------------------------------------------------------------------
# Configuration
# -----------------------------------------------------------------------------

@dataclass
class DINOv3ViTConfig:
    """Configuration class for DINOv3 Vision Transformer models."""
    model_type: str = "dinov3_vit"
    image_size: Union[int, List[int], Tuple[int, int]] = 512
    patch_size: Union[int, List[int], Tuple[int, int]] = 16
    num_channels: int = 3
    hidden_size: int = 1024
    intermediate_size: int = 4096
    num_hidden_layers: int = 24
    num_attention_heads: int = 16
    hidden_act: str = "gelu"
    attention_dropout: float = 0.0
    initializer_range: float = 0.02
    layer_norm_eps: float = 1e-5
    rope_theta: float = 100.0
    query_bias: bool = True
    key_bias: bool = False
    value_bias: bool = True
    proj_bias: bool = True
    mlp_bias: bool = True
    layerscale_value: float = 1.0
    drop_path_rate: float = 0.0
    use_gated_mlp: bool = False
    num_register_tokens: int = 4
    pos_embed_shift: Optional[float] = None
    pos_embed_jitter: Optional[float] = None
    pos_embed_rescale: Optional[float] = 2.0
    _attn_implementation: str = "eager"

    def __init__(self, **kwargs):
        for k, v in kwargs.items():
            setattr(self, k, v)

    @classmethod
    def from_pretrained(cls, pretrained_model_name_or_path: Union[str, Path], **kwargs) -> "DINOv3ViTConfig":
        model_path = Path(pretrained_model_name_or_path)
        config_file = None

        if model_path.exists() and model_path.is_dir():
            candidate = model_path / "config.json"
            if candidate.exists():
                config_file = candidate

        if config_file is None:
            # Try fetching config.json via huggingface_hub
            try:
                from huggingface_hub import hf_hub_download
                token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_TOKEN")
                if token and token.startswith(("ghp_", "gho_", "github_pat_")):
                    token = None
                config_path = hf_hub_download(
                    repo_id=str(pretrained_model_name_or_path),
                    filename="config.json",
                    token=token,
                )
                config_file = Path(config_path)
            except Exception as e:
                logger.debug(f"Could not download config.json from HF hub: {e}")

        if config_file is not None and config_file.exists():
            with open(config_file, "r", encoding="utf-8") as f:
                data = json.load(f)
            data.update(kwargs)
            return cls(**data)

        # Fallback to default
        return cls(**kwargs)

    def to_dict(self) -> Dict[str, Any]:
        return {k: v for k, v in self.__dict__.items() if not k.startswith("_")}


# -----------------------------------------------------------------------------
# Positional Coordinates and RoPE
# -----------------------------------------------------------------------------

def get_patches_center_coordinates(
    num_patches_h: int, num_patches_w: int, dtype: torch.dtype, device: torch.device
) -> torch.Tensor:
    """Computes 2D coordinates of patch centers normalized to [-1, 1]."""
    coords_h = (torch.arange(0.5, num_patches_h, dtype=dtype, device=device) / num_patches_h) * 2.0 - 1.0
    coords_w = (torch.arange(0.5, num_patches_w, dtype=dtype, device=device) / num_patches_w) * 2.0 - 1.0
    grid_h, grid_w = torch.meshgrid(coords_h, coords_w, indexing="ij")
    coords = torch.stack([grid_h, grid_w], dim=-1).flatten(0, 1)
    return coords


def rotate_half(x: torch.Tensor) -> torch.Tensor:
    """Rotates half the hidden dims of the input."""
    half = x.shape[-1] // 2
    x1 = x[..., :half]
    x2 = x[..., half:]
    return torch.cat((-x2, x1), dim=-1)


def apply_rotary_pos_emb(
    q: torch.Tensor, k: torch.Tensor, cos: torch.Tensor, sin: torch.Tensor
) -> Tuple[torch.Tensor, torch.Tensor]:
    """Applies Rotary Position Embedding only to patch tokens, leaving prefix tokens unrotated."""
    num_tokens = q.shape[-2]
    num_patches = sin.shape[-2]
    num_prefix_tokens = num_tokens - num_patches

    if num_prefix_tokens > 0:
        q_prefix, q_patches = q.split((num_prefix_tokens, num_patches), dim=-2)
        k_prefix, k_patches = k.split((num_prefix_tokens, num_patches), dim=-2)

        q_patches = (q_patches * cos) + (rotate_half(q_patches) * sin)
        k_patches = (k_patches * cos) + (rotate_half(k_patches) * sin)

        q = torch.cat((q_prefix, q_patches), dim=-2)
        k = torch.cat((k_prefix, k_patches), dim=-2)
    else:
        q = (q * cos) + (rotate_half(q) * sin)
        k = (k * cos) + (rotate_half(k) * sin)

    return q, k


class DINOv3ViTRopePositionEmbedding(nn.Module):
    """Rotary Position Embedding module for DINOv3."""

    def __init__(self, config: DINOv3ViTConfig):
        super().__init__()
        self.config = config
        self.base = float(config.rope_theta)
        self.head_dim = config.hidden_size // config.num_attention_heads
        inv_freq = 1.0 / (self.base ** (torch.arange(0, 1, 4 / self.head_dim, dtype=torch.float32)))
        self.register_buffer("inv_freq", inv_freq, persistent=False)

    def forward(self, pixel_values: torch.Tensor) -> Tuple[torch.Tensor, torch.Tensor]:
        _, _, height, width = pixel_values.shape
        patch_size = self.config.patch_size if isinstance(self.config.patch_size, int) else self.config.patch_size[0]
        num_patches_h = height // patch_size
        num_patches_w = width // patch_size

        patch_coords = get_patches_center_coordinates(
            num_patches_h, num_patches_w, dtype=torch.float32, device=pixel_values.device
        )

        angles = 2 * math.pi * patch_coords[:, :, None] * self.inv_freq[None, None, :]
        angles = angles.flatten(1, 2).tile(2)

        cos = torch.cos(angles).to(dtype=pixel_values.dtype)
        sin = torch.sin(angles).to(dtype=pixel_values.dtype)
        return cos, sin


# -----------------------------------------------------------------------------
# Embeddings & Layers
# -----------------------------------------------------------------------------

class DINOv3ViTEmbeddings(nn.Module):
    """Patch and token embeddings for DINOv3."""

    def __init__(self, config: DINOv3ViTConfig):
        super().__init__()
        self.config = config
        patch_size = config.patch_size if isinstance(config.patch_size, int) else config.patch_size[0]
        self.cls_token = nn.Parameter(torch.randn(1, 1, config.hidden_size) * config.initializer_range)
        self.mask_token = nn.Parameter(torch.zeros(1, 1, config.hidden_size))
        num_registers = getattr(config, "num_register_tokens", 4)
        if num_registers > 0:
            self.register_tokens = nn.Parameter(
                torch.randn(1, num_registers, config.hidden_size) * config.initializer_range
            )
        else:
            self.register_tokens = None
        self.patch_embeddings = nn.Conv2d(
            config.num_channels, config.hidden_size, kernel_size=patch_size, stride=patch_size
        )

    def forward(self, pixel_values: torch.Tensor, bool_masked_pos: Optional[torch.Tensor] = None) -> torch.Tensor:
        batch_size = pixel_values.shape[0]
        dtype = self.patch_embeddings.weight.dtype
        pixel_values = pixel_values.to(dtype=dtype)

        patch_embeddings = self.patch_embeddings(pixel_values).flatten(2).transpose(1, 2)
        if bool_masked_pos is not None:
            mask_token = self.mask_token.to(dtype=dtype)
            patch_embeddings = torch.where(bool_masked_pos.unsqueeze(-1), mask_token, patch_embeddings)

        cls_tokens = self.cls_token.expand(batch_size, -1, -1).to(dtype=dtype)
        if self.register_tokens is not None:
            reg_tokens = self.register_tokens.expand(batch_size, -1, -1).to(dtype=dtype)
            return torch.cat([cls_tokens, reg_tokens, patch_embeddings], dim=1)
        return torch.cat([cls_tokens, patch_embeddings], dim=1)


class DINOv3ViTAttention(nn.Module):
    """Multihead Attention with 2D Rotary Position Embeddings."""

    def __init__(self, config: DINOv3ViTConfig):
        super().__init__()
        self.config = config
        self.embed_dim = config.hidden_size
        self.num_heads = config.num_attention_heads
        self.head_dim = self.embed_dim // self.num_heads
        self.scaling = self.head_dim ** -0.5
        self.dropout = config.attention_dropout

        self.q_proj = nn.Linear(self.embed_dim, self.embed_dim, bias=config.query_bias)
        self.k_proj = nn.Linear(self.embed_dim, self.embed_dim, bias=config.key_bias)
        self.v_proj = nn.Linear(self.embed_dim, self.embed_dim, bias=config.value_bias)
        self.o_proj = nn.Linear(self.embed_dim, self.embed_dim, bias=config.proj_bias)

    def forward(
        self,
        hidden_states: torch.Tensor,
        position_embeddings: Optional[Tuple[torch.Tensor, torch.Tensor]] = None,
        attention_mask: Optional[torch.Tensor] = None,
        **kwargs,
    ) -> Tuple[torch.Tensor, Optional[torch.Tensor]]:
        batch_size, seq_len, _ = hidden_states.shape

        q = self.q_proj(hidden_states).view(batch_size, seq_len, self.num_heads, self.head_dim).transpose(1, 2)
        k = self.k_proj(hidden_states).view(batch_size, seq_len, self.num_heads, self.head_dim).transpose(1, 2)
        v = self.v_proj(hidden_states).view(batch_size, seq_len, self.num_heads, self.head_dim).transpose(1, 2)

        if position_embeddings is not None:
            cos, sin = position_embeddings
            q, k = apply_rotary_pos_emb(q, k, cos, sin)

        # Efficient scaled dot-product attention
        dropout_p = self.dropout if self.training else 0.0
        attn_output = F.scaled_dot_product_attention(q, k, v, attn_mask=attention_mask, dropout_p=dropout_p)
        attn_output = attn_output.transpose(1, 2).contiguous().view(batch_size, seq_len, self.embed_dim)
        output = self.o_proj(attn_output)
        return output, None


class DINOv3ViTLayerScale(nn.Module):
    """LayerScale residual multiplier."""

    def __init__(self, config: DINOv3ViTConfig):
        super().__init__()
        val = getattr(config, "layerscale_value", 1.0)
        self.lambda1 = nn.Parameter(torch.ones(config.hidden_size) * val)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return x * self.lambda1


class DINOv3ViTMLP(nn.Module):
    """Standard 2-layer MLP."""

    def __init__(self, config: DINOv3ViTConfig):
        super().__init__()
        self.fc1 = nn.Linear(config.hidden_size, config.intermediate_size, bias=config.mlp_bias)
        self.fc2 = nn.Linear(config.intermediate_size, config.hidden_size, bias=config.mlp_bias)
        act_name = getattr(config, "hidden_act", "gelu")
        self.act = F.silu if act_name in ("silu", "swish") else F.gelu

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.fc2(self.act(self.fc1(x)))


class DINOv3ViTGatedMLP(nn.Module):
    """SwiGLU Gated MLP."""

    def __init__(self, config: DINOv3ViTConfig):
        super().__init__()
        self.gate_proj = nn.Linear(config.hidden_size, config.intermediate_size, bias=config.mlp_bias)
        self.up_proj = nn.Linear(config.hidden_size, config.intermediate_size, bias=config.mlp_bias)
        self.down_proj = nn.Linear(config.intermediate_size, config.hidden_size, bias=config.mlp_bias)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.down_proj(F.silu(self.gate_proj(x)) * self.up_proj(x))


class DINOv3ViTLayer(nn.Module):
    """Transformer block in DINOv3."""

    def __init__(self, config: DINOv3ViTConfig):
        super().__init__()
        self.norm1 = nn.LayerNorm(config.hidden_size, eps=config.layer_norm_eps)
        self.attention = DINOv3ViTAttention(config)
        self.layer_scale1 = DINOv3ViTLayerScale(config)

        self.norm2 = nn.LayerNorm(config.hidden_size, eps=config.layer_norm_eps)
        if getattr(config, "use_gated_mlp", False):
            self.mlp = DINOv3ViTGatedMLP(config)
        else:
            self.mlp = DINOv3ViTMLP(config)
        self.layer_scale2 = DINOv3ViTLayerScale(config)

    def forward(
        self,
        hidden_states: torch.Tensor,
        position_embeddings: Optional[Tuple[torch.Tensor, torch.Tensor]] = None,
        **kwargs,
    ) -> torch.Tensor:
        # Pre-LN Self-Attention
        normed = self.norm1(hidden_states)
        attn_out, _ = self.attention(normed, position_embeddings=position_embeddings)
        hidden_states = hidden_states + self.layer_scale1(attn_out)

        # Pre-LN MLP
        normed = self.norm2(hidden_states)
        mlp_out = self.mlp(normed)
        hidden_states = hidden_states + self.layer_scale2(mlp_out)
        return hidden_states


class DINOv3ViTEncoder(nn.Module):
    """Encoder stack of DINOv3 layers."""

    def __init__(self, config: DINOv3ViTConfig):
        super().__init__()
        self.layer = nn.ModuleList([DINOv3ViTLayer(config) for _ in range(config.num_hidden_layers)])

    def forward(
        self,
        hidden_states: torch.Tensor,
        position_embeddings: Optional[Tuple[torch.Tensor, torch.Tensor]] = None,
        **kwargs,
    ) -> torch.Tensor:
        for layer_module in self.layer:
            hidden_states = layer_module(hidden_states, position_embeddings=position_embeddings)
        return hidden_states


# -----------------------------------------------------------------------------
# DINOv3ViTModel Main Interface
# -----------------------------------------------------------------------------

class DINOv3ViTModel(nn.Module):
    """
    DINOv3 Vision Transformer model.
    
    Provides:
    - .embeddings: DINOv3ViTEmbeddings
    - .rope_embeddings: DINOv3ViTRopePositionEmbedding
    - .layer: alias pointing to self.model.layer for flat-traversal compatibility
    - .model: DINOv3ViTEncoder
    - .norm: output LayerNorm
    - .from_pretrained(): loads weights from local dir or Hugging Face hub
    """

    def __init__(self, config: DINOv3ViTConfig):
        super().__init__()
        self.config = config
        self.embeddings = DINOv3ViTEmbeddings(config)
        self.rope_embeddings = DINOv3ViTRopePositionEmbedding(config)
        self.model = DINOv3ViTEncoder(config)
        self.norm = nn.LayerNorm(config.hidden_size, eps=config.layer_norm_eps)

    @property
    def layer(self) -> nn.ModuleList:
        """Compatibility property for code expecting flat self.model.layer access."""
        return self.model.layer

    def forward(
        self,
        pixel_values: torch.Tensor,
        bool_masked_pos: Optional[torch.Tensor] = None,
        **kwargs,
    ) -> torch.Tensor:
        hidden_states = self.embeddings(pixel_values, bool_masked_pos=bool_masked_pos)
        position_embeddings = self.rope_embeddings(pixel_values)
        hidden_states = self.model(hidden_states, position_embeddings=position_embeddings)
        return self.norm(hidden_states)

    @classmethod
    def from_pretrained(
        cls,
        pretrained_model_name_or_path: Union[str, Path],
        *args,
        **kwargs,
    ) -> "DINOv3ViTModel":
        """Load pretrained DINOv3 model from local path or Hugging Face Hub."""
        config = kwargs.pop("config", None)
        if config is None:
            config = DINOv3ViTConfig.from_pretrained(pretrained_model_name_or_path, **kwargs)

        model = cls(config)

        model_dir = Path(pretrained_model_name_or_path)
        weights_file = None

        if model_dir.exists() and model_dir.is_dir():
            for name in ("model.safetensors", "pytorch_model.bin"):
                cand = model_dir / name
                if cand.exists():
                    weights_file = cand
                    break

        if weights_file is None:
            # Download via huggingface_hub
            try:
                from huggingface_hub import hf_hub_download
                token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_TOKEN")
                if token and token.startswith(("ghp_", "gho_", "github_pat_")):
                    token = None
                try:
                    weights_path = hf_hub_download(
                        repo_id=str(pretrained_model_name_or_path),
                        filename="model.safetensors",
                        token=token,
                    )
                    weights_file = Path(weights_path)
                except Exception:
                    weights_path = hf_hub_download(
                        repo_id=str(pretrained_model_name_or_path),
                        filename="pytorch_model.bin",
                        token=token,
                    )
                    weights_file = Path(weights_path)
            except Exception as e:
                logger.warning(f"Could not download DINOv3 weights from HF: {e}")

        if weights_file is not None and weights_file.exists():
            state_dict = {}
            if str(weights_file).endswith(".safetensors"):
                try:
                    from safetensors.torch import load_file
                    state_dict = load_file(str(weights_file), device="cpu")
                except ImportError:
                    logger.warning("safetensors not installed; attempting torch.load")
                    state_dict = torch.load(str(weights_file), map_location="cpu")
            else:
                state_dict = torch.load(str(weights_file), map_location="cpu")

            # Map checkpoint keys to model structure
            cleaned_state = {}
            for k, v in state_dict.items():
                new_k = k
                if new_k.startswith("model.layer."):
                    pass
                elif new_k.startswith("layer."):
                    new_k = f"model.{new_k}"
                cleaned_state[new_k] = v

            missing, unexpected = model.load_state_dict(cleaned_state, strict=False)
            if missing:
                logger.debug(f"DINOv3 load missing keys: {len(missing)}")
            if unexpected:
                logger.debug(f"DINOv3 load unexpected keys: {len(unexpected)}")

        return model
