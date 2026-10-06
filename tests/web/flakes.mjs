#!/usr/bin/env node
// Who a browser run's failures are for: the issue each failed test belongs
// to (#177 §1.5, §1.1).
//
// A quarantined test names its flake issue in its declaration, as a
// Playwright annotation beside the tag:
//
//   test("…", { tag: "@quarantine", annotation: { type: "issue", description: "#N" } }, …)
//
// The annotation travels with the test into every report, so CI can tell the
// issue what happened without anyone reading the run.
//
//   node flakes.mjs check
//       every test tagged @quarantine names its issue that way (`make
//       spec-lint` runs it)
//   node flakes.mjs quarantined report.json [--outcome failure]
//       the Slow suite's quarantine job (slow-suite.yml): each issue with the
//       quarantined tests of its that failed, one comment's worth, as
//       `issues=<json>` in GITHUB_OUTPUT, and as `unowned=<n>` the failures
//       no issue owns (a test naming none, a test cut short, an error outside
//       any test, or a run that failed with no failed test in its report):
//       those are not a known flake, and the job turns the suite red on them
//
// The report is Playwright's JSON, a run's blobs merged (`npx playwright
// merge-reports --reporter json`). A test's repeats (`--repeat-each`) are one
// test here, with how many of its runs failed.
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

const plain = (s) => String(s ?? "").replace(/\u001b\[[0-9;]*m/g, "");

/** The issue an annotation list names (`{ type: "issue", description:
 *  "#173" }`), or null. */
export function issueOf(annotations) {
  for (const a of annotations || []) {
    const m = a && a.type === "issue" && /^#(\d+)$/.exec(String(a.description ?? "").trim());
    if (m) return Number(m[1]);
  }
  return null;
}

/** Every test in a Playwright JSON report (or `--list` output), its repeats
 *  together: { key, file, line, title, tags, issue, issueNoted, runs,
 *  failed, interrupted, errors, runners }. `issueNoted`: it carries an
 *  `issue` annotation at all, well formed or not. */
export function testsIn(report) {
  const byKey = new Map();
  const walk = (suite, titles) => {
    for (const spec of suite.specs || []) {
      const title = [...titles, spec.title].join(" › ");
      const key = `${spec.file} › ${title}`;
      const t = byKey.get(key) || {
        key, file: spec.file, line: spec.line, title, tags: spec.tags || [],
        issue: null, issueNoted: false, runs: 0, failed: 0, interrupted: 0, errors: [], runners: [],
      };
      for (const test of spec.tests || []) {
        t.issue ??= issueOf(test.annotations);
        t.issueNoted ||= (test.annotations || []).some((a) => a && a.type === "issue");
        for (const r of test.results || []) {
          if (r.status === "skipped") continue;
          t.runs++;
          if (r.status === "interrupted") t.interrupted++;
          else if (r.status !== (test.expectedStatus || "passed")) {
            t.failed++;
            const first = plain((r.error || (r.errors || [])[0] || {}).message).split("\n").find((l) => l.trim());
            if (first && !t.errors.includes(first.trim())) t.errors.push(first.trim());
            for (const a of r.annotations || []) if (a.type === "runner" && !t.runners.includes(a.description)) t.runners.push(a.description);
          }
        }
      }
      byKey.set(key, t);
    }
    for (const child of suite.suites || []) walk(child, [...titles, child.title]);
  };
  // A file's own suite is titled by the file; its describes nest below it.
  for (const fileSuite of report.suites || []) walk(fileSuite, []);
  return [...byKey.values()];
}

const runsSaid = (t) => (t.runs === 1 ? "its one run" : t.failed === t.runs ? `all ${t.runs} of its runs` : `${t.failed} of its ${t.runs} runs`);

/** One failed test, as the comment's first line says it. */
export function failedSaid(t) {
  return `\`${t.file}:${t.line}\` '${t.title}', ${runsSaid(t)}`;
}

/** What the failed runs said, for under that line: each run's first error
 *  line, and the runners they failed on. */
export function detailOf(tests) {
  const lines = [];
  for (const t of tests) for (const e of t.errors) lines.push(`${t.file}:${t.line}: ${e.length > 300 ? `${e.slice(0, 299)}…` : e}`);
  const runners = [...new Set(tests.flatMap((t) => t.runners))];
  return [
    lines.length ? ["```", ...lines, "```"].join("\n") : "",
    runners.length ? `Failed on ${runners.join("; ")}.` : "",
  ].filter(Boolean).join("\n\n");
}

/** The Slow suite's quarantine job: each issue with its quarantined tests
 *  that failed, and what no issue owns. */
export function quarantined(report) {
  const tests = testsIn(report);
  const owned = new Map();
  const unowned = [];
  for (const t of tests) {
    if (t.interrupted > 0) unowned.push(`${t.file}:${t.line} '${t.title}' was cut short (interrupted)`);
    if (!t.failed) continue;
    if (!t.tags.includes("quarantine")) unowned.push(`${t.file}:${t.line} '${t.title}' failed and is not quarantined`);
    else if (t.issue == null) unowned.push(`${t.file}:${t.line} '${t.title}' failed and names no issue`);
    else owned.set(t.issue, [...(owned.get(t.issue) || []), t]);
  }
  for (const e of report.errors || []) unowned.push(`an error outside any test: ${plain(e.message).split("\n")[0]}`);
  const issues = [...owned].sort(([a], [b]) => a - b).map(([issue, ts]) => ({
    issue,
    failed: ts.map(failedSaid).join("; "),
    detail: detailOf(ts),
  }));
  return { issues, unowned, failed: tests.filter((t) => t.failed > 0).length };
}

/** The tests tagged @quarantine that do not name their issue. */
export function unnamed(listing) {
  return testsIn(listing)
    .filter((t) => t.tags.includes("quarantine") && t.issue == null)
    .map((t) => `${t.file}:${t.line} '${t.title}'${t.issueNoted ? " (its issue annotation is not of the form \"#N\")" : ""}`);
}

function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  const opts = { _: [] };
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith("--")) opts[rest[i].slice(2)] = rest[++i];
    else opts._.push(rest[i]);
  }
  return { cmd, opts };
}

function output(name, value) {
  const line = `${name}=${typeof value === "string" ? value : JSON.stringify(value)}`;
  console.log(line);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${line}\n`);
}

function summary(text) {
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
}

const readReport = (path) => (path && existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null);

function cmdCheck() {
  // --pass-with-no-tests: with nothing quarantined, there is nothing to name.
  const r = spawnSync("npx", ["playwright", "test", "--list", "--reporter=json", "--pass-with-no-tests", "--grep", "@quarantine"], {
    cwd: HERE,
    encoding: "utf8",
    maxBuffer: 64 << 20,
  });
  if (r.status !== 0) {
    process.stderr.write(r.stderr || r.stdout);
    return 1;
  }
  const bad = unnamed(JSON.parse(r.stdout));
  if (!bad.length) return 0;
  console.error(
    `A test tagged @quarantine names its flake issue beside the tag, so the Slow suite can comment there when it fails:\n` +
      `  { tag: "@quarantine", annotation: { type: "issue", description: "#<issue>" } }\n` +
      `(tests/web/AGENTS.md, docs/process.md § Flakes). These do not:\n${bad.map((b) => `  ${b}`).join("\n")}`,
  );
  return 1;
}

function cmdQuarantined(opts) {
  const report = readReport(opts._[0]);
  const q = report ? quarantined(report) : { issues: [], unowned: [], failed: 0 };
  const unowned = [...q.unowned];
  if (opts.outcome === "failure" && !q.failed && !unowned.length) {
    unowned.push(report ? "the run failed, and its report names no failed test" : "the run failed and left no report");
  }
  output("issues", q.issues);
  output("unowned", String(unowned.length));
  if (q.issues.length) {
    summary(`### Quarantined tests that failed\n\n${q.issues.map((i) => `- #${i.issue}: ${i.failed}`).join("\n")}\n\nEach is said on its own issue (on main), and none turns this run red.\n`);
  }
  if (unowned.length) summary(`### Not a known flake\n\n${unowned.map((u) => `- ${u}`).join("\n")}\n`);
  return 0;
}

const commands = { check: cmdCheck, quarantined: cmdQuarantined };
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const { cmd, opts } = parseArgs(process.argv.slice(2));
  if (!commands[cmd]) {
    console.error("usage: node flakes.mjs check|quarantined … (see the header)");
    process.exit(2);
  }
  try {
    process.exit(commands[cmd](opts));
  } catch (e) {
    console.error(`flakes: ${e.message}`);
    process.exit(2);
  }
}
