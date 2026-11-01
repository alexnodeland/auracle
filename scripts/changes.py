#!/usr/bin/env python3
"""What a change reaches: the one path classifier behind CI's fast lane
(ci.yml's `changes` job) and `make check-changed`, so "what does this change
reach?" has one answer.

    python3 scripts/changes.py classify < FILES
        FILES is the changed paths, one per line. Prints `key=true` or
        `key=false` for each class below, one per line; ci.yml's `changes`
        job reads them for a PR's fast lane.

    python3 scripts/changes.py check [--base BASE]
        The paths changed since the merge base with BASE (origin/main), to
        the working tree, untracked files included (as tests/web/changed.mjs
        reads them). Prints the parts of `make check` they reach on one line,
        for `make check-changed` to run, and says on stderr why, and what
        CI's fast lane runs for them beyond `make check`.

    python3 scripts/changes.py keys [--base REV] [--json]
        The key of each class of job's record (KEYS, below): a hash of the
        files that class reads in the commit checked out, and of what it
        reads of REV (HEAD^1), the commit a pull_request run's merge commit
        went onto. Prints `class=key` for each, or one JSON object; ci.yml's
        `changes` job reads them, its `ci` job names a record by one, and
        the queue's run looks one up (#581).

The classes (docs/architecture/testing.md § CI tiers, *The two lanes*):

    full    a change to CI itself: a workflow, an action, or this file. The
            fast lane runs the full gate, as the queue runs it, and
            `make check-changed` all of `make check`
    rust    anything that changes what the compiler sees or how the Rust is
            built and tested, and the files outside crates/ the crates' Rust
            reads (RUST_READS): Lint, Coverage and the Doctests
    site    the site's sources (the Rust, which it embeds as the engine and
            rustdoc; the app; www/; docs/; the Claude Code setup; an
            AGENTS.md or CLAUDE.md): Site
    web     the site's, a script's own tests (scripts/*.py), and the
            operator's scripts and the saved workflows' check (scripts/ops/):
            Web (`make web-check`, `make dev-check`)
    smoke   what the browser reads changed, other than spec files alone (a
            spec runs against main's app, and runs itself): Browser smoke
    worker  what the engine is built from (ENGINE), apps/web, or
            tests/worker, their prose aside: Worker protocol. changed.mjs
            picks no spec for worker.js, so this is the fast lane's check of
            it
    reach   what the browser reads changed at all: ci.yml then asks
            tests/web/changed.mjs which specs

A changelog entry (changelog.d/) reaches none of them: CI's `changes` job
checks the entries and the voice on every run, the site doesn't read them,
and `make check-changed` runs those two checks when nothing else reaches
dev-check.

Python 3 standard library only.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys

# A change to CI itself. This file decides what the fast lane runs, so a
# change to it runs everything, as a workflow's does.
FULL = re.compile(r"^\.github/(workflows|actions)/|^scripts/changes\.py$")
# The files outside crates/ that the crates' Rust reads: a test's
# `include_str!` or a path from CARGO_MANIFEST_DIR, and an example's
# `include_str!`, which clippy reads when Lint compiles the examples
# (--all-targets). The Rust jobs' answer depends on them as on the crates, so
# a change to one runs them, and each is in the `rust` record's key (KEYS).
# A test in scripts/test_changes.py reads the crates' sources for path
# literals that leave crates/, and fails when this list misses one or names
# one no longer read (#581). A node script beside the examples
# (live_cost.mjs) is not here: no Rust job runs it.
RUST_READS = (
    "Cargo.lock",
    "apps/web/perform-wirings.json",
    "apps/web/preset-faces.json",
    "apps/web/tests/fixtures/live-frame-face.json",
    "apps/web/tests/fixtures/sexpr-heads.json",
    "apps/web/words.js",
    "www/brand/sound.json",
)
_READS = "|".join(re.escape(f) + "$" for f in RUST_READS)
# What `make wasm` builds the engine from: the key of the web-engine action's
# cache (.github/actions/web-engine).
ENGINE = re.compile(r"^(crates/|Cargo\.(toml|lock)$|Makefile$|rust-toolchain)")
# The Makefile defines every build, so a change to it touches everything.
# So do the coverage gate's own scripts, which only the Coverage job runs on
# real numbers (their tests run in Web's dev-check), setup.sh, and nextest's
# config (.config/nextest.toml), which every Rust test run reads. Another
# script under scripts/ is no reason to run the Rust.
RUST = re.compile(
    r"^(crates/|Cargo\.(toml|lock)$|Makefile$|rust-toolchain|\.config/nextest\.toml$"
    r"|scripts/(coverage_gate|test_coverage_gate)\.py$|scripts/setup\.sh$|" + _READS + ")"
)
SITE = re.compile(r"^(www/|apps/web/|tests/web/|docs/|\.claude/)|(^|/)(AGENTS|CLAUDE)\.md$")
SCRIPT = re.compile(r"^scripts/([^/]+\.py$|ops/)")
# What the browser reads: the app, its specs and what runs them, the engine.
BROWSER = re.compile(r"^(apps/web/|tests/web/|crates/|Cargo\.(toml|lock)$|Makefile$|rust-toolchain)")
PROSE = re.compile(r"\.md$")
# What Web runs and no browser reads: the specs' lint (its config, its
# suppressions, its own tests), CI's flake routing (flakes.mjs and its tests)
# and the timings fold's tests. A change to them alone, or beside spec files,
# runs what a spec-only change runs.
WEB_ONLY = re.compile(
    r"^tests/web/(eslint\.config\.mjs|eslint-suppressions\.json|eslint\.test\.mjs|suppressions\.mjs"
    r"|flakes(\.test)?\.mjs|shard\.test\.mjs)$"
)
SPEC = re.compile(r"^tests/web/[^/]+\.spec\.js$")
WORKER = re.compile(r"^(apps/web/|tests/worker/)")

CLASSES = ("full", "rust", "site", "web", "smoke", "worker", "reach")

# ─── the records' keys (#581) ────────────────────────────────────────────────
#
# A class of job that passed leaves a record (ci.yml's `ci` job), keyed by a
# hash of the files that class reads, so a later run on byte-identical inputs
# can find it. Today that is a dry run: the queue's run logs which classes it
# would reuse and runs everything, until a wave's batches have been diffed.
#
# A key hashes the git blob id and mode of each file the class reads in the
# commit under test, and of each file it reads in the commit the change went
# onto (REV, HEAD^1: a pull_request run tests a merge commit, and its first
# parent is the main it was made on), beside the files every key holds: CI
# itself (.github/, and this file, which says what each class reads) and
# rust-toolchain.toml, which pins the compiler's release. Each class is
# (what it reads of the commit, what it reads of the commit it went onto).
EVERY_KEY = re.compile(r"^(\.github/|scripts/changes\.py$|rust-toolchain\.toml$)")
EVERYTHING = re.compile(r"")
# Lint, the Doctests and Coverage: what builds and tests the Rust, and the
# files outside crates/ it reads. Coverage's gate also reads the commit the
# change went onto: each crate's floor there, and the lines changed since.
RUST_INPUTS = re.compile(
    r"^(crates/|Cargo\.(toml|lock)$|Makefile$|rust-toolchain|\.config/nextest\.toml$"
    r"|scripts/coverage_gate\.py$|" + _READS + ")"
)
# The whole browser tier: the app, its specs and what runs them, the engine
# (ENGINE) and node's version. A fast lane's few specs leave no record.
BROWSER_INPUTS = re.compile(r"^(apps/web/|tests/web/|crates/|Cargo\.(toml|lock)$|Makefile$|rust-toolchain|\.node-version$)")
# Worker protocol: worker.js and what it loads, its tests, the engine, node.
WORKER_INPUTS = re.compile(r"^(apps/web/|tests/worker/|crates/|Cargo\.(toml|lock)$|Makefile$|rust-toolchain|\.node-version$)")
# Web's `make web-check` and `make dev-check` read most of the tree, and its
# specs' lint the suppressions file, and the files, of the commit the change
# went onto (tests/web/suppressions.mjs, given HEAD^1).
SPEC_LINT_BASE = re.compile(r"^tests/web/")
KEYS = {
    "rust": (RUST_INPUTS, RUST_INPUTS),
    "browser": (BROWSER_INPUTS, None),
    "worker": (WORKER_INPUTS, None),
    "web": (EVERYTHING, SPEC_LINT_BASE),
    # The site is built from the tree alone.
    "site": (EVERYTHING, None),
    # Every class at once: the full gate's record.
    "tree": (EVERYTHING, re.compile(RUST_INPUTS.pattern + "|" + SPEC_LINT_BASE.pattern)),
}

# `make check`'s parts, in its order, and the class that reaches each.
CHECK = (
    ("fmt-check", "rust"),
    ("lint", "rust"),
    ("web-check", "web"),
    ("dev-check", "web"),
    ("wasm-check", "rust"),
    ("test", "rust"),
)
# What CI's `changes` job runs on every PR, the voice and the changelog's
# entries: dev-check's parts for those, when nothing reaches dev-check.
EVERY_RUN = ("dev-voice", "dev-changelog")
# The jobs of the fast lane `make check` does not run, and the command that
# runs each locally.
BEYOND = (
    ("site", "Site", "make site && make site-check"),
    ("worker", "Worker protocol", "make worker-test, after make wasm"),
    ("smoke", "Browser smoke", "make smoke"),
    ("reach", "the specs it reaches, and Burn-in for the ones it adds or edits", "make browser-changed REPEAT=3"),
)


def classify(files: list[str]) -> dict[str, bool]:
    """Each class, for the changed paths `files`."""
    files = [f for f in files if f]
    if any(FULL.search(f) for f in files):
        return {"full": True, "rust": True, "site": True, "web": True, "smoke": False, "worker": True, "reach": True}
    rust = any(RUST.search(f) for f in files)
    site = rust or any(SITE.search(f) for f in files)
    web = site or any(SCRIPT.search(f) for f in files)
    reach = [f for f in files if BROWSER.search(f) and not PROSE.search(f) and not WEB_ONLY.search(f)]
    # Spec files alone run against main's app, and run themselves.
    smoke = any(not SPEC.search(f) for f in reach)
    # The engine the tests run, not the Rust's tests: a file only a Rust test
    # reads (www/brand/sound.json) or the coverage gate is nothing to it.
    worker = any(ENGINE.search(f) for f in files) or any(WORKER.search(f) and not PROSE.search(f) for f in files)
    return {"full": False, "rust": rust, "site": site, "web": web, "smoke": smoke, "worker": worker, "reach": bool(reach)}


def check_parts(c: dict[str, bool]) -> list[str]:
    """The `make` targets `make check-changed` runs for the classes `c`:
    the parts of `make check` they reach, in its order (all of it for a
    change to CI itself); when none of them is dev-check, the two checks
    CI's `changes` job runs on every PR beside them."""
    parts = [part for part, cls in CHECK if c["full"] or c[cls]]
    return parts if "dev-check" in parts else [*parts, *EVERY_RUN]


def beyond(c: dict[str, bool]) -> list[str]:
    """The fast lane's jobs beyond `make check` the classes reach, each with
    its local command."""
    if c["full"]:
        return [f"{name} ({cmd})" for _, name, cmd in BEYOND[:2]] + ["the whole browser tier (make browser-fast)"]
    return [f"{name} ({cmd})" for cls, name, cmd in BEYOND if c[cls]]


# Which config files git reads, kept when the GIT_* variables are dropped
# (as coverage_gate.py's own_env keeps them): they name no repository. A
# caller that says "no global config" is heard: this file's tests say it for
# their throwaway repositories, so a user's core.fsmonitor starts no daemon in
# each, to outlive it and hold up a later git there.
CONFIG_VARS = ("GIT_CONFIG_GLOBAL", "GIT_CONFIG_NOSYSTEM", "GIT_CONFIG_SYSTEM")


def git(cwd: str | None, *args: str) -> str:
    """`git args` in `cwd`, on that directory's repository whatever GIT_*
    says: a git hook (pre-commit runs `make dev-check`) sets GIT_DIR and
    GIT_INDEX_FILE, which would point git at another one. Which config files
    to read (CONFIG_VARS) is kept. Without the file-system monitor, as
    wasm_pkg.py's git: on a loaded machine its daemon fell behind and git
    called an edited file unchanged, and a file left out here is a part of
    `make check` left out."""
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_") or k in CONFIG_VARS}
    cmd = ["git", "-c", "core.fsmonitor=false", *args]
    return subprocess.run(cmd, cwd=cwd, env=env, check=True, capture_output=True, text=True).stdout


def changed_files(base: str, cwd: str | None = None) -> tuple[str, list[str]]:
    """The merge base with `base`, and the paths changed since it: to the
    working tree, and untracked files (as tests/web/changed.mjs reads them)."""
    merge_base = git(cwd, "merge-base", base, "HEAD").strip()
    committed = git(cwd, "diff", "--name-only", merge_base).splitlines()
    untracked = git(cwd, "ls-files", "--others", "--exclude-standard").splitlines()
    return merge_base, sorted(set(committed) | set(untracked))


def ls_tree(rev: str, cwd: str | None = None) -> list[tuple[str, str]]:
    """Every file in `rev`, as (path, "mode type blob")."""
    out = []
    for rec in git(cwd, "ls-tree", "-r", "-z", "--full-tree", rev).split("\0"):
        if rec:
            meta, path = rec.split("\t", 1)
            out.append((path, meta))
    return out


def keys(base: str = "HEAD^1", cwd: str | None = None) -> dict[str, str]:
    """Each class's record key for the commit checked out (HEAD), the
    change having gone onto `base`: 32 hex digits of a SHA-256."""
    head = ls_tree("HEAD", cwd)
    then = ls_tree(base, cwd)
    every = [f"{meta}\t{path}\n" for path, meta in head if EVERY_KEY.search(path)]
    out = {}
    for name, (now, before) in KEYS.items():
        h = hashlib.sha256(f"{name}\n".encode())
        for line in every:
            h.update(line.encode())
        h.update(b"head\n")
        for path, meta in head:
            if now.search(path):
                h.update(f"{meta}\t{path}\n".encode())
        h.update(b"base\n")
        for path, meta in then if before else ():
            if before.search(path):
                h.update(f"{meta}\t{path}\n".encode())
        out[name] = h.hexdigest()[:32]
    return out


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("classify", help="read changed paths on stdin, print key=true|false")
    ck = sub.add_parser("check", help="print the parts of `make check` the local change reaches")
    ck.add_argument("--base", default="origin/main")
    ks = sub.add_parser("keys", help="print each class's record key for HEAD")
    ks.add_argument("--base", default="HEAD^1", help="the commit the change went onto (HEAD^1)")
    ks.add_argument("--json", action="store_true", help="one JSON object rather than class=key lines")
    args = ap.parse_args(argv)

    if args.cmd == "classify":
        c = classify(sys.stdin.read().splitlines())
        for k in CLASSES:
            print(f"{k}={'true' if c[k] else 'false'}")
        return 0

    if args.cmd == "keys":
        try:
            k = keys(args.base)
        except subprocess.CalledProcessError as e:
            print(f"  cannot read HEAD and {args.base}: {(e.stderr or '').strip() or e}", file=sys.stderr)
            return 1
        print(json.dumps(k, sort_keys=True) if args.json else "\n".join(f"{c}={v}" for c, v in k.items()))
        return 0

    def say(line: str) -> None:
        print(f"  {line}", file=sys.stderr)

    try:
        merge_base, files = changed_files(args.base)
    except subprocess.CalledProcessError as e:
        say(f"cannot diff against {args.base}: {(e.stderr or '').strip() or e}")
        say("run `git fetch origin` first, or name another BASE=")
        return 1
    since = f"since {args.base} (merge base {merge_base[:12]})"
    if not files:
        say(f"nothing changed {since}: nothing to check")
        return 0
    c = classify(files)
    parts = check_parts(c)
    if c["full"]:
        reached = "CI itself, so everything"
    else:
        reached = " ".join(k for k in CLASSES if c[k] and k != "reach") or "no job of their own"
    say(f"{len(files)} files changed {since}; they reach: {reached}")
    say(f"make check's parts: {' '.join(parts)}")
    more = beyond(c)
    if more:
        say(f"CI's fast lane also runs: {'; '.join(more)}")
    print(" ".join(parts))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
