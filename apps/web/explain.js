// Explain anything (Plan-005 task 10, RFC-006 §9; the specimen is prototype
// v2's explain.js, docs/notes/vision-2026-09/prototype/). Point at a control
// on PERFORM's panel (a ? chip appears beside it), press ?, or hold it on a
// phone, and it answers with a figure and one or two plain sentences. From
// BRIGHT's figure, a one-minute lesson on filters starts, using the sound in
// hand as its example.
//
// Every figure is what the engine measured at that moment (ADR-012), never a
// recipe: a control is a direction in φ wired onto this patch's knobs
// (`perform::PALETTE`, `perform_wire`), so what it does is the sound in hand
// rendered twice, the control at its center and turned, each measured by
// `WasmEngine::explain_render` (`auracle_features::explain::Portrait`). Each
// figure draws the measurement its control's direction is made of (words.js
// `FIGURE_OF`), as made dashed and turned lit:
//   - bands: the long-term spectrum (`Portrait::bands`), the turned render
//     against the made one band by band;
//   - onset: the first note's first 400 ms (`Portrait::onset`);
//   - level: the phrase's level and its last 300 ms (`Portrait::level`);
//   - motion: the held note's brightness or level over time
//     (`Portrait::bright`, `Portrait::loud`), whichever the turn moved more;
//   - harmonics: the held note's harmonics (`Portrait::held`).
// What moves: a figure draws its turned measurement in along its own axis
// (time, or the spectrum from the bottom), at the phrase's own pace where the
// axis is time, and holds; MOTION's figure runs the held note's measured
// track at its real rate while it is open. Nothing is interpolated between
// two measurements. Under reduced motion every figure is drawn whole at once.
//
// The lesson renders the sound in hand through a lowpass from the grammar
// (`WasmEngine::lesson_filter`): its spectrum and its audition, and the
// filter's response from quiver's own filter. The patch itself never changes.
//
// main.js owns the worker, the audio and the bench; perform.js owns the
// controls (`explainOf`: what to render; `hear`: the sweep by ear). This
// module draws, and asks. Its sentences are words.js's, unit-tested.

// The portrait's bands (auracle_features::explain): keep in step.
const NB = 40;
const LO_HZ = 35;
const HI_HZ = 14000;
const FLOOR_DB = -60;
// The figure's drawing box, in CSS pixels; the canvas is drawn at the
// device's pixel ratio.
const W = 320;
const H = 140;
// The lesson's two canvases.
const VW = 200;
const VH = 300;
const FW = 320;
const FH = 150;
// The lesson's cutoff runs over the knob's corner on the held note, within
// the portrait's bands; it starts high, so the first drag is down.
const CUT_LO_HZ = 100;
const CUT_HI_HZ = 14000;
const CUT_START_HZ = 12000;
// A turn's figure follows the control once it has rested this long: a
// timer (when it asks), not a motion.
const FOLLOW_MS = 300;
// How often an open figure checks its control's state (a new measurement,
// a drift) and that what it was asked about is still in sight.
const WATCH_MS = 400;
// Replies kept, by what they were asked about.
const CACHE_MAX = 24;

export function createExplain(host) {
  const { words, tok, canvasFont, motionMs, INK, inkAlpha } = host;
  const {
    PALETTE, FIGURE_OF, EXPLAIN_UI: UI, explainTitle, explainSays, explainAlt, hzWord, msWord, dbWord,
    LESSON_TITLE, LESSON_BUTTON, LESSON_LENGTH, lessonSteps, cutoffWord, lessonPlay, stepOf,
  } = words;
  const hair = () => tok("--hairline");
  const mute = () => tok("--silk-mute");
  const reduced = () => motionMs("--d-move") === 0;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const perf = () => host.perform();

  // ---------- drawing helpers ----------
  function sizeCanvas(cv, w, h) {
    const dpr = window.devicePixelRatio || 1;
    const Wd = Math.round(w * dpr);
    const Hd = Math.round(h * dpr);
    if (cv.width !== Wd || cv.height !== Hd) {
      cv.width = Wd;
      cv.height = Hd;
    }
    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }
  // Canvas text at the canvas floor, in device pixels (taste.js's rule).
  function text(ctx, s, x, y, align = "left", color = INK.silkDim) {
    const dpr = window.devicePixelRatio || 1;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.font = canvasFont(dpr);
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.fillText(s, x * dpr, y * dpr);
    ctx.restore();
  }
  function box(ctx, b) {
    ctx.strokeStyle = hair();
    ctx.lineWidth = 1;
    ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w, b.h);
  }
  // As made: a dashed silk line.
  function madeLine(ctx) {
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = inkAlpha(INK.silk, 0.6);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // The made measurement: dashed beside a turned one, lit when it is the
  // whole figure (a control nothing turns here).
  function baseLine(ctx, turned, w = 2) {
    if (turned) madeLine(ctx);
    else litLine(ctx, w);
  }
  // Turned: the sound's green, lit.
  function litLine(ctx, w = 2) {
    ctx.strokeStyle = INK.green;
    ctx.lineWidth = w;
    ctx.shadowColor = inkAlpha(INK.green, 0.6);
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
  function dot(ctx, x, y) {
    ctx.beginPath();
    ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = INK.green;
    ctx.fill();
  }
  // A band's place on a log-frequency axis, 0 at the lowest band's center.
  const bandOfHz = (hz) => (NB * Math.log(hz / LO_HZ)) / Math.log(HI_HZ / LO_HZ) - 0.5;
  const hzOfBand = (b) => LO_HZ * Math.pow(HI_HZ / LO_HZ, (b + 0.5) / NB);
  // A path through points [x, y], gaps (null) breaking it.
  function polyline(ctx, pts) {
    ctx.beginPath();
    let pen = false;
    for (const p of pts) {
      if (!p) {
        pen = false;
        continue;
      }
      if (pen) ctx.lineTo(p[0], p[1]);
      else ctx.moveTo(p[0], p[1]);
      pen = true;
    }
  }

  // A spectrum stood up, as the face stands one (low at the base): each
  // band's level from the floor to 0 dB is its half-width. `faces:` once
  // faces land (Plan-005 task 3, vessel.js `drawVessel`), the sound's face
  // is the face of its render whitened against the bank; this is the same
  // render's spectrum before whitening, so its copy says "its spectrum".
  function shapePath(ctx, bands, b, upto = NB) {
    const half = (d) => ((clamp(d, FLOOR_DB, 0) - FLOOR_DB) / -FLOOR_DB) * (b.w / 2);
    const y = (i) => b.y + b.h - (i / (NB - 1)) * b.h;
    const cx = b.x + b.w / 2;
    const n = Math.max(2, Math.min(NB, upto));
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const p = [cx + half(bands[i]), y(i)];
      if (i) ctx.lineTo(p[0], p[1]);
      else ctx.moveTo(p[0], p[1]);
    }
    for (let i = n - 1; i >= 0; i--) ctx.lineTo(cx - half(bands[i]), y(i));
    ctx.closePath();
  }
  const bandY = (b, i) => b.y + b.h - (clamp(i, 0, NB - 1) / (NB - 1)) * b.h;

  // ---------- the figures ----------
  // Each returns {paint(k, t), dur, loop}: `k` is how much of the turned
  // measurement is drawn (0 to 1), `t` seconds since it began. `dur` is how
  // long the drawing takes (s): the phrase's own time where the axis is
  // time, else twice `--d-move`, and 0 under reduced motion.
  const spectralDur = () => (2 * motionMs("--d-move")) / 1000;

  // BRIGHT, BODY, WARMTH, AIR: the spectrum, the turned render against the
  // made one (`Portrait::bands`), and the difference band by band.
  function bandsFigure(ctx, c, made, turned) {
    const L = { x: 10, y: 10, w: 58, h: H - 36 };
    const R = { x: 138, y: 10, w: W - 152, h: H - 36 };
    const zx = R.x + R.w / 2;
    const f = turned ? turned.facts : made.facts;
    // The line it listens to: BRIGHT the spectrum's center, AIR where the
    // top rolls off, the weight controls 250 Hz (φ's bass_fraction).
    const markHz = c.name === "Bright" ? f.centroid_hz : c.name === "Air" ? f.rolloff_hz : 250;
    const paint = (k) => {
      ctx.clearRect(0, 0, W, H);
      shapePath(ctx, made.bands, L);
      baseLine(ctx, turned, 1.2);
      if (turned) {
        const upto = Math.round(NB * k);
        if (upto >= 2) {
          shapePath(ctx, turned.bands, L, upto);
          ctx.fillStyle = inkAlpha(INK.green, 0.12);
          ctx.fill();
          litLine(ctx, 1.2);
        }
      }
      for (const hz of [100, 1000, 10000]) {
        const y = bandY(L, bandOfHz(hz));
        ctx.fillStyle = mute();
        ctx.fillRect(74, y, 5, 1);
        text(ctx, hzWord(hz), 83, y + 4);
      }
      box(ctx, R);
      ctx.fillStyle = inkAlpha(INK.silkDim, 0.5);
      ctx.fillRect(zx, R.y, 1, R.h);
      const my = bandY(L, bandOfHz(markHz));
      ctx.setLineDash([2, 3]);
      ctx.strokeStyle = inkAlpha(INK.silk, 0.55);
      ctx.beginPath();
      ctx.moveTo(L.x, my);
      ctx.lineTo(R.x + R.w, my);
      ctx.stroke();
      ctx.setLineDash([]);
      if (turned) {
        const upto = Math.round(NB * k);
        const pts = [];
        for (let i = 0; i < upto; i++) {
          const d = clamp(turned.bands[i] - made.bands[i], -24, 24);
          pts.push([zx + (d / 24) * (R.w / 2), bandY(R, i)]);
        }
        if (pts.length > 1) {
          polyline(ctx, pts);
          litLine(ctx);
        }
      }
      text(ctx, "−24", R.x, H - 8);
      text(ctx, "0", zx, H - 8, "center");
      text(ctx, "+24 dB", R.x + R.w, H - 8, "right");
    };
    return { paint, dur: spectralDur(), loop: false };
  }

  // SNAP, ROUND: the first note's first 400 ms in φ's attack windows
  // (`Portrait::onset`, re the note's peak), with where each reaches 90% of
  // it (φ's `attack_s`, `Facts::attack_ms`).
  function onsetFigure(ctx, c, made, turned) {
    const G = { x: 30, y: 14, w: W - 44, h: H - 42 };
    const n = made.onset.length;
    const span = n * made.onset_step_s;
    const xOf = (i) => G.x + (i / (n - 1)) * G.w;
    const top = Math.max(1.05, ...made.onset, ...(turned ? turned.onset : []));
    const yOf = (g) => G.y + G.h - (g / top) * G.h;
    const tick = (ms, lit) => {
      const x = G.x + clamp(ms / 1000 / span, 0, 1) * G.w;
      ctx.fillStyle = lit ? INK.green : INK.silkDim;
      ctx.fillRect(x, G.y + G.h - 5, 1, 5);
    };
    const paint = (k) => {
      ctx.clearRect(0, 0, W, H);
      box(ctx, G);
      polyline(ctx, made.onset.map((g, i) => [xOf(i), yOf(g)]));
      baseLine(ctx, turned);
      tick(made.facts.attack_ms, false);
      if (turned) {
        const upto = Math.max(1, Math.round((n - 1) * k));
        polyline(ctx, turned.onset.slice(0, upto + 1).map((g, i) => [xOf(i), yOf(g)]));
        litLine(ctx);
        dot(ctx, xOf(upto), yOf(turned.onset[upto]));
        if (k >= 1) tick(turned.facts.attack_ms, true);
      }
      text(ctx, "0", G.x, H - 8);
      text(ctx, msWord(span * 1000), G.x + G.w, H - 8, "right");
    };
    return { paint, dur: reduced() ? 0 : span, loop: false };
  }

  // SPACE, DISTANCE, HAZE, PUNCH, THUMP, HEFT: the phrase's level against
  // its RMS (`Portrait::level`), the notes' gates above it, and for the
  // space controls the last 300 ms φ's `tail_ratio` reads.
  function levelFigure(ctx, c, made, turned) {
    const G = { x: 34, y: 14, w: W - 46, h: H - 40 };
    const secs = made.seconds;
    const n = made.level.length;
    const xOf = (i) => G.x + ((i + 0.5) * made.level_step_s / secs) * G.w;
    const yOf = (d) => G.y + G.h * (12 - clamp(d, -48, 12)) / 60;
    const tail = ["Space", "Distance", "Haze"].includes(c.name);
    const paint = (k) => {
      ctx.clearRect(0, 0, W, H);
      box(ctx, G);
      if (tail) {
        const x0 = G.x + ((secs - 0.3) / secs) * G.w;
        ctx.fillStyle = inkAlpha(INK.green, 0.07);
        ctx.fillRect(x0, G.y, G.x + G.w - x0, G.h);
      }
      ctx.fillStyle = mute();
      for (const [on, off] of made.notes) ctx.fillRect(G.x + (on / secs) * G.w, G.y - 4, Math.max(1, ((off - on) / secs) * G.w), 2);
      ctx.setLineDash([2, 3]);
      ctx.strokeStyle = inkAlpha(INK.silkDim, 0.6);
      ctx.beginPath();
      ctx.moveTo(G.x, yOf(0));
      ctx.lineTo(G.x + G.w, yOf(0));
      ctx.stroke();
      ctx.setLineDash([]);
      polyline(ctx, made.level.map((d, i) => [xOf(i), yOf(d)]));
      baseLine(ctx, turned, 1.6);
      if (turned) {
        const m = Math.min(turned.level.length, n);
        const upto = Math.max(1, Math.round((m - 1) * k));
        polyline(ctx, turned.level.slice(0, upto + 1).map((d, i) => [xOf(i), yOf(d)]));
        litLine(ctx, 1.6);
        if (k < 1) dot(ctx, xOf(upto), yOf(turned.level[upto]));
      }
      text(ctx, "0 dB", G.x - 4, yOf(0) + 4, "right");
      text(ctx, "0", G.x, H - 8);
      text(ctx, `${secs.toFixed(1)} s`, G.x + G.w, H - 8, "right");
    };
    return { paint, dur: reduced() ? 0 : secs, loop: false };
  }

  // MOTION, THROB, SWAY: the held note over time, the two tracks φ's motion
  // bands are measured on (`Portrait::bright`, Hz; `Portrait::loud`, dB),
  // whichever the turn moved more in φ's currency (an octave of brightness
  // against 6 dB of level). Run at its real rate while open.
  function motionFigure(ctx, c, made, turned) {
    const G = { x: 58, y: 12, w: W - 70, h: H - 38 };
    const sd = (xs) => {
      const v = xs.filter((x) => x != null);
      if (v.length < 2) return 0;
      const m = v.reduce((a, b) => a + b, 0) / v.length;
      return Math.sqrt(v.reduce((a, b) => a + (b - m) * (b - m), 0) / v.length);
    };
    const oct = (p) => p.bright.map((h) => (h ? Math.log2(h) : null));
    const six = (p) => p.loud.map((d) => (d == null ? null : d / 6.02));
    const other = turned || made;
    const useLevel = Math.abs(sd(six(other)) - sd(six(made))) > Math.abs(sd(oct(other)) - sd(oct(made)));
    const track = (p) => (useLevel ? p.loud : p.bright);
    const all = [...track(made), ...track(other)].filter((v) => v != null);
    let lo;
    let hi;
    let yOf;
    let ticks;
    if (useLevel) {
      lo = Math.min(-24, ...all);
      hi = 0;
      yOf = (d) => G.y + G.h - ((d - lo) / (hi - lo)) * G.h;
      ticks = [[0, "0 dB"], [Math.round(lo / 2), dbWord(Math.round(lo / 2))]];
    } else {
      lo = Math.log(Math.max(20, Math.min(...all) / 1.41));
      hi = Math.log(Math.min(20000, Math.max(...all) * 1.41));
      yOf = (h) => G.y + G.h - ((Math.log(h) - lo) / (hi - lo)) * G.h;
      ticks = [100, 1000, 10000].filter((h) => Math.log(h) > lo && Math.log(h) < hi).map((h) => [h, hzWord(h)]);
      if (!ticks.length) ticks = [[Math.exp((lo + hi) / 2), hzWord(Math.exp((lo + hi) / 2))]];
    }
    const n = Math.max(track(made).length, track(other).length);
    const step = made.track_step_s;
    const span = n * step;
    const xOf = (i) => G.x + (i / Math.max(1, n - 1)) * G.w;
    const pts = (p, upto) => track(p).slice(0, upto + 1).map((v, i) => (v == null ? null : [xOf(i), yOf(v)]));
    const paint = (k, t) => {
      ctx.clearRect(0, 0, W, H);
      box(ctx, G);
      for (const [v, label] of ticks) {
        ctx.fillStyle = inkAlpha(INK.silkDim, 0.35);
        ctx.fillRect(G.x, yOf(v), G.w, 1);
        text(ctx, label, G.x - 6, yOf(v) + 4, "right");
      }
      polyline(ctx, pts(made, n));
      baseLine(ctx, turned);
      if (turned) {
        // At its real rate: the head is where the held note is, `t` seconds
        // in, looping while the figure is open.
        const upto = reduced() ? n - 1 : Math.min(n - 1, Math.floor(((t % span) / step)));
        polyline(ctx, pts(turned, upto));
        litLine(ctx);
        const v = track(turned)[upto];
        if (v != null && !reduced()) dot(ctx, xOf(upto), yOf(v));
      }
      text(ctx, "0", G.x, H - 8);
      text(ctx, `${span.toFixed(1)} s`, G.x + G.w, H - 8, "right");
    };
    return { paint, dur: reduced() ? 0 : span, loop: !reduced() && !!turned };
  }

  // GRIT, BITE, LO-FI: the held note's harmonics and what lies between them
  // (`Portrait::held`, bin by bin to 4 kHz): noise fills the gaps (φ's
  // flatness), a sharper edge lifts the top.
  function harmonicsFigure(ctx, c, made, turned) {
    const G = { x: 34, y: 12, w: W - 46, h: H - 38 };
    const n = made.held.length;
    const top = (n - 1) * made.held_step_hz;
    const xOf = (i) => G.x + ((i * made.held_step_hz) / top) * G.w;
    const yOf = (d) => G.y + G.h * (clamp(d, FLOOR_DB, 0) / FLOOR_DB);
    const paint = (k) => {
      ctx.clearRect(0, 0, W, H);
      box(ctx, G);
      polyline(ctx, made.held.map((d, i) => [xOf(i), yOf(d)]));
      baseLine(ctx, turned, 1.4);
      if (turned) {
        const upto = Math.max(1, Math.round((n - 1) * k));
        polyline(ctx, turned.held.slice(0, upto + 1).map((d, i) => [xOf(i), yOf(d)]));
        litLine(ctx, 1.4);
      }
      text(ctx, "0 dB", G.x - 4, G.y + 8, "right");
      text(ctx, "−60", G.x - 4, G.y + G.h, "right");
      text(ctx, "0", G.x, H - 8);
      text(ctx, hzWord(1000), xOf(Math.round(1000 / made.held_step_hz)), H - 8, "center");
      text(ctx, hzWord(2000), xOf(Math.round(2000 / made.held_step_hz)), H - 8, "center");
      text(ctx, hzWord(top), G.x + G.w, H - 8, "right");
    };
    return { paint, dur: spectralDur(), loop: false };
  }

  const FIGURES = { bands: bandsFigure, onset: onsetFigure, level: levelFigure, motion: motionFigure, harmonics: harmonicsFigure };

  // Nothing measured yet: the frame, and what it is waiting for.
  function waitingFigure(ctx, say) {
    return {
      paint: () => {
        ctx.clearRect(0, 0, W, H);
        box(ctx, { x: 10, y: 10, w: W - 20, h: H - 20 });
        text(ctx, say, W / 2, H / 2 + 4, "center", INK.amber);
      },
      dur: 0,
      loop: false,
    };
  }

  // Plays a figure's drawing, then holds (or runs, for a loop). Under
  // reduced motion, the end at once.
  let anim = 0;
  function run(fig) {
    cancelAnimationFrame(anim);
    anim = 0;
    if (!fig.dur && !fig.loop) {
      fig.paint(1, 0);
      return;
    }
    const t0 = performance.now();
    const tick = (now) => {
      const t = (now - t0) / 1000;
      const k = fig.dur ? Math.min(1, t / fig.dur) : 1;
      fig.paint(k, t);
      if (pop.classList.contains("on") && (k < 1 || fig.loop)) anim = requestAnimationFrame(tick);
      else anim = 0;
    };
    anim = requestAnimationFrame(tick);
  }

  // ---------- what is askable ----------
  // A placed control on PERFORM's panel: its knob carries `data-ask`.
  const ASKABLE = "#view-perform .pf-knob[data-index]";
  function tag() {
    document.querySelectorAll(ASKABLE).forEach((n) => {
      if (n.dataset.ask !== "control") n.dataset.ask = "control";
    });
  }
  let tagQueued = false;
  const root = document.getElementById("view-perform");
  if (root) {
    new MutationObserver(() => {
      if (tagQueued) return;
      tagQueued = true;
      requestAnimationFrame(() => {
        tagQueued = false;
        tag();
      });
    }).observe(root, { childList: true, subtree: true });
  }
  tag();

  // ---------- the chip: the sign that you can ask ----------
  // Beside what the pointer is over, never in it: a fixed overlay, so no
  // label moves for it. Hidden on film and in booth mode (`host.chrome`).
  const chip = el("button", "xp-chip", "?");
  chip.type = "button";
  chip.tabIndex = -1;
  chip.setAttribute("aria-label", UI.ask);
  chip.title = UI.askTitle;
  document.body.append(chip);
  let current = null;
  let hideT = 0;
  function showChip(t) {
    current = t;
    clearTimeout(hideT);
    if (!host.chrome()) return chip.classList.remove("on");
    const r = t.getBoundingClientRect();
    if (!r.width || !r.height) return chip.classList.remove("on");
    chip.style.left = `${clamp(r.right - 14, 4, innerWidth - 26)}px`;
    chip.style.top = `${clamp(r.top - 6, 4, innerHeight - 26)}px`;
    chip.classList.add("on");
  }
  function hideChip() {
    clearTimeout(hideT);
    hideT = setTimeout(() => {
      chip.classList.remove("on");
      if (!pop.classList.contains("on")) current = null;
    }, 160);
  }
  document.addEventListener("pointerover", (e) => {
    if (e.pointerType === "touch") return;
    if (e.target === chip) return clearTimeout(hideT);
    const t = e.target.closest?.("[data-ask]");
    if (t) showChip(t);
    else if (current && !e.target.closest?.(".xp")) hideChip();
  });
  document.addEventListener("focusin", (e) => {
    const t = e.target.closest?.("[data-ask]");
    if (t) showChip(t);
  });
  document.addEventListener("scroll", () => chip.classList.remove("on"), true);
  chip.addEventListener("click", () => current && ask(current));

  // ? asks about what holds focus or is under the pointer; Esc closes. In
  // the capture phase, ahead of the app's own ? (the keys card), which it
  // leaves alone when nothing askable is in reach.
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape" && lesson.classList.contains("on")) {
        e.preventDefault();
        e.stopPropagation();
        closeLesson();
        return;
      }
      if (e.key === "Escape" && pop.classList.contains("on")) {
        e.preventDefault();
        e.stopPropagation();
        close();
        return;
      }
      if (e.key !== "?" || e.metaKey || e.ctrlKey || e.target.closest?.("input, textarea, select")) return;
      const focused = document.activeElement?.closest?.("[data-ask]");
      const t = focused || (current && current.matches(":hover") ? current : null);
      if (!t) return;
      e.preventDefault();
      e.stopPropagation();
      ask(t);
    },
    true,
  );

  // ---------- touch: hold to ask ----------
  // A finger held still on a control fills a ring around it; when the ring
  // closes, PERFORM's long press asks (`askHold`, at its own 550 ms), and the
  // answer opens. Moving, or lifting early, is an ordinary touch. The ring
  // waits a moment, so a tap or the start of a turn never shows it.
  const RING_DELAY_MS = 140;
  const ring = el("div", "xp-ring");
  ring.setAttribute("aria-hidden", "true");
  document.body.append(ring);
  let hold = null;
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (e.pointerType !== "touch" || e.target.closest?.(".xp, .xl")) return;
      const t = e.target.closest?.("[data-ask]");
      if (!t) return;
      ring.style.left = `${e.clientX}px`;
      ring.style.top = `${e.clientY}px`;
      ring.classList.remove("on", "done");
      hold = {
        x: e.clientX,
        y: e.clientY,
        id: e.pointerId,
        show: setTimeout(() => {
          if (!hold) return;
          void ring.offsetWidth;
          ring.classList.add("on");
        }, RING_DELAY_MS),
      };
    },
    true,
  );
  const endHold = () => {
    if (!hold) return;
    clearTimeout(hold.show);
    ring.classList.remove("on");
    hold = null;
  };
  document.addEventListener(
    "pointermove",
    (e) => {
      if (hold && e.pointerId === hold.id && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > 10) endHold();
    },
    true,
  );
  document.addEventListener("pointerup", endHold, true);
  document.addEventListener("pointercancel", endHold, true);
  document.addEventListener("contextmenu", (e) => {
    if (e.target.closest?.("[data-ask]") && matchMedia("(pointer: coarse)").matches) e.preventDefault();
  });
  // PERFORM's long press on a touch: answer, and say it was taken.
  function askHold(t) {
    if (!t || !t.matches("[data-ask]")) return false;
    ring.classList.remove("on");
    ring.classList.add("done");
    hold = null;
    navigator.vibrate?.(8);
    ask(t);
    return true;
  }

  // ---------- the answer ----------
  const pop = el("div", "xp");
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-modal", "false");
  pop.setAttribute("aria-labelledby", "xp-title");
  pop.tabIndex = -1;
  document.body.append(pop);
  let shown = null; // {i, el, st, c, key}
  let returnTo = null;
  let watchT = 0;
  let followT = 0;
  // Beside or below what was asked, never over it, with a caret pointing back
  // at it; a sheet along the bottom on a narrow screen (style.css).
  function place(t) {
    pop.removeAttribute("data-side");
    if (matchMedia("(max-width: 700px)").matches) {
      pop.style.left = "";
      pop.style.top = "";
      return;
    }
    const r = t.getBoundingClientRect();
    const pw = pop.offsetWidth;
    const ph = pop.offsetHeight;
    const gap = 12;
    let side = "below";
    let x = r.left + r.width / 2 - pw / 2;
    let y = r.bottom + gap;
    if (y + ph > innerHeight - gap) {
      if (r.top - ph - gap >= 8) {
        side = "above";
        y = r.top - ph - gap;
      } else {
        side = r.right + gap + pw < innerWidth ? "right" : "left";
        x = side === "right" ? r.right + gap : r.left - pw - gap;
        y = r.top + r.height / 2 - ph / 2;
      }
    }
    x = clamp(x, gap, innerWidth - pw - gap);
    y = clamp(y, 8, innerHeight - ph - 8);
    pop.style.left = `${Math.round(x)}px`;
    pop.style.top = `${Math.round(y)}px`;
    pop.dataset.side = side;
    pop.style.setProperty("--cx", `${clamp(r.left + r.width / 2 - x, 18, pw - 18)}px`);
    pop.style.setProperty("--cy", `${clamp(r.top + r.height / 2 - y, 18, ph - 18)}px`);
  }

  // The replies, by what they were asked about (the control, the patch, both
  // sets of knobs and the model's revision, which the standardizer `along`
  // is measured in follows), and the requests still out.
  const cache = new Map();
  const out = new Map(); // token -> key
  let token = 0;
  // The wiring's words are part of it too: a measurement that lands with
  // the control nothing turns changes no knob, but changes what is said.
  const keyOf = (st) => JSON.stringify([host.tasteRev(), st.index, st.tree, st.made, st.turned, st.pending, st.search, st.knobs, st.only]);
  function request(st, key) {
    if ([...out.values()].includes(key)) return;
    token += 1;
    out.set(token, key);
    host.send({ type: "explain", token, tree: st.tree, made: st.made, turned: st.turned, k: st.index });
  }

  function ask(t) {
    const i = Number(t.dataset.i);
    if (!Number.isInteger(i) || !perf()) return;
    if (!pop.classList.contains("on")) returnTo = document.activeElement;
    shown = { i, el: t };
    if (!render()) return;
    pop.classList.add("on");
    chip.classList.remove("on");
    place(t);
    pop.focus({ preventScroll: true });
    clearInterval(watchT);
    watchT = setInterval(watch, WATCH_MS);
  }
  function close() {
    cancelAnimationFrame(anim);
    anim = 0;
    clearInterval(watchT);
    clearTimeout(followT);
    const was = pop.classList.contains("on");
    pop.classList.remove("on");
    shown = null;
    if (was && returnTo && document.contains(returnTo)) returnTo.focus?.({ preventScroll: true });
    returnTo = null;
  }
  // A press anywhere else puts it away; turning the control it explains
  // does not (the figure follows the turn).
  document.addEventListener("pointerdown", (e) => {
    if (!pop.classList.contains("on") || e.target.closest?.(".xp, .xp-chip, .xl")) return;
    if (shown && shown.el.contains(e.target)) return;
    close();
  });
  window.addEventListener("resize", () => {
    if (shown && pop.classList.contains("on")) place(shown.el);
  });
  // PERFORM scrolls on a short screen: the answer follows what it is about.
  root?.addEventListener("scroll", () => {
    if (shown && pop.classList.contains("on")) place(shown.el);
  }, { passive: true });

  // Builds the answer for the control at `shown.i` from what is known now:
  // the engine's reply if there is one, else the frame and a request.
  function render() {
    const st = perf()?.explainOf(shown.i);
    if (!st) {
      close();
      return false;
    }
    const c = PALETTE[st.index];
    const key = keyOf(st);
    const data = cache.get(key) || null;
    const sameAsShown = shown.key === key && pop.querySelector(".xp-fig");
    const sameControl = shown.c === c && pop.querySelector(".xp-fig[title]");
    shown.st = st;
    shown.c = c;
    shown.key = key;
    if (!data && !st.pending) request(st, key);
    if (sameAsShown && !shown.stale) return true;
    // The same control turned, or its sound drifted: the last measurement
    // stays, dimmed, under "listening…" until the new one lands, so the
    // answer does not blink out on every turn.
    if (!data && !st.pending && sameControl) {
      pop.querySelector(".xp-fig").classList.add("old");
      pop.querySelector(".xp-say").textContent = UI.listening;
      return true;
    }
    shown.stale = false;
    const kind = FIGURE_OF[c.name];
    // A render that did not vet (or a request that failed) is said, never
    // drawn: there is nothing measured to draw.
    const failed = !!(data && (data.error || !data.made || data.made.error));
    const made = data && !failed ? data.made.portrait : null;
    const turnedP = data && data.turned && !data.turned.error ? data.turned.portrait : null;
    const say = failed ? UI.failed : explainSays(c, st, made && made.facts, turnedP && turnedP.facts);
    const cv = el("canvas", "xp-fig");
    const ctx = sizeCanvas(cv, W, H);
    cv.style.aspectRatio = `${W} / ${H}`;
    cv.setAttribute("role", "img");
    cv.setAttribute("aria-label", explainAlt(c, host.label(), kind, say));
    let fig;
    if (made) fig = FIGURES[kind](ctx, c, made, st.search ? null : turnedP);
    else fig = waitingFigure(ctx, failed ? "" : UI.listening);
    if (made) {
      cv.title = UI.again;
      cv.addEventListener("click", () => run(fig));
    }
    const keep = pop.contains(document.activeElement) ? document.activeElement.dataset.i : null;
    const head = el("div", "xp-head");
    const title = el("span", "xp-title", explainTitle(c.name));
    title.id = "xp-title";
    const x = el("button", "xp-x", "×");
    x.type = "button";
    x.setAttribute("aria-label", UI.close);
    x.onclick = close;
    head.append(title, x);
    // Every control on the panel, a tap apart, as How it works has them.
    const sw = el("div", "xp-sw");
    sw.setAttribute("role", "group");
    sw.setAttribute("aria-label", UI.others);
    const panel = perf().panel();
    panel.forEach((k, j) => {
      const b = el("button", null, PALETTE[k].name);
      b.type = "button";
      b.dataset.i = String(j);
      b.setAttribute("aria-pressed", String(j === shown.i));
      b.onclick = () => switchTo(j);
      sw.append(b);
      if (keep === String(j)) queueMicrotask(() => b.focus({ preventScroll: true }));
    });
    const p = el("p", "xp-say", say);
    const parts = [head, cv, sw, p];
    const acts = el("div", "xp-acts");
    if (!st.pending && !st.search) {
      const hear = el("button", "xp-hear util-btn", UI.hear);
      hear.type = "button";
      hear.title = UI.hearTitle;
      hear.onclick = () => perf().hear(shown.i);
      acts.append(hear);
    }
    if (c.name === "Bright") {
      const learn = el("button", "xp-learn util-btn", LESSON_BUTTON);
      learn.type = "button";
      learn.append(el("span", "xp-sub", LESSON_LENGTH));
      learn.onclick = () => {
        close();
        openLesson();
      };
      acts.append(learn);
    }
    if (acts.childNodes.length) parts.push(acts);
    pop.replaceChildren(...parts);
    run(fig);
    return true;
  }
  function switchTo(j) {
    const t = document.querySelector(`#view-perform .pf-knob[data-i="${j}"]`);
    if (!t) return;
    shown = { i: j, el: t };
    render();
    place(t);
  }
  pop.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    if (!shown) return;
    const n = perf().panel().length;
    e.preventDefault();
    e.stopPropagation();
    switchTo((shown.i + (e.key === "ArrowRight" ? 1 : -1) + n) % n);
  });
  // The answer follows its control and its patch: a turn, once it rests, a
  // new measurement, a drift. And it belongs to what it was asked about: out
  // of sight, it closes.
  function watch() {
    if (!shown || !pop.classList.contains("on")) return;
    const r = shown.el.getBoundingClientRect();
    if (!document.contains(shown.el) || !r.width) {
      const again = document.querySelector(`#view-perform .pf-knob[data-i="${shown.i}"]`);
      if (again && again.getBoundingClientRect().width) shown.el = again;
      else return close();
    }
    const st = perf()?.explainOf(shown.i);
    if (st && keyOf(st) !== shown.key) render();
  }
  function controlTurned(i) {
    if (!shown || shown.i !== i || !pop.classList.contains("on")) return;
    clearTimeout(followT);
    followT = setTimeout(() => shown && render(), FOLLOW_MS);
  }

  // ---------- the lesson: what a filter does ----------
  const lesson = el("div", "xl");
  lesson.setAttribute("role", "dialog");
  lesson.setAttribute("aria-modal", "true");
  lesson.setAttribute("aria-labelledby", "xl-title");
  document.body.append(lesson);
  const L = {
    step: 0,
    name: "",
    tree: null,
    overrides: null,
    bright: null,
    plain: null, // the sound in hand's reply: {data, buffer}
    filtered: null, // the latest filtered reply
    cutoff: null, // the knob the player set (0–1)
    asked: null, // the cutoff of the request out, or "plain"
    want: null, // a cutoff waiting for that request to land
    token: 0,
    returnTo: null,
    src: null,
    srcStart: 0,
    playing: false,
    raf: 0,
  };
  const knobOfHz = (hz) => Math.log(hz / 20) / Math.log(1000);
  const hzOfKnob = (x) => 20 * Math.pow(1000, x);
  function openLesson() {
    const p = perf();
    const s = p?.sounding();
    if (!s) return;
    const bi = p.panel().indexOf(0);
    const b = bi >= 0 ? p.explainOf(bi) : null;
    Object.assign(L, {
      step: 0,
      name: host.label(),
      tree: s.tree,
      overrides: s.overrides,
      bright: b,
      plain: null,
      filtered: null,
      cutoff: knobOfHz(CUT_START_HZ),
      asked: null,
      want: null,
      returnTo: document.activeElement,
    });
    lesson.classList.add("on");
    askLesson(null);
    renderLesson();
  }
  function closeLesson() {
    if (!lesson.classList.contains("on")) return;
    stopLesson();
    cancelAnimationFrame(L.raf);
    L.raf = 0;
    lesson.classList.remove("on");
    L.returnTo?.focus?.({ preventScroll: true });
  }
  // One request out at a time; the latest cutoff waits for it.
  function askLesson(cutoff) {
    const what = cutoff == null ? "plain" : cutoff;
    if (L.asked != null) {
      L.want = what;
      return;
    }
    L.asked = what;
    L.token += 1;
    host.send({ type: "explain_lesson", token: L.token, tree: L.tree, overrides: L.overrides, cutoff });
  }
  function lessonReply(m) {
    if (m.token !== L.token || !lesson.classList.contains("on")) return;
    L.asked = null;
    const buffer = m.buffer && m.buffer.length ? host.audio.ctx.createBuffer(1, m.buffer.length, m.sampleRate) : null;
    if (buffer) buffer.copyToChannel(m.buffer, 0);
    const reply = { data: m.data || { error: m.error }, buffer };
    if (m.cutoff == null) L.plain = reply;
    else L.filtered = reply;
    if (L.playing) startLesson();
    if (L.want != null) {
      const w = L.want;
      L.want = null;
      askLesson(w === "plain" ? null : w);
    } else if (L.step === 1 && !L.filtered) askLesson(L.cutoff);
    paintLesson();
    if (L.step === 1) {
      const pl = lesson.querySelector(".xl-play");
      if (pl) pl.textContent = lessonPlay(L.name, true, L.playing);
    }
  }
  // The lesson's sound: the step's render, looped, from where the last one
  // was, so a new cutoff is heard in place. Through the app's master, and
  // the app's own phrase stops first.
  function startLesson() {
    const r = L.step === 1 && L.filtered && L.filtered.buffer ? L.filtered : L.plain;
    if (!r || !r.buffer) return;
    const ctx = host.audio.ctx;
    const at = L.src ? (ctx.currentTime - L.srcStart) % r.buffer.duration : 0;
    if (L.src) {
      try { L.src.stop(); } catch { /* already stopped */ }
    }
    host.stopAudition();
    const src = ctx.createBufferSource();
    src.buffer = r.buffer;
    src.loop = true;
    src.connect(host.audio.out);
    src.start(0, at);
    L.src = src;
    L.srcStart = ctx.currentTime - at;
    L.playing = true;
    if (!L.raf) liveLoop();
  }
  function stopLesson() {
    if (L.src) {
      try { L.src.stop(); } catch { /* already stopped */ }
    }
    L.src = null;
    L.playing = false;
  }
  function togglePlay() {
    if (L.playing) stopLesson();
    else startLesson();
    const pl = lesson.querySelector(".xl-play");
    if (pl) pl.textContent = lessonPlay(L.name, L.step === 1, L.playing);
    paintLesson();
  }
  // What is heard now, in the portrait's bands: the output's analyser, each
  // band its loudest bin, in dB re the loudest band (the faces' `liveBands`).
  function liveBands() {
    const a = host.analyser();
    if (!a) return null;
    const bins = new Float32Array(a.frequencyBinCount);
    a.getFloatFrequencyData(bins);
    const nyq = host.audio.ctx.sampleRate / 2;
    const out = [];
    let peak = -Infinity;
    for (let b = 0; b < NB; b++) {
      const e0 = LO_HZ * Math.pow(HI_HZ / LO_HZ, b / NB);
      const e1 = LO_HZ * Math.pow(HI_HZ / LO_HZ, (b + 1) / NB);
      const i0 = clamp(Math.floor((e0 / nyq) * bins.length), 0, bins.length - 1);
      const i1 = clamp(Math.ceil((e1 / nyq) * bins.length), i0, bins.length - 1);
      let m = -Infinity;
      for (let i = i0; i <= i1; i++) m = Math.max(m, bins[i]);
      out.push(m);
      peak = Math.max(peak, m);
    }
    if (!Number.isFinite(peak) || peak < -100) return null;
    return out.map((d) => Math.max(FLOOR_DB, d - peak));
  }
  function liveLoop() {
    paintShape();
    if (lesson.classList.contains("on") && L.playing && !reduced()) L.raf = requestAnimationFrame(liveLoop);
    else L.raf = 0;
  }

  let shapeCv = null;
  let filterCv = null;
  function paintShape() {
    if (!shapeCv) return;
    const ctx = sizeCanvas(shapeCv, VW, VH);
    ctx.clearRect(0, 0, VW, VH);
    const h = VH - 30;
    const w = h * 0.6;
    const b = { x: (VW - w) / 2, y: 12, w, h };
    const plain = L.plain && L.plain.data && L.plain.data.portrait;
    const filt = L.step === 1 && L.filtered && L.filtered.data && L.filtered.data.portrait;
    if (!plain) {
      text(ctx, UI.listening, VW / 2, VH / 2, "center", INK.amber);
      return;
    }
    if (filt) {
      shapePath(ctx, plain.bands, b);
      madeLine(ctx);
      shapePath(ctx, filt.bands, b);
    } else shapePath(ctx, plain.bands, b);
    ctx.fillStyle = inkAlpha(INK.green, 0.14);
    ctx.fill();
    litLine(ctx, 1.8);
    if (L.step === 1) {
      // The cutoff on the shape: above it is what the filter takes away.
      const hz = L.filtered?.data?.cutoff_hz ?? hzOfKnob(L.cutoff);
      const y = bandY(b, bandOfHz(hz));
      ctx.fillStyle = inkAlpha(tok("--bezel"), 0.55);
      ctx.fillRect(0, 0, VW, y);
      ctx.fillStyle = INK.silk;
      ctx.fillRect(b.x - 18, y - 0.75, b.w + 36, 1.5);
      ctx.beginPath();
      ctx.arc(b.x - 18, y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // What you hear, now: the output's spectrum, drawn on the shape's
    // right edge while the lesson plays.
    const live = L.playing ? liveBands() : null;
    if (live) {
      const half = (d) => ((clamp(d, FLOOR_DB, 0) - FLOOR_DB) / -FLOOR_DB) * (b.w / 2);
      polyline(ctx, live.map((d, i) => [b.x + b.w / 2 + half(d), bandY(b, i)]));
      ctx.strokeStyle = INK.silk;
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }
  }
  const fxOf = (hz) => 16 + ((Math.log(hz) - Math.log(CUT_LO_HZ)) / (Math.log(CUT_HI_HZ) - Math.log(CUT_LO_HZ))) * (FW - 32);
  const hzOfFx = (x) => Math.exp(Math.log(CUT_LO_HZ) + ((x - 16) / (FW - 32)) * (Math.log(CUT_HI_HZ) - Math.log(CUT_LO_HZ)));
  function paintFilter() {
    if (!filterCv) return;
    const ctx = sizeCanvas(filterCv, FW, FH);
    ctx.clearRect(0, 0, FW, FH);
    const gy = 14;
    const gh = FH - 44;
    box(ctx, { x: 16, y: gy, w: FW - 32, h: gh });
    const d = L.filtered && L.filtered.data;
    // The filter's response, measured from its impulse (`lesson_filter`'s
    // `response`, quiver's filter as the compiler wires it): the cutoff the
    // reply was for, which the handle leads while a new one renders.
    if (d && d.response) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(17, gy, FW - 34, gh);
      ctx.clip();
      const pts = [];
      d.response.forEach((db, i) => {
        const hz = hzOfBand(i);
        if (hz < CUT_LO_HZ * 0.9 || hz > CUT_HI_HZ * 1.1) return;
        pts.push([fxOf(hz), gy + (clamp(-db, 0, 36) / 36) * gh]);
      });
      polyline(ctx, pts);
      ctx.lineTo(pts[pts.length - 1][0], gy + gh);
      ctx.lineTo(pts[0][0], gy + gh);
      ctx.closePath();
      ctx.fillStyle = inkAlpha(INK.green, 0.14);
      ctx.fill();
      polyline(ctx, pts);
      litLine(ctx);
      ctx.restore();
    }
    const hz = hzOfKnob(L.cutoff);
    const cx = fxOf(clamp(hz, CUT_LO_HZ, CUT_HI_HZ));
    ctx.fillStyle = INK.silk;
    ctx.fillRect(cx - 1, gy - 4, 2, gh + 8);
    ctx.beginPath();
    ctx.arc(cx, gy - 4, 6, 0, Math.PI * 2);
    ctx.fill();
    text(ctx, hzWord(100), 16, FH - 8);
    text(ctx, hzWord(1000), fxOf(1000), FH - 8, "center");
    text(ctx, hzWord(10000), fxOf(10000), FH - 8, "center");
    const left = cx - 16 > 120;
    text(ctx, cutoffWord(hz), left ? cx - 10 : cx + 10, gy + gh - 10, left ? "right" : "left", INK.silk);
    filterCv.setAttribute("aria-valuenow", String(Math.round(hz)));
    filterCv.setAttribute("aria-valuetext", cutoffWord(hz));
  }
  function paintLesson() {
    paintShape();
    paintFilter();
  }
  function setCut(hz) {
    L.cutoff = knobOfHz(clamp(hz, CUT_LO_HZ, CUT_HI_HZ));
    paintLesson();
    askLesson(L.cutoff);
  }
  function renderLesson() {
    const steps = lessonSteps(L.name, L.bright);
    const s = steps[L.step];
    shapeCv = el("canvas", "xl-shape");
    shapeCv.setAttribute("role", "img");
    shapeCv.setAttribute("aria-label", UI.shape(L.name));
    filterCv = null;
    const body = el("div", "xl-body");
    const h = el("h2", "xl-h", s.h);
    h.id = "xl-title";
    body.append(h);
    for (const t of s.p || []) body.append(el("p", null, t));
    if (L.step === 1) {
      filterCv = el("canvas", "xl-filter");
      filterCv.tabIndex = 0;
      filterCv.setAttribute("role", "slider");
      filterCv.setAttribute("aria-label", UI.cutoff);
      filterCv.setAttribute("aria-valuemin", String(CUT_LO_HZ));
      filterCv.setAttribute("aria-valuemax", String(CUT_HI_HZ));
      let drag = false;
      const at = (e) => hzOfFx(e.clientX - filterCv.getBoundingClientRect().left);
      filterCv.addEventListener("pointerdown", (e) => {
        drag = true;
        filterCv.setPointerCapture(e.pointerId);
        setCut(at(e));
      });
      filterCv.addEventListener("pointermove", (e) => drag && setCut(at(e)));
      filterCv.addEventListener("pointerup", () => (drag = false));
      filterCv.addEventListener("pointercancel", () => (drag = false));
      filterCv.addEventListener("keydown", (e) => {
        const hz = hzOfKnob(L.cutoff);
        const down = e.key === "ArrowLeft" || e.key === "ArrowDown";
        const up = e.key === "ArrowRight" || e.key === "ArrowUp";
        if (!down && !up) return;
        e.preventDefault();
        e.stopPropagation();
        setCut(down ? hz / 1.12 : hz * 1.12);
      });
      body.append(filterCv);
      if (!L.filtered) askLesson(L.cutoff);
    }
    if (s.list) {
      const ul = el("ul", "xl-list");
      for (const t of s.list) ul.append(el("li", null, t));
      body.append(ul);
    }
    body.append(el("p", "xl-try", s.try));
    if (L.step < 2) {
      const play = el("button", "xl-play util-btn", lessonPlay(L.name, L.step === 1, L.playing));
      play.type = "button";
      play.onclick = togglePlay;
      body.append(play);
    }
    const pips = el("div", "xl-pips");
    pips.setAttribute("aria-hidden", "true");
    steps.forEach((_, i) => pips.append(el("i", i <= L.step ? "on" : null)));
    const back = el("button", "xl-back util-btn", UI.back);
    back.type = "button";
    back.disabled = L.step === 0;
    back.onclick = () => go(L.step - 1);
    const next = el("button", `xl-next util-btn${L.step === steps.length - 1 ? " primary" : ""}`, L.step < steps.length - 1 ? UI.next : UI.done);
    next.type = "button";
    if (L.step < steps.length - 1) next.append(el("kbd", null, "↵"));
    next.onclick = () => (L.step < steps.length - 1 ? go(L.step + 1) : closeLesson());
    const nav = el("div", "xl-nav");
    nav.append(pips, el("span", "xl-count", stepOf(L.step, steps.length)), back, next);
    const top = el("div", "xl-top");
    const x = el("button", "xp-x", "×");
    x.type = "button";
    x.setAttribute("aria-label", UI.close);
    x.onclick = closeLesson;
    top.append(el("span", "xl-cap", LESSON_TITLE), x);
    const main = el("div", "xl-main");
    main.append(shapeCv, body);
    const panel = el("div", "xl-panel");
    panel.dataset.step = String(L.step);
    panel.append(top, main, nav);
    lesson.replaceChildren(panel);
    paintLesson();
    (filterCv || next).focus({ preventScroll: true });
  }
  function go(step) {
    L.step = clamp(step, 0, 2);
    // The step's sound: the filtered one on the filter's step, else the plain.
    if (L.playing) startLesson();
    renderLesson();
  }
  // Space plays the lesson's sound (ADR-016); Enter steps on; Tab stays in
  // the lesson. Every other key goes on to the app (the note keys play).
  lesson.addEventListener("keydown", (e) => {
    if (e.key === " " && !e.target.closest("button")) {
      e.preventDefault();
      e.stopPropagation();
      togglePlay();
      return;
    }
    if (e.key === "Enter" && !e.target.closest("button") && L.step < 2) {
      e.preventDefault();
      e.stopPropagation();
      go(L.step + 1);
      return;
    }
    if (e.key === "Tab") {
      const f = [...lesson.querySelectorAll("button:not([disabled]), [tabindex='0']")];
      if (!f.length) return;
      const i = f.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) {
        f[f.length - 1].focus();
        e.preventDefault();
      } else if (!e.shiftKey && i === f.length - 1) {
        f[0].focus();
        e.preventDefault();
      }
    }
  });
  lesson.addEventListener("click", (e) => {
    if (e.target === lesson) closeLesson();
  });

  function onWorker(m) {
    if (m.type === "explain_lesson") return lessonReply(m);
    if (m.type !== "explain") return;
    const key = out.get(m.token);
    if (key == null) return;
    out.delete(m.token);
    cache.set(key, m.error ? { error: m.error } : { made: m.made, turned: m.turned || null });
    while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
    if (shown && shown.key === key) {
      shown.stale = true;
      render();
    }
  }

  return {
    onWorker,
    askHold,
    controlTurned,
    // A view change puts the answer away: it belongs to where it was asked.
    close() {
      close();
      closeLesson();
    },
    openLesson,
  };
}
