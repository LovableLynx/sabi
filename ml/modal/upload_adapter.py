"""Copy the trained LoRA adapter (2 files) into the Modal "sabi-weights" volume.

Run once from the repo root, after `python -m modal token new`:
    python ml/modal/upload_adapter.py
"""
from pathlib import Path

import modal

REPO = Path(__file__).resolve().parents[2]
ADAPTER = REPO / "ml" / "outputs" / "lora_run_1" / "final_adapter"
FILES = ["adapter_config.json", "adapter_model.safetensors"]

missing = [f for f in FILES if not (ADAPTER / f).exists()]
if missing:
    raise SystemExit(f"Missing in {ADAPTER}: {missing}")

vol = modal.Volume.from_name("sabi-weights", create_if_missing=True)
with vol.batch_upload(force=True) as batch:
    for f in FILES:
        batch.put_file(str(ADAPTER / f), f"/adapter/{f}")
        print("uploaded", f)
print("Adapter is in the sabi-weights volume. Next: python -m modal deploy ml/modal/sabi_modal.py")
