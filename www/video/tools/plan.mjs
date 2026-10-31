// A walkthrough film's plan, read without a browser. validate.mjs and
// framing.mjs both need what film.js hands to walkthrough() (each beat's
// shot, camera, clips and callouts); film.js is written for a browser, so it
// is run here against a stand-in for stage/walk.js.
//
//   import { loadPlan } from "./plan.mjs";
//   const plan = await loadPlan(filmDir);   // the plan's array, or null
//
// null means the film has no plan to read: its film.js does not call
// walkthrough (by the name walk.js's import gives it: `walkthrough as walk` is
// called `walk(`), as an illustrated film, drawn on the stage, does not, and
// nor does the one that cuts to takes of the app, as launch does; or it has no
// film.js. Such a film is never evaluated: its build() draws on a DOM that
// Node lacks.
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
import { scan } from "./reads.mjs";

const WALK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../stage/walk.js");
const KEPT = "__planFromWalkthrough";

/** The `import { … } from ".../walk.js"` statements of film.js (`plain`: its
 *  source with the comments blanked): where each one is, and the names it
 *  binds, `{ name, local }` (`walkthrough as walk` is `{ walkthrough, walk }`). */
function walkImports(plain) {
  const re = /\bimport\s*\{([^}]*)\}\s*from\s*(["'])([^"'\n]*\/walk\.js)\2\s*;?/dg;
  return [...plain.matchAll(re)].map((m) => ({
    from: m.index,
    to: m.index + m[0].length,
    binds: m[1]
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [name, local = name] = part.split(/\s+as\s+/);
        return { name, local };
      }),
  }));
}

/** Does film.js call walkthrough? By the name walk.js's import binds it
 *  to (`walkthrough as walk` is called `walk(`); a call of the plain name with
 *  no such import is still a walkthrough, so that loadPlan can say what the
 *  import is missing. A name only a comment or a string mentions is no call. */
export function callsWalkthrough(src) {
  const { plain, code } = scan(src);
  const bound = walkImports(plain).flatMap((i) => i.binds).find((b) => b.name === "walkthrough");
  if (!bound) return /\bwalkthrough\s*\(/.test(code);
  return new RegExp(`(?<![\\w$.])${bound.local.replace(/\$/g, "\\$")}\\s*\\(`).test(code);
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
  const plain = scan(src).plain;
  const imports = walkImports(plain);
  if (!imports.length) throw new Error("film.js calls walkthrough( but imports nothing from stage/walk.js (as `import { walkthrough } from \"../../stage/walk.js\"`; only a named import is read)");
  const edits = [];
  const binds = [];
  for (const imp of imports) {
    for (const { name, local } of imp.binds) {
      if (!STUBS[name]) throw new Error(`film.js imports "${name}" from walk.js, and plan.mjs stands in only for ${Object.keys(STUBS).join(" and ")}`);
      binds.push(`const ${local} = ${STUBS[name]()};`);
    }
    edits.push({ from: imp.from, to: imp.to, text: "" });
  }
  const relative = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])(\.{1,2}\/[^"'\n]*)\2/gd;
  for (const m of plain.matchAll(relative)) {
    if (imports.some((i) => m.index >= i.from && m.index < i.to)) continue;
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
