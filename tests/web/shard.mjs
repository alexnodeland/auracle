#!/usr/bin/env node
// Split the browser specs across CI's runners by how long each test takes,
// not by where it falls in the list.
//
// Playwright's own `--shard=k/N` cuts the list into N runs of equal count, so
// a runner that draws the long PATCH and audio-in tests takes twice as long as
// one that draws the short ones (measured on main at f6f4612: 18.8 min of test
// time on the fullest of five runners, 9.1 on the emptiest). Here every test is
// weighed by its time on main's last run and the runners are filled longest
// test first, each test to the emptiest runner (LPT), so they finish together.
//
//   node shard.mjs run --shard 3/12 [--timings t.json] [--files "a.spec.js …"] [-- <playwright options>]
//       list the tests the files and options select, pick shard 3 of 12, run it
//   node shard.mjs plan --shards 12 [--timings t.json] [--files "…"] [-- <playwright options>]
//       print how the tests would split, and run nothing
//
// Spec files go in --files, not after `--`: Playwright ORs its positional
// filters, so a whole file passed beside a runner's `file:line` selectors
// would run every test in it on every runner. The files narrow the listing;
// the run gets the selectors and the options only.
//   node shard.mjs timings --out timings.json report.json [report.json ...]
//       fold Playwright JSON reports into the timings file (tests the reports
//       did not run keep the time they had)
//
// A test is weighed by its file and titles, so it keeps its time when lines
// above it move; a test with no time yet (new, renamed, or no timings file at
// all) weighs the median of the known ones. Tests sharing a line (a loop over
// describe blocks) go to the same runner, because a run selects them by line.
// Without a timings file the split is still deterministic, by count.
//
// The deal is a partition only if every runner reads the same timings, so CI
// reads them once per run (the engine job uploads them as an artifact every
// runner downloads, a re-run's too), and each runner prints a hash of the
// whole plan: runners of one run that print different hashes dealt from
// different files.
//
// A run that would outlast its job is interrupted, not left to be killed.
// CI's browser jobs set AURACLE_GLOBAL_TIMEOUT_MIN a few minutes under their
// own limit, and the config makes it Playwright's globalTimeout. That alone
// ends a run without ending the test that was running: Playwright 1.63
// reports it as not run, with no error and no trace. So a minute before it
// (half-way, for a limit under two minutes) `run` sends Playwright SIGINT,
// as Ctrl-C would: the running test ends interrupted, naming the wait it was
// in, with its trace, and the blob report is written. The global timeout
// then bounds the teardown.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_WEIGHT_S = 12; // the median test on main before any timings exist
const INTERRUPT_EARLY_MS = 60_000; // how long before the global timeout `run` interrupts

function parseArgs(argv) {
  const dash = argv.indexOf("--");
  const own = dash < 0 ? argv : argv.slice(0, dash);
  const pass = dash < 0 ? [] : argv.slice(dash + 1);
  const [cmd, ...rest] = own;
  const opts = { _: [] };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith("--")) opts[a.slice(2)] = rest[++i];
    else opts._.push(a);
  }
  return { cmd, opts, pass };
}

const keyOf = (file, titles) => [file, ...titles].join(" › ");

/** Every test in a Playwright JSON report (or `--list` output), as
 *  { key, file, line, durations }. */
function testsIn(report) {
  const out = [];
  const walk = (suite, titles) => {
    if (titles.length) out.describes.push({ file: suite.file, line: suite.line, title: titles.join(" › ") });
    for (const spec of suite.specs || []) {
      const key = keyOf(spec.file, [...titles, spec.title]);
      // An interrupted run's time is how far it got, not how long it takes.
      const durations = (spec.tests || []).flatMap((t) => (t.results || []).filter((r) => r.status !== "interrupted").map((r) => r.duration));
      out.push({ key, file: spec.file, line: spec.line, durations });
    }
    for (const child of suite.suites || []) walk(child, [...titles, child.title]);
  };
  out.describes = [];
  // A file's own suite is titled by the file; its describes nest below it.
  for (const fileSuite of report.suites || []) walk(fileSuite, []);
  return out;
}

function listTests(pass) {
  // --pass-with-no-tests: a PR's changed spec may hold only slow tests.
  const r = spawnSync("npx", ["playwright", "test", "--list", "--reporter=json", "--pass-with-no-tests", ...pass], {
    cwd: HERE,
    encoding: "utf8",
    maxBuffer: 64 << 20,
  });
  if (r.status !== 0) {
    process.stderr.write(r.stderr || r.stdout);
    throw new Error(`playwright --list exited ${r.status}`);
  }
  const report = JSON.parse(r.stdout);
  if (report.errors?.length) {
    for (const e of report.errors) process.stderr.write(`${e.message}\n`);
    throw new Error("playwright could not load the specs");
  }
  const tests = testsIn(report);
  // `file:line` also selects a describe declared on that line, and with it
  // every test in its body: if one of those tests is on another line, it has
  // a selector of its own too and would run on two runners.
  const clash = [];
  for (const d of tests.describes) {
    const atLine = tests.some((t) => t.file === d.file && t.line === d.line);
    const inside = tests.filter((t) => t.key.startsWith(`${keyOf(d.file, [d.title])} › `));
    if (atLine && inside.some((t) => t.line !== d.line)) clash.push(`  ${d.file}:${d.line} (describe "${d.title}")`);
  }
  if (clash.length) {
    throw new Error(`a test shares its line with a describe whose other tests are on other lines, so a run by line would select them twice; give the test a line of its own:\n${clash.join("\n")}`);
  }
  return tests;
}

function readTimings(path) {
  if (!path || !existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    process.stderr.write(`shard: ${path} is not JSON; splitting by count\n`);
    return {};
  }
}

/** The tests grouped by the line a run selects them by, weighed, and dealt
 *  to `n` runners longest first. Returns the runners as
 *  { load, units: [{ sel, weight, keys }] }. */
function plan(tests, timings, n) {
  const known = Object.values(timings).filter((s) => typeof s === "number" && s > 0).sort((a, b) => a - b);
  const fallback = known.length ? known[known.length >> 1] : DEFAULT_WEIGHT_S;
  const units = new Map();
  for (const t of tests) {
    // Anchored at a path separator, or `smoke.spec.js` would also select a
    // file whose name ends in it.
    const sel = `/${t.file}:${t.line}`;
    const u = units.get(sel) || { sel, weight: 0, keys: [] };
    u.weight += timings[t.key] ?? fallback;
    u.keys.push(t.key);
    units.set(sel, u);
  }
  // Longest first; ties broken by the selector so every runner computes the
  // same plan from the same list.
  const order = [...units.values()].sort((a, b) => b.weight - a.weight || (a.sel < b.sel ? -1 : 1));
  const runners = Array.from({ length: n }, () => ({ load: 0, units: [] }));
  for (const u of order) {
    let best = 0;
    for (let i = 1; i < n; i++) if (runners[i].load < runners[best].load) best = i;
    runners[best].units.push(u);
    runners[best].load += u.weight;
  }
  const hash = createHash("sha256")
    .update(JSON.stringify(runners.map((r) => r.units.map((u) => u.sel))))
    .digest("hex")
    .slice(0, 12);
  return { runners, fallback, known: known.length, total: tests.length, hash };
}

const minutes = (s) => `${(s / 60).toFixed(1)} min`;

function describe(p) {
  const lines = [
    `${p.total} tests, ${p.known} with a time from main (others weigh ${p.fallback.toFixed(1)} s); plan ${p.hash}`,
    ...p.runners.map((r, i) => `  runner ${i + 1}: ${r.units.reduce((n, u) => n + u.keys.length, 0)} tests, ~${minutes(r.load)}`),
  ];
  return lines.join("\n");
}

function parseShard(s) {
  const m = /^(\d+)\/(\d+)$/.exec(s || "");
  if (!m || +m[1] < 1 || +m[1] > +m[2]) throw new Error(`--shard wants k/N, got ${s}`);
  return [+m[1], +m[2]];
}

const filesOf = (opts) => (opts.files || "").split(/\s+/).filter(Boolean);

function cmdRun(opts, pass) {
  const [k, n] = parseShard(opts.shard);
  const p = plan(listTests([...filesOf(opts), ...pass]), readTimings(opts.timings), n);
  const mine = p.runners[k - 1];
  const summary = `${describe(p)}\nthis is runner ${k}`;
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Browser shard ${k}/${n}\n\n\`\`\`\n${summary}\n\`\`\`\n`);
  }
  if (!mine.units.length) {
    console.log("nothing for this runner");
    return 0;
  }
  return runPlaywright([...mine.units.map((u) => u.sel), ...pass]);
}

/** Playwright's test command with these arguments, interrupted (SIGINT)
 *  ahead of AURACLE_GLOBAL_TIMEOUT_MIN when it is set (the header says why).
 *  Run as node and the CLI's own file, not through npx, so the signal
 *  reaches Playwright itself. Resolves to its exit code. */
function runPlaywright(args) {
  const limitMs = Number(process.env.AURACLE_GLOBAL_TIMEOUT_MIN || 0) * 60_000;
  const cli = join(HERE, "node_modules", "@playwright", "test", "cli.js");
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, "test", ...args], { cwd: HERE, stdio: "inherit" });
    const at = limitMs > 0 ? Math.max(limitMs / 2, limitMs - INTERRUPT_EARLY_MS) : 0;
    const timer = at > 0
      ? setTimeout(() => {
          console.log(`shard: ${(at / 60_000).toFixed(1)} min in, ${((limitMs - at) / 60_000).toFixed(1)} before the global timeout: interrupting the run, so the test running now is reported`);
          child.kill("SIGINT");
        }, at)
      : null;
    child.on("exit", (code) => {
      if (timer) clearTimeout(timer);
      resolve(code ?? 1);
    });
  });
}

function cmdPlan(opts, pass) {
  const n = Number(opts.shards || 1);
  const p = plan(listTests([...filesOf(opts), ...pass]), readTimings(opts.timings), n);
  console.log(describe(p));
  return 0;
}

function cmdTimings(opts) {
  if (!opts.out) throw new Error("timings wants --out");
  const timings = readTimings(opts.out);
  let folded = 0;
  for (const path of opts._) {
    // A runner that stopped before its tests wrote no report.
    if (!existsSync(path)) {
      console.log(`timings: no report at ${path}, skipped`);
      continue;
    }
    for (const t of testsIn(JSON.parse(readFileSync(path, "utf8")))) {
      // A test's time is its last attempt's (a retry, or `--repeat-each`,
      // gives several; the gate runs each once).
      const d = t.durations.at(-1);
      if (typeof d === "number" && d > 0) {
        timings[t.key] = Math.round(d / 100) / 10;
        folded++;
      }
    }
  }
  const sorted = Object.fromEntries(Object.entries(timings).sort(([a], [b]) => (a < b ? -1 : 1)));
  writeFileSync(opts.out, `${JSON.stringify(sorted, null, 1)}\n`);
  console.log(`timings: ${folded} tests folded from ${opts._.length} report(s); ${Object.keys(sorted).length} in ${opts.out}`);
  return 0;
}

const { cmd, opts, pass } = parseArgs(process.argv.slice(2));
const commands = { run: cmdRun, plan: cmdPlan, timings: cmdTimings };
if (!commands[cmd]) {
  console.error("usage: node shard.mjs run|plan|timings … (see the header)");
  process.exit(2);
}
try {
  process.exit(await commands[cmd](opts, pass));
} catch (e) {
  console.error(`shard: ${e.message}`);
  process.exit(2);
}
