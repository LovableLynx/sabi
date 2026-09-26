"""
Validate and merge the three subject dialogue datasets against the schema in
data/schema/dialogue_schema.md before they ever reach the fine-tuning script.

Run:
    python ml/src/data_validate.py

Exits non-zero with a full error report if anything is malformed — run this
after every batch of new examples lands from a subject-owner, not just once
at the end. Bad data caught here is cheap; bad data caught after a fine-tune
run is a wasted GPU-hour.
"""
from __future__ import annotations

import io
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

# Force UTF-8 stdout: Windows consoles often default to a legacy codepage
# that cannot encode characters used in this script's labels/output.
if sys.stdout.encoding is None or sys.stdout.encoding.lower() != "utf-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data"

SUBJECT_FILES = {
    "literature": DATA_DIR / "arts_literature" / "arts_literature.json",
    "physics": DATA_DIR / "science_physics" / "science_physics.json",
    "accounting": DATA_DIR / "commerce_accounting" / "commerce_accounting.json",
}

ID_PREFIX = {"literature": "lit-", "physics": "phy-", "accounting": "acc-"}

REQUIRED_FIELDS = [
    "id", "subject", "topic", "source", "difficulty",
    "student_opening", "misconception", "turns",
    "correct_understanding", "max_turns_to_resolution",
    "frustration_threshold", "notation_check",
]

VALID_TECHNIQUES = {
    "cultural_analogy_probe", "guided_transfer", "extend_to_effect",
    "narrowing", "escalated_hint", "worked_example",
}

# Physics notation guardrails — flag likely-mangled equations early.
PHYSICS_BAD_PATTERNS = [
    (re.compile(r"\d[a-zA-Z]{2,}(?!\()"), "possible missing '*' between number and variables (e.g. use 2*a*s not 2as)"),
    (re.compile(r"[a-zA-Z]\d(?!\^| |,|\)|\.|$)"), "possible missing space/operator after a variable+digit"),
]

# Accounting: every table block must have exactly these 4 columns in order.
ACCOUNTING_HEADER = "| Date | Account | Debit (₦) | Credit (₦) |"


@dataclass
class ValidationReport:
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def error(self, msg: str) -> None:
        self.errors.append(msg)

    def warn(self, msg: str) -> None:
        self.warnings.append(msg)

    @property
    def ok(self) -> bool:
        return not self.errors


def load_subject(subject: str) -> list[dict]:
    path = SUBJECT_FILES[subject]
    if not path.exists():
        raise FileNotFoundError(f"Missing data file for {subject}: {path}")
    with path.open(encoding="utf-8") as f:
        payload = json.load(f)
    return payload.get("examples", [])


def validate_example(ex: dict, subject: str, seen_ids: set[str], report: ValidationReport) -> None:
    prefix = ID_PREFIX[subject]

    for field_name in REQUIRED_FIELDS:
        if field_name not in ex:
            report.error(f"[{ex.get('id', '?')}] missing required field '{field_name}'")

    ex_id = ex.get("id", "")
    if ex_id:
        if not ex_id.startswith(prefix):
            report.error(f"[{ex_id}] id must start with '{prefix}' for subject {subject}")
        if ex_id in seen_ids:
            report.error(f"[{ex_id}] duplicate id")
        seen_ids.add(ex_id)

    if ex.get("subject") != subject:
        report.error(f"[{ex_id}] subject field '{ex.get('subject')}' does not match file ({subject})")

    turns = ex.get("turns", [])
    if not turns:
        report.error(f"[{ex_id}] has no turns")
    else:
        if turns[0].get("role") != "student":
            report.error(f"[{ex_id}] must start on a student turn")
        if turns[-1].get("role") != "tutor":
            report.error(f"[{ex_id}] must end on a tutor turn")
        expected_role = "student"
        for i, t in enumerate(turns):
            if t.get("role") != expected_role:
                report.error(f"[{ex_id}] turn {i} expected role '{expected_role}', got '{t.get('role')}'")
            expected_role = "tutor" if expected_role == "student" else "student"
            if "text" not in t or not t["text"].strip():
                report.error(f"[{ex_id}] turn {i} missing/empty text")
            tech = t.get("technique")
            if t.get("role") == "tutor" and tech and tech not in VALID_TECHNIQUES:
                report.warn(f"[{ex_id}] turn {i} unrecognised technique '{tech}'")

        answer_leak_check(ex, turns, report)

    threshold = ex.get("frustration_threshold")
    if isinstance(threshold, int):
        tutor_turns_before_escalation = [
            t for t in turns if t.get("role") == "tutor" and t.get("technique") not in ("escalated_hint", "worked_example")
        ]
        if ex.get("escalated") and len(tutor_turns_before_escalation) > threshold + 1:
            report.warn(
                f"[{ex_id}] marked escalated but has {len(tutor_turns_before_escalation)} "
                f"non-escalation tutor turns vs frustration_threshold={threshold} — check pacing"
            )

    if ex.get("escalated"):
        techniques = [t.get("technique") for t in turns if t.get("role") == "tutor"]
        if "escalated_hint" not in techniques and "worked_example" not in techniques:
            report.error(f"[{ex_id}] marked escalated=true but no tutor turn uses 'escalated_hint' or 'worked_example'")

    if ex.get("notation_check") not in ("n/a", "reviewed"):
        report.warn(f"[{ex_id}] notation_check is '{ex.get('notation_check')}', expected 'reviewed' or 'n/a'")

    if subject == "physics":
        validate_physics_notation(ex, turns, report)
    elif subject == "accounting":
        validate_accounting_notation(ex, turns, report)


def answer_leak_check(ex: dict, turns: list[dict], report: ValidationReport) -> None:
    """Heuristic: warn if a non-final, non-escalation tutor turn looks like it
    just states the answer outright. This is a heuristic, not proof — human
    review still matters — but catches the most obvious accidental leaks."""
    correct = (ex.get("correct_understanding") or "").lower()
    if len(correct) < 12:
        return
    key_phrase = correct[:40]
    for i, t in enumerate(turns[:-1]):
        if t.get("role") != "tutor":
            continue
        if t.get("technique") in ("escalated_hint", "worked_example"):
            continue
        if key_phrase and key_phrase in t.get("text", "").lower():
            report.warn(
                f"[{ex.get('id')}] turn {i} may be leaking the answer early "
                f"(overlaps strongly with correct_understanding) — please review manually"
            )


def validate_physics_notation(ex: dict, turns: list[dict], report: ValidationReport) -> None:
    for i, t in enumerate(turns):
        text = t.get("text", "")
        if "$" not in text:
            continue
        for pattern, msg in PHYSICS_BAD_PATTERNS:
            if pattern.search(text):
                report.warn(f"[{ex.get('id')}] turn {i}: {msg} — text: {text[:60]!r}")


def validate_accounting_notation(ex: dict, turns: list[dict], report: ValidationReport) -> None:
    for i, t in enumerate(turns):
        text = t.get("text", "")
        if "|" not in text:
            continue
        if "Debit" in text or "Credit" in text:
            if ACCOUNTING_HEADER not in text:
                report.error(
                    f"[{ex.get('id')}] turn {i} has a ledger table but header does not "
                    f"exactly match required format:\n  expected: {ACCOUNTING_HEADER}"
                )


def main() -> int:
    overall = ValidationReport()
    total = 0
    per_subject_counts: dict[str, int] = {}
    per_subject_escalated: dict[str, int] = {}

    for subject in SUBJECT_FILES:
        try:
            examples = load_subject(subject)
        except FileNotFoundError as e:
            overall.error(str(e))
            continue

        seen_ids: set[str] = set()
        for ex in examples:
            validate_example(ex, subject, seen_ids, overall)

        per_subject_counts[subject] = len(examples)
        per_subject_escalated[subject] = sum(1 for e in examples if e.get("escalated"))
        total += len(examples)

    print("=== Sabi dataset validation ===")
    for subject, count in per_subject_counts.items():
        esc = per_subject_escalated.get(subject, 0)
        pct = (esc / count * 100) if count else 0
        print(f"  {subject:12s}: {count:4d} examples  ({esc} escalated, {pct:.0f}%)")
    print(f"  {'TOTAL':12s}: {total:4d} examples")
    print(f"  target: 600 total, ~200/subject, ~20% escalated per subject\n")

    if overall.warnings:
        print(f"--- {len(overall.warnings)} warning(s) ---")
        for w in overall.warnings:
            print(f"  WARN  {w}")
        print()

    if overall.errors:
        print(f"--- {len(overall.errors)} error(s) ---")
        for e in overall.errors:
            print(f"  ERROR {e}")
        print("\nFAILED: fix errors above before fine-tuning.")
        return 1

    print("PASSED: no schema errors found.")
    if total < 600:
        print(f"NOTE: {600 - total} more examples needed to hit the 600 target.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
