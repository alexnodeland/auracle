#!/usr/bin/env python3
"""CI's health, measured (#177 § 7.1): how long a PR waits for its `CI`
check, how long its jobs wait for a runner, how often a run goes red and on
what, and how a PR gets from open to merged.

    python3 scripts/ci_stats.py                       the last 7 days, as Markdown
    python3 scripts/ci_stats.py --since 2026-09-28 --until 2026-10-05
    python3 scripts/ci_stats.py --format json         the same numbers, to keep
    python3 scripts/ci_stats.py --compare docs/notes/ci-baseline-2026-10-05.json
                                                      and each headline against a saved run

`--since` and `--until` take a date (YYYY-MM-DD, UTC, both days included) or
a time (2026-10-06T09:00:00Z). The default is the 7 days up to now, and a
window never runs past now.

It reads the Actions and pull request APIs through `gh api`, GET only, so it
uses gh's own login, or GH_TOKEN in CI. What can no longer change is kept
under `.cache/ci_stats/` (gitignored), keyed by URL: the jobs of a completed
run, and the files and comments of a closed PR. A second run over the same
window fetches only the lists and what is still in flight. At GitHub's rate
limit it stops, reports what it had read (in JSON, with `stopped`), says so
on stderr, and exits 3; `--compare` refuses such a run as a base.

What it counts, with the definitions #177's numbers used:
- A run is a `ci.yml` run. Its verdict is its first attempt's `CI` job (on a
  queue batch, its `Full gate` job, the check the queue merges on): green
  (success), red (failure or timed out) or cancelled. A re-run is counted
  (`reruns`), not believed. A run on main that ran nothing (main had moved
  past it, so ci.yml's `changes` job skipped everything) has no verdict.
- Two lanes (ADR-023). A PR's own run is the fast lane, reported by the kind
  of PR. The kind follows ci.yml's `changes` job, in its order, from the PR's
  files: CI when it changes a workflow or an action (the fast lane runs the
  full gate), whatever else it changes; then Rust (crates/, Cargo.*,
  rust-toolchain, the Makefile, the coverage gate's scripts, setup.sh); then
  web (apps/web/ and tests/web/, their Markdown and the specs' lint aside);
  and docs and other
  (anything else: the site, docs/, .claude/, the other scripts,
  changelog.d/, .mergify.yml). The kinds are the same for runs from before
  ci.yml had these lanes, so a baseline compares like with like. A run
  belongs to the PR whose branch it ran on while the PR was open. The merge
  queue's runs, on its draft PRs from branches under `mergify/merge-queue/`,
  are the full gate: a row of their own (queue batch), belonging to no PR. A
  push to main is a row of its own too.
- CI wall time: the run created to its `CI` job completed (a queue batch's
  `Full gate`), on green and red runs.
- Runner wait: each required job's start minus its creation (a job `CI`
  needs; on a queue batch, one `Full gate` needs), summed per run, the
  longest in the run, and every one's; and the longest of all the run's jobs,
  required or not.
- Red rate: red runs of the green and red ones; cancelled runs are left out.
- Runs per PR: the `ci.yml` runs on a merged PR's branch while it was open
  (its fast lane; the queue's batches are counted on their own row).
- Open to merge, PRs merged a day, and open to the first red (that run's
  `CI` completed): over the PRs merged in the window.
- In the queue: from when the PR entered Mergify's queue to its merge, as
  Mergify records it: the `queued_at` in the payload of its status comment
  whose state is `merged` (a new comment each time the PR enters); n/a when
  Mergify did not merge it (a merge by hand, after leaving the queue or
  without it). How many times each PR entered is counted too.
- main red: from a red run's `CI` completed on main to the next green run's
  `CI` completed on main. Consecutive reds are one stretch. A stretch that
  began before the window is counted from the window's start.
- Shards: each `Browser (k/N)` job's time on the green PR and queue runs that
  ran all N, grouped by N. The spread is a run's slowest shard minus its
  fastest. The headlines read the largest N, the whole tier (a fast lane
  runs only the specs its change reaches, on fewer).
- Jobs: each job's time on green runs, by name with the shard numbers folded
  (`Browser (k/12)`); the Coverage chain from its build's start to its
  report's end; and the Slow suite's and the Flake hunt's runs, created to
  their last job done, each judged by its first attempt.

Python 3 standard library only.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import re
import subprocess
import sys
import threading
import time
import urllib.parse
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
REPO = "alexnodeland/auracle"
CACHE = os.path.join(ROOT, ".cache", "ci_stats")
UTC = dt.timezone.utc
DAY = dt.timedelta(days=1)

# The rows of the main table, in order, and what each is called.
ROWS = ("rust", "web", "docs", "ci", "unmatched", "queue", "main")
LABEL = {
    "rust": "Rust",
    "web": "Web",
    "docs": "Docs and other",
    "ci": "CI (full gate)",
    "unmatched": "No PR found",
    "queue": "Queue batch",
    "main": "main (push)",
}
# The merge queue's draft PRs come from branches under this prefix
# (.mergify.yml's queue_branch_prefix, which ci.yml's `changes` job reads too).
QUEUE_BRANCH = "mergify/merge-queue/"
# The jobs that answer for a run, not jobs of their own: `CI`, which every
# check needs, and `Full gate`, which a queue run's merge waits on.
AGGREGATES = ("CI", "Full gate")
# Jobs no answer waits for: the deploy after a green `CI` on main, main's
# Codecov upload of the queue run's coverage, and the Slow suite's issue on a
# red one.
NOT_NEEDED = ("Deploy to Pages", "Codecov from the queue's run", "Report a failure on main")
# The other workflows whose runs the budgets need.
OTHER = (("slow-suite.yml", "Slow suite"), ("flake-hunt.yml", "Flake hunt"))
# How far before --since a merged PR's runs are still read (runs per PR, and
# its first red): a PR opened longer ago than this counts only its later runs.
LOOKBACK = dt.timedelta(days=14)


# ─── time ────────────────────────────────────────────────────────────────────


def ts(s: str | None) -> dt.datetime | None:
    if not s:
        return None
    t = dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
    return t if t.tzinfo else t.replace(tzinfo=UTC)


def iso(t: dt.datetime) -> str:
    return t.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_when(s: str, end: bool = False) -> dt.datetime:
    """A date is the start of that day (UTC); as the end of a window it is
    the start of the next, so the day is included. A time is that time."""
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", s):
        day = dt.datetime.strptime(s, "%Y-%m-%d").replace(tzinfo=UTC)
        return day + DAY if end else day
    t = ts(s)
    if t is None:
        raise ValueError(f"not a date or a time: {s!r}")
    return t


def mins(a: dt.datetime | None, b: dt.datetime | None) -> float | None:
    if a is None or b is None:
        return None
    return (b - a).total_seconds() / 60


# ─── statistics ──────────────────────────────────────────────────────────────


def pct(xs, p: float) -> float | None:
    """The p-th quantile, interpolated between the two nearest values (as
    numpy's default and the issue's numbers do). None for no values."""
    xs = sorted(x for x in xs if x is not None)
    if not xs:
        return None
    k = (len(xs) - 1) * p
    f = int(k)
    c = min(f + 1, len(xs) - 1)
    return xs[f] + (xs[c] - xs[f]) * (k - f)


def rnd(v: float | None, digits: int = 1) -> float | None:
    return None if v is None else round(v, digits)


def dist(xs, digits: int = 1) -> dict:
    xs = [x for x in xs if x is not None]
    return {
        "n": len(xs),
        "median": rnd(pct(xs, 0.5), digits),
        "p90": rnd(pct(xs, 0.9), digits),
        "max": rnd(max(xs), digits) if xs else None,
    }


def mean(xs) -> float | None:
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else None


# ─── what a PR changed ───────────────────────────────────────────────────────

# ci.yml's `changes` job, in its order, one kind per PR (see the docstring).
CI = re.compile(r"^\.github/(workflows|actions)/")
RUST = re.compile(
    r"^(crates/|Cargo\.(toml|lock)$|Makefile$|rust-toolchain"
    r"|scripts/(coverage_gate|test_coverage_gate)\.py$|scripts/setup\.sh$)"
)
# The specs' lint (its config, its suppressions, its tests) is read by Web,
# not by any browser: ci.yml's `reach` leaves it out.
WEB = re.compile(
    r"^(?!tests/web/(eslint\.config\.mjs|eslint-suppressions\.json|eslint\.test\.mjs|suppressions\.mjs)$)"
    r"(apps/web/|tests/web/).*(?<!\.md)$"
)


def classify(files) -> str:
    """ci, rust, web or docs: the first lane, in ci.yml's order, that any of
    the PR's files reaches."""
    files = list(files)
    for kind, pattern in (("ci", CI), ("rust", RUST), ("web", WEB)):
        if any(pattern.match(f) for f in files):
            return kind
    return "docs"


# ─── a run and its jobs ──────────────────────────────────────────────────────

SHARD = re.compile(r"^Browser \((\d+)/(\d+)\)$")
VERDICT = {
    "success": "green",
    "failure": "red",
    "timed_out": "red",
    "cancelled": "cancelled",
    "skipped": "cancelled",
}


def first_attempt(jobs) -> list:
    return [j for j in jobs or [] if j.get("run_attempt", 1) == 1]


def is_queue(run) -> bool:
    """A run of the merge queue's full gate, on one of its draft PRs."""
    return run.get("event") == "pull_request" and (run.get("head_branch") or "").startswith(QUEUE_BRANCH)


def is_main(run) -> bool:
    return run.get("event") == "push" and run.get("head_branch") == "main"


def ran(job) -> bool:
    return bool(job.get("runner_name")) and job.get("conclusion") not in (None, "skipped")


def superseded(run) -> bool:
    """A run on main that ran nothing: main had moved past its commit, so
    ci.yml's `changes` job skipped every job, and `CI` passed on nothing. (A
    run cancelled before its jobs began ran nothing too, and is cancelled.)"""
    jobs = first_attempt(run.get("jobs"))
    if not is_main(run) or not jobs:
        return False
    gate = gate_job(run)
    if gate is None or gate.get("conclusion") != "success":
        return False
    idle = ("What changed",) + AGGREGATES + NOT_NEEDED
    return not any(ran(j) for j in jobs if j.get("name") not in idle)


def gate_job(run) -> dict | None:
    """The first attempt's job that answers for the run: `Full gate` on a
    queue run (falling back on `CI` before it ran), `CI` on any other."""
    jobs = {j.get("name"): j for j in first_attempt(run.get("jobs"))}
    if is_queue(run) and "Full gate" in jobs:
        return jobs["Full gate"]
    return jobs.get("CI")


def verdict(run) -> str | None:
    """green, red or cancelled, from the first attempt's `CI` job (`Full
    gate` on a queue run); None while it runs, and for a superseded run on
    main. It fails when a job it needs was cancelled, with nothing else
    failed: that run was cancelled when the run itself was (a newer push
    replaced it), and red otherwise (a job reached its time limit). A run
    with no jobs read falls back on its own conclusion."""
    if run.get("status") != "completed" or superseded(run):
        return None
    j = gate_job(run)
    if j is None:
        if run.get("run_attempt", 1) == 1 or not run.get("jobs"):
            return VERDICT.get(run.get("conclusion"))
        return None
    v = VERDICT.get(j.get("conclusion"))
    others_failed = any(
        x.get("conclusion") in ("failure", "timed_out")
        for x in first_attempt(run.get("jobs"))
        if x.get("name") not in AGGREGATES
    )
    if v == "red" and not others_failed:
        if run.get("run_attempt", 1) == 1 and run.get("conclusion") == "cancelled":
            return "cancelled"
    return v


def ci_done(run) -> dt.datetime | None:
    """When the first attempt's `CI` job (`Full gate` on a queue run)
    completed; the run's last update when its jobs were not read."""
    j = gate_job(run)
    if j is not None:
        return ts(j.get("completed_at"))
    return ts(run.get("updated_at")) if not run.get("jobs") else None


def wall(run) -> float | None:
    return mins(ts(run["created_at"]), ci_done(run))


def needed(run, job) -> bool:
    """A job the run's answer waits for: one `CI` needs, or on a queue run
    one `Full gate` needs (`CI` itself and the Browser report with them)."""
    name = job.get("name")
    if name in NOT_NEEDED:
        return False
    if is_queue(run):
        return name != "Full gate"
    return name not in ("CI", "Full gate", "Browser report")


def waits(run, required: bool = True) -> list:
    """Minutes each first-attempt job that got a runner waited for it: the
    required ones, or with required=False every one."""
    out = []
    for j in first_attempt(run.get("jobs")):
        if not ran(j) or (required and not needed(run, j)):
            continue
        w = mins(ts(j.get("created_at")), ts(j.get("started_at")))
        if w is not None and w >= 0:
            out.append(w)
    return out


def failed_jobs(run) -> list:
    """The first attempt's failed jobs; when only `CI` or `Full gate`
    failed, the jobs that were cancelled under it (at their time limit),
    marked so."""
    jobs = first_attempt(run.get("jobs"))
    failed = [j["name"] for j in jobs if j.get("conclusion") in ("failure", "timed_out")]
    names = [n for n in failed if n not in AGGREGATES]
    if not names:
        names = [f"{j['name']} (cancelled)" for j in jobs if j.get("conclusion") == "cancelled"] or failed
    return sorted(names, key=natural)


def natural(s: str):
    return [int(p) if p.isdigit() else p for p in re.split(r"(\d+)", s)]


def fold(name: str) -> str:
    """A job's name with its shard number folded: `Browser (3/12)` is
    `Browser (k/12)`."""
    return re.sub(r"\((\d+)/(\d+)\)", r"(k/\2)", name)


def workflow_verdict(run) -> str | None:
    """A Slow suite or Flake hunt run's verdict from its first attempt: red
    when a job failed, cancelled when one was, green when the rest passed.
    With no jobs read, a first attempt's own conclusion."""
    if run.get("status") != "completed":
        return None
    jobs = first_attempt(run.get("jobs"))
    if not jobs:
        return VERDICT.get(run.get("conclusion")) if run.get("run_attempt", 1) == 1 else None
    ends = [j.get("conclusion") for j in jobs]
    if any(c in ("failure", "timed_out") for c in ends):
        return "red"
    if "cancelled" in ends:
        return "cancelled"
    return "green" if all(c in ("success", "skipped") for c in ends) else None


# ─── which PR a run belongs to ───────────────────────────────────────────────

FAR = dt.datetime.max.replace(tzinfo=UTC)


def by_branch(prs) -> dict:
    out = defaultdict(list)
    for p in prs:
        out[p["branch"]].append(p)
    return out


def pr_for(run, branches) -> dict | None:
    """The PR whose branch the run ran on while it was open (from two
    minutes before it was opened, as a run can be created just ahead of
    the PR's record, to when it closed). A queue run has none: its draft PR
    is the queue's, and the PRs in the batch are counted by their merge."""
    if run.get("event") != "pull_request" or is_queue(run):
        return None
    t = ts(run["created_at"])
    for p in branches.get(run.get("head_branch"), []):
        start = ts(p["created_at"]) - dt.timedelta(minutes=2)
        end = ts(p.get("closed_at")) or FAR
        if start <= t <= end:
            return p
    return None


def row_of(run, branches) -> str | None:
    """The run's row; None for a run that is no row's (a manual run), or
    whose PR's files could not be read."""
    if is_main(run):
        return "main"
    if run.get("event") != "pull_request":
        return None
    if is_queue(run):
        return "queue"
    p = pr_for(run, branches)
    return p.get("kind") if p else "unmatched"


# ─── the queue ───────────────────────────────────────────────────────────────

PAYLOAD = re.compile(r"-\*- Mergify Payload -\*-\s*(\{.*?\})\s*-\*- Mergify Payload End -\*-", re.S)


def payloads(comments) -> list:
    """The payloads Mergify keeps, as an HTML comment, in each of its status
    comments on the PR (a new comment each time the PR enters the queue):
    each says when the PR entered (`queued_at`) and how that went (`state`)."""
    out = []
    for c in comments or []:
        if not (c.get("user") or {}).get("login", "").startswith("mergify"):
            continue
        for m in PAYLOAD.finditer(c.get("body") or ""):
            try:
                data = json.loads(m.group(1))
            except ValueError:
                continue
            if isinstance(data, dict) and ts(data.get("queued_at")) is not None:
                out.append(data)
    return out


def queue_time(comments, merged_at: dt.datetime) -> tuple:
    """(minutes from entering the queue to the merge, how many times the PR
    entered before it). The entry is Mergify's own figure, in the payload
    whose state is `merged`; a PR Mergify did not merge (merged by hand,
    after leaving the queue or without it) has none: (None, entries)."""
    found = payloads(comments)
    entries = {ts(p["queued_at"]) for p in found} - {None}
    entries = [t for t in entries if t <= merged_at]
    done = [ts(p["queued_at"]) for p in found if p.get("state") == "merged" and ts(p["queued_at"]) <= merged_at]
    if not done:
        return None, len(entries)
    return mins(max(done), merged_at), len(entries)


# ─── main's red stretches ────────────────────────────────────────────────────


def main_red(runs, since: dt.datetime, until: dt.datetime) -> list:
    """Each stretch main stayed red in the window: from the first red run's
    `CI` completed to the next green run's, in the order the runs were
    created. A stretch that began before `since` is counted from `since`
    (`clipped`); one still open at the end is measured to `until` and has no
    `to`. A run with no verdict neither opens nor closes one."""
    out, cur = [], None
    for r in sorted(runs, key=lambda r: r["created_at"]):
        v = verdict(r)
        if v == "red":
            if cur is None:
                cur = {"from": ci_done(r), "to": None, "red_runs": [], "green_run": None}
            cur["red_runs"].append(r["id"])
        elif v == "green" and cur is not None:
            cur["to"], cur["green_run"] = ci_done(r), r["id"]
            out.append(cur)
            cur = None
    if cur is not None:
        out.append(cur)
    kept = []
    for w in out:
        if w["from"] is None or w["from"] >= until or (w["to"] is not None and w["to"] <= since):
            continue
        w["clipped"] = w["from"] < since
        start = max(w["from"], since)
        w["minutes"] = rnd(mins(start, w["to"] or until))
        w["from"] = iso(start)
        w["to"] = iso(w["to"]) if w["to"] else None
        kept.append(w)
    return kept


# ─── the numbers ─────────────────────────────────────────────────────────────


def in_window(run, since, until) -> bool:
    return since <= ts(run["created_at"]) < until


def measure(data: dict, since: dt.datetime, until: dt.datetime) -> dict:
    """Every number, from what `collect` read (or a test wrote): `ci` (ci.yml
    runs, each with its `jobs`; one marked `unread` is left out),
    `main_before` (main's last decided run before the window, with its
    jobs), `main_after` (main's runs after it up to the first green, with
    their jobs, to close a red stretch), `prs` (each
    with `kind`, None when its files could not be read, and `comments` when
    merged in the window) and `other` (each OTHER workflow's runs)."""
    branches = by_branch(data["prs"])
    runs = [r for r in data["ci"] if r.get("status") == "completed" and not r.get("unread")]
    window = [r for r in runs if in_window(r, since, until)]

    # By kind of PR (the fast lane), the queue's batches, and main.
    rows: dict = {}
    red_runs, failing = [], Counter()
    grouped = defaultdict(list)
    for r in window:
        k = row_of(r, branches)
        if k is not None:
            grouped[k].append(r)
    for k in ROWS:
        rs = grouped.get(k)
        if not rs:
            continue
        v = Counter(verdict(r) for r in rs)
        decided = [r for r in rs if verdict(r) in ("green", "red")]
        w = [waits(r) for r in decided]
        rows[k] = {
            "runs": len(rs),
            "green": v["green"],
            "red": v["red"],
            "cancelled": v["cancelled"],
            "no_verdict": v[None],
            "reruns": sum(1 for r in rs if r.get("run_attempt", 1) > 1),
            "red_rate": rnd(v["red"] / (v["green"] + v["red"]), 3) if decided else None,
            "wall": dist(wall(r) for r in decided),
            "wait_per_run": dist(sum(x) for x in w),
            "longest_wait": dist(max(x, default=0) for x in w),
            "longest_wait_all": dist(max(waits(r, required=False), default=0) for r in decided),
            "job_wait": dist((y for x in w for y in x), 2),
        }
        for r in rs:
            if verdict(r) == "red":
                p = pr_for(r, branches)
                failed = failed_jobs(r)
                failing.update(fold(n) for n in failed)
                red_runs.append(
                    {
                        "run": r["id"],
                        "url": r.get("html_url"),
                        "row": k,
                        "pr": p["number"] if p else None,
                        "jobs": failed,
                    }
                )

    # The PRs merged in the window, and every run of theirs.
    runs_of = defaultdict(list)
    for r in runs:
        p = pr_for(r, branches)
        if p is not None:
            runs_of[p["number"]].append(r)
    merged = [p for p in data["prs"] if p.get("merged_at") and since <= ts(p["merged_at"]) < until]
    days = (until - since).total_seconds() / 86400
    opened, first_red, queue, entries, per_kind = [], [], [], [], defaultdict(list)
    for p in merged:
        c, m = ts(p["created_at"]), ts(p["merged_at"])
        opened.append(mins(c, m))
        mine = runs_of[p["number"]]
        if p.get("kind"):
            per_kind[p["kind"]].append(len(mine))
        reds = [ci_done(r) for r in mine if verdict(r) == "red" and ci_done(r)]
        if reds:
            first_red.append(mins(c, min(reds)))
        q, n = queue_time(p.get("comments"), m)
        entries.append(n)
        if q is not None:
            queue.append(q)
    for k, counts in per_kind.items():
        rows.setdefault(k, {"runs": 0})["runs_per_pr"] = {
            "prs": len(counts),
            "median": rnd(pct(counts, 0.5)),
            "mean": rnd(mean(counts), 2),
        }
    prs = {
        "merged": len(merged),
        "per_day": rnd(len(merged) / days, 2) if days > 0 else None,
        "open_to_merge": dist(opened),
        "with_red": len(first_red),
        "open_to_first_red": dist(first_red),
        "queue": dist(queue),
        "queue_na": len(merged) - len(queue),
        "queue_entries": sum(entries),
        "requeued": sum(1 for n in entries if n > 1),
    }

    # main's red stretches: its runs in the window, its last decided run
    # before it (a stretch may have begun there) and the runs after it that
    # close a stretch, both as `collect` read them, with their jobs. main's
    # runs before the window in `ci` are listed copies whose jobs were not
    # read, whose final conclusion a re-run or a superseded run would make
    # green: they are not read here.
    mains = [r for r in runs if is_main(r) and ts(r["created_at"]) >= since]
    mains += [r for r in data.get("main_after", []) if not r.get("unread")]
    before = [r for r in data.get("main_before", []) if verdict(r) in ("green", "red")]
    if before:
        mains.append(max(before, key=lambda r: r["created_at"]))
    stretches = main_red(mains, since, until)

    green_pr = [r for r in window if r.get("event") == "pull_request" and verdict(r) == "green"]
    green = [r for r in window if verdict(r) == "green"]
    others = {f: [r for r in data["other"].get(f, []) if not r.get("unread")] for f, _ in OTHER}
    out = {
        "repo": REPO,
        "since": iso(since),
        "until": iso(until),
        "classifier": "files, by ci.yml's lanes",
        "rows": rows,
        "red_runs": red_runs,
        "failing_jobs": dict(sorted(failing.items(), key=lambda kv: (-kv[1], natural(kv[0])))),
        "prs": prs,
        "main_red": {
            "stretches": stretches,
            "minutes": rnd(sum(w["minutes"] or 0 for w in stretches)),
        },
        "shards": shard_stats(green_pr),
        "jobs": job_stats(green),
        "workflows": {name: workflow_runs(others[f], since, until) for f, name in OTHER},
    }
    unread_runs = sum(1 for r in data["ci"] if r.get("unread")) + sum(
        1 for rs in data["other"].values() for r in rs if r.get("unread")
    )
    unread_prs = sum(1 for p in data["prs"] if "kind" in p and p["kind"] is None)
    if unread_runs or unread_prs:
        out["unread"] = {"runs": unread_runs, "prs": unread_prs}
    return out


def shard_stats(runs) -> dict:
    """Each shard's time on runs that ran all N, by N."""
    groups = defaultdict(list)
    for r in runs:
        seen, n = {}, None
        for j in first_attempt(r.get("jobs")):
            m = SHARD.match(j.get("name", ""))
            if m and j.get("conclusion") == "success":
                seen[int(m.group(1))] = (ts(j["started_at"]), ts(j["completed_at"]))
                n = int(m.group(2))
        if n and len(seen) == n:
            groups[n].append(seen)
    out = {}
    for n in sorted(groups):
        rs = groups[n]
        times = [{k: mins(a, b) for k, (a, b) in s.items()} for s in rs]
        each = {}
        for k in range(1, n + 1):
            xs = [t[k] for t in times]
            each[str(k)] = {"median": rnd(pct(xs, 0.5)), "max": rnd(max(xs))}
        out[str(n)] = {
            "runs": len(rs),
            "shard": each,
            "all": dist(x for t in times for x in t.values()),
            "spread": dist(max(t.values()) - min(t.values()) for t in times),
            "total": dist(sum(t.values()) for t in times),
            "wall": dist(mins(min(a for a, _ in s.values()), max(b for _, b in s.values())) for s in rs),
        }
    return out


def job_stats(runs) -> dict:
    """Each job's minutes on green runs, by folded name, with the Coverage
    chain as one more."""
    times = defaultdict(list)
    for r in runs:
        cov = []
        for j in first_attempt(r.get("jobs")):
            if j.get("conclusion") != "success" or not ran(j):
                continue
            a, b = ts(j.get("started_at")), ts(j.get("completed_at"))
            times[fold(j["name"])].append(mins(a, b))
            if j["name"].startswith("Coverage"):
                cov.append((a, b))
        built = any(j.get("name") == "Coverage build" and ran(j) for j in first_attempt(r.get("jobs")))
        if built and cov:
            times["Coverage, build to report"].append(mins(min(a for a, _ in cov), max(b for _, b in cov)))
    return {name: dist(times[name]) for name in sorted(times, key=natural)}


def workflow_runs(runs, since, until) -> dict:
    """A workflow's runs in the window, each by its first attempt: the red
    ones, the green ones that ran more than one job (not only the job that
    decides there is nothing to run), and the green ones' minutes from
    created to the last first-attempt job done."""
    rs = [r for r in runs if r.get("status") == "completed" and in_window(r, since, until)]
    green = [
        r
        for r in rs
        if workflow_verdict(r) == "green" and sum(1 for j in first_attempt(r.get("jobs")) if ran(j)) > 1
    ]
    red = [r for r in rs if workflow_verdict(r) == "red"]

    def span(r):
        ends = [ts(j.get("completed_at")) for j in first_attempt(r.get("jobs")) if ran(j)]
        ends = [e for e in ends if e]
        return mins(ts(r["created_at"]), max(ends)) if ends else None

    return {
        "runs": len(green) + len(red),
        "green": len(green),
        "red": len(red),
        "wall_green": dist(span(r) for r in green),
    }


# ─── the headlines, and a saved run against today's ──────────────────────────


def widest(shard_groups: dict) -> str | None:
    """The whole browser tier's shard count: the largest N that ran (a PR
    that changes only specs runs fewer)."""
    return max(shard_groups, key=int) if shard_groups else None


def headline(s: dict) -> list:
    """(key, label, value, unit) for the numbers a comparison reads."""
    out = []
    for k in ROWS:
        r = s["rows"].get(k)
        if not r:
            continue
        name = LABEL[k]
        if "wall" in r:
            rate = None if r["red_rate"] is None else round(100 * r["red_rate"], 1)
            out += [
                (f"rows.{k}.wall.median", f"{name}: CI wall time, median", r["wall"]["median"], "min"),
                (f"rows.{k}.wall.p90", f"{name}: CI wall time, p90", r["wall"]["p90"], "min"),
                (f"rows.{k}.red_rate", f"{name}: red runs", rate, "%"),
                (
                    f"rows.{k}.wait_per_run.median",
                    f"{name}: required jobs' runner wait per run, median",
                    r["wait_per_run"]["median"],
                    "min",
                ),
                (
                    f"rows.{k}.longest_wait.median",
                    f"{name}: longest required-job wait per run, median",
                    r["longest_wait"]["median"],
                    "min",
                ),
            ]
        if "runs_per_pr" in r:
            out.append(
                (f"rows.{k}.runs_per_pr.median", f"{name}: runs per merged PR, median", r["runs_per_pr"]["median"], "")
            )
    p = s["prs"]
    out += [
        ("prs.per_day", "PRs merged a day", p["per_day"], ""),
        ("prs.open_to_merge.median", "Open to merge, median", p["open_to_merge"]["median"], "min"),
        ("prs.open_to_merge.p90", "Open to merge, p90", p["open_to_merge"]["p90"], "min"),
        ("prs.open_to_first_red.median", "Open to first red, median", p["open_to_first_red"]["median"], "min"),
        ("prs.queue.median", "In the queue, entered to merged, median", p["queue"]["median"], "min"),
        ("main_red.minutes", "main red, minutes in all", s["main_red"]["minutes"], "min"),
    ]
    n = widest(s["shards"])
    if n:
        g = s["shards"][n]
        out += [
            ("shards.n", "Browser shards in the whole tier", int(n), ""),
            ("shards.shard.median", "Browser shard, median", g["all"]["median"], "min"),
            ("shards.shard.max", "Browser shard, max", g["all"]["max"], "min"),
            ("shards.spread.median", "Browser shards' spread, median", g["spread"]["median"], "min"),
            ("shards.wall.median", "Browser tier, first shard start to last end, median", g["wall"]["median"], "min"),
        ]
    return out


def compare(base: dict, now: dict) -> list:
    """Each headline in either run: label, base, now, change (None where
    either is missing)."""
    b = {k: (label, v, u) for k, label, v, u in headline(base)}
    n = {k: (label, v, u) for k, label, v, u in headline(now)}
    keys = [k for k, *_ in headline(now)] + [k for k, *_ in headline(base) if k not in n]
    out = []
    for k in keys:
        label, unit = (n.get(k) or b.get(k))[0], (n.get(k) or b.get(k))[2]
        bv, nv = (b.get(k) or (None, None, None))[1], (n.get(k) or (None, None, None))[1]
        numbers = isinstance(bv, (int, float)) and isinstance(nv, (int, float))
        out.append(
            {
                "key": k,
                "label": label,
                "unit": unit,
                "base": bv,
                "now": nv,
                "change": round(nv - bv, 2) if numbers else None,
            }
        )
    return out


# ─── Markdown ────────────────────────────────────────────────────────────────


def num(v, digits: int = 1) -> str:
    if v is None:
        return "n/a"
    if isinstance(v, int):
        return str(v)
    return f"{v:.{digits}f}"


def pair(d: dict) -> str:
    return f"{num(d['median'])} / {num(d['p90'])}" if d and d.get("n") else "n/a"


def window_text(since: str, until: str) -> str:
    a, b = ts(since), ts(until)
    if a.time() == dt.time(0) and b.time() == dt.time(0):
        last = b - DAY
        if last.date() == a.date():
            return f"{a:%Y-%m-%d} (UTC)"
        return f"{a:%Y-%m-%d} to {last:%Y-%m-%d} (UTC, both days in)"
    return f"{a:%Y-%m-%d %H:%M} to {b:%Y-%m-%d %H:%M} UTC"


def markdown(s: dict, cmp: list | None = None, base_name: str | None = None) -> str:
    L = []
    w = L.append
    w(f"## CI health, {window_text(s['since'], s['until'])}")
    w("")
    if s.get("stopped"):
        u = s.get("unread", {})
        w(
            f"**Stopped at GitHub's rate limit** ({s['stopped']}): the jobs of {u.get('runs', 0)} run(s) and "
            f"the files of {u.get('prs', 0)} PR(s) were not read, and what follows leaves them out. What was "
            "read is in the cache, so the next run goes on from there."
        )
        w("")
    w(
        "*`scripts/ci_stats.py`: `ci.yml` runs created in the window, the PRs merged in it, minutes "
        "unless marked. A run's verdict and wall time are its first attempt's `CI` job (a queue "
        "batch's `Full gate`, the check the queue merges on). Runner waits are the required jobs' "
        "unless marked.*"
    )
    w("")
    w("### By kind of PR (the fast lane), the queue, and main")
    w("")
    w(
        "| Kind | Runs | Green | Red | Cancelled | Red rate | CI wall, median / p90 "
        "| Runner wait per run, median / p90 | Longest job wait, median | Longest wait of all jobs, median "
        "| Job wait, median (s) | Merged PRs | Runs per PR, median / mean |"
    )
    w("| --- |" + " ---: |" * 12)
    for k in ROWS:
        r = s["rows"].get(k)
        if not r:
            continue
        rp = r.get("runs_per_pr")
        cells = [LABEL[k], num(r.get("runs", 0))]
        if "wall" in r:
            rate = "n/a" if r["red_rate"] is None else f"{100 * r['red_rate']:.0f}%"
            job_wait = r["job_wait"]["median"]
            cells += [
                num(r["green"]),
                num(r["red"]),
                num(r["cancelled"]),
                rate,
                pair(r["wall"]),
                pair(r["wait_per_run"]),
                num(r["longest_wait"]["median"]),
                num(r["longest_wait_all"]["median"]),
                num(None if job_wait is None else 60 * job_wait, 0),
            ]
        else:
            cells += ["0", "0", "0", "n/a", "n/a", "n/a", "n/a", "n/a", "n/a"]
        cells += [num(rp["prs"]) if rp else "", f"{num(rp['median'])} / {num(rp['mean'], 2)}" if rp else ""]
        w("| " + " | ".join(cells) + " |")
    notes = []
    reruns = sum(r.get("reruns", 0) for r in s["rows"].values())
    if reruns:
        notes.append(f"Re-run by hand: {reruns} run(s), each counted by its first attempt.")
    idle = s["rows"].get("main", {}).get("no_verdict", 0)
    if idle:
        notes.append(f"On main, {idle} run(s) ran nothing (main had moved past them) and have no verdict.")
    if notes:
        w("")
        w(" ".join(notes))
    w("")
    w("### Red runs, and the job that failed")
    w("")
    if not s["red_runs"]:
        w("None.")
    for r in s["red_runs"]:
        where = f"#{r['pr']}, {LABEL[r['row']]}" if r["pr"] else LABEL[r["row"]]
        link = f"[{r['run']}]({r['url']})" if r.get("url") else str(r["run"])
        w(f"- {link} ({where}): {', '.join(r['jobs']) or 'no job named'}")
    if s["failing_jobs"]:
        w("")
        w("Failed, by job: " + ", ".join(f"{name} {n}" for name, n in s["failing_jobs"].items()) + ".")
    w("")
    p = s["prs"]
    w("### Pull requests merged")
    w("")
    w(
        "| Merged | A day | Open to merge, median / p90 | With a red run | Open to first red, median / p90 "
        "| In the queue, entered to merged, median / p90 | Times entered | Entered more than once |"
    )
    w("| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |")
    q = pair(p["queue"]) + (f" (n/a for {p['queue_na']})" if p["queue_na"] else "")
    w(
        f"| {p['merged']} | {num(p['per_day'], 2)} | {pair(p['open_to_merge'])} | {p['with_red']} "
        f"| {pair(p['open_to_first_red'])} | {q} | {p['queue_entries']} | {p['requeued']} |"
    )
    w("")
    w("### main")
    w("")
    st = s["main_red"]["stretches"]
    if not st:
        w("main was never red.")
    else:
        w(f"Red {len(st)} time(s), {num(s['main_red']['minutes'])} minutes in all:")
        for x in st:
            end = f"green at {x['to']} (run {x['green_run']})" if x["to"] else "still red at the window's end"
            start = f"from {x['from']}" + (" (red since before the window)" if x.get("clipped") else "")
            w(f"- {start}, {num(x['minutes'])} min, {end}; red runs {', '.join(map(str, x['red_runs']))}")
    w("")
    w("### Browser shards, on green PR and queue runs that ran every shard")
    w("")
    if not s["shards"]:
        w("No green PR or queue run ran the whole browser tier.")
    for n, g in sorted(s["shards"].items(), key=lambda kv: -kv[1]["runs"]):
        w(
            f"**{n} shard{'s' if n != '1' else ''}**, {g['runs']} run(s). "
            f"A shard: median {num(g['all']['median'])}, max {num(g['all']['max'])}. "
            f"Spread (slowest minus fastest): median {num(g['spread']['median'])}, max {num(g['spread']['max'])}. "
            f"First start to last end: median {num(g['wall']['median'])}, p90 {num(g['wall']['p90'])}. "
            f"Runner-minutes a run: median {num(g['total']['median'])}."
        )
        w("")
        w("| Shard | " + " | ".join(g["shard"]) + " |")
        w("| --- |" + " ---: |" * len(g["shard"]))
        w("| Median | " + " | ".join(num(v["median"]) for v in g["shard"].values()) + " |")
        w("| Max | " + " | ".join(num(v["max"]) for v in g["shard"].values()) + " |")
        w("")
    w("### Jobs, on green runs")
    w("")
    w("| Job | Runs | Median | p90 | Max |")
    w("| --- | ---: | ---: | ---: | ---: |")
    for name, d in s["jobs"].items():
        w(f"| {name} | {d['n']} | {num(d['median'])} | {num(d['p90'])} | {num(d['max'])} |")
    for name, d in s["workflows"].items():
        g = d["wall_green"]
        w(
            f"| {name} (a green run, created to done; {d['red']} red) "
            f"| {g['n']} | {num(g['median'])} | {num(g['p90'])} | {num(g['max'])} |"
        )
    if cmp is not None:
        w("")
        w(f"### Against {base_name or 'the base'}")
        w("")
        w("| | Base | Now | Change |")
        w("| --- | ---: | ---: | ---: |")
        for c in cmp:
            unit = {"": "", "%": " points"}.get(c["unit"], f" {c['unit']}")
            ch = "n/a" if c["change"] is None else f"{c['change']:+.1f}{unit}"
            w(f"| {c['label']} | {num(c['base'])} | {num(c['now'])} | {ch} |")
    return "\n".join(L) + "\n"


# ─── the API ─────────────────────────────────────────────────────────────────


class ApiError(RuntimeError):
    pass


class RateLimited(ApiError):
    """GitHub's rate limit: nothing more can be read for now."""


def limited(stderr: str) -> bool:
    """Whether a refusal is the rate limit: an HTTP 429, or an HTTP 403 that
    says so or that comes with the limit at 0 (`gh api rate_limit` costs
    nothing against it)."""
    if "HTTP 429" in stderr:
        return True
    if "HTTP 403" not in stderr:
        return False
    if re.search(r"rate limit", stderr, re.I):
        return True
    p = subprocess.run(
        ["gh", "api", "rate_limit", "-q", ".resources.core.remaining"], capture_output=True, text=True
    )
    return p.returncode == 0 and p.stdout.strip() == "0"


def gh(url: str, paginate: bool, tries: int = 3) -> str:
    """`gh api` GET of one URL, every page when paginate. A server error
    (HTTP 5xx: GitHub's, not the request's) is asked again, twice at most;
    the rate limit raises RateLimited."""
    cmd = ["gh", "api", "-X", "GET", "-H", "Accept: application/vnd.github+json"]
    if paginate:
        cmd.append("--paginate")
    for attempt in range(1, tries + 1):
        p = subprocess.run(cmd + [url], capture_output=True, text=True)
        if p.returncode == 0:
            return p.stdout
        error = f"gh api {url}: {p.stderr.strip() or p.returncode}"
        if limited(p.stderr):
            raise RateLimited(error)
        if attempt == tries or not re.search(r"HTTP 5\d\d", p.stderr):
            raise ApiError(error)
        time.sleep(2 * attempt)
    raise AssertionError("unreachable")


def decode_all(text: str) -> list:
    """Every JSON value in text, one after another (`gh api --paginate`
    prints each page as it comes)."""
    out, i, dec = [], 0, json.JSONDecoder()
    text = text.strip()
    while i < len(text):
        obj, i = dec.raw_decode(text, i)
        out.append(obj)
        while i < len(text) and text[i].isspace():
            i += 1
    return out


class GitHub:
    """GET requests to the repository's API, kept on disk when asked to.
    Once the rate limit is reached (`stopped`), every request after it is
    refused here without being sent."""

    def __init__(self, repo: str = REPO, cache: str = CACHE, fetch=gh):
        self.repo, self.cache, self.fetch = repo, cache, fetch
        self.fetched = self.reused = 0
        self.stopped = None
        self.lock = threading.Lock()

    def url(self, path: str, params: dict | None = None) -> str:
        q = urllib.parse.urlencode(params or {}, safe=":.")
        return f"repos/{self.repo}/{path}" + (f"?{q}" if q else "")

    def file(self, url: str) -> str:
        return os.path.join(self.cache, hashlib.sha256(url.encode()).hexdigest() + ".json")

    def get(
        self, path: str, params: dict | None = None, key: str | None = None, paginate: bool = False, keep: bool = False
    ):
        """The response, its pages joined: a list from `key` (or from array
        pages), else the one object. keep: read it from the cache, or write
        it there, as it can no longer change."""
        url = self.url(path, params)
        file = self.file(url)
        if keep and os.path.exists(file):
            with open(file) as f:
                saved = json.load(f)
            if saved.get("url") == url:
                with self.lock:
                    self.reused += 1
                return saved["data"]
        if self.stopped:
            raise RateLimited(self.stopped)
        try:
            pages = decode_all(self.fetch(url, paginate))
        except RateLimited as e:
            with self.lock:
                self.stopped = self.stopped or str(e)
            raise
        with self.lock:
            self.fetched += 1
        if key is not None:
            data = [x for page in pages for x in page.get(key, [])]
        elif pages and all(isinstance(page, list) for page in pages):
            data = [x for page in pages for x in page]
        else:
            data = pages[0] if pages else None
        if keep:
            os.makedirs(self.cache, exist_ok=True)
            tmp = f"{file}.{os.getpid()}.{threading.get_ident()}.tmp"
            with open(tmp, "w") as f:
                json.dump({"url": url, "data": data}, f)
            os.replace(tmp, file)
        return data

    def get_or_none(self, *args, **kwargs):
        """The response, or None when the API refuses it (a token without
        the scope, say, or the rate limit): the number it feeds is then n/a."""
        try:
            return self.get(*args, **kwargs)
        except RateLimited:
            return None
        except ApiError as e:
            print(f"ci_stats: {e}", file=sys.stderr)
            return None


def list_runs(api: GitHub, workflow: str, start: dt.datetime, end: dt.datetime, **filters) -> list:
    """A workflow's runs created in [start, end), a day per query (the
    filtered list stops at 1,000), each run once."""
    seen = {}
    t = start
    while t < end:
        u = min(t + DAY, end)
        params = {"created": f"{iso(t)}..{iso(u)}", "per_page": 100, **filters}
        for r in api.get(f"actions/workflows/{workflow}/runs", params, key="workflow_runs", paginate=True):
            seen[r["id"]] = r
        t = u
    return sorted((r for r in seen.values() if start <= ts(r["created_at"]) < end), key=lambda r: r["created_at"])


def list_prs(api: GitHub, since: dt.datetime) -> list:
    """Every PR updated since a day before `since`: one that ran or merged
    in the window was updated in it. Newest first, a page at a time, until a
    short page or one that ends before then."""
    out = []
    for page in range(1, 100):
        params = {"state": "all", "sort": "updated", "direction": "desc", "per_page": 100, "page": page}
        batch = api.get("pulls", params) or []
        out += batch
        if len(batch) < 100 or ts(batch[-1]["updated_at"]) < since - DAY:
            break
    return [
        {
            "number": p["number"],
            "title": p["title"],
            "branch": p["head"]["ref"],
            "created_at": p["created_at"],
            "closed_at": p.get("closed_at"),
            "merged_at": p.get("merged_at"),
        }
        for p in out
    ]


def jobs_of(api: GitHub, run) -> None:
    """Read the run's jobs into it, kept once the run has completed; at the
    rate limit, mark it `unread`."""
    try:
        run["jobs"] = api.get(
            f"actions/runs/{run['id']}/jobs",
            {"filter": "all", "per_page": 100},
            key="jobs",
            paginate=True,
            keep=run.get("status") == "completed",
        )
    except RateLimited:
        run["unread"] = True


def main_before(api: GitHub, since: dt.datetime) -> list:
    """main's last run before `since` that has a verdict (a red stretch may
    have begun there), with its jobs; none when there is none."""
    params = {"branch": "main", "event": "push", "created": f"<{iso(since)}", "per_page": 20}
    for r in api.get("actions/workflows/ci.yml/runs", params, key="workflow_runs"):
        if r.get("status") != "completed":
            continue
        jobs_of(api, r)
        if r.get("unread"):
            return []
        if verdict(r) in ("green", "red"):
            return [r]
    return []


def main_after(api: GitHub, runs) -> list:
    """main's runs after the window, with their jobs, up to the first green
    one (the one that closes a stretch still red at the window's end)."""
    out = []
    for r in runs:
        if r.get("status") != "completed":
            continue
        jobs_of(api, r)
        if r.get("unread"):
            break
        out.append(r)
        if verdict(r) == "green":
            break
    return out


def collect(api: GitHub, since: dt.datetime, until: dt.datetime, now: dt.datetime, workers: int = 8) -> dict:
    """Everything `measure` reads, from the API. At the rate limit, what
    could not be read is marked (a run `unread`, a PR's kind None)."""
    end = min(until, now)
    prs = list_prs(api, since)
    merged = [p for p in prs if p["merged_at"] and since <= ts(p["merged_at"]) < until]
    start = max(min([since] + [ts(p["created_at"]) for p in merged]), since - LOOKBACK)
    ci = list_runs(api, "ci.yml", start, end)
    after = list_runs(api, "ci.yml", end, min(end + 3 * DAY, now), branch="main", event="push") if end < now else []
    after = main_after(api, after)
    other = {f: list_runs(api, f, since, end) for f, _ in OTHER}
    before = main_before(api, since)

    # Only what a number reads, as a nightly's token has 1,000 requests an
    # hour: the jobs of the window's runs and of the merged PRs' earlier
    # ones; of the other workflows' runs, the green ones and those re-run
    # (whose first attempt the final conclusion does not tell); and the
    # files of the PRs those runs belong to.
    branches = by_branch(prs)
    in_merged = {p["number"] for p in merged}
    wanted = {p["number"]: p for p in merged}
    need = []
    for r in ci:
        p = pr_for(r, branches)
        if since <= ts(r["created_at"]):
            need.append(r)
            if p is not None:
                wanted[p["number"]] = p
        elif p is not None and p["number"] in in_merged:
            need.append(r)
    need += [
        r
        for rs in other.values()
        for r in rs
        if r.get("conclusion") == "success" or r.get("run_attempt", 1) > 1
    ]

    def files_of(p):
        closed = p["closed_at"] is not None
        try:
            files = api.get(f"pulls/{p['number']}/files", {"per_page": 100}, paginate=True, keep=closed)
        except RateLimited:
            p["kind"] = None
            return
        p["kind"] = classify(f["filename"] for f in files)
        if p["number"] in in_merged:
            p["comments"] = api.get_or_none(
                f"issues/{p['number']}/comments", {"per_page": 100}, paginate=True, keep=closed
            )

    with ThreadPoolExecutor(max_workers=workers) as pool:
        list(pool.map(lambda r: jobs_of(api, r), need))
        list(pool.map(files_of, list(wanted.values())))
    for p in prs:
        p.setdefault("kind", "docs")
    return {"ci": ci, "main_before": before, "main_after": after, "prs": prs, "other": other}


# ─── the command ─────────────────────────────────────────────────────────────


# The exit status of a run that stopped at the rate limit, after it wrote
# what it had read: not a whole measurement, and not to be kept as a base.
STOPPED = 3


def load_base(ap, path: str) -> dict:
    """A saved --format json run, whole: not Markdown, not one that stopped
    at the rate limit."""
    try:
        with open(path) as f:
            base = json.load(f)
    except (OSError, ValueError) as e:
        ap.error(f"--compare {path}: not a saved --format json run ({e})")
    if not isinstance(base, dict) or base.get("stopped") or "rows" not in base:
        ap.error(f"--compare {path}: a run that stopped at the rate limit, or not a run; not a base")
    return base


def main(argv=None, now: dt.datetime | None = None) -> int:
    ap = argparse.ArgumentParser(
        description=__doc__.split("\n\n")[0], formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--since", help="the window's first day or time (default: 7 days ago)")
    ap.add_argument("--until", help="its last day (included) or time (default: now; never later than now)")
    ap.add_argument("--format", choices=("md", "json"), default="md")
    ap.add_argument("--compare", metavar="BASE.json", help="a saved --format json run to compare the headlines with")
    args = ap.parse_args(argv)

    now = now or dt.datetime.now(UTC).replace(microsecond=0)
    until = min(parse_when(args.until, end=True), now) if args.until else now
    since = parse_when(args.since) if args.since else until - 7 * DAY
    if since >= until:
        ap.error("--since must come before --until")
    base = load_base(ap, args.compare) if args.compare else None

    api = GitHub()
    try:
        data = collect(api, since, until, now)
    except RateLimited as e:
        print(f"ci_stats: stopped at GitHub's rate limit before the lists were read: {e}", file=sys.stderr)
        if args.format == "json":
            json.dump({"stopped": str(e)}, sys.stdout, indent=1)
            sys.stdout.write("\n")
        else:
            print(f"## CI health, {window_text(iso(since), iso(until))}\n")
            print(
                f"**Stopped at GitHub's rate limit** ({e}) after {api.fetched} request(s), before the "
                "lists of runs and PRs were read, so there is nothing to report. What was read is in the "
                "cache, so the next run goes on from there."
            )
        return STOPPED
    stats = measure(data, since, until)
    stats["generated"] = iso(now)
    if api.stopped:
        stats["stopped"] = api.stopped
        stats.setdefault("unread", {"runs": 0, "prs": 0})
    print(f"ci_stats: {api.fetched} requests, {api.reused} from {os.path.relpath(CACHE, ROOT)}/", file=sys.stderr)

    cmp = compare(base, stats) if base is not None else None
    if args.format == "json":
        if cmp is not None:
            stats["compare"] = {"base": args.compare, "headlines": cmp}
        json.dump(stats, sys.stdout, indent=1)
        sys.stdout.write("\n")
    else:
        sys.stdout.write(markdown(stats, cmp, args.compare))
    if api.stopped:
        u = stats["unread"]
        print(
            f"ci_stats: stopped at GitHub's rate limit ({api.stopped}); what was read is reported, and "
            f"{u['runs']} run(s)' jobs and {u['prs']} PR(s)' files are left out. Exit {STOPPED}.",
            file=sys.stderr,
        )
        return STOPPED
    return 0


if __name__ == "__main__":
    sys.exit(main())
