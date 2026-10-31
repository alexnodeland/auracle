// A walkthrough film's plan, read without a browser. validate.mjs and
// framing.mjs both need what film.js hands to walkthrough() (each beat's
// shot, camera, clips and callouts); film.js is written for a browser, so it
// is run here against a stand-in for stage/walk.js.
//
//   import { loadPlan } from "./plan.mjs";
//   const plan = await loadPlan(filmDir);   // the plan's array, or null
//
// null means the film has no plan to read: its film.js does not call
// walkthrough( (an illustrated film is drawn on the stage, and so is the one
// that cuts to takes of the app, as launch does), or it has no film.js. Such
// a film is never evaluated: its build() draws on a DOM that Node lacks.
//
// What the stand-in brings in is what film.js imports from walk.js and no
// more: `walkthrough` (it keeps the options it is given) and `aim` (walk.js's
// own source, so the keyframes it computes cannot drift from the real ones).
// The copy that runs is written outside the film's directory, so its other
// relative imports (`./cards.js`, `../../stage/kit.js`) are made absolute.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const WALK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../stage/walk.js");
const KEPT = "__planFromWalkthrough";

/** The source with its comments blanked to spaces, so that a name in a
 *  comment is not mistaken for code and every index still points into the
 *  original. A `//` after a quote or a colon is a string or a URL, not a
 *  comment. */
function blanked(src) {
  return src.replace(/\/\*[\s\S]*?\*\/|(?<![:\\"'`])\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, " "));
}

/** Does this film.js call walkthrough( ? */
export function callsWalkthrough(src) {
  return /\bwalkthrough\s*\(/.test(blanked(src));
}

/** walk.js's `aim`, as an expression, with the stage's `clamp` it uses. */
function aimSource() {
  const m = /export function aim\([^)]*\)\s*\{[\s\S]*?\n\}/.exec(fs.readFileSync(WALK, "utf8"));
  if (!m) throw new Error(`plan.mjs cannot find \`export function aim\` in ${WALK}`);
  const clamp = "const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));";
  return `(() => { ${clamp} ${m[0].replace(/^export /, "")} return aim; })()`;
}

const STUBS = {
  walkthrough: () => `async (stage, opts) => { ${KEPT}_opts = opts; }`,
  aim: aimSource,
};

/** film.js's source, ready to run in Node: the walk.js import replaced by the
 *  stand-in, every other relative import pointing at the film's directory. */
function standIn(src, fdir) {
  const code = blanked(src);
  const edits = [];
  const walk = /\bimport\s*\{([^}]*)\}\s*from\s*(["'])([^"'\n]*\/walk\.js)\2\s*;?/d.exec(code);
  if (!walk) throw new Error("film.js calls walkthrough( but imports nothing from stage/walk.js (as `import { walkthrough } from \"../../stage/walk.js\"`)");
  const binds = [];
  for (const part of walk[1].split(",").map((s) => s.trim()).filter(Boolean)) {
    const [name, local = name] = part.split(/\s+as\s+/);
    if (!STUBS[name]) throw new Error(`film.js imports "${name}" from walk.js, and plan.mjs stands in only for ${Object.keys(STUBS).join(" and ")}`);
    binds.push(`const ${local} = ${STUBS[name]()};`);
  }
  edits.push({ from: walk.index, to: walk.index + walk[0].length, text: "" });
  const relative = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])(\.{1,2}\/[^"'\n]*)\2/gd;
  for (const m of code.matchAll(relative)) {
    if (m.index >= walk.index && m.index < walk.index + walk[0].length) continue;
    const [from, to] = m.indices[3];
    edits.push({ from, to, text: pathToFileURL(path.resolve(fdir, m[3])).href });
  }
  let out = src;
  for (const e of edits.sort((a, b) => b.from - a.from)) out = out.slice(0, e.from) + e.text + out.slice(e.to);
  return `let ${KEPT}_opts = null;\nexport const ${KEPT} = () => ${KEPT}_opts;\n${binds.join("\n")}\n${out}`;
}

/** The plan film.js gives walkthrough(), or null when the film has none.
 *  Throws, saying why, when the film calls walkthrough( and cannot be read. */
export async function loadPlan(fdir) {
  const file = path.join(fdir, "film.js");
  if (!fs.existsSync(file)) return null;
  const src = fs.readFileSync(file, "utf8");
  if (!callsWalkthrough(src)) return null;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "plan-"));
  try {
    const copy = path.join(tmp, "film.mjs");
    fs.writeFileSync(copy, standIn(src, fdir));
    let opts;
    try {
      const mod = await import(pathToFileURL(copy).href);
      await mod.build({});
      opts = mod[KEPT]();
    } catch (e) {
      throw new Error(`film.js could not be run for its plan: ${(e && e.message) || e}. Its build() runs here against an empty stage, in Node: load the stage and the kit inside build(), after walkthrough(), as view-perform does.`);
    }
    if (!opts || !Array.isArray(opts.plan)) throw new Error("film.js calls walkthrough( but build() never gave it a plan");
    return opts.plan;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
