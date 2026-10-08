"""
Score the single-turn benchmark with no LLM judge: deterministic, free and
reproducible. For each held-out question and each model's first reply:

  answer_leaked   the reply contains one of the question's answer_terms
                  (the final value / named concept), i.e. it handed over the
                  answer instead of guiding. LOWER is better for a tutor.
  asks_question   the reply contains a question mark (a Socratic move)
  nigerian_ref    the reply uses a concrete Nigerian everyday reference
                  (word list below; a heuristic, reported as such)

Leak detection is conservative: a reply that states the answer in words a
term list doesn't cover is NOT counted as a leak. That under-counts leaks
for both models equally, so the comparison stays fair.

Paired McNemar exact test on answer_leaked tells whether the base-vs-Sabi
difference is bigger than chance.

Run:
    python ml/eval/score_single_turn.py
Outputs:
    ml/outputs/single_turn_report.md, ml/outputs/single_turn_scores.json
"""
from __future__ import annotations

import io
import json
import re
import sys
from math import comb
from pathlib import Path

if sys.stdout.encoding is None or sys.stdout.encoding.lower() != "utf-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[2]

NIGERIAN_REFS = [
    "okada", "danfo", "keke", "molue", "agbero", "bus stop", "mama put", "buka", "esusu", "ajo", "adashe",
    "yam", "garri", "jollof", "suya", "akara", "puff-puff", "puff puff", "egusi", "fufu", "amala", "ogbono",
    "cassava", "plantain", "palm wine", "palm oil", "kola", "nepa", "phcn", "generator", "harmattan",
    "rainy season", "compound", "village", "town crier", "iroko", "masquerade", "moonlight", "talking drum",
    "owambe", "aso-ebi", "aso ebi", "adire", "ankara", "oga", "abeg", "wahala", "market", "trader", "farm",
    "balogun", "onitsha", "ariaria", "kurmi", "alaba", "naija", "nigeria", "lagos", "kano", "abuja",
]


def norm(text: str) -> str:
    text = text.lower().replace("−", "-").replace("²", "^2").replace("³", "^3")
    return re.sub(r"\s+", " ", text)


def leaked(reply: str, terms: list[str]) -> bool:
    r = norm(reply)
    return any(norm(t) in r for t in terms if t.strip())


def nigerian_ref(reply: str, question: str) -> bool:
    # Only count references the model introduced, not ones copied from the question.
    r, q = norm(reply), norm(question)
    return any(re.search(rf"\b{re.escape(w)}\b", r) and not re.search(rf"\b{re.escape(w)}\b", q) for w in NIGERIAN_REFS)


def mcnemar_exact(b: int, c: int) -> float:
    """Two-sided exact McNemar p-value from discordant pair counts."""
    n = b + c
    if n == 0:
        return 1.0
    k = min(b, c)
    tail = sum(comb(n, i) for i in range(k + 1)) / 2 ** n
    return min(1.0, 2 * tail)


def pct(x: float) -> str:
    return f"{100 * x:.1f}%"


def main() -> int:
    questions = {}
    for path in sorted((ROOT / "data" / "benchmark").glob("single_turn_*.json")):
        for q in json.loads(path.read_text(encoding="utf-8")):
            questions[q["id"]] = q
    replies_path = ROOT / "ml" / "outputs" / "single_turn_replies.jsonl"
    if not replies_path.exists():
        raise SystemExit(f"Missing {replies_path}. Run ml/eval/generate_single_turn.py first.")
    replies = {}
    for line in replies_path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            r = json.loads(line)
            replies[(r["model"], r["id"])] = r["reply"]

    ids = [i for i in questions if ("base", i) in replies and ("finetuned", i) in replies]
    rows = []
    for i in ids:
        q = questions[i]
        row = {"id": i, "subject": q["subject"], "topic": q["topic"]}
        for m in ("base", "finetuned"):
            rep = replies[(m, i)]
            row[m] = {
                "answer_leaked": leaked(rep, q["answer_terms"]),
                "asks_question": "?" in rep,
                "nigerian_ref": nigerian_ref(rep, q["student_message"]),
                "words": len(rep.split()),
            }
        rows.append(row)

    def summary(subset: list[dict]) -> dict:
        n = len(subset)
        out = {"n": n}
        for m in ("base", "finetuned"):
            out[m] = {k: sum(r[m][k] for r in subset) / n for k in ("answer_leaked", "asks_question", "nigerian_ref")}
            out[m]["avg_words"] = sum(r[m]["words"] for r in subset) / n
        b = sum(1 for r in subset if r["base"]["answer_leaked"] and not r["finetuned"]["answer_leaked"])
        c = sum(1 for r in subset if r["finetuned"]["answer_leaked"] and not r["base"]["answer_leaked"])
        out["mcnemar"] = {"base_only_leaked": b, "sabi_only_leaked": c, "p_value": mcnemar_exact(b, c)}
        return out

    overall = summary(rows)
    by_subject = {s: summary([r for r in rows if r["subject"] == s]) for s in sorted({r["subject"] for r in rows})}

    lines = [
        "# Sabi single-turn benchmark: base N-ATLAS vs. fine-tuned",
        "",
        f"**{overall['n']} held-out questions** that do not appear in the training data, "
        "scored deterministically (no LLM judge) on each model's first reply.",
        "",
        "| Metric | Base N-ATLAS | Sabi | Change |",
        "|---|---|---|---|",
    ]
    for key, label, better in (
        ("answer_leaked", "Gives the answer away in its first reply (lower is better)", "lower"),
        ("asks_question", "Asks the student a guiding question", "higher"),
        ("nigerian_ref", "Brings in a Nigerian everyday reference", "higher"),
    ):
        bv, fv = overall["base"][key], overall["finetuned"][key]
        lines.append(f"| {label} | {pct(bv)} | {pct(fv)} | {100 * (fv - bv):+.1f} pts |")
    lines.append(f"| Average reply length (words) | {overall['base']['avg_words']:.0f} | {overall['finetuned']['avg_words']:.0f} | |")
    mc = overall["mcnemar"]
    lines += [
        "",
        f"Paired exact McNemar test on answer leaks: {mc['base_only_leaked']} questions where only base leaked, "
        f"{mc['sabi_only_leaked']} where only Sabi leaked, p = {mc['p_value']:.2g}.",
        "",
        "## By subject",
        "",
        "| Subject | n | Leaks: base → Sabi | Asks a question: base → Sabi | Nigerian reference: base → Sabi | McNemar p |",
        "|---|---|---|---|---|---|",
    ]
    for s, v in by_subject.items():
        lines.append(
            f"| {s} | {v['n']} | {pct(v['base']['answer_leaked'])} → {pct(v['finetuned']['answer_leaked'])} "
            f"| {pct(v['base']['asks_question'])} → {pct(v['finetuned']['asks_question'])} "
            f"| {pct(v['base']['nigerian_ref'])} → {pct(v['finetuned']['nigerian_ref'])} | {v['mcnemar']['p_value']:.2g} |"
        )
    lines += [
        "",
        "## How to read this",
        "",
        "- **Answer leak** means the reply contains the question's answer key: the final value or the named concept.",
        "  This check is conservative. An answer stated in words the key list doesn't cover is not counted, which",
        "  affects both models equally.",
        "- **Nigerian reference** uses a fixed word list and only counts references the model added, not ones copied",
        "  from the question. Treat it as a heuristic.",
        "- This test complements the multi-turn benchmark, which is judged by an LLM and checks whether students",
        "  reach the right understanding and whether the tutor escalates when they stay stuck.",
    ]

    (ROOT / "ml" / "outputs" / "single_turn_report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    (ROOT / "ml" / "outputs" / "single_turn_scores.json").write_text(
        json.dumps({"overall": overall, "by_subject": by_subject, "rows": rows}, indent=2), encoding="utf-8")
    print("\n".join(lines))
    return 0


if __name__ == "__main__":
    sys.exit(main())
