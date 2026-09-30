// PERFORM: playing the sound — the PERFORM view in depth, for players.
//
// A walkthrough over the real instrument (shots.json; tools/footage.mjs
// records each shot from apps/web with the master bus as its sound), framed
// by stage/walk.js: a camera that settles before the words land, callouts
// pinned to measured marks, and captions, all pinned to the narration's
// words. Around it, three kinds of card drawn with the kit: the title, a card
// at every chapter's turn, and the outro.
//
// The structure, and what the music does:
// - open: the cold open. Glass Pad plays the bed's own changes, one chord a
//   bar, while an XY gesture brings in Bright and Motion. No words, no bed.
// - title: the title card over the same shot, which runs on (silent: the
//   app's sound is placed over its own beat only). The bed comes in.
// - Every chapter is two beats: a one-bar turn (the chapter card, the bed at
//   0 dB, no words) and its demo (the bed out, so the app is the music). A
//   turn borrows its demo's shot: the shot's `pre` covers the turn, and the
//   turn's plan entry says `meta: {pre: 0.5}` and `clips: []`, so both
//   entries put the shot's start at the same film time and the picture runs
//   on unbroken (validate.mjs checks it). Nothing is played during a turn.
// - together: all of it at once, on Acid Line; the outro borrows its shot,
//   which clicks the PATCH tab on "PATCH", so the offer just taken is the
//   sound opened in PATCH. The bed returns under the outro.
//
// Where this departs from the outline in VIEWS.md, and why:
// - Keep and Back share the Wander chapter: Keep marks home, Wander takes
//   the sound somewhere, Freeze holds it, and Back glides home. Alone, Keep
//   and Back made an eleven-second chapter.
// - Sync is shown on Loom, the one preset with a step sequencer, so the
//   dock chapter runs on Loom: on a patch without one, Sync changes nothing
//   you could hear.
// - The PERFORM wiring is measured per session, and the seeded session
//   decides it. As rehearsed (plain session): Glass Pad reaches Bright both
//   ways, Snap only toward bloom, Motion only toward restless and Space only
//   toward far; Body and Grit are search controls. Bell
//   Jar's Bright turns its wavefolder's threshold. Each shot logs its wiring.
// - Presets ship wired, so Bell Jar plays the moment it is opened and the
//   status line reads "re-checking" while PERFORM measures it again; the
//   named chapter says so (named8) and has no cut. Off camera, every set-up
//   waits for that re-check, so a shot starts on the session's own wiring.
// - Wander's state is on the line under its dial ("ideas · one in B",
//   "drift · gliding", "paused 3 s", "held"), so its callouts point at the
//   dial, not the status line, which speaks only about the patch.
// - Every shot's session is a returning player's (the film's `init` marks
//   the first-run coach and PERFORM's first steps as done), so neither sits
//   over the keybed or pushes the deck down; the tour film shows them.
import { walkthrough, aim } from "../../stage/walk.js";

// Written by gen_shots.py (python3 www/video/films/view-perform/gen_shots.py)
// from timeline.json: where the shot a card beat borrows starts, as that
// beat's `meta.pre`. Rerun it after every timeline change; validate.mjs
// checks these.
const BORROW = /*borrow*/ { title: 11.929, outro: 23.357 } /*/borrow*/;

/** A narration time moved by d seconds, as one offset ("play2:Z-1.30"). */
function shift(at, d) {
  if (typeof at === "number") return +(at + d).toFixed(3);
  const m = /^(.*?)([+-]\d+(?:\.\d+)?)?$/.exec(at);
  const off = Number(m[2] || 0) + d;
  return `${m[1]}${off >= 0 ? "+" : ""}${off.toFixed(2)}`;
}

/** A camera that settles: it holds on each framing, and each move to the
 *  next takes `dur` seconds and arrives at that keyframe's time (set just
 *  before the words it frames), so nothing moves while a callout is up. */
function settle(keys, dur = 0.9) {
  const out = [keys[0]];
  for (let i = 1; i < keys.length; i++) {
    out.push([shift(keys[i][0], -dur), ...out[out.length - 1].slice(1)]);
    out.push(keys[i]);
  }
  return out;
}

const WIDE = [0, 1.0, 0.5, 0.5];
const TURN = { meta: { pre: 0.5 }, clips: [], cam: [WIDE] };

// The chapters: the card each turn shows, and the label its demo carries.
export const CHAPTERS = [
  { turn: "turn-play", beat: "play", n: 1, name: "Play it", q: "How do you play it?" },
  { turn: "turn-named", beat: "named", n: 2, name: "Named for what you hear", q: "How do you make it brighter while you play?" },
  { turn: "turn-honest", beat: "honest", n: 3, name: "Honest controls", q: "What if this patch can’t do that?" },
  { turn: "turn-xy", beat: "xy", n: 4, name: "The XY pad", q: "How do you move two things at once?" },
  { turn: "turn-offer", beat: "offer", n: 5, name: "Offers", q: "How do you try something new without stopping?" },
  { turn: "turn-wander", beat: "wander", n: 6, name: "Wander, Keep and Back", q: "Can it play along, and bring you home?" },
  { turn: "turn-dock", beat: "dock", n: 7, name: "The dock", q: "How do you hold, stack and arpeggiate it?" },
  { turn: "turn-midi", beat: "midi", n: 8, name: "MIDI", q: "What does a controller do here?" },
  { turn: "turn-together", beat: "together", n: 0, name: "All of it at once", q: "An arpeggio, Wander, and an offer taken on the downbeat." },
];
const COUNT = CHAPTERS.filter((c) => c.n).length;
const label = (beat) => {
  const c = CHAPTERS.find((x) => x.beat === beat);
  return c.n ? `${String(c.n).padStart(2, "0")} · ${c.name.toLowerCase()}` : c.name.toLowerCase();
};

const PLAN = [
  // The cold open: wide on the chord, then in on the pad and the knobs it
  // moves as the gesture starts; the title holds that framing, veiled.
  { beat: "open", shot: "vp-open", cam: settle([WIDE, [2.2, ...aim(1.08, 1086, 540)], [8.0, ...aim(1.2, 1000, 560)]], 1.8) },
  { beat: "title", shot: "vp-open", meta: { pre: BORROW.title }, clips: [], cam: [[0, ...aim(1.2, 1000, 560)]] },

  { beat: "turn-play", shot: "vp-play", ...TURN },
  {
    beat: "play",
    shot: "vp-play",
    chapter: label("play"),
    cam: settle([
      WIDE,
      ["play1:computer", ...aim(1.45, 960, 900)],
      ["play2:Z-0.3", ...aim(1.45, 700, 900)],
      ["play4:velocity-0.2", ...aim(1.45, 1500, 880)],
      ["play5:timbre-0.3", ...aim(1.3, 1000, 330)],
    ]),
    callouts: [
      { at: "play1:notes", until: "play1:black-0.1", mark: "keybed", side: "top", ox: -120, dx: -60, dy: -110, text: "A to L: white keys" },
      { at: "play1:black", until: "play2-0.9", mark: "keybed", side: "top", ox: 60, dx: 60, dy: -110, text: "W to P: black keys" },
      { at: "play2:octave", until: "play2:Hold", mark: "oct", side: "top", dx: 40, dy: -110, text: "z / x: the octave" },
      { at: "play2:accent", until: "play3:strike-0.1", mark: "keybed", side: "top", ox: 40, dx: 60, dy: -110, text: "shift: an accent" },
      { at: "play3:strike+0.2", until: "play3:harder", mark: "e4", side: "top", oy: 10, dx: 90, dy: -110, text: "near the top: soft" },
      { at: "play3:harder", until: "play4:velocity-1.15", mark: "e4", side: "bottom", oy: -8, dx: 110, dy: -170, text: "the front edge: hard" },
      { at: "play4:velocity", until: "play5:timbre-1.25", mark: "midi", side: "top", dx: -70, dy: -100, text: "a MIDI keyboard" },
      { at: "play6:touch", mark: "touch", side: "bottom", ox: -180, dx: -30, dy: 110, text: "touch: velocity → Bright" },
    ],
  },

  { beat: "turn-named", shot: "vp-named", ...TURN },
  {
    beat: "named",
    shot: "vp-named",
    chapter: label("named"),
    cam: settle([
      WIDE,
      ["named1:named-0.2", ...aim(1.45, 820, 300)],
      ["named1:Grit-0.2", ...aim(1.45, 1180, 300)],
      ["named2:ride-0.3", ...aim(1.2, 1086, 420)],
      ["named3:Underneath-0.2", ...aim(1.35, 1000, 520)],
      ["named4:Long-0.3", ...aim(1.3, 900, 330)],
      ["named5:Every-0.2", ...aim(1.2, 800, 330)],
      ["named9:Bell-0.3", ...aim(1.2, 1086, 460)],
    ], 0.8),
    callouts: [
      { at: "named2:ride", until: "named3:Underneath-1.15", mark: "bright", side: "bottom", dx: -60, dy: 150, text: "Bright: ridden up" },
      { at: "named3:knobs", until: "named4:Long-1.15", mark: "hood", side: "top", ox: -140, dx: 60, dy: -80, text: "the patch's own knobs" },
      { at: "named4:Long+0.3", until: "named5:Every-1.05", mark: "bright", side: "bottom", dx: 60, dy: 150, text: "long press: hear it" },
      { at: "named6:nudges", until: "named7-0.1", mark: "status", side: "right", dx: 90, dy: 30, text: "re-checking: PERFORM listens", color: "b" },
      { at: "named8:wired", until: "named9:Bell-1.15", mark: "status", side: "right", dx: 90, dy: 30, text: "shipped wired: it plays at once" },
      { at: "named9:folds", until: "named9:name", mark: "bright", side: "bottom", dx: 70, dy: 150, text: "Bright → wavefolder threshold" },
      { at: "named9:name", mark: "hood", side: "top", ox: -140, dx: 60, dy: -80, text: "different knobs, same name" },
    ],
  },

  { beat: "turn-honest", shot: "vp-honest", ...TURN },
  {
    beat: "honest",
    shot: "vp-honest",
    chapter: label("honest"),
    cam: settle([
      WIDE,
      ["honest1:turn", ...aim(1.5, 1200, 330)],
      ["honest3:amber-0.4", ...aim(1.45, 1100, 360)],
      ["honest5:variant-0.3", ...aim(1.25, 1086, 480)],
    ]),
    callouts: [
      { at: "honest2:close", until: "honest3:amber-1.35", mark: "space", side: "bottom", dx: -70, dy: 150, text: "turns toward far only: a stop at the centre" },
      { at: "honest3:amber", until: "honest5:variant-1.25", mark: "grit", side: "bottom", dx: -90, dy: 150, text: "amber, dashed: out of reach", color: "b" },
      { at: "honest5:growing+0.3", until: "honest6-0.1", mark: "offer", side: "top", ox: -380, dx: 40, dy: -70, text: "B: growing a grittier offer", color: "b" },
      { at: "honest6:says", until: "honest6:Listen-0.1", mark: "offer", side: "top", ox: -380, dx: 40, dy: -70, text: "B: how far it went", color: "b" },
      { at: "honest6:Listen", mark: "peek", side: "top", dx: 40, dy: -100, text: "Peek: hear it first" },
    ],
  },

  { beat: "turn-xy", shot: "vp-xy", ...TURN },
  {
    beat: "xy",
    shot: "vp-xy",
    chapter: label("xy"),
    cam: settle([
      WIDE,
      ["xy1:two", ...aim(1.55, 740, 700)],
      ["xy4:dials-0.3", ...aim(1.2, 1086, 480)],
    ]),
    callouts: [
      { at: "xy2:Choose", until: "xy2:tells", mark: "ysel", side: "right", dx: 90, dy: -40, text: "choose the axes" },
      { at: "xy2:tells", until: "xy3", mark: "note", side: "bottom", dx: 60, dy: 90, text: "an amber axis says so", color: "b" },
      { at: "xy3:draw", until: "xy4:dials-1.25", mark: "xy", side: "right", dx: 70, dy: -120, text: "Bright → · Motion ↑" },
      { at: "xy4:dials", until: "xy4:Double", mark: "deck", side: "bottom", ox: -380, dx: -40, dy: 110, text: "the dials follow" },
      { at: "xy4:Double", mark: "xy", side: "bottom", dx: 80, dy: 90, text: "double-click: centre" },
    ],
  },

  { beat: "turn-offer", shot: "vp-offer", ...TURN },
  {
    beat: "offer",
    shot: "vp-offer",
    chapter: label("offer"),
    cam: settle([
      WIDE,
      ["offer1:playing", ...aim(1.22, 1086, 470)],
      ["offer5-0.1", ...aim(1.2, 1180, 550)],
    ]),
    callouts: [
      { at: "offer1:slot", until: "offer3", mark: "offer", side: "top", ox: -380, dx: 40, dy: -70, text: "B: a variant of this sound", color: "b" },
      { at: "offer3:Peek", until: "offer4:ride", mark: "peek", side: "top", dx: 40, dy: -100, text: "held: B alone" },
      { at: "offer4:matched", until: "offer5-1.05", mark: "blend", side: "bottom", dx: 80, dy: 150, text: "Blend, at matched loudness" },
      { at: "offer5:pad", until: "offer5:pass", mark: "offer-pad", side: "top", dx: 40, dy: -100, text: "NEXT · passes on B" },
      { at: "offer5:pass", until: "offer6", mark: "passed", side: "top", dx: -160, dy: -90, text: "a pass is a pick for A, with undo", color: "b" },
      { at: "offer6+0.1", until: "offer6:sound", mark: "peek", side: "top", dx: 40, dy: -100, text: "held: hear the next one first" },
      { at: "offer6:sound+0.4", mark: "toast", side: "top", dx: -160, dy: -90, text: "a take is a pick for B", color: "b" },
    ],
  },

  { beat: "turn-wander", shot: "vp-wander", ...TURN },
  {
    beat: "wander",
    shot: "vp-wander",
    chapter: label("wander"),
    cam: settle([
      WIDE,
      ["wander1:sound", ...aim(1.3, 1086, 440)],
    ]),
    callouts: [
      { at: "wander1:hear", until: "wander2:Wander-0.2", mark: "keep", side: "top", dx: 40, dy: -110, text: "Keep: this is home" },
      { at: "wander2:model-0.3", until: "wander3", mark: "wander", side: "bottom", dx: -120, dy: 150, text: "Wander: ideas" },
      { at: "wander3:ideas", until: "wander4:Further", mark: "offer", side: "top", ox: -380, dx: 40, dy: -70, text: "an idea, in B", color: "b" },
      { at: "wander4:drift", until: "wander5", mark: "wander", side: "bottom", dx: -120, dy: 150, text: "drift · gliding, toward your taste", color: "b" },
      { at: "wander5:way", until: "wander6:new", mark: "wander", side: "bottom", dx: -120, dy: 150, text: "roam" },
      { at: "wander6:module", until: "wander7:Touch", mark: "offer", side: "top", ox: -380, dx: 40, dy: -70, text: "new modules arrive only in B", color: "b" },
      { at: "wander7:Touch+0.4", until: "wander7:Freeze-0.1", mark: "wander", side: "bottom", dx: -120, dy: 150, text: "paused: your hands are on it", color: "b" },
      { at: "wander7:Freeze", until: "wander8:Back", mark: "freeze", side: "top", dx: -60, dy: -100, text: "Freeze: held" },
      { at: "wander8:home", mark: "hood", side: "top", ox: -160, dx: 50, dy: -80, text: "back to the ticks: home" },
    ],
  },

  { beat: "turn-dock", shot: "vp-dock", ...TURN },
  {
    beat: "dock",
    shot: "vp-dock",
    chapter: label("dock"),
    cam: settle([
      WIDE,
      ["dock1:Hold", ...aim(1.6, 420, 940)],
      ["dock3:Glide-0.3", ...aim(1.55, 1450, 940)],
      ["dock4:arpeggiator-0.3", ...aim(1.45, 480, 900)],
      ["dock6:like-0.3", ...aim(1.4, 1500, 880)],
    ]),
    callouts: [
      { at: "dock1:latches", until: "dock2", mark: "hold", side: "top", dx: 30, dy: -110, text: "hold: latched" },
      { at: "dock2:stacks", until: "dock3:Glide-1.25", mark: "uni", side: "top", dx: 50, dy: -110, text: "unison: four voices, one note" },
      { at: "dock3:slides", until: "dock4:arpeggiator-1.25", mark: "glide", side: "top", dx: -60, dy: -110, text: "glide" },
      { at: "dock4:tempo", until: "dock5", mark: "tempo", side: "right", dx: 80, dy: -60, text: "up · down, at 84" },
      { at: "dock5:Sync", until: "dock6:like-1.25", mark: "sync", side: "top", dx: 40, dy: -110, text: "sync: Loom's steps on the beat" },
      { at: "dock6:REC", until: "dock6:WAV+0.5", mark: "rec", side: "top", dx: -60, dy: -110, text: "● rec" },
      { at: "dock6:WAV+0.8", mark: "saved", side: "top", dx: -160, dy: -90, text: "a WAV of what you played" },
    ],
  },

  { beat: "turn-midi", shot: "vp-midi", ...TURN },
  {
    beat: "midi",
    shot: "vp-midi",
    chapter: label("midi"),
    cam: settle([
      WIDE,
      ["midi1:controller", ...aim(1.2, 1300, 700)],
    ]),
    callouts: [
      { at: "midi1:claim", until: "midi2", mark: "rows", side: "left", oy: -90, dx: -200, dy: -40, text: "the first eight claim the eight" },
      { at: "midi2:knob", until: "midi3:Pressure-0.1", mark: "spacerow", side: "left", dx: -150, dy: 40, text: "learn: CC 20 → Space" },
      { at: "midi3:Pressure", until: "midi3:wheel", mark: "bright", side: "bottom", dx: -60, dy: 150, text: "pressure → Bright" },
      { at: "midi3:wheel", until: "midi4:clock", mark: "motion", side: "bottom", dx: 60, dy: 150, text: "mod wheel → Motion" },
      { at: "midi4:clock+0.9", until: "midi5", mark: "clock", side: "left", dx: -170, dy: -60, text: "the tempo follows the clock" },
      { at: "midi5:aside", mark: "ind", side: "top", dx: -80, dy: -110, text: "midi ○: another tab has it" },
    ],
  },

  { beat: "turn-together", shot: "vp-together", ...TURN },
  {
    beat: "together",
    shot: "vp-together",
    chapter: label("together"),
    cam: settle([
      WIDE,
      ["together2:Wander-0.3", ...aim(1.2, 1120, 440)],
      ["together3:take-0.3", ...aim(1.2, 1180, 550)],
    ]),
    callouts: [
      { at: "together2:Wander", until: "together2:offer", mark: "wander", side: "bottom", dx: -120, dy: 150, text: "Wander: drift" },
      { at: "together2:offer", until: "together3:take-1.25", mark: "offer", side: "top", ox: -380, dx: 40, dy: -70, text: "B: an offer, on the arpeggio", color: "b" },
      { at: "together3:downbeat", mark: "take", side: "top", dx: 40, dy: -100, text: "Take, on the downbeat" },
    ],
  },
  { beat: "outro", shot: "vp-together", meta: { pre: BORROW.outro }, clips: [], cam: [WIDE] },
];

export async function build(stage) {
  await walkthrough(stage, { plan: PLAN });
  // validate.mjs and framing.mjs read the plan with a stub stage: no cards.
  if (!stage.scene) return;
  const [S, K] = await Promise.all([import("../../stage/stage.js"), import("../../stage/kit.js")]);
  titleCard(stage, S, K);
  CHAPTERS.forEach((c) => turnCard(stage, S, K, c));
  outroCard(stage, S, K);
}

// ---------------------------------------------------------------------------
// The cards. Each sits over the footage it borrows, behind a veil that
// darkens and softens the instrument, so the words lead and the instrument
// is still there.

const Z = 6; // above the walkthrough's scenes, below the grain

/** A veil over the footage's window only (walk.js's frame), so the captions
 *  and the chapter label outside it stay as they are. */
function veil(S, layer, { a = 0.62, blur = 5 } = {}) {
  const v = S.place(S.el("div", {}, layer), { x: 120, y: 70, w: 1680, h: 945 });
  v.style.borderRadius = "14px";
  v.style.background = `radial-gradient(120% 95% at 30% 50%, rgba(7,8,10,${a}) 0%, rgba(7,8,10,${Math.min(0.92, a + 0.18)}) 100%)`;
  v.style.backdropFilter = `blur(${blur}px) saturate(0.85)`;
  return v;
}

/** The title: PERFORM, what it is for, and its eight controls turning with the bed. */
function titleCard(stage, S, K) {
  const b = stage.tl.beats.find((x) => x.id === "title");
  const next = stage.tl.beats.find((x) => x.id === "turn-play");
  stage.scene({
    id: "card-title",
    t0: b.t0,
    t1: next.t0,
    pre: 0.5,
    post: 0.35,
    fin: 0.5,
    fout: 0.35,
    z: Z,
    build(layer) {
      veil(S, layer, { a: 0.66, blur: 6 });
      const eyebrow = S.place(S.el("div", { class: "eyebrow" }, layer, "Auracle · the four views, in depth"), { x: 960, y: 250, ax: 0.5, ay: 0.5 });
      eyebrow.style.fontSize = "22px";
      const title = K.textBlock(layer, { x: 960, y: 372, w: 1600, cls: "silk", size: 168, align: "center", ax: 0.5, ay: 0.5, text: "PERFORM" });
      title.style.letterSpacing = "0.14em";
      title.style.textShadow = "0 0 40px rgba(142,240,177,0.18)";
      const sub = K.textBlock(layer, { x: 960, y: 505, w: 1400, cls: "voice", size: 64, align: "center", ax: 0.5, ay: 0.5, text: "playing the sound" });
      sub.style.color = "#d9d4c8";
      // The eight controls, as the deck has them: six named for what you
      // hear (sound, green), then Blend and Wander (the model's side, amber).
      const svg = K.svgLayer(layer);
      const names = ["Bright", "Snap", "Motion", "Body", "Grit", "Space", "Blend", "Wander"];
      const xs = names.map((_, i) => 960 + (i - 3.5) * 150 + (i >= 6 ? 30 : -30));
      const ks = names.map((n, i) => ({ i, k: K.knob(svg, { cx: xs[i], cy: 700, r: 34, label: n, labelSize: 15, color: i >= 6 ? "b" : "a" }) }));
      const mid = (xs[5] + xs[6]) / 2;
      S.el("line", { x1: mid, y1: 655, x2: mid, y2: 765, stroke: "#292e36", "stroke-width": 2 }, svg);
      const bar = (4 * 60) / stage.tl.grid.bpm;
      return (tl, t) => {
        const u = S.ramp(tl, -0.3, 0.9, S.E.out4);
        title.style.opacity = u;
        title.style.letterSpacing = `${S.lerp(0.34, 0.14, u)}em`;
        eyebrow.style.opacity = S.ramp(tl, 0.2, 0.9, S.E.io2);
        sub.style.opacity = S.ramp(tl, 0.5, 1.3, S.E.io2);
        sub.style.transform = `translateY(${(1 - S.ramp(tl, 0.5, 1.3, S.E.out3)) * 12}px)`;
        // The controls turn slowly, each on its own phase, and lean with
        // the bed's loudness (the first mix writes its envelope).
        const env = stage.env(t);
        ks.forEach(({ k, i }) => {
          const on = S.ramp(tl, 0.9 + i * 0.08, 1.5 + i * 0.08, S.E.out3);
          const base = i === 6 ? 0.08 : i === 7 ? 0.3 : 0.5;
          const sway = i >= 6 ? 0.06 : 0.16;
          const val = base + on * (sway * S.noise1(t / bar + i * 1.7, 31 + i) + 0.05 * env);
          k.set(S.clamp(val), { lit: 0.35 + 0.65 * on });
          k.g.style.opacity = on;
        });
      };
    },
  });
}

/** A chapter's turn: its number, its name and the question it answers. */
function turnCard(stage, S, K, c) {
  const b = stage.tl.beats.find((x) => x.id === c.turn);
  const d = stage.tl.beats.find((x) => x.id === c.beat);
  stage.scene({
    id: `card-${c.beat}`,
    t0: b.t0,
    t1: d.t0,
    pre: 0.25,
    post: 0.45,
    fin: 0.25,
    fout: 0.45,
    z: Z,
    build(layer) {
      veil(S, layer, { a: 0.6, blur: 5 });
      const X = 250;
      const num = S.place(S.el("div", { class: "eyebrow" }, layer, c.n ? `${String(c.n).padStart(2, "0")} / ${String(COUNT).padStart(2, "0")}` : "putting it together"), { x: X, y: 400 });
      num.style.fontSize = "24px";
      const rule = S.place(S.el("div", {}, layer), { x: X, y: 446, w: 0, h: 2 });
      rule.style.background = "#8ef0b1";
      rule.style.boxShadow = "0 0 12px rgba(142,240,177,0.6)";
      const name = K.textBlock(layer, { x: X - 6, y: 470, w: 1500, cls: "display", size: 104, text: c.name });
      const q = K.textBlock(layer, { x: X, y: 610, w: 1400, cls: "voice", size: 50 });
      q.style.color = "#d9d4c8";
      const qs = S.words(q, c.q);
      // Where this chapter sits among the eight: a row of dots, this one lit.
      const dots = [];
      if (c.n) {
        for (let i = 1; i <= COUNT; i++) {
          const dot = S.place(S.el("div", {}, layer), { x: X + (i - 1) * 26, y: 720, w: 10, h: 10 });
          dot.style.borderRadius = "50%";
          dot.style.background = i === c.n ? "#8ef0b1" : i < c.n ? "#3d6a4d" : "#292e36";
          if (i === c.n) dot.style.boxShadow = "0 0 10px rgba(142,240,177,0.8)";
          dots.push(dot);
        }
      }
      const len = d.t0 - b.t0;
      return (tl, t) => {
        const u = S.ramp(tl, -0.2, 0.45, S.E.out3);
        num.style.opacity = u;
        name.style.opacity = S.ramp(tl, -0.1, 0.55, S.E.out3);
        name.style.transform = `translateY(${(1 - S.ramp(tl, -0.1, 0.6, S.E.out4)) * 18}px)`;
        rule.style.width = `${Math.round(140 * S.ramp(tl, 0.0, 0.7, S.E.out4))}px`;
        q.style.opacity = S.ramp(tl, 0.25, 0.6, S.E.io2);
        S.reveal(qs, t, b.t0 + 0.35, b.t0 + Math.min(1.6, len * 0.55));
        dots.forEach((dot, i) => (dot.style.opacity = S.ramp(tl, 0.3 + i * 0.03, 0.7 + i * 0.03, S.E.io2)));
      };
    },
  });
}

/** The outro: the loop in three words, then where to go next. */
function outroCard(stage, S, K) {
  const b = stage.tl.beats.find((x) => x.id === "outro");
  const l1 = stage.line("outro1");
  const l2 = stage.line("outro2");
  const l3 = stage.line("outro3");
  stage.scene({
    id: "card-outro",
    t0: b.t0,
    t1: b.t1,
    pre: 0.5,
    post: 0,
    fin: 0.5,
    z: Z,
    build(layer) {
      const v = veil(S, layer, { a: 0.64, blur: 5 });
      // "play it · turn it · let it offer", lit as they are said.
      const loop = K.textBlock(layer, { x: 960, y: 380, w: 1700, cls: "display", size: 92, align: "center", ax: 0.5, ay: 0.5 });
      const ls = S.words(loop, "*play it* · *turn it* · _let it offer_");
      // Next: PATCH, and the guide.
      const next = S.place(S.el("div", { class: "eyebrow" }, layer, "next, in depth"), { x: 250, y: 640 });
      next.style.fontSize = "22px";
      const patch = K.textBlock(layer, { x: 244, y: 676, w: 1200, cls: "silk", size: 96, text: "PATCH" });
      patch.style.letterSpacing = "0.14em";
      const inside = K.textBlock(layer, { x: 250, y: 800, w: 1200, cls: "voice", size: 50, text: "inside the sound" });
      inside.style.color = "#d9d4c8";
      const guide = S.el("div", { class: "pill a" }, layer, "the guide · docs / views / perform");
      S.place(guide, { x: 1670, y: 860, ax: 1, ay: 0.5 });
      // The lockup, small, to sign off.
      const svg = K.svgLayer(layer);
      // Right-aligned with the pill: the wordmark measured, the mark before it.
      const wm = S.place(S.el("div", { class: "lk" }, layer), { x: 0, y: 700, ay: 0.5 });
      wm.style.fontSize = "46px";
      S.el("span", { class: "wm" }, wm, "AURACLE");
      const wmW = wm.getBoundingClientRect().width;
      S.place(wm, { x: 1670 - wmW, y: 700, ay: 0.5 });
      const mk = K.mark(svg, { cx: 1670 - wmW - 22 - 38, cy: 700, size: 76 });
      const L2 = l2.t0 - b.t0;
      return (tl, t) => {
        const u = S.ramp(tl, -0.3, 0.5, S.E.out3);
        loop.style.opacity = u * (1 - 0.55 * S.ramp(tl, L2 - 0.4, L2 + 0.3, S.E.io2));
        S.reveal(ls, t, l1.t0 + 0.6, l1.t1);
        const n = S.ramp(tl, L2 - 0.2, L2 + 0.5, S.E.out3);
        next.style.opacity = n;
        patch.style.opacity = n;
        patch.style.transform = `translateY(${(1 - n) * 16}px)`;
        inside.style.opacity = S.ramp(tl, L2 + 0.3, L2 + 1.0, S.E.io2);
        const g = S.ramp(tl, l3.t0 - b.t0 + 0.2, l3.t0 - b.t0 + 0.9, S.E.out3);
        guide.style.opacity = g;
        guide.style.transform = `translateY(${(1 - g) * 10}px)`;
        const m = S.ramp(tl, l3.t1 - b.t0 + 0.1, l3.t1 - b.t0 + 1.1, S.E.out4);
        mk.update({ tile: m, outer: m, inner: S.ramp(tl, l3.t1 - b.t0 + 0.3, l3.t1 - b.t0 + 1.2), core: m });
        wm.style.opacity = m;
        v.style.opacity = 1;
      };
    },
  });
}
