// The film stage: a deterministic motion-graphics timeline.
//
// A frame is a pure function of time. Every scene is built once and then told
// the time; nothing animates by itself (no CSS transitions, no timers), so
// `seek(t)` draws exactly the same frame whether it is called in order, out
// of order, in a preview tab or by tools/render.mjs capturing frame 1 874 of
// 2 550. That is what lets a film be re-rendered from the repo, bit for bit,
// after the voice or the music changes.
//
// Timing comes from outside: tools/timeline.py lays the narration and the
// music grid out and writes `timeline.json`, and a film's scenes are pinned to
// its cues — never to hand-typed seconds that the next voice take would break.

export const W = 1920;
export const H = 1080;

// ---- easing -------------------------------------------------------------

export const E = {
  lin: (u) => u,
  in2: (u) => u * u,
  out2: (u) => 1 - (1 - u) * (1 - u),
  io2: (u) => (u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u)),
  in3: (u) => u * u * u,
  out3: (u) => 1 - Math.pow(1 - u, 3),
  io3: (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2),
  out4: (u) => 1 - Math.pow(1 - u, 4),
  io4: (u) => (u < 0.5 ? 8 * u ** 4 : 1 - Math.pow(-2 * u + 2, 4) / 2),
  out5: (u) => 1 - Math.pow(1 - u, 5),
  outExpo: (u) => (u >= 1 ? 1 : 1 - Math.pow(2, -10 * u)),
  ioExpo: (u) =>
    u <= 0 ? 0 : u >= 1 ? 1 : u < 0.5 ? Math.pow(2, 20 * u - 10) / 2 : (2 - Math.pow(2, -20 * u + 10)) / 2,
  outBack: (u, s = 1.5) => 1 + (s + 1) * Math.pow(u - 1, 3) + s * Math.pow(u - 1, 2),
  ioSine: (u) => -(Math.cos(Math.PI * u) - 1) / 2,
  outSine: (u) => Math.sin((u * Math.PI) / 2),
};

export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, u) => a + (b - a) * u;

/** 0→1 as t goes t0→t1, eased. */
export function ramp(t, t0, t1, ease = E.io3) {
  if (t1 <= t0) return t >= t1 ? 1 : 0;
  return ease(clamp((t - t0) / (t1 - t0)));
}

/** Up over [a,b], down over [c,d]. */
export function fade(t, a, b, c = Infinity, d = Infinity, ease = E.io2) {
  return ramp(t, a, b, ease) * (1 - ramp(t, c, d, ease));
}

/** Keyframes: [[t, value, ease?], …]; values are numbers or equal-length arrays. */
export function keys(t, ks) {
  if (t <= ks[0][0]) return ks[0][1];
  for (let i = 1; i < ks.length; i++) {
    const [t1, v1, ease = E.io3] = ks[i];
    const [t0, v0] = ks[i - 1];
    if (t <= t1) {
      const u = ramp(t, t0, t1, ease);
      return Array.isArray(v0) ? v0.map((x, j) => lerp(x, v1[j], u)) : lerp(v0, v1, u);
    }
  }
  return ks[ks.length - 1][1];
}

/** A seeded PRNG (mulberry32), so every "random" scatter is the same each render. */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth 1-D value noise in [-1, 1]; for organic drift that is still deterministic. */
export function noise1(x, seed = 0) {
  const h = (i) => {
    let n = (i * 374761393 + seed * 668265263) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return lerp(h(i), h(i + 1), u) * 2 - 1;
}

// ---- DOM helpers ----------------------------------------------------------

const SVGNS = "http://www.w3.org/2000/svg";

export function el(tag, attrs = {}, parent = null, text = null) {
  const svg = /^(svg|g|path|circle|rect|line|polyline|polygon|text|tspan|defs|linearGradient|radialGradient|stop|clipPath|mask|use|ellipse|filter|feGaussianBlur|feMerge|feMergeNode|foreignObject)$/.test(tag);
  const n = svg ? document.createElementNS(SVGNS, tag) : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === "class") n.setAttribute("class", v);
    else if (k === "style" && typeof v === "object") Object.assign(n.style, v);
    else if (k === "html") n.innerHTML = v;
    else n.setAttribute(k, v);
  }
  if (text != null) n.textContent = text;
  if (parent) parent.appendChild(n);
  return n;
}

export const px = (v) => `${v}px`;

/** Position an absolutely placed HTML element in frame pixels. */
export function place(node, { x, y, w, h, ax = 0, ay = 0 } = {}) {
  node.style.position = "absolute";
  if (x != null) node.style.left = px(x);
  if (y != null) node.style.top = px(y);
  if (w != null) node.style.width = px(w);
  if (h != null) node.style.height = px(h);
  if (ax || ay) node.style.translate = `${-ax * 100}% ${-ay * 100}%`;
  return node;
}

/**
 * Split text into word spans for a voice-synchronised reveal. `*several
 * words*` are lit green, `_several words_` amber, and "\n" breaks the line.
 */
export function words(parent, text, cls = "") {
  const spans = [];
  const re = /\*([^*]+)\*|_([^_]+)_|(\n)|([^\s*_]+)|(\s+)/g;
  let m;
  const add = (w, extra) => spans.push(el("span", { class: `w${extra}${cls ? " " + cls : ""}` }, parent, w));
  while ((m = re.exec(text))) {
    if (m[1] || m[2]) {
      const extra = m[1] ? " ga" : " gb";
      const parts = (m[1] || m[2]).split(/\s+/).filter(Boolean);
      parts.forEach((w, i) => {
        add(w, extra);
        if (i < parts.length - 1) parent.appendChild(document.createTextNode(" "));
      });
    } else if (m[3]) {
      el("br", {}, parent);
    } else if (m[4]) {
      // Punctuation glued to an emphasised run ("*yours*.") joins the last word.
      if (/^[.,!?;:]+$/.test(m[4]) && spans.length) spans[spans.length - 1].textContent += m[4];
      else add(m[4], "");
    } else if (m[5]) {
      parent.appendChild(document.createTextNode(" "));
    }
  }
  return spans;
}

/**
 * Reveal word spans across [t0, t1]: each word lights when the narrator is
 * estimated to reach it (proportional to characters, or exact word times when
 * the timeline carries them).
 */
export function reveal(spans, t, t0, t1, wordTimes = null, lead = 0.08) {
  const n = spans.length;
  if (!n) return;
  let starts;
  if (wordTimes && wordTimes.length === n) {
    starts = wordTimes;
  } else {
    const lens = spans.map((s) => s.textContent.length + 1);
    const total = lens.reduce((a, b) => a + b, 0);
    let acc = 0;
    starts = lens.map((l) => {
      const s = t0 + ((t1 - t0) * acc) / total;
      acc += l;
      return s;
    });
  }
  for (let i = 0; i < n; i++) {
    const u = ramp(t, starts[i] - lead, starts[i] - lead + 0.28, E.out3);
    spans[i].style.setProperty("--u", u.toFixed(4));
  }
}

// ---- the stage ------------------------------------------------------------

export class Stage {
  constructor({ timeline, fps = 30 }) {
    this.tl = timeline;
    this.fps = timeline.fps || fps;
    this.duration = timeline.duration;
    this.frame = document.getElementById("frame");
    this.scenes = [];
    this.pending = [];
    this._grain = null;
    this._buildOverlay();
  }

  /** Cue time by name (a narration line id, a beat id, or a named cue). */
  cue(name, which = "t0") {
    const tl = this.tl;
    if (tl.cues && name in tl.cues) {
      const c = tl.cues[name];
      return typeof c === "number" ? c : c[which];
    }
    const line = tl.lines?.find((l) => l.id === name);
    if (line) return line[which];
    const beat = tl.beats?.find((b) => b.id === name);
    if (beat) return beat[which];
    throw new Error(`no cue "${name}"`);
  }

  line(id) {
    const l = this.tl.lines?.find((x) => x.id === id);
    if (!l) throw new Error(`no line "${id}"`);
    return l;
  }

  /** Music envelope (0–1) at time t, if the timeline carries one. */
  env(t, key = "music") {
    const e = this.tl.env?.[key];
    if (!e) return 0;
    const i = t * e.rate;
    const i0 = Math.floor(i);
    const f = i - i0;
    const a = e.v[clamp(i0, 0, e.v.length - 1)] ?? 0;
    const b = e.v[clamp(i0 + 1, 0, e.v.length - 1)] ?? 0;
    return lerp(a, b, f);
  }

  /** Beat phase at time t on the music grid: {beat, bar, phase in [0,1)}. */
  beat(t) {
    const g = this.tl.grid;
    if (!g) return { beat: 0, bar: 0, phase: 0 };
    const b = (t - g.t0) / (60 / g.bpm);
    const beat = Math.floor(b);
    return { beat, bar: Math.floor(beat / g.meter), phase: b - beat };
  }

  /**
   * Add a scene. `build(layer, stage)` runs once and returns
   * `update(tl, t, stage)`, called with scene-local and absolute time.
   * The layer is shown over [t0 - pre, t1 + post] and faded over `fin`/`fout`.
   */
  scene({ id, t0, t1, pre = 0, post = 0, fin = 0, fout = 0, z = 0, build }) {
    const layer = el("div", { class: "layer", "data-scene": id }, this.frame);
    layer.style.zIndex = String(10 + z);
    // Built while displayed, so a scene can measure its own text; hidden after.
    const update = build(layer, this) || (() => {});
    layer.style.display = "none";
    const s = { id, t0, t1, pre, post, fin, fout, layer, update };
    this.scenes.push(s);
    this.frame.insertBefore(this._grainEl, null);
    this.frame.insertBefore(this._vignette, this._grainEl);
    return s;
  }

  /** Scenes can hand back promises (a video seek); seek awaits them. */
  wait(p) {
    this.pending.push(p);
  }

  async seek(t) {
    this.t = t;
    this.pending = [];
    for (const s of this.scenes) {
      const on = t >= s.t0 - s.pre && t < s.t1 + s.post;
      s.layer.style.display = on ? "" : "none";
      if (!on) continue;
      let o = 1;
      if (s.fin > 0) o *= ramp(t, s.t0 - s.pre, s.t0 - s.pre + s.fin, E.io2);
      if (s.fout > 0) o *= 1 - ramp(t, s.t1 + s.post - s.fout, s.t1 + s.post, E.io2);
      s.layer.style.opacity = o.toFixed(4);
      s.update(t - s.t0, t, this);
    }
    this._drawGrain(t);
    if (this.pending.length) await Promise.all(this.pending);
  }

  _buildOverlay() {
    this._vignette = el("div", { id: "vignette" }, this.frame);
    this._grainEl = el("canvas", { id: "grain", width: 960, height: 540 }, this.frame);
    this._grainEl.style.width = "1920px";
    this._grainEl.style.height = "1080px";
    // Six fixed grain plates, cycled by frame: film grain that is the same on
    // every render.
    const r = rng(7);
    this._plates = [];
    for (let k = 0; k < 6; k++) {
      const c = document.createElement("canvas");
      c.width = 960;
      c.height = 540;
      const g = c.getContext("2d");
      const img = g.createImageData(960, 540);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = Math.floor(r() * 255);
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      this._plates.push(c);
    }
  }

  _drawGrain(t) {
    // The frame breathes with the music: the vignette opens a little on each
    // swell (the mix's own envelope, written by tools/mix.py).
    this._vignette.style.opacity = (1 - 0.22 * this.env(t)).toFixed(3);
    // Grain changes every third frame: alive, but cheap for the encoder.
    const k = Math.floor((t * this.fps) / 3) % this._plates.length;
    const g = this._grainEl.getContext("2d");
    g.drawImage(this._plates[k], 0, 0);
  }
}

// ---- boot -----------------------------------------------------------------

/**
 * Load a film: fetch its timeline, build it, and expose the capture hook.
 * Preview: `?t=12.5` shows one frame; `?play` runs in real time from `?t`.
 */
export async function boot(buildFilm, timelineUrl = "timeline.json") {
  const q = new URLSearchParams(location.search);
  const capture = q.has("capture");
  if (capture) document.documentElement.classList.add("capture");
  const timeline = await (await fetch(timelineUrl, { cache: "no-store" })).json();
  await document.fonts.ready;
  await Promise.all(
    ["500 20px Jost", "300 20px Jost", "400 20px 'IBM Plex Mono'", "italic 400 20px Newsreader"].map((f) =>
      document.fonts.load(f),
    ),
  );
  const stage = new Stage({ timeline });
  await buildFilm(stage);
  const fit = () => {
    if (capture) return;
    const s = Math.min(innerWidth / W, innerHeight / H);
    stage.frame.style.transform = `scale(${s})`;
  };
  addEventListener("resize", fit);
  fit();
  const hud = document.getElementById("hud");
  const t0 = Number(q.get("t") || 0);
  await stage.seek(t0);
  if (hud) hud.textContent = `${t0.toFixed(2)} / ${stage.duration.toFixed(2)} s`;
  if (q.has("play") && !capture) {
    const start = performance.now() - t0 * 1000;
    const tick = async () => {
      const t = ((performance.now() - start) / 1000) % stage.duration;
      await stage.seek(t);
      if (hud) hud.textContent = `${t.toFixed(2)} / ${stage.duration.toFixed(2)} s`;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  window.__stage = {
    seek: (t) => stage.seek(t),
    duration: stage.duration,
    fps: stage.fps,
    ready: true,
  };
}
