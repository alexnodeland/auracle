#!/usr/bin/env python3
"""The web engine's package (apps/web/pkg): its build stamp, which build it
is, and taking another checkout's instead of building the same one again.

    python3 scripts/wasm_pkg.py source --recipe CMD
        print the hash of the engine's inputs here: the Rust the build reads
        and the command that builds it
    python3 scripts/wasm_pkg.py begin
        mark pkg/ unfinished, before a build writes into it (`make wasm`,
        `make wasm-dev`)
    python3 scripts/wasm_pkg.py stamp [--profile P] [--source H [--recipe CMD]] FILE...
        write pkg/build.json over FILE... (`make wasm`, `make wasm-dev`,
        `make wasm-stamp`); with --recipe, H is kept only if the inputs
        still hash to it, the build done
    python3 scripts/wasm_pkg.py check
        exit 1, saying what to run, unless pkg/ holds a release build (the
        `make browser-*` targets and `make smoke`)
    python3 scripts/wasm_pkg.py reuse --recipe CMD [--from DIR] FILE...
        copy a release build of this checkout's Rust into its pkg/ and stamp
        it over FILE... (`make pkg-reuse`, which `make worktree` runs): the
        first, in the order below, of the repository's other checkouts whose
        build was made from this checkout's Rust and this command; or DIR's,
        when it was. Files are copied, never linked, so a build there later
        can't change this one

pkg/build.json holds three things:
- `build`: the first 16 hex digits of a SHA-256 over the engine and every
  app script. main.js puts it on the worker's, the modules' and the wasm's
  URLs, so the same bytes keep their URL and a browser refetches exactly
  what changed (apps/web/AGENTS.md).
- `profile`: `release` (`make wasm`: fat LTO, one codegen unit, wasm-opt),
  the build CI, the browser specs, rehearsals and recordings run on; `dev`
  (`make wasm-dev`), for trying an engine edit in the browser in seconds,
  which they refuse; or `unfinished`, from the moment a build starts until
  it is stamped, which they refuse too. A stamp with none is a release
  build, from before the field.
- `source`: the hash of what the build was made from (`source`, above), so
  another checkout can tell whether this build is the one it would make.

Why `unfinished`: wasm-pack writes the new engine into pkg/ before it runs
wasm-opt, and leaves build.json alone. A build that fails at wasm-opt (its
download, docs/runbooks/wasm-opt-download.md) or is stopped there would
leave a new, unoptimized engine under the last build's stamp: release, and
built from other Rust, which the specs would run and another checkout would
take. Marked before the build starts, pkg/ says what it holds whatever
happens next, until `make wasm` finishes.

Which checkout `reuse` takes: every checkout git lists (`git worktree list`)
but this one, the main checkout first and then the others, the most recently
built first. A checkout is passed over, with the reason kept for the
refusal, when it has no engine, a dev or unfinished build, a stamp that says
nothing of its source, or a source that isn't this one's; so a worktree
whose Rust is the same as another's, any other's, takes that one's build.

Re-stamping (after a JS-only change, or CI's cached engine against a new
commit's app scripts) keeps the profile and the source: the engine is the
same, only the scripts beside it changed.

Python 3 standard library only.
"""

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PKG = os.path.join("apps", "web", "pkg")
WASM = "auracle_wasm_bg.wasm"
# What `make wasm` reads, as CI's engine cache keys it (.github/actions/
# web-engine), but for the Makefile and prose: of the Makefile only the
# build's command counts (`--recipe`), and no crate compiles a `.md` file in
# (an AGENTS.md is for its readers), so neither a Makefile change elsewhere
# nor a doc makes two checkouts' engines differ.
INPUTS = ("crates", "Cargo.toml", "Cargo.lock", "rust-toolchain.toml", ".cargo/config.toml")
PROSE = ".md"
RELEASE, DEV, UNFINISHED = "release", "dev", "unfinished"
# How many checkouts a refusal says why it passed over (a repository with a
# dozen worktrees would fill the screen).
SHOWN = 5
# What a profile is, for a refusal.
WHAT = {
    DEV: "a dev build (`make wasm-dev`)",
    UNFINISHED: "an unfinished build (a `make wasm` or `make wasm-dev` that failed or was stopped, or is running)",
}


def own_env():
    """The environment without git's own variables. A git hook runs with
    GIT_DIR and GIT_INDEX_FILE set to the repository being committed, and a
    git command given them works on that repository wherever it runs."""
    return {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}


def git(args, root):
    """git in the checkout at `root`, without the file-system monitor: on a
    loaded machine its daemon fell behind and git called an edited file
    unchanged, and a file it doesn't list is left out of `source`."""
    r = subprocess.run(["git", "-C", root, "-c", "core.fsmonitor=false", *args], capture_output=True, text=True, env=own_env())
    if r.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)}: {r.stderr.strip()}")
    return r.stdout


def source(root, recipe):
    """The hash of the engine's inputs in the checkout at `root`, as its
    working tree has them (an uncommitted edit counts, an ignored file or a
    doc doesn't), and of the command that builds it. None outside git."""
    try:
        listed = git(["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", *INPUTS], root)
    except (RuntimeError, OSError):
        return None
    h = hashlib.sha256(recipe.encode() + b"\0")
    for rel in sorted(set(p for p in listed.split("\0") if p and not p.endswith(PROSE))):
        try:
            with open(os.path.join(root, rel), "rb") as f:
                body = hashlib.sha256(f.read()).digest()
        except FileNotFoundError:
            body = b"deleted"
        h.update(rel.encode() + b"\0" + body)
    return h.hexdigest()[:16]


def read_stamp(pkg):
    try:
        with open(os.path.join(pkg, "build.json")) as f:
            got = json.load(f)
        return got if isinstance(got, dict) else {}
    except (OSError, ValueError):
        return {}


def write_stamp(pkg, out):
    with open(os.path.join(pkg, "build.json"), "w") as f:
        json.dump(out, f)
    return out


def begin(pkg):
    """Mark pkg/ unfinished: a build is about to write into it (`make wasm`,
    `make wasm-dev`). No `build`, so the app fetches every script afresh
    meanwhile (main.js's fallback), and no `source`, so no checkout takes
    it; `stamp` replaces it when the build is done, and a re-stamp keeps
    it."""
    os.makedirs(pkg, exist_ok=True)
    return write_stamp(pkg, {"profile": UNFINISHED})


def stamp(pkg, files, profile=None, src=None):
    """Write pkg/build.json: `build` over `files`, `profile` and `source`
    as given, or as the stamp already there had them (an empty `src` drops
    it). Returns what it wrote."""
    before = read_stamp(pkg)
    h = hashlib.sha256()
    for path in files:
        with open(path, "rb") as f:
            h.update(f.read())
    out = {"build": h.hexdigest()[:16], "profile": profile or before.get("profile") or RELEASE}
    kept = before.get("source") if src is None else src
    if kept:
        out["source"] = kept
    return write_stamp(pkg, out)


def settled(root, recipe, src):
    """`src`, a hash of the inputs taken before a build, if they still hash
    to it now the build is done; otherwise "" (no source): Rust saved while
    it built may or may not be in the engine, so no checkout may take it."""
    return src if src and source(root, recipe) == src else ""


def refusal(pkg):
    """Why the browser specs, a rehearsal or a recording can't run on pkg/,
    or None: it must hold a release build."""
    if not os.path.isfile(os.path.join(pkg, WASM)):
        return "no built engine in apps/web/pkg: run `make wasm` first"
    profile = read_stamp(pkg).get("profile") or RELEASE
    if profile != RELEASE:
        return (
            f"apps/web/pkg is {WHAT.get(profile, f'a {profile} build')}, and the browser specs, rehearsals and "
            "recordings run on the release build: run `make wasm` first"
        )
    return None


def checkouts(root):
    """The repository's other checkouts (`git worktree list`), as paths that
    exist: the main checkout (git lists it first) and then the rest, the
    most recently built first (the newest engine in pkg/), so the one whose
    Rust is likeliest to be this one's comes first. `root`'s own is left
    out."""
    listed = git(["worktree", "list", "--porcelain"], root)
    blocks = [b.strip().splitlines() for b in listed.split("\n\n") if b.strip()]
    mine = os.path.realpath(root)
    found = []
    for fields in blocks:
        path = fields[0][len("worktree ") :] if fields[0].startswith("worktree ") else ""
        # A bare repository holds no pkg/, and a worktree whose directory
        # was removed (git's `prunable`) holds nothing to take.
        if path and "bare" not in fields and os.path.isdir(path) and os.path.realpath(path) != mine:
            found.append((path, fields is blocks[0]))

    def built(path):
        try:
            return os.path.getmtime(os.path.join(path, PKG, WASM))
        except OSError:
            return 0.0

    # Not the main checkout: newest build first, git's order among builds
    # of the same second (sorted() is stable).
    return [p for p, main in found if main] + sorted((p for p, main in found if not main), key=built, reverse=True)


def offer(origin, mine):
    """(its stamp, None) when `origin` holds a release engine built from the
    inputs that hash to `mine`; otherwise (None, why not), as a clause."""
    theirs = os.path.join(origin, PKG)
    rec = read_stamp(theirs)
    if not os.path.isfile(os.path.join(theirs, WASM)) or not rec:
        return None, f"{origin} has no built engine"
    profile = rec.get("profile") or RELEASE
    if profile != RELEASE:
        return None, f"{origin}'s engine is {WHAT.get(profile, f'a {profile} build')}"
    if not rec.get("source"):
        return None, f"{origin}'s engine doesn't say what it was built from (a stamp from before it did)"
    if rec["source"] != mine:
        return None, (
            f"{origin}'s engine was built from other Rust, or another build command, than this checkout's "
            f"({rec['source']}, here {mine})"
        )
    return rec, None


def take(root, origin, rec, files, mine):
    """Copy `origin`'s pkg/ (stamped `rec`) over root's and stamp it over
    `files`. Returns (0, what it did) or (1, why not), root's pkg/ as it
    was on 1."""
    theirs = os.path.join(origin, PKG)
    ours = os.path.join(root, PKG)
    staged = ours + ".reuse"
    shutil.rmtree(staged, ignore_errors=True)
    # Files, not links: a build there later must not change this one.
    try:
        shutil.copytree(theirs, staged, symlinks=False)
        # A build there marks its pkg/ unfinished before it writes a byte, so
        # a stamp unchanged after the copy means nothing was written during
        # it. (A build that clears pkg/ under the copy fails the copy itself.)
        copied = read_stamp(theirs) == rec
    except (OSError, shutil.Error):
        copied = False
    if not copied:
        shutil.rmtree(staged, ignore_errors=True)
        return 1, f"{origin}'s engine changed while it was copied (a build there?)"
    shutil.rmtree(ours, ignore_errors=True)
    os.replace(staged, ours)
    stamp(ours, files, profile=RELEASE, src=mine)
    return 0, f"apps/web/pkg: {origin}'s release build, from the same Rust and build command ({mine})"


def reuse(root, recipe, files, origin=None):
    """Copy a release build of root's engine inputs into root's pkg/ and
    stamp it over `files`: `origin`'s, when named and built from them, else
    the first of the repository's other checkouts that has one (`checkouts`
    says in what order). Returns (0, what it did) or (1, why not); on 1
    root's pkg/ is as it was."""
    mine = source(root, recipe)
    if mine is None:
        return 1, "cannot read this checkout's engine inputs (no git?): run `make wasm`"
    if origin is not None:
        if os.path.realpath(origin) == os.path.realpath(root):
            return 1, "that is this checkout: run `make wasm`"
        rec, why = offer(origin, mine)
        if rec is None:
            return 1, f"{why}: run `make wasm` there, or here"
        code, said = take(root, origin, rec, files, mine)
        return code, said if code == 0 else f"{said}: `make pkg-reuse` again once it is done, or `make wasm`"
    try:
        found = checkouts(root)
    except (RuntimeError, OSError) as e:
        return 1, f"cannot list this repository's checkouts ({e}): run `make wasm`"
    passed = []
    for path in found:
        rec, why = offer(path, mine)
        if rec is not None:
            code, said = take(root, path, rec, files, mine)
            if code == 0:
                return 0, said
            why = said
        passed.append(why)
    if not passed:
        return 1, "no other checkout of this repository to take an engine from: run `make wasm`"
    shown = [f"    {why}" for why in passed[:SHOWN]]
    if len(passed) > SHOWN:
        shown.append(f"    and {len(passed) - SHOWN} more")
    return 1, "no other checkout has a release engine built from this Rust and build command: `make wasm` is owed before a browser run\n" + "\n".join(shown)


def main(argv, root=ROOT):
    ap = argparse.ArgumentParser(prog="wasm_pkg.py", description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("source")
    p.add_argument("--recipe", required=True)
    sub.add_parser("begin")
    p = sub.add_parser("stamp")
    p.add_argument("--profile", choices=(RELEASE, DEV))
    p.add_argument("--source", dest="src")
    p.add_argument("--recipe")
    p.add_argument("files", nargs="+")
    sub.add_parser("check")
    p = sub.add_parser("reuse")
    p.add_argument("--recipe", required=True)
    p.add_argument("--from", dest="origin")
    p.add_argument("files", nargs="+")
    a = ap.parse_args(argv)
    pkg = os.path.join(root, PKG)
    if a.cmd == "source":
        print(source(root, a.recipe) or "")
        return 0
    if a.cmd == "begin":
        begin(pkg)
        return 0
    if a.cmd == "stamp":
        src = a.src
        if a.recipe is not None and src:
            src = settled(root, a.recipe, src)
            if not src:
                print(
                    "  the Rust changed while it built, so this build doesn't say what it was built from and "
                    "no other checkout takes it (`make pkg-reuse`); `make wasm` again to stamp it",
                    file=sys.stderr,
                )
        out = stamp(pkg, a.files, a.profile, src)
        print(f"  apps/web/pkg/build.json: {json.dumps(out)}")
        return 0
    if a.cmd == "check":
        why = refusal(pkg)
        if why:
            print(f"  {why}", file=sys.stderr)
            return 1
        return 0
    code, said = reuse(root, a.recipe, a.files, a.origin)
    print(f"  {said}", file=sys.stderr if code else sys.stdout)
    if code == 0:
        print(f"  apps/web/pkg/build.json: {json.dumps(read_stamp(pkg))}")
    return code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
