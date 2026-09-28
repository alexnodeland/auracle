// view-perform's camera and callouts, resolved against timeline.json the way
// walk.js resolves them: every beat's camera keyframes in order, every
// callout inside its beat with until after at, and no callout up while the
// camera moves.
//
//   node www/video/films/view-perform/lint_plan.mjs      (from the repo root)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const F = path.dirname(fileURLToPath(import.meta.url));
const tl = JSON.parse(fs.readFileSync(`${F}/timeline.json`, "utf8"));
let src = fs.readFileSync(`${F}/film.js`, "utf8");
src = src.replace(/import\s*\{[^}]*\}\s*from\s*"[^"]*walk\.js";/, `
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
function aim(z, x, y) { if (z <= 1) return [z, 0.5, 0.5]; const f = (p, span) => clamp(((p * z) / span - 0.5) / (z - 1), 0, 1); return [z, f(x, 1920), f(y, 1080)]; }
let captured = null;
async function walkthrough(stage, opts) { captured = opts; }
export function plan() { return captured; }`);
const tmp = path.join(os.tmpdir(), `lint-vp-${process.pid}.mjs`);
fs.writeFileSync(tmp, src);
const mod = await import(tmp);
await mod.build({});
const { plan } = mod.plan();
fs.unlinkSync(tmp);
function wordTime(l, word) {
  const i = l.text.toLowerCase().indexOf(word.toLowerCase());
  if (i < 0) return l.t0;
  if (l.words) return l.words[Math.min(l.text.slice(0, i).split(/\s+/).filter(Boolean).length, l.words.length - 1)];
  return l.t0 + ((l.t1 - l.t0) * i) / l.text.length;
}
function at(b, spec) {
  if (typeof spec === "number") return b.t0 + spec;
  const off = /([+-]\d+(?:\.\d+)?)$/.exec(spec);
  if (off) return at(b, spec.slice(0, off.index)) + Number(off[1]);
  const [id, w] = spec.split(":");
  const l = tl.lines.find((x) => x.id === id);
  if (!l) throw new Error(`no line ${id}`);
  return w ? wordTime(l, w) : l.t0;
}
const issues = [];
for (const p of plan) {
  const b = tl.beats.find((x) => x.id === p.beat);
  const cam = (p.cam || []).map(([a, z, fx, fy]) => ({ t: at(b, a), v: [z, fx, fy], a }));
  for (let i = 1; i < cam.length; i++) if (cam[i].t < cam[i - 1].t - 1e-6) issues.push(`${p.beat}: camera keyframe ${cam[i].a} (${cam[i].t.toFixed(2)}) before ${cam[i - 1].a} (${cam[i - 1].t.toFixed(2)})`);
  const moves = [];
  for (let i = 1; i < cam.length; i++) if (cam[i].v.some((x, j) => Math.abs(x - cam[i - 1].v[j]) > 1e-6)) moves.push([cam[i - 1].t, cam[i].t]);
  for (const c of p.callouts || []) {
    const a0 = at(b, c.at);
    const a1 = c.until != null ? at(b, c.until) : b.t1;
    if (a1 <= a0 + 0.3) issues.push(`${p.beat}: "${c.text}" is up only ${(a1 - a0).toFixed(2)} s`);
    if (a0 < b.t0 - 0.01 || a0 > b.t1) issues.push(`${p.beat}: "${c.text}" starts outside its beat`);
    for (const [m0, m1] of moves) if (a0 < m1 - 0.05 && a1 - 0.3 > m0 + 0.05) issues.push(`${p.beat}: "${c.text}" (${a0.toFixed(2)}–${a1.toFixed(2)}) is up while the camera moves (${m0.toFixed(2)}–${m1.toFixed(2)})`);
  }
}
console.log(`lint: ${issues.length ? issues.length + " issue(s)" : "ok"}`);
for (const i of issues) console.log("  - " + i);
