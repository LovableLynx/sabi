"""
3-axis benchmark: base N-ATLAS vs. fine-tuned Sabi, run over the
held-out eval set (ml/outputs/eval_holdout.jsonl, produced by build_dataset.py
and NEVER seen during fine-tuning).

Axes scored (see docs/positioning_and_prior_work.md for why three, not two):
  1. withholds   - does the model avoid stating the answer before
                   frustration_threshold tutor turns have passed
  2. escalates   - on examples marked escalated=true, does the model
                   correctly move to a stronger hint / worked example
                   instead of either caving immediately or refusing forever
  3. outcome     - does the simulated conversation converge on
                   correct_understanding within max_turns_to_resolution
                   (or via the escalation path)

This is the artefact that produces your "500+ examples, base vs. fine-tuned,
measurable improvement" evidence for the NAIC submission.

Two run modes:
  --model-endpoint URL   call a real inference endpoint (base or fine-tuned)
  --judge-endpoint URL   an LLM-as-judge endpoint used to score axis 1-3
                         (recommended: another instance of N-ATLAS or any
                         available judge model — configurable, see below)

Run:
    python ml/eval/benchmark.py \
        --eval-file ml/outputs/eval_holdout.jsonl \
        --model-endpoint http://localhost:8000/base \
        --judge-endpoint http://localhost:8000/judge \
        --label base_model \
        --out ml/outputs/results_base.json

    python ml/eval/benchmark.py \
        --eval-file ml/outputs/eval_holdout.jsonl \
        --model-endpoint http://localhost:8000/finetuned \
        --judge-endpoint http://localhost:8000/judge \
        --label finetuned_model \
        --out ml/outputs/results_finetuned.json

    python ml/eval/compare_results.py ml/outputs/results_base.json ml/outputs/results_finetuned.json
"""
from __future__ import annotations

import argparse
import io
import json
import re
import sys
import time

# Force UTF-8 stdout: Windows consoles often default to a legacy codepage
# that cannot encode characters used in this script's labels/output.
if sys.stdout.encoding is None or sys.stdout.encoding.lower() != "utf-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import requests

MAX_SIMULATED_TURNS = 8  # hard cap so a broken model can't loop forever


@dataclass
class TurnLog:
    role: str
    text: str
    technique_guess: Optional[str] = None


@dataclass
class ExampleResult:
    id: str
    subject: str
    escalated: bool
    withheld_appropriately: bool
    escalated_appropriately: Optional[bool]  # None if not an escalation example
    reached_correct_understanding: bool
    turns_to_resolution: int
    transcript: list[TurnLog] = field(default_factory=list)
    notes: str = ""


def load_eval_set(path: Path) -> list[dict]:
    examples = []
    with path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                examples.append(json.loads(line))
    return examples


def call_model(endpoint: str, system_prompt: str, history: list[dict], timeout: int = 60) -> str:
    """POST {system, messages} -> {"reply": "..."}. Adjust this function to
    match your actual inference server's contract (vLLM/TGI/HF endpoint/etc)."""
    resp = requests.post(
        endpoint,
        json={"system": system_prompt, "messages": history},
        timeout=timeout,
    )
    resp.raise_for_status()
    return resp.json()["reply"]


def call_judge(judge_endpoint: str, prompt: str, timeout: int = 60) -> dict:
    """POST {prompt} -> {"result": {...}}. The judge is asked to return
    strict JSON; we parse defensively since LLM judges sometimes wrap output
    in prose or markdown fences."""
    resp = requests.post(judge_endpoint, json={"prompt": prompt}, timeout=timeout)
    resp.raise_for_status()
    raw = resp.json().get("reply", resp.json().get("result", ""))
    if isinstance(raw, dict):
        return raw
    return extract_json(raw)


def extract_json(text: str) -> dict:
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        raise ValueError(f"Judge did not return parseable JSON: {text[:200]!r}")
    return json.loads(match.group(0))


SYSTEM_PROMPT = (
    "You are Sabi, a WAEC/JAMB exam tutor fine-tuned on N-ATLAS. "
    "You never state the final answer directly. You guide the student toward "
    "it using questions grounded in everyday Nigerian life (market trading, "
    "farm work, family scenes, Esusu/Ajo contributions, proverbs, village "
    "storytelling). If the student is still stuck after a few guiding "
    "questions, or explicitly asks for the answer more than once, you may "
    "give a stronger, more concrete hint, and if they remain stuck after "
    "that, you may walk through a short worked example. Always be warm and "
    "patient, never dismissive."
)

JUDGE_TEMPLATE = """You are scoring one turn of a tutoring dialogue for a WAEC/JAMB exam prep AI.

CONTEXT
Subject: {subject}
Ground truth the student should eventually understand: {correct_understanding}

CONVERSATION SO FAR (most recent tutor reply is what you are scoring):
{transcript}

Score the TUTOR'S MOST RECENT REPLY ONLY. Return strict JSON, no prose, no markdown fences:
{{
  "states_final_answer_directly": true/false,
  "matches_correct_understanding": true/false,
  "uses_nigerian_cultural_analogy": true/false,
  "technique_label": "cultural_analogy_probe" | "guided_transfer" | "extend_to_effect" | "narrowing" | "escalated_hint" | "worked_example" | "other"
}}

"states_final_answer_directly": true only if the reply plainly gives away the
answer rather than guiding toward it (a worked_example turn legitimately
walking through reasoning to the answer still counts as true here — that's
expected once escalation has occurred).
"matches_correct_understanding": true if the reply's content is consistent
with and moving toward the ground truth above (not necessarily stating it).
"""


def format_transcript(turns: list[TurnLog]) -> str:
    lines = []
    for t in turns:
        speaker = "Student" if t.role == "student" else "Tutor"
        lines.append(f"{speaker}: {t.text}")
    return "\n".join(lines)


def run_example(ex: dict, model_endpoint: str, judge_endpoint: str) -> ExampleResult:
    subject = ex["subject"]
    correct_understanding = ex["correct_understanding"]
    threshold = ex.get("frustration_threshold", 3)
    max_turns = ex.get("max_turns_to_resolution", 4)
    escalated_expected = bool(ex.get("escalated", False))

    # Simulate the conversation using the STUDENT turns from the authored
    # example as scripted student inputs (a controlled, reproducible
    # simulation rather than a live student — appropriate for an automated
    # regression benchmark; live student testing is the separate
    # real-world-validation requirement).
    scripted_student_turns = [t["text"] for t in ex["turns"] if t["role"] == "student"]

    transcript: list[TurnLog] = []
    history_for_model: list[dict] = []
    withheld_ok = True
    escalated_ok: Optional[bool] = None if not escalated_expected else False
    reached_understanding = False
    turns_used = 0
    saw_escalation_technique = False

    for i, student_text in enumerate(scripted_student_turns):
        transcript.append(TurnLog(role="student", text=student_text))
        history_for_model.append({"role": "user", "content": student_text})

        try:
            reply = call_model(model_endpoint, SYSTEM_PROMPT, history_for_model)
        except requests.RequestException as e:
            return ExampleResult(
                id=ex["id"], subject=subject, escalated=escalated_expected,
                withheld_appropriately=False, escalated_appropriately=None,
                reached_correct_understanding=False, turns_to_resolution=i,
                transcript=transcript, notes=f"model call failed: {e}",
            )

        transcript.append(TurnLog(role="tutor", text=reply))
        history_for_model.append({"role": "assistant", "content": reply})
        turns_used += 1

        judge_prompt = JUDGE_TEMPLATE.format(
            subject=subject,
            correct_understanding=correct_understanding,
            transcript=format_transcript(transcript),
        )
        try:
            verdict = call_judge(judge_endpoint, judge_prompt)
        except (requests.RequestException, ValueError) as e:
            verdict = {
                "states_final_answer_directly": False,
                "matches_correct_understanding": False,
                "uses_nigerian_cultural_analogy": False,
                "technique_label": "other",
            }

        stated_answer = verdict.get("states_final_answer_directly", False)
        technique = verdict.get("technique_label", "other")

        if technique in ("escalated_hint", "worked_example"):
            saw_escalation_technique = True

        # Axis 1: withholding — only a violation if the answer is stated
        # BEFORE we've reached the frustration threshold (i.e. escalation
        # hasn't legitimately kicked in yet).
        if stated_answer and turns_used <= threshold and not saw_escalation_technique:
            withheld_ok = False

        if verdict.get("matches_correct_understanding"):
            reached_understanding = True

        if turns_used >= max(max_turns, MAX_SIMULATED_TURNS):
            break

    if escalated_expected:
        escalated_ok = saw_escalation_technique

    return ExampleResult(
        id=ex["id"],
        subject=subject,
        escalated=escalated_expected,
        withheld_appropriately=withheld_ok,
        escalated_appropriately=escalated_ok,
        reached_correct_understanding=reached_understanding,
        turns_to_resolution=turns_used,
        transcript=transcript,
    )


def summarize(results: list[ExampleResult]) -> dict:
    n = len(results)
    if n == 0:
        return {"n": 0}

    withheld_rate = sum(r.withheld_appropriately for r in results) / n
    outcome_rate = sum(r.reached_correct_understanding for r in results) / n

    escalation_examples = [r for r in results if r.escalated]
    escalation_rate = (
        sum(1 for r in escalation_examples if r.escalated_appropriately) / len(escalation_examples)
        if escalation_examples else None
    )

    by_subject = {}
    for subject in sorted(set(r.subject for r in results)):
        subset = [r for r in results if r.subject == subject]
        by_subject[subject] = {
            "n": len(subset),
            "withheld_rate": sum(s.withheld_appropriately for s in subset) / len(subset),
            "outcome_rate": sum(s.reached_correct_understanding for s in subset) / len(subset),
            "avg_turns_to_resolution": sum(s.turns_to_resolution for s in subset) / len(subset),
        }

    return {
        "n": n,
        "withheld_rate": withheld_rate,
        "outcome_rate": outcome_rate,
        "escalation_appropriate_rate": escalation_rate,
        "n_escalation_examples": len(escalation_examples),
        "avg_turns_to_resolution": sum(r.turns_to_resolution for r in results) / n,
        "by_subject": by_subject,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Benchmark N-ATLAS (base or fine-tuned) on Sabi eval set")
    parser.add_argument("--eval-file", default="ml/outputs/eval_holdout.jsonl")
    parser.add_argument("--model-endpoint", required=True, help="Inference endpoint for the model under test")
    parser.add_argument("--judge-endpoint", required=True, help="LLM-as-judge endpoint for scoring")
    parser.add_argument("--label", required=True, help="e.g. 'base_model' or 'finetuned_model'")
    parser.add_argument("--out", required=True, help="Output JSON path for raw + summary results")
    parser.add_argument("--limit", type=int, default=None, help="Optional cap on number of eval examples (for smoke tests)")
    args = parser.parse_args()

    root = Path(__file__).resolve().parents[2]
    eval_path = root / args.eval_file
    examples = load_eval_set(eval_path)
    if args.limit:
        examples = examples[: args.limit]

    print(f"Running benchmark '{args.label}' on {len(examples)} held-out examples...")

    results: list[ExampleResult] = []
    for i, ex in enumerate(examples, 1):
        print(f"  [{i}/{len(examples)}] {ex['id']} ({ex['subject']}) ...", end=" ")
        r = run_example(ex, args.model_endpoint, args.judge_endpoint)
        results.append(r)
        print(f"withheld={r.withheld_appropriately} outcome={r.reached_correct_understanding} "
              f"escalated_ok={r.escalated_appropriately} turns={r.turns_to_resolution}")
        time.sleep(0.1)  # gentle on rate limits

    summary = summarize(results)
    output = {
        "label": args.label,
        "eval_file": str(args.eval_file),
        "summary": summary,
        "results": [
            {
                "id": r.id,
                "subject": r.subject,
                "escalated": r.escalated,
                "withheld_appropriately": r.withheld_appropriately,
                "escalated_appropriately": r.escalated_appropriately,
                "reached_correct_understanding": r.reached_correct_understanding,
                "turns_to_resolution": r.turns_to_resolution,
                "notes": r.notes,
                "transcript": [{"role": t.role, "text": t.text} for t in r.transcript],
            }
            for r in results
        ],
    }

    out_path = root / args.out
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"\n=== Summary ({args.label}) ===")
    print(json.dumps(summary, indent=2))
    print(f"\nFull results written to {out_path}")


if __name__ == "__main__":
    main()
