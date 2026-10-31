// shard.mjs timings: the times the next run's deal weighs each test by. A
// test's time is the median of its runs that passed, in seconds to a tenth:
// a failed run's time is how long it took to fail (a timeout's is the
// timeout), so it never counts, except in the nightly Speed budgets' own
// timings (`--failed`), kept for each browser (`--by-project`), which its
// deal (`plan`) weighs each browser's tests by. And `budgets`: the table of
// budgets over their limit, and the other failures, that the run's summary
// and that job's issue comment show. Run as CI runs it, the CLI on files.
// `make web-check` runs it.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

const run = (status, duration) => ({ status, duration });
/** A spec at the top of its file: one test per repeat, each with its run. */
const spec = (title, runs) => ({ title, file: "a.spec.js", line: 1, tags: [], tests: runs.map((r) => ({ results: [r] })) });
const report = (specs, suites = []) => ({ suites: [{ title: "a.spec.js", file: "a.spec.js", specs, suites }], errors: [] });

/** `node shard.mjs timings --out <t.json> <reports…>` over these timings and
 *  reports (null for a report path with no file), and what it wrote. */
function fold(timings, reports) {
  const dir = mkdtempSync(join(tmpdir(), "shard-"));
  const out = join(dir, "timings.json");
  if (timings) writeFileSync(out, JSON.stringify(timings));
  const paths = reports.map((r, i) => {
    const path = join(dir, `report-${i}.json`);
    if (r) writeFileSync(path, JSON.stringify(r));
    return path;
  });
  execFileSync(process.execPath, [join(HERE, "shard.mjs"), "timings", "--out", out, ...paths], { stdio: "pipe" });
  return JSON.parse(readFileSync(out, "utf8"));
}

test("a test's time is the median of its runs that passed; a failed run's time does not count", () => {
  const t = fold(null, [report([
    // Two passed, and one failed at its timeout, last: 6 s, not 9 (the
    // failed run counted) nor 60 (the last run taken).
    spec("two passed, one timed out", [run("passed", 3000), run("passed", 9000), run("failed", 60_000)]),
    // Three passed: the middle one, not the mean (12 s).
    spec("three passed", [run("passed", 30_000), run("passed", 2000), run("passed", 4000)]),
    // An interrupted run took as long as it got.
    spec("one passed, one cut short", [run("passed", 1500), run("interrupted", 40_000)]),
  ])]);
  assert.deepEqual(t, {
    "a.spec.js › one passed, one cut short": 1.5,
    "a.spec.js › three passed": 4,
    "a.spec.js › two passed, one timed out": 6,
  });
});

test("a test that never passed, or did not run, keeps the time it had; a test with none yet gets one", () => {
  const t = fold(
    { "a.spec.js › never passed": 7.5, "a.spec.js › not run": 12, "a.spec.js › ran": 99 },
    [report([spec("never passed", [run("failed", 120_000), run("timedOut", 120_000)]), spec("ran", [run("passed", 2000)]), spec("new", [run("passed", 800)])])],
  );
  assert.deepEqual(t, { "a.spec.js › never passed": 7.5, "a.spec.js › new": 0.8, "a.spec.js › not run": 12, "a.spec.js › ran": 2 });
});

test("a test's repeats inside a describe, each a spec of its own, and its runs across runners' reports are one test's runs", () => {
  const inner = (r) => ({ title: "inner", file: "a.spec.js", line: 4, tags: [], tests: [{ results: [r] }] });
  const group = (runs) => [{ title: "group", file: "a.spec.js", line: 3, specs: runs.map(inner) }];
  const t = fold(null, [
    report([], group([run("passed", 1000), run("passed", 5000)])),
    // A runner that stopped before its tests wrote no report: skipped.
    null,
    report([], group([run("passed", 3000), run("failed", 90_000)])),
  ]);
  assert.deepEqual(t, { "a.spec.js › group › inner": 3 });
});

// The nightly Speed budgets job runs the same tests in two browsers and deals
// each browser's runners by that browser's times, from one report that
// merges both.
const projectSpec = (title, runs) => ({ title, file: "a.spec.js", line: 1, tags: [], tests: runs.map(([project, r]) => ({ projectName: project, results: [r] })) });

test("--by-project keeps a time for each project a test ran in; --failed counts a failed or timed-out run, never an interrupted one", () => {
  const dir = mkdtempSync(join(tmpdir(), "shard-"));
  const out = join(dir, "timings.json");
  const path = join(dir, "merged.json");
  writeFileSync(path, JSON.stringify(report([
    projectSpec("both", [["chromium", run("passed", 60_000)], ["firefox", run("passed", 30_000)]]),
    // Over a budget, so failed, having run to its end: its time is how long
    // it holds its runner.
    projectSpec("over a budget", [["chromium", run("failed", 240_000)], ["firefox", run("timedOut", 120_000)]]),
    projectSpec("cut short", [["chromium", run("interrupted", 5_000)]]),
  ])));
  writeFileSync(out, JSON.stringify({ "a.spec.js › both": 9 }));
  execFileSync(process.execPath, [join(HERE, "shard.mjs"), "timings", "--out", out, "--by-project", "--failed", path], { stdio: "pipe" });
  assert.deepEqual(JSON.parse(readFileSync(out, "utf8")), {
    // The plain time it had is kept: a tier seeded from another's.
    "a.spec.js › both": 9,
    "[chromium] a.spec.js › both": 60,
    "[chromium] a.spec.js › over a budget": 240,
    "[firefox] a.spec.js › both": 30,
    "[firefox] a.spec.js › over a budget": 120,
  });
  // Without the two, as the gate folds: the median of the passed runs of
  // every project, under the plain key.
  assert.deepEqual(fold(null, [JSON.parse(readFileSync(path, "utf8"))]), { "a.spec.js › both": 45 });
});

/** A listing as `npx playwright test --list --reporter=json` writes one, of
 *  tests in `project`, each `[title, line]`. */
const listing = (project, tests) => report(tests.map(([title, line]) => ({ title, file: "a.spec.js", line, tags: [], tests: [{ projectName: project }] })));

/** `node shard.mjs plan` over a listing and timings: each runner's load in
 *  minutes, and its first line. */
function planOf(list, timings, shards) {
  const dir = mkdtempSync(join(tmpdir(), "shard-"));
  writeFileSync(join(dir, "list.json"), JSON.stringify(list));
  writeFileSync(join(dir, "t.json"), JSON.stringify(timings));
  const text = execFileSync(process.execPath, [join(HERE, "shard.mjs"), "plan", "--shards", String(shards), "--timings", join(dir, "t.json"), "--listing", join(dir, "list.json")], { encoding: "utf8" });
  return { head: text.split("\n")[0], loads: [...text.matchAll(/~(\d+\.\d) min/g)].map((m) => Number(m[1])) };
}

test("a tier folded by project deals by the listed project's times, and before it has any by its plain ones", () => {
  const tests = [["long", 1], ["short", 2], ["mid", 3]];
  const timings = {
    "a.spec.js › long": 60, "a.spec.js › short": 6, "a.spec.js › mid": 30,
    "[firefox] a.spec.js › long": 120, "[firefox] a.spec.js › short": 600, "[firefox] a.spec.js › mid": 300,
  };
  // Firefox's own times: `short` alone is the heaviest runner's load.
  const firefox = planOf(listing("firefox", tests), timings, 2);
  assert.deepEqual(firefox.loads, [10, 7]);
  assert.match(firefox.head, /^3 tests, 3 with a time from main in firefox /);
  // Chromium has none of its own yet: the plain times, as the gate deals.
  const chromium = planOf(listing("chromium", tests), timings, 2);
  assert.deepEqual(chromium.loads, [1, 0.6]);
  assert.match(chromium.head, /^3 tests, 3 with a time from main \(others/);
});

test("a test with no time in its project weighs its time in another, or its plain one, scaled by how the two compare, and only with neither the median", () => {
  // Chromium takes twice Firefox's time on the tests both timed, and four
  // times the gate's. `short` is the test the cut stopped in Chromium,
  // which Firefox ran; `solo` ran in neither, but has a time on the gate;
  // `new` has none anywhere.
  const timings = {
    "a.spec.js › long": 60, "a.spec.js › mid": 30, "a.spec.js › solo": 10,
    "[firefox] a.spec.js › long": 120, "[firefox] a.spec.js › mid": 60, "[firefox] a.spec.js › short": 300,
    "[chromium] a.spec.js › long": 240, "[chromium] a.spec.js › mid": 120,
  };
  const got = planOf(listing("chromium", [["long", 1], ["mid", 2], ["short", 3], ["solo", 4], ["new", 5]]), timings, 3);
  assert.match(got.head, /^5 tests, 2 with a time from main in chromium, 2 by their time in another browser or on the gate, scaled \(others weigh 240\.0 s\)/);
  // short 300 × 2 = 600 s alone; long 240 and mid 120; new 240 (the
  // median) and solo 10 × 4 = 40. Weighed the median, short would share a
  // runner as the cut test did.
  assert.deepEqual(got.loads, [10, 6, 4.7]);
});

/** A result of a test in `project` that recorded these annotations, ended
 *  `status`, with these errors' messages. */
const result = (status, annotations, errors = []) => ({ status, duration: 1000, annotations, errors: errors.map((message) => ({ message })) });
const budgetSpec = (title, line, project, r, expectedStatus = "passed") => ({ title, file: "b.spec.js", line, tags: [], tests: [{ projectName: project, expectedStatus, results: [r] }] });
const RUNNER = { type: "runner", description: "4 × AMD EPYC 7763 64-Core Processor" };

/** `node shard.mjs budgets [--failures] --out <file> <report>`: what it
 *  printed, and what it wrote. Outside a run of Actions, unless `env` says
 *  otherwise (this suite runs inside one in CI). */
function budgets(rep, flags = [], env = {}) {
  const dir = mkdtempSync(join(tmpdir(), "shard-"));
  writeFileSync(join(dir, "merged.json"), JSON.stringify(rep));
  const out = join(dir, "over.md");
  const outside = { GITHUB_STEP_SUMMARY: "", GITHUB_SERVER_URL: "", GITHUB_REPOSITORY: "", GITHUB_SHA: "" };
  const printed = execFileSync(process.execPath, [join(HERE, "shard.mjs"), "budgets", ...flags, "--out", out, join(dir, "merged.json")], { encoding: "utf8", env: { ...process.env, ...outside, ...env } });
  return { printed, written: readFileSync(out, "utf8") };
}

test("each budget over its limit is a row: its name, figure and limit, the browser, the profile's rates, the runner's CPU and the test", () => {
  const rep = report([
    budgetSpec("a pick", 10, "firefox", result("failed", [
      { type: "budget", description: "pick 12 → the next pair on the table 3404 ms of 100 ms on air in firefox (engine and farm ×8.21, page ×1) (over)" },
      { type: "budget", description: "within: the click → sounding 40 ms of 100 ms on air in firefox (engine and farm ×8.21, page ×1)" },
      RUNNER,
    ], ["Error: budget: pick 12 → the next pair on the table\n\nexpect(received).toBeLessThanOrEqual(expected)"])),
    // A name with its own parentheses and a pipe; on the gate, no profile
    // and no runner (the test passed).
    budgetSpec("a frame", 20, "chromium", result("passed", [{ type: "budget", description: "a frame (median) | loop 5 ms of 2 ms (over)" }])),
  ]);
  const { written } = budgets(rep);
  const rows = written.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| Budget") && !l.startsWith("| ---"));
  assert.deepEqual(rows, [
    "| a frame (median) \\| loop | 5 ms | 2 ms | chromium | — | — | a frame (`b.spec.js:20`) |",
    "| pick 12 → the next pair on the table | 3404 ms | 100 ms | firefox | air: engine and farm ×8.21, page ×1 | 4 × AMD EPYC 7763 64-Core Processor | a pick (`b.spec.js:10`) |",
  ]);
  // In a run of Actions, the place links to the test's line at the run's commit.
  const run = { GITHUB_SERVER_URL: "https://github.com", GITHUB_REPOSITORY: "o/r", GITHUB_SHA: "abc123" };
  assert.match(budgets(rep, [], run).written, /\| a pick \(\[`b\.spec\.js:10`\]\(https:\/\/github\.com\/o\/r\/blob\/abc123\/tests\/web\/b\.spec\.js#L10\)\) \|$/m);
  assert.match(written, /^2 over their limit: 1 in chromium, 1 in firefox\./m);
  // A test that failed on its budgets alone is not a failure of another kind.
  assert.doesNotMatch(budgets(rep, ["--failures"]).written, /other than a budget/);
});

test("--failures lists each test that failed on something other than a budget, or was cut short, with its runner", () => {
  const rep = report([
    budgetSpec("stalls", 30, "chromium", result("timedOut", [RUNNER], ["Test timeout of 114878ms exceeded."])),
    budgetSpec("both", 40, "firefox", result("failed", [RUNNER, { type: "budget", description: "x 9 ms of 1 ms (over)" }], ["Error: budget: x", "\u001b[31mError: expect(locator).toHaveText(expected) failed\u001b[39m\n\nLocator: …"])),
    budgetSpec("cut", 50, "chromium", result("interrupted", [], ["Error: page.waitForTimeout: Test ended."])),
    budgetSpec("fine", 60, "chromium", result("passed", [])),
  ]);
  const { written, printed } = budgets(rep, ["--failures"]);
  assert.match(written, /#### Failed on something other than a budget \(3\)/);
  assert.match(written, /^- `b\.spec\.js:30` in chromium on 4 × AMD EPYC 7763 64-Core Processor: stalls: Test timeout of 114878ms exceeded\.$/m);
  assert.match(written, /^- `b\.spec\.js:50` in chromium: cut: interrupted: its runner reached its cut/m);
  assert.match(written, /^- `b\.spec\.js:40` in firefox on .*: both: Error: expect\(locator\)\.toHaveText\(expected\) failed$/m);
  assert.doesNotMatch(written, /fine/);
  assert.equal(printed.trim(), written.trim());
  // Without the flag, as the gate's report asks, only the budgets.
  assert.doesNotMatch(budgets(rep).written, /other than a budget/);
});

test("--failures judges a run against what its test expects: a test.fail() that fails is no failure, and one that passes is", () => {
  const rep = report([
    budgetSpec("judged", 70, "firefox", result("failed", [RUNNER], ["Error: budget: over", "Error: expect(received).toBe(expected)"]), "failed"),
    budgetSpec("not judged", 80, "chromium", result("passed", [RUNNER]), "failed"),
    budgetSpec("stalls", 90, "chromium", result("timedOut", [], ["Test timeout of 1000ms exceeded."]), "failed"),
  ]);
  const { written } = budgets(rep, ["--failures"]);
  assert.match(written, /#### Failed on something other than a budget \(2\)/);
  assert.match(written, /^- `b\.spec\.js:80` in chromium on .*: not judged: passed, where it is marked to end failed \(test\.fail\)$/m);
  assert.match(written, /^- `b\.spec\.js:90` in chromium: stalls: Test timeout of 1000ms exceeded\.$/m);
  assert.doesNotMatch(written, /b\.spec\.js:70/);
});

test("with none over, the file says so; with too many for a comment, it is cut to whole rows and says how many went", () => {
  assert.match(budgets(report([budgetSpec("ok", 1, "chromium", result("passed", [{ type: "budget", description: "a 1 ms of 100 ms" }]))])).written, /^No budget was over its limit\.$/m);
  const many = Array.from({ length: 400 }, (_, i) => budgetSpec(`t${i}`, i + 1, "chromium", result("failed", [RUNNER, { type: "budget", description: `${"a long budget name ".repeat(4)}${i} 900 ms of 100 ms on air in chromium (engine, farm and page ×9) (over)` }], ["Error: budget: …"])));
  const { written, printed } = budgets(report(many));
  assert.ok(written.length <= 40_000, `${written.length} characters`);
  const kept = written.split("\n").filter((l) => /^\| a long/.test(l)).length;
  assert.match(written, new RegExp(`… and ${400 - kept} more: the run's summary lists them all\\.\\n$`));
  assert.ok(kept > 100 && kept < 400, `${kept} rows kept`);
  // The summary keeps them all.
  assert.equal(printed.split("\n").filter((l) => /^\| a long/.test(l)).length, 400);
});
