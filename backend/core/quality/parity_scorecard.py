"""Parity scorecard generator comparing ForMash3D against market competitors.

Generates parity_scorecard.json with evaluated quality, performance, and failure rates.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional

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


def create_parity_scorecard_template() -> Dict[str, Dict[str, Any]]:
    """Create a blank parity scorecard template with required rows and columns."""
    return {
        row: {col: None for col in SCORECARD_COLUMNS}
        for row in SCORECARD_ROWS
    }


def generate_parity_scorecard(
    output_path: Optional[str | Path] = None,
    entries: Optional[Dict[str, Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """Generate parity scorecard, optionally writing to json file.
    
    Parameters
    ----------
    output_path : str or Path, optional
        Destination json path (default: parity_scorecard.json if called as CLI).
    entries : dict, optional
        Custom row/col mappings to merge into template.
        
    Returns
    -------
    dict:
        Populated scorecard dictionary.
    """
    scorecard = create_parity_scorecard_template()

    if entries:
        for row, cols in entries.items():
            if row in scorecard and isinstance(cols, dict):
                for col, val in cols.items():
                    if col in SCORECARD_COLUMNS:
                        scorecard[row][col] = val

    payload = {
        "metadata": {
            "title": "ForMash3D Parity Scorecard",
            "columns": SCORECARD_COLUMNS,
            "rows": SCORECARD_ROWS,
        },
        "scorecard": scorecard,
    }

    if output_path:
        out_p = Path(output_path)
        out_p.parent.mkdir(parents=True, exist_ok=True)
        with out_p.open("w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2)

    return payload


if __name__ == "__main__":
    generate_parity_scorecard("parity_scorecard.json")
