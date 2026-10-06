#!/usr/bin/env python3
"""wf_result.py's tests: a finished run's output file and a running run's
journal, read the same way (`make dev-check`, its dev-ops part).

    python3 scripts/ops/test_wf_result.py

Each test writes a run in the shapes Claude Code writes them (the output
file's `result` and `args`; the journal's `started` and `result` records,
each agent's transcript beside it) into a throwaway directory. Nothing reads
the network. Python 3 standard library only.
"""

import contextlib
import io
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import wf_result as W  # noqa: E402

SESSION = "https://claude.ai/code/session_01ABCDEFGHIJ"


def report(**over):
    r = {
        "head": "a" * 40,
        "commits": ["aaaaaaa fix(web): the thing"],
        "summary": "s",
        "gates": ["make web-check: ok"],
        "browser_runs": [],
        "user_visible": True,
        "changelog_fragment": "changelog.d/thing.md",
        "voice_drafts": [{"words": "Kept as new", "where": "apps/web/main.js toast", "voice_md_row": "| Kept as new | … |"}],
        "decisions": ["kept main's behavior for BACK TO"],
        "before_after": "",
        "closes": [300],
        "refs": [177],
        "needs_full_ci": {"value": True, "reason": "apps/web/perform.js changed"},
        "open_items": [{"kind": "decision", "text": "Should BACK TO fade?"}, {"kind": "other_area", "text": "the guide's rack page"}],
        "pr_title": "fix(web): the thing is true now",
        "pr_body": f"## What\n\nIt.\n\nCloses #300\nRefs #177\n\n{SESSION}\n",
        "base": "b" * 40,
        "conflicts": "none",
        "pr_checks": "title ok; links ok",
    }
    r.update(over)
    return r


def review(blocking=1):
    f = {"file": "apps/web/x.js", "line": 3, "summary": "wrong", "scenario": "s"}
    return {"verdict": "v", "blocking": [f] * blocking, "should_fix": [f], "maintainers_call": [], "nits": [f, f]}


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = self.tmp.name
        self.out = os.path.join(self.dir, "out")

    def tearDown(self):
        self.tmp.cleanup()

    def run_main(self, *argv):
        said = io.StringIO()
        with contextlib.redirect_stdout(said):
            code = W.main([*argv, "--out", self.out])
        return code, said.getvalue()

    def read(self, name):
        with open(os.path.join(self.out, name)) as f:
            return f.read()


class FinishedRun(Base):
    def write_output(self, result, args):
        path = os.path.join(self.dir, "wf_abc-123.json")
        with open(path, "w") as f:
            json.dump({"runId": "wf_abc-123", "workflowName": "ship-issues", "status": "completed", "args": args, "result": result}, f)
        return path

    def test_a_ship_issues_result_gives_the_body_and_the_summary(self):
        item = {
            "issue": 300, "branch": "claude/thing", "worktree": "/w/auracle-wt-thing", "status": "ready", "problems": [],
            "final": report(), "review": review(), "verify": {"all_resolved": True, "remaining": [], "notes": ""}, "fix_rounds": 1,
        }
        path = self.write_output({"workflow": "ship-issues", "session": SESSION, "items": [item]}, {"session": SESSION, "items": [{}]})
        code, said = self.run_main(path)
        self.assertEqual(code, 0)
        body = self.read("pr-300.md")
        self.assertTrue(body.startswith("## What"))
        self.assertEqual(body.rstrip().splitlines()[-1], SESSION)
        self.assertEqual(body.count(SESSION), 1, "the link the body ends with is not added twice")
        for want in (
            "#300  claude/thing  ready",
            "on origin/main bbbbbbbbbbbb",
            "closes #300; refs #177",
            "full-ci: yes (apps/web/perform.js changed)",
            "review: 1 blocking, 1 should-fix, 0 for the maintainer, 2 nits; re-check: all resolved",
            'voice: "Kept as new" at apps/web/main.js toast; row: | Kept as new | … |',
            "decision: Should BACK TO fade?",
            "other_area: the guide's rack page",
            "decided: kept main's behavior for BACK TO",
            "ship: scripts/ops/ship_pr.sh --full-ci /w/auracle-wt-thing claude/thing 'fix(web): the thing is true now' ",
        ):
            self.assertIn(want, said)
        self.assertNotIn("PROBLEM", said)
        self.assertEqual(self.read("summary.md").splitlines()[1], "#300  claude/thing  ready")
        self.assertEqual(json.loads(self.read("wf-300.json"))["final"]["head"], "a" * 40)

    def test_what_is_wrong_with_a_report_is_said(self):
        bad = report(
            pr_title="PATCH: an untyped title",
            pr_body="## What\n\nCloses #300, #301\n",
            closes=[300, 302],
            refs=[177],
            open_items=[{"kind": "in_area", "text": "the spec's other test"}],
        )
        item = {"issue": 300, "branch": "claude/thing", "worktree": "/w/x", "status": "needs_attention", "problems": ["finalize did not return"], "final": bad, "review": None, "verify": None}
        path = self.write_output({"workflow": "ship-issues", "items": [item]}, {})
        _, said = self.run_main(path, "--session", SESSION)
        for want in (
            "PROBLEM: finalize did not return",
            "PROBLEM: title: The title's type `PATCH` is not one of the types",
            "PROBLEM: body: `Closes #300, #301` names 2 issues after one `Closes`",
            "PROBLEM: closes #302, but the body has no `Closes #302`",
            "PROBLEM: the body closes #301, which closes does not list",
            "PROBLEM: refs #177, but the body has no `Refs #177`",
            "PROBLEM: in-area work left: the spec's other test",
            "review: none came back",
        ):
            self.assertIn(want, said)
        # The session link given on the command line is added to a body without one.
        self.assertEqual(self.read("pr-300.md").rstrip().splitlines()[-1], SESSION)

    def test_blocking_findings_no_re_check_confirmed_are_a_problem(self):
        # A run from before ship-issues flagged a fix or a re-check that did
        # not return: `ready`, with the review's blocking finding never checked.
        item = {"issue": 300, "branch": "claude/thing", "worktree": "/w/x", "status": "ready", "problems": [], "final": report(), "review": review(), "verify": None}
        path = self.write_output({"workflow": "ship-issues", "session": SESSION, "items": [item]}, {"session": SESSION})
        _, said = self.run_main(path)
        self.assertIn("re-check: NOT done", said)
        self.assertIn("PROBLEM: 1 blocking finding(s), and no re-check says they are fixed", said)
        item.update(verify={"all_resolved": False, "remaining": [review()["blocking"][0]], "notes": ""})
        _, said = self.run_main(self.write_output({"workflow": "ship-issues", "items": [item]}, {}))
        self.assertIn("re-check: NOT resolved", said)
        self.assertIn("PROBLEM: the re-check says 1 blocking finding(s) remain", said)
        # The workflow's own word on it is not said twice.
        item.update(problems=["1 blocking finding(s) remain after 2 fix round(s)"])
        _, said = self.run_main(self.write_output({"workflow": "ship-issues", "items": [item]}, {}))
        self.assertEqual(said.count("blocking finding(s) remain"), 1)

    def test_the_first_ship_issues_list_is_read_too(self):
        # 2026-10-06's runs returned a list, with the session added by hand.
        old = [{"issue": 173, "branch": "claude/a", "worktree": "/w/a", "final": report(pr_body="Closes #300\nRefs #177\n"), "review": review(0), "verify": None}, {"issue": 174, "failed": True}]
        path = self.write_output(old, {"items": []})
        _, said = self.run_main(path)
        self.assertIn("#173  claude/a  done", said)
        self.assertIn("#174    failed", said)
        self.assertEqual(self.read("pr-173.md"), "Closes #300\nRefs #177\n")

    def test_a_fix_flake_item_ships_with_priority(self):
        item = {"key": "patch_facts", "issue": None, "branch": "claude/flake", "worktree": "/w/f", "status": "ready", "problems": [], "final": report(needs_full_ci={"value": False, "reason": "none"}, closes=[], refs=[177]), "labels": ["priority"]}
        item["final"]["pr_body"] = f"Refs #177\n\n{SESSION}\n"
        path = self.write_output({"workflow": "fix-flake", "session": SESSION, "items": [item]}, {"session": SESSION})
        _, said = self.run_main(path)
        self.assertIn("ship: scripts/ops/ship_pr.sh --priority /w/f claude/flake", said)
        self.assertTrue(os.path.exists(os.path.join(self.out, "pr-patch_facts.md")))

    def test_a_triage_prints_its_plan(self):
        plan = {
            "waves": [{"name": "1", "why": "no shared files", "items": [{"issue": 5, "topic": "five", "agentType": "web-engineer", "closes": [5], "refs": [], "needs_full_ci": True}]}],
            "chains": [{"issues": [6, 7], "why": "7 builds on 6"}],
            "questions": [{"issue": 8, "question": "Which word?"}],
            "closable": [{"issue": 9, "why": "#250 did it"}],
            "held": [],
        }
        path = self.write_output({"workflow": "triage-backlog", "triaged": [{}, {}], "missing": [], "overlaps": [], "plan": plan}, {})
        _, said = self.run_main(path)
        for want in ("wave 1: no shared files", "#5 claude/five (web-engineer; closes [5], refs []; full-ci)", "chain: #6 -> #7: 7 builds on 6", "question #8: Which word?", "closable #9: #250 did it"):
            self.assertIn(want, said)


class Journal(Base):
    """A run still going: agents' results as they came back."""

    def write_journal(self, records, prompts):
        run = os.path.join(self.dir, "subagents", "workflows", "wf_run-1")
        os.makedirs(run)
        with open(os.path.join(run, "journal.jsonl"), "w") as f:
            f.write('{"type":"launched"}\n')
            for r in records:
                f.write(json.dumps(r) + "\n")
            f.write("not json, a line cut short by a crash\n")
        for agent_id, prompt in prompts.items():
            with open(os.path.join(run, f"agent-{agent_id}.jsonl"), "w") as f:
                f.write(json.dumps({"type": "user", "message": {"role": "user", "content": prompt}}) + "\n")
        return run

    def test_a_finished_item_ships_while_another_runs(self):
        started = lambda key, label, agent: {"type": "started", "key": key, "agentId": agent, "label": label, "phase": "Build"}  # noqa: E731
        done = lambda key, result: {"type": "result", "key": key, "agentId": "x", "result": result}  # noqa: E731
        early = report(pr_title="fix(web): an early draft", base="")
        final = report()
        records = [
            started("k1", "build #300", "a1"), started("k2", "build #301", "a2"),
            done("k1", early),
            started("k3", "review #300", "a3"), done("k3", review()),
            started("k4", "fix #300", "a4"), done("k4", report(pr_title="fix(web): after the review")),
            started("k5", "verify #300", "a5"), done("k5", {"all_resolved": True, "remaining": [], "notes": ""}),
            started("k6", "finalize #300", "a6"), done("k6", final),
        ]
        prompts = {
            "a1": "You are building GitHub issue #300 of alexnodeland/auracle.\nWorktree: /w/auracle-wt-thing (branch claude/thing, already created from origin/main). Browser port: 8800.",
            "a2": "You are building GitHub issue #301.\nWorktree: /w/auracle-wt-other (branch claude/other, already created from origin/main).",
        }
        run = self.write_journal(records, prompts)
        code, said = self.run_main(run, "--session", SESSION)
        self.assertEqual(code, 0)
        self.assertIn("#300  claude/thing  done, read from the journal", said)
        self.assertIn("title: fix(web): the thing is true now", said, "the latest report is the finalized one")
        self.assertIn("re-check: all resolved", said)
        self.assertIn("ship: scripts/ops/ship_pr.sh --full-ci /w/auracle-wt-thing claude/thing", said)
        self.assertIn("#301  claude/other  running (build #301)", said)
        self.assertEqual(self.read("pr-300.md").rstrip().splitlines()[-1], SESSION)
        self.assertFalse(os.path.exists(os.path.join(self.out, "pr-301.md")))

    def test_an_agent_that_failed_did_not_return_and_nothing_runs(self):
        # The journal's record for an agent that was skipped or died: its
        # stage got null and the run went on, here to finalize.
        started = lambda key, label: {"type": "started", "key": key, "agentId": key, "label": label, "phase": "x"}  # noqa: E731
        done = lambda key, result: {"type": "result", "key": key, "agentId": key, "result": result}  # noqa: E731
        failed = lambda key: {"type": "failed", "key": key, "agentId": key}  # noqa: E731
        records = [
            started("k1", "build #300"), done("k1", report()),
            started("k2", "review #300"), done("k2", review()),
            started("k3", "fix #300"), failed("k3"),
            started("k4", "finalize #300"), done("k4", report()),
            started("k5", "build #301"), failed("k5"),
            started("k6", "triage #5"), failed("k6"),
            # Failed, then started again by a resumed run, and back.
            started("k7", "build #302"), failed("k7"), started("k7", "build #302"), done("k7", report(closes=[302], pr_body=f"Closes #302\nRefs #177\n\n{SESSION}")),
        ]
        prompt = "Worktree: /w/auracle-wt-thing (branch claude/thing, already created from origin/main)."
        run = self.write_journal(records, {"k1": prompt})
        _, said = self.run_main(run, "--session", SESSION)
        self.assertNotIn("running", said, "nothing is running: the fix failed")
        self.assertIn("#300  claude/thing  done, read from the journal", said)
        self.assertIn("PROBLEM: fix #300 did not return", said)
        self.assertIn("review: 1 blocking, 1 should-fix, 0 for the maintainer, 2 nits; re-check: NOT done", said)
        self.assertIn("PROBLEM: 1 blocking finding(s), and no re-check says they are fixed", said)
        # A branch whose build died is said, not dropped; a triage's agent is not a branch.
        self.assertIn("#301    failed\n  problem: build #301 did not return", said)
        self.assertNotIn("#5", said)
        self.assertNotIn("build #302 did not return", said)

    def test_the_journal_is_found_by_run_id(self):
        home = os.path.join(self.dir, "home")
        run = os.path.join(home, "projects", "-repo", "session-1", "subagents", "workflows", "wf_run-2")
        os.makedirs(run)
        with open(os.path.join(run, "journal.jsonl"), "w") as f:
            f.write('{"type":"launched"}\n')
        self.assertEqual(W.find("wf_run-2", home), os.path.join(run, "journal.jsonl"))
        # A finished run's output file comes first.
        out = os.path.join(home, "projects", "-repo", "session-1", "workflows", "wf_run-2.json")
        os.makedirs(os.path.dirname(out))
        with open(out, "w") as f:
            f.write("{}")
        self.assertEqual(W.find("wf_run-2", home), out)


if __name__ == "__main__":
    unittest.main(verbosity=1)
