// A setting changed in PATCH is heard: live under a held note, and on replay.
//
// The other PATCH specs prove that an edit reaches the engine (edits counted
// out and replies counted back) and that an unplugged socket goes quiet. None
// of them listens for a change of timbre. These do, at the page's output: an
// init script wraps `AudioNode.prototype.connect`, so whatever the app connects
// to the destination (the master bus, where the voices and every ▶ phrase
// meet) is also connected to one shared `AnalyserNode`, and the spectrum is
// read off that.
//
// The patch is Falling Sign: one VCO (square) under a static low-pass whose
// corner sits well above the first five harmonics of C4, with nothing after
// it. Its only moving part is a pitch envelope that settles in ~0.3 s. The
// held note is `a` (C4), and the audition phrase opens on a 1.8 s C4, so live
// and replay are read at the same pitch: the fundamental's level and the 2nd
// and 3rd harmonics relative to it (sine: neither; triangle: 3rd ≈ −19 dB, no
// 2nd; square: 3rd ≈ −9.5 dB, no 2nd), and a magnitude-weighted spectral
// centroid.
//
// What this claims:
//
// - Cycling the VCO's wave chip (square → sine → triangle) under a held note
//   changes what comes out of the speakers to each waveform's harmonic
//   signature, and once the edit has landed ▶ plays the triangle, Space stops
//   it, and Space plays it again.
// - A selector change under a held note keeps its level while the engine
//   renders it: the voices are handed nothing until the edit's reply (the
//   render slowed by 1.5 s so the window is wide on any machine), the held
//   note's level stays where it was, and once the reply lands the new filter
//   mode plays at its measured makeup, within 4 dB of the level before. A
//   tree sent ahead of its render could carry only the previous tree's
//   makeup, which on this change (Falling Sign's filter, low-pass to
//   band-pass) is 11.8 dB too quiet, and up to 27 dB hot on others
//   (crates/auracle-wasm/examples/selector_makeup.rs).
// - Turning the filter's cutoff down lowers the centroid and the 3rd harmonic,
//   live and on ▶.
// - ▶ or Space pressed while a wave change is still at the engine plays the
//   changed patch. The bench's buffer is the phrase rendered before the edit
//   until the edit's reply replaces it, and a press in that window used to
//   play the old wave.
// - A ▶ waiting like that is lit (`.pending`) within 100 ms of the press, its
//   glyph keeps the playing ink while a phrase also plays, and a keyboard
//   focus keeps its ring. It plays nothing when the edit lands if it was
//   taken back: by a second press, by Space (which also stops a phrase
//   already sounding), by leaving PATCH, or by another ▶ (a bank row's, whose
//   phrase it then does not cut off).
// - An undo and a redo of a selector keep the held note's level: the voices
//   take the restored tree before its render at the makeup it was measured
//   at (the engine's memo of that tree), and the level while it renders is
//   the level once it lands. They took it at the makeup of the tree being
//   left: 11.8 dB off on this change, up to 27 dB hot on others.
// - A selector whose check fails is not applied: the voices keep the sound
//   from before it, and the alarm says so ("Not applied"), not "Muted". A
//   knob turned after it is not muted for a check of a tree the voices do
//   not hold.
// - A knob whose check finds a runaway is muted, as the alarm says: a knob
//   reaches the voices before its check, and its failed check used to raise
//   "Muted" over voices still playing. A check that passes lifts the mute.
//   (The failure is the engine's reply edited on its way to the page.)
// - An edit's reply leaves alone the voices of a preset opened while the
//   edit rendered. A structural edit (here a ⌘Z) reaches the voices before
//   its render, and its reply sets their makeup; a remembered preset clicked
//   in between plays from memory at once, and that reply used to set the
//   edit's makeup on it (Pluck's, 24 dB over Held Under's).
// - In PATCH, Space with ▶ disabled (nothing reaches the output) says so and
//   plays nothing, rather than the bank's render of the patch before the edit;
//   ▶'s tooltip gives the same reason.
// - Space in PERFORM and EVOLVE plays the sound as edited (the wave changed in
//   PATCH), not the preset as saved, and waits like ▶ for an edit still at the
//   engine when it is pressed. While it waits, the dock says so ("▶ waiting
//   for the edit…" over the sound's name, in a polite live region) within
//   100 ms of the press, whole and on screen, until the edit lands; outside
//   PATCH nothing did, and a first try appended it to the name, where the
//   name's ellipsis hid it.
//
// The engine is made slow for real where a test needs the window between an
// edit and its reply (a busy-wait prepended to worker.js, as
// patch_editing.spec.js does), so the window is wide on any machine.
//
// What it does not claim: that the harmonic levels are exact (the tolerances
// are a few dB either side of the textbook values); how quickly a wave change
// is heard live (it waits for the engine's render, a few hundred ms; the log
// prints it); that every selector change keeps its level within 3 dB (the
// makeup is measured on the whole phrase, a held C4 is one note of it);
// anything about other patches.
const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");
const { goLevel } = require("./shell");

const INIT = `(() => {
  const Orig = window.Worker;
  const workers = (window.__pwWorkers = []);
  const io = (window.__pwIO = { out: 0, in: 0, benchAt: [], replies: [], early: [] });
  const EDITS = new Set(["edit_param", "edit_structure", "edit_set_tree"]);
  function Wrapped(url, opts) {
    const w = new Orig(url, opts);
    w.__pwUrl = String(url);
    workers.push(w);
    if (/worker\\.js/.test(w.__pwUrl)) {
      const post = w.postMessage.bind(w);
      w.postMessage = (m, t) => {
        if (m && EDITS.has(m.type)) io.out += 1;
        return post(m, t);
      };
      w.addEventListener("message", (e) => {
        const d = e.data;
        if (!d || typeof d.type !== "string") return;
        // A check that finds a runaway, on demand: the next edit's reply says
        // its vet failed (this listener runs before main's, on the same data).
        if (window.__pwFailVet && d.type === "bench" && d.edited !== undefined) {
          window.__pwFailVet = false;
          d.vetOk = false;
          d.vetSilent = false;
        }
        if ((d.type === "bench" && d.edited !== undefined) || d.type === "edit_rejected") {
          io.in += 1;
          io.benchAt.push(performance.now());
        }
        if (d.type === "bench") io.replies.push({ t: performance.now(), edited: d.edited, subject: d.subject, makeup: d.makeup });
        if (d.type === "tree_json" && d.edited !== undefined) io.early.push(performance.now());
      });
    }
    return w;
  }
  Wrapped.prototype = Orig.prototype;
  window.Worker = Wrapped;
  window.__pwEngine = () => workers.find((w) => /worker\\.js/.test(w.__pwUrl)) || null;

  // The output tap: anything connected to a destination is also connected
  // to one analyser per context. \`connect\` returns what it returned (the
  // app chains on it).
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (dest, ...rest) {
    const r = connect.call(this, dest, ...rest);
    if (typeof AudioDestinationNode !== "undefined" && dest instanceof AudioDestinationNode) {
      let a = this.context.__pwTap;
      if (!a) {
        a = this.context.createAnalyser();
        a.fftSize = 16384;
        a.smoothingTimeConstant = 0;
        this.context.__pwTap = a;
        window.__pwTap = a;
      }
      connect.call(this, a);
    }
    return r;
  };

  // The spectrum at the output now, read around the note \`want\` (Hz).
  window.__pwSpectrum = (want) => {
    const a = window.__pwTap;
    if (!a) return null;
    const d = new Float32Array(a.frequencyBinCount);
    a.getFloatFrequencyData(d);
    const hz = a.context.sampleRate / a.fftSize;
    const at = (f) => Math.max(1, Math.min(d.length - 2, Math.round(f / hz)));
    const peak = (lo, hi) => {
      let db = -Infinity, i0 = at(lo);
      for (let i = at(lo); i <= at(hi); i++) if (d[i] > db) { db = d[i]; i0 = i; }
      return { db, i: i0 };
    };
    const p = peak(want * 0.94, want * 1.06);
    const [l, c, r] = [d[p.i - 1], d[p.i], d[p.i + 1]];
    const den2 = l - 2 * c + r;
    const off = Number.isFinite(l) && Number.isFinite(r) && den2 !== 0 ? (0.5 * (l - r)) / den2 : 0;
    const f0 = (p.i + off) * hz;
    const rel = (k) => peak(k * f0 * 0.98, k * f0 * 1.02).db - p.db;
    // Magnitude-weighted centroid over 50 Hz–12 kHz, bins within 90 dB of
    // the fundamental (the analyser's floor is not the patch).
    let num = 0, den = 0;
    for (let j = at(50); j <= at(12000); j++) {
      if (!(d[j] > p.db - 90)) continue;
      const m = Math.pow(10, d[j] / 20);
      num += m * j * hz;
      den += m;
    }
    return { f0, level: p.db, h2: rel(2), h3: rel(3), h4: rel(4), h5: rel(5), centroid: den > 0 ? num / den : 0 };
  };

  // The output's RMS over the analyser's window (a third of a second), in dBFS.
  window.__pwRmsDb = () => {
    const a = window.__pwTap;
    if (!a) return null;
    const b = new Float32Array(a.fftSize);
    a.getFloatTimeDomainData(b);
    let sum = 0;
    for (const x of b) sum += x * x;
    return sum > 0 ? 10 * Math.log10(sum / b.length) : -Infinity;
  };

  // The output's peak over the analyser's window, in dBFS.
  window.__pwPeakDb = () => {
    const a = window.__pwTap;
    if (!a) return null;
    const b = new Float32Array(a.fftSize);
    a.getFloatTimeDomainData(b);
    let peak = 0;
    for (const x of b) peak = Math.max(peak, Math.abs(x));
    return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
  };

  // Every tree handed to the voices (the worklet's \`patch\` message), by
  // time: when a change reached a held note, whatever the analyser's window.
  const voiced = (window.__pwVoiced = []);
  // …and every makeup they were handed, with a patch or on its own.
  const makeups = (window.__pwMakeups = []);
  const portPost = MessagePort.prototype.postMessage;
  MessagePort.prototype.postMessage = function (m, ...rest) {
    if (m && m.type === "patch") voiced.push(performance.now());
    if (m && (m.type === "patch" || m.type === "makeup") && m.makeup != null) makeups.push({ t: performance.now(), type: m.type, makeup: m.makeup });
    return portPost.call(this, m, ...rest);
  };

  // When the hand last pressed the wave chip, ▶ and Space (page clock).
  const at = (window.__pwAt = {});
  document.addEventListener("pointerdown", (e) => {
    const t = e.target;
    if (t.closest && t.closest("#rack-play")) at.play = performance.now();
    else if (t.classList && t.classList.contains("enum-body")) at.chip = performance.now();
    else if (t.classList && t.classList.contains("knob-hit")) at.knob = performance.now();
  }, true);
  document.addEventListener("keydown", (e) => { if (e.key === " ") at.space = performance.now(); }, true);

  // What the bench's ▶ has said, in order: every change of its pending or
  // playing state, with the time.
  const said = (window.__pwPlaySaid = []);
  document.addEventListener("DOMContentLoaded", () => {
    const b = document.getElementById("rack-play");
    if (!b) return;
    const read = () => {
      const now = { pending: b.classList.contains("pending"), playing: b.classList.contains("playing") };
      const last = said[said.length - 1];
      if (!last || last.pending !== now.pending || last.playing !== now.playing) said.push({ t: performance.now(), ...now });
    };
    read();
    new MutationObserver(read).observe(b, { attributes: true, attributeFilter: ["class"] });
  });

  // What the dock's wait sign has said, in order, with the time, and where
  // it was then: whole (not clipped), on screen, clear of the keybed, and on
  // top (what is at its middle is the sign).
  const dock = (window.__pwDockSaid = []);
  document.addEventListener("DOMContentLoaded", () => {
    const el = document.getElementById("live-wait");
    if (!el) return;
    const read = () => {
      const text = el.textContent;
      if (dock.length && dock[dock.length - 1].text === text) return;
      const r = el.getBoundingClientRect();
      const p = document.getElementById("piano").getBoundingClientRect();
      const hit = text ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
      dock.push({
        t: performance.now(), text,
        live: el.getAttribute("role") === "status" && el.getAttribute("aria-live") === "polite",
        whole: el.scrollWidth <= el.clientWidth + 0.5,
        onScreen: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight && r.width > 0,
        clearOfKeys: r.left >= p.right || r.right <= p.left || r.bottom <= p.top || r.top >= p.bottom,
        onTop: !!hit && (hit === el || el.contains(hit)),
      });
    };
    read();
    new MutationObserver(read).observe(el, { childList: true, characterData: true, subtree: true });
  });

  // Every spectrum for \`ms\` from now, stamped with its time.
  window.__pwRecord = (ms, want) => new Promise((resolve) => {
    const out = [];
    const t0 = performance.now();
    const step = () => {
      const t = performance.now() - t0;
      const s = window.__pwSpectrum(want);
      if (s) out.push({ t, at: t0 + t, rms: window.__pwRmsDb(), ...s });
      if (t < ms) setTimeout(step, 25);
      else resolve(out);
    };
    step();
  });

  try {
    for (const k of ["auracle-warmed", "auracle-played", "auracle-bench-tour", "auracle-bank-toured"])
      localStorage.setItem(k, "1");
  } catch (_) {}
})();`;

// Prepended to worker.js (as in patch_editing.spec.js): a busy-wait before the
// engine's own handler sees chosen request types, switched on by a message.
//
// `__pw_slow_render` slows the engine's renders of an edit instead:
// `edit_param` and `edit_revet` busy-wait before they run, so anything that
// reached the voices ahead of a render shows in the window before its reply.
const SLOW = `let __pwSlow = {};
self.addEventListener("message", (e) => {
  const d = e.data;
  if (d && d.type === "__pw_slow") { __pwSlow = d.slow || {}; e.stopImmediatePropagation(); return; }
  if (d && d.type === "__pw_slow_render") {
    e.stopImmediatePropagation();
    const P = WasmEngine.prototype;
    for (const name of ["edit_param", "edit_revet"]) {
      const f = P["__pw_" + name] || (P["__pw_" + name] = P[name]);
      P[name] = function (...a) {
        const until = performance.now() + d.ms;
        while (performance.now() < until) {}
        return f.apply(this, a);
      };
    }
    return;
  }
  const ms = d && __pwSlow[d.type];
  if (ms) { const until = performance.now() + ms; while (performance.now() < until) {} }
});
`;

const C4 = 261.63;

// The slowed worker is served from the file, not fetched through the server:
// a route handler then has nothing in flight that a failing test's teardown
// could wait on. It is the file the server would send.
const WORKER_JS = path.join(__dirname, "..", "..", "apps", "web", "worker.js");

// No route outlives its test, whatever state a failure left it in.
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

async function boot(page, { slowable = false } = {}) {
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await page.addInitScript(INIT);
  if (slowable) {
    const body = SLOW + fs.readFileSync(WORKER_JS, "utf8");
    await page.route(/\/worker\.js(\?|$)/, (route) =>
      route.fulfill({ status: 200, body, contentType: "text/javascript", headers: { "Cache-Control": "no-store" } }));
  }
  await page.goto("/");
  await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 60_000 });
  return errors;
}

const slow = (page, map) =>
  page.evaluate((m) => window.__pwEngine().postMessage({ type: "__pw_slow", slow: m }), map);
const slowRender = (page, ms) =>
  page.evaluate((n) => window.__pwEngine().postMessage({ type: "__pw_slow_render", ms: n }), ms);

/** Every edit posted has been answered, and stays that way for `quiet` ms. */
async function settled(page, quiet = 700) {
  await expect
    .poll(
      async () => {
        const a = await page.evaluate(() => [window.__pwIO.out, window.__pwIO.in]);
        if (a[0] !== a[1]) return false;
        await page.waitForTimeout(quiet);
        const b = await page.evaluate(() => [window.__pwIO.out, window.__pwIO.in]);
        return a[0] === b[0] && a[1] === b[1];
      },
      { timeout: 30_000, intervals: [250] },
    )
    .toBe(true);
}

async function openPreset(page, name) {
  // The app opens at PERFORM (Plan-008): PATCH is a level away.
  await goLevel(page, "patch");
  await page.locator('.bf[data-f="preset"]').click();
  await page.locator(".bank-item", { hasText: name }).first().click();
  await expect(page.locator("#rack-subject")).toContainText(name, { timeout: 60_000 });
  await expect(page.locator("#rack-svg .knob-hit").first()).toBeVisible();
  await settled(page);
}

/** The VCO's wave knob on the bench: its address and the option showing. */
const waveKnob = (page) =>
  page.evaluate(() => {
    for (const m of window.__aur.wb.rack.modules) {
      if (m.kind !== "vco") continue;
      const k = m.knobs.find((x) => x.addr.endsWith("#wave"));
      if (k) return { addr: k.addr, value: k.value, option: k.kind.options[Math.round(k.value)] };
    }
    return null;
  });

/** Median of a list of numbers. */
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
};

/** The output's RMS once it is steady: polled until two successive reads (a
 *  poll apart, each over the analyser's third of a second) agree within
 *  0.5 dB, after a swap's fade-in and the leveler have settled. */
async function steadyRms(page) {
  let last = null;
  let now = null;
  await expect
    .poll(async () => {
      now = await page.evaluate(() => window.__pwRmsDb());
      const ok = last != null && Number.isFinite(now) && Math.abs(now - last) < 0.5;
      last = now;
      return ok;
    }, { timeout: 15_000, intervals: [250] })
    .toBe(true);
  return now;
}

/** The live output's spectrum at C4, the median of `n` reads 120 ms apart. */
async function liveSpectrum(page, n = 5) {
  const reads = [];
  for (let i = 0; i < n; i++) {
    reads.push(await page.evaluate((w) => window.__pwSpectrum(w), C4));
    await page.waitForTimeout(120);
  }
  const pick = (k) => median(reads.map((r) => r[k]));
  return { f0: pick("f0"), level: pick("level"), h2: pick("h2"), h3: pick("h3"), h5: pick("h5"), centroid: pick("centroid") };
}

/** Quiet at the output (nothing held, nothing playing) for the analyser's
 *  whole window, about a third of a second — and no phrase still running out
 *  its silent tail, or Space would stop that instead of playing. */
async function quiet(page) {
  await expect(page.locator("#rack-play")).not.toHaveClass(/\bplaying\b/, { timeout: 15_000 });
  await expect
    .poll(() => page.evaluate(() => window.__pwPeakDb()), { timeout: 15_000, intervals: [100] })
    .toBeLessThan(-80);
}

/** Press something that plays the bench's phrase, and read the phrase's
 *  opening C4 at the output: onset found from the level, then the spectra
 *  whose whole window sits inside the held note (the pitch envelope settled,
 *  the C5 that follows not yet begun), medianed. */
async function replaySpectrum(page, press, ms = 2600) {
  await quiet(page);
  await page.evaluate(([w, n]) => { window.__pwRec = window.__pwRecord(n, w); }, [C4, ms]);
  await press();
  const snaps = await page.evaluate(() => window.__pwRec);
  const top = Math.max(...snaps.map((s) => s.level).filter(Number.isFinite));
  const onset = snaps.find((s) => s.level > top - 20);
  expect(onset, "the phrase sounds at the output").toBeTruthy();
  const inNote = snaps.filter(
    (s) => s.t - onset.t >= 0.6e3 && s.t - onset.t <= 1.6e3 && Math.abs(s.f0 / C4 - 1) < 0.015,
  );
  expect(inNote.length, `snapshots inside the held C4 (${snaps.length} taken)`).toBeGreaterThanOrEqual(5);
  const pick = (k) => median(inNote.map((r) => r[k]));
  return { f0: pick("f0"), level: pick("level"), h2: pick("h2"), h3: pick("h3"), h5: pick("h5"), centroid: pick("centroid"), n: inNote.length };
}

const fmt = (s) =>
  `f0 ${s.f0.toFixed(1)} Hz · ${s.level.toFixed(1)} dB · h2 ${s.h2.toFixed(1)} · h3 ${s.h3.toFixed(1)} · h5 ${s.h5.toFixed(1)} · centroid ${s.centroid.toFixed(0)} Hz`;

// Each waveform's harmonic signature at C4, relative to the fundamental: the
// textbook level with a few dB either way, and "none" for a harmonic the
// waveform does not have (measured below −130 dB; −40 leaves room).
const NONE = -40;
const WAVES = {
  sin: { h2: null, h3: null },
  tri: { h2: null, h3: -19.1 },
  sqr: { h2: null, h3: -9.5 },
  saw: { h2: -6.0, h3: -9.5 },
};
const TOL = 3.5;
const isWave = (s, w) =>
  ["h2", "h3"].every((h) => (WAVES[w][h] == null ? s[h] < NONE : Math.abs(s[h] - WAVES[w][h]) < TOL));
function expectWave(s, w, where) {
  for (const h of ["h2", "h3"]) {
    const want = WAVES[w][h];
    const said = `${where}: ${h} of ${w} (${fmt(s)})`;
    if (want == null) expect(s[h], said).toBeLessThan(NONE);
    else expect(Math.abs(s[h] - want), said).toBeLessThan(TOL);
  }
  expect(Math.abs(s.f0 / C4 - 1), `${where}: the note is C4`).toBeLessThan(0.01);
}

/** The wave chip on the rack, clicked once. */
async function clickWave(page) {
  const k = await waveKnob(page);
  await page.locator(`#rack-svg g[data-addr="${k.addr}"] .enum-body`).click();
  return k;
}

/** Hold C4 and wait until it sounds, steady (the pitch envelope settled). */
async function holdC4(page) {
  await page.keyboard.down("a");
  await expect.poll(async () => (await liveSpectrum(page, 1)).level, { timeout: 20_000 }).toBeGreaterThan(-60);
  await expect
    .poll(async () => Math.abs((await liveSpectrum(page, 1)).f0 / C4 - 1), { timeout: 10_000 })
    .toBeLessThan(0.005);
}

/** A rack knob's centre on screen, and what it says. */
async function rackKnob(page, addr) {
  await expect(page.locator(`#rack-svg g[data-addr="${addr}"] .knob-hit`)).toBeVisible();
  return page.evaluate((a) => {
    const g = document.querySelector(`#rack-svg g[data-addr="${CSS.escape(a)}"]`);
    if (!g) return null;
    const r = g.querySelector(":scope > .knob-hit").getBoundingClientRect();
    return {
      x: r.x + r.width / 2,
      y: r.y + r.height / 2,
      value: Number(g.getAttribute("aria-valuenow")),
      text: g.querySelector(".knob-value")?.textContent || "",
    };
  }, addr);
}

/** Drag a rack knob down by `dy` pixels (140 px is its full travel). */
async function dragDown(page, k, dy, steps = 8) {
  await page.mouse.move(k.x, k.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) await page.mouse.move(k.x, k.y + (dy * i) / steps);
  await page.mouse.up();
}


/** The wave chip's text: what the player reads on the rack. */
const chipText = (page, addr) => page.locator(`#rack-svg g[data-addr="${addr}"] .enum-text`);

/** Stop the bench's phrase as a player would: focus off ▶ first (Space on a
 *  focused button presses it), then Space. */
async function stopPhrase(page) {
  await page.locator("#rack-subject").click();
  await page.keyboard.press(" ");
  await expect(page.locator("#rack-play")).not.toHaveClass(/\bplaying\b/);
}

const replies = (page) => page.evaluate(() => window.__pwIO.benchAt.length);
const pageNow = (page) => page.evaluate(() => performance.now());
const peakDb = (page) => page.evaluate(() => window.__pwPeakDb());

/** Whether the bench's ▶ has lit as playing since page time `t`. */
const playedSince = (page, t) =>
  page.evaluate((s) => window.__pwPlaySaid.some((x) => x.t > s && x.playing), t);

/** A colour token as the browser computes it (`rgb(…)`), for `toHaveCSS`. */
const tokenRgb = (page, name) =>
  page.evaluate((n) => {
    const el = document.createElement("span");
    el.style.color = `var(${n})`;
    document.body.appendChild(el);
    const c = getComputedStyle(el).color;
    el.remove();
    return c;
  }, name);

/** Until the engine has answered past the `n`th edit, and `ms` more. */
async function pastReply(page, n, ms = 800) {
  await expect.poll(() => replies(page), { timeout: 30_000 }).toBeGreaterThan(n);
  await page.waitForTimeout(ms);
}

test("a VCO's wave cycled in PATCH is heard: live under a held note, and on ▶ and Space", async ({ page }) => {
  test.setTimeout(90_000);
  const errors = await boot(page);
  await openPreset(page, "Falling Sign");
  const { addr } = await waveKnob(page);
  await expect(chipText(page, addr)).toHaveText("sqr");

  // Live: the held note takes each wave in turn, square → sine → triangle.
  await holdC4(page);
  const first = await liveSpectrum(page);
  console.log(`[patch_audible] live sqr: ${fmt(first)}`);
  expectWave(first, "sqr", "live");
  for (const [was, want] of [["sqr", "sin"], ["sin", "tri"]]) {
    const n = await replies(page);
    await page.evaluate((w) => { window.__pwRec = window.__pwRecord(1500, w); }, C4);
    await clickWave(page);
    await expect(chipText(page, addr)).toHaveText(want);
    await expect.poll(async () => isWave(await liveSpectrum(page, 3), want), { timeout: 20_000 }).toBe(true);
    await settled(page);
    const s = await liveSpectrum(page);
    // For the log: the engine's reply, and the first read of the new wave
    // (an upper bound: the analyser's window is a third of a second long).
    const [chip, landed, snaps] = await page.evaluate(async (i) =>
      [window.__pwAt.chip, window.__pwIO.benchAt[i], await window.__pwRec], n);
    const heard = snaps.find((x) => x.at > chip && isWave(x, want));
    console.log(
      `[patch_audible] live ${was} → ${want}: reply ${Math.round(landed - chip)} ms after the click, ` +
        `new wave read ${heard ? Math.round(heard.at - chip) + " ms" : "after 1.5 s"}; ${fmt(s)}`,
    );
    expectWave(s, want, `live, after ${was} → ${want}`);
  }
  await page.keyboard.up("a");

  // Replay: ▶ plays the triangle, Space stops it, and Space again plays it.
  const onPlay = await replaySpectrum(page, () => page.locator("#rack-play").click(), 2200);
  console.log(`[patch_audible] ▶ tri: ${fmt(onPlay)} (${onPlay.n} reads)`);
  expectWave(onPlay, "tri", "▶");
  await stopPhrase(page);
  const onSpace = await replaySpectrum(page, () => page.keyboard.press(" "), 2200);
  console.log(`[patch_audible] Space tri: ${fmt(onSpace)} (${onSpace.n} reads)`);
  expectWave(onSpace, "tri", "Space");
  expect(errors).toEqual([]);
});

test("a selector changed under a held note keeps its level: the voices wait for the render and take its measured makeup", async ({ page }) => {
  test.setTimeout(90_000);
  const errors = await boot(page, { slowable: true });
  await openPreset(page, "Falling Sign");
  const fk = page.locator('#rack-svg g[data-addr="node#fkind"]');
  await expect(fk.locator(".enum-text")).toHaveText("svf lp");
  await holdC4(page);
  const before = await steadyRms(page);
  // The render behind the change takes a second and a half more on any
  // machine.
  await slowRender(page, 1500);
  const n = await replies(page);
  await page.evaluate((w) => { window.__pwRec = window.__pwRecord(2800, w); }, C4);
  await fk.locator(".enum-body").click();
  await expect(fk.locator(".enum-text")).toHaveText("svf bp");
  const [chip, snaps] = await page.evaluate(async () => [window.__pwAt.chip, await window.__pwRec]);
  await pastReply(page, n, 0);
  const [landed, voiced] = await page.evaluate(
    ([i, t]) => [window.__pwIO.benchAt[i], window.__pwVoiced.filter((x) => x > t)], [n, chip]);
  // The analyser's window is a third of a second: reads from 0.4 s after the
  // click until the reply hear only what played after the click.
  const inWindow = snaps.filter((x) => x.at > chip + 400 && x.at < landed - 50).map((x) => x.rms);
  const lo = Math.min(...inWindow), hi = Math.max(...inWindow);
  await settled(page);
  const after = await steadyRms(page);
  console.log(
    `[patch_audible] svf lp → svf bp under a held note: ${before.toFixed(1)} dB before; ` +
      `${lo.toFixed(1)} to ${hi.toFixed(1)} dB over ${inWindow.length} reads while the engine rendered (reply at ` +
      `${Math.round(landed - chip)} ms); the voices took the tree ${voiced.length ? Math.round(voiced[0] - chip) + " ms" : "never"} ` +
      `after the click; ${after.toFixed(1)} dB once it landed`,
  );
  expect(inWindow.length, "reads while the engine rendered").toBeGreaterThanOrEqual(10);
  expect(voiced.filter((t) => t < landed), "nothing reached the voices before the render").toEqual([]);
  expect(Math.max(hi - before, before - lo), "the level held while the engine rendered").toBeLessThan(1.5);
  expect(voiced.length, "the new mode reached the voices with the reply").toBe(1);
  // Measured on the whole phrase, the makeup does not level one held C4
  // exactly: band-pass sits 2.8 dB under low-pass here (the early tree played
  // it 14.6 dB under, for the length of the render).
  expect(Math.abs(after - before), "the new mode plays at its measured level").toBeLessThan(4);
  await page.keyboard.up("a");
  expect(errors).toEqual([]);
});

test("an undo and a redo of a selector keep the held note's level: the voices take the restored tree at its measured makeup", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = await boot(page, { slowable: true });
  await openPreset(page, "Falling Sign");
  const fk = page.locator('#rack-svg g[data-addr="node#fkind"]');
  await expect(fk.locator(".enum-text")).toHaveText("svf lp");
  // Low-pass to band-pass, measured; then each way back with the render
  // slowed by 1.5 s, under a held C4.
  await fk.locator(".enum-body").click();
  await expect(fk.locator(".enum-text")).toHaveText("svf bp");
  await settled(page);
  await holdC4(page);
  await steadyRms(page);
  await slowRender(page, 1500);
  for (const [key, want] of [["ControlOrMeta+z", "svf lp"], ["ControlOrMeta+Shift+z", "svf bp"]]) {
    const n = await page.evaluate(() => window.__pwIO.replies.length);
    await page.evaluate((w) => { window.__pwRec = window.__pwRecord(2600, w); }, C4);
    const t0 = await pageNow(page);
    await page.locator("#rack-subject").click();
    await page.keyboard.press(key);
    const snaps = await page.evaluate(() => window.__pwRec);
    await expect.poll(() => page.evaluate((i) => window.__pwIO.replies.length > i, n), { timeout: 30_000 }).toBe(true);
    const { reply, early } = await page.evaluate(([i, t]) => {
      const reply = window.__pwIO.replies[i];
      return { reply, early: window.__pwMakeups.filter((m) => m.t > t && m.t < reply.t && m.type === "patch") };
    }, [n, t0]);
    await expect(fk.locator(".enum-text")).toHaveText(want);
    await settled(page);
    const after = await steadyRms(page);
    const inWindow = snaps.filter((x) => x.at > (early[0]?.t ?? t0) + 400 && x.at < reply.t - 50).map((x) => x.rms);
    const lo = Math.min(...inWindow), hi = Math.max(...inWindow);
    const db = (g) => (20 * Math.log10(g)).toFixed(1);
    console.log(
      `[patch_audible] ${key} → ${want}: the voices took it ${early.length ? Math.round(early[0].t - t0) + " ms" : "never"} after the key ` +
        `at ${early.length ? db(early[0].makeup) : "?"} dB; the reply measured ${db(reply.makeup)} dB at ${Math.round(reply.t - t0)} ms; ` +
        `${lo.toFixed(1)} to ${hi.toFixed(1)} dBFS while it rendered, ${after.toFixed(1)} dBFS once it landed`,
    );
    expect(early.length, `${key}: the voices took the restored tree before its render`).toBe(1);
    expect(Math.abs(early[0].makeup / reply.makeup - 1), `${key}: at the makeup its render measures`).toBeLessThan(1e-9);
    expect(inWindow.length, "reads while the engine rendered").toBeGreaterThanOrEqual(8);
    expect(Math.max(hi - after, after - lo), `${key}: the level while it rendered is the level once it landed`).toBeLessThan(1.5);
  }
  await page.keyboard.up("a");
  expect(errors).toEqual([]);
});

test("a filter cutoff turned down in PATCH lowers the spectral centroid, live and on ▶", async ({ page }) => {
  test.setTimeout(90_000);
  const errors = await boot(page);
  await openPreset(page, "Falling Sign");
  const before = await replaySpectrum(page, () => page.locator("#rack-play").click(), 2200);
  await stopPhrase(page);
  await holdC4(page);
  const liveBefore = await liveSpectrum(page);

  const k = await rackKnob(page, "node#cut");
  expect(k, "Falling Sign's filter has a cutoff on the rack").not.toBeNull();
  await page.evaluate((w) => { window.__pwRec = window.__pwRecord(1500, w); }, C4);
  await dragDown(page, k, 42); // 0.3 of the knob's travel
  const turned = await rackKnob(page, "node#cut");
  expect(turned.value).toBeLessThan(k.value - 0.25);
  await expect
    .poll(async () => (await liveSpectrum(page, 3)).centroid, { timeout: 20_000 })
    .toBeLessThan(liveBefore.centroid * 0.7);
  await settled(page);
  const liveAfter = await liveSpectrum(page);
  const [pressed, snaps] = await page.evaluate(async () => [window.__pwAt.knob, await window.__pwRec]);
  const darker = snaps.find((x) => x.at > pressed && x.centroid < liveBefore.centroid * 0.7);
  const heardMs = darker ? Math.round(darker.at - pressed) : "over 1500";
  await page.keyboard.up("a");
  const after = await replaySpectrum(page, () => page.locator("#rack-play").click(), 2200);
  console.log(
    `[patch_audible] cutoff ${k.value.toFixed(2)} → ${turned.value.toFixed(2)} (${turned.text}): ` +
      `live centroid ${liveBefore.centroid.toFixed(0)} → ${liveAfter.centroid.toFixed(0)} Hz (read ${heardMs} ms after the press), ` +
      `▶ centroid ${before.centroid.toFixed(0)} → ${after.centroid.toFixed(0)} Hz; ` +
      `h3 live ${liveBefore.h3.toFixed(1)} → ${liveAfter.h3.toFixed(1)}, ▶ ${before.h3.toFixed(1)} → ${after.h3.toFixed(1)} dB`,
  );
  expect(liveAfter.centroid, "live").toBeLessThan(liveBefore.centroid * 0.7);
  expect(after.centroid, "▶").toBeLessThan(before.centroid * 0.7);
  // The fundamental is below the corner either way; the harmonics above it fall.
  expect(liveAfter.h3, "live 3rd harmonic").toBeLessThan(liveBefore.h3 - 6);
  expect(after.h3, "▶ 3rd harmonic").toBeLessThan(before.h3 - 6);
  expect(errors).toEqual([]);
});

test("a knob whose check finds a runaway is muted, as the alarm says, until a check passes", async ({ page }) => {
  test.setTimeout(90_000);
  const errors = await boot(page);
  await openPreset(page, "Falling Sign");
  await holdC4(page);
  const k = await rackKnob(page, "node#cut");
  const n = await replies(page);
  await page.evaluate(() => { window.__pwFailVet = true; });
  await dragDown(page, k, 6);
  await pastReply(page, n, 0);
  await expect(page.locator("#alarm")).toContainText("Muted");
  await expect.poll(() => peakDb(page), { timeout: 5_000, intervals: [100] }).toBeLessThan(-80);
  // The next turn passes its check, and the held note sounds again.
  const m = await replies(page);
  await dragDown(page, await rackKnob(page, "node#cut"), -6);
  await pastReply(page, m, 0);
  await expect(page.locator("#alarm")).not.toContainText("Muted");
  await expect.poll(() => peakDb(page), { timeout: 5_000, intervals: [100] }).toBeGreaterThan(-60);
  await page.keyboard.up("a");
  expect(errors).toEqual([]);
});

test("a selector whose check fails is not applied and says so, and a knob turned after it is not muted for it", async ({ page }) => {
  test.setTimeout(90_000);
  const errors = await boot(page);
  await openPreset(page, "Falling Sign");
  await holdC4(page);
  const alarm = page.locator("#alarm");
  // The wave's check fails: the voices keep the square, and the alarm says
  // the setting was not applied, not that anything was muted.
  let n = await replies(page);
  const t0 = await pageNow(page);
  await page.evaluate(() => { window.__pwFailVet = true; });
  await clickWave(page);
  await pastReply(page, n, 0);
  await expect(alarm).toContainText("Not applied");
  await expect(alarm).not.toContainText("Muted");
  expect(await page.evaluate((t) => window.__pwVoiced.filter((x) => x > t).length, t0), "the voices never took it").toBe(0);
  expectWave(await liveSpectrum(page), "sqr", "the keys play the sound from before the setting");
  // A knob turned now has its check fail too (the bench still holds the
  // wave), but the voices hold the tree from before the wave, never judged
  // with it: they are not muted for it.
  n = await replies(page);
  await page.evaluate(() => { window.__pwFailVet = true; });
  await dragDown(page, await rackKnob(page, "node#cut"), 6);
  await pastReply(page, n, 0);
  await expect(alarm).toContainText("Not applied");
  expect(await peakDb(page), "still sounding").toBeGreaterThan(-60);
  await page.keyboard.up("a");
  expect(errors).toEqual([]);
});

test("an edit's reply leaves alone the makeup of a preset opened while the edit rendered", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = await boot(page, { slowable: true });
  // Held Under opened once, so the page remembers it and plays it from the
  // click next time; then Pluck on the rack, with a knob turned.
  await openPreset(page, "Held Under");
  await openPreset(page, "Pluck");
  const k = await page.evaluate(() => window.__aur.wb.rack.modules.flatMap((m) => m.knobs).find((x) => x.kind.t === "continuous").addr);
  await dragDown(page, await rackKnob(page, k), 20);
  await settled(page);
  // ⌘Z reaches the voices as a tree at once, and its render takes a second
  // and a half more.
  await slowRender(page, 1500);
  const early = await page.evaluate(() => window.__pwIO.early.length);
  await page.locator("#rack-subject").click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => page.evaluate(() => window.__pwIO.early.length), { timeout: 10_000 }).toBeGreaterThan(early);
  const clicked = await pageNow(page);
  await page.locator('.bf[data-f="preset"]').click();
  await page.locator(".bank-item", { hasText: "Held Under" }).first().click();
  await expect(page.locator("#rack-subject")).toContainText("Held Under", { timeout: 60_000 });
  await settled(page);
  const { undo, open, after } = await page.evaluate((t) => ({
    undo: window.__pwIO.replies.find((r) => r.t > t && r.edited === "restore"),
    open: window.__pwIO.replies.find((r) => r.t > t && r.subject !== undefined),
    after: window.__pwMakeups.filter((m) => m.t > t),
  }), clicked);
  const db = (g) => (20 * Math.log10(g)).toFixed(1);
  console.log(
    `[patch_audible] the undo's reply (makeup ${undo ? db(undo.makeup) : "?"} dB) landed ` +
      `${undo && open ? Math.round(undo.t - clicked) + " ms after the click, the open's" : "?"} at ${open ? Math.round(open.t - clicked) : "?"} ms ` +
      `(${open ? db(open.makeup) : "?"} dB); the voices were handed ${after.map((m) => `${m.type} ${db(m.makeup)} dB`).join(", ")}`,
  );
  expect(undo, "the undo answered").toBeTruthy();
  expect(open, "the open answered").toBeTruthy();
  expect(Math.abs(Math.log10(undo.makeup / open.makeup)) * 20, "two makeups apart").toBeGreaterThan(6);
  expect(after.filter((m) => Math.abs(m.makeup - undo.makeup) < 1e-9), "the undo's makeup never reached Held Under's voices").toEqual([]);
  expect(after.length, "the voices took Held Under").toBeGreaterThan(0);
  expect(Math.abs(after[after.length - 1].makeup - open.makeup), "and play it at its own makeup").toBeLessThan(1e-9);
  expect(errors).toEqual([]);
});

test("▶ and Space pressed while a wave change is still at the engine play the changed patch", async ({ page }) => {
  test.setTimeout(90_000);
  const errors = await boot(page, { slowable: true });
  await openPreset(page, "Falling Sign");
  // The render behind a wave change takes the engine a few hundred ms; this
  // adds a second and a half on any machine, so the press below is always
  // inside it.
  await slow(page, { edit_param: 1500 });

  const pressedEarly = async (press, key) => {
    const n = await replies(page);
    const s = await replaySpectrum(page, press, 4500);
    const at = await page.evaluate(() => window.__pwAt);
    const landed = await page.evaluate((i) => window.__pwIO.benchAt[i], n);
    return { s, pressedMs: at[key] - at.chip, landedMs: landed - at.chip };
  };

  // ▶, at once: square → sine.
  let r = await pressedEarly(async () => {
    await clickWave(page);
    await page.locator("#rack-play").click();
  }, "play");
  console.log(`[patch_audible] ▶ ${Math.round(r.pressedMs)} ms after the chip, reply at ${Math.round(r.landedMs)} ms: ${fmt(r.s)}`);
  expect(r.pressedMs, "▶ was pressed while the edit was at the engine").toBeLessThan(r.landedMs);
  expectWave(r.s, "sin", "▶ pressed before the edit landed");
  await settled(page);
  await stopPhrase(page);

  // Space, at once: sine → triangle.
  r = await pressedEarly(async () => {
    await clickWave(page);
    await page.locator("#rack-subject").click();
    await page.keyboard.press(" ");
  }, "space");
  console.log(`[patch_audible] Space ${Math.round(r.pressedMs)} ms after the chip, reply at ${Math.round(r.landedMs)} ms: ${fmt(r.s)}`);
  expect(r.pressedMs, "Space was pressed while the edit was at the engine").toBeLessThan(r.landedMs);
  expectWave(r.s, "tri", "Space pressed before the edit landed");
  expect(errors).toEqual([]);
});

test("Space in PERFORM and EVOLVE plays the sound as edited, and waits for an edit still at the engine", async ({ page }) => {
  test.setTimeout(150_000);
  const errors = await boot(page, { slowable: true });
  await openPreset(page, "Falling Sign");
  const { addr } = await waveKnob(page);
  // Square → sine, landed: the preset as saved is square, the sound is sine.
  await clickWave(page);
  await expect(chipText(page, addr)).toHaveText("sin");
  await settled(page);
  const stop = async () => {
    await page.keyboard.press(" ");
    await expect.poll(() => peakDb(page), { timeout: 15_000, intervals: [100] }).toBeLessThan(-80);
  };
  for (const view of ["perform", "evolve"]) {
    await goLevel(page, view);
    const s = await replaySpectrum(page, () => page.keyboard.press(" "), 2200);
    console.log(`[patch_audible] Space in ${view}: ${fmt(s)} (${s.n} reads)`);
    expectWave(s, "sin", `Space in ${view}`);
    await stop();
  }

  // An edit still at the engine: the wave cycled in PATCH, the view left at
  // once and Space pressed there before the edit's reply. It plays the new
  // wave when the reply lands, not the one before.
  await slow(page, { edit_param: 1500 });
  for (const [view, want] of [["perform", "tri"], ["evolve", "saw"]]) {
    await goLevel(page, "patch");
    await quiet(page);
    const n = await replies(page);
    const s = await replaySpectrum(page, async () => {
      await clickWave(page);
      await goLevel(page, view);
      await page.keyboard.press(" ");
    }, 4500);
    const at = await page.evaluate(() => window.__pwAt);
    const landed = await page.evaluate((i) => window.__pwIO.benchAt[i], n);
    // The dock says Space waits, at once, and stops saying it when the
    // phrase starts.
    const dock = await page.evaluate((t) => window.__pwDockSaid.filter((d) => d.t >= t), at.space);
    const waits = dock.find((d) => d.text === "▶ waiting for the edit…");
    const done = waits && dock.find((d) => d.t > waits.t && d.text === "");
    console.log(
      `[patch_audible] Space in ${view} ${Math.round(at.space - at.chip)} ms after the chip, reply at ${Math.round(landed - at.chip)} ms; ` +
        `the dock said it waits ${waits ? Math.round(waits.t - at.space) + " ms" : "never"} after the press, until ` +
        `${done ? Math.round(done.t - at.space) + " ms" : "?"}: ${fmt(s)}`,
    );
    expect(at.space - at.chip, `Space in ${view} was pressed while the edit was at the engine`).toBeLessThan(landed - at.chip);
    expect(waits, `the dock says Space in ${view} waits`).toBeTruthy();
    expect(waits.live, "in a polite live region").toBe(true);
    expect(waits.whole, "whole, not clipped").toBe(true);
    expect(waits.onScreen, "on screen").toBe(true);
    expect(waits.clearOfKeys, "clear of the keybed").toBe(true);
    expect(waits.onTop, "and on top, so it is seen").toBe(true);
    expect(waits.t - at.space, "within 100 ms of the press").toBeLessThan(100);
    expect(done, "and stops saying it").toBeTruthy();
    expect(done.t, "once the edit has landed").toBeGreaterThanOrEqual(landed);
    expectWave(s, want, `Space in ${view}, pressed before the edit landed`);
    await stop();
    await settled(page);
  }
  expect(errors).toEqual([]);
});

test("a ▶ waiting for an edit is lit at once, and a second press, Space, another ▶ or leaving PATCH takes it back", async ({ page }) => {
  test.setTimeout(90_000);
  const errors = await boot(page, { slowable: true });
  await openPreset(page, "Falling Sign");
  await slow(page, { edit_param: 1000 });
  const play = page.locator("#rack-play");

  // Lit within 100 ms of the press, and pressed again, taken back: nothing
  // plays when the edit lands.
  let n = await replies(page);
  await clickWave(page);
  await play.click();
  await expect(play).toHaveClass(/\bpending\b/);
  await expect(play).toHaveAttribute("aria-busy", "true");
  const litMs = await page.evaluate(() => {
    const on = window.__pwPlaySaid.find((x) => x.t >= window.__pwAt.play && x.pending);
    return on ? on.t - window.__pwAt.play : null;
  });
  console.log(`[patch_audible] the waiting ▶ lit ${litMs == null ? "never" : Math.round(litMs) + " ms"} after the press`);
  expect(litMs, "lit within 100 ms of the press").not.toBeNull();
  expect(litMs, "lit within 100 ms of the press").toBeLessThan(100);
  let t0 = await pageNow(page);
  await play.click();
  await expect(play).not.toHaveClass(/\bpending\b/);
  await expect(play).not.toHaveAttribute("aria-busy", "true");
  await pastReply(page, n);
  expect(await playedSince(page, t0), "a ▶ taken back plays nothing when the edit lands").toBe(false);
  expect(await peakDb(page)).toBeLessThan(-80);
  await settled(page);

  // A phrase sounding and a ▶ waiting behind an edit: Space stops both.
  await play.click();
  await expect(play).toHaveClass(/\bplaying\b/);
  n = await replies(page);
  await clickWave(page);
  await play.click();
  await expect(play).toHaveClass(/\bpending\b/);
  // Playing and waiting at once, the glyph keeps the playing ink on the
  // green face (amber on it was 1.28:1).
  await expect(play).toHaveClass(/\bplaying\b/);
  // Read after the button's colour transition has run, not at its start
  // (where it still shows the colour it is leaving).
  const ink = await play.evaluate((el) => {
    for (const a of el.getAnimations()) a.finish();
    return getComputedStyle(el).color;
  });
  expect(ink, "the glyph's ink while playing and waiting").toBe(await tokenRgb(page, "--xport-lo"));
  await page.locator("#rack-subject").click();
  t0 = await pageNow(page);
  await page.keyboard.press(" ");
  await expect(play).not.toHaveClass(/\bplaying\b/);
  await expect(play).not.toHaveClass(/\bpending\b/);
  await pastReply(page, n);
  expect(await playedSince(page, t0), "Space took the waiting ▶ back as well as the phrase").toBe(false);
  expect(await peakDb(page)).toBeLessThan(-80);
  await settled(page);

  // Leaving PATCH takes it back: the bench's phrase does not start in PERFORM.
  n = await replies(page);
  await clickWave(page);
  await play.click();
  await expect(play).toHaveClass(/\bpending\b/);
  t0 = await pageNow(page);
  await goLevel(page, "perform");
  await expect(play).not.toHaveClass(/\bpending\b/);
  await pastReply(page, n);
  expect(await playedSince(page, t0), "nothing from PATCH starts in PERFORM").toBe(false);
  expect(await peakDb(page)).toBeLessThan(-80);
  await goLevel(page, "patch");
  await settled(page);

  // Another ▶ wins: a bank row's ▶ takes the wait back, and the edit landing
  // does not cut the row's phrase off.
  await page.locator('.bf[data-f="pool"]').click();
  const row = page.locator("#bank-list .bank-item .bi-hear").first();
  n = await replies(page);
  await clickWave(page);
  await play.click();
  await expect(play).toHaveClass(/\bpending\b/);
  t0 = await pageNow(page);
  await row.click();
  await expect(play).not.toHaveClass(/\bpending\b/);
  await expect(row).toHaveClass(/\bplaying\b/, { timeout: 30_000 });
  await pastReply(page, n);
  expect(await playedSince(page, t0), "the bench's ▶ does not start over the row's phrase").toBe(false);
  await expect(row).toHaveClass(/\bplaying\b/);
  await settled(page);

  // From the keyboard: ▶ focused and pressed with Enter while an edit is on
  // its way keeps its focus ring, with the waiting cue on its edge.
  n = await replies(page);
  await clickWave(page);
  await page.keyboard.press("Shift"); // the last input was a key: focus shows
  await play.focus();
  expect(await play.evaluate((el) => el.matches(":focus-visible")), "▶ has keyboard focus").toBe(true);
  await page.keyboard.press("Enter");
  await expect(play).toHaveClass(/\bpending\b/);
  await expect(play).toHaveCSS("outline-style", "solid");
  await expect(play).toHaveCSS("outline-width", "2px");
  await expect(play).toHaveCSS("outline-color", await tokenRgb(page, "--phos-a"));
  await expect(play).toHaveCSS("border-top-style", "dotted");
  await expect(play).toHaveCSS("border-top-color", await tokenRgb(page, "--phos-b"));
  await pastReply(page, n, 0);
  expect(errors).toEqual([]);
});

test("in PATCH, Space with nothing reaching the output says so, and does not play the patch from before the edit", async ({ page }) => {
  test.setTimeout(90_000);
  const errors = await boot(page);
  await openPreset(page, "Falling Sign");
  // Falling Sign's VCO is its only source: unplugged, nothing reaches the
  // output, and ▶ is disabled.
  const key = await page.evaluate(() => window.__aur.wb.rack.modules.find((m) => m.kind === "vco")?.key);
  await page.locator(`#rack-svg g.mod-group[data-key="${key}"] .mod-menu-btn`).first().click();
  await page.locator("#ctx-menu .cm-item").filter({ hasText: /^set aside/ }).first().click();
  await settled(page);
  await expect(page.locator("#rack-play")).toBeDisabled();
  // Its tooltip gives that reason, not the vet's sentence about a runaway.
  await expect(page.locator("span.tt:has(#rack-play)")).toHaveAttribute(
    "title", "Nothing reaches the output: plug a source into the empty socket first");
  await page.locator("#rack-subject").click();
  await page.keyboard.press(" ");
  await expect(page.locator("#toasts .toast-msg", { hasText: "Nothing to play" })).toBeVisible({ timeout: 5_000 });
  // The bank's render of the preset, which Space used to play here, would be
  // sounding by now.
  await page.waitForTimeout(1_000);
  expect(await peakDb(page), "nothing plays").toBeLessThan(-80);
  expect(errors).toEqual([]);
});
