"""
Always-available Sabi AI on Modal (serverless GPU).

Two services:
  tutor  GPU (L4). Wakes only when a student sends a chat message, and
         switches off after 5 idle minutes, so idle time costs nothing.
  api    tiny CPU service for leaderboard, pilot feedback and status checks,
         so opening the app or the leaderboard never wakes the GPU.
Modal's free Starter plan includes $30 of compute a month; with no card on
file it can't bill beyond that.

What it runs: the same ml/serve/serve_sabi.py as the Kaggle demo (model API +
leaderboard + pilot feedback), with the N-ATLaS weights cached in a Modal
Volume so the 16 GB download happens only once, and ml/outputs (leaderboard,
anonymous feedback) kept in a second Volume so it survives shutdowns.

One-time setup (from the repo root):
    pip install modal
    python -m modal token new             # browser login
    python -m modal secret create sabi-hf HF_TOKEN=<your Hugging Face read token>
    python ml/modal/upload_adapter.py     # copies the trained adapter into the volume
Deploy (prints two permanent URLs: ...-sabi-tutor.modal.run for the AI and
...-sabi-api.modal.run for leaderboard/feedback):
    python -m modal deploy ml/modal/sabi_modal.py
Then put both URLs in app/src/core/config.js and push.
Download the pilot feedback later:
    python -m modal volume get sabi-outputs feedback.jsonl ml/outputs/feedback.jsonl
"""
from __future__ import annotations

import subprocess
from pathlib import Path

import modal

REPO = Path(__file__).resolve().parents[2]
PORT = 8000
GPU = "T4"            # 16 GB, ~$0.59/hr. "L4" (24 GB, faster) needs a card on file at Modal
IDLE_SHUTDOWN = 300   # seconds without requests before the GPU switches off

app = modal.App("sabi")

weights = modal.Volume.from_name("sabi-weights", create_if_missing=True)   # HF cache + adapter
outputs = modal.Volume.from_name("sabi-outputs", create_if_missing=True)   # leaderboard + feedback

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "torch==2.5.1", "transformers>=4.46,<5", "peft>=0.13", "accelerate>=1.0",
        "bitsandbytes>=0.44", "pyyaml", "safetensors", "sentencepiece",
    )
    .env({"HF_HOME": "/weights/hf", "PYTHONUNBUFFERED": "1"})
    # Only the code the server needs: no data, no keys, no outputs.
    .add_local_dir(REPO / "app", "/sabi/app", ignore=["tools/**"])
    .add_local_dir(REPO / "ml" / "serve", "/sabi/ml/serve", ignore=["__pycache__/**"])
    .add_local_dir(REPO / "ml" / "src", "/sabi/ml/src", ignore=["__pycache__/**"])
    .add_local_dir(REPO / "ml" / "configs", "/sabi/ml/configs")
)

# The leaderboard/feedback service needs no torch: a tiny image starts in seconds.
api_image = (
    modal.Image.debian_slim(python_version="3.11")
    .env({"PYTHONUNBUFFERED": "1"})
    .add_local_dir(REPO / "app", "/sabi/app", ignore=["tools/**"])
    .add_local_dir(REPO / "ml" / "serve", "/sabi/ml/serve", ignore=["__pycache__/**"])
    .add_local_dir(REPO / "ml" / "src", "/sabi/ml/src", ignore=["__pycache__/**"])
)


# --- 1. The AI tutor (GPU). Only chat messages are sent here, so the GPU
#        wakes up only when a student actually asks Sabi something.
@app.function(
    image=image,
    gpu=GPU,
    volumes={"/weights": weights},
    secrets=[modal.Secret.from_name("sabi-hf")],
    scaledown_window=IDLE_SHUTDOWN,
    max_containers=1,          # one GPU at most: protects the free credit
    timeout=24 * 60 * 60,
)
@modal.concurrent(max_inputs=50)   # the server queues generations itself
@modal.web_server(PORT, startup_timeout=120)
def tutor():
    # Answers at once; the model loads in the background (--background-load)
    # and chats get "waking up" until it's ready (~1-2 min after a cold start).
    subprocess.Popen(
        [
            "python", "/sabi/ml/serve/serve_sabi.py",
            "--adapter", "/weights/adapter",
            "--host", "0.0.0.0", "--port", str(PORT),
            "--leaderboard-file", "/tmp/unused-leaderboard.json",
            "--background-load",
        ],
        cwd="/sabi",
    )


# --- 2. Leaderboard, feedback and status (cheap CPU, never touches the GPU).
@app.function(
    image=api_image,
    cpu=0.25,
    memory=512,
    volumes={"/outputs": outputs},
    scaledown_window=60,
    max_containers=1,          # one writer for the leaderboard/feedback files
    timeout=24 * 60 * 60,
)
@modal.concurrent(max_inputs=100)
@modal.web_server(PORT, startup_timeout=60)
def api():
    subprocess.Popen(
        [
            "python", "/sabi/ml/serve/serve_sabi.py", "--no-model",
            "--host", "0.0.0.0", "--port", str(PORT),
            "--leaderboard-file", "/outputs/leaderboard.json",
        ],
        cwd="/sabi",
    )
