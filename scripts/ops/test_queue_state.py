#!/usr/bin/env python3
"""queue_state.py's tests: what the watcher reports for a PR, from the JSON
`gh pr view --json state,labels,statusCheckRollup` gives (`make dev-check`,
its dev-ops part).

    python3 scripts/ops/test_queue_state.py

Python 3 standard library only.
"""

import json
import os
import subprocess
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import queue_state as Q  # noqa: E402

URL = "https://github.com/alexnodeland/auracle/actions/runs/{run}/job/{job}"


def check(name, conclusion="SUCCESS", status="COMPLETED", run=100, job=1, workflow="CI"):
    return {
        "__typename": "CheckRun",
        "name": name,
        "status": status,
        "conclusion": conclusion if status == "COMPLETED" else "",
        "detailsUrl": URL.format(run=run, job=job),
        "workflowName": workflow,
    }


def queue_check(status):
    return {"__typename": "CheckRun", "name": "Mergify Merge Queue", "status": status, "conclusion": "", "detailsUrl": "https://dashboard.mergify.com/x", "workflowName": ""}


def pr(*checks, labels=("queue",), state="OPEN"):
    return {"state": state, "labels": [{"name": n} for n in labels], "statusCheckRollup": list(checks)}


class Watch(unittest.TestCase):
    def test_merged_and_closed(self):
        self.assertEqual(Q.classify(pr(state="MERGED")), "MERGED")
        self.assertEqual(Q.classify(pr(state="CLOSED")), "CLOSED")

    def test_on_its_way_says_nothing(self):
        self.assertIsNone(Q.classify(pr(check("CI", status="IN_PROGRESS"), check("PR checks", workflow="PR checks"))))
        self.assertIsNone(Q.classify(pr(check("CI"), check("PR checks", workflow="PR checks"), queue_check("IN_PROGRESS"))))

    def test_dequeued(self):
        self.assertEqual(Q.classify(pr(check("CI"), labels=("queue", "dequeued"))), "dequeued")

    def test_a_stale_dequeued_label_does_not_count_while_the_queue_holds_it(self):
        # Requeued: the label is still on, and the queue's check is running again.
        self.assertIsNone(Q.classify(pr(check("CI"), queue_check("IN_PROGRESS"), labels=("queue", "dequeued"))))
        self.assertIsNone(Q.classify(pr(check("CI"), queue_check("QUEUED"), labels=("queue", "dequeued"))))

    def test_ci_red_is_read_from_its_latest_run(self):
        self.assertEqual(Q.classify(pr(check("CI", "FAILURE", run=100))), "CI red")
        self.assertEqual(Q.classify(pr(check("CI", "TIMED_OUT", run=100))), "CI red")
        # Red, then a push's run went green: not red.
        self.assertIsNone(Q.classify(pr(check("CI", "SUCCESS", run=101), check("CI", "FAILURE", run=100))))
        # The rollup's order does not decide: the run id does.
        self.assertEqual(Q.classify(pr(check("CI", "SUCCESS", run=99), check("CI", "FAILURE", run=100))), "CI red")

    def test_a_cancelled_run_is_not_red(self):
        self.assertIsNone(Q.classify(pr(check("CI", "CANCELLED"))))

    def test_pr_checks_red_then_put_right_by_an_edit(self):
        red = check("PR checks", "FAILURE", run=200, workflow="PR checks")
        self.assertEqual(Q.classify(pr(check("CI"), red)), "PR checks red")
        # An edit to the body runs it again on the same commit: the rollup keeps both.
        fixed = check("PR checks", "SUCCESS", run=201, workflow="PR checks")
        self.assertIsNone(Q.classify(pr(check("CI"), red, fixed)))

    def test_a_full_ci_pr_waits_for_its_slow_suite(self):
        asked = lambda run, c="SUCCESS": check("Asked for", c, run=run, workflow="Slow suite")  # noqa: E731
        browser = lambda run, c="SUCCESS", status="COMPLETED": check("Slow browser (1/3)", c, status=status, run=run, job=2, workflow="Slow suite")  # noqa: E731
        labels = ("full-ci",)
        self.assertIsNone(Q.classify(pr(check("CI"), labels=labels)))
        self.assertIsNone(Q.classify(pr(check("CI"), asked(300), browser(300, status="IN_PROGRESS"), labels=labels)))
        self.assertEqual(Q.classify(pr(check("CI"), asked(300), browser(300), labels=labels)), "Slow suite green")
        self.assertEqual(Q.classify(pr(check("CI"), asked(300), browser(300, "FAILURE"), labels=labels)), "Slow suite red")
        # Another label added later starts a run that asks for nothing: its skipped jobs don't count.
        later = (asked(301, "SKIPPED"), check("Slow browser (1/3)", "SKIPPED", run=301, job=2, workflow="Slow suite"))
        self.assertEqual(Q.classify(pr(check("CI"), asked(300), browser(300, "FAILURE"), *later, labels=labels)), "Slow suite red")
        # The opened run, cancelled by the labelled one, is not the verdict.
        self.assertEqual(Q.classify(pr(check("CI"), asked(299), browser(299, "CANCELLED"), asked(300), browser(300), labels=labels)), "Slow suite green")
        # Queued already: the queue's own states decide, not the Slow suite.
        self.assertIsNone(Q.classify(pr(check("CI"), asked(300), browser(300, "FAILURE"), labels=("full-ci", "queue"))))

    def test_a_slow_suite_verdict_waits_for_its_run_to_complete(self):
        # 'Asked for' is done and the next jobs have checks, but a job that
        # needs those has none yet: every check shown is done, the run is not.
        asked = check("Asked for", run=300, workflow="Slow suite")
        rust = check("Slow Rust", run=300, job=2, workflow="Slow suite")
        p = pr(check("CI"), asked, rust, labels=("full-ci",))
        self.assertEqual(Q.slow_run(p), 300)
        self.assertEqual(Q.classify(p), "Slow suite green", "the checks alone can't tell")
        self.assertIsNone(Q.classify(p, run_status="in_progress"))
        self.assertEqual(Q.classify(p, run_status="completed"), "Slow suite green")
        # Only a full-ci PR not yet queued has a run to look up.
        self.assertIsNone(Q.slow_run(pr(check("CI"), asked, labels=("full-ci", "queue"))))
        self.assertIsNone(Q.slow_run(pr(check("CI"), labels=("full-ci",))))

    def test_a_status_context_is_read_too(self):
        ctx = {"__typename": "StatusContext", "context": "CI", "state": "FAILURE", "targetUrl": URL.format(run=5, job=0)}
        self.assertEqual(Q.classify(pr(ctx)), "CI red")


MUTANTS = "Mutants in the changed code"


def gates(ci="SUCCESS", checks="SUCCESS", mutants="SUCCESS", run=100):
    """The three checks the queue's conditions read, each from a run of its own."""
    return [
        check("CI", ci, run=run, job=1),
        check("PR checks", checks, run=run + 1, job=2, workflow="PR checks"),
        check(MUTANTS, mutants, run=run + 2, job=3, workflow="Mutants"),
    ]


class Ready(unittest.TestCase):
    """What queue_group.sh waits on: the three checks green on their latest
    run, and for a full-ci PR its Slow suite too."""

    def test_the_three_gates_green_is_ready(self):
        self.assertEqual(Q.ready(pr(*gates(), labels=())), "ready")
        # The queue label, and a stale dequeued one, change nothing here.
        self.assertEqual(Q.ready(pr(*gates(), labels=("queue", "dequeued"))), "ready")

    def test_a_gate_still_running_or_missing_is_waiting(self):
        running = lambda called, **kw: check(called, status="IN_PROGRESS", **kw)  # noqa: E731
        self.assertIsNone(Q.ready(pr(running("CI"), *gates()[1:])))
        self.assertIsNone(Q.ready(pr(*gates()[:2], running(MUTANTS, run=102, job=3, workflow="Mutants"))))
        # No check at all yet: nothing to be green.
        self.assertIsNone(Q.ready(pr()))
        self.assertIsNone(Q.ready(pr(*gates()[:2])))
        self.assertIsNone(Q.ready({"state": "OPEN", "labels": [], "statusCheckRollup": None}))

    def test_each_gate_red_is_named(self):
        self.assertEqual(Q.ready(pr(*gates(ci="FAILURE"))), "CI red")
        self.assertEqual(Q.ready(pr(*gates(checks="FAILURE"))), "PR checks red")
        self.assertEqual(Q.ready(pr(*gates(mutants="FAILURE"))), f"{MUTANTS} red")
        self.assertEqual(Q.ready(pr(*gates(mutants="TIMED_OUT"))), f"{MUTANTS} red")
        # Red is told while the others still run: the group need not wait for them.
        self.assertEqual(Q.ready(pr(check("CI", status="IN_PROGRESS"), *gates(mutants="FAILURE")[1:])), f"{MUTANTS} red")

    def test_a_gate_is_read_by_its_latest_run(self):
        # Red, then a later run (a push, an edit to the body) went green.
        again = check(MUTANTS, "SUCCESS", run=110, job=3, workflow="Mutants")
        self.assertEqual(Q.ready(pr(*gates(mutants="FAILURE"), again)), "ready")
        # Green, then a later run went red.
        later = check("CI", "FAILURE", run=120)
        self.assertEqual(Q.ready(pr(*gates(), later)), "CI red")
        # A later run still going is not green yet, though an earlier one was.
        self.assertIsNone(Q.ready(pr(*gates(), check("CI", status="IN_PROGRESS", run=120))))

    def test_a_skipped_or_cancelled_gate_is_not_green(self):
        # `check-success` is Mergify's rule, and a skipped check is not a success.
        self.assertIsNone(Q.ready(pr(*gates(mutants="SKIPPED"))))
        self.assertIsNone(Q.ready(pr(*gates(ci="NEUTRAL"))))
        # Cancelled is not red: a newer run's check may not exist yet.
        self.assertIsNone(Q.ready(pr(*gates(ci="CANCELLED"))))

    def test_closed_and_merged_are_told(self):
        self.assertEqual(Q.ready(pr(*gates(), state="MERGED")), "MERGED")
        self.assertEqual(Q.ready(pr(*gates(), state="CLOSED")), "CLOSED")

    def test_a_status_context_is_read_too(self):
        ctx = lambda state: {"__typename": "StatusContext", "context": "CI", "state": state, "targetUrl": URL.format(run=100, job=0)}  # noqa: E731
        self.assertEqual(Q.ready(pr(ctx("SUCCESS"), *gates()[1:])), "ready")
        self.assertEqual(Q.ready(pr(ctx("FAILURE"), *gates()[1:])), "CI red")
        self.assertIsNone(Q.ready(pr(ctx("PENDING"), *gates()[1:])))

    def slow(self, run=300, conclusion="SUCCESS", status="COMPLETED"):
        return [
            check("Asked for", run=run, workflow="Slow suite"),
            check("Slow browser (1/3)", conclusion, status=status, run=run, job=2, workflow="Slow suite"),
        ]

    def test_a_full_ci_pr_is_ready_only_with_its_slow_suite_green(self):
        full = ("full-ci",)
        self.assertEqual(Q.ready(pr(*gates(), *self.slow(), labels=full)), "ready")
        # Running: wait. Red or cancelled: told, with the gates green or not.
        self.assertIsNone(Q.ready(pr(*gates(), *self.slow(status="IN_PROGRESS"), labels=full)))
        self.assertEqual(Q.ready(pr(*gates(), *self.slow(conclusion="FAILURE"), labels=full)), "Slow suite red")
        self.assertEqual(Q.ready(pr(*gates(), *self.slow(conclusion="CANCELLED"), labels=full)), "Slow suite cancelled")
        self.assertEqual(Q.ready(pr(check("CI", status="IN_PROGRESS"), *gates()[1:], *self.slow(conclusion="FAILURE"), labels=full)), "Slow suite red")
        # Slow suite green, gates still running: wait.
        self.assertIsNone(Q.ready(pr(check("CI", status="IN_PROGRESS"), *gates()[1:], *self.slow(), labels=full)))
        # A red gate wins over the Slow suite.
        self.assertEqual(Q.ready(pr(*gates(ci="FAILURE"), *self.slow(), labels=full)), "CI red")
        # Queued by hand already: it is still read, not skipped.
        self.assertEqual(Q.ready(pr(*gates(), *self.slow(), labels=("full-ci", "queue"))), "ready")
        self.assertEqual(Q.ready(pr(*gates(), *self.slow(conclusion="FAILURE"), labels=("full-ci", "queue"))), "Slow suite red")

    def test_a_pr_without_full_ci_ignores_the_slow_suite(self):
        self.assertEqual(Q.ready(pr(*gates(), *self.slow(conclusion="FAILURE"), labels=())), "ready")

    def test_a_full_ci_pr_the_slow_suite_never_ran_for_is_told_once_the_gates_are_green(self):
        full = ("full-ci",)
        # Nothing asked for, or only a run another label started (its jobs skipped).
        self.assertEqual(Q.ready(pr(*gates(), labels=full)), "Slow suite not run")
        skipped = check("Asked for", "SKIPPED", run=301, workflow="Slow suite")
        self.assertEqual(Q.ready(pr(*gates(), skipped, labels=full)), "Slow suite not run")
        # While a gate runs it may still be starting: nothing yet.
        self.assertIsNone(Q.ready(pr(check("CI", status="IN_PROGRESS"), *gates()[1:], labels=full)))

    def test_a_slow_suite_verdict_waits_for_its_run_to_complete(self):
        full = ("full-ci",)
        p = pr(*gates(), *self.slow(), labels=full)
        self.assertEqual(Q.ready_run(p), 300)
        self.assertIsNone(Q.ready(p, run_status="in_progress"))
        self.assertEqual(Q.ready(p, run_status="completed"), "ready")
        # Red is a verdict only once the run is done, too.
        red_p = pr(*gates(), *self.slow(conclusion="FAILURE"), labels=full)
        self.assertIsNone(Q.ready(red_p, run_status="in_progress"))
        self.assertEqual(Q.ready(red_p, run_status="completed"), "Slow suite red")

    def test_the_run_to_look_up_is_a_full_ci_pr_s_queued_or_not(self):
        self.assertEqual(Q.ready_run(pr(*gates(), *self.slow(), labels=("full-ci", "queue"))), 300)
        self.assertIsNone(Q.ready_run(pr(*gates(), *self.slow(), labels=())))
        self.assertIsNone(Q.ready_run(pr(*gates(), labels=("full-ci",))))
        self.assertIsNone(Q.ready_run(pr(*gates(), *self.slow(), labels=("full-ci",), state="CLOSED")))

    def test_the_command_line_prints_what_the_functions_say(self):
        script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "queue_state.py")
        full = pr(*gates(), *self.slow(), labels=("full-ci",))

        def cli(p, *args):
            done = subprocess.run([sys.executable, script, *args], input=json.dumps(p), capture_output=True, text=True, check=True)
            return done.stdout

        self.assertEqual(cli(pr(*gates(), labels=()), "--ready"), "ready\n")
        self.assertEqual(cli(pr(*gates(ci="FAILURE")), "--ready"), "CI red\n")
        self.assertEqual(cli(pr(), "--ready"), "")
        self.assertEqual(cli(full, "--ready-run"), "300\n")
        self.assertEqual(cli(pr(*gates()), "--ready-run"), "")
        self.assertEqual(cli(full, "--ready", "--run-status", "in_progress"), "")
        self.assertEqual(cli(full, "--ready", "--run-status", "completed"), "ready\n")


if __name__ == "__main__":
    unittest.main(verbosity=1)
