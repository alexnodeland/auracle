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
import { issueOf, quarantined, testsIn, unnamed } from "./flakes.mjs";

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

// The step the Slow suite's quarantine job runs: its outputs are what the
// comments are made from, and `unowned` is what turns the suite red.
function quarantinedStep(r, outcome) {
  const dir = mkdtempSync(join(tmpdir(), "flakes-"));
  const out = join(dir, "out");
  writeFileSync(out, "");
  const args = [join(HERE, "flakes.mjs"), "quarantined", join(dir, "report.json"), "--outcome", outcome];
  if (r) writeFileSync(join(dir, "report.json"), JSON.stringify(r));
  execFileSync(process.execPath, args, { env: { ...process.env, GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: "" }, stdio: "pipe" });
  return Object.fromEntries(readFileSync(out, "utf8").trim().split("\n").map((l) => [l.slice(0, l.indexOf("=")), JSON.parse(l.slice(l.indexOf("=") + 1))]));
}

test("the quarantine job's step: a quarantined failure becomes a comment on its issue, and nothing that would turn the suite red", () => {
  const out = quarantinedStep(report([spec(SHADE, 503, [failed("boom")], { tags: ["quarantine"], annotations: [issue(173)] })]), "failure");
  assert.equal(out.unowned, 0);
  assert.deepEqual(out.issues.map((i) => i.issue), [173]);
});

test("the quarantine job's step: a failed run with no failed test in its report, or no report, is unowned", () => {
  assert.equal(quarantinedStep(report([spec(SHADE, 503, [passed()], { tags: ["quarantine"], annotations: [issue(173)] })]), "failure").unowned, 1);
  assert.equal(quarantinedStep(null, "failure").unowned, 1);
  assert.deepEqual(quarantinedStep(null, "success"), { issues: [], unowned: 0 });
});
