// The launch film. Every scene is pinned to the narration's cues in
// timeline.json (tools/timeline.py), so a new voice take re-times the film
// without anyone editing seconds here.

import { el, place, clamp, lerp, ramp, fade, keys, E, rng, noise1, words, reveal } from "../../stage/stage.js";
import { svgLayer, scope, knob, cable, plate, mark, pointer, glide, keyboard, textBlock, voiceWave, duelCard, performPanel, pressPad, PHOS, GLOW, ink, inkA } from "../../stage/kit.js";

export async function build(stage) {
  const beat = (id) => stage.tl.beats.find((b) => b.id === id);
  const line = (id) => stage.line(id);
  const ctx = { stage, beat, line };
  sceneOpen(ctx);
  sceneTitle(ctx);
  sceneDuel(ctx);
  sceneGrow(ctx);
  scenePerform(ctx);
  sceneDepth(ctx);
  sceneClose(ctx);
  sceneEnd(ctx);
}

/** A caption line for a scene: the narration, set in the voice face. */
function voiceLine(over, text, { y = 960, size = 54, w = 1700 } = {}) {
  const d = textBlock(over, { x: 960, y, w, cls: "voice", size, align: "center", ax: 0.5, ay: 0.5 });
  const sp = words(d, text);
  return { d, sp };
}

/** Standard layer stack: HTML under, SVG, HTML over. */
function stack(layer) {
  const under = el("div", { class: "layer" }, layer);
  const svg = svgLayer(layer);
  const over = el("div", { class: "layer" }, layer);
  return { under, svg, over };
}

// ---------------------------------------------------------------------------
// OPEN — a sound, then the wall of knobs it is hidden in.

function wall(g, { cols = 8, rows = 5, margin = 34, gap = 16, seed = 3, center = [3, 2] }) {
  const r = rng(seed);
  const pw = (1920 - 2 * margin - (cols - 1) * gap) / cols;
  const ph = (1080 - 2 * margin - (rows - 1) * gap) / rows;
  const names = ["VCO", "SVF", "VCA", "LFO", "ENV", "MIX", "DELAY", "VERB", "FOLD", "S&H", "SLEW", "NOISE", "LADDER", "CHORUS", "PHASER", "DRIVE", "STEPS", "CRUSH", "RING", "GRAIN"];
  const knobs = [];
  let screen = null;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = margin + i * (pw + gap);
      const y = margin + j * (ph + gap);
      const pg = el("g", {}, g);
      el("rect", { x, y, width: pw, height: ph, rx: 9, fill: ink("--module-face"), stroke: ink("--hairline"), "stroke-width": 1.2 }, pg);
      el("rect", { x: x + 1, y: y + 1, width: pw - 2, height: 2, rx: 1, fill: inkA("--white", 0.05) }, pg);
      for (const [sx, sy] of [[9, 9], [pw - 9, 9], [9, ph - 9], [pw - 9, ph - 9]]) {
        el("circle", { cx: x + sx, cy: y + sy, r: 3.2, fill: ink("--module-screw") }, pg);
      }
      el(
        "text",
        { x: x + 16, y: y + 30, fill: ink("--silk-dim"), "font-family": "Jost", "font-weight": 500, "font-size": 15, "letter-spacing": "0.16em" },
        pg,
        names[Math.floor(r() * names.length)],
      );
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
        el("circle", { cx: x + (pw * (q + 1)) / 5, cy: y + ph - 22, r: 5.5, fill: ink("--bezel"), stroke: ink("--phos-a-deep"), "stroke-width": 1.4 }, pg);
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
      lock.style.fontSize = "150px";
      const wm = el("span", { class: "wm" }, lock, "AURACLE");
      const desc = textBlock(layer, { x: 960, y: 700, w: 1600, cls: "mono", size: 27, align: "center", ax: 0.5, ay: 0.5 });
      desc.style.letterSpacing = "0.26em";
      desc.style.textTransform = "uppercase";
      desc.style.color = ink("--silk-dim");
      desc.textContent = "a synthesizer that searches for your sound";

      // Final lockup geometry (measured once, at the final tracking).
      wm.style.letterSpacing = "0.095em";
      const wmW = wm.getBoundingClientRect().width;
      const fs = 150;
      const markPx = 1.28 * fs;
      const gap = 0.62 * fs;
      const total = markPx + gap + wmW;
      const left = 960 - total / 2;
      const endMark = { cx: left + markPx / 2, cy: 520 };
      const wmX = left + markPx + gap;

      return (tl, t) => {
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
// DUEL — two patches; you pick; every pick teaches it.

const DUELS = [
  ["Hollow Reed", "Glass Pad"],
  ["Rust Choir", "Tin Rain"],
  ["Deep Current", "Night Bloom"],
  ["Soft Engine", "Pale Wire"],
  ["Iron Tide", "Silver Drift"],
  ["Low Lantern", "Wide Ember"],
  ["Pulse Garden", "Quiet Static"],
  ["Warm Signal", "Fold Bloom"],
];

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
      const { under, svg, over } = stack(layer);
      const A = duelCard(under, svg, { x: 170, y: 290, w: 740, h: 450, side: "A", name: DUELS[0][0], wave: voiceWave({ f: 1.6, bright: 0.2, seed: 21 }) });
      const B = duelCard(under, svg, { x: 1010, y: 290, w: 740, h: 450, side: "B", name: DUELS[0][1], wave: voiceWave({ f: 2.4, bright: 0.75, seed: 22 }) });
      // The model's side of it: an amber posterior that tightens with each pick.
      const post = el("g", {}, svg);
      post.style.filter = GLOW.b;
      const rings = [0, 1, 2].map((i) => el("ellipse", { cx: 960, cy: 150, rx: 100, ry: 30, fill: "none", stroke: ink("--phos-b"), "stroke-width": 2 - i * 0.5, opacity: 0.5 }, post));
      const core = el("circle", { cx: 960, cy: 150, r: 5, fill: ink("--phos-b") }, post);
      const sparks = Array.from({ length: 8 }, () => el("circle", { r: 6, fill: ink("--phos-b"), opacity: 0 }, post));
      const count = textBlock(over, { x: 960, y: 222, w: 400, cls: "mono", size: 24, align: "center", ax: 0.5, ay: 0.5 });
      count.style.color = ink("--phos-b-dim");
      count.style.letterSpacing = "0.14em";
      const ptr = pointer(svg);
      const v1 = voiceLine(over, "It plays you two patches. You pick the one you like better.");
      const v2 = voiceLine(over, "Every pick teaches it _your taste_,");
      return (tl, t) => {
        const L1 = l1.t0 - b.t0;
        const L2 = l2.t0 - b.t0;
        const d1 = l1.t1 - l1.t0;
        // Cards arrive.
        const inU = ramp(tl, -0.4, 0.5, E.out4);
        A.div.style.transform = `translateX(${(1 - inU) * -120}px)`;
        B.div.style.transform = `translateX(${(1 - inU) * 120}px)`;
        // First duel, played out by hand: hear A, hear B, pick B.
        const hA = L1 + 0.25;
        const hB = L1 + d1 * 0.42;
        const pk = L1 + d1 * 0.78;
        const pp = glide(tl, [
          [L1 - 0.5, 960, 1000],
          [hA, A.hearPos[0], A.hearPos[1]],
          [hA + 0.7, A.hearPos[0], A.hearPos[1]],
          [hB, B.hearPos[0], B.hearPos[1]],
          [hB + 0.6, B.hearPos[0], B.hearPos[1]],
          [pk, B.pickPos[0], B.pickPos[1]],
          [L2 + 3, B.pickPos[0], B.pickPos[1] + 40],
        ]);
        const clickAt = [hA, hB, pk].find((c) => tl >= c && tl < c + 0.5);
        ptr.update({ x: pp.x, y: pp.y, o: fade(tl, L1 - 0.5, L1 - 0.1, L2 + 0.2, L2 + 0.6), click: clickAt != null ? (tl - clickAt) / 0.5 : null });
        const aOn = fade(tl, hA, hA + 0.15, hB - 0.1, hB + 0.3);
        const bOn = ramp(tl, hB, hB + 0.15);
        // After the first pick, a quick run of duels: one per beat.
        const spb = 60 / stage.tl.grid.bpm;
        const run0 = L2 - 0.1;
        const k = tl < run0 ? -1 : Math.floor((tl - run0) / spb);
        const picks = k < 0 ? (tl >= pk ? 1 : 0) : 1 + Math.min(k + 1, 11);
        const firstPick = ramp(tl, pk, pk + 0.25, E.out3);
        if (k < 0) {
          A.update(t, { level: 0.22 + 0.5 * aOn, lit: aOn, name: DUELS[0][0] });
          B.update(t, { level: 0.22 + 0.5 * (tl < pk + 0.8 ? bOn : 1), lit: bOn, picked: firstPick, name: DUELS[0][1] });
        } else {
          const pair = DUELS[(k + 1) % DUELS.length];
          const ph = ((tl - run0) / spb) % 1;
          const pickB = (k * 7 + 3) % 3 !== 0;
          const flash = ph < 0.55 ? 1 - ph / 0.55 : 0;
          A.update(t, { level: 0.35, lit: 0, picked: pickB ? 0 : flash, name: pair[0] });
          B.update(t, { level: 0.35, lit: 0, picked: pickB ? flash : 0, name: pair[1] });
        }
        // Sparks fly from each pick to the posterior, which tightens.
        const spread = 1 / Math.sqrt(1 + picks * 0.9);
        rings.forEach((r, i) => {
          r.setAttribute("rx", (300 * spread * (1 + i * 0.45)).toFixed(1));
          r.setAttribute("ry", (46 * spread * (1 + i * 0.45) + 6).toFixed(1));
          r.setAttribute("opacity", (0.2 + 0.5 * (1 - spread) + 0.2) * (1 - i * 0.28));
        });
        core.setAttribute("r", (3 + 6 * (1 - spread)).toFixed(2));
        post.style.opacity = ramp(tl, pk - 0.2, pk + 0.4);
        sparks.forEach((sp, i) => {
          const s0 = i === 0 ? pk : run0 + (i - 1) * spb;
          const u = ramp(tl, s0, s0 + 0.55, E.io2);
          const from = i === 0 ? B.pickPos : (((i - 1) * 7 + 3) % 3 !== 0 ? B.pickPos : A.pickPos);
          if (u <= 0 || u >= 1) return sp.setAttribute("opacity", 0);
          sp.setAttribute("cx", lerp(from[0], 960, u));
          sp.setAttribute("cy", lerp(from[1], 150, E.out2(u)) - Math.sin(u * Math.PI) * 80);
          sp.setAttribute("opacity", 1 - u * 0.4);
        });
        count.textContent = picks ? `${picks} pick${picks > 1 ? "s" : ""}` : "";
        count.style.opacity = post.style.opacity;
        // Words.
        v1.d.style.opacity = fade(tl, L1 - 0.3, L1, L2 - 0.5, L2 - 0.2);
        reveal(v1.sp, t, l1.t0, l1.t1);
        v2.d.style.opacity = fade(tl, L2 - 0.2, L2 + 0.1, b.t1 - b.t0 - 0.1, b.t1 - b.t0 + 0.3);
        reveal(v2.sp, t, l2.t0, l2.t1);
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
      const P = [
        { name: "VCO", kind: "saw", x: 150, y: 420, knobs: 2 },
        { name: "SVF", kind: "lowpass", x: 540, y: 420, knobs: 2, alt: "LADDER" },
        { name: "VCA", kind: "", x: 930, y: 420, knobs: 1 },
        { name: "VERB", kind: "space", x: 1320, y: 420, knobs: 2 },
        { name: "LFO", kind: "0.4 Hz", x: 540, y: 150, knobs: 1 },
        { name: "ENV", kind: "adsr", x: 930, y: 150, knobs: 2 },
      ];
      const plates = P.map((p, i) => plate(under, svg, { x: p.x, y: p.y, w: 290, h: 190, name: p.name, kind: p.kind, knobs: p.knobs, seed: 30 + i }));
      const cab = [
        cable(svg, { p0: plates[0].out, p1: plates[1].in, sag: 26 }),
        cable(svg, { p0: plates[1].out, p1: plates[2].in, sag: 26 }),
        cable(svg, { p0: plates[2].out, p1: plates[3].in, sag: 26 }),
        cable(svg, { p0: [540 + 145, 150 + 190], p1: [540 + 290 / 3, 420 + 190 * 0.56 - 32], sag: 12 }),
        cable(svg, { p0: [930 + 145, 150 + 190], p1: [930 + 145, 420 + 190 * 0.56 - 32], sag: 12 }),
      ];
      const out = el("div", { class: "silk" }, over, "OUT ▸");
      place(out, { x: 1660, y: 526, ay: 0.5 });
      Object.assign(out.style, { fontSize: "22px", color: ink("--phos-a-dim"), letterSpacing: "0.2em" });
      const outCable = cable(svg, { p0: plates[3].out, p1: [1648, 526], sag: 8 });
      // Lineage: what each generation changed, in the app's own words.
      const gens = [
        ["gen 7", "+lfo → cutoff"],
        ["gen 8", "svf → ladder"],
        ["gen 9", "release 0.3→0.9, +verb"],
      ];
      const chips = gens.map(([g, d], i) => {
        const c = el("div", { class: "pill" }, over, "");
        c.innerHTML = `<span style="color:${ink("--phos-b-dim")}">${g}</span>&nbsp;&nbsp;<span style="color:${ink("--silk")}">${d}</span>`;
        place(c, { x: 150 + i * 560, y: 700 });
        return c;
      });
      const v1 = voiceLine(over, "and it grows new patches _toward it_.", { y: 900 });
      const v2 = voiceLine(over, "Not samples. *Real modular circuits*, built and wired from scratch.", { y: 900 });
      const r = rng(9);
      return (tl, t) => {
        const T = b.t1 - b.t0;
        const L2 = l2.t0 - b.t0;
        // Plates arrive one by one, cables plug in behind them.
        const order = [0, 1, 2, 3, 4, 5];
        order.forEach((pi, i) => {
          const a0 = -0.2 + i * 0.28;
          const u = ramp(tl, a0, a0 + 0.5, E.out4);
          plates[pi].div.style.opacity = u;
          plates[pi].div.style.transform = `translateY(${(1 - u) * 30}px) scale(${0.96 + 0.04 * u})`;
          for (const { k } of plates[pi].knobs) k.g.style.opacity = u;
        });
        cab.forEach((c, i) => {
          const a0 = 0.5 + i * 0.3;
          c.update(t, { draw: ramp(tl, a0, a0 + 0.6, E.io2), flow: ramp(tl, a0 + 0.6, a0 + 1.2) });
        });
        outCable.update(t, { draw: ramp(tl, 1.8, 2.3), flow: ramp(tl, 2.3, 2.8) });
        out.style.opacity = ramp(tl, 2.0, 2.4);
        // The knobs breathe: an LFO on the cutoff, an envelope on the level.
        plates[1].knobs[0].k.set(0.45 + 0.28 * Math.sin(t * 2 * Math.PI * 0.4), { glowOn: true });
        plates[2].knobs[0].k.set(0.35 + 0.4 * Math.max(0, Math.sin(t * 2 * Math.PI * 0.6)), { glowOn: true });
        // Evolution: at the second line the filter becomes a ladder and the
        // tail opens.
        const swap = ramp(tl, L2 + 0.9, L2 + 1.3, E.io3);
        const nm = plates[1].div.querySelector(".silk");
        nm.textContent = swap > 0.5 ? "LADDER" : "SVF";
        plates[1].div.style.transform = `rotateY(${Math.sin(swap * Math.PI) * 70}deg)`;
        plates[1].div.style.borderColor = swap > 0.5 ? inkA("--phos-b", 0.8 * (1 - ramp(tl, L2 + 1.3, L2 + 3))) : "";
        chips.forEach((c, i) => {
          const a0 = L2 + 0.3 + i * 0.9;
          const u = ramp(tl, a0, a0 + 0.5, E.out3);
          c.style.opacity = u;
          c.style.transform = `translateY(${(1 - u) * 14}px)`;
        });
        v1.d.style.opacity = fade(tl, -0.2, 0.2, L2 - 0.5, L2 - 0.2);
        reveal(v1.sp, t, l1.t0, l1.t1);
        v2.d.style.opacity = fade(tl, L2 - 0.2, L2 + 0.1, T + 0.1, T + 0.5);
        reveal(v2.sp, t, l2.t0, l2.t1);
        void r;
      };
    },
  });
}

// ---------------------------------------------------------------------------
// PERFORM — play it; turn Bright; let it wander; press Offer; blend; take.

function scenePerform({ stage, beat, line }) {
  const bp = beat("play");
  const bo = beat("offer");
  const L = (id) => line(id);
  stage.scene({
    id: "perform",
    t0: bp.t0,
    t1: bo.t1,
    pre: 0.3,
    post: 0.8,
    fin: 0.6,
    build(layer) {
      const { under, svg, over } = stack(layer);
      const P = performPanel(under, svg, over, { y: 60 });
      const kb = keyboard(svg, { x: 380, y: 800, w: 1160, h: 150, low: 48, octaves: 2 });
      const ptr = pointer(svg);
      // Wiring: Bright drives cutoff (+), reso (+ a little) and drive (+).
      const wires = el("g", {}, svg);
      wires.style.filter = GLOW.a;
      const bk = P.knobs.bright;
      const targets = [0, 1, 2].map((i) => P.strip[i]);
      const wirePaths = targets.map((s) => {
        const d = `M${bk.cx} ${bk.cy + 62} C${bk.cx} ${bk.cy + 120} ${s.cx} ${s.cy - 70} ${s.cx} ${s.cy - 28}`;
        const p = el("path", { d, fill: "none", stroke: PHOS.a, "stroke-width": 2, "stroke-dasharray": "5 7", opacity: 0 }, wires);
        return p;
      });
      const gains = [0.42, 0.12, 0.2];
      const chords = [[57, 60, 64, 69], [53, 57, 60, 65], [48, 55, 60, 64], [55, 59, 62, 67]];
      const lines = ["play1", "play2", "play3", "offer1", "offer2"].map(L);
      const vs = [
        voiceLine(over, "Then you *play it*.", { y: 1030, size: 46 }),
        voiceLine(over, "Turn *Bright*, and it finds the knobs that make this patch brighter.", { y: 1030, size: 46 }),
        voiceLine(over, "Let it wander, and the knobs turn themselves _toward your taste_.", { y: 1030, size: 46 }),
        voiceLine(over, "Press _Offer_, and a new version grows from the sound in your hands.", { y: 1030, size: 46 }),
        voiceLine(over, "Blend into it. Take it, or pass. Either way, _it learns_.", { y: 1030, size: 46 }),
      ];
      const plus = textBlock(over, { x: 1640, y: 90, w: 300, cls: "mono", size: 24, align: "right", ax: 1, ay: 0.5 });
      plus.style.color = ink("--phos-b");
      return (tl, t) => {
        const T0 = bp.t0;
        const at = (id, k = "t0") => stage.line(id)[k] - T0;
        // Panel in.
        const inU = ramp(tl, -0.3, 0.6, E.out4);
        layer.style.transform = `translateY(${(1 - inU) * 40}px)`;
        // Chords on the keyboard, one per bar, in time with the music.
        const bar = (60 / stage.tl.grid.bpm) * 4;
        const ci = Math.floor((t - stage.tl.grid.t0) / bar);
        kb.update(new Set(tl > 0.2 ? chords[((ci % 4) + 4) % 4] : []));
        // Bright: the hand turns it during play2; the strip knobs follow.
        const b0 = at("play2") + 0.3;
        const b1 = at("play2", "t1") - 0.2;
        const turn = ramp(tl, b0 + 0.4, b1, E.io3) - 0.6 * ramp(tl, at("play3") - 0.3, at("play3") + 0.4, E.io2);
        const bright = 0.5 + 0.38 * turn;
        // Wander: turned up during play3, the knobs drift under the taste walk.
        const w0 = at("play3");
        const wander = ramp(tl, w0 + 0.5, w0 + 1.3) * (1 - ramp(tl, at("offer1") - 0.2, at("offer1") + 0.3));
        const drift = (i) => wander * 0.22 * noise1(t * 0.9 + i * 3.1, 17 + i);
        bk.k.set(bright + drift(9) * 0.5);
        P.knobs.wander.k.set(0.1 + 0.7 * wander, { col: "b" });
        ["snap", "motion", "body", "grit", "space"].forEach((n, i) => P.knobs[n].k.set(0.5 + drift(i) * 0.6));
        P.strip.forEach((s, i) => {
          const base = [0.35, 0.3, 0.2, 0.15, 0.5, 0.4][i];
          const v = base + (gains[i] || 0) * (bright - 0.5) * 2 + drift(i + 20);
          s.k.set(clamp(v), { ghost: wander > 0.05 ? clamp(v + 0.12 * wander) : null });
        });
        wirePaths.forEach((p, i) => p.setAttribute("opacity", 0.9 * fade(tl, b0, b0 + 0.5, at("play3") + 0.2, at("play3") + 0.7) * (0.4 + gains[i])));
        // Blend: 0 until offer2, then into B and back.
        const o0 = at("offer1");
        const o2 = at("offer2");
        const blend = ramp(tl, o2 + 0.1, o2 + 1.1, E.io3);
        const taken = ramp(tl, o2 + 1.6, o2 + 1.9, E.io2);
        P.knobs.blend.k.set(blend * (1 - taken));
        // The scopes: A brightens with Bright; B grows after Offer.
        const offerGrow = ramp(tl, o0 + 0.9, o0 + 2.2, E.io3);
        P.trA.wave = voiceWave({ f: 1.9, bright: clamp(0.15 + 0.8 * (bright - 0.3)), seed: 5 });
        P.trB.wave = voiceWave({ f: 2.6, bright: 0.7, seed: 44 });
        P.trA.update(t, { amp: 0.62 * (1 - 0.7 * blend * (1 - taken)) + 0.2 * taken, ox: t * 0.25 });
        P.trB.update(t, { amp: 0.62 * offerGrow, draw: offerGrow, ox: t * 0.25 });
        P.trB.g.style.opacity = offerGrow > 0 ? 1 - taken : 0;
        if (taken > 0.5) P.trA.wave = voiceWave({ f: 2.6, bright: 0.7, seed: 44 });
        // Pads.
        pressPad(P.pads.offer, fade(tl, o0 + 0.35, o0 + 0.45, o0 + 0.7, o0 + 1.2), "b");
        pressPad(P.pads.take, fade(tl, o2 + 1.55, o2 + 1.65, o2 + 1.9, o2 + 2.4), "a");
        // The hand.
        const kpos = (n) => [P.knobs[n].cx + 10, P.knobs[n].cy + 12];
        const pp = glide(tl, [
          [b0 - 0.8, 1300, 1000],
          [b0, ...kpos("bright")],
          [b1, kpos("bright")[0], kpos("bright")[1] - 40],
          [w0 + 0.3, ...kpos("wander")],
          [w0 + 1.4, kpos("wander")[0], kpos("wander")[1] - 30],
          [o0 + 0.3, ...P.pads.offer.pos],
          [o0 + 1.0, ...P.pads.offer.pos],
          [o2, ...kpos("blend")],
          [o2 + 1.1, kpos("blend")[0], kpos("blend")[1] - 40],
          [o2 + 1.5, ...P.pads.take.pos],
          [o2 + 3.0, P.pads.take.pos[0] + 60, P.pads.take.pos[1] + 120],
        ]);
        const clicks = [b0, w0 + 0.3, o0 + 0.35, o2 + 0.05, o2 + 1.55];
        const ck = clicks.find((c) => tl >= c && tl < c + 0.5);
        ptr.update({ x: pp.x, y: pp.y, o: fade(tl, b0 - 0.8, b0 - 0.3, o2 + 2.6, o2 + 3.2), click: ck != null ? (tl - ck) / 0.5 : null });
        // "+1": the answer is a pick.
        plus.textContent = "+1 pick";
        plus.style.opacity = fade(tl, o2 + 1.8, o2 + 2.1, o2 + 3.4, o2 + 3.9);
        plus.style.transform = `translateY(${-20 * ramp(tl, o2 + 1.8, o2 + 3.9, E.out2)}px)`;
        // Words.
        lines.forEach((l, i) => {
          const a = l.t0 - T0;
          const next = i + 1 < lines.length ? lines[i + 1].t0 - T0 : bo.t1 - T0;
          vs[i].d.style.opacity = fade(tl, a - 0.25, a + 0.05, next - 0.35, next - 0.1);
          reveal(vs[i].sp, t, l.t0, l.t1);
        });
      };
    },
  });
}

// ---------------------------------------------------------------------------
// DEPTH — the circuit underneath, and a model that keeps score in public.

function sceneDepth({ stage, beat, line }) {
  const b = beat("depth");
  const l1 = line("depth1");
  const l2 = line("depth2");
  stage.scene({
    id: "depth",
    t0: b.t0,
    t1: b.t1,
    pre: 0.3,
    post: 0.6,
    fin: 0.5,
    fout: 0.6,
    build(layer) {
      const { under, svg, over } = stack(layer);
      const P = [
        { name: "VCO", kind: "saw", x: 110, y: 290 },
        { name: "LADDER", kind: "lowpass", x: 560, y: 290 },
        { name: "VCA", kind: "", x: 1010, y: 290 },
        { name: "VERB", kind: "space", x: 1460, y: 290 },
      ];
      const plates = P.map((p, i) => plate(under, svg, { x: p.x, y: p.y, w: 350, h: 260, name: p.name, kind: p.kind, knobs: 2, seed: 50 + i }));
      const cabs = [0, 1, 2].map((i) => cable(svg, { p0: plates[i].out, p1: plates[i + 1].in, sag: 30 }));
      // Amber pointers: the value PERFORM is playing each knob at.
      const performed = [plates[1].knobs[0], plates[1].knobs[1], plates[3].knobs[1]];
      const tags = performed.map((pk, i) => {
        const t = el("div", { class: "pill b" }, over, ["cutoff, reso  ◂ Bright", "", "mix  ◂ Space"][i]);
        const g = pk.k.g.getBBox ? null : null;
        return { t, pk, g };
      });
      const v1 = voiceLine(over, "Open the circuit any time. Every knob is *real*, and you can watch the performance turn them.", { y: 900, size: 50, w: 1600 });
      const v2 = voiceLine(over, "Underneath, a model of your taste _bets on every choice_ before you make it, and keeps score in public.", { y: 900, size: 50, w: 1600 });
      // The forecast: two small cards and the model's bet.
      const fc = el("div", { class: "layer" }, over);
      const bet = textBlock(fc, { x: 960, y: 260, w: 1200, cls: "mono", size: 30, align: "center", ax: 0.5, ay: 0.5 });
      bet.style.color = ink("--phos-b");
      const gauge = el("g", {}, svg);
      gauge.style.filter = GLOW.b;
      const track = el("rect", { x: 560, y: 340, width: 800, height: 10, rx: 5, fill: ink("--gauge-track") }, gauge);
      const fill = el("rect", { x: 560, y: 340, width: 0, height: 10, rx: 5, fill: ink("--phos-b") }, gauge);
      const lblA = textBlock(fc, { x: 540, y: 345, w: 200, cls: "mono", size: 26, align: "right", ax: 1, ay: 0.5, text: "A" });
      const lblB = textBlock(fc, { x: 1380, y: 345, w: 200, cls: "mono", size: 26, align: "left", ax: 0, ay: 0.5, text: "B" });
      // A reliability diagram, drawn: forecasts against outcomes.
      const rel = el("g", {}, svg);
      const rx0 = 760;
      const ry0 = 440;
      const rs = 380;
      el("rect", { x: rx0, y: ry0, width: rs, height: rs, fill: "none", stroke: ink("--gauge-frame"), "stroke-width": 2 }, rel);
      const diag = el("line", { x1: rx0, y1: ry0 + rs, x2: rx0 + rs, y2: ry0, stroke: ink("--phos-b-deep"), "stroke-width": 2, "stroke-dasharray": "6 8" }, rel);
      const dotsG = el("g", {}, rel);
      dotsG.style.filter = GLOW.b;
      // Illustrative, and honest about it: dots near the line, whiskers wide.
      const pts = [[0.14, 0.24, 7], [0.3, 0.22, 9], [0.47, 0.55, 13], [0.62, 0.53, 10], [0.78, 0.86, 8], [0.9, 0.8, 6]];
      const dots = pts.map(([fx, fy, r]) => {
        const c = el("circle", { cx: rx0 + fx * rs, cy: ry0 + rs - fy * rs, r, fill: ink("--phos-b"), opacity: 0 }, dotsG);
        const wv = 0.34 / Math.sqrt(r);
        const wsk = el("line", { x1: rx0 + fx * rs, x2: rx0 + fx * rs, y1: ry0 + rs - (fy - wv) * rs, y2: ry0 + rs - (fy + wv) * rs, stroke: ink("--phos-b-dim"), "stroke-width": 2, opacity: 0 }, rel);
        return { c, wsk };
      });
      const relLbl = textBlock(fc, { x: rx0 + rs + 30, y: ry0 + 40, w: 520, cls: "mono", size: 22, align: "left" });
      relLbl.innerHTML = `<span style="color:${ink("--phos-b-dim")}">TRUST</span><br><span style="color:${ink("--silk-dim")}">what it said would happen,<br>against what did.<br>on the line = honest.</span>`;
      return (tl, t) => {
        const L2 = l2.t0 - b.t0;
        const T = b.t1 - b.t0;
        // The circuit: plates rise into place.
        plates.forEach((p, i) => {
          const u = ramp(tl, -0.3 + i * 0.12, 0.4 + i * 0.12, E.out4);
          const o = u * (1 - ramp(tl, L2 - 0.6, L2 + 0.1));
          p.div.style.opacity = o;
          p.div.style.transform = `translateY(${(1 - u) * 50}px)`;
          for (const { k } of p.knobs) k.g.style.opacity = o;
        });
        cabs.forEach((c, i) => c.update(t, { draw: ramp(tl, 0.3 + i * 0.2, 0.9 + i * 0.2), flow: 1, opacity: 1 - ramp(tl, L2 - 0.6, L2 + 0.1) }));
        // PERFORM turning the knobs: amber ghost values sweeping.
        const sweep = 0.5 + 0.3 * Math.sin((tl - 1) * 1.6);
        performed.forEach((pk, i) => {
          const base = [0.42, 0.3, 0.35][i];
          const ghost = clamp(base + [0.3, 0.1, 0.2][i] * (sweep - 0.5) * 2 + 0.15);
          pk.k.set(base, { ghost: tl > 1.2 ? ghost : null, glowOn: true });
        });
        tags.forEach(({ t: tg, pk }, i) => {
          const kx = [560 + 175, 0, 1460 + 175][i];
          place(tg, { x: kx, y: 262, ax: 0.5, ay: 1 });
          tg.style.opacity = i === 1 ? 0 : fade(tl, 1.3 + i * 0.3, 1.8 + i * 0.3, L2 - 0.6, L2 - 0.1);
          tg.style.fontSize = "19px";
          void pk;
        });
        // The forecast and the score.
        const fin = ramp(tl, L2 - 0.1, L2 + 0.5);
        const p = 0.71;
        const g = ramp(tl, L2 + 0.4, L2 + 1.6, E.io3);
        fill.setAttribute("width", (800 * p * g).toFixed(1));
        gauge.style.opacity = fin * (1 - ramp(tl, T - 0.3, T + 0.3));
        bet.textContent = `before you answer:  B, ${Math.round(p * 100 * g)}%`;
        fc.style.opacity = fin * (1 - ramp(tl, T - 0.3, T + 0.3));
        lblA.style.color = ink("--silk-dim");
        lblB.style.color = ink("--phos-b");
        rel.style.opacity = fin * (1 - ramp(tl, T - 0.3, T + 0.3));
        dots.forEach((d, i) => {
          const u = ramp(tl, L2 + 1.8 + i * 0.35, L2 + 2.2 + i * 0.35, E.outBack);
          d.c.setAttribute("opacity", clamp(u));
          d.c.setAttribute("r", pts[i][2] * clamp(u, 0, 1.3));
          d.wsk.setAttribute("opacity", 0.8 * clamp(u));
        });
        diag.setAttribute("opacity", ramp(tl, L2 + 1.4, L2 + 1.9));
        v1.d.style.opacity = fade(tl, l1.t0 - b.t0 - 0.3, l1.t0 - b.t0, L2 - 0.5, L2 - 0.2);
        reveal(v1.sp, t, l1.t0, l1.t1);
        v2.d.style.opacity = fade(tl, L2 - 0.2, L2 + 0.1, T + 0.1, T + 0.5);
        reveal(v2.sp, t, l2.t0, l2.t1);
      };
    },
  });
}

// ---------------------------------------------------------------------------
// CLOSE — every note in this film; free, open, in the browser.

const BANK = ["Glass Pad", "Acid Line", "Loom", "Undertow", "Sub & Sparkle", "Detune Dream", "Wobble Board", "Cathedral", "Ghost Bell", "Iron Bass", "Tine", "First Bass"];

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
      const cells = BANK.map((n, i) => {
        const col = i % 4;
        const row = Math.floor(i / 4);
        const x = 200 + col * 390;
        const y = 150 + row * 210;
        const d = place(el("div", { class: "screen" }, under), { x, y, w: 360, h: 180 });
        const lbl = el("div", { class: "mono" }, under, n);
        place(lbl, { x: x + 14, y: y + 12 });
        Object.assign(lbl.style, { fontSize: "19px", color: ink("--phos-a-dim"), zIndex: 2 });
        const tr = scope(svg, { x: x + 20, y: y + 46, w: 320, h: 110, width: 2.5, points: 220, wave: voiceWave({ f: 1.2 + (i % 5) * 0.5, bright: 0.2 + ((i * 37) % 10) / 12, seed: 60 + i }) });
        return { d, lbl, tr };
      });
      const v1 = voiceLine(over, "Every note in this film *is Auracle*.", { y: 850, size: 60 });
      const v2 = voiceLine(over, "Free, open source, and running in your browser.", { y: 850, size: 60 });
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
          const hot = ((beatNo % 12) + 12) % 12 === i ? 1 - ph : 0;
          c.d.style.opacity = u;
          c.lbl.style.opacity = u;
          c.lbl.style.color = hot > 0.2 ? ink("--phos-a") : ink("--phos-a-dim");
          c.tr.update(t, { amp: 0.3 + 0.45 * hot, ox: t * 0.3 });
          c.tr.g.style.opacity = u * (0.45 + 0.55 * hot);
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
      const { under, svg, over } = stack(layer);
      const M = { cx: 0, cy: 420, size: 150 };
      const lock = place(el("div", { class: "lk" }, over), { x: 0, y: 0 });
      lock.style.fontSize = "110px";
      const wm = el("span", { class: "wm" }, lock, "AURACLE");
      const wmW = wm.getBoundingClientRect().width;
      const markPx = 1.28 * 110;
      const gap = 0.62 * 110;
      const left = 960 - (markPx + gap + wmW) / 2;
      M.cx = left + markPx / 2;
      const mk = mark(svg, { cx: M.cx, cy: M.cy, size: markPx });
      place(lock, { x: left + markPx + gap, y: M.cy, ay: 0.5 });
      // The lockup lands on the downbeat of the score's last section, where
      // the finale rings out. There is no hit (ADR-014: no cues); on N3,
      // Reach follows the last word.
      const say = textBlock(over, { x: 960, y: 610, w: 1400, cls: "voice", size: 64, align: "center", ax: 0.5, ay: 0.5 });
      const sp = words(say, "Play it *today*.");
      const url = el("div", { class: "pill a" }, over, "auracle.alexnodeland.com  ▸");
      place(url, { x: 960, y: 740, ax: 0.5, ay: 0.5 });
      Object.assign(url.style, { fontSize: "30px", padding: "16px 34px" });
      void under;
      return (tl, t) => {
        const u = ramp(tl, -0.3, 0.6, E.out4);
        mk.update({ tile: u, outer: ramp(tl, -0.1, 0.8), inner: ramp(tl, -0.3, 0.5), core: E.outBack(ramp(tl, -0.3, 0.3, E.lin)) });
        lock.style.opacity = u;
        wm.style.letterSpacing = `${lerp(0.3, 0.095, u)}em`;
        say.style.opacity = ramp(tl, l1.t0 - b.t0 - 0.3, l1.t0 - b.t0);
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
