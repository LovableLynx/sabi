"""
Run Sabi's GPU/long jobs on Kaggle from this laptop, using the Kaggle API
(~/.kaggle/kaggle.json). Nobody has to open the Kaggle website.

Jobs:
  single_turn   GPU: base vs. Sabi first replies on data/benchmark/*, then the
                deterministic score (ml/eval/score_single_turn.py)
  judge         CPU: Groq judging of the multi-turn transcripts, resumable

How it works:
  1. Bundles the code, data and job inputs (adapter, transcripts, judgements)
     into a PRIVATE Kaggle dataset, plus a tiny secrets.json with only the
     keys that job needs (read from gitignored ml/.hf_token / ml/.groq_key).
     Kaggle's saved notebook secrets are not available to API-started runs,
     which is why keys travel this way.
  2. Pushes a private notebook that unpacks the bundle and runs the job.
  3. Waits, downloads the outputs into ml/outputs/, and deletes the dataset
     (and with it the keys) once the run has finished.

Run:
    python ml/kaggle/run_job.py single_turn
    python ml/kaggle/run_job.py judge
"""
from __future__ import annotations

import argparse
import io
import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
from pathlib import Path

os.environ.setdefault("PYTHONUTF8", "1")
if sys.stdout.encoding is None or sys.stdout.encoding.lower() != "utf-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "ml" / "outputs"

JOBS = {
    "single_turn": {
        "gpu": True,
        "secrets": {"HF_TOKEN": "ml/.hf_token"},
        "inputs": ["ml/outputs/lora_run_1/final_adapter/adapter_model.safetensors",
                   "ml/outputs/lora_run_1/final_adapter/adapter_config.json"],
        "commands": [
            "python ml/eval/generate_single_turn.py --adapter ml/outputs/lora_run_1/final_adapter",
            "python ml/eval/score_single_turn.py",
        ],
        "fetch": r".*ml/outputs/(single_turn_.*)$",
    },
    "judge": {
        "gpu": False,
        "secrets": {"GROQ_API_KEY": "ml/.groq_key"},
        "inputs": ["ml/outputs/transcripts_base.jsonl", "ml/outputs/transcripts_finetuned.jsonl",
                   "ml/outputs/judgements.jsonl"],
        "commands": [
            "python ml/eval/judge_transcripts.py",
            "python ml/eval/compare_results.py ml/outputs/results_base.json ml/outputs/results_finetuned.json"
            " --out ml/outputs/comparison_report.md",
        ],
        "fetch": r".*ml/outputs/((judgements\.jsonl)|(results_.*\.json)|(comparison_report\.md))$",
    },
}

CODE_PATHS = ["data", "ml/src", "ml/eval", "ml/configs", "ml/requirements.txt"]

DRIVER = r'''
import glob, json, os, shutil, subprocess, sys, tarfile
work = "/kaggle/working/sabi"
os.makedirs(work, exist_ok=True)
tars = glob.glob("/kaggle/input/**/bundle.tar", recursive=True)
if tars:
    tarfile.open(tars[0]).extractall(work)
else:  # Kaggle may have unpacked the archive itself
    marker = glob.glob("/kaggle/input/**/ml/eval/judge_transcripts.py", recursive=True)[0]
    shutil.copytree(os.path.dirname(os.path.dirname(os.path.dirname(marker))), work, dirs_exist_ok=True)
secrets = json.load(open(glob.glob("/kaggle/input/**/secrets.json", recursive=True)[0]))
os.environ.update(secrets)  # kept in memory only, never written to /kaggle/working
os.chdir(work)
subprocess.run("pip install -q -r ml/requirements.txt", shell=True)
for cmd in COMMANDS:
    print("\n$ " + cmd, flush=True)
    code = subprocess.run(cmd, shell=True).returncode
    print(f"[exit code {code}]", flush=True)
'''


def kaggle(*args: str, check: bool = True) -> str:
    proc = subprocess.run([sys.executable, "-m", "kaggle", *args], capture_output=True, text=True,
                          encoding="utf-8", errors="replace", env={**os.environ, "PYTHONUTF8": "1"})
    out = (proc.stdout or "") + (proc.stderr or "")
    if check and proc.returncode != 0:
        raise SystemExit(f"kaggle {' '.join(args)} failed:\n{out}")
    return out


def username() -> str:
    cfg = json.loads((Path.home() / ".kaggle" / "kaggle.json").read_text())
    return cfg["username"]


def build_dataset_dir(job: str, spec: dict, tmp: Path) -> None:
    tmp.mkdir(parents=True, exist_ok=True)
    secrets = {}
    for env_name, rel in spec["secrets"].items():
        path = ROOT / rel
        if not path.exists() or not path.read_text(encoding="utf-8").strip():
            raise SystemExit(f"Missing {rel}. Paste the key alone into that file (it is gitignored).")
        secrets[env_name] = path.read_text(encoding="utf-8").strip()
    for rel in spec["inputs"]:
        if not (ROOT / rel).exists():
            raise SystemExit(f"Missing job input {rel}.")

    with tarfile.open(tmp / "bundle.tar", "w") as tar:
        for rel in CODE_PATHS + spec["inputs"]:
            tar.add(ROOT / rel, arcname=rel)
    (tmp / "secrets.json").write_text(json.dumps(secrets), encoding="utf-8")
    (tmp / "dataset-metadata.json").write_text(json.dumps({
        "title": f"sabi-job-{job.replace('_', '-')}",
        "id": f"{username()}/sabi-job-{job.replace('_', '-')}",
        "licenses": [{"name": "other"}],
    }), encoding="utf-8")


def push_kernel(job: str, spec: dict, tmp: Path) -> str:
    user = username()
    slug = f"{user}/sabi-{job.replace('_', '-')}-job"
    nb = {
        "cells": [{"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [],
                   "source": f"COMMANDS = {json.dumps(spec['commands'])}\n" + DRIVER}],
        "metadata": {"kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"}},
        "nbformat": 4, "nbformat_minor": 4,
    }
    (tmp / "job.ipynb").write_text(json.dumps(nb), encoding="utf-8")
    (tmp / "kernel-metadata.json").write_text(json.dumps({
        "id": slug, "title": f"sabi-{job.replace('_', '-')}-job", "code_file": "job.ipynb",
        "language": "python", "kernel_type": "notebook", "is_private": True,
        "enable_gpu": spec["gpu"], "enable_internet": True,
        "machine_shape": "NvidiaTeslaT4" if spec["gpu"] else "",
        "dataset_sources": [f"{user}/sabi-job-{job.replace('_', '-')}"],
        "competition_sources": [], "kernel_sources": [], "model_sources": [],
    }), encoding="utf-8")
    print(kaggle("kernels", "push", "-p", str(tmp)).strip())
    return slug


def wait(slug: str, poll: int = 60) -> str:
    while True:
        status = kaggle("kernels", "status", slug, check=False).strip().splitlines()[-1]
        print(time.strftime("%H:%M"), status, flush=True)
        if any(s in status.lower() for s in ("complete", "error", "cancel")):
            return status
        time.sleep(poll)


def fetch(slug: str, pattern: str) -> list[Path]:
    from kaggle.api.kaggle_api_extended import KaggleApi

    api = KaggleApi()
    api.authenticate()
    dest = Path(tempfile.mkdtemp(prefix="sabi_job_out_"))
    files, token = [], None
    while True:
        got, token = api.kernels_output(slug, str(dest), force=True, quiet=True, page_token=token, page_size=100)
        files += got
        if not token:
            break
    import re
    copied = []
    OUT.mkdir(parents=True, exist_ok=True)
    for f in map(Path, files):
        posix = f.as_posix()
        if re.match(pattern, posix):
            target = OUT / f.name
            shutil.copy(f, target)
            copied.append(target)
        elif f.suffix == ".log":
            log = json.loads(f.read_text(encoding="utf-8"))
            text = "".join(e["data"] for e in log if e.get("stream_name") == "stdout")
            (OUT / f"kaggle_{slug.split('/')[-1]}.log.txt").write_text(text, encoding="utf-8")
            print("\n--- job output (last 40 lines) ---\n" + "\n".join(text.splitlines()[-40:]))
    return copied


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("job", choices=JOBS)
    parser.add_argument("--keep-dataset", action="store_true", help="don't delete the private input dataset afterwards")
    args = parser.parse_args()
    spec = JOBS[args.job]
    dataset = f"{username()}/sabi-job-{args.job.replace('_', '-')}"

    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        build_dataset_dir(args.job, spec, tmp / "dataset")
        listing = kaggle("datasets", "list", "--mine", "--csv", check=False)
        exists = any(line.split(",")[0].strip() == dataset for line in listing.splitlines())
        if exists:
            print(kaggle("datasets", "version", "-p", str(tmp / "dataset"), "-m", "job inputs", "-q").strip())
        else:
            print(kaggle("datasets", "create", "-p", str(tmp / "dataset"), "-q").strip())
        print("Waiting for the dataset to finish processing...")
        for _ in range(60):
            if "ready" in kaggle("datasets", "status", dataset, check=False).lower():
                break
            time.sleep(10)
        (tmp / "kernel").mkdir()
        slug = push_kernel(args.job, spec, tmp / "kernel")

    try:
        status = wait(slug)
        copied = fetch(slug, spec["fetch"])
        print("\nStatus:", status)
        for c in copied:
            print("  saved", c.relative_to(ROOT))
    finally:
        if not args.keep_dataset:
            print(kaggle("datasets", "delete", dataset, "--yes", check=False).strip() or f"deleted {dataset}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
