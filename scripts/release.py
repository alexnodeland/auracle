#!/usr/bin/env python3
"""A release: the version it takes, the bump, what its tag owes, and the list
of what merged, by type, under its notes (the Prepare release workflow,
`.github/workflows/prepare-release.yml`, and `release.yml`; CONTRIBUTING.md
§ Cutting a release).

    python3 scripts/release.py plan [--version X.Y.Z] [--ref REF] [--notes]
                                    [--body FILE] [--github-output]
        the version the next release takes, and why, from the titles merged
        since the last tag; --notes adds the list `notes` would write (it
        reads the PRs' authors with `gh`), --body writes the release PR's
        body, --github-output the version for the workflow's next steps
    python3 scripts/release.py bump X.Y.Z
        the workspace's version, everywhere it is written
    python3 scripts/release.py verify vX.Y.Z
        what a tag owes before it is pushed: the workspace at its version,
        a `## [X.Y.Z]` section in CHANGELOG.md, and nothing left waiting in
        changelog.d/
    python3 scripts/release.py notes (vX.Y.Z | --to REF)
        every PR merged since the tag before, grouped by its title's type,
        each with its author (`gh`)

**The version.** A PR's title is a conventional subject (PR checks), and the
merge queue squash-merges it as `<title> (#n)`, so `main`'s first-parent
subjects since the last `vX.Y.Z` tag are the titles merged since the last
release, and no API needs asking. A `!` after the type is a breaking change,
a `feat` a minor one, a `fix` or `perf` a patch; any other type alone makes a
patch too, since a release was asked for and it ships something. While the
major is 0, a breaking change moves the minor: in 0.x the minor is the
number that says "not compatible" (as Cargo reads a version requirement),
and the README says the API and the save format may change between commits.
1.0 is a decision, made with `--version`. The titles from before PR checks
(October 2026) often have no type: they are counted and listed, and move
nothing.

**A release prepared and not tagged.** When the section under
`[Unreleased]` is `## [X.Y.Z]`, the workspace is at X.Y.Z and `vX.Y.Z` isn't
tagged, the release PR merged and its tag was refused (an entry merged
while it waited, say), so the next release PR is the same version again:
`changelog.py --release` folds what waits into that section. Any other
disagreement between the workspace's version and the last tag is refused,
since one of them was changed by hand.

**The bump.** `[workspace.package] version` in Cargo.toml, the `version` on
every path dependency between the workspace's crates (Cargo.toml's
`[workspace.dependencies]` and `crates/auracle-wasm/Cargo.toml`), and each
crate's entry in Cargo.lock. Cargo refuses a path dependency whose
requirement its crate no longer meets, and CI doesn't build `--locked`, so a
lock left behind would be rewritten on every runner rather than noticed.

**The notes.** The changelog's section is the release's notes, curated and
written for players (ADR-013). Under it, `notes` lists every PR merged since
the tag before, by type, each with its author, in place of GitHub's
generated list. The titles come from git; only the authors are asked of the
API (`gh api`, GET), a page of a hundred closed PRs at a time.

Python 3 standard library only, from 3.9 (macOS's own `python3`, which
`make dev-check` may run on): the manifests are read line by line, as Cargo
writes them, since a TOML parser is in the library from 3.11 only.
`make dev-check` runs its tests (scripts/test_release.py), with no network.
"""

from __future__ import annotations

import argparse
import dataclasses
import json
import os
import pathlib
import re
import subprocess
import sys
import time
from typing import Any, Callable, Iterable, NamedTuple

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import changelog  # noqa: E402
import pr_checks  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
REPO = pr_checks.REPO
CARGO = "Cargo.toml"
LOCK = "Cargo.lock"

SEMVER = re.compile(r"(\d+)\.(\d+)\.(\d+)")
# A release's tag. The versions the titles pick are X.Y.Z, and only those are
# read as the last release; a pre-release tag pushed by hand (`v0.3.0-rc.1`,
# changelog.py's VERSION) is still checked and published as any other.
TAG = re.compile(r"v(\d+\.\d+\.\d+)")
RELEASE_TAG = re.compile(rf"v({changelog.VERSION.pattern})")
# The number the merge queue puts after a squashed PR's title.
NUMBER = re.compile(r"\s*\(#(\d+)\)$")

# The types, as `notes` groups them, in the order it lists them. Every type
# PR checks accepts is here but `release`, the release PR itself, which is
# left out of its own list (test_release.py holds the two lists together).
GROUPS = (
    ("Features", ("feat",)),
    ("Fixes", ("fix",)),
    ("Performance", ("perf",)),
    ("Reverts", ("revert",)),
    ("Documentation", ("docs",)),
    ("Tests", ("tests", "test")),
    ("CI", ("ci",)),
    ("Build", ("build",)),
    ("Refactoring", ("refactor",)),
    ("Style", ("style",)),
    ("Chores", ("chore",)),
)
UNTYPED = "Without a type"
LEFT_OUT = ("release",)

PAGE = 100  # closed PRs a page, the API's most


class Refused(Exception):
    """Why the release can't be planned, bumped or tagged as asked."""


# ─── versions and titles ─────────────────────────────────────────────────────


def version_of(text: str) -> tuple[int, int, int] | None:
    """`X.Y.Z` as numbers, or None for anything else (a pre-release too)."""
    m = SEMVER.fullmatch(text)
    return (int(m.group(1)), int(m.group(2)), int(m.group(3))) if m else None


def last_tag(tags: Iterable[str]) -> str | None:
    """The highest `vX.Y.Z` among `tags`, by number (v0.10.0 is above
    v0.9.0), or None. Any other tag is not a release's."""
    best: tuple[tuple[int, int, int], str] | None = None
    for tag in tags:
        m = TAG.fullmatch(tag)
        v = version_of(m.group(1)) if m else None
        if v is not None and (best is None or v > best[0]):
            best = (v, tag)
    return best[1] if best else None


class Title(NamedTuple):
    number: int | None  # the PR's, from the `(#n)` the queue appends
    title: str  # as merged, without the number
    type: str | None  # a type PR checks accepts, or None
    breaking: bool  # a `!` after the type
    author: str = ""  # the commit's author, for a commit with no PR


def read_subject(subject: str, author: str = "") -> Title:
    """A squash commit's subject, `<title> (#n)`, as a PR's title."""
    subject = subject.strip()
    m = NUMBER.search(subject)
    number = int(m.group(1)) if m else None
    title = subject[: m.start()] if m else subject
    t = pr_checks.TITLE.fullmatch(title)
    kind = t.group("type") if t and t.group("type") in pr_checks.TYPES else None
    return Title(number, title, kind, bool(kind and t.group("bang")), author)


def level_for(titles: list[Title], major: int) -> tuple[str, str]:
    """The level of the bump the titles call for, and why, in words."""

    def count(kinds: tuple[str, ...]) -> int:
        return sum(1 for t in titles if t.type in kinds)

    breaking = sum(1 for t in titles if t.breaking)
    if breaking:
        if major == 0:
            return "minor", f"{breaking} breaking (`!`), which moves the minor while the major is 0"
        return "major", f"{breaking} breaking (`!`)"
    if count(("feat",)):
        return "minor", f"{count(('feat',))} feat"
    if count(("fix", "perf")):
        return "patch", f"{count(('fix', 'perf'))} fix or perf"
    return "patch", "no feat, fix, perf or breaking change, so a patch"


def bumped(version: str, level: str) -> str:
    major, minor, patch = version_of(version) or (0, 0, 0)
    if level == "major":
        return f"{major + 1}.0.0"
    if level == "minor":
        return f"{major}.{minor + 1}.0"
    return f"{major}.{minor}.{patch + 1}"


def counts(titles: list[Title]) -> list[tuple[str, int]]:
    """How many titles of each type, in GROUPS' order, then the untyped."""
    out = []
    for kinds in [k for _, k in GROUPS] + [LEFT_OUT]:
        for kind in kinds:
            n = sum(1 for t in titles if t.type == kind)
            if n:
                out.append((kind, n))
    untyped = sum(1 for t in titles if t.type is None)
    if untyped:
        out.append(("without a type", untyped))
    return out


@dataclasses.dataclass
class Plan:
    version: str  # the release's
    previous: str | None  # the last tag, `vX.Y.Z`
    computed: str  # what the titles call for
    level: str
    why: str
    titles: list[Title]
    folded: bool  # into the untagged section already under [Unreleased]


def decide(
    previous: str | None,
    workspace: str,
    pending: str | None,
    titles: list[Title],
    asked: str = "",
) -> Plan:
    """The release's version: `asked` when given, else what the titles since
    `previous` call for. `workspace` is Cargo.toml's version, and `pending`
    the version of an untagged `## [X.Y.Z]` section standing under
    `[Unreleased]`, if there is one. Raises Refused."""
    if asked and version_of(asked) is None:
        raise Refused(f"`{asked}` is not a version: X.Y.Z")
    if version_of(workspace) is None:
        raise Refused(f"{CARGO}'s `[workspace.package] version` is `{workspace}`, not X.Y.Z")
    if not titles:
        raise Refused(f"nothing has merged since {previous}")
    base = previous[1:] if previous else None
    if base is None:
        level, why, computed = "first", "the first tag: the workspace's version", workspace
    else:
        level, why = level_for(titles, (version_of(base) or (0, 0, 0))[0])
        computed = bumped(base, level)
    if pending is not None:
        if workspace != pending:
            raise Refused(
                f"{changelog.CHANGELOG} has `## [{pending}]` under `{changelog.UNRELEASED}`, untagged, "
                f"and {CARGO} says {workspace}: one of them was changed by hand"
            )
        if asked and asked != pending:
            raise Refused(
                f"{pending} is prepared and not tagged (`## [{pending}]` is under `{changelog.UNRELEASED}`): "
                f"leave the version empty or give {pending}, and what waits is folded into it"
            )
        return Plan(pending, previous, computed, level, why, titles, True)
    if base is not None and workspace != base:
        raise Refused(
            f"{CARGO} says {workspace} and the last tag is {previous}, with no untagged `## [{workspace}]` "
            f"under `{changelog.UNRELEASED}`: one of them was changed by hand"
        )
    version = asked or computed
    if base is not None and version_of(version) <= version_of(base):  # type: ignore[operator]
        raise Refused(f"{version} is not above the last release, {previous}")
    return Plan(version, previous, computed, level, why, titles, False)


def pending_section(text: str, tagged: Callable[[str], bool]) -> str | None:
    """The version of the `## [X.Y.Z]` right under `[Unreleased]` when
    `vX.Y.Z` isn't tagged: a release prepared and not out."""
    _, _, _, rest = changelog.split(text)
    m = re.match(r"## \[([^\]]+)\]", rest[0]) if rest else None
    if m and not tagged(m.group(1)):
        return m.group(1)
    return None


# ─── the workspace's version, where it is written ────────────────────────────


class Place(NamedTuple):
    rel: str  # the file
    line: int  # 0-based
    version: str  # as written there


def table(text: str, name: str) -> list[tuple[int, str]]:
    """The lines of a manifest's `[name]` table, each with its 0-based
    number, up to the next header."""
    out = []
    inside = False
    for i, line in enumerate(text.split("\n")):
        if line.startswith("["):
            inside = line.split("#", 1)[0].strip() == f"[{name}]"
        elif inside:
            out.append((i, line))
    return out


def string(text: str, name: str, key: str) -> tuple[int, str] | None:
    """`key = "…"` in the manifest's `[name]` table: its line, and the
    string. None without one."""
    pattern = re.compile(rf'^\s*{re.escape(key)}\s*=\s*"([^"]*)"')
    for i, line in table(text, name):
        if m := pattern.match(line):
            return i, m.group(1)
    return None


def strings(text: str, name: str, key: str) -> list[str]:
    """`key = ["…", …]` in the manifest's `[name]` table, on one line or
    several, comments left out. [] without one."""
    lines = table(text, name)
    start = re.compile(rf"^\s*{re.escape(key)}\s*=\s*\[")
    for k, (_, line) in enumerate(lines):
        m = start.match(line)
        if not m:
            continue
        held = []
        for ln in [line[m.end() :]] + [ln for _, ln in lines[k + 1 :]]:
            ln = ln.split("#", 1)[0]
            held.append(ln.split("]", 1)[0])
            if "]" in ln:
                break
        return re.findall(r'"([^"]*)"', " ".join(held))
    return []


def workspace_version(text: str) -> str:
    """Cargo.toml's `[workspace.package] version`, or "" without one."""
    found = string(text, "workspace.package", "version")
    return found[1] if found else ""


def members(root: pathlib.Path) -> dict[str, str]:
    """Each workspace crate's name, and its manifest's path. Raises Refused
    for a manifest with no `[package] name`."""
    out = {}
    for member in strings((root / CARGO).read_text(encoding="utf-8"), "workspace", "members"):
        rel = f"{member}/{CARGO}"
        found = string((root / rel).read_text(encoding="utf-8"), "package", "name")
        if found is None:
            raise Refused(f"{rel}: no `name` under `[package]`")
        out[found[1]] = rel
    return out


VERSION_LINE = re.compile(r'^(\s*version\s*=\s*")([^"]*)(".*)$')
PATH_DEP = re.compile(r'^\s*([\w-]+)\s*=\s*\{(?=[^}]*\bpath\s*=)[^}]*\bversion\s*=\s*"([^"]*)"')
LOCK_NAME = re.compile(r'^name = "([^"]*)"$')


def places(root: pathlib.Path) -> list[Place]:
    """Every place the workspace's version is written: Cargo.toml's
    `[workspace.package] version`, each path dependency between the crates
    that pins a version, and each crate's entry in Cargo.lock (the ones with
    no `source`: a crate from crates.io with the same name and version is
    not the workspace's). Raises Refused when the workspace's own is
    missing."""
    crates = members(root)
    own = string((root / CARGO).read_text(encoding="utf-8"), "workspace.package", "version")
    if own is None:
        raise Refused(f"{CARGO}: no `version` under `[workspace.package]`")
    found = [Place(CARGO, *own)]
    for rel in [CARGO, *crates.values()]:
        for i, line in enumerate((root / rel).read_text(encoding="utf-8").split("\n")):
            m = PATH_DEP.match(line)
            if m and m.group(1) in crates:
                found.append(Place(rel, i, m.group(2)))
    if (root / LOCK).exists():
        lines = (root / LOCK).read_text(encoding="utf-8").split("\n")
        for i, line in enumerate(lines):
            m = LOCK_NAME.match(line)
            if not m or m.group(1) not in crates:
                continue
            block = []
            for ln in lines[i + 1 :]:
                if not ln.strip() or ln.startswith("["):
                    break
                block.append(ln)
            if any(ln.startswith("source = ") for ln in block):
                continue
            for j, ln in enumerate(block, i + 1):
                if v := VERSION_LINE.match(ln):
                    found.append(Place(LOCK, j, v.group(2)))
                    break
    return found


def bump(root: pathlib.Path, new: str) -> list[Place]:
    """Write `new` everywhere `places` finds the workspace's version, and
    say where. Nothing to write when it is there already (a release folded
    into one prepared). Raises Refused, writing nothing, on a version that
    isn't one, or places that don't agree (a bump half made by hand)."""
    if version_of(new) is None:
        raise Refused(f"`{new}` is not a version: X.Y.Z")
    found = places(root)
    old = found[0].version
    wrong = [p for p in found if p.version != old]
    if wrong:
        raise Refused(
            "\n".join(f"{p.rel}:{p.line + 1}: {p.version}, and {CARGO}'s workspace says {old}" for p in wrong)
        )
    if old == new:
        return []
    by_file: dict[str, list[int]] = {}
    for p in found:
        by_file.setdefault(p.rel, []).append(p.line)
    for rel, at in by_file.items():
        lines = (root / rel).read_text(encoding="utf-8").split("\n")
        for i in at:
            lines[i] = lines[i].replace(f'"{old}"', f'"{new}"', 1)
        (root / rel).write_text("\n".join(lines), encoding="utf-8")
    return found


# ─── what a tag owes ─────────────────────────────────────────────────────────


def section(text: str, version: str) -> str | None:
    """CHANGELOG.md's `## [version]` section, without its heading, as
    release.yml cuts it (up to the next `## [`), or None without one."""
    lines = text.split("\n")
    start = next((i for i, ln in enumerate(lines) if re.match(rf"## \[{re.escape(version)}\](\s|$)", ln)), None)
    if start is None:
        return None
    end = next((i for i in range(start + 1, len(lines)) if changelog.RELEASE.match(lines[i])), len(lines))
    return "\n".join(lines[start + 1 : end]).strip("\n")


def verify(root: pathlib.Path, tag: str) -> list[str]:
    """What is wrong with tagging the tree at `root` as `tag`; [] when
    nothing is. The workspace is at the tag's version everywhere it is
    written, CHANGELOG.md has a `## [X.Y.Z]` section with something in it,
    and changelog.d/ holds no entry (a change the tag ships that its notes
    don't mention)."""
    m = RELEASE_TAG.fullmatch(tag)
    if not m:
        return [f"`{tag}` is not a release's tag: vX.Y.Z"]
    version = m.group(1)
    wrong = []
    found = []
    try:
        found = places(root)
    except Refused as e:
        wrong.append(str(e))
    except OSError as e:
        wrong.append(f"{CARGO}: {e}")
    for p in found:
        if p.version != version:
            wrong.append(f"{p.rel}:{p.line + 1}: {p.version}, not {version}: bump the workspace (release.py bump) or retag")
    try:
        text = changelog.read(root, changelog.CHANGELOG)
    except FileNotFoundError:
        text = ""
    body = section(text, version)
    if body is None:
        wrong.append(f"{changelog.CHANGELOG}: no `## [{version}]` section: a release with no notes is not a release")
    elif not body.strip():
        wrong.append(f"{changelog.CHANGELOG}: the `## [{version}]` section is empty")
    left, _ = changelog.fragments(root)
    if left:
        wrong.append(
            f"{changelog.FRAGMENTS}/ still holds entries that no release notes mention: {', '.join(left)}. "
            f"Run the Prepare release workflow again: it folds them into `## [{version}]` while v{version} isn't tagged"
        )
    return wrong


# ─── git ─────────────────────────────────────────────────────────────────────


def git(root: pathlib.Path, *args: str) -> str:
    """git's output, run at `root` with no GIT_* variable from the caller
    (changelog.git_env). Raises Refused when git fails."""
    try:
        p = subprocess.run(["git", *args], cwd=root, env=changelog.git_env(root), capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.SubprocessError) as e:
        raise Refused(f"git {' '.join(args)}: {e}") from None
    if p.returncode != 0:
        raise Refused(f"git {' '.join(args)}: {p.stderr.strip() or p.returncode}")
    return p.stdout


def tags_merged(root: pathlib.Path, ref: str) -> list[str]:
    return git(root, "tag", "--merged", ref, "--list", "v*").split()


def all_tags(root: pathlib.Path) -> set[str]:
    return set(git(root, "tag", "--list", "v*").split())


def titles_between(root: pathlib.Path, since: str | None, ref: str) -> list[Title]:
    """The first-parent subjects from `since` (not included) to `ref`,
    newest first, as titles."""
    span = f"{since}..{ref}" if since else ref
    out = git(root, "log", "--first-parent", "--format=%s%x1f%an%x1e", span, "--")
    titles = []
    for record in out.split("\x1e"):
        if record.strip():
            subject, _, author = record.strip("\n").partition("\x1f")
            titles.append(read_subject(subject, author))
    return titles


def show(root: pathlib.Path, ref: str | None, rel: str) -> str:
    """A file as `ref` has it, or as the tree has it with no ref."""
    if ref is None:
        return (root / rel).read_text(encoding="utf-8")
    return git(root, "show", f"{ref}:{rel}")


def waiting(root: pathlib.Path, ref: str | None) -> int:
    """How many entries wait in changelog.d/, as `ref` has it, or as the
    tree has it with no ref."""
    if ref is None:
        return len(changelog.fragments(root)[0])
    names = git(root, "ls-tree", "--name-only", f"{ref}:{changelog.FRAGMENTS}").split()
    return sum(1 for n in names if n.endswith(".md") and n != changelog.README and not n.startswith("."))


# ─── the authors, from the API ───────────────────────────────────────────────


def login(user: dict | None) -> str:
    """A PR author's handle as GitHub shows it: `dependabot[bot]` for an
    app, `ghost` for a deleted account."""
    return user["login"] if user and user.get("login") else "ghost"


def authors(numbers: Iterable[int], get: Callable[[str], Any], repo: str = REPO) -> dict[int, str]:
    """Each PR's author, by number. The closed PRs a page at a time, newest
    first, until a page reaches below the lowest number wanted (numbers rise
    with time, so the rest are older); then any not found yet, one each."""
    want = set(numbers)
    found: dict[int, str] = {}
    if not want:
        return found
    lowest = min(want)
    page = 1
    while want - found.keys():
        items = get(f"repos/{repo}/pulls?state=closed&sort=created&direction=desc&per_page={PAGE}&page={page}")
        for pr in items:
            if pr["number"] in want:
                found[pr["number"]] = login(pr.get("user"))
        if len(items) < PAGE or min(pr["number"] for pr in items) <= lowest:
            break
        page += 1
    for n in sorted(want - found.keys()):
        found[n] = login(get(f"repos/{repo}/pulls/{n}").get("user"))
    return found


def gh_get(url: str, tries: int = 3) -> Any:
    """`gh api` GET of one URL, as JSON. A server error (HTTP 5xx) is asked
    again, twice at most. Raises Refused."""
    for attempt in range(1, tries + 1):
        try:
            p = subprocess.run(["gh", "api", "-X", "GET", url], capture_output=True, text=True, timeout=60)
        except (OSError, subprocess.SubprocessError) as e:
            raise Refused(f"gh api {url}: {e}") from None
        if p.returncode == 0:
            return json.loads(p.stdout)
        if attempt == tries or not re.search(r"HTTP 5\d\d", p.stderr):
            raise Refused(f"gh api {url}: {p.stderr.strip() or p.returncode}")
        time.sleep(2 * attempt)
    raise AssertionError("unreachable")


# ─── the notes ───────────────────────────────────────────────────────────────


def handle(name: str) -> str:
    return f"@{name}"


def render(titles: list[Title], who: dict[int, str], since: str | None) -> str:
    """The list under a release's notes: every PR merged since `since`, by
    type in GROUPS' order, oldest first within each, each with its author;
    the release PR itself left out."""
    shown = [t for t in reversed(titles) if t.type not in LEFT_OUT]

    def by(t: Title) -> str:
        if t.number is not None and t.number in who:
            return handle(who[t.number])
        return t.author or "unknown"

    people: list[str] = []
    for t in shown:
        if (b := by(t)) not in people:
            people.append(b)
    head = f"## Merged since {since}" if since else "## Merged"
    n = len(shown)
    out = [head, "", f"{n} pull request{'' if n == 1 else 's'}, by type. Contributors: {', '.join(people) or 'none'}."]
    groups = [(name, [t for t in shown if t.type in kinds]) for name, kinds in GROUPS]
    groups.append((UNTYPED, [t for t in shown if t.type is None]))
    for name, items in groups:
        if not items:
            continue
        out += ["", f"### {name}", ""]
        for t in items:
            number = f" (#{t.number})" if t.number is not None else ""
            out.append(f"- {t.title}{number} by {by(t)}")
    return "\n".join(out) + "\n"


def notes(titles: list[Title], since: str | None, get: Callable[[str], Any] = gh_get) -> str:
    numbers = [t.number for t in titles if t.number is not None and t.type not in LEFT_OUT]
    return render(titles, authors(numbers, get), since)


def previous_tag(root: pathlib.Path, tag: str) -> str | None:
    """The release before `tag`: the highest `vX.Y.Z` below it that it
    contains."""
    here = version_of(SEMVER.match(tag[1:]).group(0))  # type: ignore[union-attr]
    below = [t for t in tags_merged(root, tag) if (m := TAG.fullmatch(t)) and version_of(m.group(1)) < here]  # type: ignore[operator]
    return last_tag(below)


# ─── the release PR's body ───────────────────────────────────────────────────


def body(plan: Plan, fragments: int, run: str = "") -> str:
    """The release PR's body: what it holds, why this version, what the
    operator does before it is queued, and the line PR checks asks of a PR
    with no issue."""
    since = plan.previous or "the first commit"
    made = f"the Prepare release workflow ([its run]({run}))" if run else "the Prepare release workflow"
    if plan.folded:
        version = (
            f"{plan.version}, prepared before and not tagged: what merged since folds into its section "
            f"(the titles since {since} alone would make {plan.computed}: {plan.why})"
        )
    else:
        version = f"{plan.version}, from {since}: {plan.why}"
    tally = ", ".join(f"{kind} {n}" for kind, n in counts(plan.titles))
    entries = "the one entry" if fragments == 1 else f"the {fragments} entries"
    return f"""The release PR for {plan.version}, made by {made}.

- **The version:** {version}.
- **The changelog:** `## [{plan.version}]` in `CHANGELOG.md`, with {entries} that waited in `changelog.d/` (now deleted) and what `[Unreleased]` held.
- **The bump:** the workspace's version in `Cargo.toml`, `crates/auracle-wasm/Cargo.toml` and `Cargo.lock`.

Titles merged since {since}, by type: {tally}.

**Before it is queued:**

1. Write the paragraph under `## [{plan.version}]` that says what this release is, and push it to this branch. That push starts `CI` and `PR checks`: a PR this workflow opens with its own token starts no workflow (GitHub's rule). With nothing to write, close the PR and reopen it, which starts them too.
2. Queue it: `@mergifyio queue`. It is tested and merged alone (the `release` label).

Once it merges, the same workflow tags its merge commit `v{plan.version}` and starts `release.yml` on the tag, which publishes the release: the `## [{plan.version}]` section as its notes, then every PR merged since {since}, by type.

No issue: the {plan.version} release
"""


# ─── the command ─────────────────────────────────────────────────────────────


def plan_at(root: pathlib.Path, ref: str | None, asked: str) -> Plan:
    head = ref or "HEAD"
    previous = last_tag(tags_merged(root, head))
    titles = titles_between(root, previous, head)
    tags = all_tags(root)
    text = show(root, ref, changelog.CHANGELOG)
    pending = pending_section(text, lambda v: f"v{v}" in tags)
    return decide(previous, workspace_version(show(root, ref, CARGO)), pending, titles, asked)


def describe(plan: Plan) -> str:
    since = plan.previous or "the first commit"
    lines = [f"  release: {plan.version}"]
    if plan.folded:
        lines.append(f"  folded into {plan.version}, prepared and not tagged (the titles alone: {plan.computed}, {plan.why})")
    elif plan.version != plan.computed:
        lines.append(f"  asked for; the titles since {since} call for {plan.computed} ({plan.why})")
    else:
        lines.append(f"  a {plan.level} bump from {since}: {plan.why}")
    lines.append(f"  {len(plan.titles)} merged since {since}: " + ", ".join(f"{k} {n}" for k, n in counts(plan.titles)))
    untyped = [t for t in plan.titles if t.type is None]
    if untyped:
        lines.append(f"  {len(untyped)} without a type, which move nothing:")
        lines += [f"    {t.title}" + (f" (#{t.number})" if t.number else "") for t in untyped]
    return "\n".join(lines)


def main(argv: list[str], root: pathlib.Path = ROOT, get: Callable[[str], Any] = gh_get) -> int:
    parser = argparse.ArgumentParser(prog="release.py", description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("plan")
    p.add_argument("--version", default="")
    p.add_argument("--ref", default=None)
    p.add_argument("--notes", action="store_true")
    p.add_argument("--body", default=None)
    p.add_argument("--github-output", action="store_true")
    sub.add_parser("bump").add_argument("version")
    sub.add_parser("verify").add_argument("tag")
    n = sub.add_parser("notes")
    n.add_argument("tag", nargs="?")
    n.add_argument("--to", default=None)
    args = parser.parse_args(argv)
    try:
        if args.command == "plan":
            plan = plan_at(root, args.ref, args.version.strip())
            print(describe(plan))
            if args.body:
                server, repo, run = (os.environ.get(k, "") for k in ("GITHUB_SERVER_URL", "GITHUB_REPOSITORY", "GITHUB_RUN_ID"))
                url = f"{server}/{repo}/actions/runs/{run}" if server and repo and run else ""
                pathlib.Path(args.body).write_text(body(plan, waiting(root, args.ref), url), encoding="utf-8")
            if args.github_output:
                if not os.environ.get("GITHUB_OUTPUT"):
                    raise Refused("--github-output: GITHUB_OUTPUT is not set (it is in a workflow's step)")
                with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as f:
                    f.write(f"version={plan.version}\nprevious={plan.previous or ''}\nfolded={str(plan.folded).lower()}\n")
            if args.notes:
                print()
                print(notes(plan.titles, plan.previous, get), end="")
            return 0
        if args.command == "bump":
            changed = bump(root, args.version)
            if not changed:
                print(f"  the workspace is at {args.version} already: nothing to bump")
            for p_ in changed:
                print(f"  {p_.rel}:{p_.line + 1}: {p_.version} -> {args.version}")
            return 0
        if args.command == "verify":
            wrong = verify(root, args.tag)
            for w in wrong:
                print(f"  {w}", file=sys.stderr)
            if wrong:
                return 1
            print(f"  {args.tag}: the workspace, CHANGELOG.md and changelog.d/ are ready for it")
            return 0
        if args.command == "notes":
            if bool(args.tag) == bool(args.to):
                parser.error("notes takes a tag, or --to REF")
            if args.tag:
                if not RELEASE_TAG.fullmatch(args.tag):
                    raise Refused(f"`{args.tag}` is not a release's tag: vX.Y.Z")
                since, ref = previous_tag(root, args.tag), args.tag
            else:
                since, ref = last_tag(tags_merged(root, args.to)), args.to
            print(notes(titles_between(root, since, ref), since, get), end="")
            return 0
    except (Refused, changelog.Refused) as e:
        for line in str(e).split("\n"):
            print(f"  {line}", file=sys.stderr)
        return 1
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
