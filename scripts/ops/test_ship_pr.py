#!/usr/bin/env python3
"""ship_pr.sh's tests: the PR it opens, labels and queues, through `gh pr
create` and, when that fails, through the REST API (`make dev-check`, its
dev-ops part).

    python3 scripts/ops/test_ship_pr.py

Each case runs the real script on a scratch repository: a bare `origin`
whose `main` holds a stand-in `scripts/pr_checks.py` that passes, and a
clone on `claude/thing` with one commit. A fake `gh` first on PATH writes
each call to a log and answers as the case says, so nothing reaches GitHub.
HOME is the scratch directory, so no one's git config reaches the
repository either. Python 3 standard library only.
"""

import json
import os
import shutil
import subprocess
import tempfile
import textwrap
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SHIP = os.path.join(HERE, "ship_pr.sh")
REPO = "o/r"
TITLE = "fix(web): the thing is true now"
BODY = "Closes #300\nRefs #177\n"

# The fake gh. FAKE_GH says what fails: "create" (gh pr create, as GitHub's
# GraphQL API failed on 2026-10-06), "rest" (the REST create answers
# nothing), "lookup" (no open PR found by its branch), "comment" (gh pr
# comment), "rest-comment" (the comment through REST).
FAKE_GH = textwrap.dedent(
    """\
    #!/usr/bin/env python3
    import json, os, sys
    args = sys.argv[1:]
    fails = os.environ.get("FAKE_GH", "").split(",")
    call = {"argv": args}
    if "--input" in args:
        with open(args[args.index("--input") + 1], encoding="utf-8") as f:
            call["input"] = json.load(f)
    with open(os.environ["FAKE_GH_LOG"], "a", encoding="utf-8") as log:
        log.write(json.dumps(call) + "\\n")
    if args[:2] == ["-R", "o/r"]:
        args = args[2:]
    if args[:2] == ["pr", "create"]:
        if "create" in fails:
            sys.stderr.write("GraphQL: Something went wrong while executing your query. (createPullRequest)\\n")
            sys.exit(1)
        print("https://github.com/o/r/pull/281")
    elif args[:2] == ["pr", "comment"]:
        sys.exit(1 if "comment" in fails else 0)
    elif args[0] == "api":
        path = [a for a in args[1:] if a.startswith("repos/")][0]
        if path == "repos/o/r/pulls":
            if "rest" in fails:
                sys.stderr.write("gh: Validation Failed (HTTP 422)\\n")
                sys.exit(1)
            print("281")
        elif path.startswith("repos/o/r/pulls?"):
            print("null" if "lookup" in fails else "281")
        elif path.endswith("/comments"):
            sys.exit(1 if "rest-comment" in fails else 0)
    else:
        sys.exit(2)
    """
)


def git(*args, cwd, env):
    subprocess.run(
        ["git", "-c", "core.fsmonitor=false", "-c", "user.name=t", "-c", "user.email=t@example.com", *args],
        cwd=cwd, env=env, check=True, capture_output=True,
    )


class ShipPr(unittest.TestCase):
    # One scratch repository for every case: a second push of the same
    # branch to it changes nothing. Each case has its own log.
    @classmethod
    def setUpClass(cls):
        cls.dir = d = tempfile.mkdtemp()
        cls.addClassCleanup(shutil.rmtree, d)
        cls.env = {k: v for k, v in os.environ.items() if not k.startswith(("GIT_", "GH_"))}
        cls.env.update(HOME=d, XDG_CONFIG_HOME=d, GH_REPO=REPO)
        bin_dir = os.path.join(d, "bin")
        os.mkdir(bin_dir)
        with open(os.path.join(bin_dir, "gh"), "w", encoding="utf-8") as f:
            f.write(FAKE_GH)
        os.chmod(os.path.join(bin_dir, "gh"), 0o755)
        cls.env["PATH"] = bin_dir + os.pathsep + cls.env["PATH"]

        origin = os.path.join(d, "origin.git")
        seed = os.path.join(d, "seed")
        cls.wt = os.path.join(d, "wt")
        run = lambda *a, cwd=d: git(*a, cwd=cwd, env=cls.env)  # noqa: E731
        run("init", "-q", "--bare", "-b", "main", origin)
        run("init", "-q", "-b", "main", seed)
        os.mkdir(os.path.join(seed, "scripts"))
        with open(os.path.join(seed, "scripts", "pr_checks.py"), "w", encoding="utf-8") as f:
            f.write("import sys\nsys.exit(0)\n")
        run("add", ".", cwd=seed)
        run("commit", "-q", "-m", "main", cwd=seed)
        run("push", "-q", origin, "main", cwd=seed)
        run("clone", "-q", origin, cls.wt)
        run("checkout", "-q", "-b", "claude/thing", cwd=cls.wt)
        with open(os.path.join(cls.wt, "thing.txt"), "w", encoding="utf-8") as f:
            f.write("the thing\n")
        run("add", ".", cwd=cls.wt)
        run("commit", "-q", "-m", "fix: the thing", cwd=cls.wt)
        with open(os.path.join(d, "pr.md"), "w", encoding="utf-8") as f:
            f.write(BODY)

    def setUp(self):
        self.log = os.path.join(self.dir, f"gh-{self._testMethodName}.log")

    def ship(self, *flags, fails=""):
        env = dict(self.env, FAKE_GH=fails, FAKE_GH_LOG=self.log)
        # The body's path is relative to where ship_pr.sh is run from.
        done = subprocess.run(
            ["bash", SHIP, *flags, self.wt, "claude/thing", TITLE, "pr.md"],
            cwd=self.dir, env=env, capture_output=True, text=True, timeout=60,
        )
        try:
            with open(self.log, encoding="utf-8") as f:
                calls = [json.loads(line) for line in f]
        except FileNotFoundError:
            calls = []
        return done, calls

    def api(self, calls, path):
        return [c for c in calls if c["argv"][0] == "api" and path in c["argv"]]

    def test_gh_pr_create_opens_labels_and_queues(self):
        done, calls = self.ship()
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(done.stdout.split("\n")[0], "281 https://github.com/o/r/pull/281")
        create = calls[0]["argv"]
        self.assertEqual(create[:4], ["-R", REPO, "pr", "create"])
        self.assertIn("queue", create)
        # gh reads the body from where it runs, a scratch directory: the path is absolute.
        body = create[create.index("--body-file") + 1]
        self.assertTrue(os.path.isabs(body), body)
        self.assertEqual(os.path.realpath(body), os.path.realpath(os.path.join(self.dir, "pr.md")))
        self.assertEqual(calls[1]["argv"], ["-R", REPO, "pr", "comment", "281", "--body", "@mergifyio queue"])
        self.assertEqual(len(calls), 2)
        self.assertEqual(self.api(calls, "repos/o/r/pulls"), [])

    def test_a_failed_create_opens_the_pr_through_rest(self):
        done, calls = self.ship(fails="create")
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertIn("through the REST API", done.stderr)
        self.assertEqual(done.stdout.split("\n")[0], "281 https://github.com/o/r/pull/281")
        (pulls,) = self.api(calls, "repos/o/r/pulls")
        self.assertEqual(pulls["input"], {"base": "main", "head": "claude/thing", "title": TITLE, "body": BODY})
        self.assertIn("POST", pulls["argv"])
        (labels,) = self.api(calls, "repos/o/r/issues/281/labels")
        self.assertEqual([a for a in labels["argv"] if a.startswith("labels[]=")], ["labels[]=queue"])
        self.assertTrue(any(c["argv"][2:4] == ["pr", "comment"] for c in calls))
        self.assertEqual(self.api(calls, "repos/o/r/pulls?head=o:claude/thing&state=open"), [])

    def test_a_rest_create_that_answers_nothing_finds_the_pr_by_its_branch(self):
        done, calls = self.ship(fails="create,rest")
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(len(self.api(calls, "repos/o/r/pulls?head=o:claude/thing&state=open")), 1)
        self.assertEqual(len(self.api(calls, "repos/o/r/issues/281/labels")), 1)
        self.assertEqual(done.stdout.split("\n")[0], "281 https://github.com/o/r/pull/281")

    def test_the_queue_comment_goes_through_rest_when_gh_pr_comment_fails(self):
        done, calls = self.ship(fails="create,comment")
        self.assertEqual(done.returncode, 0, done.stderr)
        (comment,) = self.api(calls, "repos/o/r/issues/281/comments")
        self.assertIn("body=@mergifyio queue", comment["argv"])
        self.assertIn("-f", comment["argv"])  # -F would read a file named "mergifyio queue"

    def test_a_comment_that_fails_both_ways_says_the_pr_is_open_and_not_queued(self):
        done, calls = self.ship(fails="comment,rest-comment")
        self.assertEqual(done.returncode, 1)
        self.assertEqual(done.stdout.split("\n")[0], "281 https://github.com/o/r/pull/281")
        self.assertIn("#281 is open and labelled, but the queue's comment failed", done.stderr)

    def test_full_ci_through_rest_is_labelled_and_not_queued(self):
        done, calls = self.ship("--full-ci", "--priority", fails="create")
        self.assertEqual(done.returncode, 0, done.stderr)
        (labels,) = self.api(calls, "repos/o/r/issues/281/labels")
        self.assertEqual([a for a in labels["argv"] if a.startswith("labels[]=")], ["labels[]=full-ci", "labels[]=priority"])
        self.assertEqual(self.api(calls, "repos/o/r/issues/281/comments"), [])
        self.assertFalse(any(c["argv"][2:4] == ["pr", "comment"] for c in calls))
        self.assertIn("not queued", done.stdout)

    def test_no_pr_anywhere_fails_and_labels_nothing(self):
        done, calls = self.ship(fails="create,rest,lookup")
        self.assertEqual(done.returncode, 1)
        self.assertIn("no PR for claude/thing", done.stderr)
        self.assertFalse(any(a.endswith(("/labels", "/comments")) for c in calls for a in c["argv"]))
        self.assertFalse(any(c["argv"][2:4] == ["pr", "comment"] for c in calls))
        self.assertEqual(done.stdout, "")


if __name__ == "__main__":
    unittest.main(verbosity=1)
