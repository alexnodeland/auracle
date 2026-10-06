#!/usr/bin/env python3
"""What a pull request owes before the merge queue takes it, and what its
merge owes the issues it names (`.github/workflows/pr-checks.yml`;
docs/process.md § Pull requests).

    python3 scripts/pr_checks.py title       the title is a conventional subject
    python3 scripts/pr_checks.py links       the body names its issues, one per keyword
    python3 scripts/pr_checks.py changelog   a warning: a player-facing change, no entry
    python3 scripts/pr_checks.py merged      on merge: comment, close, tell the parents, tick

In CI each reads the PR from the event, through the environment
(PR_NUMBER, PR_TITLE, PR_BODY, PR_AUTHOR, PR_HEAD_REPO, PR_MERGED_AT,
GITHUB_REPOSITORY),
never from a script the workflow writes. `--pr N` reads PR N with `gh`
instead, for a run by hand; `check --pr N` runs the first three on it, and
`merged --pr N --dry-run` says what the merge job would do, writing nothing.

**The title** becomes the squash commit's subject on `main` (`<title> (#n)`),
so it carries the prefix AGENTS.md rule 8 asks of a commit: a type from TYPES,
an optional `(scope)`, an optional `!`, then `: ` and the subject.

**The links.** GitHub closes an issue when a merged PR's body names it after a
closing keyword (close, fix or resolve, in any tense), and reads one issue per
keyword: `Closes #1, #2` closes #1 only. So every closing keyword names one
issue, and a list after one fails with the fix spelled out. `Refs #n` (or
`Ref`) names an issue the PR advances without finishing; a list is fine
there, since only this script reads it. A ref is `#n`, `owner/repo#n` or the
issue's URL; one in another repository is not this PR's link. The body names
at least one issue, or says why not on a line that starts `No issue:`. Every
issue it names exists, is an issue and not a PR, and one named with a closing
keyword is still open. Keywords are matched in any case, anywhere in the body
but in code (fenced blocks and inline spans), quoted lines (`>`) and HTML
comments (the template's guidance). A Dependabot PR's body is the upstream
release notes, so its links are not checked.

**The changelog.** A PR that changes what a player or a reader of the site
sees (PLAYER_FACING) with no entry in `changelog.d/` gets a warning, never a
failure: whether a change is noticeable is a judgment the script can't make.

**On merge,** for a PR that names issues: each `Closes` issue GitHub didn't
close is closed here, with a comment saying why; each issue that closed with
the PR (not one closed before it merged) and has a parent (GitHub's
sub-issues) is counted on the parent, with how many of its sub-issues are
closed; each `Refs` issue gets a comment naming the PR. One comment per issue
per PR, each of its lines carrying a marker of its own, so a run again adds
only what an earlier run left out: a line a failed run couldn't write is
posted, and none is posted twice. GitHub closes linked issues a moment after
the merge, so an issue still open is read again for up to POLLS * EVERY
seconds before it is closed here.

**The boxes.** Each issue that closed with the PR is searched for in the
bodies of the other open issues (an umbrella's checklist), and each body
found is read and parsed. A box there (`- [ ] …`) that names it is ticked
once every issue the box names is closed: `#130 + #153` waits for both. A
number that is a PR is not an issue to wait for. A box that names an issue
in another repository is left for a person. GitHub's own reading decides
what is a box and what is a number: not a box in fenced code, in an HTML
comment or in a quote, nor a number in inline code or a comment; a `<!--` in
code is text, and one that starts mid-line and never closes is text too
(only one that starts a line hides the rest of the body).

Only `[ ]` becomes `[x]`. The body is read again just before the write, and
a box whose line changed since the first read is left as it is. A queue
batch merges its PRs seconds apart, so another run of this job may write the
same body from a read taken before this write, putting its boxes back: the
body is read again SETTLE seconds after the write, and a box back to `[ ]`,
its line otherwise as it was, is ticked again, up to TRIES writes in all.
What the job can't see: a person's edit saved between its read and its
write is lost (the API has no conditional write for a body); a write
landing more than SETTLE seconds after the read it was built on can still
put a box back; and the search index can lag an edit by a minute, so a box
added just before the merge can be missed. A person ticks those.

The issue's comment gets a line for each box ticked, quoting it in code (so
an @mention or `#n` in it notifies no one again), each line marked with the
box's line and text. A box ticked is ticked for good, so a run again ticks
nothing twice and says nothing twice, and a box a red run left (an issue it
names couldn't be read) is ticked and said by the run again. A run that
ticked a box and then failed to post its line doesn't post it later, since
a box ticked by the job looks like one ticked by hand.

The GitHub API is read and written through `gh api` (GH_TOKEN in CI).
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
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Callable
from urllib.parse import quote

REPO = "alexnodeland/auracle"

# The types a title may start with: the conventional ones this repository's
# history uses, and `release`, which a release PR's title starts with
# (CONTRIBUTING.md § Cutting a release; `release: cut 0.2.0`). Lower case.
TYPES = ("feat", "fix", "docs", "tests", "test", "ci", "build", "refactor", "perf", "chore", "revert", "style", "release")
TITLE = re.compile(r"(?P<type>[A-Za-z]+)(?:\((?P<scope>[^()\s]+)\))?(?P<bang>!)?: (?P<subject>\S.*)")
# A title that starts like a prefix and isn't quite one: each part is read
# loosely, so the failure can say which part is off.
LOOSE = re.compile(r"(?P<type>[A-Za-z]+)(?P<gap>\s*)(?:\((?P<scope>[^()]*)\))?(?P<bang>!)?(?P<before>\s*):(?P<after>\s*)(?P<subject>.*)")
# GitHub's Revert button titles its PR this way.
REVERT = re.compile(r'Revert "(?P<title>.+)"')
EXAMPLE = "fix(web): a toast that names a replaced sound is never dropped"

DEPENDABOT = "dependabot[bot]"

# A change here reaches a player or a reader of the site; its tests and the
# notes for contributors beside it do not.
PLAYER_FACING = ("apps/web/", "www/docs/src/", "www/landing/")
NOT_PLAYER_FACING = ("apps/web/tests/",)
FRAGMENTS = "changelog.d/"
FRAGMENTS_README = "changelog.d/README.md"

CLOSING = r"close[sd]?|fix(?:e[sd])?|resolve[sd]?"
REFS = r"refs?"
# Any reference GitHub would link: an issue's URL, `owner/repo#n` or `#n`.
REF = r"(?:https?://(?:www\.)?github\.com/[\w.-]+/[\w.-]+/(?:issues|pull)/\d+|(?:[\w.-]+/[\w.-]+)?#\d+)\b"
# Between the keyword and its ref: a colon, or spaces.
AFTER_KEYWORD = r"(?:[ \t]*:[ \t]*|[ \t]+)"
# Between two refs of a list: a comma, semicolon, ampersand or slash, `and`,
# or only spaces. After a separator or an `and` the list may go on to the
# next line (`Closes #3,` then `#4`); after only spaces it may not.
BETWEEN = r"(?:[ \t]*[,;&/]\s*(?:and\s+)?|[ \t]+(?:(?:and|&)\s+)?)"
STATEMENT = re.compile(
    rf"\b(?P<keyword>{CLOSING}|{REFS})\b{AFTER_KEYWORD}(?P<first>{REF})(?P<rest>(?:{BETWEEN}{REF})*)",
    re.IGNORECASE,
)
NO_ISSUE = re.compile(r"^[ \t]*(?:[-*+][ \t]+)?no issue:[ \t]*(?P<why>.*?)[ \t]*$", re.IGNORECASE | re.MULTILINE)

# Each line the merge job writes carries a marker naming what it says and the
# PR: `closed by` (the job closed the issue), `advanced by` (a `Refs` line),
# `sub-issues` (a parent's count of them closed), `ticked line N (hash)` (a
# box it ticked in the issue's body: the box's line, and its text hashed).
MARK = "<!-- pr-checks: {what} #{pr} -->"
POLLS = 6
EVERY = 10  # seconds
# How long after writing a body's ticks the job reads it again, to tick again
# a box another run's write put back; and how many writes it makes at most.
# Longer than any run takes between its read and its write (one API call).
SETTLE = 5  # seconds
TRIES = 3

# A task list's box, as GitHub draws one: `- [ ] text`, `* [x] text`,
# `1. [ ] text`. The line is matched whole, a CR at its end included (GitHub's
# web editor saves a body with CRLF line ends), so ticking a box changes one
# character and nothing else on the line.
BOX = re.compile(r"[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+\[(?P<mark>[ xX])\][ \t]+(?P<text>[^\r]*?)[ \t]*\r?")
# How much of a box's text the comment that says it was ticked quotes.
QUOTE = 80  # characters


# ─── the title ───────────────────────────────────────────────────────────────


def check_title(title: str) -> list[str]:
    """What is wrong with `title` as a squash commit's subject; [] when
    nothing is."""
    want = (
        "It becomes the squash commit's subject on main, so it starts with a "
        f"type, as a commit's does (AGENTS.md rule 8): `<type>: <subject>` or "
        f"`<type>(<scope>): <subject>`, the type one of {', '.join(TYPES)}. "
        f"For example `{EXAMPLE}`."
    )
    text = title.strip()
    m = TITLE.fullmatch(text)
    if not m:
        revert = REVERT.fullmatch(text)
        if revert:
            return [
                f"GitHub's Revert button titles a PR `Revert \"…\"`, which has no type. A revert's title is "
                f"`revert: <subject>`, here `revert: {revert.group('title')}`."
            ]
        loose = LOOSE.fullmatch(text)
        if loose and loose.group("type").lower() in TYPES:
            prefix = text[: loose.start("after")]
            return [f"The title's prefix `{prefix}` is almost right: {off(loose)}. {want}"]
        return [f"The title `{title}` has no conventional prefix. {want}"]
    kind = m.group("type")
    if kind.lower() in TYPES and kind != kind.lower():
        return [f"The title's type `{kind}` has capital letters; types are lower case: `{kind.lower()}`. {want}"]
    if kind not in TYPES:
        return [
            f"The title's type `{kind}` is not one of the types. A topic such as `{kind.lower()}` can be the scope: "
            f"`<type>({kind.lower()}): <subject>`. {want}"
        ]
    return []


def off(m: re.Match) -> str:
    """What is off in a prefix LOOSE read and TITLE didn't."""
    scope = m.group("scope")
    if m.group("gap") and scope is not None:
        return "no space goes between the type and the `(`"
    if m.group("gap") and m.group("bang"):
        return "no space goes before the `!`"
    if m.group("gap") or m.group("before"):
        return "no space goes before the colon"
    if scope is not None and not scope.strip():
        return "the `()` is empty; name a scope in it, or leave it out"
    if scope is not None and re.search(r"\s", scope):
        return "a scope has no spaces in it"
    if not m.group("subject").strip():
        return "the subject after the colon is missing"
    return "one space goes after the colon, then the subject"


# ─── the links ───────────────────────────────────────────────────────────────


INLINE_CODE = r"(`+)(?:(?!\1).)+?\1"
# A line that opens fenced code: three backticks or tildes, or more.
FENCE = re.compile(r"[ \t]*(`{3,}|~{3,})")


def closes(fence: str, line: str) -> bool:
    """`line` closes fenced code that `fence` opened: a run of its character
    as long or longer, and nothing after it."""
    m = FENCE.match(line)
    return bool(m) and m.group(1)[0] == fence[0] and len(m.group(1)) >= len(fence) and not line.strip()[len(m.group(1)) :].strip()


def unfenced(lines: list[str]):
    """Each (index, line) of `lines` outside fenced code; the fences' own
    lines are left out too."""
    fence = None
    for i, line in enumerate(lines):
        if fence is not None:
            if closes(fence, line):
                fence = None
            continue
        m = FENCE.match(line)
        if m:
            fence = m.group(1)
            continue
        yield i, line


def readable(body: str) -> str:
    """`body` without what GitHub doesn't read as a link: HTML comments,
    fenced code, quoted lines and inline code."""
    text = re.sub(r"<!--.*?-->", " ", body.replace("\r\n", "\n"), flags=re.DOTALL)
    return "\n".join(re.sub(INLINE_CODE, " ", line) for _, line in unfenced(text.split("\n")) if not line.lstrip().startswith(">"))


def number(ref: str, repo: str) -> int | None:
    """The issue number `ref` names in `repo`, or None when it is another
    repository's."""
    owner, name = repo.lower().split("/")
    url = re.fullmatch(r"https?://(?:www\.)?github\.com/([\w.-]+)/([\w.-]+)/(?:issues|pull)/(\d+)", ref, re.IGNORECASE)
    if url:
        return int(url.group(3)) if (url.group(1).lower(), url.group(2).lower()) == (owner, name) else None
    where, _, n = ref.partition("#")
    if where and where.lower() != f"{owner}/{name}":
        return None
    return int(n)


@dataclass
class Links:
    closes: list[int] = field(default_factory=list)
    refs: list[int] = field(default_factory=list)
    no_issue: str | None = None  # the reason on a `No issue:` line, "" when it gives none
    problems: list[str] = field(default_factory=list)

    def named(self) -> list[int]:
        return self.closes + [n for n in self.refs if n not in self.closes]


def parse(body: str, repo: str = REPO) -> Links:
    """The issues `body` closes and the ones it refs, in order, and each
    closing keyword followed by a list."""
    links = Links()
    text = readable(body or "")
    for m in STATEMENT.finditer(text):
        keyword = m.group("keyword")
        refs = [m.group("first")] + re.findall(REF, m.group("rest"))
        closing = re.fullmatch(CLOSING, keyword, re.IGNORECASE) is not None
        ours = [n for n in (number(r, repo) for r in refs) if n is not None]
        if closing and len(refs) > 1:
            fixed = ", ".join([f"{keyword} {refs[0]}"] + [f"{keyword.lower()} {r}" for r in refs[1:]])
            links.problems.append(
                f"`{' '.join(m.group(0).split())}` names {len(refs)} issues after one `{keyword}`. GitHub reads "
                f"one issue per keyword, so it would close {refs[0]} only. Give each its own: `{fixed}`, "
                "or one per line."
            )
        # Every issue of a list after a closing keyword is one the PR means to
        # close: the merge job closes those GitHub doesn't.
        target = links.closes if closing else links.refs
        for n in ours:
            if n not in target:
                target.append(n)
    no = NO_ISSUE.search(text)
    if no:
        links.no_issue = no.group("why")
    return links


@dataclass
class Box:
    """A box in an issue's task list."""

    line: int  # its line's index in the body split at "\n"
    raw: str  # that line, exactly as the body has it
    mark: int  # the column of the space or `x` between its brackets
    ticked: bool
    text: str  # what follows the box, its spaces collapsed
    issues: list[int]  # the numbers in this repository it names, in order
    elsewhere: bool  # it names an issue in another repository


# A line that starts a block of its own, so a paragraph doesn't go on to it:
# a blank line, a list item, a quote, a heading, a fence or an HTML comment.
BLOCK = re.compile(r"[ \t]*(?:\r?$|(?:[-*+]|\d{1,9}[.)])(?:[ \t]|\r?$)|>|#{1,6}(?:[ \t]|\r?$)|`{3,}|~{3,}|<!--)")
# Inline code, or the start of an HTML comment: whichever comes first is it.
CODE_OR_COMMENT = re.compile(rf"{INLINE_CODE}|<!--")


def shown(body: str) -> list[str | None]:
    """Each line of `body` (split at "\\n") as GitHub reads it as Markdown,
    each HTML comment in it blanked to spaces so its columns hold; None for a
    line with no Markdown in it, in fenced code (the fences' own lines too)
    or in an HTML comment. A comment that starts a line is an HTML block: it
    runs to the line holding its `-->`, that line whole, or to the end of the
    body when none does. One that starts mid-line, outside inline code, runs
    to its `-->` on that line, or on a line its paragraph goes on to; with
    none, it is text. A `<!--` in code is text."""
    lines = body.split("\n")
    out: list[str | None] = [None] * len(lines)
    fence = None
    i = 0
    while i < len(lines):
        line = lines[i]
        if fence is not None:
            if closes(fence, line):
                fence = None
            i += 1
            continue
        m = FENCE.match(line)
        if m:
            fence = m.group(1)
            i += 1
            continue
        if line.lstrip().startswith("<!--"):
            rest = line[line.index("<!--") + 4 :]
            while "-->" not in rest and i + 1 < len(lines):
                i += 1
                rest = lines[i]
            i += 1
            continue
        text, at, last = line, 0, i
        while c := CODE_OR_COMMENT.search(text, at):
            at = c.end()
            if c.group(0) != "<!--":
                continue
            end = text.find("-->", at)
            if end >= 0:
                end += 3
            else:
                j = i + 1
                while j < len(lines) and not BLOCK.match(lines[j]) and "-->" not in lines[j]:
                    j += 1
                if j == len(lines) or BLOCK.match(lines[j]):
                    break
                # It closes on line j: the lines between go on its paragraph,
                # so none of them is a box.
                last, end = j, len(text.rstrip("\r"))
            text = text[: c.start()] + " " * (end - c.start()) + text[end:]
            at = end
        out[i] = text
        i = last + 1
    return out


def boxes(body: str, repo: str = REPO) -> list[Box]:
    """Every box GitHub draws in `body`, and the numbers each names: not one
    in fenced code, in an HTML comment or in a quote, and no number in inline
    code or a comment, which GitHub doesn't link."""
    raw = body.split("\n")
    found = []
    for i, line in enumerate(shown(body)):
        m = BOX.fullmatch(line) if line is not None else None
        if not m:
            continue
        issues: list[int] = []
        elsewhere = False
        for ref in re.findall(REF, re.sub(INLINE_CODE, " ", m.group("text"))):
            n = number(ref, repo)
            if n is None:
                elsewhere = True
            elif n not in issues:
                issues.append(n)
        found.append(Box(i, raw[i], m.start("mark"), m.group("mark") != " ", " ".join(m.group("text").split()), issues, elsewhere))
    return found


def listed(numbers: list[int]) -> str:
    """`#1`, `#1 and #2`, `#1, #2 and #3`."""
    named = [f"#{n}" for n in numbers]
    return ", ".join(named[:-1]) + (" and " if len(named) > 1 else "") + named[-1]


def quoted(box: Box, code: bool = False) -> str:
    """The box's text in quotes, cut short at a word when it is long; with
    `code`, in inline code instead, where GitHub links no @mention and no
    `#n`, so quoting a box notifies no one again."""
    text = box.text if len(box.text) <= QUOTE else box.text[:QUOTE].rsplit(" ", 1)[0] + "…"
    if not code:
        return f"“{text}”"
    ticks = "`" * (max((len(r) for r in re.findall(r"`+", text)), default=0) + 1)
    pad = " " if text.startswith("`") or text.endswith("`") else ""
    return f"{ticks}{pad}{text}{pad}{ticks}"


def key(box: Box) -> str:
    """What the marker of the line saying a box was ticked names it by: its
    line, and its text hashed."""
    return f"line {box.line} ({hashlib.sha1(box.text.encode()).hexdigest()[:8]})"


def check_links(links: Links, get: Callable[[str], tuple[int, object]], repo: str = REPO) -> tuple[list[str], list[str]]:
    """What is wrong with the links (problems), and a line about each issue
    named (notes). `get(path)` is the API's (status, JSON)."""
    problems = list(links.problems)
    notes: list[str] = []
    if not links.named():
        if links.no_issue:
            notes.append(f"no issue: {links.no_issue}")
        elif links.no_issue == "":
            problems.append("The `No issue:` line gives no reason. Say why this PR needs no issue after it.")
        elif not problems:
            problems.append(
                "The body names no issue. Name each issue this PR finishes as `Closes #n` (one per keyword) "
                "and each it advances as `Refs #n`; or, for a PR with no issue, say why on a line that "
                "starts `No issue:`."
            )
        return problems, notes
    for n in links.named():
        closing = n in links.closes
        status, issue = get(f"repos/{repo}/issues/{n}")
        if status == 404 or status == 410:
            problems.append(f"#{n} doesn't exist in {repo}.")
        elif status != 200 or not isinstance(issue, dict):
            problems.append(f"#{n} couldn't be read (HTTP {status}): {issue}")
        elif issue.get("pull_request"):
            problems.append(f"#{n} is a pull request, not an issue. Name it without a keyword.")
        elif closing and issue.get("state") == "closed":
            problems.append(
                f"#{n} is closed already, so `Closes #{n}` would do nothing. Name it as `Refs #{n}`, "
                "or reopen it if this PR finishes it."
            )
        else:
            notes.append(f"#{n} ({issue.get('state')}): {'closes' if closing else 'refs'}: {issue.get('title')}")
    return problems, notes


# ─── the changelog ───────────────────────────────────────────────────────────


def changelog_warning(files: list[tuple[str, str]]) -> str | None:
    """A warning when `files` (path, status) change what a player or a reader
    sees and add or change no entry in changelog.d/; None otherwise."""
    seen = [
        f
        for f, _ in files
        if f.startswith(PLAYER_FACING) and not f.startswith(NOT_PLAYER_FACING) and not (f.startswith("apps/web/") and f.endswith(".md"))
    ]
    entry = any(f.startswith(FRAGMENTS) and f != FRAGMENTS_README and f.endswith(".md") and status != "removed" for f, status in files)
    if not seen or entry:
        return None
    shown = ", ".join(seen[:3]) + (f" and {len(seen) - 3} more" if len(seen) > 3 else "")
    return (
        f"This PR changes what a player or a reader of the site sees ({shown}) and adds no entry in "
        "changelog.d/. If a player, a listener or a reader can notice the change, write "
        "changelog.d/<topic>.md (changelog.d/README.md says how)."
    )


# ─── on merge ────────────────────────────────────────────────────────────────


class Api:
    """The GitHub REST API through `gh api`. Each call returns (status, JSON);
    a status gh doesn't print is 0."""

    def __init__(self, run: Callable[..., subprocess.CompletedProcess] = subprocess.run):
        self.run = run

    def call(self, path: str, method: str = "GET", data: dict | None = None) -> tuple[int, object]:
        args = ["gh", "api", "--method", method, path]
        if data is not None:
            args += ["--input", "-"]
        p = self.run(args, input=None if data is None else json.dumps(data), capture_output=True, text=True)
        if p.returncode == 0:
            return 200, json.loads(p.stdout) if p.stdout.strip() else None
        m = re.search(r"\(HTTP (\d{3})\)", p.stderr)
        return (int(m.group(1)) if m else 0), p.stderr.strip()

    def get(self, path: str) -> tuple[int, object]:
        return self.call(path)

    def all(self, path: str) -> tuple[int, list]:
        """Every page of a list."""
        items: list = []
        page = 1
        while True:
            sep = "&" if "?" in path else "?"
            status, data = self.get(f"{path}{sep}per_page=100&page={page}")
            if status != 200 or not isinstance(data, list):
                return (status if status != 200 else 0), items
            items += data
            if len(data) < 100:
                return 200, items
            page += 1

    def search(self, q: str) -> tuple[int, list]:
        """Every issue and PR the search API finds for `q`, page by page (it
        gives at most ten pages)."""
        items: list = []
        for page in range(1, 11):
            status, data = self.get(f"search/issues?q={quote(q, safe='')}&per_page=100&page={page}")
            if status != 200 or not isinstance(data, dict):
                return (status if status != 200 else 0), items
            got = data.get("items") or []
            items += got
            if len(got) < 100 or len(items) >= (data.get("total_count") or 0):
                break
        return 200, items

    def post(self, path: str, data: dict) -> tuple[int, object]:
        return self.call(path, "POST", data)

    def patch(self, path: str, data: dict) -> tuple[int, object]:
        return self.call(path, "PATCH", data)


@dataclass
class Pr:
    number: int
    title: str
    body: str
    author: str
    head_repo: str = REPO
    merged_at: str = ""  # GitHub's ISO time; "" when unknown


def earlier(when: str | None, than: str | None) -> bool:
    """`when` is before `than`, both GitHub's ISO times; False when either
    is unknown."""
    if not when or not than:
        return False
    return datetime.fromisoformat(when.replace("Z", "+00:00")) < datetime.fromisoformat(than.replace("Z", "+00:00"))


def on_merge(
    pr: Pr,
    api: Api,
    repo: str = REPO,
    dry_run: bool = False,
    sleep: Callable[[float], None] = time.sleep,
    log: Callable[[str], None] = print,
) -> int:
    """Comment on what `pr` advanced, close what it finished that GitHub
    didn't, and count each closed issue on its parent. 0, or 1 when a read
    or a write failed."""
    failed = False

    def say(n: int, lines: list[tuple[str, str]]) -> None:
        """Comment on #n each of `lines` (what, text) that no comment there
        has yet, in one comment: each line's marker is found again, so a run
        again posts only the lines an earlier run didn't."""
        nonlocal failed
        status, comments = api.all(f"repos/{repo}/issues/{n}/comments")
        if status != 200:
            log(f"#{n}: comments couldn't be read (HTTP {status}): not commented")
            failed = True
            return
        said = "\n".join(c.get("body") or "" for c in comments)
        new = [(what, text) for what, text in lines if MARK.format(what=what, pr=pr.number) not in said]
        if not new:
            log(f"#{n}: commented already")
            return
        text = "\n\n".join(t for _, t in new)
        if dry_run:
            log(f"#{n}: would comment: {text}")
            return
        marks = "\n".join(MARK.format(what=what, pr=pr.number) for what, _ in new)
        status, _ = api.post(f"repos/{repo}/issues/{n}/comments", {"body": f"{text}\n\n{marks}"})
        log(f"#{n}: commented: {text}" if status in (200, 201) else f"#{n}: the comment failed (HTTP {status})")
        failed = failed or status not in (200, 201)

    def is_issue(n: int, status: int, issue: object) -> bool:
        if status != 200 or not isinstance(issue, dict):
            log(f"#{n}: couldn't be read (HTTP {status}): skipped")
            return False
        if issue.get("pull_request"):
            log(f"#{n}: a pull request, not an issue: skipped")
            return False
        return True

    if pr.author == DEPENDABOT:
        log(f"#{pr.number} is Dependabot's: its body is the upstream release notes, and names no issue here")
        return 0
    if pr.head_repo.lower() != repo.lower():
        log(f"::warning::#{pr.number} came from a fork ({pr.head_repo or 'deleted'}), whose runs get a read-only token: update the issues it names by hand")
        return 0
    links = parse(pr.body, repo)
    if not links.named():
        log(f"#{pr.number} names no issue{': ' + links.no_issue if links.no_issue else ''}")
        return 0
    for p in links.problems:
        log(f"note: {p}")

    # The issues it closes, read until GitHub has closed them or POLLS * EVERY
    # seconds have gone by: GitHub closes them a moment after the merge.
    issues: dict[int, dict] = {}
    for n in links.closes:
        status, issue = api.get(f"repos/{repo}/issues/{n}")
        if not is_issue(n, status, issue):
            failed = failed or status not in (200, 404, 410)
            continue
        issues[n] = issue
    polls = 0
    while not dry_run and polls < POLLS and any(i.get("state") == "open" for i in issues.values()):
        sleep(EVERY)
        polls += 1
        for n in [n for n, i in issues.items() if i.get("state") == "open"]:
            status, again = api.get(f"repos/{repo}/issues/{n}")
            if status == 200 and isinstance(again, dict):
                issues[n] = again

    # An issue closed before the merge (by hand, or by another PR that named
    # it) wasn't closed with this PR, so its parent isn't told it was.
    closed: list[int] = []
    for n, issue in issues.items():
        if issue.get("state") == "closed":
            if earlier(issue.get("closed_at"), pr.merged_at):
                log(f"#{n}: closed before #{pr.number} merged, so not with it: its parent isn't told")
                continue
            log(f"#{n}: closed")
            closed.append(n)
            continue
        status, comments = api.all(f"repos/{repo}/issues/{n}/comments")
        if status == 200 and any(MARK.format(what="closed by", pr=pr.number) in (c.get("body") or "") for c in comments):
            log(f"#{n}: open, though this PR closed it once: someone reopened it, so it stays open")
            continue
        if dry_run:
            log(f"#{n}: open: would close it")
            closed.append(n)
            continue
        status, _ = api.patch(f"repos/{repo}/issues/{n}", {"state": "closed", "state_reason": "completed"})
        if status != 200:
            log(f"#{n}: open, and closing it failed (HTTP {status})")
            failed = True
            continue
        closed.append(n)
        say(
            n,
            [
                (
                    "closed by",
                    f"#{pr.number} merged and names this issue with `Closes`, but it was still open "
                    f"{polls * EVERY} seconds later, so it is closed here. GitHub closes one issue per keyword: "
                    "`Closes #a, #b` closes #a only.",
                )
            ],
        )

    # Each parent of an issue that closed, with the issues of its that did.
    parents: dict[int, list[int]] = {}
    for n in closed:
        status, parent = api.get(f"repos/{repo}/issues/{n}/parent")
        if status == 404:
            continue
        if status != 200 or not isinstance(parent, dict):
            log(f"#{n}: its parent couldn't be read (HTTP {status})")
            failed = True
            continue
        if not str(parent.get("repository_url", "")).lower().endswith(f"/repos/{repo.lower()}"):
            log(f"#{n}: its parent is in another repository: not told")
            continue
        parents.setdefault(parent["number"], []).append(n)

    lines: dict[int, list[tuple[str, str]]] = {}
    for p, children in parents.items():
        status, subs = api.all(f"repos/{repo}/issues/{p}/sub_issues")
        if status != 200:
            log(f"#{p}: its sub-issues couldn't be read (HTTP {status})")
            failed = True
            continue
        done = sum(1 for s in subs if s.get("state") == "closed" or s.get("number") in closed)
        lines.setdefault(p, []).append(("sub-issues", f"{listed(children)} closed with #{pr.number}. {done} of {len(subs)} sub-issues are closed."))
    for n in links.refs:
        if n in links.closes:
            continue
        status, issue = api.get(f"repos/{repo}/issues/{n}")
        if not is_issue(n, status, issue):
            failed = failed or status not in (200, 404, 410)
            continue
        lines.setdefault(n, []).insert(0, ("advanced by", f"Advanced by #{pr.number}, merged: {pr.title}"))

    # The boxes in other open issues that name what closed, ticked once
    # every issue each names is closed; said in the same comment.
    ticked, bad = tick(pr, closed, api, repo, dry_run, sleep, log)
    failed = failed or bad
    for n, said in ticked.items():
        lines.setdefault(n, []).extend(said)
    for n, said in lines.items():
        say(n, said)
    return 1 if failed else 0


def tick(
    pr: Pr,
    closed: list[int],
    api: Api,
    repo: str = REPO,
    dry_run: bool = False,
    sleep: Callable[[float], None] = time.sleep,
    log: Callable[[str], None] = print,
) -> tuple[dict[int, list[tuple[str, str]]], bool]:
    """Tick each box in another open issue that names an issue in `closed`,
    the issues that closed with `pr`, once every issue the box names is
    closed. A PR a box names is not an issue to wait for. Only the box's
    `[ ]` changes, and only when its line is as it was read: the body is
    read again just before the write, and a line changed since (or moved,
    or ticked by hand) is left. SETTLE seconds after the write it is
    read again, and a box another write put back is ticked again, up to
    TRIES writes. Returns the lines (what, text) to say on each issue edited,
    one per box ticked, and whether a read or a write failed."""
    failed = False
    # The open issues whose bodies name one that closed. The search matches
    # the number anywhere in a body, so each body is read and parsed.
    found: list[int] = []
    for n in closed:
        status, items = api.search(f"repo:{repo} is:issue is:open #{n} in:body")
        if status != 200:
            log(f"#{n}: the issues naming it couldn't be searched (HTTP {status}): no box ticked for it")
            failed = True
            continue
        found += [i["number"] for i in items if i["number"] not in closed + found and not i.get("pull_request")]

    # What each number a box names is: "open" or "closed", None for what
    # isn't an issue (a PR, or no such issue), "?" when it couldn't be read.
    kinds: dict[int, str | None] = {n: "closed" for n in closed}

    def kind(n: int) -> str | None:
        if n not in kinds:
            status, issue = api.get(f"repos/{repo}/issues/{n}")
            if status == 200 and isinstance(issue, dict):
                kinds[n] = None if issue.get("pull_request") else issue.get("state")
            elif status in (404, 410):
                kinds[n] = None
            else:
                log(f"#{n}: couldn't be read (HTTP {status})")
                kinds[n] = "?"
        return kinds[n]

    def write(m: int, due: list[Box]) -> list[Box]:
        """Tick `due` in #m's body as it is now, and see that the ticks
        held: the boxes ticked."""
        nonlocal failed
        done: list[Box] = []
        writes = 0
        while True:
            if writes:
                sleep(SETTLE)
            status, issue = api.get(f"repos/{repo}/issues/{m}")
            if status != 200 or not isinstance(issue, dict):
                if writes:
                    # The write landed; whether another put a box back since
                    # isn't known.
                    log(f"#{m}: couldn't be read again after the write (HTTP {status}): whether its ticks held isn't known")
                    done += due
                else:
                    log(f"#{m}: couldn't be read again (HTTP {status}): its boxes aren't ticked")
                failed = True
                return done
            body = issue.get("body") or ""
            lines = body.split("\n")
            if not writes:
                # Only a line still as it was read: a person may have
                # changed it, moved it or ticked it by hand.
                still = {(b.line, b.raw) for b in boxes(body, repo) if not b.ticked}
                for box in [b for b in due if (b.line, b.raw) not in still]:
                    log(f"#{m}: {quoted(box)} changed since it was read: not ticked")
                due = [b for b in due if (b.line, b.raw) in still]
            else:
                # Another run's write, built on a read from before this
                # write, puts a box back to `[ ]` and leaves its line as it was.
                back = [b for b in due if b.line < len(lines) and lines[b.line] == b.raw]
                done += [b for b in due if b not in back]
                due = back
                if due and writes == TRIES:
                    for box in due:
                        log(f"#{m}: {quoted(box)} was put back by another write each of the {TRIES} times it was ticked: not ticked")
                    failed = True
                    return done
                for box in due:
                    log(f"#{m}: {quoted(box)} was put back by another write: ticked again")
            if not due:
                return done
            for box in due:
                lines[box.line] = box.raw[: box.mark] + "x" + box.raw[box.mark + 1 :]
            status, _ = api.patch(f"repos/{repo}/issues/{m}", {"body": "\n".join(lines)})
            if status != 200:
                log(f"#{m}: ticking {len(due)} box{'es' if len(due) > 1 else ''} failed (HTTP {status})")
                failed = True
                return done
            writes += 1

    said: dict[int, list[tuple[str, str]]] = {}
    for m in sorted(found):
        status, issue = api.get(f"repos/{repo}/issues/{m}")
        if status != 200 or not isinstance(issue, dict):
            log(f"#{m}: couldn't be read (HTTP {status}): its boxes aren't ticked")
            failed = True
            continue
        due: list[Box] = []
        for box in boxes(issue.get("body") or "", repo):
            if box.ticked or not any(n in closed for n in box.issues):
                continue
            if box.elsewhere:
                log(f"#{m}: {quoted(box)} names an issue in another repository: not ticked")
                continue
            states = {n: kind(n) for n in box.issues}
            if "?" in states.values():
                log(f"#{m}: {quoted(box)} names an issue that couldn't be read: not ticked")
                failed = True
                continue
            waiting = [n for n, s in states.items() if s == "open"]
            if waiting:
                log(f"#{m}: {quoted(box)} waits for {listed(waiting)}, still open")
                continue
            due.append(box)
        if not due:
            continue
        if dry_run:
            for box in due:
                log(f"#{m}: would tick {quoted(box)}")
        else:
            due = write(m, due)
            for box in due:
                log(f"#{m}: ticked {quoted(box)}")
        for box in due:
            closers = listed(sorted(n for n in box.issues if n in closed))
            said.setdefault(m, []).append(
                (
                    f"ticked {key(box)}",
                    f"#{pr.number} closed {closers}, and every issue this box names is closed now, so it is ticked: {quoted(box, code=True)}.",
                )
            )
    return said, failed


# ─── the command line ────────────────────────────────────────────────────────


def annotate(kind: str, title: str, text: str) -> str:
    """A GitHub Actions annotation, its text escaped as the runner wants."""
    esc = text.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
    return f"::{kind} title={title}::{esc}"


def summary(lines: list[str]) -> None:
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if path:
        with open(path, "a") as f:
            f.write("\n".join(lines) + "\n\n")


def read_pr(api: Api, repo: str, n: int | None) -> Pr:
    """PR n through the API, or the PR this run's event is about."""
    if n is None:
        return Pr(
            number=int(os.environ.get("PR_NUMBER") or 0),
            title=os.environ.get("PR_TITLE", ""),
            body=os.environ.get("PR_BODY", ""),
            author=os.environ.get("PR_AUTHOR", ""),
            head_repo=os.environ.get("PR_HEAD_REPO", repo),
            merged_at=os.environ.get("PR_MERGED_AT", ""),
        )
    status, data = api.get(f"repos/{repo}/pulls/{n}")
    if status != 200 or not isinstance(data, dict):
        sys.exit(f"PR #{n} couldn't be read (HTTP {status}): {data}")
    head = (data.get("head") or {}).get("repo") or {}
    return Pr(
        n,
        data.get("title") or "",
        data.get("body") or "",
        (data.get("user") or {}).get("login", ""),
        head.get("full_name", ""),
        data.get("merged_at") or "",
    )


def run_title(pr: Pr, ci: bool) -> bool:
    problems = check_title(pr.title)
    print(f"title: {pr.title}")
    for p in problems:
        print(annotate("error", "PR title", p) if ci else f"  ✗ {p}")
    if not problems:
        print("  ok")
    summary([f"**Title:** {'ok' if not problems else problems[0]}"])
    return not problems


def run_links(pr: Pr, api: Api, repo: str, ci: bool) -> bool:
    if pr.author == DEPENDABOT:
        print("links: Dependabot's PR, whose body is the upstream release notes: not checked")
        summary(["**Issues:** Dependabot's PR, not checked"])
        return True
    links = parse(pr.body, repo)
    problems, notes = check_links(links, api.get, repo)
    print(f"links: closes {', '.join(f'#{n}' for n in links.closes) or 'none'}; refs {', '.join(f'#{n}' for n in links.refs) or 'none'}")
    for n in notes:
        print(f"  {n}")
    for p in problems:
        print(annotate("error", "PR issue links", p) if ci else f"  ✗ {p}")
    if not problems:
        print("  ok")
    summary(["**Issues:**"] + [f"- {n}" for n in notes] + [f"- ✗ {p}" for p in problems])
    return not problems


def run_changelog(pr: Pr, api: Api, repo: str, ci: bool) -> bool:
    status, files = api.all(f"repos/{repo}/pulls/{pr.number}/files")
    if status != 200:
        print(f"changelog: the PR's files couldn't be read (HTTP {status}): not checked")
        return True
    warning = changelog_warning([(f["filename"], f.get("status", "")) for f in files])
    print("changelog:")
    print(f"  {annotate('warning', 'Changelog', warning) if ci else '! ' + warning}" if warning else "  ok")
    summary([f"**Changelog:** {warning or 'ok'}"])
    return True


def main(argv: list[str], api: Api | None = None) -> int:
    ap = argparse.ArgumentParser(prog="pr_checks.py", description=__doc__.split("\n\n")[0])
    ap.add_argument("what", choices=["title", "links", "changelog", "check", "merged"])
    ap.add_argument("--pr", type=int, help="read PR N with gh, not from the environment")
    ap.add_argument("--repo", default=os.environ.get("GITHUB_REPOSITORY") or REPO)
    ap.add_argument("--dry-run", action="store_true", help="merged: say what it would do, and write nothing")
    args = ap.parse_args(argv)
    api = api or Api()
    ci = os.environ.get("GITHUB_ACTIONS") == "true"
    pr = read_pr(api, args.repo, args.pr)
    if args.what == "merged":
        return on_merge(pr, api, args.repo, dry_run=args.dry_run)
    ok = True
    if args.what in ("title", "check"):
        ok = run_title(pr, ci) and ok
    if args.what in ("links", "check"):
        ok = run_links(pr, api, args.repo, ci) and ok
    if args.what in ("changelog", "check"):
        ok = run_changelog(pr, api, args.repo, ci) and ok
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
