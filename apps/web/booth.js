// Booth mode: Auracle on a trade-show kiosk.
//
// Three jobs, all off unless booth mode is on (`?booth` in the URL, or the ⋯
// menu):
//
// 1. **Attract.** After a minute with nobody at the keys, the instrument
//    plays itself in PERFORM: a curated patch, a chord progression, two named
//    controls moving under an invisible hand (their dials turn), then hands
//    off while Wander drifts the knobs, then an offer grown into B and blended
//    in. The patch changes every cycle. It is the product's pitch, performed.
// 2. **Hand over.** Any key, click, touch, wheel or MIDI note stops it on the
//    spot — notes released, Wander still, B cleared — and the visitor is
//    holding the sound that was playing. Nothing attract did is logged or
//    taught: PERFORM is quiet while it runs, and its offers are never answered.
// 3. **Next visitor.** Shift+Esc (or ⌘K's New visitor) forgets the taste profile
//    and starts again, keeping booth mode and the measured wirings.
// 4. **Pre-warm.** Every patch in the set is measured for PERFORM in the
//    background at boot, while nobody is at the keys, so attract performs
//    only patches whose controls already work — and so does a visitor who
//    takes one over.
//
// The host is main.js; this module owns timing and nothing else.

// A minute with nobody at the keys, unless the URL says otherwise
// (`?booth=20`: twenty seconds) — for staff, and for tests.
const DEFAULT_IDLE_MS = 60_000;
const CHORD_MS = 4000;

// Patches that sound good on a show floor and give several controls to move.
// `arp` is the arp rate (steps per beat) for patches that want motion from
// the keys; absent means held chords.
const BOOTH_SET = [
  { name: "Glass Pad" },
  { name: "Acid Line", arp: 4 },
  { name: "Loom" },
  { name: "Undertow" },
  { name: "Sub & Sparkle", arp: 2 },
  { name: "Detune Dream" },
  { name: "Wobble Board", arp: 2 },
  { name: "Cathedral" },
];

// Am – F – C – G, voiced around C4 (MIDI 60).
const PROGRESSION = [
  [57, 60, 64],
  [53, 57, 60, 65],
  [48, 55, 60, 64],
  [55, 59, 62, 67],
];

// Named-control indices (perform.js order) the attract hand may move, best
// first; it takes the first two this patch can actually reach.
const HAND_ORDER = [0, 2, 3, 5, 1];

// The pre-warm starts a measurement only after this long with no input, so a
// visitor who walks up waits behind at most the one already under way.
const PREWARM_QUIET_MS = 3000;
// A measurement that never answers (a dead engine) must not stall the rest.
const PREWARM_GIVE_UP_MS = 120_000;

const sleep = (ms, run) =>
  new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    run.timers.add(t);
  });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createBooth(host) {
  const KEY = "auracle-booth";
  let on = false;
  let idleMs = DEFAULT_IDLE_MS;
  try {
    const q = new URL(location.href).searchParams;
    on = q.has("booth") || localStorage.getItem(KEY) === "1";
    const secs = Number(q.get("booth"));
    if (q.get("booth") && Number.isFinite(secs) && secs >= 2) idleMs = secs * 1000;
  } catch {
    on = false;
  }
  let lastInput = performance.now();
  let run = null; // the attract run in progress: {stop, timers:Set, notes:Set}
  let cycle = 0;
  const overlay = host.overlay;
  const caption = host.caption;

  function setCaption(text) {
    if (caption) caption.textContent = text;
  }

  function stop() {
    if (!run) return;
    const r = run;
    run = null;
    r.stop = true;
    for (const t of r.timers) clearTimeout(t);
    clearInterval(r.chordTimer);
    clearInterval(r.handTimer);
    for (const n of r.notes) host.noteOff(n);
    r.notes.clear();
    host.setArp(false);
    const p = host.perform();
    if (p) {
      p.setControl(6, 0); // Blend home
      p.setControl(7, 0); // Wander still
      p.setQuiet(false);
    }
    host.quiet(false);
    overlay?.classList.add("hidden");
  }

  // Any sign of a person hands the instrument over — onto controls that
  // work. Attract only starts a patch nobody has measured when no measured
  // one exists (a first boot's first minute), so this is the safety net: if
  // the patch it leaves is still measuring and the pre-warm has another one
  // ready, the visitor gets that one, not six controls reading "measuring…".
  function poke() {
    lastInput = performance.now();
    if (!run) return;
    const p = host.perform();
    const inert = !!p && p.measuring();
    stop();
    if (!inert) return;
    const ready = BOOTH_SET.find((it) => handsFor(it).length >= 2 && !host.isLive(it.name));
    if (ready) host.loadPreset(ready.name);
  }
  for (const ev of ["keydown", "pointerdown", "wheel", "touchstart"]) {
    window.addEventListener(ev, (e) => {
      if (on && ev === "keydown" && e.key === "Escape" && e.shiftKey) {
        e.preventDefault();
        host.resetVisitor();
        return;
      }
      poke();
    }, { capture: true, passive: ev !== "keydown" });
  }

  setInterval(() => {
    if (!on) return;
    if (host.ready()) prewarm();
    if (run || performance.now() - lastInput < idleMs) return;
    if (!host.ready()) return;
    attract();
  }, 2000);

  // ---------- pre-warm ----------
  // Attract used to perform whatever came next in the set, measured or not:
  // the pitch opened on six controls reading "measuring…" for twenty seconds,
  // and a visitor who took over mid-measurement held a patch whose controls
  // did nothing yet. So each patch in the set is measured once, at boot,
  // before anyone needs it: one at a time, each begun only in a quiet moment,
  // through the host — which gets the preset's tree without opening it and
  // has PERFORM measure it for the cache alone, leaving the bench and the
  // voices as they were. The wirings persist (perform.js), so after a
  // machine's first boot this is a walk through the cache.
  let warming = false;
  let warmingNow = null; // the item being measured right now
  let warmPasses = 0;
  let nextPassAt = 0;
  // "Never while someone is playing": no input for a few seconds, no key
  // held, and the engine between jobs — no pool still filling, no fit, no
  // long call running. While attract runs, its chords and its questions to
  // PERFORM are nobody's, and its drifts and offers keep PERFORM asking
  // something most of the time: waiting for PERFORM to fall silent starved
  // the pre-warm (two patches in two minutes), so during attract a
  // measurement takes its turn between attract's requests instead — but
  // only early in a cycle (the hand and Wander stages), so it is usually
  // done by the time the next patch loads. Begun late, the next load queued
  // behind it and the pitch sat silent for up to thirty seconds between
  // patches; one that runs long anyway is played through (the "hold" stage).
  const quiet = () => {
    if (!on || !host.ready() || !host.engineIdle()) return false;
    if (performance.now() - lastInput < PREWARM_QUIET_MS) return false;
    if (run) return run.stage === "hand" || run.stage === "wander";
    const p = host.perform();
    return host.held() === 0 && !(p && p.busy());
  };
  const measured = (item) => host.reach(item.name) != null;
  async function prewarm() {
    if (warming || warmPasses >= 3 || performance.now() < nextPassAt) return;
    if (BOOTH_SET.every(measured)) return;
    warming = true;
    warmPasses += 1;
    try {
      for (const item of BOOTH_SET) {
        if (measured(item)) continue;
        while (!quiet()) {
          if (!on) return;
          await delay(1000);
        }
        warmingNow = item;
        await Promise.race([host.prewarm(item.name), delay(PREWARM_GIVE_UP_MS)]);
        warmingNow = null;
      }
    } finally {
      warming = false;
      warmingNow = null;
      // One that failed (the engine still warming up) gets another pass,
      // later — not a tight retry against an engine that said no.
      nextPassAt = performance.now() + 30_000;
    }
  }

  // The hand's two controls on `item`, from its measured wiring: empty until
  // it has been measured, or when fewer than two reach it.
  function handsFor(item) {
    const reach = host.reach(item.name);
    return reach ? HAND_ORDER.filter((k) => reach.includes(k)).slice(0, 2) : [];
  }
  const readyOther = (item) => BOOTH_SET.some((it) => it !== item && handsFor(it).length >= 2);

  // Round the set, skipping to the next patch that is ready. Before any is
  // (a cold first boot), the one the pre-warm is on or would take next, so
  // attract and the pre-warm measure the same patch rather than two patches
  // racing for one engine thread.
  function nextItem() {
    const n = BOOTH_SET.length;
    for (let i = 0; i < n; i++) {
      const item = BOOTH_SET[(cycle + i) % n];
      if (handsFor(item).length >= 2) {
        cycle += i + 1;
        return item;
      }
    }
    const item = warmingNow || BOOTH_SET.find((it) => !measured(it)) || BOOTH_SET[cycle % n];
    cycle += 1;
    return item;
  }

  function endChords(r) {
    clearInterval(r.chordTimer);
    r.chordTimer = null;
    for (const n of [...r.notes]) {
      host.noteOff(n);
      r.notes.delete(n);
    }
  }

  async function attract() {
    // `stage` is where the cycle is: load, measure, hand, wander, offer, hold.
    const r = { stop: false, timers: new Set(), notes: new Set(), chordTimer: null, handTimer: null, stage: "load" };
    run = r;
    host.quiet(true);
    const p = host.perform();
    if (p) p.setQuiet(true);
    overlay?.classList.remove("hidden");
    try {
      while (!r.stop) {
        await oneCycle(r, nextItem());
      }
    } catch (err) {
      console.warn("[booth] attract stopped:", err);
      if (run === r) stop();
    }
  }

  async function oneCycle(r, item) {
    r.stage = "load";
    setCaption(item.name);
    host.loadPreset(item.name);
    // The bench answers behind whatever the engine is already doing (a
    // measurement can hold it for seconds), so wait for *this* patch to be
    // the one sounding. A fixed 2.5 s ran the next stage on the old patch
    // under the new one's caption: the hand turned Glass Pad's knobs beside
    // "Acid Line", and a visitor then took over a patch still measuring.
    await sleep(1500, r);
    for (let i = 0; i < 120 && !r.stop && !host.isLive(item.name); i++) await sleep(250, r);
    if (r.stop || !host.isLive(item.name)) return;
    host.showView("perform");
    const perf = host.perform();
    const hands = () => HAND_ORDER.filter((k) => perf && perf.reaches(k)).slice(0, 2);
    // Two named controls must reach before the hand moves. A pre-warmed
    // patch is wired the moment PERFORM shows it; one that is not gives way
    // to the next pre-warmed patch before a note is played, so the pitch
    // never performs controls that do nothing.
    if (hands().length < 2 && readyOther(item)) return;
    host.setArp(!!item.arp, item.arp || 2);

    // The chords run under everything that follows.
    let chord = 0;
    const play = () => {
      if (r.stop) return;
      const next = PROGRESSION[chord++ % PROGRESSION.length];
      for (const n of next) {
        host.noteOn(n, 0.8);
        r.notes.add(n);
      }
      for (const n of [...r.notes]) {
        if (!next.includes(n)) {
          host.noteOff(n);
          r.notes.delete(n);
        }
      }
    };
    play();
    r.chordTimer = setInterval(play, CHORD_MS);

    // Nothing pre-warmed yet (a cold first boot): the patch is measured in
    // the open, and the hand waits for it — up to a minute, because on a
    // busy machine a big patch takes longer than the twenty seconds this
    // used to allow, and the pitch then skipped its hand stage altogether.
    // It gives way the moment another patch is ready.
    r.stage = "measure";
    for (let i = 0; i < 120 && !r.stop && perf && hands().length < 2 && perf.measuring() && !readyOther(item); i++) {
      await sleep(500, r);
    }
    if (r.stop) return;

    // 1 — two named controls under one invisible hand. Fewer than two, and
    // the next ready patch plays instead; with none ready, the hand sits
    // this one out and Wander and the offer carry the cycle.
    const hs = hands();
    if (hs.length < 2 && readyOther(item)) {
      endChords(r);
      return;
    }
    if (hs.length === 2) {
      r.stage = "hand";
      const names = hs.map((k) => host.controlName(k)).join(" and ");
      setCaption(`${item.name} · ${names}, under one hand`);
      const t0 = performance.now();
      r.handTimer = setInterval(() => {
        const t = (performance.now() - t0) / 1000;
        perf.setControl(hs[0], 0.5 + 0.38 * Math.sin(t * 0.9));
        perf.setControl(hs[1], 0.5 + 0.34 * Math.sin(t * 0.63 + 1));
      }, 90);
      await sleep(11_000, r);
      clearInterval(r.handTimer);
      r.handTimer = null;
      if (r.stop) return;
      for (const k of hs) perf.setControl(k, 0.5);
    }

    // 2 — hands off: Wander lets the taste walk turn the knobs.
    r.stage = "wander";
    setCaption(`${item.name} · Wander: the knobs turn themselves`);
    perf?.setControl(7, 0.8);
    await sleep(15_000, r);
    if (r.stop) return;
    perf?.setControl(7, 0);

    // 3 — an offer grows in B and is blended in. Never answered: attract
    // does not teach.
    r.stage = "offer";
    setCaption(`${item.name} · Offer: a new version grows in B`);
    perf?.press("offer");
    for (let i = 0; i < 60 && !r.stop && perf && !perf.hasOffer(); i++) await sleep(500, r);
    if (r.stop) return;
    if (perf?.hasOffer()) {
      setCaption(`${item.name} · Blend: from home into the offer`);
      for (let i = 0; i <= 30 && !r.stop; i++) {
        perf.setControl(6, i / 30);
        await sleep(200, r);
      }
      await sleep(5000, r);
      for (let i = 30; i >= 0 && !r.stop; i--) {
        perf.setControl(6, i / 30);
        await sleep(80, r);
      }
    }
    // A pre-warm measurement still running holds the one engine thread the
    // next patch's load needs, and on a busy machine it can take most of a
    // minute. The next patch cannot land before it ends, so this one keeps
    // playing through it rather than the pitch falling silent under the next
    // patch's name.
    r.stage = "hold";
    setCaption(item.name);
    for (let i = 0; i < 120 && !r.stop && warmingNow; i++) await sleep(500, r);
    if (r.stop) return;
    endChords(r);
    await sleep(1500, r);
  }

  return {
    get on() {
      return on;
    },
    setOn(v) {
      on = !!v;
      try {
        localStorage.setItem(KEY, on ? "1" : "0");
      } catch {
        /* per-viewer convenience only */
      }
      if (!on) stop();
      lastInput = performance.now();
    },
    poke,
    attracting: () => !!run,
  };
}
