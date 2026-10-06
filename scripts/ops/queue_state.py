#!/usr/bin/env python3
"""What a watched PR is waiting on, or what happened to it: the rule
`watch_queue.sh` polls by (docs/process.md § CI and merging; the ship-wave
skill).

    gh pr view N --json state,labels,statusCheckRollup | python3 scripts/ops/queue_state.py [--run-status S]
    gh pr view N --json state,labels,statusCheckRollup | python3 scripts/ops/queue_state.py --slow-run

Prints one word or phrase when something happened, and nothing while the PR
is still on its way:

- `MERGED` or `CLOSED`;
- `dequeued`: the `dequeued` label is on and Mergify's *Mergify Merge Queue*
  check is not in progress. After a requeue the label can stay on while the
  PR is back in the queue: that stale label is not a dequeue;
- `CI red` or `PR checks red`: the check's latest run failed or timed out. A
  check is read by its latest run, the highest run id (then job id) in its
  link, because the rollup keeps every run on the head commit, and an edit to
  the title or body runs `PR checks` again on the same commit. A cancelled
  run is not red;
- `Slow suite red` or `Slow suite green`: for a PR carrying `full-ci` and
  not yet `queue` (opened by `ship_pr.sh --full-ci`), the Slow suite's latest
  run that was asked for (its *Asked for* job ran), once it has finished.
  Green, the operator queues it. GitHub makes a job's check run only once
  the jobs it needs have finished, so for a moment every job the rollup
  shows can be done while the run is not: `--slow-run` prints that run's id,
  and `--run-status` takes its own status (`gh run view <id> --json status`),
  with which a verdict waits until the run is `completed`. watch_queue.sh
  passes it.

Python 3 standard library only.
"""

from __future__ import annotations

import json
import re
import sys

RED = {"FAILURE", "TIMED_OUT", "STARTUP_FAILURE"}
WAITING = {"IN_PROGRESS", "QUEUED", "PENDING", "WAITING", "REQUESTED", "EXPECTED"}
IDS = re.compile(r"/runs/(\d+)(?:/job/(\d+))?")


def ids(check: dict) -> tuple[int, int]:
    m = IDS.search(check.get("detailsUrl") or check.get("targetUrl") or "")
    return (int(m.group(1)), int(m.group(2) or 0)) if m else (0, 0)


def name(check: dict) -> str:
    return check.get("name") or check.get("context") or ""


def latest(checks: list[dict], called: str) -> dict | None:
    runs = [c for c in checks if name(c) == called]
    return max(runs, key=ids) if runs else None


def red(check: dict | None) -> bool:
    return bool(check) and (check.get("conclusion") or check.get("state") or "").upper() in RED


def slow_suite(checks: list[dict]) -> str | None:
    """The Slow suite's verdict on its latest run that was asked for."""
    jobs = [c for c in checks if c.get("workflowName") == "Slow suite"]
    asked = [ids(c)[0] for c in jobs if name(c) == "Asked for" and (c.get("conclusion") or "").upper() != "SKIPPED"]
    if not asked:
        return None
    run = max(asked)
    this = [c for c in jobs if ids(c)[0] == run]
    if any((c.get("status") or "").upper() in WAITING for c in this):
        return None
    if any(red(c) for c in this):
        return "Slow suite red"
    if any((c.get("conclusion") or "").upper() == "CANCELLED" for c in this):
        return "Slow suite cancelled"
    return "Slow suite green"


def waits_for_slow_suite(pr: dict) -> bool:
    labels = {lab.get("name") for lab in pr.get("labels") or []}
    return pr.get("state", "OPEN") == "OPEN" and "full-ci" in labels and "queue" not in labels


def slow_run(pr: dict) -> int | None:
    """The id of the Slow suite run whose verdict a full-ci PR waits on:
    its latest run that was asked for."""
    if not waits_for_slow_suite(pr):
        return None
    checks = pr.get("statusCheckRollup") or []
    asked = [ids(c)[0] for c in checks if c.get("workflowName") == "Slow suite" and name(c) == "Asked for" and (c.get("conclusion") or "").upper() != "SKIPPED"]
    return max(asked) if asked else None


def classify(pr: dict, run_status: str | None = None) -> str | None:
    """What happened to the PR, or None. `run_status`: the Slow suite run's
    own status, when it was looked up; a verdict then waits for `completed`."""
    if pr.get("state") and pr["state"] != "OPEN":
        return pr["state"]
    labels = {lab.get("name") for lab in pr.get("labels") or []}
    checks = pr.get("statusCheckRollup") or []
    in_queue = any(name(c) == "Mergify Merge Queue" and (c.get("status") or "").upper() in WAITING for c in checks)
    if "dequeued" in labels and not in_queue:
        return "dequeued"
    for called in ("CI", "PR checks"):
        if red(latest(checks, called)):
            return f"{called} red"
    if waits_for_slow_suite(pr):
        if run_status is not None and run_status.lower() != "completed":
            return None
        return slow_suite(checks)
    return None


def main(argv: list[str]) -> int:
    pr = json.load(sys.stdin)
    if argv[:1] == ["--slow-run"]:
        run = slow_run(pr)
        if run:
            print(run)
        return 0
    run_status = argv[1] if argv[:1] == ["--run-status"] and len(argv) > 1 else None
    state = classify(pr, run_status)
    if state:
        print(state)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
