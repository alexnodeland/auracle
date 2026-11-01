#!/usr/bin/env python3
"""ci_skip.py's tests: when Search health's and the Slow suite's nightly
runs skip an unchanged main, when the Slow suite skips a push to main that
changes nothing its tests cover, and that anything that keeps it from
deciding is a run, never a skip and never an error.

    python3 scripts/test_ci_skip.py      (run by `make dev-check`)

No test reaches the network: the runs, jobs and compares are small dicts
written here, answered by a fake API that records each path it was asked.
Python 3 standard library only.
"""

import contextlib
import io
import os
import re
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import ci_skip as K  # noqa: E402

REPO = "o/r"
HEAD = "a" * 40
OLD = "b" * 40
OLDER = "c" * 40


def job(name, conclusion="success", runner="GitHub Actions 1"):
    return {"name": name, "conclusion": conclusion, "runner_name": runner if conclusion != "skipped" else ""}


TESTED = [job("Asked for"), job("Slow Rust (search floor)"), job("Slow browser (1/6)")]
SKIPPED = [job("Asked for"), job("Slow Rust (search floor)", "skipped"), job("Slow browser (1/6)", "skipped")]


def run(rid, sha, day, event="schedule", conclusion="success", status="completed", branch="main"):
    return {
        "id": rid,
        "run_number": rid,
        "name": "Slow suite",
        "html_url": f"https://github.com/{REPO}/actions/runs/{rid}",
        "head_sha": sha,
        "head_branch": branch,
        "event": event,
        "status": status,
        "conclusion": conclusion,
        "created_at": f"2026-10-{day:02d}T10:00:00Z",
    }


class FakeAPI:
    """The REST API, from dicts: `runs` the workflow's runs (filtered as the
    API filters them by `event` and `status`), `jobs` each run's jobs by id,
    `compares` each `base...head`'s answer. Records each path asked."""

    def __init__(self, runs=(), jobs=None, compares=None, fail=None):
        self.runs, self.jobs, self.compares, self.fail = list(runs), jobs or {}, compares or {}, fail
        self.asked = []

    def __call__(self, path):
        self.asked.append(path)
        if self.fail and re.search(self.fail, path):
            raise K.Undecided(f"`gh api {path}`: HTTP 502")
        if "/actions/workflows/" in path:
            q = dict(p.split("=", 1) for p in path.split("?", 1)[1].split("&"))
            rs = [
                r
                for r in self.runs
                if ("event" not in q or r["event"] == q["event"])
                and (q.get("status") not in ("completed",) or r["status"] == "completed")
                and (q.get("status") != "success" or r["conclusion"] == "success")
            ]
            return {"workflow_runs": rs}
        m = re.search(r"/actions/runs/(\d+)/jobs", path)
        if m:
            return {"jobs": self.jobs.get(int(m.group(1)), [])}
        m = re.search(r"/compare/(\w+)\.\.\.(\w+)", path)
        if m:
            return self.compares[(m.group(1), m.group(2))]
        raise AssertionError(f"unexpected path {path}")


def ahead(*files):
    return {"status": "ahead", "files": [{"filename": f} for f in files]}


ENV = {"GITHUB_REPOSITORY": REPO, "GITHUB_SHA": HEAD, "GITHUB_RUN_ID": "999"}


def decide(mode, api, env=ENV):
    return K.decide(mode, "slow-suite.yml", env, api)


class Nightly(unittest.TestCase):
    """A scheduled run of Search health or the Slow suite."""

    def test_an_unchanged_main_its_last_scheduled_run_tested_green_skips(self):
        api = FakeAPI([run(1, HEAD, 30)], {1: TESTED})
        go, why, error = decide("nightly", api)
        self.assertFalse(go)
        self.assertFalse(error)
        self.assertIn("**Skipped:**", why)
        self.assertIn(f"runs/1)", why)
        self.assertIn("`aaaaaaaaaaaa`", why)

    def test_a_main_that_moved_runs(self):
        go, why, _ = decide("nightly", FakeAPI([run(1, OLD, 30)], {1: TESTED}))
        self.assertTrue(go)
        self.assertIn("`bbbbbbbbbbbb`", why)

    def test_a_red_last_run_on_the_same_commit_runs_again(self):
        api = FakeAPI([run(2, HEAD, 31, conclusion="failure"), run(1, HEAD, 30)], {2: TESTED, 1: TESTED})
        go, why, _ = decide("nightly", api)
        self.assertTrue(go)
        self.assertIn("failure", why)

    def test_a_night_that_skipped_is_passed_over_for_the_run_that_tested(self):
        # The skip ran only the job that decided so; the answer is run 1's.
        api = FakeAPI([run(2, HEAD, 31), run(1, HEAD, 30)], {2: [job("Asked for")], 1: TESTED})
        go, why, _ = decide("nightly", api)
        self.assertFalse(go)
        self.assertIn("runs/1)", why)

    def test_a_cancelled_run_is_no_answer_and_is_passed_over(self):
        api = FakeAPI([run(2, OLD, 31, conclusion="cancelled"), run(1, HEAD, 30)], {2: TESTED, 1: TESTED})
        go, _, _ = decide("nightly", api)
        self.assertFalse(go)
        self.assertNotIn("repos/o/r/actions/runs/2/jobs?per_page=100", api.asked)

    def test_a_run_in_progress_and_this_run_itself_are_no_precedent(self):
        api = FakeAPI(
            [run(999, HEAD, 31, status="in_progress", conclusion=None), run(5, HEAD, 31, status="in_progress", conclusion=None)],
            {999: TESTED, 5: TESTED},
        )
        go, _, _ = decide("nightly", api)
        self.assertTrue(go)

    def test_a_push_or_a_run_by_hand_on_the_same_commit_is_not_a_scheduled_run(self):
        api = FakeAPI([run(2, HEAD, 31, event="push"), run(1, HEAD, 31, event="workflow_dispatch")], {2: TESTED, 1: TESTED})
        go, _, _ = decide("nightly", api)
        self.assertTrue(go)

    def test_no_scheduled_run_that_tested_anything_runs(self):
        go, why, error = decide("nightly", FakeAPI([run(1, HEAD, 30)], {1: SKIPPED}))
        self.assertTrue(go)
        self.assertFalse(error)
        self.assertIn("no scheduled run", why)

    def test_it_asks_for_main_s_scheduled_runs_of_its_own_workflow(self):
        api = FakeAPI([run(1, HEAD, 30)], {1: TESTED})
        decide("nightly", api)
        self.assertTrue(api.asked[0].startswith("repos/o/r/actions/workflows/slow-suite.yml/runs?branch=main&"))
        self.assertIn("event=schedule", api.asked[0])


class MainPush(unittest.TestCase):
    """The Slow suite on a push to main."""

    def push(self, *files, base_runs=None, jobs=None):
        runs = base_runs or [run(1, OLD, 30, event="push")]
        api = FakeAPI(runs, jobs or {1: TESTED}, {(OLD, HEAD): ahead(*files)})
        return decide("main-push", api), api

    def test_a_push_of_docs_the_site_and_the_agent_docs_skips(self):
        (go, why, error), _ = self.push("docs/process.md", "www/docs/src/play.md", ".claude/README.md", "changelog.d/x.md")
        self.assertFalse(go)
        self.assertFalse(error)
        self.assertIn("**Skipped:**", why)
        self.assertIn("`docs/process.md`", why)
        self.assertIn("runs/1)", why)

    def test_each_path_of_the_slow_list_runs(self):
        # docs/architecture/testing.md § When the slow tier runs, path by path.
        for f in (
            "crates/auracle-grammar/src/lib.rs",
            "Cargo.toml",
            "Cargo.lock",
            "rust-toolchain.toml",
            "Makefile",
            ".config/nextest.toml",
            ".github/workflows/slow-suite.yml",
            ".github/actions/browser-shard/action.yml",
            "apps/web/worker.js",
            "apps/web/farm.js",
            "apps/web/perform.js",
            "apps/web/patch.js",
            "apps/web/live-audio.js",
            "apps/web/audio-in.js",
            "apps/web/explain.js",
            "apps/web/faces.js",
            "apps/web/vessel.js",
            "apps/web/main.js",
            "tests/web/fixtures.js",
            "tests/web/playwright.config.js",
            "tests/web/package.json",
            "tests/web/package-lock.json",
            "tests/web/perform_next.spec.js",
        ):
            with self.subTest(f=f):
                (go, why, _), _ = self.push("docs/process.md", f)
                self.assertTrue(go)
                self.assertIn(f"`{f}`", why)
                self.assertNotIn("`docs/process.md`", why)

    def test_the_base_is_the_last_run_that_tested_green_not_a_newer_skip(self):
        # Run 3 was superseded (only its scope ran), run 2 was red: the
        # files are counted from run 1's commit, so a superseded push's
        # changes are never lost.
        runs = [run(3, OLD, 31, event="push"), run(2, OLD, 31, event="push", conclusion="failure"), run(1, OLDER, 30)]
        api = FakeAPI(runs, {3: [job("Asked for")], 2: TESTED, 1: TESTED}, {(OLDER, HEAD): ahead("crates/x/src/lib.rs")})
        go, why, _ = decide("main-push", api)
        self.assertTrue(go)
        self.assertIn("runs/1)", why)
        self.assertTrue(any("/compare/" + OLDER + "..." + HEAD in p for p in api.asked))

    def test_a_run_by_hand_or_the_nightly_s_commit_is_a_base_and_a_pr_s_never(self):
        for event, ok in (("workflow_dispatch", True), ("schedule", True), ("pull_request", False)):
            with self.subTest(event=event):
                runs = [run(1, OLD, 30, event=event)]
                api = FakeAPI(runs, {1: TESTED}, {(OLD, HEAD): ahead("docs/x.md")})
                go, _, _ = decide("main-push", api)
                self.assertEqual(go, not ok)

    def test_the_commit_a_green_run_tested_skips(self):
        api = FakeAPI([run(1, HEAD, 30, event="push")], {1: TESTED}, {(HEAD, HEAD): {"status": "identical", "files": []}})
        go, why, _ = decide("main-push", api)
        self.assertFalse(go)
        self.assertIn("this very commit", why)

    def test_no_green_run_that_tested_anything_runs(self):
        go, why, error = decide("main-push", FakeAPI([run(1, OLD, 30, event="push")], {1: SKIPPED}))
        self.assertTrue(go)
        self.assertFalse(error)

    def test_a_renamed_file_counts_by_its_old_path_too(self):
        cmp = {"status": "ahead", "files": [{"filename": "docs/old-worker.md", "previous_filename": "apps/web/worker.js"}]}
        api = FakeAPI([run(1, OLD, 30, event="push")], {1: TESTED}, {(OLD, HEAD): cmp})
        go, _, _ = decide("main-push", api)
        self.assertTrue(go)


class AnErrorIsARun(unittest.TestCase):
    """Whatever keeps it from deciding runs, says why, and is never an
    error of the step's own."""

    def assertRuns(self, api, mode="main-push", env=ENV):
        go, why, error = decide(mode, api, env)
        self.assertTrue(go)
        self.assertTrue(error)
        self.assertIn("no reason to skip", why)

    def test_the_api_failing_at_each_call_runs(self):
        for mode in ("nightly", "main-push"):
            for fail in ("/actions/workflows/", "/jobs", "/compare/"):
                with self.subTest(mode=mode, fail=fail):
                    if mode == "nightly" and fail == "/compare/":
                        continue
                    runs = [run(1, OLD if mode == "main-push" else HEAD, 30, event="push" if mode == "main-push" else "schedule")]
                    api = FakeAPI(runs, {1: TESTED}, {(OLD, HEAD): ahead("docs/x.md")}, fail=fail)
                    self.assertRuns(api, mode)

    def test_a_compare_it_cannot_trust_runs(self):
        for cmp in (
            {"status": "diverged", "files": [{"filename": "docs/x.md"}]},
            {"status": "behind", "files": []},
            {"status": "ahead", "files": [{"filename": f"docs/{i}.md"} for i in range(K.FILES_CAP)]},
            {"status": "ahead"},
            {"status": "ahead", "files": []},
            ["not", "a", "compare"],
        ):
            with self.subTest(cmp=str(cmp)[:40]):
                self.assertRuns(FakeAPI([run(1, OLD, 30, event="push")], {1: TESTED}, {(OLD, HEAD): cmp}))

    def test_an_answer_it_cannot_read_runs(self):
        class Odd(FakeAPI):
            def __call__(self, path):
                return {"message": "Not Found"}

        for mode in ("nightly", "main-push"):
            with self.subTest(mode=mode):
                self.assertRuns(Odd(), mode)

    def test_a_bug_of_its_own_runs(self):
        def boom(path):
            raise KeyError("surprise")

        self.assertRuns(boom)

    def test_no_repository_or_commit_runs(self):
        self.assertRuns(FakeAPI(), env={"GITHUB_RUN_ID": "1"})

    def test_the_time_running_out_runs(self):
        old = K.DEADLINE_S
        K.DEADLINE_S = -1
        try:
            go, why, error = K.decide("nightly", "slow-suite.yml", ENV)
        finally:
            K.DEADLINE_S = old
        self.assertTrue(go)
        self.assertIn("out of time", why)


class Main(unittest.TestCase):
    """What the workflow's step reads: one line, the summary, exit 0."""

    def call(self, api, mode="main-push"):
        out, err = io.StringIO(), io.StringIO()
        with tempfile.NamedTemporaryFile("r", suffix=".md", delete=False) as f:
            summary = f.name
        self.addCleanup(os.unlink, summary)
        env = dict(ENV, GITHUB_STEP_SUMMARY=summary)
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = K.main([mode, "--workflow", "slow-suite.yml"], env=env, api=api)
        with open(summary) as f:
            return code, out.getvalue(), err.getvalue(), f.read()

    def test_a_skip_prints_run_false_and_says_why_in_the_summary(self):
        api = FakeAPI([run(1, OLD, 30, event="push")], {1: TESTED}, {(OLD, HEAD): ahead("docs/x.md")})
        code, out, err, summary = self.call(api)
        self.assertEqual((code, out), (0, "run=false\n"))
        self.assertIn("**Skipped:**", summary)
        self.assertNotIn("::warning::", err)

    def test_an_error_prints_run_true_with_a_warning_and_exits_0(self):
        code, out, err, summary = self.call(FakeAPI(fail="."))
        self.assertEqual((code, out), (0, "run=true\n"))
        self.assertTrue(err.startswith("::warning::Running:"))
        self.assertIn("no reason to skip", summary)


class TheWorkflows(unittest.TestCase):
    """Each workflow that asks names itself, and asks in the mode its event
    calls for: Search health and the Slow suite each night, the Slow suite
    on a push. The Flake hunt never asks."""

    def read(self, name):
        with open(os.path.join(ROOT, ".github", "workflows", name)) as f:
            return f.read()

    def test_each_call_names_the_file_it_is_in(self):
        for name in sorted(os.listdir(os.path.join(ROOT, ".github", "workflows"))):
            for named in re.findall(r"ci_skip\.py \S+ --workflow ([\w.-]+)", self.read(name)):
                with self.subTest(name=name):
                    self.assertEqual(named, name)

    def test_who_asks_and_how(self):
        for name, call in (
            ("search-health.yml", "ci_skip.py nightly --workflow search-health.yml"),
            ("slow-suite.yml", 'ci_skip.py "$mode" --workflow slow-suite.yml'),
        ):
            with self.subTest(name=name):
                self.assertTrue(call in self.read(name), f"{name} does not run `{call}`")
        self.assertFalse("ci_skip.py" in self.read("flake-hunt.yml"), "the Flake hunt asks to skip")


if __name__ == "__main__":
    unittest.main(verbosity=1)
