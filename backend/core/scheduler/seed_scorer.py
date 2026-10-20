"""Best-of-N seed candidate scoring and selection.

Computes a normalized composite quality score using fixed reference ranges
from config, and selects the best candidate with early stopping and tie-breaking.
"""
from __future__ import annotations

import functools
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
import yaml

try:
    from backend.core.config import get_quality_config
except ImportError:
    from core.config import get_quality_config


@functools.lru_cache(maxsize=4)
def load_seed_scoring_config(config_path: Optional[str] = None) -> Dict[str, Any]:
    """Load seed scoring weights, ranges and early stop threshold from canonical quality config."""
    cfg = get_quality_config(config_path)["seeds"]
    return {
        "weights": cfg["weights"],
        "ranges": cfg["ranges"],
        "early_stop_score": float(cfg["early_stop_score"]),
        "inverted": set(cfg.get("inverted", [])),
    }


def score_seed_candidate(metrics: Dict[str, Any], config_path: Optional[str] = None) -> float:
    """Compute normalized composite score [0.0, 1.0] using fixed reference ranges.

    Negative metrics (holes, floaters, degenerates, triangle count, aspect ratio)
    are inverted so that higher is always better.
    """
    cfg = load_seed_scoring_config(config_path)
    weights: Dict[str, float] = cfg["weights"]
    ranges: Dict[str, List[float]] = cfg["ranges"]
    inverted: set[str] = cfg["inverted"]

    total_weighted_score = 0.0
    total_weight = 0.0

    for metric_name, weight in weights.items():
        if metric_name not in metrics:
            continue
        try:
            val = float(metrics[metric_name])
        except (ValueError, TypeError):
            continue

        r = ranges.get(metric_name, [0.0, 1.0])
        r_min, r_max = float(r[0]), float(r[1])
        clipped = min(max(val, r_min), r_max)

        if r_max > r_min:
            norm = (clipped - r_min) / (r_max - r_min)
        else:
            norm = 1.0

        if metric_name in inverted:
            metric_score = 1.0 - norm
        else:
            metric_score = norm

        total_weighted_score += float(weight) * metric_score
        total_weight += float(weight)

    if total_weight <= 0:
        return 0.0

    composite = total_weighted_score / total_weight
    return float(round(min(max(composite, 0.0), 1.0), 4))


def select_best_candidate(
    candidates_metrics: List[Dict[str, Any]],
    early_stop_threshold: float = 0.85,
    config_path: Optional[str] = None,
) -> Tuple[int, float, List[Dict[str, Any]]]:
    """Select the best candidate from a sequence of candidates.

    - Sequentially scores candidates and stops early when score >= early_stop_threshold.
    - If no early stop, selects candidate with highest score; if within 2% composite,
      breaks ties with higher feature_edge_retention, then lower triangle_count.
    - Returns (best_index, best_score, scored_records).
    """
    if not candidates_metrics:
        return -1, 0.0, []

    scored_records: List[Dict[str, Any]] = []
    early_stopped = False

    for idx, cand in enumerate(candidates_metrics):
        score = score_seed_candidate(cand, config_path=config_path)
        record = {
            "candidate_index": idx,
            "composite_score": score,
            "metrics": cand,
            "early_stop": bool(score >= early_stop_threshold),
        }
        scored_records.append(record)
        if record["early_stop"]:
            early_stopped = True
            break

    if early_stopped:
        best_record = scored_records[-1]
        return best_record["candidate_index"], best_record["composite_score"], scored_records

    # No early stop occurred: evaluate among all scored candidates
    top_score = max(r["composite_score"] for r in scored_records)
    # Filter candidates within 2% (0.02) composite score
    tied_pool = [r for r in scored_records if (top_score - r["composite_score"]) <= 0.02 + 1e-9]

    def tie_break_sort_key(record: Dict[str, Any]):
        m = record["metrics"]
        fer = float(m.get("feature_edge_retention", 0.0))
        tc = float(m.get("triangle_count", float("inf")))
        return (-fer, tc, record["candidate_index"])

    best_record = min(tied_pool, key=tie_break_sort_key)
    return best_record["candidate_index"], best_record["composite_score"], scored_records
