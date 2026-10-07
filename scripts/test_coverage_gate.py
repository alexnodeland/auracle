#!/usr/bin/env python3
"""The coverage gate's tests: the floors, their ratchet, and the changed lines.

    python3 scripts/test_coverage_gate.py      (run by `make dev-check`)

No test reads a real coverage run or the real floors. The floors' cases run on
summaries written here, against a floors file in a throwaway tree; the changed
lines' cases make a throwaway git repository with a crate in it, change it,
and read an lcov file written to match. Python 3 standard library only.
"""

import contextlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import coverage_gate as C  # noqa: E402


def read(path):
    with open(path) as f:
        return f.read()


def summary(root, files):
    """A `cargo llvm-cov report --json --summary-only` with these files, each
    {path: (lines, lines covered, functions, functions covered)}; regions
    follow lines."""
    out = []
    for path, (ln, lc, fn, fc) in files.items():
        out.append(
            {
                "filename": os.path.join(root, path),
                "summary": {
                    "lines": {"count": ln, "covered": lc},
                    "functions": {"count": fn, "covered": fc},
                    "regions": {"count": ln, "covered": lc},
                },
            }
        )
    return {"data": [{"files": out, "totals": {}}], "type": "llvm.coverage.json.export"}


def test_env():
    """The environment every git command here runs in, made from the
    environment as it is at the call: none of git's own variables (see
    Tree.git), no system or global config, and a test identity."""
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    env.update(
        GIT_CONFIG_NOSYSTEM="1",
        GIT_CONFIG_GLOBAL=os.devnull,
        GIT_AUTHOR_NAME="t",
        GIT_AUTHOR_EMAIL="t@example.com",
        GIT_COMMITTER_NAME="t",
        GIT_COMMITTER_EMAIL="t@example.com",
    )
    return env


_NO_USER_CONFIG = mock.patch.dict(os.environ, {"GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull})


def setUpModule():
    """The script's own git runs in these scratch repositories too, so it
    reads no system or global config either: a global core.fsmonitor would
    start a daemon in each, which outlives the test and can hold up a later
    git there (it held one of the pre-commit hook's runs for minutes)."""
    _NO_USER_CONFIG.start()


def tearDownModule():
    _NO_USER_CONFIG.stop()


class Tree(unittest.TestCase):
    """A throwaway repository root with a crates/ directory."""

    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="coverage-test-")
        os.makedirs(os.path.join(self.root, "crates"))

    def tearDown(self):
        shutil.rmtree(self.root)

    def write(self, rel, text):
        path = os.path.join(self.root, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            f.write(text)
        return path

    def run_main(self, *argv):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = C.main(list(argv), self.root)
        return code, out.getvalue(), err.getvalue()

    def git(self, *args):
        """git in the throwaway repository and nowhere else. A git hook (the
        pre-commit hook runs these tests) sets GIT_DIR and GIT_INDEX_FILE to
        the repository being committed, and git obeys them from any
        directory: a test that inherited them once wrote its identity and
        core.bare into the real repository's config. So none of git's own
        variables reach these commands, the identity is given per command,
        and every command but `init` first checks it is in the throwaway
        repository."""
        if args[0] != "init":
            top = subprocess.run(
                ["git", "-C", self.root, "rev-parse", "--absolute-git-dir"], env=test_env(), capture_output=True, text=True
            ).stdout.strip()
            if os.path.realpath(top) != os.path.realpath(os.path.join(self.root, ".git")):
                raise AssertionError(f"refusing to run git outside the test's own repository (found {top!r})")
        subprocess.run(["git", "-C", self.root, *args], env=test_env(), check=True, capture_output=True)


class Paths(unittest.TestCase):
    def test_a_file_is_placed_by_its_path_under_crates(self):
        self.assertEqual(C.repo_path("/r/crates/auracle-taste/src/lib.rs", "/r"), "crates/auracle-taste/src/lib.rs")
        self.assertEqual(C.crate_of("crates/auracle-taste/src/model.rs"), "auracle-taste")

    def test_a_path_from_another_checkout_is_read_from_its_crates_directory(self):
        self.assertEqual(
            C.repo_path("/home/runner/work/a/a/crates/auracle-grammar/src/term.rs", "/Users/me/auracle"),
            "crates/auracle-grammar/src/term.rs",
        )

    def test_a_file_outside_crates_belongs_to_no_crate(self):
        self.assertIsNone(C.repo_path("/r/apps/web/x.rs", "/r"))
        self.assertIsNone(C.repo_path("/elsewhere/lib.rs", "/r"))


class Floors(Tree):
    def floors(self, data):
        self.write(C.BASELINE, C.write_floors(data))

    def summary_file(self, files):
        return self.write("summary.json", json.dumps(summary(self.root, files)))

    def test_a_crate_is_the_sum_of_its_files(self):
        s = summary(self.root, {"crates/a/src/lib.rs": (100, 90, 10, 9), "crates/a/src/x.rs": (50, 50, 5, 5)})
        a = C.per_crate(s, self.root)["a"].tallies
        self.assertEqual((a["lines"].count, a["lines"].covered), (150, 140))
        self.assertEqual((a["functions"].count, a["functions"].covered), (15, 14))

    def test_a_crate_at_its_floor_passes_and_the_table_says_so(self):
        self.floors({"a": {"lines": 90.0, "functions": 90.0}})
        code, out, err = self.run_main("floors", self.summary_file({"crates/a/src/lib.rs": (100, 90, 10, 9)}))
        self.assertEqual(code, 0, err)
        self.assertRegex(out, r"a\s+90\.00%\s+90\.00%")
        self.assertIn("ok", out)

    def test_one_line_under_the_floor_fails_and_names_the_crate(self):
        self.floors({"a": {"lines": 90.0, "functions": 90.0}})
        code, out, err = self.run_main("floors", self.summary_file({"crates/a/src/lib.rs": (100, 89, 10, 9)}))
        self.assertEqual(code, 1)
        self.assertIn("a: lines 89.00% (11 of 100 not covered) is under its floor of 90.00%", err)

    def test_functions_are_gated_as_lines_are(self):
        self.floors({"a": {"lines": 90.0, "functions": 90.0}})
        code, _, err = self.run_main("floors", self.summary_file({"crates/a/src/lib.rs": (100, 100, 10, 8)}))
        self.assertEqual(code, 1)
        self.assertIn("a: functions 80.00%", err)

    def test_the_comparison_is_exact_not_rounded(self):
        # 2 of 3 is 66.666…%: at a floor of 66.66 it passes, at 66.67 it does not.
        self.assertTrue(C.Tally(3, 2).at_least(66.66))
        self.assertFalse(C.Tally(3, 2).at_least(66.67))
        self.assertTrue(C.Tally(0, 0).at_least(100.0))

    def test_a_crate_with_no_floor_fails_and_a_floor_with_no_crate_fails(self):
        self.write("crates/unrun/Cargo.toml", "[package]\n")
        self.floors({"unrun": {"lines": 50.0, "functions": 50.0}, "gone": {"lines": 50.0, "functions": 50.0}})
        code, _, err = self.run_main("floors", self.summary_file({"crates/a/src/lib.rs": (10, 10, 1, 1)}))
        self.assertEqual(code, 1)
        self.assertIn("a: no floor yet", err)
        # A crate that is still there but was not measured: the run is short.
        self.assertIn("unrun: has a floor, but the run measured no file of it", err)
        # A crate whose directory is gone: its floor is dropped, not kept.
        self.assertIn("gone: has a floor, but the crate is gone; `make coverage-floors` drops it", err)

    def test_raise_drops_the_floor_of_a_removed_crate_and_keeps_the_rest(self):
        self.write("crates/a/Cargo.toml", "[package]\n")
        self.floors({"a": {"lines": 90.0, "functions": 90.0}, "old": {"lines": 80.0, "functions": 80.0}})
        s = self.summary_file({"crates/a/src/lib.rs": (100, 90, 10, 9)})
        code, out, err = self.run_main("floors", s, "--raise")
        self.assertEqual(code, 0, err)
        self.assertIn("old: dropped (the crate is gone)", out)
        self.assertEqual(json.loads(read(os.path.join(self.root, C.BASELINE))), {"a": {"lines": 90.0, "functions": 90.0}})
        self.assertEqual(self.run_main("floors", s)[0], 0)

    def test_a_crate_still_there_keeps_its_floor_through_raise(self):
        self.write("crates/a/Cargo.toml", "[package]\n")
        self.write("crates/b/Cargo.toml", "[package]\n")
        self.floors({"a": {"lines": 90.0, "functions": 90.0}, "b": {"lines": 80.0, "functions": 80.0}})
        code, _, err = self.run_main("floors", self.summary_file({"crates/a/src/lib.rs": (100, 90, 10, 9)}), "--raise")
        self.assertEqual(code, 1)
        self.assertIn("b: has a floor, but the run measured no file of it", err)
        self.assertIn("wrote nothing", err)

    def test_base_lets_a_removed_crates_floor_go_and_no_other(self):
        self.git("init", "-q", "-b", "main")
        self.write("crates/a/Cargo.toml", "[package]\n")
        self.write("crates/b/Cargo.toml", "[package]\n")
        self.floors({"a": {"lines": 90.0, "functions": 90.0}, "b": {"lines": 80.0, "functions": 80.0}})
        self.git("add", "-A")
        self.git("commit", "-q", "-m", "floors")
        self.git("rm", "-q", "-r", "crates/b")
        self.floors({"a": {"lines": 90.0, "functions": 90.0}})
        s = self.summary_file({"crates/a/src/lib.rs": (100, 95, 10, 10)})
        code, _, err = self.run_main("floors", s, "--base", "HEAD")
        self.assertEqual(code, 0, err)
        # Dropping the floor of a crate that is still there is lowering it.
        self.floors({"b": {"lines": 80.0, "functions": 80.0}})
        self.write("crates/b/Cargo.toml", "[package]\n")
        s = self.summary_file({"crates/b/src/lib.rs": (100, 95, 10, 10)})
        code, _, err = self.run_main("floors", s, "--base", "HEAD")
        self.assertEqual(code, 1)
        self.assertIn("a: its floor was removed", err)

    def test_raise_writes_todays_values_truncated_so_the_run_passes(self):
        self.floors({"a": {"lines": 90.0, "functions": 50.0}})
        s = self.summary_file({"crates/a/src/lib.rs": (3, 3, 3, 2), "crates/b/src/lib.rs": (1000, 979, 7, 7)})
        code, out, err = self.run_main("floors", s, "--raise")
        self.assertEqual(code, 0, err)
        floors = json.loads(read(os.path.join(self.root, C.BASELINE)))
        # 2 of 3 functions is 66.666…%: written as 66.66, never rounded up to 66.67.
        self.assertEqual(floors, {"a": {"lines": 100.0, "functions": 66.66}, "b": {"lines": 97.9, "functions": 100.0}})
        self.assertIn("a: functions 50.00 → 66.66", out)
        self.assertIn("b: new", out)
        self.assertEqual(self.run_main("floors", s)[0], 0)

    def test_the_file_keeps_two_decimals_one_crate_a_line(self):
        text = C.write_floors({"b": {"lines": 97.9, "functions": 100}, "a": {"lines": 1, "functions": 2.5}})
        self.assertEqual(
            text,
            '{\n  "a": {"lines": 1.00, "functions": 2.50},\n  "b": {"lines": 97.90, "functions": 100.00}\n}\n',
        )
        self.assertEqual(C.read_floors(text)["b"]["lines"], 97.9)

    def test_raise_never_lowers_a_floor_and_writes_nothing_while_one_is_under(self):
        self.floors({"a": {"lines": 95.0, "functions": 90.0}})
        before = read(os.path.join(self.root, C.BASELINE))
        code, _, err = self.run_main("floors", self.summary_file({"crates/a/src/lib.rs": (100, 94, 10, 10)}), "--raise")
        self.assertEqual(code, 1)
        self.assertIn("wrote nothing", err)
        self.assertEqual(read(os.path.join(self.root, C.BASELINE)), before)

    def test_raise_keeps_a_floor_the_run_is_over_but_not_by_a_hundredth(self):
        v = C.judge(C.per_crate(summary(self.root, {"crates/a/src/lib.rs": (100000, 90005, 1, 1)}), self.root),
                    {"a": {"lines": 90.0, "functions": 100.0}})
        self.assertEqual(v.raised["a"], {"lines": 90.0, "functions": 100.0})

    def test_a_malformed_floor_is_refused(self):
        with self.assertRaises(ValueError):
            C.read_floors('{"a": {"lines": 90}}')
        with self.assertRaises(ValueError):
            C.read_floors('{"a": {"lines": "90", "functions": 90}}')

    def test_base_fails_a_floor_that_went_down_or_away(self):
        self.git("init", "-q", "-b", "main")
        self.write("crates/a/Cargo.toml", "[package]\n")
        self.write("crates/b/Cargo.toml", "[package]\n")
        self.floors({"a": {"lines": 90.0, "functions": 90.0}, "b": {"lines": 80.0, "functions": 80.0}})
        self.git("add", "-A")
        self.git("commit", "-q", "-m", "floors")
        self.floors({"a": {"lines": 89.0, "functions": 90.0}})
        s = self.summary_file({"crates/a/src/lib.rs": (100, 95, 10, 10)})
        code, _, err = self.run_main("floors", s, "--base", "HEAD")
        self.assertEqual(code, 1)
        self.assertIn("a: the lines floor went from 90.00 to 89.00", err)
        self.assertIn("b: its floor was removed", err)

    def test_base_passes_a_floor_that_rose(self):
        self.git("init", "-q", "-b", "main")
        self.floors({"a": {"lines": 90.0, "functions": 90.0}})
        self.git("add", "-A")
        self.git("commit", "-q", "-m", "floors")
        self.floors({"a": {"lines": 95.0, "functions": 90.0}})
        code, _, err = self.run_main("floors", self.summary_file({"crates/a/src/lib.rs": (100, 95, 10, 10)}), "--base", "HEAD")
        self.assertEqual(code, 0, err)

    def test_the_table_prints_before_any_failure_and_the_summary_names_them(self):
        self.write("crates/a/Cargo.toml", "[package]\n")
        self.floors({"a": {"lines": 99.0, "functions": 99.0}})
        md = self.write("summary.md", "")
        code, out, err = self.run_main("floors", self.summary_file({"crates/a/src/lib.rs": (100, 90, 10, 9)}), "--markdown", md)
        self.assertEqual(code, 1)
        self.assertRegex(out, r"a\s+90\.00%\s+90\.00%\s+90\.00%\s+99\.00%\s+99\.00%\s+UNDER")
        text = read(md)
        self.assertIn("| `a` | 90.00% (10 of 100 missed) | 90.00% (1 of 10 missed) | 90.00% (10 of 100 missed) | 99.00% | 99.00% | UNDER |", text)
        self.assertIn("**Failed:**\n\n- a: lines 90.00% (10 of 100 not covered) is under its floor of 99.00%", text)

    def test_a_broken_floors_file_still_prints_the_table(self):
        self.write(C.BASELINE, '{"a": {"lines": 90}}')
        md = self.write("summary.md", "")
        code, out, err = self.run_main("floors", self.summary_file({"crates/a/src/lib.rs": (100, 90, 10, 9)}), "--markdown", md)
        self.assertEqual(code, 1)
        self.assertRegex(out, r"a\s+90\.00%\s+90\.00%")
        self.assertIn("needs exactly lines and functions", err)
        self.assertIn("| `a` | 90.00%", read(md))

    def test_markdown_appends_the_table(self):
        self.floors({"a": {"lines": 90.0, "functions": 90.0}})
        md = self.write("summary.md", "before\n")
        self.run_main("floors", self.summary_file({"crates/a/src/lib.rs": (100, 90, 10, 9)}), "--markdown", md)
        text = read(md)
        self.assertTrue(text.startswith("before\n### Coverage of the fast tier, by crate"))
        self.assertIn("| `a` | 90.00% (10 of 100 missed) | 90.00% (1 of 10 missed) |", text)


LIB_BEFORE = """pub fn add(a: i32, b: i32) -> i32 {
    a + b
}
"""

# Three changed lines: line 2 (code that runs), line 4 (blank) and line 5
# (code that does not run).
LIB_AFTER = """pub fn add(a: i32, b: i32) -> i32 {
    a.saturating_add(b)
}

pub fn sub(a: i32, b: i32) -> i32 { a - b }
"""


def lcov(root, records):
    """An lcov file: records is {path: (lines {n: count}, functions {name: (line, count)})}."""
    out = []
    for path, (lines, fns) in records.items():
        out.append(f"SF:{os.path.join(root, path)}")
        for name, (n, _) in fns.items():
            out.append(f"FN:{n},{name}")
        for name, (_, c) in fns.items():
            out.append(f"FNDA:{c},{name}")
        for n, c in sorted(lines.items()):
            out.append(f"DA:{n},{c}")
        out.append("end_of_record")
    return "\n".join(out) + "\n"


class Changed(Tree):
    def setUp(self):
        super().setUp()
        self.git("init", "-q", "-b", "main")
        self.write("crates/a/src/lib.rs", LIB_BEFORE)
        self.write("README.md", "x\n")
        self.git("add", "-A")
        self.git("commit", "-q", "-m", "base")
        self.git("checkout", "-q", "-b", "change")

    def lcov_file(self, records):
        return self.write("lcov.info", lcov(self.root, records))

    def test_one_covered_and_one_uncovered_changed_line(self):
        self.write("crates/a/src/lib.rs", LIB_AFTER)
        self.git("commit", "-q", "-am", "change")
        f = self.lcov_file({"crates/a/src/lib.rs": ({1: 3, 2: 3, 3: 3, 5: 0}, {"add": (1, 3), "sub": (5, 0)})})
        code, out, err = self.run_main("diff", f, "--base", "main")
        self.assertEqual(code, 1)
        self.assertIn("3 changed line(s) in crates/ since main", err)
        self.assertIn("2 of them code the run measured, 1 not covered", err)
        self.assertIn("crates/a/src/lib.rs\n        5  pub fn sub(a: i32, b: i32) -> i32 { a - b }\n", err)
        self.assertNotIn("saturating_add", err)

    def test_every_changed_line_covered_passes(self):
        self.write("crates/a/src/lib.rs", LIB_AFTER)
        self.git("commit", "-q", "-am", "change")
        f = self.lcov_file({"crates/a/src/lib.rs": ({1: 3, 2: 3, 3: 3, 5: 1}, {"add": (1, 3), "sub": (5, 1)})})
        code, out, _ = self.run_main("diff", f, "--base", "main")
        self.assertEqual(code, 0)
        self.assertIn("0 not covered", out)

    def test_a_closure_that_never_ran_on_a_line_that_did_is_uncovered(self):
        self.write("crates/a/src/lib.rs", "pub fn f(v: &[i32]) -> i32 {\n    v.iter().map(|x| x * 2).sum()\n}\n")
        self.git("commit", "-q", "-am", "change")
        f = self.lcov_file({"crates/a/src/lib.rs": ({1: 1, 2: 1, 3: 1}, {"f": (1, 1), "f::{closure#0}": (2, 0)})})
        code, _, err = self.run_main("diff", f, "--base", "main")
        self.assertEqual(code, 1)
        self.assertIn("    2  v.iter().map(|x| x * 2).sum()", err)

    def test_a_function_counts_as_run_when_any_copy_of_it_ran(self):
        # The same function in two binaries (or two instantiations): one copy
        # ran, so the line is covered.
        self.write("crates/a/src/lib.rs", "pub fn f() -> i32 {\n    1\n}\n")
        self.git("commit", "-q", "-am", "change")
        text = lcov(self.root, {"crates/a/src/lib.rs": ({1: 1, 2: 1, 3: 1}, {"_RNv1f": (1, 0)})})
        text += lcov(self.root, {"crates/a/src/lib.rs": ({1: 0, 2: 0, 3: 0}, {"_RNv2f": (1, 2)})})
        f = self.write("lcov.info", text)
        code, out, err = self.run_main("diff", f, "--base", "main")
        self.assertEqual(code, 0, err)

    def test_uncommitted_and_untracked_changes_count(self):
        self.write("crates/a/src/lib.rs", LIB_AFTER)
        self.write("crates/a/src/new.rs", "pub fn n() {}\n")
        f = self.lcov_file(
            {
                "crates/a/src/lib.rs": ({1: 1, 2: 1, 3: 1, 5: 1}, {}),
                "crates/a/src/new.rs": ({1: 0}, {"n": (1, 0)}),
            }
        )
        code, _, err = self.run_main("diff", f, "--base", "main")
        self.assertEqual(code, 1)
        self.assertIn("crates/a/src/new.rs\n        1  pub fn n() {}", err)

    def test_a_diff_config_that_renames_the_prefixes_still_finds_the_line(self):
        # diff.mnemonicPrefix writes `+++ w/crates/…`, diff.noprefix
        # `+++ crates/…`; read as written, either made the check pass on
        # anything ("0 changed line(s)").
        self.write("crates/a/src/lib.rs", LIB_AFTER)
        self.git("commit", "-q", "-am", "change")
        f = self.lcov_file({"crates/a/src/lib.rs": ({1: 3, 2: 3, 3: 3, 5: 0}, {})})
        for key in ("diff.mnemonicPrefix", "diff.noprefix"):
            with self.subTest(key=key):
                self.git("config", key, "true")
                code, _, err = self.run_main("diff", f, "--base", "main")
                self.git("config", "--unset", key)
                self.assertEqual(code, 1)
                self.assertIn("3 changed line(s) in crates/ since main", err)
                self.assertIn("1 not covered", err)

    def test_files_the_run_did_not_measure_are_named_not_failed(self):
        self.write("crates/a/tests/it.rs", "#[test]\nfn t() {}\n")
        self.write("crates/a/Cargo.toml", "[package]\n")
        self.write("README.md", "changed\n")
        self.git("add", "-A")
        self.git("commit", "-q", "-m", "change")
        code, out, _ = self.run_main("diff", self.lcov_file({}), "--base", "main")
        self.assertEqual(code, 0)
        self.assertIn("not measured (no code the native fast tier builds): crates/a/tests/it.rs", out)
        self.assertNotIn("Cargo.toml", out)
        self.assertNotIn("README", out)

    def test_a_renamed_file_counts_only_its_changed_lines(self):
        self.git("mv", "crates/a/src/lib.rs", "crates/a/src/math.rs")
        self.git("commit", "-q", "-m", "rename")
        f = self.lcov_file({"crates/a/src/math.rs": ({1: 0, 2: 0, 3: 0}, {})})
        code, out, _ = self.run_main("diff", f, "--base", "main")
        self.assertEqual(code, 0)
        self.assertIn("0 changed line(s)", out)

    def test_the_diff_is_against_the_merge_base_not_the_branch_tip(self):
        # main moves on after the branch: its new line is not this change's.
        self.git("checkout", "-q", "main")
        self.write("crates/a/src/other.rs", "pub fn o() {}\n")
        self.git("add", "-A")
        self.git("commit", "-q", "-m", "main moves")
        self.git("checkout", "-q", "change")
        code, out, _ = self.run_main("diff", self.lcov_file({"crates/a/src/other.rs": ({1: 0}, {})}), "--base", "main")
        self.assertEqual(code, 0)
        self.assertIn("0 changed line(s)", out)

    def test_markdown_links_each_run_of_lines(self):
        self.write("crates/a/src/lib.rs", LIB_AFTER)
        self.git("commit", "-q", "-am", "change")
        self.write("crates/a/src/more.rs", "pub fn m(a: i32) -> i32 {\n    a * 2\n}\n")
        f = self.lcov_file(
            {
                "crates/a/src/lib.rs": ({1: 1, 2: 1, 3: 1, 5: 0}, {}),
                "crates/a/src/more.rs": ({1: 0, 2: 0, 3: 0}, {}),
            }
        )
        md = self.write("summary.md", "")
        self.run_main("diff", f, "--base", "main", "--markdown", md, "--link", "https://x/blob/abc/")
        text = read(md)
        self.assertIn("4 of the 5 changed lines the run measured (against `main`):", text)
        self.assertIn("- [`crates/a/src/lib.rs:5`](https://x/blob/abc/crates/a/src/lib.rs#L5): `pub fn sub(a: i32, b: i32) -> i32 { a - b }`", text)
        self.assertIn("- [`crates/a/src/more.rs:1-3`](https://x/blob/abc/crates/a/src/more.rs#L1-L3): `pub fn m(a: i32) -> i32 {`", text)


class NoOtherRepository(Tree):
    """The incident this guards against: the pre-commit hook ran these tests
    with GIT_DIR, GIT_INDEX_FILE and GIT_WORK_TREE naming the repository
    being committed, and the tests' git commands wrote to it. Here those
    variables name a victim repository while the tests' helpers and every
    path of the script that runs git do their work, and the victim must come
    out byte for byte as it went in."""

    VICTIM_FILES = ("config", "index", "HEAD", "refs/heads/main")

    def setUp(self):
        super().setUp()
        self.victim = tempfile.mkdtemp(prefix="coverage-victim-")
        for args in (["init", "-q", "-b", "main"], ["add", "-A"], ["commit", "-q", "-m", "victim"]):
            if args[0] == "add":
                with open(os.path.join(self.victim, "f"), "w") as f:
                    f.write("x\n")
            subprocess.run(["git", "-C", self.victim, *args], env=test_env(), check=True, capture_output=True)

    def tearDown(self):
        shutil.rmtree(self.victim)
        super().tearDown()

    def snapshot(self):
        out = {}
        for rel in self.VICTIM_FILES:
            with open(os.path.join(self.victim, ".git", rel), "rb") as f:
                out[rel] = f.read()
        return out

    def test_git_variables_naming_another_repository_change_nothing_in_it(self):
        before = self.snapshot()
        hook = {
            "GIT_DIR": os.path.join(self.victim, ".git"),
            "GIT_INDEX_FILE": os.path.join(self.victim, ".git", "index"),
            "GIT_WORK_TREE": self.victim,
        }
        with mock.patch.dict(os.environ, hook):
            # The tests' helpers: init, config, add, commit, branch, mv.
            self.git("init", "-q", "-b", "main")
            self.git("config", "diff.noprefix", "true")
            self.write("crates/a/Cargo.toml", "[package]\n")
            self.write("crates/a/src/lib.rs", LIB_BEFORE)
            self.floors_file({"a": {"lines": 90.0, "functions": 90.0}})
            self.git("add", "-A")
            self.git("commit", "-q", "-m", "base")
            self.git("checkout", "-q", "-b", "change")
            self.write("crates/a/src/lib.rs", LIB_AFTER)
            self.git("commit", "-q", "-am", "change")
            # Every path of the script that runs git: diff (merge-base,
            # diff, ls-files) and floors --base (merge-base, show).
            lcov_path = self.write("lcov.info", lcov(self.root, {"crates/a/src/lib.rs": ({1: 1, 2: 1, 3: 1, 5: 0}, {})}))
            code, _, err = self.run_main("diff", lcov_path, "--base", "main")
            self.assertEqual(code, 1)
            self.assertIn("1 not covered", err)
            s = self.write("summary.json", json.dumps(summary(self.root, {"crates/a/src/lib.rs": (100, 95, 10, 10)})))
            code, _, err = self.run_main("floors", s, "--base", "main")
            self.assertEqual(code, 0, err)
        self.assertEqual(self.snapshot(), before)
        # And the work happened where it should have.
        log = subprocess.run(["git", "-C", self.root, "log", "--format=%s"], env=test_env(), capture_output=True, text=True)
        self.assertEqual(log.stdout.split(), ["change", "base"])

    def floors_file(self, data):
        self.write(C.BASELINE, C.write_floors(data))


class OwnEnv(Tree):
    """What the script's git is given of the caller's environment: never a
    variable that names a repository, always which config files to read."""

    def test_which_config_to_read_reaches_git_and_no_repository_does(self):
        cfg = self.write("global.gitconfig", "[user]\n\tname = global-sentinel\n")
        self.git("init", "-q", "-b", "main")
        hook = {"GIT_CONFIG_GLOBAL": cfg, "GIT_DIR": "/nonexistent/.git", "GIT_INDEX_FILE": "/nonexistent/index"}
        with mock.patch.dict(os.environ, hook):
            env = C.own_env()
            name = C.git(["config", "user.name"], self.root, check=False).strip()
        self.assertEqual(name, "global-sentinel")
        self.assertEqual(env["GIT_CONFIG_GLOBAL"], cfg)
        self.assertEqual(env["GIT_CONFIG_NOSYSTEM"], "1")
        self.assertNotIn("GIT_DIR", env)
        self.assertNotIn("GIT_INDEX_FILE", env)


class NoFileSystemMonitor(Tree):
    """A config that turns the file-system monitor on (a user's global
    core.fsmonitor=true, which the script's git reads when it is named by
    GIT_CONFIG_GLOBAL, as OwnEnv's) does not make the script's git ask it:
    `diff` and `ls-files --others` would ask a daemon, and start one for
    each scratch repository, to outlive it and hold up a later git there.
    The monitor here is a hook that records that it was asked (git runs one
    for the same two commands, without starting a daemon), so a test that
    fails does so without leaving one behind."""

    def setUp(self):
        super().setUp()
        self.outside = tempfile.mkdtemp(prefix="coverage-monitor-")
        self.addCleanup(shutil.rmtree, self.outside)
        self.asked = os.path.join(self.outside, "asked")
        hook = os.path.join(self.outside, "monitor.sh")
        with open(hook, "w") as f:
            f.write(f'#!/bin/sh\necho asked >> "{self.asked}"\nprintf "\\0"\n')
        os.chmod(hook, 0o755)
        self.cfg = os.path.join(self.outside, "global.gitconfig")
        with open(self.cfg, "w") as f:
            f.write(f"[core]\n\tfsmonitor = {hook}\n")
        self.git("init", "-q", "-b", "main")
        self.write("crates/a/src/lib.rs", LIB_BEFORE)
        self.git("add", "-A")
        self.git("commit", "-q", "-m", "base")
        self.write("crates/a/src/lib.rs", LIB_AFTER)
        self.write("crates/a/src/new.rs", "pub fn n() {}\n")

    def was_asked(self):
        asked = os.path.exists(self.asked)
        if asked:
            os.remove(self.asked)
        return asked

    def test_the_changed_lines_are_read_without_asking_the_monitor(self):
        with mock.patch.dict(os.environ, {"GIT_CONFIG_GLOBAL": self.cfg}):
            # The control: git asks the monitor for both commands when
            # nothing says otherwise, so the test below can fail.
            for args in (["diff", "--unified=0", "HEAD", "--", "crates"], ["ls-files", "--others", "--", "crates"]):
                subprocess.run(["git", "-C", self.root, *args], env=C.own_env(), capture_output=True, check=True)
                self.assertTrue(self.was_asked(), f"git {args[0]} did not ask the monitor: this test proves nothing")
            mb, changed = C.changes_since("main", self.root)
        self.assertFalse(self.was_asked(), "the script's git asked the file-system monitor")
        self.assertEqual(changed["crates/a/src/lib.rs"], {2, 4, 5})
        self.assertEqual(changed["crates/a/src/new.rs"], {1, 2})


class Parsing(unittest.TestCase):
    def test_hunks_give_the_new_side_and_a_deletion_gives_nothing(self):
        diff = "\n".join(
            [
                "diff --git a/crates/a/src/x.rs b/crates/a/src/x.rs",
                "--- a/crates/a/src/x.rs",
                "+++ b/crates/a/src/x.rs",
                "@@ -3 +3 @@",
                "@@ -10,0 +11,2 @@",
                "@@ -20,4 +22,0 @@",
                "diff --git a/crates/a/src/gone.rs b/crates/a/src/gone.rs",
                "--- a/crates/a/src/gone.rs",
                "+++ /dev/null",
                "@@ -1,3 +0,0 @@",
            ]
        )
        self.assertEqual(C.changed_lines(diff), {"crates/a/src/x.rs": {3, 11, 12}})

    def test_a_new_side_path_without_its_prefix_is_an_error_not_a_pass(self):
        for target in ("+++ w/crates/a/src/x.rs", "+++ crates/a/src/x.rs"):
            with self.subTest(target=target), self.assertRaises(ValueError):
                C.changed_lines(f"--- a/crates/a/src/x.rs\n{target}\n@@ -3 +3 @@\n")

    def test_runs_group_consecutive_lines(self):
        self.assertEqual(C.runs([1, 2, 3, 7, 9, 10]), [(1, 3), (7, 7), (9, 10)])


if __name__ == "__main__":
    unittest.main(verbosity=1)
