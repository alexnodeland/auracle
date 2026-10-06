// The file-issue action's choice of issue (file-issue.js), against a GitHub
// that records what it was asked: a named issue gets the comment and nothing
// is searched or opened; a title finds the open issue the workflow opened,
// or opens one with its labels. `make web-check` runs it.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const { fileIssue, bodyOf } = createRequire(import.meta.url)("./file-issue.js");

/** A GitHub with these open issues, keeping every call made of it. */
function github(open = []) {
  const calls = [];
  const issues = {
    listForRepo: (args) => calls.push(["list", args]),
    createComment: async (args) => calls.push(["comment", args]),
    create: async (args) => {
      calls.push(["create", args]);
      return { data: { number: 999 } };
    },
  };
  return {
    calls,
    rest: { issues },
    paginate: async (fn, args) => {
      fn(args);
      return open;
    },
  };
}

const context = { repo: { owner: "o", repo: "r" }, serverUrl: "https://github.com", runId: 42, sha: "abcdef0123456789", eventName: "schedule" };
const core = { info: () => {} };
const ADVICE = "Read the run.";

test("a named issue gets the comment, and nothing is searched for or opened", async () => {
  const gh = github([{ number: 5, title: "Slow suite failing on main" }]);
  const env = { ISSUE: "173", TITLE: "Slow suite failing on main", FAILED: "`taste_learning.spec.js:503` 'pointing at a weight…', its one run", ADVICE };
  const done = await fileIssue({ github: gh, context, core, env });
  assert.deepEqual(done, { action: "commented", number: 173 });
  assert.deepEqual(gh.calls.map(([k]) => k), ["comment"]);
  assert.equal(gh.calls[0][1].issue_number, 173);
  assert.match(gh.calls[0][1].body, /^The nightly run at abcdef0 failed: `taste_learning\.spec\.js:503` 'pointing at a weight…', its one run\.\n/);
});

test("a title finds the open issue this workflow opened, and comments there", async () => {
  const gh = github([{ number: 7, title: "Other" }, { number: 156, title: "Slow suite failing on main" }]);
  const done = await fileIssue({ github: gh, context, core, env: { TITLE: "Slow suite failing on main", RESULTS: JSON.stringify({ browser: { result: "failure" }, rust: { result: "success" } }), ADVICE } });
  assert.deepEqual(done, { action: "commented", number: 156 });
  assert.deepEqual(gh.calls.map(([k]) => k), ["list", "comment"]);
  assert.equal(gh.calls[0][1].creator, "github-actions[bot]");
  assert.equal(gh.calls[1][1].issue_number, 156);
});

test("a title with no open issue opens one, with the labels asked for", async () => {
  const gh = github([{ number: 8, title: "Flaky: other 'x'", pull_request: null }]);
  const title = "Flaky: bank_lineage 'a generation's children land in New'";
  const done = await fileIssue({ github: gh, context, core, env: { TITLE: title, FAILED: "`bank_lineage.spec.js:670` 'a generation's…', 1 of its 3 runs", LABELS: "flake, area:tests", ADVICE } });
  assert.deepEqual(done, { action: "opened", number: 999 });
  const [, made] = gh.calls.find(([k]) => k === "create");
  assert.equal(made.title, title);
  assert.deepEqual(made.labels, ["flake", "area:tests"]);
});

test("the callers that name only a title and the jobs get the body they always had", () => {
  const body = bodyOf({ context: { ...context, eventName: "push" }, env: { RESULTS: JSON.stringify({ engine: { result: "success" }, browser: { result: "failure" } }), ADVICE } });
  assert.equal(body, "The push at abcdef0 failed: `browser`.\n\nRun: https://github.com/o/r/actions/runs/42\n\nRead the run.");
});

test("a caller can say what the run was", () => {
  const body = bodyOf({ context, env: { RUN: "The weekly run", RESULTS: JSON.stringify({ mutants: { result: "failure" } }), ADVICE } });
  assert.match(body, /^The weekly run at abcdef0 failed: `mutants`\./);
});

test("what the failure said goes under what failed", () => {
  const body = bodyOf({ context, env: { FAILED: "`a.spec.js:3` 'x', its one run", DETAIL: "```\nError: boom\n```", ADVICE } });
  assert.equal(body, "The nightly run at abcdef0 failed: `a.spec.js:3` 'x', its one run.\n\n```\nError: boom\n```\n\nRun: https://github.com/o/r/actions/runs/42\n\nRead the run.");
});

test("an issue that is not a number is refused, and so is neither an issue nor a title", async () => {
  await assert.rejects(fileIssue({ github: github(), context, core, env: { ISSUE: "#173", ADVICE } }), /not an issue number/);
  await assert.rejects(fileIssue({ github: github(), context, core, env: { ADVICE } }), /needs a title/);
});
