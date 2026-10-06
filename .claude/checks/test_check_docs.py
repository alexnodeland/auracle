#!/usr/bin/env python3
"""The agent docs check's tests (`.claude/checks/check_docs.py`).

    python3 .claude/checks/test_check_docs.py      (run by `make dev-check`)

Each case runs the check in a throwaway tree, never in the real one. Python 3
standard library only.
"""

import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import unittest

CHECK = os.path.join(os.path.dirname(os.path.abspath(__file__)), "check_docs.py")
BROKEN = "See [the plan](missing.md).\n"


class OtherCheckouts(unittest.TestCase):
    """A branch's worktree lives inside the main checkout, at
    .claude/worktrees/<topic>, with its own copy of every doc: the check
    reads the docs of the checkout it runs in, and no other's."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.tmp.name)
        self.write("AGENTS.md", "Read [the process](docs/process.md).\n")
        self.write("docs/process.md", "# How work flows\n")
        # .git is a directory in a clone and a file in a worktree, as git
        # makes them: one worktree where they live, one placed elsewhere.
        (self.root / ".git").mkdir()
        for wt in (".claude/worktrees/x", "www/clone"):
            self.write(f"{wt}/.git", "gitdir: elsewhere\n")
            self.write(f"{wt}/AGENTS.md", BROKEN)
        # A TAB where a backslash was lost, which the site's Markdown is
        # checked for.
        self.write("www/clone/guide.md", "a lost \theta\n")

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, rel, text):
        p = self.root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text)

    def run_check(self):
        return subprocess.run([sys.executable, CHECK], cwd=self.root, capture_output=True, text=True)

    def test_a_checkout_inside_this_one_is_not_read(self):
        r = self.run_check()
        self.assertEqual(r.returncode, 0, r.stdout)
        self.assertIn("agent docs: 2 files, 0 problem(s)", r.stdout)

    def test_its_docs_would_be_read_were_they_this_checkouts(self):
        # Without their .git, the clone's files are this checkout's and are
        # read; .claude/worktrees/ is still never read.
        for wt in (".claude/worktrees/x", "www/clone"):
            (self.root / wt / ".git").unlink()
        r = self.run_check()
        self.assertEqual(r.returncode, 1, r.stdout)
        self.assertIn("www/clone/AGENTS.md: link to missing missing.md", r.stdout)
        self.assertIn("www/clone/guide.md:1: control character", r.stdout)
        self.assertNotIn(".claude/worktrees", r.stdout)
        self.assertIn("agent docs: 3 files, 2 problem(s)", r.stdout)

    def test_a_worktrees_own_docs_are_read_from_its_root(self):
        # Run in the worktree, its docs are the ones read.
        shutil.rmtree(self.root / "www")
        r = subprocess.run([sys.executable, CHECK], cwd=self.root / ".claude/worktrees/x", capture_output=True, text=True)
        self.assertEqual(r.returncode, 1, r.stdout)
        self.assertIn("AGENTS.md: link to missing missing.md", r.stdout)
        self.assertIn("agent docs: 1 files, 1 problem(s)", r.stdout)


if __name__ == "__main__":
    unittest.main(verbosity=1)
