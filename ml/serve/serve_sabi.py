"""
Serve the Sabi chat app AND a chat API from one process, so a single URL
gives a working live demo.

    GET  /              -> app/index.html (and the app's static files)
    GET  /api/health    -> {"status": "ok", "mode": "model"|"mock", ...}
    POST /api/chat      -> {"messages": [{"role": "user"|"assistant", "content": ...}],
                            "model": "sabi" | "base" | "both"}
                        <- {"reply": "...", "base_reply": "..." (when model == "both")}
    GET  /api/leaderboard -> {"players": [{id, nickname, avatar, state, school, xp}, ...]}
    POST /api/score     -> {id, nickname, avatar, state, school, xp}  (upsert one player)

"sabi" = N-ATLAS with the fine-tuned LoRA adapter switched on.
"base" = the same weights with the adapter switched off (original N-ATLAS).
"both" = both, for the side-by-side comparison view in the app.

Run on a GPU (Kaggle) — see ml/serve/kaggle_launch.py for the one-cell
launcher that also opens a public tunnel:
    python ml/serve/serve_sabi.py --adapter ml/outputs/lora_run_1/final_adapter

Run WITHOUT a GPU to test the app end to end with canned replies:
    python ml/serve/serve_sabi.py --mock
"""
from __future__ import annotations

import argparse
import json
import mimetypes
import sys
import threading
import time
from contextlib import nullcontext
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
APP_DIR = ROOT / "app"
sys.path.insert(0, str(ROOT / "ml" / "src"))
from build_dataset import SYSTEM_PROMPT  # noqa: E402  same prompt the model was trained with

MAX_HISTORY_MESSAGES = 16  # keep prompts well inside N-ATLAS's 8k context

NIGERIAN_STATES = {
    "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno",
    "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu", "FCT Abuja", "Gombe",
    "Imo", "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Kogi", "Kwara", "Lagos",
    "Nasarawa", "Niger", "Ogun", "Ondo", "Osun", "Oyo", "Plateau", "Rivers", "Sokoto",
    "Taraba", "Yobe", "Zamfara",
}


class MockTutor:
    """Canned replies so the app and API can be tested without a GPU."""

    mode = "mock"
    info = "mock replies (no model loaded)"

    def reply(self, messages: list[dict], use_adapter: bool) -> str:
        time.sleep(0.6)
        if not use_adapter:
            return "[mock base N-ATLAS] Here is the answer directly: ..."
        turn = sum(1 for m in messages if m["role"] == "assistant") + 1
        return (
            f"[mock Sabi, turn {turn}] Before I answer — think of an okada braking "
            f"at a checkpoint. What is its speed once it has fully stopped?"
        )


class ModelTutor:
    """N-ATLAS in 4-bit with the Sabi LoRA adapter, toggled per request."""

    mode = "model"

    def __init__(self, base_model: str, adapter_dir: Path, max_new_tokens: int):
        import torch
        from peft import PeftModel
        from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig

        self.torch = torch
        self.max_new_tokens = max_new_tokens
        use_bf16 = torch.cuda.get_device_capability(0)[0] >= 8
        compute_dtype = torch.bfloat16 if use_bf16 else torch.float16

        print(f"Loading {base_model} + adapter {adapter_dir} ...", flush=True)
        self.tokenizer = AutoTokenizer.from_pretrained(base_model)
        if self.tokenizer.pad_token is None:
            self.tokenizer.pad_token = self.tokenizer.eos_token
        model = AutoModelForCausalLM.from_pretrained(
            base_model,
            quantization_config=BitsAndBytesConfig(
                load_in_4bit=True,
                bnb_4bit_quant_type="nf4",
                bnb_4bit_compute_dtype=compute_dtype,
                bnb_4bit_use_double_quant=True,
            ),
            device_map="auto",  # see generate_transcripts.py: one T4 can't hold the fp16 load
        )
        self.model = PeftModel.from_pretrained(model, str(adapter_dir))
        self.model.eval()
        self.input_device = self.model.get_input_embeddings().weight.device

        self.stop_ids = [self.tokenizer.eos_token_id]
        eot = self.tokenizer.convert_tokens_to_ids("<|eot_id|>")
        if isinstance(eot, int) and eot != self.tokenizer.unk_token_id and eot not in self.stop_ids:
            self.stop_ids.append(eot)
        self.info = f"{base_model} + {adapter_dir.name}"

    def reply(self, messages: list[dict], use_adapter: bool) -> str:
        chat = [{"role": "system", "content": SYSTEM_PROMPT}] + messages
        text = self.tokenizer.apply_chat_template(chat, tokenize=False, add_generation_prompt=True)
        enc = self.tokenizer(text, return_tensors="pt", add_special_tokens=False).to(self.input_device)
        ctx = nullcontext() if use_adapter else self.model.disable_adapter()
        with self.torch.no_grad(), ctx:
            out = self.model.generate(
                **enc,
                max_new_tokens=self.max_new_tokens,
                do_sample=False,  # greedy, same as the benchmark
                temperature=None,
                top_p=None,
                eos_token_id=self.stop_ids,
                pad_token_id=self.tokenizer.pad_token_id,
            )
        return self.tokenizer.decode(out[0, enc["input_ids"].shape[1]:], skip_special_tokens=True).strip()


class Leaderboard:
    """Players and XP in a JSON file. One record per player id; the newest
    submission wins. There is no anti-cheat — fine for a demo or a
    supervised class trial, not for a prize competition."""

    MAX_PLAYERS_RETURNED = 1000

    def __init__(self, path: Path):
        self.path = path
        self.lock = threading.Lock()
        self.players: dict[str, dict] = {}
        if path.exists():
            try:
                self.players = {p["id"]: p for p in json.loads(path.read_text(encoding="utf-8"))}
            except (ValueError, KeyError, TypeError):
                print(f"Warning: could not read {path}; starting an empty leaderboard", flush=True)

    @staticmethod
    def validate(raw: dict) -> dict:
        def text(key: str, lo: int, hi: int) -> str:
            value = " ".join(str(raw.get(key, "")).split())
            if not lo <= len(value) <= hi:
                raise ValueError(f"{key} must be {lo}-{hi} characters")
            return value

        player_id = text("id", 8, 64)
        if not all(c.isalnum() or c == "-" for c in player_id):
            raise ValueError("invalid id")
        state = text("state", 2, 40)
        if state not in NIGERIAN_STATES:
            raise ValueError("unknown state")
        xp = raw.get("xp")
        if not isinstance(xp, int) or isinstance(xp, bool) or not 0 <= xp <= 1_000_000:
            raise ValueError("xp must be a whole number 0-1,000,000")
        return {
            "id": player_id,
            "nickname": text("nickname", 2, 20),
            "avatar": text("avatar", 1, 8),
            "state": state,
            "school": text("school", 2, 60),
            "xp": xp,
            "updated": int(time.time()),
        }

    def upsert(self, raw: dict) -> dict:
        player = self.validate(raw)
        with self.lock:
            self.players[player["id"]] = player
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text(json.dumps(list(self.players.values()), ensure_ascii=False), encoding="utf-8")
            tmp.replace(self.path)  # atomic, so a crash never leaves a half-written file
        return player

    def top(self) -> list[dict]:
        with self.lock:
            ranked = sorted(self.players.values(), key=lambda p: (-p["xp"], p["nickname"].lower()))
        return [{k: p[k] for k in ("id", "nickname", "avatar", "state", "school", "xp")} for p in ranked[: self.MAX_PLAYERS_RETURNED]]


def make_handler(tutor, lock: threading.Lock, board: Leaderboard):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):
            sys.stderr.write(f"[{self.log_date_time_string()}] {fmt % args}\n")

        def _json(self, payload: dict, status: int = 200) -> None:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(body)

        def do_OPTIONS(self):
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.end_headers()

        def do_GET(self):
            path = self.path.split("?", 1)[0]
            if path == "/api/health":
                self._json({"status": "ok", "mode": tutor.mode, "model": tutor.info, "leaderboard": True})
                return
            if path == "/api/leaderboard":
                self._json({"players": board.top()})
                return
            rel = "index.html" if path in ("", "/") else path.lstrip("/")
            target = (APP_DIR / rel).resolve()
            if APP_DIR.resolve() not in target.parents or not target.is_file():
                self._json({"error": "not found"}, status=404)
                return
            body = target.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", mimetypes.guess_type(target.name)[0] or "application/octet-stream")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self):
            path = self.path.split("?", 1)[0]
            if path == "/api/score":
                try:
                    length = int(self.headers.get("Content-Length", 0))
                    if length > 4096:
                        raise ValueError("request too large")
                    player = board.upsert(json.loads(self.rfile.read(length)))
                except (ValueError, TypeError, AttributeError) as e:
                    self._json({"error": f"invalid score: {e}"}, status=400)
                    return
                self._json({"ok": True, "player": player})
                return
            if path != "/api/chat":
                self._json({"error": "not found"}, status=404)
                return
            try:
                payload = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
                messages = [
                    {"role": m["role"], "content": str(m["content"])}
                    for m in payload.get("messages", [])
                    if m.get("role") in ("user", "assistant")
                ][-MAX_HISTORY_MESSAGES:]
                which = payload.get("model", "sabi")
            except (ValueError, KeyError, TypeError):
                self._json({"error": "invalid request"}, status=400)
                return
            if not messages or messages[-1]["role"] != "user":
                self._json({"error": "last message must be from the user"}, status=400)
                return
            if which not in ("sabi", "base", "both"):
                self._json({"error": "model must be sabi, base or both"}, status=400)
                return

            start = time.time()
            try:
                with lock:  # one generation at a time on the single GPU
                    result = {}
                    if which in ("sabi", "both"):
                        result["reply"] = tutor.reply(messages, use_adapter=True)
                    if which in ("base", "both"):
                        key = "base_reply" if which == "both" else "reply"
                        result[key] = tutor.reply(messages, use_adapter=False)
            except Exception as e:  # surface model errors to the UI instead of a dropped connection
                self._json({"error": f"generation failed: {e}"}, status=500)
                return
            result["seconds"] = round(time.time() - start, 1)
            self._json(result)

    return Handler


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve the Sabi app + chat API")
    parser.add_argument("--adapter", default="ml/outputs/lora_run_1/final_adapter")
    parser.add_argument("--base-model", default="NCAIR1/N-ATLaS")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--max-new-tokens", type=int, default=300)
    parser.add_argument("--mock", action="store_true", help="canned replies, no GPU/model needed")
    parser.add_argument("--leaderboard-file", default="ml/outputs/leaderboard.json")
    args = parser.parse_args()

    if args.mock:
        tutor = MockTutor()
    else:
        adapter_dir = Path(args.adapter)
        if not adapter_dir.is_absolute():
            adapter_dir = ROOT / adapter_dir
        if not adapter_dir.exists():
            raise SystemExit(f"Adapter not found: {adapter_dir}")
        tutor = ModelTutor(args.base_model, adapter_dir, args.max_new_tokens)

    board_path = Path(args.leaderboard_file)
    if not board_path.is_absolute():
        board_path = ROOT / board_path
    board_path.parent.mkdir(parents=True, exist_ok=True)
    board = Leaderboard(board_path)

    server = ThreadingHTTPServer((args.host, args.port), make_handler(tutor, threading.Lock(), board))
    print(f"Serving Sabi ({tutor.mode}: {tutor.info}) on http://{args.host}:{args.port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
