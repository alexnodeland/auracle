// Under the hood: for engineers. Every picture here is a diagram of something
// the reference documents and the code implements; the narration names the
// same things the reference's chapter titles do.

import { el, place, clamp, lerp, ramp, fade, E, rng, noise1, words, reveal } from "../../stage/stage.js";
import { svgLayer, scope, knob, cable, mark, textBlock, voiceWave, phiBars, PHOS, GLOW, ink, inkA } from "../../stage/kit.js";

export async function build(stage) {
  const beat = (id) => stage.tl.beats.find((b) => b.id === id);
  const line = (id) => stage.line(id);
  const ctx = { stage, beat, line };
  sceneCrates(ctx);
  sceneGenome(ctx);
  sceneCompile(ctx);
  sceneAudition(ctx);
  sceneFeatures(ctx);
  sceneUtility(ctx);
  sceneCalibration(ctx);
  sceneSearch(ctx);
  scenePerform(ctx);
  sceneRuntime(ctx);
  sceneOutro(ctx);
}

function stack(layer) {
  const under = el("div", { class: "layer" }, layer);
  const svg = svgLayer(layer);
  const over = el("div", { class: "layer" }, layer);
  return { under, svg, over };
}
function voiceLine(over, text, { y = 985, size = 44, w = 1720 } = {}) {
  const d = textBlock(over, { x: 960, y, w, cls: "voice", size, align: "center", ax: 0.5, ay: 0.5 });
  return { d, sp: words(d, text) };
}
function speak(v, t, l, next) {
  v.d.style.opacity = fade(t, l.t0 - 0.25, l.t0 + 0.05, next - 0.35, next - 0.1);
  reveal(v.sp, t, l.t0, l.t1);
}
function wordTime(l, word) {
  const i = l.text.toLowerCase().indexOf(word.toLowerCase());
  if (i < 0) return l.t0;
  if (l.words) {
    const idx = l.text.slice(0, i).split(/\s+/).filter(Boolean).length;
    return l.words[Math.min(idx, l.words.length - 1)];
  }
  return l.t0 + ((l.t1 - l.t0) * i) / l.text.length;
}
/** A labelled box: a plate with a mono title and an optional subtitle. */
function box(under, { x, y, w, h, title, sub = "", color = "a", ax = 0, ay = 0 }) {
  const d = place(el("div", { class: "plate" }, under), { x, y, w, h, ax, ay });
  const t = el("div", { class: "mono" }, d, title);
  Object.assign(t.style, { position: "absolute", left: "18px", top: "14px", fontSize: "22px", color: color === "b" ? ink("--phos-b") : color === "s" ? ink("--silk") : ink("--phos-a"), fontWeight: 600 });
  if (sub) {
    const s = el("div", { class: "mono" }, d, sub);
    Object.assign(s.style, { position: "absolute", left: "18px", top: "48px", right: "14px", fontSize: "16px", color: ink("--silk-dim"), lineHeight: "1.45", whiteSpace: "pre-wrap" });
  }
  return d;
}
/** An arrow from p0 to p1 (drawn on with `u`). */
function arrow(svg, p0, p1, color = "a", { curve = 0, width = 2.5, dash = null } = {}) {
  const g = el("g", {}, svg);
  g.style.filter = GLOW[color];
  const mx = (p0[0] + p1[0]) / 2 + curve * (p1[1] - p0[1]);
  const my = (p0[1] + p1[1]) / 2 - curve * (p1[0] - p0[0]);
  const path = el("path", { d: `M${p0[0]} ${p0[1]} Q${mx} ${my} ${p1[0]} ${p1[1]}`, fill: "none", stroke: PHOS[color], "stroke-width": width, "stroke-linecap": "round" }, g);
  if (dash) path.setAttribute("stroke-dasharray", dash);
  const len = path.getTotalLength();
  if (!dash) path.setAttribute("stroke-dasharray", `${len} ${len}`);
  const ang = Math.atan2(p1[1] - my, p1[0] - mx);
  const head = el("path", { d: `M0 0 L-14 -7 L-14 7 Z`, fill: PHOS[color], transform: `translate(${p1[0]} ${p1[1]}) rotate(${(ang * 180) / Math.PI})` }, g);
  return {
    g,
    update(u) {
      if (!dash) path.setAttribute("stroke-dashoffset", len * (1 - clamp(u)));
      else g.style.opacity = clamp(u * 2);
      head.setAttribute("opacity", u >= 0.98 ? 1 : 0);
    },
  };
}

// ---------------------------------------------------------------------------

function sceneCrates({ stage, beat, line }) {
  const b = beat("intro");
  const l1 = line("intro1");
  const l2 = line("intro2");
  stage.scene({
    id: "crates", t0: b.t0, t1: b.t1, post: 0.5, fout: 0.5,
    build(layer) {
      const { under, svg, over } = stack(layer);
      const C = {
        grammar: { x: 170, y: 250, sub: "the genome: a typed\ngrammar over modules" },
        features: { x: 170, y: 560, sub: "audition and φ:\nwhat a patch sounds like" },
        taste: { x: 760, y: 560, sub: "utility, likelihoods,\nposterior, calibration" },
        session: { x: 760, y: 250, sub: "search, refinement,\nPERFORM, persistence" },
        wasm: { x: 1350, y: 400, sub: "the engine in the\nbrowser: worker + voices" },
      };
      const boxes = Object.fromEntries(Object.entries(C).map(([k, v]) => [k, box(under, { x: v.x, y: v.y, w: 400, h: 190, title: `auracle-${k}`, sub: v.sub, color: k === "taste" ? "b" : "a" })]));
      const ext = [
        place(el("div", { class: "pill" }, over, "quiver · patch-graph DSP"), { x: 370, y: 190, ax: 0.5 }),
        place(el("div", { class: "pill" }, over, "fugue-evo · evolution as inference"), { x: 960, y: 190, ax: 0.5 }),
      ];
      const wasmTag = place(el("div", { class: "pill a" }, over, "→ .wasm"), { x: 1550, y: 640, ax: 0.5 });
      const arrows = [
        arrow(svg, [570, 345], [760, 345]),
        arrow(svg, [570, 655], [760, 655], "b"),
        arrow(svg, [370, 440], [370, 560]),
        arrow(svg, [960, 560], [960, 440], "b"),
        arrow(svg, [1160, 345], [1350, 470]),
      ];
      // The two stories: sound (green) and choice (amber).
      const sound = place(el("div", { class: "eyebrow" }, over, "a patch becomes a sound"), { x: 370, y: 800, ax: 0.5 });
      const choice = place(el("div", { class: "eyebrow b" }, over, "a choice becomes a model"), { x: 960, y: 800, ax: 0.5 });
      const v1 = voiceLine(over, "Auracle is a *Rust workspace* of five crates, compiled to *WebAssembly*.");
      const v2 = voiceLine(over, "Here's how *a patch becomes a sound*, and _a choice becomes a model_.");
      return (tl, t) => {
        Object.values(boxes).forEach((d, i) => {
          const u = ramp(t, b.t0 + 0.2 + i * 0.18, b.t0 + 0.8 + i * 0.18, E.out4);
          d.style.opacity = u;
          d.style.transform = `translateY(${(1 - u) * 24}px)`;
        });
        ext.forEach((e, i) => (e.style.opacity = ramp(t, b.t0 + 1.4 + i * 0.2, b.t0 + 1.9 + i * 0.2)));
        arrows.forEach((a, i) => a.update(ramp(t, b.t0 + 1.2 + i * 0.2, b.t0 + 1.8 + i * 0.2)));
        wasmTag.style.opacity = ramp(t, wordTime(l1, "WebAssembly"), wordTime(l1, "WebAssembly") + 0.4);
        sound.style.opacity = ramp(t, wordTime(l2, "a patch"), wordTime(l2, "a patch") + 0.4);
        choice.style.opacity = ramp(t, wordTime(l2, "a choice"), wordTime(l2, "a choice") + 0.4);
        speak(v1, t, l1, l2.t0);
        speak(v2, t, l2, b.t1 + 0.4);
        void tl;
      };
    },
  });
}

// ---------------------------------------------------------------------------

const TREE = {
  n: "out", c: [{ n: "verb", k: "mix", c: [{ n: "vca", c: [{ n: "ladder", k: "cut", c: [{ n: "saw", k: "detune" }, { n: "lfo", k: "rate" }] }, { n: "env", k: "attack" }] }] }],
};

function layoutTree(t, x, y, dx, dy, out = [], parent = -1, addr = "node") {
  const me = out.length;
  out.push({ n: t.n, k: t.k, x, y, parent, addr });
  const kids = t.c || [];
  const w = (kids.length - 1) * dx;
  kids.forEach((c, i) => layoutTree(c, x - w / 2 + i * dx, y + dy, dx * 0.62, dy, out, me, `${addr}/${i}`));
  return out;
}

function sceneGenome({ stage, beat, line }) {
  const b = beat("genome");
  const l1 = line("genome1");
  const l2 = line("genome2");
  stage.scene({
    id: "genome", t0: b.t0, t1: b.t1, pre: 0.3, post: 0.5, fin: 0.4, fout: 0.5,
    build(layer) {
      const { under, svg, over } = stack(layer);
      const nodes = layoutTree(TREE, 760, 160, 520, 130);
      const edges = el("g", {}, svg);
      const nodeEls = nodes.map((nd, i) => {
        const d = place(el("div", { class: "pill a" }, over, nd.n), { x: nd.x, y: nd.y, ax: 0.5, ay: 0.5 });
        Object.assign(d.style, { fontSize: "24px", padding: "10px 24px" });
        let line = null;
        if (nd.parent >= 0) {
          const p = nodes[nd.parent];
          line = el("line", { x1: p.x, y1: p.y + 24, x2: nd.x, y2: nd.y - 24, stroke: ink("--phos-a-deep"), "stroke-width": 2.5 }, edges);
        }
        let addr = null;
        if (nd.k) {
          addr = place(el("div", { class: "mono" }, over, `${nd.addr}#${nd.k}`), { x: nd.x, y: nd.y + 34, ax: 0.5 });
          Object.assign(addr.style, { fontSize: "18px", color: ink("--phos-b") });
        }
        return { d, line, addr };
      });
      const term = place(el("div", { class: "mono" }, over, ""), { x: 1330, y: 250 });
      term.innerHTML = `<span style="color:${ink("--silk-dim")}">// a patch, as a term</span><br>out(<br>&nbsp;&nbsp;verb(<br>&nbsp;&nbsp;&nbsp;&nbsp;vca(<br>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;ladder(saw, lfo),<br>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;env)))`;
      Object.assign(term.style, { fontSize: "26px", color: ink("--phos-a"), lineHeight: "1.5" });
      const prior = place(el("div", { class: "mono" }, over, "x ~ p_grammar(x)"), { x: 1330, y: 640 });
      Object.assign(prior.style, { fontSize: "34px", color: ink("--phos-b"), textShadow: `0 0 18px ${inkA("--phos-b", 0.4)}` });
      const v1 = voiceLine(over, "A patch is a term in a *typed grammar*: a probabilistic program over modules.");
      const v2 = voiceLine(over, "Every knob and every structural choice has a _trace address_, so a whole patch is one draw from a prior.");
      const tAddr = wordTime(l2, "trace address");
      const tDraw = wordTime(l2, "one draw");
      return (tl, t) => {
        nodeEls.forEach((ne, i) => {
          const u = ramp(t, b.t0 + 0.2 + i * 0.15, b.t0 + 0.6 + i * 0.15, E.out3);
          ne.d.style.opacity = u;
          if (ne.line) ne.line.setAttribute("opacity", u);
          if (ne.addr) ne.addr.style.opacity = ramp(t, tAddr + i * 0.08, tAddr + 0.3 + i * 0.08);
        });
        term.style.opacity = ramp(t, wordTime(l1, "term"), wordTime(l1, "term") + 0.5);
        prior.style.opacity = ramp(t, tDraw, tDraw + 0.4);
        // One draw from a prior: the leaves flicker through alternatives.
        const flick = ramp(t, tDraw, tDraw + 0.3) * (1 - ramp(t, l2.t1, l2.t1 + 0.3));
        const alts = { saw: ["saw", "fold", "pluck", "saw"], lfo: ["lfo", "s&h", "steps", "lfo"], env: ["env", "follow", "env"] };
        nodeEls.forEach((ne, i) => {
          const n = nodes[i].n;
          if (alts[n]) {
            const k = flick > 0.05 ? Math.floor(t * 7 + i) % alts[n].length : 0;
            ne.d.textContent = alts[n][k];
          }
        });
        speak(v1, t, l1, l2.t0);
        speak(v2, t, l2, b.t1 + 0.4);
        void tl;
      };
    },
  });
}

// ---------------------------------------------------------------------------

function sceneCompile({ stage, beat, line }) {
  const b = beat("compile");
  const l1 = line("compile1");
  stage.scene({
    id: "compile", t0: b.t0, t1: b.t1, pre: 0.3, post: 0.5, fin: 0.4, fout: 0.5,
    build(layer) {
      const { under, svg, over } = stack(layer);
      const N = [
        ["saw", 180, 420], ["lfo", 180, 660], ["ladder", 560, 420], ["env", 560, 660], ["vca", 940, 420], ["verb", 1320, 420], ["out", 1660, 420],
      ];
      const pos = {};
      N.forEach(([n, x, y]) => {
        box(under, { x, y, w: 220, h: 110, title: n, sub: n === "ladder" ? "cut ← lfo" : n === "vca" ? "gain ← env" : "", ax: 0, ay: 0.5 });
        pos[n] = [x, y];
      });
      const wires = [
        ["saw", "ladder"], ["ladder", "vca"], ["vca", "verb"], ["verb", "out"],
      ].map(([a, c]) => cable(svg, { p0: [pos[a][0] + 220, pos[a][1]], p1: [pos[c][0], pos[c][1]], sag: 14 }));
      const mods = [
        cable(svg, { p0: [pos.lfo[0] + 220, pos.lfo[1]], p1: [pos.ladder[0] + 110, pos.ladder[1] + 55], sag: 10, color: "a", width: 3 }),
        cable(svg, { p0: [pos.env[0] + 220, pos.env[1]], p1: [pos.vca[0] + 110, pos.vca[1] + 55], sag: 10, color: "a", width: 3 }),
      ];
      const sampleG = el("g", {}, svg);
      sampleG.style.filter = GLOW.a;
      const dots = Array.from({ length: 5 }, () => el("circle", { r: 7, fill: ink("--phos-a-pulse"), opacity: 0 }, sampleG));
      const badge = place(el("div", { class: "pill a" }, over, "0 allocations on the audio path"), { x: 960, y: 250, ax: 0.5, ay: 0.5 });
      const q = place(el("div", { class: "mono" }, over, "quiver · Patch::tick() → one sample"), { x: 960, y: 790, ax: 0.5 });
      Object.assign(q.style, { fontSize: "24px", color: ink("--silk-dim") });
      const v1 = voiceLine(over, "It compiles to a *quiver signal graph*, which runs one sample at a time with _no allocation on the audio path_.");
      return (tl, t) => {
        wires.forEach((w, i) => w.update(t, { draw: ramp(t, b.t0 + 0.3 + i * 0.25, b.t0 + 0.8 + i * 0.25), flow: 1 }));
        mods.forEach((w, i) => w.update(t, { draw: ramp(t, b.t0 + 1.2 + i * 0.25, b.t0 + 1.7 + i * 0.25), flow: 0.6 }));
        // Samples travelling the chain.
        const path = [pos.saw, pos.ladder, pos.vca, pos.verb, pos.out].map((p) => [p[0] + 110, p[1]]);
        dots.forEach((d, i) => {
          const u = ((t * 0.35 + i / dots.length) % 1) * (path.length - 1);
          const k = Math.floor(u);
          const f = u - k;
          const a = path[k];
          const c = path[Math.min(k + 1, path.length - 1)];
          d.setAttribute("cx", lerp(a[0], c[0], f));
          d.setAttribute("cy", lerp(a[1], c[1], f));
          d.setAttribute("opacity", 0.9 * ramp(t, b.t0 + 1.6, b.t0 + 2.2));
        });
        badge.style.opacity = ramp(t, wordTime(l1, "no allocation"), wordTime(l1, "no allocation") + 0.4);
        q.style.opacity = ramp(t, wordTime(l1, "quiver"), wordTime(l1, "quiver") + 0.4);
        speak(v1, t, l1, b.t1 + 0.4);
        void tl;
      };
    },
  });
}

// ---------------------------------------------------------------------------

function sceneAudition({ stage, beat, line }) {
  const b = beat("audition");
  const l1 = line("audition1");
  stage.scene({
    id: "audition", t0: b.t0, t1: b.t1, pre: 0.3, post: 0.5, fin: 0.4, fout: 0.5,
    build(layer) {
      const { under, svg, over } = stack(layer);
      // The phrase as a piano roll: a held note, a chord, a high note.
      const roll = el("g", {}, svg);
      roll.style.filter = GLOW.a;
      const notes = [[0, 1.6, 60], [1.8, 1.2, 64], [1.8, 1.2, 67], [1.8, 1.2, 60], [3.2, 0.7, 72]];
      const nEls = notes.map(([s, d, m]) => el("rect", { x: 200 + s * 150, y: 520 - (m - 60) * 18, width: d * 150 - 8, height: 14, rx: 4, fill: ink("--phos-a"), opacity: 0 }, roll));
      const lbl = place(el("div", { class: "eyebrow" }, over, "the standard phrase"), { x: 200, y: 200 });
      const meter = place(el("div", {}, over), { x: 900, y: 250, w: 36, h: 380 });
      Object.assign(meter.style, { background: ink("--bezel"), borderRadius: "6px", border: `1px solid ${ink("--hairline")}`, overflow: "hidden" });
      const fillM = el("div", {}, meter);
      Object.assign(fillM.style, { position: "absolute", left: 0, right: 0, bottom: 0, height: "0%", background: `linear-gradient(0deg,${ink("--phos-a-deep")},${ink("--phos-a")})` });
      const tgt = place(el("div", { class: "mono" }, over, "— target loudness"), { x: 945, y: 360 });
      Object.assign(tgt.style, { fontSize: "18px", color: ink("--silk-dim") });
      const gate = ["silence", "clipping", "DC offset", "non-finite"].map((g, i) => {
        const d = place(el("div", { class: "pill" }, over, `✕ ${g}`), { x: 1300, y: 300 + i * 90 });
        Object.assign(d.style, { fontSize: "22px" });
        return d;
      });
      const pass = place(el("div", { class: "pill a" }, over, "✓ vetted → featurize"), { x: 1300, y: 690 });
      Object.assign(pass.style, { fontSize: "22px" });
      const v1 = voiceLine(over, "Every candidate plays the same *standard phrase*, normalized for loudness, through a *vetting gate* that rejects silence, clipping and DC.");
      return (tl, t) => {
        lbl.style.opacity = ramp(t, b.t0, b.t0 + 0.4);
        nEls.forEach((n, i) => n.setAttribute("opacity", ramp(t, b.t0 + 0.2 + i * 0.2, b.t0 + 0.5 + i * 0.2)));
        const lu = ramp(t, wordTime(l1, "loudness"), wordTime(l1, "loudness") + 1.0, E.io3);
        fillM.style.height = `${lerp(92, 71, lu) * ramp(t, b.t0 + 0.5, b.t0 + 1.2)}%`;
        meter.style.opacity = tgt.style.opacity = ramp(t, wordTime(l1, "loudness") - 0.4, wordTime(l1, "loudness"));
        const tg = wordTime(l1, "vetting gate");
        gate.forEach((g, i) => (g.style.opacity = ramp(t, tg + 0.3 + i * 0.25, tg + 0.6 + i * 0.25)));
        pass.style.opacity = ramp(t, tg + 1.6, tg + 2.0);
        speak(v1, t, l1, b.t1 + 0.4);
        void tl;
        void under;
      };
    },
  });
}

// ---------------------------------------------------------------------------

function sceneFeatures({ stage, beat, line }) {
  const b = beat("features");
  const l1 = line("features1");
  stage.scene({
    id: "features", t0: b.t0, t1: b.t1, pre: 0.3, post: 0.5, fin: 0.4, fout: 0.5,
    build(layer) {
      const { under, svg, over } = stack(layer);
      const vals = [1.2, 0.4, 1.0, -0.6, 0.8, 0.9, 0.2, 1.4, -0.7, -0.5, -0.2, -0.9, 0.5, 0.7, 0.3, 0.9, 0.4, -0.3];
      const bars = phiBars(svg, over, { x: 180, y: 170, w: 1000, h: 300, values: vals });
      const hi = [15, 16, 17];
      const band = place(el("div", { class: "pill a" }, over, "motion: 0.5–2 · 2–8 · 8–30 Hz"), { x: 1180 - 170, y: 120, ax: 0.5 });
      const grid = [];
      const R = rng(4);
      for (let i = 0; i < 26; i++) {
        grid.push(el("rect", { x: 1320 + (i % 5) * 64, y: 170 + Math.floor(i / 5) * 64, width: 48, height: 48, rx: 8, fill: R() > 0.5 ? ink("--phos-a-deep") : ink("--panel"), stroke: ink("--hairline"), "stroke-width": 1.5, opacity: 0 }, svg));
      }
      const s18 = place(el("div", { class: "pill a" }, over, "φ_audio · 18"), { x: 680, y: 720, ax: 0.5 });
      const s26 = place(el("div", { class: "pill" }, over, "φ_struct · 26"), { x: 1470, y: 720, ax: 0.5 });
      const z = place(el("div", { class: "mono" }, over, "z = (φ − μ) / σ   — standardized"), { x: 960, y: 820, ax: 0.5 });
      Object.assign(z.style, { fontSize: "30px", color: ink("--silk") });
      const v1 = voiceLine(over, "From that phrase come *eighteen perceptual features*, from brightness and noisiness to envelope shape and *three bands of modulation rate*. Twenty-six structural ones come from the patch itself. Every one is standardized.", { size: 38 });
      return (tl, t) => {
        const u = ramp(t, b.t0 + 0.1, b.t0 + 1.8, E.io2);
        const tb = wordTime(l1, "three bands");
        const hiNow = t > tb - 0.1 && t < tb + 1.6;
        bars.update(u, vals, { hi: hiNow ? 16 : -1 });
        band.style.opacity = fade(t, tb, tb + 0.3, tb + 1.8, tb + 2.2);
        const ts = wordTime(l1, "Twenty-six");
        grid.forEach((g, i) => g.setAttribute("opacity", ramp(t, ts + i * 0.03, ts + 0.3 + i * 0.03)));
        s18.style.opacity = ramp(t, wordTime(l1, "eighteen"), wordTime(l1, "eighteen") + 0.4);
        s26.style.opacity = ramp(t, ts + 0.4, ts + 0.8);
        z.style.opacity = ramp(t, wordTime(l1, "standardized"), wordTime(l1, "standardized") + 0.4);
        speak(v1, t, l1, b.t1 + 0.4);
        void tl;
        void under;
        void hi;
      };
    },
  });
}

// ---------------------------------------------------------------------------

function sceneUtility({ stage, beat, line }) {
  const b = beat("utility");
  const l1 = line("utility1");
  const l2 = line("utility2");
  stage.scene({
    id: "utility", t0: b.t0, t1: b.t1, pre: 0.3, post: 0.5, fin: 0.4, fout: 0.5,
    build(layer) {
      const { under, svg, over } = stack(layer);
      const f = place(el("div", { class: "mono" }, over, ""), { x: 960, y: 200, ax: 0.5, ay: 0.5 });
      f.innerHTML = `u(x) = max<sub>k</sub> θ<sub>k</sub> · φ(x)`;
      Object.assign(f.style, { fontSize: "64px", color: ink("--phos-b"), textShadow: `0 0 26px ${inkA("--phos-b", 0.45)}` });
      // The three likelihoods (auracle-taste's `Feedback`): heard edits,
      // self-reports and PERFORM's offers are duels with a provenance tag.
      const streams = ["duels", "keep or cut", "stars"].map((s, i) => {
        const d = place(el("div", { class: "pill b" }, over, s), { x: 300, y: 420 + i * 120, ax: 0.5, ay: 0.5 });
        return d;
      });
      const arr = streams.map((_, i) => arrow(svg, [420, 420 + i * 120], [880, 540], "b", { curve: 0 }));
      // The posterior: MCMC draws (adaptive single-site MH, kept as 500).
      // An answer reweights them in place — sequential importance weights —
      // and a refit resamples the cloud around where the evidence now points.
      // Each draw is a step from the last one — a chain, not a scatter — and
      // it wanders the whole posterior only over many steps.
      const walk = (n, cx, cy, sx, sy, seed) => {
        const r = rng(seed);
        const g = () => Math.sqrt(-2 * Math.log(r() + 1e-9)) * Math.cos(2 * Math.PI * r());
        const rho = 0.82;
        const k = Math.sqrt(1 - rho * rho);
        let u = g();
        let v = g();
        return Array.from({ length: n }, () => {
          u = rho * u + k * g();
          v = rho * v + k * g();
          return [cx + sx * u + 0.25 * sx * v, cy + sy * v, u];
        });
      };
      const A = walk(90, 1150, 540, 130, 75, 7);
      const B = walk(90, 1215, 528, 62, 36, 11);
      const pts = A.map((a, i) => ({ a: [a[0], a[1]], b: [B[i][0], B[i][1]], w: Math.exp(-0.5 * (a[2] - 0.9) ** 2) }));
      const pg = el("g", {}, svg);
      pg.style.filter = GLOW.b;
      const chain = pts.slice(0, 48);
      const trail = el("path", { d: `M${chain.map((p) => `${p.a[0].toFixed(1)} ${p.a[1].toFixed(1)}`).join(" L")}`, fill: "none", stroke: ink("--phos-b-dim"), "stroke-width": 1.2, opacity: 0.55 }, pg);
      const tlen = trail.getTotalLength();
      trail.setAttribute("stroke-dasharray", `${tlen} ${tlen}`);
      const dots = pts.map((p) => el("circle", { cx: p.a[0], cy: p.a[1], r: 4.5, fill: ink("--phos-b"), opacity: 0 }, pg));
      const pulse = el("circle", { r: 7, fill: ink("--phos-b"), opacity: 0 }, svg);
      pulse.style.filter = GLOW.b;
      const cap = place(el("div", { class: "mono" }, over, "MCMC · 500 draws · reweighted between refits"), { x: 1215, y: 760, ax: 0.5 });
      Object.assign(cap.style, { fontSize: "26px", color: ink("--phos-b-dim"), whiteSpace: "nowrap" });
      const v1 = voiceLine(over, "Taste is a utility: _the maximum over a few linear experts_ on those features.");
      const v2 = voiceLine(over, "A duel, a keep or a cut, a star rating: each has its own likelihood. The posterior is sampled by _Markov chain Monte Carlo_, and each new answer reweights those samples until a refit is due.", { size: 38 });
      return (tl, t) => {
        f.style.opacity = ramp(t, b.t0 + 0.2, b.t0 + 0.8);
        const s0 = l2.t0;
        streams.forEach((s, i) => (s.style.opacity = ramp(t, s0 + i * 0.4, s0 + 0.3 + i * 0.4)));
        arr.forEach((a, i) => a.update(ramp(t, s0 + 0.3 + i * 0.4, s0 + 0.8 + i * 0.4)));
        // Drawn one by one as the chain walks, from "posterior" to "Carlo".
        const tp = wordTime(l2, "posterior");
        const tc = wordTime(l2, "Carlo") + 0.6;
        const n = ramp(t, tp, tc, E.lin) * pts.length;
        trail.setAttribute("stroke-dashoffset", tlen * (1 - clamp(n / chain.length)));
        // One answer arrives down the duel stream, and the draws take its weight.
        const tw = wordTime(l2, "reweights");
        const pu = ramp(t, tw - 0.9, tw - 0.1, E.io2);
        pulse.setAttribute("cx", lerp(420, 880, pu));
        pulse.setAttribute("cy", 420 + (540 - 420) * pu);
        pulse.setAttribute("opacity", fade(t, tw - 0.9, tw - 0.8, tw - 0.2, tw));
        const wu = ramp(t, tw, tw + 0.8, E.io3);
        const refit = ramp(t, wordTime(l2, "refit"), wordTime(l2, "refit") + 1.4, E.io3);
        pts.forEach((p, i) => {
          const d = dots[i];
          const on = clamp(n - i);
          const rw = lerp(1, 0.35 + 1.5 * p.w, wu * (1 - refit));
          const op = lerp(1, 0.2 + 0.8 * p.w, wu * (1 - refit));
          d.setAttribute("cx", lerp(p.a[0], p.b[0], refit).toFixed(1));
          d.setAttribute("cy", lerp(p.a[1], p.b[1], refit).toFixed(1));
          d.setAttribute("r", (4.5 * rw).toFixed(2));
          d.setAttribute("opacity", (on * op).toFixed(3));
        });
        trail.setAttribute("opacity", (0.55 * (1 - refit)).toFixed(3));
        cap.style.opacity = ramp(t, wordTime(l2, "Monte"), wordTime(l2, "Monte") + 0.5);
        speak(v1, t, l1, l2.t0);
        speak(v2, t, l2, b.t1 + 0.4);
        void tl;
        void under;
      };
    },
  });
}

// ---------------------------------------------------------------------------

function sceneCalibration({ stage, beat, line }) {
  const b = beat("calibration");
  const l1 = line("calibration1");
  stage.scene({
    id: "calibration", t0: b.t0, t1: b.t1, pre: 0.3, post: 0.5, fin: 0.4, fout: 0.5,
    build(layer) {
      const { under, svg, over } = stack(layer);
      const steps = ["forecast  p(B) = 0.64", "answer  B", "score  (1 − 0.64)² = 0.13"].map((s, i) => {
        const d = place(el("div", { class: "pill b" }, over, s), { x: 360 + i * 600, y: 330, ax: 0.5, ay: 0.5 });
        Object.assign(d.style, { fontSize: "26px", padding: "14px 30px" });
        return d;
      });
      const ar = [arrow(svg, [620, 330], [780, 330], "b"), arrow(svg, [1170, 330], [1330, 330], "b")];
      const kinds = ["dealt duels", "PERFORM offers", "heard edits", "self-reports"].map((k, i) => {
        const d = place(el("div", { class: "mono" }, over, k), { x: 600, y: 520 + i * 70, ax: 1, ay: 0.5 });
        Object.assign(d.style, { fontSize: "24px", color: ink("--silk-dim") });
        const bar = place(el("div", {}, over), { x: 630, y: 520 + i * 70, w: 0, h: 18, ay: 0.5 });
        Object.assign(bar.style, { background: ink("--phos-b-dim"), borderRadius: "4px" });
        return { d, bar, w: [420, 300, 360, 220][i] };
      });
      const cap = place(el("div", { class: "mono" }, over, "each stream scored on its own"), { x: 1300, y: 625, ay: 0.5 });
      Object.assign(cap.style, { fontSize: "22px", color: ink("--silk-mute") });
      const v1 = voiceLine(over, "Every duel is _forecast before it's answered_. Each forecast is scored with a *proper scoring rule*, separately for each kind of evidence.");
      return (tl, t) => {
        steps.forEach((s, i) => (s.style.opacity = ramp(t, b.t0 + 0.3 + i * 0.9, b.t0 + 0.6 + i * 0.9)));
        ar.forEach((a, i) => a.update(ramp(t, b.t0 + 0.7 + i * 0.9, b.t0 + 1.1 + i * 0.9)));
        const tk = wordTime(l1, "separately");
        kinds.forEach((k, i) => {
          const u = ramp(t, tk - 0.2 + i * 0.2, tk + 0.4 + i * 0.2, E.out3);
          k.d.style.opacity = u;
          k.bar.style.width = `${k.w * u}px`;
        });
        cap.style.opacity = ramp(t, tk + 0.8, tk + 1.2);
        speak(v1, t, l1, b.t1 + 0.4);
        void tl;
        void under;
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
    id: "search", t0: b.t0, t1: b.t1, pre: 0.3, post: 0.5, fin: 0.4, fout: 0.5,
    build(layer) {
      const { under, svg, over } = stack(layer);
      const f = place(el("div", { class: "mono" }, over, ""), { x: 960, y: 150, ax: 0.5, ay: 0.5 });
      f.innerHTML = `π<sub>β</sub>(x) ∝ p<sub>grammar</sub>(x) · e<sup>β 𝔼[u(x)]</sup>`;
      Object.assign(f.style, { fontSize: "52px", color: ink("--silk") });
      // A 1-D landscape: prior (green), tilt (amber), target (silk).
      const X0 = 200;
      const X1 = 1720;
      const base = 720;
      const prior = (x) => 0.55 * Math.exp(-((x - 0.35) ** 2) / 0.05) + 0.35 * Math.exp(-((x - 0.72) ** 2) / 0.02);
      const util = (x) => 1.2 * Math.exp(-((x - 0.7) ** 2) / 0.03) - 0.2;
      const curve = (fn, h) => {
        let d = "";
        for (let i = 0; i <= 200; i++) {
          const x = i / 200;
          d += (i ? "L" : "M") + (X0 + x * (X1 - X0)).toFixed(1) + " " + (base - fn(x) * h).toFixed(1);
        }
        return d;
      };
      const gA = el("g", {}, svg);
      gA.style.filter = GLOW.a;
      const pP = el("path", { d: curve(prior, 380), fill: "none", stroke: ink("--phos-a"), "stroke-width": 3 }, gA);
      const gB = el("g", {}, svg);
      gB.style.filter = GLOW.b;
      const target = (x) => prior(x) * Math.exp(2.2 * util(x));
      const mx = Math.max(...Array.from({ length: 201 }, (_, i) => target(i / 200)));
      const pT = el("path", { d: curve((x) => target(x) / mx, 420), fill: inkA("--phos-b", 0.08), stroke: ink("--phos-b"), "stroke-width": 3.2 }, gB);
      el("line", { x1: X0, y1: base, x2: X1, y2: base, stroke: ink("--hairline"), "stroke-width": 2 }, svg);
      const legend = place(el("div", { class: "mono" }, over, ""), { x: X0, y: base + 30 });
      legend.innerHTML = `<span style="color:${ink("--phos-a")}">— the grammar's prior</span> &nbsp;&nbsp; <span style="color:${ink("--phos-b")}">— tilted by your taste</span>`;
      Object.assign(legend.style, { fontSize: "22px" });
      // An MH chain: dots hopping, mostly within the amber mode.
      const R = rng(99);
      const chain = [];
      let x = 0.35;
      for (let i = 0; i < 90; i++) {
        const prop = clamp(x + (R() - 0.5) * 0.22, 0.02, 0.98);
        if (R() < Math.min(1, target(prop) / target(x))) x = prop;
        chain.push(x);
      }
      const cg = el("g", {}, svg);
      cg.style.filter = GLOW.b;
      const walker = el("circle", { r: 11, fill: ink("--phos-b-hot") }, cg);
      const trail = Array.from({ length: 12 }, () => el("circle", { r: 5, fill: ink("--phos-b"), opacity: 0 }, cg));
      const lock = place(el("div", { class: "pill" }, over, "🔒 locked knobs: exact conditioning"), { x: 1500, y: 300, ax: 0.5 });
      const v1 = voiceLine(over, "Search targets a *Boltzmann distribution*: the grammar's prior, _tilted by expected utility_.");
      const v2 = voiceLine(over, "Refinement is *Metropolis-Hastings* on the trace, through fugue-evo. A lock is exact conditioning.");
      const lenP = pP.getTotalLength();
      pP.setAttribute("stroke-dasharray", `${lenP} ${lenP}`);
      return (tl, t) => {
        f.style.opacity = ramp(t, b.t0 + 0.1, b.t0 + 0.6);
        pP.setAttribute("stroke-dashoffset", lenP * (1 - ramp(t, b.t0 + 0.4, b.t0 + 1.6)));
        const tilt = ramp(t, wordTime(l1, "tilted"), wordTime(l1, "tilted") + 1.0, E.io3);
        gB.style.opacity = tilt;
        legend.style.opacity = ramp(t, b.t0 + 1.0, b.t0 + 1.5);
        const run = ramp(t, l2.t0, l2.t1 + 1.5, E.lin);
        const k = Math.floor(run * (chain.length - 1));
        const px = (v) => X0 + v * (X1 - X0);
        const py = (v) => base - (target(v) / mx) * 420;
        walker.setAttribute("cx", px(chain[k]));
        walker.setAttribute("cy", py(chain[k]));
        walker.setAttribute("opacity", run > 0 ? 1 : 0);
        trail.forEach((d, i) => {
          const j = Math.max(0, k - (i + 1) * 2);
          d.setAttribute("cx", px(chain[j]));
          d.setAttribute("cy", py(chain[j]));
          d.setAttribute("opacity", run > 0 ? 0.5 * (1 - i / trail.length) : 0);
        });
        lock.style.opacity = ramp(t, wordTime(l2, "lock"), wordTime(l2, "lock") + 0.4);
        speak(v1, t, l1, l2.t0);
        speak(v2, t, l2, b.t1 + 0.4);
        void tl;
        void under;
      };
    },
  });
}

// ---------------------------------------------------------------------------

function scenePerform({ stage, beat, line }) {
  const b = beat("perform");
  const l1 = line("perform1");
  const l2 = line("perform2");
  stage.scene({
    id: "perform", t0: b.t0, t1: b.t1, pre: 0.3, post: 0.5, fin: 0.4, fout: 0.5,
    build(layer) {
      const { under, svg, over } = stack(layer);
      // Left: named directions in feature space.
      const O = [420, 470];
      const named = [["Bright", 0.2], ["Snap", 1.3], ["Motion", 2.2], ["Body", 3.3], ["Grit", 4.2], ["Space", 5.3]];
      const dirs = named.map(([n, a]) => {
        const p = [O[0] + Math.cos(a) * 250, O[1] - Math.sin(a) * 250];
        const ar = arrow(svg, O, p, "a", { width: 3 });
        const lb = place(el("div", { class: "mono" }, over, n), { x: O[0] + Math.cos(a) * 295, y: O[1] - Math.sin(a) * 295, ax: 0.5, ay: 0.5 });
        Object.assign(lb.style, { fontSize: "22px", color: ink("--silk") });
        return { ar, lb };
      });
      // Right: the Jacobian, knobs × features, as a heat grid.
      const J = [];
      const R = rng(17);
      const gx = 900;
      const gy = 220;
      for (let i = 0; i < 8; i++) {
        for (let j = 0; j < 12; j++) {
          const v = (R() - 0.5) * 2 * (j === 0 && i < 2 ? 2 : 1);
          J.push({ r: el("rect", { x: gx + j * 42, y: gy + i * 42, width: 38, height: 38, rx: 4, fill: v > 0 ? ink("--phos-a") : ink("--phos-a-deep"), opacity: 0 }, svg), a: Math.min(1, Math.abs(v)) });
        }
      }
      const jl = place(el("div", { class: "mono" }, over, "∂φ / ∂knob — one render per knob"), { x: gx, y: gy - 50 });
      Object.assign(jl.style, { fontSize: "22px", color: ink("--silk-dim") });
      const ridge = place(el("div", { class: "pill a" }, over, "ridge solve → ≤ 4 knobs per control"), { x: gx + 250, y: 600, ax: 0.5 });
      const checks = ["−1", "−½", "+½", "+1"].map((s, i) => {
        const d = place(el("div", { class: "pill a" }, over, `${s} ✓`), { x: gx + 20 + i * 130, y: 700 });
        return d;
      });
      const rendered = place(el("div", { class: "mono" }, over, "checked on real renders"), { x: gx + 20, y: 770 });
      Object.assign(rendered.style, { fontSize: "20px", color: ink("--silk-mute") });
      const v1 = voiceLine(over, "PERFORM's named controls are *fixed directions* in that standardized space of sound.");
      const v2 = voiceLine(over, "For each patch, a *finite-difference Jacobian* and a *ridge solve* wire each control to its knobs. Every half of every control is then _checked on real renders_.", { size: 40 });
      return (tl, t) => {
        dirs.forEach((d, i) => {
          d.ar.update(ramp(t, b.t0 + 0.3 + i * 0.15, b.t0 + 0.8 + i * 0.15));
          d.lb.style.opacity = ramp(t, b.t0 + 0.6 + i * 0.15, b.t0 + 1.0 + i * 0.15);
        });
        const tj = wordTime(l2, "Jacobian");
        J.forEach((c, i) => c.r.setAttribute("opacity", c.a * ramp(t, tj - 0.3 + (i % 12) * 0.05, tj + 0.2 + (i % 12) * 0.05)));
        jl.style.opacity = ramp(t, tj - 0.3, tj + 0.1);
        ridge.style.opacity = ramp(t, wordTime(l2, "ridge"), wordTime(l2, "ridge") + 0.4);
        const tc = wordTime(l2, "checked");
        checks.forEach((c, i) => (c.style.opacity = ramp(t, tc - 0.2 + i * 0.2, tc + 0.1 + i * 0.2)));
        rendered.style.opacity = ramp(t, tc + 0.6, tc + 1.0);
        speak(v1, t, l1, l2.t0);
        speak(v2, t, l2, b.t1 + 0.4);
        void tl;
        void under;
      };
    },
  });
}

// ---------------------------------------------------------------------------

function sceneRuntime({ stage, beat, line }) {
  const b = beat("runtime");
  const l1 = line("runtime1");
  stage.scene({
    id: "runtime", t0: b.t0, t1: b.t1, pre: 0.3, post: 0.5, fin: 0.4, fout: 0.5,
    build(layer) {
      const { under, svg, over } = stack(layer);
      const tab = place(el("div", {}, under), { x: 140, y: 140, w: 1640, h: 700 });
      Object.assign(tab.style, { border: `1.5px solid ${ink("--hairline")}`, borderRadius: "16px", background: inkA("--panel", 0.35) });
      const tl0 = place(el("div", { class: "mono" }, over, "your browser tab"), { x: 170, y: 160 });
      Object.assign(tl0.style, { fontSize: "20px", color: ink("--silk-mute") });
      const B = [
        box(under, { x: 220, y: 260, w: 360, h: 170, title: "main thread", sub: "the UI: PERFORM, PATCH,\nEVOLVE, TASTE", color: "s" }),
        box(under, { x: 780, y: 260, w: 360, h: 170, title: "engine worker", sub: "auracle-wasm: search,\ntaste, wiring" }),
        box(under, { x: 1340, y: 260, w: 360, h: 170, title: "AudioWorklet", sub: "the voices, A and B,\nsample by sample" }),
        box(under, { x: 780, y: 580, w: 360, h: 170, title: "render farm", sub: "N workers: audition\n+ φ in parallel" }),
      ];
      const ar = [
        arrow(svg, [580, 345], [780, 345]),
        arrow(svg, [1140, 345], [1340, 345]),
        arrow(svg, [960, 430], [960, 580], "a", { dash: "8 8" }),
      ];
      const v1 = voiceLine(over, "In the browser, the engine runs in a *worker*, and the voices in an *AudioWorklet*. A *render farm* measures candidates in parallel.");
      return (tl, t) => {
        tab.style.opacity = tl0.style.opacity = ramp(t, b.t0, b.t0 + 0.5);
        const ks = [0, wordTime(l1, "worker"), wordTime(l1, "AudioWorklet"), wordTime(l1, "render farm")];
        B.forEach((d, i) => {
          const u = ramp(t, (i === 0 ? b.t0 + 0.3 : ks[i]) - 0.2, (i === 0 ? b.t0 + 0.3 : ks[i]) + 0.3, E.out3);
          d.style.opacity = u;
          d.style.transform = `translateY(${(1 - u) * 16}px)`;
        });
        ar.forEach((a, i) => a.update(ramp(t, ks[i + 1], ks[i + 1] + 0.5)));
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
      const mk = mark(svg, { cx: left + markPx / 2, cy: 380, size: markPx });
      place(lock, { x: left + markPx + gap, y: 380, ay: 0.5 });
      const v1 = voiceLine(over, "Every claim here has *a measurement behind it*, in the reference. Read it, run it, and change it.", { y: 580, size: 48 });
      const links = ["reference", "API docs", "source"].map((s, i) => place(el("div", { class: "pill a" }, over, `${s}  ▸`), { x: 960 + (i - 1) * 300, y: 720, ax: 0.5, ay: 0.5 }));
      stage.sfx("logo_sting", b.t0 - 0.1, -2);
      return (tl, t) => {
        const u = ramp(t, b.t0 - 0.2, b.t0 + 0.7, E.out4);
        mk.update({ tile: u, outer: u, inner: ramp(t, b.t0 - 0.3, b.t0 + 0.4), core: E.outBack(ramp(t, b.t0 - 0.3, b.t0 + 0.2, E.lin)) });
        lock.style.opacity = u;
        speak(v1, t, l1, b.t1 + 5);
        links.forEach((l, i) => (l.style.opacity = ramp(t, l1.t1 - 0.6 + i * 0.2, l1.t1 - 0.2 + i * 0.2)));
        layer.style.opacity = 1 - ramp(t, b.t1 - 0.8, b.t1, E.io2);
        void tl;
      };
    },
  });
}
