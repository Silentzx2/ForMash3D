"""Parity scorecard generator comparing ForMesh3D against market competitors.

Strict truth contract:
Every cell is either a measured number with a source file or null.
Qualitative marketing claims and unsourced metrics are strictly disallowed.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

SCORECARD_ROWS: List[str] = [
    "sharpness",
    "topology_cleanliness",
    "uv_quality",
    "texture_quality",
    "speed",
    "failure_rate",
]

SCORECARD_COLUMNS: List[str] = [
    "ForMash3D",
    "Tripo",
    "Meshy",
    "Hyper3D",
]


def create_parity_scorecard_template() -> Dict[str, Dict[str, Optional[Dict[str, Any]]]]:
    """Create a blank parity scorecard template where every cell defaults to null."""
    return {
        row: {col: None for col in SCORECARD_COLUMNS}
        for row in SCORECARD_ROWS
    }


def validate_scorecard_cell(row: str, col: str, cell: Any) -> None:
    """Validate that a cell is either None (null) or a dict with numeric value and source file."""
    if cell is None:
        return
    if not isinstance(cell, dict):
        raise ValueError(
            f"Invalid cell at [{row}][{col}]: must be null or a dict with 'value' and 'source', got {type(cell).__name__}"
        )
    val = cell.get("value")
    if val is not None and not isinstance(val, (int, float)):
        raise ValueError(
            f"Invalid value at [{row}][{col}]: 'value' must be numeric or null, got {val!r}"
        )
    if val is not None:
        source = cell.get("source")
        if not source or not isinstance(source, str) or not source.strip():
            raise ValueError(
                f"Unsourced metric at [{row}][{col}]: numeric value {val} must specify a non-empty 'source' file path"
            )


def validate_scorecard(scorecard_payload: Dict[str, Any]) -> None:
    """Validate an entire scorecard payload for truth and source attribution."""
    scorecard = scorecard_payload.get("scorecard", {})
    for row in SCORECARD_ROWS:
        cols = scorecard.get(row, {})
        for col in SCORECARD_COLUMNS:
            cell = cols.get(col)
            validate_scorecard_cell(row, col, cell)


def generate_parity_scorecard(
    output_path: Optional[Union[str, Path]] = None,
    entries: Optional[Dict[str, Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """Generate parity scorecard with strict source attribution, writing to JSON."""
    scorecard = create_parity_scorecard_template()

    if entries:
        for row, cols in entries.items():
            if row in scorecard and isinstance(cols, dict):
                for col, val in cols.items():
                    if col in SCORECARD_COLUMNS:
                        if val is None:
                            scorecard[row][col] = None
                        elif isinstance(val, dict):
                            validate_scorecard_cell(row, col, val)
                            scorecard[row][col] = val
                        elif isinstance(val, (int, float)):
                            raise ValueError(
                                f"Bare numeric literal {val} at [{row}][{col}] has no source file attribution."
                            )
                        else:
                            raise ValueError(
                                f"Disallowed qualitative string at [{row}][{col}]: {val!r}"
                            )

    payload = {
        "metadata": {
            "title": "ForMesh3D Parity Scorecard",
            "columns": SCORECARD_COLUMNS,
            "rows": SCORECARD_ROWS,
            "policy": "Every cell is either a measured number with a source file or null. Qualitative marketing strings are prohibited.",
        },
        "scorecard": scorecard,
    }

    validate_scorecard(payload)

    if output_path:
        out_p = Path(output_path)
        out_p.parent.mkdir(parents=True, exist_ok=True)
        with out_p.open("w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2)

    return payload


if __name__ == "__main__":
    generate_parity_scorecard("parity_scorecard.json")
