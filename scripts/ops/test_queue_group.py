#!/usr/bin/env python3
"""queue_group.sh's tests: when a group of PRs is queued, and when it is
not (`make dev-check`, its dev-ops part).

    python3 scripts/ops/test_queue_group.py

Each case runs the real script. A fake `gh` first on PATH answers `pr view`
with the JSON the case staged (one document per poll, the last one repeated),
`run view` with a run's staged statuses, and the label and comment calls as
the case says, writing every call to a log; nothing reaches GitHub. The PR
documents are built with test_queue_state's helpers, so the rule they carry
is the one queue_state.py is tested on. Python 3 standard library only.
"""

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import textwrap
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from test_queue_state import MUTANTS, check, gates, pr  # noqa: E402

GROUP = os.path.join(HERE, "queue_group.sh")
MERGIFY = os.path.join(HERE, "..", "..", ".mergify.yml")
REPO = "o/r"

# The fake gh. FAKE_GH says what fails, as a comma list of "<call>" (for
# every PR) or "<call>:<pr>": "view" (gh pr view), "view-first" (only its
# first call fails), "view-alternate" (its first call fails, its second does
# not, its third fails, and so on), "edit" (gh pr edit), "comment" (gh pr
# comment), "rest-label" and "rest-comment" (the REST calls).
FAKE_GH = textwrap.dedent(
    """\
    #!/usr/bin/env python3
    import json, os, sys
    args = sys.argv[1:]
    fails = os.environ.get("FAKE_GH", "").split(",")
    with open(os.environ["FAKE_GH_LOG"], "a", encoding="utf-8") as log:
        log.write(json.dumps({"argv": args}) + "\\n")

    def fail(kind, n):
        return kind in fails or f"{kind}:{n}" in fails

    def staged_flag(key):
        # False the first time it is asked, True after: a failure that happens once.
        path = os.environ["FAKE_GH_STATE"] + ".flags"
        flags = open(path, encoding="utf-8").read().split() if os.path.exists(path) else []
        if key not in flags:
            with open(path, "a", encoding="utf-8") as f:
                f.write(key + " ")
        return key in flags

    def nth_call(key):
        # 1 the first time it is asked, 2 the second, and so on.
        path = os.environ["FAKE_GH_STATE"]
        with open(path, encoding="utf-8") as f:
            state = json.load(f)
        n = state["seen"].get(key, 0) + 1
        state["seen"][key] = n
        with open(path, "w", encoding="utf-8") as f:
            json.dump(state, f)
        return n

    def staged(section, key):
        # The next document staged for this key; the last one repeats.
        path = os.environ["FAKE_GH_STATE"]
        with open(path, encoding="utf-8") as f:
            state = json.load(f)
        seen = state["seen"].setdefault(section + key, 0)
        docs = state[section][key]
        state["seen"][section + key] = seen + 1
        with open(path, "w", encoding="utf-8") as f:
            json.dump(state, f)
        return docs[min(seen, len(docs) - 1)]

    if args[:2] == ["-R", "o/r"]:
        args = args[2:]
    if args[:2] == ["pr", "view"]:
        if (
            fail("view", args[2])
            or (fail("view-first", args[2]) and not staged_flag("viewed" + args[2]))
            or (fail("view-alternate", args[2]) and nth_call("alternate" + args[2]) % 2 == 1)
        ):
            sys.stderr.write(f"GraphQL: PR {args[2]}: Something went wrong while executing your query.\\n")
            sys.exit(1)
        print(json.dumps(staged("views", args[2])))
    elif args[:2] == ["run", "view"]:
        print(staged("runs", args[2]))
    elif args[:2] == ["pr", "edit"]:
        sys.exit(1 if fail("edit", args[2]) else 0)
    elif args[:2] == ["pr", "comment"]:
        sys.exit(1 if fail("comment", args[2]) else 0)
    elif args[0] == "api":
        path = [a for a in args[1:] if a.startswith("repos/")][0]
        n = path.split("/")[4]
        if path.endswith("/labels"):
            sys.exit(1 if fail("rest-label", n) else 0)
        if path.endswith("/comments"):
            sys.exit(1 if fail("rest-comment", n) else 0)
        sys.exit(2)
    else:
        sys.exit(2)
    """
)


def slow(run=300, conclusion="SUCCESS", status="COMPLETED"):
    return [
        check("Asked for", run=run, workflow="Slow suite"),
        check("Slow browser (1/3)", conclusion, status=status, run=run, job=2, workflow="Slow suite"),
    ]


def running(called="CI", run=100, workflow="CI"):
    return check(called, status="IN_PROGRESS", run=run, workflow=workflow)


GREEN = pr(*gates(), labels=())
WAITING = pr(running(), *gates()[1:], labels=())


class QueueGroup(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dir = d = tempfile.mkdtemp()
        cls.addClassCleanup(shutil.rmtree, d)
        cls.env = {k: v for k, v in os.environ.items() if not k.startswith(("GIT_", "GH_"))}
        cls.env.update(HOME=d, XDG_CONFIG_HOME=d, GH_REPO=REPO)
        bin_dir = os.path.join(d, "bin")
        os.mkdir(bin_dir)
        with open(os.path.join(bin_dir, "gh"), "w", encoding="utf-8") as f:
            f.write(FAKE_GH)
        os.chmod(os.path.join(bin_dir, "gh"), 0o755)
        cls.env["PATH"] = bin_dir + os.pathsep + cls.env["PATH"]

    def setUp(self):
        self.log = os.path.join(self.dir, f"gh-{self._testMethodName}.log")
        self.state = os.path.join(self.dir, f"state-{self._testMethodName}.json")

    def group(self, *args, views, runs=None, fails=""):
        """Run queue_group.sh; `views` maps a PR to the documents its polls
        see, `runs` a Slow suite run to the statuses its polls see."""
        with open(self.state, "w", encoding="utf-8") as f:
            json.dump({"views": {str(k): v for k, v in views.items()}, "runs": {str(k): v for k, v in (runs or {}).items()}, "seen": {}}, f)
        env = dict(self.env, FAKE_GH=fails, FAKE_GH_LOG=self.log, FAKE_GH_STATE=self.state)
        done = subprocess.run(
            ["bash", GROUP, "--every", "0.05", *args],
            cwd=self.dir, env=env, capture_output=True, text=True, timeout=60,
        )
        try:
            with open(self.log, encoding="utf-8") as f:
                calls = [json.loads(line)["argv"] for line in f]
        except FileNotFoundError:
            calls = []
        return done, [c[2:] if c[:2] == ["-R", REPO] else c for c in calls]

    def queueing(self, calls):
        """The calls that queue a PR, in order."""
        return [c for c in calls if c[:2] in (["pr", "edit"], ["pr", "comment"]) or c[0] == "api"]

    def assertQueued(self, calls, *prs):
        for n in prs:
            n = str(n)
            self.assertIn(["pr", "edit", n, "--add-label", "queue"], calls)
            self.assertIn(["pr", "comment", n, "--body", "@mergifyio queue"], calls)
        edited = {c[2] for c in calls if c[:2] == ["pr", "edit"]}
        self.assertEqual(edited, {str(n) for n in prs})

    def assertNothingQueued(self, calls):
        self.assertEqual(self.queueing(calls), [], "no label, no comment")

    # The ordinary case -----------------------------------------------------

    def test_a_group_all_green_is_labelled_and_commented_together(self):
        done, calls = self.group("11", "12", "13", views={11: [GREEN], 12: [GREEN], 13: [GREEN]})
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(done.stdout, "queued: #11 #12 #13\n")
        self.assertNotIn("a batch holds", done.stderr)
        self.assertQueued(calls, 11, 12, 13)
        # Every PR was read before any was queued, and none read after: the
        # group enters in one go, not as each is found green.
        first = next(i for i, c in enumerate(calls) if self.queueing([c]))
        self.assertEqual([c[:2] for c in calls[:first]], [["pr", "view"]] * 3)
        self.assertTrue(all(c[:2] != ["pr", "view"] for c in calls[first:]))
        # Per PR the label comes before its comment.
        for n in "11", "12", "13":
            order = [c[0] + c[1] for c in calls if len(c) > 2 and c[2] == n and c[1] in ("edit", "comment")]
            self.assertEqual(order, ["predit", "prcomment"])

    def test_more_prs_than_a_batch_holds_are_warned_of_and_still_queued(self):
        # The size the script warns at is the queue's: .mergify.yml's
        # batch_size on its default rule, read here so the two cannot part.
        with open(MERGIFY, encoding="utf-8") as f:
            size = int(re.search(r"name: default\b.*?batch_size: (\d+)", f.read(), re.DOTALL).group(1))
        group = [str(n) for n in range(11, 11 + size + 1)]
        done, calls = self.group(*group, views={int(n): [GREEN] for n in group})
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(done.stdout, "queued: " + " ".join("#" + n for n in group) + "\n")
        self.assertIn(f"{size + 1} PRs, and a batch holds {size}", done.stderr)
        self.assertQueued(calls, *group)

    def test_it_waits_on_the_state_until_every_pr_is_green(self):
        done, calls = self.group(
            "11", "12", views={11: [WAITING, WAITING, GREEN], 12: [GREEN, WAITING, GREEN]}
        )
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(done.stdout, "queued: #11 #12\n")
        # 12 was green on the first poll and went back to running: it is read
        # again until the whole group is green at once, and queued only then.
        views = [c[2] for c in calls if c[:2] == ["pr", "view"]]
        self.assertEqual(views, ["11", "12"] * 3)
        self.assertEqual(done.stderr.count("waiting on"), 2, done.stderr)
        self.assertIn("ready: #12; waiting on: #11", done.stderr)
        self.assertQueued(calls, 11, 12)

    def test_the_hash_and_a_repeat_are_taken_for_one_pr(self):
        done, calls = self.group("#11", "11", views={11: [GREEN]})
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(done.stdout, "queued: #11\n")
        self.assertEqual(len([c for c in calls if c[:2] == ["pr", "edit"]]), 1)

    def test_all_three_checks_are_read_a_skipped_one_is_not_green(self):
        # Mergify's `check-success` is the rule; its three conditions are all.
        done, calls = self.group("11", "--for", "0.0005", views={11: [pr(*gates(mutants="SKIPPED"))]})
        self.assertEqual(done.returncode, 2, done.stderr)
        self.assertIn("still waiting", done.stderr)
        self.assertNothingQueued(calls)

    # A PR that went wrong --------------------------------------------------

    def test_a_red_pr_stops_the_group_and_nothing_is_queued(self):
        views = {11: [GREEN], 12: [pr(*gates(mutants="FAILURE"), labels=())], 13: [WAITING]}
        done, calls = self.group("11", "12", "13", views=views)
        self.assertEqual(done.returncode, 1)
        self.assertIn(f"stopped at #12 {MUTANTS} red", done.stderr)
        self.assertNothingQueued(calls)
        self.assertEqual(done.stdout, "")

    def test_a_closed_pr_and_a_failed_slow_suite_stop_the_group_too(self):
        # The verdicts themselves are queue_state.py's (test_queue_state.py);
        # here, that the script stops on each kind: a state, and a full-ci
        # PR's Slow suite, looked up by its run.
        cases = {
            "CLOSED": pr(*gates(), labels=(), state="CLOSED"),
            "Slow suite red": pr(*gates(), *slow(conclusion="FAILURE"), labels=("full-ci",)),
            "Slow suite not run": pr(*gates(), labels=("full-ci",)),
        }
        for why, doc in cases.items():
            with self.subTest(why):
                done, calls = self.group("11", "12", views={11: [GREEN], 12: [doc]}, runs={300: ["completed"]})
                self.assertEqual(done.returncode, 1, done.stderr)
                self.assertIn(f"stopped at #12 {why}", done.stderr)
                self.assertNothingQueued(calls)

    def test_a_cancelled_slow_suite_stops_the_group_when_a_second_poll_shows_it_too(self):
        # Opening a PR with full-ci starts two Slow suite runs and the second
        # cancels the first: for a moment the cancelled one is all there is.
        cancelled = pr(*gates(), *slow(conclusion="CANCELLED"), labels=("full-ci",))
        done, calls = self.group("11", "12", views={11: [GREEN], 12: [cancelled]}, runs={300: ["completed"]})
        self.assertEqual(done.returncode, 1, done.stderr)
        self.assertIn("stopped at #12 Slow suite cancelled", done.stderr)
        self.assertEqual([c[2] for c in calls if c[:2] == ["pr", "view"]], ["11", "12", "11", "12"])
        self.assertNothingQueued(calls)

    def test_a_cancelled_slow_suite_replaced_by_a_green_one_is_not_a_stop(self):
        cancelled = pr(*gates(), *slow(run=300, conclusion="CANCELLED"), labels=("full-ci",))
        replaced = pr(*gates(), *slow(run=300, conclusion="CANCELLED"), *slow(run=301), labels=("full-ci",))
        done, calls = self.group("11", "12", views={11: [GREEN], 12: [cancelled, replaced]}, runs={300: ["completed"], 301: ["completed"]})
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(done.stdout, "queued: #11 #12\n")
        self.assertQueued(calls, 11, 12)

    def test_a_cancelled_slow_suite_is_forgotten_when_the_next_poll_shows_it_running(self):
        # Cancelled, running, cancelled, green: never two cancelled polls in a
        # row, so the group is never stopped, and it queues when the suite is
        # green. Staged by state, with no clock: a script that kept the
        # memory of the first cancelled poll would stop on the third.
        cancelled = pr(*gates(), *slow(run=300, conclusion="CANCELLED"), labels=("full-ci",))
        again = pr(*gates(), *slow(run=301, status="IN_PROGRESS"), labels=("full-ci",))
        green = pr(*gates(), *slow(run=301), labels=("full-ci",))
        done, calls = self.group(
            "12",
            views={12: [cancelled, again, cancelled, green]},
            runs={300: ["completed"], 301: ["in_progress", "completed"]},
        )
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(done.stdout, "queued: #12\n")
        self.assertEqual([c[2] for c in calls if c[:2] == ["pr", "view"]], ["12"] * 4)
        self.assertQueued(calls, 12)

    def test_drop_red_queues_the_rest_and_says_who_was_left_out(self):
        views = {11: [GREEN], 12: [pr(*gates(ci="FAILURE"), labels=())], 13: [WAITING, GREEN]}
        done, calls = self.group("--drop-red", "11", "12", "13", views=views)
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(done.stdout, "queued: #11 #13\nleft out: #12 CI red\n")
        self.assertIn("leaving out #12 CI red", done.stderr)
        self.assertQueued(calls, 11, 13)
        # Once dropped, 12 is not read again.
        self.assertEqual([c[2] for c in calls if c[:2] == ["pr", "view"]].count("12"), 1)

    def test_drop_red_with_every_pr_dropped_queues_nothing_and_fails(self):
        views = {11: [pr(*gates(ci="FAILURE"), labels=())], 12: [pr(*gates(), labels=(), state="CLOSED")]}
        done, calls = self.group("--drop-red", "11", "12", views=views)
        self.assertEqual(done.returncode, 1)
        self.assertIn("nothing left to queue", done.stderr)
        self.assertNothingQueued(calls)

    # The Slow suite --------------------------------------------------------

    def test_a_full_ci_pr_is_queued_only_once_its_slow_suite_is_green(self):
        running_slow = pr(*gates(), *slow(status="IN_PROGRESS"), labels=("full-ci",))
        done_slow = pr(*gates(), *slow(), labels=("full-ci",))
        done, calls = self.group(
            "11", "12", views={11: [GREEN], 12: [running_slow, running_slow, done_slow]}, runs={300: ["in_progress", "in_progress", "completed"]}
        )
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(done.stdout, "queued: #11 #12\n")
        self.assertQueued(calls, 11, 12)
        self.assertEqual([c[2] for c in calls if c[:2] == ["pr", "view"]].count("12"), 3)
        # The run is looked up by id, once per poll.
        self.assertEqual([c[:3] for c in calls if c[:2] == ["run", "view"]], [["run", "view", "300"]] * 3)

    def test_a_slow_suite_whose_jobs_are_done_but_whose_run_is_not_is_waited_for(self):
        # Every check the rollup shows is done; the run itself is not.
        full = pr(*gates(), *slow(), labels=("full-ci",))
        done, calls = self.group("11", views={11: [full]}, runs={300: ["in_progress", "in_progress", "completed"]})
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(len([c for c in calls if c[:2] == ["run", "view"]]), 3)
        self.assertQueued(calls, 11)

    def test_a_pr_without_full_ci_never_asks_about_a_slow_suite(self):
        done, calls = self.group("11", views={11: [pr(*gates(), *slow(conclusion="FAILURE"), labels=())]})
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual([c for c in calls if c[:2] == ["run", "view"]], [])

    # Waiting out --------------------------------------------------------------

    def test_it_gives_up_waiting_and_queues_nothing(self):
        done, calls = self.group("11", "12", "--for", "0.0005", views={11: [GREEN], 12: [WAITING]})
        self.assertEqual(done.returncode, 2, done.stderr)
        self.assertIn("still waiting after 0.0005 h: 11 12", done.stderr)
        self.assertNothingQueued(calls)

    def test_a_pr_gh_cannot_read_once_is_read_again(self):
        done, calls = self.group("11", "12", views={11: [GREEN], 12: [GREEN]}, fails="view-first:12")
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(done.stdout, "queued: #11 #12\n")
        self.assertEqual([c[2] for c in calls if c[:2] == ["pr", "view"]], ["11", "12", "11", "12"])
        self.assertQueued(calls, 11, 12)

    def test_a_pr_that_cannot_be_read_ten_polls_running_stops_the_group(self):
        done, calls = self.group("11", "12", views={11: [GREEN], 12: [GREEN]}, fails="view:12")
        self.assertEqual(done.returncode, 1)
        self.assertIn("can't read #12 on 10 polls running", done.stderr)
        self.assertIn("Something went wrong", done.stderr)
        self.assertNothingQueued(calls)
        self.assertEqual(len([c for c in calls if c[:2] == ["pr", "view"] and c[2] == "12"]), 10)

    def test_unreadable_polls_that_are_not_in_a_row_never_stop_the_group(self):
        # PR 12 cannot be read on every other poll: eleven of the twenty-two,
        # more than the ten that stop a group, but never two in a row. PR 11
        # is on its way for those twenty-one polls, then green.
        done, calls = self.group(
            "11", "12", views={11: [WAITING] * 21 + [GREEN], 12: [GREEN]}, fails="view-alternate:12"
        )
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(done.stdout, "queued: #11 #12\n")
        self.assertQueued(calls, 11, 12)
        views_of_12 = [c for c in calls if c[:2] == ["pr", "view"] and c[2] == "12"]
        self.assertEqual(len(views_of_12), 22)

    def test_every_pr_gh_cannot_read_is_named_with_its_own_error(self):
        done, calls = self.group("11", "12", "13", views={11: [GREEN], 12: [GREEN], 13: [GREEN]}, fails="view:11,view:12")
        self.assertEqual(done.returncode, 1)
        self.assertIn("can't read #11 #12 on 10 polls running", done.stderr)
        # Each one's own error, not the last one's: gh's message names its PR.
        self.assertIn("#11: GraphQL: PR 11:", done.stderr)
        self.assertIn("#12: GraphQL: PR 12:", done.stderr)
        self.assertNothingQueued(calls)

    # Queueing, when gh fails -------------------------------------------------------

    def test_the_label_and_the_comment_go_through_rest_when_gh_fails(self):
        done, calls = self.group("11", "12", views={11: [GREEN], 12: [GREEN]}, fails="edit,comment")
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(done.stdout, "queued: #11 #12\n")
        for n in "11", "12":
            label = next(c for c in calls if c[0] == "api" and f"repos/o/r/issues/{n}/labels" in c)
            self.assertIn("labels[]=queue", label)
            comment = next(c for c in calls if c[0] == "api" and f"repos/o/r/issues/{n}/comments" in c)
            # -f, not -F: -F would read a file named "mergifyio queue".
            self.assertEqual(comment[comment.index("-f") + 1], "body=@mergifyio queue")

    def test_a_label_that_fails_both_ways_is_named_and_the_rest_are_queued(self):
        done, calls = self.group("11", "12", views={11: [GREEN], 12: [GREEN]}, fails="edit:12,rest-label:12")
        self.assertEqual(done.returncode, 1)
        self.assertEqual(done.stdout, "queued: #11\n")
        self.assertIn("#12 could not be labelled", done.stderr)
        # Its comment is not sent: the PR would be queued unlabelled.
        self.assertNotIn(["pr", "comment", "12", "--body", "@mergifyio queue"], calls)
        self.assertIn(["pr", "edit", "11", "--add-label", "queue"], calls)
        self.assertIn(["pr", "comment", "11", "--body", "@mergifyio queue"], calls)

    def test_a_comment_that_fails_both_ways_says_the_pr_is_labelled(self):
        done, calls = self.group("11", views={11: [GREEN]}, fails="comment,rest-comment")
        self.assertEqual(done.returncode, 1)
        self.assertEqual(done.stdout, "queued: #11\n")
        self.assertIn("#11 is labelled, but the queue's comment failed", done.stderr)

    # Usage --------------------------------------------------------------------

    def test_help_prints_the_header_and_touches_nothing(self):
        done, calls = self.group("--help", views={})
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertTrue(done.stdout.startswith("queue_group.sh [--drop-red] [--every SECONDS] [--for HOURS] PR [PR ...]"), done.stdout)
        self.assertNotIn("set -uo", done.stdout)
        self.assertEqual(calls, [])

    def test_usage_errors_exit_2_and_touch_nothing(self):
        for args in ([], ["abc"], ["11", "--every", "0"], ["11", "--every", "x"], ["11", "--for", "-1"], ["11", "--nope"], ["--every"]):
            with self.subTest(args=args):
                done, calls = self.group(*args, views={11: [GREEN]})
                self.assertEqual(done.returncode, 2, done.stderr)
                self.assertEqual(calls, [])


if __name__ == "__main__":
    unittest.main(verbosity=1)
