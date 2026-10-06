#!/usr/bin/env python3
"""The changelog's entries waiting for a release, one file per change in
`changelog.d/`, and the release that moves them into `CHANGELOG.md`.

    python3 scripts/changelog.py --check     every fragment parses, and [Unreleased] holds
                                             its note (make dev-check, CI)
    python3 scripts/changelog.py --preview   print [Unreleased] as it would read with them in
    python3 scripts/changelog.py --release X.Y.Z [YYYY-MM-DD]
                                             close [Unreleased] as `## [X.Y.Z] - date`
                                             (today by default), then delete the fragments

Nearly every change adds an entry to `CHANGELOG.md`, and each went at the top
of `[Unreleased]`, so any two open PRs conflicted on the same lines, and the
merge queue sends back a PR it can't rebase (ADR-021). Now a change writes its
entry as `changelog.d/<topic>.md`, `<topic>` being its branch's: the same
`### Kind: title` sections and bullets it would have put under `[Unreleased]`.
Two PRs never touch the same file.

A fragment is one or more sections, each a `### Kind: title` heading (KINDS
below) and a body. Nothing comes before the first heading, and no line is a
`#` or `##` heading: `release.yml` takes a release's notes up to the next
`## [`, so one would cut them short. A line in a code fence is body text.
`changelog.d/README.md` says how to write one, and is not a fragment.

Under `## [Unreleased]`, before its first `###`, stands NOTE below and
nothing else, so a reader of `CHANGELOG.md` knows where the newer entries
wait, and an entry written straight into the file without a heading fails.

A release builds `## [X.Y.Z] - date` newest first, as every section of the
file runs: the fragments, the one merged last at the top (by the commit that
last added each, from `git log`; one not committed yet counts as newer than
any, by when it was written), then the entries already under `[Unreleased]`
(written there before `changelog.d/` existed). `[Unreleased]` is left with its
note, and the fragments are deleted. A person still writes the paragraph under
the new heading that says what the release is (CONTRIBUTING.md § Cutting a
release). Run again with the same version while that section is the one under
`[Unreleased]` and `vX.Y.Z` isn't tagged (the release PR waits, or merged and
the tag waits), it folds what has merged since into the top of the section
instead. `--check` never runs git. Python 3 standard
library only.
"""

from __future__ import annotations

import datetime
import os
import pathlib
import re
import subprocess
import sys
from typing import NamedTuple

ROOT = pathlib.Path(__file__).resolve().parent.parent
CHANGELOG = "CHANGELOG.md"
FRAGMENTS = "changelog.d"
README = "README.md"
UNRELEASED = "## [Unreleased]"

# What stands under `## [Unreleased]`, before and after a release: for a
# reader of CHANGELOG.md on GitHub (the landing page's Changelog link), who
# sees this file and not changelog.d/.
NOTE = """Changes not yet released wait in [`changelog.d/`](changelog.d/), one file
each, until a release moves them here. Any listed in this section were
written before that folder existed."""

# The kinds a section can be: the three every change uses, Renamed (0.2.0's
# rename), and Keep a Changelog's Removed.
KINDS = ("Added", "Changed", "Fixed", "Removed", "Renamed")

FENCE = re.compile(r" {0,3}(`{3,}|~{3,})")
SECTION = re.compile(r" {0,3}###(?!#)")
SECTION_SHAPE = re.compile(r"### (\w+): (\S.*?)\s*")
TOP = re.compile(r" {0,3}#{1,2}(?:[ \t]|$)")
# What ends a release's notes in release.yml (`inside && /^## \[/`).
RELEASE = re.compile(r"## \[")
VERSION = re.compile(r"\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?")
DATE = re.compile(r"\d{4}-\d{2}-\d{2}")
# The line `added_at` asks git for, so nothing else git prints (a signature
# check, say) can be read as a time.
ADDED = re.compile(r"^added (\d+)$", re.M)


class Refused(Exception):
    """Why the changelog can't be checked, previewed or released as asked."""


class Released(NamedTuple):
    heading: str  # the section's heading line
    sections: int  # how many `###` sections it holds now
    order: list[tuple[str, int | None]]  # each fragment, newest first, and when a commit added it
    folded: bool  # whether they went into a section that was already there


# ─── a fragment ──────────────────────────────────────────────────────────────


def closes(fence: str, line: str) -> bool:
    """Whether `line` closes the code fence `fence` opened."""
    m = FENCE.match(line)
    return bool(m) and m.group(1)[0] == fence[0] and len(m.group(1)) >= len(fence) and not line[m.end() :].strip()


def parse(rel: str, text: str) -> tuple[list[tuple[str, str]], list[str]]:
    """A fragment's sections, each (kind, title), and what is wrong with it,
    each as `file:line: what`."""
    found: list[tuple[str, str]] = []
    wrong: list[str] = []
    fence = ""  # the open code fence's marker
    opened = 0  # the line it opened on
    heading = 0  # the line of the last section's heading
    body = False  # whether that section has any text yet
    before = False  # whether text before the first heading was reported
    for n, line in enumerate(text.split("\n"), 1):
        if fence:
            if closes(fence, line):
                fence = ""
            elif RELEASE.match(line):
                wrong.append(f"{rel}:{n}: `## [` starts a line, in code too: release.yml would end the release's notes here")
            continue
        m = FENCE.match(line)
        if m:
            fence, opened = m.group(1), n
        elif SECTION.match(line):
            if heading and not body:
                wrong.append(f"{rel}:{heading}: a section with nothing under its heading")
            heading, body = n, False
            shape = SECTION_SHAPE.fullmatch(line)
            if not shape:
                wrong.append(f"{rel}:{n}: `{line.strip()}` is not `### Kind: title`")
            elif shape.group(1) not in KINDS:
                wrong.append(f"{rel}:{n}: `{shape.group(1)}` is not a kind: {', '.join(KINDS)}")
            else:
                found.append((shape.group(1), shape.group(2)))
            continue
        elif TOP.match(line):
            wrong.append(f"{rel}:{n}: a `#` or `##` heading: a fragment's sections are `### Kind: title`")
            continue
        if not line.strip():
            continue
        if heading:
            body = True
        elif not before:
            before = True
            wrong.append(f"{rel}:{n}: text before the first `### Kind: title`")
    if fence:
        wrong.append(f"{rel}:{opened}: a code fence that never closes")
    if heading and not body:
        wrong.append(f"{rel}:{heading}: a section with nothing under its heading")
    if not heading:
        wrong.append(f"{rel}:1: no `### Kind: title` section")
    return found, wrong


def sections(text: str) -> int:
    """How many `### ` headings `text` has, outside its code."""
    n, fence = 0, ""
    for line in text.split("\n"):
        if fence:
            fence = "" if closes(fence, line) else fence
        elif m := FENCE.match(line):
            fence = m.group(1)
        elif line.startswith("### "):
            n += 1
    return n


def fragments(root: pathlib.Path) -> tuple[list[str], list[str]]:
    """The fragments in changelog.d/ (their paths from the root, by name),
    and what else is there that shouldn't be. A dotfile is ignored."""
    d = root / FRAGMENTS
    if not d.is_dir():
        return [], []
    found, wrong = [], []
    for p in sorted(d.iterdir()):
        rel = f"{FRAGMENTS}/{p.name}"
        if p.name.startswith(".") or p.name == README:
            continue
        if p.is_file() and p.suffix == ".md":
            found.append(rel)
        else:
            wrong.append(f"{rel}: not a fragment: a fragment is a `.md` file directly in {FRAGMENTS}/")
    return found, wrong


def read(root: pathlib.Path, rel: str) -> str:
    return (root / rel).read_text(encoding="utf-8")


def check(root: pathlib.Path) -> tuple[list[str], list[str]]:
    """Every fragment and what is wrong anywhere: a fragment that doesn't
    parse, a stray file in changelog.d/, or a CHANGELOG.md without exactly
    one `## [Unreleased]`, or whose text under it before its first `###`
    isn't NOTE."""
    found, wrong = fragments(root)
    for rel in found:
        wrong += parse(rel, read(root, rel))[1]
    try:
        text = read(root, CHANGELOG)
    except FileNotFoundError:
        return found, wrong + [f"{CHANGELOG}: missing"]
    try:
        head, note, _, _ = split(text)
    except Refused as e:
        return found, wrong + [str(e)]
    if note != NOTE:
        wrong.append(
            f"{CHANGELOG}:{len(head)}: under `{UNRELEASED}`, before its first `###`, stands the note in "
            f"scripts/changelog.py (NOTE) and nothing else; an entry goes in {FRAGMENTS}/<topic>.md"
        )
    return found, wrong


# ─── merge order ─────────────────────────────────────────────────────────────


def git_env(root: pathlib.Path) -> dict[str, str]:
    """The environment for git: without a GIT_* variable (a hook's GIT_DIR
    or GIT_INDEX_FILE would point it at another repository than the root's),
    and with the root's parent as its ceiling, so a root that isn't a
    repository is never read as part of one above it."""
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    env["GIT_CEILING_DIRECTORIES"] = str(root.resolve().parent)
    return env


def added_time(out: str) -> int | None:
    """The time in what `added_at`'s `git log` printed, or None."""
    m = ADDED.search(out)
    return int(m.group(1)) if m else None


def added_at(root: pathlib.Path, rel: str) -> int | None:
    """When the commit that last added `rel` was made (seconds since the
    epoch), or None when no commit has added it (or git can't say). The last
    add, not the first: a release deletes the fragments, so a topic's name
    comes back, and its first add is a file that is gone."""
    cmd = ["git", "-c", "log.showSignature=false", "log", "-1", "--no-renames", "--diff-filter=A", "--format=added %ct", "--", rel]
    try:
        out = subprocess.run(cmd, cwd=root, env=git_env(root), capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.SubprocessError):
        return None
    return added_time(out.stdout) if out.returncode == 0 else None


def tagged(root: pathlib.Path, version: str) -> bool:
    """Whether the repository has the tag `v<version>`: that release is out."""
    cmd = ["git", "rev-parse", "-q", "--verify", f"refs/tags/v{version}"]
    try:
        return subprocess.run(cmd, cwd=root, env=git_env(root), capture_output=True, timeout=30).returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def ordered(root: pathlib.Path, found: list[str]) -> list[tuple[str, int | None]]:
    """The fragments oldest first, each with when a commit added it (None
    when none has): the committed ones by that commit, then the rest (not
    merged yet) by when each was written. A tie goes by name."""
    at = {rel: added_at(root, rel) for rel in found}

    def key(rel: str) -> tuple[int, int, str]:
        if at[rel] is not None:
            return 0, at[rel], rel
        return 1, (root / rel).stat().st_mtime_ns, rel

    return [(rel, at[rel]) for rel in sorted(found, key=key)]


def merge_order(root: pathlib.Path, found: list[str]) -> list[str]:
    """The fragments in the order they merged, oldest first."""
    return [rel for rel, _ in ordered(root, found)]


# ─── the release ─────────────────────────────────────────────────────────────


def split(text: str) -> tuple[list[str], str, str, list[str]]:
    """CHANGELOG.md as (its lines up to and with `## [Unreleased]`, the text
    under that heading before its first `###`, the entries from there, the
    lines from the next `## [` on). Raises Refused without exactly one
    `## [Unreleased]`."""
    lines = text.split("\n")
    if lines.count(UNRELEASED) != 1:
        raise Refused(f"{CHANGELOG}: {lines.count(UNRELEASED)} `{UNRELEASED}` headings, not one")
    u = lines.index(UNRELEASED)
    r = next((i for i in range(u + 1, len(lines)) if RELEASE.match(lines[i])), len(lines))
    section = lines[u + 1 : r]
    k = next((i for i, ln in enumerate(section) if ln.startswith("### ")), len(section))
    note = "\n".join(section[:k]).strip("\n")
    entries = "\n".join(section[k:]).strip("\n")
    return lines[: u + 1], note, entries, lines[r:]


def folded(root: pathlib.Path) -> tuple[list[str], str, list[str], list[tuple[str, int | None]]]:
    """CHANGELOG.md as (its lines up to and with `## [Unreleased]`, what that
    section holds with the fragments in, newest first, the lines from the next
    `## [` on, the fragments newest first). Raises Refused when `--check`
    would fail."""
    found, wrong = check(root)
    if wrong:
        raise Refused("\n".join(wrong))
    head, _, entries, rest = split(read(root, CHANGELOG))
    order = ordered(root, found)[::-1]
    parts = [read(root, rel).strip("\n") for rel, _ in order] + [entries]
    return head, "\n\n".join(p for p in parts if p), rest, order


def preview(root: pathlib.Path) -> str:
    """`[Unreleased]` as it would read with the fragments in."""
    head, body, _, _ = folded(root)
    return "\n\n".join(p for p in (head[-1], NOTE, body) if p) + "\n"


def release(root: pathlib.Path, version: str, date: str) -> Released:
    """Close `[Unreleased]` as `## [version] - date` with every fragment in,
    write CHANGELOG.md, then delete the fragments. When `## [version]` is
    already the section under `[Unreleased]`, what is waiting goes into the
    top of it instead, and its heading and paragraph stay as they are,
    unless `v<version>` is tagged. Raises Refused, having changed nothing, on
    a version or date that isn't one, a version further down or tagged,
    nothing to release, or anything `--check` refuses."""
    if not VERSION.fullmatch(version):
        raise Refused(f"`{version}` is not a version: X.Y.Z")
    if not DATE.fullmatch(date):
        raise Refused(f"`{date}` is not a date: YYYY-MM-DD")
    try:
        datetime.date.fromisoformat(date)
    except ValueError:
        raise Refused(f"`{date}` is not a date: YYYY-MM-DD") from None
    head, body, rest, order = folded(root)
    mine = f"## [{version}]"
    here = bool(rest) and rest[0].startswith(mine)
    if not here and any(ln.startswith(mine) for ln in rest):
        raise Refused(f"{CHANGELOG} already has a `{mine}` section, and not as the one under `{UNRELEASED}`")
    if here and tagged(root, version):
        raise Refused(f"`v{version}` is tagged, so `{mine}` is released: what waits goes in the next version")
    if not body:
        raise Refused(f"nothing to release: `{UNRELEASED}` and {FRAGMENTS}/ hold no entries")
    if here:
        end = next((i for i in range(1, len(rest)) if RELEASE.match(rest[i])), len(rest))
        heading, section, rest = rest[0], rest[1:end], rest[end:]
        k = next((i for i, ln in enumerate(section) if ln.startswith("### ")), len(section))
        intro = "\n".join(section[:k]).strip("\n")
        body = "\n\n".join(p for p in (body, "\n".join(section[k:]).strip("\n")) if p)
    else:
        heading, intro = f"{mine} - {date}", ""
    out = head + ["", NOTE, "", heading, ""] + ([intro, ""] if intro else []) + [body]
    out += ["", *rest] if rest else [""]
    (root / CHANGELOG).write_text("\n".join(out), encoding="utf-8")
    for rel, _ in order:
        (root / rel).unlink()
    return Released(heading, sections(body), order, here)


# ─── the command ─────────────────────────────────────────────────────────────


def when(at: int | None) -> str:
    if at is None:
        return "not committed, so by when it was written"
    return "added " + datetime.datetime.fromtimestamp(at, datetime.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")


def main(argv: list[str], root: pathlib.Path = ROOT) -> int:
    try:
        if argv == ["--check"]:
            found, wrong = check(root)
            if wrong:
                for w in wrong:
                    print(f"  {w}", file=sys.stderr)
                print(f"  changelog: {len(wrong)} problem(s); how to write a fragment: {FRAGMENTS}/{README}", file=sys.stderr)
                return 1
            print(f"  changelog: {len(found)} fragment(s) in {FRAGMENTS}/ parse, and `{UNRELEASED}` holds its note")
            return 0
        if argv == ["--preview"]:
            text = preview(root)
            try:
                sys.stdout.write(text)
                sys.stdout.flush()
            except BrokenPipeError:
                # A pager or `head` that stops reading early is not a failure.
                os.dup2(os.open(os.devnull, os.O_WRONLY), sys.stdout.fileno())
            return 0
        if argv[:1] == ["--release"] and len(argv) in (2, 3):
            date = argv[2] if len(argv) == 3 else datetime.date.today().isoformat()
            r = release(root, argv[1], date)
            k = f"{len(r.order)} fragment(s) from {FRAGMENTS}/ (now deleted)"
            if r.folded:
                print(f"  {CHANGELOG}: folded {k} into `{r.heading}`, which holds {r.sections} sections")
            else:
                print(f"  {CHANGELOG}: `{r.heading}` holds {r.sections} sections, with {k}")
            if r.order:
                print("  their order, newest first, as they stand under the heading:")
                for rel, at in r.order:
                    print(f"    {rel}: {when(at)}")
                by_commit = sum(1 for _, at in r.order if at is not None)
                print(f"  ordered {by_commit} by the commit that added each, {len(r.order) - by_commit} by when each was written")
            if r.folded:
                print("  its heading and paragraph are as they were: check the paragraph still says what the release is")
            else:
                print(f"  next: write the paragraph under `{r.heading}` that says what this release is")
            return 0
    except Refused as e:
        for line in str(e).split("\n"):
            print(f"  {line}", file=sys.stderr)
        return 1
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
