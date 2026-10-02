// PERFORM — the instrument as something you play rather than something you
// edit. Up to eight controls named for what you hear, from a palette of
// eighteen (the six to start), Blend and Wander, and six pads; stage mode.
//
// The named controls are directions in the audio half of φ (Bright is
// +centroid +rolloff, Snap is −attack +crest, …), wired onto *this* patch's
// knobs by the patch's own measured Jacobian (auracle_session::perform). A
// control's value c ∈ [−1, 1] moves each wired knob by c × its gain, around
// wherever the sound is now, so drift moves the centre and never makes a
// control jump. A control whose direction this patch's knobs cannot honestly
// produce is drawn as a *search* control and asks for an offer instead.
//
// State, in three layers:
//   home  — the last sound you kept (or loaded): {json, makeup, knobs}
//   cur   — the structure and knob values actually sounding: {json, knobs}
//   c[k]  — the named controls' deltas on top of cur
// Drift glides cur toward a proposal from the taste walk; Back glides it to
// home; Keep and Take commit to the bench and are logged as implicit evidence
// (which stays out of the fit until it earns its place).
//
// Nothing here opens a modal. A player mid-phrase cannot answer a dialog.

// The palette's words (names, end words, what each does), with this module's
// own build stamp so a new build fetches both together.
const { PALETTE, FAMILIES, onThisSound, panelCount, platformKeys } = await import(`./words.js${new URL(import.meta.url).search}`);

const NS = "http://www.w3.org/2000/svg";
const KNOB_MAX = 1 - 1e-6;
// The panel: which of the palette's eighteen controls sit on PERFORM, in the
// player's order, as palette indices (`perform::PALETTE`). The six are the
// default, and at most eight sit there at once: each placed control is
// measured on every sound (about five renders each), and eight keeps a
// measurement near the six's (the reference's PERFORM page, "What it costs").
const PANEL_DEFAULT = [0, 1, 2, 3, 4, 5];
const PANEL_MAX = 8;
// A stored panel is read entry by entry, as the engine reads `controls`
// (`palette_set`): whole numbers in range, each once, at most eight. Nothing
// valid left (or nothing stored) is the six.
function validPanel(raw) {
  if (!Array.isArray(raw)) return PANEL_DEFAULT.slice();
  const out = [];
  for (const v of raw) {
    if (Number.isInteger(v) && v >= 0 && v < PALETTE.length && !out.includes(v)) out.push(v);
    if (out.length >= PANEL_MAX) break;
  }
  return out.length ? out : PANEL_DEFAULT.slice();
}
// A set of controls as a measurement asks for it: sorted by palette index.
// The engine wires and separates in the order asked (`separate`: of two
// controls that are one gesture on a patch, the later is the search
// control), so the order is part of the answer. Asking in palette order
// makes the answer the panel's set, whatever order the player has put it in:
// reordering costs no renders, the six come first as the census measured
// them ("beside the six"), and the six asked in order is today's
// measurement, keyed and shipped as before.
const setOf = (panel) => [...panel].sort((a, b) => a - b);
const SIX_KEY = PANEL_DEFAULT.join(",");
// The set's part of a cache key: empty for the six, so their wirings keep
// the keys they were cached and shipped under.
const setKey = (set) => {
  const s = setOf(set || PANEL_DEFAULT).join(",");
  return s === SIX_KEY ? "" : s;
};
// The key a measured wiring is kept under (`wireKey` in `createPerform`):
// the patch as it is (uids dropped, so a re-minted tree is the same patch),
// then the audition clip for a sound with an AUDIO IN (`|clip:`), then the
// set measured unless it is the six (`#controls=`). The clip goes on the
// patch's part, before the set, so `${patch}#controls=` still prefixes every
// set of one patch (`borrowWiring`) and a set is never clipped off. A key
// that is not a tree (one already composed) is itself.
export function wireKeyOf(json, set, clip) {
  let base;
  try {
    base = JSON.stringify(JSON.parse(json), (k, v) => (k === "uid" ? undefined : v));
  } catch {
    return json;
  }
  if (clip && base.includes('"AudioIn"')) base = `${base}|clip:${clip}`;
  const sk = setKey(set);
  return sk ? `${base}#controls=${sk}` : base;
}
// A palette index from a wiring entry: its `index`, or for a wiring kept
// before the engine sent one, the palette entry of the same name.
const indexOf = (w) => (w && Number.isInteger(w.index) ? w.index : w ? PALETTE.findIndex((c) => c.name === w.name) : -1);
// Wander landmarks on the dial's 0..1 travel: still, then ideas (variants
// appear in B), drift and roam. The middle zone was called "offer", the Offer
// pad's word and Blend's; it is "ideas", as the films say.
const WANDER_IDEAS = 0.15;
const WANDER_DRIFT = 0.4;
const WANDER_ROAM = 0.75;
// Hands on, it waits: no autonomous move within this long of a touch.
const HANDS_OFF_MS = 3500;
// Let go of Wander in a new zone and its first move comes this long after:
// the zone's pace governs the repeats, not the first answer. It used to wait
// a whole period, 36 s at the left of drift (21 s measured), and a player
// concluded it did not work.
const WANDER_FIRST_MS = 1500;
// The wiring is a linear model measured with 0.08 knob steps
// (perform::JACOBIAN_STEP). It is re-measured only once some knob has moved
// farther than this from where it was measured — a gentle drift stays inside
// and keeps its wiring, instead of spending ~46 renders after every glide.
const TRUST = 0.12;

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
// Mirrors auracle_session::perform::Wiring::range: a half that the patch's
// renders did not confirm is closed. REACH_FLOOR / 2 in σ.
const HALF_OPEN = 0.075;
function rangeOf(w) {
  if (!w || w.search || w.pending) return [0, 0];
  const ok = (m) => m == null || m >= HALF_OPEN;
  return [ok(w.down) ? -1 : 0, ok(w.up) ? 1 : 0];
}
// Does this control turn knobs on this patch? Not when it is a search control
// (the patch can't), and not while it is *pending*: a control a Take carried
// over with none of its knobs left in the taken tree, which is waiting for the
// taken patch's own measurement. Pending is "not measured yet", never "can't",
// so it wears neither the amber search look nor its gesture.
const turns = (w) => !!(w && !w.search && !w.pending);
// The palette indices of the controls a wiring reaches.
const reachOfWiring = (wiring) =>
  (wiring || []).map((w, i) => (turns(w) ? (Number.isInteger(w.index) ? w.index : i) : -1)).filter((i) => i >= 0);
// What knob `addr` sounds at: its base plus every control that turns it, each
// at its value clamped to the range its wiring supports, the sum clamped to
// the knob's travel once. `wire` and `values` are aligned by panel position;
// a value is a control's turn plus any expression on it. Pure, so the
// sounding value can be tested away from the page (tests/perform.test.mjs).
export function soundingOf(base, addr, wire, values) {
  let v = base;
  (wire || []).forEach((w, i) => {
    const c0 = values[i] || 0;
    if (!turns(w) || !c0) return;
    const [lo, hi] = rangeOf(w);
    const c = clamp(c0, lo, hi);
    for (const [a, g] of w.knobs) if (a === addr) v += c * g;
  });
  return clamp(v, 0, KNOB_MAX);
}
// The bases that keep every knob sounding where it does when the controls
// at the positions `keep` says false leave the panel: for each knob, what it
// sounds at now (`soundingOf`, with those controls' turns and no expression
// on them, which is released), less what the controls that stay add to it.
// Not clamped here: `soundingOf` clamps the sum once, so a base past the end
// of a knob's travel with a kept control pulling back sounds exactly as
// before (base 0.85, a hidden +0.30 and a kept −0.25 sound at 0.90 before
// and after; a base clamped to 1.0 would sound at 0.75).
export function foldHidden(bases, wire, values, keep) {
  const kept = values.map((v, i) => (keep[i] ? v : 0));
  const out = new Map();
  for (const [a, b] of bases) {
    const target = soundingOf(b, a, wire, values);
    out.set(a, target - keptSum(a, wire, kept));
  }
  return out;
}
// The bases that keep every knob sounding where it does when the wiring
// under the controls changes (a re-check measured new gains, or new halves):
// for each knob, what it sounds at under the old wiring and values, less what
// the new wiring at the new values adds. Unclamped, as `foldHidden`'s are:
// everything sent to the voices goes through `soundingOf`, which clamps once.
export function rebase(bases, oldWire, oldValues, newWire, newValues) {
  const out = new Map();
  for (const [a, b] of bases) out.set(a, soundingOf(b, a, oldWire, oldValues) - keptSum(a, newWire, newValues));
  return out;
}
// What the controls with non-zero `values` add to knob `addr`, unclamped.
function keptSum(addr, wire, values) {
  let v = 0;
  (wire || []).forEach((w, i) => {
    const c0 = values[i] || 0;
    if (!turns(w) || !c0) return;
    const [lo, hi] = rangeOf(w);
    const c = clamp(c0, lo, hi);
    for (const [a, g] of w.knobs) if (a === addr) v += c * g;
  });
  return v;
}
// How far a search control has to be turned before letting go asks for
// something (a graft or an offer). Short of it, it springs back and asks
// nothing; the dial draws a notch there while it is being turned.
const ASK_AT = 0.3;
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const svg = (tag, attrs, cls) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
  if (cls) e.setAttribute("class", cls);
  return e;
};

function wanderZone(w) {
  if (w < WANDER_IDEAS) return "still";
  if (w < WANDER_DRIFT) return "ideas";
  if (w < WANDER_ROAM) return "drift";
  return "roam";
}

// Seconds between autonomous moves, and walk length, by dial position. Drift
// aims at one audible change per phrase; Roam at one per bar or two.
function wanderPace(w) {
  const z = wanderZone(w);
  // sigma is the walk's step on a knob's 0..1 range (Engine::local_walk).
  // Measured over 12 presets: sigma 0.05 × 8 steps moves the farthest knob
  // ~0.06–0.14, 0.08 × 18 ~0.15–0.33, 0.15 × 40 ~0.25–0.6.
  if (z === "drift") {
    const t = (w - WANDER_DRIFT) / (WANDER_ROAM - WANDER_DRIFT);
    return { period: 36 - 22 * t, steps: Math.round(8 + 10 * t), glide: 6 - 2 * t, sigma: 0.05 + 0.03 * t };
  }
  if (z === "roam") {
    const t = (w - WANDER_ROAM) / (1 - WANDER_ROAM);
    return { period: 12 - 5 * t, steps: Math.round(24 + 16 * t), glide: 3 - t, sigma: 0.1 + 0.05 * t };
  }
  return { period: 24, steps: 40, glide: 0, sigma: 0.05 };
}

export function createPerform(host) {
  const root = host.root;
  root.innerHTML = "";
  // The panel as the player left it (`perf.panel`, saved with the session by
  // main.js): read through the host, which owns persisted state.
  const firstPanel = validPanel(host.panel ? host.panel() : null);
  const state = {
    panel: firstPanel,
    home: null,
    cur: null,
    wire: null, // [{name, low, high, knobs:[[addr,gain]], purity, reach, position, search}]
    grafted: new Set(), // control names already given a module on this patch
    intent: null, // {i, dir, at}: a turn waiting on its graft to be measured
    c: firstPanel.map(() => 0),
    sent: new Map(), // addr -> value last written to the voices
    // addr -> value a hand wrote in PATCH since this tree arrived (see
    // `knobSet`). Read only where a knob's base is taken from a measurement
    // that may predate the write; cleared with every new tree.
    hand: new Map(),
    wander: 0,
    wanderSettled: "still", // Wander's zone where it was last let go
    hold: false,
    blend: 0,
    offer: null, // {json, makeup}
    req: 0,
    // Every reply is checked against the patch it was asked about: a patch
    // change bumps gen, and anything still in flight for the old patch is
    // dropped when it lands rather than applied to the new one.
    gen: 0,
    pending: new Map(), // req -> {kind, gen, at}
    applyThen: new Map(), // req -> callback for perform_apply
    // Expression (channel pressure, the mod wheel): source -> {i, v}, an
    // offset on one named control added under the player's own turn. Never
    // counted as a touch — it would hold Wander for as long as a key is down.
    expr: new Map(),
    // Set by Keep while its tree travels through the bench and back, so the
    // echo is not mistaken for a new patch.
    keeping: null,
    measuring: false,
    // A measurement not started because another patch is on its way to the
    // bench (see `heldForOpen`): "measure" or "revalidate", or null.
    heldWire: null,
    playableAt: 0, // when the current wiring landed (see growSpare)
    lastTouch: 0,
    lastMove: performance.now(),
    glide: null, // {from: Map, to: Map, t0, dur, json}
    visible: false,
    // Velocity -> timbre: which named control a note's velocity plays, per
    // voice, and how far. -1 is off.
    touch: { i: 0, depth: 0.5, sites: [] },
  };

  // Booth attract mode plays the instrument by itself; nothing it does is the
  // player's, so none of it is logged or recorded as a pick.
  const logImplicit = (kind, detail) => {
    if (!state.quiet) host.logImplicit(kind, detail);
  };

  // ---------- the panel ----------
  // Everything below that says `i` for a named control means its position on
  // the panel (its knob, its slot in `state.c` and `state.wire`, the XY pad's
  // axes, a MIDI slot). Across the boundary a control is its palette index
  // (`indexAt`), the `index` the engine puts on each wiring.
  const controls = () => state.panel.map((k) => PALETTE[k]);
  const indexAt = (i) => {
    const w = state.wire && state.wire[i];
    const k = indexOf(w);
    return k >= 0 ? k : state.panel[i];
  };
  // A control the panel holds and no measurement has wired yet: "not
  // measured", which reads listening… and turns nothing (see `turns`).
  const unmeasured = (k) => ({
    name: PALETTE[k].name, index: k, low: PALETTE[k].low, high: PALETTE[k].high,
    knobs: [], purity: 0, reach: 0, position: 0, search: false, pending: true,
  });
  // A measurement's wirings (in the order they were asked for, each with its
  // palette `index`) laid onto the panel's positions by that index. A control
  // the measurement did not wire is unmeasured.
  function alignWiring(entries) {
    const by = new Map();
    for (const w of entries || []) {
      const k = indexOf(w);
      if (k >= 0 && !by.has(k)) by.set(k, w);
    }
    return state.panel.map((k) => by.get(k) || unmeasured(k));
  }
  // The positions of the panel's controls in the order a first gesture
  // reaches for them: Bright, Motion, Snap, Body, Space, Grit, then the rest
  // of the palette in its order (the first steps' "Turn …", the XY pad).
  const REACH_FOR = [0, 2, 1, 3, 5, 4, ...PALETTE.map((_, k) => k).slice(6)];
  const preferOrder = () => REACH_FOR.map((k) => state.panel.indexOf(k)).filter((i) => i >= 0);
  // Palette indices as positions on the panel (booth mode asks by position,
  // as `reaches(i)` answers), leaving out what is not on it.
  const onPanel = (ks) => ks.map((k) => state.panel.indexOf(k)).filter((i) => i >= 0);

  // ---------- layout ----------
  const head = el("div", "pf-head");
  const title = el("div", "pf-title");
  const nameEl = el("div", "pf-name", "·");
  const statusEl = el("div", "pf-status mono", "");
  // What PERFORM is doing with the sound is announced politely, by a quiet
  // twin of the status line (`statusSaid`): the one live region for a
  // measurement (the controls' own waiting signs are silent), and it leaves
  // out "re-checking", which comes and goes in the background and is not
  // news.
  const statusSaid = el("div", "sr-only", "");
  statusSaid.setAttribute("role", "status");
  // The visible line is for the eye; its twin is what is read, once.
  statusEl.setAttribute("aria-hidden", "true");
  title.append(nameEl, statusEl, statusSaid);
  const scope = el("canvas", "pf-scope");
  scope.width = 360;
  scope.height = 72;
  scope.setAttribute("aria-hidden", "true");
  head.append(title, scope);

  const deck = el("div", "pf-deck");
  deck.setAttribute("role", "group");
  deck.setAttribute("aria-label", "Performance controls");
  const pads = el("div", "pf-pads");
  pads.setAttribute("role", "group");
  pads.setAttribute("aria-label", "Performance pads");
  const touchRow = el("div", "pf-touch mono");
  const offerCard = el("div", "pf-offer");
  const why = el("div", "pf-why");
  // Under the hood: the real knobs the controls and Wander are moving, live.
  // The named controls are a *view* onto these; this is where that becomes
  // visible, and each one opens its module in PATCH.
  const hood = el("div", "pf-hood");
  // The XY pad: two named controls under one finger, the gesture a
  // performer reaches for first. Beside the hood strip, so the knobs it
  // moves are visible while it moves them.
  const xy = el("div", "pf-xy");
  const stage = el("div", "pf-stage");
  stage.append(xy, hood);
  // First steps: the whole loop in three moves, ticked off as they happen.
  const stepsEl = el("div", "pf-steps mono");
  stepsEl.setAttribute("role", "status");
  // The marquee row holds the first steps, and in booth mode the attract band
  // laid over the same slot (main.js moves it in): attract then hides nothing
  // it is showing off, and nothing moves when a visitor takes over.
  const marquee = el("div", "pf-marquee");
  marquee.append(stepsEl);
  root.append(head, marquee, deck, touchRow, pads, offerCard, stage, why);

  // ---------- knobs ----------
  const knobs = [];
  function makeKnob(i, spec) {
    const wrap = el("div", "pf-knob");
    wrap.dataset.i = String(i);
    const s = svg("svg", { viewBox: "-50 -50 100 100", width: 96, height: 96 });
    // The travel is drawn as its two halves, low (7:30 → 12 o'clock) and high
    // (12 → 4:30), so a half the patch's renders closed can be drawn closed
    // and the half you can turn toward drawn open. It used to be one circle
    // with a dash pattern, which assumed a circle's stroke starts at 12
    // o'clock; it starts at 3, so the ring was drawn on the closed side.
    const pointer = svg("g", {}, "pf-k-turn");
    pointer.append(svg("line", { x1: 0, y1: -12, x2: 0, y2: -30 }, "pf-k-ptr"));
    const where = svg("circle", { r: 3.2, cx: 0, cy: -44 }, "pf-k-where");
    where.append(svg("title"));
    s.append(
      svg("path", { d: arcPath(-135, 0) }, "pf-k-half pf-k-lo"),
      svg("path", { d: arcPath(0, 135) }, "pf-k-half pf-k-hi"),
      // The stop at the centre of a half-closed control.
      svg("line", { x1: 0, y1: -49.5, x2: 0, y2: -38.5 }, "pf-k-stop"),
      svg("path", { d: "" }, "pf-k-arc"),
      // Where letting go of a search control starts to ask (±ASK_AT).
      svg("path", { d: `${radial(-ASK_AT * 135, 39, 49)} ${radial(ASK_AT * 135, 39, 49)}` }, "pf-k-notch"),
      svg("circle", { r: 34 }, "pf-k-body"),
      pointer,
      where,
    );
    // Where a re-centred control was, fading (see `recentre`).
    if (spec.kind === "named") s.insertBefore(svg("path", { d: "" }, "pf-k-ghost"), s.querySelector(".pf-k-body"));
    if (spec.kind === "wander") {
      // Where the zones begin (ideas, drift, roam): three short ticks just
      // outside the ring, and inside it a thin arc that fills toward
      // Wander's next move.
      const at = (v) => -135 + v * 270;
      const ticks = [WANDER_IDEAS, WANDER_DRIFT, WANDER_ROAM].map((v) => radial(at(v), 45, 49)).join(" ");
      s.insertBefore(svg("path", { d: ticks }, "pf-k-zone"), s.querySelector(".pf-k-body"));
      s.insertBefore(svg("path", { d: "" }, "pf-k-count"), s.querySelector(".pf-k-body"));
    }
    const name = el("div", "pf-k-name", spec.name);
    const ends = el("div", "pf-k-ends mono", `${spec.low} · ${spec.high}`);
    const sub = el("div", "pf-k-sub mono", "");
    // A control being measured says so in its own box over the line under
    // it (#live-wait's sign: the line keeps its box, hidden, so nothing
    // moves). The status line above the deck is the one that announces it.
    const wait = el("div", "pf-k-wait mono", "");
    wait.setAttribute("aria-hidden", "true");
    const line = el("div", "pf-k-line");
    line.append(sub, wait);
    wrap.append(s, name, ends, line);
    if (spec.kind === "named") wrap.dataset.index = String(spec.index);
    wrap.tabIndex = 0;
    wrap.setAttribute("role", "slider");
    wrap.setAttribute("aria-label", spec.name);
    wrap.setAttribute("aria-valuemin", "-1");
    wrap.setAttribute("aria-valuemax", "1");
    const k = { i, spec, wrap, svg: s, sub, wait, value: spec.initial || 0 };
    bindDrag(k);
    deck.append(wrap);
    knobs.push(k);
    return k;
  }

  const ARC_R = 44;
  const angleOf = (v, bipolar) => (bipolar ? v * 135 : -135 + v * 270);
  const polar = (deg) => {
    const r = (deg - 90) * (Math.PI / 180);
    return [ARC_R * Math.cos(r), ARC_R * Math.sin(r)];
  };
  function arcPath(a0, a1) {
    if (Math.abs(a1 - a0) < 0.5) return "";
    const [x0, y0] = polar(Math.min(a0, a1));
    const [x1, y1] = polar(Math.max(a0, a1));
    const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
    return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${ARC_R} ${ARC_R} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  }
  // An arc like arcPath's at another radius (Wander's countdown sits inside
  // the ring).
  function arcAt(a0, a1, R) {
    if (Math.abs(a1 - a0) < 0.5) return "";
    const p = (deg) => {
      const r = (deg - 90) * (Math.PI / 180);
      return [R * Math.cos(r), R * Math.sin(r)];
    };
    const [x0, y0] = p(Math.min(a0, a1));
    const [x1, y1] = p(Math.max(a0, a1));
    const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
    return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${R} ${R} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  }
  // A short radial tick at `deg`, from radius r0 out to r1.
  function radial(deg, r0, r1) {
    const r = (deg - 90) * (Math.PI / 180);
    const p = (R) => `${(R * Math.cos(r)).toFixed(2)} ${(R * Math.sin(r)).toFixed(2)}`;
    return `M ${p(r0)} L ${p(r1)}`;
  }

  function paintKnob(k) {
    if (k.spec.kind === "named" && typeof paintXY === "function" && (k.i === XY.x || k.i === XY.y)) queueMicrotask(paintXY);
    const bipolar = k.spec.kind === "named" || k.spec.kind === "blend-bipolar";
    const v = k.value;
    // Where the pointer is drawn: the value, or on its way there while a
    // re-centre glides (`recentre`).
    const a = angleOf(k.drawn != null ? k.drawn : v, bipolar);
    k.svg.querySelector(".pf-k-ptr").setAttribute("transform", `rotate(${a})`);
    k.svg.querySelector(".pf-k-arc").setAttribute("d", arcPath(bipolar ? 0 : -135, a));
    k.wrap.setAttribute("aria-valuenow", v.toFixed(2));
    const where = k.svg.querySelector(".pf-k-where");
    const [loHalf, hiHalf] = [k.svg.querySelector(".pf-k-lo"), k.svg.querySelector(".pf-k-hi")];
    if (k.spec.kind === "named") {
      const w = state.wire && state.wire[k.i];
      const search = !!(w && w.search);
      // Not measured yet: no wiring at all, or a control a Take carried over
      // with nothing left to turn. One look for it, never the amber of a
      // control this patch can't reach.
      const pending = !w || !!w.pending;
      const listening = w ? !!w.pending : state.measuring;
      // Listening for real: a measurement that will wire this control is
      // out (a first one, a re-check, or the panel's new set).
      const waiting = pending && (state.measuring || state.revalidating || inFlight("perform_wire"));
      k.wrap.classList.toggle("waiting", waiting);
      if (k.wait.textContent !== (waiting ? "listening…" : "")) k.wait.textContent = waiting ? "listening…" : "";
      k.wrap.classList.toggle("search", search);
      k.wrap.classList.toggle("unwired", pending);
      k.wrap.classList.toggle("pending", pending);
      const [lo, hi] = rangeOf(w);
      const halfLo = turns(w) && lo === 0;
      const halfHi = turns(w) && hi === 0;
      k.wrap.classList.toggle("half-lo", halfLo);
      k.wrap.classList.toggle("half-hi", halfHi);
      loHalf.classList.toggle("closed", halfLo);
      hiHalf.classList.toggle("closed", halfHi);
      loHalf.classList.toggle("open", !halfLo);
      hiHalf.classList.toggle("open", !halfHi);
      if (w && !pending) {
        // Where the sound measures on this axis: z through a soft squash onto
        // the dial's travel, so "very bright for this bank" sits near the stop.
        const pos = Math.tanh(w.position / 2);
        const [x, y] = polar(pos * 135);
        where.setAttribute("cx", x.toFixed(2));
        where.setAttribute("cy", y.toFixed(2));
        where.style.display = "";
        const dotSays = `The amber dot is where this sound measures on ${w.name}, compared with the sounds in your session.`;
        where.querySelector("title").textContent = dotSays;
        // What the player can do, not where the app infers the sound sits: a
        // half closes because the renders did not confirm it, which is not
        // the same as the sound being at that end, and the dot often said
        // otherwise. Short enough for the cell at 1280 px: a caption cut off
        // with an ellipsis reads as broken, whatever it was going to say.
        k.sub.textContent = search
          ? k.asking
            ? askWords(w, v)
            : "turn to ask for it"
          : halfLo
            ? `turns toward ${w.high} only`
            : halfHi
              ? `turns toward ${w.low} only`
              : knobCaption(w.knobs.map(([a]) => a));
        // A sentence a player can read, not the measurement: addresses,
        // purity and σ are the engineer's, and live in the docs and the
        // under-the-hood strip, not on the knob.
        const toward = halfLo ? ` It only turns toward ${w.high} on this patch.` : halfHi ? ` It only turns toward ${w.low} on this patch.` : "";
        k.wrap.title = search
          ? `${w.name}: nothing in this patch makes it ${w.high} without changing something else. Turn it and it grows a variant that can.`
          : `${w.name}: ${w.knobs.map(([a, g]) => `${g >= 0 ? "raises" : "lowers"} ${knobWord(a, true)}`).join(", ")} as you turn it toward ${w.high}.${toward} Long-press to hear it.`;
        k.wrap.title += `\n${dotSays}`;
        // The engineer's view, on request (⋯ → Show measurements): what the
        // measurement actually said, in its own units.
        if (host.engineer?.()) {
          const halves = w.down != null ? `measured −${w.down.toFixed(2)}σ / +${w.up.toFixed(2)}σ` : `${w.reach.toFixed(2)}σ predicted`;
          k.wrap.title += `\n\npurity ${w.purity.toFixed(2)} · reach ${w.reach.toFixed(2)}σ · ${halves} · at ${w.position.toFixed(2)}σ\n${w.knobs.map(([a, g]) => `${a} ${g >= 0 ? "+" : "−"}${Math.abs(g).toFixed(2)}`).join("  ")}`;
        }
      } else {
        where.style.display = "none";
        k.sub.textContent = listening ? "listening…" : "";
        k.wrap.title = listening
          ? `${k.spec.name}: listening to how this sound moves. It turns once that is done.`
          : k.spec.name;
      }
      k.wrap.setAttribute("aria-valuetext", Math.abs(v) < 0.005 ? "center" : `${v > 0 ? k.spec.high : k.spec.low} ${Math.round(Math.abs(v) * 100)}%`);
    } else if (k.spec.kind === "wander") {
      where.style.display = "none";
      const [words, left] = wanderState();
      k.sub.textContent = words;
      k.wrap.classList.toggle("held", state.hold);
      k.wrap.setAttribute("aria-valuetext", words);
      k.wrap.title = wanderTitle();
      // The wait for the next move, as a thin arc filling clockwise from the
      // dial's start: drawn only while Wander is counting down to one.
      const count = k.svg.querySelector(".pf-k-count");
      if (count) count.setAttribute("d", left == null ? "" : arcAt(-135, -135 + 270 * (1 - left), 39));
    } else if (k.spec.kind === "blend") {
      where.style.display = "none";
      k.sub.textContent = state.offer ? `${Math.round(v * 100)}% offer` : "no offer yet";
      k.wrap.classList.toggle("unwired", !state.offer);
      k.wrap.setAttribute("aria-valuetext", `${Math.round(v * 100)} percent offer`);
    }
  }

  // What letting go of a search control turned to `v` would do, said while it
  // is being turned: short of ASK_AT nothing (it springs back), past it a
  // graft or an offer.
  function askWords(w, v) {
    if (Math.abs(v) < ASK_AT) return "turn further to ask";
    const graft = graftFor(w, v > 0);
    return graft ? `let go to add a ${graft}` : `let go to ask for ${v > 0 ? w.high : w.low}`;
  }

  // Where a control's dial may sit. A named control stops at the centre on a
  // half its wiring closed, as the sound already did (liveValue): the dial
  // used to turn on past it, drawing an arc on the closed side that nothing
  // played, and the next drag then started from a value the sound had never
  // had. A search control turns both ways, because turning it is how you ask,
  // and so does one whose wiring has not been measured yet (it springs back
  // when let go).
  function spanOf(k) {
    if (k.spec.kind !== "named") return [0, 1];
    const w = state.wire?.[k.i];
    if (!turns(w)) return [-1, 1];
    const [lo, hi] = rangeOf(w);
    return lo === hi ? [-1, 1] : [lo, hi];
  }

  // A drag that runs into the stop of a half-closed control: the pointer
  // gives a small bump toward the closed side and back (120 ms; none under
  // reduced motion, see style.css). Once per arrival at the stop.
  function bump(k, dir) {
    const cls = dir < 0 ? "bump-lo" : "bump-hi";
    k.wrap.classList.remove("bump-lo", "bump-hi");
    void k.wrap.getBoundingClientRect();
    k.wrap.classList.add(cls);
    clearTimeout(k.bumpTimer);
    k.bumpTimer = setTimeout(() => k.wrap.classList.remove(cls), 160);
  }

  function bindDrag(k) {
    let startY = 0;
    let startV = 0;
    let pressT = 0;
    let moved = false;
    let hearTimer = null;
    const lo = () => (k.spec.kind === "named" ? -1 : 0);
    const set = (v, fine) => {
      if (k.tween) cancelAnimationFrame(k.tween), (k.tween = null);
      k.drawn = null;
      const [sLo, sHi] = spanOf(k);
      k.value = clamp(v, sLo, sHi);
      // A half-closed control's stop at the centre is felt, not only seen.
      const half = k.spec.kind === "named" && (sLo === 0 || sHi === 0) && sLo !== sHi;
      const pushed = half ? (v < sLo - 1e-9 ? -1 : v > sHi + 1e-9 ? 1 : 0) : 0;
      if (pushed && !k.atStop) bump(k, pushed);
      k.atStop = !!pushed;
      // A light detent at the centre of a bipolar control: home is findable
      // by feel.
      if (k.spec.kind === "named" && !fine && Math.abs(k.value) < 0.03) k.value = 0;
      // A search control being turned says what letting go would do.
      k.asking = k.spec.kind === "named" && !!state.wire?.[k.i]?.search;
      k.wrap.classList.toggle("asking", k.asking);
      paintKnob(k);
      onKnob(k);
    };
    k.wrap.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      k.held = true;
      if (k.tween) cancelAnimationFrame(k.tween), (k.tween = null);
      k.drawn = null;
      k.atStop = false;
      k.wrap.focus({ preventScroll: true });
      k.wrap.setPointerCapture(e.pointerId);
      startY = e.clientY;
      startV = k.value;
      pressT = performance.now();
      moved = false;
      // Turning Wander is not a hand on the sound: it must not pause Wander
      // itself ("paused — your hands are on it" as you turned it up). A key
      // gesture still settling hands over to the pointer: it must not let
      // go of Wander under the pointer 450 ms in.
      if (k.spec.kind === "wander") {
        clearTimeout(k.keyTimer);
        wanderGrab();
      } else touch();
      if (k.spec.kind === "named") {
        const touchHold = e.pointerType === "touch";
        hearTimer = setTimeout(() => {
          // On touch a long press asks what the control does (explain.js:
          // its figure, which can play the same sweep); with a mouse it is
          // still the sweep by ear.
          if (moved) return;
          if (touchHold && host.askHold?.(k.wrap)) return;
          hearIt(k);
        }, 550);
      }
    });
    k.wrap.addEventListener("pointermove", (e) => {
      if (!k.wrap.hasPointerCapture(e.pointerId)) return;
      const dy = startY - e.clientY;
      if (Math.abs(dy) > 3) moved = true;
      const span = e.shiftKey ? 900 : 180;
      set(startV + (dy / span) * (1 - lo()), e.shiftKey);
      if (k.spec.kind !== "wander") touch();
    });
    const end = (e) => {
      clearTimeout(hearTimer);
      k.held = false;
      queueMicrotask(panelLater);
      const held = k.wrap.hasPointerCapture(e.pointerId);
      if (held) k.wrap.releasePointerCapture(e.pointerId);
      // One of three: a turn is let go (`onRelease`, which springs back a
      // control with nothing to turn); Wander pressed without turning is let
      // go, a tap also holding or releasing it; a nudge too small to count as
      // a turn still lets go of a control that has nothing to turn, which
      // springs back rather than sitting off-centre.
      if (moved) onRelease(k);
      else if (k.spec.kind === "wander") {
        if (performance.now() - pressT < 300) toggleHold();
        wanderLetGo();
      } else if (held && k.spec.kind === "named" && !turns(state.wire?.[k.i])) springBack(k);
    };
    k.wrap.addEventListener("pointerup", end);
    k.wrap.addEventListener("pointercancel", end);
    k.wrap.addEventListener("dblclick", () => {
      set(k.spec.kind === "named" ? 0 : k.value);
      onRelease(k);
    });
    k.wrap.addEventListener("keydown", (e) => {
      const step = e.shiftKey ? 0.01 : 0.05;
      if (e.key === "ArrowUp" || e.key === "ArrowRight") set(k.value + step, true);
      else if (e.key === "ArrowDown" || e.key === "ArrowLeft") set(k.value - step, true);
      else if (e.key === "Home") set(k.spec.kind === "named" ? 0 : 0);
      else if (e.key === "Enter" && k.spec.kind === "named") hearIt(k);
      else return;
      e.preventDefault();
      e.stopPropagation();
      if (k.spec.kind === "wander") wanderGrab();
      else touch();
      // A run of arrow presses is one gesture: logged, and a search control
      // asked, once the keys go quiet.
      clearTimeout(k.keyTimer);
      k.keyTimer = setTimeout(() => onRelease(k), 450);
    });
  }

  // Wander waits HANDS_OFF_MS after any touch, and says so for that long
  // ("paused 3 s"). That is Wander's own state, and it is said on Wander,
  // under its name, with a thin arc counting down to the next move (see
  // `wanderState`). The status line keeps to the patch: it used to carry
  // "wander: drift" and "paused — your hands are on it" beside the
  // measurement, in the least-read place on the screen.
  function touch() {
    state.lastTouch = performance.now();
    renderWander();
  }
  function handsOn() {
    return performance.now() - state.lastTouch < HANDS_OFF_MS;
  }

  // Wander in the hand: autonomous moves wait while it is being turned, but
  // it is not a touch. Let go in a new zone and the first move comes
  // WANDER_FIRST_MS after (and after any other hand has been off for
  // HANDS_OFF_MS); the zone's period governs the moves after that.
  // "A new zone" is one other than where Wander was last let go
  // (`wanderSettled`), so a gesture that starts on the keys and ends on the
  // pointer still counts once, at its end.
  function wanderGrab() {
    state.wanderGrab = true;
    renderWander();
  }
  function wanderLetGo() {
    state.wanderGrab = false;
    const z = wanderZone(state.wander);
    if (z !== state.wanderSettled && z !== "still") {
      const now = performance.now();
      state.moveFrom = now;
      state.moveAt = now + WANDER_FIRST_MS;
      state.wanderStay = 0;
      setTimeout(wanderTick, WANDER_FIRST_MS + 20);
    }
    state.wanderSettled = z;
    renderWander();
  }

  // When Wander moves next, as [from, at] in performance.now() time: a first
  // move scheduled by a let-go, else a period after the last move. Hands on
  // push it back to HANDS_OFF_MS after the last touch.
  function wanderDue() {
    const pace = wanderPace(state.wander);
    let from = state.lastMove;
    let at = state.lastMove + pace.period * 1000;
    if (state.moveAt != null) [from, at] = [state.moveFrom, state.moveAt];
    const off = state.lastTouch + HANDS_OFF_MS;
    return [from, Math.max(at, off)];
  }

  // What Wander is doing, in a few words for the line under it, and how much
  // of the wait for its next move is left (0..1), or null when it is not
  // counting down to one.
  function wanderState() {
    const z = wanderZone(state.wander);
    if (state.hold) return ["frozen", null];
    if (z === "still") return ["still", null];
    if (state.wanderGrab) return [z, null];
    const now = performance.now();
    if (handsOn()) return [`paused ${Math.max(1, Math.ceil((state.lastTouch + HANDS_OFF_MS - now) / 1000))} s`, null];
    if (state.glide && state.glide.why === "Wander") return [`${z} · gliding${state.wanderTaste === false ? " · no taste yet" : ""}`, null];
    if (inFlight("perform_drift")) return [`${z} · walking…`, null];
    if (z === "ideas") {
      if (state.offer) return ["ideas · one in B", null];
      if (inFlight("perform_offer")) return ["ideas · growing…", null];
    }
    if (!state.cur || !state.wire) return [z, null];
    if (state.wanderStay && now - state.wanderStay < 6000) return ["nothing better nearby", null];
    const [from, at] = wanderDue();
    const left = Math.max(0, at - now);
    const span = Math.max(1, at - from);
    return [`${z} · next in ${Math.max(1, Math.ceil(left / 1000))} s`, Math.min(1, left / span)];
  }
  function wanderTitle() {
    const base = "Wander: how alive the sound is. Still, ideas (variants appear in B), drift (small steps toward your taste, glided), roam (bigger, faster). Tap to freeze it.";
    return state.wanderWhy ? `${base}\nLast move: ${state.wanderWhy}.` : base;
  }
  function renderWander() {
    const k = knobs.find((x) => x.spec.kind === "wander");
    if (k) paintKnob(k);
  }

  // ---------- the sound ----------
  // Each named control's value now: its turn plus any expression on it.
  function controlValues() {
    return state.c.map((c, i) => {
      let p = 0;
      for (const x of state.expr.values()) if (x.i === i) p += x.v;
      return c + p;
    });
  }
  function liveValue(addr) {
    const base = state.cur.knobs.get(addr);
    if (base == null) return null;
    return soundingOf(base, addr, state.wire, controlValues());
  }

  function overrides() {
    if (!state.cur) return [];
    const out = [...state.cur.knobs.keys()].map((a) => [a, liveValue(a)]);
    // A knob turned in PATCH that this wiring does not hold is still part of
    // the sound: Keep, an offer or a drift built without it would put the
    // tree's old value back.
    for (const [a, v] of state.hand) if (!state.cur.knobs.has(a)) out.push([a, v]);
    return out;
  }

  // Write every knob whose sounding value changed. Only continuous knobs are
  // ever written, so the voices take them with no recompile.
  function push() {
    const live = host.live();
    if (!live || !state.cur) return;
    paintHoodSoon();
    for (const a of state.cur.knobs.keys()) {
      const v = liveValue(a);
      if (v == null) continue;
      const prev = state.sent.get(a);
      if (prev == null || Math.abs(prev - v) > 1e-5) {
        live.param(a, v);
        state.sent.set(a, v);
        const ti = state.touch.sites.findIndex(([ta]) => ta === a);
        if (ti >= 0) {
          state.touch.sites[ti][2] = v;
          live.touchBase(ti, v);
        }
      }
    }
  }

  // A knob turned in PATCH. The hand wrote `v` into the voices already; this
  // makes it PERFORM's base too, so the sound PERFORM describes and plays
  // from is the one the player just set. Without it the base stayed at the
  // tree PERFORM last measured, until a structural edit re-sent the tree:
  // PATCH drew the old value as "performed" (an amber readout and pointer
  // over the knob the player had just turned), and the first PERFORM control
  // moved after it wrote the old value back into the voices, silently
  // undoing the edit. Home follows as well, because the edit is to the patch
  // itself: Back must not glide it away.
  function knobSet(addr, v) {
    if (!state.cur || !Number.isFinite(v)) return;
    v = clamp(v, 0, KNOB_MAX);
    state.hand.set(addr, v);
    // The player's hands are on the patch: a drift grown from before this
    // turn is dropped, and a glide in progress stops where it is.
    touch();
    if (!state.cur.knobs.has(addr)) return;
    state.cur.knobs.set(addr, v);
    if (state.home && state.home.knobs && state.home.knobs.has(addr)) state.home.knobs.set(addr, v);
    const g = state.glide;
    if (g) {
      if (g.from.has(addr)) g.from.set(addr, v);
      if (g.to.has(addr)) g.to.set(addr, v);
    }
    state.sent.set(addr, v);
    // With a control turned on this knob, what sounds is the new base plus
    // the control's offset — PATCH wrote the bare base, so put it back on.
    const lv = liveValue(addr);
    const live = host.live();
    if (live && lv != null && Math.abs(lv - v) > 1e-5) {
      live.param(addr, lv);
      state.sent.set(addr, lv);
    }
    const ti = state.touch.sites.findIndex(([ta]) => ta === addr);
    if (ti >= 0 && lv != null) {
      state.touch.sites[ti][2] = lv;
      if (live && live.touchBase) live.touchBase(ti, lv);
    }
    paintHoodSoon();
  }

  // PATCH's knob writes landed on the bench: the same structure with new
  // values, already in the voices knob by knob (`knobSet`). The tree text
  // follows, so a first measurement, Keep and an offer all start from the
  // patch as edited rather than as it arrived.
  function followTree(json) {
    if (!state.cur || !json || state.cur.json === json) return;
    if (structureDiffers(state.cur.json, json)) return;
    state.cur.json = json;
    if (state.home && state.home.json && !structureDiffers(state.home.json, json)) state.home.json = json;
  }

  // Why PERFORM is playing `addr` away from the patch, or null when it is
  // not. The same terms `liveValue` adds (a named control or expression with
  // a non-zero offset on a wire that reaches this knob, search controls
  // skipped), plus a glide under way, plus a base PERFORM itself carried away
  // from home (a finished drift, or controls folded into the centre by a
  // re-measurement) and has not kept. A base that merely disagrees with the
  // bench is none of these, and is not a performance.
  function movedOn(addr) {
    if (!state.cur) return null;
    const base = state.cur.knobs.get(addr);
    if (base == null) return null;
    const why = [];
    (state.wire || []).forEach((w, i) => {
      if (!turns(w)) return;
      let p = 0;
      for (const x of state.expr.values()) if (x.i === i) p += x.v;
      if (!(state.c[i] + p)) return;
      if (w.knobs.some(([a, g]) => a === addr && g)) why.push(w.name);
    });
    const g = state.glide;
    if (g && g.from.has(addr) && Math.abs((g.to.has(addr) ? g.to.get(addr) : g.from.get(addr)) - g.from.get(addr)) > 1e-4) {
      why.push(g.why || "a glide");
    } else {
      const h = state.home && state.home.knobs ? state.home.knobs.get(addr) : null;
      if (h != null && Math.abs(base - h) > 0.004) why.push("moved since the last Keep");
    }
    return why.length ? why : null;
  }

  // Send the touch wiring: the chosen control's knobs, their gains and where
  // they sit now. Off, or a control this patch cannot reach, sends nothing to
  // play — velocity is then loudness only, as it always was.
  function sendTouch() {
    const live = host.live();
    const w = state.wire && state.touch.i >= 0 ? state.wire[state.touch.i] : null;
    const [lo, hi] = rangeOf(w);
    state.touch.sites =
      turns(w) && lo < 0 && hi > 0 ? w.knobs.map(([a, g]) => [a, g, liveValue(a) ?? 0]) : [];
    if (live && live.touch) live.touch(state.touch.sites, state.touch.depth);
    renderTouch();
  }

  // A drop-down swallows the note keys while it has focus (main.js lets text
  // entry keep every key), and a native select type-aheads: after choosing an
  // XY axis or what touch plays, the keys went silent, or an `s` jumped the
  // axis to Snap. So a choice hands the keys back: focus leaves the select
  // for `target` (the XY field), or for nothing. Only a choice made by
  // steering the closed select with the arrow keys keeps it there, so a
  // keyboard player can step through the options.
  const STEER_KEYS = /^(Arrow(Up|Down|Left|Right)|Page(Up|Down)|Home|End)$/;
  function steerable(sel) {
    sel.addEventListener("keydown", (e) => {
      if (STEER_KEYS.test(e.key)) sel.dataset.steerAt = String(performance.now());
    });
  }
  const steered = (sel) => performance.now() - Number(sel.dataset.steerAt || -1e9) < 400;
  function giveBackKeys(sel, target) {
    if (steered(sel)) return;
    if (document.activeElement === sel) sel.blur();
    if (target) target.focus({ preventScroll: true });
  }

  function renderTouch() {
    touchRow.innerHTML = "";
    const lab = el("span", "pf-touch-l", "touch");
    const sel = document.createElement("select");
    sel.id = "pf-touch-sel";
    sel.setAttribute("aria-label", "What your velocity plays");
    const off = document.createElement("option");
    off.value = "-1";
    off.textContent = "loudness only";
    sel.append(off);
    controls().forEach((c, i) => {
      const w = state.wire && state.wire[i];
      const [lo, hi] = rangeOf(w);
      const o = document.createElement("option");
      o.value = String(i);
      o.textContent = `${c.name.toLowerCase()}: soft ${c.low}, hard ${c.high}`;
      o.disabled = !turns(w) || lo === 0 || hi === 0;
      if (i === state.touch.i) o.selected = true;
      sel.append(o);
    });
    if (state.touch.i < 0) off.selected = true;
    sel.onchange = () => {
      const keep = steered(sel);
      state.touch.i = Number(sel.value);
      // …which rebuilds this row, select and all.
      sendTouch();
      if (keep) touchRow.querySelector("select")?.focus({ preventScroll: true });
      else giveBackKeys(sel, null);
    };
    steerable(sel);
    const depth = document.createElement("input");
    depth.type = "range";
    depth.min = "0";
    depth.max = "1";
    depth.step = "0.05";
    depth.value = String(state.touch.depth);
    depth.id = "pf-touch-depth";
    depth.setAttribute("aria-label", "How far velocity reaches");
    depth.oninput = () => {
      state.touch.depth = Number(depth.value);
      const live = host.live();
      if (live && live.touch) live.touch(state.touch.sites, state.touch.depth);
    };
    const note = el(
      "span",
      "pf-touch-n",
      state.touch.sites.length ? `velocity moves ${knobWords(state.touch.sites.map(([a]) => a))}` : "velocity sets loudness only",
    );
    touchRow.append(lab, sel, depth, note);
  }

  // What PERFORM adds when a control has nothing to turn (the engine's
  // `perform::insert_for`); Snap and Motion have no one-module answer.
  // `perform::graft_for`: a transparent EQ gives Bright and Body its shelves;
  // Space, asked for more of, gets a release long enough to have a tail
  // (every effect here sits before the amp envelope, so a reverb alone is cut
  // at note-off). Grit, Snap and Motion have no honest one-step answer.
  const GRAFTS = { Bright: "tone EQ", Body: "tone EQ", Space: "longer release" };

  // A search control's offer is aimed the way the control was turned
  // (`Engine::offer_toward`, ADR-008), and B says how far it went, in the
  // control's own words for "more of it" each way (words.js `PALETTE`'s
  // `aim`). `{k, sign}` for the control at panel position `i` turned `dir`
  // (+1 up, −1 down): `k` is its palette index, the wiring's `index`, which
  // is how the engine names it (`perform_offer`'s `control`). Never the
  // position: on a panel in another order, position 0 is not Bright.
  function aimAt(i, dir) {
    const k = indexAt(i);
    const c = PALETTE[k];
    return c ? { k, sign: dir > 0 ? 1 : -1, word: c.aim[dir > 0 ? 1 : 0] } : null;
  }

  // A knob as a player names it: "cutoff", or with its module, "filter
  // cutoff". The rack's own labels, via the host; the address suffix only
  // when the host has nothing better.
  function knobWord(addr, withModule) {
    const info = host.knobInfo ? host.knobInfo(addr, 0) : null;
    const label = (info && info.label) || addr.split("#").pop();
    return withModule && info && info.module ? `${info.module.toLowerCase()} ${label.toLowerCase()}` : label.toLowerCase();
  }

  // Several knobs as a phrase: bare names where they are unambiguous, with the
  // module where two share a name ("env attack · lfo attack", never
  // "attack · attack").
  function knobWords(addrs) {
    const bare = addrs.map((a) => knobWord(a));
    return addrs.map((a, i) => (bare.indexOf(bare[i]) !== bare.lastIndexOf(bare[i]) ? knobWord(a, true) : bare[i])).join(" · ");
  }

  // The caption under a control: at most two knobs by name, then how many
  // more ("mod depth · lfo rate +1"), and one when two would run past
  // CAPTION_CHARS (two names that need their modules, "wavefolder mod depth ·
  // vco mod depth"). The caption wraps in three lines, and three lines of
  // the narrowest column (1000 px) hold 24 characters on any renderer; the
  // tooltip and the under-the-hood strip list every knob.
  const CAPTION_CHARS = 24;
  function knobCaption(addrs) {
    const names = knobWords(addrs).split(" · ");
    const two = names.length <= 2 ? names.join(" · ") : `${names.slice(0, 2).join(" · ")} +${names.length - 2}`;
    if (names.length < 2 || two.length <= CAPTION_CHARS) return two;
    return `${names[0]} +${names.length - 1}`;
  }

  function onKnob(k, fromMidi) {
    if (!fromMidi) host.controlMoved?.(k.i);
    // An open figure follows its control (explain.js).
    host.controlTurned?.(k.i);
    if (k.spec.kind === "named") {
      state.c[k.i] = k.value;
      // How it works opens on the control last touched.
      if (howAt !== state.panel[k.i]) {
        howAt = state.panel[k.i];
        renderHow();
      }
      const w = state.wire && state.wire[k.i];
      if (turns(w)) {
        push();
        if (Math.abs(k.value) > 0.2) stepDone("turn");
      }
    } else if (k.spec.kind === "blend") {
      state.blend = k.value;
      const live = host.live();
      if (live && state.offer) live.bMix(state.blend);
    } else if (k.spec.kind === "wander") {
      state.wander = k.value;
      renderWander();
    }
  }

  // The module a search control would be given, turned `up` or down, or null
  // when there is none to give (see GRAFTS): once per control per patch, and
  // not while another graft is on its way.
  function graftFor(w, up) {
    const graft = GRAFTS[w.name];
    if (!graft || (!up && w.name === "Space") || state.grafted.has(w.name) || inFlight("perform_graft")) return null;
    return graft;
  }

  // Back to the centre, with nothing asked: a control that has nothing to turn
  // does not stay where a hand left it.
  function springBack(k) {
    k.asking = false;
    k.wrap.classList.remove("asking");
    k.value = 0;
    state.c[k.i] = 0;
    paintKnob(k);
  }

  // ---------- re-centring ----------
  // The controls return to zero whenever the sound they were turned on is
  // folded into the centre: a new measurement, a Keep, a Take, a glide. The
  // sound does not move, but the dial used to jump to 12 o'clock under the
  // player's eyes ("I set Bright to 70% and now it says 0"), and a MIDI pot on
  // it went dead until swept back through the middle. Now the pointer glides
  // home over `--d-state` while a ghost tick marks where it was and fades
  // (none of it under reduced motion), and a pot bound to it keeps working
  // from where it is (midi.js re-anchors instead of letting go).
  // A motion token's length in ms, read when the motion starts (main.js's
  // `motionMs`): 0 under reduced motion, which the glides also skip.
  const motionMs = (name) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0;
  const stillMotion = () => !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  function recentre(k) {
    if (k.tween) cancelAnimationFrame(k.tween);
    k.tween = null;
    const from = k.drawn != null ? k.drawn : k.value;
    k.value = 0;
    k.drawn = null;
    host.controlMoved?.(k.i, { recentre: true, to: 0.5 });
    if (Math.abs(from) < 0.005 || stillMotion()) return paintKnob(k);
    const ghost = k.svg.querySelector(".pf-k-ghost");
    if (ghost) {
      ghost.setAttribute("d", radial(angleOf(from, true), 38, 49));
      ghost.classList.remove("fade");
      void ghost.getBoundingClientRect();
      ghost.classList.add("fade");
    }
    const t0 = performance.now();
    const ms = motionMs("--d-state");
    const step = () => {
      const u = ms > 0 ? clamp((performance.now() - t0) / ms, 0, 1) : 1;
      k.drawn = u >= 1 ? null : from * (1 - u * u * (3 - 2 * u));
      paintKnob(k);
      k.tween = u < 1 ? requestAnimationFrame(step) : null;
    };
    k.drawn = from;
    paintKnob(k);
    k.tween = requestAnimationFrame(step);
  }
  function recentreAll() {
    knobs.forEach((k) => {
      if (k.spec.kind === "named") recentre(k);
    });
  }

  function onRelease(k) {
    if (k.dead) return;
    if (k.spec.kind === "wander") return wanderLetGo();
    if (k.spec.kind !== "named") return;
    const w = state.wire && state.wire[k.i];
    const was = k.value;
    if (!turns(w)) {
      // Nothing under this control to leave turned. A search control always
      // springs back: short of ASK_AT that is the whole answer, and past it
      // the gesture asks. A control still being listened to (no wiring yet,
      // or carried over by a Take with no knobs left) does nothing at all,
      // and never grafts or grows an offer: "not measured yet" is not
      // "can't".
      springBack(k);
    }
    if (w && w.search && Math.abs(was) > ASK_AT) {
      // Honest about what happens: this patch cannot make the sound the label
      // names by turning knobs. If one change would give it something to turn
      // (see GRAFTS), that change goes in as one undo step on the bench, and
      // the control is measured again and set where the hand left it.
      // Otherwise the gesture becomes a request for a patch that can: the
      // control springs back and the offer arrives in B.
      const up = was > 0;
      const graft = graftFor(w, up);
      if (graft) {
        state.grafted.add(w.name);
        state.intent = { i: k.i, dir: up ? 1 : -1, at: performance.now() };
        host.note(`${w.name}: giving it a ${graft} to turn…`, { replace: `pf-graft:${w.name}` });
        // Named by its palette index, as every control is to the engine.
        request("perform_graft", { tree: state.cur.json, overrides: overrides(), k: indexAt(k.i) });
      } else {
        const aim = aimAt(k.i, up ? 1 : -1);
        host.note(`${w.name}: no knobs here make it ${up ? w.high : w.low}, so it’s growing ${aim ? `a ${aim.word}` : "an"} offer instead.`, { replace: "pf-offer", urgent: true });
        requestOffer(`${w.name.toLowerCase()} ${up ? "up" : "down"}`, aim);
      }
    }
    logImplicit("perform_turn", { control: k.spec.name, value: +was.toFixed(3) });
  }

  // Long-press: the control explains itself by ear. A two-second sweep
  // through both ends and back, on a held note if there is none already.
  function hearIt(k) {
    const w = state.wire && state.wire[k.i];
    if (!turns(w)) {
      host.note(
        w && w.search
          ? `${w.name} isn’t in this patch’s knobs. Turn it to ask for a variant.`
          : state.measuring || state.revalidating
            ? `${k.spec.name}: still listening to this sound. Try again in a moment.`
            : `${k.spec.name} hasn’t been measured on this sound yet.`,
        { urgent: true },
      );
      return;
    }
    const start = k.value;
    const playing = host.heldCount() > 0;
    if (!playing) host.noteOn(48, 0.8);
    const t0 = performance.now();
    const D = 2400;
    const path = (u) => (u < 0.25 ? -4 * u : u < 0.75 ? -1 + 4 * (u - 0.25) : 1 - 4 * (u - 0.75)) ;
    const tick = () => {
      // The panel was rebuilt under the sweep: stop it, and its note.
      if (k.dead) {
        if (!playing) host.noteOff(48);
        return;
      }
      const u = (performance.now() - t0) / D;
      if (u >= 1) {
        k.value = start;
        state.c[k.i] = start;
        paintKnob(k);
        push();
        if (!playing) host.noteOff(48);
        return;
      }
      k.value = clamp(start + path(u), ...spanOf(k));
      state.c[k.i] = k.value;
      paintKnob(k);
      push();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // ---------- worker plumbing ----------
  function request(kind, msg) {
    const req = ++state.req;
    state.pending.set(req, { kind, gen: state.gen, at: performance.now() });
    // A measurement carries the set it asked for (no `controls` is the six),
    // so its reply is laid on the panel it belongs to (`forPanel`).
    if (kind === "perform_wire") state.pending.get(req).set = setOf(msg.controls || PANEL_DEFAULT);
    host.send({ ...msg, type: kind, req });
    return req;
  }

  // Is a request of this kind already out for the current patch?
  function inFlight(kind) {
    for (const p of state.pending.values()) if (p.kind === kind && p.gen === state.gen) return true;
    return false;
  }

  // Measured wirings, by patch. A measurement is ~one render per knob plus
  // the verification renders — seconds, on the same worker that fills the
  // pool — and a player flicking between presets asks for the same few again
  // and again, so every first measurement (no knob overrides yet) is kept,
  // tagged with how much the model had seen when it was taken (a refit moves
  // the standardizer the wiring is expressed in) and with the render
  // namespace it was measured in (`cache_namespace`: the stimulus, the
  // featurizer's RENDER_EPOCH and the quiver version), because a wiring holds
  // φ (`z`) and a new DSP or featurizer measures the same patch differently.
  //
  // Stale-while-revalidate: a patch measured before is playable *at once*
  // from its last measurement, whatever the tag, and re-measured in the
  // background when the tag is stale. The directions a control turns its
  // knobs survive a refit — the standardizer rescales each coordinate by a
  // positive factor — so the old wiring is right about what the knobs do,
  // and the fresh one only sharpens how far. The cache persists across
  // reloads, so a booth machine that has visited its demo set once never
  // says "measuring…" on it again.
  const WIRE_CACHE_MAX = 48;
  const WIRE_STORE = "auracle-perform-wirings";
  const tasteRev = () => (host.tasteRev ? host.tasteRev() : 0);
  // The tag a wiring is kept under and compared with. One written before the
  // namespace was part of it is a bare number, which never matches: it is
  // played at once and re-measured, like any stale one.
  const wireRev = () => `${tasteRev()}@${(host.renderNs && host.renderNs()) || ""}`;
  // Keyed by what the patch *is*, not by the bytes it arrived as. A tree's
  // JSON carries its node uids, and the pool mints those per session
  // (`Uid::mint`, one process-wide counter), so the same preset loaded after
  // a reload — or re-admitted after an eviction — came back as different
  // bytes and missed a measurement the cache already held: a booth's demo
  // set said "measuring…" again after every visitor reset. The wiring itself
  // is uid-free (its knobs are trace addresses), and the engine already
  // treats two trees that differ only in uids as the same patch.
  //
  // …and by the controls measured. A measurement wires the set it was asked
  // for (`controls`, in palette order, `setOf`), and a control's wiring
  // depends on the set: of two that are one gesture on a patch, the later is
  // the search control (`separate`). So a wiring of one set is never played
  // for another: the key is the patch's, then `#controls=` and the set, and
  // for the six it is the patch's alone, as it was before the palette (the
  // shipped file and every cache already hold the six under that key).
  //
  // A sound with an AUDIO IN is measured with the session's audition clip
  // (Plan-007), so under another clip the same patch measures differently:
  // its key carries the clip, on the patch's part, before the set
  // (`wireKeyOf`). Only for a sound that listens, so a new clip leaves every
  // other wiring where it was.
  function wireKey(json, set) {
    return wireKeyOf(json, set, host.clipTag ? host.clipTag() : null);
  }
  const wireCache = (() => {
    try {
      const raw = localStorage.getItem(WIRE_STORE);
      // Entries stored under the old byte keys are re-keyed on the way in.
      return new Map((raw ? JSON.parse(raw) : []).map(([k, v]) => [wireKey(k), v]));
    } catch {
      return new Map();
    }
  })();
  // Every preset, measured ahead of time and shipped with the app
  // (`perform-wirings.json`, written natively by `make perform-wirings`,
  // keyed here by the same `wireKey`). A preset is what a newcomer meets
  // first — the warm start's cards, the preset bank, booth mode's demo set —
  // and its first measurement cost eleven-odd seconds of "listening…" on
  // every control. A shipped wiring is played at once and always re-measured
  // in the background: it was taken under a standardizer fitted natively,
  // not this session's, so it is right about which knobs a control turns and
  // only roughly right about how far. The player's own cache is asked first.
  const SHIPPED_WAIT_MS = 3000;
  const shipped = new Map(); // wireKey -> {data, rev, shipped: true, tree}
  const shippedByName = new Map(); // preset name -> its tree text
  let shippedLoaded = false;
  const shippedReady = (async () => {
    try {
      // The app's own version stamp (`?v=`) rides on this module's URL, so
      // the file is refetched exactly when a build changed it.
      const url = new URL(`./perform-wirings.json${new URL(import.meta.url).search}`, import.meta.url);
      const load = (async () => {
        const r = await fetch(url);
        const f = r.ok ? await r.json() : null;
        for (const p of (f && f.presets) || []) {
          if (!p || typeof p.tree !== "string" || !p.data) continue;
          shipped.set(wireKey(p.tree), { data: p.data, rev: f.rev ?? 0, shipped: true });
          shippedByName.set(p.name, p.tree);
        }
      })();
      load.catch(() => {}); // failing after the wait gave up on it: nothing to say
      // A fetch that stalls (a flaky connection, a proxy holding it) must not
      // hold a patch on "listening…": past SHIPPED_WAIT_MS nothing waits for
      // it, and the patch in the hands is measured as any other is. The file
      // still fills in if it lands later, for the presets opened after.
      await Promise.race([load, new Promise((ok) => setTimeout(ok, SHIPPED_WAIT_MS))]);
    } catch {
      // No file (an old bundle, a blocked fetch): presets are measured like
      // any other patch.
    }
    shippedLoaded = true;
  })();
  // A measured wiring for this key: the player's cache first, then the file.
  const knownWiring = (key) => wireCache.get(key) || shipped.get(key) || null;
  // The first wiring of the patch under the hands is here: a timing mark the
  // film recorder and the budget specs read (`window.__aur.marks`).
  function markWired(how) {
    try {
      performance.mark("auracle:perform-wired", { detail: { how, name: host.label() } });
    } catch {
      /* marks are evidence, never load-bearing */
    }
  }
  // Written 1.5 s after the last change, and at once when the page is hidden
  // or left (`pagehide`, `visibilitychange`), as the session is
  // (`saveOnLeave` in main.js). Leaving cancels the timer: a reload, a closed
  // tab or a booth's visitor reset in the 1.5 s after a measurement landed
  // threw it away, and the patch said "listening…" for a whole measurement
  // again after the reload (6.6 s on a quiet machine, 8.7-10 s on a CI
  // runner, where perform_instant.spec.js reloads 1-1.5 s after one).
  let wireSaveTimer = null;
  function writeWirings() {
    clearTimeout(wireSaveTimer);
    wireSaveTimer = null;
    try {
      localStorage.setItem(WIRE_STORE, JSON.stringify([...wireCache]));
    } catch {
      // Quota or a private window: the cache is a convenience, never
      // load-bearing. Halve it and carry on in memory.
      const keep = [...wireCache].slice(-Math.floor(WIRE_CACHE_MAX / 2));
      wireCache.clear();
      keep.forEach(([k, v]) => wireCache.set(k, v));
    }
  }
  function rememberWiring(json, data, rev, set) {
    const key = wireKey(json, set);
    wireCache.delete(key);
    while (wireCache.size >= WIRE_CACHE_MAX) wireCache.delete(wireCache.keys().next().value);
    wireCache.set(key, { data: structuredClone(data), rev });
    clearTimeout(wireSaveTimer);
    wireSaveTimer = setTimeout(writeWirings, 1500);
  }
  // Only a write still waiting: another tab holds its own copy of the cache,
  // and hiding this one must not overwrite that tab's with nothing new.
  const flushWirings = () => {
    if (wireSaveTimer !== null) writeWirings();
  };
  window.addEventListener("pagehide", flushWirings);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushWirings();
  });

  function wire() {
    if (!state.cur) return;
    const first = state.cur.knobs.size === 0;
    const set = setOf(state.panel);
    const key = first ? wireKey(state.cur.json, set) : null;
    // The panel's own set measured before, or failing that, what any other
    // set measured of this patch, control by control (`borrowWiring`): the
    // controls they share play at once, and the rest listen until the
    // panel's set is measured.
    const hit = first ? knownWiring(key) || borrowWiring(state.cur.json, set) : null;
    if (first && !hit && !shippedLoaded) {
      // The shipped file is a local fetch of a few milliseconds, begun when
      // PERFORM was built; a patch asked about before it lands waits for it
      // (up to SHIPPED_WAIT_MS) rather than starting eleven seconds of
      // renders it may not need.
      const gen = state.gen;
      state.measuring = true;
      renderStatus();
      knobs.forEach(paintKnob);
      shippedReady.then(() => {
        if (state.gen !== gen || state.wire || !state.measuring || inFlight("perform_wire")) return;
        state.measuring = false;
        wire();
      });
      return;
    }
    if (hit) {
      // A hit is a use: it moves to the young end, so the patches played
      // most — a booth's demo set, round every few minutes — are the last
      // ones the cache lets go.
      if (!hit.shipped && !hit.borrowed) {
        wireCache.delete(key);
        wireCache.set(key, hit);
      }
      applyWired(structuredClone(hit.data));
      markWired(hit.shipped ? "shipped" : hit.borrowed ? "borrowed" : "cached");
      knobs.forEach(paintKnob);
      renderHood();
      if (!hit.shipped && !hit.borrowed && hit.rev === wireRev()) return;
      // Playable now; the fresh measurement lands when it lands.
      if (!heldForOpen("revalidate")) revalidate(!!hit.borrowed);
      return;
    }
    if (heldForOpen("measure")) {
      renderStatus();
      knobs.forEach(paintKnob);
      return;
    }
    state.measuring = true;
    renderStatus();
    knobs.forEach(paintKnob);
    // A first measurement is of the tree as it stands, because it is cached
    // under that tree's text; knobs turned in PATCH since are laid over it
    // when it lands (`applyWired`).
    const req = request("perform_wire", { tree: state.cur.json, overrides: first ? [] : overrides(), ...asked(set) });
    if (first) state.pending.get(req).cacheAs = { json: state.cur.json, rev: wireRev(), set };
  }

  // What a `perform_wire` request carries to name its set: nothing for the
  // six (the engine's default, so the request is the one it always was),
  // otherwise `controls`, the set in palette order.
  const asked = (set) => (setKey(set) ? { controls: setOf(set) } : {});

  // A wiring for the panel's set from measurements of other sets of the same
  // patch: each control the panel holds, from a kept measurement that wired
  // it (the player's cache, then the shipped file). Null when none did. Each
  // control's wiring there depends on what was wired before it, so this is
  // played as a stale one is, and the panel's own set is measured behind it.
  function borrowWiring(json, set) {
    const base = wireKey(json);
    const want = new Set(set);
    const found = new Map();
    let data = null;
    const look = (key, v) => {
      if (!v || !v.data || (key !== base && !key.startsWith(`${base}#controls=`))) return;
      for (const w of v.data.wiring || []) {
        const k = indexOf(w);
        if (want.has(k) && !found.has(k)) found.set(k, w);
      }
      if (!data) data = v.data;
    };
    for (const [key, v] of wireCache) look(key, v);
    look(base, shipped.get(base));
    if (!found.size || !data) return null;
    return { data: { ...data, wiring: [...found.values()] }, rev: "", borrowed: true };
  }

  // `foreground`: the panel holds controls nobody has measured on this patch,
  // and the player is waiting on them, so this is not background work.
  function revalidate(foreground = false) {
    state.revalidating = true;
    renderStatus();
    // Background (`bg`): the patch is already playable from its last
    // measurement, so this waits behind anything the player asks for.
    const set = setOf(state.panel);
    const req = request("perform_wire", { tree: state.cur.json, overrides: [], bg: !foreground, ...asked(set) });
    state.pending.get(req).cacheAs = { json: state.cur.json, rev: wireRev(), quiet: true, set };
  }

  // The sound has moved a long way from where its wiring was measured (a
  // glide past TRUST, or a Keep of controls turned far), but the wiring in
  // hand still works: re-measure around where the knobs are now, in the
  // background, and keep playing on the old wiring meanwhile ("re-checking").
  // This used to be a full `wire()` in the engine's `soon` lane, which held
  // the floor for 10-16 s: a pressed Offer with no spare waited behind a
  // measurement nobody had asked for, and in roam the engine re-measured
  // after nearly every glide. Not cached: it measures the tree with the
  // knobs where they are, not the tree's text as it stands.
  function recheck() {
    if (!state.cur || !state.wire) return wire();
    if (state.revalidating && inFlight("perform_wire")) return renderStatus();
    state.revalidating = true;
    renderStatus();
    const set = setOf(state.panel);
    const req = request("perform_wire", { tree: state.cur.json, overrides: overrides(), bg: true, ...asked(set) });
    state.pending.get(req).cacheAs = { json: state.cur.json, rev: wireRev(), quiet: true, nocache: true, set };
  }

  // A patch on its way out is not measured. A measurement is thirty-odd
  // renders on the one worker (11-16 s measured), made one at a time with the
  // player's requests answered between them (`measure` in worker.js), but a
  // started one holds the worker's floor until it is done, and the next
  // measurement waits behind it:
  // PERFORM opened in the second between a preset click and its bench reply
  // used to start measuring the patch being left, and the patch the player
  // had picked queued behind it — half a minute of "measuring…" for a sound
  // nobody would play. While an open is on its way (`host.opening`), the
  // measurement is held, and the interval below lets it go when the open
  // lands or fails. The new patch arrives through `patchChanged`, which
  // drops the hold and measures that one instead.
  function heldForOpen(what) {
    if (!host.opening || !host.opening()) return false;
    state.heldWire = what;
    return true;
  }
  function releaseHeld() {
    const what = state.heldWire;
    state.heldWire = null;
    if (!state.cur || !state.visible) return;
    if (what === "measure" && !state.wire && !state.measuring) wire();
    else if (what === "revalidate" && state.wire && !state.revalidating) revalidate();
  }

  // ---------- offers are duels ----------
  // An offer is the model's proposal played against the sound in your hands:
  // the same question an EVOLVE duel asks, asked without stopping the music.
  // Once B has been *heard* — Peek held, or Blend past half, for a second
  // while notes sound — the player's answer is recorded as a duel tagged
  // `perform_offer`: Take is "B over what I had", asking for another offer is
  // "what I had over B". Both directions, or the model would only ever hear
  // itself agreed with. An offer taken or passed unheard teaches nothing.
  const HEARD_MS = 1000;
  const TAKE_SETTLE_MS = 8000;
  setInterval(() => {
    watchAnswer();
    if (state.heldWire && !host.opening?.()) releaseHeld();
    // An open began or ended somewhere else in the app: say so here.
    const incoming = host.opening?.() ? host.openingName?.() || null : null;
    if (state.visible && incoming !== (state.incoming || null)) renderStatus();
    if (state.deferredWire && performance.now() - state.lastTouch >= 1500) {
      const d = state.deferredWire;
      state.deferredWire = null;
      applyRechecked(d);
      knobs.forEach(paintKnob);
      renderHood();
    }
    // Wander's line counts down ("drift · next in 9 s", "paused 3 s").
    if (state.visible && (state.hold || wanderZone(state.wander) !== "still")) renderWander();
    const o = state.offer;
    if (!o || !state.visible) return;
    if ((state.peeking || state.blend >= 0.5) && host.heldCount() > 0) o.heardMs = (o.heardMs || 0) + 250;
  }, 250);

  // An answer waits out a short window before it is sent, counted from when
  // its toast is on screen (the lane can hold a toast back behind another):
  // taking something to hear it in place is not always a verdict, and neither
  // is a Next pressed to move on. A Take's toast offers "don't count it"; a
  // pass's offers UNDO, which brings B back as well. One answer waits at a
  // time, which keeps the log in order: a new one commits the one before, as
  // a second EVOLVE pick does.
  const PASS_WINDOW_MS = 7000;
  function holdAnswer(took) {
    const o = state.offer;
    if (state.quiet || !o || !state.cur || (o.heardMs || 0) < HEARD_MS) return null;
    commitAnswer();
    const pick = { tree: state.cur.json, overrides: overrides(), offer: o.json, took };
    const pt = { pick, sent: false, dropped: false, at: performance.now(), shownAt: 0, timer: null, toast: null, windowMs: took ? TAKE_SETTLE_MS : PASS_WINDOW_MS };
    return pt;
  }
  function waitAnswer(pt) {
    state.answerWait = pt;
    watchAnswer();
  }
  function answerOffer(took) {
    const pt = holdAnswer(took);
    if (!pt) return;
    pt.toast = host.note("Took B. That counts as a pick over what you had.", {
      undo: () => {
        if (pt.sent) {
          host.note("Already counted: that Take’s window had closed.", { urgent: true });
          return;
        }
        pt.dropped = true;
        clearTimeout(pt.timer);
        if (state.answerWait === pt) state.answerWait = null;
      },
      undoLabel: "don’t count it",
      replace: "pf-offer",
    });
    waitAnswer(pt);
  }

  // The answer waiting out its window (see holdAnswer): its clock starts when
  // its toast reaches the screen, and it is counted when the window ends or
  // when the toast leaves the screen early (a later word on the offer took
  // its place, so its undo is gone). A toast that never gets on screen at all
  // is counted after a generous wait rather than held for ever.
  function watchAnswer() {
    const pt = state.answerWait;
    if (!pt || pt.sent || pt.dropped) return;
    const onScreen = !!(pt.toast && pt.toast.isConnected);
    if (!pt.shownAt) {
      if (onScreen) {
        pt.shownAt = performance.now();
        pt.timer = setTimeout(commitAnswer, pt.windowMs);
      } else if (performance.now() - pt.at > 30_000) commitAnswer();
      return;
    }
    if (!onScreen) commitAnswer();
  }
  function commitAnswer() {
    const pt = state.answerWait;
    if (!pt) return;
    state.answerWait = null;
    clearTimeout(pt.timer);
    if (pt.sent || pt.dropped) return;
    pt.sent = true;
    sendAnswer(pt.pick);
  }

  function sendAnswer(pick) {
    request("perform_record", pick);
  }

  // ---------- a spare offer, grown ahead ----------
  // Offer used to cost ~10 s of renders after the press — the one gesture no
  // other instrument has, made to wait. Once a patch has been steady for a few
  // seconds and nothing else is asking the engine for anything, one offer is
  // grown in the background and kept; Offer hands it over at once. It belongs
  // to the sound it grew from: a new patch discards it (the generation
  // changes), and so do hands that have carried the knobs outside the trust
  // region it was grown in, since it would no longer be a variant of *this*.
  const SPARE_STEADY_MS = 6000;
  // …and playable for a while too. A patch is not steady while it is being
  // measured, whatever the clock says since it changed: counting from the
  // change alone, every measurement longer than six seconds ended in a spare
  // grown the moment the controls came alive — ten-odd seconds on the one
  // worker, in front of whatever the player did next. A preset clicked right
  // after opening a patch waited 15 s behind a spare for the patch it left.
  const SPARE_PLAYABLE_MS = 3000;
  function spareFresh(sp) {
    for (const [a, v] of state.cur.knobs) {
      const at = sp.at.get(a);
      if (at == null || Math.abs(liveValue(a) - at) > TRUST) return false;
    }
    return true;
  }
  // …and while B holds an offer too. The spare belongs to the sound in your
  // hands, not to B, and the moment a player is exploring fastest — offer,
  // pass, offer — is the moment it is needed: the second Offer, grown on
  // demand, took 10.9 s where the first took 0.01 s. It still waits for hands
  // off (two seconds), and for the engine to have nothing else asked of it.
  function knobsNow() {
    return new Map([...state.cur.knobs.keys()].map((a) => [a, liveValue(a)]));
  }
  function growSpare() {
    const now = performance.now();
    if (!state.visible || !state.cur || !state.wire || state.spare) return;
    if (state.pending.size > 0 || state.glide) return;
    // No spare for a patch on its way out, either (see `heldForOpen`).
    if (host.opening?.()) return;
    if (now - (state.changedAt || 0) < SPARE_STEADY_MS || now - state.playableAt < SPARE_PLAYABLE_MS) return;
    if (now - state.lastTouch < 2000) return;
    // Nobody has asked for it yet, so it waits behind anything that is asked
    // for (`bg`), and is promoted the moment Offer claims it.
    const req = request("perform_offer", { tree: state.cur.json, overrides: overrides(), locks: host.locks(), steps: 20, bg: true });
    state.pending.get(req).spare = { at: knobsNow() };
  }

  // `at`: the knobs the offer grew from (for handing it back as a spare, see
  // `restoreOffer`); `again`: an offer brought back by an undo, not news.
  function presentOffer(offer, at, again) {
    state.offer = {
      json: JSON.stringify(offer.tree),
      makeup: offer.makeup,
      taste: !!offer.taste,
      changes: host.describeDiff && offer.diff ? host.describeDiff(offer.diff) : "",
      src: offer,
      at: at || knobsNow(),
      why: state.offerWhy || "",
      aim: offer.aim ? { ...offer.aim, moved: offer.moved } : null,
    };
    const live = host.live();
    if (live) {
      live.bPatch(state.offer.json, state.offer.makeup);
      live.bMix(state.visible ? state.blend : 0);
    }
    renderOffer();
    // An undone pass brings back an offer already grown: it is not grown
    // again, so it does not grow again on screen.
    if (again) moment("grown");
    else growOffer();
    knobs.forEach(paintKnob);
    if (!again) logImplicit("perform_offer", { why: state.offerWhy || "" });
  }

  // ---------- the offer's motion ----------
  // Each moment shows what the engine did, and no more (ADR-012):
  // - grown: an offer is a short walk from the sound under your hands
  //   (`Engine::offer`, or `Engine::offer_toward` for a search control's,
  //   asked by `perform_offer` with this sound's tree and knobs), so B grows
  //   out of the sound's name into its place;
  // - taken: B fills with the sound's green and goes into the name: the
  //   bench takes its tree (`commitTree`, `edit_set_tree`), heard or not;
  //   only a heard one is also recorded as a pick for it (`perform_record`,
  //   `record_tree_duel`);
  // - folded: passed, B folds back into the name it grew from: it is emptied
  //   (`bClear`), nothing joins the pool, and a heard one is recorded as a
  //   pick for the sound you kept (`perform_record`).
  // Each moment is also B's `data-moment`, so reduced motion (every
  // duration 0) shows each state without the movement, and nothing waits on
  // a motion ending: B's own state changes at once, and a copy of it moves.
  const easeOf = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "ease-out";
  // The transform that puts box `to` where box `at` is (origin top left).
  const onto = (at, to) =>
    `translate(${(at.left - to.left).toFixed(1)}px, ${(at.top - to.top).toFixed(1)}px) scale(${(at.width / to.width).toFixed(3)}, ${(at.height / to.height).toFixed(3)})`;
  let momentTimer = 0;
  function moment(name) {
    offerCard.dataset.moment = name;
    clearTimeout(momentTimer);
    // A taken B shows its fill for a moment, then is the empty B it now is.
    if (name === "taken") momentTimer = setTimeout(() => offerCard.dataset.moment === "taken" && (offerCard.dataset.moment = ""), 1200);
  }
  function growOffer() {
    moment("grown");
    offerCard.getAnimations().forEach((a) => a.cancel());
    const ms = motionMs("--d-move");
    if (!ms || !state.visible) return;
    const from = nameEl.getBoundingClientRect();
    const to = offerCard.getBoundingClientRect();
    if (!from.width || !to.width) return;
    // While it grows it passes through the pads below it, and a press on
    // PEEK or TAKE in that moment must reach the pad, not B.
    offerCard.classList.add("moving");
    const grown = offerCard.animate([{ transform: onto(from, to), opacity: 0.25 }, { transform: "none", opacity: 1 }], { duration: ms, easing: easeOf("--e-settle") });
    const still = () => offerCard.classList.remove("moving");
    grown.onfinish = still;
    grown.oncancel = still;
    setTimeout(still, ms + 100);
  }
  // A copy of B as it was, to move while B itself is already what it is now:
  // taken (`snapshot`) and put on the page (`ghost`) apart, so a Take's copy
  // can wait for the bench's word.
  function ghost(name) {
    const gh = snapshot(name);
    if (gh) showGhost(gh);
    return gh;
  }
  function showGhost(gh) {
    document.body.append(gh.g);
    gh.gone = () => gh.g.remove();
    setTimeout(gh.gone, gh.ms * 3 + 200);
  }
  function snapshot(name) {
    const ms = motionMs("--d-move");
    const r = offerCard.getBoundingClientRect();
    if (!ms || !state.visible || !r.width) return null;
    const g = offerCard.cloneNode(true);
    // Its own classes, never B's, inside as well: it is a picture of B, not
    // B, and nothing that reads B may find it.
    g.className = "pf-offer-ghost";
    for (const e of g.querySelectorAll("[class]")) e.className = e.className.replace(/\bpf-offer-/g, "pf-ghost-");
    g.dataset.moment = name;
    g.setAttribute("aria-hidden", "true");
    g.style.left = `${r.left}px`;
    g.style.top = `${r.top}px`;
    g.style.width = `${r.width}px`;
    g.style.height = `${r.height}px`;
    return { g, r, ms, gone: () => g.remove() };
  }
  // Played when the bench has taken the offer's tree (`patchChanged` sees
  // the taken tree arrive, after the engine adopted it), with the copy of B
  // taken when TAKE was pressed. A Take the bench refuses never arrives, so
  // it never fills.
  function takeMotion(gh) {
    moment("taken");
    // Out of sight (the bench took it after the player left PERFORM), there
    // is nothing to move.
    if (!gh || !state.visible) return;
    showGhost(gh);
    const fill = el("span", "pf-ghost-fill");
    gh.g.append(fill);
    // The green rises from the base, then the whole of B goes into the name.
    fill.animate([{ transform: "scaleY(0)" }, { transform: "scaleY(1)" }], { duration: gh.ms, easing: easeOf("--e-settle"), fill: "forwards" });
    const into = gh.g.animate(
      [
        { transform: "none", opacity: 1, offset: 0 },
        { transform: "none", opacity: 1, offset: 0.5 },
        { transform: onto(nameEl.getBoundingClientRect(), gh.r), opacity: 0 },
      ],
      { duration: gh.ms * 2, easing: easeOf("--e-swap"), fill: "forwards" },
    );
    into.onfinish = gh.gone;
  }
  function foldMotion() {
    moment("folded");
    const gh = ghost("folded");
    if (!gh) return;
    const back = gh.g.animate(
      [{ transform: "none", opacity: 1 }, { transform: onto(nameEl.getBoundingClientRect(), gh.r), opacity: 0 }],
      { duration: gh.ms, easing: easeOf("--e-swap"), fill: "forwards" },
    );
    back.onfinish = gh.gone;
  }

  function requestDrift() {
    if (!state.cur || state.glide || inFlight("perform_drift")) return;
    const pace = wanderPace(state.wander);
    state.lastMove = performance.now();
    state.moveAt = null;
    request("perform_drift", {
      tree: state.cur.json,
      overrides: overrides(),
      locks: host.locks(),
      steps: pace.steps,
      sigma: pace.sigma,
    });
    renderWander();
  }

  // Asking for another offer is passing on the one in B, and the offer passed
  // on leaves B (it fades out). It used to stay there, playable and takeable,
  // while the next one grew: a player could Take the very sound they had just
  // passed on, and a Take landing just after the next offer arrived was
  // counted as an unheard answer to *that* one.
  //
  // A pass is a verdict only once B has been heard, and it is said either way:
  // a heard pass counts as a pick for what you had, after a window with UNDO
  // (B comes back, and nothing is recorded); an unheard one says it was not
  // counted, with UNDO too. B used to vanish unheard with no word and no way
  // back, and a heard pass was recorded at once with no undo, while a Take
  // had eight seconds of "don't count it".
  function passOffer() {
    const o = state.offer;
    const gen = state.gen;
    const pt = holdAnswer(false);
    if (o) foldMotion();
    state.offer = null;
    const live = host.live();
    if (live) live.bClear();
    // B is empty: Blend comes home, as it does after a Take. Left past half,
    // it read "67% offer" over an empty B, and the next offer arrived at that
    // level over what the player was playing, without being asked for.
    blendHome();
    renderOffer();
    knobs.forEach(paintKnob);
    if (!o || state.quiet) return;
    if (!pt) {
      host.note("Skipped B. Not counted, because you hadn’t heard it.", {
        undo: () => restoreOffer(o, gen),
        undoLabel: "undo",
        replace: "pf-offer",
      });
      return;
    }
    pt.toast = host.note("Passed on B. That counts as a pick for what you had.", {
      undo: () => {
        if (pt.sent) {
          host.note("Already counted: that pass’s window had closed.", { urgent: true });
          return;
        }
        pt.dropped = true;
        clearTimeout(pt.timer);
        if (state.answerWait === pt) state.answerWait = null;
        restoreOffer(o, gen);
      },
      undoLabel: "undo",
      replace: "pf-offer",
    });
    waitAnswer(pt);
  }

  // An undone pass: B comes back as it was, heard as far as it had been. The
  // offer that took its place goes back to being the spare, and one still
  // growing stops being claimed (it lands as the spare), so the next Next is
  // as quick as this one was. Across a patch change B cannot come back: it
  // was a variant of the sound before.
  function restoreOffer(o, gen) {
    if (gen !== state.gen || !state.cur) {
      host.note("Not counted: B was a variant of the sound before, so it can’t come back.", { replace: "pf-offer" });
      return;
    }
    // What B holds now, and any offer still growing, wait as the Offer pad's
    // spare — except an aimed one: it answered a turn of a search control,
    // and handed out later by the pad it would be a directed walk presented
    // as an undirected one. A growing aimed offer is withdrawn instead.
    const cur = state.offer;
    if (cur && cur.src && !cur.aim && !state.spare) state.spare = { offer: cur.src, at: cur.at };
    for (const [req, q] of state.pending) {
      if (q.kind !== "perform_offer" || q.gen !== state.gen || q.superseded) continue;
      q.again = false;
      q.promote = false;
      if (q.aim) {
        q.superseded = true;
        host.send({ type: "retire", reqs: [req] });
      } else if (!q.spare) q.spare = { at: knobsNow() };
    }
    state.offerWhy = o.why;
    presentOffer(o.src, o.at, true);
    state.offer.heardMs = o.heardMs || 0;
  }

  // Blend back to *home*: at once for the sound and the control's value (B
  // is empty or emptying), and over `--d-move` for the pointer, drawn
  // (`k.drawn`) as a re-centre is, so the eye sees where it went. A hand on
  // Blend stops the glide (bindDrag).
  //
  // A MIDI pot on Blend is let go, not re-anchored as a re-centred control's
  // is: the pot has to come back down through home before it drives Blend
  // again. Re-anchored at home, a pot left near the top spread the whole
  // blend over the little travel it had left (from 0.9, all of it in about
  // thirteen steps), so the next nudge poured the next offer in over what the
  // player had just chosen, which is what bringing Blend home is for.
  // Home over `--d-move`.
  function blendHome() {
    const k = knobs.find((x) => x.spec.kind === "blend");
    state.blend = 0;
    if (!k) return;
    if (k.tween) cancelAnimationFrame(k.tween);
    k.tween = null;
    const v0 = k.drawn != null ? k.drawn : k.value;
    k.value = 0;
    k.drawn = null;
    host.controlMoved?.(k.i);
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!v0 || still) return paintKnob(k);
    const t0 = performance.now();
    const ms = motionMs("--d-move");
    const step = () => {
      const u = ms > 0 ? clamp((performance.now() - t0) / ms, 0, 1) : 1;
      k.drawn = u >= 1 ? null : v0 * (1 - u * u * (3 - 2 * u));
      paintKnob(k);
      k.tween = u < 1 ? requestAnimationFrame(step) : null;
    };
    k.drawn = v0;
    paintKnob(k);
    k.tween = requestAnimationFrame(step);
  }

  function requestOffer(why, aim) {
    if (!state.cur) return;
    if (state.offer) passOffer();
    if (aim) return requestAimed(why, aim);
    const growingAt = [...state.pending.entries()].find(([, q]) => q.kind === "perform_offer" && q.gen === state.gen && !q.superseded);
    const growing = growingAt ? growingAt[1] : null;
    // A claim makes a background offer (a spare, Wander's) the player's: if it
    // is still waiting in the engine's background lane, it moves up.
    if (growing && why !== "wander" && why !== "attract") host.send({ type: "promote", kind: "perform_offer", req: growingAt[0] });
    if (growing && !growing.spare) {
      // One is already on its way: this press is a claim on it, and if it
      // comes back empty it is asked for once more. It used to be dropped
      // silently, so a press while an offer grew — Wander's, or attract's
      // just before a visitor took over — could end in nothing at all.
      growing.again = true;
      state.offerWhy = why || state.offerWhy;
      if (why !== "wander" && why !== "attract") stepDone("offer");
      renderOffer("growing an offer…");
      return;
    }
    state.lastMove = performance.now();
    state.moveAt = null;
    state.offerWhy = why || "";
    if (why !== "wander" && why !== "attract") stepDone("offer");
    // A spare grown ahead from this sound is handed over at once; one still
    // growing is claimed, and lands in B the moment it is done.
    if (state.spare && spareFresh(state.spare)) {
      const sp = state.spare;
      state.spare = null;
      presentOffer(sp.offer, sp.at);
      return;
    }
    state.spare = null;
    if (growing) {
      growing.promote = true;
      renderOffer("growing an offer…");
      return;
    }
    // Twenty steps is ~10 s of renders: long enough to find a real variant,
    // short enough to still be the same moment in a performance. Roam asks
    // for a longer walk and so a farther offer.
    const steps = wanderZone(state.wander) === "roam" ? 40 : 20;
    // Wander's and attract's offers are nobody's request (`bg`); a pressed
    // Offer is the player's, and goes ahead of background work.
    const bg = why === "wander" || why === "attract";
    const req = request("perform_offer", { tree: state.cur.json, overrides: overrides(), locks: host.locks(), steps, bg });
    state.pending.get(req).from = knobsNow();
    renderOffer("growing an offer…");
  }

  // A search control's offer, aimed the way it was turned (ADR-008). A spare,
  // or an undirected offer already growing, is not the answer to this: it
  // stays (or becomes) the spare for the next Offer, and this one is grown for
  // the gesture. The same turn again while it grows is a claim on it; another
  // control's aimed offer still growing is withdrawn.
  function requestAimed(why, aim) {
    state.lastMove = performance.now();
    state.offerWhy = why || "";
    stepDone("offer");
    const growing = `growing a ${aim.word} offer…`;
    for (const [req, q] of state.pending) {
      if (q.kind !== "perform_offer" || q.gen !== state.gen || q.superseded) continue;
      if (q.aim && q.aim.k === aim.k && q.aim.sign === aim.sign) {
        q.promote = true;
        renderOffer(growing);
        return;
      }
      if (q.aim) {
        q.superseded = true;
        host.send({ type: "retire", reqs: [req] });
      } else {
        q.again = false;
        q.promote = false;
        if (!q.spare) q.spare = { at: new Map([...state.cur.knobs.keys()].map((a) => [a, liveValue(a)])) };
      }
    }
    const steps = wanderZone(state.wander) === "roam" ? 40 : 20;
    const req = request("perform_offer", {
      tree: state.cur.json,
      overrides: overrides(),
      locks: host.locks(),
      steps,
      control: aim.k,
      sign: aim.sign,
    });
    state.pending.get(req).aim = aim;
    renderOffer(growing);
    // Progress past the first second: B counts while the walk runs, so a
    // turn that springs back is not followed by a strip that looks stuck.
    const t0 = performance.now();
    const tick = () => {
      const q = state.pending.get(req);
      if (!q || q.superseded || q.gen !== state.gen || state.offer || !state.visible) return;
      renderOffer(`${growing} ${Math.round((performance.now() - t0) / 1000)} s`);
      setTimeout(tick, 1000);
    };
    setTimeout(tick, 1000);
  }

  // What an aimed offer did the way it was asked, in the model's colour:
  // "grittier by 0.8σ", or plainly that it did not go that way. σ is the
  // spread of the patches in this session, the unit a control's reach is
  // measured in. Below AIM_SAID (half of `REACH_FLOOR`, the line a control's
  // half must clear to be said to turn that way) it did not move that way.
  const AIM_SAID = 0.075;
  function aimNote(aim) {
    const span = el("span", "pf-offer-aim");
    span.title = "How far this offer moved the way you turned, in σ: the spread of the sounds in this session. Offers from the Offer button and Wander are not aimed.";
    const by = aim.sign * Number(aim.moved);
    if (aim.moved == null || !Number.isFinite(by)) span.textContent = `aimed ${aim.word}, not measured`;
    else if (by >= AIM_SAID) span.textContent = `${aim.word} by ${by.toFixed(1)}σ`;
    else span.textContent = `not ${aim.word}: this walk found no way there. Turn it again to try another`;
    return span;
  }

  // A measurement arrived (or came out of the cache): wire the controls.
  function applyWired(data) {
    state.measuring = false;
    state.carried = false;
    // Where the sound is *now* becomes the new centre and the controls
    // return to zero there, so nothing audibly moves. Now, not when the
    // measurement was asked for: the player may have kept turning while
    // it rendered, and the old wiring's deltas are folded in before it is
    // replaced. A knob this patch had not been measured on yet takes the
    // value the measurement read.
    const had = state.cur.knobs;
    // …and a knob turned in PATCH since this tree arrived takes the hand's
    // value: the measurement may have been of the tree before the turn.
    const here = new Map(
      data.addrs.map((a, i) => [a, had.has(a) ? liveValue(a) : state.hand.has(a) ? state.hand.get(a) : data.values[i]]),
    );
    state.cur.knobs = here;
    state.wiredAt = new Map(here);
    state.playableAt = performance.now();
    state.c = state.c.map(() => 0);
    recentreAll();
    // Laid onto the panel by each wiring's palette index, never by its place
    // in the reply (`alignWiring`).
    state.wire = alignWiring(data.wiring);
    if (state.home && !state.home.knobs) state.home.knobs = new Map(state.cur.knobs);
    // Touch follows the player's choice if this patch can play it, and
    // otherwise falls back to the first control it can (Bright, Snap,
    // Motion…) rather than silently doing nothing.
    const playable = (i) => {
      const w = state.wire[i];
      const [lo, hi] = rangeOf(w);
      return turns(w) && lo < 0 && hi > 0;
    };
    if (state.touch.i >= 0 && !playable(state.touch.i)) {
      const first = state.wire.findIndex((_, i) => playable(i));
      if (first >= 0) state.touch.i = first;
    }
    sendTouch();
    renderStatus();
    renderSteps();
    // A graft was asked for by a turn: finish the gesture on the new patch.
    const it = state.intent;
    if (it && performance.now() - it.at < 30_000) {
      state.intent = null;
      const w = state.wire[it.i];
      const k = knobs[it.i];
      const [lo, hi] = rangeOf(w);
      if (k && turns(w) && (it.dir > 0 ? hi > 0 : lo < 0)) {
        k.value = 0.5 * it.dir;
        state.c[it.i] = k.value;
        push();
        paintKnob(k);
        host.note(`${w.name} now turns ${w.knobs.map(([a]) => knobWord(a, true)).join(" and ")}.`, { replace: `pf-graft:${w.name}` });
      } else if (w) {
        host.note(`${w.name}: the ${GRAFTS[w.name] || "graft"} didn’t reach it here, so it’s growing an offer instead.`, { replace: `pf-graft:${w.name}`, urgent: true });
        requestOffer(`${w.name.toLowerCase()} ${it.dir > 0 ? "up" : "down"}`, aimAt(it.i, it.dir));
      }
    }
  }

  // A background re-check landed on a patch already playing on a wiring. If
  // every control still turns the same knobs, the fresh numbers are taken in
  // place: nothing re-centres, and the sound does not move — each knob's base
  // absorbs the difference between the old gains and the new at the
  // control's current position. A control whose half the re-check closed
  // under it stops at the centre on that side, as a drag would. Only a
  // wiring that turns different knobs re-centres (`applyWired`).
  const wiredKnobs = (w) => (w && !w.search && !w.pending ? w.knobs.map(([a]) => a).sort().join("|") : w && w.search ? "search" : "");
  // A control that was not measured yet turns nothing, and is at the centre
  // (`springBack`), so whatever it is wired to now moves nothing yet: it
  // never makes two wirings different.
  function sameKnobs(a, b) {
    return !!a && !!b && a.length === b.length && a.every((w, i) => (w && w.pending) || wiredKnobs(w) === wiredKnobs(b[i]));
  }
  function applyRechecked(data) {
    const old = state.wire;
    const fresh = alignWiring(data.wiring);
    const addrs = state.cur ? [...state.cur.knobs.keys()].sort().join("|") : "";
    if (!state.cur || state.carried || !sameKnobs(old, fresh) || [...data.addrs].sort().join("|") !== addrs) {
      applyWired(data);
      return;
    }
    // What each knob sounds at now, under the old wiring, stays: a control
    // whose half the re-check closed stops at the centre on that side, as a
    // drag would, and the bases absorb the difference (`rebase`, unclamped:
    // a base clamped on its own here undid a hide's fold, `foldHidden`).
    const oldValues = controlValues();
    old.forEach((w, i) => {
      const nw = fresh[i];
      if (!turns(w) || !state.c[i]) return;
      const [lo, hi] = rangeOf(nw);
      const cNew = clamp(state.c[i], lo, hi);
      if (cNew !== state.c[i]) {
        state.c[i] = cNew;
        const k = knobs[i];
        if (k) k.value = cNew;
      }
    });
    state.cur.knobs = rebase(state.cur.knobs, old, oldValues, fresh, controlValues());
    state.wiredAt = new Map(data.addrs.map((a, i) => [a, data.values[i]]));
    state.wire = fresh;
    state.carried = false;
    state.measuring = false;
    push();
    sendTouch();
    renderStatus();
  }

  function onWorker(m) {
    const p = state.pending.get(m.req);
    if (!p) return false;
    state.pending.delete(m.req);
    const then = state.applyThen.get(m.req);
    state.applyThen.delete(m.req);
    // A measurement is kept even when the player has already moved on: it
    // is still true of that patch, and flicking back is the common case.
    if (p.cacheAs && !p.cacheAs.nocache && m.type === "perform_wired" && m.data) rememberWiring(p.cacheAs.json, m.data, p.cacheAs.rev, p.cacheAs.set);
    // A pre-warm (see `prewarm` below) was for the cache alone: it answers its
    // caller and goes no further, whatever is sounding when it lands.
    if (p.prewarm) {
      if (m.error) console.warn("[perform] prewarm:", m.error);
      p.prewarm(m.type === "perform_wired" && m.data ? onPanel(reachOfWiring(m.data.wiring)) : null);
      return true;
    }
    // A recorded pick is in the log whatever has happened to the sound since.
    if (m.type === "perform_recorded") {
      if (m.recorded) host.voteLanded?.();
      return true;
    }
    // An answer about a patch that is no longer sounding is consumed, not used.
    if (p.gen !== state.gen) return true;
    if (m.error) console.warn(`[perform] ${p.kind}:`, m.error);
    if (m.type === "perform_wired") {
      // A measurement of a set the panel no longer holds (the player placed
      // or hid a control while it ran) is kept in the cache, above, and not
      // played: the panel's own set is measured, or already is.
      const forPanel = setOf(p.set || p.cacheAs?.set || PANEL_DEFAULT).join(",") === setOf(state.panel).join(",");
      if (!forPanel && state.wire && m.data) {
        state.revalidating = inFlight("perform_wire");
        measurePanel();
        knobs.forEach(paintKnob);
        renderStatus();
        renderPalette();
        return true;
      }
      if (p.cacheAs && p.cacheAs.quiet) {
        // A background re-measurement of a patch already playing from its
        // last one: never clears a working wiring, and never re-centres the
        // controls under a moving hand — it waits for a pause. Another
        // measurement still out (the panel's new set) keeps it re-checking.
        state.revalidating = inFlight("perform_wire");
        if (m.data) {
          if (performance.now() - state.lastTouch < 1500) state.deferredWire = m.data;
          else applyRechecked(m.data);
        } else if (p.cacheAs.carried) {
          // A wiring borrowed from another sound is not this patch's: with no
          // measurement to replace it, it goes rather than lingering.
          state.wire = null;
          state.carried = false;
          renderStatus("couldn’t measure this patch");
        }
        knobs.forEach(paintKnob);
        renderHood();
        renderStatus();
        renderHow();
        renderPalette();
        return true;
      }
      if (!m.data) {
        state.measuring = false;
        state.wire = null;
        renderStatus(m.error ? "couldn’t measure this patch" : "the model hasn’t heard enough sounds to measure against yet");
      } else {
        applyWired(m.data);
        markWired("measured");
        // The panel changed while its first measurement ran: the controls
        // it shares play now, and its own set is measured next.
        if (!forPanel) measurePanel();
      }
      knobs.forEach(paintKnob);
      renderHood();
      renderHow();
      renderPalette();
      return true;
    }
    if (m.type === "perform_drifted") {
      // Hands came on while the walk ran: the player's sound wins, and the
      // proposal (made from where the knobs were) is dropped.
      if (state.lastTouch > p.at) {
        renderWander();
        return true;
      }
      if (!m.drift || !m.drift.tree) {
        // Staying is Wander's news, said on Wander; a walk that cannot start
        // from this patch at all is the patch's, and goes on the status line.
        if (m.error || (m.drift && m.drift.reason === "outside_support")) renderStatus(whyNot(m, m.drift, ""));
        else state.wanderStay = performance.now();
        renderWander();
        return true;
      }
      const pace = wanderPace(state.wander);
      state.wanderTaste = !!m.drift.taste;
      state.wanderWhy = m.drift.taste ? "toward your taste" : "through the grammar, before it has learned your taste";
      startGlide(new Map(m.drift.knobs), JSON.stringify(m.drift.tree), pace.glide, "Wander");
      return true;
    }
    if (m.type === "perform_offered") {
      // An aimed offer another turn has replaced is not shown.
      if (p.superseded) return true;
      // A spare nobody has asked for yet is kept, not shown.
      if (p.spare && !p.promote) {
        if (m.offer && m.offer.tree) state.spare = { offer: m.offer, at: p.spare.at };
        return true;
      }
      if (!m.offer || !m.offer.tree) {
        if (p.again) {
          requestOffer(state.offerWhy);
          return true;
        }
        renderOffer(whyNot(m, m.offer, p.aim ? `no ${p.aim.word} offer grew this time: turn it again, or loosen a lock` : "the walk came back unchanged: try again, or loosen a lock"));
        return true;
      }
      if (p.aim) m.offer.aim = p.aim;
      presentOffer(m.offer, p.from || (p.spare && p.spare.at));
      return true;
    }
    if (m.type === "perform_grafted") {
      const t = m.graft && m.graft.tree;
      if (!t) {
        const i = state.intent ? state.intent.i : -1;
        const dir = state.intent ? state.intent.dir : 1;
        state.intent = null;
        const w = state.wire && state.wire[i];
        if (w) {
          host.note(`${w.name}: nothing to add here, so it’s growing an offer instead.`, { replace: `pf-graft:${w.name}`, urgent: true });
          requestOffer(`${w.name.toLowerCase()} ${dir > 0 ? "up" : "down"}`, aimAt(i, dir));
        }
        return true;
      }
      // Committed like Keep: one undo step on the bench, and the patch comes
      // back through patchChanged to be measured.
      if (refusedWhileLanding("That change")) return true;
      host.commitTree(JSON.stringify(t));
      return true;
    }
    if (m.type === "perform_applied") {
      if (then) then(m.json);
      return true;
    }
    return true;
  }

  // A new tree reached the voices from anywhere in the app. It becomes home,
  // and the controls are re-measured around it.
  function patchChanged(json, makeup, liveKnobs) {
    nameEl.textContent = host.label();
    if (!json) return;
    // The same text is the same sound — unless a hand has turned knobs in
    // PATCH since it arrived, in which case this tree (an undo of that turn,
    // say) was just handed to the voices *without* them, and the base has to
    // be read from it again.
    if (state.cur && state.cur.json === json && !state.hand.size) {
      state.keeping = null;
      return;
    }
    // Keep's own tree coming back from the bench: same structure, same
    // sound. Nothing to reset.
    if (state.keeping && state.cur && !structureDiffers(state.cur.json, json)) {
      state.keeping = null;
      state.cur.json = json;
      state.cur.makeup = makeup;
      state.home.json = json;
      state.home.makeup = makeup;
      // Keep wrote every performed knob in, hand-turned ones included.
      state.hand.clear();
      // The sound did not move, so neither did its wiring: it is re-measured
      // only if the knobs have left the neighbourhood it was measured in, and
      // then in the background (see `recheck`).
      if (outsideTrust()) recheck();
      else renderStatus();
      return;
    }
    state.keeping = null;
    // A Take coming back from the bench, with the taken tree's live knobs: the
    // controls keep the wiring they had instead of reading "measuring…" for
    // the whole re-measurement — 14 s on a busy laptop, mid-phrase. Only the
    // knobs the taken tree still has are kept (addresses are positional, and
    // an offer can change structure), centred on the taken tree's values; the
    // offer's own measurement replaces it the moment it lands. This is the
    // stale-while-revalidate a remeasured patch already gets (see `wire`),
    // with the wiring borrowed from the sound the offer grew out of.
    const taking = state.taking;
    const taken = !!taking && performance.now() - taking.at < 15_000 && treeShape(json) === taking.key;
    if (taken || (taking && performance.now() - taking.at >= 15_000)) state.taking = null;
    // The bench took it: B fills and goes into the name now.
    if (taken) takeMotion(taking.shot);
    const carried =
      taken && taking.wire && Array.isArray(liveKnobs) && liveKnobs.length ? carryWiring(taking.wire, liveKnobs) : null;
    // The patch being left: a measurement of it is still worth finishing
    // (cached, for flicking back) but nobody is waiting on it, so it drops to
    // the engine's background lane; offers and drifts grown from it are worth
    // nothing, and are withdrawn if they have not started.
    const leaving = [...state.pending.entries()]
      .filter(([, p]) => p.gen === state.gen && /^perform_(wire|offer|drift)$/.test(p.kind))
      .map(([req]) => req);
    if (leaving.length) host.send({ type: "retire", reqs: leaving });
    state.gen++;
    state.applyThen.clear();
    state.measuring = false;
    state.heldWire = null;
    state.cur = { json, makeup, knobs: new Map() };
    state.home = { json, makeup, knobs: null };
    state.hand.clear();
    // Addresses mean nothing across a patch change until re-measured: a
    // stale touch site could land on a different module's knob.
    state.touch.sites = [];
    const lv = host.live();
    if (lv && lv.touch) lv.touch([], state.touch.depth);
    state.sent.clear();
    state.wire = null;
    state.glide = null;
    state.grafted.clear();
    state.deferredWire = null;
    state.spare = null;
    state.changedAt = performance.now();
    state.revalidating = false;
    state.carried = false;
    // An offer still growing for the old patch is consumed when it lands (its
    // generation is stale), so B must say so now: it used to keep "growing an
    // offer…" for ever when the patch changed under a growing offer.
    if (state.offer) clearOffer();
    else renderOffer();
    if (carried) {
      const here = new Map(liveKnobs);
      state.cur.knobs = here;
      state.home.knobs = new Map(here);
      state.wiredAt = new Map(here);
      state.wire = alignWiring(carried);
      // A borrowed wiring: the XY keeps its axes (see pickXY) until the
      // taken patch's own measurement says which controls reach it.
      state.carried = true;
      state.playableAt = performance.now();
      // The offer was grown from the performed sound, controls and all, so
      // the taken tree already contains their deltas: they read zero on it.
      state.c = state.c.map(() => 0);
      recentreAll();
      sendTouch();
      state.revalidating = true;
      const set = setOf(state.panel);
      const req = request("perform_wire", { tree: json, overrides: [], ...asked(set) });
      state.pending.get(req).cacheAs = { json, rev: wireRev(), quiet: true, carried: true, set };
      renderStatus();
    } else if (state.visible) wire();
    knobs.forEach(paintKnob);
    renderHood();
    renderSteps();
  }

  // A tree as its content alone — keys sorted, node uids dropped — so the
  // offer that was taken and the tree the bench echoes back compare equal
  // however either was serialized: the bench mints uids for the offer's
  // nodes, and a reply is free to order a tree's keys its own way.
  function treeShape(json) {
    const canon = (v) => {
      if (Array.isArray(v)) return v.map(canon);
      if (!v || typeof v !== "object") return v;
      const out = {};
      for (const k of Object.keys(v).sort()) if (k !== "uid") out[k] = canon(v[k]);
      return out;
    };
    try {
      return JSON.stringify(canon(JSON.parse(json)));
    } catch {
      return json;
    }
  }

  // The wiring `wire` had, kept for the tree whose live knobs are `list`: each
  // control keeps the knobs that tree still has; one left with none has
  // nothing to turn until the measurement says otherwise. That one is
  // *pending* ("listening…"), not a search control: it used to be marked
  // search, so a control that worked a second before the Take turned amber,
  // said "turn to ask for it", and a turn of it grafted a module or grew an
  // offer, ten seconds before the measurement put it back.
  function carryWiring(wire, list) {
    const live = new Set(list.map(([a]) => a));
    return wire.map((w) => {
      if (!w || w.search) return w;
      const kept = w.knobs.filter(([a]) => live.has(a));
      return kept.length ? { ...w, knobs: kept } : { ...w, knobs: [], pending: true };
    });
  }

  // Measure now even if PERFORM has never been looked at: a MIDI control can
  // be turned from any view.
  function ensureWired() {
    if (!state.cur) {
      const t = host.liveTree();
      if (t && t.json) patchChanged(t.json, t.makeup);
    }
    if (state.cur && !state.wire && !state.measuring) wire();
  }

  // Why a walk came back empty, in the player's words. `outside_support` is
  // the one that no retry fixes: the patch has a value the grammar gives no
  // mass, so evolution cannot start from it at all.
  function whyNot(m, r, otherwise) {
    if (m.error) return "the walk failed on this sound: try again";
    if (r && r.reason === "outside_support")
      return "a walk can’t start from this sound: nudge any knob off its stop and try again";
    return otherwise;
  }

  // ---------- glides (drift and back) ----------
  function startGlide(to, json, seconds, why) {
    const from = new Map();
    for (const a of state.cur.knobs.keys()) from.set(a, liveValue(a));
    // The controls' deltas are part of where the glide starts; fold them into
    // the base so the controls read zero at the destination.
    // A copy: the glide writes into cur.knobs every frame and must keep
    // reading its fixed starting point from `from`.
    state.cur.knobs = new Map(from);
    state.c = state.c.map(() => 0);
    recentreAll();
    state.glide = { from, to, t0: performance.now(), dur: Math.max(0.2, seconds) * 1000, json, why };
    renderWander();
    requestAnimationFrame(stepGlide);
  }

  function stepGlide() {
    const g = state.glide;
    if (!g) return;
    // Hands on, it waits: a touch mid-glide stops it where it is, and the
    // sound stays there. It never snaps back or finishes on its own.
    if (performance.now() - state.lastTouch < 60 && performance.now() - g.t0 > 60) {
      state.glide = null;
      renderWander();
      if (outsideTrust()) recheck();
      return;
    }
    const u = clamp((performance.now() - g.t0) / g.dur, 0, 1);
    const e = u * u * (3 - 2 * u); // smoothstep: no velocity step at either end
    for (const [a, v0] of g.from) {
      const v1 = g.to.has(a) ? g.to.get(a) : v0;
      state.cur.knobs.set(a, v0 + (v1 - v0) * e);
    }
    push();
    if (u >= 1) {
      if (g.json) state.cur.json = g.json;
      state.glide = null;
      state.lastMove = performance.now();
      renderWander();
      if (outsideTrust()) recheck();
      else renderStatus();
      return;
    }
    requestAnimationFrame(stepGlide);
  }

  // ---------- under the hood ----------
  // Which knobs to show: every knob a reachable control moves, then any knob
  // Wander has carried away from home — at most HOOD_MAX, in that order.
  const HOOD_MAX = 10;
  let hoodRows = new Map(); // addr -> {fill, home, val}
  let hoodKey = "";
  function hoodAddrs() {
    const out = [];
    const add = (a) => {
      if (!out.includes(a) && state.cur && state.cur.knobs.has(a) && out.length < HOOD_MAX) out.push(a);
    };
    (state.wire || []).forEach((w) => {
      if (turns(w)) w.knobs.forEach(([a]) => add(a));
    });
    if (state.home && state.home.knobs && state.cur) {
      for (const [a, v] of state.cur.knobs) {
        const h = state.home.knobs.get(a);
        if (h != null && Math.abs(v - h) > 0.02) add(a);
      }
    }
    return out;
  }
  function renderHood() {
    const addrs = hoodAddrs();
    // The labels are part of the key: an open reaches PERFORM before PATCH's
    // rack has named its modules, so rows built then read raw addresses
    // ("thresh", "dec") and must be rebuilt once the names arrive.
    const info = (a) => (host.knobInfo ? host.knobInfo(a, 0) : { module: "", label: a });
    const key = addrs.map((a) => `${a}=${info(a).module} ${info(a).label}`).join("|");
    if (key === hoodKey) return paintHood();
    hoodKey = key;
    hood.innerHTML = "";
    hoodRows = new Map();
    if (!addrs.length) return;
    const h = el("div", "pf-hood-h", "under the hood");
    h.title =
      "The patch’s own knobs these controls are turning now. Click one to open it in PATCH, which shows the kept sound until you press Keep.";
    hood.append(h);
    const grid = el("div", "pf-hood-grid");
    for (const a of addrs) {
      const { module, label } = info(a);
      const row = el("button", "pf-hood-row");
      row.type = "button";
      row.title = `${module} ${label}: open in PATCH (it shows the kept value until you Keep)`;
      const name = el("span", "pf-hood-name");
      name.append(el("span", "pf-hood-mod", module), document.createTextNode(` ${label}`));
      const track = el("span", "pf-hood-track");
      const fill = el("span", "pf-hood-fill");
      const home = el("span", "pf-hood-home");
      track.append(fill, home);
      const val = el("span", "pf-hood-val mono", "");
      row.append(name, track, val);
      row.onclick = () => host.showKnob && host.showKnob(a);
      grid.append(row);
      hoodRows.set(a, { fill, home, val });
    }
    hood.append(grid);
    paintHood();
  }
  function paintHood() {
    if (!state.cur) return;
    for (const [a, r] of hoodRows) {
      const v = liveValue(a);
      if (v == null) continue;
      r.fill.style.width = `${(v * 100).toFixed(1)}%`;
      const h = state.home && state.home.knobs ? state.home.knobs.get(a) : null;
      r.home.style.left = h == null ? "-10px" : `${(h * 100).toFixed(1)}%`;
      r.val.textContent = host.knobInfo ? host.knobInfo(a, v).text : `${Math.round(v * 100)}%`;
    }
  }
  let hoodQueued = false;
  function paintHoodSoon() {
    if (hoodQueued || !state.visible) return;
    hoodQueued = true;
    requestAnimationFrame(() => {
      hoodQueued = false;
      renderHood();
    });
  }

  // Has any knob left the neighbourhood the wiring was measured in?
  function outsideTrust() {
    if (!state.wiredAt || !state.wire) return true;
    for (const [a, v] of state.cur.knobs) {
      const at = state.wiredAt.get(a);
      if (at == null || Math.abs(v - at) > TRUST) return true;
    }
    return false;
  }

  // ---------- pads ----------
  function applyThen(then) {
    const req = request("perform_apply", { tree: state.cur.json, overrides: overrides() });
    state.applyThen.set(req, then);
  }

  // A patch PERFORM already plays whose bench has not landed yet (main hands
  // an open to the voices before the engine renders it for the rack): a tree
  // committed now would land on the rack it replaces. So a Keep, Take or
  // Back is refused until it lands, before anything here has changed, and
  // says so. Usually a moment; seconds on a busy machine.
  function refusedWhileLanding(what) {
    const name = host.openLanding ? host.openLanding() : null;
    if (!name) return false;
    host.note(`${what} waits for ${name} to finish opening. Try again in a moment.`, { urgent: true, replace: "pf-landing" });
    return true;
  }

  function keep() {
    if (!state.cur) return;
    if (refusedWhileLanding("Keep")) return;
    applyThen((json) => {
      if (!json || json === "null") return;
      if (refusedWhileLanding("Keep")) return; // opened while it was applied
      const here = new Map(overrides());
      logImplicit("perform_keep", { controls: state.c.map((x) => +x.toFixed(3)) });
      // The sound does not change, so neither does anything playing it: the
      // controls' deltas fold into the centre, the offer in B stays, and the
      // wiring is refreshed around the new centre in the background.
      state.cur.knobs = here;
      state.c = state.c.map(() => 0);
      recentreAll();
      state.home = { json, makeup: state.cur.makeup, knobs: new Map(here) };
      state.keeping = json;
      host.commitTree(json);
      host.note("Kept: this is home now. Back returns here.", { replace: "pf-keep" });
      flash("keep");
    });
  }

  function back() {
    if (!state.home || !state.home.knobs) return;
    const structural = state.home.json !== state.cur.json && structureDiffers(state.home.json, state.cur.json);
    if (structural && refusedWhileLanding("Back")) return;
    logImplicit("perform_back", {});
    if (structural) {
      host.commitTree(state.home.json);
      return;
    }
    startGlide(new Map(state.home.knobs), state.home.json, 1.2, "Back");
    flash("back");
  }

  // Two trees share a structure when they carry the same knob addresses; a
  // glide is only honest between those. (Values differ; addresses do not.)
  function structureDiffers(a, b) {
    const shape = (j) => j.replace(/-?\d+(\.\d+)?(e-?\d+)?/g, "#");
    return shape(a) !== shape(b);
  }

  function take() {
    if (!state.offer) return host.note("Nothing offered yet. Press Offer, or turn Wander up.", { urgent: true });
    if (refusedWhileLanding("Take")) return;
    logImplicit("perform_take", { why: state.offerWhy || "" });
    answerOffer(true);
    const json = state.offer.json;
    // Measured when the offer grew: A rebuilds as the offer at its own level,
    // not the old sound's, and B hands over with no jump.
    const makeup = state.offer.makeup;
    // B keeps sounding until A has rebuilt as the offer, then fades out: at
    // any Blend position the handover has no gap and no jump.
    state.offer = null;
    const live = host.live();
    if (live) live.bClear({ afterSwap: true });
    // …and Blend comes home. What was in B *is* A now, and B is empty: left
    // turned toward "offer", the next offer would sound at that level the
    // moment it arrived, over the sound the player just chose.
    blendHome();
    // The controls stay under the hands through the handover (see
    // `patchChanged`): the wiring measured on the sound being left carries
    // over to the one taken until the offer's own measurement lands.
    // Keyed by the taken tree itself (uids aside, see `wireKey`): a Take the
    // bench refuses must not lend its wiring to whatever patch comes next. The
    // wiring is the one under the hands now, kept here because an edit still
    // in flight can land first and clear it.
    state.taking = { at: performance.now(), key: treeShape(json), wire: state.wire, shot: snapshot("taken") };
    renderOffer();
    knobs.forEach(paintKnob);
    host.commitTree(json, "taken offer", makeup);
    flash("take");
  }

  function clearOffer() {
    state.offer = null;
    const live = host.live();
    if (live) live.bClear();
    renderOffer();
    knobs.forEach(paintKnob);
  }

  function toggleHold() {
    state.hold = !state.hold;
    padEls.hold.classList.toggle("lit", state.hold);
    padEls.hold.setAttribute("aria-pressed", String(state.hold));
    knobs.forEach(paintKnob);
  }

  const padEls = {};
  function pad(key, label, hint, onDown, onUp) {
    const b = el("button", "pf-pad", label);
    b.type = "button";
    b.title = hint;
    b.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      touch();
      onDown();
    });
    if (onUp) {
      b.addEventListener("pointerup", onUp);
      b.addEventListener("pointerleave", (e) => {
        if (e.buttons) onUp();
      });
    }
    // Keyboard and assistive tech arrive as a click with no pointer behind
    // it (detail 0); a pointer press was already handled on pointerdown.
    b.addEventListener("click", (e) => {
      if (e.detail !== 0) return;
      touch();
      onDown();
      if (onUp) setTimeout(onUp, 600);
    });
    padEls[key] = b;
    pads.append(b);
  }
  function flash(key) {
    const b = padEls[key];
    if (!b) return;
    b.classList.remove("flash");
    void b.offsetWidth;
    b.classList.add("flash");
  }

  // ---------- panels ----------
  // What PERFORM is doing with the patch: opening it, listening to it, how
  // many controls reach it, re-checking it. Wander's own state is said on
  // Wander (`wanderState`).
  function renderStatus(msg) {
    const parts = [];
    // Another patch is on its way to the player's hands. The title still
    // names what the keys play — that is true until it lands — dimmed, and
    // this line names what is coming, so the patch being left can never read
    // as the one that was picked.
    const incoming = host.opening?.() ? host.openingName?.() : null;
    state.incoming = incoming || null;
    nameEl.classList.toggle("pending", !!incoming);
    if (msg) parts.push(msg);
    else if (incoming) parts.push(`opening ${incoming}…`);
    else if (state.heldWire === "measure") parts.push("opening the sound you picked…");
    // A re-measure with a wiring in hand (after a glide past TRUST, say)
    // keeps the dials working on the old one, so it reads as a re-check, as
    // after a Take. "listening to this patch…" is for a patch with no wiring
    // yet, whose dials really are waiting.
    else if (state.measuring && !state.wire) parts.push("listening to this sound…");
    else if (state.wire) {
      const n = state.wire.filter(turns).length;
      parts.push(`${n} of ${state.wire.length} controls reach this patch`);
      // A control placed on the panel and not measured on this sound yet is
      // named while its measurement is out: the controls beside it play on.
      const unheard = state.wire.filter((w) => w && w.pending && w.knobs && !w.knobs.length && !state.carried).map((w) => w.name);
      if ((state.revalidating || state.measuring) && unheard.length) parts.push(`listening to ${unheard.join(", ")}…`);
      else if (state.revalidating || state.measuring) parts.push("re-checking");
    }
    // Written only when the words change.
    const text = parts.join(" · ");
    if (statusEl.textContent !== text) statusEl.textContent = text;
    const said = parts.filter((x) => x !== "re-checking").join(" · ");
    if (statusSaid.textContent !== said) statusSaid.textContent = said;
  }

  function renderOffer(msg) {
    offerCard.innerHTML = "";
    const lab = el("div", "pf-offer-label mono", "B");
    const body = el("div", "pf-offer-body");
    if (msg) body.textContent = msg;
    else if (state.offer) {
      const src = state.offer.taste ? "grown toward your taste" : "grown before it has learned your taste";
      // What changed first — it is the thing a player decides on — then
      // where it came from, then what to do with it.
      body.innerHTML = "";
      if (state.offer.changes) body.append(el("b", "pf-offer-what", state.offer.changes), document.createTextNode(" · "));
      const aim = state.offer.aim;
      if (aim) body.append(aimNote(aim), document.createTextNode(" · "));
      body.append(document.createTextNode(`${src}${state.offerWhy && !aim ? ` (${state.offerWhy})` : ""}: hold Peek to hear it, slide Blend, or Take it`));
    }
    else body.textContent = "no offer: press Offer to grow a variant from here";
    offerCard.classList.toggle("ready", !!state.offer);
    offerCard.append(lab, body);
    paintPads();
  }
  // Take and Peek act on an offer; until there is one they look it.
  // Waiting, not broken: a disabled pad says what it is waiting for. An
  // offer not heard yet can still be taken (the heard rule decides only
  // whether the answer counts, `holdAnswer`).
  function paintPads() {
    for (const k of ["take", "peek"]) {
      if (!padEls[k]) continue;
      padEls[k].disabled = !state.offer;
      padEls[k].dataset.wait = state.offer ? "" : "needs an offer";
    }
    // While B holds an offer, pressing Offer passes on it: the pad says so
    // before it is pressed, not in a toast after.
    const op = padEls.offer;
    if (op) {
      op.textContent = state.offer ? "Next" : "Offer";
      op.dataset.sub = state.offer ? "passes on B" : "";
      op.title = state.offer ? "Pass on the offer in B and hear the next one" : "Grow a variant from here into B";
    }
  }

  // ---------- how it works ----------
  // Every control on the panel, a tap apart, opened on the one you last
  // touched: what you hear it do, what it listens to, and what it turns on
  // this sound, read from this sound's wiring (`perform_wire`'s entry for it,
  // found by its palette index). Then how the deck works, for every control
  // at once. Closed at rest; nothing here is drawn as motion.
  why.innerHTML = "";
  const whyBtn = el("button", "pf-why-btn util-btn", "how it works");
  whyBtn.type = "button";
  const whyBody = el("div", "pf-why-body hidden");
  const howList = el("div", "pf-how-list");
  howList.setAttribute("role", "group");
  howList.setAttribute("aria-label", "Your controls");
  const howOne = el("div", "pf-how-one");
  const howAll = el("div", "pf-how-all");
  howAll.innerHTML =
    "<p>Each control is a direction in what the instrument can hear. When a sound opens, the instrument nudges every knob once and measures how the sound responds; each control is then wired to the few knobs that move the sound most purely in its direction, and each half is checked on real renders. Hover a control to see which knobs and how purely.</p>" +
    "<p>The amber dot on a control’s ring is where this sound measures on it, compared with the sounds in your session. A control that turns only one way on this sound says so under its name (<i>turns toward far only</i>): its ring is solid on that side, and it stops at the center on the other. One that reads <i>listening…</i> hasn’t been measured on this sound yet, and does nothing until it has.</p>" +
    "<p>A control drawn in amber can’t be reached by this patch’s knobs (a patch with no drive can’t get grittier by turning a filter). Turn it past the notch and let go, and it adds what is missing or asks for a variant that can, aimed the way you turned it, which arrives in <b>B</b> saying how far it went (<i>grittier by 1.8σ</i>, σ being the spread of your session’s sounds) or that it didn’t get there. Short of the notch it springs back and asks nothing.</p>" +
    "<p><b>Wander</b> sets how alive the sound is: <b>still</b>, <b>ideas</b> (variants appear in B), <b>drift</b> (knob-only steps of the taste walk, glided, about one per phrase), <b>roam</b> (bigger, faster). Its ticks mark where each begins. Let go of it in a new zone and it answers in a second and a half; the line under it says what it is doing and when it moves next, and the thin arc inside its ring fills toward that move. Structure never changes on its own. Tap Wander to freeze it; touching any other control pauses it for a few seconds.</p>";
  whyBody.append(howList, howOne, howAll);
  // Which control How it works opens on: the one last touched (a palette
  // index), else the panel's first.
  let howAt = null;
  function howFocus() {
    return howAt != null && state.panel.includes(howAt) ? howAt : state.panel[0];
  }
  function renderHow() {
    if (whyBody.classList.contains("hidden")) return;
    const at = howFocus();
    const keep = howList.contains(document.activeElement) ? document.activeElement.dataset.index : null;
    howList.innerHTML = "";
    state.panel.forEach((k) => {
      const c = PALETTE[k];
      const b = el("button", "pf-how-tab", c.name);
      b.type = "button";
      b.dataset.index = String(k);
      b.setAttribute("aria-pressed", String(k === at));
      b.onclick = () => {
        howAt = k;
        renderHow();
      };
      howList.append(b);
      if (keep === String(k)) queueMicrotask(() => b.focus({ preventScroll: true }));
    });
    const i = state.panel.indexOf(at);
    const c = PALETTE[at];
    const w = state.wire && state.wire[i];
    const [lo, hi] = rangeOf(w);
    const on = onThisSound(c.name, {
      pending: !w || !!w.pending,
      search: !!(w && w.search),
      knobs: turns(w) ? w.knobs.map(([a]) => knobWord(a, true)) : [],
      only: turns(w) && lo === 0 && hi > 0 ? c.high : turns(w) && hi === 0 && lo < 0 ? c.low : "",
    });
    howOne.innerHTML = "";
    const h = el("div", "pf-how-h");
    h.append(el("span", "pf-how-name", c.name), el("span", "pf-how-ends mono", `${c.low} · ${c.high}`));
    howOne.append(h, el("p", "pf-how-hear", c.hear), el("p", "pf-how-how", c.how), el("p", "pf-how-here", on));
  }
  whyBtn.onclick = () => {
    whyBody.classList.toggle("hidden");
    whyBtn.setAttribute("aria-expanded", String(!whyBody.classList.contains("hidden")));
    renderHow();
  };
  whyBtn.setAttribute("aria-expanded", "false");
  why.append(whyBtn, whyBody);

  // ---------- the palette ----------
  // Which controls sit on the panel, and in what order: place, hide and order
  // up to PANEL_MAX of the palette's eighteen. A panel, not a dialog
  // (nothing here opens a modal): the keys play through it, Esc or × puts it
  // away. Each row's mark says what the control does on this sound, from its
  // wiring: it turns, nothing here turns it, or it is being listened to. A
  // control not on the panel is not measured, so it carries no mark.
  // Marks sit in a cell every row reserves, left of the name: a name never
  // moves for a mark, and is never cut short by one.
  const arrangeBtn = el("button", "pf-arrange util-btn", "arrange");
  arrangeBtn.type = "button";
  arrangeBtn.title = "Place, hide and order your controls";
  arrangeBtn.setAttribute("aria-haspopup", "dialog");
  arrangeBtn.setAttribute("aria-expanded", "false");
  const pal = el("div", "pp hidden");
  pal.setAttribute("role", "dialog");
  pal.setAttribute("aria-label", "Your controls");
  document.body.append(pal);
  const palOpen = () => !pal.classList.contains("hidden");
  function openPalette() {
    pal.classList.remove("hidden");
    arrangeBtn.setAttribute("aria-expanded", "true");
    renderPalette();
    placePalette();
    pal.querySelector(".pp-x")?.focus({ preventScroll: true });
  }
  function closePalette(back = true) {
    if (!palOpen()) return;
    pal.classList.add("hidden");
    arrangeBtn.setAttribute("aria-expanded", "false");
    if (back && state.visible) arrangeBtn.focus({ preventScroll: true });
  }
  arrangeBtn.onclick = () => (palOpen() ? closePalette() : openPalette());
  // Over the deck it arranges, as wide as it needs; on a narrow screen, a
  // sheet along the bottom (style.css).
  function placePalette() {
    if (!palOpen()) return;
    const r = deck.getBoundingClientRect();
    if (!r.width) return;
    pal.style.left = `${Math.round(r.left)}px`;
    pal.style.top = `${Math.round(r.top)}px`;
  }
  window.addEventListener("resize", placePalette);
  // PERFORM's view scrolls on a short screen: the palette stays over the deck.
  root.addEventListener("scroll", placePalette, { passive: true });
  // Esc puts it away wherever focus is, before anything else takes the key.
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Escape" || !palOpen()) return;
      e.preventDefault();
      e.stopPropagation();
      closePalette();
    },
    true,
  );
  // What a placed control does on this sound, for its row's mark.
  function markOf(i) {
    const w = state.wire && state.wire[i];
    if (!w || w.pending) {
      const waiting = state.measuring || state.revalidating || inFlight("perform_wire");
      return waiting ? ["listening", "listening…"] : ["unmeasured", "not measured on this sound yet"];
    }
    if (w.search) return ["search", "nothing here turns it: turn it to ask for an offer"];
    return ["turns", `turns ${knobWords(w.knobs.map(([a]) => a))}`];
  }
  function palRow(k, placedAt) {
    const c = PALETTE[k];
    const placed = placedAt >= 0;
    const row = el("div", `pp-row${placed ? " on" : ""}`);
    row.dataset.index = String(k);
    const mark = el("span", "pp-mark");
    mark.setAttribute("aria-hidden", "true");
    const txt = el("span", "pp-txt");
    txt.append(el("span", "pp-name", c.name), el("span", "pp-ends mono", `${c.low} · ${c.high}`));
    // The waiting sign (#live-wait's): its own box beside the words.
    const wait = el("span", "pp-wait mono", "");
    row.append(mark, txt, wait);
    const btn = (cls, glyph, label, on, disabled) => {
      const b = el("button", `pp-b ${cls}`, glyph);
      b.type = "button";
      b.setAttribute("aria-label", label);
      b.title = label;
      b.disabled = !!disabled;
      b.onclick = on;
      return b;
    };
    const n = state.panel.length;
    if (placed) {
      const [m, said] = markOf(placedAt);
      mark.dataset.mark = m;
      mark.title = said;
      txt.title = said;
      if (m === "listening") wait.textContent = "listening…";
      row.append(
        btn("pp-up", "↑", `Move ${c.name} earlier`, () => movePanel(k, -1), placedAt === 0),
        btn("pp-down", "↓", `Move ${c.name} later`, () => movePanel(k, 1), placedAt === n - 1),
        btn("pp-hide", "×", `Hide ${c.name}`, () => hidePanel(k), n <= 1),
      );
    } else {
      row.append(btn("pp-place", "+", `Place ${c.name}`, () => placePanel(k), n >= PANEL_MAX));
    }
    return row;
  }
  function renderPalette() {
    if (!palOpen()) return;
    const keep = pal.contains(document.activeElement) ? document.activeElement.getAttribute("aria-label") : null;
    const n = state.panel.length;
    pal.innerHTML = "";
    const head = el("div", "pp-head");
    const words = el("div", "pp-words");
    words.append(el("div", "pp-title", "Your controls"), el("p", "pp-sub mono", panelCount(n, PANEL_MAX)));
    const x = el("button", "pp-x util-btn", "×");
    x.type = "button";
    x.setAttribute("aria-label", "Close");
    x.title = "Close · Esc";
    x.onclick = () => closePalette();
    head.append(words, x);
    const body = el("div", "pp-body");
    const on = el("div", "pp-sec");
    on.append(el("div", "pp-h", "On the panel"), ...state.panel.map((k, i) => palRow(k, i)));
    body.append(on);
    for (const fam of FAMILIES) {
      const rest = PALETTE.map((c, k) => k).filter((k) => PALETTE[k].family === fam && !state.panel.includes(k));
      if (!rest.length) continue;
      const sec = el("div", "pp-sec");
      sec.append(el("div", "pp-h", fam), ...rest.map((k) => palRow(k, -1)));
      body.append(sec);
    }
    pal.append(head, body);
    // Focus stays on the button it was on, or the row's next useful one.
    if (keep) {
      const b = [...pal.querySelectorAll("button")].find((e) => e.getAttribute("aria-label") === keep && !e.disabled);
      (b || x).focus({ preventScroll: true });
    }
  }
  function placePanel(k) {
    if (state.panel.length >= PANEL_MAX || state.panel.includes(k)) return;
    setPanel([...state.panel, k]);
    // From the + to the new row's place in the panel's list.
    pal.querySelector(`.pp-row.on[data-index="${k}"] .pp-hide`)?.focus({ preventScroll: true });
  }
  function hidePanel(k) {
    if (state.panel.length <= 1) return;
    setPanel(state.panel.filter((x) => x !== k));
    pal.querySelector(`.pp-row[data-index="${k}"] .pp-place`)?.focus({ preventScroll: true });
  }
  function movePanel(k, d) {
    const a = state.panel.slice();
    const i = a.indexOf(k);
    const j = i + d;
    if (i < 0 || j < 0 || j >= a.length) return;
    [a[i], a[j]] = [a[j], a[i]];
    setPanel(a);
  }

  // ---------- stage mode ----------
  // ⇧F: the sound under your hands, the whole screen, for a gig or a stream.
  // What it draws is what you hear and nothing else: the output after the
  // master gain (`host.outAnalyser`: LivePoly's voices in the AudioWorklet,
  // and any phrase Space plays), as its spectrum mirrored about the centre
  // with the lows at the base, left to fade like phosphor. Nothing
  // moves without sound. The face (Plan-005 task 3) is not drawn: the app
  // does not compute it yet. Space plays and the keys play, as everywhere;
  // ⇧F or Esc leaves. Not a modal: it asks nothing.
  const stageBtn = el("button", "pf-stage-btn util-btn", "stage ⇧F");
  stageBtn.type = "button";
  stageBtn.title = platformKeys("Stage mode · ⇧F");
  stageBtn.textContent = platformKeys("stage ⇧F");
  stageBtn.onclick = () => openStage();
  const actions = el("div", "pf-actions");
  actions.append(arrangeBtn, stageBtn);
  head.insertBefore(actions, scope);
  let stageOn = null; // {root, cv, name, raf, entered, back, bins, trail}
  // The bands drawn: 40 from 40 Hz to 16 kHz, spaced evenly in pitch.
  const ST_BANDS = 40;
  const ST_LO = 40;
  const ST_HI = 16000;
  const stHz = (b) => ST_LO * Math.pow(ST_HI / ST_LO, b / (ST_BANDS - 1));
  function openStage() {
    if (stageOn) return;
    const rootEl = el("div", "st-stage");
    rootEl.tabIndex = -1;
    rootEl.setAttribute("role", "dialog");
    rootEl.setAttribute("aria-modal", "true");
    rootEl.setAttribute("aria-label", `Stage mode: ${host.label()}`);
    const cv = el("canvas", "st-canvas");
    cv.setAttribute("aria-hidden", "true");
    const hud = el("div", "st-hud");
    const name = el("div", "st-name", host.label());
    const where = el("div", "st-cat mono", "PERFORM · in hand");
    hud.append(name, where);
    // What plays and what leaves, in the hands this screen has.
    const touchOnly = !!window.matchMedia?.("(pointer: coarse)").matches;
    const hint = el("div", "st-hint mono", touchOnly ? "tap to play the sound · × leaves" : platformKeys("A to L play · Space plays the sound · ⇧F or Esc leaves"));
    const leave = el("button", "st-leave util-btn", "×");
    leave.type = "button";
    leave.setAttribute("aria-label", platformKeys("Leave stage mode (⇧F or Esc)"));
    leave.title = platformKeys("Leave · ⇧F");
    leave.onclick = (e) => {
      e.stopPropagation();
      closeStage();
    };
    const said = el("div", "sr-only", platformKeys(`Stage mode, ${host.label()}. ⇧F or Escape leaves.`));
    said.setAttribute("role", "status");
    // The stage's own live region: a screen reader may not announce one
    // outside a modal dialog, so a refusal is said here too (below).
    const ticks = ["100 Hz", "1 kHz", "10 kHz"].map((t) => el("div", "st-tick mono", t));
    ticks.forEach((t) => t.setAttribute("aria-hidden", "true"));
    rootEl.append(cv, ...ticks, hud, hint, leave, said);
    // A tap plays the sound, as Space does: on a touch screen there is no
    // Space.
    rootEl.addEventListener("click", (e) => {
      if (!e.target.closest("button")) host.play?.();
    });
    const back = document.activeElement;
    // Everything behind the stage is out of reach while it is on: Tab cannot
    // land on a hidden control there for Space to press (`inert`), and Tab
    // inside goes between the stage and its × (the keydown below). The
    // toasts and the alarm are the exception: a refusal or an alarm said now
    // shows over the stage (style.css), and can be read and pressed.
    const behind = [...document.body.children].filter((e) => !e.inert && e.id !== "toasts" && e.id !== "alarm");
    behind.forEach((e) => (e.inert = true));
    document.body.append(rootEl);
    document.documentElement.classList.add("st-on");
    stageOn = { root: rootEl, cv, name, ticks, hint, leave, said, hintText: hint.textContent, hintTimer: 0, raf: 0, entered: false, back, behind };
    rootEl.focus({ preventScroll: true });
    // A refusal is said in a toast, which stage mode would hide: urgent ones
    // are lifted above it (style.css), and said in the stage's own line too,
    // for a few seconds. A receipt is not news on stage, and stays hidden.
    stageOn.watch = new MutationObserver((list) => {
      const st = stageOn;
      if (!st) return;
      for (const m of list) {
        for (const n of m.addedNodes) {
          if (!(n instanceof Element) || !n.classList.contains("urgent")) continue;
          const text = n.querySelector(".toast-msg")?.textContent || "";
          if (!text) continue;
          st.hint.textContent = text;
          st.hint.classList.add("said");
          st.said.textContent = text;
          clearTimeout(st.hintTimer);
          st.hintTimer = setTimeout(() => {
            st.hint.textContent = st.hintText;
            st.hint.classList.remove("said");
          }, 5000);
        }
      }
    });
    const toasts = document.getElementById("toasts");
    if (toasts) stageOn.watch.observe(toasts, { childList: true });
    try {
      const fs = document.documentElement.requestFullscreen?.();
      if (fs && fs.then) fs.then(() => stageOn && (stageOn.entered = true)).catch(() => {});
    } catch {
      /* full screen is a courtesy: the stage covers the window either way */
    }
    stageOn.raf = requestAnimationFrame(stageFrame);
  }
  function closeStage() {
    const s = stageOn;
    if (!s) return;
    stageOn = null;
    cancelAnimationFrame(s.raf);
    clearTimeout(s.hintTimer);
    s.watch?.disconnect();
    s.root.remove();
    s.behind.forEach((e) => (e.inert = false));
    document.documentElement.classList.remove("st-on");
    if (document.fullscreenElement) document.exitFullscreen?.().catch?.(() => {});
    if (s.back && s.back.isConnected) s.back.focus?.({ preventScroll: true });
  }
  document.addEventListener("fullscreenchange", () => {
    if (stageOn && stageOn.entered && !document.fullscreenElement) closeStage();
  });
  // ⇧F opens stage mode in PERFORM only, as the mock has it, and leaves it
  // from anywhere. In PERFORM it takes the place of F's accent (the note keys
  // play harder with Shift); everywhere else ⇧F is the accented F it always
  // was (ADR-009's status note). Matched on the key's character, as the
  // keymap is, so a Dvorak or Colemak F is F. Only Shift and F, nothing else
  // held, and never while typing. Esc leaves; Tab stays on the stage.
  const typing = (t) => !!t?.closest?.("input, textarea, select, [contenteditable]");
  window.addEventListener(
    "keydown",
    (e) => {
      if (stageOn && e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeStage();
        return;
      }
      if (stageOn && e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        (document.activeElement === stageOn.leave ? stageOn.root : stageOn.leave).focus({ preventScroll: true });
        return;
      }
      const shiftF = e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && e.key === "F" && !typing(e.target);
      if (shiftF && (stageOn || state.visible)) {
        e.preventDefault();
        e.stopPropagation();
        if (!e.repeat) (stageOn ? closeStage : openStage)();
      }
    },
    true,
  );
  // The loop: size the canvas, follow the name, and hand one frame's state
  // to `stageDraw`, which is all that knows what the stage looks like.
  function stageFrame() {
    const s = stageOn;
    if (!s) return;
    s.raf = requestAnimationFrame(stageFrame);
    const dpr = window.devicePixelRatio || 1;
    const W = s.root.clientWidth;
    const H = s.root.clientHeight;
    if (s.cv.width !== Math.round(W * dpr) || s.cv.height !== Math.round(H * dpr)) {
      s.cv.width = Math.round(W * dpr);
      s.cv.height = Math.round(H * dpr);
    }
    if (s.name.textContent !== host.label()) s.name.textContent = host.label();
    stageDraw(s.cv.getContext("2d"), {
      W,
      H,
      dpr,
      still: stillMotion(),
      ink: host.ink,
      ticks: s.ticks,
      analyser: host.outAnalyser ? host.outAnalyser() : host.live()?.analyser,
      tree: state.cur ? state.cur.json : null,
    });
  }

  // One frame of the stage, from `st`: the canvas's size in CSS pixels
  // (`W`, `H`) and its pixel ratio, reduced motion (`still`), the inks, the
  // frequency marks (`ticks`, page elements), the output's analyser and the
  // tree of the sound in hand.
  // faces: the mock draws the held sound's face here, its vessel at the full
  // height of the stage (Plan-005 task 3, `claude/faces`). Until faces land
  // this draws the output's spectrum, mirrored in the face's coordinates
  // (lows at the base); the faces integration replaces this function's body
  // with the vessel, drawn from the sound's face and lit by what sounds.
  let stageBuf = null;
  let stageLoudAt = 0; // when the stage last drew a sound
  function stageDraw(g, st) {
    const { W, H, dpr } = st;
    // The fade halves what is left each few frames but, in 8-bit alpha,
    // never reaches nothing: a second and a half after the last sound the
    // canvas is cleared outright, so silence is truly empty.
    if (performance.now() - stageLoudAt > 1500) g.clearRect(0, 0, W * dpr, H * dpr);
    // Phosphor: what was drawn fades rather than vanishing. Under reduced
    // motion, each frame is only what sounds now.
    if (st.still) g.clearRect(0, 0, W * dpr, H * dpr);
    else {
      g.save();
      g.globalCompositeOperation = "destination-out";
      g.globalAlpha = 0.16;
      g.fillRect(0, 0, W * dpr, H * dpr);
      g.restore();
    }
    const h = Math.min(H * 0.74, W * 1.1) * dpr;
    const w = h * 0.6;
    const cx = (W * dpr) / 2;
    const base = (H * dpr) / 2 + h / 2;
    // The frequency axis, beside the shape: where 100 Hz, 1 kHz and 10 kHz
    // sit, so a lit band can be read. Words on the page, not on the canvas,
    // which holds only what sounds.
    st.ticks.forEach((t, j) => {
      const hz = [100, 1000, 10000][j];
      t.style.top = `${((base - (Math.log(hz / ST_LO) / Math.log(ST_HI / ST_LO)) * h) / dpr).toFixed(1)}px`;
      t.style.right = `${((W * dpr - (cx - w / 2)) / dpr + 16).toFixed(1)}px`;
    });
    const an = st.analyser;
    if (!an) return;
    if (!stageBuf || stageBuf.length !== an.frequencyBinCount) stageBuf = new Float32Array(an.frequencyBinCount);
    an.getFloatFrequencyData(stageBuf);
    const nyq = an.context.sampleRate / 2;
    const half = [];
    let loud = 0;
    for (let b = 0; b < ST_BANDS; b++) {
      const f0 = b ? (stHz(b - 1) + stHz(b)) / 2 : stHz(0);
      const f1 = b < ST_BANDS - 1 ? (stHz(b) + stHz(b + 1)) / 2 : stHz(b);
      const i0 = Math.max(0, Math.floor((f0 / nyq) * stageBuf.length));
      const i1 = Math.min(stageBuf.length - 1, Math.max(i0, Math.ceil((f1 / nyq) * stageBuf.length)));
      let db = -Infinity;
      for (let i = i0; i <= i1; i++) db = Math.max(db, stageBuf[i]);
      // −100 dBFS is nothing; −30 and above is the full width.
      const v = clamp((db + 100) / 70, 0, 1);
      loud = Math.max(loud, v);
      half.push(v);
    }
    if (loud < 0.02) return;
    stageLoudAt = performance.now();
    g.save();
    g.beginPath();
    for (let b = 0; b < ST_BANDS; b++) {
      const y = base - (b / (ST_BANDS - 1)) * h;
      const x = cx + (half[b] * w) / 2;
      if (b) g.lineTo(x, y);
      else g.moveTo(cx, base), g.lineTo(x, y);
    }
    for (let b = ST_BANDS - 1; b >= 0; b--) g.lineTo(cx - (half[b] * w) / 2, base - (b / (ST_BANDS - 1)) * h);
    g.closePath();
    g.strokeStyle = st.ink.green;
    g.lineWidth = 2 * dpr;
    g.shadowColor = st.ink.green;
    g.shadowBlur = 18 * dpr * loud;
    g.globalAlpha = 0.9;
    g.stroke();
    g.restore();
  }

  // ---------- first steps ----------
  // For someone who walks up to it cold — no staff, no manual. Three moves
  // are the whole loop: play, turn a control, ask for an offer. Each ticks off
  // when it happens (not when it is read), and the strip retires once all
  // three have. Per visitor: the booth's "new visitor" brings it back.
  const STEPS_KEY = "auracle-perform-steps";
  const STEPS = [
    { id: "play", text: () => "Play a key: A to L, or tap the keybed" },
    { id: "turn", text: turnStep },
    { id: "offer", text: () => "Press OFFER, then hold PEEK or TAKE it" },
  ];
  // Step 2 names a control that turns on *this* patch. It used to say "Turn a
  // lit control: BRIGHT is a good start" on every patch, when the only
  // coloured names on the deck were the amber search controls (the ones that
  // cannot turn), and Bright is itself one on some patches. Both ways first,
  // in the order the XY pad picks (Bright, Motion, Snap…), then one way.
  function turnStep() {
    const order = preferOrder();
    const w = state.wire;
    if (!w) return "Turn a named control: drag up or down";
    const both = order.find((i) => turns(w[i]) && rangeOf(w[i])[0] < 0 && rangeOf(w[i])[1] > 0);
    if (both != null) return `Turn ${controls()[both].name.toUpperCase()}: drag up or down`;
    const one = order.find((i) => turns(w[i]));
    if (one != null) return `Turn ${controls()[one].name.toUpperCase()}: drag ${rangeOf(w[one])[1] > 0 ? "up" : "down"}`;
    return "Turn a named control: drag up or down";
  }
  const stepsDone = new Set();
  try {
    for (const id of JSON.parse(localStorage.getItem(STEPS_KEY) || "[]")) stepsDone.add(id);
  } catch {
    /* a per-viewer convenience; an empty set is fine */
  }
  function renderSteps() {
    if (stepsDone.size >= STEPS.length) {
      // The closing line stays for its moment (see stepDone).
      if (!stepsEl.querySelector(".all")) stepsEl.classList.add("hidden");
      return;
    }
    stepsEl.innerHTML = "";
    const now = STEPS.find((st) => !stepsDone.has(st.id));
    STEPS.forEach((st, i) => {
      const done = stepsDone.has(st.id);
      stepsEl.append(el("span", `pf-step${done ? " done" : ""}${st === now ? " now" : ""}`, `${done ? "✓" : i + 1}  ${st.text()}`));
    });
  }
  function stepDone(id) {
    if (state.quiet || stepsDone.has(id) || stepsDone.size >= STEPS.length) return;
    stepsDone.add(id);
    try {
      localStorage.setItem(STEPS_KEY, JSON.stringify([...stepsDone]));
    } catch {
      /* in memory is enough for this visit */
    }
    if (stepsDone.size < STEPS.length) return renderSteps();
    stepsEl.innerHTML = "";
    stepsEl.append(el("span", "pf-step done all", "✓  That is the loop. Every offer you take or pass teaches it what you like."));
    setTimeout(() => stepsEl.classList.add("hidden"), 7000);
  }
  renderSteps();

  // ---------- XY pad ----------
  // Named-control indices on each axis. Until the player picks, the pad
  // follows the patch: its two axes are the first two controls this patch
  // reaches (see pickXY), so the first thing under a finger always moves.
  // Positions on the panel; until a wiring says what reaches, the first two
  // a gesture reaches for (Bright × Motion on the six).
  let xyHeld = false;
  const XY = { x: preferOrder()[0] ?? 0, y: preferOrder()[1] ?? preferOrder()[0] ?? 0, chosen: false };
  const xySels = {};
  const xyHead = el("div", "pf-xy-head mono");
  const xyField = el("div", "pf-xy-field");
  xyField.tabIndex = 0;
  xyField.setAttribute("role", "slider");
  const xyDot = el("div", "pf-xy-dot");
  const xyLab = { l: el("span", "pf-xy-l mono"), r: el("span", "pf-xy-r mono"), t: el("span", "pf-xy-t mono"), b: el("span", "pf-xy-b mono") };
  const xyNote = el("div", "pf-xy-note mono");
  xyField.append(xyLab.t, xyLab.b, xyLab.l, xyLab.r, xyDot, xyNote);
  const axisSel = (axis) => {
    const sel = el("select", "perf-sel");
    sel.setAttribute("aria-label", `XY pad ${axis} axis`);
    fillAxis(sel, axis);
    sel.onchange = () => {
      XY[axis] = Number(sel.value);
      XY.chosen = true;
      paintXY();
      giveBackKeys(sel, xyField);
    };
    steerable(sel);
    xySels[axis] = sel;
    return sel;
  };
  // An axis's choices are the controls on the panel, in its order.
  function fillAxis(sel, axis) {
    sel.innerHTML = "";
    controls().forEach((c, i) => {
      const o = el("option", null, c.name);
      o.value = String(i);
      sel.append(o);
    });
    sel.value = String(XY[axis]);
  }
  xyHead.append(el("span", "pf-xy-cap", "XY"), axisSel("x"), el("span", null, "×"), axisSel("y"));
  xy.append(xyHead, xyField);

  const xyReach = (i) => turns(state.wire && state.wire[i]);
  // An axis not measured yet (no wiring, or a control a Take carried over with
  // nothing to turn) is waiting, not dead: it is drawn dim, never struck
  // through in the amber of "doesn't reach".
  const xyPending = (i) => {
    const w = state.wire && state.wire[i];
    return !w || !!w.pending;
  };
  // A fresh wiring: unless the player has chosen the axes, put the first two
  // reachable controls under the finger (Bright × Motion when both reach). Not
  // on a wiring a Take carried over: it is borrowed from the sound before, and
  // swapping an axis under the player's hand because of it was wrong ten
  // seconds later.
  function pickXY() {
    if (XY.chosen || !state.wire || state.carried) return;
    const reach = preferOrder().filter((i) => xyReach(i));
    if (reach.length < 2 || (xyReach(XY.x) && xyReach(XY.y))) return;
    [XY.x, XY.y] = reach.slice(0, 2);
    if (xySels.x) xySels.x.value = String(XY.x);
    if (xySels.y) xySels.y.value = String(XY.y);
  }
  function paintXY() {
    pickXY();
    const kx = knobs[XY.x], ky = knobs[XY.y];
    if (!kx || !ky) return;
    const cx = (kx.value + 1) / 2, cy = (ky.value + 1) / 2;
    xyDot.style.left = `${(cx * 100).toFixed(1)}%`;
    xyDot.style.top = `${((1 - cy) * 100).toFixed(1)}%`;
    xyLab.l.textContent = kx.spec.low;
    xyLab.r.textContent = kx.spec.high;
    xyLab.b.textContent = ky.spec.low;
    xyLab.t.textContent = ky.spec.high;
    const rx = xyReach(XY.x), ry = xyReach(XY.y);
    const px = xyPending(XY.x), py = xyPending(XY.y);
    const dx = !rx && !px, dy = !ry && !py;
    xyField.classList.toggle("dead-x", dx);
    xyField.classList.toggle("dead-y", dy);
    xyField.classList.toggle("pending-x", px);
    xyField.classList.toggle("pending-y", py);
    const listening = state.wire ? state.revalidating : state.measuring;
    xyNote.classList.toggle("pending", !dx && !dy);
    xyNote.textContent = dx && dy
      ? "neither reaches this patch: pick two others"
      : dx ? `${kx.spec.name} doesn’t reach this patch`
        : dy ? `${ky.spec.name} doesn’t reach this patch`
          : (px || py) && listening ? "listening to this sound…" : "";
    xyField.setAttribute("aria-valuetext", `${kx.spec.name} ${Math.round(kx.value * 100)}%, ${ky.spec.name} ${Math.round(ky.value * 100)}%`);
  }
  // Only a reachable axis moves: dragging along an amber one would be a
  // knob that does nothing, and the pad has no "let go to ask" gesture.
  function setXY(cx, cy) {
    touch();
    for (const [i, v] of [[XY.x, cx], [XY.y, cy]]) {
      if (!xyReach(i)) continue;
      const k = knobs[i];
      const [lo, hi] = rangeOf(state.wire[i]);
      k.value = clamp(v * 2 - 1, lo, hi);
      paintKnob(k);
      onKnob(k);
    }
    paintXY();
  }
  const xyAt = (e) => {
    const r = xyField.getBoundingClientRect();
    return [clamp((e.clientX - r.left) / r.width, 0, 1), clamp(1 - (e.clientY - r.top) / r.height, 0, 1)];
  };
  xyField.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    xyHeld = true;
    xyField.focus({ preventScroll: true });
    xyField.setPointerCapture(e.pointerId);
    ensureWired();
    setXY(...xyAt(e));
  });
  xyField.addEventListener("pointermove", (e) => {
    if (xyField.hasPointerCapture(e.pointerId)) setXY(...xyAt(e));
  });
  const xyEnd = (e) => {
    xyHeld = false;
    queueMicrotask(panelLater);
    if (xyField.hasPointerCapture(e.pointerId)) xyField.releasePointerCapture(e.pointerId);
    for (const i of [XY.x, XY.y]) logImplicit("perform_turn", { control: knobs[i].spec.name, value: +knobs[i].value.toFixed(3), via: "xy" });
  };
  xyField.addEventListener("pointerup", xyEnd);
  xyField.addEventListener("pointercancel", xyEnd);
  // Home is a double-tap away.
  xyField.addEventListener("dblclick", () => setXY(0.5, 0.5));
  xyField.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? 0.01 : 0.05;
    const cx = (knobs[XY.x].value + 1) / 2, cy = (knobs[XY.y].value + 1) / 2;
    const mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
    if (!mv) return;
    e.preventDefault();
    e.stopPropagation();
    setXY(clamp(cx + mv[0], 0, 1), clamp(cy + mv[1], 0, 1));
  });

  // ---------- build ----------
  // The deck: the panel's controls in its order, then Blend and Wander.
  // Rebuilt only when the panel changes (`setPanel`), never under a held
  // pointer.
  function buildDeck() {
    for (const k of knobs) {
      k.dead = true;
      if (k.tween) cancelAnimationFrame(k.tween);
      clearTimeout(k.keyTimer);
      clearTimeout(k.bumpTimer);
    }
    knobs.length = 0;
    deck.innerHTML = "";
    controls().forEach((c, i) =>
      makeKnob(i, { kind: "named", name: c.name, low: c.low, high: c.high, index: state.panel[i], initial: state.c[i] || 0 }),
    );
    const n = state.panel.length;
    makeKnob(n, { kind: "blend", name: "Blend", low: "home", high: "offer", initial: state.blend });
    makeKnob(n + 1, { kind: "wander", name: "Wander", low: "still", high: "roam", initial: state.wander });
    // Eight columns hold the six and Blend and Wander; a longer panel widens
    // the row by a column a control (a count, not a size).
    deck.style.setProperty("--pf-cols", String(Math.max(8, n + 2)));
    knobs.forEach(paintKnob);
  }
  buildDeck();

  // ---------- placing controls ----------
  // A new panel from the palette: `next` as palette indices, in the player's
  // order. Each control keeps its turn and its wiring, by index. One taken
  // off has its turn folded into the knobs first, so nothing you hear moves.
  // One put on is unmeasured until the panel's set is measured
  // (`measurePanel`), and says listening… meanwhile; the others play on. The
  // deck is never rebuilt under a held pointer: the change waits for the
  // hand to let go (`panelLater`).
  function setPanel(raw) {
    const next = validPanel(raw);
    if (next.join(",") === state.panel.join(",")) return false;
    if (knobs.some((k) => k.held) || xyHeld) {
      state.panelLater = next;
      return true;
    }
    state.panelLater = null;
    const old = state.panel;
    const was = (k) => old.indexOf(k);
    const sameSet = setOf(old).join(",") === setOf(next).join(",");
    const keep = old.map((k) => next.includes(k));
    // A wheel or pressure held on a control taken off is let go: its offset
    // is not folded in (the next value from it lands on nothing).
    for (const [src, x] of state.expr) if (!keep[x.i]) state.expr.delete(src);
    // What a control taken off was doing stays in the knobs, so nothing you
    // hear moves (`foldHidden`).
    if (state.cur && state.wire && keep.some((k) => !k)) {
      const values = state.c.map((c, i) => (keep[i] ? controlValues()[i] : c));
      state.cur.knobs = foldHidden(state.cur.knobs, state.wire, values, keep);
    }
    // The touch control, taken off: velocity moves to the first control left
    // that turns both ways, or plays loudness only, and says which.
    const touchGone = state.touch.i >= 0 && !keep[state.touch.i];
    state.c = next.map((k) => (was(k) >= 0 ? state.c[was(k)] : 0));
    const entries = state.wire;
    state.panel = next;
    if (entries) state.wire = alignWiring(entries);
    for (const [src, x] of state.expr) {
      const j = next.indexOf(old[x.i]);
      if (j < 0) state.expr.delete(src);
      else x.i = j;
    }
    if (touchGone) {
      const both = (i) => turns(state.wire?.[i]) && rangeOf(state.wire[i])[0] < 0 && rangeOf(state.wire[i])[1] > 0;
      const to = preferOrder().find(both);
      state.touch.i = to ?? -1;
      host.note(to != null ? `Touch now plays ${PALETTE[next[to]].name}.` : "Touch plays loudness only: no control left on the panel turns both ways.", { replace: "pf-touch" });
    } else if (state.touch.i >= 0) state.touch.i = next.indexOf(old[state.touch.i]);
    const xi = next.indexOf(old[XY.x]);
    const yi = next.indexOf(old[XY.y]);
    if (xi < 0 || yi < 0) {
      XY.chosen = false;
      const o = preferOrder();
      XY.x = xi >= 0 ? xi : o.find((i) => i !== yi) ?? 0;
      XY.y = yi >= 0 ? yi : o.find((i) => i !== XY.x) ?? XY.x;
    } else [XY.x, XY.y] = [xi, yi];
    state.intent = null;
    host.setPanel?.(next);
    buildDeck();
    fillAxis(xySels.x, "x");
    fillAxis(xySels.y, "y");
    paintXY();
    push();
    sendTouch();
    renderHood();
    renderStatus();
    renderSteps();
    // A new order of the same set is the same measurement: nothing to ask.
    if (!sameSet) measurePanel();
    // After the measurement, so a control placed again on a set measured
    // before reads as the wiring it got at once, never "not measured".
    renderStatus();
    renderHow();
    renderPalette();
    return true;
  }
  function panelLater() {
    if (state.panelLater && !knobs.some((k) => k.held) && !xyHeld) setPanel(state.panelLater);
  }

  // Measure the panel's set on the sound under the hands, lazily: only in
  // sight (a hidden PERFORM measures on `show`), and only what is not known
  // already. A set measured before plays at once and keeps the sound where it
  // is (`applyRechecked`); one not measured yet is asked for in front of
  // background work, because the player is waiting on the control just
  // placed. Each placed control costs its own renders (about five; the
  // Jacobian's are in the engine's memo), so nothing is measured that is not
  // on the panel.
  function measurePanel() {
    if (!state.cur || !state.visible) return;
    if (!state.wire) {
      if (!state.measuring) wire();
      return;
    }
    const set = setOf(state.panel);
    const hit = knownWiring(wireKey(state.cur.json, set));
    if (hit) {
      applyRechecked(structuredClone(hit.data));
      knobs.forEach(paintKnob);
      renderHood();
      renderStatus();
      if (!hit.shipped && hit.rev === wireRev()) return;
    }
    const same = (p) => p.kind === "perform_wire" && p.gen === state.gen && p.cacheAs && !p.cacheAs.nocache && setOf(p.cacheAs.set || PANEL_DEFAULT).join(",") === set.join(",");
    if ([...state.pending.values()].some(same)) return;
    // A measurement of a set the panel left still finishes, for the cache,
    // but behind the player's work (`retire` drops a measurement to the
    // background lane).
    const left = [...state.pending.entries()]
      .filter(([, p]) => p.kind === "perform_wire" && p.gen === state.gen && p.cacheAs && p.cacheAs.set && !same(p))
      .map(([req]) => req);
    if (left.length) host.send({ type: "retire", reqs: left });
    revalidate(!hit && state.wire.some((w) => w.pending));
    knobs.forEach(paintKnob);
    // The palette's signs follow the measurement just asked for.
    renderPalette();
  }

  pad("keep", "Keep", "Make this sound home: Back returns here", keep);
  pad("back", "Back", "Glide back to the last sound you kept", back);
  pad("offer", "Offer", "Grow a variant from here into B", () => requestOffer());
  // The one gesture no other instrument has; it reads as the primary.
  padEls.offer.classList.add("primary");
  pad("take", "Take", "Make the offer in B your sound", take);
  pad(
    "peek",
    "Peek",
    "Hold to hear the offer; let go to come back",
    () => {
      const live = host.live();
      state.peeking = true;
      if (live && state.offer) live.bMix(1);
      else host.note("Nothing offered yet. Press Offer first.", { urgent: true });
    },
    () => {
      state.peeking = false;
      const live = host.live();
      if (live && state.offer) live.bMix(state.blend);
    },
  );
  // "Freeze", not "Hold": the dock's HOLD latches notes, and two buttons
  // named the same thing on one screen doing different jobs is a trap.
  pad("hold", "Freeze", "Freeze wander (tap Wander does the same)", toggleHold);
  padEls.hold.setAttribute("aria-pressed", "false");
  knobs.forEach(paintKnob);
  renderOffer();
  renderStatus();
  renderTouch();

  // ---------- the wander clock ----------
  function wanderTick() {
    if (!state.visible || state.hold || !state.cur || !state.wire || state.wanderGrab) return;
    const now = performance.now();
    if (now < wanderDue()[1]) return;
    const z = wanderZone(state.wander);
    if (z === "ideas" && !state.offer && !inFlight("perform_offer")) requestOffer("wander");
    else if ((z === "drift" || z === "roam") && !state.glide) requestDrift();
    else return;
    state.moveAt = null;
    renderWander();
  }
  setInterval(() => {
    growSpare();
    wanderTick();
  }, 1000);

  // ---------- scope ----------
  function drawScope() {
    requestAnimationFrame(drawScope);
    if (!state.visible) return;
    // The bitmap follows the box it is shown in, at the screen's pixel
    // density, as every canvas in main.js does. The fixed 360×72 was
    // stretched 2× on a retina screen: the trace smeared across four device
    // pixels and peaked at three-quarters of the phosphor.
    const dpr = window.devicePixelRatio || 1;
    const bw = Math.round(scope.clientWidth * dpr);
    const bh = Math.round(scope.clientHeight * dpr);
    if (bw > 0 && bh > 0 && (scope.width !== bw || scope.height !== bh)) {
      scope.width = bw;
      scope.height = bh;
    }
    const live = host.live();
    const an = live && live.analyser;
    const g = scope.getContext("2d");
    g.clearRect(0, 0, scope.width, scope.height);
    if (!an) return;
    const buf = new Float32Array(an.fftSize);
    an.getFloatTimeDomainData(buf);
    g.strokeStyle = host.ink.green;
    g.lineWidth = 1.4 * dpr;
    g.beginPath();
    const n = buf.length;
    for (let i = 0; i < n; i += 4) {
      const x = (i / n) * scope.width;
      const y = scope.height / 2 - buf[i] * scope.height * 0.9;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
  requestAnimationFrame(drawScope);

  return {
    // The row under the title, where booth mode lays its attract band.
    marquee,
    // PATCH's rack changed (a bench reply or a rebuild): the hood's rows are
    // named from it, and an open reaches PERFORM before the rack does.
    rackChanged() {
      if (state.visible) renderHood();
    },
    // For booth attract mode (booth.js): the pads by name, whether a control
    // reaches this patch, whether B holds an offer, and quiet — nothing done
    // while quiet is logged or taught.
    press(name) {
      if (name === "offer") requestOffer("attract");
      else if (name === "take") take();
      else if (name === "keep") keep();
      else if (name === "back") back();
    },
    reaches(i) {
      const w = state.wire && state.wire[i];
      return turns(w);
    },
    // Still waiting on the first measurement of the patch under the hands:
    // its controls do nothing yet.
    measuring: () => state.measuring,
    // PERFORM has a question out to the engine — its own, not a pre-warm's.
    // The worker is one thread, so booth mode's pre-warm waits for these
    // when a player may be at the keys, rather than queueing its seconds of
    // renders in front of whatever the player asks next.
    busy: () => [...state.pending.values()].some((p) => !p.prewarm),
    // Which named controls reach the patch `json`, from its cached wiring:
    // null when it has never been measured.
    reachOf(json) {
      const hit = json ? knownWiring(wireKey(json)) : null;
      return hit ? onPanel(reachOfWiring(hit.data.wiring)) : null;
    },
    // A preset's tree as the pool holds it (uids aside), from the shipped
    // file: what the warm start pre-warms its cards from without inserting
    // them. Null before the file lands, or for a name it does not have.
    shippedTree: (name) => shippedByName.get(name) || null,
    // Measure a patch that is *not* playing, for the cache alone (booth
    // mode's pre-warm, booth.js), and answer with the named controls that
    // reach it — at once when it was measured before. The request is an
    // ordinary `perform_wire` whose reply belongs to no patch (`gen` −1), so
    // it is cached and never applied: the sound under a player's hands is
    // not disturbed by a measurement of something else.
    //
    // `fresh`: a shipped wiring, or one measured before the model's last
    // refit or under another render namespace, is not enough — measure it
    // under this session's model (the warm start's cards, while the player is
    // choosing).
    prewarm(json, { fresh = false } = {}) {
      const key = wireKey(json);
      const hit = fresh ? wireCache.get(key) : knownWiring(key);
      if (hit && (!fresh || hit.rev === wireRev())) return Promise.resolve(onPanel(reachOfWiring(hit.data.wiring)));
      return new Promise((resolve) => {
        const req = request("perform_wire", { tree: json, overrides: [], bg: true });
        const p = state.pending.get(req);
        p.gen = -1;
        p.cacheAs = { json, rev: wireRev() };
        p.prewarm = resolve;
      });
    },
    hasOffer: () => !!state.offer,
    // Explain anything (explain.js, Plan-005 task 10): what the figure of the
    // control at panel position `i` renders. The performed state twice, as
    // knob overrides: `made`, every knob as it sounds with this control at
    // its center, and `turned`, the same with it at `at`, where the player
    // has it or, at the center, a full turn toward the end it opens to (null
    // when nothing turns it). With the control's wiring in words: the knobs
    // it turns, whether it is a search control or not measured yet, the one
    // end it turns toward, and whether a knob is a filter's cutoff. Null
    // before a patch is under PERFORM's hands.
    explainOf(i) {
      const k = knobs[i];
      if (!state.cur || !k || k.spec.kind !== "named") return null;
      const w = state.wire && state.wire[i];
      const vals = controlValues();
      const [lo, hi] = rangeOf(w);
      const v = vals[i] || 0;
      const toward = hi > 0 ? 1 : lo < 0 ? -1 : 0;
      const held = clamp(v, lo, hi);
      const at = Math.abs(held) >= 0.05 ? held : toward;
      const over = (c) => {
        const vv = vals.slice();
        vv[i] = c;
        const out = [...state.cur.knobs.keys()].map((a) => [a, soundingOf(state.cur.knobs.get(a), a, state.wire, vv)]);
        for (const [a, x] of state.hand) if (!state.cur.knobs.has(a)) out.push([a, x]);
        return out;
      };
      const addrs = turns(w) ? w.knobs.map(([a]) => a) : [];
      return {
        i,
        index: indexAt(i),
        tree: state.cur.json,
        value: v,
        at,
        pending: !w || !!w.pending,
        search: !!(w && w.search),
        knobs: addrs.map((a) => knobWord(a, true)),
        cut: addrs.some((a) => a.endsWith("#cut")),
        only: turns(w) && lo === 0 && hi > 0 ? k.spec.high : turns(w) && hi === 0 && lo < 0 ? k.spec.low : "",
        made: over(0),
        turned: turns(w) && at !== 0 ? over(at) : null,
      };
    },
    // The control at panel position `i` explains itself by ear: its sweep
    // through both ends and back (`hearIt`), as a long press does.
    hear(i) {
      const k = knobs[i];
      if (k && k.spec.kind === "named") hearIt(k);
    },
    // The sound in hand as it sounds now, every control where it is: the tree
    // and its knob overrides (the lesson on filters starts from it). Null
    // before a patch is under PERFORM's hands.
    sounding: () => (state.cur ? { tree: state.cur.json, overrides: overrides() } : null),
    // The panel, for MIDI and booth mode: a slot is a position on the deck
    // (the panel's controls in its order, then Blend and Wander).
    controlNames: () => [...controls().map((c) => c.name), "Blend", "Wander"],
    controlName: (i) => (controls()[i] ? controls()[i].name : ""),
    panel: () => state.panel.slice(),
    setPanel,
    openPalette,
    stage: () => !!stageOn,
    openStage,
    closeStage,
    // Re-draw every control (after "Show measurements" changes).
    repaint() {
      knobs.forEach(paintKnob);
    },
    // A key went down (main's note path): the first of the first steps.
    notePlayed() {
      stepDone("play");
    },
    // What PERFORM is playing right now, knob by knob — the kept values plus
    // every control, glide and Wander move on top — for PATCH to draw beside
    // the kept ones. Null before a patch is under PERFORM's hands. PATCH draws
    // a knob as performed only where `movedOn` names a reason.
    performedKnobs() {
      if (!state.cur) return null;
      const out = new Map();
      for (const a of state.cur.knobs.keys()) {
        const v = liveValue(a);
        if (v != null) out.set(a, v);
      }
      return out;
    },
    // Why PERFORM is playing a knob away from the patch (the controls on it,
    // "Wander", "Back"…), or null: what PATCH draws a ghost for, and says.
    movedOn,
    // PATCH turned a knob; PATCH's knob writes landed on the bench.
    knobSet,
    followTree,
    setQuiet(on) {
      state.quiet = !!on;
      // Whatever attract blended in was heard by nobody in particular: an
      // offer it leaves behind starts unheard for the visitor.
      if (!on && state.offer) state.offer.heardMs = 0;
    },
    show() {
      state.visible = true;
      // Back in sight: a first measurement of this patch that `hide` let drop
      // into the engine's background lane is the player's again. (A re-check
      // is background by nature, and stays there.)
      for (const [req, p] of state.pending) {
        if (p.kind === "perform_wire" && p.gen === state.gen && !(p.cacheAs && p.cacheAs.quiet)) {
          host.send({ type: "promote", kind: "perform_wire", req });
        }
      }
      nameEl.textContent = host.label();
      const t = host.liveTree();
      if (t && t.json && (!state.cur || state.cur.json !== t.json)) patchChanged(t.json, t.makeup);
      // The panel as saved, if it arrived after PERFORM was built (the
      // session is restored while the engine boots).
      const saved = validPanel(host.panel ? host.panel() : null);
      if (saved.join(",") !== state.panel.join(",")) setPanel(saved);
      // Measured lazily: a patch that changed while PERFORM was hidden is
      // wired the first time it is looked at, not every time it changed;
      // and a control placed on the panel is measured once it is in sight.
      if (state.cur && !state.wire && !state.measuring) wire();
      else if (state.cur && state.wire && !state.carried && state.wire.some((w) => w.pending)) measurePanel();
      const live = host.live();
      if (live && state.offer) live.bMix(state.blend);
      renderStatus();
      knobs.forEach(paintKnob);
      renderHood();
    },
    // B is PERFORM's: out of sight it is silent, so editing in PATCH never
    // hears a blend it cannot see. The offer itself stays for coming back.
    hide() {
      state.visible = false;
      closePalette(false);
      const live = host.live();
      if (live && state.offer) live.bMix(0);
      // Out of sight, a measurement is nobody's to wait on. It still
      // finishes, and is cached for coming back, but in the engine's
      // background lane, where the player's own long work elsewhere — ⚡, a
      // generation — goes first. The films caught the cost of not doing this:
      // a preset opened while PERFORM was still showing started a measurement
      // that ran on after the view changed to PATCH, and the first knob edit
      // there waited 16 s behind it.
      const measuring = [...state.pending.entries()]
        .filter(([, p]) => p.kind === "perform_wire" && p.gen === state.gen)
        .map(([req]) => req);
      if (measuring.length) host.send({ type: "retire", reqs: measuring });
    },
    ensureWired,
    patchChanged,
    // The live patch was renamed (auto-names follow the pool).
    relabel() {
      nameEl.textContent = host.label();
    },
    onWorker,
    // For MIDI and the keyboard: set a named control (0..5), Blend (6) or
    // Wander (7) from a normalized 0..1 value.
    setControl(i, v01) {
      const k = knobs[i];
      if (!k) return;
      if (k.spec.kind === "wander") wanderGrab();
      else touch();
      ensureWired();
      // A pot takes the pointer from a glide home, as a hand does.
      if (k.tween) cancelAnimationFrame(k.tween), (k.tween = null);
      k.drawn = null;
      k.value = clamp(k.spec.kind === "named" ? v01 * 2 - 1 : v01, ...spanOf(k));
      paintKnob(k);
      onKnob(k, true);
      // A pot has no "let go": the gesture ends when it goes quiet.
      clearTimeout(k.keyTimer);
      k.keyTimer = setTimeout(() => onRelease(k), 450);
    },
    // The control's position as 0..1, what a MIDI pot is compared against
    // for pickup.
    // Expression from `src` on control i (0..5): 0..1 pushes toward its high
    // end, and 0 is exactly where the player left it. A null src clears every
    // source (reset-all-controllers, a device leaving).
    setExpression(src, i, v01) {
      if (src == null) state.expr.clear();
      else if (!v01) state.expr.delete(src);
      else state.expr.set(src, { i, v: clamp(v01, 0, 1) });
      if (state.cur && state.wire) push();
      else if (v01) ensureWired();
    },
    getControl(i) {
      const k = knobs[i];
      if (!k) return 0.5;
      return k.spec.kind === "named" ? (k.value + 1) / 2 : k.value;
    },
    pad(key) {
      ({ keep, back, offer: () => requestOffer(), take, hold: toggleHold })[key]?.();
    },
  };
}
