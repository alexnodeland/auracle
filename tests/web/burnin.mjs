#!/usr/bin/env node
// A PR's burn-in (ci.yml's Burn-in job, #456): which of the spec files it
// adds or edits run three times each, and on how many runners, by main's
// timings (the cache the Browser job deals from).
//
//   node burnin.mjs --timings timings-fast.json --files "a.spec.js b.spec.js"
//       prints one line: the runners (0 for none), then the files burned
//       in; on stderr each file's planned load, and the files left out
//
// Sized by time, never by count: one heavy spec repeated three times is a
// quarter of an hour on one runner, and the Browser job's limits (a run
// interrupted at fourteen minutes, shard.mjs) are the Burn-in's too. As
// many files as fit MAX_RUNNERS runners of LIMIT_S each are burned in: a
// new spec first (main has never run it), then the lightest. The rest run
// once in the Browser job, and the run's summary names them. A file's time
// is the sum of its tests' times on main (their keys are `file › …`,
// shard.mjs's keyOf); a file main has never timed weighs each of its tests
// at the median test's time.
import { readFileSync, existsSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

export const REPEAT = 3;
// A runner's planned share, as the Browser job plans its twelve (about six
// minutes each, against the interrupt at fourteen: the hosted runners
// differ in speed by about a factor of two).
export const TARGET_S = 6 * 60;
// The most one runner may plan before the burn-in is called too heavy.
export const LIMIT_S = 7 * 60;
// The account runs 20 jobs at once, and the queue's run holds 18
// (docs/architecture/testing.md § CI tiers, Runners).
export const MAX_RUNNERS = 3;
const DEFAULT_WEIGHT_S = 12; // shard.mjs's, before any timings exist

/** The median of main's test times, or shard.mjs's default without any. */
export function median(timings) {
  const known = Object.values(timings).filter((s) => typeof s === "number" && s > 0).sort((a, b) => a - b);
  return known.length ? known[known.length >> 1] : DEFAULT_WEIGHT_S;
}

/** How many tests a spec's source declares: `test("…"`, not
 *  `test.describe`, `test.use` or `test.setTimeout`. */
export function testsDeclared(source) {
  return (source.match(/\btest(?:\.(?:only|fixme|fail|slow))?\(\s*["'`]/g) || []).length;
}

/** One spec file's time once, in seconds: its tests' times on main, or for
 *  a file main never timed, its declared tests at the median. */
export function fileSeconds(file, timings, source, med = median(timings)) {
  let s = 0;
  for (const [key, t] of Object.entries(timings)) if (key.startsWith(`${file} › `) && typeof t === "number") s += t;
  return s > 0 ? s : Math.max(1, testsDeclared(source)) * med;
}

/** The burn-in's plan: { runners (0 for none), files (burned in), left
 *  (too heavy to fit beside them, run once), load (seconds, repeats
 *  included, of `files`), perFile }. `sources[file]` is each file's text. */
export function plan({ files, timings, sources, repeat = REPEAT, target = TARGET_S, limit = LIMIT_S, max = MAX_RUNNERS }) {
  const med = median(timings);
  const timed = (f) => Object.keys(timings).some((k) => k.startsWith(`${f} › `));
  const perFile = files.map((f) => ({ file: f, seconds: repeat * fileSeconds(f, timings, sources[f] || "", med), fresh: !timed(f) }));
  // A new spec first, then the lightest, while the whole fits.
  const order = [...perFile].sort((a, b) => b.fresh - a.fresh || a.seconds - b.seconds || (a.file < b.file ? -1 : 1));
  const chosen = [];
  const left = [];
  let load = 0;
  for (const f of order) {
    if (load + f.seconds <= max * limit) {
      chosen.push(f.file);
      load += f.seconds;
    } else left.push(f.file);
  }
  if (!chosen.length) return { runners: 0, files: [], left, load: 0, perFile };
  const runners = Math.min(max, Math.max(1, Math.ceil(load / target)));
  return { runners, files: files.filter((f) => chosen.includes(f)), left: files.filter((f) => left.includes(f)), load, perFile };
}

function main(argv) {
  const opt = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i < 0 ? "" : argv[i + 1] || "";
  };
  const files = opt("files").split(/\s+/).filter(Boolean).map((f) => f.replace(/^\//, ""));
  const tpath = opt("timings");
  let timings = {};
  try {
    if (tpath && existsSync(tpath)) timings = JSON.parse(readFileSync(tpath, "utf8"));
  } catch {
    console.error(`burnin: ${tpath} is not JSON; every test weighs the default`);
  }
  const sources = Object.fromEntries(files.map((f) => [f, existsSync(join(HERE, f)) ? readFileSync(join(HERE, f), "utf8") : ""]));
  const p = plan({ files, timings, sources });
  for (const f of p.perFile) console.error(`burnin: ${f.file} ×${REPEAT} ~${(f.seconds / 60).toFixed(1)} min`);
  console.error(`burnin: ${(p.load / 60).toFixed(1)} min on ${p.runners} runner(s)${p.left.length ? `; too heavy to burn in beside them, run once: ${p.left.join(" ")}` : ""}`);
  console.log([p.runners, ...p.files].join(" "));
}

// Run as a script, not imported (burnin.test.mjs), through a link too.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) main(process.argv.slice(2));
