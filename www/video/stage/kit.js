// The illustration kit: the instrument's parts, drawn as the films need them.
//
// Every piece takes the time from its scene and draws itself; none keeps its
// own clock. Colours are the two phosphors and nothing else: green (`a`) is
// sound, amber (`b`) is the model's mind. The parts are drawn as the app
// draws them (apps/web: style.css, perform.js, main.js's rack), so a film's
// drawing and the instrument read as one; a sound's face is drawn by the
// app's own renderer (apps/web/vessel.js).

import { el, place, clamp, lerp, ramp, E, rng, noise1 } from "./stage.js";
import { decodeFace, bankStats } from "../../../apps/web/faces.js";
import { drawVessel } from "../../../apps/web/vessel.js";

// Every colour is a token of the stage's (stage.css, generated from
// www/brand/tokens.json), read once per name: an SVG attribute cannot use a
// custom property, and a film drawn in literals drifts from the product it
// shows. `make dev-check` fails on a colour written in the kit or a film.
const TOKENS = new Map();
/** A token's value: `ink("--phos-a")` is "#8ef0b1". */
export function ink(name) {
  let v = TOKENS.get(name);
  if (v === undefined) {
    v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (!v) throw new Error(`no colour token ${name} in stage.css`);
    TOKENS.set(name, v);
  }
  return v;
}
/** A token at an opacity, as rgba(): `inkA("--phos-a", 0.5)`. */
export function inkA(name, a) {
  const h = ink(name);
  // Only an opaque #rrggbb token has an opacity to set; say so for anything else.
  if (!/^#[0-9a-f]{6}$/i.test(h)) throw new Error(`inkA(${name}): needs a #rrggbb token, got "${h}"`);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export const PHOS = { a: ink("--phos-a"), b: ink("--phos-b") };
export const PHOS_DIM = { a: ink("--phos-a-dim"), b: ink("--phos-b-dim") };
export const PHOS_DEEP = { a: ink("--phos-a-deep"), b: ink("--phos-b-deep") };
const GLOW = {
  a: `drop-shadow(0 0 2.5px ${inkA("--phos-a", 0.95)}) drop-shadow(0 0 12px ${inkA("--phos-a", 0.38)})`,
  b: `drop-shadow(0 0 2.5px ${inkA("--phos-b", 0.95)}) drop-shadow(0 0 14px ${inkA("--phos-b", 0.42)})`,
};
// The app's own glow: a knob's arc while it moves, a mod lead (style.css).
const GLOW_SOFT = {
  a: `drop-shadow(0 0 3px ${inkA("--phos-a", 0.55)})`,
  b: `drop-shadow(0 0 3px ${inkA("--phos-b", 0.55)})`,
};

// An SVG id for a gradient or a clip, once in the document: a film draws the
// same part in several scenes, and an id seen twice resolves to the first,
// which a hidden scene does not paint.
let UID = 0;
const uid = (p) => `${p}-${++UID}`;

/** A full-frame SVG in a layer. */
export function svgLayer(layer) {
  return el("svg", { class: "full", viewBox: "0 0 1920 1080", width: 1920, height: 1080 }, layer);
}

// ---- waveforms ------------------------------------------------------------

/**
 * A synthetic but musical waveform: a band-limited saw through a moving
 * lowpass, with a little chorus. `bright` (0–1) sets how many harmonics speak.
 * Used where a film shows "a sound" rather than a particular recording.
 */
export function voiceWave({ f = 3, bright = 0.5, detune = 0.012, seed = 1 } = {}) {
  const r = rng(seed);
  const ph = Array.from({ length: 24 }, () => r() * Math.PI * 2);
  return (x, t) => {
    const n = Math.max(1, Math.round(2 + bright * 16));
    let y = 0;
    let norm = 0;
    for (let k = 1; k <= n; k++) {
      const roll = Math.exp(-(k - 1) / (1.5 + bright * 9));
      const a = roll / k;
      y += a * Math.sin(2 * Math.PI * k * f * x + ph[k % 24] + t * 0.8 * k);
      y += 0.6 * a * Math.sin(2 * Math.PI * k * f * (1 + detune) * x + ph[(k + 7) % 24] - t * 0.5 * k);
      norm += 1.6 * a;
    }
    return y / norm;
  };
}

/** A scope trace: a phosphor line drawn from a waveform function or samples. */
export function scope(parent, { x, y, w, h, color = "a", width = 3, points = 360, wave, glow = true }) {
  const g = el("g", {}, parent);
  if (glow) g.style.filter = GLOW[color];
  const path = el(
    "path",
    { fill: "none", stroke: PHOS[color], "stroke-width": width, "stroke-linejoin": "round", "stroke-linecap": "round" },
    g,
  );
  const head = el("circle", { r: width * 1.6, fill: ink("--white"), opacity: 0 }, g);
  let fn = wave || voiceWave();
  const api = {
    g,
    path,
    set wave(f) {
      fn = f;
    },
    /**
     * Draw at time t. `draw` in [0,1] sweeps the beam left to right (the head
     * glows at the front); `amp` scales the trace; `samples` overrides the
     * function with a real recording's window.
     */
    update(t, { draw = 1, amp = 1, samples = null, ox = 0, rect = null } = {}) {
      if (rect) ({ x, y, w, h } = rect);
      const n = samples ? samples.length : points;
      const upto = Math.max(1, Math.floor(n * clamp(draw)));
      let d = "";
      for (let i = 0; i < upto; i++) {
        const u = i / (n - 1);
        const v = samples ? samples[i] : fn(u + ox, t);
        const px = x + u * w;
        const py = y + h / 2 - (v * amp * h) / 2;
        d += (i ? "L" : "M") + px.toFixed(1) + " " + py.toFixed(1);
      }
      path.setAttribute("d", d);
      if (draw < 1 && draw > 0) {
        const u = (upto - 1) / (n - 1);
        const v = samples ? samples[upto - 1] : fn(u + ox, t);
        head.setAttribute("cx", x + u * w);
        head.setAttribute("cy", y + h / 2 - (v * amp * h) / 2);
        head.setAttribute("opacity", 0.9);
      } else head.setAttribute("opacity", 0);
    },
  };
  return api;
}

// ---- a knob ---------------------------------------------------------------

/**
 * A knob as the instrument draws one (apps/web: PERFORM's `.pf-knob`, the
 * rack's knobs): its travel as a ring in silk, a phosphor arc for its value,
 * a flat graphite body with a contact shadow, and a silk pointer. The ring
 * sits at 44/34 of the body, the pointer runs from 12/34 to 30/34 of it, as
 * perform.js draws them. `value` in [0,1] over a 270° sweep; `bipolar`
 * draws the arc from twelve o'clock (a named control's turn either way).
 *
 * A label is set in silk caps under it (`label`), with the app's two quiet
 * lines under a named control when given: its ends (`ends`, "dark · bright")
 * and the knobs it moves (`sub`). `search` draws PERFORM's search control:
 * the ring dashed and the name in amber. `where` (a value) puts PERFORM's
 * amber dot on the ring.
 */
export function knob(parent, { cx, cy, r = 38, label = null, color = "a", labelSize = 16, glow = true, dim = false, bipolar = false, ends = null, sub = null, search = false, where = null, ring = true, ringColor = null }) {
  const g = el("g", {}, parent);
  const s = r / 34;
  const R = 44 * s;
  const a0 = (-225 * Math.PI) / 180;
  const sweep = (270 * Math.PI) / 180;
  const at = (u) => a0 + sweep * clamp(u);
  const arcPath = (u0, u1, rr) => {
    const [lo, hi] = u0 <= u1 ? [u0, u1] : [u1, u0];
    if (hi - lo < 1e-3) return "";
    const p0 = [cx + rr * Math.cos(at(lo)), cy + rr * Math.sin(at(lo))];
    const p1 = [cx + rr * Math.cos(at(hi)), cy + rr * Math.sin(at(hi))];
    const large = (hi - lo) * 270 > 180 ? 1 : 0;
    return `M${p0[0].toFixed(2)} ${p0[1].toFixed(2)}A${rr} ${rr} 0 ${large} 1 ${p1[0].toFixed(2)} ${p1[1].toFixed(2)}`;
  };
  const travel = el("path", {
    d: arcPath(0, 1, R), fill: "none",
    stroke: search ? PHOS_DEEP.b : ringColor ? ink(ringColor) : ink("--silk-mute"),
    "stroke-width": search ? Math.max(1.5, 2.2 * s) : Math.max(1.5, 3 * s),
    "stroke-dasharray": search ? `${1.2 * s} ${4.5 * s}` : null,
    "stroke-linecap": "round",
    opacity: ring ? (dim ? 0.55 : 1) : 0,
  }, g);
  const arcG = el("g", {}, g);
  const arc = el("path", { fill: "none", stroke: dim ? PHOS_DEEP[color] : PHOS[color], "stroke-width": Math.max(2, 3.5 * s), "stroke-linecap": "round" }, arcG);
  const ghostArc = el("path", { fill: "none", stroke: PHOS.b, "stroke-width": Math.max(2, 2.6 * s), "stroke-linecap": "round", opacity: 0 }, g);
  const dot = el("circle", { r: Math.max(2, 3.2 * s), fill: PHOS.b, opacity: 0 }, g);
  const body = el("circle", { cx, cy, r, fill: ink("--knob-body"), stroke: ink("--black"), "stroke-width": 1 }, g);
  body.style.filter = `drop-shadow(0 ${(2 * s).toFixed(1)}px ${(3 * s).toFixed(1)}px ${inkA("--black", 0.6)})`;
  const ptr = el("line", { x1: cx, y1: cy - 12 * s, x2: cx, y2: cy - 30 * s, stroke: ink("--silk"), "stroke-width": Math.max(1.4, 3 * s), "stroke-linecap": "round" }, g);
  let text = null;
  let lines = [];
  if (label) {
    const ty = cy + r + 36;
    text = el("text", {
      x: cx, y: ty, "text-anchor": "middle", fill: search ? PHOS.b : ink("--silk"),
      "font-family": "Jost", "font-weight": 600, "font-size": labelSize, "letter-spacing": "0.18em",
    }, g, label.toUpperCase());
    const small = labelSize * 0.86;
    lines = [ends && [ends, ink("--silk-dim")], sub && [sub, search ? PHOS_DIM.b : PHOS_DIM.a]].filter(Boolean).map(([t, fill], i) =>
      el("text", { x: cx, y: ty + small * 1.5 * (i + 1), "text-anchor": "middle", fill, "font-family": "IBM Plex Mono", "font-size": small }, g, t),
    );
  }
  const api = {
    g,
    text,
    lines,
    set(value, { lit = 1, ghost = null, col = color, glowOn = null, where: w = where } = {}) {
      arc.setAttribute("d", bipolar ? arcPath(0.5, value, R) : arcPath(0, value, R));
      const bright = glowOn == null ? !dim : glowOn;
      arc.setAttribute("stroke", bright ? PHOS[col] : PHOS_DEEP[col]);
      arcG.style.filter = bright && (glowOn || (glow && glowOn == null)) ? GLOW_SOFT[col] : "none";
      arcG.style.opacity = lit;
      ptr.setAttribute("transform", `rotate(${-135 + 270 * clamp(value)} ${cx} ${cy})`);
      if (ghost != null) {
        ghostArc.setAttribute("d", bipolar ? arcPath(0.5, ghost, R + 6 * s) : arcPath(0, ghost, R + 6 * s));
        ghostArc.setAttribute("opacity", 0.9);
      } else ghostArc.setAttribute("opacity", 0);
      if (w != null) {
        dot.setAttribute("cx", cx + R * Math.cos(at(w)));
        dot.setAttribute("cy", cy + R * Math.sin(at(w)));
        dot.setAttribute("opacity", 1);
      } else dot.setAttribute("opacity", 0);
    },
    /** A label's words, changed (a sub line that says what a turn moved). */
    sub(t) {
      if (lines[lines.length - 1]) lines[lines.length - 1].textContent = t;
    },
  };
  api.set(bipolar ? 0.5 : 0);
  return api;
}

// ---- cables ---------------------------------------------------------------

/**
 * A patch cable from p0 to p1 with gravity sag, as the rack draws one: a
 * translucent black casing under the lead, the lead in the sound's green
 * (amber and dashed for a modulation, `color: "b"`), and a jack at each end;
 * `draw` plugs it in progressively.
 */
export function cable(parent, { p0, p1, sag = 80, color = "a", width = 5 }) {
  const g = el("g", {}, parent);
  g.style.filter = `drop-shadow(1px 3px 3px ${inkA("--black", 0.55)})`;
  const d = () => {
    const mx = (p0[0] + p1[0]) / 2;
    const my = Math.max(p0[1], p1[1]) + sag;
    return `M${p0[0]} ${p0[1]} C${lerp(p0[0], mx, 0.6)} ${my} ${lerp(p1[0], mx, 0.6)} ${my} ${p1[0]} ${p1[1]}`;
  };
  const casing = el("path", { d: d(), fill: "none", stroke: inkA("--black", 0.5), "stroke-width": width * 2.4, "stroke-linecap": "round" }, g);
  const glowG = el("g", {}, g);
  if (color === "b") glowG.style.filter = GLOW_SOFT.b;
  const line = el("path", { d: d(), fill: "none", stroke: color === "b" ? inkA("--phos-b", 0.85) : inkA("--phos-a", 0.82), "stroke-width": width, "stroke-linecap": "round" }, glowG);
  const pulse = el("path", { d: d(), fill: "none", stroke: ink("--phos-a-pulse"), "stroke-width": width * 0.5, "stroke-linecap": "round", opacity: 0 }, glowG);
  const len = line.getTotalLength();
  casing.setAttribute("stroke-dasharray", `${len} ${len}`);
  line.setAttribute("stroke-dasharray", color === "b" ? `${width * 2.6} ${width * 1.8}` : `${len} ${len}`);
  pulse.setAttribute("stroke-dasharray", `26 ${len}`);
  const jacks = [p0, p1].map((p) => {
    const j = el("g", {}, g);
    el("circle", { cx: p[0], cy: p[1], r: width + 3.5, fill: ink("--bezel"), stroke: PHOS_DEEP[color], "stroke-width": 2 }, j);
    el("circle", { cx: p[0], cy: p[1], r: width * 0.7, fill: "none", stroke: inkA("--white", 0.18), "stroke-width": 1 }, j);
    return j;
  });
  return {
    g,
    update(t, { draw = 1, flow = 0, opacity = 1 } = {}) {
      const off = len * (1 - clamp(draw));
      casing.setAttribute("stroke-dashoffset", off);
      if (color === "b") line.style.opacity = draw >= 1 ? 1 : clamp(draw * 1.5);
      else line.setAttribute("stroke-dashoffset", off);
      g.style.opacity = opacity;
      jacks[1].style.opacity = draw >= 1 ? 1 : 0;
      if (flow > 0 && draw >= 1 && color !== "b") {
        pulse.setAttribute("opacity", 0.85 * flow);
        pulse.setAttribute("stroke-dashoffset", -((t * 420) % (len + 26)) + 26);
      } else pulse.setAttribute("opacity", 0);
    },
  };
}

// ---- a module plate -------------------------------------------------------

/**
 * A module as it sits in PATCH's rack: a graphite plate lit from the top
 * left, its name in silk caps at the top, what kind it is in mono at the
 * right, a row of knobs with each one's readout and name under it, and a
 * jack on each side at the knobs' height. A modulator's plate is dashed amber
 * and its knobs are amber (`color: "b"`). `labels` and `values` name the
 * knobs as the rack does ("cutoff", "632 Hz"). Returns jack positions for
 * cables.
 */
export function plate(layer, svg, { x, y, w = 250, h = 190, name, kind = "", knobs = 2, color = "a", seed = 1, labels = null, values = null }) {
  const div = place(el("div", { class: "plate" }, layer), { x, y, w, h });
  const mod = color === "b";
  Object.assign(div.style, {
    background: `linear-gradient(180deg, ${ink("--plate-hi")}, ${ink("--plate-lo")})`,
    border: mod ? `1.5px dashed ${ink("--phos-b-deep")}` : `1px solid ${ink("--hairline")}`,
    borderRadius: "var(--r2)",
    boxShadow: `inset 0 1px 0 ${inkA("--white", 0.09)}, 0 1px 2px ${inkA("--black", 0.8)}, 0 5px 14px ${inkA("--black", 0.35)}`,
  });
  const fs = Math.max(14, Math.min(26, h * 0.12));
  const title = el("div", { class: "silk" }, div, name);
  Object.assign(title.style, {
    position: "absolute", left: "var(--s4)", top: "var(--s3)", fontSize: "var(--t-frame-3)", fontWeight: 600,
    letterSpacing: "0.18em", textTransform: "uppercase", color: mod ? ink("--phos-b") : ink("--silk"),
  });
  if (kind) {
    const k = el("div", { class: "mono" }, div, kind);
    Object.assign(k.style, { position: "absolute", right: "var(--s4)", top: "var(--s3)", fontSize: "var(--t-frame-2)", color: ink("--silk-dim") });
  }
  const r = rng(seed);
  const ks = [];
  const kr = Math.min(26, w / (knobs * 3.4), h * 0.15);
  const ky = y + h * 0.5;
  for (let i = 0; i < knobs; i++) {
    const cx = x + (w * (i + 1)) / (knobs + 1);
    const k = knob(svg, { cx, cy: ky, r: kr, color, glow: false });
    const v0 = 0.2 + r() * 0.6;
    k.set(v0);
    const lbl = [];
    if (values) lbl.push(el("text", { x: cx, y: ky + kr * 1.29 + fs * 1.05, "text-anchor": "middle", fill: ink("--silk"), "font-family": "IBM Plex Mono", "font-size": fs * 0.92 }, svg, values[i] ?? ""));
    if (labels) lbl.push(el("text", { x: cx, y: ky + kr * 1.29 + fs * (values ? 2.05 : 1.05), "text-anchor": "middle", fill: ink("--silk-dim"), "font-family": "IBM Plex Mono", "font-size": fs * 0.84 }, svg, labels[i] ?? ""));
    ks.push({ k, v0, cx, cy: ky, lbl });
  }
  const jack = (px) => {
    const j = el("g", {}, svg);
    el("circle", { cx: px, cy: ky, r: 8, fill: ink("--bezel"), stroke: mod ? PHOS_DEEP.b : PHOS_DEEP.a, "stroke-width": 2 }, j);
    el("circle", { cx: px, cy: ky, r: 3.5, fill: "none", stroke: inkA("--white", 0.18), "stroke-width": 1 }, j);
    return j;
  };
  const jacks = [jack(x), jack(x + w)];
  return {
    div,
    knobs: ks,
    jacks,
    in: [x, ky],
    out: [x + w, ky],
    set opacity(o) {
      div.style.opacity = o;
      for (const { k, lbl } of ks) {
        k.g.style.opacity = o;
        for (const t of lbl) t.style.opacity = o;
      }
      for (const j of jacks) j.style.opacity = o;
    },
  };
}

// ---- the mark -------------------------------------------------------------

/**
 * The mark (www/brand/mark.svg) drawn at any size, with each ring animatable:
 * read inward it is a posterior contracting onto one taste.
 */
export function mark(parent, { cx, cy, size = 320 }) {
  const s = size / 32;
  const g = el("g", {}, parent);
  const tile = el("rect", { x: cx - 16 * s, y: cy - 16 * s, width: 32 * s, height: 32 * s, rx: 7 * s, fill: ink("--rack") }, g);
  const outer = el("circle", { cx, cy, r: 12 * s, fill: "none", stroke: ink("--phos-a-deep"), "stroke-width": 2.2 * s }, g);
  const innerG = el("g", {}, g);
  innerG.style.filter = GLOW.a;
  const inner = el("circle", { cx, cy, r: 7.4 * s, fill: "none", stroke: ink("--phos-a"), "stroke-width": 2.6 * s }, innerG);
  const coreG = el("g", {}, g);
  coreG.style.filter = GLOW.b;
  const core = el("circle", { cx, cy, r: 3 * s, fill: ink("--phos-b") }, coreG);
  const circ = (r) => 2 * Math.PI * r;
  const lenO = circ(12 * s);
  const lenI = circ(7.4 * s);
  outer.setAttribute("stroke-dasharray", `${lenO} ${lenO}`);
  inner.setAttribute("stroke-dasharray", `${lenI} ${lenI}`);
  outer.setAttribute("transform", `rotate(-90 ${cx} ${cy})`);
  inner.setAttribute("transform", `rotate(-90 ${cx} ${cy})`);
  return {
    g,
    /** tile 0–1, outer/inner ring draw 0–1, core 0–1 (scale), glow multiplier */
    update({ tile: tu = 1, outer: ou = 1, inner: iu = 1, core: cu = 1 } = {}) {
      tile.setAttribute("opacity", tu);
      outer.setAttribute("stroke-dashoffset", lenO * (1 - ou));
      inner.setAttribute("stroke-dashoffset", lenI * (1 - iu));
      core.setAttribute("r", 3 * s * cu);
    },
  };
}

// ---- the pointer ----------------------------------------------------------

/** A mouse pointer with a click ripple, for showing a hand at work. */
export function pointer(parent) {
  const g = el("g", {}, parent);
  const ripple = el("circle", { r: 10, fill: "none", stroke: ink("--silk"), "stroke-width": 2, opacity: 0 }, g);
  const arrow = el(
    "path",
    {
      d: "M0 0 L0 30 L8 23 L13.5 35 L18 33 L12.8 21.5 L23 21.5 Z",
      fill: ink("--cursor"),
      stroke: ink("--rack"),
      "stroke-width": 2,
      "stroke-linejoin": "round",
    },
    g,
  );
  arrow.style.filter = `drop-shadow(0 3px 6px ${inkA("--black", 0.6)})`;
  return {
    g,
    /** position, opacity, and click phase (0..1 over the ripple; null for none) */
    update({ x, y, o = 1, click = null, scale = 1.25 }) {
      g.style.opacity = o;
      arrow.setAttribute("transform", `translate(${x} ${y}) scale(${scale * (click != null && click < 0.25 ? 0.9 : 1)})`);
      if (click != null && click >= 0 && click <= 1) {
        ripple.setAttribute("cx", x);
        ripple.setAttribute("cy", y);
        ripple.setAttribute("r", 8 + 34 * E.out3(click));
        ripple.setAttribute("opacity", 0.8 * (1 - click));
      } else ripple.setAttribute("opacity", 0);
    },
  };
}

/** Path helper: pointer position along a list of [t, x, y] waypoints. */
export function glide(t, pts) {
  if (t <= pts[0][0]) return { x: pts[0][1], y: pts[0][2] };
  for (let i = 1; i < pts.length; i++) {
    if (t <= pts[i][0]) {
      const u = ramp(t, pts[i - 1][0], pts[i][0], E.io3);
      return { x: lerp(pts[i - 1][1], pts[i][1], u), y: lerp(pts[i - 1][2], pts[i][2], u) };
    }
  }
  const l = pts[pts.length - 1];
  return { x: l[1], y: l[2] };
}

// ---- a keyboard -----------------------------------------------------------

/**
 * A keybed as the instrument's (apps/web `.piano`): bone keys under a green
 * felt strip, each C named with its octave, black keys grouped as a real
 * keybed groups them, and a held key lit green. `lit` is a set of MIDI notes.
 */
export function keyboard(parent, { x, y, w = 900, h = 170, low = 48, octaves = 2, names = true }) {
  const g = el("g", {}, parent);
  const whites = [];
  const blacks = [];
  const pattern = [0, 2, 4, 5, 7, 9, 11];
  // Where a black key sits over the white key on its left, as style.css's
  // `.bkey.pcN` sets it (C#/D# converge, F#/G#/A# spread).
  const bkLeft = { 1: 0.64, 3: 0.74, 6: 0.6, 8: 0.69, 10: 0.78 };
  const nW = octaves * 7 + 1;
  const kw = w / nW;
  const rr = Math.min(4, kw * 0.08);
  const gid = uid("kb");
  const defs = el("defs", {}, g);
  const grad = (id, stops) => {
    const lg = el("linearGradient", { id, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    for (const [o, c, a = 1] of stops) el("stop", { offset: o, "stop-color": ink(c), "stop-opacity": a }, lg);
  };
  grad(`${gid}w`, [[0, "--silk"], [0.88, "--silk"], [1, "--silk-dim"]]);
  grad(`${gid}d`, [[0, "--phos-a"], [1, "--phos-a-dim"]]);
  grad(`${gid}b`, [[0, "--btn-hi"], [0.9, "--rack"]]);
  grad(`${gid}bd`, [[0, "--phos-a-dim"], [0.9, "--phos-a-deep"]]);
  el("rect", { x, y, width: w, height: h, fill: ink("--black") }, g);
  for (let i = 0; i < nW; i++) {
    const oct = Math.floor(i / 7);
    const note = low + oct * 12 + pattern[i % 7];
    const r = el("path", { d: rounded(x + i * kw, y, kw - 1, h, 0, rr), fill: `url(#${gid}w)` }, g);
    el("line", { x1: x + (i + 1) * kw - 0.5, y1: y, x2: x + (i + 1) * kw - 0.5, y2: y + h, stroke: ink("--silk-mute"), "stroke-width": 1 }, g);
    let lbl = null;
    if (names && note % 12 === 0) {
      lbl = el("text", { x: x + i * kw + kw / 2, y: y + h - Math.max(5, h * 0.09), "text-anchor": "middle", fill: ink("--slot"), "font-family": "IBM Plex Mono", "font-weight": 600, "font-size": Math.max(9, Math.min(16, kw * 0.22)) }, g, `C${Math.floor(note / 12) - 1}`);
    }
    whites.push({ note, r, lbl });
  }
  for (let i = 0; i < nW - 1; i++) {
    const deg = i % 7;
    if (deg === 2 || deg === 6) continue;
    const oct = Math.floor(i / 7);
    const pc = pattern[deg] + 1;
    const note = low + oct * 12 + pc;
    const bw = kw * 0.55;
    const bx = x + i * kw + kw * bkLeft[pc];
    const r = el("path", { d: rounded(bx, y, bw, h * 0.58, 0, rr * 0.8), fill: `url(#${gid}b)`, stroke: ink("--black"), "stroke-width": 1 }, g);
    r.style.filter = `drop-shadow(0 3px 4px ${inkA("--black", 0.6)})`;
    blacks.push({ note, r });
  }
  // The felt strip above the keys.
  const felt = el("rect", { x, y, width: w, height: Math.max(2, h * 0.05), fill: `url(#${gid}bd)` }, g);
  felt.setAttribute("fill", ink("--phos-a-deep"));
  return {
    g,
    update(lit = new Set()) {
      for (const { note, r } of whites) r.setAttribute("fill", lit.has(note) ? `url(#${gid}d)` : `url(#${gid}w)`);
      for (const { note, r } of blacks) r.setAttribute("fill", lit.has(note) ? `url(#${gid}bd)` : `url(#${gid}b)`);
    },
  };
}

/** A rectangle's path with its top corners at `rt` and its bottom at `rb`. */
function rounded(x, y, w, h, rt, rb) {
  return `M${x + rt} ${y}H${x + w - rt}Q${x + w} ${y} ${x + w} ${y + rt}V${y + h - rb}Q${x + w} ${y + h} ${x + w - rb} ${y + h}H${x + rb}Q${x} ${y + h} ${x} ${y + h - rb}V${y + rt}Q${x} ${y} ${x + rt} ${y}Z`;
}

// ---- a text block -----------------------------------------------------------

/** An absolutely placed HTML text block. */
export function textBlock(layer, { x, y, w = 1400, cls = "display", size = 72, align = "left", ax = 0, ay = 0, html = null, text = null }) {
  const d = place(el("div", { class: cls }, layer), { x, y, w, ax, ay });
  d.style.fontSize = `${size}px`;
  d.style.textAlign = align;
  if (html != null) d.innerHTML = html;
  else if (text != null) d.textContent = text;
  return d;
}

// ---- footage ------------------------------------------------------------------

/**
 * A recorded clip of the real app, in a window frame. Seeking is exact: the
 * stage waits for `seeked` (a video) or `decode()` (a frame) before the frame
 * is captured.
 *
 * `frames` ({base, fps, n, runs}, from footage.mjs's ID.frames.json) shows the
 * screencast's own JPEGs, one per paint, instead of a video: no encode after
 * each shot, and a seek is one small image decode instead of a VP9 seek.
 * `runs` is [[file, count]…] over the clip's constant-rate frames.
 */
export function footage(layer, { src, frames = null, x, y, w, h, radius = 14, chrome = true }) {
  if (frames) return footageFrames(layer, { frames, x, y, w, h, radius });
  const { wrap, inner } = footageWrap(layer, { x, y, w, h, radius });
  const v =el("video", { src, muted: "", playsinline: "", preload: "auto" }, inner);
  v.muted = true;
  Object.assign(v.style, { width: "100%", height: "100%", objectFit: "cover", display: "block" });
  const ready = new Promise((res) => {
    if (v.readyState >= 2) res();
    else v.addEventListener("loadeddata", () => res(), { once: true });
  });
  return {
    wrap,
    inner,
    video: v,
    ready,
    /** Show clip time `ct` (s); zoom `z` about (fx, fy) in [0,1] of the frame. */
    async seek(ct, { z = 1, fx = 0.5, fy = 0.5 } = {}) {
      await ready;
      // Aim a hair past the frame's start, so rounding never shows the one before.
      const tt = clamp(ct + 0.002, 0, (v.duration || 1e9) - 0.001);
      if (Math.abs(v.currentTime - tt) > 1e-4) {
        await new Promise((res) => {
          v.addEventListener("seeked", () => res(), { once: true });
          v.currentTime = tt;
        });
      }
      inner.style.transform = `translate(${(-fx * (z - 1) * w).toFixed(2)}px, ${(-fy * (z - 1) * h).toFixed(2)}px) scale(${z})`;
    },
  };
}

function footageWrap(layer, { x, y, w, h, radius }) {
  const wrap = place(el("div", {}, layer), { x, y, w, h });
  Object.assign(wrap.style, {
    borderRadius: `${radius}px`,
    overflow: "hidden",
    background: ink("--bezel"),
    boxShadow: `0 0 0 1px ${ink("--hairline")}, 0 40px 90px ${inkA("--black", 0.7)}, 0 0 60px ${inkA("--phos-a", 0.06)}`,
  });
  const inner = el("div", {}, wrap);
  Object.assign(inner.style, { position: "absolute", inset: "0", transformOrigin: "0 0" });
  return { wrap, inner };
}

function footageFrames(layer, { frames, x, y, w, h, radius }) {
  const { wrap, inner } = footageWrap(layer, { x, y, w, h, radius });
  const img = el("img", { alt: "", decoding: "sync" }, inner);
  Object.assign(img.style, { width: "100%", height: "100%", objectFit: "cover", display: "block" });
  // Constant-rate frame i → the paint it shows.
  const file = new Int32Array(frames.n);
  let i = 0;
  for (const [k, c] of frames.runs) for (let j = 0; j < c && i < frames.n; j++) file[i++] = k;
  let shown = -1;
  return {
    wrap,
    inner,
    video: null,
    ready: Promise.resolve(),
    async seek(ct, { z = 1, fx = 0.5, fy = 0.5 } = {}) {
      // A hair past the frame's start, as the video path aims, so the two
      // paths show the same frame for the same clip time.
      const k = file[clamp(Math.floor((ct + 0.002) * frames.fps), 0, frames.n - 1)];
      if (k !== shown) {
        shown = k;
        img.src = `${frames.base}/${String(k).padStart(5, "0")}.jpg`;
        await img.decode().catch(() => {});
      }
      inner.style.transform = `translate(${(-fx * (z - 1) * w).toFixed(2)}px, ${(-fy * (z - 1) * h).toFixed(2)}px) scale(${z})`;
    },
  };
}

/** A callout: a pill label with a leader to a point, drawn on. */
export function callout(layer, svg, { x, y, tx, ty, text, color = "a" }) {
  const line = el("path", { d: `M${x} ${y} L${tx} ${ty}`, stroke: PHOS[color], "stroke-width": 2, fill: "none" }, svg);
  const dot = el("circle", { cx: x, cy: y, r: 6, fill: PHOS[color] }, svg);
  dot.style.filter = GLOW[color];
  let len = Math.hypot(tx - x, ty - y);
  line.setAttribute("stroke-dasharray", `${len} ${len}`);
  const pill = place(el("div", { class: `pill ${color}` }, layer, text), { x: tx, y: ty, ax: tx < x ? 1 : 0, ay: 0.5 });
  let u0 = 0;
  const api = {
    update(u) {
      u0 = u;
      line.setAttribute("stroke-dashoffset", len * (1 - clamp(u * 1.6)));
      dot.setAttribute("opacity", clamp(u * 4));
      pill.style.opacity = clamp((u - 0.35) * 2.5);
      pill.style.transform = `translateY(${(1 - clamp((u - 0.35) * 2.5)) * 8}px)`;
    },
    /** Re-aim: the point and the label move (a camera move over footage). */
    move(x2, y2, tx2, ty2) {
      line.setAttribute("d", `M${x2} ${y2} L${tx2} ${ty2}`);
      dot.setAttribute("cx", x2);
      dot.setAttribute("cy", y2);
      len = Math.hypot(tx2 - x2, ty2 - y2);
      line.setAttribute("stroke-dasharray", `${len} ${len}`);
      place(pill, { x: tx2, y: ty2, ax: tx2 < x2 ? 1 : 0, ay: 0.5 });
      api.update(u0);
    },
  };
  return api;
}

export { GLOW, GLOW_SOFT, noise1 };
// ---- the instrument, drawn at its own geometry ------------------------------
//
// The app as a film draws it: the menu bar, the bank, the levels' cross, the
// keybed, and PERFORM, EVOLVE and PATCH, each part where the app puts it at
// 1920 × 1080 and in its own type, so a drawn frame and a recording of the
// app line up and read as one instrument. The places were measured from the
// app (apps/web at 1920 × 1080, a seeded session holding Slow Weather;
// www/video/films/launch/measure_app.mjs prints them); type sizes are the
// app's own tokens (--t-label … --t-display), read from stage.css.
//
// An app screen is a window onto that 1920 × 1080 page, at any size, with
// the same camera as `footage()`: zoom `z` about (fx, fy) of the window. A
// recording of the app in the same window under the same camera covers the
// drawing exactly, so a film can cross from one to the other.

/** The app's type sizes (stage.css, from www/brand/tokens.json), in px. */
const sizeOf = (name) => {
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  if (!Number.isFinite(v)) throw new Error(`no size token ${name} in stage.css`);
  return v;
};
export const TYPE = { label: sizeOf("--t-label"), value: sizeOf("--t-value"), body: sizeOf("--t-body"), voice: sizeOf("--t-voice"), title: sizeOf("--t-title"), display: sizeOf("--t-display") };

/**
 * Text as the app sets it, in an SVG: silk caps (Jost 600, tracked) by
 * default; `mono` for IBM Plex Mono values; `caps: false` for a name or a
 * sentence in Jost.
 */
export function say(parent, x, y, text, { size = TYPE.label, fill = null, mono = false, caps = !mono, weight = null, track = null, anchor = "start", opacity = null } = {}) {
  return el("text", {
    x, y, "text-anchor": anchor, fill: fill || ink(caps ? "--silk" : mono ? "--silk-dim" : "--silk"),
    "font-family": mono ? "IBM Plex Mono" : "Jost",
    "font-weight": weight ?? (caps ? 600 : 400),
    "font-size": size,
    "letter-spacing": track != null ? `${track}em` : caps ? "0.18em" : null,
    opacity,
  }, parent, caps ? String(text).toUpperCase() : text);
}

/** A rounded rectangle in an SVG. */
function box(parent, x, y, w, h, r, attrs = {}) {
  return el("rect", { x, y, width: w, height: h, rx: r, ...attrs }, parent);
}

// ---- faces ------------------------------------------------------------------

// The presets' faces the app ships (apps/web/preset-faces.json, rendered
// natively by `make preset-faces`), drawn by the app's own renderer
// (apps/web/vessel.js) against the presets' mean and spread: the app draws
// them against the session's bank, which a film has no session to read, so
// the vessel's widths can differ a little from a recording's. A recording's
// own face, logged from the page (`.pf-face .face`), is drawn as it is.
let SHIPPED = null;
{
  // A film without the faces would draw empty wells and rows: stop instead.
  const r = await fetch(new URL("../../../apps/web/preset-faces.json", import.meta.url));
  if (!r.ok) throw new Error(`kit: no apps/web/preset-faces.json (${r.status}); run \`make preset-faces\``);
  {
    const file = await r.json();
    const byName = new Map();
    for (const p of file.presets || []) {
      const raw = atob(p.face || "");
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      const f = decodeFace(bytes);
      if (f) byName.set(p.name, f);
    }
    SHIPPED = { byName, names: [...byName.keys()], stats: bankStats([...byName.values()]) };
    if (!SHIPPED.stats) throw new Error("kit: apps/web/preset-faces.json holds too few faces to draw against");
  }
}
/** The presets the app ships, in the bank's order. */
export const PRESETS = SHIPPED ? SHIPPED.names : [];

// How the app draws a face of each kind (main.js FACE_SIZE and FACE_OPTS):
// the picture's size, and for a large one the vessel standing on a floor at
// 79% of it with its glow and reflection.
const FACE_KIND = {
  well: { pic: [240, 480], scale: 1, glow: 18, line: 2 },
  wellb: { pic: [200, 480], scale: 0.62, glow: 12, line: 1.6, color: "b" },
  evolve: { pic: [240, 480], scale: 1, glow: 18, line: 2 },
  out: { pic: [150, 250], scale: 1, glow: 14, line: 1.8 },
  row: { pic: [26, 34] },
  inhand: { pic: [20, 30] },
};
function wellBox(w, h, scale = 1) {
  const bh = h * 0.74 * scale;
  const bw = Math.min(w * 0.9, bh * 0.6);
  return { x: (w - bw) / 2, y: h * 0.79 - bh, w: bw, h: bh };
}

/**
 * A sound's face in a slot, fitted whole and centred as the app shows one
 * (`object-fit: contain`): a preset's by `name`, or a picture the app drew
 * (`src`, a data URL logged from the page). `show()` changes it.
 */
export function face(parent, { x, y, w, h, name = null, src = null, kind = "well", density = 2 }) {
  const K = FACE_KIND[kind];
  const [pw, ph] = K.pic;
  const k = Math.min(w / pw, h / ph);
  const cw = pw * k;
  const chh = ph * k;
  const wrap = place(el("div", {}, parent), { x: x + (w - cw) / 2, y: y + (h - chh) / 2, w: cw, h: chh });
  const c = el("canvas", { width: Math.round(cw * density), height: Math.round(chh * density) }, wrap);
  Object.assign(c.style, { width: "100%", height: "100%", display: "block" });
  const img = el("img", { alt: "", decoding: "sync" }, wrap);
  Object.assign(img.style, { position: "absolute", inset: "0", width: "100%", height: "100%", display: "none" });
  const api = {
    wrap,
    name: null,
    ready: Promise.resolve(),
    show(n, picture = null) {
      api.name = n;
      const ctx = c.getContext("2d");
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, c.width, c.height);
      if (picture) {
        img.src = picture;
        img.style.display = "block";
        c.style.display = "none";
        api.ready = img.decode().catch(() => {});
        return api;
      }
      img.style.display = "none";
      c.style.display = "block";
      const f = SHIPPED && n ? SHIPPED.byName.get(n) : null;
      if (!f || !SHIPPED.stats) return api;
      const s = k * density;
      ctx.setTransform(s, 0, 0, s, 0, 0);
      const color = ink(K.color === "b" ? "--phos-b" : "--phos-a");
      if (K.glow) drawVessel(ctx, f, SHIPPED.stats, { box: wellBox(pw, ph, K.scale), color, glow: K.glow * s, reflection: true, line: K.line });
      else {
        const pad = Math.min(pw, ph) * 0.06;
        drawVessel(ctx, f, SHIPPED.stats, { box: { x: pad, y: pad, w: pw - 2 * pad, h: ph - 2 * pad }, color, slices: ph >= 20 });
      }
      return api;
    },
  };
  return api.show(name, src);
}

// ---- the app's screen and its chrome -----------------------------------------

// The levels, out to in, as the cross at the stage's right edge stacks them
// (index.html's `.rail`), with their icons and what each one is.
const LEVELS = {
  learning: { y: 410, d: "M7 18v-6 M12 18V6 M17 18v-8.5", what: "how it learns your taste" },
  taste: { y: 476, d: "M3 19h18 M3 16c4.5 0 4.5-11 9-11s4.5 11 9 11", what: "the sound among all sounds" },
  evolve: { y: 545, x: 1826, s: 34, d: "M4.5 18.8 12 5.2l7.5 13.6 M8 13.5h8", what: "what it could become" },
  perform: { y: 542, d: "M12 13l3.6-4.2 M12 3.2v1.6", circle: [12, 13, 7], what: "the sound, under your hands" },
  patch: { y: 608, d: "M6.5 11.9c0 8 11 8 11 0", circles: [[6.5, 9, 2.9], [17.5, 9, 2.9]], what: "what the sound is made of" },
};

// The bank as the seeded session shows it with Slow Weather opened from
// PRESETS: the list scrolled to the sound in hand, each row a face and a name.
const BANK_ROWS = [
  ["Coin Toss"], ["Gut String"], ["Ghost Bell"], ["Choirboy"], ["Twelve String"],
  ["PAD", 11], ["Cathedral"], ["Glass Pad"], ["Detune Dream"], ["Ember"], ["Slow Weather"], ["Morph Pad"], ["Sweep Machine"], ["Sea Change"], ["Pump Room"], ["Tidal"],
  ["TEXTURE", 13], ["Noise Wash"], ["Dub Echo"], ["Static Ocean"], ["Rotor"],
];

/**
 * The app's page, drawn: a window of `w × h` frame px at (x, y) onto the
 * 1920 × 1080 page, with the menu bar, the bank, the levels' cross and the
 * keybed (`chrome: false` leaves them out). Its layers (`under` for HTML,
 * `svg`, `over`) are in the page's px. `cam(z, fx, fy)` frames it as
 * `footage().seek` frames a recording.
 */
export function appScreen(layer, { x = 0, y = 0, w = 1920, h = 1080, radius = 0, level = "perform", inHand = "Slow Weather", taught = 0, chrome = true, frame = true, bankRows = null, tabs = null } = {}) {
  const wrap = place(el("div", {}, layer), { x, y, w, h });
  wrap.style.overflow = "hidden";
  if (frame) {
    Object.assign(wrap.style, {
      borderRadius: radius ? `var(--r${radius})` : "0",
      background: ink("--rack"),
      boxShadow: `0 0 0 1px ${ink("--hairline")}, 0 40px 90px ${inkA("--black", 0.7)}, 0 0 60px ${inkA("--phos-a", 0.06)}`,
    });
  }
  const inner = el("div", {}, wrap);
  Object.assign(inner.style, { position: "absolute", inset: "0", transformOrigin: "0 0" });
  const root = el("div", {}, inner);
  Object.assign(root.style, { position: "absolute", left: "0", top: "0", width: "1920px", height: "1080px", transformOrigin: "0 0", transform: `scale(${w / 1920})`, background: ink("--rack") });
  const under = el("div", { class: "layer" }, root);
  const svg = el("svg", { viewBox: "0 0 1920 1080", width: 1920, height: 1080 }, root);
  Object.assign(svg.style, { position: "absolute", inset: "0", overflow: "visible" });
  const over = el("div", { class: "layer" }, root);
  const api = { wrap, inner, root, under, svg, over, w, h, level };
  api.cam = (z = 1, fx = 0.5, fy = 0.5) => {
    inner.style.transform = `translate(${(-fx * (z - 1) * w).toFixed(2)}px, ${(-fy * (z - 1) * h).toFixed(2)}px) scale(${z})`;
  };
  if (!chrome) return api;

  // The menu bar: the wordmark and its lamp, where you are, the sound in hand
  // with ▶, TAUGHT, MODEL and ⌘K.
  const bar = el("g", {}, svg);
  el("line", { x1: 0, y1: 55.5, x2: 1920, y2: 55.5, stroke: ink("--hairline"), "stroke-width": 1 }, bar);
  say(bar, 24, 33, "Auracle", { size: 17, weight: 500, track: 0.42 });
  el("circle", { cx: 146, cy: 27.5, r: 3, fill: ink("--phos-b-dim") }, bar);
  el("line", { x1: 181.5, y1: 16, x2: 181.5, y2: 39, stroke: ink("--hairline") }, bar);
  const whereN = say(bar, 206, 31, level, { size: TYPE.label, track: 0.16 });
  const whereD = say(bar, 280, 31, LEVELS[level].what, { size: TYPE.value, caps: false, fill: ink("--silk-dim") });
  box(bar, 1265.4, 8.5, 165.3, 38, 19, { fill: ink("--panel"), stroke: ink("--hairline") });
  const handFace = face(over, { x: 1272, y: 12.5, w: 20, h: 30, name: inHand, kind: "inhand" });
  const handName = say(bar, 1298, 32.5, inHand, { size: TYPE.body, caps: false, weight: 500 });
  el("path", { d: "M1401 21 v13 l10.5 -6.5z", fill: ink("--phos-a") }, bar);
  say(bar, 1454.7, 32, "Taught", { size: TYPE.label, fill: ink("--silk-dim"), track: 0.16 });
  const taughtN = say(bar, 1521, 32.5, String(taught), { size: TYPE.value, mono: true, fill: ink("--phos-b") });
  box(bar, 1554.5, 12.5, 123, 30, 15, { fill: "none", stroke: ink("--hairline") });
  el("circle", { cx: 1571, cy: 27.5, r: 3, fill: ink("--amber-off"), stroke: ink("--phos-b-deep") }, bar);
  say(bar, 1582, 31.5, "Model", { size: TYPE.label, track: 0.16, fill: ink("--silk-dim") });
  box(bar, 1640, 19, 28, 17, 3, { fill: "none", stroke: ink("--hairline") });
  say(bar, 1654, 31.5, "ALT", { size: TYPE.label, mono: true, anchor: "middle", fill: ink("--silk-dim") });
  box(bar, 1701.5, 10.5, 202.5, 34, 6, { fill: ink("--panel"), stroke: ink("--hairline") });
  el("circle", { cx: 1722, cy: 27, r: 4.6, fill: "none", stroke: ink("--silk-dim"), "stroke-width": 1.4 }, bar);
  el("line", { x1: 1725.5, y1: 30.5, x2: 1729, y2: 34, stroke: ink("--silk-dim"), "stroke-width": 1.4, "stroke-linecap": "round" }, bar);
  say(bar, 1737, 32, "Find or do anything", { size: TYPE.value, caps: false, fill: ink("--silk-dim") });
  box(bar, 1846, 18, 50, 18, 3, { fill: "none", stroke: ink("--hairline") });
  say(bar, 1871, 31.5, "Ctrl K", { size: TYPE.label, mono: true, anchor: "middle", fill: ink("--silk-dim") });

  // The bank: three tabs, Find a sound, and its rows.
  const bank = el("g", {}, svg);
  el("rect", { x: 0, y: 56, width: 280, height: 948, fill: ink("--recess-hi") }, bank);
  el("line", { x1: 280.5, y1: 56, x2: 280.5, y2: 1004, stroke: ink("--hairline") }, bank);
  const tabN = (i, n) => (tabs && tabs[i] && tabs[i][1] != null ? String(tabs[i][1]) : n);
  [["Pool", tabN(0, "40"), 16, 70], ["Saved", tabN(1, "0"), 99, 161], ["Presets", tabN(2, "62"), 182, 247]].forEach(([t, n, bx, nx], i) => {
    if (i === 2) box(bank, bx, 72, 81, 28, 4, { fill: ink("--panel-hi") });
    say(bank, bx + 13, 90.5, t, { size: TYPE.label, track: 0.14, fill: ink(i === 2 ? "--silk" : "--silk-dim") });
    say(bank, nx, 90.5, n, { size: TYPE.label, mono: true, fill: ink("--silk-dim") });
  });
  box(bank, 16, 112, 219, 32, 4, { fill: ink("--bezel"), stroke: ink("--hairline") });
  el("circle", { cx: 32, cy: 127, r: 4.6, fill: "none", stroke: ink("--silk-dim"), "stroke-width": 1.4 }, bank);
  el("line", { x1: 35.5, y1: 130.5, x2: 39, y2: 134, stroke: ink("--silk-dim"), "stroke-width": 1.4, "stroke-linecap": "round" }, bank);
  say(bank, 47, 133, "Find a sound", { size: TYPE.body, caps: false, fill: ink("--silk-dim") });
  el("circle", { cx: 253, cy: 128, r: 9, fill: ink("--panel"), stroke: ink("--hairline") }, bank);
  say(bank, 253, 132, "?", { size: TYPE.label, mono: true, anchor: "middle", fill: ink("--silk-dim") });
  // The rows a recording showed (`bank`: [y, "row" | "group" | "live",
  // name, word]), lit where the recording lit one, or the seeded session's
  // list scrolled to Slow Weather.
  const rows = bankRows
    ? bankRows.map(([yy, kind, n, extra]) => ({ y: yy, n, count: kind === "group" ? extra ?? "" : null, live: kind === "live", word: kind === "group" ? null : extra }))
    : (() => {
        let yy = 149;
        return BANK_ROWS.map(([n, count]) => ({ y: (yy += 41) - 41, n, count: count ?? null, live: n === inHand }));
      })();
  // The list scrolls under its head: rows are cut at the find row.
  const clipId = uid("bank");
  const cp = el("clipPath", { id: clipId }, el("defs", {}, bank));
  el("rect", { x: 0, y: 147, width: 280, height: 857 }, cp);
  const list = el("g", { "clip-path": `url(#${clipId})` }, bank);
  for (const { y: ry, n, count, live: isLive, word } of rows) {
    if (count != null) {
      say(list, 16, ry + 32, n, { size: TYPE.label, track: 0.16, fill: ink("--silk-dim") });
      say(list, 263, ry + 32, String(count), { size: TYPE.label, mono: true, anchor: "end", fill: ink("--silk-dim") });
      continue;
    }
    const live = isLive;
    if (live) {
      box(list, 8, ry, 263, 40, 4, { fill: ink("--panel-hi") });
      el("rect", { x: 8, y: ry, width: 2, height: 40, fill: ink("--phos-a") }, list);
    }
    if (word && /in pool/i.test(word)) say(list, 266, ry + 25, "in pool", { size: TYPE.label, track: 0.12, anchor: "end", fill: ink("--phos-a-dim") });
    else if (!bankRows && live) say(list, 266, ry + 25, "in pool", { size: TYPE.label, track: 0.12, anchor: "end", fill: ink("--phos-a-dim") });
    if (ry >= 146) face(over, { x: 18, y: ry + 3, w: 26, h: 34, name: n, kind: "row" });
    say(list, 56, ry + 25, n, { size: TYPE.body, caps: false, weight: 500 });
  }

  // The levels' cross at the stage's right edge: out to in, the current stop lit.
  const rail = el("g", {}, svg);
  say(rail, 1890, 403, "out", { size: TYPE.label, mono: true, anchor: "middle", fill: ink("--silk-dim") });
  say(rail, 1893, 663, "in", { size: TYPE.label, mono: true, anchor: "middle", fill: ink("--silk-dim") });
  for (const y0 of [450, 516, 582]) el("line", { x1: 1892, y1: y0, x2: 1892, y2: y0 + 26, stroke: ink("--hairline") }, rail);
  el("line", { x1: 1860, y1: 562, x2: 1872, y2: 562, stroke: ink("--hairline") }, rail);
  const stops = {};
  for (const [lv, L] of Object.entries(LEVELS)) {
    const s = L.s || 40;
    const cx = (L.x ?? 1872) + s / 2;
    const cy = L.y + s / 2;
    const g = el("g", {}, rail);
    const halo = el("circle", { cx, cy, r: s / 2 + 4, fill: inkA("--phos-a", 0.06), opacity: 0 }, g);
    const disc = el("circle", { cx, cy, r: s / 2 - 0.5, fill: ink("--panel"), stroke: ink("--hairline") }, g);
    const ic = el("g", { transform: `translate(${cx - (s * 0.45) / 2} ${cy - (s * 0.45) / 2}) scale(${(s * 0.45) / 24})`, fill: "none", stroke: ink("--silk-mute"), "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round" }, g);
    el("path", { d: L.d }, ic);
    if (L.circle) el("circle", { cx: L.circle[0], cy: L.circle[1], r: L.circle[2] }, ic);
    for (const c of L.circles || []) el("circle", { cx: c[0], cy: c[1], r: c[2] }, ic);
    stops[lv] = { halo, disc, ic, cx, cy };
  }

  // The keybed: KEYS and the octave keys, three octaves from C3 with the
  // computer's keys printed on the ones they play, and the volume, MIDI, ● REC.
  const kb = el("g", {}, svg);
  el("rect", { x: 0, y: 1004, width: 1920, height: 76, fill: ink("--recess-hi") }, kb);
  el("line", { x1: 0, y1: 1004.5, x2: 1920, y2: 1004.5, stroke: ink("--hairline") }, kb);
  say(kb, 16, 1034, "Keys", { size: TYPE.label, track: 0.16 });
  [["Z", 16], ["X", 77]].forEach(([k, kx]) => {
    box(kb, kx, 1044, 18, 17, 3, { fill: "none", stroke: ink("--hairline") });
    say(kb, kx + 9, 1056.5, k, { size: TYPE.label, mono: true, anchor: "middle", fill: ink("--silk-dim") });
  });
  say(kb, 48, 1056.5, "C4", { size: TYPE.label, mono: true, fill: ink("--silk") });
  say(kb, 110, 1056.5, "octave", { size: TYPE.label, mono: true, fill: ink("--silk-dim") });
  const piano = keyboard(kb, { x: 273, y: 1012, w: 1231.5, h: 59, low: 48, octaves: 3, names: false });
  // The computer's keys on the keys they play (a = C4 … ' = F5), and each C's name.
  const hints = { 60: "a", 61: "w", 62: "s", 63: "e", 64: "d", 65: "f", 66: "t", 67: "g", 68: "y", 69: "h", 70: "u", 71: "j", 72: "k", 73: "o", 74: "l", 75: "p", 76: ";", 77: "'" };
  const pattern = [0, 2, 4, 5, 7, 9, 11];
  const kw = 1231.5 / 22;
  for (let i = 0; i < 22; i++) {
    const note = 48 + Math.floor(i / 7) * 12 + pattern[i % 7];
    const kx = 273 + i * kw + kw / 2;
    if (note % 12 === 0) say(kb, 273 + i * kw + 14, 1063, `C${note / 12 - 1}`, { size: TYPE.label, mono: true, weight: 600, fill: ink("--slot"), anchor: "start" });
    if (hints[note]) say(kb, note % 12 === 0 ? kx - 14 : kx, note % 12 === 0 ? 1049 : 1063, hints[note], { size: TYPE.value, mono: true, anchor: "middle", fill: ink("--slot"), opacity: 0.75 });
  }
  const bkOff = { 1: 0.64, 3: 0.74, 6: 0.6, 8: 0.69, 10: 0.78 };
  for (const [note, k] of Object.entries(hints)) {
    const pc = note % 12;
    if (!(pc in bkOff)) continue;
    const o = Math.floor((note - 48) / 12);
    const wi = o * 7 + pattern.indexOf(pc - 1);
    say(kb, 273 + wi * kw + kw * bkOff[pc] + kw * 0.275, 1038, k, { size: TYPE.value, mono: true, anchor: "middle", fill: ink("--silk-dim") });
  }
  say(kb, 1520, 1045, "Vol", { size: TYPE.label, track: 0.16, fill: ink("--silk-dim") });
  box(kb, 1549, 1040, 95, 3, 1.5, { fill: ink("--hairline") });
  box(kb, 1549, 1040, 72, 3, 1.5, { fill: ink("--phos-a-deep") });
  box(kb, 1616, 1033, 10, 16, 2, { fill: ink("--silk-dim") });
  say(kb, 1652, 1045, "-2 dB", { size: TYPE.value, mono: true, fill: ink("--phos-a-dim") });
  say(kb, 1707, 1046, "midi ·", { size: TYPE.body, caps: false, fill: ink("--silk") });
  box(kb, 1759, 1029, 58, 26, 4, { fill: "none", stroke: ink("--hairline") });
  el("circle", { cx: 1773, cy: 1042, r: 3.5, fill: ink("--silk") }, kb);
  say(kb, 1783, 1046, "Rec", { size: TYPE.label, track: 0.12 });
  box(kb, 1830, 1029, 66, 26, 4, { fill: "none", stroke: ink("--hairline") });
  say(kb, 1839, 1046, "Keys ⋯", { size: TYPE.label, track: 0.12, fill: ink("--silk-dim") });

  api.keys = piano;
  api.taught = (n) => (taughtN.textContent = String(n));
  api.setLevel = (lv) => {
    api.level = lv;
    whereN.textContent = lv.toUpperCase();
    whereD.textContent = LEVELS[lv].what;
    whereD.setAttribute("x", 206 + lv.length * 10.4 + 10);
    for (const [k, s] of Object.entries(stops)) {
      const on = k === lv;
      s.disc.setAttribute("fill", ink(on ? "--panel-hi" : "--panel"));
      s.disc.setAttribute("stroke", ink(on ? "--phos-a-deep" : "--hairline"));
      s.ic.setAttribute("stroke", ink(on ? "--phos-a" : "--silk-mute"));
      s.halo.setAttribute("opacity", on ? 1 : 0);
      s.disc.style.filter = on ? `drop-shadow(0 0 9px ${inkA("--phos-a", 0.35)})` : "none";
    }
  };
  api.inHand = (n) => {
    handName.textContent = n;
    handFace.show(n);
  };
  api.setLevel(level);
  return api;
}

// ---- controls, as the app draws them ------------------------------------------

/**
 * A pad (apps/web `.pf-pad`): its name in silk caps with its printed key,
 * and under it the word for what it waits for. `kind` is "pad", "primary"
 * (Offer: amber, filled), "pass" (no face of its own) or "mv" (Keep and Back
 * in the moved bar). `set({enabled, down, lit, label, sub})` is its state.
 */
export function appPad(svg, { x, y, w, h, label, key = null, kind = "pad", wait = null, enabled = true }) {
  const g = el("g", {}, svg);
  const gid = uid("pad");
  const defs = el("defs", {}, g);
  const lg = el("linearGradient", { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
  const stops = kind === "primary" ? ["--phos-b", "--phos-b-dim"] : kind === "mv" ? ["--panel-hi", "--panel-hi"] : ["--btn-hi", "--btn-lo"];
  stops.forEach((c, i) => el("stop", { offset: i, "stop-color": ink(c) }, lg));
  const face0 = el("g", {}, g);
  const shadow = box(face0, x, y + 3, w, h, kind === "mv" ? 4 : 8, { fill: ink("--shadow-ink") });
  const body = box(face0, x, y, w, h, kind === "mv" ? 4 : 8, { fill: `url(#${gid})`, stroke: ink(kind === "primary" ? "--phos-b" : kind === "mv" ? "--hairline" : "--black"), "stroke-width": 1 });
  const hi = el("line", { x1: x + 6, y1: y + 1, x2: x + w - 6, y2: y + 1, stroke: inkA("--white", kind === "primary" ? 0.35 : 0.07) }, face0);
  const ink0 = kind === "primary" ? ink("--rack") : ink("--silk");
  const ty = y + h / 2 + 4;
  const name = say(g, x + w / 2, ty, label, { size: TYPE.label, anchor: "middle", fill: ink0, track: 0.16 });
  let keyBox = null;
  let keyT = null;
  if (key) {
    keyBox = box(g, 0, 0, 0, 16, 3, { fill: "none", stroke: kind === "primary" ? inkA("--rack", 0.45) : ink("--hairline") });
    keyT = say(g, 0, 0, key, { size: TYPE.label, mono: true, anchor: "middle", fill: kind === "primary" ? ink("--rack") : ink("--silk-dim") });
  }
  const subT = say(g, x + w / 2, y + h / 2 + 16, "", { size: TYPE.label + 1, mono: true, anchor: "middle", fill: kind === "primary" ? ink("--rack") : ink("--silk-dim") });
  const lay = (twoLines) => {
    const nw = label.length * TYPE.label * 0.82 + (label.length - 1) * TYPE.label * 0.16;
    const kwid = key ? key.length * 7 + 9 : 0;
    const total = nw + (key ? 8 + kwid : 0);
    const nx = x + w / 2 - total / 2;
    const yy = twoLines ? y + h / 2 - 4 : ty;
    name.setAttribute("x", nx);
    name.setAttribute("y", yy);
    name.setAttribute("text-anchor", "start");
    if (key) {
      keyBox.setAttribute("x", nx + nw + 8);
      keyBox.setAttribute("y", yy - 12);
      keyBox.setAttribute("width", kwid);
      keyT.setAttribute("x", nx + nw + 8 + kwid / 2);
      keyT.setAttribute("y", yy);
    }
  };
  const st = { enabled, down: 0, lit: 0, label: null, sub: null };
  const api = {
    g,
    pos: [x + w / 2, y + h / 2],
    set(o = {}) {
      Object.assign(st, o);
      const { enabled: en, down, lit, label: lb, sub } = st;
      if (lb != null && lb !== label) {
        label = lb;
        name.textContent = lb.toUpperCase();
      }
      const words = !en ? wait || "" : sub || "";
      subT.textContent = words;
      lay(!!words);
      subT.setAttribute("y", y + h / 2 + 15);
      const flat = !en || kind === "pass";
      face0.style.display = flat ? "none" : "";
      if (!en) {
        g.querySelector(".dash")?.remove();
        const d = box(g, x + 0.5, y + 0.5, w - 1, h - 1, 8, { class: "dash", fill: "none", stroke: ink("--plate-off-edge"), "stroke-dasharray": "4 3" });
        g.insertBefore(d, g.firstChild.nextSibling);
      } else g.querySelector(".dash")?.remove();
      const dy = en && !flat ? 2 * down : 0;
      face0.setAttribute("transform", `translate(0 ${dy})`);
      shadow.setAttribute("height", h - 2 * down);
      for (const t of [name, keyBox, keyT, subT]) if (t) t.setAttribute("transform", `translate(0 ${dy})`);
      const amber = kind === "primary" ? 0 : lit;
      name.setAttribute("fill", kind === "primary" ? ink("--rack") : amber > 0.3 ? ink("--phos-b") : en && kind !== "pass" ? ink("--silk") : ink("--silk-dim"));
      const glow = kind === "primary" ? 0.55 + 0.45 * Math.max(down, lit) : amber;
      body.style.filter = glow > 0.01 ? `drop-shadow(0 0 ${(12 + 12 * glow).toFixed(1)}px ${inkA("--phos-b", 0.35 * glow)})` : "none";
      void hi;
    },
  };
  api.set({ enabled });
  return api;
}

// ---- PERFORM --------------------------------------------------------------------

// Slow Weather in PERFORM, as the seeded session measured it (the films'
// pad, shotgen.CAST): its controls, what each one moves on this patch, the
// knobs under the hood with their values, and what its first offer changed.
export const SLOW_WEATHER = {
  name: "Slow Weather",
  cap: "pad · in hand",
  blurb: "never sits in the same place twice",
  status: "5 of 6 controls reach this patch",
  controls: [
    { name: "Bright", ends: "dark · bright", sub: "cutoff", where: [-21.81, -38.22], vel: true },
    { name: "Snap", ends: "bloom · snap", sub: "attack", where: [-32.11, -30.09] },
    { name: "Motion", ends: "still · restless", sub: "mod depth · rate", where: [-4.73, -43.74] },
    { name: "Body", ends: "thin · full", sub: "detune · mix +1", where: [14.55, -41.52] },
    { name: "Grit", ends: "smooth · rough", sub: "turn to ask for it", where: [-16.76, -40.68], search: true },
    { name: "Space", ends: "close · far", sub: "release · mix +2", where: [44, -0.26] },
  ],
  // [module, knob, value, fill] in the hood's order (three to a row).
  hood: [
    ["filter", "cutoff", "632 Hz", 0.55], ["env / out", "attack", "1.45 s", 0.85], ["filter", "mod depth", "50%", 0.5],
    ["lfo", "rate", "0.25 Hz", 0.45], ["supersaw", "detune", "60%", 0.6], ["supersaw", "mix", "55%", 0.55],
    ["env / out", "release", "1.58 s", 0.85], ["reverb", "mix", "35%", 0.35], ["reverb", "size", "65%", 0.65],
    ["reverb", "damp", "40%", 0.4],
  ],
  offer: "attack 1.45 s → 9.1 ms, release 1.58 s → 3.6 ms, sustain −2.8 dB → −8.6 dB",
};

/**
 * PERFORM, drawn on an app screen at the app's own places: the head (the
 * sound's family, its name and blurb, the moved bar's Keep and Back), the
 * well with the sound's face (and B's beside it while it holds an offer,
 * with Blend under them), and on the right the controls, the knobs under the
 * hood and the pad row: Wander, Offer, Peek, Take, Pass.
 *
 * The state is set each frame: `knob(i, c)` turns control i to c in [−1, 1];
 * `hood(i, u, text)` a hood row; `wander(u, words)`; `offered(u)` brings B
 * in; `blend(u)`; `moved(on)`; the pads through `pads.<name>.set()`.
 */
export function performView(scr, { sound = SLOW_WEATHER, faceA = null, faceB = null, offerName = "Morph Pad" } = {}) {
  const { svg, under } = scr;
  const g = el("g", {}, svg);
  // The head.
  say(g, 304, 99, sound.cap, { size: TYPE.label, fill: ink("--silk-dim") });
  const movedG = el("g", {}, g);
  say(movedG, 822, 99, "moved", { size: TYPE.value, mono: true, fill: ink("--silk-dim") });
  const keep = appPad(movedG, { x: 866.2, y: 81.8, w: 76.4, h: 26.3, label: "Keep", key: "↵", kind: "mv" });
  const back = appPad(movedG, { x: 950.5, y: 81.8, w: 85.5, h: 26.3, label: "Back", key: "⇧⌫", kind: "mv" });
  const nameT = say(g, 302, 165, sound.name, { size: TYPE.display, caps: false, track: -0.01 });
  el("circle", { cx: 628.3, cy: 146.1, r: 15.5, fill: ink("--panel"), stroke: ink("--hairline") }, g);
  el("path", { d: "M628.3 140v8 M625 143l3.3-3.3 3.3 3.3 M622.8 147v4.5h11v-4.5", fill: "none", stroke: ink("--silk-dim"), "stroke-width": 1.3, "stroke-linecap": "round", "stroke-linejoin": "round" }, g);
  say(g, 304, 197, sound.blurb, { size: TYPE.body, caps: false, fill: ink("--silk-dim") });

  // The well.
  const well = place(el("div", {}, under), { x: 304, y: 218.5, w: 732, h: 767.5 });
  Object.assign(well.style, {
    border: `1px solid ${ink("--hairline")}`, borderRadius: "var(--r3)", boxSizing: "border-box",
    background: `radial-gradient(120% 90% at 50% 60%, ${ink("--panel")}, ${ink("--bezel")} 62%)`,
    boxShadow: `inset 0 0 0 1px ${inkA("--black", 0.6)}, inset 0 30px 60px -30px ${inkA("--black", 0.75)}`,
  });
  const A = face(under, { x: 321, y: 243.5, w: 698, h: 725.5, name: faceA ? null : sound.name, src: faceA, kind: "well" });
  const Bslot = { x: 707.6, y: 243.5, w: 311.4, h: 685.5 };
  const B = face(under, { ...Bslot, name: faceB ? null : offerName, src: faceB, kind: "wellb" });
  const bLabel = say(g, 863.3, 458, "B", { size: TYPE.label, mono: true, weight: 600, anchor: "middle", fill: ink("--phos-b") });
  const bWords = say(g, 863.3, 902, sound.offer.split(", ").slice(0, 2).join(", "), { size: TYPE.label, mono: true, anchor: "middle", fill: ink("--silk-dim") });
  // The live trace in the well's corner, and the corner's two buttons.
  const tr = scope(svg, { x: 317, y: 231.5, w: 120, h: 30, width: 1.5, points: 160, glow: false });
  tr.g.style.opacity = 0.55;
  [["XY", 889.1, 33.7], ["Shift F", 930.8, 92.2]].forEach(([t, bx, bw]) => {
    box(g, bx, 231.5, bw, 26.3, 4, { fill: ink("--bezel"), stroke: ink("--hairline") });
    say(g, bx + bw / 2 + (t === "XY" ? 0 : 9), 248.5, t, { size: TYPE.label, mono: true, anchor: "middle", fill: ink("--silk-dim") });
  });
  // Blend: home to B, under the two faces, while B holds an offer.
  const blendG = el("g", {}, g);
  say(blendG, 490, 952, "home", { size: TYPE.label, fill: ink("--phos-a-dim"), track: 0.12 });
  box(blendG, 535.7, 946, 298.6, 4, 2, { fill: ink("--hairline") });
  const blendFill = box(blendG, 535.7, 946, 0, 4, 2, { fill: ink("--phos-b") });
  const blendThumb = el("circle", { cx: 535.7, cy: 948, r: 7, fill: ink("--phos-b"), stroke: ink("--rack"), "stroke-width": 1.5 }, blendG);
  say(blendG, 842.3, 952, "B", { size: TYPE.label, fill: ink("--phos-b") });
  const blendV = say(blendG, 670, 970, "0% offer", { size: TYPE.value, mono: true, anchor: "middle", fill: ink("--phos-b-dim") });

  // The controls' head and the status line.
  say(g, 1068, 229.5, "Controls", { size: TYPE.label });
  say(g, 1576.5, 229.5, "› Arrange", { size: TYPE.label, fill: ink("--silk-dim"), track: 0.16 });
  say(g, 1673.4, 229.5, "› How it works", { size: TYPE.label, fill: ink("--silk-dim"), track: 0.16 });
  const status = say(g, 1068, 266, sound.status, { size: TYPE.value, mono: true, fill: ink("--silk-dim") });

  // The named controls, three to a row.
  const knobs = sound.controls.map((c, i) => {
    const cx = 1068 + (i % 3) * 246.65 + 119.35;
    const cy = (i < 3 ? 290.1 : 477) + 42;
    const k = knob(g, { cx, cy, r: 34 * 0.84, bipolar: true, search: c.search, glow: false, color: c.search ? "b" : "a" });
    const w = c.where ? (Math.atan2(c.where[0], -c.where[1]) * 180) / Math.PI / 270 + 0.5 : null;
    k.set(0.5, { where: w, col: c.search ? "b" : "a" });
    say(g, cx, cy + 59, c.name, { size: TYPE.label, anchor: "middle", fill: c.search ? ink("--phos-b") : ink("--silk") });
    say(g, cx, cy + 77, c.ends, { size: TYPE.label, mono: true, anchor: "middle", fill: ink("--silk-dim") });
    const sub = say(g, cx, cy + 93, c.sub, { size: TYPE.label, mono: true, anchor: "middle", fill: c.search ? ink("--phos-b-dim") : ink("--phos-a-dim") });
    if (c.vel) {
      box(g, 1072.5, 291, 27, 15, 3, { fill: "none", stroke: ink("--phos-a-deep") });
      say(g, 1086, 302, "vel", { size: TYPE.label, mono: true, anchor: "middle", fill: ink("--phos-a-dim") });
    }
    return { k, cx, cy, w, sub, c, search: !!c.search, v: 0 };
  });

  // Under the hood: the real knobs the controls and Wander move, live.
  say(g, 1068, 675.8, "Under the hood", { size: TYPE.label, weight: 400, track: 0.1, fill: ink("--silk-dim") });
  const hood = sound.hood.map(([m, p, v, u], i) => {
    const hx = 1068 + (i % 3) * 249.35;
    const hy = 683.8 + Math.floor(i / 3) * 22;
    const nm = el("text", { x: hx, y: hy + 13, "font-family": "Jost", "font-size": TYPE.label, fill: ink("--silk-dim") }, g);
    el("tspan", { fill: ink("--silk"), "letter-spacing": "0.08em" }, nm, m.toUpperCase());
    el("tspan", {}, nm, ` ${p}`);
    box(g, hx + 126.3, hy + 7, 44, 6, 3, { fill: ink("--bezel"), stroke: ink("--hairline") });
    const fill = box(g, hx + 127, hy + 7.5, 42 * u, 5, 2.5, { fill: ink("--phos-a-deep") });
    el("rect", { x: hx + 126.3 + 44 * u - 1, y: hy + 6, width: 2, height: 8, fill: ink("--silk-dim") }, g);
    const val = say(g, hx + 233.3, hy + 13, v, { size: TYPE.label, mono: true, anchor: "end", fill: ink("--phos-a-dim") });
    return { fill, val, u0: u, nm };
  });

  // The pad row: Wander, then Offer, Peek, Take and Pass.
  const wander = knob(g, { cx: 1094, cy: 819.3, r: 34 * 0.44, color: "b", glow: false, ringColor: "--phos-b-deep" });
  // Where Wander's zones begin (ideas, drift, roam): ticks outside its ring.
  for (const v of [0.08, 0.35, 0.72]) {
    const a = ((-135 + 270 * v - 90) * Math.PI) / 180;
    const R0 = 45 * 0.44;
    el("line", { x1: 1094 + R0 * Math.cos(a), y1: 819.3 + R0 * Math.sin(a), x2: 1094 + (R0 + 2.5) * Math.cos(a), y2: 819.3 + (R0 + 2.5) * Math.sin(a), stroke: ink("--silk-dim"), "stroke-width": 1.2, "stroke-linecap": "round" }, g);
  }
  wander.set(0);
  const wName = say(g, 1124, 801.5, "Wander", { size: TYPE.label, fill: ink("--phos-b") });
  const wSub = say(g, 1124, 817.5, "still", { size: TYPE.value, mono: true, fill: ink("--phos-a-dim") });
  const pads = {
    offer: appPad(g, { x: 1236, y: 793.3, w: 151.5, h: 52, label: "Offer", key: "N", kind: "primary" }),
    peek: appPad(g, { x: 1395.5, y: 793.3, w: 131.7, h: 52, label: "Peek", key: "B", wait: "needs an offer", enabled: false }),
    take: appPad(g, { x: 1535.2, y: 793.3, w: 131.7, h: 52, label: "Take", key: "⇧↵", wait: "needs an offer", enabled: false }),
    pass: appPad(g, { x: 1674.9, y: 793.3, w: 125.1, h: 52, label: "Pass", kind: "pass", wait: "needs an offer", enabled: false }),
    keep,
    back,
  };

  const api = {
    g, A, B, scope: tr, knobs, hoodRows: hood, pads, status, nameT, well,
    wander: { k: wander, cx: 1094, cy: 819.3, name: wName, sub: wSub },
    /** Control i turned to c in [−1, 1]; `held` lights it as a hand on it. */
    knob(i, c, { held = false } = {}) {
      const K = knobs[i];
      K.v = c;
      K.k.set(0.5 + c / 2, { where: K.w, col: K.search ? "b" : "a", glowOn: held });
    },
    hood(i, u, text = null) {
      const H = hood[i];
      H.fill.setAttribute("width", Math.max(0, 42 * clamp(u)));
      if (text != null) H.val.textContent = text;
    },
    wanderTo(u, words = null, { held = false } = {}) {
      wander.set(u, { col: "b", glowOn: held });
      if (words != null) wSub.textContent = words;
    },
    /** B coming in (0..1): the faces move apart, B's face and words appear. */
    offered(u) {
      const e = E.io3(clamp(u));
      A.wrap.style.transform = `translateX(${(-e * (698 - 370.6) / 2).toFixed(1)}px) scale(${lerp(1, 0.945, e)})`;
      A.wrap.style.transformOrigin = "50% 80%";
      B.wrap.style.opacity = e;
      bLabel.setAttribute("opacity", e);
      bWords.setAttribute("opacity", e);
      blendG.setAttribute("opacity", e);
      for (const k of ["peek", "take", "pass"]) pads[k].set({ enabled: u >= 0.5 });
      pads.offer.set({ label: u >= 0.5 ? "Next" : "Offer", sub: u >= 0.5 ? "passes on B" : "" });
    },
    blend(u) {
      const x = 535.7 + 298.6 * clamp(u);
      blendFill.setAttribute("width", x - 535.7);
      blendThumb.setAttribute("cx", x);
      blendV.textContent = `${Math.round(100 * clamp(u))}% offer`;
    },
    moved(on) {
      movedG.setAttribute("opacity", on ? 1 : 0);
    },
    /** Take: the offer becomes the sound in hand. */
    take(name = null, src = null) {
      A.show(name, src);
    },
  };
  api.offered(0);
  api.blend(0);
  api.moved(false);
  return api;
}

// ---- EVOLVE ---------------------------------------------------------------------

/**
 * EVOLVE, drawn: the head (EVOLVE, its generations, the question and the
 * teaching pips), the little TASTE map, the pair's two cards (each a well
 * with its sound's face, the name under it, PLAY and PICK), and the foot.
 * `card(side).show(name)`; `card(side).set({lit, picked, play})`; `pips(n)`.
 */
export function evolveView(scr, { a = "Glass Pad", b = "Slow Weather", generations = 0 } = {}) {
  const { svg, under } = scr;
  const g = el("g", {}, svg);
  say(g, 304, 94, "Evolve", { size: TYPE.label, fill: ink("--silk") });
  say(g, 376, 94, "Generations", { size: TYPE.label, fill: ink("--silk-dim"), track: 0.16 });
  say(g, 488, 94, String(generations), { size: TYPE.value, mono: true, fill: ink("--phos-b") });
  say(g, 302, 154, "Pick the one you’d reach for.", { size: TYPE.display, caps: false, track: -0.01 });
  const pips = Array.from({ length: 6 }, (_, i) => el("circle", { cx: 308.5 + i * 13, cy: 179.7, r: 4, fill: ink("--amber-off"), stroke: ink("--slot") }, g));
  const teach = say(g, 390, 185, "Play both. Pick the one you’d reach for.", { size: TYPE.body, caps: false, fill: ink("--silk-dim") });
  // The TASTE map, small: the pool as points, the pair marked.
  const map = place(el("div", {}, under), { x: 1540, y: 80, w: 260, h: 140 });
  Object.assign(map.style, { border: `1px solid ${ink("--hairline")}`, borderRadius: "var(--r2)", background: `radial-gradient(120% 90% at 50% 60%, ${ink("--panel")}, ${ink("--bezel")} 70%)` });
  const R = rng(17);
  for (let i = 0; i < 38; i++) el("circle", { cx: 1555 + R() * 230, cy: 92 + R() * 100, r: 1.3, fill: ink("--phos-a-dim") }, g);
  say(g, 1548, 211, "Taste", { size: TYPE.label, fill: ink("--silk-dim"), track: 0.16 });
  say(g, 1609, 211, "Alt 4", { size: TYPE.label, mono: true, fill: ink("--silk-dim") });
  const cards = {};
  for (const [side, x0, nm] of [["A", 304, a], ["B", 1073.2, b]]) {
    const w = 726.8;
    const well = place(el("div", {}, under), { x: x0, y: 236, w, h: 626 });
    Object.assign(well.style, {
      border: `1px solid ${ink("--hairline")}`, borderRadius: "var(--r3)", boxSizing: "border-box",
      background: `radial-gradient(120% 90% at 50% 60%, ${ink("--panel")}, ${ink("--bezel")} 62%)`,
      boxShadow: `inset 0 0 0 1px ${inkA("--black", 0.6)}, inset 0 30px 60px -30px ${inkA("--black", 0.75)}`,
    });
    // The well's faint grid.
    for (let i = 1; i < 8; i++) el("line", { x1: x0 + (w * i) / 8, y1: 237, x2: x0 + (w * i) / 8, y2: 861, stroke: inkA("--white", 0.025) }, g);
    for (let j = 1; j < 4; j++) el("line", { x1: x0 + 1, y1: 236 + (626 * j) / 4, x2: x0 + w - 1, y2: 236 + (626 * j) / 4, stroke: inkA("--white", 0.025) }, g);
    const f = face(under, { x: x0 + 16, y: 260, w: w - 32, h: 590, name: nm, kind: "evolve" });
    say(g, x0 + 13, 262, side, { size: TYPE.label, fill: ink("--silk-dim"), track: 0.16 });
    [["⇄ circuit", w - 168.2, 82.8], ["↓ patch", w - 77.4, 68.4]].forEach(([t, dx, bw]) => {
      box(g, x0 + dx, 249, bw, 23, 3, { fill: ink("--bezel"), stroke: ink("--hairline") });
      say(g, x0 + dx + bw / 2, 265, t, { size: TYPE.value, mono: true, anchor: "middle", fill: ink("--silk-dim") });
    });
    const name = say(g, x0, 897, nm, { size: TYPE.title, caps: false, weight: 400 });
    const play = appPad(g, { x: x0 + w - 192.2, y: 874, w: 96.2, h: 34, label: "▶ Play", key: side === "A" ? "1" : "2" });
    const pick = appPad(g, { x: x0 + w - 88, y: 874, w: 88, h: 34, label: `Pick ${side}`, key: side === "A" ? "←" : "→" });
    const ring = place(el("div", {}, under), { x: x0, y: 236, w, h: 626 });
    Object.assign(ring.style, { borderRadius: "var(--r3)", border: `1px solid ${ink("--phos-a-dim")}`, boxSizing: "border-box", opacity: 0 });
    cards[side] = {
      face: f, name, play, pick, ring, x: x0, w,
      show(n) {
        f.show(n);
        name.textContent = n;
      },
      set({ lit = 0, picked = 0, play: p = 0, pickDown = 0 } = {}) {
        ring.style.opacity = Math.max(lit, picked);
        ring.style.boxShadow = `0 0 ${12 + 20 * picked}px ${inkA("--phos-a", 0.12 + 0.2 * picked)}`;
        play.set({ down: p, lit: 0 });
        pick.set({ down: pickDown, lit: picked });
      },
    };
  }
  say(g, 1052, 576, "or", { size: TYPE.label, anchor: "middle", fill: ink("--silk-dim"), track: 0.16 });
  box(g, 304, 924, 132.8, 23, 3, { fill: "none", stroke: ink("--hairline") });
  say(g, 313, 940, "another pair  N", { size: TYPE.value, mono: true, fill: ink("--silk-dim") });
  say(g, 445, 940, "◇ random pair · a fair test", { size: TYPE.value, mono: true, fill: ink("--silk-dim") });
  box(g, 1680, 924, 120, 34, 8, { fill: "none", stroke: ink("--phos-b-deep"), "stroke-dasharray": "4 3" });
  say(g, 1740, 945.5, "Evolve pool", { size: TYPE.label, anchor: "middle", fill: ink("--phos-b"), track: 0.16 });
  say(g, 1795, 978, "› What each generation did", { size: TYPE.label, anchor: "end", fill: ink("--silk-dim"), track: 0.16 });
  return {
    g, cards, teach,
    card: (s) => cards[s],
    /** The teaching pips: n of six lit (the model's amber). */
    pips(n) {
      pips.forEach((p, i) => {
        const on = i < n;
        p.setAttribute("fill", ink(on ? "--phos-b" : "--amber-off"));
        p.style.filter = on ? GLOW_SOFT.b : "none";
      });
    },
  };
}

// ---- PATCH ------------------------------------------------------------------------

// Slow Weather's rack, as PATCH lays it out at 1920 × 1080 (three modules
// and a modulator, in signal order, the LFO under the filter's cutoff):
// each plate's place, its kind, and its knobs' readouts and names.
export const SLOW_WEATHER_RACK = [
  { name: "supersaw", x: 349.8, y: 449.9, w: 254.9, kind: "", knobs: [["oct", "0", null], ["detune", "60%", 0.6], ["mix", "55%", 0.55], ["mod", "0%", 0]], tab: "pitch" },
  { name: "filter", x: 674.7, y: 449.9, w: 215, kind: "svf bp", knobs: [["cutoff", "632 Hz", 0.55], ["res", "Q 0.8", 0.35], ["mod", "50%", 0.5]], tab: "cutoff", filled: true },
  { name: "reverb", x: 959.6, y: 449.9, w: 254.9, kind: "", knobs: [["size", "65%", 0.65], ["damp", "40%", 0.4], ["mix", "35%", 0.35], ["mod", "0%", 0]], tab: "size" },
  { name: "env / out", x: 1284.6, y: 449.9, w: 254.9, kind: "", knobs: [["attack", "1.45 s", 0.8], ["decay", "100 ms", 0.25], ["sustain", "−2.8 dB", 0.75], ["release", "1.58 s", 0.8]], env: true },
  { name: "lfo", x: 499.7, y: 622.3, w: 105, kind: "tri", knobs: [["rate", "0.25 Hz", 0.3]], mod: true },
];

/**
 * PATCH, drawn: the head (PATCH · the family, the name, what it holds, the
 * toolbar), the rack's frame and its plates with their knobs, readouts,
 * jacks and level chips, the cables between them, the modulator's amber
 * lead into its tab, and OUT with the sound's face. `knob(m, i, u, text)`
 * turns a knob; `ghost(m, i, u)` draws where PERFORM is playing it.
 */
export function patchView(scr, { sound = SLOW_WEATHER, rack = SLOW_WEATHER_RACK, faceSrc = null, teach = null } = {}) {
  const { svg, under } = scr;
  const g = el("g", {}, svg);
  say(g, 304, 92, "Patch", { size: TYPE.label });
  say(g, 359, 92, "· pad", { size: TYPE.label, fill: ink("--silk-dim"), track: 0.16 });
  say(g, 302, 155, sound.name, { size: TYPE.display, caps: false, track: -0.01 });
  say(g, 304, 189, "3 modules · 1 modulator, in signal order", { size: TYPE.body, caps: false, fill: ink("--silk-dim") });
  const ev = appPad(g, { x: 1099, y: 119, w: 175, h: 32, label: "⚡ Evolve from this", kind: "primary" });
  void ev;
  box(g, 1276, 119, 26, 32, 4, { fill: ink("--phos-b-dim") });
  say(g, 1326, 140, "+ Add module", { size: TYPE.label, fill: ink("--silk-dim"), track: 0.16 });
  say(g, 1497, 140, "New patch", { size: TYPE.label, fill: ink("--silk-dim"), track: 0.16 });
  say(g, 1635, 140, "› How to read this", { size: TYPE.label, fill: ink("--silk-dim"), track: 0.16 });
  const frame = place(el("div", {}, under), { x: 305, y: 213.2, w: 1494, h: 775.8 });
  Object.assign(frame.style, {
    border: `1px solid ${ink("--hairline")}`, borderRadius: "var(--r1)", boxSizing: "border-box",
    background: `radial-gradient(60% 55% at 55% 45%, ${inkA("--white", 0.04)}, transparent 70%), linear-gradient(180deg, ${ink("--panel-lo")}, ${ink("--rack")})`,
    boxShadow: `inset 0 0 22px ${inkA("--black", 0.85)}, inset 0 0 2px 1px ${ink("--black")}`,
  });
  for (let x = 312; x < 1796; x += 24) for (let y = 220; y < 985; y += 24) el("circle", { cx: x, cy: y, r: 1.05, fill: inkA("--white", 0.025) }, g);
  const H = 112.5;
  const wires = el("g", {}, g);
  wires.style.filter = `drop-shadow(1px 3px 3px ${inkA("--black", 0.55)})`;
  const plates = rack.map((m) => {
    const pg = el("g", {}, g);
    const mod = !!m.mod;
    const pl = box(pg, m.x, m.y, m.w, H, 8, { fill: ink("--plate-hi"), stroke: mod ? ink("--phos-b-deep") : ink("--hairline"), "stroke-dasharray": mod ? "4 3" : null });
    pl.style.filter = `drop-shadow(0 1px 1px ${inkA("--black", 0.8)}) drop-shadow(0 5px 7px ${inkA("--black", 0.35)})`;
    el("rect", { x: m.x + 1, y: m.y + 1, width: m.w - 2, height: 18, rx: 7, fill: inkA("--white", 0.04) }, pg);
    say(pg, m.x + 15, m.y + 23.5, m.name, { size: 13, weight: 500, fill: mod ? ink("--phos-b") : ink("--silk") });
    if (m.kind) say(pg, m.x + m.w - 15, m.y + 23.5, m.kind, { size: 11, mono: true, anchor: "end", fill: ink("--silk-dim") });
    if (m.env) el("path", { d: `M${m.x + m.w - 80} ${m.y + 27} l14 -14 h28 l14 14`, fill: inkA("--phos-a", 0.12), stroke: ink("--phos-a-deep"), "stroke-width": 1.2 }, pg);
    const n = m.knobs.length;
    const kx0 = m.x + 31;
    const step = n > 1 ? (m.w - 62) / (n - 1) : 0;
    const ks = m.knobs.map(([lbl, val, u], i) => {
      const cx = n > 1 ? kx0 + i * step : m.x + m.w / 2;
      const cy = m.y + 58;
      let k = null;
      if (u != null) {
        k = knob(pg, { cx, cy, r: 14, color: mod ? "b" : "a", glow: false });
        k.set(u);
      } else {
        say(pg, cx, cy + 4, val, { size: 11, mono: true, anchor: "middle", fill: ink("--silk") });
      }
      const v = u != null ? say(pg, cx, m.y + 89, val, { size: 11, mono: true, anchor: "middle", fill: ink("--silk") }) : null;
      say(pg, cx, m.y + 103, lbl, { size: 10, mono: true, anchor: "middle", fill: ink("--silk-mute") });
      return { k, v, cx, cy, u };
    });
    if (m.tab) {
      const tx = m.x + m.w / 2 - 54;
      box(pg, tx, m.y + H + 2, 108, 18, 3, { fill: inkA("--rack", 0.6), stroke: ink("--phos-b-deep"), "stroke-dasharray": m.filled ? null : "3 2.5" });
      el("circle", { cx: tx + 15, cy: m.y + H + 11, r: 5.5, fill: ink("--bezel"), stroke: ink("--phos-b-dim"), "stroke-width": 1.6 }, pg);
      say(pg, tx + 96, m.y + H + 15, m.tab, { size: 10, anchor: "end", fill: ink("--phos-b"), track: 0.1, opacity: m.filled ? 0.85 : 0.7 });
    }
    return { m, g: pg, knobs: ks, in: [m.x, m.y + 58], out: [m.x + m.w, m.y + 58] };
  });
  // The audio chain: out → level chip → in, and on to OUT.
  const audio = plates.filter((p) => !p.m.mod);
  const jackAt = (x, y, col = "a") => {
    el("circle", { cx: x, cy: y, r: 6.5, fill: ink("--bezel"), stroke: col === "a" ? ink("--phos-a-deep") : ink("--phos-b-dim"), "stroke-width": 1.6 }, wires);
    el("circle", { cx: x, cy: y, r: 2.5, fill: "none", stroke: inkA("--white", 0.18) }, wires);
  };
  for (let i = 0; i < audio.length; i++) {
    const a = audio[i].out;
    const b = i + 1 < audio.length ? audio[i + 1].in : [1597, a[1]];
    el("line", { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: inkA("--black", 0.5), "stroke-width": 5.5, "stroke-linecap": "round" }, wires);
    el("line", { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: inkA("--phos-a", 0.72), "stroke-width": 2.2, "stroke-linecap": "round" }, wires);
    jackAt(a[0], a[1]);
    jackAt(b[0], b[1]);
    if (i + 1 < audio.length) {
      const mx = (a[0] + b[0]) / 2;
      box(wires, mx - 11, a[1] - 9, 22, 18, 3, { fill: ink("--bezel"), stroke: ink("--phos-a-deep") });
      [4, 7, 10].forEach((hh, j) => el("rect", { x: mx - 6 + j * 4.5, y: a[1] + 5 - hh, width: 3, height: hh, fill: ink("--phos-a") }, wires));
    }
  }
  // The modulator's lead, from the LFO's out to the filter's cutoff tab.
  const lfo = plates.find((p) => p.m.mod);
  const filt = plates.find((p) => p.m.filled);
  if (lfo && filt) {
    const tabX = filt.m.x + filt.m.w / 2 - 54 + 15;
    const p0 = lfo.out;
    const lead = `M${p0[0]} ${p0[1]} H${tabX - 8} Q${tabX} ${p0[1]} ${tabX} ${p0[1] - 8} V${filt.m.y + H + 11}`;
    el("path", { d: lead, fill: "none", stroke: inkA("--black", 0.5), "stroke-width": 4.5 }, wires);
    const ml = el("path", { d: lead, fill: "none", stroke: inkA("--phos-b", 0.62), "stroke-width": 1.8, "stroke-dasharray": "6 4" }, wires);
    ml.style.filter = `drop-shadow(0 0 3px ${inkA("--phos-b", 0.35)})`;
    jackAt(p0[0], p0[1], "b");
    say(g, tabX - 8, p0[1] + 4, "depth 50% · 0.25 Hz", { size: 11, mono: true, fill: ink("--silk-dim") });
  }
  // OUT, and the sound's face beside it.
  say(g, 1597, 485, "out", { size: 13, weight: 500, anchor: "middle", fill: ink("--silk-dim"), track: 0.18 });
  const outY = rack[0].y + 58;
  el("circle", { cx: 1597, cy: outY, r: 7, fill: ink("--bezel"), stroke: ink("--phos-a"), "stroke-width": 1.8 }, g);
  el("circle", { cx: 1597, cy: outY, r: 2.5, fill: ink("--phos-a") }, g);
  const out = face(under, { x: 1614, y: 375, w: 150, h: 250, name: faceSrc ? null : sound.name, src: faceSrc, kind: "out" });
  say(g, 337, 921, "Fit", { size: TYPE.label, fill: ink("--silk-dim"), track: 0.16 });
  say(g, 372, 921, "–", { size: TYPE.label, fill: ink("--silk-dim") });
  say(g, 402, 921, "+", { size: TYPE.label, anchor: "middle", fill: ink("--silk-dim") });
  say(g, 441, 921, "Map", { size: TYPE.label, anchor: "middle", fill: ink("--silk-dim"), track: 0.16 });
  say(g, 476, 921, "Chain ▾", { size: TYPE.label, fill: ink("--silk-dim"), track: 0.16 });
  // The teach strip says what the session says (`#pt-teach`), or nothing.
  if (teach) say(g, 1777, 921, teach, { size: TYPE.label, anchor: "end", fill: ink("--phos-b"), track: 0.16 });
  return {
    g, plates, out,
    knob(mi, ki, u, text = null) {
      const K = plates[mi].knobs[ki];
      if (K.k) K.k.set(u, { glowOn: true });
      if (text != null && K.v) K.v.textContent = text;
    },
    ghost(mi, ki, u) {
      const K = plates[mi].knobs[ki];
      if (K.k) K.k.set(K.u, { ghost: u });
    },
  };
}

// ---- a duel card ----------------------------------------------------------

/**
 * One side of an EVOLVE pair, as the app draws its card: a well holding the
 * sound's face (a preset's, by `face`; else its sweep, as the app shows a
 * sound still rendering), the side's letter in its corner, and under the
 * well the name, ▶ PLAY and PICK. `under` takes the HTML; `svg` the rest.
 */
export function duelCard(under, svg, { x, y, w = 620, h = 400, side = "A", name = "—", wave, color = "a", face: faceName = null }) {
  const foot = Math.max(48, h * 0.12);
  const wh = h - foot - 12;
  const div = place(el("div", {}, under), { x, y, w, h: wh });
  Object.assign(div.style, {
    border: `1px solid ${ink("--hairline")}`, borderRadius: "var(--r3)", boxSizing: "border-box",
    background: `radial-gradient(120% 90% at 50% 60%, ${ink("--panel")}, ${ink("--bezel")} 62%)`,
    boxShadow: `inset 0 0 0 1px ${inkA("--black", 0.6)}, inset 0 30px 60px -30px ${inkA("--black", 0.75)}`,
  });
  const g = el("g", {}, svg);
  for (let i = 1; i < 8; i++) el("line", { x1: x + (w * i) / 8, y1: y + 1, x2: x + (w * i) / 8, y2: y + wh - 1, stroke: inkA("--white", 0.025) }, g);
  const sideT = say(g, x + 18, y + 30, side, { size: 18, fill: ink("--silk-dim"), track: 0.16 });
  void sideT;
  const f = faceName && PRESETS.includes(faceName) ? face(under, { x: x + 20, y: y + 30, w: w - 40, h: wh - 40, name: faceName, kind: "evolve" }) : null;
  const tr = f ? null : scope(svg, { x: x + 40, y: y + 60, w: w - 80, h: wh - 120, width: 3, points: 300, wave: wave || voiceWave({ seed: side.charCodeAt(0) }), color });
  const nm = el("div", { class: "silk" }, under, name);
  place(nm, { x, y: y + wh + 12 });
  Object.assign(nm.style, { fontSize: "var(--t-frame-5)", color: ink("--silk"), letterSpacing: "0", textTransform: "none" });
  // PLAY and PICK at the app's size, scaled up with the card (a film's card
  // is larger than the app's at 1920 × 1080).
  const k = Math.max(1, Math.min(1.8, w / 420));
  const pickW = 92 * k;
  const playW = 96 * k;
  const bh = 34 * k;
  const pad = (px, pw, opts) => {
    const pg = el("g", { transform: `translate(${px} ${y + wh + 12}) scale(${k})` }, g);
    const p = appPad(pg, { x: 0, y: 0, w: pw / k, h: 34, ...opts });
    p.pos = [px + p.pos[0] * k, y + wh + 12 + p.pos[1] * k];
    return p;
  };
  const play = pad(x + w - pickW - playW - 8 * k, playW, { label: "▶ Play", key: side === "A" ? "1" : "2" });
  const pick = pad(x + w - pickW, pickW, { label: `Pick ${side}`, key: side === "A" ? "←" : "→" });
  void bh;
  return {
    div, nm, face: f,
    hear: play, pick,
    hearPos: play.pos,
    pickPos: pick.pos,
    update(t, { level = 0.25, lit = 0, picked = 0, name: nn = null, draw = 1 } = {}) {
      if (nn != null && nm.textContent !== nn) {
        nm.textContent = nn;
        if (f && PRESETS.includes(nn)) f.show(nn);
      }
      if (tr) {
        tr.update(t, { amp: level, draw });
        tr.g.style.opacity = 0.35 + 0.65 * clamp(level / 0.7);
      }
      if (f) f.wrap.style.opacity = 0.75 + 0.25 * clamp(level / 0.7);
      div.style.borderColor = picked > 0 ? inkA("--phos-a", 0.3 + 0.6 * picked) : lit > 0 ? inkA("--phos-a", 0.35 * lit) : ink("--hairline");
      div.style.boxShadow = `inset 0 0 0 1px ${inkA("--black", 0.6)}, inset 0 30px 60px -30px ${inkA("--black", 0.75)}, 0 0 ${12 + 28 * picked}px ${inkA("--phos-a", 0.12 * Math.max(lit, picked) + 0.15 * picked)}`;
      play.set({ down: lit > 0.5 ? 0.6 : 0 });
      pick.set({ down: picked > 0.5 ? 1 : 0, lit: picked });
    },
  };
}

// ---- the PERFORM panel, for a film that takes it apart ---------------------------

export const NAMED = ["Bright", "Snap", "Motion", "Body", "Grit", "Space", "Blend", "Wander"];

/**
 * PERFORM, drawn (performView) without the app's chrome, scaled into a
 * film's box (by default x 160–1760, y from `y`, 690 tall). For the films
 * written against the panel this replaced, it keeps its handles:
 * - `trA` and `trB`: A is the live trace in the well's corner, B the offer
 *   (its `update(t, {draw})` brings B in; `g.style.opacity` shows it); a
 *   new `wave` on `trA` once B is in is a Take: A shows B's sound.
 * - `pads.{offer, peek, take, pass, keep, back}` for `pressPad`.
 * - `knobs.{bright … space, blend, wander}` ({k, cx, cy} in the film's px,
 *   `k.set(v)` with v in [0, 1]) and `strip` (the hood's rows).
 */
export function performPanel(under, svg, over, { x = 160, y = 110, w = 1600, h = 690, sound = SLOW_WEATHER, faceA = null, faceB = null } = {}) {
  // PERFORM's part of the page: x 296–1812, y 72–994.
  const PX0 = 296;
  const PY0 = 72;
  const PW = 1516;
  const PH = 922;
  const s = Math.min(w / PW, h / PH);
  const ox = x + (w - PW * s) / 2 - PX0 * s;
  const oy = y - PY0 * s;
  const host = el("div", { class: "layer" }, under);
  const scr = appScreen(host, { x: ox, y: oy, w: 1920 * s, h: 1080 * s, chrome: false, frame: false });
  scr.wrap.style.overflow = "visible";
  scr.root.style.background = "none";
  const V = performView(scr, { sound, faceA, faceB });
  const at = (px, py) => [ox + px * s, oy + py * s];
  const knobs = {};
  V.knobs.forEach((K, i) => {
    const [cx, cy] = at(K.cx, K.cy);
    knobs[NAMED[i].toLowerCase()] = { k: { g: K.k.g, set: (v, o = {}) => V.knob(i, v * 2 - 1, { held: !!o.glowOn }) }, cx, cy, v: 0.5 };
  });
  const [bx, by] = at(670, 948);
  knobs.blend = { k: { g: null, set: (v) => V.blend(v) }, cx: bx, cy: by, v: 0 };
  const [wx, wy] = at(V.wander.cx, V.wander.cy);
  knobs.wander = { k: { g: V.wander.k.g, set: (v) => V.wanderTo(v) }, cx: wx, cy: wy, v: 0 };
  const pads = {};
  for (const [k, p] of Object.entries(V.pads)) pads[k] = { ...p, d: p, pos: at(...p.pos), app: p };
  const strip = V.hoodRows.map((H, i) => ({ k: { set: (v) => V.hood(i, v) }, cx: 0, cy: 0, v: H.u0 }));
  let bIn = 0;
  const trA = {
    g: V.scope.g,
    path: V.scope.path,
    set wave(f) {
      V.scope.wave = f;
      if (bIn > 0.5) V.take(V.B.name);
    },
    update: (t, o = {}) => V.scope.update(t, { ...o, amp: (o.amp ?? 1) * 0.9 }),
  };
  const bG = { style: {} };
  // B hidden again (a film's Take or pass) puts the offer away, as the app does.
  Object.defineProperty(bG.style, "opacity", { set: (v) => V.offered(Math.min(Number(v), bIn)), get: () => V.B.wrap.style.opacity });
  const trB = {
    g: bG,
    set wave(f) {
      void f;
    },
    update(t, { draw = 1 } = {}) {
      bIn = clamp(draw);
      V.offered(bIn);
    },
  };
  return { V, scr, div: host, nm: V.nameT, trA, trB, pads, knobs, strip, h, y, x, w, at, s };
}

/** A pad pressed (`u` 0..1): pushed in and lit, amber or green. */
export function pressPad(p, u, color = "a") {
  const pad = p.app || p;
  if (pad.set) return pad.set({ down: u, lit: color === "b" ? u : 0 });
}

// ---- φ: a sound's measurements, as a meter bridge -------------------------

/** The eighteen audio coordinates, in order: `AudioFeatures::NAMES` in
 *  crates/auracle-features/src/audio.rs (www/reference/src/features/audio.md). */
export const PHI_AUDIO = [
  "brightness", "movement", "rolloff", "noisiness", "flux", "zero-cross", "level", "level swing",
  "crest", "attack", "tail", "bass", "held move", "high note", "chord noise", "slow motion", "mid motion", "fast motion",
];

/**
 * A φ fingerprint: one bar per coordinate, standardized (−2…+2 σ about a
 * centre line). `values` has 18 entries; bars grow with `u`.
 */
export function phiBars(parent, over, { x, y, w = 900, h = 260, color = "a", labels = true, values }) {
  const g = el("g", {}, parent);
  const n = values.length;
  const bw = w / n;
  const mid = y + h / 2;
  el("line", { x1: x, y1: mid, x2: x + w, y2: mid, stroke: ink("--hairline"), "stroke-width": 2 }, g);
  const bg = el("g", {}, g);
  bg.style.filter = GLOW[color];
  const bars = values.map((v, i) => el("rect", { x: x + i * bw + bw * 0.18, width: bw * 0.64, y: mid, height: 0, rx: 2, fill: PHOS[color] }, bg));
  const lbls = labels
    ? values.map((_, i) => {
        const t = el("div", { class: "mono" }, over, PHI_AUDIO[i] || "");
        place(t, { x: x + i * bw + bw / 2, y: y + h + 16, ax: 0.5 });
        Object.assign(t.style, { fontSize: "var(--t-frame-1)", color: ink("--silk-mute"), writingMode: "vertical-rl", transform: "rotate(180deg)", transformOrigin: "50% 0" });
        return t;
      })
    : [];
  return {
    g,
    update(u, vals = values, { hi = -1 } = {}) {
      vals.forEach((v, i) => {
        const k = clamp(u * n - i * 0.6, 0, 1);
        const hh = (h / 2) * clamp(Math.abs(v) / 2.2, 0, 1) * E.out3(k);
        bars[i].setAttribute("y", v >= 0 ? mid - hh : mid);
        bars[i].setAttribute("height", hh);
        bars[i].setAttribute("opacity", hi < 0 || hi === i ? 1 : 0.35);
      });
      lbls.forEach((l, i) => (l.style.opacity = clamp(u * 2 - 0.2) * (hi < 0 || hi === i ? 1 : 0.5)));
    },
  };
}

// ---- the posterior: a cloud of tastes ----------------------------------------

/**
 * A set of candidate tastes (unit arrows from an origin), each weighted by
 * how well it explains the picks so far. `update(picks, u)` fades out the
 * arrows a pick rules out: a pick of B over A keeps θ with θ·(b − a) > 0.
 */
export function tasteCloud(parent, { cx, cy, r = 300, n = 160, seed = 3, color = "b" }) {
  const R = rng(seed);
  const g = el("g", {}, parent);
  const arrows = [];
  for (let i = 0; i < n; i++) {
    const a = R() * Math.PI * 2;
    const len = r * (0.55 + 0.45 * R());
    const th = [Math.cos(a), Math.sin(a)];
    const line = el("line", { x1: cx, y1: cy, x2: cx + th[0] * len, y2: cy - th[1] * len, stroke: PHOS[color], "stroke-width": 1.4, "stroke-linecap": "round", opacity: 0.6 }, g);
    const tip = el("circle", { cx: cx + th[0] * len, cy: cy - th[1] * len, r: 3, fill: PHOS[color], opacity: 0.8 }, g);
    tip.style.filter = GLOW[color];
    arrows.push({ th, len, line, tip, w: 1 });
  }
  return {
    g,
    arrows,
    /** picks: [{d: [dx, dy], u}] — each pick's preferred direction (b − a) and how far it has landed (0..1). */
    update(picks, { grow = 1, sharpen = 0 } = {}) {
      for (const a of arrows) {
        let w = 1;
        for (const p of picks) {
          const dot = a.th[0] * p.d[0] + a.th[1] * p.d[1];
          // A soft likelihood: logistic in the margin, sharpened as the pick lands.
          const k = 5 + 12 * sharpen;
          const lik = 1 / (1 + Math.exp(-k * dot));
          w *= lerp(1, lik * 1.8, p.u);
        }
        a.w = clamp(w, 0, 1.6);
        const vis = clamp(a.w) * grow;
        a.line.setAttribute("opacity", (0.03 + 0.72 * vis).toFixed(3));
        a.tip.setAttribute("opacity", (0.03 + 0.9 * vis).toFixed(3));
        // A ruled-out taste also shrinks back toward the origin.
        const L = a.len * grow * (0.25 + 0.75 * clamp(a.w));
        a.line.setAttribute("x2", cx + a.th[0] * L);
        a.line.setAttribute("y2", cy - a.th[1] * L);
        a.tip.setAttribute("cx", cx + a.th[0] * L);
        a.tip.setAttribute("cy", cy - a.th[1] * L);
      }
    },
    /** The weighted mean direction, for drawing "the" taste. */
    mean() {
      let x = 0;
      let y = 0;
      for (const a of arrows) {
        x += a.th[0] * a.w;
        y += a.th[1] * a.w;
      }
      const m = Math.hypot(x, y) || 1;
      return [x / m, y / m];
    },
  };
}
