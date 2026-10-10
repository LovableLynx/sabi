"""
One-shot smoke test of the entire benchmark pipeline against the mock
server: no GPU, no model download, no compute credits spent.

This proves the plumbing works, HTTP contracts, JSON parsing, the 3-axis
scoring logic, and report generation, before you point benchmark.py at a
real (expensive) N-ATLAS inference endpoint.

Run:
    python ml/smoketest/run_smoketest.py

Exits non-zero if any step fails, with the failing step's output printed.
"""
from __future__ import annotations

import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PORT = 8800
BASE_URL = f"http://localhost:{PORT}"


def run(cmd: list[str], **kwargs) -> subprocess.CompletedProcess:
    print(f"\n$ {' '.join(cmd)}")
    result = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, **kwargs)
    print(result.stdout)
    if result.returncode != 0:
        print(result.stderr, file=sys.stderr)
    return result


def wait_for_server(proc: subprocess.Popen, timeout: float = 10.0) -> bool:
    import urllib.request
    import urllib.error

    start = time.time()
    while time.time() - start < timeout:
        if proc.poll() is not None:
            return False  # server process died
        try:
            urllib.request.urlopen(f"{BASE_URL}/base", data=b"{}", timeout=1)
        except urllib.error.HTTPError:
            return True  # server responded (even with an error status = alive)
        except Exception:
            time.sleep(0.2)
            continue
        return True
    return False


def main() -> int:
    print("=== Sabi benchmark plumbing smoke test ===")
    print("Using a mock inference/judge server, no GPU or real model involved.\n")

    # 0. Ensure we have a non-empty eval set to run against. If build_dataset
    #    hasn't been run, or produced 0 eval examples, bail with a clear message.
    eval_file = ROOT / "ml" / "outputs" / "eval_holdout.jsonl"
    if not eval_file.exists() or eval_file.stat().st_size == 0:
        print(
            f"ERROR: {eval_file} is missing or empty.\n"
            f"Run `python ml/src/build_dataset.py` first (after "
            f"`python ml/src/data_validate.py` passes)."
        )
        return 1

    # 1. Start the mock server as a subprocess.
    server_proc = subprocess.Popen(
        [sys.executable, str(ROOT / "ml" / "smoketest" / "mock_server.py")],
        cwd=ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    print(f"Started mock server (pid={server_proc.pid}), waiting for it to come up...")

    try:
        if not wait_for_server(server_proc):
            print("ERROR: mock server did not start in time.")
            return 1
        print("Mock server is up.\n")

        outputs_dir = ROOT / "ml" / "outputs"
        outputs_dir.mkdir(parents=True, exist_ok=True)
        base_results = outputs_dir / "smoketest_results_base.json"
        ft_results = outputs_dir / "smoketest_results_finetuned.json"
        report_path = outputs_dir / "smoketest_comparison_report.md"

        # 2. Run benchmark against the mock "base" model.
        r1 = run([
            sys.executable, "ml/eval/benchmark.py",
            "--model-endpoint", f"{BASE_URL}/base",
            "--judge-endpoint", f"{BASE_URL}/judge",
            "--label", "base_model_MOCK",
            "--out", str(base_results.relative_to(ROOT)),
        ])
        if r1.returncode != 0:
            print("FAILED: benchmark.py against mock base model.")
            return 1

        # 3. Run benchmark against the mock "fine-tuned" model.
        r2 = run([
            sys.executable, "ml/eval/benchmark.py",
            "--model-endpoint", f"{BASE_URL}/finetuned",
            "--judge-endpoint", f"{BASE_URL}/judge",
            "--label", "finetuned_model_MOCK",
            "--out", str(ft_results.relative_to(ROOT)),
        ])
        if r2.returncode != 0:
            print("FAILED: benchmark.py against mock fine-tuned model.")
            return 1

        # 4. Generate the comparison report.
        r3 = run([
            sys.executable, "ml/eval/compare_results.py",
            str(base_results.relative_to(ROOT)),
            str(ft_results.relative_to(ROOT)),
            "--out", str(report_path.relative_to(ROOT)),
        ])
        if r3.returncode != 0:
            print("FAILED: compare_results.py")
            return 1

        print("\n=== SMOKE TEST PASSED ===")
        print("Plumbing verified end-to-end: model endpoint calls, judge calls,")
        print("3-axis scoring, and report generation all work correctly.")
        print(f"\nMock comparison report written to: {report_path}")
        print(
            "\nThese numbers are meaningless (mock models, rule-based judge), "
            "do not use them in your submission. Once you have a real N-ATLAS "
            "inference endpoint (base and fine-tuned) and a real judge "
            "endpoint, rerun the same benchmark.py commands pointed at those."
        )
        return 0

    finally:
        server_proc.terminate()
        try:
            server_proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server_proc.kill()
        print("\nMock server stopped.")


if __name__ == "__main__":
    sys.exit(main())
