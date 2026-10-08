"""
Single-turn benchmark generation: for every held-out question in
data/benchmark/single_turn_*.json, record the FIRST reply from base N-ATLAS
(adapter off) and from Sabi (adapter on). Runs on a GPU.

Scored afterwards, without any LLM, by ml/eval/score_single_turn.py.

Run:
    python ml/eval/generate_single_turn.py --adapter ml/outputs/lora_run_1/final_adapter
Output:
    ml/outputs/single_turn_replies.jsonl   (one line per question per model)
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


def load_questions() -> list[dict]:
    items = []
    for path in sorted((ROOT / "data" / "benchmark").glob("single_turn_*.json")):
        items += json.loads(path.read_text(encoding="utf-8"))
    return items


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default="ml/configs/lora_config.yaml")
    parser.add_argument("--adapter", default="ml/outputs/lora_run_1/final_adapter")
    parser.add_argument("--batch-size", type=int, default=12)
    parser.add_argument("--max-new-tokens", type=int, default=200)
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args()

    import torch
    from peft import PeftModel
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig

    cfg = yaml.safe_load((ROOT / args.config).read_text(encoding="utf-8"))
    base_model = cfg["model"]["base_model"]
    adapter_dir = Path(args.adapter)
    if not adapter_dir.is_absolute():
        adapter_dir = ROOT / adapter_dir

    questions = load_questions()[: args.limit] if args.limit else load_questions()
    print(f"{len(questions)} benchmark questions")

    use_bf16 = torch.cuda.get_device_capability(0)[0] >= 8
    tokenizer = AutoTokenizer.from_pretrained(base_model)
    tokenizer.padding_side = "left"
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    model = AutoModelForCausalLM.from_pretrained(
        base_model,
        quantization_config=BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_compute_dtype=torch.bfloat16 if use_bf16 else torch.float16,
            bnb_4bit_use_double_quant=True,
        ),
        device_map="auto",  # see generate_transcripts.py: one T4 can't hold the fp16 load
    )
    model = PeftModel.from_pretrained(model, str(adapter_dir))
    model.eval()
    device = model.get_input_embeddings().weight.device

    stop_ids = [tokenizer.eos_token_id]
    eot = tokenizer.convert_tokens_to_ids("<|eot_id|>")
    if isinstance(eot, int) and eot != tokenizer.unk_token_id and eot not in stop_ids:
        stop_ids.append(eot)

    out_path = ROOT / "ml" / "outputs" / "single_turn_replies.jsonl"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    start = time.time()
    with out_path.open("w", encoding="utf-8") as out:
        for model_name, use_adapter in (("finetuned", True), ("base", False)):
            for i in range(0, len(questions), args.batch_size):
                batch = questions[i : i + args.batch_size]
                texts = [
                    tokenizer.apply_chat_template(
                        [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": q["student_message"]}],
                        tokenize=False,
                        add_generation_prompt=True,
                    )
                    for q in batch
                ]
                enc = tokenizer(texts, return_tensors="pt", padding=True, add_special_tokens=False).to(device)
                ctx = nullcontext() if use_adapter else model.disable_adapter()
                with torch.no_grad(), ctx:
                    gen = model.generate(
                        **enc,
                        max_new_tokens=args.max_new_tokens,
                        do_sample=False,
                        temperature=None,
                        top_p=None,
                        eos_token_id=stop_ids,
                        pad_token_id=tokenizer.pad_token_id,
                    )
                new = gen[:, enc["input_ids"].shape[1]:]
                for q, toks in zip(batch, new):
                    out.write(json.dumps({
                        "id": q["id"], "subject": q["subject"], "topic": q["topic"], "model": model_name,
                        "reply": tokenizer.decode(toks, skip_special_tokens=True).strip(),
                    }, ensure_ascii=False) + "\n")
                out.flush()
                print(f"  {model_name}: {min(i + args.batch_size, len(questions))}/{len(questions)}  ({time.time() - start:.0f}s)", flush=True)
    print(f"Wrote {out_path}")


if __name__ == "__main__":
    main()
