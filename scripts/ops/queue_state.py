#!/usr/bin/env python3
"""What a watched PR is waiting on, or what happened to it: the rule
`watch_queue.sh` polls by (docs/process.md § CI and merging; the ship-wave
skill).

    gh pr view N --json state,labels,statusCheckRollup | python3 scripts/ops/queue_state.py

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
  Green, the operator queues it.

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


def classify(pr: dict) -> str | None:
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
    if "full-ci" in labels and "queue" not in labels:
        return slow_suite(checks)
    return None


def main() -> int:
    state = classify(json.load(sys.stdin))
    if state:
        print(state)
    return 0


if __name__ == "__main__":
    sys.exit(main())
