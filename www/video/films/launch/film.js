// The launch film. Every scene is pinned to the narration's cues in
// timeline.json (tools/timeline.py), so a new voice take re-times the film
// without anyone editing seconds here.
//
// It is drawn, and the drawing is the instrument's own: EVOLVE, PERFORM and
// PATCH are drawn where the app puts every part at 1920 × 1080, in its type
// and colours, with the sounds' own faces (kit.js `appScreen` and the views).
// Three beats cross from the drawing into the real app, recorded on the same
// window and camera (shots.json, written by gen_shots.py; tools/footage.mjs):
// play (Bright opening up, Wander let go and drifting), offer (Blend past half
// and Take) and depth (in to PATCH with the face carried, the cutoff turned
// from PERFORM, out to TASTE and LEARNING). Each take logs what the app
// showed (its faces, controls, knobs, bank), and the drawing before each cut
// is drawn from those logs, so the cut lands on the same picture.
//
// The sound is ADR-014's (the N3 bed, Bloom and Reach, no cues): the app is
// heard only in the demos after play2, play3 and offer2 (timeline.json
// `demos`), each the instrument alone, and the cut into the app lands as the
// first demo begins. Elsewhere the takes are a picture under the voice.
//
// The takes are read from out/launch/shots/ (`?dry` reads a rehearsal's
// logs and draws no footage, `?nofootage` neither), and a missing take stops
// the render: illustrated.sh records them first.

import { el, place, clamp, lerp, ramp, fade, keys, E, rng, words, reveal } from "../../stage/stage.js";
import {
  svgLayer, scope, knob, cable, plate, mark, pointer, glide, textBlock, voiceWave, footage, callout, face, say,
  appScreen, performView, evolveView, patchView, SLOW_WEATHER, PRESETS, TYPE, GLOW, ink, inkA,
} from "../../stage/kit.js";
import { aim } from "../../stage/walk.js";

// The window the app is drawn and recorded in, in frame px, and its scale.
const F = { x: 192, y: 34, w: 1536, h: 864 };
const S = F.w / 1920;
const CAP_Y = 968;

export async function build(stage) {
  await Promise.all(["600 20px Jost", "600 20px 'IBM Plex Mono'"].map((f) => document.fonts.load(f)));
  const takes = await loadTakes(stage);
  const giant = await (await fetch("giant_patch.json", { cache: "no-store" })).json();
  const beat = (id) => stage.tl.beats.find((b) => b.id === id);
  const line = (id) => stage.line(id);
  const ctx = { stage, beat, line, takes, giant };
  sceneOpen(ctx);
  sceneTitle(ctx);
  sceneDuel(ctx);
  sceneGrow(ctx);
  scenePlay(ctx);
  sceneOffer(ctx);
  sceneDepth(ctx);
  sceneClose(ctx);
  sceneEnd(ctx);
}

// ---------------------------------------------------------------------------
// The takes: each shot's sidecar (its marks, stamps, cuts and logs) and the
// screencast's frames.

async function loadTakes(stage) {
  const q = new URLSearchParams(location.search);
  if (q.has("nofootage")) return {};
  const dry = q.has("dry");
  const dir = `../../out/${stage.tl.film}/${dry ? "dry" : "shots"}`;
  const spec = await (await fetch("shots.json", { cache: "no-store" })).json();
  const out = {};
  for (const s of spec.shots) {
    const meta = await (await fetch(`${dir}/${s.id}.json`, { cache: "no-store" })).json();
    const logs = {};
    for (const l of meta.logs || []) logs[l.name] = l.value;
    let frames = null;
    if (!dry && meta.picture === "frames") frames = { ...(await (await fetch(`${dir}/${s.id}.frames.json`, { cache: "no-store" })).json()), base: `${dir}/${s.id}` };
    let chrome = null;
    try {
      chrome = logs.chrome ? JSON.parse(logs.chrome) : null;
    } catch {
      chrome = null;
    }
    out[s.id] = { id: s.id, meta, logs, frames, chrome, pre: meta.pre ?? s.pre ?? 0, clips: meta.clips || s.clips || [], beat: s.beat };
  }
  return out;
}

/** Film time of a narration point, as footage.mjs reads one: "line:word±s",
 *  a line's id, or seconds from the beat's start. */
function at(stage, b, spec) {
  if (typeof spec === "number") return b.t0 + spec;
  const off = /([+-]\d+(?:\.\d+)?)$/.exec(spec);
  if (off) return at(stage, b, spec.slice(0, off.index)) + Number(off[1]);
  const [id, word] = spec.split(":");
  const l = stage.line(id);
  if (!word) return l.t0;
  const ws = l.text.split(/\s+/);
  const k = ws.findIndex((w) => w.toLowerCase().replace(/[^\w']/g, "").startsWith(word.toLowerCase()));
  if (k < 0) throw new Error(`no word "${word}" in ${id}`);
  return l.words ? l.words[k] : l.t0 + ((l.t1 - l.t0) * k) / ws.length;
}

/** A take's clock: shot seconds at film time t, through its cuts (a cut
 *  never goes back), and where its marks are. */
function takeClock(stage, take) {
  const b = stage.tl.beats.find((x) => x.id === take.beat);
  const origin = b.t0 - take.pre;
  const cuts = take.clips
    .map(([a, from, rate = 1]) => ({ t: at(stage, b, a), from: typeof from === "number" ? from : null, rate }))
    .filter((c) => Number.isFinite(c.t) && Number.isFinite(c.from))
    .sort((x, y) => x.t - y.t);
  cuts.forEach((c, i) => {
    const p = cuts[i - 1];
    c.from = Math.max(c.from, p ? p.from + (c.t - p.t) * p.rate : c.t - origin);
  });
  return {
    b,
    origin,
    clipTime(t) {
      let c = null;
      for (const x of cuts) if (t >= x.t) c = x;
      return c ? c.from + (t - c.t) * c.rate : t - origin;
    },
    /** Film time at which the take reached shot second s (after any cut). */
    filmAt(s) {
      let f = s + origin;
      for (const c of cuts) if (s >= c.from) f = c.t + (s - c.from) / c.rate;
      return f;
    },
    mark(name) {
      const r = take.meta.rects?.[name];
      return r ? [r.x + r.w / 2, r.y + r.h / 2] : null;
    },
  };
}

/** The sound as a take showed it in PERFORM (its `sound` log: the head, each
 *  control with its caption and amber dot, the knobs under the hood), and its
 *  first offer's changes; kit's Slow Weather only where a take has none (a
 *  dry run with no takes). */
function soundOf(take) {
  const s = { ...SLOW_WEATHER, controls: SLOW_WEATHER.controls.map((c) => ({ ...c })), hood: SLOW_WEATHER.hood.map((h) => [...h]) };
  let seen = null;
  try {
    seen = take?.logs?.sound ? JSON.parse(take.logs.sound) : null;
  } catch (e) {
    seen = null;
  }
  if (seen) {
    for (const k of ["name", "cap", "blurb", "status"]) if (seen[k] != null) s[k] = seen[k];
    if (seen.controls?.length) s.controls = seen.controls.map((c) => ({ ...c, where: c.where || null }));
    if (seen.hood?.length) s.hood = seen.hood;
  }
  if (take?.logs?.offer) s.offer = take.logs.offer.split(/\s*\+\d+ more|grown toward/)[0].replace(/,\s*$/, "");
  return s;
}

/** A caption: the narration, set in the voice face. */
function voiceLine(over, text, { y = CAP_Y, size = 46, w = 1700 } = {}) {
  const d = textBlock(over, { x: 960, y, w, cls: "voice", size, align: "center", ax: 0.5, ay: 0.5 });
  const sp = words(d, text);
  return { d, sp };
}

/** Captions for a run of lines: each shown from its start to the next's. */
function captions(over, stage, ids, end, opts = {}) {
  const ls = ids.map((id) => stage.line(id));
  const vs = ls.map((l) => voiceLine(over, l.text.replace(/\b(PERFORM|EVOLVE|PATCH|LEARNING)\b/g, "*$1*"), opts));
  return (t) => {
    ls.forEach((l, i) => {
      const next = i + 1 < ls.length ? ls[i + 1].t0 : end;
      vs[i].d.style.opacity = fade(t, l.t0 - 0.25, l.t0 + 0.05, next - 0.35, next - 0.1);
      reveal(vs[i].sp, t, l.t0, l.t1);
    });
  };
}

/** Standard layer stack: HTML under, SVG, HTML over. */
function stack(layer) {
  const under = el("div", { class: "layer" }, layer);
  const svg = svgLayer(layer);
  const over = el("div", { class: "layer" }, layer);
  return { under, svg, over };
}

/** A camera over the app's window: keyframes [t, z, x, y] that centre the
 *  app's point (x, y) at zoom z; returns [z, fx, fy] at t. */
function camera(ks) {
  const k = ks.map(([t, z, x, y]) => [t, aim(z, x, y), E.io3]);
  return (t) => (k.length > 1 ? keys(t, k) : k[0][1]);
}

/** Where the app's point (x, y) is in the frame under camera [z, fx, fy]. */
function onFrame([z, fx, fy], x, y) {
  return [F.x - fx * (z - 1) * F.w + z * x * S, F.y - fy * (z - 1) * F.h + z * y * S];
}

// ---------------------------------------------------------------------------
// OPEN — a sound; then the circuit it lives in, and every circuit around it:
// the modules to wire together, where the feedback goes, and how each choice
// shapes the sound.

// The field: every preset the app ships, as PATCH describes and lays it out
// (giant_patch.json, written by giant_patch.mjs from the engine's own rack
// description: each module's kind, its knobs where the preset sets them, the
// cables), packed in shelves around Dub Echo, a vco into a filter into a
// delay that feeds its output back to its input. The opening starts inside
// Dub Echo's OUT and pulls back until the whole library is in frame. They
// are side by side, not one patch: a tree that large is over the grammar's
// ceilings.
const FIELD = { gapX: 220, gapY: 190, aspect: 16 / 9, center: "Dub Echo" };

function packField(racks) {
  // Shelves as wide as makes the field the frame's shape.
  FIELD.shelf = Math.sqrt(racks.reduce((a, r) => a + (r.w + FIELD.gapX) * (r.h + FIELD.gapY), 0) * FIELD.aspect) * 1.04;
  const pack = (order) => {
    const shelves = [];
    let cur = null;
    for (const r of order) {
      if (!cur || (cur.items.length && cur.w + r.w > FIELD.shelf)) {
        cur = { items: [], w: 0, h: 0 };
        shelves.push(cur);
      }
      cur.items.push({ r, x: cur.w });
      cur.w += r.w + FIELD.gapX;
      cur.h = Math.max(cur.h, r.h);
    }
    const placed = [];
    let y = 0;
    for (const s of shelves) {
      const off = (FIELD.shelf - (s.w - FIELD.gapX)) / 2;
      for (const it of s.items) placed.push({ rack: it.r, x: off + it.x, y: y + (s.h - it.r.h) / 2 });
      y += s.h + FIELD.gapY;
    }
    return { placed, w: FIELD.shelf, h: y - FIELD.gapY };
  };
  // Dub Echo goes where the rack nearest the field's middle would be.
  let order = racks.slice();
  for (let pass = 0; pass < 3; pass++) {
    const { placed, w, h } = pack(order);
    const mid = (p) => Math.hypot(p.x + p.rack.w / 2 - w / 2, p.y + p.rack.h / 2 - h / 2);
    const near = placed.reduce((a, p) => (mid(p) < mid(a) ? p : a)).rack;
    const c = order.find((r) => r.name === FIELD.center);
    if (near === c) break;
    order = order.filter((r) => r !== c);
    order.splice(order.indexOf(near), 0, c);
  }
  return pack(order);
}

/** The opening's field, its knobs and its camera, the same for the open and
 *  for the title (whose cloud rises from those knobs). */
let OPEN_FIELD = null;
function openField(stage, giant) {
  if (OPEN_FIELD) return OPEN_FIELD;
  const { placed, w: FW, h: FH } = packField(giant.racks);
  const center = placed.find((p) => p.rack.name === FIELD.center);
  const R = rng(23);
  const knobs = [];
  const T = (spec) => at(stage, stage.tl.beats.find((x) => x.id === "open"), spec);
  const l2 = stage.line("open2");
  const cRack = { x: center.x + center.rack.w / 2, y: center.y + center.rack.h / 2 };
  const maxD = Math.max(...placed.map((p) => Math.hypot(p.x + p.rack.w / 2 - cRack.x, p.y + p.rack.h / 2 - cRack.y)));
  const tChoice = T("open2:choice");
  const tLift = stage.tl.beats.find((x) => x.id === "title").t0 - 0.8;
  placed.forEach((p, ri) => {
    const d = Math.hypot(p.x + p.rack.w / 2 - cRack.x, p.y + p.rack.h / 2 - cRack.y) / maxD;
    p.dist = d;
    p.rack.modules.forEach((m, mi) => {
      m.knobs.forEach(([label, v], ki) => {
        const n = m.knobs.length;
        const kx = p.x + m.x + (m.w * (ki + 1)) / (n + 1);
        const ky = p.y + m.y + m.h * 0.5;
        const turns = R() < 0.6;
        const dir = R() < 0.5 ? -1 : 1;
        knobs.push({
          ri, mi, ki, label, v, x: kx, y: ky,
          // How each choice shapes the sound: a wave of turns from Dub Echo
          // outward, as many hands at once.
          turnAt: turns ? tChoice - 0.25 + 1.3 * d + 0.5 * R() : null,
          turnBy: dir * (0.12 + 0.22 * R()) * (v + dir * 0.3 > 1 || v + dir * 0.3 < 0 ? -1 : 1),
          // When its dot lifts off, into the title.
          lift: tLift + 0.75 * R(),
          spin: (R() - 0.5) * 1.6,
          size: 1 + R() * 2.4,
        });
      });
    });
  });
  // The camera: inside Dub Echo's OUT, then back to Dub Echo, then out over
  // the field as the line names what a circuit holds. [t, log zoom, fx, fy].
  const sc = center.rack.scope;
  const S0 = { x: center.x + sc.x, y: center.y + sc.y, w: sc.w, h: sc.h };
  const z0 = Math.max(1920 / S0.w, 1080 / S0.h) * 1.04;
  // The field fills the frame and runs off its edges: more than one screen holds.
  const zEnd = Math.max(1920 / FW, 1080 / FH) * 1.12;
  const fc = { x: FW / 2, y: FH / 2 };
  const via = (u) => [lerp(cRack.x, fc.x, u), lerp(cRack.y, fc.y, u)];
  const pull0 = l2.t0 - 0.6;
  const K = [
    [pull0, Math.log(z0), S0.x + S0.w / 2, S0.y + S0.h / 2],
    [T("open2:circuit") + 0.5, Math.log(1920 / (center.rack.w + 420)), cRack.x, cRack.y],
    [T("open2:together") + 0.6, Math.log(0.42), ...via(0.35)],
    [T("open2:goes") + 0.5, Math.log(0.26), ...via(0.7)],
    [T("open2:sound") + 0.3, Math.log(zEnd), fc.x, fc.y],
  ];
  const cam = (t) => {
    if (t <= K[0][0]) return { s: z0, fx: K[0][2], fy: K[0][3] };
    for (let i = 1; i < K.length; i++) {
      if (t <= K[i][0]) {
        const u = ramp(t, K[i - 1][0], K[i][0], i === 1 ? E.io4 : E.io3);
        return { s: Math.exp(lerp(K[i - 1][1], K[i][1], u)), fx: lerp(K[i - 1][2], K[i][2], u), fy: lerp(K[i - 1][3], K[i][3], u) };
      }
    }
    const k = K[K.length - 1];
    return { s: Math.exp(k[1]), fx: k[2], fy: k[3] };
  };
  const toFrame = (c, x, y) => [960 + c.s * (x - c.fx), 540 + c.s * (y - c.fy)];
  const valueAt = (k, t) => (k.turnAt == null ? k.v : clamp(k.v + k.turnBy * ramp(t, k.turnAt, k.turnAt + 0.7, E.io3)));
  OPEN_FIELD = { placed, FW, FH, center, knobs, S0, z0, cam, toFrame, valueAt, T, pull0, end: K[K.length - 1][0] };
  return OPEN_FIELD;
}

function sceneOpen({ stage, beat, line, giant }) {
  const b = beat("open");
  const l1 = line("open1");
  const l2 = line("open2");
  const OF = openField(stage, giant);
  stage.scene({
    id: "open",
    t0: b.t0,
    t1: b.t1,
    post: 1.0,
    fout: 1.0,
    build(layer) {
      const { placed, FW, FH, center, knobs, S0, z0, cam, valueAt, T, pull0 } = OF;
      const world = el("div", {}, layer);
      Object.assign(world.style, { position: "absolute", left: "0px", top: "0px", width: `${FW}px`, height: `${FH}px`, transformOrigin: "0 0" });
      const back = place(el("div", {}, layer), { x: 0, y: 0, w: 1920, h: 1080 });
      back.style.background = `radial-gradient(60% 55% at 50% 45%, ${inkA("--white", 0.035)}, transparent 70%), linear-gradient(180deg, ${ink("--panel-lo")}, ${ink("--rack")})`;
      layer.insertBefore(back, world);
      const under = el("div", {}, world);
      Object.assign(under.style, { position: "absolute", left: "0px", top: "0px", width: `${FW}px`, height: `${FH}px` });
      const svg = el("svg", { width: FW, height: FH, viewBox: `0 0 ${FW} ${FH}` }, world);
      Object.assign(svg.style, { position: "absolute", left: "0px", top: "0px", overflow: "visible" });
      const cableG = el("g", {}, svg);
      const knobG = el("g", {}, svg);

      // Every rack: its plates, its cables, its OUT and the scope there.
      const racks = placed.map((p, ri) => {
        const isCenter = p === center;
        const plates = p.rack.modules.map((m, mi) => {
          const pl = plate(under, knobG, {
            x: p.x + m.x, y: p.y + m.y, w: m.w, h: m.h, name: m.title, kind: m.kind, knobs: m.knobs.length,
            labels: m.knobs.map(([l]) => l), color: m.mod ? "b" : "a", seed: 40 + ri * 7 + mi,
          });
          pl.knobs.forEach((k, ki) => k.k.set(m.knobs[ki][1], { lit: 0.8, glowOn: false }));
          return pl;
        });
        const cab = p.rack.wires.map(([from, to, kind]) => {
          const a = plates[from];
          const m = p.rack.modules[to];
          const p1 = kind === "mod" ? [p.x + m.x + m.w / 2, p.y + m.y + m.h] : plates[to].in;
          return { c: cable(cableG, { p0: a.out, p1, sag: kind === "mod" ? 24 : 8, width: 4, color: kind === "mod" ? "b" : "a" }), kind };
        });
        const amp = plates[p.rack.modules.findIndex((m) => m.title === "env / out")] || plates[0];
        const outJack = [p.x + p.rack.out.x, p.y + p.rack.out.y];
        cab.push({ c: cable(cableG, { p0: amp.out, p1: outJack, sag: 4, width: 4 }), kind: "out" });
        // Wired in signal order: from the leftmost source to OUT.
        cab.forEach((c, i) => (c.x = i < p.rack.wires.length ? plates[p.rack.wires[i][0]].out[0] : Infinity));
        cab.slice().sort((a, b2) => a.x - b2.x).forEach((c, i) => (c.step = i));
        const sc = p.rack.scope;
        const scr = place(el("div", { class: "screen" }, under), { x: p.x + sc.x, y: p.y + sc.y, w: sc.w, h: sc.h });
        void scr;
        say(knobG, outJack[0], outJack[1] - 22, "out", { size: 22, weight: 500, anchor: "middle", fill: ink("--silk-dim") });
        const tr = isCenter ? null : scope(knobG, { x: p.x + sc.x + 10, y: p.y + sc.y + 14, w: sc.w - 20, h: sc.h - 28, width: 5, points: 120, glow: false, wave: voiceWave({ f: 1.6 + (ri % 5) * 0.4, bright: 0.25 + (ri % 3) * 0.2, seed: 60 + ri }) });
        // A delay, a phaser or a flanger feeds its output back to its input:
        // drawn as PATCH draws a cable that runs backwards (out, down to a bus
        // under the plate, back, and up into the socket).
        const loops = p.rack.modules.flatMap((m, mi) => {
          if (!m.fb) return [];
          const pl = plates[mi];
          const [ox, oy] = pl.out;
          const [ix, iy] = pl.in;
          const bus = p.y + m.y + m.h + 36;
          const d = `M${ox} ${oy} H${ox + 28} V${bus} H${ix - 28} V${iy} H${ix}`;
          const g = el("g", {}, cableG);
          const casing = el("path", { d, fill: "none", stroke: inkA("--black", 0.5), "stroke-width": 9.6, "stroke-linejoin": "round" }, g);
          const ln = el("path", { d, fill: "none", stroke: inkA("--phos-a", 0.82), "stroke-width": 6, "stroke-linejoin": "round" }, g);
          const len = ln.getTotalLength();
          for (const q of [casing, ln]) q.setAttribute("stroke-dasharray", `${len} ${len}`);
          const pulse = el("path", { d, fill: "none", stroke: ink("--phos-a-pulse"), "stroke-width": 4, "stroke-dasharray": `60 ${len}`, opacity: 0 }, g);
          const tag = say(cableG, (ox + ix) / 2, bus + 44, `${m.title} · feedback`, { size: 34, mono: true, anchor: "middle", fill: ink("--silk-dim") });
          return [{ g, casing, ln, pulse, len, tag, knob: pl.knobs[m.knobs.findIndex(([l]) => l === "feedback")] }];
        });
        return { p, plates, cab, tr, loops, isCenter, outJack };
      });
      const C = racks.find((r) => r.isCenter);
      const lit = new Map();
      knobs.forEach((k) => lit.set(k, racks[k.ri].plates[k.mi].knobs[k.ki]));
      const ptr = pointer(svg);

      // The sound at Dub Echo's OUT, on its scope: drawn in screen space, so
      // the trace keeps its width however far the camera is from it.
      const top = svgLayer(layer);
      // A knob being turned lights where it is, in screen space, so a turn
      // reads at any distance.
      const sparkG = el("g", {}, top);
      sparkG.style.filter = GLOW.a;
      const sparks = knobs.filter((k) => k.turnAt != null).map((k) => ({ k, c: el("circle", { r: 0, fill: "none", stroke: ink("--phos-a"), "stroke-width": 2, opacity: 0 }, sparkG) }));
      const trace = scope(top, { x: 0, y: 0, w: 1920, h: 1080, width: 4, points: 520, wave: voiceWave({ f: 2.2, bright: 0.45, seed: 5 }) });
      // Until the pull-back the scope draws the bed we hear (ADR-012): its
      // drone's F2 and C3 (sound.json key.pedal, 2:3), and from Bloom on its
      // chord's A3, C4 and G4 over them, at the loudness the mix measured
      // (timeline.json env.music, written by mix.py).
      const env = stage.tl.env?.music;
      const envAt = (tt) => (env ? stage.env(tt, "music") : clamp(tt / 1.5));
      let envPeak = 1e-6;
      if (env) for (let i = 0; i < Math.min(env.v.length, Math.round((l2.t0 - 0.6) * env.rate)); i++) envPeak = Math.max(envPeak, env.v[i]);
      const te = stage.tl.marks?.entrance ?? 0;
      const bedWave = (bloom) => (x, tt) => {
        const ph = 2 * Math.PI * x;
        let y = Math.sin(4 * ph + tt * 0.9) + 0.75 * Math.sin(6 * ph + 1.3 - tt * 0.6);
        y += bloom * (0.45 * Math.sin(10.08 * ph + 0.4 + tt * 1.7) + 0.4 * Math.sin(12 * ph + 2.1 - tt * 1.2) + 0.3 * Math.sin(17.96 * ph + 0.9 + tt * 2.3));
        return y / (1.75 + 1.15 * bloom);
      };

      const shade = place(el("div", {}, layer), { x: 0, y: 0, w: 1920, h: 1080 });
      shade.style.background = `linear-gradient(180deg, ${inkA("--bezel", 0)} 55%, ${inkA("--bezel", 0.85)} 100%)`;
      const t1 = textBlock(layer, { x: 960, y: 230, w: 1600, cls: "voice", size: 84, align: "center", ax: 0.5, ay: 0.5 });
      const w1 = words(t1, "Every synthesizer has a sound in it\nthat's *yours*.");
      const t2 = textBlock(layer, { x: 960, y: 900, w: 1720, cls: "voice", size: 52, align: "center", ax: 0.5, ay: 0.5 });
      const w2 = words(t2, "Finding it means knowing your circuit: which *modules* to wire together, where the _feedback_ goes, and how each choice *shapes the sound*.");

      // The words' moments.
      const tWire = [T("open2:modules"), T("open2:wire"), T("open2:together"), T("open2:together") + 0.55];
      const tWave = T("open2:wire");
      const tFb = T("open2:feedback") - 0.2;
      const tChoice = T("open2:choice") - 0.1;
      const tShapes = T("open2:shapes") - 0.1;
      // Dub Echo's own turns: the filter's cutoff on "choice", the delay's
      // feedback on "shapes".
      const cutK = C.plates[2].knobs[0];
      const fbK = C.loops[0]?.knob;
      return (tl, t) => {
        const c = cam(t);
        world.style.transform = `translate(${960 - c.s * c.fx}px, ${540 - c.s * c.fy}px) scale(${c.s})`;
        // Where Dub Echo's scope sits on the frame now.
        const sx = 960 + c.s * (S0.x - c.fx);
        const sy = 540 + c.s * (S0.y - c.fy);
        const sw = c.s * S0.w;
        const sh = c.s * S0.h;
        const u = clamp(Math.log(z0 / c.s) / Math.log(z0));
        // Dub Echo wired cable by cable, by the hand; every other circuit
        // wires itself in a wave outward from it.
        const draws = tWire.map((a) => ramp(t, a - 0.35, a + 0.25, E.io2));
        for (const r of racks) {
          const near = r.p.dist;
          const show = r.isCenter ? ramp(t, pull0 + 0.6, pull0 + 1.2) : ramp(t, tWave - 0.9 + 1.6 * near, tWave - 0.3 + 1.6 * near);
          r.plates.forEach((pl) => (pl.opacity = show));
          r.cab.forEach(({ c: cb, step }) => {
            const dr = r.isCenter ? draws[Math.min(step, 3)] : ramp(t, tWave + 1.5 * near + step * 0.12, tWave + 0.5 + 1.5 * near + step * 0.12, E.io2);
            cb.update(t, { draw: dr, flow: r.isCenter ? ramp(t, tWire[Math.min(step, 3)] + 0.25, tWire[Math.min(step, 3)] + 0.8) : 0, opacity: show });
          });
          // Where the feedback goes: Dub Echo's delay first, then every loop in the field.
          r.loops.forEach((lp, li) => {
            const a = r.isCenter ? tFb : tFb + 0.35 + 0.9 * near + li * 0.1;
            const f = ramp(t, a, a + 0.9, E.io2);
            const off = lp.len * (1 - f);
            lp.casing.setAttribute("stroke-dashoffset", off);
            lp.ln.setAttribute("stroke-dashoffset", off);
            lp.g.style.opacity = show;
            lp.g.style.filter = f > 0 && t < a + 3.4 ? GLOW.a : "none";
            lp.pulse.setAttribute("opacity", f >= 1 ? 0.9 : 0);
            lp.pulse.setAttribute("stroke-dashoffset", -((t * 520) % (lp.len + 30)) + 30);
            lp.tag.setAttribute("opacity", ramp(t, a + 0.6, a + 1.0) * show);
          });
          if (r.tr) {
            const turned = r.plates.reduce((n, pl) => n + pl.knobs.length, 0);
            void turned;
            r.tr.g.style.opacity = show;
          }
        }
        // How each choice shapes the sound: knobs turn all over the field;
        // a knob whose dot has lifted off for the title dims.
        const racksTurn = new Map();
        for (const k of knobs) {
          const kk = lit.get(k);
          const v = valueAt(k, t);
          const turning = k.turnAt != null && t >= k.turnAt && t < k.turnAt + 0.8;
          const gone = ramp(t, k.lift, k.lift + 0.3);
          if (k.turnAt != null && t >= k.turnAt - 0.05) racksTurn.set(k.ri, Math.max(racksTurn.get(k.ri) || 0, ramp(t, k.turnAt, k.turnAt + 0.7)));
          kk.k.set(v, { lit: 0.8 * (1 - 0.7 * gone) + (turning ? 0.2 : 0), glowOn: turning });
        }
        for (const sp of sparks) {
          const e = fade(t, sp.k.turnAt, sp.k.turnAt + 0.15, sp.k.turnAt + 0.6, sp.k.turnAt + 1.1);
          if (e <= 0) {
            if (sp.on) sp.c.setAttribute("opacity", 0);
            sp.on = false;
            continue;
          }
          sp.on = true;
          const [x, y] = OF.toFrame(c, sp.k.x, sp.k.y);
          sp.c.setAttribute("cx", x.toFixed(1));
          sp.c.setAttribute("cy", y.toFixed(1));
          sp.c.setAttribute("r", (Math.max(3, 24 * c.s) * (0.8 + 0.4 * e)).toFixed(1));
          sp.c.setAttribute("opacity", (0.9 * e).toFixed(3));
        }
        racks.forEach((r, ri) => {
          if (!r.tr) return;
          const ch = racksTurn.get(ri) || 0;
          r.tr.wave = voiceWave({ f: 1.6 + (ri % 5) * 0.4 + 0.6 * ch, bright: 0.25 + (ri % 3) * 0.2 + 0.3 * ch, detune: 0.012 + 0.02 * ch, seed: 60 + ri });
          r.tr.update(t, { amp: 0.6, ox: t * 0.12 });
        });
        // Dub Echo's choices.
        const c1 = ramp(t, tChoice, tChoice + 0.9, E.io3);
        const c2 = ramp(t, tShapes, tShapes + 0.9, E.io3);
        cutK.k.set(clamp(0.5 + 0.3 * c1), { glowOn: c1 > 0 && c1 < 1 });
        if (fbK) fbK.k.set(clamp(0.75 - 0.35 * c2), { glowOn: c2 > 0 && c2 < 1 });
        const fb = C.loops.length ? ramp(t, tFb, tFb + 0.9, E.io2) : 0;
        // The sound at OUT: the bed, then silent while the patch is apart,
        // back once OUT is wired, and changed by every choice.
        const live = Math.max(1 - ramp(t, pull0 + 0.3, pull0 + 1.0), draws[3]);
        const opening = t < pull0 + 0.3;
        if (opening) trace.wave = bedWave(ramp(t, te, te + 1.5));
        else trace.wave = voiceWave({ f: 2.2 + 0.8 * fb, bright: 0.25 + 0.3 * fb + 0.35 * c1 + 0.1 * c2, detune: 0.012 + 0.03 * c2, seed: 5 });
        const level = opening ? clamp(0.12 + 0.88 * Math.sqrt(clamp(envAt(t) / envPeak))) : 1;
        trace.path.setAttribute("stroke-width", lerp(4, 1.6, u));
        trace.g.style.opacity = 1 - ramp(t, T("open2:sound") + 0.6, T("open2:sound") + 1.4);
        trace.update(t, { draw: 1, amp: 0.55 * level * live, ox: t * 0.12, rect: { x: sx + sw * 0.05, y: sy + sh * 0.12, w: sw * 0.9, h: sh * 0.76 } });
        // The hand plugs Dub Echo's cables and its feedback, then leaves the
        // field to turn its own knobs.
        const leg = (i) => {
          const a = C.cab[i].c;
          void a;
          const from = i < 3 ? C.plates[3 - i].out : C.plates[0].out;
          const to = i < 3 ? C.plates[2 - i].in : C.outJack;
          return [[tWire[i] - 0.4, from[0], from[1]], [tWire[i] + 0.25, to[0], to[1]]];
        };
        const lp = C.loops[0];
        const fbPath = lp ? [[tFb - 0.1, ...C.plates[1].out], [tFb + 0.9, ...C.plates[1].in]] : [];
        const path = [[tWire[0] - 1.2, C.plates[3].out[0] - 200, C.plates[3].out[1] + 500], ...[0, 1, 2, 3].flatMap(leg), ...fbPath,
          [tFb + 2.0, C.plates[1].in[0] - 300, C.plates[1].in[1] + 600]];
        const p = glide(t, path);
        const held = draws.some((d) => d > 0 && d < 1) || (fb > 0 && fb < 1);
        ptr.update({ x: p.x, y: p.y, o: fade(t, tWire[0] - 1.2, tWire[0] - 0.7, tFb + 1.0, tFb + 1.6), click: held ? 0.1 : null, scale: 1.1 / Math.max(0.4, c.s) });
        // The words.
        t1.style.opacity = fade(t, l1.t0 - 0.3, l1.t0 + 0.2, pull0 - 0.3, pull0 + 0.3);
        reveal(w1, t, l1.t0, l1.t1);
        shade.style.opacity = ramp(t, pull0 + 0.8, pull0 + 2.4);
        t2.style.opacity = fade(t, l2.t0 - 0.2, l2.t0 + 0.3, l2.t1 + 0.3, l2.t1 + 0.9);
        reveal(w2, t, l2.t0, l2.t1);
        void tl;
      };
    },
  });
}

// ---------------------------------------------------------------------------
// TITLE — the field's knobs lift off as a cloud, and the cloud contracts into
// the mark: read inward, the mark is a posterior contracting onto one taste.

function sceneTitle({ stage, beat, line, giant }) {
  const b = beat("title");
  const l = line("title1");
  const OF = openField(stage, giant);
  stage.scene({
    id: "title",
    t0: b.t0,
    t1: b.t1,
    pre: 0.8,
    post: 0.6,
    fout: 0.6,
    build(layer) {
      const svg = svgLayer(layer);
      const M = { cx: 960, cy: 470, size: 300 };
      // One dot for every knob in frame when the field stops, starting on it.
      const c = OF.cam(OF.end + 1);
      const parts = [];
      const cloudG = el("g", {}, svg);
      cloudG.style.filter = GLOW.b;
      for (const k of OF.knobs) {
        const [x, y] = OF.toFrame(c, k.x, k.y);
        if (x < -10 || x > 1930 || y < -10 || y > 1090) continue;
        const dx = x - M.cx;
        const dy = (y - M.cy) / 0.82;
        parts.push({ k, r0: Math.hypot(dx, dy), a0: Math.atan2(dy, dx), lift: k.lift - b.t0, c: el("circle", { r: 0, fill: ink("--phos-b"), opacity: 0 }, cloudG) });
      }
      const mk = mark(svg, M);
      const lock = place(el("div", { class: "lk" }, layer), { x: 0, y: 0 });
      lock.style.fontSize = "var(--t-frame-14)";
      const wm = el("span", { class: "wm" }, lock, "AURACLE");
      const desc = textBlock(layer, { x: 960, y: 700, w: 1600, cls: "mono", size: 27, align: "center", ax: 0.5, ay: 0.5 });
      desc.style.letterSpacing = "0.26em";
      desc.style.textTransform = "uppercase";
      desc.style.color = ink("--silk-dim");
      desc.textContent = "a synthesizer that searches for your sound";

      // Final lockup geometry (measured once, at the final tracking).
      wm.style.letterSpacing = "0.095em";
      const wmW = wm.getBoundingClientRect().width;
      const fs = parseFloat(getComputedStyle(lock).fontSize); // the size its token sets
      const markPx = 1.28 * fs;
      const gap = 0.62 * fs;
      const total = markPx + gap + wmW;
      const left = 960 - total / 2;
      const endMark = { cx: left + markPx / 2, cy: 520 };
      const wmX = left + markPx + gap;

      return (tl) => {
        const c1 = 1.9;
        for (const p of parts) {
          // It lifts off its knob, glows, and is drawn into the swirl.
          const on = ramp(tl, p.lift, p.lift + 0.3);
          const uu = ramp(tl, p.lift + 0.2, c1 - 0.1 + 0.25 * (p.lift + 0.8), E.lin);
          const e = E.io3(uu);
          const r = lerp(p.r0, 0, e);
          const a = p.a0 + e * (1.2 + 2 * p.k.spin);
          const rise = 14 * on * (1 - e);
          p.c.setAttribute("cx", (M.cx + r * Math.cos(a)).toFixed(1));
          p.c.setAttribute("cy", (M.cy + r * Math.sin(a) * 0.82 - rise).toFixed(1));
          p.c.setAttribute("r", (p.k.size * (0.5 + 0.5 * on) * (1 - 0.6 * e)).toFixed(2));
          p.c.setAttribute("opacity", (on * (1 - ramp(uu, 0.82, 1, E.lin))).toFixed(3));
        }
        // The mark assembles: core, then inner ring, outer ring, tile.
        const core = E.outBack(ramp(tl, c1 - 0.45, c1 + 0.2, E.lin));
        const inner = ramp(tl, c1 - 0.1, c1 + 0.8, E.io3);
        const outer = ramp(tl, c1 + 0.25, c1 + 1.2, E.io3);
        const tile = ramp(tl, c1 + 0.6, c1 + 1.4, E.io2);
        mk.update({ core: tl < c1 - 0.45 ? 0 : core, inner, outer, tile });
        // Then it moves into the lockup and the word tracks in.
        const m = ramp(tl, c1 + 1.3, c1 + 2.2, E.io4);
        const scale = lerp(1, markPx / M.size, m);
        const cx = lerp(M.cx, endMark.cx, m);
        const cy = lerp(M.cy, endMark.cy, m);
        mk.g.setAttribute("transform", `translate(${cx} ${cy}) scale(${scale}) translate(${-M.cx} ${-M.cy})`);
        const w = ramp(tl, c1 + 1.55, c1 + 2.6, E.out4);
        wm.style.letterSpacing = `${lerp(0.5, 0.095, w)}em`;
        lock.style.opacity = w;
        place(lock, { x: wmX, y: endMark.cy, ay: 0.5 });
        lock.style.transform = `translateY(-0.035em)`;
        desc.style.opacity = ramp(tl, c1 + 2.3, c1 + 3.0, E.io2);
        desc.style.letterSpacing = `${lerp(0.4, 0.26, ramp(tl, c1 + 2.3, c1 + 3.2, E.out4))}em`;
        place(desc, { y: 700 });
        // A slow push-in once the mark is made.
        layer.style.transform = `scale(${lerp(1.0, 1.035, ramp(tl, c1, b.t1 - b.t0, E.lin))})`;
        layer.style.transformOrigin = "50% 50%";
        void l;
      };
    },
  });
}

// ---------------------------------------------------------------------------
// DUEL — EVOLVE plays you two sounds; you pick; every pick teaches it.

// Pairs of the bank's own sounds, each drawn with its face: the pool a
// session starts from holds the presets.
const PAIRS = [
  ["Glass Pad", "Slow Weather"],
  ["Cathedral", "Morph Pad"],
  ["Tidal", "Long Room"],
  ["Rotor", "Detune Dream"],
  ["Ember", "Sea Change"],
  ["Sweep Machine", "Pump Room"],
  ["Choirboy", "Twelve String"],
  ["Wobble Board", "Solo Flight"],
].filter(([a, b]) => PRESETS.includes(a) && PRESETS.includes(b));

function sceneDuel({ stage, beat, line }) {
  const b = beat("duel");
  const l1 = line("duel1");
  const l2 = line("duel2");
  stage.scene({
    id: "duel",
    t0: b.t0,
    t1: b.t1,
    pre: 0.4,
    post: 0.6,
    fin: 0.4,
    build(layer) {
      const scr = appScreen(layer, { ...F, radius: 3, level: "evolve" });
      const V = evolveView(scr, { a: PAIRS[0][0], b: PAIRS[0][1] });
      const { svg, over } = stack(layer);
      const ptr = pointer(svg);
      const cap = captions(over, stage, ["duel1", "duel2"], b.t1 + 0.3);
      const A = V.card("A");
      const B = V.card("B");
      const cam = camera([
        [b.t0 - 0.4, 1.0, 960, 540],
        [l1.t0 + 0.6, 1.18, 1050, 600],
        [l2.t0 - 0.2, 1.18, 1050, 600],
        [l2.t0 + 0.8, 1.0, 960, 540],
      ]);
      let shown = 0;
      return (tl, t) => {
        const c = cam(t);
        scr.cam(...c);
        const d1 = l1.t1 - l1.t0;
        // First pair, played out by hand: PLAY A, PLAY B, PICK B.
        const hA = l1.t0 + d1 * 0.22;
        const hB = l1.t0 + d1 * 0.45;
        const pk = l1.t0 + d1 * 0.8;
        const fp = (card, which) => onFrame(c, ...(which === "play" ? card.play.pos : card.pick.pos));
        const path = [
          [l1.t0 - 0.5, 1200, 1060],
          [hA, ...fp(A, "play")],
          [hA + 0.5, ...fp(A, "play")],
          [hB, ...fp(B, "play")],
          [hB + 0.5, ...fp(B, "play")],
          [pk, ...fp(B, "pick")],
          [l2.t0 + 2, fp(B, "pick")[0] + 40, fp(B, "pick")[1] + 60],
        ];
        const p = glide(t, path);
        const clickAt = [hA, hB, pk].find((x) => t >= x && t < x + 0.5);
        ptr.update({ x: p.x + 4, y: p.y + 6, o: fade(t, l1.t0 - 0.5, l1.t0 - 0.1, l2.t0 + 0.4, l2.t0 + 0.8), click: clickAt != null ? (t - clickAt) / 0.5 : null, scale: 1.1 });
        // After the first pick, a run of pairs, one a beat, each answered.
        const spb = 60 / stage.tl.grid.bpm;
        const run0 = l2.t0 - 0.1;
        const k = t < run0 ? -1 : Math.floor((t - run0) / spb);
        const picks = t < pk ? 0 : 1 + Math.max(0, Math.min(k + 1, 9));
        let pair = PAIRS[0];
        if (k >= 0) pair = PAIRS[(k + 1) % PAIRS.length];
        const idx = PAIRS.indexOf(pair);
        if (idx !== shown) {
          A.show(pair[0]);
          B.show(pair[1]);
          shown = idx;
        }
        if (k < 0) {
          const aOn = fade(t, hA, hA + 0.15, hB - 0.1, hB + 0.2);
          const bOn = fade(t, hB, hB + 0.15, pk + 0.6, pk + 1.0);
          A.set({ lit: aOn, play: fade(t, hA, hA + 0.08, hA + 0.25, hA + 0.4) });
          B.set({ lit: bOn, play: fade(t, hB, hB + 0.08, hB + 0.25, hB + 0.4), picked: ramp(t, pk, pk + 0.2), pickDown: fade(t, pk, pk + 0.08, pk + 0.25, pk + 0.4) });
        } else {
          const ph = ((t - run0) / spb) % 1;
          const pickB = (k * 7 + 3) % 3 !== 0;
          const flash = ph < 0.55 ? 1 - ph / 0.55 : 0;
          A.set({ picked: pickB ? 0 : flash, pickDown: pickB ? 0 : flash });
          B.set({ picked: pickB ? flash : 0, pickDown: pickB ? flash : 0 });
        }
        // Every pick is taught: the pips toward the first fit, and TAUGHT.
        V.pips(Math.min(6, picks));
        scr.taught(picks);
        cap(t);
        void tl;
      };
    },
  });
}

// ---------------------------------------------------------------------------
// GROW — real circuits, built and wired, growing toward the taste.

function sceneGrow({ stage, beat, line }) {
  const b = beat("grow");
  const l1 = line("grow1");
  const l2 = line("grow2");
  stage.scene({
    id: "grow",
    t0: b.t0,
    t1: b.t1,
    pre: 0.2,
    post: 0.6,
    fin: 0.5,
    fout: 0.6,
    build(layer) {
      const { under, svg, over } = stack(layer);
      // A patch as PATCH lays one out: the audio chain in a row, its
      // modulator under the filter, each plate with its readouts.
      const P = [
        { name: "supersaw", x: 110, y: 380, w: 330, knobs: 3, labels: ["detune", "mix", "mod"], values: ["60%", "55%", "0%"] },
        { name: "filter", kind: "svf lp", alt: "ladder", x: 540, y: 380, w: 300, knobs: 3, labels: ["cutoff", "res", "mod"], values: ["632 Hz", "Q 0.8", "50%"] },
        { name: "reverb", x: 940, y: 380, w: 330, knobs: 3, labels: ["size", "damp", "mix"], values: ["65%", "40%", "35%"] },
        { name: "env / out", x: 1370, y: 380, w: 440, knobs: 4, labels: ["attack", "decay", "sustain", "release"], values: ["1.45 s", "100 ms", "−2.8 dB", "0.3 s"] },
        { name: "lfo", kind: "tri", x: 570, y: 140, w: 200, knobs: 1, labels: ["rate"], values: ["0.25 Hz"], color: "b" },
      ];
      const plates = P.map((p, i) => plate(under, svg, { x: p.x, y: p.y, w: p.w, h: 170, name: p.name, kind: p.kind || "", knobs: p.knobs, labels: p.labels, values: p.values, color: p.color || "a", seed: 30 + i }));
      const cab = [
        cable(svg, { p0: plates[0].out, p1: plates[1].in, sag: 10, width: 4 }),
        cable(svg, { p0: plates[1].out, p1: plates[2].in, sag: 10, width: 4 }),
        cable(svg, { p0: plates[2].out, p1: plates[3].in, sag: 10, width: 4 }),
        cable(svg, { p0: plates[4].out, p1: [plates[1].knobs[0].cx, 380], sag: 40, width: 3, color: "b" }),
      ];
      const out = el("div", { class: "silk" }, over, "OUT");
      place(out, { x: 1832, y: 465, ay: 0.5 });
      Object.assign(out.style, { fontSize: "var(--t-frame-3)", color: ink("--silk-dim"), letterSpacing: "0.2em" });
      const outCable = cable(svg, { p0: plates[3].out, p1: [1880, 465], sag: 4, width: 4 });
      // Lineage: what each generation changed.
      const gens = [
        ["gen 7", "+lfo → cutoff"],
        ["gen 8", "svf → ladder"],
        ["gen 9", "release 0.3 s → 1.6 s"],
      ];
      const chips = gens.map(([g, d], i) => {
        const c = el("div", { class: "pill" }, over, "");
        c.innerHTML = `<span style="color:${ink("--phos-b-dim")}">${g}</span>&nbsp;&nbsp;<span style="color:${ink("--silk")}">${d}</span>`;
        place(c, { x: 150 + i * 560, y: 700 });
        return c;
      });
      const cap = captions(over, stage, ["grow1", "grow2"], b.t1 + 0.4, { y: 900, size: 54 });
      return (tl, t) => {
        const L2 = l2.t0 - b.t0;
        // Plates arrive one by one, cables plug in behind them.
        plates.forEach((p, i) => {
          const a0 = -0.2 + i * 0.28;
          const u = ramp(tl, a0, a0 + 0.5, E.out4);
          p.opacity = u;
          p.div.style.transform = `translateY(${(1 - u) * 30}px)`;
        });
        cab.forEach((c, i) => {
          const a0 = 0.5 + i * 0.3;
          c.update(t, { draw: ramp(tl, a0, a0 + 0.6, E.io2), flow: ramp(tl, a0 + 0.6, a0 + 1.2) });
        });
        outCable.update(t, { draw: ramp(tl, 1.8, 2.3), flow: ramp(tl, 2.3, 2.8) });
        out.style.opacity = ramp(tl, 2.0, 2.4);
        // The LFO turns the filter's cutoff; the envelope opens and closes.
        plates[1].knobs[0].k.set(0.45 + 0.28 * Math.sin(t * 2 * Math.PI * 0.25), { glowOn: true });
        plates[4].knobs[0].k.set(0.3, { col: "b" });
        // Evolution: at the second line the filter becomes a ladder and the
        // tail opens.
        const swap = ramp(tl, L2 + 0.9, L2 + 1.3, E.io3);
        const kind = plates[1].div.querySelector(".mono");
        if (kind) kind.textContent = swap > 0.5 ? "ladder" : "svf lp";
        plates[1].div.style.borderColor = swap > 0.5 ? inkA("--phos-b", 0.8 * (1 - ramp(tl, L2 + 1.3, L2 + 3))) : "";
        const rel = ramp(tl, L2 + 2.2, L2 + 3.0);
        plates[3].knobs[3].k.set(0.25 + 0.5 * rel, { glowOn: rel > 0 && rel < 1 });
        plates[3].knobs[3].lbl[0].textContent = rel > 0.5 ? "1.6 s" : "0.3 s";
        chips.forEach((c, i) => {
          const a0 = L2 + 0.3 + i * 0.9;
          const u = ramp(tl, a0, a0 + 0.5, E.out3);
          c.style.opacity = u;
          c.style.transform = `translateY(${(1 - u) * 14}px)`;
        });
        cap(t);
        void l1;
      };
    },
  });
}

// ---------------------------------------------------------------------------
// PLAY — PERFORM drawn, then the app itself: Bright opening up in its demo,
// Wander let go on its line and drifting in its demo.

/** The app's window, drawn and recorded: a drawn screen and, when the take
 *  is in, its footage in the same window under the same camera. */
function appWindow(layer, take, opts) {
  const scr = appScreen(layer, { ...F, radius: 3, ...opts });
  const clip = take && take.frames ? footage(layer, { frames: take.frames, ...F, radius: 14 }) : null;
  if (clip) clip.wrap.style.opacity = 0;
  return { scr, clip };
}

/** A demo by id (timeline.json `demos`): its first note, last note-off, and
 *  where the next line may start. */
function demoOf(stage, id) {
  const d = (stage.tl.demos || []).find((x) => x.id === id);
  if (!d) throw new Error(`no demo "${id}" in the timeline`);
  return d;
}

/** Cross from the drawing to the take over [x0, x1], and keep the take's
 *  frame in step with the film. */
function crossToTake(stage, scr, clip, ck, t, c, x0, x1) {
  if (!clip) return;
  const u = ramp(t, x0, x1, E.io2);
  clip.wrap.style.opacity = u;
  scr.wrap.style.opacity = 1 - ramp(t, x1, x1 + 0.1);
  if (u > 0) stage.wait(clip.seek(ck.clipTime(t), { z: c[0], fx: c[1], fy: c[2] }));
}

function scenePlay({ stage, beat, line, takes }) {
  const b = beat("play");
  const take = takes["l-play"];
  const ck = take ? takeClock(stage, take) : null;
  const l1 = line("play1");
  const dB = demoOf(stage, "bright");
  const dW = demoOf(stage, "wander");
  stage.scene({
    id: "play",
    t0: b.t0,
    t1: b.t1,
    pre: 0.4,
    post: 1.0,
    fin: 0.4,
    fout: 0.6,
    build(layer) {
      const ch = take?.chrome || {};
      const { scr, clip } = appWindow(layer, take, { level: "perform", taught: Number(ch.taught || 0), inHand: soundOf(take).name, bankRows: ch.bank || null, tabs: ch.tabs || null });
      const V = performView(scr, { sound: soundOf(take), faceA: take?.logs?.face || null });
      const { svg, over } = stack(layer);
      const ptr = pointer(svg);
      const cap = captions(over, stage, ["play1", "play2", "play3"], b.t1 + 0.4);
      // The drawing, until the instrument is heard: the cut into the app
      // lands as Bright's demo begins.
      const x1 = dB.t0;
      const x0 = x1 - 0.6;
      const tTurn = dB.t0 + 0.5;
      const tLet = at(stage, b, "play3:Let");
      const bright = ck?.mark("bright") || [V.knobs[0].cx, V.knobs[0].cy];
      const wander = ck?.mark("wander") || [V.wander.cx, V.wander.cy];
      const cam = camera([
        [b.t0 - 0.4, 1.0, 960, 540],
        [l1.t1, 1.0, 960, 540],
        [dB.t0 - 0.8, 1.45, 1300, 560],
        [dB.off + 0.6, 1.45, 1300, 560],
        [tLet - 0.2, 1.4, 1300, 700],
        [b.t1 + 1, 1.4, 1300, 700],
      ]);
      const chord = new Set([60, 64, 67]);
      return (tl, t) => {
        const c = cam(t);
        scr.cam(...c);
        // Drawn: the keys under the first line, and the pointer on its way to Bright.
        scr.keys.update(t >= l1.t0 && t < l1.t1 + 0.6 ? chord : new Set());
        V.scope.update(t, { amp: t >= l1.t0 ? 0.35 : 0.05, ox: t * 0.3 });
        crossToTake(stage, scr, clip, ck, t, c, x0, x1);
        // The hand: Bright up 70 px over 3 s in its demo, then Wander up 95 px
        // on "Let it wander".
        const [bx, by] = bright;
        const [wx, wy] = wander;
        const pts = [
          [x0 - 1.0, 1700, 1000],
          [tTurn, bx, by],
          [tTurn + 3.0, bx, by - 70],
          [tTurn + 3.5, bx, by - 70],
          [tLet, wx, wy],
          [tLet + 0.7, wx, wy - 95],
          [tLet + 1.4, wx + 120, wy - 60],
        ];
        const p = glide(t, pts);
        const [px, py] = onFrame(c, p.x, p.y);
        const held = (t >= tTurn && t < tTurn + 3.0) || (t >= tLet && t < tLet + 0.7);
        ptr.update({ x: px, y: py, o: fade(t, x0 - 1.0, x0 - 0.5, tLet + 1.0, tLet + 1.5), click: held ? 0.1 : null, scale: 1.1 });
        cap(t);
        void tl;
        void dW;
      };
    },
  });
}

// ---------------------------------------------------------------------------
// OFFER — Offer grows B from the sound in hand (drawn, with the take's own
// faces); then the app: Blend past half and Take, in the offer's demo.

function sceneOffer({ stage, beat, line, takes }) {
  const b = beat("offer");
  const take = takes["l-offer"];
  const ck = take ? takeClock(stage, take) : null;
  const o2 = line("offer2");
  const dO = demoOf(stage, "blend");
  stage.scene({
    id: "offer",
    t0: b.t0,
    t1: b.t1,
    pre: 0.6,
    post: 0.8,
    fin: 0.6,
    fout: 0.6,
    build(layer) {
      const ch = take?.chrome || {};
      const { scr, clip } = appWindow(layer, take, { level: "perform", taught: Number(ch.taught || 0), inHand: soundOf(take).name, bankRows: ch.bank || null, tabs: ch.tabs || null });
      const V = performView(scr, { sound: soundOf(take), faceA: take?.logs?.face || null, faceB: take?.logs?.["face b"] || null });
      const { svg, over } = stack(layer);
      const growing = say(scr.svg, 863.3, 566, "growing an offer…", { size: TYPE.value, mono: true, anchor: "middle", fill: ink("--phos-b") });
      const ptr = pointer(svg);
      const cap = captions(over, stage, ["offer1", "offer2"], b.t1 + 0.4);
      const tPress = at(stage, b, "offer1:Press");
      // The app's own wait for B, as the take timed it.
      const ready = take?.meta?.stamps?.ready != null ? ck.filmAt(take.meta.stamps.ready) : tPress + 4;
      const tBlend = dO.t0 + 0.4;
      const tTake = dO.t0 + 4.2;
      const x0 = o2.t0 - 0.7;
      const x1 = o2.t0 - 0.1;
      const offerPad = ck?.mark("offer") || V.pads.offer.pos;
      const takePad = ck?.mark("take") || V.pads.take.pos;
      const cam = camera([
        [b.t0 - 0.6, 1.0, 960, 540],
        [tPress - 0.3, 1.28, 1100, 640],
        [x1, 1.28, 1100, 640],
        [tBlend - 0.2, 1.32, 1080, 760],
        [tTake + 0.2, 1.32, 1080, 760],
        [tTake + 1.2, 1.0, 960, 540],
        [b.t1 + 1, 1.0, 960, 540],
      ]);
      return (tl, t) => {
        const c = cam(t);
        scr.cam(...c);
        V.scope.update(t, { amp: 0.05, ox: t * 0.3 });
        // Drawn: Offer pressed, "growing an offer…", then B.
        V.pads.offer.set({ down: fade(t, tPress, tPress + 0.08, tPress + 0.25, tPress + 0.45) });
        V.moved(t >= tPress + 0.2);
        growing.setAttribute("opacity", fade(t, tPress + 0.2, tPress + 0.4, ready - 0.2, ready));
        V.offered(ramp(t, ready - 0.1, ready + 0.6, E.lin));
        V.blend(0);
        crossToTake(stage, scr, clip, ck, t, c, x0, x1);
        // The hand: Offer, then (in the demo) Blend from home past half, then Take.
        const bl = ck?.meta?.rects?.blend;
        const bx0 = bl ? bl.x + bl.w / 2 - 140 : 545;
        const by = bl ? bl.y + bl.h / 2 : 948;
        const pts = [
          [tPress - 0.9, 1700, 1050],
          [tPress, ...offerPad],
          [tPress + 0.6, ...offerPad],
          [tBlend - 0.5, bx0, by],
          [tBlend, bx0, by],
          [tBlend + 1.4, bx0 + 215, by],
          [tTake - 0.6, bx0 + 215, by],
          [tTake, ...takePad],
          [tTake + 1.2, takePad[0] + 80, takePad[1] + 120],
        ];
        const p = glide(t, pts);
        const [px, py] = onFrame(c, p.x, p.y);
        const ckAt = [tPress, tTake].find((x) => t >= x && t < x + 0.5);
        const held = t >= tBlend && t < tBlend + 1.4;
        ptr.update({ x: px, y: py, o: fade(t, tPress - 0.9, tPress - 0.5, tTake + 0.8, tTake + 1.2), click: ckAt != null ? (t - ckAt) / 0.5 : held ? 0.1 : null, scale: 1.1 });
        cap(t);
        void tl;
      };
    },
  });
}

// ---------------------------------------------------------------------------
// DEPTH — the app itself, seen and not heard: in to PATCH (the face carried
// from PERFORM's well to OUT), the cutoff turned from PERFORM; then out to
// TASTE and LEARNING, where its forecasts are the session's own.

function sceneDepth({ stage, beat, line, takes }) {
  const b = beat("depth");
  const take = takes["l-circuit"];
  const ck = take ? takeClock(stage, take) : null;
  const l1 = line("depth1");
  const l2 = line("depth2");
  stage.scene({
    id: "depth",
    t0: b.t0,
    t1: b.t1,
    pre: 0.6,
    post: 0.6,
    fin: 0.6,
    fout: 0.6,
    build(layer) {
      const ch = take?.chrome || {};
      // Without a take, PATCH drawn (a preview); with one, the app throughout.
      const hasClip = !!(take && take.frames);
      const { scr, clip } = appWindow(layer, take, { level: hasClip ? "perform" : "patch", taught: Number(ch.taught || 0), inHand: soundOf(take).name, bankRows: ch.bank || null, tabs: ch.tabs || null });
      const V = clip ? performView(scr, { sound: soundOf(take), faceA: take?.logs?.face || null }) : patchView(scr, { teach: ch.teach || null });
      if (clip) clip.wrap.style.opacity = 1;
      const { svg, over } = stack(layer);
      const ptr = pointer(svg);
      const tOpen = at(stage, b, "depth1:Open");
      const tEvery = at(stage, b, "depth1:Every");
      const tWatch = at(stage, b, "depth1:watch");
      const tUnder = at(stage, b, "depth2:Underneath");
      const tKeeps = at(stage, b, "depth2:keeps") - 0.8;
      const rail = (lv) => ck?.mark(lv);
      // The cutoff knob on the filter plate, as the take measured the plate.
      const fr = take?.meta?.rects?.filter;
      const cutoff = fr ? [fr.x + 39, fr.y + 58] : V.plates ? [V.plates[1].knobs[0].cx, V.plates[1].knobs[0].cy] : [705, 508];
      const cam = camera([
        [b.t0 - 0.6, 1.0, 960, 540],
        [tEvery - 0.4, 1.0, 960, 540],
        [tEvery + 0.4, 1.7, 780, 520],
        [tUnder - 0.7, 1.7, 780, 520],
        [tUnder - 0.1, 1.0, 960, 540],
        [tKeeps + 1.4, 1.0, 960, 540],
        [tKeeps + 2.4, 1.35, 1450, 800],
        [b.t1 + 1, 1.35, 1450, 800],
      ]);
      const tag = callout(over, svg, { x: 0, y: 0, tx: 0, ty: 0, text: "◂ Bright, in PERFORM", color: "b" });
      const cap = captions(over, stage, ["depth1", "depth2"], b.t1 + 0.5);
      return (tl, t) => {
        const c = cam(t);
        scr.cam(...c);
        if (clip) {
          scr.wrap.style.opacity = 0;
          stage.wait(clip.seek(ck.clipTime(t), { z: c[0], fx: c[1], fy: c[2] }));
        }
        // The hand on the levels' cross: in to PATCH, then out to TASTE and LEARNING.
        const stops = [[tOpen, rail("patch")], [tUnder, rail("taste")], [tKeeps, rail("learning")]].filter(([, p]) => p);
        if (stops.length) {
          const pts = [[tOpen - 0.9, 1860, 900]];
          for (const [tt, p] of stops) pts.push([tt - 0.05, ...p], [tt + 0.6, ...p]);
          pts.push([tKeeps + 1.4, 1880, 960]);
          const p = glide(t, pts);
          const [px, py] = onFrame(c, p.x, p.y);
          const ckAt = stops.map(([tt]) => tt).find((x) => t >= x && t < x + 0.5);
          ptr.update({ x: px, y: py, o: fade(t, tOpen - 0.9, tOpen - 0.5, tKeeps + 0.9, tKeeps + 1.4) * (1 - ramp(t, tOpen + 0.7, tOpen + 1.0) + ramp(t, tUnder - 0.8, tUnder - 0.4)), click: ckAt != null ? (t - ckAt) / 0.5 : null, scale: 1.1 });
        } else ptr.update({ x: 0, y: 0, o: 0 });
        // PERFORM's hand on the cutoff, named.
        const [kx, ky] = onFrame(c, ...cutoff);
        tag.move(kx + 22 * c[0], ky - 6, kx + 120, ky - 120);
        tag.update(ramp(t, tWatch - 0.2, tWatch + 0.6, E.io2) * (1 - ramp(t, tUnder - 0.8, tUnder - 0.4)));
        cap(t);
        void tl;
        void l1;
        void l2;
      };
    },
  });
}

// ---------------------------------------------------------------------------
// CLOSE — every note in this film; free, open, in the browser.

const BANK = ["Tidal", "Cathedral", "Morph Pad", "Long Room", "Slow Weather", "Rotor", "Wobble Board", "Solo Flight", "Held Under", "Ceiling", "Dub Echo", "Choirboy"].filter((n) => PRESETS.includes(n));

function sceneClose({ stage, beat, line }) {
  const b = beat("close");
  const l1 = line("close1");
  const l2 = line("close2");
  stage.scene({
    id: "close",
    t0: b.t0,
    t1: b.t1,
    pre: 0.3,
    post: 0.5,
    fin: 0.4,
    fout: 0.5,
    build(layer) {
      const { under, svg, over } = stack(layer);
      // The bank's sounds, each in a well with its face and its name, as
      // EVOLVE's cards hold them.
      const cells = BANK.map((n, i) => {
        const col = i % 6;
        const row = Math.floor(i / 6);
        const x = 130 + col * 280;
        const y = 90 + row * 340;
        const d = place(el("div", {}, under), { x, y, w: 250, h: 290 });
        Object.assign(d.style, {
          border: `1px solid ${ink("--hairline")}`, borderRadius: "var(--r3)",
          background: `radial-gradient(120% 90% at 50% 60%, ${ink("--panel")}, ${ink("--bezel")} 62%)`,
          boxShadow: `inset 0 0 0 1px ${inkA("--black", 0.6)}, inset 0 30px 60px -30px ${inkA("--black", 0.75)}`,
        });
        const f = face(under, { x: x + 10, y: y + 12, w: 230, h: 240, name: n, kind: "evolve" });
        const lbl = say(svg, x + 125, y + 276, n, { size: 20, caps: false, anchor: "middle", fill: ink("--silk-dim") });
        return { d, f, lbl };
      });
      const v1 = voiceLine(over, "Every note in this film *is Auracle*.", { y: 830, size: 60 });
      const v2 = voiceLine(over, "Free, open source, and running in your browser.", { y: 830, size: 60 });
      const pills = ["free", "open source · MIT", "Rust → WebAssembly", "nothing to install"].map((s, i) => {
        const p = el("div", { class: "pill a" }, over, s);
        place(p, { x: 960 + (i - 1.5) * 380, y: 960, ax: 0.5, ay: 0.5 });
        return p;
      });
      return (tl, t) => {
        const L2 = l2.t0 - b.t0;
        const spb = 60 / stage.tl.grid.bpm;
        const beatNo = Math.floor((t - stage.tl.grid.t0) / spb);
        const ph = ((t - stage.tl.grid.t0) / spb) % 1;
        cells.forEach((c, i) => {
          const u = ramp(tl, -0.3 + i * 0.06, 0.3 + i * 0.06, E.out3);
          const hot = ((beatNo % cells.length) + cells.length) % cells.length === i ? 1 - ph : 0;
          c.d.style.opacity = u;
          c.f.wrap.style.opacity = u * (0.55 + 0.45 * hot);
          c.lbl.setAttribute("opacity", u);
          c.lbl.setAttribute("fill", hot > 0.2 ? ink("--phos-a") : ink("--silk-dim"));
          c.d.style.borderColor = hot > 0.2 ? inkA("--phos-a", 0.5 * hot) : ink("--hairline");
        });
        under.style.transform = `scale(${lerp(1, 0.97, ramp(tl, 0, b.t1 - b.t0, E.lin))})`;
        v1.d.style.opacity = fade(tl, l1.t0 - b.t0 - 0.3, l1.t0 - b.t0, L2 - 0.4, L2 - 0.15);
        reveal(v1.sp, t, l1.t0, l1.t1);
        v2.d.style.opacity = fade(tl, L2 - 0.2, L2 + 0.1, b.t1 - b.t0, b.t1 - b.t0 + 0.4);
        reveal(v2.sp, t, l2.t0, l2.t1);
        pills.forEach((p, i) => {
          const u = ramp(tl, L2 + 0.4 + i * 0.25, L2 + 0.8 + i * 0.25, E.out3);
          p.style.opacity = u;
          p.style.transform = `translateY(${(1 - u) * 12}px)`;
        });
      };
    },
  });
}

// ---------------------------------------------------------------------------
// END — the lockup, and where to play it.

function sceneEnd({ stage, beat, line }) {
  const b = beat("end");
  const l1 = line("end1");
  stage.scene({
    id: "end",
    t0: b.t0,
    t1: b.t1,
    pre: 0.3,
    post: 0.1,
    fin: 0.5,
    build(layer) {
      const { svg, over } = stack(layer);
      const M = { cx: 0, cy: 420, size: 150 };
      const lock = place(el("div", { class: "lk" }, over), { x: 0, y: 0 });
      lock.style.fontSize = "var(--t-frame-12)";
      const wm = el("span", { class: "wm" }, lock, "AURACLE");
      const wmW = wm.getBoundingClientRect().width;
      const lockPx = parseFloat(getComputedStyle(lock).fontSize); // the size its token sets
      const markPx = 1.28 * lockPx;
      const gap = 0.62 * lockPx;
      const left = 960 - (markPx + gap + wmW) / 2;
      M.cx = left + markPx / 2;
      const mk = mark(svg, { cx: M.cx, cy: M.cy, size: markPx });
      place(lock, { x: left + markPx + gap, y: M.cy, ay: 0.5 });
      // The lockup lands on the downbeat of the score's last section, where
      // the finale rings out. There is no hit (ADR-014: no cues).
      const sayIt = textBlock(over, { x: 960, y: 610, w: 1400, cls: "voice", size: 64, align: "center", ax: 0.5, ay: 0.5 });
      const sp = words(sayIt, "Play it *today*.");
      const url = el("div", { class: "pill a" }, over, "auracle.alexnodeland.com  ▸");
      place(url, { x: 960, y: 740, ax: 0.5, ay: 0.5 });
      Object.assign(url.style, { fontSize: "var(--t-frame-5)", padding: "var(--s4) var(--s6)" });
      return (tl, t) => {
        const u = ramp(tl, -0.3, 0.6, E.out4);
        mk.update({ tile: u, outer: ramp(tl, -0.1, 0.8), inner: ramp(tl, -0.3, 0.5), core: E.outBack(ramp(tl, -0.3, 0.3, E.lin)) });
        lock.style.opacity = u;
        wm.style.letterSpacing = `${lerp(0.3, 0.095, u)}em`;
        sayIt.style.opacity = ramp(tl, l1.t0 - b.t0 - 0.3, l1.t0 - b.t0);
        reveal(sp, t, l1.t0, l1.t1);
        const uu = ramp(tl, l1.t1 - b.t0, l1.t1 - b.t0 + 0.6, E.out3);
        url.style.opacity = uu;
        url.style.transform = `translateY(${(1 - uu) * 12}px)`;
        // The very end fades to the rack.
        layer.style.opacity = 1 - ramp(tl, b.t1 - b.t0 - 0.8, b.t1 - b.t0, E.io2);
      };
    },
  });
}
