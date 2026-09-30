// TASTE: what it learned about you — the TASTE view, in the real app, for
// musicians.
//
// One recorded shot per beat (shots.json; tools/footage.mjs records them from
// apps/web with the app's own sound, auditions included). The camera and the
// callouts are pinned to the narration's words and to the elements
// footage.mjs measured. `aim(z, x, y)` centres the camera on a point of the
// 1920×1080 app. The title and the outro are drawn with the kit over their
// shots, the way films/launch draws its cards.
//
// The sessions (gen_shots.py and session.py write shots.json; each shot builds
// its session off camera):
// - FRESH, for the cold open and the title: the warm start skipped, five
//   picks, and a musical pair on the table (re-dealt with skip, which
//   records nothing). The sixth pick, on camera, is the model's first fit:
//   the map goes from "nothing predicted yet" to lit.
// - RICH, for every chapter: the warm start, thirty duels and five stars from
//   one consistent listener (dark, slow sounds and bright, struck ones over
//   anything noisy), then duels to the edge of a refit.
// Every dot, row and bin a shot points at is found from the engine's own
// taste views and marked with an invisible marker, so a callout lands on it
// wherever the seeded session puts it.
//
// Where this departs from VIEWS.md's outline, because the app does otherwise:
// - The map only changes at a refit, and refits follow duels (EVOLVE), not
//   stars. So "picks land" is shown the way the app designs it: a pick, then
//   "● it just learned — see what changed ▸", then the map.
// - The wrong beat marks the corrected dot again after the refit: the axes
//   turn a little at every refit, so the dot has moved by then. One pick
//   against the model moves it a little, and the narration says so.
// - The cold open cuts from the link to just before the fit lands, and the
//   wrong beat from its link to the refit (the shots' `clips`; no cut when
//   they are quick).
// - profile: the system's file picker cannot be filmed, so the load is shown
//   from the moment a file is chosen, which is when the app asks its question.
import { walkthrough, aim } from "../../stage/walk.js";

const PLAN = [
  {
    beat: "open",
    shot: "vt-open",
    // Wide on the map before any fit; in on the pair; wide as the map
    // lights; then a slow, centred push. Centred, not onto the dot that is
    // played: this session's first deal can differ between takes (it is dealt
    // while the pool fills), and with it which dot that is.
    cam: [[0, 1.0, 0.5, 0.5], [1.4, 1.0, 0.5, 0.5], [2.0, ...aim(1.12, 960, 470)], [6.1, ...aim(1.12, 960, 470)],
      [6.9, 1.0, 0.5, 0.5], [8.4, 1.0, 0.5, 0.5], [14.2, ...aim(1.08, 1080, 540)]],
  },
  {
    beat: "title",
    shot: "vt-title",
    cam: [[0, ...aim(1.08, 1080, 540)], ["title2", ...aim(1.12, 1100, 540)]],
  },
  {
    beat: "tabs",
    shot: "vt-tabs",
    chapter: "01 · four ways in",
    cam: [[0, 1.0, 0.5, 0.5], ["tabs1:four", ...aim(1.2, 900, 420)], ["tabs4-0.2", ...aim(1.35, 760, 300)]],
    callouts: [
      { at: "tabs2:map", until: "tabs2:Styles", mark: "tab-map", side: "bottom", dx: 40, dy: 90, text: "where your sounds sit" },
      { at: "tabs2:Styles", until: "tabs3:Directions", mark: "tab-styles", side: "bottom", dx: 40, dy: 90, text: "the tastes it has found" },
      { at: "tabs3:Directions", until: "tabs3:Trust", mark: "tab-dir", side: "bottom", dx: 40, dy: 90, text: "what pulls you" },
      { at: "tabs3:Trust", until: "tabs4", mark: "tab-trust", side: "bottom", dx: 40, dy: 90, text: "whether to believe it" },
      { at: "tabs4:chips", mark: "chips", side: "bottom", ox: -440, dx: 60, dy: 90, text: "your styles, in every tab" },
    ],
  },
  {
    beat: "map",
    shot: "vt-map",
    chapter: "02 · the map",
    cam: [[0, 1.0, 0.5, 0.5], ["map1:heard", ...aim(1.08, 1000, 600)], ["map2:Nearby-0.3", ...aim(1.8, 840, 720)], ["map2:flat", ...aim(1.08, 1000, 600)],
      ["map3:Glow-0.2", 1.0, 0.5, 0.5], ["map4-0.2", ...aim(1.8, 1278, 600)], ["map5-0.2", ...aim(1.7, 1090, 300)]],
    callouts: [
      { at: "map2:Nearby+0.4", until: "map2:flat", mark: "n1", side: "top", dx: -60, dy: -90, text: "side by side, and named alike" },
      { at: "map3:Glow", until: "map3:bank", mark: "legend", side: "top", ox: -40, dx: -60, dy: -70, text: "dim to bright: would like" },
      { at: "map3:bank", until: "map4", mark: "row0", side: "right", dx: 80, dy: 10, text: "its best guesses first" },
      { at: "map4:small", until: "map5", mark: "yes", side: "left", ox: -8, dx: -120, dy: -70, text: "small and bright: a firm yes" },
      { at: "map5:big", mark: "maybe", side: "left", ox: -12, dx: -110, dy: 70, text: "big and bright: a maybe" },
    ],
  },
  {
    beat: "hear",
    shot: "vt-hear",
    cam: [[0, ...aim(1.2, 1100, 620)], ["hear2-0.3", ...aim(1.12, 1000, 540)], ["hear3-0.3", ...aim(1.2, 900, 620)]],
    callouts: [
      { at: "hear1:fingers", until: "hear2", mark: "keys", side: "top", ox: 60, dx: 60, dy: -80, text: "your keys play it" },
      { at: "hear2:maybes", until: "hear3", mark: "maybe", side: "right", ox: 12, dx: 100, dy: 70, text: "a maybe" },
      { at: "hear3:dim", mark: "dim", side: "top", dx: 80, dy: -90, text: "dim: it thinks you'd skip it" },
    ],
  },
  {
    beat: "styles",
    shot: "vt-styles",
    chapter: "03 · styles",
    cam: [[0, 1.0, 0.5, 0.5], ["styles2", ...aim(1.12, 1000, 480)], ["styles4-0.3", ...aim(1.6, 600, 300)], ["styles5:sticks", ...aim(1.25, 700, 360)]],
    callouts: [
      { at: "styles3:separate", until: "styles4", mark: "chips", side: "bottom", ox: -440, dx: 60, dy: 90, text: "your styles, each with its share" },
      { at: "styles4:plays", until: "styles4:plays+2.9", mark: "play-first", side: "bottom", dx: 40, dy: 110, text: "its best example" },
      { at: "styles4:plays+2.9", until: "styles5", mark: "play-second", side: "bottom", dx: -60, dy: 110, text: "another style's" },
      { at: "styles5:sticks", mark: "named", side: "bottom", dx: 60, dy: 100, text: "yours now" },
    ],
  },
  {
    beat: "directions",
    shot: "vt-dir",
    chapter: "04 · directions",
    cam: [[0, 1.0, 0.5, 0.5], ["dir1:listens", ...aim(1.1, 1080, 520)], ["dir3-0.2", ...aim(1.45, 820, 330)], ["dir4", ...aim(1.1, 1080, 560)], ["dir5-0.2", ...aim(1.4, 1250, 330)]],
    callouts: [
      { at: "dir2:right", until: "dir2:left", mark: "right", side: "right", dx: 70, dy: -40, text: "toward" },
      { at: "dir2:left", until: "dir3", mark: "left", side: "left", dx: -70, dy: 40, text: "away" },
      { at: "dir3:every", until: "dir4", mark: "agree", side: "left", dx: -90, dy: -50, text: "noise srcs: every style leans away" },
      { at: "dir4:hear", until: "dir4:Others", mark: "heard", side: "left", dx: -90, dy: -40, text: "what you hear" },
      { at: "dir4:built", until: "dir5", mark: "built", side: "left", dx: -90, dy: 40, text: "what it's built from" },
      { at: "dir5:across", mark: "guess", side: "right", dx: 50, dy: -70, text: "hollow, with a ?: still a guess" },
    ],
  },
  {
    beat: "trust",
    shot: "vt-trust",
    chapter: "05 · trust",
    cam: [[0, 1.0, 0.5, 0.5], ["trust2", ...aim(1.25, 760, 520)], ["trust4-0.2", ...aim(1.6, 700, 880)], ["trust5", ...aim(1.1, 900, 520)]],
    callouts: [
      { at: "trust2:forecasts", until: "trust3", mark: "xaxis", side: "bottom", dx: 60, dy: 50, text: "its forecast, before you pick" },
      { at: "trust3:diagonal", until: "trust3:whiskers", mark: "honest", side: "right", dx: 90, dy: -40, text: "honest" },
      { at: "trust3:whiskers", until: "trust4", mark: "bin", side: "left", dx: -90, dy: 40, text: "a bucket of forecasts, and its wobble" },
      { at: "trust4:random", until: "trust5", mark: "check", side: "bottom", ox: 200, dx: 40, dy: 50, text: "the number to trust", color: "b" },
    ],
  },
  {
    beat: "wrong",
    shot: "vt-wrong",
    chapter: "06 · when it's wrong",
    cam: [[0, 1.0, 0.5, 0.5], ["wrong2-0.2", ...aim(1.5, 1250, 560)], ["wrong3:star-0.3", ...aim(1.3, 300, 800)], ["wrong4", 1.0, 0.5, 0.5], ["wrong6", ...aim(1.5, 1330, 540)]],
    callouts: [
      { at: "wrong2:thinks+0.5", until: "wrong3", mark: "wrong", side: "left", ox: -8, dx: -110, dy: -80, text: "it's sure you'll like this" },
      { at: "wrong3:star", until: "wrong4", mark: "star1", side: "right", dx: 90, dy: -40, text: "one star" },
      { at: "wrong4:other+0.3", until: "wrong5:See", mark: "pred", side: "bottom", dx: 60, dy: 70, text: "it had this backwards", color: "b" },
      { at: "wrong6:lower", mark: "wrong2", side: "right", ox: 8, dx: 110, dy: -80, text: "a little lower" },
    ],
  },
  {
    beat: "profile",
    shot: "vt-profile",
    chapter: "07 · your profile",
    cam: [[0, 1.0, 0.5, 0.5], ["profile1:stays-0.2", ...aim(1.6, 1700, 300)], ["profile3-0.3", ...aim(1.3, 1100, 300)]],
    callouts: [
      { at: "profile2:save", until: "profile2:load", mark: "save", side: "left", dx: -90, dy: 20, text: "a file you keep" },
      { at: "profile3:Loading+0.3", until: "profile4", mark: "alarm-load", side: "bottom", dx: 40, dy: 60, text: "it asks, and saves yours first" },
      { at: "profile4:asks", mark: "alarm", side: "bottom", dx: 40, dy: 60, text: "it asks first: saved patches stay" },
    ],
  },
  {
    beat: "together",
    shot: "vt-together",
    chapter: "08 · the loop",
    cam: [[0, 1.0, 0.5, 0.5], ["together2:walk-0.3", ...aim(1.2, 1000, 500)], ["together3:back", 1.0, 0.5, 0.5]],
    callouts: [
      { at: "together2:arrow", until: "together3", mark: "t1", side: "top", dx: -90, dy: -70, text: "arrows step, Enter opens" },
      { at: "together3:maybe", until: "together3:Star", mark: "t2", side: "right", ox: 12, dx: 100, dy: 60, text: "a maybe" },
      { at: "together3:Star+0.2", until: "together3:back", mark: "star5", side: "right", dx: 90, dy: -40, text: "five stars" },
    ],
  },
  {
    beat: "outro",
    shot: "vt-outro",
    cam: [[0, 1.0, 0.5, 0.5]],
  },
];

export async function build(stage) {
  await walkthrough(stage, { plan: PLAN });
  // A plan checker may hand build() a bare object: the cards need a stage.
  if (!stage.tl) return;
  // The kit, loaded here rather than at the top, so that checking the plan
  // needs nothing but walk.js.
  const [S, K] = await Promise.all([import("../../stage/stage.js"), import("../../stage/kit.js")]);
  kit = { ...S, ...K };
  const beat = (id) => stage.tl.beats.find((b) => b.id === id);
  titleCard(stage, beat("title"));
  outroCard(stage, beat("outro"));
}

// stage.js and kit.js, once build() has loaded them.
let kit = null;

/** The four views, in the order the films go through them. */
const VIEWS = ["PERFORM", "PATCH", "EVOLVE", "TASTE"];

/** A row of the four view names; `lit(i)` → 0..1 glow and `color(i)`. */
function viewsRow(layer, { x, y, size = 30, gap = 64 }) {
  const { el, place, lerp, PHOS } = kit;
  const row = place(el("div", {}, layer), { x, y, ay: 0.5 });
  Object.assign(row.style, { display: "flex", alignItems: "center", gap: `${gap}px`, whiteSpace: "nowrap" });
  const items = VIEWS.map((v) => {
    const s = el("span", { class: "silk" }, row, v);
    Object.assign(s.style, { fontSize: `${size}px`, letterSpacing: "0.22em", color: "#6f6c63" });
    return s;
  });
  return {
    row,
    items,
    update(glow) {
      items.forEach((s, i) => {
        const g = glow[i] || { u: 0, c: "b" };
        const col = g.c === "a" ? PHOS.a : PHOS.b;
        s.style.color = g.u > 0.02 ? col : "#6f6c63";
        s.style.opacity = String(lerp(0.55, 1, g.u));
        s.style.textShadow = g.u > 0.02 ? `0 0 ${Math.round(18 * g.u)}px ${g.c === "a" ? "rgba(142,240,177,.55)" : "rgba(255,180,84,.6)"}` : "none";
      });
    },
  };
}

/** The title: TASTE, fourth of the four views, over the map that just lit. */
function titleCard(stage, b) {
  const { el, place, ramp, lerp, E, svgLayer, mark, textBlock, PHOS } = kit;
  const l1 = stage.line("title1");
  stage.scene({
    id: "title-card",
    t0: b.t0,
    t1: b.t1,
    pre: 0.4,
    post: 0.2,
    z: 5,
    build(layer) {
      const scrim = place(el("div", {}, layer), { x: 0, y: 0, w: 1920, h: 1080 });
      scrim.style.background = "linear-gradient(90deg, rgba(7,8,10,.93) 0%, rgba(7,8,10,.82) 38%, rgba(7,8,10,.25) 70%, rgba(7,8,10,0) 100%)";
      const svg = svgLayer(layer);
      const mk = mark(svg, { cx: 196, cy: 318, size: 92 });
      const eyebrow = textBlock(layer, { x: 262, y: 318, w: 900, cls: "eyebrow b", size: 22, ay: 0.5 });
      eyebrow.textContent = "Auracle · the four views";
      const big = textBlock(layer, { x: 146, y: 470, w: 1200, cls: "display", size: 196, ay: 0.5 });
      big.textContent = "TASTE";
      Object.assign(big.style, { fontWeight: "400", letterSpacing: "0.16em", color: PHOS.b, textShadow: "0 0 34px rgba(255,180,84,.35)" });
      const sub = textBlock(layer, { x: 152, y: 614, w: 1100, cls: "voice", size: 58, ay: 0.5 });
      sub.textContent = "what it learned about you";
      const views = viewsRow(layer, { x: 156, y: 742, size: 24, gap: 46 });
      return (tl) => {
        const T = b.t1 - b.t0;
        const u = ramp(tl, -0.4, 0.5, E.out3);
        const out = 1 - ramp(tl, T - 0.7, T + 0.1, E.io2);
        scrim.style.opacity = String(u * out);
        mk.update({ tile: u, outer: ramp(tl, -0.2, 0.7), inner: ramp(tl, 0.0, 0.8), core: E.outBack(ramp(tl, 0.2, 0.7, E.lin)) });
        mk.g.style.opacity = String(out);
        eyebrow.style.opacity = String(ramp(tl, 0.1, 0.7) * out);
        const w = ramp(tl, 0.0, 1.1, E.out4);
        big.style.opacity = String(w * out);
        big.style.letterSpacing = `${lerp(0.42, 0.16, w)}em`;
        sub.style.opacity = String(ramp(tl, l1.t0 - b.t0 - 0.2, l1.t0 - b.t0 + 0.5) * out);
        views.row.style.opacity = String(ramp(tl, 0.9, 1.6) * out);
        const lit = ramp(tl, 1.3, 2.0);
        views.update([{ u: 0.0 }, { u: 0.0 }, { u: 0.0 }, { u: lit, c: "b" }]);
      };
    },
  });
}

/** The outro: the last of the four views, where to go next, and the guide. */
function outroCard(stage, b) {
  const { el, place, ramp, E, svgLayer, mark, textBlock } = kit;
  const o1 = stage.line("outro1");
  const o2 = stage.line("outro2");
  const o3 = stage.line("outro3");
  const w = (l, word) => {
    const i = l.text.toLowerCase().indexOf(word.toLowerCase());
    if (i < 0) return l.t0;
    const k = l.text.slice(0, i).split(/\s+/).filter(Boolean).length;
    return l.words ? l.words[Math.min(k, l.words.length - 1)] : l.t0 + ((l.t1 - l.t0) * i) / l.text.length;
  };
  stage.scene({
    id: "outro-card",
    t0: b.t0,
    t1: b.t1,
    pre: 0.2,
    post: 0.1,
    z: 5,
    build(layer) {
      const scrim = place(el("div", {}, layer), { x: 0, y: 0, w: 1920, h: 1080 });
      scrim.style.background = "radial-gradient(120% 95% at 50% 45%, rgba(7,8,10,.80) 0%, rgba(7,8,10,.90) 60%, rgba(7,8,10,.96) 100%)";
      const views = viewsRow(layer, { x: 960, y: 400, size: 40, gap: 80 });
      views.row.style.translate = "-50% -50%";
      const loop = textBlock(layer, { x: 960, y: 486, w: 1200, cls: "mono", size: 24, align: "center", ax: 0.5, ay: 0.5 });
      loop.textContent = "play it · shape it · pick · read what it learned";
      loop.style.letterSpacing = "0.12em";
      const go = textBlock(layer, { x: 960, y: 610, w: 1500, cls: "voice", size: 56, align: "center", ax: 0.5, ay: 0.5 });
      go.innerHTML = `go play, and keep picking in <span class="gb">EVOLVE</span>`;
      const guide = el("div", { class: "pill b" }, layer, "the guide  ›  the four views  ›  TASTE");
      place(guide, { x: 960, y: 738, ax: 0.5, ay: 0.5 });
      Object.assign(guide.style, { fontSize: "26px", padding: "14px 30px" });
      const url = textBlock(layer, { x: 960, y: 800, w: 1200, cls: "mono", size: 22, align: "center", ax: 0.5, ay: 0.5 });
      url.textContent = "auracle.alexnodeland.com/docs";
      const svg = svgLayer(layer);
      const mk = mark(svg, { cx: 960, cy: 236, size: 84 });
      return (tl, t) => {
        const T = b.t1 - b.t0;
        const u = ramp(tl, -0.2, 0.6, E.out3);
        scrim.style.opacity = String(u);
        mk.update({ tile: u, outer: ramp(tl, 0.0, 0.8), inner: ramp(tl, 0.2, 1.0), core: E.outBack(ramp(tl, 0.3, 0.8, E.lin)) });
        views.row.style.opacity = String(ramp(tl, 0.1, 0.8));
        loop.style.opacity = String(ramp(t, o1.t1 - 0.2, o1.t1 + 0.5));
        const taste = ramp(t, w(o1, "TASTE") - 0.1, w(o1, "TASTE") + 0.4);
        const play = ramp(t, w(o2, "play") - 0.1, w(o2, "play") + 0.4);
        const evo = ramp(t, w(o2, "EVOLVE") - 0.1, w(o2, "EVOLVE") + 0.4);
        views.update([{ u: play, c: "a" }, { u: 0 }, { u: evo, c: "b" }, { u: taste * (1 - 0.5 * evo), c: "b" }]);
        const g = ramp(t, w(o2, "go") - 0.2, w(o2, "go") + 0.4, E.out3);
        go.style.opacity = String(g);
        go.style.transform = `translateY(${(1 - g) * 10}px)`;
        const p = ramp(t, o3.t0 - 0.1, o3.t0 + 0.5, E.out3);
        guide.style.opacity = String(p);
        guide.style.transform = `translateY(${(1 - p) * 10}px)`;
        url.style.opacity = String(p * 0.9);
        // The very end fades to black with the bed's last bar.
        layer.style.opacity = String(1 - ramp(tl, T - 0.6, T + 0.1, E.io2));
      };
    },
  });
}
