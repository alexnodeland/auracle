#!/usr/bin/env python3
"""The PR checks' tests (`scripts/pr_checks.py`): the title, the links a body
names and what fails among them, the changelog's warning, and what a merge
does to the issues it names.

    python3 scripts/test_pr_checks.py      (run by `make dev-check`)

No test reaches the network: the GitHub API is a fake that holds issues,
comments and parents in memory and records every write, and `gh` never runs
(the API wrapper's own tests hand it a stand-in for `subprocess.run`). The
last case reads the real pull request template. Python 3 standard library
only.
"""

import contextlib
import io
import json
import os
import pathlib
import subprocess
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import pr_checks as P  # noqa: E402

ROOT = pathlib.Path(HERE).parent
REPO = "alexnodeland/auracle"


class Fake:
    """The GitHub API in memory: issues by number ({state, title, pr,
    parent}), each issue's comments, and the writes made. `closes_after`
    closes an issue (as GitHub does after a merge) once it has been read
    that many times."""

    def __init__(self, issues=None, comments=None, closes_after=None, fail=(), lag=False):
        self.issues = {n: dict(i) for n, i in (issues or {}).items()}
        # With `lag`, a parent's list of sub-issues gives each one's state
        # from before any write, as GitHub's can for a moment.
        self.before = {n: i.get("state", "open") for n, i in self.issues.items()} if lag else None
        self.comments = {n: list(c) for n, c in (comments or {}).items()}
        self.closes_after = dict(closes_after or {})
        self.reads = {}
        self.fail = set(fail)
        self.writes = []
        self.files = []

    def _issue(self, n):
        i = self.issues[n]
        out = {"number": n, "title": i.get("title", f"issue {n}"), "state": i.get("state", "open"), "repository_url": f"https://api.github.com/repos/{i.get('repo', REPO)}"}
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
            if n in self.closes_after and self.reads[n] > self.closes_after[n]:
                self.issues[n]["state"] = "closed"
            return 200, self._issue(n)
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

    def post(self, path, data):
        n = int(path.split("/")[4])
        self.writes.append(("comment", n, data["body"]))
        self.comments.setdefault(n, []).append(data["body"])
        return 201, {}

    def patch(self, path, data):
        n = int(path.split("/")[4])
        self.writes.append(("close", n, data["state"]))
        self.issues[n]["state"] = data["state"]
        return 200, {}


def merge(body, api, number=300, title="tests: a change", author="alexnodeland", head=REPO):
    """Run the merge job on a PR with `body` against `api`: its exit code,
    its log, and how many times it slept."""
    log, slept = [], []
    code = P.on_merge(P.Pr(number, title, body, author, head), api, REPO, sleep=slept.append, log=log.append)
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

    def test_an_unknown_type_fails(self):
        (problem,) = P.check_title("wip: half of it")
        self.assertIn("`wip` is not one of the types", problem)

    def test_a_type_in_capitals_fails_with_its_lower_case(self):
        (problem,) = P.check_title("CI: read Rust's stable channel whole")
        self.assertIn("`ci`", problem)

    def test_malformed_prefixes_fail(self):
        for t in ["fix:no space", "fix: ", "fix (web): a space before the scope", "fix(): an empty scope", "(web): no type", "fix(web) : a space before the colon"]:
            self.assertEqual(len(P.check_title(t)), 1, t)


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
        fake = Fake({5: {}}, fail={f"repos/{REPO}/issues/5"})
        self.assertEqual(merge("Refs #5", fake)[0], 1)

    def test_dependabot_a_fork_and_a_pr_with_no_issue_write_nothing(self):
        fake = Fake({1: {}})
        self.assertEqual(merge("Fixes #1", fake, author=P.DEPENDABOT)[0], 0)
        code, log, _ = merge("Fixes #1", fake, head="someone/auracle")
        self.assertIn("read-only token", log[0])
        self.assertEqual(merge("No issue: a typo", fake)[0], 0)
        self.assertEqual(fake.writes, [])

    def test_a_dry_run_writes_nothing_and_does_not_wait(self):
        fake = Fake({5: {}, 177: {}})
        log, slept = [], []
        P.on_merge(P.Pr(300, "t", "Closes #5\nRefs #177", "a"), fake, REPO, dry_run=True, sleep=slept.append, log=log.append)
        self.assertEqual((fake.writes, slept), ([], []))
        self.assertIn("#5: open: would close it", log)


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
