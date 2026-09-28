// EVOLVE: breeding sounds you like — the deep dive into EVOLVE, over the
// real app.
//
// A cold open (a duel you can hear: A, then B, a pick, and the next pair
// sliding in), the title over the bed, then eight chapters, each opened by a
// one-bar card over the bed (cards.js) and played over one recorded shot
// (shots.json; tools/footage.mjs): the duel, playing a card yourself, the
// warm start, what a pick does, why pairs are random, a generation, stars,
// save and cut, and a working rhythm that puts them together. The outro
// points on to TASTE.
//
// Every shot is the same seeded session, taught off camera (the warm start
// answered with two pads and a texture). A chapter's turn beat borrows the
// chapter's shot, which starts a bar early (`pre` in shots.json), so the
// footage runs on unbroken under the card. The title borrows the cold open's
// shot the same way. The camera and the callouts are pinned to the
// narration's words and to the elements footage.mjs measured; `aim(z, x, y)`
// centres the camera on a point of the 1920×1080 app. Two beats cut inside
// themselves (the shot's `clips`): the warm start's "teach it" and EVOLVE
// POOL, whose results arrive seconds and minutes after the press.
//
// Under the demos the app is the music: the bed is out (each beat's `bed_db`
// in script.json), and in under the title, the chapter cards, the fair
// questions (which play nothing) and the outro.
import { walkthrough, aim } from "../../stage/walk.js";

// One bar of the bed (84 BPM, 4/4): a turn beat starts on a bar line and its
// chapter one bar later.
const BAR = 240 / 84;
// Each chapter's shot starts this long before its beat (shots.json `pre`).
const PRE = 3.4;

/** A time spec plus an offset, folded into one ("duel2:one-0.8"). */
function T(spec, off) {
  if (typeof spec === "number") return +(spec + off).toFixed(3);
  const m = /([+-]\d+(?:\.\d+)?)$/.exec(spec);
  const base = m ? spec.slice(0, m.index) : spec;
  const o = +((m ? Number(m[1]) : 0) + off).toFixed(3);
  return o === 0 ? base : `${base}${o > 0 ? "+" : "-"}${Math.abs(o)}`;
}

/** A camera that holds, then moves: each stop [at, z, fx, fy] is reached
 *  `move` seconds after the camera leaves the stop before it, so it is
 *  still whenever a callout is up. */
function hold(stops, move = 0.8) {
  const out = [stops[0]];
  for (let i = 1; i < stops.length; i++) {
    const [at, ...v] = stops[i];
    out.push([T(at, -move), ...out[out.length - 1].slice(1)]);
    out.push([at, ...v]);
  }
  return out;
}

/** A turn beat: the chapter's own shot, already running under the card. */
function turn(beat, shot, cam) {
  return { beat, shot, meta: { pre: +(PRE - BAR).toFixed(6) }, clips: [], cam: [[0, ...cam]] };
}

// Framings, in app pixels.
const WIDE = [1.0, 0.5, 0.5];
const CARDS = aim(1.1, 1086, 470);
const CARD_A = aim(1.32, 672, 610);
const CARD_B = aim(1.32, 1498, 610);
const BUTTONS = aim(1.3, 1086, 700);
const METER = aim(1.45, 820, 230);
const METER_R = aim(1.4, 1180, 230);
const POOL_BTN = aim(1.55, 1640, 170);
const RAIL = aim(1.4, 360, 430);
const LINEAGE = aim(1.35, 1100, 840);
const WARM = aim(1.18, 960, 520);

export async function build(stage) {
  await walkthrough(stage, {
    plan: [
      {
        beat: "open",
        shot: "ve-open",
        cam: [[0, ...aim(1.1, 1086, 470)]],
        callouts: [
          { at: 0.4, until: 5.2, mark: "playA", side: "top", dx: 30, dy: -80, text: "A · press 1" },
          { at: 5.5, until: 10.0, mark: "playB", side: "top", dx: 30, dy: -80, text: "B · press 2" },
        ],
      },
      {
        // The cold open's shot runs on under the title card.
        beat: "title",
        shot: "ve-open",
        meta: { pre: +(4 * BAR + 0.5).toFixed(6) },
        clips: [],
        cam: [[0, ...aim(1.1, 1086, 470)], ["title2", ...aim(1.16, 1086, 470)]],
      },
      turn("turn1", "ve-duel", WIDE),
      {
        beat: "duel",
        shot: "ve-duel",
        chapter: "01 · the duel",
        cam: hold([[0, ...WIDE], ["duel2", ...CARD_A], ["duel3", ...CARD_B], ["duel4", ...CARDS], ["duel6", ...BUTTONS], ["duel7", ...CARDS]]),
        callouts: [
          { at: "duel2:one", until: T("duel3", -0.9), mark: "playA", side: "top", dx: 30, dy: -80, text: "1 · hear A" },
          { at: "duel3:two", until: T("duel4", -0.9), mark: "playB", side: "top", dx: 30, dy: -80, text: "2 · hear B" },
          { at: "duel4:phrase", until: "duel5", mark: "scopeA", side: "top", ox: -120, dx: 40, dy: -60, text: "the same five seconds, every time" },
          { at: "duel6:left", until: "duel6:right", mark: "chooseA", side: "top", dy: -80, text: "← picks A" },
          { at: "duel6:right", until: T("duel7", -0.9), mark: "chooseB", side: "top", dy: -80, text: "→ picks B" },
        ],
      },
      turn("turn2", "ve-play", WIDE),
      {
        beat: "play",
        shot: "ve-play",
        chapter: "02 · play it yourself",
        cam: hold([[0, ...WIDE], ["play1:click", ...aim(1.12, 900, 560)], ["play3", ...aim(1.12, 1180, 560)], ["play5", ...WIDE]]),
        callouts: [
          { at: T("play1:click", 0.2), until: T("play2", 0.3), mark: "cardA", side: "top", ox: -200, dx: 40, dy: -40, text: "click a card" },
          { at: T("play2", 0.4), until: T("play3", -0.9), mark: "keybed", side: "top", ox: -150, dx: -40, dy: -70, text: "now on your keys" },
          { at: T("play3:Click", 0.2), until: "play4", mark: "cardB", side: "top", ox: 200, dx: -40, dy: -40, text: "the other card" },
        ],
      },
      turn("turn3", "ve-point", WARM),
      {
        beat: "point",
        shot: "ve-point",
        chapter: "03 · point it",
        cam: hold([[0, ...WARM], [T("point4", 0.8), ...METER]]),
        callouts: [
          { at: "point1:nine", until: "point2", mark: "grid", side: "top", ox: -220, dx: 40, dy: -50, text: "one per family, then filled" },
          { at: T("point2:Play", 0.2), until: "point2:closest", mark: "padplay", side: "right", dx: 80, dy: -30, text: "▶ hear it" },
          { at: "point3:beats", until: T("point4", -0.9), mark: "go", side: "bottom", dy: 80, text: "3 picks × 6 passed = 18" },
          { at: "point4:eighteen", mark: "copy", side: "bottom", ox: -60, dx: 40, dy: 90, text: "eighteen picks in", color: "b" },
        ],
      },
      turn("turn4", "ve-meter", METER),
      {
        beat: "meter",
        shot: "ve-meter",
        chapter: "04 · what a pick does",
        cam: hold([[0, ...METER], ["meter3", ...METER_R], ["meter4", ...METER]]),
        callouts: [
          { at: "meter1:dot", until: T("meter3", -0.9), mark: "pips", side: "bottom", dx: 30, dy: 90, text: "one dot per pick", color: "b" },
          { at: "meter3:forecasts", until: T("meter4", -0.9), mark: "pred", side: "bottom", dy: 90, text: "its forecast, made before you picked", color: "b" },
          { at: T("meter4:sixth", 0.4), mark: "copy", side: "bottom", ox: -60, dx: 40, dy: 90, text: "it just learned", color: "b" },
        ],
      },
      turn("turn5", "ve-fair", METER_R),
      {
        beat: "fair",
        shot: "ve-fair",
        chapter: "05 · fair questions",
        cam: hold([[0, ...METER_R], ["fair4", ...aim(1.3, 820, 200)], ["fair5", ...METER_R]]),
        callouts: [
          { at: "fair1:random", until: T("fair2", -0.9), mark: "nameA", side: "right", dx: 140, dy: 10, text: "A and B: dealt at random", color: "b" },
          { at: T("fair3:pick", 0.4), until: T("fair4", -0.9), mark: "forecast", side: "bottom", dy: 90, text: "its forecast, checked against you", color: "b" },
          { at: "fair4:TASTE", until: T("fair5", -0.9), mark: "taste", side: "bottom", dy: 90, text: "TASTE › TRUST" },
          { at: T("fair5:skip", 0.2), mark: "skip", side: "bottom", dy: 90, text: "skip · nothing recorded" },
        ],
      },
      turn("turn6", "ve-breed", POOL_BTN),
      {
        beat: "breed",
        shot: "ve-breed",
        chapter: "06 · a generation",
        cam: hold([[0, ...POOL_BTN], ["breed3", ...RAIL], ["breed5", ...LINEAGE], ["breed7", ...RAIL]]),
        callouts: [
          { at: T("breed1:press", 0.3), until: T("breed3", -0.9), mark: "evolve", side: "bottom", dx: -120, dy: 100, text: "breeds from its ten best" },
          { at: "breed3:lightning", until: T("breed4", 0.2), mark: "fresh", side: "right", dx: 90, dy: 20, text: "⚡ a new child" },
          { at: "breed4:retires", until: T("breed5", -0.9), mark: "toast", side: "top", dx: -60, dy: -70, text: "the ones it liked least, retired" },
          { at: "breed5:changed", until: T("breed7", -0.9), mark: "line1", side: "top", ox: -420, dx: 40, dy: -70, text: "what each child changed", color: "b" },
          { at: T("breed7:listen", 0.2), mark: "fresh", side: "right", dx: 90, dy: 20, text: "▶ hear it" },
        ],
      },
      turn("turn7", "ve-keep", RAIL),
      {
        beat: "keep",
        shot: "ve-keep",
        chapter: "07 · stars, save, cut",
        cam: hold([[0, ...RAIL]]),
        callouts: [
          { at: "keep2:opinion", until: T("keep3", -0.2), mark: "rated", side: "right", oy: 14, dx: 90, dy: 30, text: "a rating teaches", color: "b" },
          { at: "keep3:keeps", until: T("keep4", -0.2), mark: "saved", side: "right", oy: 14, dx: 90, dy: 30, text: "a save keeps, and teaches nothing" },
          { at: T("keep4:Cut", 0.4), until: "keep5", mark: "toast3", side: "top", dy: -70, text: "seven seconds to undo" },
          { at: "keep5:save", mark: "budget", side: "bottom", dx: 40, dy: 80, text: "saved: never retired" },
        ],
      },
      turn("turn8", "ve-rhythm", CARDS),
      {
        beat: "rhythm",
        shot: "ve-rhythm",
        chapter: "08 · a working rhythm",
        cam: hold([[0, ...CARDS], ["rhythm3", ...POOL_BTN], ["rhythm4", ...WIDE]]),
        callouts: [
          { at: T("rhythm4:Play", 0.3), until: "rhythm4:save", mark: "child", side: "top", dx: 30, dy: -60, text: "a new child, on the keys" },
          { at: T("rhythm4:save", 0.3), until: "rhythm5", mark: "row", side: "right", dx: 90, dy: 20, text: "saved" },
        ],
      },
      {
        beat: "outro",
        shot: "ve-outro",
        cam: [[0, ...WIDE], ["outro2", ...aim(1.05, 900, 400)]],
        callouts: [],
      },
    ],
  });
  // The kit's cards (the title, the chapter turns, the outro) need the real
  // stage; the scratch validators build this plan against a stub and stop.
  if (!stage.tl) return;
  const { cards } = await import("./cards.js");
  cards(stage);
}
