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
a time (2026-10-06T09:00:00Z). The default is the 7 days up to now.

It reads the Actions and pull request APIs through `gh api`, GET only, so it
uses gh's own login, or GH_TOKEN in CI. What can no longer change is kept
under `.cache/ci_stats/` (gitignored), keyed by URL: the jobs of a completed
run, and the files, timeline and comments of a closed PR. A second run over
the same window fetches only the lists and what is still in flight.

What it counts, with the definitions #177's numbers used:
- A run is a `ci.yml` run. Its verdict is its first attempt's `CI` job: green
  (success), red (failure or timed out) or cancelled. A re-run is counted
  (`reruns`), not believed.
- The kind of PR comes from the PR's files, the first match winning: Rust
  (crates/, Cargo.*, rust-toolchain), CI (.github/, .mergify.yml, Makefile,
  scripts/, .config/), web (apps/web/, tests/web/), and docs only (anything
  else). A run belongs to the PR whose branch it ran on while the PR was open.
  A push to main has no PR: it is a row of its own.
- CI wall time: the run created to its `CI` job completed, on green and red
  runs.
- Runner wait: each job's start minus its creation, summed per run; and the
  longest one in the run (the last shard to get a runner); and every job's.
- Red rate: red runs of the green and red ones; cancelled runs are left out.
- Runs per PR: the `ci.yml` runs on a merged PR's branch while it was open.
- Open to merge, PRs merged a day, and open to the first red (that run's
  `CI` completed): over the PRs merged in the window.
- main red: from a red run's `CI` completed on main to the next green run's
  `CI` completed on main. Consecutive reds are one stretch.
- Queue time: from the PR's first `queue` label (its timeline) or
  `@mergifyio queue` comment, whichever is first, to the merge; n/a when it
  has neither (a merge by hand, before Mergify).
- Shards: each `Browser (k/N)` job's time on the green PR runs that ran all N,
  grouped by N. The spread is a run's slowest shard minus its fastest. The
  headlines read the largest N, the whole tier (a PR that changes only specs
  runs fewer).
- Jobs: each job's time on green runs, by name with the shard numbers folded
  (`Browser (k/12)`); the Coverage chain from its build's start to its
  report's end; and the Slow suite's and the Flake hunt's runs, created to
  their last job done.

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
ROWS = ("rust", "ci", "web", "docs", "unmatched", "main")
LABEL = {
    "rust": "Rust",
    "ci": "CI",
    "web": "Web",
    "docs": "Docs only",
    "unmatched": "No PR found",
    "main": "main (push)",
}
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

# ci.yml's `changes` job, simplified to one kind per PR.
RUST = re.compile(r"^(crates/|Cargo\.(toml|lock)$|rust-toolchain)")
CI = re.compile(r"^(\.github/|\.mergify\.yml$|Makefile$|scripts/|\.config/)")
WEB = re.compile(r"^(apps/web/|tests/web/)")


def classify(files) -> str:
    """rust, ci, web or docs: the first kind any of the PR's files is."""
    files = list(files)
    for kind, pattern in (("rust", RUST), ("ci", CI), ("web", WEB)):
        if any(pattern.match(f) for f in files):
            return kind
    return "docs"


# ─── a run and its jobs ──────────────────────────────────────────────────────

SHARD = re.compile(r"^Browser \((\d+)/(\d+)\)$")
VERDICT = {"success": "green", "failure": "red", "timed_out": "red", "cancelled": "cancelled", "skipped": "cancelled"}


def first_attempt(jobs) -> list:
    return [j for j in jobs or [] if j.get("run_attempt", 1) == 1]


def ci_job(run) -> dict | None:
    for j in first_attempt(run.get("jobs")):
        if j.get("name") == "CI":
            return j
    return None


def verdict(run) -> str | None:
    """green, red or cancelled, from the first attempt's `CI` job; None while
    it runs. `CI` fails when a job it needs was cancelled, with nothing else
    failed: that run was cancelled when the run itself was (a newer push
    replaced it), and red otherwise (a job reached its time limit). A run
    with no jobs read falls back on its own conclusion."""
    if run.get("status") != "completed":
        return None
    j = ci_job(run)
    if j is None:
        if run.get("run_attempt", 1) == 1 or not run.get("jobs"):
            return VERDICT.get(run.get("conclusion"))
        return None
    v = VERDICT.get(j.get("conclusion"))
    if v == "red" and not any(
        x.get("conclusion") in ("failure", "timed_out") for x in first_attempt(run.get("jobs")) if x.get("name") != "CI"
    ):
        if run.get("run_attempt", 1) == 1 and run.get("conclusion") == "cancelled":
            return "cancelled"
    return v


def ci_done(run) -> dt.datetime | None:
    """When the first attempt's `CI` job completed (the run's last update
    when its jobs were not read)."""
    j = ci_job(run)
    if j is not None:
        return ts(j.get("completed_at"))
    return ts(run.get("updated_at")) if not run.get("jobs") else None


def wall(run) -> float | None:
    return mins(ts(run["created_at"]), ci_done(run))


def ran(job) -> bool:
    return bool(job.get("runner_name")) and job.get("conclusion") not in (None, "skipped")


def waits(run) -> list:
    """Minutes each first-attempt job that got a runner waited for it."""
    out = []
    for j in first_attempt(run.get("jobs")):
        w = mins(ts(j.get("created_at")), ts(j.get("started_at"))) if ran(j) else None
        if w is not None and w >= 0:
            out.append(w)
    return out


def failed_jobs(run) -> list:
    """The first attempt's failed jobs; when only `CI` failed, the jobs that
    were cancelled under it (at their time limit), marked so."""
    jobs = first_attempt(run.get("jobs"))
    names = [j["name"] for j in jobs if j.get("conclusion") in ("failure", "timed_out") and j.get("name") != "CI"]
    if not names:
        names = [f"{j['name']} (cancelled)" for j in jobs if j.get("conclusion") == "cancelled"] or ["CI"]
    return sorted(names, key=natural)


def natural(s: str):
    return [int(p) if p.isdigit() else p for p in re.split(r"(\d+)", s)]


def fold(name: str) -> str:
    """A job's name with its shard number folded: `Browser (3/12)` is
    `Browser (k/12)`."""
    return re.sub(r"\((\d+)/(\d+)\)", r"(k/\2)", name)


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
    the PR's record, to when it closed)."""
    if run.get("event") != "pull_request":
        return None
    t = ts(run["created_at"])
    for p in branches.get(run.get("head_branch"), []):
        start = ts(p["created_at"]) - dt.timedelta(minutes=2)
        end = ts(p.get("closed_at")) or FAR
        if start <= t <= end:
            return p
    return None


def row_of(run, branches) -> str | None:
    if run.get("event") == "push" and run.get("head_branch") == "main":
        return "main"
    if run.get("event") != "pull_request":
        return None
    p = pr_for(run, branches)
    return p["kind"] if p else "unmatched"


# ─── the queue ───────────────────────────────────────────────────────────────

QUEUE_COMMAND = re.compile(r"^\s*@mergify(io)?\s+queue\b", re.I | re.M)


def queued_at(timeline, comments) -> dt.datetime | None:
    """When the PR first went into the queue: its first `queue` label or
    `@mergifyio queue` comment (not a bot's), whichever is first. None when
    it has neither."""
    times = []
    for e in timeline or []:
        if e.get("event") == "labeled" and (e.get("label") or {}).get("name") == "queue":
            times.append(ts(e.get("created_at")))
    for c in comments or []:
        if (c.get("user") or {}).get("type") == "Bot":
            continue
        if QUEUE_COMMAND.search(c.get("body") or ""):
            times.append(ts(c.get("created_at")))
    times = [t for t in times if t is not None]
    return min(times) if times else None


# ─── main's red stretches ────────────────────────────────────────────────────


def main_red(runs, until: dt.datetime) -> list:
    """Each stretch main stayed red: from the first red run's `CI` completed
    to the next green run's, in the order the runs were created. A stretch
    still open at the end is measured to `until` and has no `to`."""
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
    for w in out:
        w["minutes"] = rnd(mins(w["from"], w["to"] or until))
        w["from"] = iso(w["from"]) if w["from"] else None
        w["to"] = iso(w["to"]) if w["to"] else None
    return out


# ─── the numbers ─────────────────────────────────────────────────────────────


def in_window(run, since, until) -> bool:
    return since <= ts(run["created_at"]) < until


def measure(data: dict, since: dt.datetime, until: dt.datetime) -> dict:
    """Every number, from what `collect` read (or a test wrote): `ci` (ci.yml
    runs, each with its `jobs`), `main_after` (main's runs after the window,
    without jobs, to close a red stretch), `prs` (each with `kind`, and
    `timeline` and `comments` when merged in the window; None when they could
    not be read) and `other` (each OTHER workflow's runs, with their jobs)."""
    branches = by_branch(data["prs"])
    runs = [r for r in data["ci"] if r.get("status") == "completed"]
    window = [r for r in runs if in_window(r, since, until)]

    # By kind of PR.
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
            "reruns": sum(1 for r in rs if r.get("run_attempt", 1) > 1),
            "red_rate": rnd(v["red"] / (v["green"] + v["red"]), 3) if decided else None,
            "wall": dist(wall(r) for r in decided),
            "wait_per_run": dist(sum(x) for x in w),
            "longest_wait": dist(max(x, default=0) for x in w),
            "job_wait": dist((y for x in w for y in x), 2),
        }
        for r in rs:
            if verdict(r) == "red":
                p = pr_for(r, branches)
                failed = failed_jobs(r)
                failing.update(fold(n) for n in failed)
                red_runs.append(
                    {"run": r["id"], "url": r.get("html_url"), "row": k, "pr": p["number"] if p else None, "jobs": failed}
                )

    # The PRs merged in the window, and every run of theirs.
    runs_of = defaultdict(list)
    for r in runs:
        p = pr_for(r, branches)
        if p is not None:
            runs_of[p["number"]].append(r)
    merged = [p for p in data["prs"] if p.get("merged_at") and since <= ts(p["merged_at"]) < until]
    days = (until - since).total_seconds() / 86400
    opened, first_red, queue, no_queue, per_kind = [], [], [], 0, defaultdict(list)
    for p in merged:
        c, m = ts(p["created_at"]), ts(p["merged_at"])
        opened.append(mins(c, m))
        mine = runs_of[p["number"]]
        per_kind[p["kind"]].append(len(mine))
        reds = [ci_done(r) for r in mine if verdict(r) == "red" and ci_done(r)]
        if reds:
            first_red.append(mins(c, min(reds)))
        q = queued_at(p.get("timeline"), p.get("comments"))
        if q is None:
            no_queue += 1
        else:
            queue.append(mins(q, m))
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
        "queue_na": no_queue,
    }

    # main's red stretches: its runs in the window, then the ones after it
    # that close a stretch.
    mains = [r for r in runs if r.get("event") == "push" and r.get("head_branch") == "main"]
    mains = [r for r in mains if ts(r["created_at"]) >= since] + list(data.get("main_after", []))
    stretches = [w for w in main_red(mains, until) if w["from"] and ts(w["from"]) < until]

    green_pr = [r for r in window if r.get("event") == "pull_request" and verdict(r) == "green"]
    green = [r for r in window if verdict(r) == "green"]
    return {
        "repo": REPO,
        "since": iso(since),
        "until": iso(until),
        "classifier": "files",
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
        "workflows": {name: workflow_runs(data["other"].get(f, []), since, until) for f, name in OTHER},
    }


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
        out[str(n)] = {
            "runs": len(rs),
            "shard": {str(k): {"median": rnd(pct([t[k] for t in times], 0.5)), "max": rnd(max(t[k] for t in times))} for k in range(1, n + 1)},
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
        if any(j.get("name") == "Coverage build" and ran(j) for j in first_attempt(r.get("jobs"))) and cov:
            times["Coverage, build to report"].append(mins(min(a for a, _ in cov), max(b for _, b in cov)))
    return {name: dist(times[name]) for name in sorted(times, key=natural)}


def workflow_runs(runs, since, until) -> dict:
    """A workflow's runs in the window: the red ones, the green ones that ran
    more than one job (not only the job that decides there is nothing to
    run), and the green ones' minutes from created to the last first-attempt
    job done."""
    rs = [r for r in runs if r.get("status") == "completed" and in_window(r, since, until)]
    green = [r for r in rs if r.get("conclusion") == "success" and sum(1 for j in first_attempt(r.get("jobs")) if ran(j)) > 1]
    red = [r for r in rs if r.get("conclusion") == "failure"]

    def span(r):
        ends = [ts(j.get("completed_at")) for j in first_attempt(r.get("jobs")) if ran(j)]
        return mins(ts(r["created_at"]), max(e for e in ends if e)) if any(ends) else None

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
            out += [
                (f"rows.{k}.wall.median", f"{name}: CI wall time, median", r["wall"]["median"], "min"),
                (f"rows.{k}.wall.p90", f"{name}: CI wall time, p90", r["wall"]["p90"], "min"),
                (f"rows.{k}.red_rate", f"{name}: red runs", None if r["red_rate"] is None else round(100 * r["red_rate"], 1), "%"),
                (f"rows.{k}.wait_per_run.median", f"{name}: runner wait per run, median", r["wait_per_run"]["median"], "min"),
                (f"rows.{k}.longest_wait.median", f"{name}: longest job wait per run, median", r["longest_wait"]["median"], "min"),
            ]
        if "runs_per_pr" in r:
            out.append((f"rows.{k}.runs_per_pr.median", f"{name}: runs per merged PR, median", r["runs_per_pr"]["median"], ""))
    p = s["prs"]
    out += [
        ("prs.per_day", "PRs merged a day", p["per_day"], ""),
        ("prs.open_to_merge.median", "Open to merge, median", p["open_to_merge"]["median"], "min"),
        ("prs.open_to_merge.p90", "Open to merge, p90", p["open_to_merge"]["p90"], "min"),
        ("prs.open_to_first_red.median", "Open to first red, median", p["open_to_first_red"]["median"], "min"),
        ("prs.queue.median", "Queue to merge, median", p["queue"]["median"], "min"),
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
        delta = round(nv - bv, 2) if isinstance(bv, (int, float)) and isinstance(nv, (int, float)) else None
        out.append({"key": k, "label": label, "unit": unit, "base": bv, "now": nv, "change": delta})
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
    w(
        "*`scripts/ci_stats.py`: `ci.yml` runs created in the window, the PRs merged in it, minutes "
        "unless marked. A run's verdict is its first attempt's `CI` job.*"
    )
    w("")
    w("### By kind of PR")
    w("")
    w(
        "| Kind | Runs | Green | Red | Cancelled | Red rate | CI wall, median / p90 | Runner wait per run, median / p90 "
        "| Longest job wait, median | Job wait, median (s) | Merged PRs | Runs per PR, median / mean |"
    )
    w("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |")
    for k in ROWS:
        r = s["rows"].get(k)
        if not r:
            continue
        rp = r.get("runs_per_pr")
        cells = [LABEL[k], num(r.get("runs", 0))]
        if "wall" in r:
            rate = "n/a" if r["red_rate"] is None else f"{100 * r['red_rate']:.0f}%"
            cells += [
                num(r["green"]),
                num(r["red"]),
                num(r["cancelled"]),
                rate,
                pair(r["wall"]),
                pair(r["wait_per_run"]),
                num(r["longest_wait"]["median"]),
                num(None if r["job_wait"]["median"] is None else 60 * r["job_wait"]["median"], 0),
            ]
        else:
            cells += ["0", "0", "0", "n/a", "n/a", "n/a", "n/a", "n/a"]
        cells += [num(rp["prs"]) if rp else "", f"{num(rp['median'])} / {num(rp['mean'], 2)}" if rp else ""]
        w("| " + " | ".join(cells) + " |")
    reruns = sum(r.get("reruns", 0) for r in s["rows"].values())
    if reruns:
        w("")
        w(f"Re-run by hand: {reruns} run(s). Each is counted by its first attempt.")
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
    w("| Merged | A day | Open to merge, median / p90 | With a red run | Open to first red, median / p90 | Queue to merge, median / p90 |")
    w("| ---: | ---: | ---: | ---: | ---: | ---: |")
    q = pair(p["queue"]) + (f" (n/a for {p['queue_na']})" if p["queue_na"] else "")
    w(
        f"| {p['merged']} | {num(p['per_day'], 2)} | {pair(p['open_to_merge'])} | {p['with_red']} "
        f"| {pair(p['open_to_first_red'])} | {q} |"
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
            w(f"- from {x['from']}, {num(x['minutes'])} min, {end}; red runs {', '.join(map(str, x['red_runs']))}")
    w("")
    w("### Browser shards, on green PR runs that ran every shard")
    w("")
    if not s["shards"]:
        w("No green PR run ran the whole browser tier.")
    for n, g in sorted(s["shards"].items(), key=lambda kv: -kv[1]["runs"]):
        w(
            f"**{n} shard{'s' if n != '1' else ''}**, {g['runs']} run(s). A shard: median {num(g['all']['median'])}, max {num(g['all']['max'])}. "
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
        w(f"| {name} (a green run, created to done; {d['red']} red) | {g['n']} | {num(g['median'])} | {num(g['p90'])} | {num(g['max'])} |")
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


def gh(url: str, paginate: bool, tries: int = 3) -> str:
    """`gh api` GET of one URL, every page when paginate. A server error
    (HTTP 5xx: GitHub's, not the request's) is asked again, twice at most."""
    cmd = ["gh", "api", "-X", "GET", "-H", "Accept: application/vnd.github+json"]
    if paginate:
        cmd.append("--paginate")
    for attempt in range(1, tries + 1):
        p = subprocess.run(cmd + [url], capture_output=True, text=True)
        if p.returncode == 0:
            return p.stdout
        if attempt == tries or not re.search(r"HTTP 5\d\d", p.stderr):
            raise ApiError(f"gh api {url}: {p.stderr.strip() or p.returncode}")
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
    """GET requests to the repository's API, kept on disk when asked to."""

    def __init__(self, repo: str = REPO, cache: str = CACHE, fetch=gh):
        self.repo, self.cache, self.fetch = repo, cache, fetch
        self.fetched = self.reused = 0
        self.lock = threading.Lock()

    def url(self, path: str, params: dict | None = None) -> str:
        q = urllib.parse.urlencode(params or {}, safe=":.")
        return f"repos/{self.repo}/{path}" + (f"?{q}" if q else "")

    def get(self, path: str, params: dict | None = None, key: str | None = None, paginate: bool = False, keep: bool = False):
        """The response, its pages joined: a list from `key` (or from array
        pages), else the one object. keep: read it from the cache, or write
        it there, as it can no longer change."""
        url = self.url(path, params)
        file = os.path.join(self.cache, hashlib.sha256(url.encode()).hexdigest() + ".json")
        if keep and os.path.exists(file):
            with open(file) as f:
                saved = json.load(f)
            if saved.get("url") == url:
                with self.lock:
                    self.reused += 1
                return saved["data"]
        pages = decode_all(self.fetch(url, paginate))
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
        the scope, say): the number it feeds is then n/a."""
        try:
            return self.get(*args, **kwargs)
        except ApiError as e:
            print(f"ci_stats: {e}", file=sys.stderr)
            return None


def list_runs(api: GitHub, workflow: str, start: dt.datetime, end: dt.datetime, **filters) -> list:
    """A workflow's runs created in [start, end), a day per query (the
    filtered list stops at 1,000)."""
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
    in the window was updated in it."""
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


def collect(api: GitHub, since: dt.datetime, until: dt.datetime, now: dt.datetime, workers: int = 8) -> dict:
    """Everything `measure` reads, from the API."""
    end = min(until, now)
    prs = list_prs(api, since)
    merged = [p for p in prs if p["merged_at"] and since <= ts(p["merged_at"]) < until]
    start = max(min([since] + [ts(p["created_at"]) for p in merged]), since - LOOKBACK)
    ci = list_runs(api, "ci.yml", start, end)
    after = list_runs(api, "ci.yml", end, min(end + 3 * DAY, now), branch="main", event="push") if end < now else []
    other = {f: list_runs(api, f, since, end) for f, _ in OTHER}

    def jobs_of(r):
        r["jobs"] = api.get(
            f"actions/runs/{r['id']}/jobs", {"filter": "all", "per_page": 100}, key="jobs", paginate=True, keep=r.get("status") == "completed"
        )

    # Only what a number reads, as a nightly's token has 1,000 requests an
    # hour: the jobs of the window's runs and of the merged PRs' earlier
    # ones, the other workflows' green runs, and the files of the PRs those
    # runs belong to.
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
    need += [r for rs in other.values() for r in rs if r.get("conclusion") == "success"]

    def files_of(p):
        closed = p["closed_at"] is not None
        files = api.get(f"pulls/{p['number']}/files", {"per_page": 100}, paginate=True, keep=closed)
        p["kind"] = classify(f["filename"] for f in files)
        if p["number"] in in_merged:
            p["timeline"] = api.get_or_none(f"issues/{p['number']}/timeline", {"per_page": 100}, paginate=True, keep=closed)
            p["comments"] = api.get_or_none(f"issues/{p['number']}/comments", {"per_page": 100}, paginate=True, keep=closed)

    with ThreadPoolExecutor(max_workers=workers) as pool:
        list(pool.map(jobs_of, need))
        list(pool.map(files_of, list(wanted.values())))
    for p in prs:
        p.setdefault("kind", "docs")
    return {"ci": ci, "main_after": after, "prs": prs, "other": other}


# ─── the command ─────────────────────────────────────────────────────────────


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--since", help="the window's first day or time (default: 7 days ago)")
    ap.add_argument("--until", help="its last day (included) or time (default: now)")
    ap.add_argument("--format", choices=("md", "json"), default="md")
    ap.add_argument("--compare", metavar="BASE.json", help="a saved --format json run to compare the headlines with")
    args = ap.parse_args(argv)

    now = dt.datetime.now(UTC).replace(microsecond=0)
    until = parse_when(args.until, end=True) if args.until else now
    since = parse_when(args.since) if args.since else until - 7 * DAY
    if since >= until:
        ap.error("--since must come before --until")

    api = GitHub()
    stats = measure(collect(api, since, until, now), since, until)
    stats["generated"] = iso(now)
    print(f"ci_stats: {api.fetched} requests, {api.reused} from {os.path.relpath(CACHE, ROOT)}/", file=sys.stderr)

    cmp = None
    if args.compare:
        with open(args.compare) as f:
            cmp = compare(json.load(f), stats)
    if args.format == "json":
        if cmp is not None:
            stats["compare"] = {"base": args.compare, "headlines": cmp}
        json.dump(stats, sys.stdout, indent=1)
        sys.stdout.write("\n")
    else:
        sys.stdout.write(markdown(stats, cmp, args.compare))
    return 0


if __name__ == "__main__":
    sys.exit(main())
