"""
Convert validated dialogue JSON into fine-tuning-ready chat-format examples,
with a held-out eval split that the fine-tuning script never sees.

Run:
    python ml/src/build_dataset.py

Outputs (ml/outputs/):
    train.jsonl        - training examples (chat-format, multi-turn)
    eval_holdout.jsonl - held-out examples used ONLY by ml/eval/benchmark.py
    split_manifest.json - which ids went where, for reproducibility

Split strategy: stratified per-subject, per-escalated-flag, so the eval set
has proportional representation of escalation examples in each subject
(escalation behavior is a distinct axis we benchmark — see benchmark.py).
"""
from __future__ import annotations

import json
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data"
OUT_DIR = ROOT / "ml" / "outputs"
OUT_DIR.mkdir(parents=True, exist_ok=True)

SUBJECT_FILES = {
    "literature": DATA_DIR / "arts_literature" / "arts_literature.json",
    "physics": DATA_DIR / "science_physics" / "science_physics.json",
    "accounting": DATA_DIR / "commerce_accounting" / "commerce_accounting.json",
}

EVAL_FRACTION = 0.20  # ~20% held out per subject, stratified by 'escalated'
SEED = 42

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


def load_all() -> dict[str, list[dict]]:
    out = {}
    for subject, path in SUBJECT_FILES.items():
        with path.open(encoding="utf-8") as f:
            payload = json.load(f)
        out[subject] = payload.get("examples", [])
    return out


def stratified_split(examples: list[dict], eval_fraction: float, rng: random.Random) -> tuple[list[dict], list[dict]]:
    escalated = [e for e in examples if e.get("escalated")]
    normal = [e for e in examples if not e.get("escalated")]

    def split_group(group: list[dict]) -> tuple[list[dict], list[dict]]:
        group = group[:]
        rng.shuffle(group)
        n_eval = max(1, round(len(group) * eval_fraction)) if group else 0
        return group[n_eval:], group[:n_eval]

    train_e, eval_e = split_group(escalated)
    train_n, eval_n = split_group(normal)
    return train_e + train_n, eval_e + eval_n


def example_to_chat(ex: dict) -> dict:
    """Convert one dialogue example into a chat-format training record.
    Uses the standard {"messages": [...]} shape compatible with most
    SFT/LoRA trainers (e.g. TRL's SFTTrainer, axolotl, HF chat templates)."""
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    for turn in ex["turns"]:
        role = "user" if turn["role"] == "student" else "assistant"
        messages.append({"role": role, "content": turn["text"]})
    return {
        "id": ex["id"],
        "subject": ex["subject"],
        "topic": ex.get("topic"),
        "escalated": bool(ex.get("escalated", False)),
        "messages": messages,
    }


def write_jsonl(path: Path, records: list[dict]) -> None:
    with path.open("w", encoding="utf-8") as f:
        for r in records:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")


def main() -> None:
    rng = random.Random(SEED)
    all_examples = load_all()

    train_records: list[dict] = []
    eval_records: list[dict] = []
    manifest = {"seed": SEED, "eval_fraction": EVAL_FRACTION, "subjects": {}}

    for subject, examples in all_examples.items():
        if not examples:
            print(f"WARNING: no examples found for subject '{subject}' — skipping.")
            continue
        train, held_out = stratified_split(examples, EVAL_FRACTION, rng)

        manifest["subjects"][subject] = {
            "total": len(examples),
            "train": len(train),
            "eval_holdout": len(held_out),
            "eval_ids": [e["id"] for e in held_out],
        }

        train_records.extend(example_to_chat(e) for e in train)
        # Eval records keep the FULL original example (not just chat format)
        # because the benchmark harness needs correct_understanding,
        # frustration_threshold, escalated, etc. — not just the message list.
        eval_records.extend(held_out)

    write_jsonl(OUT_DIR / "train.jsonl", train_records)
    write_jsonl(OUT_DIR / "eval_holdout.jsonl", eval_records)
    with (OUT_DIR / "split_manifest.json").open("w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)

    if len(train_records) == 0:
        print(
            "\nWARNING: 0 training examples were produced. This happens when a "
            "subject has too few examples for the 20% eval split to leave any "
            "training data (e.g. 1-2 examples). This is expected with today's "
            "placeholder data and will resolve once real authoring volume "
            "(~200/subject) lands. Do NOT run finetune_lora.py against an "
            "empty train.jsonl.\n"
        )

    print(f"Wrote {len(train_records)} training examples -> {OUT_DIR / 'train.jsonl'}")
    print(f"Wrote {len(eval_records)} held-out eval examples -> {OUT_DIR / 'eval_holdout.jsonl'}")
    print(f"Manifest -> {OUT_DIR / 'split_manifest.json'}")
    for subject, info in manifest["subjects"].items():
        print(f"  {subject:12s}: {info['total']:3d} total -> {info['train']:3d} train / {info['eval_holdout']:3d} eval")


if __name__ == "__main__":
    main()
