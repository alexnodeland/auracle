// flakes.mjs: which issue a failed test's run is said on. The reports here
// have the shape Playwright 1.63 writes when a run's blobs are merged into
// JSON: a file's suite, its specs, one test per repeat (`--repeat-each`), and
// inside a describe one spec per repeat. `make web-check` runs it.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { MANY, flakyTitle, hunt, issueOf, lost, quarantined, testsIn, titledFor, unnamed } from "./flakes.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const RED = "\u001b[31m";
const OFF = "\u001b[39m";

const passed = (ms = 1000) => ({ status: "passed", duration: ms, annotations: [] });
const failed = (message, runner) => ({
  status: "failed",
  duration: 9000,
  error: { message: `Error: ${RED}${message}${OFF}\n\n  at somewhere` },
  annotations: runner ? [{ type: "runner", description: runner }] : [],
});
const issue = (n) => ({ type: "issue", description: `#${n}` });
/** A spec: one test per run, each with its one result. */
const spec = (title, line, runs, { tags = [], annotations = [] } = {}) => ({
  title, file: "taste_learning.spec.js", line, tags,
  tests: runs.map((r) => ({ annotations, expectedStatus: "passed", results: [r] })),
});
const report = (specs, { suites = [], errors = [] } = {}) => ({
  suites: [{ title: "taste_learning.spec.js", file: "taste_learning.spec.js", specs, suites }],
  errors,
});
/** A listing (`playwright test --list --reporter=json`): each test once,
 *  with no results, by file. */
const listing = (files) => ({
  suites: Object.entries(files).map(([file, titles]) => ({
    title: file, file,
    specs: titles.map((title, i) => ({ title, file, line: i + 1, tags: [], tests: [{ annotations: [], expectedStatus: "passed", results: [] }] })),
  })),
  errors: [],
});
const skipped = { status: "skipped", duration: 0, annotations: [] };

const SHADE = "pointing at a weight shades the small map by each sound's z on that feature, as the engine posted it";

test("an issue is named as #N in an `issue` annotation, and nothing else names one", () => {
  assert.equal(issueOf([issue(173)]), 173);
  assert.equal(issueOf([{ type: "budget", description: "#4" }, issue(12)]), 12);
  assert.equal(issueOf([{ type: "issue", description: "https://github.com/alexnodeland/auracle/issues/173" }]), null);
  assert.equal(issueOf([]), null);
  assert.equal(issueOf(undefined), null);
});

test("a quarantined test that failed is said on the issue it names, and nothing is left unowned", () => {
  const q = quarantined(report([
    spec(SHADE, 503, [failed("expect(received).toBeGreaterThan(expected)", "4 × AMD EPYC 7763 64-Core Processor")], { tags: ["quarantine"], annotations: [issue(173)] }),
  ]));
  assert.deepEqual(q.unowned, []);
  assert.equal(q.issues.length, 1);
  assert.equal(q.issues[0].issue, 173);
  assert.equal(q.issues[0].failed, `\`taste_learning.spec.js:503\` '${SHADE}', its one run`);
  assert.equal(
    q.issues[0].detail,
    "```\ntaste_learning.spec.js:503: Error: expect(received).toBeGreaterThan(expected)\n```\n\nFailed on 4 × AMD EPYC 7763 64-Core Processor.",
  );
});

test("quarantined tests are grouped by their issue, one comment each, in issue order", () => {
  const q = quarantined(report([
    spec("b", 20, [failed("two")], { tags: ["quarantine"], annotations: [issue(200)] }),
    spec("a", 10, [failed("one")], { tags: ["quarantine"], annotations: [issue(150)] }),
    spec("c", 30, [failed("three")], { tags: ["slow", "quarantine"], annotations: [issue(150)] }),
    spec("d", 40, [passed()], { tags: ["quarantine"], annotations: [issue(300)] }),
  ]));
  assert.deepEqual(q.issues.map((i) => i.issue), [150, 200]);
  assert.equal(q.issues[0].failed, "`taste_learning.spec.js:10` 'a', its one run; `taste_learning.spec.js:30` 'c', its one run");
  assert.deepEqual(q.unowned, []);
});

test("a quarantined run that passed says nothing to anyone", () => {
  const q = quarantined(report([spec(SHADE, 503, [passed()], { tags: ["quarantine"], annotations: [issue(173)] })]));
  assert.deepEqual(q, { issues: [], unowned: [], failed: 0 });
});

test("a failure no issue owns is not a known flake: a test naming none, one not quarantined, one cut short, an error outside a test", () => {
  const q = quarantined(report(
    [
      spec("names none", 1, [failed("x")], { tags: ["quarantine"] }),
      spec("not quarantined", 2, [failed("y")]),
      spec("cut short", 3, [{ status: "interrupted", duration: 5, annotations: [] }], { tags: ["quarantine"], annotations: [issue(9)] }),
    ],
    { errors: [{ message: `${RED}Error: No tests found${OFF}` }] },
  ));
  assert.deepEqual(q.issues, []);
  assert.deepEqual(q.unowned, [
    "taste_learning.spec.js:1 'names none' failed and names no issue",
    "taste_learning.spec.js:2 'not quarantined' failed and is not quarantined",
    "taste_learning.spec.js:3 'cut short' was cut short (interrupted)",
    "an error outside any test: Error: No tests found",
  ]);
});

test("a quarantined test that names a closed issue is no known flake: its failure would be said to no one", () => {
  const r = report([
    spec("closed", 1, [failed("x")], { tags: ["quarantine"], annotations: [issue(60)] }),
    spec("open", 2, [failed("y")], { tags: ["quarantine"], annotations: [issue(61)] }),
  ]);
  const q = quarantined(r, [{ number: 61, title: "Flaky: taste_learning 'open'" }]);
  assert.deepEqual(q.issues.map((i) => i.issue), [61]);
  assert.deepEqual(q.unowned, ["taste_learning.spec.js:1 'closed' failed and names #60, which is not open"]);
  // The open issues unread: each issue named is taken as open, so a
  // listing that failed never turns the suite red by itself.
  const unread = quarantined(r, null);
  assert.deepEqual([unread.issues.map((i) => i.issue), unread.unowned], [[60, 61], []]);
});

test("a test's repeats are one test: inside a file and inside a describe, where each repeat is a spec of its own", () => {
  const inner = (r) => ({ title: "inner", file: "taste_learning.spec.js", line: 7, tags: [], tests: [{ annotations: [], expectedStatus: "passed", results: [r] }] });
  const tests = testsIn(report(
    [spec("top", 3, [passed(), failed("once"), passed()])],
    { suites: [{ title: "a group", file: "taste_learning.spec.js", line: 6, specs: [inner(failed("a")), inner(failed("b")), inner(passed())] }] },
  ));
  assert.deepEqual(tests.map((t) => [t.title, t.runs, t.failed]), [["top", 3, 1], ["a group › inner", 3, 2]]);
});

test("a test expected to fail that fails is not a failure", () => {
  const r = report([{ title: "known", file: "taste_learning.spec.js", line: 1, tags: [], tests: [{ annotations: [], expectedStatus: "failed", results: [{ status: "failed", duration: 1, annotations: [] }] }] }]);
  assert.equal(testsIn(r)[0].failed, 0);
});

test("the hunt files each failed test under its Flaky: title, with how many of its runs failed", () => {
  const h = hunt(report([spec("x", 3, [passed(), failed("boom"), passed()]), spec("y", 4, [failed("a"), failed("a"), failed("a")]), spec("z", 5, [passed(), passed(), passed()])]));
  assert.equal(h.unexplained, false);
  assert.deepEqual(h.flaky.map((f) => [f.issue, f.title, f.failed]), [
    ["", "Flaky: taste_learning 'x'", "`taste_learning.spec.js:3` 'x', 1 of its 3 runs"],
    ["", "Flaky: taste_learning 'y'", "`taste_learning.spec.js:4` 'y', all 3 of its runs"],
  ]);
  // The same error three times is said once.
  assert.equal(h.flaky[1].detail, "```\ntaste_learning.spec.js:4: Error: a\n```");
});

test("the hunt finds a flake's open issue by its title as a person writes it: cut short with …, a note after it, the file with or without .spec.js", () => {
  const t = { file: "bank_lineage.spec.js", title: "a generation's children land in New with their seed and what changed, and Replaced names what it replaced" };
  assert.ok(titledFor("Flaky: bank_lineage 'a generation's children land in New with their seed and what changed…' (no child budded)", t));
  assert.ok(titledFor(`Flaky: bank_lineage.spec.js '${t.title}'`, t));
  assert.ok(titledFor(flakyTitle(t), t));
  assert.ok(!titledFor("Flaky: bank_lineage 'a generation's children land in New with their seed and what changed'", t), "a whole title is the whole title");
  assert.ok(!titledFor("Flaky: bank_kept 'a generation's children land…'", t), "another file");
  assert.ok(!titledFor("Flaky: bank_lineage '…'", t), "an empty start names every test");
  assert.ok(!titledFor("bank_lineage: a generation's children land… (flaky)", t));
});

test("the hunt comments on the issue a test names, else on its open Flaky: issue, else opens one", () => {
  const r = report([
    spec("named", 1, [failed("a")], { annotations: [issue(40)] }),
    spec("titled by hand, long ago", 2, [failed("b")]),
    spec("new", 3, [failed("c")]),
  ]);
  const open = [
    { number: 40, title: "taste_learning: a test that names this issue" },
    { number: 41, title: "Flaky: taste_learning 'titled by hand…' (seen once)" },
    { number: 42, title: "Flaky: taste_learning 'named'" },
  ];
  assert.deepEqual(hunt(r, open).flaky.map((f) => f.issue), [40, 41, ""]);
});

test("the hunt passes over a closed issue a test names: its open Flaky: issue, else a new one", () => {
  const r = report([
    spec("named, closed, titled", 1, [failed("a")], { annotations: [issue(30)] }),
    spec("named, closed", 2, [failed("b")], { annotations: [issue(31)] }),
  ]);
  const open = [{ number: 50, title: "Flaky: taste_learning 'named, closed, titled'" }];
  assert.deepEqual(hunt(r, open).flaky.map((f) => f.issue), [50, ""]);
  // The open issues unread: the issues named are taken as open, and no
  // title is matched.
  assert.deepEqual(hunt(r, null).flaky.map((f) => f.issue), [30, 31]);
  assert.deepEqual(hunt(report([spec("x", 3, [failed("c")])]), null).flaky.map((f) => f.issue), [""]);
});

test("a hunt that failed in a way no test accounts for says so", () => {
  assert.equal(hunt(report([spec("a", 1, [{ status: "interrupted", duration: 1, annotations: [] }])])).unexplained, true);
  assert.equal(hunt(report([], { errors: [{ message: "worker crashed" }] })).unexplained, true);
});

test("a test the hunt was dealt that no runner reported never ran: a runner was lost, and that is said beside the flakes the others found", () => {
  // One runner of twelve wrote no report, and bank_lineage's tests were its.
  const r = report([
    spec("x", 1, [passed(), failed("boom"), passed()]),
    spec("y", 2, [passed(), passed(), passed()]),
    spec("skips itself", 3, [skipped, skipped, skipped]),
  ]);
  const dealt = listing({ "taste_learning.spec.js": ["x", "y", "skips itself"], "bank_lineage.spec.js": ["a", "b"] });
  assert.deepEqual(lost(r, dealt).map((t) => t.key), ["bank_lineage.spec.js › a", "bank_lineage.spec.js › b"]);
  const h = hunt(r, [], dealt);
  assert.equal(h.unexplained, true);
  assert.deepEqual(h.flaky.map((f) => f.title), ["Flaky: taste_learning 'x'"]);
  // Every runner reported (a test its runner skipped is in its report): the
  // one flake accounts for the run.
  const all = hunt(r, [], listing({ "taste_learning.spec.js": ["x", "y", "skips itself"] }));
  assert.deepEqual([all.unexplained, all.lost], [false, []]);
});

test("more tests failing in one hunt than a few are one thing wrong, not that many flakes: no issue for each", () => {
  const some = Array.from({ length: MANY }, (_, i) => spec(`t${i}`, i + 1, [failed("x")]));
  assert.equal(hunt(report(some)).flaky.length, MANY);
  const h = hunt(report([...some, spec("one more", 99, [failed("x")])]));
  assert.deepEqual(h.flaky, []);
  assert.equal(h.unexplained, true);
  assert.equal(h.failed.length, MANY + 1);
});

test("a Flaky: title fits GitHub's 256 characters, cut short with …", () => {
  const t = { file: "x.spec.js", title: "w".repeat(400) };
  const title = flakyTitle(t);
  assert.equal(title.length, 256);
  assert.match(title, /^Flaky: x 'w+…'$/);
  assert.ok(titledFor(title, t));
});

test("the check names each quarantined test that names no issue, and why", () => {
  // `--list` writes each test once, with no results.
  const listed = (title, line, opts = {}) => ({ ...spec(title, line, [], opts), tests: [{ annotations: opts.annotations || [], expectedStatus: "passed", results: [] }] });
  const listing = report([
    listed("named", 1, { tags: ["quarantine"], annotations: [issue(1)] }),
    listed("unnamed", 2, { tags: ["quarantine"] }),
    listed("a link", 3, { tags: ["quarantine"], annotations: [{ type: "issue", description: "https://example.com/issues/3" }] }),
    listed("not quarantined", 4),
  ]);
  assert.deepEqual(unnamed(listing), [
    "taste_learning.spec.js:2 'unnamed'",
    "taste_learning.spec.js:3 'a link' (its issue annotation is not of the form \"#N\")",
  ]);
});

// The steps the workflows run: their outputs are what the comments and
// issues are made from, and `unowned` and `unexplained` are what turn a run
// red or file an issue of its own. `files`: a JSON file for each option
// (`--listed`, `--open`), or `undefined` for one asked for and not there.
function step(cmd, r, outcome, files = {}) {
  const dir = mkdtempSync(join(tmpdir(), "flakes-"));
  const out = join(dir, "out");
  writeFileSync(out, "");
  const args = [join(HERE, "flakes.mjs"), cmd, join(dir, "report.json"), "--outcome", outcome];
  if (r) writeFileSync(join(dir, "report.json"), JSON.stringify(r));
  for (const [flag, content] of Object.entries(files)) {
    const path = join(dir, `${flag}.json`);
    if (content !== undefined) writeFileSync(path, JSON.stringify(content));
    args.push(`--${flag}`, path);
  }
  execFileSync(process.execPath, args, { env: { ...process.env, GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: "" }, stdio: "pipe" });
  return Object.fromEntries(readFileSync(out, "utf8").trim().split("\n").map((l) => [l.slice(0, l.indexOf("=")), JSON.parse(l.slice(l.indexOf("=") + 1))]));
}
const quarantinedStep = (r, outcome, files) => step("quarantined", r, outcome, files);

test("the quarantine job's step: a quarantined failure becomes a comment on its issue, and nothing that would turn the suite red", () => {
  const out = quarantinedStep(report([spec(SHADE, 503, [failed("boom")], { tags: ["quarantine"], annotations: [issue(173)] })]), "failure");
  assert.equal(out.unowned, 0);
  assert.deepEqual(out.issues.map((i) => i.issue), [173]);
});

test("the quarantine job's step: a failure that names a closed issue turns the suite red, and the open issues unread leave it to the issue named", () => {
  const r = report([spec(SHADE, 503, [failed("boom")], { tags: ["quarantine"], annotations: [issue(173)] })]);
  assert.deepEqual(quarantinedStep(r, "failure", { open: [{ number: 5, title: "Slow suite failing on main" }] }), { issues: [], unowned: 1 });
  assert.equal(quarantinedStep(r, "failure", { open: [{ number: 173, title: "Flaky: taste_learning 'pointing…'" }] }).unowned, 0);
  const unread = quarantinedStep(r, "failure");
  assert.deepEqual([unread.issues.map((i) => i.issue), unread.unowned], [[173], 0]);
});

test("the quarantine job's step: a failed run with no failed test in its report, or no report, is unowned", () => {
  assert.equal(quarantinedStep(report([spec(SHADE, 503, [passed()], { tags: ["quarantine"], annotations: [issue(173)] })]), "failure").unowned, 1);
  assert.equal(quarantinedStep(null, "failure").unowned, 1);
  assert.deepEqual(quarantinedStep(null, "success"), { issues: [], unowned: 0 });
});

test("the hunt's step: a flake and a runner lost in the same failed run file the flake and the run both", () => {
  const r = report([spec("x", 1, [passed(), failed("boom"), passed()])]);
  const dealt = listing({ "taste_learning.spec.js": ["x"], "bank_lineage.spec.js": ["a"] });
  const out = step("hunt", r, "failure", { listed: dealt });
  assert.deepEqual(out.flaky.map((f) => f.title), ["Flaky: taste_learning 'x'"]);
  assert.equal(out.unexplained, true);
  // Every runner reported: the flake is the whole story.
  assert.equal(step("hunt", r, "failure", { listed: listing({ "taste_learning.spec.js": ["x"] }) }).unexplained, false);
  // The listing could not be made: a lost runner would not show, so that is said.
  assert.equal(step("hunt", r, "failure", { listed: undefined }).unexplained, true);
  // No runner wrote a report: every test it was dealt is lost.
  assert.deepEqual(step("hunt", null, "failure", { listed: dealt }), { flaky: [], unexplained: true });
  assert.deepEqual(step("hunt", null, "success"), { flaky: [], unexplained: false });
});
