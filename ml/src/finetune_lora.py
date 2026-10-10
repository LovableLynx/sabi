"""
LoRA fine-tune N-ATLAS (NCAIR1/N-ATLaS, Llama-3 8B base) on the Sabi
dialogue dataset.

Requires (not installed by default, see ml/requirements.txt):
    pip install -r ml/requirements.txt

Run (after ml/src/build_dataset.py has produced ml/outputs/train.jsonl):
    python ml/src/finetune_lora.py --config ml/configs/lora_config.yaml

This is a QLoRA setup (4-bit base model + LoRA adapters) so it's feasible on
a single consumer/cloud GPU (e.g. a 24GB card, or free-tier Colab/Kaggle T4
with reduced batch size) rather than requiring full 8B fine-tuning.

If you don't have local GPU access, this same script runs unmodified on:
  - Google Colab (T4/A100 runtime)
  - Kaggle notebooks (free GPU quota)
  - Any rented GPU box (RunPod, Lambda, Vast.ai) via the compute credits
    NAIC provides to shortlisted teams

NOTE ON HARDWARE: this script cannot be executed on the Windows CPU-only
environment this project was scaffolded in. Development happens here; the
actual training run happens wherever your team has GPU access. That's normal
for ML competition work, don't block on running this locally.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import yaml


def load_config(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)


def main() -> None:
    parser = argparse.ArgumentParser(description="LoRA fine-tune N-ATLAS on Sabi data")
    parser.add_argument("--config", default="ml/configs/lora_config.yaml")
    parser.add_argument("--dry-run", action="store_true", help="Validate config + data only, skip actual training")
    args = parser.parse_args()

    cfg = load_config(args.config)

    root = Path(__file__).resolve().parents[2]
    train_path = root / cfg["data"]["train_file"]
    if not train_path.exists():
        raise SystemExit(
            f"Training file not found: {train_path}\n"
            f"Run `python ml/src/build_dataset.py` first."
        )

    n_examples = sum(1 for _ in train_path.open(encoding="utf-8"))
    print(f"Training examples found: {n_examples}")
    if n_examples < 400:
        print(
            f"WARNING: only {n_examples} training examples. Target is ~480 "
            f"(600 total minus ~20% held out for eval). Fine-tuning quality "
            f"will suffer with too few examples, prioritise data authoring."
        )

    print(f"Base model: {cfg['model']['base_model']}")
    print(f"LoRA rank={cfg['lora']['r']}, alpha={cfg['lora']['alpha']}, "
          f"target_modules={cfg['lora']['target_modules']}")
    print(f"Epochs={cfg['training']['num_epochs']}, "
          f"lr={cfg['training']['learning_rate']}, "
          f"batch_size={cfg['training']['per_device_train_batch_size']} "
          f"x grad_accum={cfg['training']['gradient_accumulation_steps']}")

    if args.dry_run:
        print("\nDry run only, config and data validated, no training performed.")
        return

    # --- Actual training code (requires transformers/peft/bitsandbytes) ---
    # Imported lazily so `--dry-run` works without heavy deps installed.
    # Uses the plain transformers Trainer rather than TRL's SFTTrainer: TRL
    # 1.x patches the lm_head in a way that crashes on 4-bit + LoRA models.
    try:
        import torch
        from datasets import load_dataset
        from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
        from transformers import (
            AutoModelForCausalLM,
            AutoTokenizer,
            BitsAndBytesConfig,
            Trainer,
            TrainingArguments,
        )
    except ImportError as e:
        raise SystemExit(
            "Missing ML dependencies for actual training.\n"
            "Install with: pip install -r ml/requirements.txt\n"
            "(Use --dry-run to validate config/data without these installed.)\n"
            f"Original error: {e}"
        )

    # Native bf16 needs compute capability 8.0+ (Ampere). Kaggle's T4 is 7.5;
    # torch.cuda.is_bf16_supported() can still return True there via slow
    # emulation, so check the hardware generation directly.
    use_bf16 = torch.cuda.is_available() and torch.cuda.get_device_capability(0)[0] >= 8
    compute_dtype = torch.bfloat16 if use_bf16 else torch.float16
    print(f"GPU: {torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'none'} "
          f"-> using {'bf16' if use_bf16 else 'fp16'}")

    bnb_config = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=compute_dtype,
        bnb_4bit_use_double_quant=True,
    )

    tokenizer = AutoTokenizer.from_pretrained(cfg["model"]["base_model"])
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    model = AutoModelForCausalLM.from_pretrained(
        cfg["model"]["base_model"],
        quantization_config=bnb_config,
        device_map="auto",
    )
    model = prepare_model_for_kbit_training(model)

    lora_config = LoraConfig(
        r=cfg["lora"]["r"],
        lora_alpha=cfg["lora"]["alpha"],
        lora_dropout=cfg["lora"]["dropout"],
        target_modules=cfg["lora"]["target_modules"],
        bias="none",
        task_type="CAUSAL_LM",
    )
    model = get_peft_model(model, lora_config)
    model.print_trainable_parameters()

    model.config.use_cache = False  # incompatible with gradient checkpointing

    max_len = cfg["training"]["max_seq_length"]
    dataset = load_dataset("json", data_files=str(train_path), split="train")

    def tokenize_with_assistant_mask(example: dict) -> dict:
        """Tokenize the dialogue and compute loss ONLY on tutor (assistant)
        turns. Training on the student turns too would teach the model to
        imitate confused students, not to tutor.

        Renders the chat template one message at a time; the Llama-3 template
        is prefix-stable (each turn ends in <|eot_id|>), so the tokens each
        new message adds can be labelled by that message's role."""
        msgs = example["messages"]
        input_ids: list[int] = []
        labels: list[int] = []
        for i, msg in enumerate(msgs):
            text = tokenizer.apply_chat_template(msgs[: i + 1], tokenize=False)
            ids = tokenizer(text, add_special_tokens=False)["input_ids"]
            if ids[: len(input_ids)] != input_ids:
                prefix_mismatches.append(example.get("id", "?"))
            new_ids = ids[len(input_ids):]
            input_ids = ids
            labels += new_ids if msg["role"] == "assistant" else [-100] * len(new_ids)
        input_ids, labels = input_ids[:max_len], labels[:max_len]
        return {"input_ids": input_ids, "labels": labels, "attention_mask": [1] * len(input_ids)}

    prefix_mismatches: list[str] = []
    dataset = dataset.map(tokenize_with_assistant_mask, remove_columns=dataset.column_names)
    if prefix_mismatches:
        raise SystemExit(
            f"Chat template is not prefix-stable for {len(set(prefix_mismatches))} "
            f"examples (e.g. {sorted(set(prefix_mismatches))[:5]}), so tutor-only "
            f"loss masking would mislabel tokens. Stopping rather than training "
            f"on bad labels, report this so the masking can be adapted."
        )
    dataset = dataset.filter(lambda ex: any(l != -100 for l in ex["labels"]))
    lengths = [len(x) for x in dataset["input_ids"]]
    print(f"Tokenized {len(dataset)} examples; length min/avg/max = "
          f"{min(lengths)}/{sum(lengths) // len(lengths)}/{max(lengths)} tokens "
          f"(truncation limit {max_len})")

    def collate(batch: list[dict]) -> dict:
        width = max(len(ex["input_ids"]) for ex in batch)
        pad_id = tokenizer.pad_token_id

        def pad(seq: list[int], value: int) -> list[int]:
            return seq + [value] * (width - len(seq))

        return {
            "input_ids": torch.tensor([pad(ex["input_ids"], pad_id) for ex in batch]),
            "labels": torch.tensor([pad(ex["labels"], -100) for ex in batch]),
            "attention_mask": torch.tensor([pad(ex["attention_mask"], 0) for ex in batch]),
        }

    output_dir = root / cfg["training"]["output_dir"]
    output_dir.mkdir(parents=True, exist_ok=True)

    training_args = TrainingArguments(
        output_dir=str(output_dir),
        num_train_epochs=cfg["training"]["num_epochs"],
        per_device_train_batch_size=cfg["training"]["per_device_train_batch_size"],
        gradient_accumulation_steps=cfg["training"]["gradient_accumulation_steps"],
        learning_rate=cfg["training"]["learning_rate"],
        lr_scheduler_type="cosine",
        warmup_ratio=0.05,
        logging_steps=5,
        save_strategy="epoch",
        bf16=use_bf16,
        fp16=not use_bf16,
        gradient_checkpointing=True,
        report_to=[],
        remove_unused_columns=False,  # our collator needs the raw fields
    )

    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=dataset,
        data_collator=collate,
    )

    trainer.train()
    trainer.save_model(str(output_dir / "final_adapter"))
    tokenizer.save_pretrained(str(output_dir / "final_adapter"))
    print(f"\nTraining complete. LoRA adapter saved to {output_dir / 'final_adapter'}")
    print("Next: python ml/eval/generate_transcripts.py --adapter "
          f"{(output_dir / 'final_adapter').relative_to(root)}")


if __name__ == "__main__":
    main()
