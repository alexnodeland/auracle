// Check PATCH: inside the sound's references before a rehearsal or a render:
// every "line:word" in shots.json and film.js resolves to the same word under
// footage.mjs's rule (word start) and walk.js's (substring), every callout's
// mark is measured by its shot, every plan beat has a shot, and every beat
// without a plan entry is one of cards.js's (the title, the chapter cards, the
// outro), whose chapters and lines exist.
// usage (from the repo root): node www/video/films/view-patch/validate.mjs
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const fdir = path.dirname(fileURLToPath(import.meta.url));
const film = path.basename(fdir);
const tl = JSON.parse(fs.readFileSync(`${fdir}/timeline.json`, "utf8"));
const shots = JSON.parse(fs.readFileSync(`${fdir}/shots.json`, "utf8"));
const problems = [];

function check(spec, where) {
  if (typeof spec !== "string" || spec.startsWith("@")) return;
  const s = spec.replace(/([+-]\d+(?:\.\d+)?)$/, "");
  const [id, word] = s.split(":");
  const line = tl.lines.find((l) => l.id === id);
  if (!line) return problems.push(`${where}: no line ${id} (${spec})`);
  if (!word) return;
  const words = line.text.split(/\s+/);
  const kf = words.findIndex((w) => w.toLowerCase().replace(/[^\w']/g, "").startsWith(word.toLowerCase()));
  const i = line.text.toLowerCase().indexOf(word.toLowerCase());
  const kw = i < 0 ? -1 : line.text.slice(0, i).split(/\s+/).filter(Boolean).length;
  if (kf < 0) problems.push(`${where}: footage finds no word "${word}" in ${id}`);
  if (i < 0) problems.push(`${where}: walk finds no "${word}" in ${id}`);
  if (kf >= 0 && i >= 0 && kf !== kw) problems.push(`${where}: "${word}" in ${id} is word ${kf} for footage but ${kw} for walk ("${words[kw]}")`);
}

const marks = {};
for (const sh of shots.shots) {
  marks[sh.id] = new Set(Object.keys(sh.marks || {}));
  const walkSteps = (list, where) => {
    for (const a of list || []) {
      if (a.op === "mark") marks[sh.id].add(a.name);
      if (a.op === "seq") walkSteps(a.steps, where);
      for (const k of ["at", "until", "start"]) if (a[k] != null && !(k === "until" && a.op === "until")) check(a[k], `${sh.id} ${a.op} ${k}`);
    }
  };
  walkSteps(sh.actions, sh.id);
  for (const [f] of sh.clips || []) check(f, `${sh.id} clip`);
  if (!tl.beats.find((b) => b.id === sh.beat)) problems.push(`${sh.id}: no beat ${sh.beat}`);
}

// film.js: evaluate its plan with a stub walkthrough.
let src = fs.readFileSync(`${fdir}/film.js`, "utf8");
src = src.replace(/import\s*\{[^}]*\}\s*from\s*"[^"]*walk\.js";/, `
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
function aim(z, x, y) { if (z <= 1) return [z, 0.5, 0.5]; const f = (p, span) => clamp(((p * z) / span - 0.5) / (z - 1), 0, 1); return [z, f(x, 1920), f(y, 1080)]; }
let captured = null;
async function walkthrough(stage, opts) { captured = opts; }
export function plan() { return captured; }`);
const tmp = path.join(os.tmpdir(), `validate-${film}-${process.pid}.mjs`);
fs.writeFileSync(tmp, src);
const mod = await import(tmp);
await mod.build({});
const { plan } = mod.plan();
fs.unlinkSync(tmp);
const seen = new Set();
for (const p of plan) {
  const sh = shots.shots.find((s) => s.id === p.shot);
  if (!sh) problems.push(`plan ${p.beat}: no shot ${p.shot}`);
  // A shot may also show the beat just before its own (a chapter card over
  // its lead-in: the film's walkthrough plan says so with `meta.pre`), when
  // the footage runs on unbroken: both entries must put the shot's start at
  // the same film time. Anything else is a shot in the wrong beat.
  if (sh && sh.beat !== p.beat) {
    const own = tl.beats.find((b) => b.id === sh.beat);
    const here = tl.beats.find((b) => b.id === p.beat);
    const pre = p.meta && p.meta.pre;
    if (pre == null || !own || !here) problems.push(`plan ${p.beat}: shot ${p.shot} is for beat ${sh.beat}`);
    else if (Math.abs((here.t0 - pre) - (own.t0 - (sh.pre || 0))) > 0.001)
      problems.push(`plan ${p.beat}: borrows ${p.shot} (beat ${sh.beat}) but its start is ${(here.t0 - pre).toFixed(3)} s, not the shot's ${(own.t0 - (sh.pre || 0)).toFixed(3)} s`);
    else if (!p.clips || p.clips.length) problems.push(`plan ${p.beat}: borrows ${p.shot}; give it clips: [] so the shot's cuts stay in beat ${sh.beat}`);
  }
  seen.add(p.beat);
  for (const [a] of p.cam || []) check(a, `${p.beat} cam`);
  for (const [a] of p.clips || []) check(a, `${p.beat} clips`);
  for (const c of p.callouts || []) {
    check(c.at, `${p.beat} callout "${c.text}" at`);
    if (c.until != null) check(c.until, `${p.beat} callout "${c.text}" until`);
    if (c.mark && sh && !marks[sh.id].has(c.mark)) problems.push(`${p.beat} callout "${c.text}": shot ${sh.id} measures no mark "${c.mark}"`);
  }
}
// view-patch: the title, the chapter cards and the outro are drawn by cards.js.
const CARDS = new Set(["title", "outro", ...tl.beats.map((b) => b.id).filter((id) => id.startsWith("t-"))]);
for (const b of tl.beats) if (!seen.has(b.id) && !CARDS.has(b.id)) problems.push(`beat ${b.id} has no plan entry`);
// Every card turns onto a beat that has a plan entry, and the card words resolve.
const cardsSrc = fs.readFileSync(`${fdir}/cards.js`, "utf8");
for (const m of cardsSrc.matchAll(/id: "(t-[\w-]+)", beat: "([\w-]+)", shot: "([\w-]+)"/g)) {
  if (!tl.beats.find((b) => b.id === m[1])) problems.push(`card ${m[1]}: no such beat`);
  if (!seen.has(m[2])) problems.push(`card ${m[1]}: its chapter ${m[2]} has no plan entry`);
  if (!shots.shots.find((s) => s.id === m[3] && s.beat === m[2])) problems.push(`card ${m[1]}: no shot ${m[3]} for beat ${m[2]}`);
}
for (const id of ["outro1", "outro2"]) if (!tl.lines.find((l) => l.id === id)) problems.push(`cards: no line ${id}`);
console.log(`${film}: ${problems.length ? problems.length + " problem(s)" : "ok"}`);
for (const p of problems) console.log("  - " + p);
process.exit(problems.length ? 1 : 0);
