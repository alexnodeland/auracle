// Record the real instrument for a film: picture and its own sound.
//
//   node www/video/tools/footage.mjs FILM                   → every shot in films/FILM/shots.json
//   node www/video/tools/footage.mjs FILM --shot ID[,ID…]   → those shots
//   node www/video/tools/footage.mjs FILM --dry [--shot …]  → a rehearsal: no picture, no sound
//
// Each shot boots the app from apps/web (the committed wasm, so the footage
// matches the build), runs its setup off camera, then records while it plays
// its actions on a clock. Actions can be pinned to the narration: `at:
// "hood1:Turn"` is the moment the voice reaches "Turn" in line hood1, measured
// from the shot's beat (timeline.json carries word times once the voice is
// in; before that, tools/timeline.py estimates them).
//
// Picture: Chromium's screencast, JPEG q92, every frame the page paints, with
// its own timestamp; resampled to a constant 30 fps by time, not by count, so
// a dropped paint repeats a frame instead of shortening the clip. The paints
// are kept as JPEG files (out/FILM/shots/ID/NNNNN.jpg) with an index
// (ID.frames.json); nothing is encoded, so the next shot starts at once. Sound: the
// app's master bus, tapped through the ?film capture hook (main.js), so the
// voices and every audition are in it (▶ on a bank row, the duels, the node
// bank's preview, space), and no toast lands in the shot. Both are stamped in
// wall time, and the offset between them is written beside the clip.
//
// Only the capture (auracle-film-capture.wav) is the shot's sound: any other
// download the shot starts (an export: .auracle.json, .png, .svg, a taste
// profile, a ● rec take) is kept beside the clip in ID.dl/ and listed in the
// sidecar. The capture has its own switch, so ● rec can be pressed on camera:
// the take it makes, and its "saved … take" toast, are the app's own.
//
// A rehearsal (`--dry`) runs every shot's set-up and actions against the live
// app at their times, and records neither picture nor sound. It saves a
// screenshot when recording would start, at every `mark` and `snap`, and at
// the end (out/FILM/dry/ID-*.jpg), and a sidecar (out/FILM/dry/ID.json) with
// the marks, the stamps, how late each action started, what `log` read, and
// every error. A shot passes when its `errors` are empty. It never touches
// out/FILM/shots. In either mode a shot whose set-up fails is reported and
// skipped, and the run exits non-zero.
//
// shots.json: {viewport, dpr, query, init, setup: [step…], shots: [shot…]}
//   - init: a script run in every page before the app (a seeded Math.random
//     makes every shot's session the same pool, the same warm-start cards,
//     the same duel sides, so a rehearsal predicts the recording).
//   - setup: the film's common set-up, run before each shot's own.
//   shot: {id, beat, pre, dur?, query?, own_setup?, setup, marks, actions, clips?}
//   - pre: seconds recorded before the beat starts (the clip's lead-in).
//   - dur: seconds; by default the beat as timed now, plus `pre` and 0.8 s,
//     so re-timing the narration re-times the footage too. "@stamp+s" ends
//     the shot that long after a stamp.
//   - query: this shot's URL query, in place of the film's (`?film` needed).
//   - own_setup: replace the film's common set-up with the shot's own.
//   - marks: {name: selector}, measured when recording starts; a `mark`
//     action measures one mid-shot. stage/walk.js pins callouts to them.
//   - clips: a cut inside the beat, [[film, from, rate?], …]. From narration
//     time `film` ("line:word±s", or seconds from the beat's start) the film
//     shows the shot from `from` (shot-clock seconds, or "@stamp±s"), at
//     `rate` times real time (default 1). It is for a press whose result
//     arrives tens of seconds later (EVOLVE POOL, ⚡ evolve from this): the
//     shot keeps recording through the wait, only the last few seconds of it
//     stay in memory, and it runs on until the beat's end inside the last
//     window. Narration times after a cut are mapped through it, so an action
//     keyed to a word lands where the film will show it. A cut never goes
//     back: if what it waits for came early, it starts where the footage had
//     reached. The sidecar carries the windows with their stamps resolved,
//     for walk.js.
//
// Times (`at`; `until` for how long a hold, press, key or drag lasts, in
// place of `ms`; `"ms": "end"` holds until the shot's end):
//   1.5                 seconds on the shot's clock (0 = recording starts, `pre` before the beat)
//   "keys1:Play"        when the narration reaches "Play" in line keys1 ("keys1": the line's start)
//   "keys1:Play+0.45"   … plus an offset in seconds
//   "@benched+0.3"      after a stamp (an `until` with `stamp` records when it came)
// `"snap": "beat"` (or "bar") moves an action's time on to the next beat of
// the score (timeline.json's grid), so a chord the arpeggiator plays lands in
// time with the music; `"until_snap"` does the same for `until`, so a chord
// struck at the shot's start can last to the first bar line, where the next
// one (snapped) comes in.
//
// A `sel` is a Playwright selector, and an op acts on its first match: CSS
// with :has(), :has-text() and :text-is(), a list `a, b` (the first in page
// order: "the first bass card on the grid") and `>> nth=1` (the second).
//
// Ops, for set-up steps and actions alike:
//   wait {ms} | {until}                 pause; in a `seq`, until a narration time (if not past)
//   until {sel, state?, ms?, stamp?}    wait for an element state (default visible), or {js} for a
//                                       page predicate; `stamp` records when, for "@stamp" times
//   mark {name, sel}                    measure an element now (a popover, a toast)
//   snap {name}                         a rehearsal screenshot (nothing when recording)
//   log {js, name?}                     evaluate js in the page; the value goes into the sidecar
//   click {sel, force?}  dblclick {sel} a click; a double-click (renaming a bank row)
//   view {v}                            a view tab: perform, play (PATCH), evolve, taste
//   preset {name}                       open a preset from the preset bank, and wait for it
//   measured {name?, settle?}           wait until PERFORM has measured the patch
//   key {key, ms?}                      press and release one key
//   hold {keys, ms}                     hold keys together (["Shift", "a"] plays an accent)
//   type {text, sel?, ms?, enter?}      type into sel (or whatever has focus), ms between keys
//   select {sel, value}                 choose a <select> option (input and change both fire)
//   drag {sel, dx?, dy? | to, ms?, ox?, oy?, tox?, toy?}
//                                       press, move and release: by an offset, or onto the
//                                       element `to` (a held module back onto a socket)
//   press {sel, ms?, ox?, oy? | fx?, fy?}
//                                       hold the pointer down on an element, at its centre plus
//                                       (ox, oy) px or at (fx, fy) of its box; on the keybed the
//                                       strike point is the velocity (0.35 at the top, 1.0 at
//                                       the front edge)
//   path {sel, points, ms}              a gesture through points in [0,1] of an element's box
//   move {sel, ox?, oy?, ms?}           glide the pointer onto an element (hover), ms long
//   drop {file, sel?, ms?}              a file (a path in the film's folder, e.g. fixtures/x.svg)
//                                       dragged over the window for ms, then dropped on sel
//   midi {…}                            MIDI in, through the app's ?film port (main.js):
//     {device: "name"}                  plug a device in (the MIDI panel names it)
//     {note: 60 | [60, 64], vel?, ms?, ch?}   notes on, and off ms later (vel 1–127)
//     {cc, value} | {cc, values: [a, b, …], ms}   one controller value, or a turn through them
//     {pressure: v | [v, …], ms?}       channel pressure, 0–127
//     {bend: v | [v, …], ms?}           pitch bend, −1…1
//     {clock: bpm, beats, start?, start_snap?, stop?}
//                                       24 ticks a beat, timed in the page and
//                                       timestamped; Start (0xFA) before the first
//                                       tick (`start: true`), or on the clock's beat
//                                       nearest a time (`start: "clock2:start"`)
//     {start: true} | {stop: true} | {bytes: [0xB0, 74, 64]}
//   seq {steps}                         steps in order, as one action
//   rec {on: false}                     stop the shot's capture now: the shot's sound ends
//                                       here (quietly; to show a take, press ● rec on camera)
//   eval {js}                           run js in the page
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const { chromium } = require(path.join(ROOT, "tests/web/node_modules/playwright"));

const film = process.argv[2];
if (!film || film.startsWith("--")) {
  console.error("usage: footage.mjs FILM [--shot ID[,ID…]] [--dry]");
  process.exit(2);
}
const only = (() => {
  const i = process.argv.indexOf("--shot");
  return i > 0 ? new Set(process.argv[i + 1].split(",")) : null;
})();
const DRY = process.argv.includes("--dry");
const fdir = path.join(ROOT, "www/video/films", film);
const odir = path.join(ROOT, "www/video/out", film, DRY ? "dry" : "shots");
fs.mkdirSync(odir, { recursive: true });
const spec = JSON.parse(fs.readFileSync(path.join(fdir, "shots.json"), "utf8"));
const timeline = JSON.parse(fs.readFileSync(path.join(fdir, "timeline.json"), "utf8"));
const FPS = 30;
// What a cut keeps of the wait it skips: the last few seconds, so the next
// window can start a little before the stamp that opens it.
const KEEP_S = 6;
const MIME = { ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json", ".wav": "audio/wav" };
const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

// The app's own dev-server rules: no-store, so a rebuilt pkg/ is never stale.
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp" };
function serve() {
  const base = path.join(ROOT, "apps/web");
  const srv = http.createServer((req, res) => {
    let u = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (u.endsWith("/")) u += "index.html";
    const f = path.join(base, u);
    if (!f.startsWith(base) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream", "Cache-Control": "no-store" });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((r) => srv.listen(0, "127.0.0.1", () => r(srv)));
}

/** Film time of a narration point: "lineId:word" (word times if the voice is
 *  in, else by characters), a bare "lineId" (its start), or a number of
 *  seconds from the beat's start; with an optional offset ("offer1:Press+0.4"). */
function filmTime(at, beat, errors) {
  if (typeof at === "number") return (beat ? beat.t0 : 0) + at;
  const off = /([+-]\d+(?:\.\d+)?)$/.exec(at);
  if (off) return filmTime(at.slice(0, off.index), beat, errors) + Number(off[1]);
  const [id, word] = at.split(":");
  const line = timeline.lines.find((l) => l.id === id);
  if (!line) throw new Error(`no line ${id}`);
  let t = line.t0;
  if (word) {
    const words = line.text.split(/\s+/);
    const k = words.findIndex((w) => w.toLowerCase().replace(/[^\w']/g, "").startsWith(word.toLowerCase()));
    if (k >= 0) t = line.words ? line.words[k] : line.t0 + ((line.t1 - line.t0) * words.slice(0, k).join(" ").length) / line.text.length;
    else errors?.push(`no word "${word}" in ${id}: timed at the line's start`);
  }
  return t;
}

const STAMP = /^@([\w-]+)([+-]\d+(?:\.\d+)?)?$/;

/** The shot's clock: shot seconds from narration times, through any cut, and
 *  the stamps that `until … stamp` records. */
class Clock {
  constructor(shot, beat, errors) {
    this.beat = beat;
    this.errors = errors;
    this.origin = (beat ? beat.t0 : 0) - (shot.pre || 0);
    this.stamps = {};
    this.waiting = new Map(); // stamp -> [{res, rej}]
    this.failed = new Map(); // stamp -> why
    this.cuts = (shot.clips || [])
      .map(([f, from, rate = 1]) => ({ spec: f, film: filmTime(f, beat, errors), from, rate }))
      .sort((a, b) => a.film - b.film);
  }
  stamp(name, t) {
    this.stamps[name] = t;
    for (const w of this.waiting.get(name) || []) w.res(t);
    this.waiting.delete(name);
  }
  fail(name, why) {
    this.failed.set(name, why);
    for (const w of this.waiting.get(name) || []) w.rej(new Error(`stamp ${name} never came (${why})`));
    this.waiting.delete(name);
  }
  when(name) {
    if (name in this.stamps) return Promise.resolve(this.stamps[name]);
    if (this.failed.has(name)) return Promise.reject(new Error(`stamp ${name} never came (${this.failed.get(name)})`));
    return new Promise((res, rej) => this.waiting.set(name, [...(this.waiting.get(name) || []), { res, rej }]));
  }
  /** A cut's `from`: shot seconds, or null while its stamp has not come. */
  from(v) {
    if (typeof v === "number") return v;
    const m = STAMP.exec(v);
    if (!m) throw new Error(`bad clip start ${v}`);
    return m[1] in this.stamps ? this.stamps[m[1]] + Number(m[2] || 0) : null;
  }
  /** Where cut i starts on the shot's clock, or null while a stamp it needs
   *  has not come. A cut skips a wait and never goes back: if what it waits
   *  for came early, it starts where the footage before it had reached. */
  start(i) {
    const c = this.cuts[i];
    const want = this.from(c.from);
    if (want == null) return null;
    const prev = i === 0 ? c.film - this.origin : this.start(i - 1);
    if (prev == null) return null;
    const reached = i === 0 ? prev : prev + (c.film - this.cuts[i - 1].film) * this.cuts[i - 1].rate;
    return Math.max(want, reached);
  }
  /** Film time → shot seconds; waits for the stamps a cut starts from. */
  async shotAt(f) {
    for (;;) {
      let i = -1;
      this.cuts.forEach((c, k) => { if (f >= c.film) i = k; });
      if (i < 0) return f - this.origin;
      const s = this.start(i);
      if (s != null) return s + (f - this.cuts[i].film) * this.cuts[i].rate;
      const need = this.cuts.slice(0, i + 1).map((c) => STAMP.exec(String(c.from))).find((m) => m && !(m[1] in this.stamps));
      await this.when(need[1]);
    }
  }
  /** An action's `at` → shot seconds; `snap` ("beat" or "bar") moves it on
   *  to the score's next beat or bar line. */
  async at(at, snap) {
    if (at == null) at = 0;
    const m = typeof at === "string" && STAMP.exec(at);
    if (m) return (await this.when(m[1])) + Number(m[2] || 0);
    let f = typeof at === "number" ? at + this.origin : filmTime(at, this.beat, this.errors);
    if (snap) {
      const g = timeline.grid || { bpm: 120, meter: 4, t0: 0 };
      const unit = (60 / g.bpm) * (snap === "bar" ? g.meter : 1);
      f = (g.t0 || 0) + Math.ceil((f - (g.t0 || 0)) / unit - 1e-6) * unit;
    }
    return typeof at === "number" && !snap ? at : this.shotAt(f);
  }
  /** The windows of the shot the film shows, as far as they are known yet:
   *  [[from, to], …] in shot seconds, and whether any is still waiting. */
  windows() {
    const w = [[0, this.cuts.length ? this.cuts[0].film - this.origin : Infinity]];
    let open = false;
    this.cuts.forEach((c, i) => {
      const a = this.start(i);
      if (a == null) return void (open = true);
      w.push([a, i + 1 < this.cuts.length ? a + (this.cuts[i + 1].film - c.film) * c.rate : Infinity]);
    });
    return { w, open };
  }
}

/** Where an element is, scrolled into view first (a chip far down the node
 *  bank is outside its scroll box until then, and a pointer sent to it would
 *  land on whatever covers it), as a user would scroll to it. */
async function box(page, sel) {
  const l = page.locator(sel).first();
  await l.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
  const b = await l.boundingBox({ timeout: 5000 }).catch(() => null);
  if (!b) throw new Error(`nothing visible matches ${sel}`);
  return b;
}

// Where each page's pointer is, so a move can glide from there.
const pointer = new WeakMap();
async function pointTo(page, x, y) {
  await page.mouse.move(x, y);
  pointer.set(page, [x, y]);
}
/** Travel to (x, y) from wherever the pointer is, `ms` long. */
async function travel(page, x, y, ms) {
  const [px, py] = pointer.get(page) || [x, y];
  return glide(page, px, py, x - px, y - py, ms);
}

/** An eased pointer path from (x, y) by (dx, dy), `ms` long. Timed by the
 *  clock, not by a count of steps: each move goes where the hand should be
 *  now, so a slow machine takes coarser steps rather than a longer gesture
 *  (which would still hold the pointer when the next action wants it). */
async function glide(page, x, y, dx, dy, ms) {
  const t0 = Date.now();
  for (;;) {
    const u = Math.min(1, (Date.now() - t0) / ms);
    const e = u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u);
    await pointTo(page, x + dx * e, y + dy * e);
    if (u >= 1) return;
    await sleep(15);
  }
}

// ---------- MIDI, through main.js's ?film port ----------
function midiSend(page, bytes, ts) {
  return page.evaluate(([b, t]) => {
    if (!window.__film?.midi) throw new Error("this build has no ?film MIDI port (apps/web/main.js)");
    window.__film.midi(b, t ?? undefined);
  }, [bytes, ts ?? null]);
}

/** How long a held op holds, in ms. `"ms": "end"` arrives as a function:
 *  the time left to the shot's end, which a cut keyed to a stamp only knows
 *  once that stamp has come. Every op asks for it *after* it has pressed, so
 *  the keys go down at `at` and only the release waits. (Asked before the
 *  press, a hold "to the end" pressed nothing until the stamp arrived, and
 *  the rehearsal still called it on time.) */
const holdMs = async (ms, dflt) => (typeof ms === "function" ? await ms() : ms) || dflt;

/** Through `values` (a number, or points to move between) over `ms`, sending
 *  what `make` builds for each value; like a hand on a pot, only changes. */
async function midiSweep(page, values, ms, make) {
  const pts = Array.isArray(values) ? values : [values];
  if (pts.length === 1 || !ms) return midiSend(page, make(pts[pts.length - 1]));
  // The first value at once; the length may be the time to the shot's end.
  let last = make(pts[0]).join();
  await midiSend(page, make(pts[0]));
  const dur = await holdMs(ms, 0);
  const n = Math.max(2, Math.round(dur / 25));
  const t0 = Date.now();
  for (let i = 1; i <= n; i++) {
    await sleep(t0 + (i * dur) / n - Date.now());
    const u = (i / n) * (pts.length - 1);
    const k = Math.min(pts.length - 2, Math.floor(u));
    const msg = make(pts[k] + (pts[k + 1] - pts[k]) * (u - k));
    if (msg.join() !== last) await midiSend(page, msg);
    last = msg.join();
  }
}

async function midi(page, s, ctx = {}) {
  const ch = (s.ch || 0) & 15;
  const b7 = (v) => Math.max(0, Math.min(127, Math.round(v)));
  if (s.device !== undefined) await page.evaluate((n) => window.__film.midiDevice(n), s.device);
  if (s.bytes) await midiSend(page, s.bytes);
  if (s.start === true && !s.clock) await midiSend(page, [0xfa]);
  if (s.cc != null) {
    if (s.values) await midiSweep(page, s.values, s.ms, (v) => [0xb0 | ch, s.cc, b7(v)]);
    else await midiSend(page, [0xb0 | ch, s.cc, b7(s.value ?? 0)]);
  }
  if (s.pressure != null) await midiSweep(page, s.pressure, s.ms, (v) => [0xd0 | ch, b7(v)]);
  if (s.bend != null) {
    await midiSweep(page, s.bend, s.ms, (v) => {
      const x = Math.max(0, Math.min(16383, Math.round(((Math.max(-1, Math.min(1, v)) + 1) / 2) * 16383)));
      return [0xe0 | ch, x & 127, x >> 7];
    });
  }
  if (s.note != null) {
    const notes = Array.isArray(s.note) ? s.note : [s.note];
    for (const n of notes) await midiSend(page, [0x90 | ch, n, b7(s.vel ?? 100)]);
    await sleep(await holdMs(s.ms, 500));
    for (const n of notes) await midiSend(page, [0x80 | ch, n, 0]);
  }
  if (s.clock) {
    // `start`: true sends Start before the first tick; a time (a word, with
    // `start_snap` to put it on the score's beat or bar) sends it on the
    // clock's beat nearest that time, mid-run.
    let startBeat = s.start === true ? 0 : null;
    if (s.start != null && s.start !== true && s.start !== false && ctx.clock) {
      const at = await ctx.clock.at(s.start, s.start_snap);
      startBeat = Math.max(0, Math.round(((at - ctx.now()) * s.clock) / 60));
    }
    // Timed in the page: a tick every 1/24 beat, each stamped with the time
    // it was due, as an interface's timestamps would be, so the tempo the app
    // reads is the tempo sent however late a timer fires.
    await page.evaluate(({ bpm, beats, startBeat }) => new Promise((done) => {
      const dt = 60000 / (24 * bpm);
      const t0 = performance.now() + 2;
      const total = Math.round(beats * 24);
      let n = 0;
      const tick = () => {
        while (n < total && t0 + n * dt <= performance.now()) {
          if (startBeat != null && n === startBeat * 24) window.__film.midi([0xfa], t0 + n * dt - 1);
          window.__film.midi([0xf8], t0 + n * dt);
          n++;
        }
        if (n >= total) return done();
        setTimeout(tick, Math.max(0, t0 + n * dt - performance.now()));
      };
      setTimeout(tick, 2);
    }), { bpm: s.clock, beats: s.beats ?? 8, startBeat });
  }
  if (s.stop) await midiSend(page, [0xfc]);
}

async function step(page, s, ctx = {}) {
  switch (s.op) {
    case "wait":
      // In a `seq`, `until` waits for a narration time (not before the step
      // ahead of it is done, and at once if that time has passed).
      if (s.until != null && ctx.clock) return sleep(((await ctx.clock.at(s.until)) - ctx.now()) * 1000);
      return page.waitForTimeout(await holdMs(s.ms, 0));
    case "until":
      // Wait for the app to reach a state (an offer ready, a view shown); a
      // stamp records when, on the shot's clock.
      try {
        if (s.js) await page.waitForFunction(s.js, null, { timeout: s.ms || 60_000 });
        else await page.waitForSelector(s.sel, { state: s.state || "visible", timeout: s.ms || 60_000 });
      } catch (e) {
        if (s.stamp && ctx.clock) ctx.clock.fail(s.stamp, e.message.split("\n")[0]);
        throw e;
      }
      if (s.stamp && ctx.clock) ctx.clock.stamp(s.stamp, ctx.now());
      return;
    case "mark": {
      // Measure an element that only exists mid-shot (a popover, a toast).
      const b = await page.locator(s.sel).first().boundingBox({ timeout: 3000 }).catch(() => null);
      if (b && ctx.rects) ctx.rects[s.name] = { x: b.x, y: b.y, w: b.width, h: b.height };
      else if (!b) ctx.errors?.push(`mark ${s.name}: nothing visible matches ${s.sel}`);
      if (ctx.snap) await ctx.snap(s.name);
      return;
    }
    case "snap":
      if (ctx.snap) await ctx.snap(s.name || "snap");
      return;
    case "log": {
      const v = await page.evaluate(s.js);
      ctx.logs?.push({ t: ctx.now ? +ctx.now().toFixed(2) : null, name: s.name, value: v });
      return;
    }
    case "click":
      return page.locator(s.sel).first().click({ force: !!s.force });
    case "dblclick":
      return page.locator(s.sel).first().dblclick({ force: !!s.force });
    case "view":
      return page.locator(`.viewtab[data-view="${s.v}"]`).click();
    case "preset": {
      await page.locator('.bf[data-f="preset"]').click();
      // By its exact name: "Loom" must not open a preset whose blurb says "looming".
      const name = page.locator(".bi-name").filter({ hasText: new RegExp(`^\\s*${s.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`) });
      await page.locator(".bank-item.preset-item").filter({ has: name }).first().click();
      // On the bench once PATCH names it (in any view), then a moment to settle.
      await page.waitForFunction((n) => (document.getElementById("rack-subject")?.textContent || "").includes(n), s.name, { timeout: 90_000 });
      return page.waitForTimeout(s.settle ?? 600);
    }
    case "measured":
      // The status line belongs to whatever patch PERFORM last measured, so a
      // fresh load must first show its own name, then its own measurement.
      if (s.name) await page.waitForFunction((n) => (document.querySelector(".pf-name")?.textContent || "").includes(n), s.name, { timeout: 60_000 });
      await page.waitForFunction(() => /controls reach/.test(document.querySelector(".pf-status")?.textContent || ""), null, { timeout: 120_000 });
      return page.waitForTimeout(s.settle ?? 400);
    case "key":
      await page.keyboard.down(s.key);
      await page.waitForTimeout(await holdMs(s.ms, 250));
      return page.keyboard.up(s.key);
    case "hold": {
      // All at once, not one round trip after another: on a busy machine a
      // chord sent key by key is strummed.
      await Promise.all(s.keys.map((k) => page.keyboard.down(k)));
      await page.waitForTimeout(await holdMs(s.ms, 250));
      await Promise.all(s.keys.map((k) => page.keyboard.up(k)));
      return;
    }
    case "type":
      if (s.sel) await page.locator(s.sel).first().pressSequentially(s.text, { delay: s.ms ?? 90 });
      else await page.keyboard.type(s.text, { delay: s.ms ?? 90 });
      if (s.enter) await page.keyboard.press("Enter");
      return;
    case "select":
      return page.locator(s.sel).first().selectOption(String(s.value));
    case "drag": {
      const b = await box(page, s.sel);
      const x = b.x + b.width / 2 + (s.ox || 0);
      const y = b.y + b.height / 2 + (s.oy || 0);
      let dx = s.dx || 0;
      let dy = s.dy || 0;
      if (s.to) {
        const t = await box(page, s.to);
        dx = t.x + t.width / 2 + (s.tox || 0) - x;
        dy = t.y + t.height / 2 + (s.toy || 0) - y;
      }
      await travel(page, x, y, 150);
      await page.mouse.down();
      await glide(page, x, y, dx, dy, await holdMs(s.ms, 800));
      return page.mouse.up();
    }
    case "press": {
      // A pad held down (Peek is heard only while held), or a key struck:
      // where on the key sets how hard.
      const b = await box(page, s.sel);
      const x = s.fx != null ? b.x + s.fx * b.width : b.x + b.width / 2 + (s.ox || 0);
      const y = s.fy != null ? b.y + s.fy * b.height : b.y + b.height / 2 + (s.oy || 0);
      await travel(page, x, y, 150);
      await page.mouse.down();
      await page.waitForTimeout(await holdMs(s.ms, 1500));
      return page.mouse.up();
    }
    case "path": {
      // A gesture across an element, through points given in [0,1] of its
      // box (the XY pad), eased between them.
      const b = await box(page, s.sel);
      const pts = s.points.map(([fx, fy]) => [b.x + fx * b.width, b.y + fy * b.height]);
      await travel(page, pts[0][0], pts[0][1], 200);
      await page.mouse.down();
      const per = (await holdMs(s.ms, 2000)) / Math.max(1, pts.length - 1);
      for (let i = 1; i < pts.length; i++) {
        await glide(page, pts[i - 1][0], pts[i - 1][1], pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], per);
      }
      return page.mouse.up();
    }
    case "move": {
      const b = await box(page, s.sel);
      return travel(page, b.x + b.width / 2 + (s.ox || 0), b.y + b.height / 2 + (s.oy || 0), s.ms ?? 400);
    }
    case "drop": {
      // A file from the film's folder, held over the window (the app shows
      // its drop veil) and let go on `sel`: the same dragenter, dragover and
      // drop a file from the desktop fires.
      const file = path.resolve(fdir, s.file);
      const b64 = fs.readFileSync(file).toString("base64");
      const target = s.sel ? await page.locator(s.sel).first().elementHandle() : null;
      return page.evaluate(async ([b64, name, type, el, ms]) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const dt = new DataTransfer();
        dt.items.add(new File([bytes], name, { type }));
        const at = el || document.body;
        const r = at.getBoundingClientRect();
        const o = { bubbles: true, cancelable: true, composed: true, dataTransfer: dt, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 };
        at.dispatchEvent(new DragEvent("dragenter", o));
        const t0 = performance.now();
        do {
          at.dispatchEvent(new DragEvent("dragover", o));
          await new Promise((res) => setTimeout(res, 50));
        } while (performance.now() - t0 < ms);
        at.dispatchEvent(new DragEvent("drop", o));
      }, [b64, s.name || path.basename(file), s.type || MIME[path.extname(file)] || "application/octet-stream", target, s.ms ?? 1200]);
    }
    case "midi":
      return midi(page, s, ctx);
    case "seq":
      // Steps in order, as one action: each waits for the one before.
      for (const x of s.steps) await step(page, x, ctx);
      return;
    case "rec":
      // Stop the shot's capture now, quietly. The shot's sound ends here.
      if (s.on !== false) throw new Error("rec: only {on: false} (stop the capture mid-shot)");
      if (ctx.stopCapture) return ctx.stopCapture();
      return;
    case "eval":
      return page.evaluate(s.js);
    default:
      throw new Error(`unknown op ${s.op}`);
  }
}

const describe = (s) => [s.op, s.sel || s.name || s.v || s.key || (s.keys && s.keys.join("+")) || s.text || s.file || ""].join(" ").trim();

async function shoot(browser, port, shot) {
  const beat = timeline.beats.find((b) => b.id === shot.beat);
  const errors = [];
  const [W, H] = spec.viewport || [1920, 1080];
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: spec.dpr || 1, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`page: ${e.message}`));
  const shots = [];
  const snap = DRY
    ? async (name) => {
        const f = `${shot.id}-${String(shots.length).padStart(2, "0")}-${name.replace(/[^\w-]+/g, "_")}.jpg`;
        await page.screenshot({ path: path.join(odir, f), type: "jpeg", quality: 70 }).catch((e) => errors.push(`snap ${name}: ${e.message}`));
        shots.push(f);
      }
    : null;
  const write = (meta) => fs.writeFileSync(path.join(odir, `${shot.id}.json`), JSON.stringify(meta, null, 1));
  const logs = [];
  let clock;
  try {
    clock = new Clock(shot, beat, errors);
    if (spec.init) await page.addInitScript(spec.init);
    await page.goto(`http://127.0.0.1:${port}/${shot.query ?? spec.query ?? "?film"}`);
    await page.waitForFunction(() => document.querySelector("#boot")?.classList.contains("done"), null, { timeout: 300_000 });
    // `own_setup` replaces the film's common setup (a shot that takes the
    // warm start instead of skipping it).
    const setup = [...(shot.own_setup ? [] : spec.setup || []), ...(shot.setup || [])];
    for (const [i, s] of setup.entries()) {
      try {
        await step(page, s, { errors, logs });
      } catch (e) {
        throw new Error(`set-up step ${i + 1} (${describe(s)}): ${e.message.split("\n")[0]}`);
      }
    }
  } catch (e) {
    errors.push(e.message);
    console.warn(`  [${shot.id}] FAILED: ${e.message}`);
    if (snap) await snap("setup-failed");
    write({ id: shot.id, beat: shot.beat, pre: shot.pre || 0, dry: DRY, failed: true, errors, logs, snaps: shots });
    await ctx.close();
    return false;
  }
  // Park the pointer off the panel unless the shot moves it.
  await pointTo(page, W - 4, H - 4);
  // Where the things the narration names are on screen, measured now rather
  // than typed into the film: a callout pinned to `mark: "bright"` follows
  // the Bright knob wherever the layout puts it, and a layout change moves
  // the arrow with it instead of leaving it pointing at the wrong control.
  const rects = {};
  for (const [name, sel] of Object.entries(shot.marks || {})) {
    const b = await page.locator(sel).first().boundingBox({ timeout: 3000 }).catch(() => null);
    if (b) rects[name] = { x: b.x, y: b.y, w: b.width, h: b.height };
    else errors.push(`mark ${name}: nothing matches ${sel}`);
  }
  if (snap) await snap("start");

  // Every download the shot starts; only the capture is its sound.
  const downloads = [];
  let t0 = null;
  page.on("download", (d) => downloads.push({ t: t0 == null ? null : +(Date.now() / 1000 - t0).toFixed(2), name: d.suggestedFilename(), d }));

  let cdp = null;
  let frames = [];
  let recAt = null;
  if (!DRY) {
    cdp = await ctx.newCDPSession(page);
    let pruned = 0;
    cdp.on("Page.screencastFrame", async (f) => {
      frames.push({ t: f.metadata.timestamp, data: f.data });
      cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
      // Across a cut's wait, keep only what a window can still show.
      if (clock.cuts.length && t0 != null && Date.now() - pruned > 1000) {
        pruned = Date.now();
        const now = Date.now() / 1000 - t0;
        const { w, open } = clock.windows();
        frames = frames.filter((fr) => {
          const ts = fr.t - t0;
          return ts < 0 || w.some(([a, b]) => ts >= a - 1 && ts <= b + 1) || (open && ts >= now - KEEP_S);
        });
      }
    });
  }
  // The sound: the master-bus capture, from here to the end (or to a `rec`
  // action). A rehearsal runs it only for a shot that stops it mid-shot.
  const usesRec = (list) => (list || []).some((a) => a.op === "rec" || (a.op === "seq" && usesRec(a.steps)));
  let hooked = false; // the ?film capture hook; else the ● rec button's own take
  if (!DRY || usesRec(shot.actions)) {
    [recAt, hooked] = await page.evaluate(() => {
      const t = (performance.timeOrigin + performance.now()) / 1000;
      if (window.__film?.rec) {
        window.__film.rec(true);
        return [t, true];
      }
      document.getElementById("rec-btn").click();
      return [t, false];
    });
  }
  if (cdp) await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: W * (spec.dpr || 1), maxHeight: H * (spec.dpr || 1), everyNthFrame: 1 });
  t0 = Date.now() / 1000;
  const now = () => Date.now() / 1000 - t0;
  const late = [];
  let captureStop = null; // {k, t}: the capture stopped mid-shot by a `rec` action
  const stopCapture = async () => {
    if (captureStop || recAt == null) return;
    captureStop = { k: downloads.length, t: +now().toFixed(3) };
    await page.evaluate(() => window.__film?.rec?.(false));
  };
  const actx = { rects, clock, now, errors, logs, snap, stopCapture };

  // The shot's end: a number, "@stamp+s", or the beat's end (through any
  // cut) plus 0.8 s.
  let endT = null;
  const endP = (async () => {
    if (typeof shot.dur === "number") return shot.dur;
    if (typeof shot.dur === "string") return clock.at(shot.dur);
    return beat ? (await clock.shotAt(beat.t1)) + 0.8 : 8;
  })()
    .catch((e) => {
      errors.push(`end: ${e.message}`);
      return now() + 0.5;
    })
    .then((e) => (endT = e));

  // Every action waits for its own time, so one keyed to a stamp waits for
  // that stamp without holding up the rest.
  const tasks = (shot.actions || []).map((a) => (async () => {
    let t;
    // `until` is asked for now but awaited only for the release: a time past
    // a stamp-keyed cut resolves when that stamp comes, and the press must
    // not wait for it (the same trap "end" had).
    const t2P = a.until != null ? clock.at(a.until, a.until_snap) : null;
    t2P?.catch(() => {});
    try {
      t = await clock.at(a.at, a.snap);
    } catch (e) {
      return errors.push(`${describe(a)} @ ${a.at}: ${e.message}`);
    }
    await sleep((t0 + t - Date.now() / 1000) * 1000);
    if (endT != null && t > endT) return errors.push(`${describe(a)} @ ${a.at}: at ${t.toFixed(2)} s, after the shot's end (${endT.toFixed(2)} s)`);
    const lag = now() - t;
    const row = { op: describe(a), at: a.at, t: +t.toFixed(2), late: +lag.toFixed(3) };
    late.push(row);
    // "end" and `until` are asked for after the press (holdMs): either may
    // wait on a stamp that a cut needs, and the keys must still go down at `at`.
    const ms = t2P
      ? async () => Math.max(100, ((await t2P) - now()) * 1000)
      : a.ms === "end" ? async () => Math.max(200, ((endT ?? (await endP)) - now() - 0.3) * 1000) : a.ms;
    try {
      await step(page, { ...a, ms }, actx);
    } catch (e) {
      errors.push(`${describe(a)} @ ${a.at}: ${e.message.split("\n")[0]}`);
    }
    // How long it held the page: a gesture that outlasts its plan collides
    // with the next one (a drag still holding the pointer eats a click).
    row.took = +(now() - t - lag).toFixed(2);
  })());
  const end = await endP;
  await sleep((t0 + end - Date.now() / 1000) * 1000);
  // Anything still running at the end (a hold to "end" is finishing) gets a
  // moment; anything still waiting on a stamp by then never ran.
  const settled = await Promise.race([Promise.all(tasks).then(() => true), sleep(4000).then(() => false)]);
  if (!settled) errors.push("an action was still running or waiting 4 s after the shot's end");
  if (snap) await snap("end");

  const clips = clock.cuts.map((c, i) => (c.rate === 1 ? [c.spec, clock.start(i)] : [c.spec, clock.start(i), c.rate]));
  // The app's own timing marks (window.__aur.marks: boot start, veil down,
  // first sound, pool full, PERFORM wired, patch opened…), so every rehearsal
  // is also a performance run. `t` is the page's clock (ms since it loaded);
  // `at0` is that clock at this shot's t = 0, to read them beside the stamps.
  const perf = await page
    .evaluate(() => (window.__aur && window.__aur.marks ? { marks: window.__aur.marks(), now: performance.now() } : null))
    .then((p) => (p ? { at0: Math.round(p.now - now() * 1000), marks: p.marks } : undefined))
    .catch(() => undefined);
  const base = { id: shot.id, beat: shot.beat, pre: shot.pre || 0, dur: +end.toFixed(3), rects, stamps: clock.stamps, perf, clips: clips.length ? clips : undefined, errors, logs: logs.length ? logs : undefined };

  // Downloads the shot started (exports), kept beside it.
  const saveMid = async (list) => {
    for (const x of list) {
      const dir = path.join(odir, `${shot.id}.dl`);
      fs.mkdirSync(dir, { recursive: true });
      await x.d.saveAs(path.join(dir, x.name)).catch((e) => errors.push(`download ${x.name}: ${e.message}`));
    }
  };

  if (DRY) {
    await saveMid(downloads);
    await ctx.close();
    const worst = late.reduce((m, x) => Math.max(m, x.late), 0);
    write({ ...base, dry: true, downloads: downloads.map(({ t, name }) => ({ t, name })), late, snaps: shots });
    console.log(`  ${shot.id}: ${errors.length ? `${errors.length} ERROR${errors.length > 1 ? "S" : ""}` : "ok"} · ${end.toFixed(1)} s · ${Object.keys(rects).length} marks · latest action ${worst.toFixed(2)} s late${Object.keys(clock.stamps).length ? ` · stamps ${JSON.stringify(clock.stamps)}` : ""}`);
    for (const e of errors) console.log(`      - ${e}`);
    return errors.length === 0;
  }

  await cdp.send("Page.stopScreencast");
  const k = captureStop ? captureStop.k : downloads.length;
  if (!captureStop) {
    await page.evaluate(() => {
      if (window.__film?.rec) window.__film.rec(false);
      else document.getElementById("rec-btn").click();
    });
  }
  // The capture, by its name; without the hook, the ● rec take the click
  // above ended.
  let take = null;
  for (let i = 0; i < 1200 && !take; i++) {
    take = hooked ? downloads.find((x) => x.name === "auracle-film-capture.wav") : downloads.slice(k).find((x) => /\.wav$/i.test(x.name));
    if (!take) await sleep(100);
  }
  await saveMid(downloads.filter((x) => x !== take));
  if (take) await take.d.saveAs(path.join(odir, `${shot.id}.wav`));
  else errors.push("the recorder handed over no .wav");
  await ctx.close();
  if (errors.length) console.warn(`  [${shot.id}] ${errors.join(" | ")}`);

  // Resample the paints to a constant frame rate, by timestamp. The picture
  // is kept as the screencast's own JPEGs, one file per paint shown, with an
  // index from each constant-rate frame to its paint (ID.frames.json): the
  // stage draws them directly. Encoding a clip here (VP9, since Playwright's
  // Chromium has no H.264) held the browser for about as long again as the
  // shot itself, only for the renderer to decode it frame by frame.
  frames.sort((a, b) => a.t - b.t);
  const start = t0;
  const n = Math.round(end * FPS);
  const fdir = path.join(odir, shot.id);
  fs.rmSync(fdir, { recursive: true, force: true });
  fs.mkdirSync(fdir, { recursive: true });
  const fileOf = new Map(); // paint index → file number
  const runs = []; // [file, count] over the n constant-rate frames
  let j = 0;
  for (let i = 0; i < n; i++) {
    const tt = start + i / FPS;
    while (j + 1 < frames.length && frames[j + 1].t <= tt) j++;
    let k = fileOf.get(j);
    if (k == null) {
      k = fileOf.size;
      fileOf.set(j, k);
      fs.writeFileSync(path.join(fdir, `${String(k).padStart(5, "0")}.jpg`), Buffer.from(frames[j].data, "base64"));
    }
    if (runs.length && runs[runs.length - 1][0] === k) runs[runs.length - 1][1]++;
    else runs.push([k, 1]);
  }
  // Every paint's time in the clip, for takes.py's frame-rate check.
  const paintTimes = frames.filter((f) => f.t >= start && f.t <= start + end).map((f) => +(f.t - start).toFixed(4));
  fs.writeFileSync(path.join(odir, `${shot.id}.frames.json`), JSON.stringify({ fps: FPS, n, runs, paints: paintTimes }));
  fs.rmSync(path.join(odir, `${shot.id}.webm`), { force: true });
  const paints = paintTimes.length;
  const meta = { ...base, fps: FPS, picture: "frames", audio_offset: recAt - start, audio_until: captureStop ? captureStop.t : undefined, paints_per_s: paints / end, downloads: downloads.filter((x) => x !== take).map(({ t, name }) => ({ t, name })) };
  write(meta);
  console.log(`  ${shot.id}: ${end.toFixed(1)}s, ${meta.paints_per_s.toFixed(1)} paints/s, audio offset ${meta.audio_offset.toFixed(3)} s`);
  return errors.length === 0;
}

(async () => {
  const srv = await serve();
  const port = srv.address().port;
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required", "--force-color-profile=srgb"] });
  const failed = [];
  try {
    for (const shot of spec.shots) {
      if (only && !only.has(shot.id)) continue;
      if (!(await shoot(browser, port, shot))) failed.push(shot.id);
    }
  } finally {
    await browser.close();
    srv.close();
  }
  if (failed.length) {
    console.error(`${film}: ${failed.length} shot${failed.length > 1 ? "s" : ""} with errors: ${failed.join(", ")}`);
    process.exit(1);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
