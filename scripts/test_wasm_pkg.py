#!/usr/bin/env python3
"""The web engine's package script's tests: the stamp, the release check, the
engine inputs' hash, and taking another checkout's build.

    python3 scripts/test_wasm_pkg.py      (run by `make dev-check`)

Nothing here builds an engine or reads the real apps/web/pkg. The cases make
a throwaway git repository with a crate and an app script in it, a worktree
of it beside it (and more, where a case needs them), and a pkg/ of a few
bytes in each. Python 3 standard library
only.
"""

import contextlib
import hashlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import wasm_pkg as W  # noqa: E402

RECIPE = 'RUSTFLAGS=" -C link-arg=-zstack-size=8388608" wasm-pack build --release'


def test_env():
    """git's environment here: none of git's own variables (a git hook sets
    GIT_DIR and GIT_INDEX_FILE to the repository being committed, which git
    obeys from any directory), no system or global config, a test identity."""
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


class Checkouts(unittest.TestCase):
    """A main checkout with a crate, an app script and an ignored target/,
    and a worktree of it at the same commit."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="wasm-pkg-test-")
        self.main = os.path.join(self.tmp, "auracle")
        self.wt = os.path.join(self.tmp, "auracle-wt")
        os.makedirs(self.main)
        self.git(self.main, "init", "-q", "-b", "main")
        common = subprocess.run(
            ["git", "-C", self.main, "rev-parse", "--path-format=absolute", "--git-common-dir"],
            env=test_env(),
            capture_output=True,
            text=True,
        ).stdout.strip()
        if os.path.realpath(common) != os.path.realpath(os.path.join(self.main, ".git")):
            raise AssertionError(f"refusing to run git outside the test's own repository (found {common!r})")
        self.write(self.main, "crates/auracle-wasm/src/lib.rs", "pub fn f() {}\n")
        self.write(self.main, "Cargo.toml", "[workspace]\n")
        self.write(self.main, "apps/web/main.js", "main();\n")
        self.write(self.main, ".gitignore", "target/\napps/web/pkg/\n")
        self.git(self.main, "add", "-A")
        self.git(self.main, "commit", "-q", "-m", "one")
        self.git(self.main, "worktree", "add", "-q", "--detach", self.wt)

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def git(self, root, *args):
        """git in the throwaway repository, with none of git's own variables
        (test_env); setUp checks once that the repository is the test's."""
        subprocess.run(["git", "-C", root, *args], env=test_env(), check=True, capture_output=True)

    def write(self, root, rel, text):
        path = os.path.join(root, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            f.write(text)
        return path

    def worktree(self, name):
        """Another worktree of the repository, at the same commit."""
        path = os.path.join(self.tmp, name)
        self.git(self.main, "worktree", "add", "-q", "--detach", path)
        return path

    def build(self, root, wasm=b"\0asm-1", profile="release", src="here"):
        """A pkg/ as `make wasm` leaves it: the engine, its glue, the stamp."""
        pkg = os.path.join(root, W.PKG)
        os.makedirs(pkg, exist_ok=True)
        with open(os.path.join(pkg, W.WASM), "wb") as f:
            f.write(wasm)
        self.write(root, "apps/web/pkg/auracle_wasm.js", "glue();\n")
        if src == "here":
            src = W.source(root, RECIPE)
        return W.stamp(pkg, self.stamped(root), profile=profile, src=src)

    def stamped(self, root):
        return [os.path.join(root, W.PKG, W.WASM), os.path.join(root, W.PKG, "auracle_wasm.js"), os.path.join(root, "apps/web/main.js")]

    def stamp_of(self, root):
        return W.read_stamp(os.path.join(root, W.PKG))


class Stamp(Checkouts):
    def test_a_build_records_its_profile_and_source_and_a_restamp_keeps_them(self):
        made = self.build(self.main, profile="dev")
        self.assertEqual(made["profile"], "dev")
        self.assertEqual(made["source"], W.source(self.main, RECIPE))
        self.write(self.main, "apps/web/main.js", "main(2);\n")
        again = W.stamp(os.path.join(self.main, W.PKG), self.stamped(self.main))
        self.assertNotEqual(again["build"], made["build"], "a changed app script gets a new build id")
        self.assertEqual((again["profile"], again["source"]), ("dev", made["source"]))

    def test_the_build_id_is_the_hash_main_js_has_always_read(self):
        made = self.build(self.main)
        h = hashlib.sha256()
        for p in self.stamped(self.main):
            with open(p, "rb") as f:
                h.update(f.read())
        self.assertEqual(made["build"], h.hexdigest()[:16])

    def test_a_stamp_from_before_the_fields_is_a_release_build_with_no_source(self):
        pkg = os.path.join(self.main, W.PKG)
        self.build(self.main)
        with open(os.path.join(pkg, "build.json"), "w") as f:
            json.dump({"build": "0123456789abcdef"}, f)
        again = W.stamp(pkg, self.stamped(self.main))
        self.assertEqual(again["profile"], "release")
        self.assertNotIn("source", again)

    def test_a_build_whose_source_could_not_be_read_drops_the_old_one(self):
        self.build(self.main)
        again = W.stamp(os.path.join(self.main, W.PKG), self.stamped(self.main), profile="release", src="")
        self.assertNotIn("source", again)

    def test_a_build_keeps_the_source_it_hashed_first_only_if_the_rust_is_the_same_when_it_is_done(self):
        pkg = os.path.join(self.main, W.PKG)
        before = W.source(self.main, RECIPE)
        self.build(self.main, src=None)
        made = ["stamp", "--profile", "release", "--source", before, "--recipe", RECIPE, *self.stamped(self.main)]
        said = io.StringIO()
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(said):
            self.assertEqual(W.main(made, root=self.main), 0)
            self.assertEqual(self.stamp_of(self.main)["source"], before)
            self.assertEqual(said.getvalue(), "")
            # An edit saved while it built: the engine may hold it or not.
            self.write(self.main, "crates/auracle-wasm/src/lib.rs", "pub fn f() { 2; }\n")
            self.assertEqual(W.main(made, root=self.main), 0)
        self.assertIn("the Rust changed while it built", said.getvalue())
        got = W.read_stamp(pkg)
        self.assertEqual(got["profile"], "release")
        self.assertNotIn("source", got)

    def test_begin_marks_the_pkg_unfinished_with_no_build_id_and_a_restamp_keeps_it_so(self):
        pkg = os.path.join(self.main, W.PKG)
        self.assertEqual(W.begin(pkg), {"profile": "unfinished"}, "a first build: pkg/ made, and marked")
        self.build(self.main)
        W.begin(pkg)
        self.assertEqual(W.read_stamp(pkg), {"profile": "unfinished"})
        again = W.stamp(pkg, self.stamped(self.main))
        self.assertEqual(again["profile"], "unfinished")
        self.assertNotIn("source", again)


class Check(Checkouts):
    def test_no_engine_says_to_build_one(self):
        self.assertIn("make wasm", W.refusal(os.path.join(self.main, W.PKG)))

    def test_a_dev_build_is_refused_naming_make_wasm(self):
        self.build(self.main, profile="dev")
        why = W.refusal(os.path.join(self.main, W.PKG))
        self.assertIn("dev build", why)
        self.assertIn("`make wasm`", why)

    def test_an_unfinished_build_is_refused_naming_make_wasm(self):
        pkg = os.path.join(self.main, W.PKG)
        self.build(self.main)
        W.begin(pkg)
        why = W.refusal(pkg)
        self.assertIn("unfinished build", why)
        self.assertIn("`make wasm`", why)

    def test_a_release_build_and_one_from_before_the_profile_pass(self):
        pkg = os.path.join(self.main, W.PKG)
        self.build(self.main)
        self.assertIsNone(W.refusal(pkg))
        with open(os.path.join(pkg, "build.json"), "w") as f:
            json.dump({"build": "0123456789abcdef"}, f)
        self.assertIsNone(W.refusal(pkg))


class Source(Checkouts):
    def test_the_same_inputs_hash_the_same_in_both_checkouts(self):
        self.assertEqual(W.source(self.main, RECIPE), W.source(self.wt, RECIPE))

    def test_an_uncommitted_edit_a_new_file_or_another_command_changes_it(self):
        before = W.source(self.wt, RECIPE)
        self.write(self.wt, "crates/auracle-wasm/src/lib.rs", "pub fn f() { 1; }\n")
        edited = W.source(self.wt, RECIPE)
        self.assertNotEqual(edited, before)
        self.write(self.wt, "crates/auracle-wasm/src/new.rs", "\n")
        self.assertNotEqual(W.source(self.wt, RECIPE), edited)
        self.assertNotEqual(W.source(self.main, RECIPE + " --no-opt"), W.source(self.main, RECIPE))

    def test_the_app_scripts_a_crates_docs_and_ignored_files_are_not_inputs(self):
        before = W.source(self.wt, RECIPE)
        self.write(self.wt, "apps/web/main.js", "main(3);\n")
        self.write(self.wt, "crates/AGENTS.md", "# the crates\n")
        self.write(self.wt, "target/wasm32-unknown-unknown/release/x.wasm", "build output\n")
        self.assertEqual(W.source(self.wt, RECIPE), before)

    def test_a_deleted_input_changes_it(self):
        before = W.source(self.wt, RECIPE)
        os.remove(os.path.join(self.wt, "Cargo.toml"))
        self.assertNotEqual(W.source(self.wt, RECIPE), before)


class Reuse(Checkouts):
    def test_a_worktree_takes_the_main_checkouts_build_and_stamps_it_with_its_own_scripts(self):
        self.build(self.main, wasm=b"\0asm-main")
        self.write(self.wt, "apps/web/main.js", "main('worktree');\n")
        code, said = W.reuse(self.wt, RECIPE, self.stamped(self.wt))
        self.assertEqual(code, 0, said)
        with open(os.path.join(self.wt, W.PKG, W.WASM), "rb") as f:
            self.assertEqual(f.read(), b"\0asm-main")
        got = self.stamp_of(self.wt)
        self.assertEqual((got["profile"], got["source"]), ("release", W.source(self.wt, RECIPE)))
        self.assertNotEqual(got["build"], self.stamp_of(self.main)["build"], "stamped over the worktree's own main.js")

    def test_other_rust_is_refused_and_the_worktrees_pkg_is_left_alone(self):
        self.build(self.main, wasm=b"\0asm-main")
        self.build(self.wt, wasm=b"\0asm-mine", profile="dev")
        self.write(self.wt, "crates/auracle-wasm/src/lib.rs", "pub fn g() {}\n")
        code, said = W.reuse(self.wt, RECIPE, self.stamped(self.wt))
        self.assertEqual(code, 1)
        self.assertIn("other Rust", said)
        self.assertIn("make wasm", said)
        with open(os.path.join(self.wt, W.PKG, W.WASM), "rb") as f:
            self.assertEqual(f.read(), b"\0asm-mine")

    def test_another_build_command_is_refused(self):
        self.build(self.main)
        code, said = W.reuse(self.wt, RECIPE + " --no-opt", self.stamped(self.wt))
        self.assertEqual(code, 1)
        self.assertIn("another build command", said)

    def test_a_dev_build_no_build_or_one_that_does_not_say_what_it_was_built_from_is_refused(self):
        code, said = W.reuse(self.wt, RECIPE, self.stamped(self.wt))
        self.assertEqual(code, 1)
        self.assertIn("no built engine", said)
        self.build(self.main, profile="dev")
        code, said = W.reuse(self.wt, RECIPE, self.stamped(self.wt))
        self.assertEqual(code, 1)
        self.assertIn("dev build", said)
        self.build(self.main, src="")
        code, said = W.reuse(self.wt, RECIPE, self.stamped(self.wt))
        self.assertEqual(code, 1)
        self.assertIn("doesn't say what it was built from", said)
        self.assertFalse(os.path.exists(os.path.join(self.wt, W.PKG, W.WASM)))

    def test_a_build_that_stopped_after_writing_its_engine_is_refused_here_and_by_the_specs(self):
        # The main checkout's release build of this Rust; then a build of
        # other Rust that wrote its engine and stopped before wasm-opt.
        self.build(self.main, wasm=b"\0asm-S1-optimized")
        pkg = os.path.join(self.main, W.PKG)
        W.begin(pkg)
        with open(os.path.join(pkg, W.WASM), "wb") as f:
            f.write(b"\0asm-S2-unoptimized")
        self.assertIn("unfinished build", W.refusal(pkg))
        code, said = W.reuse(self.wt, RECIPE, self.stamped(self.wt))
        self.assertEqual(code, 1)
        self.assertIn("unfinished build", said)
        self.assertFalse(os.path.exists(os.path.join(self.wt, W.PKG, W.WASM)))

    def test_a_build_that_starts_there_while_it_is_copied_is_refused_and_nothing_is_left(self):
        self.build(self.main, wasm=b"\0asm-main")
        self.build(self.wt, wasm=b"\0asm-mine", profile="dev")
        copy = shutil.copytree

        def copy_then_build_there(src, dst, *a, **k):
            out = copy(src, dst, *a, **k)
            W.begin(os.path.join(self.main, W.PKG))  # make wasm starts in the main checkout
            return out

        W.shutil.copytree = copy_then_build_there
        try:
            code, said = W.reuse(self.wt, RECIPE, self.stamped(self.wt))
        finally:
            W.shutil.copytree = copy
        self.assertEqual(code, 1)
        self.assertIn("changed while it was copied", said)
        with open(os.path.join(self.wt, W.PKG, W.WASM), "rb") as f:
            self.assertEqual(f.read(), b"\0asm-mine")
        self.assertFalse(os.path.exists(os.path.join(self.wt, W.PKG) + ".reuse"))

    def test_the_main_checkout_with_no_other_engine_to_take_is_owed_a_build(self):
        self.build(self.main)
        code, said = W.reuse(self.main, RECIPE, self.stamped(self.main))
        self.assertEqual(code, 1)
        self.assertIn("`make wasm` is owed", said)
        self.assertIn(f"{self.wt} has no built engine", said)

    def test_the_main_checkout_takes_a_worktrees_build(self):
        self.build(self.wt, wasm=b"\0asm-worktree")
        code, said = W.reuse(self.main, RECIPE, self.stamped(self.main))
        self.assertEqual(code, 0, said)
        with open(os.path.join(self.main, W.PKG, W.WASM), "rb") as f:
            self.assertEqual(f.read(), b"\0asm-worktree")

    def test_a_worktree_takes_another_worktrees_build_when_the_main_checkout_has_none(self):
        other = self.worktree("auracle-other")
        self.build(other, wasm=b"\0asm-other")
        code, said = W.reuse(self.wt, RECIPE, self.stamped(self.wt))
        self.assertEqual(code, 0, said)
        self.assertIn(other, said)
        with open(os.path.join(self.wt, W.PKG, W.WASM), "rb") as f:
            self.assertEqual(f.read(), b"\0asm-other")
        self.assertEqual(self.stamp_of(self.wt)["source"], W.source(self.wt, RECIPE))

    def test_the_main_checkout_is_preferred_when_both_match(self):
        other = self.worktree("auracle-other")
        self.build(other, wasm=b"\0asm-other")
        self.build(self.main, wasm=b"\0asm-main")
        code, said = W.reuse(self.wt, RECIPE, self.stamped(self.wt))
        self.assertEqual(code, 0, said)
        with open(os.path.join(self.wt, W.PKG, W.WASM), "rb") as f:
            self.assertEqual(f.read(), b"\0asm-main")

    def test_a_checkout_that_cannot_be_taken_is_passed_over_for_one_that_can(self):
        # The main checkout: other Rust. One worktree: a dev build. Another:
        # the build wanted.
        dev = self.worktree("auracle-dev")
        good = self.worktree("auracle-good")
        self.build(dev, wasm=b"\0asm-dev", profile="dev")
        self.build(good, wasm=b"\0asm-good")
        self.build(self.main, wasm=b"\0asm-main", src="0123456789abcdef")
        code, said = W.reuse(self.wt, RECIPE, self.stamped(self.wt))
        self.assertEqual(code, 0, said)
        with open(os.path.join(self.wt, W.PKG, W.WASM), "rb") as f:
            self.assertEqual(f.read(), b"\0asm-good")

    def test_among_worktrees_the_most_recently_built_is_taken(self):
        old, new = self.worktree("auracle-old"), self.worktree("auracle-new")
        self.build(old, wasm=b"\0asm-old")
        self.build(new, wasm=b"\0asm-new")
        # git lists `old` first: only the engines' times can put `new` ahead.
        os.utime(os.path.join(old, W.PKG, W.WASM), (1_000_000, 1_000_000))
        os.utime(os.path.join(new, W.PKG, W.WASM), (2_000_000, 2_000_000))
        code, said = W.reuse(self.wt, RECIPE, self.stamped(self.wt))
        self.assertEqual(code, 0, said)
        with open(os.path.join(self.wt, W.PKG, W.WASM), "rb") as f:
            self.assertEqual(f.read(), b"\0asm-new")

    def test_no_match_anywhere_says_make_wasm_is_owed_and_why_each_was_passed_over(self):
        other = self.worktree("auracle-other")
        self.build(self.main, wasm=b"\0asm-main", src="0123456789abcdef")
        self.build(other, wasm=b"\0asm-other", profile="dev")
        self.build(self.wt, wasm=b"\0asm-mine", profile="dev")
        code, said = W.reuse(self.wt, RECIPE, self.stamped(self.wt))
        self.assertEqual(code, 1)
        self.assertIn("`make wasm` is owed", said)
        self.assertIn(f"{self.main}'s engine was built from other Rust", said)
        self.assertIn(f"{other}'s engine is a dev build", said)
        with open(os.path.join(self.wt, W.PKG, W.WASM), "rb") as f:
            self.assertEqual(f.read(), b"\0asm-mine", "a refusal leaves the worktree's own pkg/ alone")

    def test_a_refusal_says_why_for_the_first_few_checkouts_and_counts_the_rest(self):
        for i in range(W.SHOWN + 2):
            self.worktree(f"auracle-{i}")
        code, said = W.reuse(self.wt, RECIPE, self.stamped(self.wt))
        self.assertEqual(code, 1)
        lines = said.splitlines()
        # The main checkout and the seven others, but this worktree's own.
        self.assertEqual(len(lines), 1 + W.SHOWN + 1)
        self.assertEqual(lines[-1].strip(), f"and {W.SHOWN + 2 + 1 - W.SHOWN} more")

    def test_the_copy_is_files_not_links_and_a_later_build_there_does_not_change_it(self):
        self.build(self.main, wasm=b"\0asm-main")
        code, said = W.reuse(self.wt, RECIPE, self.stamped(self.wt))
        self.assertEqual(code, 0, said)
        mine = os.path.join(self.wt, W.PKG)
        self.assertFalse(os.path.islink(mine))
        for name in os.listdir(mine):
            self.assertFalse(os.path.islink(os.path.join(mine, name)), name)
        W.begin(os.path.join(self.main, W.PKG))  # a `make wasm` starts in the main checkout
        with open(os.path.join(self.main, W.PKG, W.WASM), "wb") as f:
            f.write(b"\0asm-rebuilt")
        with open(os.path.join(mine, W.WASM), "rb") as f:
            self.assertEqual(f.read(), b"\0asm-main")
        self.assertEqual(self.stamp_of(self.wt)["profile"], "release")

    def test_a_worktree_whose_directory_was_removed_is_skipped(self):
        gone = self.worktree("auracle-gone")
        self.build(gone, wasm=b"\0asm-gone")
        self.build(self.main, wasm=b"\0asm-main", src="0123456789abcdef")
        shutil.rmtree(gone)
        self.assertNotIn(gone, W.checkouts(self.wt))
        code, said = W.reuse(self.wt, RECIPE, self.stamped(self.wt))
        self.assertEqual(code, 1)
        self.assertNotIn(gone, said)

    def test_a_repository_with_no_other_checkout_has_nothing_to_take(self):
        self.git(self.main, "worktree", "remove", "--force", self.wt)
        code, said = W.reuse(self.main, RECIPE, self.stamped(self.main))
        self.assertEqual(code, 1)
        self.assertIn("no other checkout", said)
        self.assertIn("make wasm", said)

    def test_outside_git_it_says_so(self):
        loose = os.path.join(self.tmp, "loose")
        os.makedirs(loose)
        code, said = W.reuse(loose, RECIPE, [])
        self.assertEqual(code, 1)
        self.assertIn("make wasm", said)

    def test_from_names_a_checkout_and_only_that_one_is_looked_at(self):
        self.build(self.main, wasm=b"\0asm-main")
        other = self.worktree("auracle-other")
        self.build(other, wasm=b"\0asm-other", src="0123456789abcdef")
        code, said = W.reuse(self.wt, RECIPE, self.stamped(self.wt), origin=other)
        self.assertEqual(code, 1, "the main checkout matches, but --from named another")
        self.assertIn(f"{other}'s engine was built from other Rust", said)
        self.assertIn("run `make wasm` there, or here", said)
        code, said = W.reuse(self.wt, RECIPE, self.stamped(self.wt), origin=self.wt)
        self.assertEqual(code, 1)
        self.assertIn("that is this checkout", said)

    def test_an_engine_that_changes_while_it_is_copied_from_a_named_checkout_is_refused(self):
        self.build(self.main, wasm=b"\0asm-main")
        copy = shutil.copytree

        def copy_then_build_there(src, dst, *a, **k):
            out = copy(src, dst, *a, **k)
            W.begin(os.path.join(self.main, W.PKG))
            return out

        W.shutil.copytree = copy_then_build_there
        try:
            code, said = W.reuse(self.wt, RECIPE, self.stamped(self.wt), origin=self.main)
        finally:
            W.shutil.copytree = copy
        self.assertEqual(code, 1)
        self.assertIn("changed while it was copied", said)
        self.assertIn("`make pkg-reuse` again", said)
        self.assertFalse(os.path.exists(os.path.join(self.wt, W.PKG)))

    def test_an_engine_cleared_under_the_copy_is_passed_over_for_the_next(self):
        other = self.worktree("auracle-other")
        self.build(self.main, wasm=b"\0asm-main")
        self.build(other, wasm=b"\0asm-other")
        copy = shutil.copytree

        def vanishes_from_main(src, dst, *a, **k):
            if os.path.realpath(src).startswith(os.path.realpath(self.main) + os.sep):
                raise FileNotFoundError(src)  # a build there cleared its pkg/
            return copy(src, dst, *a, **k)

        W.shutil.copytree = vanishes_from_main
        try:
            code, said = W.reuse(self.wt, RECIPE, self.stamped(self.wt))
        finally:
            W.shutil.copytree = copy
        self.assertEqual(code, 0, said)
        with open(os.path.join(self.wt, W.PKG, W.WASM), "rb") as f:
            self.assertEqual(f.read(), b"\0asm-other")
        self.assertFalse(os.path.exists(os.path.join(self.wt, W.PKG) + ".reuse"))

    def test_a_repository_that_cannot_list_its_checkouts_says_so(self):
        listed = W.checkouts

        def cannot(root):
            raise RuntimeError("git worktree list: broken")

        W.checkouts = cannot
        try:
            code, said = W.reuse(self.wt, RECIPE, self.stamped(self.wt))
        finally:
            W.checkouts = listed
        self.assertEqual(code, 1)
        self.assertIn("cannot list this repository's checkouts", said)
        self.assertIn("make wasm", said)

    def test_the_command_says_what_it_took_and_what_it_owes(self):
        files = self.stamped(self.wt)
        asked = ["reuse", "--recipe", RECIPE, *files]
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            self.assertEqual(W.main(asked, root=self.wt), 1)
            self.build(self.main, wasm=b"\0asm-main")
            self.assertEqual(W.main(asked, root=self.wt), 0)
        self.assertIn("`make wasm` is owed", err.getvalue())
        self.assertIn(f"{self.main}'s release build", out.getvalue())
        self.assertIn('"profile": "release"', out.getvalue())

    def test_from_names_another_checkout(self):
        self.build(self.wt, wasm=b"\0asm-sibling")
        code, said = W.reuse(self.main, RECIPE, self.stamped(self.main), origin=self.wt)
        self.assertEqual(code, 0, said)
        with open(os.path.join(self.main, W.PKG, W.WASM), "rb") as f:
            self.assertEqual(f.read(), b"\0asm-sibling")


if __name__ == "__main__":
    unittest.main(verbosity=1)
