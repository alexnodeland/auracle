#!/usr/bin/env python3
"""ci_stats.py's tests: the kind of PR, the quantiles, a run's verdict and
its runner waits, main's red stretches, the time in Mergify's queue, the
whole measurement on a small week, the queue's lane, the comparison with a
saved run, the cache, the other workflows, the window's end, the rate limit,
and `collect` against a fake API.

    python3 scripts/test_ci_stats.py      (run by `make dev-check`)

No test reaches the network: the runs, jobs and PRs are small dicts written
here, and the cache's and `collect`'s cases hand `GitHub` a fetch that
answers from them and counts its calls.
Python 3 standard library only.
"""

import contextlib
import datetime as dt
import io
import json
import os
import re
import shutil
import sys
import tempfile
import types
import unittest
import urllib.parse
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import ci_stats as S  # noqa: E402

BASE = dt.datetime(2026, 10, 1, tzinfo=dt.timezone.utc)


def at(minutes):
    """The time `minutes` after BASE, as the API writes it."""
    return S.iso(BASE + dt.timedelta(minutes=minutes))


def job(name, created, started, done, conclusion="success", attempt=1):
    return {
        "name": name,
        "created_at": at(created),
        "started_at": at(started),
        "completed_at": at(done),
        "conclusion": conclusion,
        "run_attempt": attempt,
        "runner_name": "GitHub Actions 1",
    }


def run(
    rid, created, jobs, branch="feature", event="pull_request", conclusion="success", attempt=1, status="completed"
):
    return {
        "id": rid,
        "created_at": at(created),
        "updated_at": at(created + 30),
        "event": event,
        "head_branch": branch,
        "status": status,
        "conclusion": conclusion,
        "run_attempt": attempt,
        "html_url": f"https://example.invalid/runs/{rid}",
        "jobs": jobs,
    }


def green_run(rid, created, minutes=10, wait=1, branch="feature", event="pull_request"):
    """A green run: one test job that waited `wait` minutes for a runner,
    then `CI`, done `minutes` after the run was created."""
    return run(
        rid,
        created,
        [
            job("Test (1/2)", created, created + wait, created + minutes - 1),
            job("CI", created + minutes - 1, created + minutes - 1, created + minutes),
        ],
        branch=branch,
        event=event,
    )


def red_run(rid, created, minutes=10, failed="Browser (2/2)", branch="feature", event="pull_request"):
    return run(
        rid,
        created,
        [
            job("Browser (1/2)", created, created, created + minutes - 1),
            job(failed, created, created, created + minutes - 1, "failure"),
            job("CI", created + minutes - 1, created + minutes - 1, created + minutes, "failure"),
        ],
        branch=branch,
        event=event,
        conclusion="failure",
    )


def pr(number, branch, created, merged, kind="rust", comments=None):
    return {
        "number": number,
        "title": f"PR {number}",
        "branch": branch,
        "created_at": at(created),
        "closed_at": at(merged) if merged is not None else None,
        "merged_at": at(merged) if merged is not None else None,
        "kind": kind,
        "comments": comments,
    }


def payload(state, queued, created):
    """One of Mergify's status comments, as it writes them (#193's, with its
    times moved): its payload, an HTML comment, says when the PR entered the
    queue, to the microsecond."""
    data = {
        "version": 1,
        "state": state,
        "queue_rule_name": "default",
        "queued_at": (BASE + dt.timedelta(minutes=queued, microseconds=627454)).isoformat(),
        "estimated_time_of_merge": None,
        "speculative_check_pr": None,
        "required_conditions": [],
    }
    body = (
        "<!---\nDO NOT EDIT\n-*- Mergify Payload -*-\n"
        + json.dumps(data)
        + "\n-*- Mergify Payload End -*-\n-->\n\n# Merge Queue Status\n\n"
        + "- ✅ **Entered queue** · Rule: `default` · triggered by @alexnodeland with the `@mergifyio queue` command\n"
    )
    return {"body": body, "user": {"login": "mergify[bot]", "type": "Bot"}, "created_at": at(created)}


class Classify(unittest.TestCase):
    """The kind of PR is the lane ci.yml's `changes` job picks, in its order."""

    def test_a_workflow_or_an_action_is_ci_whatever_else_changed(self):
        self.assertEqual(S.classify([".github/workflows/ci.yml", "crates/x/src/lib.rs", "apps/web/main.js"]), "ci")
        self.assertEqual(S.classify(["tests/web/shard.mjs", ".github/actions/browser-shard/action.yml"]), "ci")
        # Beside docs or the app, a CI file still makes the PR a CI PR.
        self.assertEqual(S.classify(["docs/process.md", ".github/workflows/flake-hunt.yml"]), "ci")

    def test_what_can_change_the_build_is_rust(self):
        for f in ["crates/x/src/lib.rs", "Cargo.lock", "rust-toolchain.toml", "Makefile", "scripts/setup.sh"]:
            self.assertEqual(S.classify([f]), "rust", f)
        self.assertEqual(S.classify(["scripts/coverage_gate.py"]), "rust")
        self.assertEqual(S.classify(["scripts/test_coverage_gate.py"]), "rust")
        self.assertEqual(S.classify(["apps/web/main.js", "crates/x/src/lib.rs"]), "rust")

    def test_web_is_the_app_or_its_specs(self):
        self.assertEqual(S.classify(["apps/web/main.js", "CHANGELOG.md"]), "web")
        self.assertEqual(S.classify(["tests/web/package-lock.json"]), "web")
        self.assertEqual(S.classify(["tests/web/AGENTS.md"]), "docs")
        # The specs' lint is read by Web, not by a browser (ci.yml's `reach`).
        lint = ["eslint.config.mjs", "eslint-suppressions.json", "eslint.test.mjs", "suppressions.mjs"]
        self.assertEqual(S.classify([f"tests/web/{f}" for f in lint]), "docs")
        self.assertEqual(S.classify(["tests/web/eslint.config.mjs", "tests/web/bank.spec.js"]), "web")

    def test_anything_else_is_docs_and_other(self):
        files = ["docs/process.md", "www/docs/src/a.md", "README.md", ".claude/skills/ship/SKILL.md"]
        self.assertEqual(S.classify(files), "docs")
        for f in ["scripts/ci_stats.py", ".mergify.yml", "changelog.d/topic.md", ".github/dependabot.yml"]:
            self.assertEqual(S.classify([f]), "docs", f)
        self.assertEqual(S.classify([]), "docs")
        # A path that only contains a kind's prefix is not that kind.
        self.assertEqual(S.classify(["docs/crates/notes.md", "www/apps/web/x.md"]), "docs")

    def test_a_generator_is_read_once_for_every_kind(self):
        self.assertEqual(S.classify(f for f in ["README.md", "apps/web/main.js"]), "web")


class Quantiles(unittest.TestCase):
    def test_short_lists(self):
        self.assertIsNone(S.pct([], 0.5))
        self.assertEqual(S.pct([7], 0.5), 7)
        self.assertEqual(S.pct([7], 0.9), 7)
        self.assertEqual(S.pct([1, 2], 0.5), 1.5)
        self.assertEqual(S.pct([3, 1, 2], 0.5), 2)
        self.assertEqual(S.pct([4, 1, 3, 2], 0.5), 2.5)
        self.assertAlmostEqual(S.pct([1, 2, 3, 4], 0.9), 3.7)
        self.assertAlmostEqual(S.pct(range(1, 11), 0.9), 9.1)

    def test_dist_leaves_out_what_is_missing(self):
        self.assertEqual(S.dist([None, 2.0, 4.0, None]), {"n": 2, "median": 3.0, "p90": 3.8, "max": 4.0})
        self.assertEqual(S.dist([]), {"n": 0, "median": None, "p90": None, "max": None})


class Window(unittest.TestCase):
    def test_a_date_is_a_whole_day(self):
        self.assertEqual(S.iso(S.parse_when("2026-09-28")), "2026-09-28T00:00:00Z")
        self.assertEqual(S.iso(S.parse_when("2026-10-05", end=True)), "2026-10-06T00:00:00Z")

    def test_a_time_is_that_time(self):
        self.assertEqual(S.iso(S.parse_when("2026-10-05T08:50:02Z", end=True)), "2026-10-05T08:50:02Z")

    def test_the_window_reads_both_days_in(self):
        text = S.window_text("2026-09-28T00:00:00Z", "2026-10-06T00:00:00Z")
        self.assertEqual(text, "2026-09-28 to 2026-10-05 (UTC, both days in)")


class Verdict(unittest.TestCase):
    def test_green_and_red(self):
        self.assertEqual(S.verdict(green_run(1, 0)), "green")
        r = red_run(2, 0)
        self.assertEqual(S.verdict(r), "red")
        self.assertEqual(S.failed_jobs(r), ["Browser (2/2)"])

    def test_a_run_a_newer_push_replaced_is_cancelled(self):
        # CI fails on a cancelled need, and the run itself was cancelled.
        r = run(
            3,
            0,
            [
                job("Browser (1/2)", 0, 1, 4, "cancelled"),
                job("CI", 4, 4, 5, "failure"),
            ],
            conclusion="cancelled",
        )
        self.assertEqual(S.verdict(r), "cancelled")

    def test_a_job_cancelled_at_its_limit_is_red(self):
        # The same first attempt, re-run green by hand: still red, and the
        # job that ran out of time is named.
        r = run(
            4,
            0,
            [
                job("Browser (1/2)", 0, 1, 21, "cancelled"),
                job("CI", 21, 21, 22, "failure"),
                job("Browser (1/2)", 30, 30, 40, "success", attempt=2),
                job("CI", 40, 40, 41, "success", attempt=2),
            ],
            attempt=2,
        )
        self.assertEqual(S.verdict(r), "red")
        self.assertEqual(S.failed_jobs(r), ["Browser (1/2) (cancelled)"])
        self.assertEqual(S.wall(r), 22)

    def test_a_run_in_flight_has_none(self):
        self.assertIsNone(S.verdict(run(5, 0, [], status="in_progress", conclusion=None)))

    def test_a_superseded_run_on_main_has_none(self):
        # main had moved past it: every job skipped but What changed, and CI
        # green on nothing.
        jobs = [job("What changed", 0, 0, 1), job("CI", 1, 1, 2)]
        jobs.append(dict(job("Site", 1, 1, 1), conclusion="skipped", runner_name=""))
        self.assertIsNone(S.verdict(run(6, 0, jobs, event="push", branch="main")))
        # A PR whose change reaches no job (a changelog entry) is still green.
        self.assertEqual(S.verdict(run(7, 0, jobs)), "green")
        # Cancelled before anything began: cancelled, not idle.
        stopped = [job("What changed", 0, 0, 1, "cancelled"), job("CI", 1, 1, 2, "failure")]
        stopped.append(dict(job("Lint", 1, 1, 1), conclusion="cancelled", runner_name=""))
        stopped_run = run(9, 0, stopped, event="push", branch="main", conclusion="cancelled")
        self.assertEqual(S.verdict(stopped_run), "cancelled")
        # And main reusing the queue's verdict still builds the site: green.
        built = jobs[:2] + [job("Site", 1, 1, 3)]
        self.assertEqual(S.verdict(run(8, 0, built, event="push", branch="main")), "green")


class Waits(unittest.TestCase):
    def test_the_jobs_the_answer_waits_for_and_all_of_them(self):
        r = green_run(6, 0, wait=3)
        r["jobs"].append(dict(job("Site", 0, 9, 9), conclusion="skipped", runner_name=""))
        r["jobs"].append(job("Browser report", 0, 7, 8))
        r["jobs"].append(job("Deploy to Pages", 10, 12, 13))
        r["jobs"].append(job("Codecov from the queue's run", 1, 5, 6))
        # Required: the test job; not CI itself, the report, the deploy or
        # main's Codecov upload.
        self.assertEqual(S.waits(r), [3])
        self.assertEqual(sorted(S.waits(r, required=False)), [0, 2, 3, 4, 7])

    def test_on_a_queue_run_the_full_gate_waits_for_ci_and_the_report(self):
        r = queue_run(9, 0, 12)
        r["jobs"].append(job("Browser report", 0, 4, 11))
        r["jobs"][-2]["started_at"] = at(11)  # Full gate waited a minute
        self.assertEqual(sorted(S.waits(r)), [0, 1, 1, 4])
        self.assertEqual(sorted(S.waits(r, required=False)), [0, 1, 1, 1, 4])


class MainRed(unittest.TestCase):
    UNTIL = BASE + dt.timedelta(days=1)

    def stretches(self, runs, before=()):
        data = {"ci": runs, "main_before": list(before), "main_after": [], "prs": [], "other": {}}
        return S.measure(data, BASE, self.UNTIL)["main_red"]["stretches"]

    def test_consecutive_reds_are_one_stretch_until_the_next_green(self):
        runs = [
            green_run(1, 0, event="push", branch="main"),
            red_run(2, 20, event="push", branch="main"),
            red_run(3, 40, event="push", branch="main"),
            green_run(4, 60, minutes=15, event="push", branch="main"),
            green_run(5, 90, event="push", branch="main"),
        ]
        [w] = S.main_red(runs, BASE, self.UNTIL)
        self.assertEqual((w["from"], w["to"]), (at(30), at(75)))
        self.assertEqual(w["minutes"], 45)
        self.assertEqual((w["red_runs"], w["green_run"], w["clipped"]), ([2, 3], 4, False))

    def test_a_red_never_followed_by_green_is_measured_to_the_end(self):
        runs = [green_run(1, 0, event="push", branch="main"), red_run(2, 1380, event="push", branch="main")]
        [w] = S.main_red(runs, BASE, self.UNTIL)
        self.assertIsNone(w["to"])
        self.assertEqual(w["minutes"], 50)

    def test_a_cancelled_run_neither_opens_nor_closes_a_stretch(self):
        cancelled = run(3, 30, [], event="push", branch="main", conclusion="cancelled")
        cancelled["jobs"] = None
        runs = [red_run(2, 0, event="push", branch="main"), cancelled, green_run(4, 60, event="push", branch="main")]
        [w] = S.main_red(runs, BASE, self.UNTIL)
        self.assertEqual(w["green_run"], 4)

    def test_a_superseded_run_does_not_split_a_stretch(self):
        idle = run(5, 200, [job("What changed", 200, 200, 201), job("CI", 201, 201, 202)], event="push", branch="main")
        runs = [
            red_run(4, 100, event="push", branch="main"),
            idle,
            red_run(6, 203, event="push", branch="main"),
            green_run(7, 300, event="push", branch="main"),
        ]
        [w] = self.stretches(runs)
        self.assertEqual((w["from"], w["to"], w["minutes"], w["red_runs"]), (at(110), at(310), 200, [4, 6]))

    def test_a_stretch_that_began_before_the_window_counts_from_its_start(self):
        # Red since 23:00 the day before, green at 09:00.
        red, green = red_run(1, -60, event="push", branch="main"), green_run(2, 530, event="push", branch="main")
        [w] = self.stretches([green], [red])
        self.assertEqual((w["from"], w["to"], w["minutes"], w["clipped"]), (at(0), at(540), 540, True))
        data = {"ci": [green], "main_before": [red], "main_after": [], "prs": [], "other": {}}
        self.assertIn("(red since before the window)", S.markdown(S.measure(data, BASE, self.UNTIL)))

    def test_only_main_before_says_how_main_stood_before_the_window(self):
        # A merged PR opened before the window has collect list main's
        # earlier runs into `ci` too, without their jobs. Their final
        # conclusion lies: a red re-run green by hand, a run that ran nothing.
        red = red_run(1, -60, event="push", branch="main")
        red["run_attempt"], red["conclusion"] = 2, "success"
        red["jobs"] += [dict(j, run_attempt=2, conclusion="success") for j in red_run(1, -30)["jobs"]]
        listed = {k: v for k, v in red.items() if k != "jobs"}
        idle = run(3, -10, [], event="push", branch="main")
        del idle["jobs"]
        green = green_run(2, 530, event="push", branch="main")
        for ci in ([listed, green], [listed, idle, green]):
            [w] = self.stretches(ci, [red])
            self.assertEqual((w["from"], w["minutes"], w["red_runs"], w["clipped"]), (at(0), 540, [1], True))
        # Without main_before, the listed copies say nothing.
        self.assertEqual(self.stretches([listed, idle, green]), [])

    def test_a_stretch_that_ended_before_the_window_is_not_counted(self):
        before = [green_run(2, -100, event="push", branch="main")]
        self.assertEqual(self.stretches([green_run(3, 60, event="push", branch="main")], before), [])

    def test_a_run_after_the_window_closes_it_by_its_last_update(self):
        after = run(9, 2000, [], event="push", branch="main")
        after["jobs"] = None
        data = {
            "ci": [red_run(2, 1400, event="push", branch="main")],
            "main_after": [after],
            "prs": [],
            "other": {},
        }
        s = S.measure(data, BASE, self.UNTIL)
        [w] = s["main_red"]["stretches"]
        self.assertEqual(w["to"], at(2030))
        self.assertEqual(w["minutes"], 2030 - 1410)


class Queue(unittest.TestCase):
    MERGED = BASE + dt.timedelta(minutes=60)

    def test_from_entering_the_queue_to_the_merge(self):
        minutes, entries = S.queue_time([payload("merged", 40, 41)], self.MERGED)
        self.assertAlmostEqual(minutes, 20 - 0.627454 / 60)
        self.assertEqual(entries, 1)

    def test_queued_twice_counts_from_the_last_entry(self):
        # #193: entered, left on a conflict, entered again, merged.
        comments = [payload("dequeued", 5, 6), payload("merged", 45, 46)]
        minutes, entries = S.queue_time(comments, self.MERGED)
        self.assertEqual((round(minutes), entries), (15, 2))
        # An entry after the merge is no part of it.
        minutes, entries = S.queue_time(comments + [payload("queued", 70, 70)], self.MERGED)
        self.assertEqual((round(minutes), entries), (15, 2))

    def test_merged_by_hand_after_leaving_the_queue_is_not_a_queue_time(self):
        # Mergify's own figure is in its `merged` payload; a PR it dequeued and
        # the operator then merged has none, though it entered once.
        self.assertEqual(S.queue_time([payload("dequeued", 5, 6)], self.MERGED), (None, 1))
        # Two entries, the second merged: Mergify's figure is the second's.
        minutes, entries = S.queue_time([payload("merged", 45, 46), payload("dequeued", 5, 6)], self.MERGED)
        self.assertEqual((round(minutes), entries), (15, 2))

    def test_the_command_and_the_label_are_not_the_entry(self):
        # The process labels a PR and comments the command as it opens; the
        # PR enters the queue only once its CI, its PR checks and its
        # Mutants in the changed code are green.
        human = {"body": "@mergifyio queue", "user": {"login": "alexnodeland", "type": "User"}, "created_at": at(1)}
        quoted = dict(payload("merged", 2, 3), user={"login": "someone", "type": "User"})
        self.assertEqual(S.queue_time([human, quoted], self.MERGED), (None, 0))
        self.assertEqual(S.queue_time(None, self.MERGED), (None, 0))
        broken = dict(payload("merged", 2, 3))
        broken["body"] = broken["body"].replace('"version": 1', '"version": ')
        self.assertEqual(S.queue_time([broken], self.MERGED), (None, 0))


def week():
    """Two merged PRs and main over one day: #1 (Rust) red once then green,
    in Mergify's queue from 00:40; #2 (web) green on its one run, merged by
    hand; main red once, then green."""
    prs = [
        pr(1, "rust-pr", 0, 60, "rust", comments=[payload("merged", 40, 41)]),
        pr(2, "web-pr", 100, 130, "web", comments=[]),
        pr(3, "old-pr", -3000, -2000, "docs", comments=[]),
    ]

    def shards(created, minutes):
        return [job(f"Browser ({k}/3)", created, created + 1, created + 1 + m) for k, m in zip((1, 2, 3), minutes)]

    r1 = red_run(10, 2, branch="rust-pr")
    r2 = green_run(11, 20, minutes=20, wait=2, branch="rust-pr")
    r2["jobs"] = shards(20, (6, 8, 10)) + r2["jobs"]
    r3 = green_run(12, 101, minutes=12, wait=0, branch="web-pr")
    r3["jobs"] = shards(101, (5, 5, 9)) + r3["jobs"]
    stray = green_run(13, 200, branch="nobody")
    mains = [
        green_run(20, 61, event="push", branch="main"),
        red_run(21, 131, event="push", branch="main"),
        green_run(22, 150, event="push", branch="main"),
    ]
    return {"ci": [r1, r2, r3, stray] + mains, "main_after": [], "prs": prs, "other": {}}


class Measure(unittest.TestCase):
    def setUp(self):
        self.s = S.measure(week(), BASE, BASE + dt.timedelta(days=1))

    def test_each_kind_of_pr(self):
        rust, web = self.s["rows"]["rust"], self.s["rows"]["web"]
        self.assertEqual((rust["runs"], rust["green"], rust["red"], rust["red_rate"]), (2, 1, 1, 0.5))
        self.assertEqual(rust["wall"]["median"], 15.0)
        self.assertEqual(rust["runs_per_pr"], {"prs": 1, "median": 2, "mean": 2.0})
        self.assertEqual((web["runs"], web["red_rate"], web["wall"]["median"]), (1, 0.0, 12.0))
        self.assertEqual(self.s["rows"]["unmatched"]["runs"], 1)
        self.assertEqual(self.s["rows"]["main"]["red"], 1)
        self.assertNotIn("docs", self.s["rows"])

    def test_runner_wait_is_summed_per_run(self):
        # Run 11: its test job waited 2, its shards 1 each; CI (0) is not one
        # of the jobs it needs.
        rust = self.s["rows"]["rust"]
        self.assertEqual((rust["longest_wait"]["max"], rust["longest_wait_all"]["max"]), (2.0, 2.0))
        self.assertEqual(rust["wait_per_run"]["max"], 5.0)

    def test_red_runs_name_the_job(self):
        reds = {r["run"]: r for r in self.s["red_runs"]}
        self.assertEqual(reds[10]["pr"], 1)
        self.assertEqual(reds[10]["jobs"], ["Browser (2/2)"])
        self.assertIsNone(reds[21]["pr"])
        self.assertEqual(self.s["failing_jobs"], {"Browser (k/2)": 2})

    def test_the_prs(self):
        p = self.s["prs"]
        self.assertEqual((p["merged"], p["per_day"]), (2, 2.0))
        self.assertEqual(p["open_to_merge"]["median"], 45.0)
        self.assertEqual((p["with_red"], p["open_to_first_red"]["median"]), (1, 12.0))
        self.assertEqual((p["queue"]["n"], p["queue"]["median"], p["queue_na"]), (1, 20.0, 1))
        self.assertEqual((p["queue_entries"], p["requeued"]), (1, 0))

    def test_shards(self):
        g = self.s["shards"]["3"]
        self.assertEqual(g["runs"], 2)
        self.assertEqual(g["shard"]["3"], {"median": 9.5, "max": 10.0})
        self.assertEqual((g["spread"]["median"], g["spread"]["max"]), (4.0, 4.0))
        self.assertEqual(g["wall"]["max"], 10.0)

    def test_main(self):
        [w] = self.s["main_red"]["stretches"]
        self.assertEqual((w["red_runs"], w["green_run"], w["minutes"]), ([21], 22, 19.0))

    def test_markdown_and_json(self):
        md = S.markdown(self.s)
        self.assertIn("| Rust | 2 | 1 | 1 | 0 | 50% | 15.0 / 19.0 |", md)
        self.assertIn("**3 shards**, 2 run(s)", md)
        self.assertNotIn("Against", md)
        json.loads(json.dumps(self.s))


def queue_run(rid, created, gate_done, red=False, branch="mergify/merge-queue/0a1b2c"):
    """A run of the queue's full gate on its draft PR: two shards, `CI`, then
    `Full gate`, done at `gate_done`. Red, its second shard fails."""
    jobs = [
        job(f"Browser ({k}/2)", created, created + 1, created + 9, "failure" if red and k == 2 else "success")
        for k in (1, 2)
    ]
    jobs.append(job("CI", created + 9, created + 9, created + 10, "failure" if red else "success"))
    jobs.append(job("Full gate", created + 10, created + 10, gate_done, "failure" if red else "success"))
    return run(rid, created, jobs, branch=branch, conclusion="failure" if red else "success")


class QueueLane(unittest.TestCase):
    """Two-speed CI (ADR-023): a PR's own run is the fast lane, and the
    queue's runs on its draft PRs are the full gate, a row of their own."""

    def data(self):
        data = week()
        # The queue's draft PR is a PR in the list, closed and never merged.
        data["prs"].append(pr(50, "mergify/merge-queue/0a1b2c", 69, None, "docs"))
        data["prs"][-1]["closed_at"] = at(130)
        data["ci"] += [queue_run(30, 70, 85), queue_run(31, 90, 102, red=True)]
        return data

    def test_the_queue_is_its_own_row(self):
        s = S.measure(self.data(), BASE, BASE + dt.timedelta(days=1))
        q = s["rows"]["queue"]
        self.assertEqual((q["runs"], q["green"], q["red"], q["red_rate"]), (2, 1, 1, 0.5))
        # Wall time runs to `Full gate`, the check the queue merges on.
        self.assertEqual(q["wall"]["median"], 13.5)
        self.assertNotIn("runs_per_pr", q)
        # The fast lane's rows and runs per PR are as they were without it.
        self.assertEqual(s["rows"]["rust"]["runs_per_pr"]["median"], 2)
        self.assertEqual(s["rows"]["unmatched"]["runs"], 1)
        self.assertNotIn("docs", s["rows"])
        self.assertIn("| Queue batch | 2 | 1 | 1 | 0 | 50% | 13.5 / 14.7 |", S.markdown(s))
        self.assertIn("rows.queue.wall.median", [k for k, *_ in S.headline(s)])

    def test_a_red_batch_names_the_job_not_the_gate(self):
        s = S.measure(self.data(), BASE, BASE + dt.timedelta(days=1))
        [red] = [r for r in s["red_runs"] if r["row"] == "queue"]
        self.assertEqual((red["run"], red["pr"], red["jobs"]), (31, None, ["Browser (2/2)"]))
        self.assertEqual(s["failing_jobs"]["Browser (k/2)"], 3)

    def test_a_green_batch_counts_toward_the_shards(self):
        s = S.measure(self.data(), BASE, BASE + dt.timedelta(days=1))
        self.assertEqual(s["shards"]["2"]["runs"], 1)

    def test_a_queue_run_belongs_to_no_pr(self):
        data = self.data()
        r = data["ci"][-1]
        self.assertTrue(S.is_queue(r))
        self.assertIsNone(S.pr_for(r, S.by_branch(data["prs"])))
        self.assertFalse(S.is_queue(data["ci"][0]))
        self.assertFalse(S.is_queue(dict(r, event="push")))

    def test_the_gate_before_it_ran_and_a_cancelled_batch(self):
        r = queue_run(32, 0, 12)
        self.assertEqual(S.gate_job(r)["name"], "Full gate")
        r["jobs"] = [j for j in r["jobs"] if j["name"] != "Full gate"]
        self.assertEqual(S.gate_job(r)["name"], "CI")
        # Taken out of the queue mid-run: a shard cancelled, the gate failed
        # on it, and the run itself cancelled.
        cancelled = run(
            33,
            0,
            [
                job("Browser (1/2)", 0, 1, 4, "cancelled"),
                job("CI", 4, 4, 5, "failure"),
                job("Full gate", 5, 5, 6, "failure"),
            ],
            branch="mergify/merge-queue/0a1b2c",
            conclusion="cancelled",
        )
        self.assertEqual(S.verdict(cancelled), "cancelled")
        cancelled["conclusion"] = "failure"
        self.assertEqual(S.verdict(cancelled), "red")
        self.assertEqual(S.failed_jobs(cancelled), ["Browser (1/2) (cancelled)"])


class Compare(unittest.TestCase):
    def test_changes_against_a_saved_run(self):
        base = S.measure(week(), BASE, BASE + dt.timedelta(days=1))
        data = week()
        data["ci"] = [r for r in data["ci"] if r["id"] != 10]  # Rust's red run never happened
        now = S.measure(data, BASE, BASE + dt.timedelta(days=1))
        rows = {c["key"]: c for c in S.compare(base, now)}
        red = rows["rows.rust.red_rate"]
        self.assertEqual((red["base"], red["now"], red["change"], red["unit"]), (50.0, 0.0, -50.0, "%"))
        per_pr = rows["rows.rust.runs_per_pr.median"]
        self.assertEqual((per_pr["base"], per_pr["now"], per_pr["change"]), (2, 1, -1))
        self.assertEqual(rows["prs.open_to_first_red.median"]["now"], None)
        self.assertIsNone(rows["prs.open_to_first_red.median"]["change"])
        md = S.markdown(now, S.compare(base, now), "base.json")
        self.assertIn("### Against base.json", md)
        self.assertIn("| Rust: red runs | 50.0 | 0.0 | -50.0 points |", md)

    def test_the_shards_compared_are_the_whole_tier(self):
        # A PR that changes only specs runs fewer shards, however often.
        self.assertEqual(S.widest({"1": {"runs": 9}, "12": {"runs": 2}, "8": {"runs": 5}}), "12")
        self.assertIsNone(S.widest({}))
        base = S.measure(week(), BASE, BASE + dt.timedelta(days=1))
        rows = {c["key"]: c for c in S.compare(base, base)}
        self.assertEqual((rows["shards.n"]["now"], rows["shards.wall.median"]["change"]), (3, 0))

    def test_a_headline_only_one_side_has(self):
        base = S.measure(week(), BASE, BASE + dt.timedelta(days=1))
        now = json.loads(json.dumps(base))
        del now["rows"]["web"]
        rows = {c["key"]: c for c in S.compare(base, now)}
        self.assertEqual(rows["rows.web.wall.median"]["base"], 12.0)
        self.assertIsNone(rows["rows.web.wall.median"]["now"])
        self.assertIsNone(rows["rows.web.wall.median"]["change"])


class Cache(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.calls = []

    def tearDown(self):
        shutil.rmtree(self.dir)

    def api(self, pages):
        def fetch(url, paginate):
            self.calls.append((url, paginate))
            return pages

        return S.GitHub(repo="o/r", cache=self.dir, fetch=fetch)

    def test_a_kept_response_is_read_once(self):
        api = self.api('{"jobs": [{"id": 1}]}\n{"jobs": [{"id": 2}]}')
        for _ in range(2):
            got = api.get("actions/runs/7/jobs", {"filter": "all"}, key="jobs", paginate=True, keep=True)
            self.assertEqual(got, [{"id": 1}, {"id": 2}])
        self.assertEqual(self.calls, [("repos/o/r/actions/runs/7/jobs?filter=all", True)])
        self.assertEqual((api.fetched, api.reused), (1, 1))

    def test_what_may_still_change_is_fetched_each_time(self):
        api = self.api('[{"filename": "a"}][{"filename": "b"}]')
        for _ in range(2):
            self.assertEqual(api.get("pulls/3/files", paginate=True), [{"filename": "a"}, {"filename": "b"}])
        self.assertEqual(len(self.calls), 2)
        self.assertEqual(os.listdir(self.dir), [])

    def test_a_server_error_is_asked_again_and_a_refusal_is_not(self):
        answers = [gh_answer(1, stderr="gh: Server Error (HTTP 502)"), gh_answer(0, stdout="[]")]
        with mock.patch.object(S.subprocess, "run", side_effect=answers) as run, mock.patch.object(S.time, "sleep"):
            self.assertEqual(S.gh("repos/o/r/pulls", False), "[]")
        self.assertEqual(run.call_count, 2)
        refused = types.SimpleNamespace(returncode=1, stdout="", stderr="gh: Not Found (HTTP 404)")
        with mock.patch.object(S.subprocess, "run", return_value=refused) as run, mock.patch.object(S.time, "sleep"):
            with self.assertRaises(S.ApiError):
                S.gh("repos/o/r/pulls/9", False)
        self.assertEqual(run.call_count, 1)
        down = types.SimpleNamespace(returncode=1, stdout="", stderr="gh: (HTTP 503)")
        with mock.patch.object(S.subprocess, "run", return_value=down) as run, mock.patch.object(S.time, "sleep"):
            with self.assertRaises(S.ApiError):
                S.gh("repos/o/r/pulls", False)
        self.assertEqual(run.call_count, 3)

    def test_a_refusal_is_none(self):
        def refuse(url, paginate):
            raise S.ApiError("HTTP 403")

        api = S.GitHub(repo="o/r", cache=self.dir, fetch=refuse)
        with open(os.devnull, "w") as quiet:
            stderr, sys.stderr = sys.stderr, quiet
            try:
                self.assertIsNone(api.get_or_none("issues/3/timeline"))
            finally:
                sys.stderr = stderr


class Workflows(unittest.TestCase):
    """The Slow suite's and the Flake hunt's runs, judged by their first
    attempt as CI's are."""

    def test_a_run_re_run_green_counts_by_its_first_attempt(self):
        jobs = [
            job("Asked for", 0, 0, 1),
            job("Slow browser (1/6)", 1, 2, 30, "failure"),
            job("Asked for", 40, 40, 41, attempt=2),
            job("Slow browser (1/6)", 41, 41, 70, attempt=2),
        ]
        rerun = run(1, 0, jobs, attempt=2)  # its final conclusion: success
        self.assertEqual(S.workflow_verdict(rerun), "red")
        green = run(2, 0, [job("Asked for", 0, 0, 1), job("Slow browser (1/6)", 1, 2, 30)])
        red_unread = run(3, 0, [], conclusion="failure")
        red_unread["jobs"] = None
        w = S.workflow_runs([rerun, green, red_unread], BASE, BASE + dt.timedelta(days=1))
        self.assertEqual((w["green"], w["red"], w["wall_green"]["median"]), (1, 2, 30.0))


class Until(unittest.TestCase):
    def test_a_window_never_runs_past_now(self):
        # "Now" is noon; main has been red since 11:00, and one PR merged.
        now = BASE + dt.timedelta(hours=12)
        seen = {}

        def fake_collect(api, since, until, now_):
            seen["until"] = until
            return {
                "ci": [red_run(2, 650, event="push", branch="main")],
                "main_before": [],
                "main_after": [],
                "prs": [pr(1, "a", 0, 60, "docs", comments=[])],
                "other": {},
            }

        out = io.StringIO()
        with mock.patch.object(S, "collect", fake_collect), contextlib.redirect_stdout(out):
            with contextlib.redirect_stderr(io.StringIO()):
                S.main(["--since", "2026-10-01", "--until", "2026-10-01", "--format", "json"], now=now)
        s = json.loads(out.getvalue())
        self.assertEqual((seen["until"], s["until"]), (now, S.iso(now)))
        self.assertEqual(s["main_red"]["stretches"][0]["minutes"], 60)
        self.assertEqual(s["prs"]["per_day"], 2.0)


def gh_answer(code, stderr="", stdout=""):
    return types.SimpleNamespace(returncode=code, stdout=stdout, stderr=stderr)


class RateLimit(unittest.TestCase):
    def test_what_is_the_rate_limit(self):
        self.assertTrue(S.limited("gh: Too Many Requests (HTTP 429)"))
        self.assertTrue(S.limited("gh: API rate limit exceeded for installation ID 1. (HTTP 403)"))
        self.assertFalse(S.limited("gh: Not Found (HTTP 404)"))
        # A bare 403 asks the limit itself, which costs nothing against it.
        with mock.patch.object(S.subprocess, "run", return_value=gh_answer(0, stdout="0\n")):
            self.assertTrue(S.limited("gh: Forbidden (HTTP 403)"))
        with mock.patch.object(S.subprocess, "run", return_value=gh_answer(0, stdout="4211\n")):
            self.assertFalse(S.limited("gh: Resource not accessible by integration (HTTP 403)"))

    def test_gh_raises_it_at_once(self):
        answer = gh_answer(1, stderr="gh: API rate limit exceeded (HTTP 403)")
        with mock.patch.object(S.subprocess, "run", return_value=answer) as call, mock.patch.object(S.time, "sleep"):
            with self.assertRaises(S.RateLimited):
                S.gh("repos/o/r/pulls", False)
        self.assertEqual(call.call_count, 1)

    def test_after_it_nothing_more_is_sent(self):
        calls = []

        def fetch(url, paginate):
            calls.append(url)
            raise S.RateLimited("HTTP 429")

        with tempfile.TemporaryDirectory() as d:
            api = S.GitHub(repo="o/r", cache=d, fetch=fetch)
            for _ in range(3):
                with self.assertRaises(S.RateLimited):
                    api.get("pulls")
            self.assertIsNone(api.get_or_none("issues/1/comments"))
        self.assertEqual((len(calls), api.stopped), (1, "HTTP 429"))

    def run_main(self, fake_collect, *argv):
        out, err = io.StringIO(), io.StringIO()
        with mock.patch.object(S, "collect", fake_collect), contextlib.redirect_stdout(out):
            with contextlib.redirect_stderr(err):
                code = S.main(["--since", "2026-10-01", *argv], now=BASE + dt.timedelta(days=2))
        return code, out.getvalue(), err.getvalue()

    @staticmethod
    def stop_early(api, since, until, now):
        raise S.RateLimited("HTTP 403 API rate limit exceeded")

    @staticmethod
    def stop_late(api, since, until, now):
        api.stopped = "HTTP 403 API rate limit exceeded"
        data = week()
        data["ci"][0]["unread"] = True
        return data

    def test_stopped_before_the_lists_exits_red_with_nothing_but_the_stop(self):
        code, out, err = self.run_main(self.stop_early)
        self.assertEqual(code, S.STOPPED)
        self.assertIn("Stopped at GitHub's rate limit", out)
        self.assertIn("stopped at GitHub's rate limit", err)
        code, out, err = self.run_main(self.stop_early, "--format", "json")
        self.assertEqual((code, json.loads(out)), (S.STOPPED, {"stopped": "HTTP 403 API rate limit exceeded"}))
        self.assertIn("stopped at GitHub's rate limit", err)

    def test_stopped_part_way_reports_what_it_read_and_exits_red(self):
        code, out, err = self.run_main(self.stop_late, "--format", "json")
        s = json.loads(out)
        self.assertEqual((code, s["stopped"], s["unread"]["runs"]), (S.STOPPED, "HTTP 403 API rate limit exceeded", 1))
        self.assertIn("rows", s)
        self.assertIn("left out", err)
        code, out, err = self.run_main(self.stop_late)
        self.assertEqual(code, S.STOPPED)
        self.assertTrue(out.startswith("## CI health"))
        self.assertIn("**Stopped at GitHub's rate limit**", out)

    def test_compare_refuses_a_partial_run_or_markdown(self):
        with tempfile.TemporaryDirectory() as d:
            for name, text in (("partial.json", json.dumps({"stopped": "HTTP 429"})), ("summary.md", "## CI health\n")):
                path = os.path.join(d, name)
                with open(path, "w") as f:
                    f.write(text)
                with contextlib.redirect_stderr(io.StringIO()) as err, self.assertRaises(SystemExit) as stop:
                    self.run_main(self.stop_late, "--compare", path)
                self.assertEqual(stop.exception.code, 2)


class Collect(unittest.TestCase):
    """`collect` against a fake API: what it asks for, what it keeps, and
    what it does at the rate limit."""

    SINCE, UNTIL, NOW = BASE, BASE + dt.timedelta(days=2), BASE + dt.timedelta(days=3)

    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.calls = []
        self.limit_on = None
        done = run(1, 30, [job("Lint", 30, 31, 35), job("CI", 35, 35, 36)], branch="a-pr")
        flying = run(2, 40, [job("Lint", 40, 41, 45)], branch="a-pr", status="in_progress", conclusion=None)
        old_red = red_run(3, -60, event="push", branch="main")
        self.runs = {1: done, 2: flying, 3: old_red}
        # What each day's list of ci.yml runs answers with (every day: each
        # must come out once), and the list of main's runs before the window.
        self.listed, self.before = [1, 2], [3]
        self.prs = [
            {
                "number": 7,
                "title": "A PR",
                "head": {"ref": "a-pr"},
                "created_at": at(0),
                "updated_at": at(100),
                "closed_at": at(100),
                "merged_at": at(100),
            }
        ]

    def tearDown(self):
        shutil.rmtree(self.dir)

    def listing(self, r):
        return {k: v for k, v in r.items() if k != "jobs"}

    def fetch(self, url, paginate):
        self.calls.append(url)
        path, _, query = url.partition("?")
        q = urllib.parse.parse_qs(query)
        if self.limit_on and self.limit_on in path:
            raise S.RateLimited("HTTP 429")
        if path.endswith("/pulls"):
            return json.dumps(self.prs if q["page"] == ["1"] else [])
        if path.endswith("/actions/workflows/ci.yml/runs"):
            ids = self.before if q["created"][0].startswith("<") else self.listed
            return json.dumps({"workflow_runs": [self.listing(self.runs[i]) for i in ids]})
        if "/actions/workflows/" in path:
            return json.dumps({"workflow_runs": []})
        m = re.search(r"/actions/runs/(\d+)/jobs$", path)
        if m:
            return json.dumps({"jobs": self.runs[int(m.group(1))]["jobs"]})
        if re.search(r"/pulls/7/files$", path):
            return json.dumps([{"filename": "crates/x/src/lib.rs"}])
        if re.search(r"/issues/7/comments$", path):
            return json.dumps([payload("merged", 90, 91)])
        raise AssertionError(f"unexpected {url}")

    def collect(self):
        self.api = S.GitHub(repo="o/r", cache=self.dir, fetch=self.fetch)
        return S.collect(self.api, self.SINCE, self.UNTIL, self.NOW, workers=2)

    def kept(self, rid):
        url = self.api.url(f"actions/runs/{rid}/jobs", {"filter": "all", "per_page": 100})
        return os.path.exists(self.api.file(url))

    def test_each_run_once_and_only_finished_ones_kept(self):
        data = self.collect()
        self.assertEqual([r["id"] for r in data["ci"]], [1, 2])
        # Two days of the window, and the one day between its end and now.
        self.assertEqual(sum(1 for c in self.calls if "/workflows/ci.yml/runs" in c and "%3C" not in c), 2 + 1)
        self.assertTrue(self.kept(1))
        self.assertFalse(self.kept(2))
        self.assertTrue(self.kept(3))
        self.assertEqual([p["kind"] for p in data["prs"]], ["rust"])
        # A second run reads what was kept, and asks again for the rest.
        self.calls.clear()
        self.collect()
        self.assertFalse(any("/runs/1/jobs" in c or "/pulls/7/files" in c for c in self.calls))
        self.assertTrue(any("/runs/2/jobs" in c for c in self.calls))

    def test_main_before_the_window_and_the_queue(self):
        s = S.measure(self.collect(), self.SINCE, self.UNTIL)
        [w] = s["main_red"]["stretches"]
        self.assertEqual((w["red_runs"], w["clipped"], w["to"]), ([3], True, None))
        self.assertEqual((s["prs"]["queue"]["median"], s["rows"]["rust"]["runs"]), (10.0, 1))

    def test_a_pr_opened_before_the_window_and_main_on_either_side(self):
        # The PR opened 5 h before the window, so main's runs from then are
        # listed too, without their jobs: a red re-run green by hand (3) and
        # a run that ran nothing (4). main_before reads 4, then 3, by their
        # jobs. After the window: red (5), green (6), green (7).
        self.prs[0]["created_at"] = at(-300)
        red = self.runs[3]
        red["run_attempt"], red["conclusion"] = 2, "success"
        red["jobs"] += [dict(j, run_attempt=2, conclusion="success") for j in red_run(3, -30)["jobs"]]
        self.runs[4] = run(4, -10, [job("What changed", -10, -10, -9), job("CI", -9, -9, -8)], event="push", branch="main")
        end = 2 * 1440
        self.runs[5] = red_run(5, end + 10, event="push", branch="main")
        self.runs[6] = green_run(6, end + 40, event="push", branch="main")
        self.runs[7] = green_run(7, end + 80, event="push", branch="main")
        self.listed, self.before = [1, 2, 3, 4, 5, 6, 7], [4, 3]
        data = self.collect()
        self.assertEqual([r["id"] for r in data["ci"]], [3, 4, 1, 2])
        self.assertTrue(all("jobs" not in r for r in data["ci"] if r["id"] in (3, 4)))
        self.assertEqual([r["id"] for r in data["main_before"]], [3])
        self.assertEqual([r["id"] for r in data["main_after"]], [5, 6])
        self.assertFalse(any("/runs/7/jobs" in c for c in self.calls))
        s = S.measure(data, self.SINCE, self.UNTIL)
        [w] = s["main_red"]["stretches"]
        self.assertEqual((w["from"], w["clipped"], w["red_runs"], w["green_run"]), (at(0), True, [3, 5], 6))
        self.assertEqual(w["to"], at(end + 50))

    def test_the_prs_stop_at_a_short_page_or_an_old_one(self):
        api = S.GitHub(repo="o/r", cache=self.dir, fetch=self.fetch)
        self.assertEqual([p["number"] for p in S.list_prs(api, self.SINCE)], [7])
        self.assertEqual(sum(1 for c in self.calls if c.split("?")[0].endswith("/pulls")), 1)
        # A full page that reaches back past the window's day before stops too.
        self.calls.clear()
        self.prs = [dict(self.prs[0], number=n, updated_at=at(-3000)) for n in range(100)]
        self.assertEqual(len(S.list_prs(api, self.SINCE)), 100)
        self.assertEqual(sum(1 for c in self.calls if c.split("?")[0].endswith("/pulls")), 1)
        # A full page of recent ones reads the next.
        self.calls.clear()
        self.prs = [dict(self.prs[0], number=n, updated_at=at(100)) for n in range(100)]
        S.list_prs(api, self.SINCE)
        self.assertEqual(sum(1 for c in self.calls if c.split("?")[0].endswith("/pulls")), 2)

    def test_at_the_rate_limit_what_was_read_is_reported(self):
        self.limit_on = "/runs/1/jobs"
        data = self.collect()
        self.assertTrue(self.api.stopped)
        s = S.measure(data, self.SINCE, self.UNTIL)
        self.assertNotIn("rust", {k for k, r in s["rows"].items() if r.get("runs")})
        self.assertGreaterEqual(s["unread"]["runs"], 1)
        s["stopped"] = self.api.stopped
        self.assertIn("**Stopped at GitHub's rate limit**", S.markdown(s))


if __name__ == "__main__":
    unittest.main(verbosity=1)
