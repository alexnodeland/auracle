#!/usr/bin/env python3
"""rows_resolve.py's tests: the conflicts it resolves, and the overlaps it
refuses (`make dev-check`, its dev-ops part).

    python3 scripts/ops/test_rows_resolve.py

Each conflict is written as git writes one in diff3 style: the kept side
(HEAD), the base, then the incoming side. Python 3 standard library only.
"""

import contextlib
import io
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rows_resolve as R  # noqa: E402


def conflict(kept, base, theirs, label="abc1234 (tests: a row)"):
    """A diff3 conflict block, each side given as a list of lines."""
    side = lambda lines: "".join(f"{l}\n" for l in lines)  # noqa: E731
    return f"<<<<<<< HEAD\n{side(kept)}||||||| parent of {label}\n{side(base)}=======\n{side(theirs)}>>>>>>> {label}\n"


TABLE = "| Gate | Command |\n| --- | --- |\n"


class Resolves(unittest.TestCase):
    def test_a_row_edited_on_one_side_and_a_row_added_on_the_other(self):
        text = TABLE + conflict(
            ["| Lint | `make lint` (clippy) |", "| Web | `make web-check` |"],
            ["| Lint | `make lint` |", "| Web | `make web-check` |"],
            ["| Lint | `make lint` |", "| Web | `make web-check` |", "| Ops | `make dev-ops` |"],
        )
        out, left = R.resolve(text)
        self.assertEqual(left, [])
        self.assertEqual(out, TABLE + "| Lint | `make lint` (clippy) |\n| Web | `make web-check` |\n| Ops | `make dev-ops` |\n")

    def test_the_same_the_other_way_round(self):
        # main added a row; the branch edited one.
        out, left = R.resolve(conflict(["| a | 1 |", "| b | 2 |", "| c | 3 |"], ["| a | 1 |", "| b | 2 |"], ["| a | 1 |", "| b | 20 |"]))
        self.assertEqual(left, [])
        self.assertEqual(out, "| a | 1 |\n| b | 20 |\n| c | 3 |\n")

    def test_rows_added_at_the_same_place_keep_both_main_first(self):
        out, left = R.resolve(conflict(["| main's |"], [], ["| the branch's |"]))
        self.assertEqual(left, [])
        self.assertEqual(out, "| main's |\n| the branch's |\n")
        out, _ = R.resolve(conflict(["| a |", "| main's |"], ["| a |"], ["| a |", "| the branch's |"]))
        self.assertEqual(out, "| a |\n| main's |\n| the branch's |\n")

    def test_a_row_added_after_one_main_changed_goes_at_the_end(self):
        out, left = R.resolve(conflict(["| a |", "| b, edited |"], ["| a |", "| b |"], ["| a |", "| b |", "| c |"]))
        self.assertEqual(left, [])
        self.assertEqual(out, "| a |\n| b, edited |\n| c |\n")

    def test_a_row_the_branch_removed_is_removed(self):
        out, left = R.resolve(conflict(["| a |", "| b |", "| c |", "| d |"], ["| a |", "| b |", "| c |"], ["| a |", "| c |"]))
        self.assertEqual(left, [])
        self.assertEqual(out, "| a |\n| c |\n| d |\n")

    def test_repeated_lines_are_matched_by_place_not_by_text(self):
        # Two blank lines and two separators: the edit lands on the right one.
        kept = ["| --- |", "", "| x |", "", "| --- |", "| y |", "| new on main |"]
        base = ["| --- |", "", "| x |", "", "| --- |", "| y |"]
        theirs = ["| --- |", "", "| x |", "", "| --- |", "| y, edited |"]
        out, left = R.resolve(conflict(kept, base, theirs))
        self.assertEqual(left, [])
        self.assertEqual(out.splitlines(), ["| --- |", "", "| x |", "", "| --- |", "| y, edited |", "| new on main |"])

    def test_two_words_added_to_one_line_are_both_kept(self):
        out, left = R.resolve(conflict(["DEV_CHECKS := dev-docs dev-hooks dev-ci-stats"], ["DEV_CHECKS := dev-docs dev-hooks"], ["DEV_CHECKS := dev-docs dev-hooks dev-ops"]))
        self.assertEqual(left, [])
        self.assertEqual(out, "DEV_CHECKS := dev-docs dev-hooks dev-ci-stats dev-ops\n")

    def test_the_same_change_on_both_sides_is_kept_once(self):
        out, left = R.resolve(conflict(["| b, edited |"], ["| b |"], ["| b, edited |"]))
        self.assertEqual((out, left), ("| b, edited |\n", []))

    def test_text_around_the_conflict_is_untouched_and_crlf_kept(self):
        text = "before\r\n" + conflict(["x\r"], [], ["y\r"]) + "after\r\n"
        out, left = R.resolve(text)
        self.assertEqual(left, [])
        self.assertEqual(out, "before\r\nx\r\ny\r\nafter\r\n")


class Refuses(unittest.TestCase):
    def test_a_real_overlap_is_left_for_a_person(self):
        block = conflict(["| b | main's |"], ["| b | 2 |"], ["| b | the branch's |"])
        text = "top\n" + block
        out, left = R.resolve(text)
        self.assertEqual(out, text)
        self.assertEqual(left, ["line 2: both sides changed the same line"])

    def test_the_same_word_changed_on_both_sides_is_an_overlap(self):
        block = conflict(["DEV_CHECKS := a b2"], ["DEV_CHECKS := a b"], ["DEV_CHECKS := a b3"])
        out, left = R.resolve(block)
        self.assertEqual(out, block)
        self.assertEqual(len(left), 1)

    def test_a_conflict_with_no_base_is_left_with_the_way_to_redraw_it(self):
        text = "<<<<<<< HEAD\nx\n=======\ny\n>>>>>>> abc (tests: y)\n"
        out, left = R.resolve(text)
        self.assertEqual(out, text)
        self.assertIn("git checkout --conflict=diff3", left[0])

    def test_one_overlap_leaves_the_others_resolved(self):
        text = conflict(["| a |", "| main |"], ["| a |"], ["| a |", "| branch |"]) + "middle\n" + conflict(["| b1 |"], ["| b |"], ["| b2 |"])
        out, left = R.resolve(text)
        self.assertTrue(out.startswith("| a |\n| main |\n| branch |\nmiddle\n<<<<<<< HEAD\n| b1 |\n"), out)
        self.assertEqual(len(left), 1)


class Command(unittest.TestCase):
    def run_on(self, text):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "testing.md")
            with open(path, "w", newline="") as f:
                f.write(text)
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                code = R.main([path])
            with open(path, newline="") as f:
                return code, f.read(), out.getvalue()

    def test_resolved_writes_the_file_and_exits_0(self):
        code, text, said = self.run_on(TABLE + conflict(["| main |"], [], ["| branch |"]))
        self.assertEqual(code, 0)
        self.assertEqual(text, TABLE + "| main |\n| branch |\n")
        self.assertIn("1 resolved, 0 left", said)

    def test_an_overlap_exits_1_and_says_where(self):
        code, text, said = self.run_on(TABLE + conflict(["| main |"], ["| base |"], ["| branch |"]))
        self.assertEqual(code, 1)
        self.assertIn("<<<<<<<", text)
        self.assertIn("0 resolved, 1 left", said)
        self.assertIn("line 3:", said)


if __name__ == "__main__":
    unittest.main(verbosity=1)
