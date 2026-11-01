#!/usr/bin/env python3
"""What a watched PR is waiting on, or what happened to it: the rule
`watch_queue.sh` polls by (docs/process.md § CI and merging; the ship-wave
skill).

    gh pr view N --json state,labels,statusCheckRollup | python3 scripts/ops/queue_state.py [--run-status S]
    gh pr view N --json state,labels,statusCheckRollup | python3 scripts/ops/queue_state.py --slow-run
    gh pr view N --json state,labels,statusCheckRollup | python3 scripts/ops/queue_state.py --ready [--run-status S]
    gh pr view N --json state,labels,statusCheckRollup | python3 scripts/ops/queue_state.py --ready-run

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

`--ready` is `queue_group.sh`'s rule: whether a PR may be queued now. It
prints `ready` when `CI`, `PR checks` and `Mutants in the changed code` (the
three checks `.mergify.yml`'s queue conditions read) are each green on their
latest run and, for a PR carrying `full-ci`, its Slow suite is green too
(queued or not); `MERGED` or `CLOSED`; `<check> red` for a gate whose latest
run failed or timed out; `Slow suite red` or `Slow suite cancelled`; or
`Slow suite not run` for a `full-ci` PR whose gates are green and that has no
Slow suite run asked for, which nothing will turn green by itself. It prints
nothing while the PR is on its way, a cancelled gate run included: a newer run
may not have its check yet (see above). `--ready-run` prints the id of the
Slow suite run `--ready` waits on, for `--run-status`, as `--slow-run` does.

Python 3 standard library only.
"""

from __future__ import annotations

import json
import re
import sys

RED = {"FAILURE", "TIMED_OUT", "STARTUP_FAILURE"}
# The checks `.mergify.yml`'s queue conditions require of every PR.
GATES = ("CI", "PR checks", "Mutants in the changed code")
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


def green(check: dict | None) -> bool:
    return bool(check) and (check.get("conclusion") or check.get("state") or "").upper() == "SUCCESS"


def asked_run(checks: list[dict]) -> int | None:
    """The id of the Slow suite's latest run that was asked for: one whose
    *Asked for* job ran. A run another label started asks for nothing."""
    asked = [ids(c)[0] for c in checks if c.get("workflowName") == "Slow suite" and name(c) == "Asked for" and (c.get("conclusion") or "").upper() != "SKIPPED"]
    return max(asked) if asked else None


def slow_suite(checks: list[dict]) -> str | None:
    """The Slow suite's verdict on its latest run that was asked for."""
    run = asked_run(checks)
    if not run:
        return None
    jobs = [c for c in checks if c.get("workflowName") == "Slow suite"]
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
    return asked_run(pr.get("statusCheckRollup") or [])


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


def ready(pr: dict, run_status: str | None = None) -> str | None:
    """Whether the PR may be queued now: `ready`, or why not (a closed or
    merged state, a red gate, a Slow suite that is red, cancelled or never
    asked for), or None while it is on its way. `run_status`: as for
    `classify`."""
    if pr.get("state") and pr["state"] != "OPEN":
        return pr["state"]
    checks = pr.get("statusCheckRollup") or []
    gates = {called: latest(checks, called) for called in GATES}
    for called, check in gates.items():
        if red(check):
            return f"{called} red"
    full_ci = "full-ci" in {lab.get("name") for lab in pr.get("labels") or []}
    slow = None
    if full_ci and (run_status is None or run_status.lower() == "completed"):
        slow = slow_suite(checks)
        if slow in ("Slow suite red", "Slow suite cancelled"):
            return slow
    if not all(green(check) for check in gates.values()):
        return None
    if not full_ci or slow == "Slow suite green":
        return "ready"
    return None if asked_run(checks) else "Slow suite not run"


def ready_run(pr: dict) -> int | None:
    """The id of the Slow suite run `ready` waits on: a full-ci PR's, queued or not."""
    if pr.get("state", "OPEN") != "OPEN" or "full-ci" not in {lab.get("name") for lab in pr.get("labels") or []}:
        return None
    return asked_run(pr.get("statusCheckRollup") or [])


def main(argv: list[str]) -> int:
    pr = json.load(sys.stdin)
    if argv[:1] == ["--slow-run"]:
        run = slow_run(pr)
        if run:
            print(run)
        return 0
    if argv[:1] == ["--ready-run"]:
        run = ready_run(pr)
        if run:
            print(run)
        return 0
    if argv[:1] == ["--ready"]:
        verdict = ready(pr, argv[2] if argv[1:2] == ["--run-status"] and len(argv) > 2 else None)
        if verdict:
            print(verdict)
        return 0
    run_status = argv[1] if argv[:1] == ["--run-status"] and len(argv) > 1 else None
    state = classify(pr, run_status)
    if state:
        print(state)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
