// The illustration kit: the instrument's parts, drawn as the films need them.
//
// Every piece takes the time from its scene and draws itself; none keeps its
// own clock. Colours are the two phosphors and nothing else: green (`a`) is
// sound, amber (`b`) is the model's mind.

import { el, place, clamp, lerp, ramp, E, rng, noise1 } from "./stage.js";

export const PHOS = { a: "#8ef0b1", b: "#ffb454" };
export const PHOS_DIM = { a: "#63a97c", b: "#b8823c" };
export const PHOS_DEEP = { a: "#3d6a4d", b: "#6e4d22" };
const GLOW = {
  a: "drop-shadow(0 0 2.5px rgba(142,240,177,.95)) drop-shadow(0 0 12px rgba(142,240,177,.38))",
  b: "drop-shadow(0 0 2.5px rgba(255,180,84,.95)) drop-shadow(0 0 14px rgba(255,180,84,.42))",
};

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
  const head = el("circle", { r: width * 1.6, fill: "#fff", opacity: 0 }, g);
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
 * A panel knob: hairline ring, a phosphor arc for its value, a graphite cap
 * and a silk pointer. `value` in [0,1] over a 270° sweep.
 */
export function knob(parent, { cx, cy, r = 38, label = null, color = "a", labelSize = 16, glow = true, dim = false }) {
  const g = el("g", {}, parent);
  const a0 = (-225 * Math.PI) / 180;
  const sweep = (270 * Math.PI) / 180;
  const arcPath = (u, rr) => {
    const a1 = a0 + sweep * clamp(u);
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p0 = [cx + rr * Math.cos(a0), cy + rr * Math.sin(a0)];
    const p1 = [cx + rr * Math.cos(a1), cy + rr * Math.sin(a1)];
    return `M${p0[0].toFixed(2)} ${p0[1].toFixed(2)}A${rr} ${rr} 0 ${large} 1 ${p1[0].toFixed(2)} ${p1[1].toFixed(2)}`;
  };
  const ringOff = Math.max(5, r * 0.24);
  el("path", { d: arcPath(1, r + ringOff), fill: "none", stroke: "#292e36", "stroke-width": Math.max(2, r * 0.08), "stroke-linecap": "round" }, g);
  const arcG = el("g", {}, g);
  if (glow) arcG.style.filter = GLOW[color];
  const arcW = Math.max(2.2, r * 0.095);
  const arc = el("path", { fill: "none", stroke: dim ? PHOS_DEEP[color] : PHOS[color], "stroke-width": arcW, "stroke-linecap": "round" }, arcG);
  const ghostArc = el("path", { fill: "none", stroke: PHOS.b, "stroke-width": 3.5, "stroke-linecap": "round", opacity: 0 }, g);
  const capId = `cap${Math.floor(cx)}_${Math.floor(cy)}`;
  const defs = el("defs", {}, g);
  const rg = el("radialGradient", { id: capId, cx: "38%", cy: "30%", r: "75%" }, defs);
  el("stop", { offset: "0%", "stop-color": "#3b4048" }, rg);
  el("stop", { offset: "70%", "stop-color": "#1b1e23" }, rg);
  el("stop", { offset: "100%", "stop-color": "#111317" }, rg);
  el("circle", { cx, cy: cy + 3, r, fill: "rgba(0,0,0,.55)" }, g);
  el("circle", { cx, cy, r, fill: `url(#${capId})`, stroke: "#07080a", "stroke-width": 1.5 }, g);
  const ptr = el("line", { x1: cx, y1: cy - r * 0.28, x2: cx, y2: cy - r * 0.86, stroke: "#d9d4c8", "stroke-width": Math.max(1.6, r * 0.085), "stroke-linecap": "round" }, g);
  let text = null;
  if (label) {
    text = el(
      "text",
      {
        x: cx,
        y: cy + r + 36,
        "text-anchor": "middle",
        fill: "#d9d4c8",
        "font-family": "Jost",
        "font-weight": 500,
        "font-size": labelSize,
        "letter-spacing": "0.14em",
      },
      g,
      label.toUpperCase(),
    );
  }
  return {
    g,
    text,
    set(value, { lit = 1, ghost = null, col = color, glowOn = null } = {}) {
      arc.setAttribute("d", arcPath(value, r + ringOff));
      const bright = glowOn == null ? !dim : glowOn;
      arc.setAttribute("stroke", bright ? PHOS[col] : PHOS_DEEP[col]);
      arcG.style.filter = bright && (glow || glowOn) ? GLOW[col] : "none";
      arcG.style.opacity = lit;
      const ang = -225 + 270 * clamp(value);
      ptr.setAttribute("transform", `rotate(${ang + 90} ${cx} ${cy})`);
      if (ghost != null) {
        ghostArc.setAttribute("d", arcPath(ghost, r + ringOff + 6));
        ghostArc.setAttribute("opacity", 0.9);
      } else ghostArc.setAttribute("opacity", 0);
    },
  };
}

// ---- cables ---------------------------------------------------------------

/** A patch cable from p0 to p1 with gravity sag; `draw` plugs it in progressively. */
export function cable(parent, { p0, p1, sag = 80, color = "a", width = 5 }) {
  const g = el("g", {}, parent);
  const d = () => {
    const mx = (p0[0] + p1[0]) / 2;
    const my = Math.max(p0[1], p1[1]) + sag;
    return `M${p0[0]} ${p0[1]} C${lerp(p0[0], mx, 0.6)} ${my} ${lerp(p1[0], mx, 0.6)} ${my} ${p1[0]} ${p1[1]}`;
  };
  const casing = el("path", { d: d(), fill: "none", stroke: "#0c0d10", "stroke-width": width + 5, "stroke-linecap": "round" }, g);
  const glowG = el("g", {}, g);
  glowG.style.filter = GLOW[color];
  const line = el("path", { d: d(), fill: "none", stroke: PHOS[color], "stroke-width": width, "stroke-linecap": "round" }, glowG);
  const pulse = el("path", { d: d(), fill: "none", stroke: "#eafff2", "stroke-width": width * 0.5, "stroke-linecap": "round", opacity: 0 }, glowG);
  const len = line.getTotalLength();
  for (const p of [casing, line]) p.setAttribute("stroke-dasharray", `${len} ${len}`);
  pulse.setAttribute("stroke-dasharray", `26 ${len}`);
  const jacks = [p0, p1].map((p) => el("circle", { cx: p[0], cy: p[1], r: width + 3, fill: "#07080a", stroke: PHOS_DEEP[color], "stroke-width": 2 }, g));
  return {
    g,
    update(t, { draw = 1, flow = 0, opacity = 1 } = {}) {
      const off = len * (1 - clamp(draw));
      casing.setAttribute("stroke-dashoffset", off);
      line.setAttribute("stroke-dashoffset", off);
      g.style.opacity = opacity;
      jacks[1].style.opacity = draw >= 1 ? 1 : 0;
      if (flow > 0 && draw >= 1) {
        pulse.setAttribute("opacity", 0.85 * flow);
        pulse.setAttribute("stroke-dashoffset", -((t * 420) % (len + 26)) + 26);
      } else pulse.setAttribute("opacity", 0);
    },
  };
}

// ---- a module plate -------------------------------------------------------

/**
 * A module as it sits in the rack: a graphite plate with a silk name, a few
 * knobs and a jack on each side. Returns jack positions for cables.
 */
export function plate(layer, svg, { x, y, w = 250, h = 190, name, kind = "", knobs = 2, color = "a", seed = 1 }) {
  const div = place(el("div", { class: "plate" }, layer), { x, y, w, h });
  const title = el("div", { class: "silk" }, div, name);
  Object.assign(title.style, { position: "absolute", left: "18px", top: "14px", fontSize: "19px", letterSpacing: "0.16em" });
  if (kind) {
    const k = el("div", { class: "mono" }, div, kind);
    Object.assign(k.style, { position: "absolute", right: "16px", top: "16px", fontSize: "14px", color: "#6f6c63" });
  }
  for (const [sx, sy] of [[8, 8], [w - 20, 8], [8, h - 20], [w - 20, h - 20]]) {
    const s = el("i", { class: "screw" }, div);
    Object.assign(s.style, { left: `${sx}px`, top: `${sy}px`, width: "10px", height: "10px" });
  }
  const r = rng(seed);
  const ks = [];
  for (let i = 0; i < knobs; i++) {
    const cx = x + (w * (i + 1)) / (knobs + 1);
    const cy = y + h * 0.56;
    const k = knob(svg, { cx, cy, r: Math.min(26, w / (knobs * 3.2)), color });
    const v0 = 0.2 + r() * 0.6;
    k.set(v0);
    ks.push({ k, v0 });
  }
  return {
    div,
    knobs: ks,
    in: [x, y + h * 0.56],
    out: [x + w, y + h * 0.56],
    set opacity(o) {
      div.style.opacity = o;
      for (const { k } of ks) k.g.style.opacity = o;
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
  const tile = el("rect", { x: cx - 16 * s, y: cy - 16 * s, width: 32 * s, height: 32 * s, rx: 7 * s, fill: "#0c0d10" }, g);
  const outer = el("circle", { cx, cy, r: 12 * s, fill: "none", stroke: "#3d6a4d", "stroke-width": 2.2 * s }, g);
  const innerG = el("g", {}, g);
  innerG.style.filter = GLOW.a;
  const inner = el("circle", { cx, cy, r: 7.4 * s, fill: "none", stroke: "#8ef0b1", "stroke-width": 2.6 * s }, innerG);
  const coreG = el("g", {}, g);
  coreG.style.filter = GLOW.b;
  const core = el("circle", { cx, cy, r: 3 * s, fill: "#ffb454" }, coreG);
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
  const ripple = el("circle", { r: 10, fill: "none", stroke: "#d9d4c8", "stroke-width": 2, opacity: 0 }, g);
  const arrow = el(
    "path",
    {
      d: "M0 0 L0 30 L8 23 L13.5 35 L18 33 L12.8 21.5 L23 21.5 Z",
      fill: "#f4f1ea",
      stroke: "#0c0d10",
      "stroke-width": 2,
      "stroke-linejoin": "round",
    },
    g,
  );
  arrow.style.filter = "drop-shadow(0 3px 6px rgba(0,0,0,.6))";
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

/** A two-octave keyboard; `lit` is a set of MIDI notes to light green. */
export function keyboard(parent, { x, y, w = 900, h = 170, low = 48, octaves = 2 }) {
  const g = el("g", {}, parent);
  const whites = [];
  const blacks = [];
  const pattern = [0, 2, 4, 5, 7, 9, 11];
  const nW = octaves * 7 + 1;
  const kw = w / nW;
  for (let i = 0; i < nW; i++) {
    const oct = Math.floor(i / 7);
    const note = low + oct * 12 + pattern[i % 7];
    const r = el("rect", { x: x + i * kw + 1.5, y, width: kw - 3, height: h, rx: 5, fill: "#1d2127", stroke: "#07080a", "stroke-width": 1.5 }, g);
    whites.push({ note, r });
  }
  for (let i = 0; i < nW - 1; i++) {
    const deg = i % 7;
    if (deg === 2 || deg === 6) continue;
    const oct = Math.floor(i / 7);
    const note = low + oct * 12 + pattern[deg] + 1;
    const r = el("rect", { x: x + (i + 1) * kw - kw * 0.3, y, width: kw * 0.6, height: h * 0.62, rx: 4, fill: "#0b0c0e", stroke: "#000", "stroke-width": 1 }, g);
    blacks.push({ note, r });
  }
  return {
    g,
    update(lit = new Set()) {
      for (const { note, r } of whites) {
        const on = lit.has(note);
        r.setAttribute("fill", on ? "#8ef0b1" : "#1d2127");
        r.style.filter = on ? GLOW.a : "none";
      }
      for (const { note, r } of blacks) {
        const on = lit.has(note);
        r.setAttribute("fill", on ? "#63a97c" : "#0b0c0e");
      }
    },
  };
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
 * stage waits for `seeked` before the frame is captured.
 */
export function footage(layer, { src, x, y, w, h, radius = 14, chrome = true }) {
  const wrap = place(el("div", {}, layer), { x, y, w, h });
  Object.assign(wrap.style, {
    borderRadius: `${radius}px`,
    overflow: "hidden",
    background: "#07080a",
    boxShadow: "0 0 0 1px #292e36, 0 40px 90px rgba(0,0,0,.7), 0 0 60px rgba(142,240,177,.06)",
  });
  const inner = el("div", {}, wrap);
  Object.assign(inner.style, { position: "absolute", inset: "0", transformOrigin: "0 0" });
  const v = el("video", { src, muted: "", playsinline: "", preload: "auto" }, inner);
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

/** A callout: a pill label with a leader to a point, drawn on. */
export function callout(layer, svg, { x, y, tx, ty, text, color = "a" }) {
  const line = el("path", { d: `M${x} ${y} L${tx} ${ty}`, stroke: PHOS[color], "stroke-width": 2, fill: "none" }, svg);
  const dot = el("circle", { cx: x, cy: y, r: 6, fill: PHOS[color] }, svg);
  dot.style.filter = GLOW[color];
  const len = Math.hypot(tx - x, ty - y);
  line.setAttribute("stroke-dasharray", `${len} ${len}`);
  const pill = place(el("div", { class: `pill ${color}` }, layer, text), { x: tx, y: ty, ax: tx < x ? 1 : 0, ay: 0.5 });
  return {
    update(u) {
      line.setAttribute("stroke-dashoffset", len * (1 - clamp(u * 1.6)));
      dot.setAttribute("opacity", clamp(u * 4));
      pill.style.opacity = clamp((u - 0.35) * 2.5);
      pill.style.transform = `translateY(${(1 - clamp((u - 0.35) * 2.5)) * 8}px)`;
    },
  };
}

export { GLOW, noise1 };

// ---- a duel card ----------------------------------------------------------

/**
 * One side of an EVOLVE duel: a plate with the side's letter, the patch's
 * name, a screen with its trace, and the two things you can do with it.
 * `under` takes the HTML; `svg` takes the trace (drawn over the screen).
 */
export function duelCard(under, svg, { x, y, w = 620, h = 400, side = "A", name = "—", wave, color = "a" }) {
  const div = place(el("div", { class: "plate" }, under), { x, y, w, h });
  const badge = el("div", {}, div, side);
  Object.assign(badge.style, {
    position: "absolute", left: "22px", top: "20px", width: "46px", height: "46px", borderRadius: "8px",
    border: "1.5px solid #3d6a4d", display: "grid", placeItems: "center",
    fontFamily: "IBM Plex Mono", fontWeight: 600, fontSize: "26px", color: "#8ef0b1",
  });
  const nm = el("div", { class: "mono" }, div, name);
  Object.assign(nm.style, { position: "absolute", left: "86px", top: "28px", fontSize: "26px", color: "#d9d4c8", letterSpacing: "0.02em" });
  const scr = el("div", { class: "screen" }, div);
  Object.assign(scr.style, { left: "22px", top: "86px", width: `${w - 44}px`, height: `${h - 190}px` });
  const hear = el("div", { class: "pill" }, div, `▶  hear ${side}`);
  Object.assign(hear.style, { position: "absolute", left: "22px", bottom: "24px" });
  const pick = el("div", { class: "pill" }, div, `pick ${side}`);
  Object.assign(pick.style, { position: "absolute", right: "22px", bottom: "24px" });
  const tr = scope(svg, { x: x + 40, y: y + 100, w: w - 80, h: h - 218, width: 3, points: 300, wave: wave || voiceWave({ seed: side.charCodeAt(0) }), color });
  const check = el("div", {}, div, "✓");
  Object.assign(check.style, {
    position: "absolute", right: "22px", top: "16px", fontSize: "40px", color: "#8ef0b1",
    textShadow: "0 0 18px rgba(142,240,177,.6)", opacity: 0,
  });
  return {
    div, hear, pick, nm,
    hearPos: [x + 110, y + h - 46],
    pickPos: [x + w - 80, y + h - 46],
    update(t, { level = 0.25, lit = 0, picked = 0, name: nn = null, draw = 1 } = {}) {
      if (nn != null && nm.textContent !== nn) nm.textContent = nn;
      tr.update(t, { amp: level, draw });
      tr.g.style.opacity = 0.35 + 0.65 * clamp(level / 0.7);
      div.style.borderColor = picked > 0 ? `rgba(142,240,177,${0.3 + 0.6 * picked})` : lit > 0 ? `rgba(142,240,177,${0.35 * lit})` : "#292e36";
      div.style.boxShadow = `inset 1px 1px 0 rgba(255,255,255,.07), 0 18px 50px rgba(0,0,0,.55), 0 0 ${40 * picked}px rgba(142,240,177,${0.25 * picked})`;
      hear.classList.toggle("a", lit > 0.5);
      pick.classList.toggle("a", picked > 0.5);
      check.style.opacity = picked;
    },
  };
}

// ---- the PERFORM panel, drawn -----------------------------------------------

export const NAMED = ["Bright", "Snap", "Motion", "Body", "Grit", "Space", "Blend", "Wander"];

/**
 * PERFORM, drawn for a film: screens A and B, the six pads, the eight named
 * controls, the under-the-hood strip and a keyboard. The real view is recorded
 * separately; this is the one a film can take apart.
 */
export function performPanel(under, svg, over, { x = 160, y = 110, w = 1600, name = "Glass Pad", hood = ["cutoff", "reso", "drive", "attack", "release", "mix"] } = {}) {
  const h = 690;
  const div = place(el("div", { class: "plate" }, under), { x, y, w, h });
  for (const [sx, sy] of [[12, 12], [w - 24, 12], [12, h - 24], [w - 24, h - 24]]) {
    const s = el("i", { class: "screw" }, div);
    Object.assign(s.style, { left: `${sx}px`, top: `${sy}px` });
  }
  const title = el("div", { class: "silk" }, div, "PERFORM");
  Object.assign(title.style, { position: "absolute", left: "40px", top: "30px", fontSize: "22px", letterSpacing: "0.2em" });
  const nm = el("div", { class: "mono" }, div, name);
  Object.assign(nm.style, { position: "absolute", left: "200px", top: "31px", fontSize: "22px", color: "#9a958a" });
  // Screens.
  const sA = { x: x + 40, y: y + 82, w: 560, h: 200 };
  const sB = { x: x + w - 600, y: y + 82, w: 560, h: 200 };
  for (const [s, lbl, cls] of [[sA, "A · playing", "a"], [sB, "B · offer", "b"]]) {
    const d = el("div", { class: "screen" }, under);
    place(d, { x: s.x, y: s.y, w: s.w, h: s.h });
    const l = el("div", { class: "mono" }, under, lbl);
    place(l, { x: s.x + 12, y: s.y + 10 });
    Object.assign(l.style, { fontSize: "17px", color: cls === "a" ? "#63a97c" : "#b8823c", zIndex: 2 });
  }
  const trA = scope(svg, { x: sA.x + 24, y: sA.y + 40, w: sA.w - 48, h: sA.h - 60, width: 3, color: "a", points: 320 });
  const trB = scope(svg, { x: sB.x + 24, y: sB.y + 40, w: sB.w - 48, h: sB.h - 60, width: 3, color: "b", points: 320 });
  // Pads, between the screens.
  const padNames = ["Keep", "Back", "Offer", "Take", "Peek", "Freeze"];
  const pads = {};
  padNames.forEach((p, i) => {
    const px0 = x + 640 + (i % 3) * 110 + 5;
    const py0 = y + 92 + Math.floor(i / 3) * 96;
    const d = place(el("div", {}, under), { x: px0, y: py0, w: 100, h: 84 });
    Object.assign(d.style, {
      borderRadius: "10px", border: "1px solid #292e36",
      background: "linear-gradient(180deg,#22262d,#191c21)",
      boxShadow: "inset 1px 1px 0 rgba(255,255,255,.08), 0 6px 14px rgba(0,0,0,.5)",
      display: "grid", placeItems: "end center", paddingBottom: "12px",
      fontFamily: "Jost", fontWeight: 500, fontSize: "15px", letterSpacing: "0.16em", color: "#9a958a",
    });
    d.textContent = p.toUpperCase();
    pads[p.toLowerCase()] = { d, pos: [px0 + 50, py0 + 42] };
  });
  // Named controls.
  const knobs = {};
  const ky = y + 400;
  NAMED.forEach((n, i) => {
    const gapX = i >= 6 ? 40 : 0;
    const cx = x + 120 + i * 186 + gapX;
    const k = knob(svg, { cx, cy: ky, r: 46, label: n, labelSize: 17, color: i === 7 ? "b" : "a" });
    k.set(0.5);
    knobs[n.toLowerCase()] = { k, cx, cy: ky, v: 0.5 };
  });
  el("line", { x1: x + 120 + 5.5 * 186 + 20, y1: ky - 60, x2: x + 120 + 5.5 * 186 + 20, y2: ky + 70, stroke: "#292e36", "stroke-width": 2 }, svg);
  // The under-the-hood strip.
  const hy = y + 590;
  const hoodLbl = el("div", { class: "mono" }, over, "under the hood");
  place(hoodLbl, { x: x + 40, y: hy - 12 });
  Object.assign(hoodLbl.style, { fontSize: "17px", color: "#6f6c63", letterSpacing: "0.08em" });
  const strip = hood.map((n, i) => {
    const cx = x + 330 + i * 150;
    const k = knob(svg, { cx, cy: hy, r: 20, color: "a" });
    k.set(0.4);
    const t = el("div", { class: "mono" }, over, n);
    place(t, { x: cx + 32, y: hy - 12 });
    Object.assign(t.style, { fontSize: "16px", color: "#9a958a" });
    return { k, cx, cy: hy, v: 0.4, t };
  });
  return { div, nm, trA, trB, sA, sB, pads, knobs, strip, h, y, x, w };
}

/** A pad pressed: lit and pushed in (`u` 0..1), in green or amber. */
export function pressPad(p, u, color = "a") {
  const c = color === "a" ? "142,240,177" : "255,180,84";
  p.d.style.borderColor = u > 0.01 ? `rgba(${c},${0.3 + 0.7 * u})` : "#292e36";
  p.d.style.color = u > 0.3 ? (color === "a" ? "#8ef0b1" : "#ffb454") : "#9a958a";
  p.d.style.boxShadow = `inset 1px 1px 0 rgba(255,255,255,.08), 0 ${6 - 4 * u}px 14px rgba(0,0,0,.5), 0 0 ${30 * u}px rgba(${c},${0.35 * u})`;
  p.d.style.transform = `translateY(${2 * u}px)`;
}

// ---- φ: a sound's measurements, as a meter bridge -------------------------

/** The eighteen audio coordinates, in order (www/reference/src/features/audio.md). */
export const PHI_AUDIO = [
  "brightness", "movement", "rolloff", "noisiness", "flux", "zero-cross", "level", "attack",
  "decay", "sustain", "tail", "bass", "held move", "high note", "chord noise", "slow motion", "mid motion", "fast motion",
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
  el("line", { x1: x, y1: mid, x2: x + w, y2: mid, stroke: "#292e36", "stroke-width": 2 }, g);
  const bg = el("g", {}, g);
  bg.style.filter = GLOW[color];
  const bars = values.map((v, i) => el("rect", { x: x + i * bw + bw * 0.18, width: bw * 0.64, y: mid, height: 0, rx: 2, fill: PHOS[color] }, bg));
  const lbls = labels
    ? values.map((_, i) => {
        const t = el("div", { class: "mono" }, over, PHI_AUDIO[i] || "");
        place(t, { x: x + i * bw + bw / 2, y: y + h + 16, ax: 0.5 });
        Object.assign(t.style, { fontSize: "13px", color: "#6f6c63", writingMode: "vertical-rl", transform: "rotate(180deg)", transformOrigin: "50% 0" });
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
