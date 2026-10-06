#!/usr/bin/env python3
"""queue_state.py's tests: what the watcher reports for a PR, from the JSON
`gh pr view --json state,labels,statusCheckRollup` gives (`make dev-check`,
its dev-ops part).

    python3 scripts/ops/test_queue_state.py

Python 3 standard library only.
"""

import os
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

    def test_a_status_context_is_read_too(self):
        ctx = {"__typename": "StatusContext", "context": "CI", "state": "FAILURE", "targetUrl": URL.format(run=5, job=0)}
        self.assertEqual(Q.classify(pr(ctx)), "CI red")


if __name__ == "__main__":
    unittest.main(verbosity=1)
