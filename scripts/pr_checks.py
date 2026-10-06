#!/usr/bin/env python3
"""What a pull request owes before the merge queue takes it, and what its
merge owes the issues it names (`.github/workflows/pr-checks.yml`;
docs/process.md § Pull requests).

    python3 scripts/pr_checks.py title       the title is a conventional subject
    python3 scripts/pr_checks.py links       the body names its issues, one per keyword
    python3 scripts/pr_checks.py changelog   a warning: a player-facing change, no entry
    python3 scripts/pr_checks.py merged      on merge: comment, close, tell the parents

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
closed; each `Refs` issue gets a comment naming the PR. One
comment per issue per PR, each of its lines carrying a marker of its own, so a
run again adds only what an earlier run left out: a line a failed run couldn't
write is posted, and none is posted twice. GitHub closes linked issues a moment
after the merge, so an issue still open is read again for up to POLLS * EVERY
seconds before it is closed here.

The GitHub API is read and written through `gh api` (GH_TOKEN in CI).
Python 3 standard library only.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Callable

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
# `sub-issues` (a parent's count of them closed).
MARK = "<!-- pr-checks: {what} #{pr} -->"
POLLS = 6
EVERY = 10  # seconds


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
    if m.group("gap"):
        return "no space goes between the type and the `(`"
    if scope is not None and not scope.strip():
        return "the `()` is empty; name a scope in it, or leave it out"
    if scope is not None and re.search(r"\s", scope):
        return "a scope has no spaces in it"
    if m.group("before"):
        return "no space goes before the colon"
    if not m.group("subject").strip():
        return "the subject after the colon is missing"
    return "one space goes after the colon, then the subject"


# ─── the links ───────────────────────────────────────────────────────────────


def readable(body: str) -> str:
    """`body` without what GitHub doesn't read as a link: HTML comments,
    fenced code, quoted lines and inline code."""
    text = re.sub(r"<!--.*?-->", " ", body.replace("\r\n", "\n"), flags=re.DOTALL)
    kept, fence = [], None
    for line in text.split("\n"):
        m = re.match(r"[ \t]*(`{3,}|~{3,})", line)
        if fence is None and m:
            fence = m.group(1)
            continue
        if fence is not None:
            if m and m.group(1)[0] == fence[0] and len(m.group(1)) >= len(fence) and not line.strip()[len(m.group(1)) :].strip():
                fence = None
            continue
        if line.lstrip().startswith(">"):
            continue
        kept.append(re.sub(r"(`+)(?:(?!\1).)+?\1", " ", line))
    return "\n".join(kept)


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
        named = ", ".join(f"#{c}" for c in children[:-1]) + (" and " if len(children) > 1 else "") + f"#{children[-1]}"
        lines.setdefault(p, []).append(("sub-issues", f"{named} closed with #{pr.number}. {done} of {len(subs)} sub-issues are closed."))
    for n in links.refs:
        if n in links.closes:
            continue
        status, issue = api.get(f"repos/{repo}/issues/{n}")
        if not is_issue(n, status, issue):
            failed = failed or status not in (200, 404, 410)
            continue
        lines.setdefault(n, []).insert(0, ("advanced by", f"Advanced by #{pr.number}, merged: {pr.title}"))
    for n, said in lines.items():
        say(n, said)
    return 1 if failed else 0


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
