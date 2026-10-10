"""
Health check for the public Sabi site (and, optionally, the live AI tunnel).

Run by .github/workflows/monitor.yml every 30 minutes. If any check fails the
script exits with code 1, the workflow run fails, and GitHub emails the repo
owner. Results are also written as a table to the run's summary page.

    python ml/monitor/check_site.py                       # check the Vercel site
    SABI_AI_URL=https://xxxx.trycloudflare.com python ml/monitor/check_site.py

No third-party packages: standard library only.
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request

SITE = os.environ.get("SABI_SITE_URL", "https://sabi-app-wine.vercel.app").rstrip("/")
AI = os.environ.get("SABI_AI_URL", "").strip().rstrip("/")
SLOW_SECONDS = 10

results: list[tuple[str, bool, str]] = []


def fetch(url: str, timeout: int = 20):
    start = time.time()
    req = urllib.request.Request(url, headers={"User-Agent": "sabi-monitor/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, dict(r.headers), r.read(), time.time() - start
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read(), time.time() - start


def check(name: str, fn) -> None:
    try:
        ok, detail = fn()
    except Exception as e:  # network down, bad JSON, timeout...
        ok, detail = False, f"{type(e).__name__}: {e}"
    results.append((name, ok, detail))


def home():
    status, headers, body, secs = fetch(SITE + "/")
    if status != 200:
        return False, f"HTTP {status}"
    if b"<title>" not in body or b"src/main.js" not in body:
        return False, "page loaded but does not look like the Sabi app"
    if secs > SLOW_SECONDS:
        return False, f"slow: {secs:.1f} s"
    return True, f"HTTP 200 in {secs:.1f} s"


def security_headers():
    _, headers, _, _ = fetch(SITE + "/")
    h = {k.lower(): v for k, v in headers.items()}
    missing = [k for k in ("content-security-policy", "x-content-type-options", "x-frame-options", "strict-transport-security") if k not in h]
    return (not missing), ("all present" if not missing else "missing: " + ", ".join(missing))


def game_content():
    status, _, body, _ = fetch(SITE + "/content/game.json")
    if status != 200:
        return False, f"HTTP {status}"
    game = json.loads(body)
    stops = [l for s in game["subjects"].values() for u in s["units"] for l in u["lessons"]]
    tasks = sum(1 + len(l.get("round", [])) for l in stops)
    if len(stops) < 120 or tasks < 1200:
        return False, f"only {len(stops)} stops / {tasks} tasks"
    return True, f"{len(stops)} stops, {tasks} tasks"


def json_file(path: str, key: str | None = None):
    def run():
        status, _, body, _ = fetch(SITE + path)
        if status != 200:
            return False, f"HTTP {status}"
        data = json.loads(body)
        size = len(data[key]) if key else len(data)
        return size > 0, f"{size} entries"
    return run


def script_loads():
    status, headers, _, _ = fetch(SITE + "/src/main.js")
    ctype = {k.lower(): v for k, v in headers.items()}.get("content-type", "")
    return status == 200 and "javascript" in ctype, f"HTTP {status}, {ctype or 'no content-type'}"


def ai_health():
    status, _, body, secs = fetch(AI + "/api/health", timeout=30)
    if status != 200:
        return False, f"HTTP {status}"
    mode = json.loads(body).get("mode", "?")
    return mode == "model", f"mode={mode}, {secs:.1f} s"


check("Home page", home)
check("Security headers", security_headers)
check("App script", script_loads)
check("Lessons (game.json)", game_content)
check("School list", json_file("/content/schools.json", "states"))
check("Chat word list", json_file("/content/vocab.json"))
if AI:
    check("Live AI tutor", ai_health)

failed = [r for r in results if not r[1]]
lines = [f"## Sabi status: {'❌ ' + str(len(failed)) + ' problem(s)' if failed else '✅ all good'}", "",
         f"Checked {SITE}" + (f" and the AI at {AI}" if AI else " (live AI not checked: SABI_AI_URL not set)"), "",
         "| Check | Result | Detail |", "|---|---|---|"]
lines += [f"| {n} | {'✅' if ok else '❌'} | {d} |" for n, ok, d in results]
report = "\n".join(lines)
print(report)
summary = os.environ.get("GITHUB_STEP_SUMMARY")
if summary:
    with open(summary, "a", encoding="utf-8") as f:
        f.write(report + "\n")
sys.exit(1 if failed else 0)
