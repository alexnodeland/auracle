#!/usr/bin/env python3
"""The web engine's package script's tests: the stamp, the release check, the
engine inputs' hash, and taking another checkout's build.

    python3 scripts/test_wasm_pkg.py      (run by `make dev-check`)

Nothing here builds an engine or reads the real apps/web/pkg. The cases make
a throwaway git repository with a crate and an app script in it, a worktree
of it beside it, and a pkg/ of a few bytes in each. Python 3 standard library
only.
"""

import hashlib
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


class Check(Checkouts):
    def test_no_engine_says_to_build_one(self):
        self.assertIn("make wasm", W.refusal(os.path.join(self.main, W.PKG)))

    def test_a_dev_build_is_refused_naming_make_wasm(self):
        self.build(self.main, profile="dev")
        why = W.refusal(os.path.join(self.main, W.PKG))
        self.assertIn("dev build", why)
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

    def test_the_main_checkout_has_no_other_to_take(self):
        self.build(self.main)
        code, said = W.reuse(self.main, RECIPE, self.stamped(self.main))
        self.assertEqual(code, 1)
        self.assertIn("this is the main checkout", said)

    def test_from_names_another_checkout(self):
        self.build(self.wt, wasm=b"\0asm-sibling")
        code, said = W.reuse(self.main, RECIPE, self.stamped(self.main), origin=self.wt)
        self.assertEqual(code, 0, said)
        with open(os.path.join(self.main, W.PKG, W.WASM), "rb") as f:
            self.assertEqual(f.read(), b"\0asm-sibling")


if __name__ == "__main__":
    unittest.main(verbosity=1)
