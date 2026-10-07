// Where a run's test time goes: a Playwright reporter that splits each test
// into its setup (the browser, the context and the page: Before Hooks), its
// boots (each navigation to the boot veil lifting: a `Navigate` or `Reload`
// step to the end of the fixture's `app.booted()` wait after it), its waits
// for the whole pool after a boot (the fixture's `filled`, `poolRows` and
// `fullPool`, by their titles), the test's own work (the rest) and its
// teardown (After Hooks), and prints the sums at the end.
//
// On a run here, beside the usual reporter:
//
//   npx playwright test bank_find.spec.js --reporter=line,./split.mjs
//
// On a CI run's browser shards, from their blob reports (`gh` signed in):
//
//   gh run download <run> -R alexnodeland/auracle -p 'blob-fast-*' -D /tmp/blobs
//   mkdir -p /tmp/all && cp /tmp/blobs/*/*.zip /tmp/all/
//   npx playwright merge-reports --reporter=./split.mjs /tmp/all
//
// SPLIT_OUT=<file> also writes each test's split as a JSON line. A report
// from before the boot wait had its title (`the boot veil lifted`) is read
// by its `toHaveClass` step in fixtures.js; its pool waits other than
// `filled` have no title and count as the test's own.
// docs/notes/spec-time-2026-10.md is what it measured first.
import fs from "node:fs";

const BOOTED = (s) => s.category === "expect" && (s.title === "the boot veil lifted" || (/toHaveClass/.test(s.title) && /fixtures\.js$/.test((s.location && s.location.file) || "")));
const POOL = [/^a filled reply$/, /^the pool's whole list never came after filled$/, /^the pool never filled$/, /^the pool's \d+ rows in the bank$/];
const HOOKS = new Set(["Before Hooks", "After Hooks"]);

const flat = (steps, out = []) => {
  for (const s of steps) {
    out.push(s);
    flat(s.steps || [], out);
  }
  return out;
};
const ms = (s) => s.startTime.getTime();
// Minutes for a tier, seconds for a few specs.
const span = (x, total) => (total >= 120_000 ? `${(x / 60_000).toFixed(1)} min` : `${(x / 1000).toFixed(1)} s`);
const pct = (x, of) => `${((100 * x) / (of || 1)).toFixed(1)}%`;
const quantile = (xs, q) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(q * xs.length))] : 0);

export default class Split {
  constructor() {
    this.rows = [];
  }

  onTestEnd(test, result) {
    const top = result.steps;
    const hook = (title) => top.filter((s) => s.title === title).reduce((a, s) => a + s.duration, 0);
    const setup = hook("Before Hooks");
    const teardown = hook("After Hooks");
    const body = flat(top.filter((s) => !HOOKS.has(s.title)));
    // A boot: the first navigation after the last boot ended, to the end of
    // the boot wait that follows it.
    const navs = body.filter((s) => s.category === "pw:api" && /^(Navigate|Reload)\b/.test(s.title)).map(ms);
    const boots = [];
    let after = -Infinity;
    for (const w of body.filter(BOOTED)) {
      const from = navs.find((t) => t > after && t <= ms(w));
      if (from == null) continue;
      after = ms(w) + w.duration;
      boots.push(after - from);
    }
    // The pool's waits, outermost only (a wait inside another is in it).
    let pool = 0;
    const walk = (steps) => {
      for (const s of steps) {
        if (POOL.some((r) => r.test(s.title))) pool += s.duration;
        else walk(s.steps || []);
      }
    };
    walk(top.filter((s) => !HOOKS.has(s.title)));
    const boot = boots.reduce((a, b) => a + b, 0);
    this.rows.push({
      file: test.location.file.split(/[\\/]/).pop(),
      line: test.location.line,
      title: test.title,
      status: result.status,
      total: result.duration,
      setup,
      boot,
      boots,
      pool,
      test: Math.max(0, result.duration - setup - boot - pool - teardown),
      teardown,
      // What the fixture said of the renders a boot reused (`reuseRenders`).
      renders: (result.annotations || test.annotations || []).filter((a) => a.type === "renders").map((a) => a.description),
    });
  }

  onEnd() {
    const rows = this.rows.filter((r) => r.status !== "skipped");
    if (process.env.SPLIT_OUT) fs.writeFileSync(process.env.SPLIT_OUT, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
    const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
    const total = sum("total");
    const boots = rows.flatMap((r) => r.boots);
    const lines = [
      "",
      `Where the time went: ${rows.length} tests, ${span(total, total)} of test time`,
      ...["setup", "boot", "pool", "test", "teardown"].map((k) => `  ${k.padEnd(9)} ${span(sum(k), total).padStart(10)}  ${pct(sum(k), total).padStart(6)}`),
      `  ${boots.length} boots: median ${Math.round(quantile(boots, 0.5))} ms, p10 ${Math.round(quantile(boots, 0.1))}, p90 ${Math.round(quantile(boots, 0.9))}`,
      "  (pool: the fixture's waits for the whole pool; test: the rest of the test's own time)",
      "",
    ];
    process.stdout.write(lines.join("\n"));
  }

  printsToStdio() {
    return true;
  }
}
