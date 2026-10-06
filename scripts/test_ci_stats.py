#!/usr/bin/env python3
"""ci_stats.py's tests: the kind of PR, the quantiles, a run's verdict, main's
red stretches, the queue time, the whole measurement on a small week, the
queue's lane, the comparison with a saved run, and the cache.

    python3 scripts/test_ci_stats.py      (run by `make dev-check`)

No test reaches the network: the runs, jobs and PRs are small dicts written
here, and the cache's cases hand `GitHub` a fetch that counts its calls.
Python 3 standard library only.
"""

import datetime as dt
import json
import os
import shutil
import sys
import tempfile
import types
import unittest
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


def run(rid, created, jobs, branch="feature", event="pull_request", conclusion="success", attempt=1, status="completed"):
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


def pr(number, branch, created, merged, kind="rust", timeline=None, comments=None):
    return {
        "number": number,
        "title": f"PR {number}",
        "branch": branch,
        "created_at": at(created),
        "closed_at": at(merged) if merged is not None else None,
        "merged_at": at(merged) if merged is not None else None,
        "kind": kind,
        "timeline": timeline,
        "comments": comments,
    }


class Classify(unittest.TestCase):
    def test_rust_wins_over_every_other_kind(self):
        self.assertEqual(S.classify(["docs/a.md", "apps/web/main.js", ".github/workflows/ci.yml", "crates/x/src/lib.rs"]), "rust")
        self.assertEqual(S.classify(["Cargo.lock"]), "rust")
        self.assertEqual(S.classify(["rust-toolchain.toml"]), "rust")

    def test_ci_wins_over_web(self):
        self.assertEqual(S.classify(["tests/web/shard.mjs", ".github/actions/browser-shard/action.yml"]), "ci")
        self.assertEqual(S.classify(["Makefile"]), "ci")
        self.assertEqual(S.classify([".mergify.yml"]), "ci")
        self.assertEqual(S.classify(["scripts/ci_stats.py"]), "ci")

    def test_web_is_the_app_or_its_specs(self):
        self.assertEqual(S.classify(["apps/web/main.js", "CHANGELOG.md"]), "web")
        self.assertEqual(S.classify(["tests/web/package-lock.json"]), "web")

    def test_anything_else_is_docs_only(self):
        self.assertEqual(S.classify(["docs/process.md", "www/docs/src/a.md", "README.md", ".claude/skills/ship/SKILL.md"]), "docs")
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
        self.assertEqual(S.window_text("2026-09-28T00:00:00Z", "2026-10-06T00:00:00Z"), "2026-09-28 to 2026-10-05 (UTC, both days in)")


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

    def test_waits_count_jobs_that_got_a_runner(self):
        r = green_run(6, 0, wait=3)
        r["jobs"].append({"name": "Site", "conclusion": "skipped", "run_attempt": 1, "runner_name": "", "created_at": at(0), "started_at": at(9), "completed_at": at(9)})
        self.assertEqual(S.waits(r), [3, 0])


class MainRed(unittest.TestCase):
    UNTIL = BASE + dt.timedelta(days=1)

    def test_consecutive_reds_are_one_stretch_until_the_next_green(self):
        runs = [
            green_run(1, 0, event="push", branch="main"),
            red_run(2, 20, event="push", branch="main"),
            red_run(3, 40, event="push", branch="main"),
            green_run(4, 60, minutes=15, event="push", branch="main"),
            green_run(5, 90, event="push", branch="main"),
        ]
        [w] = S.main_red(runs, self.UNTIL)
        self.assertEqual((w["from"], w["to"]), (at(30), at(75)))
        self.assertEqual(w["minutes"], 45)
        self.assertEqual((w["red_runs"], w["green_run"]), ([2, 3], 4))

    def test_a_red_never_followed_by_green_is_measured_to_the_end(self):
        runs = [green_run(1, 0, event="push", branch="main"), red_run(2, 1380, event="push", branch="main")]
        [w] = S.main_red(runs, self.UNTIL)
        self.assertIsNone(w["to"])
        self.assertEqual(w["minutes"], 50)

    def test_a_cancelled_run_neither_opens_nor_closes_a_stretch(self):
        cancelled = run(3, 30, [], event="push", branch="main", conclusion="cancelled")
        cancelled["jobs"] = None
        runs = [red_run(2, 0, event="push", branch="main"), cancelled, green_run(4, 60, event="push", branch="main")]
        [w] = S.main_red(runs, self.UNTIL)
        self.assertEqual(w["green_run"], 4)

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
    def test_the_queue_label(self):
        timeline = [
            {"event": "labeled", "label": {"name": "full-ci"}, "created_at": at(5)},
            {"event": "labeled", "label": {"name": "queue"}, "created_at": at(10)},
        ]
        self.assertEqual(S.queued_at(timeline, []), BASE + dt.timedelta(minutes=10))

    def test_the_command_and_the_first_of_both(self):
        comments = [
            {"body": "Looks good.", "user": {"type": "User"}, "created_at": at(2)},
            {"body": "@Mergifyio queue", "user": {"type": "User"}, "created_at": at(7)},
        ]
        self.assertEqual(S.queued_at([], comments), BASE + dt.timedelta(minutes=7))
        timeline = [{"event": "labeled", "label": {"name": "queue"}, "created_at": at(12)}]
        self.assertEqual(S.queued_at(timeline, comments), BASE + dt.timedelta(minutes=7))

    def test_what_is_not_the_command(self):
        comments = [
            {"body": "@mergifyio queue", "user": {"type": "Bot"}, "created_at": at(1)},
            {"body": "Then comment `@mergifyio queue` on it.", "user": {"type": "User"}, "created_at": at(2)},
            {"body": "@mergifyio queued?", "user": {"type": "User"}, "created_at": at(3)},
        ]
        self.assertIsNone(S.queued_at([], comments))
        self.assertIsNone(S.queued_at(None, None))


def week():
    """Two merged PRs and main over one day: #1 (Rust) red once then green,
    queued by its label; #2 (web) green on its one run, merged by hand; main
    red once, then green."""
    timeline = [{"event": "labeled", "label": {"name": "queue"}, "created_at": at(40)}]
    prs = [
        pr(1, "rust-pr", 0, 60, "rust", timeline=timeline, comments=[]),
        pr(2, "web-pr", 100, 130, "web", timeline=[], comments=[]),
        pr(3, "old-pr", -3000, -2000, "docs", timeline=[], comments=[]),
    ]

    def shards(created, minutes):
        return [job(f"Browser ({k}/3)", created, created + 1, created + 1 + m) for k, m in zip((1, 2, 3), minutes)]

    r1 = red_run(10, 2, branch="rust-pr")
    r2 = green_run(11, 20, minutes=20, wait=2, branch="rust-pr")
    r2["jobs"] = shards(20, (6, 8, 10)) + r2["jobs"]
    r3 = green_run(12, 101, minutes=12, wait=0, branch="web-pr")
    r3["jobs"] = shards(101, (5, 5, 9)) + r3["jobs"]
    stray = green_run(13, 200, branch="nobody")
    mains = [green_run(20, 61, event="push", branch="main"), red_run(21, 131, event="push", branch="main"), green_run(22, 150, event="push", branch="main")]
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
        # Run 11: its test job waited 2, its shards 1 each, CI 0.
        self.assertEqual(self.s["rows"]["rust"]["longest_wait"]["max"], 2.0)
        self.assertEqual(self.s["rows"]["rust"]["wait_per_run"]["max"], 5.0)

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
    jobs = [job(f"Browser ({k}/2)", created, created + 1, created + 9, "failure" if red and k == 2 else "success") for k in (1, 2)]
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
            [job("Browser (1/2)", 0, 1, 4, "cancelled"), job("CI", 4, 4, 5, "failure"), job("Full gate", 5, 5, 6, "failure")],
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
            self.assertEqual(api.get("actions/runs/7/jobs", {"filter": "all"}, key="jobs", paginate=True, keep=True), [{"id": 1}, {"id": 2}])
        self.assertEqual(self.calls, [("repos/o/r/actions/runs/7/jobs?filter=all", True)])
        self.assertEqual((api.fetched, api.reused), (1, 1))

    def test_what_may_still_change_is_fetched_each_time(self):
        api = self.api('[{"filename": "a"}][{"filename": "b"}]')
        for _ in range(2):
            self.assertEqual(api.get("pulls/3/files", paginate=True), [{"filename": "a"}, {"filename": "b"}])
        self.assertEqual(len(self.calls), 2)
        self.assertEqual(os.listdir(self.dir), [])

    def test_a_server_error_is_asked_again_and_a_refusal_is_not(self):
        answers = [types.SimpleNamespace(returncode=1, stdout="", stderr="gh: Server Error (HTTP 502)"), types.SimpleNamespace(returncode=0, stdout="[]", stderr="")]
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


if __name__ == "__main__":
    unittest.main(verbosity=1)
