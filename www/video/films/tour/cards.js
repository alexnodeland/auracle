// The tour's two cards, drawn with the kit over the footage window: the title
// (the lockup assembling over the instrument the cold open just played, then
// lifting off it to leave the map), and the end (the lockup and where to
// play it). film.js imports this only when a real stage builds the film, so
// the plan-only checks (validate, framing) never load the kit.
import { el, place, lerp, ramp, E } from "../../stage/stage.js";
import { svgLayer, mark, textBlock, ink, inkA } from "../../stage/kit.js";

// Where walk.js puts the recorded app (its default frame).
const F = { x: 120, y: 70, w: 1680, h: 945 };

/** A dark glass over the footage window only: the captions under it and the
 *  chapter label over it stay clear. */
function scrim(layer, alpha) {
  const d = place(el("div", {}, layer), { x: F.x, y: F.y, w: F.w, h: F.h });
  Object.assign(d.style, {
    borderRadius: "var(--r3)",
    background: `radial-gradient(90% 80% at 50% 46%, ${inkA("--rack", alpha)} 0%, ${inkA("--bezel", Math.min(1, alpha + 0.08))} 100%)`,
  });
  return d;
}

/** The mark and the wordmark side by side, centred at (960, cy). */
function lockup(layer, svg, { cy, size }) {
  const lock = place(el("div", { class: "lk" }, layer), { x: 0, y: 0 });
  lock.style.fontSize = `${size}px`;
  const wm = el("span", { class: "wm" }, lock, "AURACLE");
  const wmW = wm.getBoundingClientRect().width;
  const markPx = 1.28 * size;
  const gap = 0.62 * size;
  const left = 960 - (markPx + gap + wmW) / 2;
  const mk = mark(svg, { cx: left + markPx / 2, cy, size: markPx });
  place(lock, { x: left + markPx + gap, y: cy, ay: 0.5 });
  lock.style.transform = "translateY(-0.035em)";
  return { lock, wm, mk };
}

export function cards(stage) {
  const beat = (id) => stage.tl.beats.find((b) => b.id === id);
  titleCard(stage, beat("title"), stage.line("title2"));
  endCard(stage, beat("next"), stage.line("next6"));
}

// The title: over the first bar of the bed, the lockup draws itself on the
// instrument the cold open was playing; as the narrator turns to the map it
// lifts away, and the map's callouts (film.js) are left on the real screen.
function titleCard(stage, b, l2) {
  const lift = l2.t0 - 0.15;
  stage.scene({
    id: "tour-title",
    t0: b.t0,
    t1: lift,
    pre: 0.35,
    post: 0.55,
    fin: 0.35,
    fout: 0.55,
    z: 5,
    build(layer) {
      const glass = scrim(layer, 0.8);
      const svg = svgLayer(layer);
      const { lock, wm, mk } = lockup(layer, svg, { cy: 470, size: 104 });
      const sub = textBlock(layer, { x: 960, y: 610, w: 1400, cls: "mono", size: 26, align: "center", ax: 0.5, ay: 0.5 });
      Object.assign(sub.style, { letterSpacing: "0.26em", textTransform: "uppercase", color: ink("--silk-dim") });
      sub.textContent = "a tour of the instrument";
      return (tl) => {
        glass.style.opacity = ramp(tl, -0.35, 0.1, E.io2);
        const u = ramp(tl, -0.1, 0.8, E.out4);
        mk.update({ tile: u, outer: ramp(tl, 0.0, 0.9), inner: ramp(tl, -0.15, 0.6), core: E.outBack(ramp(tl, -0.1, 0.4, E.lin)) });
        lock.style.opacity = ramp(tl, 0.15, 0.9, E.out3);
        wm.style.letterSpacing = `${lerp(0.34, 0.095, ramp(tl, 0.15, 1.2, E.out4))}em`;
        sub.style.opacity = ramp(tl, 0.9, 1.6, E.io2);
        sub.style.letterSpacing = `${lerp(0.4, 0.26, ramp(tl, 0.9, 1.9, E.out4))}em`;
        // A slow push while it holds.
        const s = lerp(1.0, 1.03, ramp(tl, 0, lift - b.t0, E.lin));
        for (const n of [lock, sub]) n.style.scale = String(s);
        svg.style.transformOrigin = "960px 470px";
        svg.style.scale = String(s);
      };
    },
  });
}

// The end: the lockup and the address, over the instrument, on the last line.
function endCard(stage, b, l6) {
  const t0 = l6.t0 - 0.35;
  stage.scene({
    id: "tour-end",
    t0,
    t1: b.t1,
    pre: 0,
    post: 0,
    fin: 0.5,
    z: 5,
    build(layer) {
      const glass = scrim(layer, 0.84);
      const svg = svgLayer(layer);
      const { lock, wm, mk } = lockup(layer, svg, { cy: 440, size: 96 });
      const url = el("div", { class: "pill a" }, layer, "auracle.alexnodeland.com  ▸");
      place(url, { x: 960, y: 590, ax: 0.5, ay: 0.5 });
      Object.assign(url.style, { fontSize: "var(--t-frame-5)", padding: "var(--s4) var(--s6)" });
      const note = textBlock(layer, { x: 960, y: 672, w: 1400, cls: "mono", size: 21, align: "center", ax: 0.5, ay: 0.5 });
      Object.assign(note.style, { letterSpacing: "0.14em", textTransform: "uppercase", color: ink("--silk-mute") });
      note.textContent = "the instrument · the guide · a film for each view";
      // The last moment goes to black, frame and captions with it.
      const black = place(el("div", {}, layer), { x: 0, y: 0, w: 1920, h: 1080 });
      black.style.background = ink("--fade-black");
      const end = b.t1 - t0;
      return (tl) => {
        glass.style.opacity = ramp(tl, 0, 0.45, E.io2);
        const u = ramp(tl, 0.05, 0.9, E.out4);
        mk.update({ tile: u, outer: ramp(tl, 0.1, 1.0), inner: ramp(tl, 0.0, 0.7), core: E.outBack(ramp(tl, 0.0, 0.5, E.lin)) });
        lock.style.opacity = u;
        wm.style.letterSpacing = `${lerp(0.3, 0.095, u)}em`;
        const v = ramp(tl, 0.8, 1.4, E.out3);
        url.style.opacity = v;
        url.style.transform = `translateY(${(1 - v) * 12}px)`;
        note.style.opacity = ramp(tl, 1.3, 1.9, E.io2);
        black.style.opacity = ramp(tl, end - 0.7, end, E.io2);
      };
    },
  });
}
