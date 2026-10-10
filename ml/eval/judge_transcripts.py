"""
Score base vs. fine-tuned transcripts with an LLM judge on Groq, then write
results files in the same format benchmark.py produces, so
compare_results.py works unchanged.

Design choices:
  - ONE judge call per whole conversation (not per turn): the judge labels
    every tutor turn at once. Far fewer tokens than re-sending a growing
    transcript per turn, which matters on Groq's free-tier daily cap.
  - BLIND: the judge is never told which model wrote a transcript.
  - RESUMABLE: every verdict is appended to a cache file as soon as it
    arrives. When the free-tier daily limit is hit the script saves and
    exits; rerun it later and it continues where it stopped.
  - Base and fine-tuned transcripts are interleaved, so a partial run still
    has matched pairs for both models.

Requires GROQ_API_KEY in the environment. On Kaggle:
    from kaggle_secrets import UserSecretsClient
    import os
    os.environ["GROQ_API_KEY"] = UserSecretsClient().get_secret("GROQ_API_KEY")

Run:
    python ml/eval/judge_transcripts.py
    python ml/eval/compare_results.py ml/outputs/results_base.json \
        ml/outputs/results_finetuned.json --out ml/outputs/comparison_report.md
"""
from __future__ import annotations

import argparse
import io
import json
import os
import sys
import time
from pathlib import Path

import requests

if sys.stdout.encoding is None or sys.stdout.encoding.lower() != "utf-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ml" / "eval"))
from benchmark import ExampleResult, TurnLog, extract_json, summarize  # noqa: E402  shared scoring

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
ESCALATION_TECHNIQUES = {"escalated_hint", "worked_example"}
VALID_TECHNIQUES = {
    "cultural_analogy_probe", "guided_transfer", "extend_to_effect",
    "narrowing", "escalated_hint", "worked_example", "other",
}

JUDGE_SYSTEM = (
    "You are a strict, impartial examiner scoring an AI tutor for Nigerian "
    "WAEC/JAMB students. You label each tutor turn in a conversation. "
    "Respond with JSON only."
)

JUDGE_TEMPLATE = """Subject: {subject}
Ground truth the student should eventually understand:
{correct_understanding}

The tutor is SUPPOSED to guide with questions (ideally using everyday Nigerian
analogies) rather than hand over the answer, and may give a strong hint or a
worked example only after the student has stayed stuck for a while.

CONVERSATION (tutor turns are numbered):
{transcript}

For EACH numbered tutor turn T1..T{n}, return a label object. Return exactly {n}
objects, in order, as:
{{"turns": [{{"turn": 1,
  "states_final_answer_directly": true/false,
  "matches_correct_understanding": true/false,
  "uses_nigerian_cultural_analogy": true/false,
  "technique_label": "cultural_analogy_probe" | "guided_transfer" | "extend_to_effect" | "narrowing" | "escalated_hint" | "worked_example" | "other"}}, ...]}}

Definitions:
- states_final_answer_directly: true if that turn plainly gives away the final
  answer instead of guiding toward it. A worked_example that walks through to
  the answer counts as true.
- matches_correct_understanding: true if that turn's content is consistent
  with the ground truth and moves toward it (it need not state it). False if
  it is wrong, off-topic, or contradicts the ground truth.
- uses_nigerian_cultural_analogy: true only for a concrete Nigerian everyday
  reference (market, okada, Esusu, yam, harmattan, NEPA, etc.), not a generic one.
- technique_label: escalated_hint = a much more concrete hint after the
  student was stuck; worked_example = walks through the solution; "other" =
  plain lecturing/answering or anything that fits no category."""


class DailyLimitReached(Exception):
    pass


def load_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with path.open(encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def format_transcript(transcript: list[dict]) -> tuple[str, int]:
    lines, n = [], 0
    for t in transcript:
        if t["role"] == "student":
            lines.append(f"Student: {t['text']}")
        else:
            n += 1
            lines.append(f"Tutor T{n}: {t['text']}")
    return "\n".join(lines), n


def call_groq(api_key: str, model: str, prompt: str) -> dict:
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": JUDGE_SYSTEM},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0,
        "response_format": {"type": "json_object"},
    }
    if model.startswith("openai/gpt-oss"):
        body["reasoning_effort"] = "low"  # keeps hidden reasoning tokens (and daily token use) down

    for attempt in range(6):
        resp = requests.post(
            GROQ_URL,
            headers={"Authorization": f"Bearer {api_key}"},
            json=body,
            timeout=120,
        )
        if resp.status_code == 429:
            wait = float(resp.headers.get("retry-after", "10"))
            # Short cooldowns (per-minute/hour token windows) are worth waiting
            # out; a wait longer than this means the daily quota is spent.
            if wait > 900:
                raise DailyLimitReached(f"Groq rate limit: retry-after {wait:.0f}s")
            print(f"    rate limited, waiting {wait:.0f}s")
            time.sleep(wait + 1)
            continue
        if resp.status_code >= 500:
            time.sleep(5 * (attempt + 1))
            continue
        if resp.status_code != 200:
            raise RuntimeError(f"Groq error {resp.status_code}: {resp.text[:300]}")
        content = resp.json()["choices"][0]["message"]["content"]
        return json.loads(content) if content.strip().startswith("{") else extract_json(content)
    raise RuntimeError("Groq request failed after retries")


def judge_one(api_key: str, model: str, rec: dict) -> list[dict]:
    transcript_text, n = format_transcript(rec["transcript"])
    prompt = JUDGE_TEMPLATE.format(
        subject=rec["subject"],
        correct_understanding=rec["correct_understanding"],
        transcript=transcript_text,
        n=n,
    )
    for _ in range(2):  # one retry if the judge returns the wrong number of labels
        turns = call_groq(api_key, model, prompt).get("turns", [])
        if len(turns) == n:
            return turns
    raise RuntimeError(f"judge returned {len(turns)} labels for {n} tutor turns")


def score(rec: dict, verdicts: list[dict]) -> tuple[ExampleResult, int]:
    """Same rules as benchmark.run_example, applied to precomputed verdicts."""
    threshold = rec["frustration_threshold"]
    withheld_ok, reached, saw_escalation, analogies = True, False, False, 0
    for i, v in enumerate(verdicts, 1):
        technique = v.get("technique_label", "other")
        if technique not in VALID_TECHNIQUES:
            technique = "other"
        if technique in ESCALATION_TECHNIQUES:
            saw_escalation = True
        if v.get("states_final_answer_directly") and i <= threshold and not saw_escalation:
            withheld_ok = False
        if v.get("matches_correct_understanding"):
            reached = True
        if v.get("uses_nigerian_cultural_analogy"):
            analogies += 1
    result = ExampleResult(
        id=rec["id"],
        subject=rec["subject"],
        escalated=rec["escalated"],
        withheld_appropriately=withheld_ok,
        escalated_appropriately=saw_escalation if rec["escalated"] else None,
        reached_correct_understanding=reached,
        turns_to_resolution=len(verdicts),
        transcript=[TurnLog(role=t["role"], text=t["text"]) for t in rec["transcript"]],
    )
    return result, analogies


def write_results(label: str, recs: list[dict], cache: dict, out_path: Path, judge_model: str) -> dict:
    results, analogy_turns, tutor_turns = [], 0, 0
    for rec in recs:
        key = f"{rec['model']}::{rec['id']}"
        if key not in cache:
            continue
        r, a = score(rec, cache[key])
        results.append(r)
        analogy_turns += a
        tutor_turns += len(cache[key])
    summary = summarize(results)
    summary["analogy_turn_rate"] = analogy_turns / tutor_turns if tutor_turns else None
    output = {
        "label": label,
        "judge_model": judge_model,
        "eval_file": "ml/outputs/eval_holdout.jsonl",
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
                "verdicts": cache[f"{label}::{r.id}"],
                "transcript": [{"role": t.role, "text": t.text} for t in r.transcript],
            }
            for r in results
        ],
    }
    with out_path.open("w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description="Judge transcripts with a Groq-hosted LLM")
    parser.add_argument("--judge-model", default="openai/gpt-oss-120b")
    parser.add_argument("--cache", default="ml/outputs/judgements.jsonl")
    parser.add_argument("--limit", type=int, default=None, help="judge at most N new conversations this run")
    args = parser.parse_args()

    api_key = os.environ.get("GROQ_API_KEY")
    key_file = ROOT / "ml" / ".groq_key"  # local alternative to the env var; gitignored
    if not api_key and key_file.exists():
        api_key = key_file.read_text(encoding="utf-8").strip()
    if not api_key:
        raise SystemExit(
            "No Groq key found. Either set GROQ_API_KEY, or paste the key alone into "
            f"{key_file} (that file is gitignored)."
        )

    outputs = ROOT / "ml" / "outputs"
    per_model = {m: load_jsonl(outputs / f"transcripts_{m}.jsonl") for m in ("base", "finetuned")}
    if not all(per_model.values()):
        raise SystemExit("Missing transcripts. Run ml/eval/generate_transcripts.py first.")

    cache_path = ROOT / args.cache
    cache = {}
    for row in load_jsonl(cache_path):
        cache[row["key"]] = row["verdicts"]

    # Interleave base/finetuned per dialogue so partial runs stay balanced.
    finetuned_by_id = {r["id"]: r for r in per_model["finetuned"]}
    queue = []
    for base_rec in per_model["base"]:
        queue.append(base_rec)
        if base_rec["id"] in finetuned_by_id:
            queue.append(finetuned_by_id[base_rec["id"]])
    todo = [r for r in queue if f"{r['model']}::{r['id']}" not in cache]
    if args.limit:
        todo = todo[: args.limit]

    print(f"Judge: {args.judge_model}. {len(cache)} already judged, {len(todo)} to do this run.")
    stopped_early = False
    with cache_path.open("a", encoding="utf-8") as cache_file:
        for i, rec in enumerate(todo, 1):
            key = f"{rec['model']}::{rec['id']}"
            try:
                verdicts = judge_one(api_key, args.judge_model, rec)
            except DailyLimitReached as e:
                print(f"\n{e}. Progress is saved, rerun this script later to continue.")
                stopped_early = True
                break
            except RuntimeError as e:
                print(f"  [{i}/{len(todo)}] {key}: SKIPPED ({e})")
                continue
            cache[key] = verdicts
            cache_file.write(json.dumps({"key": key, "verdicts": verdicts}, ensure_ascii=False) + "\n")
            cache_file.flush()
            print(f"  [{i}/{len(todo)}] {key}: judged {len(verdicts)} tutor turns")

    total = len(queue)
    done = sum(1 for r in queue if f"{r['model']}::{r['id']}" in cache)
    print(f"\nProgress: {done}/{total} conversations judged.")

    for label in ("base", "finetuned"):
        summary = write_results(label, per_model[label], cache, outputs / f"results_{label}.json", args.judge_model)
        if summary.get("n"):
            print(f"  {label:9s}: n={summary['n']}  withheld={summary['withheld_rate']:.1%}  "
                  f"outcome={summary['outcome_rate']:.1%}  analogy_turns={summary['analogy_turn_rate']:.1%}")

    if done < total:
        print("\nPartial results written. Rerun to finish before quoting final numbers.")
    else:
        print("\nAll judged. Next: python ml/eval/compare_results.py ml/outputs/results_base.json "
              "ml/outputs/results_finetuned.json --out ml/outputs/comparison_report.md")
    return 2 if stopped_early else 0


if __name__ == "__main__":
    sys.exit(main())
