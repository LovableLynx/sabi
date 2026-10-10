"""
Summarise anonymous pilot feedback (ml/outputs/feedback.jsonl, written by
serve_sabi.py during supervised student sessions) into a validation report.

Run:
    python ml/eval/summarise_pilot.py
    python ml/eval/summarise_pilot.py --file path/to/feedback.jsonl
Output:
    ml/outputs/pilot_report.md
"""
from __future__ import annotations

import argparse
import io
import json
import sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

if sys.stdout.encoding is None or sys.stdout.encoding.lower() != "utf-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[2]
LEVEL_NAMES = {"waec": "SS (WAEC/JAMB)", "bece": "JSS (BECE)", "ncee": "Primary (Common Entrance)", None: "Not set"}


def pct(n: int, d: int) -> str:
    return f"{100 * n / d:.0f}%" if d else "n/a"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--file", default="ml/outputs/feedback.jsonl")
    parser.add_argument("--out", default="ml/outputs/pilot_report.md")
    args = parser.parse_args()
    path = ROOT / args.file
    if not path.exists():
        raise SystemExit(f"No feedback file at {path}. Download it from the Kaggle session first.")
    rows = [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines() if l.strip()]
    if not rows:
        raise SystemExit("The feedback file is empty.")

    n = len(rows)
    helpful = Counter(r["helpful"] for r in rows)
    chatted = [r for r in rows if r["chat_turns"] > 0]
    asked = [r for r in chatted if r["gave_answer"] is not None]
    guided = sum(1 for r in asked if r["gave_answer"] is False)
    days = sorted({datetime.fromtimestamp(r["t"]).strftime("%Y-%m-%d") for r in rows})

    def block(subset):
        k = len(subset)
        return (k, pct(sum(r["helpful"] == 3 for r in subset), k),
                pct(sum(r["helpful"] >= 2 for r in subset), k),
                pct(sum(r["correct"] for r in subset), k))

    lines = [
        "# Sabi pilot: real-student validation",
        "",
        f"**{n} lessons finished** by students in supervised sessions on {', '.join(days)}.",
        "Feedback is anonymous: no names, device IDs or IP addresses are stored.",
        "",
        "## Headline",
        "",
        "| Measure | Result |",
        "|---|---|",
        f"| Said Sabi helped them understand (\"Yes!\") | **{pct(helpful[3], n)}** |",
        f"| Said it helped at least a bit | {pct(helpful[2] + helpful[3], n)} |",
        f"| Said it didn't really help | {pct(helpful[1], n)} |",
        f"| Lessons where the student chatted with Sabi | {pct(len(chatted), n)} ({len(chatted)}) |",
        f"| Of those, said Sabi **helped them think** rather than giving the answer | **{pct(guided, len(asked))}** ({guided} of {len(asked)}) |",
        f"| Answered correctly | {pct(sum(r['correct'] for r in rows), n)} |",
        f"| Correct on the first try, no hints | {pct(sum(r['first_try'] and r['hints'] == 0 for r in rows), n)} |",
        f"| Lessons with the live fine-tuned AI (vs offline hints) | {pct(sum(r['live_ai'] for r in rows), n)} |",
        "",
        "## By class level",
        "",
        "| Level | Lessons | Helped (\"Yes!\") | Helped at least a bit | Correct |",
        "|---|---|---|---|---|",
    ]
    by_level = defaultdict(list)
    for r in rows:
        by_level[r["level"]].append(r)
    for lvl in ("waec", "bece", "ncee", None):
        if by_level.get(lvl):
            k, yes, some, corr = block(by_level[lvl])
            lines.append(f"| {LEVEL_NAMES[lvl]} | {k} | {yes} | {some} | {corr} |")

    lines += ["", "## By subject", "", "| Subject | Lessons | Helped (\"Yes!\") | Correct |", "|---|---|---|---|"]
    by_subject = defaultdict(list)
    for r in rows:
        by_subject[r["subject"]].append(r)
    for subj, subset in sorted(by_subject.items()):
        k, yes, _, corr = block(subset)
        lines.append(f"| {subj} | {k} | {yes} | {corr} |")

    with_chat, without_chat = block(chatted), block([r for r in rows if r["chat_turns"] == 0])
    lines += [
        "",
        "## Did chatting with Sabi help?",
        "",
        "| | Lessons | Helped (\"Yes!\") | Correct |",
        "|---|---|---|---|",
        f"| Chatted with Sabi | {with_chat[0]} | {with_chat[1]} | {with_chat[3]} |",
        f"| Didn't chat | {without_chat[0]} | {without_chat[1]} | {without_chat[3]} |",
    ]
    comments = [r["comment"] for r in rows if r.get("comment") and r["comment"] != "[removed]"]
    if comments:
        lines += ["", "## Student comments", ""] + [f"- \"{c}\"" for c in comments[:20]]
    lines += [
        "",
        "## Caveats",
        "",
        "- A small, self-selected group in supervised sessions. These are early signals, not a controlled trial.",
        "- \"Helped\" is the student's own rating, not a measured learning gain.",
        "- Students who skipped the feedback question are not counted.",
    ]
    out = ROOT / args.out
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))
    print(f"\nWritten to {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
