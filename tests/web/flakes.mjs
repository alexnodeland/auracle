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
//   node flakes.mjs hunt report.json [--open issues.json] [--listed list.json] [--outcome failure]
//       the nightly Flake hunt (flake-hunt.yml): each test that failed, with
//       the `Flaky:` issue it goes to (the one its annotation names, else an
//       open one titled for it, `gh issue list --json number,title`, else a
//       title to open one under), as `flaky=<json>`; and `unexplained=true`
//       when the run failed in a way no test accounts for: an error outside
//       any test, a test cut short, a test the hunt was dealt that no runner
//       reported (`--listed`, the hunt's tests as `playwright test --list
//       --reporter=json` gives them: a runner lost, or a step before its run
//       failed, writes no report; a listing that could not be made counts
//       too), a failed run with no failed test, or more than MANY tests
//       failing in one night, which is one thing wrong with main or the
//       machines rather than that many flakes (those are listed in the run's
//       summary, and no issue is filed for each)
//
// The report is Playwright's JSON, a run's blobs merged (`npx playwright
// merge-reports --reporter json`). A test's repeats (`--repeat-each`) are one
// test here, with how many of its runs failed.
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
/** GitHub's longest issue title. */
const TITLE_MAX = 256;
/** More tests than this failing in one hunt are not each a flake. */
export const MANY = 5;

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

const stem = (file) => String(file).replace(/^.*\//, "").replace(/\.spec\.js$/, "");
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

/** The title a flake's issue has (docs/process.md § Issues): `Flaky: <file>
 *  '<test title>'`, the file without `.spec.js`, the title cut short with …
 *  to fit GitHub's limit. */
export function flakyTitle(t) {
  const head = `Flaky: ${stem(t.file)} '`;
  const room = TITLE_MAX - head.length - 1;
  const title = t.title.length > room ? `${t.title.slice(0, room - 1)}…` : t.title;
  return `${head}${title}'`;
}

/** Whether an issue's title is this test's flake: `Flaky: <file> '<title>'`,
 *  the file with or without `.spec.js`, the quoted title the test's own or
 *  its start cut short with …, and anything after the closing quote a note
 *  (`(no child budded)`), as a title written by hand reads. */
export function titledFor(issueTitle, t) {
  const m = /^Flaky: (\S+) '(.*)'(\s.*)?$/.exec(String(issueTitle).trim());
  if (!m || stem(m[1]) !== stem(t.file)) return false;
  const quoted = m[2];
  if (!quoted.endsWith("…")) return quoted === t.title;
  const start = quoted.slice(0, -1);
  return start.length > 0 && t.title.startsWith(start);
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

/** The tests a listing holds (`playwright test --list`, the tests a run
 *  was dealt) that a run's report does not: a runner that wrote no report
 *  (lost, or a step before its run failed) leaves its tests out of the
 *  merged one. A test its runner skipped is still in the report. */
export function lost(report, listing) {
  const ran = new Set(testsIn(report).map((t) => t.key));
  return testsIn(listing).filter((t) => !ran.has(t.key));
}

/** The nightly hunt: each failed test with the issue it goes to (`issue`,
 *  or "" for a new one under `title`), and whether the run failed in a way
 *  no test accounts for. `open`: the open issues, [{ number, title }].
 *  `listing`: the tests the hunt was dealt, or null to leave that
 *  unchecked. */
export function hunt(report, open = [], listing = null) {
  const tests = testsIn(report);
  const flaky = tests.filter((t) => t.failed > 0).map((t) => {
    const titled = open.filter((i) => titledFor(i.title, t)).sort((a, b) => a.number - b.number)[0];
    return { issue: t.issue ?? (titled ? titled.number : ""), title: flakyTitle(t), failed: failedSaid(t), detail: detailOf([t]) };
  });
  const many = flaky.length > MANY;
  const never = listing ? lost(report, listing) : [];
  const unexplained = many || never.length > 0 || (report.errors || []).length > 0 || tests.some((t) => t.interrupted > 0);
  return { flaky: many ? [] : flaky, unexplained, failed: flaky, lost: never };
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

/** How many lost tests the summary names, before "and N more". */
const LOST_SAID = 20;

function cmdHunt(opts) {
  const report = readReport(opts._[0]);
  const open = opts.open && existsSync(opts.open) ? JSON.parse(readFileSync(opts.open, "utf8")) : [];
  // Asked for and not there: the listing could not be made, so a runner
  // lost would not show.
  const unlisted = opts.listed != null && !existsSync(opts.listed);
  const listing = opts.listed && !unlisted ? JSON.parse(readFileSync(opts.listed, "utf8")) : null;
  // No runner wrote a report: every test the hunt was dealt is lost.
  const h = hunt(report || { suites: [], errors: [] }, open, listing);
  const unexplained = h.unexplained || unlisted || (opts.outcome === "failure" && !h.failed.length);
  output("flaky", h.flaky);
  output("unexplained", String(unexplained));
  if (!report) summary("### No runner wrote a report\n");
  if (h.flaky.length) summary(`### Failed in the hunt\n\n${h.flaky.map((f) => `- ${f.failed}: ${f.issue ? `#${f.issue}` : `a new issue, ${f.title}`}`).join("\n")}\n`);
  else if (h.failed.length) summary(`### Failed in the hunt: ${h.failed.length} tests, more than ${MANY}\n\nOne thing wrong with main or the machines, not that many flakes: no issue is filed for each.\n\n${h.failed.map((f) => `- ${f.failed}`).join("\n")}\n`);
  if (h.lost.length) {
    const named = h.lost.slice(0, LOST_SAID).map((t) => `- \`${t.file}:${t.line}\` '${t.title}'`);
    if (h.lost.length > LOST_SAID) named.push(`- and ${h.lost.length - LOST_SAID} more`);
    summary(`### Never ran: ${h.lost.length} of the ${testsIn(listing).length} tests the hunt was dealt\n\nNo runner's report holds them: a runner was lost, or a step before its run failed.\n\n${named.join("\n")}\n`);
  }
  if (unlisted) summary("### The hunt's tests could not be listed\n\nSo a runner lost would not show here.\n");
  return 0;
}

const commands = { check: cmdCheck, quarantined: cmdQuarantined, hunt: cmdHunt };
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const { cmd, opts } = parseArgs(process.argv.slice(2));
  if (!commands[cmd]) {
    console.error("usage: node flakes.mjs check|quarantined|hunt … (see the header)");
    process.exit(2);
  }
  try {
    process.exit(commands[cmd](opts));
  } catch (e) {
    console.error(`flakes: ${e.message}`);
    process.exit(2);
  }
}
