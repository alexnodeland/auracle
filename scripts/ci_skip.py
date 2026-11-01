#!/usr/bin/env python3
"""Whether a run of a workflow off the gate would only repeat an answer it
already has (#582), so it can leave its runners to the merge queue.

    python3 scripts/ci_skip.py nightly --workflow FILE
        A scheduled run: skip when main's head is the commit the workflow's
        last scheduled run that tested anything tested, and that run was
        green. Search health and the Slow suite are seeded, so the same
        commit gives the same answer. (The Flake hunt never asks: it boots
        unseeded, and the same commit can show a new flake.)

    python3 scripts/ci_skip.py main-push --workflow FILE
        The Slow suite on a push to main: skip when nothing the slow tests
        cover changed since the newest commit a run of it on main tested
        green. What they cover is read through scripts/changes.py's classes:
        `rust` (the crates and how they build and test), `reach` (what the
        browser reads: the app, its specs and what runs them) and `full` (a
        workflow, an action or the classifier itself), which between them
        hold every path docs/architecture/testing.md's Slow list names. The
        base is that commit, not the push's own `before`: main keeps its
        latest run only, so a push whose run was superseded has its changes
        tested by the next run that runs.

FILE is the workflow's file name (slow-suite.yml). It prints one line,
`run=true` or `run=false`, for the workflow's step to pass on as its output,
and says why on stderr and in the run's summary ($GITHUB_STEP_SUMMARY), with
a link to the run whose answer stands. Anything that keeps it from deciding
(the API, an answer it can't read, the time) is `run=true`, said as a
warning: an error never skips a run and never turns one red. It reads
GITHUB_REPOSITORY, GITHUB_SHA, GITHUB_RUN_ID and GITHUB_SERVER_URL as a
workflow sets them, and the API through `gh` (GH_TOKEN, `actions: read`).

"Tested" is a run in which more than one job ran: a run that skipped ran
only the job that decided so (as scripts/ci_stats.py counts a green run).

Python 3 standard library only.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import changes  # noqa: E402

# How far back to look: a page of the API. A month of nights, or a few
# days of pushes; past it, nothing found means run.
PAGE = 30
# The whole decision's time, and one call's. The job that asks is cut at
# five minutes, and running is always the answer when time is short.
DEADLINE_S = 120
CALL_S = 30
# The compare API lists at most this many files; at the cap the list may
# be cut, so it is no reason to skip.
FILES_CAP = 300
# The classes that reach what the slow tests cover.
SLOW_CLASSES = ("full", "rust", "reach")
# Events that run a workflow on main itself: a PR's run (a fork may name its
# branch main) is never a base.
MAIN_EVENTS = ("push", "schedule", "workflow_dispatch")


class Undecided(Exception):
    """What keeps the script from deciding: the answer is to run."""


def gh_api(path: str, deadline: float):
    """GET `path` from the REST API through `gh`, as JSON, inside the
    deadline."""
    left = deadline - time.monotonic()
    if left <= 0:
        raise Undecided("out of time")
    try:
        out = subprocess.run(
            ["gh", "api", path], capture_output=True, text=True, timeout=min(CALL_S, left), check=True
        ).stdout
    except subprocess.TimeoutExpired as e:
        raise Undecided(f"`gh api {path}` took over {e.timeout:.0f} s") from e
    except (OSError, subprocess.CalledProcessError) as e:
        why = (getattr(e, "stderr", "") or str(e)).strip().splitlines()
        raise Undecided(f"`gh api {path}`: {why[-1] if why else e}") from e
    try:
        return json.loads(out)
    except ValueError as e:
        raise Undecided(f"`gh api {path}` answered no JSON") from e


def ran(job) -> bool:
    """A job that ran, as scripts/ci_stats.py counts one: it had a runner
    and an end other than skipped."""
    return bool(job.get("runner_name")) and job.get("conclusion") not in (None, "skipped")


class Runs:
    """A workflow's runs on main and their jobs, from the API."""

    def __init__(self, api, repo: str, workflow: str, run_id: str):
        self.api = api
        self.repo = repo
        self.workflow = workflow
        self.run_id = str(run_id)

    def list(self, query: str) -> list:
        page = self.api(f"repos/{self.repo}/actions/workflows/{self.workflow}/runs?branch=main&per_page={PAGE}&{query}")
        runs = page.get("workflow_runs") if isinstance(page, dict) else None
        if not isinstance(runs, list):
            raise Undecided(f"the runs of {self.workflow} could not be read")
        # Newest first; this run is never its own precedent.
        mine = [r for r in runs if str(r.get("id")) != self.run_id and r.get("head_branch") == "main"]
        return sorted(mine, key=lambda r: r.get("created_at") or "", reverse=True)

    def tested(self, run) -> bool:
        page = self.api(f"repos/{self.repo}/actions/runs/{run['id']}/jobs?per_page=100")
        jobs = page.get("jobs") if isinstance(page, dict) else None
        if not isinstance(jobs, list):
            raise Undecided(f"the jobs of run {run.get('id')} could not be read")
        return sum(1 for j in jobs if ran(j)) > 1


def link(run) -> str:
    return f"[{run.get('name') or 'run'} #{run.get('run_number', run.get('id'))}]({run.get('html_url', '')})"


def short(sha: str) -> str:
    return f"`{(sha or '')[:12]}`"


def day(run) -> str:
    return (run.get("created_at") or "")[:10]


def nightly(runs: Runs, sha: str) -> tuple[bool, str]:
    """A scheduled run: (run?, why)."""
    # A cancelled run gave no answer; one that skipped ran only the job
    # that decided so, and is passed over as not tested.
    finished = [
        r
        for r in runs.list("event=schedule&status=completed")
        if r.get("event") == "schedule"
        and r.get("status") == "completed"
        and r.get("conclusion") not in (None, "cancelled", "skipped")
    ]
    last = next((r for r in finished if runs.tested(r)), None)
    if last is None:
        return True, f"Running: no scheduled run in the last {PAGE} tested main, so there is no answer to stand on."
    if last.get("head_sha") != sha:
        return True, (
            f"Running: main is at {short(sha)}, and the last scheduled run that tested main, {link(last)}, "
            f"tested {short(last.get('head_sha'))}."
        )
    if last.get("conclusion") != "success":
        return True, (
            f"Running: main is still at {short(sha)}, but the last scheduled run that tested it, {link(last)}, "
            f"ended {last.get('conclusion')}, so it is tested again."
        )
    return False, (
        f"**Skipped:** main is still at {short(sha)}, the commit {link(last)} tested green on {day(last)}. "
        "This workflow is seeded, so it would give the same answer; that run's summary has it. "
        "A run by hand (Actions → Run workflow) always runs."
    )


def compare_files(api, repo: str, base: str, sha: str) -> list[str]:
    """The paths changed from `base` to `sha`, which must be ahead of it:
    each file's path, and a renamed file's old path too."""
    cmp = api(f"repos/{repo}/compare/{base}...{sha}?per_page=1")
    status = cmp.get("status") if isinstance(cmp, dict) else None
    if status == "identical":
        return []
    if status != "ahead":
        raise Undecided(f"{short(sha)} is not ahead of {short(base)} (the compare says {status!r})")
    files = cmp.get("files")
    if not isinstance(files, list) or not files:
        raise Undecided(f"the compare of {short(base)} with {short(sha)} listed no files")
    if len(files) >= FILES_CAP:
        raise Undecided(f"{len(files)} files changed since {short(base)}, as many as the compare lists")
    paths = []
    for f in files:
        paths += [p for p in (f.get("filename"), f.get("previous_filename")) if p]
    return paths


def main_push(runs: Runs, sha: str) -> tuple[bool, str]:
    """The Slow suite on a push to main: (run?, why)."""
    green = [r for r in runs.list("status=success") if r.get("event") in MAIN_EVENTS and r.get("conclusion") == "success"]
    base = next((r for r in green if runs.tested(r)), None)
    if base is None:
        return True, f"Running: none of the last {PAGE} green runs on main tested anything, so there is no answer to stand on."
    files = compare_files(runs.api, runs.repo, base["head_sha"], sha)
    if not files:
        return False, f"**Skipped:** {link(base)} tested this very commit, {short(sha)}, green."
    if any(changes.classify(files)[k] for k in SLOW_CLASSES):
        reaching = [f for f in files if any(changes.classify([f])[k] for k in SLOW_CLASSES)]
        more = f", and {len(reaching) - 5} more" if len(reaching) > 5 else ""
        return True, (
            f"Running: since {short(base['head_sha'])}, which {link(base)} tested green, the changes reach "
            f"what the slow tests cover: {', '.join(f'`{f}`' for f in reaching[:5])}{more}."
        )
    shown = ", ".join(f"`{f}`" for f in files[:8]) + (f" and {len(files) - 8} more" if len(files) > 8 else "")
    return False, (
        f"**Skipped:** nothing the slow tests cover changed since {short(base['head_sha'])}, which {link(base)} "
        f"tested green. The {len(files)} files changed since ({shown}) are none of the Rust, the app or its specs, "
        "or CI itself (scripts/changes.py's `rust`, `reach` and `full`). The nightly run still tests main, and a "
        "run by hand always runs."
    )


MODES = {"nightly": nightly, "main-push": main_push}


def decide(mode: str, workflow: str, env, api=None) -> tuple[bool, str, bool]:
    """(run?, why, an error?) for `mode`. Any error is a run, never
    raised."""
    try:
        deadline = time.monotonic() + DEADLINE_S
        api = api or (lambda path: gh_api(path, deadline))
        repo, sha = env.get("GITHUB_REPOSITORY"), env.get("GITHUB_SHA")
        if not repo or not sha:
            raise Undecided("GITHUB_REPOSITORY or GITHUB_SHA is not set")
        run, why = MODES[mode](Runs(api, repo, workflow, env.get("GITHUB_RUN_ID", "")), sha)
        return run, why, False
    except Undecided as e:
        return True, f"Running: whether this run could skip was not decided ({e}), and that is no reason to skip.", True
    except Exception as e:  # noqa: BLE001 — any error means run, never red
        why = f"Running: deciding whether this run could skip failed ({type(e).__name__}: {e}), and that is no reason to skip."
        return True, why, True


def main(argv: list[str], env=None, api=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("mode", choices=sorted(MODES))
    ap.add_argument("--workflow", required=True, help="the workflow's file name, as slow-suite.yml")
    args = ap.parse_args(argv)
    env = os.environ if env is None else env
    run, why, error = decide(args.mode, args.workflow, env, api)
    print(f"::warning::{why}" if error else why, file=sys.stderr)
    summary = env.get("GITHUB_STEP_SUMMARY")
    if summary:
        try:
            with open(summary, "a", encoding="utf-8") as f:
                f.write(why + "\n")
        except OSError:
            pass
    print(f"run={'true' if run else 'false'}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
