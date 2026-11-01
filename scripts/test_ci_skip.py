#!/usr/bin/env python3
"""ci_skip.py's tests: when Search health's and the Slow suite's nightly
runs skip a head a run on main has tested green, when the Slow suite skips
a push to main that changes nothing its tests cover, and that anything
that keeps it from deciding is a run, never a skip and never an error.
Beside them, the other half of #582: the Flake hunt never asks, and holds
at most three runners at once.

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


def run(rid, sha, day, event="schedule", conclusion="success", status="completed", branch="main", at="10:00:00"):
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
        "created_at": f"2026-10-{day:02d}T{at}Z",
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
    """A scheduled run of Search health or the Slow suite: it stands on the
    newest run on main that tested anything, whatever started it (the
    nightly run, a push, a run by hand)."""

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

    def test_a_push_s_run_that_tested_the_head_green_skips(self):
        # Push 2 landed after the last night and ran in full, green: the
        # night after it, at the same commit, stands on it.
        api = FakeAPI([run(2, HEAD, 31, event="push"), run(1, OLD, 30)], {2: TESTED, 1: TESTED})
        go, why, error = decide("nightly", api)
        self.assertEqual((go, error), (False, False))
        self.assertIn("**Skipped:**", why)
        self.assertIn("runs/2)", why)
        self.assertIn("a push's run", why)

    def test_a_push_s_run_at_the_head_that_tested_nothing_is_looked_past(self):
        # Push 3 skipped (it changed nothing the slow tests cover) or was
        # superseded: it ran only the job that decided so. The newest run
        # that tested is push 2, at an older commit, so the night runs.
        for jobs in (SKIPPED, [job("Asked for")]):
            with self.subTest(jobs=len(jobs)):
                runs = [run(3, HEAD, 31, event="push"), run(2, OLD, 31, event="push"), run(1, OLDER, 30)]
                go, why, error = decide("nightly", FakeAPI(runs, {3: jobs, 2: TESTED, 1: TESTED}))
                self.assertEqual((go, error), (True, False))
                self.assertIn("runs/2)", why)
                self.assertIn("`bbbbbbbbbbbb`", why)

    def test_a_red_run_at_the_head_runs_again_whatever_its_event(self):
        # A red push at the head is seen, not looked past to an older green
        # run; and a red run by hand after a green night at the same commit
        # is the newest answer, so the night runs again.
        for runs in (
            [run(2, HEAD, 31, event="push", conclusion="failure"), run(1, OLD, 30)],
            [run(2, HEAD, 31, event="workflow_dispatch", conclusion="failure"), run(1, HEAD, 30)],
        ):
            with self.subTest(event=runs[0]["event"]):
                go, why, error = decide("nightly", FakeAPI(runs, {2: TESTED, 1: TESTED}))
                self.assertEqual((go, error), (True, False))
                self.assertIn("runs/2)", why)
                self.assertIn("failure", why)

    def test_a_run_by_hand_that_tested_the_head_green_skips_cold_or_not(self):
        # A run by hand runs every job, `cold` (no Rust cache) or not; the
        # API carries no inputs, and a cold run's jobs are any run's.
        api = FakeAPI([run(2, HEAD, 31, event="workflow_dispatch"), run(1, OLD, 30)], {2: TESTED, 1: TESTED})
        go, why, error = decide("nightly", api)
        self.assertEqual((go, error), (False, False))
        self.assertIn("runs/2)", why)
        self.assertIn("a run by hand", why)

    def test_search_health_s_run_by_hand_is_looked_past_whatever_its_seeds(self):
        # Its `seeds` input changes the tables, and the API doesn't return
        # it: a green run by hand at the head stands for no night.
        api = FakeAPI([run(2, HEAD, 31, event="workflow_dispatch"), run(1, OLD, 30)], {2: TESTED, 1: TESTED})
        go, why, error = K.decide("nightly", "search-health.yml", ENV, api)
        self.assertEqual((go, error), (True, False))
        self.assertIn("runs/1)", why)
        api = FakeAPI([run(2, HEAD, 31, event="workflow_dispatch"), run(1, HEAD, 30)], {2: TESTED, 1: TESTED})
        go, why, error = K.decide("nightly", "search-health.yml", ENV, api)
        self.assertEqual((go, error), (False, False))
        self.assertIn("runs/1)", why)

    def test_after_a_push_ran_in_a_cancelled_night_s_place_the_next_night_skips(self):
        # Night 2 was cancelled while it waited, and push 3 tested main in
        # its place (main-push), green: the next night, at that commit,
        # stands on push 3.
        runs = [run(3, HEAD, 31, event="push"), run(2, OLD, 31, conclusion="cancelled"), run(1, OLD, 30, event="push")]
        go, why, error = decide("nightly", FakeAPI(runs, {3: TESTED, 2: [], 1: TESTED}))
        self.assertEqual((go, error), (False, False))
        self.assertIn("runs/3)", why)

    def test_a_night_that_skipped_on_a_push_s_answer_passes_it_on(self):
        # Night 3 skipped on push 2's answer; night 4, still at that
        # commit, looks past night 3 to push 2.
        runs = [run(3, HEAD, 31), run(2, HEAD, 30, event="push"), run(1, OLD, 29)]
        go, why, _ = decide("nightly", FakeAPI(runs, {3: [job("Asked for")], 2: TESTED, 1: TESTED}))
        self.assertFalse(go)
        self.assertIn("runs/2)", why)

    def test_a_pr_s_run_on_a_branch_named_main_is_no_precedent(self):
        runs = [run(2, HEAD, 31, event="pull_request"), run(1, OLD, 30)]
        go, why, _ = decide("nightly", FakeAPI(runs, {2: TESTED, 1: TESTED}))
        self.assertTrue(go)
        self.assertIn("runs/1)", why)

    def test_no_run_that_tested_anything_runs(self):
        go, why, error = decide("nightly", FakeAPI([run(2, HEAD, 31, event="push"), run(1, HEAD, 30)], {2: SKIPPED, 1: SKIPPED}))
        self.assertTrue(go)
        self.assertFalse(error)
        self.assertIn("no answer to stand on", why)

    def test_it_asks_for_main_s_finished_runs_of_its_own_workflow_of_any_event(self):
        api = FakeAPI([run(1, HEAD, 30)], {1: TESTED})
        decide("nightly", api)
        self.assertTrue(api.asked[0].startswith("repos/o/r/actions/workflows/slow-suite.yml/runs?branch=main&"))
        self.assertIn("status=completed", api.asked[0])
        self.assertNotIn("event=", api.asked[0])


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

    def test_the_base_is_the_newest_by_run_number_not_by_created_at(self):
        # The API's created_at is a re-run's time: run 967, re-run at 09:41,
        # tested an older commit than run 969, made at 09:11. The base is
        # 969's commit (the fake knows no compare from 967's, so a base
        # read by created_at would be an error here).
        runs = [run(967, OLDER, 31, event="push", at="09:41:06"), run(969, OLD, 31, event="push", at="09:11:26")]
        api = FakeAPI(runs, {967: TESTED, 969: TESTED}, {(OLD, HEAD): ahead("docs/x.md")})
        go, why, error = decide("main-push", api)
        self.assertEqual((go, error), (False, False))
        self.assertIn("runs/969)", why)

    def test_a_push_that_cancelled_the_waiting_nightly_runs_in_its_place(self):
        # Push 1 ran green; the nightly run 2 waited behind it and was
        # cancelled, running no job, when this push landed. Docs only, and
        # still it runs: else main would go that night untested.
        runs = [run(2, OLD, 31, conclusion="cancelled"), run(1, OLD, 30, event="push")]
        api = FakeAPI(runs, {2: [], 1: TESTED}, {(OLD, HEAD): ahead("docs/process.md")})
        go, why, error = decide("main-push", api)
        self.assertEqual((go, error), (True, False))
        self.assertIn("in place of the nightly run", why)
        self.assertIn("runs/2)", why)
        self.assertFalse(any("/compare/" in p for p in api.asked), "it compared, where the night decides")

    def test_once_a_run_has_tested_green_since_the_cancelled_night_a_docs_push_skips(self):
        # Push 3 ran in the night's place, green: the night is paid, and
        # the next docs push skips as any would.
        runs = [run(3, OLD, 31, event="push"), run(2, OLDER, 31, conclusion="cancelled"), run(1, OLDER, 30, event="push")]
        api = FakeAPI(runs, {3: TESTED, 2: [], 1: TESTED}, {(OLD, HEAD): ahead("docs/process.md")})
        go, why, _ = decide("main-push", api)
        self.assertFalse(go)
        self.assertIn("runs/3)", why)

    def test_a_cancelled_night_a_later_night_tested_after_or_one_that_tested_is_not_owed(self):
        # Night 4 tested main after night 2 was cancelled (red, so no base);
        # and a night cancelled by hand after it tested gave its answer.
        for runs, jobs in (
            (
                [run(4, OLD, 31, conclusion="failure"), run(2, OLD, 30, conclusion="cancelled"), run(1, OLD, 29, event="push")],
                {4: TESTED, 2: [], 1: TESTED},
            ),
            ([run(2, OLD, 30, conclusion="cancelled"), run(1, OLD, 29, event="push")], {2: TESTED, 1: TESTED}),
        ):
            with self.subTest(night=runs[0]["id"]):
                api = FakeAPI(runs, jobs, {(OLD, HEAD): ahead("docs/process.md")})
                go, why, error = decide("main-push", api)
                self.assertEqual((go, error), (False, False))
                self.assertIn("runs/1)", why)

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
        self.assertIsNone(re.search(r"python3 \S*ci_skip\.py", self.read("flake-hunt.yml")), "the Flake hunt asks to skip")


def jobs_of(text):
    """A workflow's jobs, read from its text as this repository writes them
    (no YAML parser in the standard library): each job's `needs`, and the
    most runners it can hold at once, its matrix's size capped by its
    `max-parallel`. A matrix it can't size, or one dealt at run time with
    no cap, is a failure: no width is guessed."""
    lines = text.splitlines()
    jobs, cur = {}, None
    for line in lines[lines.index("jobs:") + 1 :]:
        m = re.match(r"^  ([\w-]+):\s*$", line)
        if m:
            cur = jobs.setdefault(m.group(1), {"needs": [], "cap": None, "size": None, "matrix": False})
            continue
        if cur is None:
            continue
        m = re.match(r"^    needs:\s*(.+?)\s*$", line)
        if m:
            v = m.group(1)
            cur["needs"] = [x.strip() for x in v.strip("[]").split(",")] if v.startswith("[") else [v]
        if re.match(r"^      matrix:", line):
            cur["matrix"] = True
        m = re.match(r"^      max-parallel:\s*(\d+)", line)
        if m:
            cur["cap"] = int(m.group(1))
        m = re.match(r"^        \w+:\s*\[(.*)\]\s*$", line)
        if m:
            cur["size"] = len(m.group(1).split(","))
        if re.match(r"^          - \{", line):
            cur["size"] = (cur["size"] or 0) + 1
    widths = {}
    for name, j in jobs.items():
        if not j["matrix"]:
            widths[name] = 1
        elif j["size"] is not None:
            widths[name] = min(j["size"], j["cap"] or j["size"])
        elif j["cap"] is not None:
            widths[name] = j["cap"]
        else:
            raise AssertionError(f"{name}'s matrix has no size this test can read and no max-parallel")
    return {n: j["needs"] for n, j in jobs.items()}, widths


def most_at_once(needs, widths):
    """The most runners the jobs can hold at once: two jobs can run side by
    side unless one needs the other, directly or through others, so the
    most is the heaviest set of jobs no two of which are so ordered."""
    after = {}

    def before(n):
        if n not in after:
            after[n] = set()
            for d in needs[n]:
                after[n] |= {d} | before(d)
        return after[n]

    names = sorted(needs)
    best = 0
    for mask in range(1, 1 << len(names)):
        pick = [n for i, n in enumerate(names) if mask >> i & 1]
        if all(a not in before(b) and b not in before(a) for a in pick for b in pick if a != b):
            best = max(best, sum(widths[n] for n in pick))
    return best


class TheFlakeHunt(unittest.TestCase):
    """The Flake hunt holds at most three runners at once (#582): GitHub
    starts its cron hours late, in the merge queue's hours, so its stages
    run one after another, none wider than three."""

    def test_it_holds_at_most_three_runners_at_once(self):
        with open(os.path.join(ROOT, ".github", "workflows", "flake-hunt.yml")) as f:
            needs, widths = jobs_of(f.read())
        self.assertGreaterEqual(len(needs), 10, "the hunt's jobs were not all read")
        self.assertEqual(widths["hunt"], 3)
        self.assertEqual(widths["perf"], 3)
        self.assertLessEqual(most_at_once(needs, widths), 3)

    def test_the_count_sees_matrices_side_by_side(self):
        # Its shape before #582: the hunt four at a time beside the budgets
        # three at a time, and two jobs of one runner, all after the engine.
        text = """jobs:
  engine:
    runs-on: x
  hunt:
    needs: engine
    strategy:
      max-parallel: 4
      matrix:
        shard: ["1/12", "2/12", "3/12", "4/12", "5/12", "6/12"]
  perf:
    needs: engine
    strategy:
      max-parallel: 3
      matrix:
        include:
          - { browser: chromium, shard: "1/8" }
          - { browser: chromium, shard: "2/8" }
          - { browser: chromium, shard: "3/8" }
          - { browser: chromium, shard: "4/8" }
  touch:
    needs: engine
  audio:
    needs: [engine]
  report:
    needs: [hunt, perf]
"""
        self.assertEqual(most_at_once(*jobs_of(text)), 9)

    def test_a_matrix_it_cannot_size_fails(self):
        text = """jobs:
  file:
    strategy:
      matrix:
        include: ${{ fromJSON(needs.report.outputs.flaky) }}
"""
        with self.assertRaises(AssertionError):
            jobs_of(text)


if __name__ == "__main__":
    unittest.main(verbosity=1)
