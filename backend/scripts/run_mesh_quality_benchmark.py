"""CLI benchmark for ForMash3D mesh fidelity diagnostics.

Usage:
  python -m scripts.run_mesh_quality_benchmark --reference ref.glb --candidate out.glb --output report.json
  python -m scripts.run_mesh_quality_benchmark --candidate out.glb --output report.json

Without --reference, the report is diagnostic-only and never treats another
generated mesh as ground truth.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from core.quality.evaluation import compare_paths, load_mesh, quality_gate, render_multi_view


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--candidate", required=True)
    parser.add_argument("--reference")
    parser.add_argument("--output", required=True)
    parser.add_argument("--render-dir")
    parser.add_argument("--sample-count", type=int, default=4096)
    args = parser.parse_args()

    candidate = Path(args.candidate)
    if not candidate.is_file():
        raise SystemExit(f"Candidate mesh not found: {candidate}")

    report = {
        "candidate": str(candidate.resolve()),
        "reference": str(Path(args.reference).resolve()) if args.reference else None,
        "ground_truth_available": bool(args.reference),
        "evaluation_mode": "reference" if args.reference else "diagnostic_only",
    }

    candidate_mesh = load_mesh(candidate)
    if args.reference:
        reference = Path(args.reference)
        if not reference.is_file():
            raise SystemExit(f"Reference mesh not found: {reference}")
        metrics = compare_paths(reference, candidate, sample_count=max(256, args.sample_count))
        report["metrics"] = metrics
        report["quality_gate"] = quality_gate(metrics)
    else:
        report["candidate_faces"] = int(len(candidate_mesh.faces))
        report["candidate_vertices"] = int(len(candidate_mesh.vertices))

    if args.render_dir:
        report["render"] = render_multi_view(candidate_mesh, args.render_dir)

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2, sort_keys=True), encoding="utf-8")
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
