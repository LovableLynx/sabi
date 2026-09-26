"""
LoRA fine-tune N-ATLAS (NCAIR1/N-ATLaS, Llama-3 8B base) on the Sabi
dialogue dataset.

Requires (not installed by default — see ml/requirements.txt):
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
for ML competition work — don't block on running this locally.
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
            f"will suffer with too few examples — prioritise data authoring."
        )

    print(f"Base model: {cfg['model']['base_model']}")
    print(f"LoRA rank={cfg['lora']['r']}, alpha={cfg['lora']['alpha']}, "
          f"target_modules={cfg['lora']['target_modules']}")
    print(f"Epochs={cfg['training']['num_epochs']}, "
          f"lr={cfg['training']['learning_rate']}, "
          f"batch_size={cfg['training']['per_device_train_batch_size']} "
          f"x grad_accum={cfg['training']['gradient_accumulation_steps']}")

    if args.dry_run:
        print("\nDry run only — config and data validated, no training performed.")
        return

    # --- Actual training code (requires transformers/peft/bitsandbytes/trl) ---
    # Imported lazily so `--dry-run` works without heavy deps installed.
    try:
        import torch
        from datasets import load_dataset
        from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
        from transformers import (
            AutoModelForCausalLM,
            AutoTokenizer,
            BitsAndBytesConfig,
            TrainingArguments,
        )
        from trl import SFTConfig, SFTTrainer
    except ImportError as e:
        raise SystemExit(
            "Missing ML dependencies for actual training.\n"
            "Install with: pip install -r ml/requirements.txt\n"
            "(Use --dry-run to validate config/data without these installed.)\n"
            f"Original error: {e}"
        )

    # Kaggle's T4 (Turing) has no bf16 support; fall back to fp16 there.
    use_bf16 = torch.cuda.is_available() and torch.cuda.is_bf16_supported()
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

    dataset = load_dataset("json", data_files=str(train_path), split="train")

    def format_chat(example: dict) -> dict:
        text = tokenizer.apply_chat_template(example["messages"], tokenize=False)
        return {"text": text}

    # Keep only the rendered text so TRL doesn't also try to treat the
    # "messages" column as a conversational dataset.
    dataset = dataset.map(format_chat, remove_columns=dataset.column_names)

    output_dir = root / cfg["training"]["output_dir"]
    output_dir.mkdir(parents=True, exist_ok=True)

    # TRL renamed max_seq_length -> max_length and tokenizer -> processing_class
    # across versions; pick whichever the installed version accepts.
    import inspect
    sft_params = inspect.signature(SFTConfig.__init__).parameters
    seq_len_key = "max_length" if "max_length" in sft_params else "max_seq_length"

    sft_config = SFTConfig(
        output_dir=str(output_dir),
        num_train_epochs=cfg["training"]["num_epochs"],
        per_device_train_batch_size=cfg["training"]["per_device_train_batch_size"],
        gradient_accumulation_steps=cfg["training"]["gradient_accumulation_steps"],
        learning_rate=cfg["training"]["learning_rate"],
        logging_steps=10,
        save_strategy="epoch",
        bf16=use_bf16,
        fp16=not use_bf16,
        report_to=[],
        dataset_text_field="text",
        **{seq_len_key: cfg["training"]["max_seq_length"]},
    )

    trainer_params = inspect.signature(SFTTrainer.__init__).parameters
    tok_key = "processing_class" if "processing_class" in trainer_params else "tokenizer"

    trainer = SFTTrainer(
        model=model,
        args=sft_config,
        train_dataset=dataset,
        **{tok_key: tokenizer},
    )

    trainer.train()
    trainer.save_model(str(output_dir / "final_adapter"))
    print(f"\nTraining complete. LoRA adapter saved to {output_dir / 'final_adapter'}")
    print("Next: run ml/eval/benchmark.py comparing base vs. fine-tuned model.")


if __name__ == "__main__":
    main()
