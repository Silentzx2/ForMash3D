"""Controlled A/B benchmark for two completed ForMash3D asset runs.

Without --reference, generated-vs-generated metrics are diagnostic only.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from core.quality.evaluation import compare_model_runs


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--baseline-asset", required=True)
    parser.add_argument("--candidate-asset", required=True)
    parser.add_argument("--reference")
    parser.add_argument("--output", required=True)
    parser.add_argument("--sample-count", type=int, default=4096)
    parser.add_argument("--render-dir")
    args = parser.parse_args()

    result = compare_model_runs(
        args.baseline_asset,
        args.candidate_asset,
        reference_mesh=args.reference,
        sample_count=max(256, args.sample_count),
        render_output_dir=args.render_dir,
    )
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2, sort_keys=True), encoding="utf-8")
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0 if result.get("status") == "ok" else 2


if __name__ == "__main__":
    raise SystemExit(main())
