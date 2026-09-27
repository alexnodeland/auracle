// How Auracle learns what you like. The taste model, drawn: what it hears,
// what one pick tells it, the cloud of tastes that survives, the lenses, the
// forecasts it is scored on, and the search it steers.

import { el, place, clamp, lerp, ramp, fade, E, rng, noise1, words, reveal } from "../../stage/stage.js";
import {
  svgLayer, scope, knob, cable, plate, mark, pointer, glide, textBlock, voiceWave, duelCard, performPanel, pressPad,
  phiBars, tasteCloud, PHOS, GLOW,
} from "../../stage/kit.js";

export async function build(stage) {
  const beat = (id) => stage.tl.beats.find((b) => b.id === id);
  const line = (id) => stage.line(id);
  const ctx = { stage, beat, line };
  sceneHook(ctx);
  sceneHears(ctx);
  sceneEvidence(ctx);
  sceneLenses(ctx);
  sceneForecast(ctx);
  sceneSearch(ctx);
  sceneReading(ctx);
  scenePlaying(ctx);
  sceneOutro(ctx);
}

function stack(layer) {
  const under = el("div", { class: "layer" }, layer);
  const svg = svgLayer(layer);
  const over = el("div", { class: "layer" }, layer);
  return { under, svg, over };
}

function voiceLine(over, text, { y = 980, size = 50, w = 1700 } = {}) {
  const d = textBlock(over, { x: 960, y, w, cls: "voice", size, align: "center", ax: 0.5, ay: 0.5 });
  return { d, sp: words(d, text) };
}

/** Show a line's words over its own span; returns nothing. */
function speak(v, t, l, next, { lead = 0.25 } = {}) {
  v.d.style.opacity = fade(t, l.t0 - lead, l.t0 + 0.05, next - 0.35, next - 0.1);
  reveal(v.sp, t, l.t0, l.t1);
}

/** When the narrator reaches `word` in a line (estimated by characters). */
function wordTime(l, word) {
  const i = l.text.toLowerCase().indexOf(word.toLowerCase());
  if (i < 0) return l.t0;
  if (l.words) {
    const idx = l.text.slice(0, i).split(/\s+/).filter(Boolean).length;
    return l.words[Math.min(idx, l.words.length - 1)];
  }
  return l.t0 + ((l.t1 - l.t0) * i) / l.text.length;
}

const PHI_A = [-1.1, -0.4, -1.0, -0.8, -0.6, -1.0, 0.3, -0.2, 0.9, 1.2, 0.8, 1.4, -0.3, -0.9, -0.5, 0.9, -0.2, -0.6];
const PHI_B = [1.4, 0.9, 1.3, 0.6, 1.0, 1.2, 0.5, 1.5, -0.6, -0.9, -0.4, -0.7, 0.8, 0.9, 0.4, -0.3, 1.1, 0.5];

// ---------------------------------------------------------------------------

function sceneHook({ stage, beat, line }) {
  const b = beat("hook");
  const l1 = line("hook1");
  const l2 = line("hook2");
  stage.scene({
    id: "hook", t0: b.t0, t1: b.t1, post: 0.6, fout: 0.6,
    build(layer) {
      const { under, svg, over } = stack(layer);
      const A = duelCard(under, svg, { x: 190, y: 250, w: 700, h: 430, side: "A", name: "Low Lantern", wave: voiceWave({ f: 1.4, bright: 0.15, seed: 3 }) });
      const B = duelCard(under, svg, { x: 1030, y: 250, w: 700, h: 430, side: "B", name: "Tin Rain", wave: voiceWave({ f: 2.6, bright: 0.8, seed: 4 }) });
      const box = place(el("div", {}, over), { x: 960, y: 170, w: 900, h: 76, ax: 0.5 });
      Object.assign(box.style, { border: "1.5px solid #292e36", borderRadius: "10px", background: "#111318", fontFamily: "Newsreader", fontStyle: "italic", fontSize: "34px", color: "#6f6c63", padding: "14px 24px" });
      box.textContent = "describe the sound you want…";
      const strike = place(el("div", {}, over), { x: 960 - 440, y: 208, h: 3, w: 0 });
      strike.style.background = "#9a958a";
      const v1 = voiceLine(over, "You know which of two sounds you like, long before you can say *why*.");
      const v2 = voiceLine(over, "So Auracle never asks you to describe a sound. *It asks you to choose.*");
      const tDescribe = wordTime(l2, "describe");
      const tChoose = wordTime(l2, "choose");
      const tWhy = wordTime(l1, "like,");
      stage.sfx("blip", tWhy, -4);
      return (tl, t) => {
        const inU = ramp(t, b.t0 - 0.2, b.t0 + 0.9, E.out4);
        A.div.style.opacity = B.div.style.opacity = inU;
        const hearA = fade(t, b.t0 + 0.6, b.t0 + 0.9, tWhy - 0.6, tWhy - 0.3);
        const hearB = fade(t, tWhy - 0.5, tWhy - 0.3, l2.t0, l2.t0 + 0.4);
        const chose = ramp(t, tWhy, tWhy + 0.3);
        A.update(t, { level: 0.2 + 0.45 * hearA, lit: hearA, draw: inU });
        B.update(t, { level: 0.2 + 0.45 * Math.max(hearB, chose * 0.6), lit: hearB, picked: chose * (1 - ramp(t, l2.t0, l2.t0 + 0.4)) + ramp(t, tChoose, tChoose + 0.4) * 0.8, draw: inU });
        box.style.opacity = fade(t, l2.t0 - 0.3, l2.t0 + 0.1, tChoose - 0.2, tChoose + 0.2);
        strike.style.width = `${880 * ramp(t, tDescribe, tDescribe + 0.45, E.io2)}px`;
        strike.style.opacity = box.style.opacity;
        speak(v1, t, l1, l2.t0);
        speak(v2, t, l2, b.t1 + 0.4);
      };
    },
  });
}

// ---------------------------------------------------------------------------

function sceneHears({ stage, beat, line }) {
  const b = beat("hears");
  const l1 = line("hears1");
  const l2 = line("hears2");
  stage.scene({
    id: "hears", t0: b.t0, t1: b.t1, pre: 0.3, post: 0.6, fin: 0.4, fout: 0.6,
    build(layer) {
      const { under, svg, over } = stack(layer);
      const scr = place(el("div", { class: "screen" }, under), { x: 160, y: 150, w: 520, h: 200 });
      const lbl = el("div", { class: "mono" }, under, "Tin Rain · the standard phrase");
      place(lbl, { x: 172, y: 160 });
      Object.assign(lbl.style, { fontSize: "17px", color: "#63a97c", zIndex: 2 });
      const tr = scope(svg, { x: 180, y: 190, w: 480, h: 140, width: 3, wave: voiceWave({ f: 2.6, bright: 0.8, seed: 4 }) });
      const bars = phiBars(svg, over, { x: 820, y: 140, w: 940, h: 250, values: PHI_B });
      const tag18 = place(el("div", { class: "pill a" }, over, "18 · the sound"), { x: 1290, y: 520, ax: 0.5 });
      // Twenty-six structural coordinates: counts and presences of the patch's parts.
      const grid = [];
      const R = rng(5);
      for (let i = 0; i < 26; i++) {
        const x = 820 + (i % 13) * 72;
        const y = 640 + Math.floor(i / 13) * 72;
        const on = R() > 0.55;
        grid.push({ r: el("rect", { x, y, width: 52, height: 52, rx: 8, fill: on ? "#3d6a4d" : "#171a1f", stroke: "#292e36", "stroke-width": 1.5, opacity: 0 }, svg), on });
      }
      const tag26 = place(el("div", { class: "pill" }, over, "26 · how it's built"), { x: 1290, y: 800, ax: 0.5 });
      const flow = el("g", {}, svg);
      flow.style.filter = GLOW.a;
      const streaks = Array.from({ length: 18 }, (_, i) => el("path", { d: `M680 250 C 760 250, 760 ${140 + 125} , ${820 + i * 52 + 26} ${265}`, fill: "none", stroke: "#8ef0b1", "stroke-width": 1.2, opacity: 0 }, flow));
      const v1 = voiceLine(over, "Behind every choice, it listens for the things you hear: *how bright* a sound is, *how noisy*, *how it starts*, and *how fast it moves*.", { size: 46, y: 990 });
      const v2 = voiceLine(over, "That's *eighteen* measurements of every patch's sound, all from the same short phrase, and twenty-six more of how the patch is built.", { size: 46, y: 990 });
      const hot = [
        [wordTime(l1, "how bright"), 0],
        [wordTime(l1, "how noisy"), 3],
        [wordTime(l1, "how it starts"), 7],
        [wordTime(l1, "how fast"), 16],
      ];
      return (tl, t) => {
        tr.update(t, { amp: 0.6, ox: t * 0.3 });
        const u = ramp(t, b.t0 + 0.2, l1.t0 + 1.5, E.io2);
        let hi = -1;
        for (const [ht, i] of hot) if (t >= ht - 0.1 && t < ht + 1.0) hi = i;
        if (t > l1.t1 + 0.2) hi = -1;
        bars.update(u, PHI_B, { hi });
        streaks.forEach((s, i) => s.setAttribute("opacity", 0.35 * fade(t, b.t0 + 0.1 + i * 0.05, b.t0 + 0.5 + i * 0.05, l1.t0 + 1.5, l1.t0 + 2.5)));
        tag18.style.opacity = ramp(t, wordTime(l2, "eighteen"), wordTime(l2, "eighteen") + 0.4);
        const s0 = wordTime(l2, "twenty-six");
        grid.forEach((g, i) => g.r.setAttribute("opacity", ramp(t, s0 - 0.2 + i * 0.03, s0 + 0.2 + i * 0.03)));
        tag26.style.opacity = ramp(t, s0 + 0.5, s0 + 0.9);
        speak(v1, t, l1, l2.t0);
        speak(v2, t, l2, b.t1 + 0.4);
      };
    },
  });
}

// ---------------------------------------------------------------------------
// EVIDENCE and POSTERIOR — one picture: tastes as arrows, ruled out by picks,
// contracting into the mark.

function sceneEvidence({ stage, beat, line }) {
  const b = beat("evidence");
  const bp = beat("posterior");
  const L = ["evidence1", "evidence2", "posterior1", "posterior2"].map(line);
  stage.scene({
    id: "evidence", t0: b.t0, t1: bp.t1, pre: 0.3, post: 0.8, fin: 0.4, fout: 0.8,
    build(layer) {
      const { under, svg, over } = stack(layer);
      // Left: the two fingerprints and the verdict.
      const fa = phiBars(svg, over, { x: 150, y: 170, w: 520, h: 150, labels: false, values: PHI_A });
      const fb = phiBars(svg, over, { x: 150, y: 420, w: 520, h: 150, labels: false, values: PHI_B });
      const la = place(el("div", { class: "mono" }, over, "A  Low Lantern"), { x: 150, y: 140 });
      const lb = place(el("div", { class: "mono" }, over, "B  Tin Rain"), { x: 150, y: 390 });
      for (const q of [la, lb]) Object.assign(q.style, { fontSize: "20px", color: "#9a958a" });
      const verdict = place(el("div", { class: "pill b" }, over, "you picked B over A"), { x: 410, y: 640, ax: 0.5 });
      // Right: the space of tastes. Axes: brightness (x) and motion (y).
      const O = [1300, 450];
      const axes = el("g", {}, svg);
      el("line", { x1: O[0] - 380, y1: O[1], x2: O[0] + 380, y2: O[1], stroke: "#292e36", "stroke-width": 2 }, axes);
      el("line", { x1: O[0], y1: O[1] - 330, x2: O[0], y2: O[1] + 330, stroke: "#292e36", "stroke-width": 2 }, axes);
      const ax1 = place(el("div", { class: "mono" }, over, "brighter →"), { x: O[0] + 380, y: O[1] + 14, ax: 1 });
      const ax2 = place(el("div", { class: "mono" }, over, "↑ more motion"), { x: O[0] + 12, y: O[1] - 330 });
      for (const q of [ax1, ax2]) Object.assign(q.style, { fontSize: "18px", color: "#6f6c63" });
      const cloud = tasteCloud(svg, { cx: O[0], cy: O[1], r: 300, n: 110, seed: 8 });
      // The picks: each one's preferred direction (b − a), in this plane.
      const picks = [
        { d: [0.95, 0.3] },
        { d: [0.5, 0.86] },
        { d: [0.9, -0.2] },
        { d: [0.7, 0.55] },
        { d: [0.98, 0.1] },
        { d: [0.6, 0.75] },
      ];
      const clipId = "tasteclip";
      const defs = el("defs", {}, svg);
      const cp = el("clipPath", { id: clipId }, defs);
      el("circle", { cx: O[0], cy: O[1], r: 340 }, cp);
      const halfplane = el("path", { fill: "rgba(255,180,84,.07)", stroke: "none", opacity: 0, "clip-path": `url(#${clipId})` }, svg);
      const cut = el("line", { stroke: "#b8823c", "stroke-width": 2, "stroke-dasharray": "8 8", opacity: 0 }, svg);
      const mk = mark(svg, { cx: O[0], cy: O[1], size: 260 });
      const v = [
        voiceLine(over, "Each pick is evidence: you liked *this* set of measurements more than *that* one.", { size: 48 }),
        voiceLine(over, "Many tastes could explain one pick. A few picks rule most of them out.", { size: 48 }),
        voiceLine(over, "Auracle keeps every taste that still fits, _weighted by how well it fits_.", { size: 48 }),
        voiceLine(over, "With every answer, that cloud of possible tastes _draws tighter_.", { size: 48 }),
      ];
      const pickT = [L[0].t0 + (L[0].t1 - L[0].t0) * 0.7, L[1].t0 + 1.4, L[1].t0 + 2.0, L[1].t0 + 2.5, L[2].t0 + 0.6, L[2].t0 + 1.4];
      pickT.forEach((pt) => stage.sfx("blip", pt, -8));
      return (tl, t) => {
        const inU = ramp(t, b.t0, b.t0 + 0.8, E.out3);
        fa.update(inU, PHI_A);
        fb.update(inU, PHI_B);
        la.style.opacity = lb.style.opacity = inU;
        verdict.style.opacity = fade(t, pickT[0] - 0.2, pickT[0] + 0.2, L[2].t0 - 0.4, L[2].t0);
        // The cloud grows in, then each pick lands.
        const grow = ramp(t, L[1].t0 - 0.6, L[1].t0 + 0.4, E.out3);
        const landed = picks.map((p, i) => ({ d: p.d, u: ramp(t, pickT[i], pickT[i] + 0.6, E.io2) }));
        const sharpen = ramp(t, L[3].t0, L[3].t1, E.io2);
        cloud.update(landed, { grow, sharpen });
        // The first pick's cut: the line through the origin, normal to b − a.
        const d = picks[0].d;
        const n = [-d[1], d[0]];
        const cu = fade(t, pickT[0], pickT[0] + 0.4, L[1].t0 + 2.6, L[1].t0 + 3.2);
        cut.setAttribute("x1", O[0] + n[0] * 360);
        cut.setAttribute("y1", O[1] - n[1] * 360);
        cut.setAttribute("x2", O[0] - n[0] * 360);
        cut.setAttribute("y2", O[1] + n[1] * 360);
        cut.setAttribute("opacity", cu * grow);
        const far = 900;
        halfplane.setAttribute("d", `M${O[0] + n[0] * far} ${O[1] - n[1] * far} L${O[0] + n[0] * far + d[0] * far} ${O[1] - n[1] * far - d[1] * far} L${O[0] - n[0] * far + d[0] * far} ${O[1] + n[1] * far - d[1] * far} L${O[0] - n[0] * far} ${O[1] + n[1] * far} Z`);
        halfplane.setAttribute("opacity", cu * grow);
        // Draws tighter, until it is the mark.
        const pull = ramp(t, L[3].t1 - 0.4, bp.t1 - 0.2, E.io3);
        cloud.g.style.opacity = 1 - pull;
        cloud.g.setAttribute("transform", `translate(${O[0]} ${O[1]}) scale(${1 - 0.9 * pull}) translate(${-O[0]} ${-O[1]})`);
        const mu = ramp(t, L[3].t1 - 0.1, bp.t1 + 0.3, E.io3);
        mk.update({ tile: ramp(mu, 0.6, 1), outer: ramp(mu, 0.35, 0.9), inner: ramp(mu, 0.15, 0.7), core: mu > 0 ? E.outBack(ramp(mu, 0, 0.35, E.lin)) : 0 });
        mk.g.style.opacity = mu > 0 ? 1 : 0;
        axes.style.opacity = ax1.style.opacity = ax2.style.opacity = grow * (1 - pull);
        const nexts = [L[1].t0, L[2].t0, L[3].t0, bp.t1 + 0.4];
        v.forEach((vv, i) => speak(vv, t, L[i], nexts[i]));
        void tl;
      };
    },
  });
}

// ---------------------------------------------------------------------------

function sceneLenses({ stage, beat, line }) {
  const b = beat("lenses");
  const l1 = line("lenses1");
  const l2 = line("lenses2");
  stage.scene({
    id: "lenses", t0: b.t0, t1: b.t1, pre: 0.3, post: 0.6, fin: 0.4, fout: 0.6,
    build(layer) {
      const { under, svg, over } = stack(layer);
      const R = rng(12);
      const dots = [];
      const cluster = (cx, cy, n, kind) => {
        for (let i = 0; i < n; i++) {
          const a = R() * Math.PI * 2;
          const r = Math.sqrt(R()) * 150;
          dots.push({ x: cx + Math.cos(a) * r * 1.3, y: cy + Math.sin(a) * r, kind, c: el("circle", { r: 5 + R() * 4, fill: "#3d6a4d" }, svg) });
        }
      };
      cluster(560, 480, 40, "dark");
      cluster(1360, 420, 40, "bright");
      for (let i = 0; i < 40; i++) dots.push({ x: 300 + R() * 1320, y: 200 + R() * 560, kind: "else", c: el("circle", { r: 3 + R() * 3, fill: "#292e36" }, svg) });
      const glowG = el("g", {}, svg);
      glowG.style.filter = GLOW.b;
      const halo = dots.map((d) => el("circle", { cx: d.x, cy: d.y, r: 0, fill: "#ffb454", opacity: 0 }, glowG));
      dots.forEach((d) => {
        d.c.setAttribute("cx", d.x);
        d.c.setAttribute("cy", d.y);
      });
      const n1 = place(el("div", { class: "voice" }, over, "dark drones"), { x: 560, y: 690, ax: 0.5 });
      const n2 = place(el("div", { class: "voice" }, over, "bright plucks"), { x: 1360, y: 630, ax: 0.5 });
      for (const q of [n1, n2]) Object.assign(q.style, { fontSize: "40px", color: "#9a958a" });
      const formula = place(el("div", { class: "mono" }, over, ""), { x: 960, y: 130, ax: 0.5, ay: 0.5 });
      formula.innerHTML = `u(x) = max<sub>k</sub> θ<sub>k</sub> · φ(x)`;
      Object.assign(formula.style, { fontSize: "44px", color: "#ffb454", textShadow: "0 0 20px rgba(255,180,84,.4)" });
      const v1 = voiceLine(over, "And taste isn't one direction. You can love *dark drones* and *bright plucks*.");
      const v2 = voiceLine(over, "So the model keeps _several lenses_, and a sound only has to please _one_ of them.");
      const tLove = wordTime(l1, "love");
      const tSev = wordTime(l2, "several");
      return (tl, t) => {
        const inU = ramp(t, b.t0 - 0.2, b.t0 + 0.6);
        // One direction first: only the bright cluster lights; then both.
        const one = ramp(t, b.t0 + 0.3, b.t0 + 1.0) * (1 - ramp(t, tSev, tSev + 0.6));
        const both = ramp(t, tSev, tSev + 0.8);
        dots.forEach((d, i) => {
          d.c.style.opacity = inU;
          let lit = 0;
          if (d.kind === "bright") lit = Math.max(one, both);
          if (d.kind === "dark") lit = both;
          halo[i].setAttribute("r", (4 + 5 * lit).toFixed(1));
          halo[i].setAttribute("opacity", (0.85 * lit).toFixed(3));
        });
        n1.style.opacity = ramp(t, tLove, tLove + 0.4);
        n2.style.opacity = ramp(t, tLove + 0.5, tLove + 0.9);
        n1.style.color = both > 0.5 ? "#ffb454" : "#9a958a";
        n2.style.color = Math.max(one, both) > 0.5 ? "#ffb454" : "#9a958a";
        formula.style.opacity = ramp(t, tSev + 0.8, tSev + 1.4);
        speak(v1, t, l1, l2.t0);
        speak(v2, t, l2, b.t1 + 0.4);
        void tl;
      };
    },
  });
}

// ---------------------------------------------------------------------------

function sceneForecast({ stage, beat, line }) {
  const b = beat("forecast");
  const l1 = line("forecast1");
  const l2 = line("forecast2");
  stage.scene({
    id: "forecast", t0: b.t0, t1: b.t1, pre: 0.3, post: 0.6, fin: 0.4, fout: 0.6,
    build(layer) {
      const { under, svg, over } = stack(layer);
      const A = duelCard(under, svg, { x: 250, y: 330, w: 600, h: 360, side: "A", name: "Soft Engine", wave: voiceWave({ f: 1.5, bright: 0.3, seed: 31 }) });
      const B = duelCard(under, svg, { x: 1070, y: 330, w: 600, h: 360, side: "B", name: "Pale Wire", wave: voiceWave({ f: 2.3, bright: 0.65, seed: 32 }) });
      const note = place(el("div", {}, over), { x: 960, y: 190, ax: 0.5, ay: 0.5 });
      Object.assign(note.style, { fontFamily: "IBM Plex Mono", fontSize: "36px", color: "#ffb454", textShadow: "0 0 20px rgba(255,180,84,.45)", border: "1.5px dashed #b8823c", borderRadius: "10px", padding: "14px 30px" });
      note.textContent = "forecast: B, 64%";
      const shot = place(el("img", { src: "../../../landing/assets/screens/taste-trust.webp" }, over), { x: 960, y: 520, w: 1100, ax: 0.5, ay: 0.5 });
      Object.assign(shot.style, { borderRadius: "12px", boxShadow: "0 0 0 1px #292e36, 0 40px 90px rgba(0,0,0,.7)" });
      const v1 = voiceLine(over, "Before every duel, it _writes down a forecast_. Afterwards, it checks.");
      const v2 = voiceLine(over, "The TRUST view shows how honest those forecasts have been, even when the answer is: _no better than a coin flip, yet_.", { size: 46 });
      const tWrites = wordTime(l1, "writes");
      const tChecks = wordTime(l1, "checks");
      stage.sfx("blip", tChecks, -4);
      return (tl, t) => {
        const cards = fade(t, b.t0 - 0.2, b.t0 + 0.5, l2.t0 - 0.2, l2.t0 + 0.3);
        A.div.style.opacity = B.div.style.opacity = cards;
        A.update(t, { level: 0.35 * cards, draw: cards });
        B.update(t, { level: 0.35 * cards, picked: ramp(t, tChecks, tChecks + 0.3) * cards, draw: cards });
        note.style.opacity = fade(t, tWrites, tWrites + 0.4, l2.t0 - 0.2, l2.t0 + 0.3);
        note.style.transform = `rotate(${-2 + 2 * ramp(t, tWrites, tWrites + 0.4)}deg)`;
        const su = ramp(t, l2.t0 - 0.1, l2.t0 + 0.7, E.out4);
        shot.style.opacity = su;
        shot.style.transform = `scale(${lerp(0.94, 1, su) + 0.03 * ramp(t, l2.t0, b.t1, E.lin)})`;
        speak(v1, t, l1, l2.t0);
        speak(v2, t, l2, b.t1 + 0.4);
        void tl;
      };
    },
  });
}

// ---------------------------------------------------------------------------

function sceneSearch({ stage, beat, line }) {
  const b = beat("search");
  const l1 = line("search1");
  const l2 = line("search2");
  stage.scene({
    id: "search", t0: b.t0, t1: b.t1, pre: 0.3, post: 0.6, fin: 0.4, fout: 0.6,
    build(layer) {
      const { under, svg, over } = stack(layer);
      const R = rng(21);
      // Candidates: small patch glyphs streaming from the grammar on the left,
      // bent toward the taste (amber, right) as they go.
      const N = 140;
      const cands = Array.from({ length: N }, (_, i) => ({
        y0: 180 + R() * 620,
        t0: R() * 6,
        speed: 0.22 + R() * 0.12,
        good: R(),
        g: el("g", {}, svg),
      }));
      for (const c of cands) {
        el("rect", { x: -9, y: -6, width: 18, height: 12, rx: 3, fill: "none", stroke: "#63a97c", "stroke-width": 1.5 }, c.g);
        el("line", { x1: 9, y1: 0, x2: 16, y2: 0, stroke: "#63a97c", "stroke-width": 1.5 }, c.g);
      }
      const attractor = [1450, 480];
      const aG = el("g", {}, svg);
      aG.style.filter = GLOW.b;
      const halo = el("circle", { cx: attractor[0], cy: attractor[1], r: 90, fill: "none", stroke: "#ffb454", "stroke-width": 2, opacity: 0.6 }, aG);
      el("circle", { cx: attractor[0], cy: attractor[1], r: 10, fill: "#ffb454" }, aG);
      const gram = place(el("div", { class: "plate" }, under), { x: 90, y: 330, w: 220, h: 300 });
      const gl = el("div", { class: "silk" }, gram, "GRAMMAR");
      Object.assign(gl.style, { position: "absolute", left: "20px", top: "18px", fontSize: "18px" });
      const gtxt = el("div", { class: "mono" }, gram, "source\n → shape\n → filter\n → space\n ~ mod");
      Object.assign(gtxt.style, { position: "absolute", left: "20px", top: "60px", fontSize: "18px", whiteSpace: "pre", color: "#63a97c", lineHeight: "1.6" });
      const counter = place(el("div", { class: "mono" }, over, ""), { x: 1450, y: 640, ax: 0.5 });
      Object.assign(counter.style, { fontSize: "30px", color: "#ffb454" });
      const sub = place(el("div", { class: "mono" }, over, "heard silently, scored against your taste"), { x: 1450, y: 690, ax: 0.5 });
      Object.assign(sub.style, { fontSize: "18px", color: "#9a958a" });
      const out = [0, 1].map((i) => {
        const d = place(el("div", { class: "pill a" }, over, i ? "B  Night Bloom" : "A  Wide Ember"), { x: 1740, y: 430 + i * 100, ax: 0.5, ay: 0.5 });
        return d;
      });
      const v1 = voiceLine(over, "Then it searches. Evolution proposes new patches from a grammar of modules, and _your taste tilts every proposal_ toward what you'll like.", { size: 46 });
      const v2 = voiceLine(over, "Thousands are heard silently. Only the best few ever reach you.", { size: 48 });
      return (tl, t) => {
        const run = t - b.t0;
        const tilt = ramp(t, wordTime(l1, "tilts"), wordTime(l1, "tilts") + 1.0);
        let heard = 0;
        cands.forEach((c) => {
          const local = ((run - c.t0) * c.speed) % 1.4;
          const u = local < 0 ? -1 : local;
          if (u < 0 || u > 1) return (c.g.style.opacity = 0);
          const x = lerp(320, 1450, u);
          const pullY = lerp(c.y0, attractor[1], E.in2(u) * tilt * (0.3 + 0.7 * c.good));
          c.g.setAttribute("transform", `translate(${x} ${pullY})`);
          const fadeOut = u > 0.8 ? 1 - (u - 0.8) / 0.2 : 1;
          c.g.style.opacity = (0.3 + 0.7 * c.good * tilt + 0.3 * (1 - tilt)) * fadeOut;
          heard++;
        });
        const n = Math.floor(clamp((t - b.t0) / (b.t1 - b.t0)) * 2400);
        counter.textContent = `${n.toLocaleString("en-US")} heard`;
        counter.style.opacity = sub.style.opacity = ramp(t, l2.t0 - 0.2, l2.t0 + 0.3);
        halo.setAttribute("r", (90 + 12 * Math.sin(t * 2)).toFixed(1));
        const few = wordTime(l2, "best few");
        out.forEach((o, i) => {
          const u = ramp(t, few + i * 0.3, few + 0.5 + i * 0.3, E.out3);
          o.style.opacity = u;
          o.style.transform = `translateX(${(1 - u) * -40}px)`;
        });
        speak(v1, t, l1, l2.t0);
        speak(v2, t, l2, b.t1 + 0.4);
        void tl;
        void heard;
      };
    },
  });
}

// ---------------------------------------------------------------------------

function sceneReading({ stage, beat, line }) {
  const b = beat("reading");
  const l1 = line("reading1");
  stage.scene({
    id: "reading", t0: b.t0, t1: b.t1, pre: 0.3, post: 0.6, fin: 0.4, fout: 0.6,
    build(layer) {
      const { over } = stack(layer);
      const shots = ["taste-map", "taste-styles", "taste-directions"].map((n, i) => {
        const img = place(el("img", { src: `../../../landing/assets/screens/${n}.webp` }, over), { x: 960, y: 480, w: 1200, ax: 0.5, ay: 0.5 });
        Object.assign(img.style, { borderRadius: "12px", boxShadow: "0 0 0 1px #292e36, 0 40px 90px rgba(0,0,0,.7)" });
        return img;
      });
      const cap = ["a map of every patch you've heard", "the styles it found", "each direction, with its uncertainty"];
      const caps = cap.map((c) => place(el("div", { class: "pill b" }, over, c), { x: 960, y: 70, ax: 0.5, ay: 0.5 }));
      const v1 = voiceLine(over, "You can read what it learned: a map of every patch you've heard, the styles it found, and each direction with its uncertainty.", { size: 44 });
      const cuts = [b.t0 - 0.3, wordTime(l1, "the styles"), wordTime(l1, "each direction"), b.t1 + 1];
      return (tl, t) => {
        shots.forEach((s, i) => {
          const o = fade(t, cuts[i], cuts[i] + 0.4, cuts[i + 1], cuts[i + 1] + 0.4);
          s.style.opacity = o;
          s.style.transform = `scale(${1 + 0.04 * ramp(t, cuts[i], cuts[i + 1] + 0.4, E.lin)})`;
          caps[i].style.opacity = o;
        });
        speak(v1, t, l1, b.t1 + 0.4);
        void tl;
      };
    },
  });
}

// ---------------------------------------------------------------------------

function scenePlaying({ stage, beat, line }) {
  const b = beat("playing");
  const l1 = line("playing1");
  stage.scene({
    id: "playing", t0: b.t0, t1: b.t1, pre: 0.3, post: 0.3, fin: 0.4, fout: 0.5,
    build(layer) {
      const { under, svg, over } = stack(layer);
      const P = performPanel(under, svg, over, { y: 90 });
      const plus = place(el("div", { class: "pill b" }, over, "+1 pick · an offer, heard and taken"), { x: 960, y: 830, ax: 0.5, ay: 0.5 });
      const v1 = voiceLine(over, "And when you play, it keeps listening. An offer you _hear_, then take or pass, counts just like a duel.", { size: 46 });
      const tOffer = wordTime(l1, "an offer");
      const tTake = wordTime(l1, "take");
      stage.sfx("offer_shimmer", tOffer, -4);
      stage.sfx("blip", tTake, -4);
      return (tl, t) => {
        const grow = ramp(t, tOffer, tOffer + 1.2);
        const taken = ramp(t, tTake + 0.3, tTake + 0.6);
        P.trA.update(t, { amp: 0.55, ox: t * 0.3 });
        P.trB.update(t, { amp: 0.55 * grow, draw: grow, ox: t * 0.3 });
        P.trB.g.style.opacity = grow > 0 ? 1 - taken : 0;
        if (taken > 0.5) P.trA.wave = voiceWave({ f: 2.6, bright: 0.7, seed: 44 });
        pressPad(P.pads.offer, fade(t, tOffer - 0.1, tOffer, tOffer + 0.3, tOffer + 0.7), "b");
        pressPad(P.pads.peek, fade(t, tOffer + 0.9, tOffer + 1.0, tTake - 0.3, tTake), "a");
        pressPad(P.pads.take, fade(t, tTake, tTake + 0.1, tTake + 0.4, tTake + 0.8), "a");
        plus.style.opacity = fade(t, tTake + 0.5, tTake + 0.8, b.t1, b.t1 + 0.4);
        speak(v1, t, l1, b.t1 + 0.4);
        void tl;
      };
    },
  });
}

// ---------------------------------------------------------------------------

function sceneOutro({ stage, beat, line }) {
  const b = beat("outro");
  const l1 = line("outro1");
  stage.scene({
    id: "outro", t0: b.t0, t1: b.t1, pre: 0, fin: 0.5,
    build(layer) {
      const { svg, over } = stack(layer);
      const lock = place(el("div", { class: "lk" }, over), { x: 0, y: 0 });
      lock.style.fontSize = "96px";
      const wm = el("span", { class: "wm" }, lock, "AURACLE");
      const wmW = wm.getBoundingClientRect().width;
      const markPx = 1.28 * 96;
      const gap = 0.62 * 96;
      const left = 960 - (markPx + gap + wmW) / 2;
      const mk = mark(svg, { cx: left + markPx / 2, cy: 430, size: markPx });
      place(lock, { x: left + markPx + gap, y: 430, ay: 0.5 });
      const v1 = voiceLine(over, "Your taste, _learned in the open_. And it never leaves your browser.", { y: 620, size: 56 });
      const fine = place(el("div", { class: "mono" }, over, "the model and your picks stay on your machine"), { x: 960, y: 720, ax: 0.5 });
      Object.assign(fine.style, { fontSize: "22px", color: "#6f6c63", letterSpacing: "0.06em" });
      stage.sfx("logo_sting", b.t0 - 0.1, -2);
      return (tl, t) => {
        const u = ramp(t, b.t0 - 0.2, b.t0 + 0.7, E.out4);
        mk.update({ tile: u, outer: u, inner: ramp(t, b.t0 - 0.3, b.t0 + 0.4), core: E.outBack(ramp(t, b.t0 - 0.3, b.t0 + 0.2, E.lin)) });
        lock.style.opacity = u;
        speak(v1, t, l1, b.t1 + 5);
        fine.style.opacity = ramp(t, l1.t1, l1.t1 + 0.6);
        layer.style.opacity = 1 - ramp(t, b.t1 - 0.8, b.t1, E.io2);
        void tl;
      };
    },
  });
}
