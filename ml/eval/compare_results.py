"""
Compare base vs. fine-tuned benchmark results and produce the "measurable
improvement" report for the NAIC submission's Sectoral Fine-Tuning
requirement (500+ examples, base vs. fine-tuned, measurable improvement).

Run:
    python ml/eval/compare_results.py \
        ml/outputs/results_base.json \
        ml/outputs/results_finetuned.json \
        --out ml/outputs/comparison_report.md
"""
from __future__ import annotations

import argparse
import io
import json
import sys
from pathlib import Path

# Windows consoles often default to a legacy codepage (cp1252) that cannot
# encode characters like the arrow used below. Force UTF-8 on stdout so this
# script's console output matches what's written to the report file
# regardless of platform/locale.
if sys.stdout.encoding is None or sys.stdout.encoding.lower() != "utf-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")


def pct(x: float | None) -> str:
    if x is None:
        return "n/a"
    return f"{x * 100:.1f}%"


def delta(a: float | None, b: float | None) -> str:
    if a is None or b is None:
        return "n/a"
    d = (b - a) * 100
    sign = "+" if d >= 0 else ""
    return f"{sign}{d:.1f} pp"


def load(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def build_report(base: dict, fine: dict) -> str:
    bs, fs = base["summary"], fine["summary"]
    lines = []
    lines.append("# Sabi: Base vs. Fine-Tuned N-ATLAS Benchmark\n")
    lines.append(f"Held-out eval set: `{base.get('eval_file', 'n/a')}`  ")
    lines.append(f"n = {bs['n']} examples (base) / {fs['n']} examples (fine-tuned)\n")

    lines.append("## Overall results\n")
    lines.append("| Metric | Base N-ATLAS | Fine-tuned (Sabi) | Delta |")
    lines.append("|---|---|---|---|")
    lines.append(f"| Withholds answer appropriately | {pct(bs['withheld_rate'])} | {pct(fs['withheld_rate'])} | {delta(bs['withheld_rate'], fs['withheld_rate'])} |")
    lines.append(f"| Reaches correct understanding | {pct(bs['outcome_rate'])} | {pct(fs['outcome_rate'])} | {delta(bs['outcome_rate'], fs['outcome_rate'])} |")
    lines.append(f"| Escalates appropriately (n={bs['n_escalation_examples']}) | {pct(bs['escalation_appropriate_rate'])} | {pct(fs['escalation_appropriate_rate'])} | {delta(bs['escalation_appropriate_rate'], fs['escalation_appropriate_rate'])} |")
    lines.append(f"| Avg. turns to resolution | {bs['avg_turns_to_resolution']:.2f} | {fs['avg_turns_to_resolution']:.2f} | {fs['avg_turns_to_resolution'] - bs['avg_turns_to_resolution']:+.2f} |")
    if bs.get("analogy_turn_rate") is not None and fs.get("analogy_turn_rate") is not None:
        lines.append(f"| Tutor turns using a Nigerian analogy | {pct(bs['analogy_turn_rate'])} | {pct(fs['analogy_turn_rate'])} | {delta(bs['analogy_turn_rate'], fs['analogy_turn_rate'])} |")
    lines.append("")
    if base.get("judge_model"):
        lines.append(f"Judge model: `{base['judge_model']}` (blind to which model wrote each transcript)\n")

    lines.append("## By subject\n")
    lines.append("| Subject | n | Withhold (base→tuned) | Outcome (base→tuned) | Avg turns (base→tuned) |")
    lines.append("|---|---|---|---|---|")
    for subject in sorted(bs["by_subject"].keys()):
        b = bs["by_subject"][subject]
        f = fs["by_subject"].get(subject, {})
        lines.append(
            f"| {subject} | {b['n']} | {pct(b['withheld_rate'])} → {pct(f.get('withheld_rate'))} "
            f"| {pct(b['outcome_rate'])} → {pct(f.get('outcome_rate'))} "
            f"| {b['avg_turns_to_resolution']:.2f} → {f.get('avg_turns_to_resolution', 0):.2f} |"
        )
    lines.append("")

    lines.append("## Interpretation notes for submission docs\n")
    lines.append(
        "- **Withholding** and **outcome** together tell the core story: a model "
        "that withholds *without* eventually reaching correct understanding is "
        "just being unhelpfully stubborn; a model that reaches understanding but "
        "never withholds is just answer-dumping. Report both, not either alone."
    )
    lines.append(
        "- **Escalation-appropriate rate** is the axis that differentiates this "
        "submission from a naive Socratic bot (see docs/positioning_and_prior_work.md) "
        ", it demonstrates the model was fine-tuned to avoid the Khanmigo "
        "disengagement failure mode, not just to refuse indefinitely."
    )
    lines.append(
        "- If avg. turns to resolution *drops* after fine-tuning while outcome "
        "rate holds or improves, that's evidence the fine-tune is guiding more "
        "efficiently, not just differently."
    )
    lines.append(
        "- These are automated, scripted-student simulations using an LLM "
        "judge, report them as a controlled regression benchmark, and pair "
        "them with the separate real-student validation required by the "
        "competition (which this script does not replace)."
    )
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("base_results")
    parser.add_argument("finetuned_results")
    parser.add_argument("--out", default="ml/outputs/comparison_report.md")
    args = parser.parse_args()

    base = load(args.base_results)
    fine = load(args.finetuned_results)
    report = build_report(base, fine)

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(report, encoding="utf-8")

    print(report)
    print(f"\nWritten to {out_path}")


if __name__ == "__main__":
    main()
