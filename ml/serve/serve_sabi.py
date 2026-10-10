"""
Serve the Sabi chat app AND a chat API from one process, so a single URL
gives a working live demo.

    GET  /              -> app/index.html (and the app's static files)
    GET  /api/health    -> {"status": "ok", "mode": "model"|"mock", ...}
    POST /api/chat      -> {"messages": [{"role": "user"|"assistant", "content": ...}],
                            "model": "sabi" | "base" | "both"}
                        <- {"reply": "...", "base_reply": "..." (when model == "both")}
    GET  /api/leaderboard -> {"players": [{pid, nickname, avatar, state, school, xp}, ...]}
    POST /api/score     -> {id, nickname, avatar, state, school, xp} <- {pid}  (upsert)
    POST /api/delete    -> {id}  (remove this player's data)
    POST /api/feedback  -> anonymous pilot feedback for one finished lesson

Security: the secret player id is never published (only pid = sha256(id)[:16]);
per-client rate limits; request and message size caps; nickname filter; XP
may only rise at a realistic pace; CSP and other security headers; binds to
127.0.0.1 by default. See SECURITY.md.

"sabi" = N-ATLAS with the fine-tuned LoRA adapter switched on.
"base" = the same weights with the adapter switched off (original N-ATLAS).
"both" = both, for the side-by-side comparison view in the app.

Run on a GPU (Kaggle), see ml/serve/kaggle_launch.py for the one-cell
launcher that also opens a public tunnel:
    python ml/serve/serve_sabi.py --adapter ml/outputs/lora_run_1/final_adapter

Run WITHOUT a GPU to test the app end to end with canned replies:
    python ml/serve/serve_sabi.py --mock
"""
from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
import re
import sys
import unicodedata
import threading
import time
from contextlib import nullcontext
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

mimetypes.add_type("font/woff2", ".woff2")
mimetypes.add_type("text/javascript", ".js")

ROOT = Path(__file__).resolve().parents[2]
APP_DIR = ROOT / "app"
sys.path.insert(0, str(ROOT / "ml" / "src"))
from build_dataset import SYSTEM_PROMPT  # noqa: E402  same prompt the model was trained with

MAX_HISTORY_MESSAGES = 16  # keep prompts well inside N-ATLAS's 8k context


# ---------------------------------------------------------------------------
# Child-safety guard. Sabi's users are school children and the tutor model has
# no safety filter of its own, so every chat is checked on the way in and the
# way out. Patterns are deliberately narrow (first-person self-harm, explicit
# sexual requests, making weapons/drugs) so that normal school work, e.g.
# discussing a character's suicide in Things Fall Apart, still works.
# ---------------------------------------------------------------------------
SELF_HARM = re.compile(
    r"\b(kill(ing)? my ?self|end(ing)? my (own )?life|"
    r"i('m| am)? (want|wanna|wan|plan|planning|going|gonna|go) (to )?(commit suicide|die)|"
    r"i don'?t want to (live|be alive)|hurt(ing)? my ?self|cut(ting)? my ?self)\b",
    re.I,
)
OFF_LIMITS = re.compile(
    r"\b(porn\w*|nudes?|naked (pic|photo|video)s?|sex (video|chat|tape)|send me your (pic|photo|picture)s?|"
    r"(make|build|making|building) (a |an )?(bomb(?! calorimeter)|gun|explosive|weapon)s?|"
    r"(make|cook|making|cooking|buy|buying) (codeine|meth|cocaine|tramadol|weed|skunk|colorado))\b",
    re.I,
)
SELF_HARM_REPLY = (
    "I'm really sorry you're feeling this way, and I'm glad you said something. You don't have to "
    "handle this alone. Please talk to a parent, a teacher, or another adult you trust today. "
    "If you are in danger right now, call 112, Nigeria's emergency number. Your life matters."
)
OFF_LIMITS_REPLY = (
    "I can't help with that. I'm here for school work: Literature, Physics, Accounting, and BECE and "
    "Common Entrance subjects. What topic are you studying today?"
)


def safety_reply(text: str) -> str | None:
    if SELF_HARM.search(text):
        return SELF_HARM_REPLY
    if OFF_LIMITS.search(text):
        return OFF_LIMITS_REPLY
    return None

NIGERIAN_STATES = {
    "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno",
    "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu", "FCT Abuja", "Gombe",
    "Imo", "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Kogi", "Kwara", "Lagos",
    "Nasarawa", "Niger", "Ogun", "Ondo", "Osun", "Oyo", "Plateau", "Rivers", "Sokoto",
    "Taraba", "Yobe", "Zamfara",
}


class NoTutor:
    """Leaderboard + feedback only, no model (Modal's cheap CPU service).
    Chat requests go to the separate GPU service instead."""

    mode = "none"
    info = "no model on this server; the AI tutor runs on a separate GPU service"

    def reply(self, messages, use_adapter):
        raise WakingUp()


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
            f"[mock Sabi, turn {turn}] Before I answer, think of an okada braking "
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


class RateLimiter:
    """Sliding-window limit per client per action, so one visitor of the
    public demo link can't monopolise the GPU or spam the leaderboard."""

    def __init__(self, limits: dict[str, tuple[int, float]]):
        self.limits = limits  # action -> (max requests, window seconds)
        self.hits: dict[tuple[str, str], list[float]] = {}
        self.lock = threading.Lock()

    def allow(self, action: str, client: str) -> bool:
        limit, window = self.limits[action]
        now = time.time()
        with self.lock:
            recent = [t for t in self.hits.get((action, client), []) if now - t < window]
            if len(recent) >= limit:
                self.hits[(action, client)] = recent
                return False
            recent.append(now)
            self.hits[(action, client)] = recent
            if len(self.hits) > 10_000:  # forget idle clients
                self.hits = {k: v for k, v in self.hits.items() if v and now - v[-1] < 3600}
            return True


# ---------------------------------------------------------------------------
# Input validation. Same rules and word lists as app/src/core/validate.js
# (keep them in sync); this copy is the authority, the app's copy only gives
# students instant feedback.
# ---------------------------------------------------------------------------
BLOCK_ANYWHERE = [
    "fuck", "fuk", "shit", "bitch", "pussy", "cunt", "nigger", "nigga", "asshole", "motherf",
    "whore", "slut", "porn", "dickhead", "ashawo", "ashewo", "oloshi", "olosho",
]
ALLOW_TOKENS = ["shittu", "shitta", "scunthorpe"]  # real names containing a blocked string
NAME_ONLY_WORDS = [  # whole words, names/schools only (King Lear's "Fool" etc. stay fine in chat)
    "dick", "ass", "sex", "sexy", "nude", "nudes", "boobs", "damn", "idiot", "stupid", "fool", "bastard",
    "mumu", "olodo", "werey", "mugu", "shege", "dan iska", "onye ara",
]
IMPERSONATE = {"admin", "moderator", "nitda", "ncair", "teacher", "official"}
LEET = str.maketrans({"0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "!": "i", "|": "i"})
KEYBOARD_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"]


def _strip_marks(text: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c))


def normalize_text(text: str) -> str:
    t = _strip_marks(str(text).lower()).translate(LEET)
    t = re.sub(r"[^a-z ]+", "", t)
    t = re.sub(r"(.)\1{2,}", r"\1\1", t)
    return re.sub(r"\s+", " ", t).strip()


def is_offensive(text: str, strict: bool = False) -> bool:
    words = normalize_text(text)
    for ok in ALLOW_TOKENS:
        words = words.replace(ok, " ")
    squashed = words.replace(" ", "")
    single = re.sub(r"(.)\1+", r"\1", squashed)
    if any(w in squashed or w in single for w in BLOCK_ANYWHERE):
        return True
    if not strict:
        return False
    padded = f" {words} "
    return any(f" {w} " in padded for w in NAME_ONLY_WORDS)


def _word_looks_real(w: str) -> bool:
    if len(w) <= 3:
        return True
    if len(w) >= 4 and any(w in r or w in r[::-1] for r in KEYBOARD_ROWS):
        return False
    if not re.search(r"[aeiouy]", w) or re.search(r"[^aeiouy]{5,}", w) or re.search(r"(.)\1\1", w):
        return False
    return True


def load_vocab() -> set[str]:
    try:
        return set(json.loads((APP_DIR / "content" / "vocab.json").read_text(encoding="utf-8")))
    except (OSError, ValueError):
        return set()


VOCAB = load_vocab()
_ALPHABET = "abcdefghijklmnopqrstuvwxyz"


def _known(w: str) -> bool:
    if w in VOCAB:
        return True
    if len(w) < 4:
        return False
    for i in range(len(w) + 1):
        if i < len(w) and w[:i] + w[i + 1:] in VOCAB:
            return True
        if i < len(w) - 1 and w[:i] + w[i + 1] + w[i] + w[i + 2:] in VOCAB:
            return True
        for c in _ALPHABET:
            if (i < len(w) and w[:i] + c + w[i + 1:] in VOCAB) or w[:i] + c + w[i:] in VOCAB:
                return True
    return False


def is_gibberish(text: str, use_vocab: bool = True) -> bool:
    raw = str(text)
    words = re.findall(r"[a-z]+", _strip_marks(raw.lower()))
    if not words:
        return not re.search(r"\d", raw)
    if re.search(r"\d", raw) and all(len(w) <= 3 for w in words):
        return False
    real = [w for w in words if _word_looks_real(w) and (not use_vocab or not VOCAB or len(w) <= 2 or _known(w))]
    return len(real) / len(words) < 0.5


def unsafe_name(value: str) -> str | None:
    """Problems with a public display name ("Chidi O.") or school name."""
    lowered = value.lower()
    if re.search(r"https?:|www\.|\.(com|ng|net|org)\b|@", lowered):
        return "links and @handles aren't allowed"
    if sum(c.isdigit() for c in value) >= 7:
        return "phone numbers aren't allowed"
    if is_offensive(value, strict=True):
        return "please choose a friendlier name"
    if normalize_text(value) in IMPERSONATE:
        return "that name can't be used"
    return None


def check_display_name(value: str) -> str | None:
    # The app sends "First L." (first name + last initial); allow that shape only.
    first = value[:-3] if re.search(r" \w\.$", value) else value
    if not first or not all(c.isalpha() or c in " '-" for c in first) or not first[0].isalpha():
        return "names can only have letters, spaces, hyphens or apostrophes"
    if not all(_word_looks_real(w) for w in normalize_text(first).split()):
        return "that doesn't look like a real name"
    if normalize_text(first) in IMPERSONATE:
        return "that name can't be used"
    return unsafe_name(value)


def check_school_name(value: str) -> str | None:
    if not all(c.isalnum() or c in " .,'&()/-" for c in value) or sum(c.isalpha() for c in value) < 3:
        return "school names can only use letters, numbers and . , ' & ( ) / -"
    if is_gibberish(value, use_vocab=False):  # school names are full of proper nouns
        return "that doesn't look like a real school name"
    return unsafe_name(value)


CHAT_BLOCK_REPLIES = {
    "offensive": "Abeg, let's keep it respectful 🙏. I'm here to help you study. Ask me about your question and we'll work it out together.",
    "gibberish": "Hmm, I no understand that one 😅. Try telling me in your own words what the question is asking, or which part is confusing you.",
}


def chat_block(text: str) -> str | None:
    if is_offensive(text):
        return "offensive"
    if is_gibberish(text):
        return "gibberish"
    return None


class WakingTutor:
    """Loads ModelTutor in a background thread so the server can answer at
    once. Until the model is ready, health reports mode "loading" and chats
    get a friendly 503, which the app turns into "Waking Sabi up...".
    Used on serverless hosts (Modal) where a cold start takes ~1-2 minutes."""

    def __init__(self, *args):
        self.mode = "loading"
        self.info = "loading N-ATLAS + Sabi adapter"
        self._tutor = None
        self._error = None
        threading.Thread(target=self._load, args=args, daemon=True).start()

    def _load(self, *args):
        try:
            self._tutor = ModelTutor(*args)
            self.info = self._tutor.info
            self.mode = "model"
            print("Model loaded and ready", flush=True)
        except Exception as e:  # keep serving the app; report the failure in health
            self._error = repr(e)
            self.mode = "error"
            self.info = "model failed to load"
            print(f"Model failed to load: {e!r}", file=sys.stderr, flush=True)

    def reply(self, messages, use_adapter):
        if self._tutor is None:
            raise WakingUp()
        return self._tutor.reply(messages, use_adapter)


class WakingUp(Exception):
    pass


def load_school_list() -> dict[str, set[str]]:
    """Real schools per state (app/content/schools.json). A player's school
    is 'verified' only if it matches this list; the client can't fake it."""
    path = APP_DIR / "content" / "schools.json"
    try:
        states = json.loads(path.read_text(encoding="utf-8"))["states"]
        return {st: {n.lower() for n in names} for st, names in states.items()}
    except (OSError, ValueError, KeyError):
        return {}


SCHOOLS = load_school_list()


class Leaderboard:
    """Players and XP in a JSON file.

    Each device sends a SECRET id that never leaves the device except in its
    own score updates; the board only ever publishes pid = sha256(id)[:16].
    So reading the leaderboard never gives anyone what they'd need to
    overwrite another player. XP is client-reported; the server only lets it
    rise at a realistic pace, which stops "1,000,000 XP" but is not full
    anti-cheat."""

    MAX_PLAYERS_RETURNED = 1000
    MAX_PLAYERS_STORED = 20_000  # stops fake sign-ups from filling the disk
    XP_BURST = 200          # allowed jump with no time elapsed
    XP_PER_MINUTE = 120     # far above what real play earns (~35 XP per lesson)

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
    def pid(player_id: str) -> str:
        return hashlib.sha256(player_id.encode("utf-8")).hexdigest()[:16]

    @staticmethod
    def check_id(raw: dict) -> str:
        player_id = str(raw.get("id", ""))
        if not 16 <= len(player_id) <= 64 or not all(c.isalnum() or c == "-" for c in player_id):
            raise ValueError("invalid id")
        return player_id

    def validate(self, raw: dict) -> dict:
        def text(key: str, lo: int, hi: int) -> str:
            value = " ".join(str(raw.get(key, "")).split())
            if not lo <= len(value) <= hi:
                raise ValueError(f"{key} must be {lo}-{hi} characters")
            if any(ord(c) < 32 for c in value):
                raise ValueError(f"{key} contains invalid characters")
            return value

        player_id = self.check_id(raw)
        nickname = text("nickname", 2, 20)
        school = text("school", 2, 60)
        for label, problem in (("nickname", check_display_name(nickname)), ("school", check_school_name(school))):
            if problem:
                raise ValueError(f"{label}: {problem}")
        state = text("state", 2, 40)
        if state not in NIGERIAN_STATES:
            raise ValueError("unknown state")
        xp = raw.get("xp")
        if not isinstance(xp, int) or isinstance(xp, bool) or not 0 <= xp <= 1_000_000:
            raise ValueError("xp must be a whole number 0-1,000,000")
        return {
            "id": player_id, "nickname": nickname, "avatar": text("avatar", 1, 8),
            "state": state, "school": school, "xp": xp, "updated": time.time(),
            "verified": school.lower() in SCHOOLS.get(state, set()),
        }

    def _save(self) -> None:
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(list(self.players.values()), ensure_ascii=False), encoding="utf-8")
        tmp.replace(self.path)  # atomic, so a crash never leaves a half-written file

    def upsert(self, raw: dict) -> dict:
        player = self.validate(raw)
        with self.lock:
            old = self.players.get(player["id"])
            if old:
                minutes = max(0.0, (player["updated"] - old["updated"]) / 60)
                allowed = old["xp"] + self.XP_BURST + int(self.XP_PER_MINUTE * minutes)
                if player["xp"] > allowed:
                    raise ValueError("xp rose faster than real play allows")
            elif player["xp"] > self.XP_BURST * 5:
                raise ValueError("new players start from a realistic score")
            elif len(self.players) >= self.MAX_PLAYERS_STORED:
                raise ValueError("the leaderboard is full right now")
            self.players[player["id"]] = player
            self._save()
        return {"pid": self.pid(player["id"]), "xp": player["xp"]}

    def delete(self, raw: dict) -> bool:
        player_id = self.check_id(raw)
        with self.lock:
            existed = self.players.pop(player_id, None) is not None
            if existed:
                self._save()
        return existed

    def top(self) -> list[dict]:
        with self.lock:
            ranked = sorted(self.players.values(), key=lambda p: (-p["xp"], p["nickname"].lower()))
        return [
            {"pid": self.pid(p["id"]), "verified": p.get("verified", False),
             **{k: p[k] for k in ("nickname", "avatar", "state", "school", "xp")}}
            for p in ranked[: self.MAX_PLAYERS_RETURNED]
        ]


class Feedback:
    """Anonymous pilot feedback: one JSON line per finished lesson.

    No names, no device ids, no IP addresses are stored. Only the lesson
    context, what the student did (hints, chat, correct) and two answers.
    Optional comments are short, filtered for links/phone numbers/slurs."""

    SUBJECTS = {
        "literature", "physics", "accounting", "bece-english", "bece-science", "bece-business",
        "ncee-maths", "ncee-english", "ncee-science",
    }

    def __init__(self, path: Path):
        self.path = path
        self.lock = threading.Lock()

    def add(self, raw: dict) -> None:
        def choice(key, allowed):
            value = raw.get(key)
            if value not in allowed:
                raise ValueError(f"{key} must be one of {sorted(allowed, key=str)}")
            return value

        def count(key, hi):
            value = raw.get(key, 0)
            if not isinstance(value, int) or isinstance(value, bool) or not 0 <= value <= hi:
                raise ValueError(f"{key} must be a whole number 0-{hi}")
            return value

        lesson = str(raw.get("lesson", ""))
        if not 3 <= len(lesson) <= 40 or not all(c.isalnum() or c == "-" for c in lesson):
            raise ValueError("invalid lesson")
        comment = " ".join(str(raw.get("comment", "")).split())[:280]
        if comment and unsafe_name(comment):
            comment = "[removed]"
        row = {
            "t": int(time.time()),
            "lesson": lesson,
            "subject": choice("subject", self.SUBJECTS),
            "level": choice("level", {"waec", "bece", "ncee", None}),
            "helpful": choice("helpful", {1, 2, 3}),          # 1 = no, 2 = a bit, 3 = yes
            "gave_answer": choice("gave_answer", {True, False, None}),
            "correct": choice("correct", {True, False}),
            "first_try": choice("first_try", {True, False}),
            "hints": count("hints", 2),
            "chat_turns": count("chat_turns", 50),
            "live_ai": choice("live_ai", {True, False}),
            "comment": comment,
        }
        with self.lock, self.path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")


MAX_BODY = {"/api/chat": 64 * 1024, "/api/score": 4096, "/api/delete": 1024, "/api/feedback": 2048}
MAX_MESSAGE_CHARS = 2000
SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
}
PAGE_CSP = (
    "default-src 'self'; script-src 'self'; style-src 'self'; "
    "font-src 'self'; img-src 'self' data:; connect-src 'self'; "
    "object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
)


def make_handler(tutor, lock: threading.Lock, board: Leaderboard, limiter: RateLimiter, feedback: Feedback):
    class Handler(BaseHTTPRequestHandler):
        server_version = "Sabi"
        sys_version = ""

        def log_message(self, fmt, *args):
            sys.stderr.write(f"[{self.log_date_time_string()}] {fmt % args}\n")

        def client(self) -> str:
            # Behind the Cloudflare tunnel every request arrives from 127.0.0.1;
            # only then is the CF-Connecting-IP header trustworthy.
            ip = self.client_address[0]
            if ip in ("127.0.0.1", "::1") and self.headers.get("CF-Connecting-IP"):
                return self.headers["CF-Connecting-IP"].strip()
            return ip

        def _headers(self, extra: dict | None = None) -> None:
            headers = {**SECURITY_HEADERS, **(extra or {})}
            # The Cloudflare tunnel terminates HTTPS and forwards over local HTTP;
            # when the visitor came in over HTTPS, tell the browser to stay on it.
            if self.client_address[0] in ("127.0.0.1", "::1") and self.headers.get("X-Forwarded-Proto") == "https":
                headers["Strict-Transport-Security"] = "max-age=31536000"
            for k, v in headers.items():
                self.send_header(k, v)

        def _json(self, payload: dict, status: int = 200) -> None:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Access-Control-Allow-Origin", "*")
            self._headers()
            self.end_headers()
            self.wfile.write(body)

        def _body(self, path: str) -> dict:
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0 or length > MAX_BODY[path]:
                raise ValueError("request too large or empty")
            data = json.loads(self.rfile.read(length))
            if not isinstance(data, dict):
                raise ValueError("expected a JSON object")
            return data

        def do_OPTIONS(self):
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Max-Age", "600")
            self.end_headers()

        def do_GET(self):
            path = self.path.split("?", 1)[0]
            if path == "/api/health":
                self._json({"status": "ok", "mode": tutor.mode, "model": tutor.info, "leaderboard": True, "feedback": True})
                return
            if path == "/api/leaderboard":
                if not limiter.allow("read", self.client()):
                    self._json({"error": "too many requests, slow down"}, status=429)
                    return
                self._json({"players": board.top()})
                return
            app_root = APP_DIR.resolve()
            rel = "index.html" if path in ("", "/") else path.lstrip("/")
            target = (APP_DIR / rel).resolve()
            if app_root not in target.parents or not target.is_file() or "tools" in target.relative_to(app_root).parts:
                self._json({"error": "not found"}, status=404)
                return
            body = target.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", mimetypes.guess_type(target.name)[0] or "application/octet-stream")
            self.send_header("Content-Length", str(len(body)))
            self._headers({"Content-Security-Policy": PAGE_CSP} if target.suffix == ".html" else None)
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self):
            path = self.path.split("?", 1)[0]
            if path not in MAX_BODY:
                self._json({"error": "not found"}, status=404)
                return
            action = {"/api/chat": "chat", "/api/score": "score", "/api/delete": "score", "/api/feedback": "score"}[path]
            if not limiter.allow(action, self.client()):
                self._json({"error": "too many requests, slow down"}, status=429)
                return
            try:
                payload = self._body(path)
            except (ValueError, TypeError):
                self._json({"error": "invalid request"}, status=400)
                return

            if path == "/api/score":
                try:
                    self._json({"ok": True, **board.upsert(payload)})
                except (ValueError, TypeError, AttributeError) as e:
                    self._json({"error": f"invalid score: {e}"}, status=400)
                return
            if path == "/api/feedback":
                try:
                    feedback.add(payload)
                    self._json({"ok": True})
                except ValueError as e:
                    self._json({"error": f"invalid feedback: {e}"}, status=400)
                return
            if path == "/api/delete":
                try:
                    self._json({"ok": True, "deleted": board.delete(payload)})
                except ValueError as e:
                    self._json({"error": str(e)}, status=400)
                return

            try:
                messages = [
                    {"role": m["role"], "content": str(m["content"])}
                    for m in payload.get("messages", [])
                    if isinstance(m, dict) and m.get("role") in ("user", "assistant")
                ][-MAX_HISTORY_MESSAGES:]
                which = payload.get("model", "sabi")
            except (KeyError, TypeError, AttributeError):
                self._json({"error": "invalid request"}, status=400)
                return
            if not messages or messages[-1]["role"] != "user":
                self._json({"error": "last message must be from the user"}, status=400)
                return
            if any(len(m["content"]) > MAX_MESSAGE_CHARS for m in messages):
                self._json({"error": f"messages are limited to {MAX_MESSAGE_CHARS} characters"}, status=400)
                return
            if which not in ("sabi", "base", "both"):
                self._json({"error": "model must be sabi, base or both"}, status=400)
                return

            start = time.time()
            blocked = chat_block(messages[-1]["content"])
            if blocked:
                # Insults and keyboard-mashing are answered here; the GPU is never used.
                reply = CHAT_BLOCK_REPLIES[blocked]
                self._json({"reply": reply, **({"base_reply": reply} if which == "both" else {}), "blocked": blocked, "seconds": 0.0})
                return
            guarded = safety_reply(messages[-1]["content"])
            if guarded:
                print("safety guard: blocked a chat message", file=sys.stderr, flush=True)
                result = {"reply": guarded, "safety": True}
                if which == "both":
                    result["base_reply"] = guarded
                result["seconds"] = 0.0
                self._json(result)
                return
            try:
                with lock:  # one generation at a time on the single GPU
                    result = {}
                    if which in ("sabi", "both"):
                        result["reply"] = tutor.reply(messages, use_adapter=True)
                    if which in ("base", "both"):
                        key = "base_reply" if which == "both" else "reply"
                        result[key] = tutor.reply(messages, use_adapter=False)
            except WakingUp:
                self._json({"error": "Sabi is waking up. Please try again in about a minute.", "waking": True}, status=503)
                return
            except Exception as e:  # log details server-side; don't leak internals to the browser
                print(f"generation failed: {e!r}", file=sys.stderr, flush=True)
                self._json({"error": "Sabi couldn't answer just now, please try again"}, status=500)
                return
            for key in ("reply", "base_reply"):
                if key in result and safety_reply(result[key]):
                    print("safety guard: replaced an unsafe model reply", file=sys.stderr, flush=True)
                    result[key] = OFF_LIMITS_REPLY
                    result["safety"] = True
            result["seconds"] = round(time.time() - start, 1)
            self._json(result)

    return Handler


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve the Sabi app + chat API")
    parser.add_argument("--adapter", default="ml/outputs/lora_run_1/final_adapter")
    parser.add_argument("--base-model", default="NCAIR1/N-ATLaS")
    parser.add_argument("--host", default="127.0.0.1",
                        help="127.0.0.1 = only this machine (the tunnel connects locally); 0.0.0.0 exposes it on the network")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--max-new-tokens", type=int, default=300)
    parser.add_argument("--mock", action="store_true", help="canned replies, no GPU/model needed")
    parser.add_argument("--leaderboard-file", default="ml/outputs/leaderboard.json")
    parser.add_argument("--no-model", action="store_true",
                        help="serve the app, leaderboard and feedback only (no GPU, no model)")
    parser.add_argument("--background-load", action="store_true",
                        help="start serving at once and load the model in the background (serverless hosts)")
    args = parser.parse_args()

    if args.no_model:
        tutor = NoTutor()
    elif args.mock:
        tutor = MockTutor()
    else:
        adapter_dir = Path(args.adapter)
        if not adapter_dir.is_absolute():
            adapter_dir = ROOT / adapter_dir
        if not adapter_dir.exists():
            raise SystemExit(f"Adapter not found: {adapter_dir}")
        tutor_cls = WakingTutor if args.background_load else ModelTutor
        tutor = tutor_cls(args.base_model, adapter_dir, args.max_new_tokens)

    board_path = Path(args.leaderboard_file)
    if not board_path.is_absolute():
        board_path = ROOT / board_path
    board_path.parent.mkdir(parents=True, exist_ok=True)
    board = Leaderboard(board_path)
    limiter = RateLimiter({"chat": (6, 60), "score": (30, 60), "read": (60, 60)})
    feedback = Feedback(board_path.with_name("feedback.jsonl"))

    server = ThreadingHTTPServer((args.host, args.port), make_handler(tutor, threading.Lock(), board, limiter, feedback))
    print(f"Serving Sabi ({tutor.mode}: {tutor.info}) on http://{args.host}:{args.port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
