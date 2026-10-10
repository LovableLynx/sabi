"""
One-cell live demo launcher for a Kaggle GPU notebook.

Starts serve_sabi.py in the background, waits for the model to load, then
opens a free Cloudflare quick tunnel (no account needed) and prints the
public https://...trycloudflare.com link to the chat app.

In a Kaggle notebook (interactive session, GPU on, Internet on), after
cloning the repo and installing ml/requirements.txt:

    %run ml/serve/kaggle_launch.py

Use %run (not !python) so the server and tunnel stay attached to the
notebook kernel. They stop when the Kaggle session stops. The link is
public but random and temporary, fine for a demo, don't post it widely.
"""
from __future__ import annotations

import glob
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PORT = 8000
CLOUDFLARED = ROOT / "cloudflared"
CLOUDFLARED_URL = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64"


def find_adapter() -> str:
    local = ROOT / "ml" / "outputs" / "lora_run_1" / "final_adapter"
    if (local / "adapter_config.json").exists():
        return str(local)
    # Any attached Input that holds an adapter: the training notebook's output
    # (.../final_adapter) or a "sabi-adapter" dataset with the two files at its top.
    configs = sorted(glob.glob("/kaggle/input/**/adapter_config.json", recursive=True))
    configs = [c for c in configs if Path(c).with_name("adapter_model.safetensors").exists()]
    if not configs:
        raise SystemExit(
            "No trained adapter found. Attach it as an Input: either the training "
            "notebook's output (Add Input -> Your Work) or the sabi-adapter dataset "
            "(Add Input -> Datasets). It must contain adapter_config.json and "
            "adapter_model.safetensors."
        )
    return str(Path(configs[0]).parent)


def wait_for_log(path: Path, pattern: str, timeout: int, proc: subprocess.Popen) -> re.Match:
    start = time.time()
    while time.time() - start < timeout:
        if proc.poll() is not None:
            raise SystemExit(f"Process exited early. Last log lines:\n{path.read_text()[-2000:]}")
        match = re.search(pattern, path.read_text(errors="replace")) if path.exists() else None
        if match:
            return match
        time.sleep(3)
    raise SystemExit(f"Timed out after {timeout}s waiting for {pattern!r} in {path}")


adapter = find_adapter()
print(f"Adapter: {adapter}")

server_log = ROOT / "server.log"
server = subprocess.Popen(
    [sys.executable, str(ROOT / "ml" / "serve" / "serve_sabi.py"), "--adapter", adapter, "--port", str(PORT)],
    cwd=ROOT,
    stdout=server_log.open("w"),
    stderr=subprocess.STDOUT,
)
print("Loading N-ATLAS + Sabi adapter (first time includes a ~16 GB download, 2-5 min)...")
wait_for_log(server_log, r"Serving Sabi", timeout=1200, proc=server)
with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/api/health", timeout=10) as r:
    print("Server up:", r.read().decode())

if not CLOUDFLARED.exists():
    urllib.request.urlretrieve(CLOUDFLARED_URL, CLOUDFLARED)
    CLOUDFLARED.chmod(0o755)

tunnel_log = ROOT / "tunnel.log"
tunnel = subprocess.Popen(
    [str(CLOUDFLARED), "tunnel", "--no-autoupdate", "--url", f"http://127.0.0.1:{PORT}"],
    stdout=tunnel_log.open("w"),
    stderr=subprocess.STDOUT,
)
url = wait_for_log(tunnel_log, r"https://[a-z0-9-]+\.trycloudflare\.com", timeout=120, proc=tunnel).group(0)

print("\n" + "=" * 60)
print(f"  Sabi live demo:  {url}")
print("=" * 60)
print("Open it on your laptop or phone. Keep this Kaggle tab open:")
print("the demo stops when the notebook session stops.")
print("Server log: server.log   Tunnel log: tunnel.log")
