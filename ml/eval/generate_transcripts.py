"""
Generate tutor transcripts for the held-out eval set from BOTH base N-ATLAS
and the fine-tuned Sabi adapter, on the GPU, in one pass. No API calls, judging is a separate step (judge_transcripts.py) so it can be resumed
across days without re-running the GPU work.

The base model and the fine-tuned model share one 4-bit copy of N-ATLAS in
memory: the LoRA adapter is switched off for "base" and on for "finetuned".

Each eval dialogue is replayed with its authored student turns as a scripted
student; the model writes every tutor turn. Dialogues are processed in
batches turn-by-turn (all dialogues' 1st tutor turn, then all 2nd, ...),
which is far faster on a T4 than one dialogue at a time.

Run (on the GPU box, after finetune_lora.py has produced an adapter):
    python ml/eval/generate_transcripts.py \
        --adapter ml/outputs/lora_run_1/final_adapter

Outputs:
    ml/outputs/transcripts_base.jsonl
    ml/outputs/transcripts_finetuned.jsonl
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from contextlib import nullcontext
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ml" / "src"))
from build_dataset import SYSTEM_PROMPT  # noqa: E402  same prompt the model was trained with


def load_jsonl(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate base + fine-tuned transcripts on the eval set")
    parser.add_argument("--config", default="ml/configs/lora_config.yaml")
    parser.add_argument("--adapter", default="ml/outputs/lora_run_1/final_adapter")
    parser.add_argument("--eval-file", default="ml/outputs/eval_holdout.jsonl")
    parser.add_argument("--models", default="finetuned,base", help="comma list: finetuned,base")
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--max-new-tokens", type=int, default=256)
    parser.add_argument("--limit", type=int, default=None, help="only the first N eval dialogues (smoke test)")
    args = parser.parse_args()

    import torch
    from peft import PeftModel
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig

    with open(ROOT / args.config, encoding="utf-8") as f:
        cfg = yaml.safe_load(f)
    base_model = cfg["model"]["base_model"]
    adapter_dir = ROOT / args.adapter
    if not adapter_dir.exists():
        raise SystemExit(f"Adapter not found: {adapter_dir}\nRun ml/src/finetune_lora.py first.")

    examples = load_jsonl(ROOT / args.eval_file)
    if args.limit:
        examples = examples[: args.limit]

    use_bf16 = torch.cuda.get_device_capability(0)[0] >= 8
    compute_dtype = torch.bfloat16 if use_bf16 else torch.float16

    tokenizer = AutoTokenizer.from_pretrained(base_model)
    tokenizer.padding_side = "left"  # required for batched generation
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    # device_map="auto", same as training: transformers 5.x materialises the
    # fp16 weights (~16 GB) before quantising, which overflows a single 15 GB
    # T4 if the whole model is pinned to one card.
    model = AutoModelForCausalLM.from_pretrained(
        base_model,
        quantization_config=BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_compute_dtype=compute_dtype,
            bnb_4bit_use_double_quant=True,
        ),
        device_map="auto",
    )
    model = PeftModel.from_pretrained(model, str(adapter_dir))
    model.eval()
    input_device = model.get_input_embeddings().weight.device

    stop_ids = [tokenizer.eos_token_id]
    eot = tokenizer.convert_tokens_to_ids("<|eot_id|>")
    if isinstance(eot, int) and eot != tokenizer.unk_token_id and eot not in stop_ids:
        stop_ids.append(eot)

    def generate(batch_msgs: list[list[dict]], use_adapter: bool) -> list[str]:
        texts = [
            tokenizer.apply_chat_template(m, tokenize=False, add_generation_prompt=True)
            for m in batch_msgs
        ]
        enc = tokenizer(texts, return_tensors="pt", padding=True, add_special_tokens=False).to(input_device)
        ctx = nullcontext() if use_adapter else model.disable_adapter()
        with torch.no_grad(), ctx:
            out = model.generate(
                **enc,
                max_new_tokens=args.max_new_tokens,
                do_sample=False,  # greedy: reproducible, fair across both models
                temperature=None,
                top_p=None,
                eos_token_id=stop_ids,
                pad_token_id=tokenizer.pad_token_id,
            )
        new_tokens = out[:, enc["input_ids"].shape[1]:]
        return [tokenizer.decode(t, skip_special_tokens=True).strip() for t in new_tokens]

    for which in [m.strip() for m in args.models.split(",") if m.strip()]:
        if which not in ("finetuned", "base"):
            raise SystemExit(f"Unknown model '{which}', use finetuned and/or base")
        use_adapter = which == "finetuned"
        print(f"\n=== Generating '{which}' transcripts for {len(examples)} dialogues ===")
        start = time.time()

        student_turns = {ex["id"]: [t["text"] for t in ex["turns"] if t["role"] == "student"] for ex in examples}
        histories = {ex["id"]: [{"role": "system", "content": SYSTEM_PROMPT}] for ex in examples}
        transcripts = {ex["id"]: [] for ex in examples}
        max_turns = max(len(v) for v in student_turns.values())

        for k in range(max_turns):
            active = [ex["id"] for ex in examples if len(student_turns[ex["id"]]) > k]
            for ex_id in active:
                text = student_turns[ex_id][k]
                histories[ex_id].append({"role": "user", "content": text})
                transcripts[ex_id].append({"role": "student", "text": text})
            for i in range(0, len(active), args.batch_size):
                chunk = active[i : i + args.batch_size]
                replies = generate([histories[ex_id] for ex_id in chunk], use_adapter)
                for ex_id, reply in zip(chunk, replies):
                    histories[ex_id].append({"role": "assistant", "content": reply})
                    transcripts[ex_id].append({"role": "tutor", "text": reply})
            print(f"  turn {k + 1}/{max_turns}: {len(active)} dialogues  ({time.time() - start:.0f}s elapsed)")

        out_path = ROOT / "ml" / "outputs" / f"transcripts_{which}.jsonl"
        with out_path.open("w", encoding="utf-8") as f:
            for ex in examples:
                f.write(json.dumps({
                    "id": ex["id"],
                    "subject": ex["subject"],
                    "escalated": bool(ex.get("escalated", False)),
                    "frustration_threshold": ex.get("frustration_threshold", 3),
                    "max_turns_to_resolution": ex.get("max_turns_to_resolution", 4),
                    "correct_understanding": ex["correct_understanding"],
                    "model": which,
                    "transcript": transcripts[ex["id"]],
                }, ensure_ascii=False) + "\n")
        print(f"Wrote {out_path}")

        sample = examples[0]["id"]
        print(f"\n--- sample ({which}, {sample}) ---")
        for t in transcripts[sample][:4]:
            print(f"{t['role'].upper()}: {t['text'][:300]}")


if __name__ == "__main__":
    main()
