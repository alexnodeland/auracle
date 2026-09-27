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

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
// Mirrors auracle_session::perform::Wiring::range: a half that the patch's
// renders did not confirm is closed. REACH_FLOOR / 2 in σ.
const HALF_OPEN = 0.075;
function rangeOf(w) {
  if (!w || w.search) return [0, 0];
  const ok = (m) => m == null || m >= HALF_OPEN;
  return [ok(w.down) ? -1 : 0, ok(w.up) ? 1 : 0];
}
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
  if (z === "drift") {
    const t = (w - WANDER_DRIFT) / (WANDER_ROAM - WANDER_DRIFT);
    return { period: 36 - 22 * t, steps: Math.round(8 + 10 * t), glide: 6 - 2 * t };
  }
  if (z === "roam") {
    const t = (w - WANDER_ROAM) / (1 - WANDER_ROAM);
    return { period: 12 - 5 * t, steps: Math.round(24 + 16 * t), glide: 3 - t };
  }
  return { period: 24, steps: 40, glide: 0 };
}

export function createPerform(host) {
  const root = host.root;
  root.innerHTML = "";
  const state = {
    home: null,
    cur: null,
    wire: null, // [{name, low, high, knobs:[[addr,gain]], purity, reach, position, search}]
    c: [0, 0, 0, 0, 0, 0],
    sent: new Map(), // addr -> value last written to the voices
    wander: 0,
    hold: false,
    blend: 0,
    offer: null, // {json, makeup}
    req: 0,
    pending: new Map(), // req -> kind
    measuring: false,
    lastTouch: 0,
    lastMove: performance.now(),
    glide: null, // {from: Map, to: Map, t0, dur, json}
    visible: false,
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
  const offerCard = el("div", "pf-offer");
  const why = el("div", "pf-why");
  root.append(head, deck, pads, offerCard, why);

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
        k.sub.textContent = search
          ? "not in this patch — turn to ask"
          : lo === 0
            ? `already as ${w.low} as it gets`
            : hi === 0
              ? `already as ${w.high} as it gets`
              : w.knobs.map(([a]) => a.split("#")[1]).join(" · ");
        k.wrap.title = search
          ? `${w.name}: this patch's knobs cannot honestly make it ${w.high} (purity ${w.purity.toFixed(2)}). Turning it asks evolution for a variant that can.`
          : `${w.name}: moves ${w.knobs.map(([a, g]) => `${a} ${g >= 0 ? "+" : "−"}${Math.abs(g).toFixed(2)}`).join(", ")} · purity ${w.purity.toFixed(2)} · measured ${w.down != null ? `−${w.down.toFixed(2)}σ / +${w.up.toFixed(2)}σ` : `${w.reach.toFixed(1)}σ predicted`} · long-press to hear it`;
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

  function bindDrag(k) {
    let startY = 0;
    let startV = 0;
    let pressT = 0;
    let moved = false;
    let hearTimer = null;
    const lo = () => (k.spec.kind === "named" ? -1 : 0);
    const set = (v, fine) => {
      k.value = clamp(v, lo(), 1);
      // A light detent at the centre of a bipolar control: home is findable
      // by feel.
      if (k.spec.kind === "named" && !fine && Math.abs(k.value) < 0.03) k.value = 0;
      paintKnob(k);
      onKnob(k);
    };
    k.wrap.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      k.wrap.focus();
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
      onRelease(k);
    });
  }

  function touch() {
    state.lastTouch = performance.now();
  }

  // ---------- the sound ----------
  function liveValue(addr) {
    const base = state.cur.knobs.get(addr);
    if (base == null) return null;
    let v = base;
    if (state.wire) {
      state.wire.forEach((w, i) => {
        if (w.search || !state.c[i]) return;
        const [lo, hi] = rangeOf(w);
        const c = clamp(state.c[i], lo, hi);
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
    for (const a of state.cur.knobs.keys()) {
      const v = liveValue(a);
      if (v == null) continue;
      const prev = state.sent.get(a);
      if (prev == null || Math.abs(prev - v) > 1e-5) {
        live.param(a, v);
        state.sent.set(a, v);
      }
    }
  }

  function onKnob(k, fromMidi) {
    if (!fromMidi) host.controlMoved?.(k.i);
    if (k.spec.kind === "named") {
      state.c[k.i] = k.value;
      const w = state.wire && state.wire[k.i];
      if (w && !w.search) push();
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
      // names by turning knobs, so the gesture becomes a request for a patch
      // that can. The control springs back; the offer arrives in B.
      const up = k.value > 0;
      host.note(`${w.name}: no knobs here make it ${up ? w.high : w.low} — growing an offer instead`);
      k.value = 0;
      state.c[k.i] = 0;
      paintKnob(k);
      requestOffer(`${w.name.toLowerCase()} ${up ? "up" : "down"}`);
    }
    host.logImplicit("perform_turn", { control: k.spec.name, value: +k.value.toFixed(3) });
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
      k.value = clamp(start + path(u), -1, 1);
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
    state.pending.set(req, kind);
    host.send({ ...msg, type: kind, req });
    return req;
  }

  function wire() {
    if (!state.cur) return;
    state.measuring = true;
    renderStatus();
    knobs.forEach(paintKnob);
    request("perform_wire", { tree: state.cur.json, overrides: overrides() });
  }

  function requestDrift() {
    if (!state.cur || state.glide || [...state.pending.values()].includes("perform_drift")) return;
    const pace = wanderPace(state.wander);
    state.lastMove = performance.now();
    request("perform_drift", {
      tree: state.cur.json,
      overrides: overrides(),
      locks: host.locks(),
      steps: pace.steps,
    });
    renderStatus("walking…");
  }

  function requestOffer(why) {
    if (!state.cur || [...state.pending.values()].includes("perform_offer")) return;
    state.lastMove = performance.now();
    state.offerWhy = why || "";
    // Twenty steps is ~10 s of renders: long enough to find a real variant,
    // short enough to still be the same moment in a performance. Roam asks
    // for a longer walk and so a farther offer.
    const steps = wanderZone(state.wander) === "roam" ? 40 : 20;
    request("perform_offer", { tree: state.cur.json, overrides: overrides(), locks: host.locks(), steps });
    renderOffer("growing an offer…");
  }

  function onWorker(m) {
    const kind = state.pending.get(m.req);
    if (!kind) return false;
    state.pending.delete(m.req);
    if (m.type === "perform_wired") {
      state.measuring = false;
      if (!m.data) {
        state.wire = null;
        renderStatus("the taste model has not seen enough patches to measure against yet");
      } else {
        // The knob values the wiring was measured at become the new centre;
        // the controls return to zero there, so nothing audibly moves.
        state.cur.knobs = new Map(m.data.addrs.map((a, i) => [a, m.data.values[i]]));
        state.c = state.c.map(() => 0);
        knobs.forEach((k) => {
          if (k.spec.kind === "named") k.value = 0;
        });
        state.wire = m.data.wiring;
        if (state.home && !state.home.knobs) state.home.knobs = new Map(state.cur.knobs);
        renderStatus();
      }
      knobs.forEach(paintKnob);
      return true;
    }
    if (m.type === "perform_drifted") {
      if (!m.drift) {
        renderStatus("nothing nearby it likes better — staying");
        return true;
      }
      const pace = wanderPace(state.wander);
      startGlide(new Map(m.drift.knobs), JSON.stringify(m.drift.tree), pace.glide);
      renderStatus(m.drift.taste ? "drifting toward your taste" : "drifting through the grammar — no taste yet");
      return true;
    }
    if (m.type === "perform_offered") {
      if (!m.offer) {
        renderOffer("no offer beat this patch — try again, or loosen a lock");
        return true;
      }
      state.offer = { json: JSON.stringify(m.offer.tree), makeup: m.offer.makeup, taste: !!m.offer.taste };
      const live = host.live();
      if (live) {
        live.bPatch(state.offer.json, state.offer.makeup);
        live.bMix(state.blend);
      }
      renderOffer();
      knobs.forEach(paintKnob);
      host.logImplicit("perform_offer", { why: state.offerWhy || "" });
      return true;
    }
    if (m.type === "perform_applied") {
      const then = state.applyThen && state.applyThen.get(m.req);
      if (then) {
        state.applyThen.delete(m.req);
        then(m.json);
      }
      return true;
    }
    return true;
  }

  // ---------- glides (drift and back) ----------
  function startGlide(to, json, seconds) {
    const from = new Map();
    for (const a of state.cur.knobs.keys()) from.set(a, liveValue(a));
    // The controls' deltas are part of where the glide starts; fold them into
    // the base so the controls read zero at the destination.
    state.cur.knobs = from;
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
      wire();
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
      wire();
      return;
    }
    requestAnimationFrame(stepGlide);
  }

  // ---------- pads ----------
  function applyThen(then) {
    if (!state.applyThen) state.applyThen = new Map();
    const req = request("perform_apply", { tree: state.cur.json, overrides: overrides() });
    state.applyThen.set(req, then);
  }

  function keep() {
    if (!state.cur) return;
    applyThen((json) => {
      if (!json || json === "null") return;
      state.home = { json, makeup: state.cur.makeup, knobs: new Map(overrides()) };
      host.logImplicit("perform_keep", { controls: state.c.map((x) => +x.toFixed(3)) });
      host.commitTree(json);
      host.note("kept — this is home now");
      flash("keep");
    });
  }

  function back() {
    if (!state.home || !state.home.knobs) return;
    host.logImplicit("perform_back", {});
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
    host.logImplicit("perform_take", { why: state.offerWhy || "" });
    const json = state.offer.json;
    clearOffer();
    host.commitTree(json);
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
    b.addEventListener("keydown", (e) => {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        onDown();
        if (onUp) setTimeout(onUp, 600);
      }
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
    if (msg) parts.push(msg);
    else if (state.measuring) parts.push("measuring how this patch moves…");
    else if (state.wire) {
      const n = state.wire.filter((w) => !w.search).length;
      parts.push(`${n} of ${state.wire.length} controls reach this patch`);
    }
    if (state.hold) parts.push("wander held");
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
      body.textContent = `an offer is waiting, ${src}${state.offerWhy ? ` (${state.offerWhy})` : ""} — hold Peek to hear it, slide Blend, or Take it`;
    }
    else body.textContent = "no offer — press Offer to grow a variant from here";
    offerCard.classList.toggle("ready", !!state.offer);
    offerCard.append(lab, body);
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

  // ---------- build ----------
  const NAMED = host.controls; // [{name, low, high}] in engine order
  NAMED.forEach((c, i) => makeKnob(i, { kind: "named", name: c.name, low: c.low, high: c.high }));
  makeKnob(6, { kind: "blend", name: "Blend", low: "home", high: "offer", initial: 0 });
  makeKnob(7, { kind: "wander", name: "Wander", low: "still", high: "roam", initial: 0 });

  pad("keep", "Keep", "Make this sound home (a strong signal about your taste)", keep);
  pad("back", "Back", "Glide back to the last sound you kept", back);
  pad("offer", "Offer", "Grow a variant from here into B", () => requestOffer());
  pad("take", "Take", "Make the offer in B your sound", take);
  pad(
    "peek",
    "Peek",
    "Hold to hear the offer; let go to come back",
    () => {
      const live = host.live();
      if (live && state.offer) live.bMix(1);
      else host.note("nothing offered yet");
    },
    () => {
      const live = host.live();
      if (live && state.offer) live.bMix(state.blend);
    },
  );
  pad("hold", "Hold", "Freeze wander (tap Wander does the same)", toggleHold);
  padEls.hold.setAttribute("aria-pressed", "false");
  knobs.forEach(paintKnob);
  renderOffer();
  renderStatus();

  // ---------- the wander clock ----------
  setInterval(() => {
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
    const live = host.live();
    const an = live && live.analyser;
    const g = scope.getContext("2d");
    g.clearRect(0, 0, scope.width, scope.height);
    if (!an) return;
    const buf = new Float32Array(an.fftSize);
    an.getFloatTimeDomainData(buf);
    g.strokeStyle = host.ink.green;
    g.lineWidth = 1.4;
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
    show() {
      state.visible = true;
      nameEl.textContent = host.label();
      const t = host.liveTree();
      if (t && t.json && (!state.cur || state.cur.json !== t.json)) this.patchChanged(t.json, t.makeup);
      // Measured lazily: a patch that changed while PERFORM was hidden is
      // wired the first time it is looked at, not every time it changed.
      if (state.cur && !state.wire && !state.measuring) wire();
      renderStatus();
      knobs.forEach(paintKnob);
    },
    hide() {
      state.visible = false;
    },
    // A new tree reached the voices from anywhere in the app. It becomes home,
    // and the controls are re-measured around it.
    patchChanged(json, makeup) {
      nameEl.textContent = host.label();
      if (!json) return;
      if (state.cur && state.cur.json === json) return;
      state.cur = { json, makeup, knobs: new Map() };
      state.home = { json, makeup, knobs: null };
      state.sent.clear();
      state.wire = null;
      state.glide = null;
      if (state.offer) clearOffer();
      if (state.visible) wire();
      else state.measuring = false;
      knobs.forEach(paintKnob);
    },
    onWorker,
    // For MIDI and the keyboard: set a named control (0..5), Blend (6) or
    // Wander (7) from a normalized 0..1 value.
    setControl(i, v01) {
      const k = knobs[i];
      if (!k) return;
      touch();
      k.value = k.spec.kind === "named" ? v01 * 2 - 1 : v01;
      paintKnob(k);
      onKnob(k, true);
    },
    // The control's position as 0..1, what a MIDI pot is compared against
    // for pickup.
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
