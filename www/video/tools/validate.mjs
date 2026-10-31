// Check a film's references before rehearsing it. Every film that has a
// shots.json (a walkthrough's, or an illustrated film's that cuts to takes of
// the app, as launch does) has its shots checked: every "line:word" in an
// action or a clip resolves to the same word under footage.mjs's rule (word
// start) and walk.js's (substring), every mark is measured by its shot, and
// every shot is in a beat of the timeline. A film whose film.js calls
// walkthrough( has its plan checked too, run with a stand-in for walk.js
// (plan.mjs): the same words in its camera, clips and callouts, every
// callout's mark measured by its shot, a shot borrowed by the beat before its
// own starting where the shot does, and every beat with a plan entry. An
// illustrated film's film.js draws on a DOM, so it is never run. A film with
// no shots.json and no plan (taste, math, dsp, engine) says so and passes.
//
//   node www/video/tools/validate.mjs FILM       (exit 1 on any problem)
//
// FILMS_DIR names another directory of films (the tool's own test reads
// scratch copies this way); its relative imports resolve from there.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPlan } from "./plan.mjs";

const film = process.argv[2];
if (!film) {
  console.error("usage: validate.mjs FILM");
  process.exit(2);
}
const films = process.env.FILMS_DIR
  ? path.resolve(process.env.FILMS_DIR)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../films");
const fdir = path.join(films, film);
if (!fs.existsSync(fdir)) {
  console.error(`${film}: no such film (${fdir})`);
  process.exit(2);
}
if (!fs.existsSync(`${fdir}/timeline.json`)) {
  console.log(`${film}: 1 problem(s)\n  - no timeline.json: voice.sh writes it`);
  process.exit(1);
}
const tl = JSON.parse(fs.readFileSync(`${fdir}/timeline.json`, "utf8"));
const shots = fs.existsSync(`${fdir}/shots.json`) ? JSON.parse(fs.readFileSync(`${fdir}/shots.json`, "utf8")) : null;
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
for (const sh of shots ? shots.shots : []) {
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

// film.js: its plan, run with a stand-in walkthrough (null for a film drawn
// on the stage, which has none).
let plan = null;
try {
  plan = await loadPlan(fdir);
} catch (e) {
  problems.push(e.message);
}
if (plan && !shots) problems.push("film.js calls walkthrough( but the film has no shots.json");
if (!shots && !plan && !problems.length) {
  console.log(`${film}: no shots.json and no walkthrough plan: nothing to check`);
  process.exit(0);
}
const seen = new Set();
for (const p of plan || []) {
  const sh = shots && shots.shots.find((s) => s.id === p.shot);
  if (!sh && shots) problems.push(`plan ${p.beat}: no shot ${p.shot}`);
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
if (plan) for (const b of tl.beats) if (!seen.has(b.id)) problems.push(`beat ${b.id} has no plan entry`);
console.log(`${film}: ${problems.length ? problems.length + " problem(s)" : plan ? "ok" : "ok (takes only: the film has no walkthrough plan)"}`);
for (const p of problems) console.log("  - " + p);
process.exit(problems.length ? 1 : 0);
