// Booth mode: Auracle on a trade-show kiosk.
//
// Three jobs, all off unless booth mode is on (`?booth` in the URL, or the ⋯
// menu):
//
// 1. **Attract.** After a minute with nobody at the keys, the instrument
//    plays itself in PERFORM: a curated patch, a chord progression, two named
//    controls moving under an invisible hand (the XY dot follows), then hands
//    off while Wander drifts the knobs, then an offer grown into B and blended
//    in. The patch changes every cycle. It is the product's pitch, performed.
// 2. **Hand over.** Any key, click, touch, wheel or MIDI note stops it on the
//    spot — notes released, Wander still, B cleared — and the visitor is
//    holding the sound that was playing. Nothing attract did is logged or
//    taught: PERFORM is quiet while it runs, and its offers are never answered.
// 3. **Next visitor.** Shift+Esc (or the ⋯ menu) forgets the taste profile
//    and starts again, keeping booth mode and the measured wirings.
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

const sleep = (ms, run) =>
  new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    run.timers.add(t);
  });

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

  // Any sign of a person hands the instrument over.
  function poke() {
    lastInput = performance.now();
    if (run) stop();
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
    if (!on || run || performance.now() - lastInput < idleMs) return;
    if (!host.ready()) return;
    attract();
  }, 2000);

  async function attract() {
    const r = { stop: false, timers: new Set(), notes: new Set(), chordTimer: null, handTimer: null };
    run = r;
    host.quiet(true);
    const p = host.perform();
    if (p) p.setQuiet(true);
    overlay?.classList.remove("hidden");
    try {
      while (!r.stop) {
        await oneCycle(r, BOOTH_SET[cycle++ % BOOTH_SET.length]);
      }
    } catch (err) {
      console.warn("[booth] attract stopped:", err);
      if (run === r) stop();
    }
  }

  async function oneCycle(r, item) {
    setCaption(item.name);
    host.loadPreset(item.name);
    await sleep(2500, r);
    if (r.stop) return;
    host.showView("perform");
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

    // Wait for the controls to be measured (instant for a patch seen before).
    const perf = host.perform();
    for (let i = 0; i < 40 && !r.stop && perf && !HAND_ORDER.some((k) => perf.reaches(k)); i++) {
      await sleep(500, r);
    }
    if (r.stop) return;

    // 1 — two named controls under one invisible hand.
    const hands = HAND_ORDER.filter((k) => perf && perf.reaches(k)).slice(0, 2);
    if (hands.length) {
      const names = hands.map((k) => host.controlName(k)).join(" and ");
      setCaption(`${item.name} · ${names}, under one hand`);
      const t0 = performance.now();
      r.handTimer = setInterval(() => {
        const t = (performance.now() - t0) / 1000;
        perf.setControl(hands[0], 0.5 + 0.38 * Math.sin(t * 0.9));
        if (hands[1] != null) perf.setControl(hands[1], 0.5 + 0.34 * Math.sin(t * 0.63 + 1));
      }, 90);
      await sleep(11_000, r);
      clearInterval(r.handTimer);
      r.handTimer = null;
      if (r.stop) return;
      for (const k of hands) perf.setControl(k, 0.5);
    }

    // 2 — hands off: Wander lets the taste walk turn the knobs.
    setCaption(`${item.name} · Wander: the knobs turn themselves`);
    perf?.setControl(7, 0.8);
    await sleep(15_000, r);
    if (r.stop) return;
    perf?.setControl(7, 0);

    // 3 — an offer grows in B and is blended in. Never answered: attract
    // does not teach.
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
    clearInterval(r.chordTimer);
    r.chordTimer = null;
    for (const n of [...r.notes]) {
      host.noteOff(n);
      r.notes.delete(n);
    }
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
