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
//   node shard.mjs plan --shards 12 [--timings t.json] [--files "…"] [--listing l.json] [-- <playwright options>]
//       print how the tests would split, and run nothing (`--listing`: from a
//       listing saved from `npx playwright test --list --reporter=json`)
//
// Spec files go in --files, not after `--`: Playwright ORs its positional
// filters, so a whole file passed beside a runner's `file:line` selectors
// would run every test in it on every runner. The files narrow the listing;
// the run gets the selectors and the options only.
//   node shard.mjs timings --out timings.json [--by-project] [--failed] report.json [report.json ...]
//       fold Playwright JSON reports into the timings file: a test's time is
//       the median of its runs that passed (one on the gate, three in the
//       nightly Flake hunt); a test the reports did not run, or ran and never
//       passed, keeps the time it had. `--by-project` keeps a time for each
//       project the test ran in (`[firefox] a.spec.js › …`), for a tier that
//       runs in more than one browser and deals each by its own: the nightly
//       Speed budgets job's. `--failed` counts a run that failed or timed out
//       too (not one interrupted): what a deal needs is how long a test holds
//       its runner, and with the budgets judged, a test over one fails having
//       run to its end, every night until it is fixed
//   node shard.mjs budgets [--out over.md] [--failures] report.json [report.json ...]
//       the speed budgets (ADR-022, fixtures.js `budget`) the report's runs
//       recorded over their limit, as a table (the budget, its figure and its
//       limit, the browser, the rates its boot ran at on the profile, the CPU
//       its test ran on, and the test), printed and added to the run's
//       summary; `--failures` adds the tests that failed on something other
//       than a budget, or were interrupted; `--out` writes the same to a file
//       too, for an issue's comment, cut to fit one
//
// A test is weighed by its file and titles, so it keeps its time when lines
// above it move; a test with no time yet (new, renamed, or no timings file at
// all) weighs the median of the known ones. A tier folded `--by-project`
// weighs a test by its time in the project the run lists it in, and until
// that project has any (its first run) by the tier's plain times. Tests
// sharing a line (a loop over describe blocks) go to the same runner, because
// a run selects them by line. Without a timings file the split is still
// deterministic, by count.
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
/** The most an issue's comment holds of `budgets --out` (GitHub takes 65,536
 *  characters; the rest of the comment, and the step's environment, need
 *  room too). */
const ISSUE_CHARS = 40_000;
/** The options that take no value. */
const FLAGS = new Set(["by-project", "failed", "failures"]);

function parseArgs(argv) {
  const dash = argv.indexOf("--");
  const own = dash < 0 ? argv : argv.slice(0, dash);
  const pass = dash < 0 ? [] : argv.slice(dash + 1);
  const [cmd, ...rest] = own;
  const opts = { _: [] };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (FLAGS.has(a.slice(2))) opts[a.slice(2)] = true;
    else if (a.startsWith("--")) opts[a.slice(2)] = rest[++i];
    else opts._.push(a);
  }
  return { cmd, opts, pass };
}

const keyOf = (file, titles) => [file, ...titles].join(" › ");
/** A test's key in one project, in a tier folded `--by-project`. */
const projectKey = (project, key) => `[${project}] ${key}`;

/** Every test in a Playwright JSON report (or `--list` output), as
 *  { key, file, line, project, runs }: `project`, the one it is listed or
 *  run in (the first, where a merged report holds several); `runs`, each of
 *  its runs as { project, status, duration }. */
function testsIn(report) {
  const out = [];
  const walk = (suite, titles) => {
    if (titles.length) out.describes.push({ file: suite.file, line: suite.line, title: titles.join(" › ") });
    for (const spec of suite.specs || []) {
      const key = keyOf(spec.file, [...titles, spec.title]);
      const runs = (spec.tests || []).flatMap((t) => (t.results || []).map((r) => ({ project: t.projectName, status: r.status, duration: r.duration })));
      out.push({ key, file: spec.file, line: spec.line, project: ((spec.tests || [])[0] || {}).projectName, runs });
    }
    for (const child of suite.suites || []) walk(child, [...titles, child.title]);
  };
  out.describes = [];
  // A file's own suite is titled by the file; its describes nest below it.
  for (const fileSuite of report.suites || []) walk(fileSuite, []);
  return out;
}

/** The tests the options select, as Playwright lists them, or as a listing
 *  saved from `npx playwright test --list --reporter=json` (`listing`, a
 *  path) says. */
function listTests(pass, listing) {
  let report;
  if (listing) report = JSON.parse(readFileSync(listing, "utf8"));
  else {
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
    report = JSON.parse(r.stdout);
  }
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
 *  { load, units: [{ sel, weight, keys }] }. A tier folded `--by-project`
 *  weighs each test by its time in the project it is listed in, once that
 *  project has times of its own; until then (its first run, seeded with
 *  another tier's times) by the plain ones. */
function plan(tests, timings, n) {
  const isTime = (s) => typeof s === "number" && s > 0;
  const projects = [...new Set(tests.map((t) => t.project).filter(Boolean))];
  const own = Object.entries(timings).filter(([k, s]) => isTime(s) && projects.some((p) => k.startsWith(`[${p}] `)));
  const byProject = own.length > 0;
  const timeOf = (t) => (byProject ? timings[projectKey(t.project, t.key)] : timings[t.key]);
  const known = (byProject ? own : Object.entries(timings).filter(([k, s]) => isTime(s) && !k.startsWith("[")))
    .map(([, s]) => s)
    .sort((a, b) => a - b);
  const fallback = known.length ? known[known.length >> 1] : DEFAULT_WEIGHT_S;
  const units = new Map();
  let timed = 0;
  for (const t of tests) {
    // Anchored at a path separator, or `smoke.spec.js` would also select a
    // file whose name ends in it.
    const sel = `/${t.file}:${t.line}`;
    const u = units.get(sel) || { sel, weight: 0, keys: [] };
    const time = timeOf(t);
    if (isTime(time)) timed++;
    u.weight += time ?? fallback;
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
  return { runners, fallback, timed, total: tests.length, hash, from: byProject ? ` in ${projects.join(", ")}` : "" };
}

const minutes = (s) => `${(s / 60).toFixed(1)} min`;

function describe(p) {
  const lines = [
    `${p.total} tests, ${p.timed} with a time from main${p.from} (others weigh ${p.fallback.toFixed(1)} s); plan ${p.hash}`,
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
  const p = plan(listTests([...filesOf(opts), ...pass], opts.listing), readTimings(opts.timings), n);
  console.log(describe(p));
  return 0;
}

function cmdTimings(opts) {
  if (!opts.out) throw new Error("timings wants --out");
  const timings = readTimings(opts.out);
  // A test's runs that passed, from every report (`--repeat-each` gives
  // several, and inside a describe each repeat is a spec of its own). A
  // failed run's time is how long it took to fail, not how long the test
  // takes: a timeout's is the timeout. With `--failed` it counts all the
  // same (the header says why); an interrupted run's never does, since it
  // took as long as it got.
  const counted = new Set(opts.failed ? ["passed", "failed", "timedOut"] : ["passed"]);
  const runs = new Map();
  for (const path of opts._) {
    // A runner that stopped before its tests wrote no report.
    if (!existsSync(path)) {
      console.log(`timings: no report at ${path}, skipped`);
      continue;
    }
    for (const t of testsIn(JSON.parse(readFileSync(path, "utf8")))) {
      for (const r of t.runs) {
        const key = opts["by-project"] && r.project ? projectKey(r.project, t.key) : t.key;
        const ds = runs.get(key) || [];
        if (counted.has(r.status) && typeof r.duration === "number" && r.duration > 0) ds.push(r.duration);
        runs.set(key, ds);
      }
    }
  }
  let folded = 0;
  for (const [key, ds] of runs) {
    if (!ds.length) continue;
    const sorted = [...ds].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    timings[key] = Math.round(median / 100) / 10;
    folded++;
  }
  const sorted = Object.fromEntries(Object.entries(timings).sort(([a], [b]) => (a < b ? -1 : 1)));
  writeFileSync(opts.out, `${JSON.stringify(sorted, null, 1)}\n`);
  console.log(`timings: ${folded} tests folded from ${opts._.length} report(s); ${Object.keys(sorted).length} in ${opts.out}`);
  return 0;
}

/** A budget's annotation as fixtures.js `budget` writes it: "<name>
 *  <figure> ms of <limit> ms", then " on <profile> in <browser> (<rates>)"
 *  where the test booted on a profile, then " (over)" where it is over. */
const BUDGET = /^(.*) (\S+) ms of (\d+(?:\.\d+)?) ms(?: on (\S+) in (\S+) \(([^()]*)\))?( \(over\))?$/;
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
/** An error's first line, without the terminal's colours. */
const firstLine = (text) => String(text || "").replace(ANSI, "").split("\n").find((l) => l.trim()) || "";

/** What a report's runs say about speed: every budget recorded over its
 *  limit, and every run that failed on something else (an error that is not
 *  a budget's soft assertion, a timeout) or was interrupted. Each with the
 *  test (`file`, `line`, `title`), its project (`browser`) and the CPU it
 *  ran on (`runner`, the annotation fixtures.js gives a test that failed;
 *  null where there is none). */
function budgetsIn(report) {
  const over = [];
  const failures = [];
  const walk = (suite, titles) => {
    for (const spec of suite.specs || []) {
      const title = [...titles, spec.title].join(" › ");
      for (const t of spec.tests || []) {
        for (const r of t.results || []) {
          const annotations = r.annotations || [];
          const runner = (annotations.find((a) => a.type === "runner") || {}).description || null;
          const at = { file: spec.file, line: spec.line, title, browser: t.projectName || null, runner };
          for (const a of annotations) {
            if (a.type !== "budget") continue;
            const text = a.description || "";
            const m = BUDGET.exec(text);
            if (m && m[7]) over.push({ ...at, name: m[1], figure: m[2], limit: m[3], profile: m[4] || null, browser: at.browser || m[5] || null, rates: m[6] || null });
            // One the pattern does not read (a fixture that writes it
            // otherwise) is still listed, whole.
            else if (!m && / \(over\)$/.test(text)) over.push({ ...at, name: text, figure: null, limit: null, profile: null, rates: null });
          }
          const errors = (r.errors && r.errors.length ? r.errors : r.error ? [r.error] : []).map((e) => firstLine(e.message || e.value));
          const other = errors.filter((e) => !/^(Error: )?budget: /.test(e));
          if (r.status === "interrupted") failures.push({ ...at, why: "interrupted: its runner reached its cut, and the tests after it there did not run" });
          else if ((r.status === "failed" || r.status === "timedOut") && (other.length || !errors.length)) failures.push({ ...at, why: other[0] || r.status });
        }
      }
    }
    for (const child of suite.suites || []) walk(child, [...titles, child.title]);
  };
  for (const s of report.suites || []) walk(s, []);
  const order = (a, b) => (a.browser || "").localeCompare(b.browser || "") || a.file.localeCompare(b.file) || a.line - b.line;
  return { over: over.sort(order), failures: failures.sort(order) };
}

/** A table cell: no pipe or line break of its own. */
const cell = (s) => (s == null || s === "" ? "—" : String(s).replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " "));

/** The budgets over their limit and, asked, the other failures, as
 *  markdown: { lines (each a line of the text), rows (the index of each
 *  line that is one budget or failure, which a cut may drop) }. */
function budgetsMarkdown({ over, failures }, withFailures) {
  const lines = ["### Speed budgets over their limit (ADR-022)", ""];
  const rows = [];
  if (over.length) {
    const by = {};
    for (const o of over) by[o.browser || "no project"] = (by[o.browser || "no project"] || 0) + 1;
    const where = Object.entries(by).map(([b, n]) => `${n} in ${b}`).join(", ");
    lines.push(`${over.length} over their limit: ${where}. The rates are what each test's boot slowed the engine, the farm and the page by on the profile, from its runner's calibration; the runner is the CPU it ran on.`, "");
    lines.push("| Budget | Figure | Limit | Browser | Rates on the profile | Runner | Test |", "| --- | ---: | ---: | --- | --- | --- | --- |");
    for (const o of over) {
      rows.push(lines.length);
      const ms = (x) => (x == null ? "—" : `${cell(x)} ms`);
      lines.push(`| ${cell(o.name)} | ${ms(o.figure)} | ${ms(o.limit)} | ${cell(o.browser)} | ${o.rates ? cell(`${o.profile}: ${o.rates}`) : "—"} | ${cell(o.runner)} | \`${o.file}:${o.line}\` |`);
    }
  } else {
    lines.push("No budget was over its limit.");
  }
  if (withFailures && failures.length) {
    lines.push("", `#### Failed on something other than a budget (${failures.length})`, "");
    for (const f of failures) {
      rows.push(lines.length);
      lines.push(`- \`${f.file}:${f.line}\` in ${f.browser || "no project"}${f.runner ? ` on ${f.runner}` : ""}: ${f.title}: ${f.why}`);
    }
  }
  return { lines, rows };
}

/** The markdown as one text of at most about `limit` characters: whole
 *  rows dropped from the end until it fits, and a line that says how many
 *  went. */
function cut({ lines, rows }, limit) {
  const all = `${lines.join("\n")}\n`;
  if (all.length <= limit) return all;
  const drop = new Set();
  const note = (n) => `\n… and ${n} more: the run's summary lists them all.\n`;
  let length = all.length + note(rows.length).length;
  for (let i = rows.length - 1; i >= 0 && length > limit; i--) {
    drop.add(rows[i]);
    length -= lines[rows[i]].length + 1;
  }
  return `${lines.filter((_, i) => !drop.has(i)).join("\n")}\n${note(drop.size)}`;
}

/** Every budget a run recorded over its limit (its annotation ends
 *  "(over)"), each run of a test its own row: on the gate a budget is
 *  recorded, not judged, so this is where a slow app or runner shows; on
 *  the nightly Speed budgets job, judged, it is what made the job red, with
 *  the other failures beside it (`--failures`). */
function cmdBudgets(opts) {
  const found = { over: [], failures: [] };
  for (const path of opts._) {
    if (!existsSync(path)) continue;
    const { over, failures } = budgetsIn(JSON.parse(readFileSync(path, "utf8")));
    found.over.push(...over);
    found.failures.push(...failures);
  }
  const md = budgetsMarkdown(found, !!opts.failures);
  if (opts.out) writeFileSync(opts.out, cut(md, ISSUE_CHARS));
  if (!found.over.length && !(opts.failures && found.failures.length)) {
    console.log("budgets: none over its limit");
    return 0;
  }
  const text = `${md.lines.join("\n")}\n`;
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
  return 0;
}

const { cmd, opts, pass } = parseArgs(process.argv.slice(2));
const commands = { run: cmdRun, plan: cmdPlan, timings: cmdTimings, budgets: cmdBudgets };
if (!commands[cmd]) {
  console.error("usage: node shard.mjs run|plan|timings|budgets … (see the header)");
  process.exit(2);
}
try {
  process.exit(await commands[cmd](opts, pass));
} catch (e) {
  console.error(`shard: ${e.message}`);
  process.exit(2);
}
