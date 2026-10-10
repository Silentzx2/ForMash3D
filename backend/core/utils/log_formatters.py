"""
Clean, human-readable logging and formatting utilities with ANSI color support for 3D generation and post-processing.
Provides visually structured boxes, banners, and milestone summaries for console, terminal, and log inspection.
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple, Union

try:
    import torch
except ImportError:
    torch = None

# ── ANSI Color Codes ────────────────────────────────────────────────────────
RESET = "\033[0m"
BOLD = "\033[1m"
DIM = "\033[2m"

# Standard Foreground Colors
RED = "\033[91m"
GREEN = "\033[92m"
YELLOW = "\033[93m"
BLUE = "\033[94m"
MAGENTA = "\033[95m"
CYAN = "\033[96m"
WHITE = "\033[97m"

# Bold Variations
B_RED = "\033[1;91m"
B_GREEN = "\033[1;92m"
B_YELLOW = "\033[1;93m"
B_BLUE = "\033[1;94m"
B_MAGENTA = "\033[1;95m"
B_CYAN = "\033[1;96m"
B_WHITE = "\033[1;97m"


def colorize_value(val_str: str) -> str:
    """Intelligently apply color styling to a value string based on its content."""
    s = val_str.strip()
    low = s.lower()

    # Success / Ready / OK / True
    if low in {"true", "ok", "ready", "completed", "success", "executed", "watertight"} or low.startswith(("rendered successfully", "enabled", "preserved")):
        return f"{GREEN}{BOLD}{val_str}{RESET}"

    # Skipped / In-progress / Passthrough / Degraded / Warn
    if low in {"skipped", "passthrough", "degraded", "running", "warn"} or low.startswith(("skipped", "passthrough", "notice")):
        return f"{YELLOW}{BOLD}{val_str}{RESET}"

    # Error / Failed / False
    if low in {"failed", "error", "fatal"} or "fail" in low or "error" in low:
        return f"{RED}{BOLD}{val_str}{RESET}"

    # If it contains numbers/units/percentages like 49,982 tris, -40.6%, 1.25s
    if re.search(r"\d+([.,]\d+)?\s*(%|faces|verts|tris|kb|mb|gb|s|ms|deg)", low):
        # Colorize numeric metrics yellow
        return f"{YELLOW}{val_str}{RESET}"

    # File path / directory
    if "/" in val_str or "\\" in val_str or low.endswith((".glb", ".fbx", ".obj", ".png", ".jpg", ".json")):
        return f"{MAGENTA}{val_str}{RESET}"

    return f"{WHITE}{val_str}{RESET}"


def format_bytes(num_bytes: Union[int, float]) -> str:
    """Format a byte count into a human-readable string (KB, MB, GB)."""
    if num_bytes is None or num_bytes < 0:
        return "N/A"
    for unit in ["B", "KB", "MB", "GB"]:
        if abs(num_bytes) < 1024.0:
            return f"{num_bytes:.1f} {unit}"
        num_bytes /= 1024.0
    return f"{num_bytes:.1f} TB"


def get_gpu_memory_summary(gpu_id: Optional[int] = None) -> str:
    """Get allocated and reserved GPU memory summary if PyTorch CUDA is active."""
    if torch is None or not torch.cuda.is_available():
        return "CPU mode"
    try:
        dev = gpu_id if gpu_id is not None else torch.cuda.current_device()
        alloc = torch.cuda.memory_allocated(dev) / (1024 ** 2)
        res = torch.cuda.memory_reserved(dev) / (1024 ** 2)
        return f"Allocated: {alloc:.0f}MB | Reserved: {res:.0f}MB"
    except Exception:
        return "CUDA"


def format_box(
    title: str,
    items: Sequence[Tuple[str, Any]],
    width: int = 76,
    border_color: str = CYAN,
) -> str:
    """
    Format key-value items into a neat colored unicode box:
    ┌─ [TITLE] ──────────────────────────────────────────
    │ Key:             Value
    └────────────────────────────────────────────────────
    """
    header_prefix = f"┌─ [{title}] "
    header_fill = max(0, width - len(header_prefix))
    lines = [f"{border_color}┌─ {B_WHITE}[{title}]{RESET}{border_color} {'─' * header_fill}{RESET}"]

    # Determine max key width for aligned indentation
    clean_items: List[Tuple[str, str]] = []
    for k, v in items:
        if v is None:
            v_str = "None"
        elif isinstance(v, bool):
            v_str = "True" if v else "False"
        elif isinstance(v, float):
            v_str = f"{v:.4g}"
        elif isinstance(v, (list, tuple, set)):
            v_str = ", ".join(str(x) for x in v) if v else "[]"
        else:
            v_str = str(v)
        clean_items.append((str(k), v_str))

    max_k_len = max((len(k) for k, _ in clean_items), default=12)
    key_col_width = min(max(max_k_len + 1, 14), 28)

    for k, v in clean_items:
        # Wrap multi-line values gracefully
        val_lines = v.splitlines() or [""]
        first_val = colorize_value(val_lines[0])
        lines.append(f"{border_color}│{RESET} • {B_CYAN}{k:<{key_col_width}}{RESET}: {first_val}")
        for subsequent in val_lines[1:]:
            lines.append(f"{border_color}│{RESET}   {' ' * key_col_width}  {colorize_value(subsequent)}")

    lines.append(f"{border_color}└{'─' * max(0, width - 1)}{RESET}")
    return "\n".join(lines)


def format_banner(
    title: str,
    items: Optional[Sequence[Tuple[str, Any]]] = None,
    width: int = 78,
    border_color: str = CYAN,
) -> str:
    """
    Format a high-visibility banner with double-line borders and ANSI color styling:
    ══════════════════════════════════════════════════════════════════════════════
    [TITLE]
    ──────────────────────────────────────────────────────────────────────────────
    • Key:             Value
    ══════════════════════════════════════════════════════════════════════════════
    """
    top_bar = f"{border_color}{'═' * width}{RESET}"
    divider = f"{border_color}{'─' * width}{RESET}"
    title_line = f"{B_WHITE}{BOLD}[{title}]{RESET}"
    lines = [top_bar, title_line, divider]

    if items:
        clean_items: List[Tuple[str, str]] = []
        for k, v in items:
            if v is None:
                v_str = "None"
            elif isinstance(v, bool):
                v_str = "True" if v else "False"
            elif isinstance(v, float):
                v_str = f"{v:.4g}"
            else:
                v_str = str(v)
            clean_items.append((str(k), v_str))

        max_k_len = max((len(k) for k, _ in clean_items), default=14)
        key_col_width = min(max(max_k_len + 1, 16), 30)

        for k, v in clean_items:
            val_lines = v.splitlines() or [""]
            first_val = colorize_value(val_lines[0])
            lines.append(f"• {B_CYAN}{k:<{key_col_width}}{RESET}: {first_val}")
            for sub in val_lines[1:]:
                lines.append(f"  {' ' * key_col_width}  {colorize_value(sub)}")

    lines.append(top_bar)
    return "\n".join(lines)
