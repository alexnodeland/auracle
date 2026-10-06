#!/usr/bin/env python3
"""The mutation report's tests: what it counts, what it names, and when it
fails.

    python3 scripts/test_mutants_report.py      (run by `make dev-check`)

No test reads a real run. Each writes the two files the report reads,
`mutants.json` and `outcomes.json`, in the shape cargo-mutants 27.1 writes
them, into a throwaway directory. Python 3 standard library only.
"""

import contextlib
import io
import json
import os
import shutil
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import mutants_report as R  # noqa: E402


def mutant(crate, file, line, fn, change):
    """cargo-mutants' description of one mutant. `change` is how its name
    ends, after `file:line:col: `."""
    return {
        "name": f"crates/{crate}/src/{file}:{line}:9: {change}",
        "file": f"crates/{crate}/src/{file}",
        "package": crate,
        "function": {"function_name": fn, "return_type": "-> f64"},
        "span": {"start": {"line": line, "column": 9}, "end": {"line": line, "column": 20}},
        "genre": "FnValue",
    }


def outcome(m, summary):
    return {"scenario": {"Mutant": m}, "summary": summary, "phase_results": []}


BASELINE_OK = {"scenario": "Baseline", "summary": "Success", "phase_results": []}

LOGLIK = mutant("auracle-taste", "model.rs", 298, "TasteSample::loglik", "replace TasteSample::loglik -> f64 with 0.0")
SIGMOID = mutant("auracle-taste", "model.rs", 330, "sigmoid", "replace + with - in sigmoid")
OR = mutant("auracle-taste", "model.rs", 915, "TastePosterior::aligned_to", "replace || with && in TastePosterior::aligned_to")
CUT = mutant("auracle-grammar", "lib.rs", 40, "cut", "replace cut -> f64 with 1.0")
WALK = mutant("auracle-grammar", "lib.rs", 90, "walk", "replace < with <= in walk")
BAD = mutant("auracle-grammar", "lib.rs", 120, "bad", "replace bad -> Self with Default::default()")


class Runs(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def run_dir(self, name, listed, outcomes, finished=True):
        """A mutants.out: `listed` mutants, and `outcomes` (each a scenario
        and its summary) judged so far."""
        d = os.path.join(self.tmp, name)
        os.makedirs(d)
        with open(os.path.join(d, "mutants.json"), "w") as f:
            json.dump(listed, f)
        with open(os.path.join(d, "outcomes.json"), "w") as f:
            json.dump(
                {
                    "outcomes": outcomes,
                    "end_time": "2026-10-06T09:00:00Z" if finished else None,
                    "cargo_mutants_version": "27.1.0",
                },
                f,
            )
        return d

    def main(self, *argv):
        """`main`'s exit status and what it printed."""
        out = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
            code = R.main(list(argv))
        return code, out.getvalue()

    def read(self, path):
        with open(path) as f:
            return f.read()

    # ─── counting ───────────────────────────────────────────────────────────

    def test_each_crate_counts_what_it_listed_and_how_each_tested_mutant_ended(self):
        d = self.run_dir(
            "one",
            [LOGLIK, SIGMOID, OR, CUT, WALK, BAD],
            [
                BASELINE_OK,
                outcome(LOGLIK, "MissedMutant"),
                outcome(SIGMOID, "CaughtMutant"),
                outcome(OR, "Timeout"),
                outcome(CUT, "Unviable"),
                outcome(WALK, "CaughtMutant"),
            ],
        )
        rows = R.Report([R.read_run(d)]).per_crate()
        self.assertEqual(list(rows), ["auracle-grammar", "auracle-taste"])
        self.assertEqual(
            rows["auracle-taste"],
            {"listed": 3, "tested": 3, "caught": 1, "survived": 1, "timeout": 1, "unviable": 0},
        )
        # BAD was listed and never reached: listed, not tested.
        self.assertEqual(
            rows["auracle-grammar"],
            {"listed": 3, "tested": 2, "caught": 1, "survived": 0, "timeout": 0, "unviable": 1},
        )

    def test_shards_add_up_to_the_workspace(self):
        a = self.run_dir("shard-0", [LOGLIK, SIGMOID], [BASELINE_OK, outcome(LOGLIK, "MissedMutant"), outcome(SIGMOID, "CaughtMutant")])
        b = self.run_dir("shard-1", [CUT, WALK], [BASELINE_OK, outcome(CUT, "MissedMutant"), outcome(WALK, "CaughtMutant")])
        rep = R.Report([R.read_run(a), R.read_run(b)])
        self.assertEqual(R.totals(rep.per_crate())["listed"], 4)
        self.assertEqual(R.totals(rep.per_crate())["survived"], 2)
        # Every survivor, from every shard, in file and line order.
        self.assertEqual([m.where() for m in rep.all("survived")], ["crates/auracle-grammar/src/lib.rs:40", "crates/auracle-taste/src/model.rs:298"])

    def test_a_change_is_named_without_the_function_it_is_in(self):
        m = R.mutant_of(SIGMOID)
        self.assertEqual((m.crate, m.file, m.line, m.function), ("auracle-taste", "crates/auracle-taste/src/model.rs", 330, "sigmoid"))
        self.assertEqual(m.change, "replace + with -")
        # A function's replaced value names the function itself, and keeps it.
        self.assertEqual(R.mutant_of(LOGLIK).change, "replace TasteSample::loglik -> f64 with 0.0")

    # ─── the verdict ────────────────────────────────────────────────────────

    def test_a_survivor_fails_and_is_named(self):
        d = self.run_dir("one", [LOGLIK, SIGMOID], [BASELINE_OK, outcome(LOGLIK, "MissedMutant"), outcome(SIGMOID, "CaughtMutant")])
        code, out = self.main(d)
        self.assertEqual(code, 1)
        self.assertIn("crates/auracle-taste/src/model.rs:298  TasteSample::loglik  replace TasteSample::loglik -> f64 with 0.0", out)
        self.assertNotIn("sigmoid", out)

    def test_caught_unviable_and_timed_out_pass_and_a_timeout_is_still_named(self):
        d = self.run_dir(
            "one",
            [LOGLIK, CUT, OR],
            [BASELINE_OK, outcome(LOGLIK, "CaughtMutant"), outcome(CUT, "Unviable"), outcome(OR, "Timeout")],
        )
        code, out = self.main(d)
        self.assertEqual(code, 0)
        self.assertIn("timed out:", out)
        self.assertIn("model.rs:915", out)

    def test_failing_unmutated_tests_fail_the_report_with_nothing_judged(self):
        d = self.run_dir("one", [LOGLIK], [{"scenario": "Baseline", "summary": "Failure", "phase_results": []}])
        code, out = self.main(d)
        self.assertEqual(code, 1)
        self.assertIn("the unmutated tests did not pass (Failure)", out)

    def test_a_directory_with_no_run_fails(self):
        code, out = self.main(os.path.join(self.tmp, "nothing"))
        self.assertEqual(code, 1)
        self.assertIn("nothing: missing, no mutants.json", out)

    def write_listed_only(self, name, listed):
        """A mutants.out with its list and no outcomes, as cargo-mutants
        leaves one that stopped before its first outcome, or that had
        nothing to test."""
        d = os.path.join(self.tmp, name)
        os.makedirs(d)
        with open(os.path.join(d, "mutants.json"), "w") as f:
            json.dump(listed, f)
        return d

    def test_a_shard_with_no_outcomes_is_missing_and_the_others_still_report(self):
        good = self.run_dir("shard-0", [LOGLIK, SIGMOID], [BASELINE_OK, outcome(LOGLIK, "MissedMutant"), outcome(SIGMOID, "CaughtMutant")])
        lost = self.write_listed_only("shard-1", [CUT, WALK])
        gone = os.path.join(self.tmp, "shard-2")
        md, issue = os.path.join(self.tmp, "summary.md"), os.path.join(self.tmp, "issue.md")
        code, out = self.main(good, lost, gone, "--markdown", md, "--issue", issue)
        self.assertEqual(code, 1)
        self.assertIn("shard-1: missing, listed 2 mutants and left no outcomes", out)
        self.assertIn("shard-2: missing, no mutants.json", out)
        # The good shard's survivor is in the summary and the issue all the same.
        self.assertIn("model.rs:298", self.read(md))
        body = self.read(issue)
        self.assertIn("- 298 `TasteSample::loglik`: `replace TasteSample::loglik -> f64 with 0.0`", body)
        self.assertIn("shard-1: missing", body)
        # A missing shard is not "stopped before its end": it never began.
        self.assertNotIn("stopped before its end", out)
        # Its listed mutants are counted as listed and untested.
        self.assertIn("| **All** | 4 | 2 |", self.read(md))

    def test_when_no_shard_reported_the_issue_says_so(self):
        # download-artifact passes when its pattern matches nothing, so the
        # survivors job can be left with no directory at all.
        gone = [os.path.join(self.tmp, f"shard-{k}") for k in range(2)]
        issue, md = os.path.join(self.tmp, "issue.md"), os.path.join(self.tmp, "summary.md")
        code, out = self.main(*gone, "--issue", issue, "--markdown", md)
        self.assertEqual(code, 1)
        self.assertIn(R.NONE_REPORTED, out)
        body = self.read(issue)
        self.assertIn(R.NONE_REPORTED, body)
        self.assertIn("shard-0: missing", body)
        self.assertIn("shard-1: missing", body)
        self.assertIn(R.NONE_REPORTED, self.read(md))

    def test_a_shard_with_nothing_to_test_is_empty_not_missing(self):
        empty = self.write_listed_only("shard-0", [])
        good = self.run_dir("shard-1", [CUT], [BASELINE_OK, outcome(CUT, "CaughtMutant")])
        issue = os.path.join(self.tmp, "issue.md")
        code, out = self.main(empty, good, "--issue", issue)
        self.assertEqual(code, 0)
        self.assertNotIn("missing", out)
        self.assertNotIn("stopped before its end", out)
        self.assertIn("| **All** | 1 | 0 | 0 |", self.read(issue))

    def test_an_outcome_in_another_shape_marks_its_run_missing_not_the_report_broken(self):
        bad = self.run_dir("shard-0", [LOGLIK], [BASELINE_OK, {"scenario": {"Mutant": {"name": "x"}}, "summary": "MissedMutant"}])
        good = self.run_dir("shard-1", [CUT], [BASELINE_OK, outcome(CUT, "MissedMutant")])
        code, out = self.main(bad, good)
        self.assertEqual(code, 1)
        self.assertIn("shard-0: missing, outcomes.json is not in the shape", out)
        self.assertIn("lib.rs:40", out)

    def test_a_run_stopped_at_its_cap_says_so_and_judges_what_it_reached(self):
        d = self.run_dir("one", [LOGLIK, SIGMOID, CUT], [BASELINE_OK, outcome(LOGLIK, "CaughtMutant")], finished=False)
        md = os.path.join(self.tmp, "summary.md")
        code, out = self.main(d, "--markdown", md)
        self.assertEqual(code, 0)
        self.assertIn("stopped before its end (a time cap, an interrupt, or a crash", out)
        self.assertIn("**Stopped before its end**", self.read(md))
        self.assertNotIn(R.NONE_REPORTED, out)
        self.assertIn("| **All** | 3 | 1 | 1 | 0 | 0 | 0 |", self.read(md))

    # ─── Markdown and the issue ─────────────────────────────────────────────

    def test_markdown_links_each_survivor_and_keeps_a_pipe_inside_its_cell(self):
        d = self.run_dir("one", [OR], [BASELINE_OK, outcome(OR, "MissedMutant")])
        md = os.path.join(self.tmp, "summary.md")
        self.main(d, "--markdown", md, "--link", "https://github.com/o/r/blob/abc")
        text = self.read(md)
        self.assertIn(
            "| [crates/auracle-taste/src/model.rs:915](https://github.com/o/r/blob/abc/crates/auracle-taste/src/model.rs#L915)"
            " | `TastePosterior::aligned_to` | `replace \\|\\| with &&` |",
            text,
        )
        # Every row of the survivors' table has its three cells.
        rows = [line for line in text.splitlines() if line.startswith("| [")]
        self.assertTrue(all(line.replace("\\|", "").count("|") == 4 for line in rows))

    def test_markdown_appends_to_what_the_summary_already_holds(self):
        d = self.run_dir("one", [LOGLIK], [BASELINE_OK, outcome(LOGLIK, "CaughtMutant")])
        md = os.path.join(self.tmp, "summary.md")
        with open(md, "w") as f:
            f.write("earlier\n")
        self.main(d, "--markdown", md)
        text = self.read(md)
        self.assertTrue(text.startswith("earlier\n## Mutants"))
        self.assertIn("No mutant survived.", text)

    def test_the_issue_lists_survivors_by_file_and_counts_what_did_not_fit(self):
        d = self.run_dir(
            "one",
            [LOGLIK, SIGMOID, CUT, WALK],
            [BASELINE_OK, *(outcome(m, "MissedMutant") for m in (LOGLIK, SIGMOID, CUT, WALK))],
        )
        rep = R.Report([R.read_run(d)])
        whole = R.issue_body(rep, rep.per_crate(), None)
        self.assertIn("**crates/auracle-grammar/src/lib.rs**", whole)
        self.assertIn("- 330 `sigmoid`: `replace + with -`", whole)
        self.assertNotIn("more:", whole)
        # Room for the table and the first file only: the second file is
        # left out whole, and counted.
        first = whole.index("**crates/auracle-taste")
        cut = R.issue_body(rep, rep.per_crate(), None, budget=first)
        self.assertIn("**crates/auracle-grammar/src/lib.rs**", cut)
        self.assertNotIn("model.rs", cut)
        self.assertIn("And 2 more: the run's summary lists every one.", cut)


if __name__ == "__main__":
    unittest.main(verbosity=1)
