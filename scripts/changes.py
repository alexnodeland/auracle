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

The classes (docs/architecture/testing.md § CI tiers, *The two lanes*):

    full    a change to CI itself: a workflow, an action, or this file. The
            fast lane runs the full gate, as the queue runs it, and
            `make check-changed` all of `make check`
    rust    anything that changes what the compiler sees or how the Rust is
            built and tested: Lint, Coverage and the Doctests
    site    the site's sources (the Rust, which it embeds as the engine and
            rustdoc; the app; www/; docs/; the Claude Code setup; an
            AGENTS.md or CLAUDE.md): Site
    web     the site's, a script's own tests (scripts/*.py), and the
            operator's scripts and the saved workflows' check (scripts/ops/):
            Web (`make web-check`, `make dev-check`)
    smoke   what the browser reads changed, other than spec files alone (a
            spec runs against main's app, and runs itself): Browser smoke
    worker  the engine, apps/web, or tests/worker, their prose aside: Worker
            protocol. changed.mjs picks no spec for worker.js, so this is
            the fast lane's check of it
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
import os
import re
import subprocess
import sys

# A change to CI itself. This file decides what the fast lane runs, so a
# change to it runs everything, as a workflow's does.
FULL = re.compile(r"^\.github/(workflows|actions)/|^scripts/changes\.py$")
# The Makefile defines every build, so a change to it touches everything.
# So do the coverage gate's own scripts, which only the Coverage jobs run on
# real numbers (their tests run in Web's dev-check), setup.sh, and nextest's
# config (.config/nextest.toml), which every Rust test run reads. Another
# script under scripts/ is no reason to run the Rust.
RUST = re.compile(
    r"^(crates/|Cargo\.(toml|lock)$|Makefile$|rust-toolchain|\.config/nextest\.toml$"
    r"|scripts/(coverage_gate|test_coverage_gate)\.py$|scripts/setup\.sh$)"
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
    ("reach", "the specs it reaches", "make browser-changed"),
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
    worker = rust or any(WORKER.search(f) and not PROSE.search(f) for f in files)
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


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("classify", help="read changed paths on stdin, print key=true|false")
    ck = sub.add_parser("check", help="print the parts of `make check` the local change reaches")
    ck.add_argument("--base", default="origin/main")
    args = ap.parse_args(argv)

    if args.cmd == "classify":
        c = classify(sys.stdin.read().splitlines())
        for k in CLASSES:
            print(f"{k}={'true' if c[k] else 'false'}")
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
