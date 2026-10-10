"""
Mock inference + judge server for smoke-testing ml/eval/benchmark.py's
plumbing WITHOUT any GPU, model download, or compute credits.

This does not test whether a fine-tuned model is actually good, it only
proves the wiring is correct: request/response shapes match what
benchmark.py sends and expects, JSON parsing survives real HTTP round-trips,
scoring logic runs end-to-end, and compare_results.py produces a sane report.
Run this BEFORE burning GPU time on a real N-ATLAS endpoint.

Three endpoints, matching benchmark.py's contract exactly:
  POST /base        -> {"reply": "..."}   (simulates an unhelpful base model
                                            that just states answers)
  POST /finetuned    -> {"reply": "..."}   (simulates a well-behaved
                                            Socratic + escalation model)
  POST /judge        -> {"reply": "{...json...}"} (simple rule-based judge,
                                            NOT a real LLM judge, but reads
                                            the same output contract)

Run:
    python ml/smoketest/mock_server.py
    (leave running in one terminal)

Then in another terminal:
    python ml/eval/benchmark.py --model-endpoint http://localhost:8800/base \
        --judge-endpoint http://localhost:8800/judge --label base_model \
        --out ml/outputs/smoketest_results_base.json

    python ml/eval/benchmark.py --model-endpoint http://localhost:8800/finetuned \
        --judge-endpoint http://localhost:8800/judge --label finetuned_model \
        --out ml/outputs/smoketest_results_finetuned.json

    python ml/eval/compare_results.py ml/outputs/smoketest_results_base.json \
        ml/outputs/smoketest_results_finetuned.json \
        --out ml/outputs/smoketest_comparison_report.md

Or just run: python ml/smoketest/run_smoketest.py  (does all of the above
in one shot, including starting/stopping this server).
"""
from __future__ import annotations

import json
import random
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = 8800

# Deliberately mediocre "base model": tends to just state the answer, rarely
# uses cultural analogies, never escalates deliberately (it has no notion of
# escalation, it just sometimes blurts the answer immediately).
BASE_REPLIES = [
    "The answer is that this uses personification, where the sun is given human qualities.",
    "You should use the formula v = u + a*t here. Substituting gives a = -5 m/s^2.",
    "Debit Purchases 5000, Credit Cash 5000. That's the double entry.",
    "This is an example of repetition used for emphasis, creating a solemn tone.",
]

# Deliberately well-behaved "fine-tuned model": asks guiding questions with
# cultural analogies, and escalates only after repeated turns.
FT_TURN_COUNT: dict[str, int] = {}

FT_PROBES = [
    "Think about how a town crier repeats a warning at night, what does repeating something do to how urgent it feels?",
    "Consider an okada braking to a stop, what is its speed the moment it has fully stopped?",
    "Think of an Esusu contribution book, when money comes INTO the pool, which side does the secretary write it on?",
]

FT_ESCALATED_HINT = "Let's narrow it down: think about it almost like the answer is right there, just one small step away, what happens right at that final moment?"

FT_WORKED_EXAMPLE = "Okay, let's work through it together step by step to the answer: [worked reasoning leading to the correct result]."


def base_model_reply(_history: list[dict]) -> str:
    return random.choice(BASE_REPLIES)


def finetuned_model_reply(history: list[dict], session_key: str) -> str:
    turn = FT_TURN_COUNT.get(session_key, 0) + 1
    FT_TURN_COUNT[session_key] = turn

    student_texts = " ".join(m["content"].lower() for m in history if m["role"] == "user")
    frustrated = "just tell me" in student_texts or "i don't get it" in student_texts or "still don't" in student_texts

    if frustrated and turn >= 3:
        return FT_WORKED_EXAMPLE
    if frustrated and turn == 2:
        return FT_ESCALATED_HINT
    return random.choice(FT_PROBES)


def judge_reply(prompt: str) -> str:
    """Very simple rule-based stand-in for an LLM judge, just pattern-matches
    on the tutor's most recent line, extracted from the transcript embedded
    in the prompt. Good enough to exercise benchmark.py's parsing logic."""
    last_tutor_line = ""
    for line in prompt.splitlines():
        if line.startswith("Tutor:"):
            last_tutor_line = line[len("Tutor:"):].strip()

    lower = last_tutor_line.lower()
    states_answer = any(
        kw in lower
        for kw in ["the answer is", "debit purchases", "a = -5", "this is an example of", "= u + a*t"]
    ) and "let's narrow" not in lower and "work through it together" not in lower

    uses_analogy = any(
        kw in lower
        for kw in ["town crier", "okada", "esusu", "market", "farm", "yam", "village"]
    )

    technique = "other"
    if "town crier" in lower or "okada" in lower or "esusu" in lower:
        technique = "cultural_analogy_probe"
    elif "narrow it down" in lower:
        technique = "escalated_hint"
    elif "work through it together" in lower:
        technique = "worked_example"
    elif states_answer:
        technique = "other"

    result = {
        "states_final_answer_directly": states_answer,
        "matches_correct_understanding": uses_analogy or "work through it together" in lower or states_answer,
        "uses_nigerian_cultural_analogy": uses_analogy,
        "technique_label": technique,
    }
    return json.dumps(result)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass  # keep smoketest output quiet

    def _send_json(self, payload: dict, status: int = 200) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length)
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            self._send_json({"error": "invalid json"}, status=400)
            return

        if self.path == "/base":
            reply = base_model_reply(payload.get("messages", []))
            self._send_json({"reply": reply})
        elif self.path == "/finetuned":
            history = payload.get("messages", [])
            session_key = json.dumps(history[:1])  # crude session id from first turn
            reply = finetuned_model_reply(history, session_key)
            self._send_json({"reply": reply})
        elif self.path == "/judge":
            reply = judge_reply(payload.get("prompt", ""))
            self._send_json({"reply": reply})
        else:
            self._send_json({"error": "unknown endpoint"}, status=404)


def main() -> None:
    server = ThreadingHTTPServer(("localhost", PORT), Handler)
    print(f"Mock smoke-test server running on http://localhost:{PORT}")
    print("  POST /base       - mock unhelpful base model")
    print("  POST /finetuned  - mock well-behaved fine-tuned model")
    print("  POST /judge      - mock rule-based judge")
    print("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.shutdown()


if __name__ == "__main__":
    main()
