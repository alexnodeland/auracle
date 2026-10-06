#!/usr/bin/env python3
"""The changelog assembler's tests (`scripts/changelog.py`): how a fragment
parses, the note under [Unreleased], the order a release puts the fragments
in, the release itself, and what it refuses.

    python3 scripts/test_changelog.py      (run by `make dev-check`, and on
                                            every PR in CI's What changed job)

No test writes the real tree, and only the last reads it. Each case builds
a throwaway one in a temp dir. The cases about merge order commit to a
scratch git repo there, with no GIT_* variable passed through from the
caller's environment (a pre-commit hook sets GIT_DIR and GIT_INDEX_FILE,
which would point git at this repository). The environment they build sets
only what a scratch repo needs: no global or system config (so no fsmonitor
daemon, no signing), the temp dir as a ceiling git doesn't climb past, and
the commit's dates, so two commits are seconds apart. Python 3 standard
library only.
"""

import contextlib
import io
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import changelog as C  # noqa: E402

TMP = pathlib.Path(tempfile.gettempdir()).resolve()

CHANGELOG = f"""# Changelog

All notable changes to Auracle are documented here.

## [Unreleased]

{C.NOTE}

### Fixed: the newest entry written here, at the top

- **Written last.** Newest first, as the file has it.

### Added: an older one

- **Written first.**

## [0.2.0] - 2026-08-04

The first release under the name.

### Renamed: Ricercar → Auracle

- A rename.

## [0.1.0] - 2026-07-30

### Changed
- Dependencies come from crates.io.
"""

ZEBRA = "### Fixed: a zebra\n\n- **Merged first.** Its name sorts last.\n"
APPLE = "\n\n### Added: an apple\n\n- **Merged second.**\n\n### Changed: and a pear\n\n- **The same change.**\n\n"
MANGO = "### Changed: a mango\n\n- **Not committed yet.**\n"
KIWI = "### Fixed: a kiwi\n\n- **Merged while the release PR waited.**\n"


def git_env(when=None):
    """A clean environment for a scratch repo: nothing GIT_* from the caller,
    no global or system config, the temp dir as git's ceiling, and the
    commit's dates when given."""
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    env.update(GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_NOSYSTEM="1", GIT_CEILING_DIRECTORIES=str(TMP))
    if when is not None:
        env.update(GIT_AUTHOR_DATE=f"@{when} +0000", GIT_COMMITTER_DATE=f"@{when} +0000")
    return env


class Tree:
    """A throwaway tree with a CHANGELOG.md and a changelog.d/ README; with
    `git=True`, a scratch repo too, its first commit at t=1000."""

    def __init__(self, git=False):
        self.git_ = git

    def __enter__(self):
        self.root = pathlib.Path(tempfile.mkdtemp(prefix="changelog-", dir=TMP))
        self.write("CHANGELOG.md", CHANGELOG)
        self.write("changelog.d/README.md", "# changelog.d\n\nHow to write one: ### Fixd: nothing\n## not a fragment\n")
        if self.git_:
            self.git("init", "-q", ".")
            self.commit(1000)
        return self

    def __exit__(self, *exc):
        shutil.rmtree(self.root)

    def write(self, rel, text):
        p = self.root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")

    def text(self, rel="CHANGELOG.md"):
        return (self.root / rel).read_text(encoding="utf-8")

    def git(self, *args, when=None):
        ident = ["-c", "user.name=Changelog Test", "-c", "user.email=changelog-test@example.invalid", "-c", "commit.gpgsign=false"]
        subprocess.run(["git", *ident, *args], cwd=self.root, env=git_env(when), check=True, capture_output=True)

    def commit(self, when, *write):
        """Write each (path, text), and commit everything at `when`."""
        for rel, text in write:
            self.write(rel, text)
        self.git("add", "-A")
        self.git("commit", "-q", "--allow-empty", "-m", f"at {when}", when=when)

    def run(self, *argv, root=None):
        """The command's exit code, and what it printed to stdout and stderr."""
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = C.main(list(argv), root or self.root)
        return code, out.getvalue(), err.getvalue()


def notes(text, version):
    """A release's notes as release.yml cuts them: from the line after
    `## [version]` up to the next `## [`."""
    out, inside = [], False
    for line in text.split("\n"):
        if line.startswith(f"## [{version}]"):
            inside = True
        elif inside and line.startswith("## ["):
            break
        elif inside:
            out.append(line)
    return "\n".join(out)


def headings(text):
    return [ln for ln in text.split("\n") if ln.startswith("### ")]


class AFragment(unittest.TestCase):
    def test_sections_parse_as_kind_and_title(self):
        found, wrong = C.parse("changelog.d/a.md", APPLE)
        self.assertEqual(wrong, [])
        self.assertEqual(found, [("Added", "an apple"), ("Changed", "and a pear")])

    def test_each_known_kind_parses(self):
        for kind in C.KINDS:
            self.assertEqual(C.parse("x.md", f"### {kind}: a title\n\n- A line.\n"), ([(kind, "a title")], []))

    def test_an_unknown_kind_fails_with_its_line(self):
        _, wrong = C.parse("changelog.d/a.md", "### Fixed: one\n\n- A.\n\n### Fixd: two\n\n- B.\n")
        self.assertEqual(wrong, ["changelog.d/a.md:5: `Fixd` is not a kind: Added, Changed, Fixed, Removed, Renamed"])

    def test_a_heading_that_is_not_kind_colon_title_fails(self):
        for heading in ("### Fixed", "### Fixed:", "### Fixed:   ", "### fixed it", "  ### Fixed: indented", "###Fixed: tight"):
            _, wrong = C.parse("a.md", f"{heading}\n\n- A line.\n")
            self.assertEqual(len(wrong), 1, heading)
            self.assertTrue(wrong[0].startswith("a.md:1: `"), wrong)
            self.assertIn("is not `### Kind: title`", wrong[0])

    def test_a_top_or_release_heading_fails(self):
        for line in ("# Changelog", "## [0.3.0] - 2026-10-20", "## Notes", "##"):
            _, wrong = C.parse("a.md", f"### Fixed: one\n\n- A.\n{line}\n- B.\n")
            self.assertEqual(wrong, ["a.md:4: a `#` or `##` heading: a fragment's sections are `### Kind: title`"], line)

    def test_text_before_the_first_heading_fails_once(self):
        _, wrong = C.parse("a.md", "\nAn intro.\nMore of it.\n\n### Fixed: one\n\n- A.\n")
        self.assertEqual(wrong, ["a.md:2: text before the first `### Kind: title`"])

    def test_an_empty_section_or_file_fails(self):
        self.assertEqual(C.parse("a.md", "### Fixed: one\n\n### Added: two\n\n- B.\n")[1], ["a.md:1: a section with nothing under its heading"])
        self.assertEqual(C.parse("a.md", "### Fixed: one\n\n- A.\n\n### Added: two\n\n")[1], ["a.md:5: a section with nothing under its heading"])
        self.assertEqual(C.parse("a.md", "\n\n")[1], ["a.md:1: no `### Kind: title` section"])

    def test_code_is_body_text(self):
        text = "### Changed: the release steps\n\n```bash\n# a comment, not a heading\n### nor this\n```\n\n#### A smaller heading is body\n"
        self.assertEqual(C.parse("a.md", text), ([("Changed", "the release steps")], []))
        # A fence that opens a section's body is its text.
        self.assertEqual(C.parse("a.md", "### Fixed: one\n~~~\nx\n~~~\n")[1], [])

    def test_a_release_heading_in_code_still_fails(self):
        # release.yml's awk doesn't know about code: it would end the notes here.
        _, wrong = C.parse("a.md", "### Fixed: one\n\n```markdown\n## [0.3.0] - 2026-10-20\n```\n")
        self.assertEqual(wrong, ["a.md:4: `## [` starts a line, in code too: release.yml would end the release's notes here"])

    def test_a_fence_that_never_closes_fails(self):
        self.assertEqual(C.parse("a.md", "### Fixed: one\n\n```\ncode\n")[1], ["a.md:3: a code fence that never closes"])

    def test_a_heading_in_code_is_not_counted_as_a_section(self):
        self.assertEqual(C.sections("### Fixed: one\n\n```markdown\n### Added: an example\n```\n\n### Added: two\n\n- B.\n"), 2)


class TheCheck(unittest.TestCase):
    def test_passes_with_only_the_readme(self):
        with Tree() as t:
            self.assertEqual(t.run("--check"), (0, "  changelog: 0 fragment(s) in changelog.d/ parse, and `## [Unreleased]` holds its note\n", ""))

    def test_passes_and_counts_the_fragments(self):
        with Tree() as t:
            t.write("changelog.d/zebra.md", ZEBRA)
            t.write("changelog.d/apple.md", APPLE)
            t.write("changelog.d/.DS_Store", "")
            code, out, _ = t.run("--check")
            self.assertEqual(code, 0)
            self.assertTrue(out.startswith("  changelog: 2 fragment(s) in changelog.d/ parse"), out)

    def test_fails_with_the_file_and_line(self):
        with Tree() as t:
            t.write("changelog.d/zebra.md", ZEBRA)
            t.write("changelog.d/broken.md", "### Fixed: one\n\n- A.\n\n### Fix: two\n\n- B.\n")
            code, out, err = t.run("--check")
            self.assertEqual((code, out), (1, ""))
            self.assertIn("  changelog.d/broken.md:5: `Fix` is not a kind:", err)
            self.assertIn("  changelog: 1 problem(s); how to write a fragment: changelog.d/README.md\n", err)

    def test_a_file_that_is_not_a_fragment_fails(self):
        with Tree() as t:
            t.write("changelog.d/topic.markdown", ZEBRA)
            t.write("changelog.d/nested/topic.md", ZEBRA)
            code, _, err = t.run("--check")
            self.assertEqual(code, 1)
            self.assertIn("changelog.d/topic.markdown: not a fragment", err)
            self.assertIn("changelog.d/nested: not a fragment", err)

    def test_the_changelog_needs_exactly_one_unreleased(self):
        with Tree() as t:
            t.write("CHANGELOG.md", CHANGELOG.replace("## [Unreleased]", "## [Next]"))
            self.assertIn("CHANGELOG.md: 0 `## [Unreleased]` headings, not one", t.run("--check")[2])
            t.write("CHANGELOG.md", CHANGELOG + "\n## [Unreleased]\n")
            self.assertIn("CHANGELOG.md: 2 `## [Unreleased]` headings, not one", t.run("--check")[2])

    def test_unreleased_holds_its_note_and_nothing_else_before_its_first_heading(self):
        says = "CHANGELOG.md:5: under `## [Unreleased]`, before its first `###`, stands the note in scripts/changelog.py (NOTE)"
        with Tree() as t:
            for wrong in (
                CHANGELOG.replace(C.NOTE, "Some other note."),
                CHANGELOG.replace(C.NOTE + "\n", ""),
                # An entry written straight into the file, with no heading.
                CHANGELOG.replace(C.NOTE, C.NOTE + "\n\n- **A bullet under the note.**"),
                CHANGELOG.replace(C.NOTE, C.NOTE.replace("\n", " ", 1)),
            ):
                t.write("CHANGELOG.md", wrong)
                code, _, err = t.run("--check")
                self.assertEqual(code, 1)
                self.assertIn(says, err)

    def test_never_runs_git(self):
        def refuse(*a, **k):
            raise AssertionError("the check ran a subprocess")

        with Tree() as t, mock.patch.object(C.subprocess, "run", refuse):
            t.write("changelog.d/zebra.md", ZEBRA)
            self.assertEqual(t.run("--check")[0], 0)

    def test_a_wrong_command_prints_the_usage(self):
        with Tree() as t:
            for argv in ((), ("--release",), ("--check", "--preview"), ("--release", "1.0.0", "2026-10-20", "x")):
                code, out, _ = t.run(*argv)
                self.assertEqual(code, 2, argv)
                self.assertIn("python3 scripts/changelog.py --check", out)


class MergeOrder(unittest.TestCase):
    def test_by_the_commit_that_added_each_not_by_name(self):
        with Tree(git=True) as t:
            t.commit(2000, ("changelog.d/zebra.md", ZEBRA))
            t.commit(3000, ("changelog.d/apple.md", APPLE))
            # Editing zebra later doesn't move it: its add is what counts.
            t.commit(4000, ("changelog.d/zebra.md", ZEBRA + "- **And a second bullet.**\n"))
            self.assertEqual(C.added_at(t.root, "changelog.d/zebra.md"), 2000)
            self.assertEqual(C.merge_order(t.root, ["changelog.d/apple.md", "changelog.d/zebra.md"]), ["changelog.d/zebra.md", "changelog.d/apple.md"])

    def test_a_name_used_again_goes_by_its_latest_add(self):
        with Tree(git=True) as t:
            t.commit(2000, ("changelog.d/zebra.md", ZEBRA))
            t.commit(3000, ("changelog.d/apple.md", APPLE))
            (t.root / "changelog.d/zebra.md").unlink()
            t.commit(4000)
            t.commit(5000, ("changelog.d/zebra.md", ZEBRA))
            self.assertEqual(C.added_at(t.root, "changelog.d/zebra.md"), 5000)
            self.assertEqual(C.merge_order(t.root, ["changelog.d/apple.md", "changelog.d/zebra.md"]), ["changelog.d/apple.md", "changelog.d/zebra.md"])

    def test_one_not_committed_comes_last_by_when_it_was_written(self):
        with Tree(git=True) as t:
            t.commit(2000, ("changelog.d/zebra.md", ZEBRA))
            t.write("changelog.d/mango.md", MANGO)
            t.write("changelog.d/apple.md", APPLE)
            os.utime(t.root / "changelog.d/mango.md", (10, 10))
            os.utime(t.root / "changelog.d/apple.md", (20, 20))
            self.assertIsNone(C.added_at(t.root, "changelog.d/mango.md"))
            found = ["changelog.d/apple.md", "changelog.d/mango.md", "changelog.d/zebra.md"]
            self.assertEqual(C.merge_order(t.root, found), ["changelog.d/zebra.md", "changelog.d/mango.md", "changelog.d/apple.md"])

    def test_a_tie_goes_by_name(self):
        with Tree(git=True) as t:
            t.commit(2000, ("changelog.d/zebra.md", ZEBRA), ("changelog.d/apple.md", APPLE))
            self.assertEqual(C.merge_order(t.root, ["changelog.d/zebra.md", "changelog.d/apple.md"]), ["changelog.d/apple.md", "changelog.d/zebra.md"])

    def test_outside_a_repository_every_fragment_is_uncommitted(self):
        with Tree() as t:
            t.write("changelog.d/zebra.md", ZEBRA)
            t.write("changelog.d/apple.md", APPLE)
            os.utime(t.root / "changelog.d/zebra.md", (10, 10))
            os.utime(t.root / "changelog.d/apple.md", (20, 20))
            self.assertEqual(C.merge_order(t.root, ["changelog.d/apple.md", "changelog.d/zebra.md"]), ["changelog.d/zebra.md", "changelog.d/apple.md"])

    def test_a_root_inside_another_repository_is_not_read_as_part_of_it(self):
        # The outer repo committed inner/changelog.d/zebra.md; without a
        # ceiling, git run in inner/ would climb to it and answer.
        with Tree(git=True) as t:
            inner = t.root / "inner"
            t.commit(2000, ("inner/CHANGELOG.md", CHANGELOG), ("inner/changelog.d/zebra.md", ZEBRA))
            self.assertIsNone(C.added_at(inner, "changelog.d/zebra.md"))
            self.assertEqual(C.ordered(inner, ["changelog.d/zebra.md"]), [("changelog.d/zebra.md", None)])

    def test_a_hooks_git_variables_dont_reach_git(self):
        # A pre-commit hook runs with GIT_DIR and GIT_INDEX_FILE set; git
        # would read that repository instead of the root's.
        with Tree(git=True) as t:
            t.commit(2000, ("changelog.d/zebra.md", ZEBRA))
            bogus = {"GIT_DIR": str(t.root / "no-such-repo"), "GIT_INDEX_FILE": str(t.root / "no-such-index")}
            with mock.patch.dict(os.environ, bogus):
                self.assertEqual(C.added_at(t.root, "changelog.d/zebra.md"), 2000)

    def test_a_signature_check_in_the_log_is_not_read_as_a_time(self):
        # A global log.showSignature prints gpg's lines with each commit.
        seen = []

        def log(cmd, **k):
            seen.append(cmd)
            out = "gpg: Signature made Tue Oct  6 09:00:00 2026 UTC\ngpg: Good signature\n1791000000\nadded 1791000600\n"
            return subprocess.CompletedProcess(cmd, 0, out, "")

        with mock.patch.object(C.subprocess, "run", log):
            self.assertEqual(C.added_at(pathlib.Path("/nowhere"), "changelog.d/zebra.md"), 1791000600)
        self.assertIn("log.showSignature=false", seen[0])
        self.assertIsNone(C.added_time("gpg: Good signature\n1791000000\n"))


class TheRelease(unittest.TestCase):
    def tree(self):
        """A repo with zebra merged before apple, and mango not committed."""
        t = Tree(git=True).__enter__()
        self.addCleanup(t.__exit__)
        t.commit(2000, ("changelog.d/zebra.md", ZEBRA))
        t.commit(3000, ("changelog.d/apple.md", APPLE))
        t.write("changelog.d/mango.md", MANGO)
        return t

    def test_builds_the_section_newest_first_the_fragments_above_unreleased(self):
        t = self.tree()
        code, out, err = t.run("--release", "0.3.0", "2026-10-20")
        self.assertEqual((code, err), (0, ""))
        self.assertIn("`## [0.3.0] - 2026-10-20` holds 6 sections, with 3 fragment(s) from changelog.d/ (now deleted)", out)
        text = t.text()
        head, older = text.split("## [0.2.0] - 2026-08-04", 1)
        self.assertEqual(
            head,
            "# Changelog\n\nAll notable changes to Auracle are documented here.\n\n"
            f"## [Unreleased]\n\n{C.NOTE}\n\n"
            "## [0.3.0] - 2026-10-20\n\n"
            "### Changed: a mango\n\n- **Not committed yet.**\n\n"
            "### Added: an apple\n\n- **Merged second.**\n\n### Changed: and a pear\n\n- **The same change.**\n\n"
            "### Fixed: a zebra\n\n- **Merged first.** Its name sorts last.\n\n"
            "### Fixed: the newest entry written here, at the top\n\n- **Written last.** Newest first, as the file has it.\n\n"
            "### Added: an older one\n\n- **Written first.**\n\n",
        )
        # The releases before it are untouched, to the last byte.
        self.assertEqual("## [0.2.0] - 2026-08-04" + older, CHANGELOG[CHANGELOG.index("## [0.2.0]") :])

    def test_says_the_order_it_used_and_how_it_knew(self):
        t = self.tree()
        out = t.run("--release", "0.3.0", "2026-10-20")[1]
        self.assertIn(
            "  their order, newest first, as they stand under the heading:\n"
            "    changelog.d/mango.md: not committed, so by when it was written\n"
            "    changelog.d/apple.md: added 1970-01-01 00:50 UTC\n"
            "    changelog.d/zebra.md: added 1970-01-01 00:33 UTC\n"
            "  ordered 2 by the commit that added each, 1 by when each was written\n"
            "  next: write the paragraph under `## [0.3.0] - 2026-10-20` that says what this release is\n",
            out,
        )

    def test_release_yml_finds_the_section(self):
        t = self.tree()
        t.run("--release", "0.3.0", "2026-10-20")
        text = t.text()
        self.assertEqual([ln for ln in text.split("\n") if ln.startswith("## [")][:3], ["## [Unreleased]", "## [0.3.0] - 2026-10-20", "## [0.2.0] - 2026-08-04"])
        cut = notes(text, "0.3.0")
        self.assertTrue(cut.startswith("\n### Changed: a mango"), cut[:80])
        self.assertTrue(cut.rstrip().endswith("- **Written first.**"), cut[-80:])
        self.assertEqual(notes(text, "0.2.0"), notes(CHANGELOG, "0.2.0"))

    def test_unreleased_keeps_its_note_and_the_fragments_are_gone(self):
        t = self.tree()
        t.run("--release", "0.3.0", "2026-10-20")
        self.assertEqual(sorted(p.name for p in (t.root / "changelog.d").iterdir()), ["README.md"])
        self.assertEqual(C.split(t.text())[1:3], (C.NOTE, ""))
        self.assertEqual(t.run("--check")[0], 0)

    def test_the_next_release_holds_only_the_fragments_since(self):
        t = self.tree()
        t.run("--release", "0.3.0", "2026-10-20")
        t.commit(6000)
        t.commit(7000, ("changelog.d/zebra.md", ZEBRA))
        self.assertEqual(t.run("--release", "0.4.0", "2026-11-02")[0], 0)
        self.assertEqual(notes(t.text(), "0.4.0").strip("\n"), ZEBRA.strip("\n"))
        self.assertIn("### Changed: a mango", notes(t.text(), "0.3.0"))

    def test_a_fragment_merged_while_the_release_pr_waited_is_folded_in(self):
        t = self.tree()
        t.run("--release", "0.3.0", "2026-10-20")
        # The paragraph a person writes under the heading.
        t.write("CHANGELOG.md", t.text().replace("## [0.3.0] - 2026-10-20\n", "## [0.3.0] - 2026-10-20\n\nThe third release.\n"))
        t.commit(6000)
        t.commit(7000, ("changelog.d/kiwi.md", KIWI))
        before = headings(notes(t.text(), "0.3.0"))
        code, out, err = t.run("--release", "0.3.0", "2026-10-30")
        self.assertEqual((code, err), (0, ""))
        self.assertIn("folded 1 fragment(s) from changelog.d/ (now deleted) into `## [0.3.0] - 2026-10-20`, which holds 7 sections", out)
        self.assertIn("its heading and paragraph are as they were", out)
        text = t.text()
        self.assertEqual([ln for ln in text.split("\n") if ln.startswith("## [")][:3], ["## [Unreleased]", "## [0.3.0] - 2026-10-20", "## [0.2.0] - 2026-08-04"])
        self.assertTrue(notes(text, "0.3.0").startswith("\nThe third release.\n\n### Fixed: a kiwi\n"))
        self.assertEqual(headings(notes(text, "0.3.0")), ["### Fixed: a kiwi"] + before)
        self.assertEqual(notes(text, "0.2.0"), notes(CHANGELOG, "0.2.0"))
        self.assertEqual(sorted(p.name for p in (t.root / "changelog.d").iterdir()), ["README.md"])
        self.assertEqual(t.run("--check")[0], 0)
        # With nothing waiting, there is nothing to fold.
        self.assertIn("nothing to release", t.run("--release", "0.3.0")[2])

    def test_a_tagged_release_takes_nothing_more(self):
        t = self.tree()
        t.run("--release", "0.3.0", "2026-10-20")
        t.commit(6000)
        t.git("tag", "v0.3.0")
        t.commit(7000, ("changelog.d/kiwi.md", KIWI))
        before = t.text()
        code, _, err = t.run("--release", "0.3.0", "2026-10-30")
        self.assertEqual(code, 1)
        self.assertIn("`v0.3.0` is tagged, so `## [0.3.0]` is released: what waits goes in the next version", err)
        self.assertEqual(t.text(), before)
        self.assertTrue((t.root / "changelog.d/kiwi.md").exists())

    def test_without_an_older_release(self):
        with Tree() as t:
            t.write("CHANGELOG.md", f"# Changelog\n\n## [Unreleased]\n\n{C.NOTE}\n")
            t.write("changelog.d/zebra.md", ZEBRA)
            self.assertEqual(t.run("--release", "0.1.0", "2026-10-20")[0], 0)
            self.assertEqual(t.text(), f"# Changelog\n\n## [Unreleased]\n\n{C.NOTE}\n\n## [0.1.0] - 2026-10-20\n\n" + ZEBRA)

    def test_the_date_defaults_to_today(self):
        t = self.tree()
        code, out, _ = t.run("--release", "0.3.0")
        self.assertEqual(code, 0)
        self.assertIn(f"## [0.3.0] - {C.datetime.date.today().isoformat()}\n", t.text())

    def test_refusals_change_nothing(self):
        t = self.tree()
        before = t.text()
        for argv, says in (
            (("0.1.0", "2026-10-20"), "CHANGELOG.md already has a `## [0.1.0]` section, and not as the one under `## [Unreleased]`"),
            (("0.3", "2026-10-20"), "`0.3` is not a version: X.Y.Z"),
            (("v0.3.0", "2026-10-20"), "`v0.3.0` is not a version: X.Y.Z"),
            (("0.3.0", "20261020"), "`20261020` is not a date: YYYY-MM-DD"),
            (("0.3.0", "2026-13-01"), "`2026-13-01` is not a date: YYYY-MM-DD"),
        ):
            code, _, err = t.run("--release", *argv)
            self.assertEqual(code, 1, argv)
            self.assertIn(says, err)
        t.write("changelog.d/broken.md", "### Fixd: one\n\n- A.\n")
        code, _, err = t.run("--release", "0.3.0", "2026-10-20")
        self.assertEqual(code, 1)
        self.assertIn("changelog.d/broken.md:1: `Fixd` is not a kind", err)
        (t.root / "changelog.d/broken.md").unlink()
        t.write("CHANGELOG.md", before.replace(C.NOTE, C.NOTE + "\n\n- **A bullet under the note.**"))
        code, _, err = t.run("--release", "0.3.0", "2026-10-20")
        self.assertEqual(code, 1)
        self.assertIn("CHANGELOG.md:5: under `## [Unreleased]`", err)
        t.write("CHANGELOG.md", before)
        self.assertEqual(sorted(p.name for p in (t.root / "changelog.d").iterdir()), ["README.md", "apple.md", "mango.md", "zebra.md"])

    def test_nothing_to_release_is_refused(self):
        with Tree() as t:
            t.write("CHANGELOG.md", f"# Changelog\n\n## [Unreleased]\n\n{C.NOTE}\n\n## [0.2.0] - 2026-08-04\n\n### Fixed: x\n\n- Y.\n")
            code, _, err = t.run("--release", "0.3.0", "2026-10-20")
            self.assertEqual(code, 1)
            self.assertIn("nothing to release", err)


class ThePreview(unittest.TestCase):
    def test_prints_unreleased_newest_first_and_writes_nothing(self):
        with Tree(git=True) as t:
            t.commit(2000, ("changelog.d/zebra.md", ZEBRA))
            t.commit(3000, ("changelog.d/apple.md", APPLE))
            code, out, _ = t.run("--preview")
            self.assertEqual(code, 0)
            self.assertTrue(out.startswith(f"## [Unreleased]\n\n{C.NOTE}\n\n### Added: an apple\n"), out[:300])
            self.assertEqual(
                headings(out),
                ["### Added: an apple", "### Changed: and a pear", "### Fixed: a zebra", "### Fixed: the newest entry written here, at the top", "### Added: an older one"],
            )
            self.assertTrue(out.endswith("- **Written first.**\n"))
            self.assertNotIn("## [0.2.0]", out)
            self.assertEqual(t.text(), CHANGELOG)
            self.assertTrue((t.root / "changelog.d/zebra.md").exists())

    def test_a_broken_fragment_is_reported(self):
        with Tree() as t:
            t.write("changelog.d/broken.md", "Some text.\n")
            code, out, err = t.run("--preview")
            self.assertEqual((code, out), (1, ""))
            self.assertIn("changelog.d/broken.md:1: text before the first", err)


class TheRealTree(unittest.TestCase):
    def test_the_readme_is_not_a_fragment_and_unreleased_holds_the_note(self):
        # Reads only: the folder holds its README, and CHANGELOG.md has the
        # one `## [Unreleased]` a release closes, with the note under it.
        found, _ = C.fragments(C.ROOT)
        self.assertNotIn(f"{C.FRAGMENTS}/{C.README}", found)
        self.assertTrue((C.ROOT / C.FRAGMENTS / C.README).is_file())
        head, note, _, _ = C.split(C.read(C.ROOT, C.CHANGELOG))
        self.assertEqual((head[-1], note), (C.UNRELEASED, C.NOTE))


if __name__ == "__main__":
    # One line when they pass, like the rest of `make dev-check`; everything
    # unittest says when one fails.
    out = io.StringIO()
    result = unittest.TextTestRunner(stream=out, verbosity=2).run(unittest.defaultTestLoader.loadTestsFromModule(sys.modules[__name__]))
    if not result.wasSuccessful():
        sys.stderr.write(out.getvalue())
        sys.exit(1)
    print(f"  changelog tests: {result.testsRun} passed")
