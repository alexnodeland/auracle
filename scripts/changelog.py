#!/usr/bin/env python3
"""The changelog's entries waiting for a release, one file per change in
`changelog.d/`, and the release that moves them into `CHANGELOG.md`.

    python3 scripts/changelog.py --check     every fragment parses (make dev-check, CI)
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

A release builds `## [X.Y.Z] - date` from what `[Unreleased]` holds (the
entries written there before `changelog.d/` existed, in their order), then
the fragments in the order they were merged: oldest first, by the commit that
last added each one (`git log`), and after those any not committed yet, by
when each was written. What sits between `## [Unreleased]` and its first
`###` (the note that says where newer entries wait) stays under
`[Unreleased]`, which is otherwise left empty. Then the fragments are deleted.
A person still writes the paragraph under the new heading that says what the
release is (CONTRIBUTING.md § Cutting a release). `--check` never runs git.
Python 3 standard library only.
"""

from __future__ import annotations

import datetime
import os
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
CHANGELOG = "CHANGELOG.md"
FRAGMENTS = "changelog.d"
README = "README.md"
UNRELEASED = "## [Unreleased]"

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


class Refused(Exception):
    """Why the changelog can't be checked, previewed or released as asked."""


# ─── a fragment ──────────────────────────────────────────────────────────────


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
        m = FENCE.match(line)
        if fence:
            closes = m and m.group(1)[0] == fence[0] and len(m.group(1)) >= len(fence) and not line[m.end() :].strip()
            if closes:
                fence = ""
            elif RELEASE.match(line):
                wrong.append(f"{rel}:{n}: `## [` starts a line, in code too: release.yml would end the release's notes here")
            continue
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
    one `## [Unreleased]` for a release to close."""
    found, wrong = fragments(root)
    for rel in found:
        wrong += parse(rel, read(root, rel))[1]
    try:
        n = read(root, CHANGELOG).split("\n").count(UNRELEASED)
    except FileNotFoundError:
        n = None
    if n is None:
        wrong.append(f"{CHANGELOG}: missing")
    elif n != 1:
        wrong.append(f"{CHANGELOG}: {n} `{UNRELEASED}` headings, not one")
    return found, wrong


# ─── merge order ─────────────────────────────────────────────────────────────


def git_env() -> dict[str, str]:
    """The environment for git, without a GIT_* variable: a hook's GIT_DIR
    or GIT_INDEX_FILE would point it at another repository than the root's."""
    return {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}


def added_at(root: pathlib.Path, rel: str) -> int | None:
    """When the commit that last added `rel` was made (seconds since the
    epoch), or None when no commit has added it (or git can't say). The last
    add, not the first: a release deletes the fragments, so a topic's name
    comes back, and its first add is a file that is gone."""
    try:
        out = subprocess.run(
            ["git", "log", "-1", "--no-renames", "--diff-filter=A", "--format=%ct", "--", rel],
            cwd=root,
            env=git_env(),
            capture_output=True,
            text=True,
            timeout=30,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    s = out.stdout.strip()
    return int(s) if out.returncode == 0 and s.isdigit() else None


def merge_order(root: pathlib.Path, found: list[str]) -> list[str]:
    """The fragments oldest first: the committed ones by the commit that added
    each, then the rest (not merged yet) by when each was written. A tie goes
    by name."""

    def key(rel: str) -> tuple[int, int, str]:
        at = added_at(root, rel)
        if at is not None:
            return 0, at, rel
        return 1, (root / rel).stat().st_mtime_ns, rel

    return sorted(found, key=key)


# ─── the release ─────────────────────────────────────────────────────────────


def split(text: str) -> tuple[list[str], str, str, list[str]]:
    """CHANGELOG.md as (its lines up to and with `## [Unreleased]`, the note
    under that heading, the entries under the note, the lines from the next
    `## [` on). Raises Refused without exactly one `## [Unreleased]`."""
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


def folded(root: pathlib.Path) -> tuple[list[str], str, str, list[str], list[str]]:
    """CHANGELOG.md split as `split` does, with the entries and every
    fragment in merge order as one body, and the fragments used. Raises
    Refused when a fragment doesn't parse."""
    found, wrong = check(root)
    if wrong:
        raise Refused("\n".join(wrong))
    head, note, entries, rest = split(read(root, CHANGELOG))
    parts = [entries] + [read(root, rel).strip("\n") for rel in merge_order(root, found)]
    body = "\n\n".join(p for p in parts if p)
    return head, note, body, rest, found


def preview(root: pathlib.Path) -> str:
    """`[Unreleased]` as it would read with the fragments in."""
    head, note, body, _, _ = folded(root)
    return "\n\n".join(p for p in (head[-1], note, body) if p) + "\n"


def release(root: pathlib.Path, version: str, date: str) -> tuple[int, list[str]]:
    """Close `[Unreleased]` as `## [version] - date` with every fragment in,
    write CHANGELOG.md, then delete the fragments. Returns how many entries
    the new section holds and the fragments it deleted. Raises Refused, having
    changed nothing, on a version or date that isn't one, a version already
    released, nothing to release, or a fragment that doesn't parse."""
    if not VERSION.fullmatch(version):
        raise Refused(f"`{version}` is not a version: X.Y.Z")
    if not DATE.fullmatch(date):
        raise Refused(f"`{date}` is not a date: YYYY-MM-DD")
    try:
        datetime.date.fromisoformat(date)
    except ValueError:
        raise Refused(f"`{date}` is not a date: YYYY-MM-DD") from None
    head, note, body, rest, found = folded(root)
    if any(ln.startswith(f"## [{version}]") for ln in rest):
        raise Refused(f"{CHANGELOG} already has a `## [{version}]` section")
    if not body:
        raise Refused(f"nothing to release: `{UNRELEASED}` and {FRAGMENTS}/ hold no entries")
    out = head + [""]
    if note:
        out += [note, ""]
    out += [f"## [{version}] - {date}", "", body]
    out += ["", *rest] if rest else [""]
    (root / CHANGELOG).write_text("\n".join(out), encoding="utf-8")
    for rel in found:
        (root / rel).unlink()
    return sum(1 for ln in body.split("\n") if ln.startswith("### ")), found


# ─── the command ─────────────────────────────────────────────────────────────


def main(argv: list[str], root: pathlib.Path = ROOT) -> int:
    try:
        if argv == ["--check"]:
            found, wrong = check(root)
            if wrong:
                for w in wrong:
                    print(f"  {w}", file=sys.stderr)
                print(f"  changelog: {len(wrong)} problem(s); how to write a fragment: {FRAGMENTS}/{README}", file=sys.stderr)
                return 1
            print(f"  changelog: {len(found)} fragment(s) in {FRAGMENTS}/ parse")
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
            n, gone = release(root, argv[1], date)
            print(f"  {CHANGELOG}: `## [{argv[1]}] - {date}` holds {n} sections, with the {len(gone)} fragment(s) from {FRAGMENTS}/, now deleted")
            print(f"  next: write the paragraph under `## [{argv[1]}]` that says what this release is")
            return 0
    except Refused as e:
        for line in str(e).split("\n"):
            print(f"  {line}", file=sys.stderr)
        return 1
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
