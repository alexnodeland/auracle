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
// - Turning the filter's cutoff down lowers the centroid and the 3rd harmonic,
//   live and on ▶.
// - ▶ or Space pressed while a wave change is still at the engine plays the
//   changed patch. The bench's buffer is the phrase rendered before the edit
//   until the edit's reply replaces it, and a press in that window used to
//   play the old wave.
// - A ▶ waiting like that is lit (`.pending`) within 100 ms of the press, and
//   plays nothing when the edit lands if it was taken back: by a second press,
//   by Space (which also stops a phrase already sounding), by leaving PATCH,
//   or by another ▶ (a bank row's, whose phrase it then does not cut off).
// - In PATCH, Space with ▶ disabled (nothing reaches the output) says so and
//   plays nothing, rather than the bank's render of the patch before the edit.
//
// The engine is made slow for real where a test needs the window between an
// edit and its reply (a busy-wait prepended to worker.js, as
// patch_editing.spec.js does), so the window is wide on any machine.
//
// What it does not claim: that the harmonic levels are exact (the tolerances
// are a few dB either side of the textbook values); how quickly a wave change
// is heard live (it waits for the engine's render, a few hundred ms; the log
// prints it); anything about ▶ or Space in the other views, which play the
// bank's render of the patch, not the bench's; anything about other patches.
const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");

const INIT = `(() => {
  const Orig = window.Worker;
  const workers = (window.__pwWorkers = []);
  const io = (window.__pwIO = { out: 0, in: 0, benchAt: [] });
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
        if ((d.type === "bench" && d.edited !== undefined) || d.type === "edit_rejected") {
          io.in += 1;
          io.benchAt.push(performance.now());
        }
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

  // Every spectrum for \`ms\` from now, stamped with its time.
  window.__pwRecord = (ms, want) => new Promise((resolve) => {
    const out = [];
    const t0 = performance.now();
    const step = () => {
      const t = performance.now() - t0;
      const s = window.__pwSpectrum(want);
      if (s) out.push({ t, at: t0 + t, ...s });
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
const SLOW = `let __pwSlow = {};
self.addEventListener("message", (e) => {
  const d = e.data;
  if (d && d.type === "__pw_slow") { __pwSlow = d.slow || {}; e.stopImmediatePropagation(); return; }
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
  await page.locator('.viewtab[data-view="perform"]').click();
  await expect(play).not.toHaveClass(/\bpending\b/);
  await pastReply(page, n);
  expect(await playedSince(page, t0), "nothing from PATCH starts in PERFORM").toBe(false);
  expect(await peakDb(page)).toBeLessThan(-80);
  await page.locator('.viewtab[data-view="play"]').click();
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
  await page.locator("#ctx-menu .cm-item").filter({ hasText: /^extract to HELD/ }).first().click();
  await settled(page);
  await expect(page.locator("#rack-play")).toBeDisabled();
  await page.locator("#rack-subject").click();
  await page.keyboard.press(" ");
  await expect(page.locator("#toasts .toast-msg", { hasText: "nothing to play" })).toBeVisible({ timeout: 5_000 });
  // The bank's render of the preset, which Space used to play here, would be
  // sounding by now.
  await page.waitForTimeout(1_000);
  expect(await peakDb(page), "nothing plays").toBeLessThan(-80);
  expect(errors).toEqual([]);
});
