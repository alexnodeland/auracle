// PERFORM — the instrument as something you play rather than something you
// edit. Eight controls with fixed names, a Wander dial, and six pads.
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

const NS = "http://www.w3.org/2000/svg";
const KNOB_MAX = 1 - 1e-6;
// Wander landmarks on the dial's 0..1 travel.
const WANDER_OFFER = 0.15;
const WANDER_DRIFT = 0.4;
const WANDER_ROAM = 0.75;
// Hands on, it waits: no autonomous move within this long of a touch.
const HANDS_OFF_MS = 3500;
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
  if (!w || w.search) return [0, 0];
  const ok = (m) => m == null || m >= HALF_OPEN;
  return [ok(w.down) ? -1 : 0, ok(w.up) ? 1 : 0];
}
// The named controls a wiring reaches: the ones `reaches(i)` says yes to.
const reachOfWiring = (wiring) =>
  (wiring || []).map((w, i) => (w && !w.search ? i : -1)).filter((i) => i >= 0);
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
  if (w < WANDER_OFFER) return "still";
  if (w < WANDER_DRIFT) return "offer";
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
  const state = {
    home: null,
    cur: null,
    wire: null, // [{name, low, high, knobs:[[addr,gain]], purity, reach, position, search}]
    grafted: new Set(), // control names already given a module on this patch
    intent: null, // {i, dir, at}: a turn waiting on its graft to be measured
    c: [0, 0, 0, 0, 0, 0],
    sent: new Map(), // addr -> value last written to the voices
    wander: 0,
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

  // ---------- layout ----------
  const head = el("div", "pf-head");
  const title = el("div", "pf-title");
  const nameEl = el("div", "pf-name", "—");
  const statusEl = el("div", "pf-status mono", "");
  title.append(nameEl, statusEl);
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
    s.append(
      svg("circle", { r: 44 }, "pf-k-ring"),
      svg("path", { d: "" }, "pf-k-arc"),
      svg("circle", { r: 34 }, "pf-k-body"),
      svg("line", { x1: 0, y1: -12, x2: 0, y2: -30 }, "pf-k-ptr"),
      svg("circle", { r: 3.2, cx: 0, cy: -44 }, "pf-k-where"),
    );
    const name = el("div", "pf-k-name", spec.name);
    const ends = el("div", "pf-k-ends mono", `${spec.low} · ${spec.high}`);
    const sub = el("div", "pf-k-sub mono", "");
    wrap.append(s, name, ends, sub);
    wrap.tabIndex = 0;
    wrap.setAttribute("role", "slider");
    wrap.setAttribute("aria-label", spec.name);
    wrap.setAttribute("aria-valuemin", "-1");
    wrap.setAttribute("aria-valuemax", "1");
    const k = { i, spec, wrap, svg: s, sub, value: spec.initial || 0 };
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

  function paintKnob(k) {
    if (k.spec.kind === "named" && typeof paintXY === "function" && (k.i === XY.x || k.i === XY.y)) queueMicrotask(paintXY);
    const bipolar = k.spec.kind === "named" || k.spec.kind === "blend-bipolar";
    const v = k.value;
    const a = angleOf(v, bipolar);
    k.svg.querySelector(".pf-k-ptr").setAttribute("transform", `rotate(${a})`);
    k.svg.querySelector(".pf-k-arc").setAttribute("d", arcPath(bipolar ? 0 : -135, a));
    k.wrap.setAttribute("aria-valuenow", v.toFixed(2));
    const where = k.svg.querySelector(".pf-k-where");
    if (k.spec.kind === "named") {
      const w = state.wire && state.wire[k.i];
      const search = !w || w.search;
      k.wrap.classList.toggle("search", !!(w && w.search));
      k.wrap.classList.toggle("unwired", !w);
      if (w) {
        // Where the sound measures on this axis: z through a soft squash onto
        // the dial's travel, so "very bright for this bank" sits near the stop.
        const pos = Math.tanh(w.position / 2);
        const [x, y] = polar(pos * 135);
        where.setAttribute("cx", x.toFixed(2));
        where.setAttribute("cy", y.toFixed(2));
        where.style.display = "";
        const [lo, hi] = rangeOf(w);
        k.wrap.classList.toggle("half-lo", !search && lo === 0);
        k.wrap.classList.toggle("half-hi", !search && hi === 0);
        // Short enough for the cell at 1280 px: a caption cut off with an
        // ellipsis reads as broken, whatever it was going to say.
        k.sub.textContent = search
          ? "turn to ask for it"
          : lo === 0
            ? `at the ${w.low} end`
            : hi === 0
              ? `at the ${w.high} end`
              : knobWords(w.knobs.map(([a]) => a));
        // A sentence a player can read, not the measurement: addresses,
        // purity and σ are the engineer's, and live in the docs and the
        // under-the-hood strip, not on the knob.
        k.wrap.title = search
          ? `${w.name}: nothing in this patch makes it ${w.high} without changing something else. Turn it and it grows a variant that can.`
          : `${w.name}: ${w.knobs.map(([a, g]) => `${g >= 0 ? "raises" : "lowers"} ${knobWord(a, true)}`).join(", ")} as you turn it toward ${w.high}. Long-press to hear it.`;
        // The engineer's view, on request (⋯ → Show measurements): what the
        // measurement actually said, in its own units.
        if (host.engineer?.()) {
          const halves = w.down != null ? `measured −${w.down.toFixed(2)}σ / +${w.up.toFixed(2)}σ` : `${w.reach.toFixed(2)}σ predicted`;
          k.wrap.title += `\n\npurity ${w.purity.toFixed(2)} · reach ${w.reach.toFixed(2)}σ · ${halves} · at ${w.position.toFixed(2)}σ\n${w.knobs.map(([a, g]) => `${a} ${g >= 0 ? "+" : "−"}${Math.abs(g).toFixed(2)}`).join("  ")}`;
        }
      } else {
        where.style.display = "none";
        k.sub.textContent = state.measuring ? "measuring…" : "";
      }
      k.wrap.setAttribute("aria-valuetext", `${v >= 0 ? k.spec.high : k.spec.low} ${Math.round(Math.abs(v) * 100)}%`);
    } else if (k.spec.kind === "wander") {
      where.style.display = "none";
      const z = wanderZone(v);
      k.sub.textContent = state.hold ? "held" : z;
      k.wrap.classList.toggle("held", state.hold);
      k.wrap.setAttribute("aria-valuetext", state.hold ? "held" : z);
    } else if (k.spec.kind === "blend") {
      where.style.display = "none";
      k.sub.textContent = state.offer ? `${Math.round(v * 100)}% offer` : "no offer yet";
      k.wrap.classList.toggle("unwired", !state.offer);
      k.wrap.setAttribute("aria-valuetext", `${Math.round(v * 100)} percent offer`);
    }
  }

  // Where a control's dial may sit. A named control stops at the centre on a
  // half its wiring closed, as the sound already did (liveValue): the dial
  // used to turn on past it, drawing an arc on the closed side that nothing
  // played, and the next drag then started from a value the sound had never
  // had. A search control turns both ways, because turning it is how you ask,
  // and so does one whose wiring has not been measured yet.
  function spanOf(k) {
    if (k.spec.kind !== "named") return [0, 1];
    const w = state.wire?.[k.i];
    if (!w || w.search) return [-1, 1];
    const [lo, hi] = rangeOf(w);
    return lo === hi ? [-1, 1] : [lo, hi];
  }

  function bindDrag(k) {
    let startY = 0;
    let startV = 0;
    let pressT = 0;
    let moved = false;
    let hearTimer = null;
    const lo = () => (k.spec.kind === "named" ? -1 : 0);
    const set = (v, fine) => {
      k.value = clamp(v, ...spanOf(k));
      // A light detent at the centre of a bipolar control: home is findable
      // by feel.
      if (k.spec.kind === "named" && !fine && Math.abs(k.value) < 0.03) k.value = 0;
      paintKnob(k);
      onKnob(k);
    };
    k.wrap.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      k.wrap.focus({ preventScroll: true });
      k.wrap.setPointerCapture(e.pointerId);
      startY = e.clientY;
      startV = k.value;
      pressT = performance.now();
      moved = false;
      touch();
      if (k.spec.kind === "named") {
        hearTimer = setTimeout(() => {
          if (!moved) hearIt(k);
        }, 550);
      }
    });
    k.wrap.addEventListener("pointermove", (e) => {
      if (!k.wrap.hasPointerCapture(e.pointerId)) return;
      const dy = startY - e.clientY;
      if (Math.abs(dy) > 3) moved = true;
      const span = e.shiftKey ? 900 : 180;
      set(startV + (dy / span) * (1 - lo()), e.shiftKey);
      touch();
    });
    const end = (e) => {
      clearTimeout(hearTimer);
      if (k.wrap.hasPointerCapture(e.pointerId)) k.wrap.releasePointerCapture(e.pointerId);
      if (moved) onRelease(k);
      else if (performance.now() - pressT < 300 && k.spec.kind === "wander") toggleHold();
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
      touch();
      // A run of arrow presses is one gesture: logged, and a search control
      // asked, once the keys go quiet.
      clearTimeout(k.keyTimer);
      k.keyTimer = setTimeout(() => onRelease(k), 450);
    });
  }

  // Wander waits HANDS_OFF_MS after any touch; the status line says so for
  // that long, and says Wander's zone again when it resumes. Only a glide
  // interrupted mid-way used to say "paused", so a touch between moves left
  // the line reading "wander: roam" while nothing moved.
  let pausedTimer = null;
  function touch() {
    const was = handsOn();
    state.lastTouch = performance.now();
    if (!was && wanderZone(state.wander) !== "still" && !state.hold) renderStatus();
    clearTimeout(pausedTimer);
    pausedTimer = setTimeout(() => renderStatus(), HANDS_OFF_MS + 20);
  }
  function handsOn() {
    return performance.now() - state.lastTouch < HANDS_OFF_MS;
  }

  // ---------- the sound ----------
  function liveValue(addr) {
    const base = state.cur.knobs.get(addr);
    if (base == null) return null;
    let v = base;
    if (state.wire) {
      state.wire.forEach((w, i) => {
        let p = 0;
        for (const x of state.expr.values()) if (x.i === i) p += x.v;
        if (w.search || !(state.c[i] + p)) return;
        const [lo, hi] = rangeOf(w);
        const c = clamp(state.c[i] + p, lo, hi);
        for (const [a, g] of w.knobs) if (a === addr) v += c * g;
      });
    }
    return clamp(v, 0, KNOB_MAX);
  }

  function overrides() {
    if (!state.cur) return [];
    return [...state.cur.knobs.keys()].map((a) => [a, liveValue(a)]);
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

  // Send the touch wiring: the chosen control's knobs, their gains and where
  // they sit now. Off, or a control this patch cannot reach, sends nothing to
  // play — velocity is then loudness only, as it always was.
  function sendTouch() {
    const live = host.live();
    const w = state.wire && state.touch.i >= 0 ? state.wire[state.touch.i] : null;
    const [lo, hi] = rangeOf(w);
    state.touch.sites =
      w && !w.search && lo < 0 && hi > 0 ? w.knobs.map(([a, g]) => [a, g, liveValue(a) ?? 0]) : [];
    if (live && live.touch) live.touch(state.touch.sites, state.touch.depth);
    renderTouch();
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
    host.controls.forEach((c, i) => {
      const w = state.wire && state.wire[i];
      const [lo, hi] = rangeOf(w);
      const o = document.createElement("option");
      o.value = String(i);
      o.textContent = `${c.name.toLowerCase()} — soft ${c.low}, hard ${c.high}`;
      o.disabled = !w || w.search || lo === 0 || hi === 0;
      if (i === state.touch.i) o.selected = true;
      sel.append(o);
    });
    if (state.touch.i < 0) off.selected = true;
    sel.onchange = () => {
      state.touch.i = Number(sel.value);
      sendTouch();
    };
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

  function onKnob(k, fromMidi) {
    if (!fromMidi) host.controlMoved?.(k.i);
    if (k.spec.kind === "named") {
      state.c[k.i] = k.value;
      const w = state.wire && state.wire[k.i];
      if (w && !w.search) {
        push();
        if (Math.abs(k.value) > 0.2) stepDone("turn");
      }
    } else if (k.spec.kind === "blend") {
      state.blend = k.value;
      const live = host.live();
      if (live && state.offer) live.bMix(state.blend);
    } else if (k.spec.kind === "wander") {
      state.wander = k.value;
      renderStatus();
    }
  }

  function onRelease(k) {
    if (k.spec.kind !== "named") return;
    const w = state.wire && state.wire[k.i];
    if (w && w.search && Math.abs(k.value) > 0.3) {
      // Honest about what happens: this patch cannot make the sound the label
      // names by turning knobs. If one change would give it something to turn
      // (see GRAFTS), that change goes in as one undo step on the bench, and
      // the control is measured again and set where the hand left it.
      // Otherwise the gesture becomes a request for a patch that can: the
      // control springs back and the offer arrives in B.
      const up = k.value > 0;
      k.value = 0;
      state.c[k.i] = 0;
      paintKnob(k);
      const graft = GRAFTS[w.name];
      if (graft && (up || w.name !== "Space") && !state.grafted.has(w.name) && !inFlight("perform_graft")) {
        state.grafted.add(w.name);
        state.intent = { i: k.i, dir: up ? 1 : -1, at: performance.now() };
        host.note(`${w.name}: giving it a ${graft} to turn…`);
        request("perform_graft", { tree: state.cur.json, overrides: overrides(), k: k.i });
      } else {
        host.note(`${w.name}: no knobs here make it ${up ? w.high : w.low} — growing an offer instead`);
        requestOffer(`${w.name.toLowerCase()} ${up ? "up" : "down"}`);
      }
    }
    logImplicit("perform_turn", { control: k.spec.name, value: +k.value.toFixed(3) });
  }

  // Long-press: the control explains itself by ear. A two-second sweep
  // through both ends and back, on a held note if there is none already.
  function hearIt(k) {
    const w = state.wire && state.wire[k.i];
    if (!w || w.search) {
      host.note(w ? `${w.name} isn't in this patch's knobs — turn it to ask for a variant` : "still measuring this patch");
      return;
    }
    const start = k.value;
    const playing = host.heldCount() > 0;
    if (!playing) host.noteOn(48, 0.8);
    const t0 = performance.now();
    const D = 2400;
    const path = (u) => (u < 0.25 ? -4 * u : u < 0.75 ? -1 + 4 * (u - 0.25) : 1 - 4 * (u - 0.75)) ;
    const tick = () => {
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
  // the standardizer the wiring is expressed in).
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
  // Keyed by what the patch *is*, not by the bytes it arrived as. A tree's
  // JSON carries its node uids, and the pool mints those per session
  // (`Uid::mint`, one process-wide counter), so the same preset loaded after
  // a reload — or re-admitted after an eviction — came back as different
  // bytes and missed a measurement the cache already held: a booth's demo
  // set said "measuring…" again after every visitor reset. The wiring itself
  // is uid-free (its knobs are trace addresses), and the engine already
  // treats two trees that differ only in uids as the same patch.
  function wireKey(json) {
    try {
      return JSON.stringify(JSON.parse(json), (k, v) => (k === "uid" ? undefined : v));
    } catch {
      return json;
    }
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
  let wireSaveTimer = null;
  function rememberWiring(json, data, rev) {
    const key = wireKey(json);
    wireCache.delete(key);
    while (wireCache.size >= WIRE_CACHE_MAX) wireCache.delete(wireCache.keys().next().value);
    wireCache.set(key, { data: structuredClone(data), rev });
    clearTimeout(wireSaveTimer);
    wireSaveTimer = setTimeout(() => {
      try {
        localStorage.setItem(WIRE_STORE, JSON.stringify([...wireCache]));
      } catch {
        // Quota or a private window: the cache is a convenience, never
        // load-bearing. Halve it and carry on in memory.
        const keep = [...wireCache].slice(-Math.floor(WIRE_CACHE_MAX / 2));
        wireCache.clear();
        keep.forEach(([k, v]) => wireCache.set(k, v));
      }
    }, 1500);
  }

  function wire() {
    if (!state.cur) return;
    const first = state.cur.knobs.size === 0;
    const key = first ? wireKey(state.cur.json) : null;
    const hit = first ? wireCache.get(key) : null;
    if (hit) {
      // A hit is a use: it moves to the young end, so the patches played
      // most — a booth's demo set, round every few minutes — are the last
      // ones the cache lets go.
      wireCache.delete(key);
      wireCache.set(key, hit);
      applyWired(structuredClone(hit.data));
      knobs.forEach(paintKnob);
      renderHood();
      if (hit.rev === tasteRev()) return;
      // Playable now; the fresh measurement lands when it lands.
      if (!heldForOpen("revalidate")) revalidate();
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
    const req = request("perform_wire", { tree: state.cur.json, overrides: overrides() });
    if (first) state.pending.get(req).cacheAs = { json: state.cur.json, rev: tasteRev() };
  }

  function revalidate() {
    state.revalidating = true;
    renderStatus();
    // Background (`bg`): the patch is already playable from its last
    // measurement, so this waits behind anything the player asks for.
    const req = request("perform_wire", { tree: state.cur.json, overrides: [], bg: true });
    state.pending.get(req).cacheAs = { json: state.cur.json, rev: tasteRev(), quiet: true };
  }

  // A patch on its way out is not measured. A measurement is one engine call
  // of 10-30 s on the one worker, and it cannot be interrupted once started:
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
    if (state.heldWire && !host.opening?.()) releaseHeld();
    // An open began or ended somewhere else in the app: say so here.
    const incoming = host.opening?.() ? host.openingName?.() || null : null;
    if (state.visible && incoming !== (state.incoming || null)) renderStatus();
    if (state.deferredWire && performance.now() - state.lastTouch >= 1500) {
      const d = state.deferredWire;
      state.deferredWire = null;
      applyWired(d);
      knobs.forEach(paintKnob);
      renderHood();
    }
    const o = state.offer;
    if (!o || !state.visible) return;
    if ((state.peeking || state.blend >= 0.5) && host.heldCount() > 0) o.heardMs = (o.heardMs || 0) + 250;
  }, 250);

  function answerOffer(took) {
    const o = state.offer;
    if (state.quiet || !o || !state.cur || (o.heardMs || 0) < HEARD_MS) return;
    const pick = { tree: state.cur.json, overrides: overrides(), offer: o.json, took };
    if (!took) {
      sendAnswer(pick);
      host.note("Passed on B — that counts as a pick for what you had.");
      return;
    }
    // A take waits out a short window: taking something to hear it in place
    // is not always a verdict, and the toast says how to say so.
    let dropped = false;
    const t = setTimeout(() => { if (!dropped) sendAnswer(pick); }, TAKE_SETTLE_MS);
    host.note("Took B — that counts as a pick over what you had.", {
      undo: () => { dropped = true; clearTimeout(t); },
      undoLabel: "don't count it",
    });
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
  function growSpare() {
    const now = performance.now();
    if (!state.visible || !state.cur || !state.wire || state.spare || state.offer) return;
    if (state.pending.size > 0 || state.glide) return;
    // No spare for a patch on its way out, either (see `heldForOpen`).
    if (host.opening?.()) return;
    if (now - (state.changedAt || 0) < SPARE_STEADY_MS || now - state.playableAt < SPARE_PLAYABLE_MS) return;
    if (now - state.lastTouch < 2000) return;
    // Nobody has asked for it yet, so it waits behind anything that is asked
    // for (`bg`), and is promoted the moment Offer claims it.
    const req = request("perform_offer", { tree: state.cur.json, overrides: overrides(), locks: host.locks(), steps: 20, bg: true });
    state.pending.get(req).spare = { at: new Map([...state.cur.knobs.keys()].map((a) => [a, liveValue(a)])) };
  }

  function presentOffer(offer) {
    state.offer = {
      json: JSON.stringify(offer.tree),
      makeup: offer.makeup,
      taste: !!offer.taste,
      changes: host.describeDiff && offer.diff ? host.describeDiff(offer.diff) : "",
    };
    const live = host.live();
    if (live) {
      live.bPatch(state.offer.json, state.offer.makeup);
      live.bMix(state.visible ? state.blend : 0);
    }
    renderOffer();
    knobs.forEach(paintKnob);
    logImplicit("perform_offer", { why: state.offerWhy || "" });
  }

  function requestDrift() {
    if (!state.cur || state.glide || inFlight("perform_drift")) return;
    const pace = wanderPace(state.wander);
    state.lastMove = performance.now();
    request("perform_drift", {
      tree: state.cur.json,
      overrides: overrides(),
      locks: host.locks(),
      steps: pace.steps,
      sigma: pace.sigma,
    });
    renderStatus("walking…");
  }

  // Asking for another offer is passing on the one in B, and the offer passed
  // on leaves B (it fades out). It used to stay there, playable and takeable,
  // while the next one grew: a player could Take the very sound they had just
  // passed on, and a Take landing just after the next offer arrived was
  // counted as an unheard answer to *that* one.
  function passOffer() {
    answerOffer(false);
    state.offer = null;
    const live = host.live();
    if (live) live.bClear();
  }

  function requestOffer(why) {
    if (!state.cur) return;
    if (state.offer) passOffer();
    const growingAt = [...state.pending.entries()].find(([, q]) => q.kind === "perform_offer" && q.gen === state.gen);
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
    state.offerWhy = why || "";
    if (why !== "wander" && why !== "attract") stepDone("offer");
    // A spare grown ahead from this sound is handed over at once; one still
    // growing is claimed, and lands in B the moment it is done.
    if (state.spare && spareFresh(state.spare)) {
      const sp = state.spare;
      state.spare = null;
      presentOffer(sp.offer);
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
    request("perform_offer", { tree: state.cur.json, overrides: overrides(), locks: host.locks(), steps, bg });
    renderOffer("growing an offer…");
  }

  // A measurement arrived (or came out of the cache): wire the controls.
  function applyWired(data) {
    state.measuring = false;
    // Where the sound is *now* becomes the new centre and the controls
    // return to zero there, so nothing audibly moves. Now, not when the
    // measurement was asked for: the player may have kept turning while
    // it rendered, and the old wiring's deltas are folded in before it is
    // replaced. A knob this patch had not been measured on yet takes the
    // value the measurement read.
    const had = state.cur.knobs;
    const here = new Map(data.addrs.map((a, i) => [a, had.has(a) ? liveValue(a) : data.values[i]]));
    state.cur.knobs = here;
    state.wiredAt = new Map(here);
    state.playableAt = performance.now();
    state.c = state.c.map(() => 0);
    knobs.forEach((k) => {
      if (k.spec.kind === "named") {
        k.value = 0;
        host.controlMoved?.(k.i);
      }
    });
    state.wire = data.wiring;
    if (state.home && !state.home.knobs) state.home.knobs = new Map(state.cur.knobs);
    // Touch follows the player's choice if this patch can play it, and
    // otherwise falls back to the first control it can (Bright, Snap,
    // Motion…) rather than silently doing nothing.
    const playable = (i) => {
      const w = state.wire[i];
      const [lo, hi] = rangeOf(w);
      return w && !w.search && lo < 0 && hi > 0;
    };
    if (state.touch.i >= 0 && !playable(state.touch.i)) {
      const first = state.wire.findIndex((_, i) => playable(i));
      if (first >= 0) state.touch.i = first;
    }
    sendTouch();
    renderStatus();
    // A graft was asked for by a turn: finish the gesture on the new patch.
    const it = state.intent;
    if (it && performance.now() - it.at < 30_000) {
      state.intent = null;
      const w = state.wire[it.i];
      const k = knobs[it.i];
      const [lo, hi] = rangeOf(w);
      if (w && k && !w.search && (it.dir > 0 ? hi > 0 : lo < 0)) {
        k.value = 0.5 * it.dir;
        state.c[it.i] = k.value;
        push();
        paintKnob(k);
        host.note(`${w.name} now turns ${w.knobs.map(([a]) => knobWord(a, true)).join(" and ")}`);
      } else if (w) {
        host.note(`${w.name}: the ${GRAFTS[w.name] || "graft"} did not reach it here — growing an offer instead`);
        requestOffer(`${w.name.toLowerCase()} ${it.dir > 0 ? "up" : "down"}`);
      }
    }
  }

  function onWorker(m) {
    const p = state.pending.get(m.req);
    if (!p) return false;
    state.pending.delete(m.req);
    const then = state.applyThen.get(m.req);
    state.applyThen.delete(m.req);
    // A measurement is kept even when the player has already moved on: it
    // is still true of that patch, and flicking back is the common case.
    if (p.cacheAs && m.type === "perform_wired" && m.data) rememberWiring(p.cacheAs.json, m.data, p.cacheAs.rev);
    // A pre-warm (see `prewarm` below) was for the cache alone: it answers its
    // caller and goes no further, whatever is sounding when it lands.
    if (p.prewarm) {
      if (m.error) console.warn("[perform] prewarm:", m.error);
      p.prewarm(m.type === "perform_wired" && m.data ? reachOfWiring(m.data.wiring) : null);
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
      if (p.cacheAs && p.cacheAs.quiet) {
        // A background re-measurement of a patch already playing from its
        // last one: never clears a working wiring, and never re-centres the
        // controls under a moving hand — it waits for a pause.
        state.revalidating = false;
        if (m.data) {
          if (performance.now() - state.lastTouch < 1500) state.deferredWire = m.data;
          else applyWired(m.data);
        } else if (p.cacheAs.carried) {
          // A wiring borrowed from another sound is not this patch's: with no
          // measurement to replace it, it goes rather than lingering.
          state.wire = null;
          renderStatus("could not measure this patch");
        }
        knobs.forEach(paintKnob);
        renderHood();
        renderStatus();
        return true;
      }
      if (!m.data) {
        state.measuring = false;
        state.wire = null;
        renderStatus(m.error ? "could not measure this patch" : "the taste model has not seen enough patches to measure against yet");
      } else {
        applyWired(m.data);
      }
      knobs.forEach(paintKnob);
      renderHood();
      return true;
    }
    if (m.type === "perform_drifted") {
      // Hands came on while the walk ran: the player's sound wins, and the
      // proposal (made from where the knobs were) is dropped.
      if (state.lastTouch > p.at) return true;
      if (!m.drift || !m.drift.tree) {
        renderStatus(whyNot(m, m.drift, "nothing nearby it likes better — staying"));
        return true;
      }
      const pace = wanderPace(state.wander);
      startGlide(new Map(m.drift.knobs), JSON.stringify(m.drift.tree), pace.glide);
      renderStatus(m.drift.taste ? "drifting toward your taste" : "drifting through the grammar — no taste yet");
      return true;
    }
    if (m.type === "perform_offered") {
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
        renderOffer(whyNot(m, m.offer, "no offer beat this patch — try again, or loosen a lock"));
        return true;
      }
      presentOffer(m.offer);
      return true;
    }
    if (m.type === "perform_grafted") {
      const t = m.graft && m.graft.tree;
      if (!t) {
        const i = state.intent ? state.intent.i : -1;
        state.intent = null;
        const w = state.wire && state.wire[i];
        if (w) {
          host.note(`${w.name}: nothing to add here — growing an offer instead`);
          requestOffer(`${w.name.toLowerCase()}`);
        }
        return true;
      }
      // Committed like Keep: one undo step on the bench, and the patch comes
      // back through patchChanged to be measured.
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
    if (state.cur && state.cur.json === json) {
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
      wire();
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
    const carried =
      taken && Array.isArray(liveKnobs) && liveKnobs.length ? carryWiring(taking.wire, liveKnobs) : null;
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
      state.wire = carried;
      state.playableAt = performance.now();
      // The offer was grown from the performed sound, controls and all, so
      // the taken tree already contains their deltas: they read zero on it.
      state.c = state.c.map(() => 0);
      knobs.forEach((k) => {
        if (k.spec.kind === "named") {
          k.value = 0;
          host.controlMoved?.(k.i);
        }
      });
      sendTouch();
      state.revalidating = true;
      const req = request("perform_wire", { tree: json, overrides: [] });
      state.pending.get(req).cacheAs = { json, rev: tasteRev(), quiet: true, carried: true };
      renderStatus();
    } else if (state.visible) wire();
    knobs.forEach(paintKnob);
    renderHood();
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
  // nothing to turn until the measurement says otherwise.
  function carryWiring(wire, list) {
    const live = new Set(list.map(([a]) => a));
    return wire.map((w) => {
      if (!w || w.search) return w;
      const kept = w.knobs.filter(([a]) => live.has(a));
      return kept.length ? { ...w, knobs: kept } : { ...w, knobs: [], search: true };
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
    if (m.error) return "the walk failed on this patch — try again";
    if (r && r.reason === "outside_support")
      return "this patch is outside what evolution can start from — nudge any knob off its stop and try again";
    return otherwise;
  }

  // ---------- glides (drift and back) ----------
  function startGlide(to, json, seconds) {
    const from = new Map();
    for (const a of state.cur.knobs.keys()) from.set(a, liveValue(a));
    // The controls' deltas are part of where the glide starts; fold them into
    // the base so the controls read zero at the destination.
    // A copy: the glide writes into cur.knobs every frame and must keep
    // reading its fixed starting point from `from`.
    state.cur.knobs = new Map(from);
    state.c = state.c.map(() => 0);
    knobs.forEach((k) => {
      if (k.spec.kind === "named") {
        k.value = 0;
        paintKnob(k);
        host.controlMoved?.(k.i);
      }
    });
    state.glide = { from, to, t0: performance.now(), dur: Math.max(0.2, seconds) * 1000, json };
    renderStatus("gliding");
    requestAnimationFrame(stepGlide);
  }

  function stepGlide() {
    const g = state.glide;
    if (!g) return;
    // Hands on, it waits: a touch mid-glide stops it where it is, and the
    // sound stays there. It never snaps back or finishes on its own.
    if (performance.now() - state.lastTouch < 60 && performance.now() - g.t0 > 60) {
      state.glide = null;
      renderStatus("paused — your hands are on it");
      if (outsideTrust()) wire();
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
      if (outsideTrust()) wire();
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
      if (!w.search) w.knobs.forEach(([a]) => add(a));
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
    const key = addrs.join("|");
    if (key === hoodKey) return paintHood();
    hoodKey = key;
    hood.innerHTML = "";
    hoodRows = new Map();
    if (!addrs.length) return;
    const h = el("div", "pf-hood-h", "under the hood");
    h.title =
      "The patch's own knobs these controls are turning right now. Click one to open it in PATCH — which shows the kept sound until you press Keep.";
    hood.append(h);
    const grid = el("div", "pf-hood-grid");
    for (const a of addrs) {
      const info = host.knobInfo ? host.knobInfo(a, 0) : { module: "", label: a };
      const row = el("button", "pf-hood-row");
      row.type = "button";
      row.title = `${info.module} ${info.label} — open in PATCH (it shows the kept value until you Keep)`;
      const name = el("span", "pf-hood-name");
      name.append(el("span", "pf-hood-mod", info.module), document.createTextNode(` ${info.label}`));
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

  function keep() {
    if (!state.cur) return;
    applyThen((json) => {
      if (!json || json === "null") return;
      const here = new Map(overrides());
      logImplicit("perform_keep", { controls: state.c.map((x) => +x.toFixed(3)) });
      // The sound does not change, so neither does anything playing it: the
      // controls' deltas fold into the centre, the offer in B stays, and the
      // wiring is refreshed around the new centre in the background.
      state.cur.knobs = here;
      state.c = state.c.map(() => 0);
      knobs.forEach((k) => {
        if (k.spec.kind === "named") {
          k.value = 0;
          paintKnob(k);
          host.controlMoved?.(k.i);
        }
      });
      state.home = { json, makeup: state.cur.makeup, knobs: new Map(here) };
      state.keeping = json;
      host.commitTree(json);
      host.note("kept — this is home now");
      flash("keep");
    });
  }

  function back() {
    if (!state.home || !state.home.knobs) return;
    logImplicit("perform_back", {});
    if (state.home.json !== state.cur.json && structureDiffers(state.home.json, state.cur.json)) {
      host.commitTree(state.home.json);
      return;
    }
    startGlide(new Map(state.home.knobs), state.home.json, 1.2);
    flash("back");
  }

  // Two trees share a structure when they carry the same knob addresses; a
  // glide is only honest between those. (Values differ; addresses do not.)
  function structureDiffers(a, b) {
    const shape = (j) => j.replace(/-?\d+(\.\d+)?(e-?\d+)?/g, "#");
    return shape(a) !== shape(b);
  }

  function take() {
    if (!state.offer) return host.note("nothing offered yet — press Offer, or turn Wander up");
    logImplicit("perform_take", { why: state.offerWhy || "" });
    answerOffer(true);
    const json = state.offer.json;
    // B keeps sounding until A has rebuilt as the offer, then fades out: at
    // any Blend position the handover has no gap and no jump.
    state.offer = null;
    const live = host.live();
    if (live) live.bClear({ afterSwap: true });
    // …and Blend comes home. What was in B *is* A now, and B is empty: left
    // turned toward "offer", the next offer would sound at that level the
    // moment it arrived, over the sound the player just chose.
    const blend = knobs.find((k) => k.spec.kind === "blend");
    if (blend) {
      blend.value = 0;
      state.blend = 0;
      host.controlMoved?.(blend.i);
    }
    // The controls stay under the hands through the handover (see
    // `patchChanged`): the wiring measured on the sound being left carries
    // over to the one taken until the offer's own measurement lands.
    // Keyed by the taken tree itself (uids aside, see `wireKey`): a Take the
    // bench refuses must not lend its wiring to whatever patch comes next. The
    // wiring is the one under the hands now, kept here because an edit still
    // in flight can land first and clear it.
    if (state.wire) state.taking = { at: performance.now(), key: treeShape(json), wire: state.wire };
    renderOffer();
    knobs.forEach(paintKnob);
    host.commitTree(json, "taken offer");
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
    renderStatus();
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
  function renderStatus(msg) {
    const z = wanderZone(state.wander);
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
    else if (state.heldWire === "measure") parts.push("opening the patch you picked…");
    else if (state.measuring) parts.push("measuring how this patch moves…");
    else if (state.wire) {
      const n = state.wire.filter((w) => !w.search).length;
      parts.push(`${n} of ${state.wire.length} controls reach this patch`);
      if (state.revalidating) parts.push("re-checking");
    }
    if (state.hold) parts.push("wander held");
    else if (z !== "still" && handsOn() && !/^paused/.test(msg || "")) parts.push("paused — your hands are on it");
    else if (z !== "still") parts.push(`wander: ${z}`);
    statusEl.textContent = parts.join(" · ");
  }

  function renderOffer(msg) {
    offerCard.innerHTML = "";
    const lab = el("div", "pf-offer-label mono", "B");
    const body = el("div", "pf-offer-body");
    if (msg) body.textContent = msg;
    else if (state.offer) {
      const src = state.offer.taste ? "grown toward your taste" : "drawn from the grammar — it has not learned your taste yet";
      // What changed first — it is the thing a player decides on — then
      // where it came from, then what to do with it.
      body.innerHTML = "";
      if (state.offer.changes) body.append(el("b", "pf-offer-what", state.offer.changes), document.createTextNode(" · "));
      body.append(document.createTextNode(`${src}${state.offerWhy ? ` (${state.offerWhy})` : ""} — hold Peek to hear it, slide Blend, or Take it`));
    }
    else body.textContent = "no offer — press Offer to grow a variant from here";
    offerCard.classList.toggle("ready", !!state.offer);
    offerCard.append(lab, body);
    // Take and Peek act on an offer; until there is one they look it.
    // Waiting, not broken: a disabled pad says what it is waiting for.
    for (const k of ["take", "peek"]) {
      if (!padEls[k]) continue;
      padEls[k].disabled = !state.offer;
      padEls[k].dataset.wait = state.offer ? "" : "needs an offer";
    }
  }

  why.innerHTML = "";
  const whyBtn = el("button", "pf-why-btn util-btn", "how this works");
  whyBtn.type = "button";
  const whyBody = el("div", "pf-why-body hidden");
  whyBody.innerHTML =
    "<p>Each control is a direction in what the instrument can hear — <b>Bright</b> is spectral centroid and rolloff, <b>Snap</b> is a faster attack and a higher crest, <b>Motion</b> is how much the held note moves across its slow, mid and fast bands. When a patch loads, the instrument nudges every knob once and measures how the sound responds; each control is then wired to the few knobs that move the sound most purely in its direction. Hover a control to see which knobs and how purely.</p>" +
    "<p>A control drawn in amber cannot be reached by this patch's knobs (a patch with no drive cannot get grittier by turning a filter). Turning it asks evolution for a variant that can, which arrives in <b>B</b>.</p>" +
    "<p><b>Wander</b> sets how alive the patch is: <b>still</b>, <b>offer</b> (variants appear in B), <b>drift</b> (knob-only steps of the taste walk, glided, about one per phrase), <b>roam</b> (bigger, faster). Structure never changes on its own. Tap Wander to hold it; touching any control pauses it.</p>";
  whyBtn.onclick = () => {
    whyBody.classList.toggle("hidden");
    whyBtn.setAttribute("aria-expanded", String(!whyBody.classList.contains("hidden")));
  };
  whyBtn.setAttribute("aria-expanded", "false");
  why.append(whyBtn, whyBody);

  // ---------- first steps ----------
  // For someone who walks up to it cold — no staff, no manual. Three moves
  // are the whole loop: play, turn a control, ask for an offer. Each ticks off
  // when it happens (not when it is read), and the strip retires once all
  // three have. Per visitor: the booth's "new visitor" brings it back.
  const STEPS_KEY = "auracle-perform-steps";
  const STEPS = [
    { id: "play", text: "Play a key: A to L, or tap the keybed" },
    { id: "turn", text: "Turn a lit control: BRIGHT is a good start" },
    { id: "offer", text: "Press OFFER, then hold PEEK or TAKE it" },
  ];
  const stepsDone = new Set();
  try {
    for (const id of JSON.parse(localStorage.getItem(STEPS_KEY) || "[]")) stepsDone.add(id);
  } catch {
    /* a per-viewer convenience; an empty set is fine */
  }
  function renderSteps() {
    stepsEl.innerHTML = "";
    if (stepsDone.size >= STEPS.length) {
      stepsEl.classList.add("hidden");
      return;
    }
    const now = STEPS.find((st) => !stepsDone.has(st.id));
    STEPS.forEach((st, i) => {
      const done = stepsDone.has(st.id);
      stepsEl.append(el("span", `pf-step${done ? " done" : ""}${st === now ? " now" : ""}`, `${done ? "✓" : i + 1}  ${st.text}`));
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
  const XY = { x: 0, y: 2, chosen: false };
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
    (host.controls || []).forEach((c, i) => {
      const o = el("option", null, c.name);
      o.value = String(i);
      sel.append(o);
    });
    sel.value = String(XY[axis]);
    sel.onchange = () => {
      XY[axis] = Number(sel.value);
      XY.chosen = true;
      paintXY();
    };
    xySels[axis] = sel;
    return sel;
  };
  xyHead.append(el("span", "pf-xy-cap", "XY"), axisSel("x"), el("span", null, "×"), axisSel("y"));
  xy.append(xyHead, xyField);

  const xyReach = (i) => {
    const w = state.wire && state.wire[i];
    return !!(w && !w.search);
  };
  // A fresh wiring: unless the player has chosen the axes, put the first two
  // reachable controls under the finger (Bright × Motion when both reach).
  function pickXY() {
    if (XY.chosen || !state.wire) return;
    const order = [0, 2, 1, 3, 5, 4];
    const reach = order.filter((i) => xyReach(i));
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
    xyField.classList.toggle("dead-x", !rx);
    xyField.classList.toggle("dead-y", !ry);
    xyNote.textContent = !state.wire
      ? (state.measuring ? "measuring…" : "")
      : !rx && !ry
        ? "neither reaches this patch — pick two others"
        : !rx ? `${kx.spec.name} doesn't reach this patch` : !ry ? `${ky.spec.name} doesn't reach this patch` : "";
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
    xyField.focus({ preventScroll: true });
    xyField.setPointerCapture(e.pointerId);
    ensureWired();
    setXY(...xyAt(e));
  });
  xyField.addEventListener("pointermove", (e) => {
    if (xyField.hasPointerCapture(e.pointerId)) setXY(...xyAt(e));
  });
  const xyEnd = (e) => {
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
  const NAMED = host.controls; // [{name, low, high}] in engine order
  NAMED.forEach((c, i) => makeKnob(i, { kind: "named", name: c.name, low: c.low, high: c.high }));
  makeKnob(6, { kind: "blend", name: "Blend", low: "home", high: "offer", initial: 0 });
  makeKnob(7, { kind: "wander", name: "Wander", low: "still", high: "roam", initial: 0 });

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
      else host.note("nothing offered yet");
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
  setInterval(() => {
    growSpare();
    if (!state.visible || state.hold || !state.cur || !state.wire) return;
    const now = performance.now();
    if (now - state.lastTouch < HANDS_OFF_MS) return;
    const z = wanderZone(state.wander);
    const pace = wanderPace(state.wander);
    if (now - state.lastMove < pace.period * 1000) return;
    if (z === "offer" && !state.offer) requestOffer("wander");
    else if (z === "drift" || z === "roam") requestDrift();
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
      return !!(w && !w.search);
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
      const hit = json ? wireCache.get(wireKey(json)) : null;
      return hit ? reachOfWiring(hit.data.wiring) : null;
    },
    // Measure a patch that is *not* playing, for the cache alone (booth
    // mode's pre-warm, booth.js), and answer with the named controls that
    // reach it — at once when it was measured before. The request is an
    // ordinary `perform_wire` whose reply belongs to no patch (`gen` −1), so
    // it is cached and never applied: the sound under a player's hands is
    // not disturbed by a measurement of something else.
    prewarm(json) {
      const hit = wireCache.get(wireKey(json));
      if (hit) return Promise.resolve(reachOfWiring(hit.data.wiring));
      return new Promise((resolve) => {
        const req = request("perform_wire", { tree: json, overrides: [], bg: true });
        const p = state.pending.get(req);
        p.gen = -1;
        p.cacheAs = { json, rev: tasteRev() };
        p.prewarm = resolve;
      });
    },
    hasOffer: () => !!state.offer,
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
    // the kept ones. Null before a patch is under PERFORM's hands.
    performedKnobs() {
      if (!state.cur) return null;
      const out = new Map();
      for (const a of state.cur.knobs.keys()) {
        const v = liveValue(a);
        if (v != null) out.set(a, v);
      }
      return out;
    },
    // The named controls that turn `addr` on this patch.
    controlsOn(addr) {
      return (state.wire || [])
        .filter((w) => !w.search && w.knobs.some(([a]) => a === addr))
        .map((w) => w.name);
    },
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
      // Measured lazily: a patch that changed while PERFORM was hidden is
      // wired the first time it is looked at, not every time it changed.
      if (state.cur && !state.wire && !state.measuring) wire();
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
      touch();
      ensureWired();
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
