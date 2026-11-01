#!/usr/bin/env python3
"""The path classifier's tests: what each kind of change reaches in CI's
fast lane, the parts of `make check` it runs locally, and which files count
as changed.

    python3 scripts/test_changes.py      (run by `make dev-check`)

The cases are the rows of docs/architecture/testing.md § CI tiers, *The two
lanes*. The last two classes read throwaway git repositories, with no
system or global config. Python 3 standard library only.
"""

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import changes as C  # noqa: E402


def reached(*files):
    """The classes `files` reach, as a set of names."""
    return {k for k, v in C.classify(list(files)).items() if v}


_NO_USER_CONFIG = mock.patch.dict(os.environ, {"GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull})


def setUpModule():
    """The script's git reads no system or global config in the throwaway
    repositories (as scripts/test_coverage_gate.py's): a global
    core.fsmonitor would start a daemon in each, which outlives the test and
    can hold up a later git there, and a global hooks path would run the
    user's hooks on the tests' commits."""
    _NO_USER_CONFIG.start()


def tearDownModule():
    _NO_USER_CONFIG.stop()


ALL_BUT_SMOKE = {"full", "rust", "site", "web", "worker", "reach"}
EVERYTHING = ["fmt-check", "lint", "web-check", "dev-check", "wasm-check", "test"]


class Lanes(unittest.TestCase):
    """Each row of the two lanes' table: what a PR's own run runs."""

    def test_docs_the_site_and_the_agent_docs_reach_web_and_the_site(self):
        for f in ("docs/process.md", "www/docs/src/play.md", ".claude/skills/check/SKILL.md", "AGENTS.md", "www/video/CLAUDE.md"):
            with self.subTest(f=f):
                self.assertEqual(reached(f), {"site", "web"})

    def test_prose_beside_the_code_runs_no_browser_and_no_rust(self):
        # An AGENTS.md under apps/web or a crate is the site's, and nothing
        # the browser or the compiler reads.
        self.assertEqual(reached("apps/web/AGENTS.md"), {"site", "web"})
        self.assertEqual(reached("tests/worker/README.md"), set())

    def test_spec_files_alone_run_themselves_with_no_smoke(self):
        self.assertEqual(reached("tests/web/patch_cables.spec.js", "tests/web/taste_view.spec.js"), {"site", "web", "reach"})

    def test_the_specs_lint_reaches_no_browser_and_beside_a_spec_runs_that_spec(self):
        lint = ("tests/web/eslint.config.mjs", "tests/web/eslint-suppressions.json", "tests/web/eslint.test.mjs", "tests/web/suppressions.mjs")
        self.assertEqual(reached(*lint), {"site", "web"})
        self.assertEqual(reached(*lint, "tests/web/patch_cables.spec.js"), {"site", "web", "reach"})

    def test_cis_flake_routing_and_the_timings_tests_reach_no_browser_and_beside_a_spec_run_that_spec(self):
        # Web runs them and no browser reads them. shard.mjs itself deals the
        # browser runners, so it is what runs the specs, and reaches the smoke.
        routing = ("tests/web/flakes.mjs", "tests/web/flakes.test.mjs", "tests/web/shard.test.mjs")
        for f in routing:
            with self.subTest(f=f):
                self.assertEqual(reached(f), {"site", "web"})
        self.assertEqual(reached(*routing, "tests/web/patch_cables.spec.js"), {"site", "web", "reach"})
        self.assertEqual(reached("tests/web/shard.mjs"), {"site", "web", "smoke", "reach"})

    def test_an_app_script_reaches_the_smoke_and_the_worker(self):
        for f in ("apps/web/main.js", "apps/web/worker.js", "apps/web/index.html", "apps/web/style.css", "apps/web/patch.js"):
            with self.subTest(f=f):
                self.assertEqual(reached(f), {"site", "web", "smoke", "worker", "reach"})

    def test_a_test_helper_reaches_the_smoke_and_not_the_worker(self):
        for f in ("tests/web/fixtures.js", "tests/web/playwright.config.js", "tests/web/package-lock.json"):
            with self.subTest(f=f):
                self.assertEqual(reached(f), {"site", "web", "smoke", "reach"})

    def test_what_builds_the_rust_reaches_everything_but_ci_itself(self):
        for f in ("crates/auracle-grammar/src/lib.rs", "Cargo.toml", "Cargo.lock", "rust-toolchain.toml", "Makefile"):
            with self.subTest(f=f):
                self.assertEqual(reached(f), {"rust", "site", "web", "smoke", "worker", "reach"})

    def test_the_rust_tests_tooling_reaches_the_rust_and_no_browser_and_no_engine(self):
        # None of them is what the engine is built from, so Worker protocol,
        # which runs the engine, has nothing to try.
        for f in ("scripts/coverage_gate.py", "scripts/test_coverage_gate.py", "scripts/setup.sh", ".config/nextest.toml"):
            with self.subTest(f=f):
                self.assertEqual(reached(f), {"rust", "site", "web"})

    def test_a_file_the_rust_reads_outside_crates_reaches_the_rust_beside_its_own_place(self):
        # The app's files the Rust tests read reach what an app file does, and
        # the Rust too; the films' sound.json, the site and the Rust.
        for f in ("apps/web/words.js", "apps/web/perform-wirings.json", "apps/web/preset-faces.json", "apps/web/tests/fixtures/sexpr-heads.json"):
            with self.subTest(f=f):
                self.assertEqual(reached(f), {"rust", "site", "web", "smoke", "worker", "reach"})
        self.assertEqual(reached("www/brand/sound.json"), {"rust", "site", "web"})
        # Its neighbours are not read by the Rust.
        self.assertEqual(reached("apps/web/tests/faces.test.mjs"), {"site", "web", "smoke", "worker", "reach"})
        self.assertEqual(reached("www/brand/tokens.json"), {"site", "web"})

    def test_the_worker_protocol_tests_reach_only_themselves(self):
        self.assertEqual(reached("tests/worker/harness.mjs"), {"worker"})

    def test_another_script_reaches_web_only(self):
        for f in ("scripts/changelog.py", "scripts/test_pr_checks.py", "scripts/test_changes.py", "scripts/ops/ship_pr.sh", "scripts/ops/workflows.test.mjs"):
            with self.subTest(f=f):
                self.assertEqual(reached(f), {"web"})

    def test_a_changelog_entry_reaches_nothing(self):
        self.assertEqual(reached("changelog.d/local-loop.md"), set())

    def test_a_change_to_ci_itself_runs_the_full_gate(self):
        for f in (".github/workflows/ci.yml", ".github/actions/playwright/action.yml", "scripts/changes.py"):
            with self.subTest(f=f):
                self.assertEqual(reached(f, "changelog.d/x.md"), ALL_BUT_SMOKE)

    def test_classes_add_up_across_files(self):
        self.assertEqual(reached("tests/worker/harness.mjs", "scripts/changelog.py"), {"worker", "web"})
        self.assertEqual(reached("tests/web/a.spec.js", "apps/web/farm.js"), {"site", "web", "smoke", "worker", "reach"})

    def test_classify_prints_every_class_for_ci(self):
        out = subprocess.run(
            [sys.executable, os.path.join(HERE, "changes.py"), "classify"],
            input="tests/worker/harness.mjs\n\nchangelog.d/x.md\n",
            capture_output=True,
            text=True,
            check=True,
        ).stdout
        self.assertEqual(
            out.splitlines(),
            ["full=false", "rust=false", "site=false", "web=false", "smoke=false", "worker=true", "reach=false"],
        )


# A string literal in Rust, escapes included.
LITERAL = re.compile(r'"((?:[^"\\]|\\.)*)"')


def rust_reads_outside_crates():
    """Each file outside crates/ that a path literal in the crates' Rust
    names (a `../` path, from the file's directory as `include_str!` reads
    it, or from its crate's as CARGO_MANIFEST_DIR builds it), and each such
    literal that names nothing there."""
    found, unresolved = set(), []
    crates = os.path.join(ROOT, "crates")
    for dirpath, dirs, files in os.walk(crates):
        dirs[:] = [d for d in dirs if d != "target"]
        for name in sorted(f for f in files if f.endswith(".rs")):
            path = os.path.join(dirpath, name)
            rel = os.path.relpath(path, ROOT)
            crate = os.path.join(ROOT, *rel.split(os.sep)[:2])
            with open(path, encoding="utf-8") as f:
                for n, line in enumerate(f, 1):
                    if line.lstrip().startswith("//"):
                        continue
                    for lit in LITERAL.findall(line):
                        if "../" not in lit:
                            continue
                        tail = lit[lit.index("../") :]
                        hits = [os.path.normpath(os.path.join(d, tail)) for d in (dirpath, crate)]
                        hits = [h for h in hits if os.path.exists(h)]
                        if not hits:
                            unresolved.append(f"{rel}:{n}: {lit}")
                        for h in hits:
                            if os.path.commonpath([h, crates]) != crates:
                                found.add(os.path.relpath(h, ROOT).replace(os.sep, "/"))
    return found, unresolved


class RustReads(unittest.TestCase):
    """The files outside crates/ the crates' Rust reads are the Rust's to
    run on and are in its record's key (#581), read from the sources."""

    def test_the_list_is_what_the_crates_read_outside_crates(self):
        found, unresolved = rust_reads_outside_crates()
        self.assertEqual(unresolved, [], "a path literal in the crates names no file: fix it, or teach this scan where it points")
        self.assertEqual(
            sorted(found - set(C.RUST_READS)), [], "the crates read these outside crates/: add them to RUST_READS in scripts/changes.py"
        )
        self.assertEqual(sorted(set(C.RUST_READS) - found), [], "no crate reads these any more: take them out of RUST_READS")

    def test_each_reaches_the_rust_and_is_in_its_key(self):
        for f in C.RUST_READS:
            with self.subTest(f=f):
                self.assertTrue(C.classify([f])["rust"])
                self.assertTrue(C.RUST_INPUTS.search(f))


class CheckParts(unittest.TestCase):
    """`make check-changed`: the parts of `make check` a change reaches."""

    def parts(self, *files):
        return C.check_parts(C.classify(list(files)))

    def test_rust_or_ci_runs_all_of_make_check_in_its_order(self):
        self.assertEqual(self.parts("crates/auracle-taste/src/model.rs"), EVERYTHING)
        self.assertEqual(self.parts(".github/workflows/ci.yml"), EVERYTHING)

    def test_the_app_the_docs_and_the_scripts_run_web_check_and_dev_check(self):
        for f in ("apps/web/main.js", "docs/process.md", "scripts/changelog.py", "tests/web/a.spec.js"):
            with self.subTest(f=f):
                self.assertEqual(self.parts(f), ["web-check", "dev-check"])

    def test_with_no_dev_check_the_voice_and_the_changelog_run_as_on_every_pr(self):
        self.assertEqual(self.parts("changelog.d/x.md"), ["dev-voice", "dev-changelog"])
        self.assertEqual(self.parts("tests/worker/harness.mjs"), ["dev-voice", "dev-changelog"])

    def test_the_jobs_beyond_make_check_are_named_with_their_commands(self):
        self.assertEqual(C.beyond(C.classify(["tests/worker/harness.mjs"])), ["Worker protocol (make worker-test, after make wasm)"])
        self.assertEqual(
            C.beyond(C.classify(["tests/web/a.spec.js"])),
            ["Site (make site && make site-check)", "the specs it reaches, and Burn-in for the ones it adds or edits (make browser-changed REPEAT=3)"],
        )
        self.assertEqual(C.beyond(C.classify(["docs/process.md"])), ["Site (make site && make site-check)"])
        self.assertEqual(C.beyond(C.classify(["changelog.d/x.md"])), [])


class ChangedFiles(unittest.TestCase):
    """What counts as changed: committed since the merge base, uncommitted,
    and untracked, as tests/web/changed.mjs reads them; not main's own
    commits since the branch left it."""

    def setUp(self):
        self.repo = tempfile.mkdtemp()
        self.git("init", "-q", "-b", "main")
        self.write("README.md", "a\n")
        self.write("docs/a.md", "a\n")
        self.commit("base")

    def tearDown(self):
        shutil.rmtree(self.repo)

    def git(self, *args):
        return C.git(self.repo, "-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", *args)

    def write(self, path, text):
        full = os.path.join(self.repo, path)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w") as f:
            f.write(text)

    def commit(self, msg):
        self.git("add", "-A")
        self.git("commit", "-q", "-m", msg)

    def test_committed_uncommitted_and_untracked_count_and_mains_own_do_not(self):
        self.git("checkout", "-q", "-b", "topic")
        self.write("crates/x/src/lib.rs", "fn a() {}\n")
        self.commit("topic")
        self.git("checkout", "-q", "main")
        self.write("apps/web/main.js", "main moved on\n")
        self.commit("main")
        self.git("checkout", "-q", "topic")
        self.write("docs/a.md", "b\n")  # uncommitted
        self.write("scripts/new.py", "x = 1\n")  # untracked
        base, files = C.changed_files("main", self.repo)
        self.assertEqual(base, self.git("merge-base", "main", "HEAD").strip())
        self.assertEqual(files, ["crates/x/src/lib.rs", "docs/a.md", "scripts/new.py"])

    def test_nothing_changed_is_no_file(self):
        self.assertEqual(C.changed_files("main", self.repo)[1], [])


class Keys(unittest.TestCase):
    """The records' keys (#581): the same files give the same key, and a
    change to what a class reads, and only that, gives it a new one."""

    FILES = {
        ".github/workflows/ci.yml": "jobs\n",
        "scripts/changes.py": "classes\n",
        "rust-toolchain.toml": 'channel = "1.99.0"\n',
        "crates/x/src/lib.rs": "fn a() {}\n",
        "Cargo.lock": "lock\n",
        "apps/web/main.js": "main\n",
        "apps/web/words.js": "words\n",
        "tests/web/a.spec.js": "spec\n",
        "tests/web/eslint-suppressions.json": "{}\n",
        "tests/worker/a.test.mjs": "worker\n",
        "www/brand/sound.json": "{}\n",
        "docs/a.md": "a\n",
        ".node-version": "22\n",
    }

    def setUp(self):
        self.repo = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.repo)
        self.git("init", "-q", "-b", "main")
        for path, text in self.FILES.items():
            self.write(path, text)
        self.commit("base")
        self.base = self.keys()

    def git(self, *args):
        return C.git(self.repo, "-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", *args)

    def write(self, path, text):
        full = os.path.join(self.repo, path)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w") as f:
            f.write(text)

    def commit(self, msg, *flags):
        self.git("add", "-A")
        self.git("commit", "-q", *flags, "-m", msg)

    def keys(self):
        return C.keys("HEAD^1", self.repo) if self.git("rev-list", "--count", "HEAD").strip() != "1" else C.keys("HEAD", self.repo)

    def changed(self, path, text="changed\n"):
        """The classes whose key a commit changing `path` moves, against
        the same files committed again unchanged."""
        self.commit("same", "--allow-empty")
        same = self.keys()
        self.write(path, text)
        self.commit("change")
        new = self.keys()
        self.git("reset", "-q", "--hard", "HEAD~2")
        return {k for k in new if new[k] != same[k]}

    def test_a_key_is_32_hex_digits_for_every_class(self):
        self.assertEqual(sorted(self.base), sorted(C.KEYS))
        for k in self.base.values():
            self.assertRegex(k, r"^[0-9a-f]{32}$")

    def test_the_same_files_give_the_same_keys_on_other_commits(self):
        # The first commit's keys took it as its own base; these are two
        # other commits of the same files, each on one of the same files.
        self.commit("again", "--allow-empty")
        self.assertEqual(self.keys(), self.base)
        self.commit("and again", "--allow-empty")
        self.assertEqual(self.keys(), self.base)

    def test_each_change_moves_the_keys_of_the_classes_that_read_it(self):
        everything = {"rust", "browser", "worker", "web", "site", "tree"}
        cases = {
            "docs/a.md": {"web", "site", "tree"},
            "crates/x/src/lib.rs": everything,
            "apps/web/main.js": {"browser", "worker", "web", "site", "tree"},
            "apps/web/words.js": everything,
            "www/brand/sound.json": {"rust", "web", "site", "tree"},
            "tests/web/a.spec.js": {"browser", "web", "site", "tree"},
            "tests/worker/a.test.mjs": {"worker", "web", "site", "tree"},
            ".node-version": {"browser", "worker", "web", "site", "tree"},
            ".github/workflows/ci.yml": everything,
            "scripts/changes.py": everything,
            "rust-toolchain.toml": everything,
        }
        for path, classes in cases.items():
            with self.subTest(path=path):
                self.assertEqual(self.changed(path), classes)

    def test_the_rust_and_the_specs_lint_read_the_commit_the_change_went_onto(self):
        # The same files on two different mains: Coverage's gate reads the
        # floors and the changed lines against the main, and the specs' lint
        # its suppressions, so their keys tell the two apart; the rest read
        # the files alone.
        start = self.git("rev-parse", "HEAD").strip()
        self.write("crates/x/src/lib.rs", "fn b() {}\n")
        self.commit("the change, on the old main")
        on_old = C.keys("HEAD^1", self.repo)
        self.git("checkout", "-q", start)
        self.write("crates/x/src/lib.rs", "fn b() {}\n")
        self.commit("main already had it")
        self.commit("the change, on the new main", "--allow-empty")
        on_new = C.keys("HEAD^1", self.repo)
        self.assertEqual({k for k in on_new if on_new[k] != on_old[k]}, {"rust", "tree"})
        self.write("tests/web/eslint-suppressions.json", '{"a.spec.js": {}}\n')
        self.commit("main moved the suppressions")
        self.git("checkout", "-q", "HEAD^1", "--", "tests/web/eslint-suppressions.json")
        self.commit("the change puts them back")
        moved = C.keys("HEAD^1", self.repo)
        self.assertEqual({k for k in moved if moved[k] != on_new[k]}, {"web", "tree"})

    def test_keys_prints_each_class_or_one_json_object(self):
        run = [sys.executable, os.path.join(HERE, "changes.py"), "keys", "--base", "HEAD"]
        lines = subprocess.run(run, cwd=self.repo, capture_output=True, text=True, check=True).stdout.splitlines()
        self.assertEqual(lines, [f"{c}={k}" for c, k in self.base.items()])
        as_json = subprocess.run([*run, "--json"], cwd=self.repo, capture_output=True, text=True, check=True).stdout
        self.assertEqual(json.loads(as_json), self.base)

    def test_a_base_it_cannot_read_is_an_error(self):
        run = [sys.executable, os.path.join(HERE, "changes.py"), "keys", "--base", "HEAD^1"]
        p = subprocess.run(run, cwd=self.repo, capture_output=True, text=True)
        self.assertEqual(p.returncode, 1)
        self.assertIn("cannot read HEAD and HEAD^1", p.stderr)
        self.assertEqual(p.stdout, "")


class GitEnv(unittest.TestCase):
    """What the script's git is given of the caller's environment: never a
    variable that names a repository, always which config files to read."""

    def test_which_config_to_read_reaches_git_and_no_repository_does(self):
        repo = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, repo)
        cfg = os.path.join(repo, "global.gitconfig")
        with open(cfg, "w") as f:
            f.write("[user]\n\tname = global-sentinel\n")
        C.git(repo, "init", "-q", "-b", "main")
        hook = {"GIT_CONFIG_GLOBAL": cfg, "GIT_DIR": "/nonexistent/.git", "GIT_INDEX_FILE": "/nonexistent/index"}
        with mock.patch.dict(os.environ, hook):
            name = C.git(repo, "config", "user.name").strip()
            top = C.git(repo, "rev-parse", "--show-toplevel").strip()
        self.assertEqual(name, "global-sentinel")
        self.assertEqual(os.path.realpath(top), os.path.realpath(repo))


if __name__ == "__main__":
    unittest.main(verbosity=1)
