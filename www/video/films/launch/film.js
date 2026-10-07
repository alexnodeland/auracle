// The launch film. Every scene is pinned to the narration's cues in
// timeline.json (tools/timeline.py), so a new voice take re-times the film
// without anyone editing seconds here.
//
// It is drawn, and the drawing is the instrument's own: EVOLVE, PERFORM and
// PATCH are drawn where the app puts every part at 1920 × 1080, in its type
// and colours, with the sounds' own faces (kit.js `appScreen` and the views).
// Three beats cross from the drawing into the real app, recorded on the same
// window and camera (shots.json, tools/footage.mjs): play (Bright turned,
// Wander gliding the knobs), offer (Blend and Take) and depth (PATCH's
// cutoff turned from PERFORM). Each take logs what the app showed (its faces,
// its controls and knobs, its bank), and the drawing before each insert is
// drawn from those logs, so the cut lands on the same picture.
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
  const beat = (id) => stage.tl.beats.find((b) => b.id === id);
  const line = (id) => stage.line(id);
  const ctx = { stage, beat, line, takes };
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

/** The sound as a take showed it in PERFORM: its controls' lines and the
 *  knobs under the hood, over Slow Weather's measured defaults. */
function soundOf(take) {
  const s = { ...SLOW_WEATHER, controls: SLOW_WEATHER.controls.map((c) => ({ ...c })), hood: SLOW_WEATHER.hood.map((h) => [...h]) };
  const subs = take?.logs?.controls;
  if (subs) {
    for (const part of subs.split(" | ")) {
      const m = /^(\w+): (.*?)( \(search\))?$/.exec(part);
      const c = m && s.controls.find((x) => x.name === m[1]);
      if (c) c.sub = m[2];
    }
  }
  const hood = take?.logs?.hood;
  if (hood) {
    for (const part of hood.split(" | ")) {
      const h = s.hood.find(([mod, p]) => part.startsWith(`${mod} ${p}`));
      if (h) h[2] = part.slice(`${h[0]} ${h[1]}`.length).trim();
    }
  }
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
// OPEN — a sound, then the wall of knobs it is hidden in.

function wall(g, { cols = 8, rows = 5, margin = 34, gap = 16, seed = 3, center = [3, 2] }) {
  const r = rng(seed);
  const pw = (1920 - 2 * margin - (cols - 1) * gap) / cols;
  const ph = (1080 - 2 * margin - (rows - 1) * gap) / rows;
  const names = ["supersaw", "filter", "vca", "lfo", "env / out", "mixer", "delay", "reverb", "fold", "s&h", "slew", "noise", "ladder", "chorus", "phaser", "drive", "steps", "crush", "ring", "grain"];
  const knobs = [];
  let screen = null;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = margin + i * (pw + gap);
      const y = margin + j * (ph + gap);
      const pg = el("g", {}, g);
      el("rect", { x, y, width: pw, height: ph, rx: 8, fill: ink("--plate-hi"), stroke: ink("--hairline"), "stroke-width": 1.2 }, pg);
      el("rect", { x: x + 1, y: y + 1, width: pw - 2, height: 22, rx: 7, fill: inkA("--white", 0.035) }, pg);
      say(pg, x + 16, y + 30, names[Math.floor(r() * names.length)], { size: 15, weight: 500, fill: ink("--silk-dim") });
      const isCenter = i === center[0] && j === center[1];
      if (isCenter) {
        screen = { x: x + 14, y: y + 44, w: pw - 28, h: ph - 58 };
        el("rect", { x: screen.x, y: screen.y, width: screen.w, height: screen.h, rx: 5, fill: ink("--bezel"), stroke: ink("--black"), "stroke-width": 1 }, pg);
        continue;
      }
      // Six small knobs, 3×2, and a jack row.
      for (let kj = 0; kj < 2; kj++) {
        for (let ki = 0; ki < 3; ki++) {
          const cx = x + (pw * (ki + 1)) / 4;
          const cy = y + 70 + kj * 58;
          const k = knob(pg, { cx, cy, r: 15, glow: false, dim: true });
          const v = 0.1 + r() * 0.8;
          k.set(v, { lit: 0.55 });
          knobs.push({ k, v, cx, cy });
        }
      }
      for (let q = 0; q < 4; q++) {
        const jx = x + (pw * (q + 1)) / 5;
        el("circle", { cx: jx, cy: y + ph - 22, r: 6.5, fill: ink("--bezel"), stroke: ink("--phos-a-deep"), "stroke-width": 1.6 }, pg);
        el("circle", { cx: jx, cy: y + ph - 22, r: 2.5, fill: "none", stroke: inkA("--white", 0.18) }, pg);
      }
    }
  }
  return { knobs, screen };
}

function sceneOpen({ stage, beat, line }) {
  const b = beat("open");
  const l1 = line("open1");
  const l2 = line("open2");
  stage.scene({
    id: "open",
    t0: b.t0,
    t1: b.t1,
    post: 1.0,
    fout: 1.0,
    build(layer) {
      const svg = svgLayer(layer);
      const world = el("g", {}, svg);
      const { knobs, screen } = wall(world, {});
      // Screen-space overlay: the trace keeps a constant line width however far
      // the camera is pulled back.
      const top = svgLayer(layer);
      const trace = scope(top, { x: 0, y: 0, w: 1920, h: 1080, width: 4, points: 520, wave: voiceWave({ f: 2.2, bright: 0.45, seed: 5 }) });
      const ptr = pointer(top);

      // The two voice lines.
      const shade = place(el("div", {}, layer), { x: 0, y: 0, w: 1920, h: 1080 });
      shade.style.background = `linear-gradient(180deg, ${inkA("--bezel", 0)} 45%, ${inkA("--bezel", 0.85)} 100%)`;
      const t1 = textBlock(layer, { x: 960, y: 230, w: 1600, cls: "voice", size: 84, align: "center", ax: 0.5, ay: 0.5 });
      const w1 = words(t1, "Every synthesizer has a sound in it\nthat's *yours*.");
      const t2 = textBlock(layer, { x: 960, y: 900, w: 1700, cls: "voice", size: 64, align: "center", ax: 0.5, ay: 0.5 });
      const w2 = words(t2, "Finding it means turning hundreds of knobs, *one at a time*.");
      const counter = textBlock(layer, { x: 1860, y: 1030, w: 600, cls: "mono", size: 22, align: "right", ax: 1, ay: 1 });

      // Camera: starts inside the centre plate's screen, pulls back to the wall.
      const sc = { cx: screen.x + screen.w / 2, cy: screen.y + screen.h / 2 };
      // Inside the scope: the screen overfills the frame, so no bezel shows.
      const z0 = Math.max(1920 / screen.w, 1080 / screen.h) * 1.04;
      const pull0 = l2.t0 - b.t0 - 0.35;
      const pull1 = pull0 + 3.2;

      // The knobs the hand turns, one after another.
      const hand = [knobs[27], knobs[33], knobs[70]];

      return (tl) => {
        const u = ramp(tl, pull0, pull1, E.io4);
        const s = Math.exp(lerp(Math.log(z0), 0, u));
        const fx = lerp(sc.cx, 960, u);
        const fy = lerp(sc.cy, 540, u);
        world.setAttribute("transform", `translate(960 540) scale(${s}) translate(${-fx} ${-fy})`);
        world.style.opacity = 0.35 + 0.65 * u;
        // Where the centre screen sits on the frame now.
        const sx = 960 + s * (screen.x - fx);
        const sy = 540 + s * (screen.y - fy);
        const sw = s * screen.w;
        const sh = s * screen.h;
        const draw = ramp(tl, 0.3, 2.2, E.io2);
        const amp = 0.55 + 0.1 * Math.sin(tl * 1.3);
        trace.path.setAttribute("stroke-width", lerp(4, 2, u));
        trace.update(tl, { draw, amp, ox: tl * 0.35, rect: { x: sx + sw * 0.04, y: sy + sh * 0.1, w: sw * 0.92, h: sh * 0.8 } });

        // Line one: over the trace, then gone before the pull-back.
        t1.style.opacity = fade(tl, l1.t0 - b.t0 - 0.3, l1.t0 - b.t0 + 0.2, pull0 - 0.6, pull0 + 0.2);
        reveal(w1, tl + b.t0, l1.t0, l1.t1);
        // Line two: over the wall.
        shade.style.opacity = ramp(tl, pull0 + 0.8, pull1);
        t2.style.opacity = ramp(tl, l2.t0 - b.t0 - 0.2, l2.t0 - b.t0 + 0.3);
        reveal(w2, tl + b.t0, l2.t0, l2.t1);

        // The hand, turning knobs one at a time once the wall is in view.
        const h0 = pull1 - 0.6;
        const seg = 1.05;
        let lit = -1;
        const path = [[h0 - 0.8, 1500, 1150]];
        hand.forEach((k, i) => {
          path.push([h0 + i * seg, k.cx + 6, k.cy + 10]);
          path.push([h0 + i * seg + 0.7, k.cx + 6, k.cy + 10]);
        });
        const p = glide(tl, path);
        const idx = Math.floor((tl - h0) / seg);
        for (let i = 0; i < hand.length; i++) {
          const k = hand[i];
          const turning = ramp(tl, h0 + i * seg + 0.05, h0 + i * seg + 0.7, E.io2);
          if (tl >= h0 + i * seg) lit = i;
          const on = tl >= h0 + i * seg;
          k.k.set(k.v + 0.22 * turning * (i % 2 ? -1 : 1), { lit: on ? 1 : 0.55, glowOn: on });
        }
        ptr.update({ x: p.x, y: p.y, o: ramp(tl, h0 - 0.8, h0 - 0.3), click: idx >= 0 && idx < hand.length ? (tl - h0 - idx * seg) / 0.5 : null, scale: 1.1 });
        counter.textContent = lit >= 0 ? `knob ${String(lit + 1).padStart(3, " ")} of ${knobs.length}` : "";
        counter.style.opacity = ramp(tl, h0, h0 + 0.3);
      };
    },
  });
}

// ---------------------------------------------------------------------------
// TITLE — a posterior contracting onto one taste is the mark.

function sceneTitle({ stage, beat, line }) {
  const b = beat("title");
  const l = line("title1");
  stage.scene({
    id: "title",
    t0: b.t0,
    t1: b.t1,
    pre: 0.8,
    post: 0.6,
    fout: 0.6,
    build(layer) {
      const svg = svgLayer(layer);
      const R = rng(11);
      const N = 420;
      const cloudG = el("g", {}, svg);
      cloudG.style.filter = GLOW.b;
      const parts = [];
      for (let i = 0; i < N; i++) {
        const ang = R() * Math.PI * 2;
        const rad = 180 + Math.pow(R(), 0.6) * 900;
        parts.push({
          a0: ang,
          r0: rad,
          spin: (R() - 0.5) * 1.6,
          s: 1 + R() * 2.6,
          d: R() * 0.35,
          c: el("circle", { r: 2, fill: ink("--phos-b") }, cloudG),
        });
      }
      const M = { cx: 960, cy: 470, size: 300 };
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
        const c0 = -0.8;
        const c1 = 1.9;
        const u = ramp(tl, c0, c1, E.io3);
        for (const p of parts) {
          const uu = clamp((u - p.d) / (1 - p.d));
          const e = E.io3(uu);
          const r = lerp(p.r0, 0, e);
          const a = p.a0 + p.spin * (1 - e) * 2 + e * 1.2;
          p.c.setAttribute("cx", M.cx + r * Math.cos(a));
          p.c.setAttribute("cy", M.cy + r * Math.sin(a) * 0.82);
          p.c.setAttribute("r", (p.s * (1 - 0.6 * e)).toFixed(2));
          p.c.setAttribute("opacity", (fade(tl, c0, c0 + 0.6) * (1 - ramp(uu, 0.82, 1, E.lin))).toFixed(3));
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
        // A slow push-in over the whole scene.
        layer.style.transform = `scale(${lerp(1.0, 1.035, ramp(tl, 0, b.t1 - b.t0, E.lin))})`;
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
// PLAY — PERFORM drawn, then the app itself: Bright turned, Wander gliding.

/** The app's window, drawn and recorded: a drawn screen and, when the take
 *  is in, its footage in the same window under the same camera. */
function appWindow(layer, take, opts) {
  const scr = appScreen(layer, { ...F, radius: 3, ...opts });
  const clip = take && take.frames ? footage(layer, { frames: take.frames, ...F, radius: 14 }) : null;
  if (clip) clip.wrap.style.opacity = 0;
  return { scr, clip };
}

function scenePlay({ stage, beat, line, takes }) {
  const b = beat("play");
  const take = takes["l-play"];
  const ck = take ? takeClock(stage, take) : null;
  const [l1, l2, l3] = ["play1", "play2", "play3"].map(line);
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
      const { scr, clip } = appWindow(layer, take, { level: "perform", taught: Number(ch.taught || 0), bankRows: ch.bank || null, tabs: ch.tabs || null });
      const V = performView(scr, { sound: soundOf(take), faceA: take?.logs?.face || null });
      const { svg, over } = stack(layer);
      const ptr = pointer(svg);
      const cap = captions(over, stage, ["play1", "play2", "play3"], b.t1 + 0.4);
      // The cut into the app: once the chord is down and the line is said.
      const x0 = l1.t1 + 0.1;
      const x1 = x0 + 0.6;
      const tTurn = at(stage, b, "play2:Turn");
      const tLet = at(stage, b, "play3:Let");
      const bright = ck?.mark("bright") || [V.knobs[0].cx, V.knobs[0].cy];
      const wander = ck?.mark("wander") || [V.wander.cx, V.wander.cy];
      const cam = camera([
        [b.t0 - 0.4, 1.0, 960, 540],
        [x1, 1.0, 960, 540],
        [tTurn - 0.2, 1.5, 1300, 560],
        [tLet - 0.3, 1.5, 1300, 560],
        [tLet + 0.5, 1.45, 1300, 700],
        [b.t1 + 1, 1.45, 1300, 700],
      ]);
      const chord = new Set([60, 64, 67]);
      return (tl, t) => {
        const c = cam(t);
        scr.cam(...c);
        // Drawn: the chord on the keys under the first line.
        const down = t >= at(stage, b, "play1:Then") - 0.3;
        scr.keys.update(down ? chord : new Set());
        V.scope.update(t, { amp: down ? 0.5 : 0.05, ox: t * 0.3 });
        if (clip) {
          const u = ramp(t, x0, x1, E.io2);
          clip.wrap.style.opacity = u;
          scr.wrap.style.opacity = 1 - ramp(t, x1, x1 + 0.1);
          if (u > 0) stage.wait(clip.seek(ck.clipTime(t), { z: c[0], fx: c[1], fy: c[2] }));
        }
        // The hand: Bright up 70 px over 1.6 s, then Wander up 95 px.
        const [bx, by] = bright;
        const [wx, wy] = wander;
        const pts = [
          [tTurn - 0.9, 1700, 1000],
          [tTurn, bx, by],
          [tTurn + 1.6, bx, by - 70],
          [tTurn + 2.0, bx, by - 70],
          [tLet, wx, wy],
          [tLet + 0.7, wx, wy - 95],
          [tLet + 1.4, wx + 120, wy - 60],
        ];
        const p = glide(t, pts);
        const [px, py] = onFrame(c, p.x, p.y);
        const held = (t >= tTurn && t < tTurn + 1.6) || (t >= tLet && t < tLet + 0.7);
        ptr.update({ x: px, y: py, o: fade(t, tTurn - 0.9, tTurn - 0.5, tLet + 1.0, tLet + 1.5), click: held ? 0.1 : null, scale: 1.1 });
        cap(t);
        void tl;
        void l2;
        void l3;
      };
    },
  });
}

// ---------------------------------------------------------------------------
// OFFER — Offer grows B from the sound in hand; then the app: Blend, Take.

function sceneOffer({ stage, beat, line, takes }) {
  const b = beat("offer");
  const take = takes["l-offer"];
  const ck = take ? takeClock(stage, take) : null;
  const [o1, o2] = ["offer1", "offer2"].map(line);
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
      const { scr, clip } = appWindow(layer, take, { level: "perform", taught: Number(ch.taught || 0), bankRows: ch.bank || null, tabs: ch.tabs || null });
      const V = performView(scr, { sound: soundOf(take), faceA: take?.logs?.face || null, faceB: take?.logs?.["face b"] || null });
      const { svg, over } = stack(layer);
      const growing = say(scr.svg, 863.3, 566, "growing an offer…", { size: TYPE.value, mono: true, anchor: "middle", fill: ink("--phos-b") });
      const ptr = pointer(svg);
      const cap = captions(over, stage, ["offer1", "offer2"], b.t1 + 0.4);
      const tPress = at(stage, b, "offer1:Press");
      const tGrows = at(stage, b, "offer1:grows");
      // The app's own wait, as the take timed it (its cut keeps the last 0.8 s).
      const ready = take?.meta?.stamps?.ready != null ? ck.filmAt(take.meta.stamps.ready) : tGrows + 0.8;
      const tBlend = at(stage, b, "offer2:Blend");
      const tTake = at(stage, b, "offer2:Take");
      const x0 = o2.t0 - 0.7;
      const x1 = o2.t0 - 0.1;
      const offerPad = ck?.mark("offer") || V.pads.offer.pos;
      const takePad = ck?.mark("take") || V.pads.take.pos;
      const cam = camera([
        [b.t0 - 0.6, 1.0, 960, 540],
        [tPress - 0.3, 1.28, 1100, 640],
        [x1, 1.28, 1100, 640],
        [tBlend + 0.2, 1.32, 1080, 760],
        [b.t1 + 1, 1.32, 1080, 760],
      ]);
      const chord = new Set([60, 64, 67]);
      return (tl, t) => {
        const c = cam(t);
        scr.cam(...c);
        scr.keys.update(chord);
        V.scope.update(t, { amp: 0.5, ox: t * 0.3 });
        // Drawn: Offer pressed, "growing an offer…", then B.
        V.pads.offer.set({ down: fade(t, tPress, tPress + 0.08, tPress + 0.25, tPress + 0.45) });
        V.moved(t >= tPress + 0.2);
        growing.setAttribute("opacity", fade(t, tPress + 0.2, tPress + 0.4, ready - 0.2, ready));
        V.offered(ramp(t, ready - 0.1, ready + 0.6, E.lin));
        V.blend(0);
        if (clip) {
          const u = ramp(t, x0, x1, E.io2);
          clip.wrap.style.opacity = u;
          scr.wrap.style.opacity = 1 - ramp(t, x1, x1 + 0.1);
          if (u > 0) stage.wait(clip.seek(ck.clipTime(t), { z: c[0], fx: c[1], fy: c[2] }));
        }
        // The hand: Offer, then Blend from home toward B, then Take.
        const bl = ck?.meta?.rects?.blend;
        const bx0 = bl ? bl.x + bl.w / 2 - 140 : 545;
        const by = bl ? bl.y + bl.h / 2 : 948;
        const pts = [
          [tPress - 0.9, 1700, 1050],
          [tPress, ...offerPad],
          [tPress + 0.6, ...offerPad],
          [tBlend - 0.2, bx0, by],
          [tBlend, bx0, by],
          [tBlend + 0.8, bx0 + 175, by],
          [tTake, ...takePad],
          [tTake + 1.2, takePad[0] + 80, takePad[1] + 120],
        ];
        const p = glide(t, pts);
        const [px, py] = onFrame(c, p.x, p.y);
        const ckAt = [tPress, tTake].find((x) => t >= x && t < x + 0.5);
        const held = t >= tBlend && t < tBlend + 0.8;
        ptr.update({ x: px, y: py, o: fade(t, tPress - 0.9, tPress - 0.5, tTake + 0.8, tTake + 1.2), click: ckAt != null ? (t - ckAt) / 0.5 : held ? 0.1 : null, scale: 1.1 });
        cap(t);
        void tl;
        void o1;
      };
    },
  });
}

// ---------------------------------------------------------------------------
// DEPTH — the sound in PATCH, its cutoff turned from PERFORM; then the model
// that bets on every choice and keeps score.

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
      const { scr, clip } = appWindow(layer, take, { level: "patch", taught: Number(ch.taught || 0), bankRows: ch.bank || null, tabs: ch.tabs || null });
      const V = patchView(scr, { faceSrc: take?.logs?.face || null });
      const { under, svg, over } = stack(layer);
      const tEvery = at(stage, b, "depth1:Every");
      const tWatch = at(stage, b, "depth1:watch");
      const x0 = tEvery - 0.6;
      const x1 = tEvery;
      // Where the cutoff knob is: the filter plate's first knob.
      const fp = V.plates[1].knobs[0];
      const cam = camera([
        [b.t0 - 0.6, 1.0, 960, 540],
        [x0, 1.12, 1000, 560],
        [tWatch - 0.6, 1.9, 760, 520],
        [l2.t0 - 0.5, 1.9, 760, 520],
      ]);
      const tag = callout(over, svg, { x: 0, y: 0, tx: 0, ty: 0, text: "◂ Bright, in PERFORM", color: "b" });
      const cap1 = captions(over, stage, ["depth1"], l2.t0 - 0.2);
      // The model: its bet before you answer, and its forecasts kept in public
      // (LEARNING's ITS FORECASTS).
      const fc = el("div", { class: "layer" }, over);
      const fsvg = svgLayer(fc);
      const panel = (x, y, w, h, title) => {
        const d = place(el("div", {}, under), { x, y, w, h });
        Object.assign(d.style, { border: `1px solid ${ink("--hairline")}`, borderRadius: "var(--r2)", background: ink("--panel"), boxShadow: `0 30px 80px ${inkA("--black", 0.6)}` });
        say(fsvg, x + 24, y + 42, title, { size: 21, track: 0.18, fill: ink("--silk-dim") });
        return d;
      };
      const pA = panel(150, 250, 720, 470, "EVOLVE · before you pick");
      const pB = panel(950, 250, 820, 470, "LEARNING · its forecasts");
      // The bet: the pair's two faces, and the model leaning to one of them.
      const fA = face(fc, { x: 210, y: 300, w: 220, h: 300, name: PAIRS[1][0], kind: "evolve" });
      const fB = face(fc, { x: 590, y: 300, w: 220, h: 300, name: PAIRS[1][1], kind: "evolve" });
      say(fsvg, 320, 640, PAIRS[1][0], { size: 24, caps: false, anchor: "middle" });
      say(fsvg, 700, 640, PAIRS[1][1], { size: 24, caps: false, anchor: "middle" });
      el("rect", { x: 210, y: 670, width: 600, height: 8, rx: 4, fill: ink("--gauge-track") }, fsvg);
      const bet = el("rect", { x: 510, y: 670, width: 0, height: 8, rx: 4, fill: ink("--phos-b") }, fsvg);
      bet.style.filter = GLOW.b;
      el("line", { x1: 510, y1: 662, x2: 510, y2: 686, stroke: ink("--silk-dim"), "stroke-width": 2 }, fsvg);
      const betT = say(fsvg, 810, 706, "it bets", { size: 22, mono: true, anchor: "end", fill: ink("--phos-b") });
      // The forecasts against what you picked: on the line is honest.
      const rx0 = 1010;
      const ry0 = 300;
      const rw = 700;
      const rh = 330;
      el("line", { x1: rx0, y1: ry0 + rh, x2: rx0 + rw, y2: ry0 + rh, stroke: ink("--hairline"), "stroke-width": 2 }, fsvg);
      const diag = el("line", { x1: rx0, y1: ry0 + rh, x2: rx0 + rw, y2: ry0, stroke: ink("--phos-b-deep"), "stroke-width": 2, "stroke-dasharray": "6 8" }, fsvg);
      [["0%", 0], ["50%", 0.5], ["100% for the one picked", 1]].forEach(([s, u]) => say(fsvg, rx0 + u * rw, ry0 + rh + 34, s, { size: 20, mono: true, anchor: u === 0 ? "start" : u === 1 ? "end" : "middle", fill: ink("--silk-dim") }));
      // Drawn for the film: the shape a fitted model's forecasts take, not a session's.
      const pts = [[0.14, 0.2, 7], [0.3, 0.26, 9], [0.47, 0.52, 13], [0.62, 0.57, 10], [0.78, 0.83, 8], [0.9, 0.86, 6]];
      const dots = pts.map(([fx, fy, r]) => {
        const c = el("circle", { cx: rx0 + fx * rw, cy: ry0 + rh - fy * rh, r, fill: ink("--phos-b"), opacity: 0 }, fsvg);
        c.style.filter = GLOW.b;
        return c;
      });
      say(fsvg, rx0 + rw, ry0 + 6, "an illustration", { size: 18, mono: true, anchor: "end", fill: ink("--silk-mute") });
      const cap2 = captions(over, stage, ["depth2"], b.t1 + 0.5);
      return (tl, t) => {
        const c = cam(t);
        scr.cam(...c);
        scr.keys.update(t >= l1.t0 && t < l2.t0 ? new Set([48, 55, 60, 64]) : new Set());
        if (clip && ramp(t, x0, x1, E.io2) > 0) stage.wait(clip.seek(ck.clipTime(t), { z: c[0], fx: c[1], fy: c[2] }));
        // The window gives way to the model at the second line.
        const away = ramp(t, l2.t0 - 0.5, l2.t0 + 0.2, E.io2);
        for (const w of [scr.wrap, clip?.wrap].filter(Boolean)) {
          w.style.transform = `scale(${lerp(1, 0.94, away)})`;
          w.style.filter = away > 0 ? `blur(${(6 * away).toFixed(1)}px)` : "none";
        }
        const winO = 1 - 0.85 * away;
        const inClip = clip ? ramp(t, x0, x1, E.io2) : 0;
        scr.wrap.style.opacity = (clip ? 1 - ramp(t, x1, x1 + 0.1) : 1) * winO;
        if (clip) clip.wrap.style.opacity = inClip * winO;
        // PERFORM's hand on the cutoff, named.
        const [kx, ky] = onFrame(c, fp.cx, fp.cy);
        tag.move(kx + 22 * c[0], ky - 6, kx + 120, ky - 120);
        tag.update(ramp(t, tWatch - 0.2, tWatch + 0.6, E.io2) * (1 - ramp(t, l2.t0 - 0.6, l2.t0 - 0.2)));
        // The model.
        const fin = ramp(t, l2.t0 - 0.1, l2.t0 + 0.5);
        fc.style.opacity = fin * (1 - ramp(t, b.t1 + 0.2, b.t1 + 0.6));
        for (const p of [pA, pB]) p.style.opacity = fc.style.opacity;
        const g = ramp(t, l2.t0 + 0.6, l2.t0 + 1.8, E.io3);
        bet.setAttribute("width", (230 * g).toFixed(1));
        betT.textContent = g > 0.5 ? `it bets on ${PAIRS[1][1]}` : "it bets";
        fA.wrap.style.opacity = 0.5;
        fB.wrap.style.opacity = 0.6 + 0.4 * g;
        diag.setAttribute("opacity", ramp(t, l2.t0 + 2.2, l2.t0 + 2.7));
        dots.forEach((d, i) => {
          const u = ramp(t, l2.t0 + 2.6 + i * 0.3, l2.t0 + 3.0 + i * 0.3, E.outBack);
          d.setAttribute("opacity", clamp(u));
          d.setAttribute("r", pts[i][2] * clamp(u, 0, 1.3));
        });
        cap1(t);
        cap2(t);
        void tl;
      };
    },
  });
}

// ---------------------------------------------------------------------------
// CLOSE — every note in this film; free, open, in the browser.

const BANK = ["Slow Weather", "Cathedral", "Morph Pad", "Long Room", "Tidal", "Rotor", "Wobble Board", "Solo Flight", "Held Under", "Ceiling", "Dub Echo", "Choirboy"].filter((n) => PRESETS.includes(n));

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
