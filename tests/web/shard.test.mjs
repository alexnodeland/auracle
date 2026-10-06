// shard.mjs timings: the times the next run's deal weighs each test by. A
// test's time is the median of its runs that passed, in seconds to a tenth:
// a failed run's time is how long it took to fail (a timeout's is the
// timeout), so it never counts. Run as CI runs it, the CLI on files.
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
