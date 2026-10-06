#!/usr/bin/env python3
"""The PR checks' tests (`scripts/pr_checks.py`): the title, the links a body
names and what fails among them, the changelog's warning, and what a merge
does to the issues it names.

    python3 scripts/test_pr_checks.py      (run by `make dev-check`)

No test reaches the network: the GitHub API is a fake that holds issues
(their bodies too), comments and parents in memory, searches the bodies,
records every write, and fails a read or a write when a test asks, and `gh`
never runs
(the API wrapper's own tests hand it a stand-in for `subprocess.run`). The
last case reads the real pull request template. Python 3 standard library
only.
"""

import contextlib
import io
import json
import os
import pathlib
import re
import subprocess
import sys
import unittest
import unittest.mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import pr_checks as P  # noqa: E402

ROOT = pathlib.Path(HERE).parent
REPO = "alexnodeland/auracle"


class Fake:
    """The GitHub API in memory: issues by number ({state, title, body, pr,
    parent}), each issue's comments, and the writes made.
    `closes_after` closes an issue (as GitHub does after a merge) once it
    has been read that many times. `edits` gives an issue the body a person
    saves just after the job's first read of it. `fail` fails a path's
    every read, `fail_reads` an issue's reads by count ({n: {2}}: the
    second), `fail_patch` the writes of an issue's body. `reverts` puts an
    issue's body back after each of its first k writes ({n: k}), as another
    write built on an older read does."""

    def __init__(self, issues=None, comments=None, closes_after=None, fail=(), lag=False, edits=None, fail_reads=None, fail_patch=(), reverts=None):
        self.issues = {n: dict(i) for n, i in (issues or {}).items()}
        # With `lag`, a parent's list of sub-issues gives each one's state
        # from before any write, as GitHub's can for a moment.
        self.before = {n: i.get("state", "open") for n, i in self.issues.items()} if lag else None
        self.comments = {n: list(c) for n, c in (comments or {}).items()}
        self.closes_after = dict(closes_after or {})
        self.edits = dict(edits or {})
        self.reads = {}
        self.fail = set(fail)
        self.fail_reads = dict(fail_reads or {})
        self.fail_patch = set(fail_patch)
        self.reverts = dict(reverts or {})
        self.writes = []
        self.files = []

    def _issue(self, n):
        i = self.issues[n]
        out = {
            "number": n,
            "title": i.get("title", f"issue {n}"),
            "state": i.get("state", "open"),
            "body": i.get("body", ""),
            "closed_at": i.get("closed_at"),
            "repository_url": f"https://api.github.com/repos/{i.get('repo', REPO)}",
        }
        if i.get("pr"):
            out["pull_request"] = {"url": "…"}
        return out

    def get(self, path):
        if path in self.fail:
            return 502, "gh: Bad Gateway (HTTP 502)"
        parts = path.split("?")[0].split("/")
        if parts[-1] == "files":
            return 200, list(self.files)
        n = int(parts[4])
        if n not in self.issues:
            return 404, "gh: Not Found (HTTP 404)"
        if len(parts) == 5:
            self.reads[n] = self.reads.get(n, 0) + 1
            if self.reads[n] in self.fail_reads.get(n, ()):
                return 502, "gh: Bad Gateway (HTTP 502)"
            if n in self.closes_after and self.reads[n] > self.closes_after[n]:
                self.issues[n]["state"] = "closed"
            read = self._issue(n)
            if n in self.edits:
                self.issues[n]["body"] = self.edits.pop(n)
            return 200, read
        if parts[5] == "parent":
            p = self.issues[n].get("parent")
            return (404, "gh: No parent issue found (HTTP 404)") if p is None else (200, self._issue(p))
        if parts[5] == "sub_issues":
            subs = [self._issue(c) for c, i in self.issues.items() if i.get("parent") == n]
            for s in subs if self.before else []:
                s["state"] = self.before[s["number"]]
            return 200, subs
        if parts[5] == "comments":
            return 200, [{"body": b} for b in self.comments.get(n, [])]
        raise AssertionError(path)

    def all(self, path):
        return self.get(path)

    def search(self, q):
        """The search API as loose as GitHub's: an open issue matches when
        its body has the number anywhere, as a word, `#` or not."""
        if f"search/issues?q={q}" in self.fail:
            return 502, []
        n = re.search(r"#(\d+)", q).group(1)
        return 200, [
            self._issue(m)
            for m, i in self.issues.items()
            if not i.get("pr") and i.get("state", "open") == "open" and re.search(rf"\b{n}\b", i.get("body", ""))
        ]

    def post(self, path, data):
        n = int(path.split("/")[4])
        self.writes.append(("comment", n, data["body"]))
        self.comments.setdefault(n, []).append(data["body"])
        return 201, {}

    def patch(self, path, data):
        n = int(path.split("/")[4])
        if "body" in data:
            if n in self.fail_patch:
                return 502, "gh: Bad Gateway (HTTP 502)"
            self.writes.append(("body", n, data["body"]))
            if self.reverts.get(n):
                self.reverts[n] -= 1
            else:
                self.issues[n]["body"] = data["body"]
        else:
            self.writes.append(("close", n, data["state"]))
            self.issues[n]["state"] = data["state"]
        return 200, {}


def merge(body, api, number=300, title="tests: a change", author="alexnodeland", head=REPO, merged_at="", dry=False, sleep=None):
    """Run the merge job on a PR with `body` against `api`: its exit code,
    its log, and how many times it slept. `sleep` stands for the time that
    passes while it sleeps."""
    log, slept = [], []

    def nap(seconds):
        slept.append(seconds)
        if sleep:
            sleep(seconds)

    code = P.on_merge(P.Pr(number, title, body, author, head, merged_at), api, REPO, dry_run=dry, sleep=nap, log=log.append)
    return code, log, len(slept)


class Title(unittest.TestCase):
    def test_a_type_an_optional_scope_and_bang_then_a_subject_pass(self):
        for t in [
            "fix(web): a toast is never dropped",
            "tests: three flakes back in the gate",
            "tests(grammar): every audit finding fixed",
            "ci: two speeds",
            "feat!: a breaking change",
            "perf(ci)!: one runner",
            "release: cut 0.3.0",
            "ci: bump the actions group across 7 directories with 8 updates",
            "tests: bump @playwright/test from 1.56.1 to 1.63.0 in /tests/web",
        ]:
            self.assertEqual(P.check_title(t), [], t)

    def test_every_type_in_the_list_passes(self):
        for kind in P.TYPES:
            self.assertEqual(P.check_title(f"{kind}: a subject"), [], kind)

    def test_a_title_with_no_prefix_fails_and_says_what_is_expected(self):
        (problem,) = P.check_title("PATCH keeps the quiet window after an open")
        self.assertIn("no conventional prefix", problem)
        self.assertIn("`<type>(<scope>): <subject>`", problem)
        self.assertIn("fix(web):", problem)

    def test_an_unknown_type_fails_and_offers_it_as_the_scope(self):
        (problem,) = P.check_title("wip: half of it")
        self.assertIn("`wip` is not one of the types", problem)
        (problem,) = P.check_title("tokens: every styled page is checked for color")
        self.assertIn("`<type>(tokens): <subject>`", problem)

    def test_a_type_with_capitals_fails_with_its_lower_case(self):
        for title, kind in [("CI: read Rust's stable channel whole", "ci"), ("Fix(web): a toast", "fix")]:
            (problem,) = P.check_title(title)
            self.assertIn(f"has capital letters; types are lower case: `{kind}`", problem, title)

    def test_a_prefix_almost_right_says_which_part_is_off(self):
        for title, off in [
            ("fix:no space", "one space goes after the colon"),
            ("fix(web):  two spaces", "one space goes after the colon"),
            ("fix: ", "the subject after the colon is missing"),
            ("fix (web): a space before the scope", "no space goes between the type and the `(`"),
            ("fix(): an empty scope", "the `()` is empty"),
            ("fix(we b): a space in the scope", "a scope has no spaces in it"),
            ("fix(web) : a space before the colon", "no space goes before the colon"),
            ("fix : a space before the colon", "no space goes before the colon"),
            ("feat !: a space before the bang", "no space goes before the `!`"),
        ]:
            (problem,) = P.check_title(title)
            self.assertIn(f"is almost right: {off}", problem, title)

    def test_what_isnt_a_typed_prefix_has_none(self):
        for title in ["(web): no type", "PATCH keeps the quiet window", "wip (x): y"]:
            (problem,) = P.check_title(title)
            self.assertIn("has no conventional prefix", problem, title)

    def test_githubs_revert_title_fails_with_the_title_to_give_it(self):
        (problem,) = P.check_title('Revert "fix(web): a toast is never dropped"')
        self.assertIn("`revert: fix(web): a toast is never dropped`", problem)
        self.assertEqual(P.check_title("revert: fix(web): a toast is never dropped"), [])


class Parse(unittest.TestCase):
    def test_every_closing_keyword_in_any_case(self):
        for kw in ["close", "closes", "closed", "fix", "fixes", "fixed", "resolve", "resolves", "resolved", "CLOSES", "Fixes"]:
            links = P.parse(f"{kw} #12", REPO)
            self.assertEqual((links.closes, links.refs, links.problems), ([12], [], []), kw)

    def test_refs_and_ref_advance_an_issue(self):
        for kw in ["Refs", "refs", "Ref", "REFS"]:
            self.assertEqual(P.parse(f"{kw} #177", REPO).refs, [177], kw)

    def test_a_colon_after_the_keyword(self):
        self.assertEqual(P.parse("Closes: #5", REPO).closes, [5])

    def test_one_keyword_per_issue_passes(self):
        links = P.parse("Closes #174, closes #176 and fixes #182.\nRefs #177.", REPO)
        self.assertEqual((links.closes, links.refs, links.problems), ([174, 176, 182], [177], []))

    def test_a_comma_list_after_a_closing_keyword_fails_with_the_fix(self):
        links = P.parse("Closes #174, #176, #182. Refs #177.", REPO)
        (problem,) = links.problems
        self.assertIn("names 3 issues after one `Closes`", problem)
        self.assertIn("close #174 only", problem)
        self.assertIn("`Closes #174, closes #176, closes #182`", problem)
        # The merge job still closes every one the author meant.
        self.assertEqual((links.closes, links.refs), ([174, 176, 182], [177]))

    def test_an_and_list_after_a_closing_keyword_fails(self):
        for body in ["Fixes #1 and #2", "fixes #1, and #2", "Resolves #1 & #2", "Closes #1 #2", "Closes #1; #2"]:
            (problem,) = P.parse(body, REPO).problems
            self.assertIn("names 2 issues", problem, body)

    def test_a_list_that_goes_on_to_the_next_line_fails(self):
        for body in ["Closes #3,\n#4", "Closes #3, and\n#4", "Fixes #3 and\n#4", "Closes #3,\r\n#4"]:
            links = P.parse(body, REPO)
            (problem,) = links.problems
            self.assertIn("names 2 issues", problem, body)
            self.assertNotIn("\n", problem, body)
            self.assertEqual(links.closes, [3, 4], body)

    def test_one_issue_per_line_is_not_a_list(self):
        links = P.parse("Closes #3\n#4 is next.\nCloses #5,\ncloses #7;\nRefs #6", REPO)
        self.assertEqual((links.closes, links.refs, links.problems), ([3, 5, 7], [6], []))

    def test_a_list_after_refs_is_fine(self):
        links = P.parse("Refs #181, #178 and #177", REPO)
        self.assertEqual((links.refs, links.problems), ([181, 178, 177], []))

    def test_the_url_and_the_repository_forms(self):
        links = P.parse(
            "Closes https://github.com/alexnodeland/auracle/issues/216\nFixes alexnodeland/auracle#12\nRefs https://github.com/AlexNodeland/Auracle/issues/177",
            REPO,
        )
        self.assertEqual((links.closes, links.refs), ([216, 12], [177]))

    def test_another_repositorys_issue_is_not_a_link_here(self):
        links = P.parse("Fixes actions/setup-python#1335\nCloses https://github.com/rhysd/actionlint/issues/654", REPO)
        self.assertEqual(links.named(), [])

    def test_code_quotes_and_html_comments_are_not_read(self):
        body = "\n".join(
            [
                "<!-- Closes #1, #2: an example in the template -->",
                "```",
                "Closes #3, #4",
                "```",
                "  ~~~text",
                "  Fixes #5",
                "  ~~~",
                "Run `gh issue close #6` or ``fixes #7``.",
                "> Closes #8, #9 (a quote)",
                "  > fixes #10",
                "Refs #11",
            ]
        )
        links = P.parse(body, REPO)
        self.assertEqual((links.closes, links.refs, links.problems), ([], [11], []))

    def test_a_keyword_reads_anywhere_but_needs_a_word_boundary(self):
        links = P.parse("This also fixes #20 in passing; the prefixes #21 and suffixes #22 are not keywords.", REPO)
        self.assertEqual(links.closes, [20])

    def test_a_bare_mention_or_an_empty_template_line_is_not_a_link(self):
        links = P.parse("#174 had no app bug (#168, #172).\n\nCloses #\nRefs #", REPO)
        self.assertEqual(links.named(), [])

    def test_no_issue_line(self):
        self.assertEqual(P.parse("## Why\n\nNo issue: a typo seen in passing", REPO).no_issue, "a typo seen in passing")
        self.assertEqual(P.parse("- no issue: a bump", REPO).no_issue, "a bump")
        self.assertEqual(P.parse("No issue:", REPO).no_issue, "")
        self.assertIsNone(P.parse("There is no issue: really", REPO).no_issue)

    def test_a_body_saved_with_crlf_reads_as_with_lf(self):
        # GitHub's web editor saves a body with CRLF line ends.
        self.assertEqual(P.parse("## Why\r\n\r\nNo issue: a typo\r\n", REPO).no_issue, "a typo")
        self.assertEqual(P.parse("No issue:\r\nThe rest.", REPO).no_issue, "")
        links = P.parse("```\r\nCloses #1, #2\r\n```\r\nCloses #3\r\n", REPO)
        self.assertEqual((links.closes, links.problems), ([3], []))


class Links(unittest.TestCase):
    def check(self, body, fake):
        return P.check_links(P.parse(body, REPO), fake.get, REPO)

    def test_open_issues_pass_and_are_named(self):
        fake = Fake({5: {"title": "a bug"}, 177: {"title": "CI"}})
        problems, notes = self.check("Closes #5\nRefs #177", fake)
        self.assertEqual(problems, [])
        self.assertEqual(notes, ["#5 (open): closes: a bug", "#177 (open): refs: CI"])

    def test_a_missing_issue_fails(self):
        problems, _ = self.check("Closes #9999", Fake({}))
        self.assertEqual(problems, [f"#9999 doesn't exist in {REPO}."])

    def test_a_pull_request_named_as_an_issue_fails(self):
        problems, _ = self.check("Refs #206", Fake({206: {"pr": True}}))
        self.assertIn("#206 is a pull request", problems[0])

    def test_closing_a_closed_issue_fails_but_refs_to_one_passes(self):
        fake = Fake({5: {"state": "closed"}})
        problems, _ = self.check("Closes #5", fake)
        self.assertIn("#5 is closed already", problems[0])
        self.assertIn("`Refs #5`", problems[0])
        self.assertEqual(self.check("Refs #5", fake)[0], [])

    def test_an_api_error_fails_and_says_so(self):
        fake = Fake({5: {}}, fail={f"repos/{REPO}/issues/5"})
        problems, _ = self.check("Closes #5", fake)
        self.assertIn("#5 couldn't be read (HTTP 502)", problems[0])

    def test_a_body_with_no_issue_fails_unless_it_says_why(self):
        problems, _ = self.check("## What\n\nA change.", Fake())
        self.assertIn("names no issue", problems[0])
        self.assertIn("`No issue:`", problems[0])
        self.assertEqual(self.check("No issue: a typo", Fake()), ([], ["no issue: a typo"]))
        problems, _ = self.check("No issue:", Fake())
        self.assertIn("gives no reason", problems[0])

    def test_dependabots_links_are_not_checked(self):
        pr = P.Pr(123, "ci: bump the actions group", "Fixes #1 and #2, from the release notes", P.DEPENDABOT)
        with contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertTrue(P.run_links(pr, Fake(), REPO, ci=False))
        self.assertIn("not checked", out.getvalue())


class Changelog(unittest.TestCase):
    def test_a_player_facing_change_with_no_entry_warns(self):
        for f in ["apps/web/main.js", "www/docs/src/levels.md", "www/landing/index.html"]:
            warning = P.changelog_warning([(f, "modified")])
            self.assertIn(f, warning or "", f)
            self.assertIn("changelog.d/<topic>.md", warning)

    def test_an_entry_beside_it_answers_it(self):
        self.assertIsNone(P.changelog_warning([("apps/web/main.js", "modified"), ("changelog.d/toasts.md", "added")]))
        self.assertIsNone(P.changelog_warning([("apps/web/main.js", "modified"), ("changelog.d/toasts.md", "modified")]))

    def test_the_readme_or_a_removed_entry_is_no_entry(self):
        self.assertIsNotNone(P.changelog_warning([("apps/web/main.js", "modified"), ("changelog.d/README.md", "modified")]))
        self.assertIsNotNone(P.changelog_warning([("apps/web/main.js", "modified"), ("changelog.d/old.md", "removed")]))

    def test_what_no_player_or_reader_sees_does_not_warn(self):
        for f in ["apps/web/tests/worker-lanes.test.mjs", "apps/web/AGENTS.md", "docs/process.md", "crates/auracle-taste/src/lib.rs", "tests/web/smoke.spec.js", "www/reference/src/x.md"]:
            self.assertIsNone(P.changelog_warning([(f, "modified")]), f)

    def test_a_long_list_is_cut_short(self):
        warning = P.changelog_warning([(f"apps/web/{n}.js", "modified") for n in "abcde"])
        self.assertIn("apps/web/c.js and 2 more", warning)

    def test_the_check_warns_and_never_fails(self):
        fake = Fake()
        fake.files = [{"filename": "apps/web/main.js", "status": "modified"}]
        with contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertTrue(P.run_changelog(P.Pr(1, "", "", ""), fake, REPO, ci=True))
        self.assertIn("::warning title=Changelog::", out.getvalue())


class OnMerge(unittest.TestCase):
    def test_refs_issues_get_one_comment_and_a_run_again_adds_none(self):
        fake = Fake({177: {}, 178: {}})
        code, _, _ = merge("Refs #177, #178", fake, title="ci: two speeds")
        self.assertEqual(code, 0)
        self.assertEqual([(w[0], w[1]) for w in fake.writes], [("comment", 177), ("comment", 178)])
        self.assertIn("Advanced by #300, merged: ci: two speeds", fake.writes[0][2])
        self.assertIn("<!-- pr-checks: advanced by #300 -->", fake.writes[0][2])
        code, log, _ = merge("Refs #177, #178", fake)
        self.assertEqual((code, len(fake.writes)), (0, 2))
        self.assertIn("#177: commented already", log)

    def test_an_issue_github_closed_is_left_alone(self):
        fake = Fake({5: {"state": "closed"}})
        code, log, slept = merge("Closes #5", fake)
        self.assertEqual((code, fake.writes, slept), (0, [], 0))
        self.assertIn("#5: closed", log)

    def test_an_issue_github_closes_a_moment_later_is_waited_for_not_closed_here(self):
        fake = Fake({5: {}}, closes_after={5: 2})
        code, _, slept = merge("Closes #5", fake)
        self.assertEqual((code, fake.writes, slept), (0, [], 2))

    def test_an_issue_github_didnt_close_is_closed_here_with_a_comment_once(self):
        fake = Fake({174: {"state": "closed"}, 176: {}, 182: {}})
        code, _, slept = merge("Closes #174, #176, #182.", fake)
        self.assertEqual((code, slept), (0, P.POLLS))
        self.assertEqual([(w[0], w[1]) for w in fake.writes], [("close", 176), ("comment", 176), ("close", 182), ("comment", 182)])
        self.assertIn("still open 60 seconds later", fake.writes[1][2])
        self.assertIn("<!-- pr-checks: closed by #300 -->", fake.writes[1][2])
        # Run again: everything is closed, nothing is written.
        merge("Closes #174, #176, #182.", fake)
        self.assertEqual(len(fake.writes), 4)

    def test_an_issue_reopened_after_this_pr_closed_it_stays_open(self):
        fake = Fake({5: {}}, comments={5: ["…\n\n<!-- pr-checks: closed by #300 -->"]})
        code, log, _ = merge("Closes #5", fake)
        self.assertEqual((code, fake.writes), (0, []))
        self.assertTrue(any("stays open" in line for line in log))

    def test_a_parent_hears_of_each_sub_issue_that_closed_with_its_count(self):
        fake = Fake(
            {
                177: {"title": "CI"},
                160: {"parent": 177, "state": "closed"},
                185: {"parent": 177, "state": "closed"},
                161: {"parent": 177, "state": "closed"},
                170: {"parent": 177},
                186: {"parent": 177},
                5: {"state": "closed"},
            },
            lag=True,
        )
        code, _, _ = merge("Closes #160, closes #185, closes #186, closes #5.", fake, title="tests: three flakes")
        self.assertEqual(code, 0)
        comments = [w for w in fake.writes if w[0] == "comment" and w[1] == 177]
        self.assertEqual(len(comments), 1)
        # #186, closed here, counts though the list still has it open.
        self.assertIn("#160, #185 and #186 closed with #300. 4 of 5 sub-issues are closed.", comments[0][2])

    def test_an_issue_closed_before_the_merge_isnt_told_to_its_parent_as_closed_with_it(self):
        # #5 was closed an hour before #300 merged (another PR of the batch
        # named it, or someone closed it by hand); GitHub closed #6 with the
        # merge, in the same second.
        fake = Fake(
            {
                177: {},
                5: {"parent": 177, "state": "closed", "closed_at": "2026-10-06T11:00:00Z"},
                6: {"parent": 177, "state": "closed", "closed_at": "2026-10-06T12:00:00Z"},
            }
        )
        code, log, _ = merge("Closes #5\nCloses #6", fake, merged_at="2026-10-06T12:00:00Z")
        self.assertEqual(code, 0)
        (comment,) = [w[2] for w in fake.writes if w[1] == 177]
        self.assertIn("#6 closed with #300. 2 of 2 sub-issues are closed.", comment)
        self.assertNotIn("#5", comment)
        self.assertIn("#5: closed before #300 merged, so not with it: its parent isn't told", log)

    def test_with_no_merge_time_a_closed_issue_counts_as_closed_with_the_pr(self):
        fake = Fake({177: {}, 5: {"parent": 177, "state": "closed", "closed_at": "2026-10-06T11:00:00Z"}})
        merge("Closes #5", fake)
        (comment,) = [w[2] for w in fake.writes if w[1] == 177]
        self.assertIn("#5 closed with #300", comment)

    def test_a_parent_that_is_also_refd_gets_one_comment_with_both(self):
        fake = Fake({177: {}, 216: {"parent": 177, "state": "closed"}})
        merge("Closes #216\nRefs #177", fake)
        (comment,) = [w for w in fake.writes if w[1] == 177]
        self.assertIn("Advanced by #300", comment[2])
        self.assertIn("#216 closed with #300", comment[2])
        self.assertIn("1 of 1 sub-issues", comment[2])

    def test_a_run_again_posts_the_line_a_failed_run_left_out_and_only_that(self):
        # #216 closed with this PR, and its parent #177 is also a `Refs`
        # issue: one comment would carry both lines. The parent's sub-issues
        # can't be read on the first run, so only the `Refs` line is posted.
        subs = f"repos/{REPO}/issues/177/sub_issues"
        fake = Fake({177: {}, 216: {"parent": 177, "state": "closed"}}, fail={subs})
        code, _, _ = merge("Closes #216\nRefs #177", fake)
        self.assertEqual(code, 1)
        (first,) = [w[2] for w in fake.writes if w[1] == 177]
        self.assertIn("Advanced by #300", first)
        self.assertNotIn("sub-issues are closed", first)
        # Run again once the read works: the parent's line is posted, alone.
        fake.fail.discard(subs)
        code, _, _ = merge("Closes #216\nRefs #177", fake)
        self.assertEqual(code, 0)
        second = [w[2] for w in fake.writes if w[1] == 177][1]
        self.assertIn("#216 closed with #300. 1 of 1 sub-issues are closed.", second)
        self.assertNotIn("Advanced by", second)
        self.assertIn("<!-- pr-checks: sub-issues #300 -->", second)
        # And a third run has nothing left to say.
        code, log, _ = merge("Closes #216\nRefs #177", fake)
        self.assertEqual((code, len([w for w in fake.writes if w[1] == 177])), (0, 2))
        self.assertIn("#177: commented already", log)

    def test_a_parent_in_another_repository_is_not_told(self):
        fake = Fake({9: {"repo": "someone/else"}, 5: {"parent": 9, "state": "closed"}})
        code, log, _ = merge("Closes #5", fake)
        self.assertEqual((code, fake.writes), (0, []))
        self.assertIn("#5: its parent is in another repository: not told", log)

    def test_what_isnt_an_issue_is_skipped(self):
        fake = Fake({206: {"pr": True}})
        code, log, _ = merge("Closes #206\nRefs #9999", fake)
        self.assertEqual((code, fake.writes), (0, []))

    def test_a_failed_read_fails_the_job(self):
        for body in ["Refs #5", "Closes #5"]:
            fake = Fake({5: {}}, fail={f"repos/{REPO}/issues/5"})
            self.assertEqual(merge(body, fake)[0], 1, body)
            self.assertEqual(fake.writes, [], body)

    def test_dependabot_a_fork_and_a_pr_with_no_issue_write_nothing(self):
        fake = Fake({1: {}})
        self.assertEqual(merge("Fixes #1", fake, author=P.DEPENDABOT)[0], 0)
        code, log, _ = merge("Fixes #1", fake, head="someone/auracle")
        self.assertIn("read-only token", log[0])
        self.assertEqual(merge("No issue: a typo", fake)[0], 0)
        self.assertEqual(fake.writes, [])

    def test_a_dry_run_writes_nothing_and_does_not_wait(self):
        fake = Fake({5: {}, 177: {"body": "- [ ] Flakes can't merge — #5"}})
        log, slept = [], []
        P.on_merge(P.Pr(300, "t", "Closes #5\nRefs #177", "a"), fake, REPO, dry_run=True, sleep=slept.append, log=log.append)
        self.assertEqual((fake.writes, slept), ([], []))
        self.assertIn("#5: open: would close it", log)
        self.assertIn("#177: would tick “Flakes can't merge — #5”", log)


class Ticks(unittest.TestCase):
    """On merge, a box in another open issue that names an issue the PR
    closed is ticked once every issue it names is closed, and said once."""

    def ticked(self, fake):
        return [w for w in fake.writes if w[0] == "body"]

    def said(self, fake, n):
        return [w[2] for w in fake.writes if w[0] == "comment" and w[1] == n]

    def test_a_box_naming_an_issue_the_merge_closed_is_ticked_and_said(self):
        # Every kind of list GitHub draws a box in, and a body saved with
        # CRLF: only the box's character changes.
        umbrella = "## The PRs\n\n- [ ] Flakes can't merge — #5\n- [ ] Not started\n* [ ] Hangs too (#5)\n1. [ ] Done when #5 is"
        crlf = "- [ ] Saved with CRLF — #5\r\n- [ ] The rest\r\n"
        fake = Fake({5: {"state": "closed"}, 177: {"body": umbrella}, 178: {"body": crlf}})
        code, log, _ = merge("Closes #5", fake)
        self.assertEqual(code, 0)
        self.assertEqual(
            self.ticked(fake),
            [
                ("body", 177, "## The PRs\n\n- [x] Flakes can't merge — #5\n- [ ] Not started\n* [x] Hangs too (#5)\n1. [x] Done when #5 is"),
                ("body", 178, "- [x] Saved with CRLF — #5\r\n- [ ] The rest\r\n"),
            ],
        )
        # One comment, a line for each box, each marked with the box's line.
        (said,) = self.said(fake, 177)
        for line, text in [(2, "Flakes can't merge — #5"), (4, "Hangs too (#5)"), (5, "Done when #5 is")]:
            self.assertIn(f"#300 closed #5, and every issue this box names is closed now, so it is ticked: `{text}`.", said)
            self.assertRegex(said, rf"<!-- pr-checks: ticked line {line} \([0-9a-f]{{8}}\) #300 -->")
        (said,) = self.said(fake, 178)
        self.assertIn("every issue this box names is closed now, so it is ticked: `Saved with CRLF — #5`.", said)
        self.assertIn("#177: ticked “Hangs too (#5)”", log)

    def test_a_box_naming_two_issues_waits_until_both_are_closed(self):
        fake = Fake({130: {"state": "closed"}, 153: {}, 177: {"body": "- [ ] Both halves: #130 + #153"}})
        code, log, _ = merge("Closes #130", fake)
        self.assertEqual((code, fake.writes), (0, []))
        self.assertIn("#177: “Both halves: #130 + #153” waits for #153, still open", log)
        # Another PR closes the second: now the box is ticked.
        fake.issues[153]["state"] = "closed"
        code, _, _ = merge("Closes #153", fake, number=301)
        self.assertEqual(code, 0)
        self.assertEqual(self.ticked(fake), [("body", 177, "- [x] Both halves: #130 + #153")])
        self.assertIn("#301 closed #153, and every issue this box names", self.said(fake, 177)[0])

    def test_a_box_in_code_a_comment_or_a_quote_or_naming_it_only_in_code_is_not_ticked(self):
        body = "\n".join(
            [
                "```",
                "- [ ] In a fence: #5",
                "```",
                "  ~~~md",
                "  - [ ] In a tilde fence: #5",
                "  ~~~",
                "<!-- - [ ] In a comment: #5 -->",
                "<!--",
                "- [ ] In a comment over lines: #5",
                "-->",
                "- [ ] Named only in code: `Closes #5`",
                "- [ ] Named only in a comment <!-- #5 -->",
                "> - [ ] Quoted: #5",
            ]
        )
        fake = Fake({5: {"state": "closed"}, 177: {"body": body}})
        code, _, _ = merge("Closes #5", fake)
        self.assertEqual((code, fake.writes), (0, []))

    def test_a_box_naming_an_issue_in_another_repository_is_left_for_a_person(self):
        fake = Fake({5: {"state": "closed"}, 177: {"body": "- [ ] Upstream too: #5 and rhysd/actionlint#654"}})
        code, log, _ = merge("Closes #5", fake)
        self.assertEqual((code, fake.writes), (0, []))
        self.assertIn("#177: “Upstream too: #5 and rhysd/actionlint#654” names an issue in another repository: not ticked", log)

    def test_a_ticked_box_is_left_alone(self):
        fake = Fake({5: {"state": "closed"}, 177: {"body": "- [x] Done — #5\n- [X] Also done — #5"}})
        code, log, _ = merge("Closes #5", fake)
        self.assertEqual((code, fake.writes), (0, []))
        # Not a box to tick at all: nothing is said of it, in a dry run too.
        log += merge("Closes #5", fake, dry=True)[1]
        self.assertEqual([line for line in log if line.startswith("#177")], [])

    def test_a_pr_a_box_names_is_not_an_issue_to_wait_for(self):
        # #206 is an open PR. The box naming #5 and it is ticked once #5
        # closes; the box naming only the PR is not.
        fake = Fake({5: {"state": "closed"}, 206: {"pr": True}, 177: {"body": "- [ ] The fix — #5 (#206)\n- [ ] Merged — #206"}})
        code, _, _ = merge("Closes #5", fake)
        self.assertEqual(code, 0)
        self.assertEqual(self.ticked(fake), [("body", 177, "- [x] The fix — #5 (#206)\n- [ ] Merged — #206")])
        # A PR named with `Closes` closes nothing, so no box naming it is
        # ticked.
        fake = Fake({206: {"pr": True}, 177: {"body": "- [ ] Merged — #206"}})
        self.assertEqual((merge("Closes #206", fake)[0], fake.writes), (0, []))

    def test_a_run_again_ticks_nothing_and_says_nothing_twice(self):
        fake = Fake({5: {"state": "closed"}, 177: {"body": "- [ ] Flakes can't merge — #5"}})
        merge("Closes #5", fake)
        self.assertEqual([(w[0], w[1]) for w in fake.writes], [("body", 177), ("comment", 177)])
        code, log, _ = merge("Closes #5", fake)
        self.assertEqual((code, len(fake.writes)), (0, 2))
        self.assertEqual([line for line in log if line.startswith("#177")], [])

    def test_a_box_changed_between_the_read_and_the_write_is_not_ticked(self):
        # A person rewrites the first box and adds a line just after the
        # job's first read: the second box is ticked in their body, the
        # first is left.
        fake = Fake(
            {5: {"state": "closed"}, 177: {"body": "- [ ] Flakes — #5\n- [ ] Hangs — #5"}},
            edits={177: "- [ ] Flakes, and slow suites — #5\n- [ ] Hangs — #5\nA line of theirs."},
        )
        code, log, _ = merge("Closes #5", fake)
        self.assertEqual(code, 0)
        self.assertEqual(self.ticked(fake), [("body", 177, "- [ ] Flakes, and slow suites — #5\n- [x] Hangs — #5\nA line of theirs.")])
        self.assertIn("#177: “Flakes — #5” changed since it was read: not ticked", log)
        (said,) = self.said(fake, 177)
        self.assertIn("so it is ticked: `Hangs — #5`.", said)
        self.assertNotIn("Flakes", said)

    def test_a_failed_search_or_read_fails_the_job_and_ticks_nothing(self):
        search = f"search/issues?q=repo:{REPO} is:issue is:open #5 in:body"
        for fail in [search, f"repos/{REPO}/issues/6"]:
            fake = Fake({5: {"state": "closed"}, 6: {"state": "closed"}, 177: {"body": "- [ ] Both: #5 and #6"}}, fail={fail})
            code, _, _ = merge("Closes #5", fake)
            self.assertEqual((code, fake.writes), (1, []), fail)

    def test_a_failed_read_again_or_write_fails_the_job_and_claims_no_tick(self):
        # The read just before the write fails, or the write does: the body
        # is as it was, and no comment says the box is ticked.
        body = "- [ ] Flakes can't merge — #5"
        for fails, said in [({"fail_reads": {177: {2}}}, "#177: couldn't be read again (HTTP 502): its boxes aren't ticked"), ({"fail_patch": {177}}, "#177: ticking 1 box failed (HTTP 502)")]:
            fake = Fake({5: {"state": "closed"}, 177: {"body": body}}, **fails)
            code, log, _ = merge("Closes #5", fake)
            self.assertEqual((code, fake.issues[177]["body"], self.said(fake, 177)), (1, body, []), fails)
            # The log says what failed, and nothing else of #177.
            self.assertEqual([line for line in log if line.startswith("#177")], [said], fails)

    def test_a_failed_read_after_the_write_fails_the_job_and_says_the_box(self):
        # The write landed: the box is ticked and said, and the run is red,
        # since whether another write put it back isn't known.
        fake = Fake({5: {"state": "closed"}, 177: {"body": "- [ ] Flakes can't merge — #5"}}, fail_reads={177: {3}})
        code, log, _ = merge("Closes #5", fake)
        self.assertEqual((code, fake.issues[177]["body"]), (1, "- [x] Flakes can't merge — #5"))
        self.assertIn("#177: couldn't be read again after the write (HTTP 502): whether its ticks held isn't known", log)
        (said,) = self.said(fake, 177)
        self.assertIn("so it is ticked: `Flakes can't merge — #5`.", said)

    def test_another_runs_write_from_an_older_read_is_ticked_again(self):
        # A queue batch merges #300 (closing #5) and #301 (closing #6)
        # seconds apart. #300's run reads #177 and is about to write when
        # #301's run reads it and writes first; #300's write, built on its
        # older read, lands while #301's run waits, and puts #301's box back.
        fake = Fake({5: {"state": "closed"}, 6: {"state": "closed"}, 177: {"body": "- [ ] Flakes can't merge — #5\n- [ ] Hangs too — #6"}})
        patch, held, runs = fake.patch, [], {}

        def landing_late(path, data):
            if "body" not in data or 301 in runs:
                return patch(path, data)
            held.append(data)
            runs[301] = None
            runs[301] = merge("Closes #6", fake, number=301, sleep=lambda _: held and patch(path, held.pop()))
            return 200, {}

        fake.patch = landing_late
        runs[300] = merge("Closes #5", fake)
        self.assertEqual((runs[300][0], runs[301][0]), (0, 0))
        self.assertEqual(fake.issues[177]["body"], "- [x] Flakes can't merge — #5\n- [x] Hangs too — #6")
        self.assertIn("#177: “Hangs too — #6” was put back by another write: ticked again", runs[301][1])
        said = "\n".join(self.said(fake, 177))
        self.assertIn("#301 closed #6, and every issue this box names is closed now, so it is ticked: `Hangs too — #6`.", said)
        self.assertIn("#300 closed #5, and every issue this box names is closed now, so it is ticked: `Flakes can't merge — #5`.", said)

    def test_a_box_put_back_each_time_it_is_ticked_fails_the_job_and_is_not_said(self):
        fake = Fake({5: {"state": "closed"}, 177: {"body": "- [ ] Flakes can't merge — #5"}}, reverts={177: P.TRIES})
        code, log, _ = merge("Closes #5", fake)
        self.assertEqual((code, fake.issues[177]["body"], len(self.ticked(fake))), (1, "- [ ] Flakes can't merge — #5", P.TRIES))
        self.assertIn(f"#177: “Flakes can't merge — #5” was put back by another write each of the {P.TRIES} times it was ticked: not ticked", log)
        self.assertEqual(self.said(fake, 177), [])

    def test_a_run_again_ticks_and_says_a_box_the_red_run_left(self):
        # #6's read fails on the first run, so only the box naming #5 alone
        # is ticked and said. Run again: the other box is ticked and said,
        # alone, in a comment of its own.
        six = f"repos/{REPO}/issues/6"
        fake = Fake({5: {"state": "closed"}, 6: {"state": "closed"}, 177: {"body": "- [ ] A — #5\n- [ ] B — #5 + #6"}}, fail={six})
        self.assertEqual(merge("Closes #5", fake)[0], 1)
        self.assertEqual(fake.issues[177]["body"], "- [x] A — #5\n- [ ] B — #5 + #6")
        fake.fail.discard(six)
        self.assertEqual(merge("Closes #5", fake)[0], 0)
        self.assertEqual(fake.issues[177]["body"], "- [x] A — #5\n- [x] B — #5 + #6")
        first, second = self.said(fake, 177)
        self.assertIn("ticked: `A — #5`.", first)
        self.assertIn("ticked: `B — #5 + #6`.", second)
        self.assertNotIn("`A — #5`", second)

    def test_a_box_is_quoted_in_code_cut_short_at_a_word(self):
        # In code, an @mention or a `#n` in the box notifies no one again; a
        # backtick in it takes a longer run around it.
        text = "Quarantined specs report to their own issues; the nightly files Flaky: issues and refreshes the timings — #5"
        fake = Fake({5: {"state": "closed"}, 177: {"body": f"- [ ] {text}\n- [ ] @alexnodeland picks `queue` — #5 (#130)"}})
        code, log, _ = merge("Closes #5", fake)
        self.assertEqual(code, 0)
        (said,) = self.said(fake, 177)
        self.assertIn("ticked: `Quarantined specs report to their own issues; the nightly files Flaky: issues…`.", said)
        self.assertIn("ticked: ``@alexnodeland picks `queue` — #5 (#130)``.", said)
        self.assertIn("#177: ticked “@alexnodeland picks `queue` — #5 (#130)”", log)


class Boxes(unittest.TestCase):
    """What `boxes` reads as a box, and the numbers it names, where GitHub
    reads an HTML comment, and where it reads `<!--` as text."""

    def read(self, body):
        return [(b.text, b.issues) for b in P.boxes(body, REPO)]

    def test_a_comment_opener_in_code_hides_nothing(self):
        self.assertEqual(self.read("- [ ] Lines carry a `<!--` marker — #7\n- [ ] Real box — #5"), [("Lines carry a `<!--` marker — #7", [7]), ("Real box — #5", [5])])
        self.assertEqual(self.read("```html\n<!-- an example\n```\n- [ ] Real box — #5"), [("Real box — #5", [5])])
        # A `-->` in code on the line its paragraph goes on to closes nothing.
        self.assertEqual(self.read("- [ ] Lines carry a `<!--` marker — #7\n  and end with `-->`"), [("Lines carry a `<!--` marker — #7", [7])])

    def test_one_mid_line_that_its_paragraph_never_closes_is_text(self):
        # Its paragraph ends where the next box starts: a `-->` past that, a
        # comment's or a line's of the next box, closes nothing here.
        for after in ["\n<!-- a note -->", "\n  and its own line, ending -->"]:
            body = "- [ ] foo <!-- unclosed mid-line — #7\n- [ ] Real box — #5" + after
            self.assertEqual(self.read(body), [("foo <!-- unclosed mid-line — #7", [7]), ("Real box — #5", [5])], after)

    def test_one_mid_line_closes_on_a_line_its_paragraph_goes_on_to(self):
        body = "- [ ] Real — #5 <!-- not #7\n  still the note --> and after\n- [ ] Next — #6"
        self.assertEqual(self.read(body), [("Real — #5", [5]), ("Next — #6", [6])])

    def test_one_that_starts_a_line_runs_to_the_line_holding_its_close_or_to_the_end(self):
        # The line it closes on is hidden whole, a box after the `-->` too;
        # a fence inside it opens nothing.
        body = "<!-- note --> - [ ] After a comment — #5\n<!--\n```\n-->\n- [ ] Real — #5\n<!-- a note never closed\n- [ ] Hidden — #5"
        self.assertEqual(self.read(body), [("Real — #5", [5])])


class ReadPr(unittest.TestCase):
    """The PR the merge job acts on: from the event's environment in CI,
    from the API with `--pr N`; its merge time among the rest."""

    def test_from_the_environment(self):
        env = {"PR_NUMBER": "300", "PR_TITLE": "t", "PR_BODY": "Closes #5", "PR_AUTHOR": "a", "PR_HEAD_REPO": REPO, "PR_MERGED_AT": "2026-10-06T12:00:00Z"}
        with unittest.mock.patch.dict(os.environ, env):
            self.assertEqual(P.read_pr(None, REPO, None), P.Pr(300, "t", "Closes #5", "a", REPO, "2026-10-06T12:00:00Z"))

    def test_from_the_api(self):
        pull = {"title": "t", "body": None, "user": {"login": "a"}, "head": {"repo": {"full_name": REPO}}, "merged_at": "2026-10-06T12:00:00Z"}

        class Pulls:
            def get(self, path):
                return (200, pull) if path == f"repos/{REPO}/pulls/300" else (404, "")

        self.assertEqual(P.read_pr(Pulls(), REPO, 300), P.Pr(300, "t", "", "a", REPO, "2026-10-06T12:00:00Z"))


class GhApi(unittest.TestCase):
    """`Api` reads gh's answer: JSON on success, the HTTP status from its
    error line otherwise, so a missing issue is told from an API that is
    down."""

    def api(self, code, out="", err=""):
        calls = []

        def run(args, **kw):
            calls.append((args, kw.get("input")))
            return subprocess.CompletedProcess(args, code, out, err)

        return P.Api(run), calls

    def test_success_is_200_with_the_json(self):
        api, calls = self.api(0, '{"number": 5, "state": "open"}')
        self.assertEqual(api.get(f"repos/{REPO}/issues/5"), (200, {"number": 5, "state": "open"}))
        self.assertEqual(calls[0][0], ["gh", "api", "--method", "GET", f"repos/{REPO}/issues/5"])

    def test_a_missing_issue_is_404_and_a_failure_without_a_status_is_0(self):
        api, _ = self.api(1, '{"message":"Not Found"}', "gh: Not Found (HTTP 404)\n")
        self.assertEqual(api.get(f"repos/{REPO}/issues/9999")[0], 404)
        api, _ = self.api(1, "", "error connecting to api.github.com\n")
        self.assertEqual(api.get(f"repos/{REPO}/issues/5")[0], 0)

    def test_a_write_sends_its_json_on_stdin(self):
        api, calls = self.api(0, "{}")
        api.post(f"repos/{REPO}/issues/5/comments", {"body": "hi"})
        self.assertEqual(calls[0][0][-2:], ["--input", "-"])
        self.assertEqual(calls[0][1], '{"body": "hi"}')

    def test_a_list_is_read_page_by_page(self):
        pages = [[{"n": i} for i in range(100)], [{"n": 100}]]
        seen = []

        def run(args, **kw):
            seen.append(args[-1])
            return subprocess.CompletedProcess(args, 0, json.dumps(pages[len(seen) - 1]), "")

        status, items = P.Api(run).all(f"repos/{REPO}/issues/5/comments")
        self.assertEqual((status, len(items)), (200, 101))
        self.assertEqual(seen, [f"repos/{REPO}/issues/5/comments?per_page=100&page={k}" for k in (1, 2)])

    def test_a_search_is_read_page_by_page_its_query_encoded(self):
        pages = [{"total_count": 101, "items": [{"number": i} for i in range(100)]}, {"total_count": 101, "items": [{"number": 100}]}]
        seen = []

        def run(args, **kw):
            seen.append(args[-1])
            return subprocess.CompletedProcess(args, 0, json.dumps(pages[len(seen) - 1]), "")

        status, items = P.Api(run).search(f"repo:{REPO} is:issue is:open #5 in:body")
        self.assertEqual((status, len(items)), (200, 101))
        # `#` unencoded would end the path there: the rest a URL fragment.
        q = "repo%3Aalexnodeland%2Fauracle%20is%3Aissue%20is%3Aopen%20%235%20in%3Abody"
        self.assertEqual(seen, [f"search/issues?q={q}&per_page=100&page={k}" for k in (1, 2)])


class TheRealTemplate(unittest.TestCase):
    def test_the_unfilled_template_names_nothing_and_fails_with_the_way_to_fix_it(self):
        # Its guidance (in HTML comments) and its empty `Closes #` and
        # `Refs #` lines are not links.
        body = (ROOT / ".github/PULL_REQUEST_TEMPLATE.md").read_text()
        links = P.parse(body, REPO)
        self.assertEqual((links.named(), links.no_issue, links.problems), ([], None, []))
        problems, _ = P.check_links(links, Fake().get, REPO)
        self.assertIn("names no issue", problems[0])


if __name__ == "__main__":
    # One line when they pass, like the rest of `make dev-check`; everything
    # unittest says when one fails.
    out = io.StringIO()
    result = unittest.TextTestRunner(stream=out, verbosity=2).run(unittest.defaultTestLoader.loadTestsFromModule(sys.modules[__name__]))
    if not result.wasSuccessful():
        sys.stderr.write(out.getvalue())
        sys.exit(1)
    print(f"  PR checks tests: {result.testsRun} passed")
