// TRACK and CAPTURE in the app (Plan-007 tasks 5 and 6): the module rail,
// one tracked live voice, CAPTURE's RECORD, and the sounds a restore kept safe
// because their take couldn't be read.
//
// The browser's inputs are the stub audio_in.spec.js uses (tones per fake
// input, never a real microphone), granted for the tab where a test says so.
// The output is read off one analyser on the destination, as there.
//
// What this claims:
//
// - TRACK and CAPTURE are in the module rail; placing TRACK (which listens
//   through an AUDIO IN) asks the browser for an input, as AUDIO IN does.
// - A tracked sound, monitored, plays from the input with no key down (one
//   tracked voice), and keys played over it stop with their keys: after they
//   are let go, the level is the tracked voice's alone again.
// - CAPTURE's RECORD records what is patched into it and puts the new take
//   in the sound, as an edit: the module then says how long it is, and a key
//   plays it.
// - A sound whose take couldn't be read is kept safe, out of the pool,
//   listed under *kept safe*; RECORD AGAIN records it and brings it back into
//   the pool.
// - A take lands only on the sound it was recorded for: moving to another
//   sound stops RECORD and drops it; a keep as new is the same sound, and the
//   take lands on it. A STOP with nothing recorded sends no take.
// - RECORD waits for its input to open, records the one its CAPTURE reads
//   (while the bench reads another), and says so when the browser refuses it.
// - The bank's cursor reaches a sound kept safe past the pool's last row, and
//   Enter presses RECORD AGAIN.
// - AUDIO IN's and CAPTURE's buttons are on the rack's keyboard walk: Enter
//   goes into a module's controls and the arrows reach them after its knobs,
//   Enter or Space presses them, and the focus stays on a button the press
//   redrew.
const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");
const { goLevel, bankTab, openCatalog } = require("./shell");
const { budget } = require("./fixtures");
const { SLOW_ENGINE } = require("./perform_budget");

// The stub, and the page's spies, as audio_in.spec.js uses them.
const { STUB, INIT } = require("./audio_in_stub.js");

const GRANTED = `try { sessionStorage.setItem("__pwMicGranted", "1"); } catch (_) {}`;

// The engine's replies kept from main, in order, from the first of the type
// named in `window.__pwHoldFrom` on, until `window.__pwRelease()` hands them
// over: what main sees of a worker that is slow to answer. INIT's listener
// runs first, so `__pwLast` still records a reply as it arrives.
const HOLD = `(() => {
  const Inner = window.Worker;
  function Holding(url, opts) {
    const w = new Inner(url, opts);
    if (!/worker\\.js/.test(String(url))) return w;
    const held = [];
    let holding = false;
    w.addEventListener("message", (e) => {
      if (e.__pwReplay || !e.data) return;
      if (!holding && window.__pwHoldFrom && e.data.type === window.__pwHoldFrom) holding = true;
      if (!holding) return;
      e.stopImmediatePropagation();
      held.push(e.data);
    });
    window.__pwRelease = () => {
      holding = false;
      window.__pwHoldFrom = null;
      for (const data of held.splice(0)) {
        const ev = new MessageEvent("message", { data });
        ev.__pwReplay = true;
        w.dispatchEvent(ev);
      }
    };
    return w;
  }
  Holding.prototype = Inner.prototype;
  window.Worker = Holding;
})();`;

// AURACLE_CPU_THROTTLE=4 runs the page and the engine worker four times
// slower, as the fixture's boot does, so the races a slower CI runner loses
// show up on a fast machine.
const THROTTLE = Number(process.env.AURACLE_CPU_THROTTLE || 0);

async function boot(page, { granted = false, hold = false } = {}) {
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  if (granted) await page.addInitScript(GRANTED);
  await page.addInitScript(STUB);
  await page.addInitScript(INIT);
  if (hold) await page.addInitScript(HOLD);
  if (THROTTLE > 1) {
    await page.route(/\/worker\.js(\?|$)/, async (route) => {
      const resp = await route.fetch();
      await route.fulfill({ response: resp, body: SLOW_ENGINE(THROTTLE) + (await resp.text()), contentType: "text/javascript" });
    });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
  }
  await page.goto("/");
  await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 120_000 });
  await goLevel(page, "patch");
  return errors;
}

const amp = { attack: 0.01, decay: 0.3, sustain: 0.95, release: 0.05 };
const ain = (input) => ({ AudioIn: { input, gain: 24 / 36, channel: "Both" } });
const saw = { Vco: { wave: "Saw", octave: 0, detune: 0.5, mod_depth: 0, modulation: "None" } };

async function openFile(page, data, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${data.name.replace(/\s/g, "-")}.json`);
  fs.writeFileSync(file, JSON.stringify(data));
  await page.setInputFiles("#patch-import-input", file);
}

const at = (page, hz) => page.evaluate((h) => window.__pwAt(h), hz);
/** The loudest reading over `ms` (read every 100 ms): at `hz` (dB), or with
 *  `{ rms: true }` the whole output's RMS (dBFS). */
async function loudest(page, hz, ms = 1200, { rms = false } = {}) {
  let db = -Infinity;
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const r = await at(page, hz);
    if (r) db = Math.max(db, rms ? r.rms : r.db);
    await page.waitForTimeout(100);
  }
  return db;
}
const takes = (page) => page.evaluate(() => window.__aur.takes());

// AURACLE_SHOTS=dir saves the states a reviewer looks at, each after the rack
// has settled (a placement moves the plates).
const SHOTS = process.env.AURACLE_SHOTS || null;
async function shotOf(page, name, boxes, { scroll = false } = {}) {
  if (!SHOTS || boxes.length === 0) return;
  await page.waitForTimeout(1500);
  // A list's rows: brought into view once the list has settled.
  if (scroll) await boxes[0].evaluate((el) => el.scrollIntoView({ block: "center" }));
  const bs = (await Promise.all(boxes.map((l) => l.boundingBox()))).filter(Boolean);
  // The boxes with a margin, within the viewport.
  const m = 24;
  const vp = page.viewportSize();
  const x0 = Math.max(0, Math.min(...bs.map((b) => b.x)) - m);
  const y0 = Math.max(0, Math.min(...bs.map((b) => b.y)) - m);
  const x1 = Math.min(vp.width, Math.max(...bs.map((b) => b.x + b.width)) + m);
  const y1 = Math.min(vp.height, Math.max(...bs.map((b) => b.y + b.height)) + m);
  if (bs.length === 0 || x1 <= x0 || y1 <= y0) {
    console.log(`shot ${name} not taken: nothing on screen (${JSON.stringify(bs)})`);
    return;
  }
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), clip: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } });
}
const plate = (page, kind) => page.locator(`#rack-svg g.mod-group[data-kind='${kind}']`).first();

/** Arrow right from where the keyboard is until it stands on the plate
 *  button `stop` (a `data-stop`); how many presses that took. */
async function walkTo(page, stop, max = 24) {
  for (let n = 1; n <= max; n++) {
    await page.keyboard.press("ArrowRight");
    const on = await page.evaluate(() => document.activeElement?.getAttribute("data-stop"));
    if (on === stop) return n;
  }
  throw new Error(`the arrows never reached ${stop}`);
}
const focused = (page) => page.evaluate(() => {
  const a = document.activeElement;
  return { stop: a?.getAttribute("data-stop") || null, addr: a?.getAttribute("data-addr") || null, tab: a?.getAttribute("tabindex") };
});

/** A take in its saved form: `n` samples of a 330 Hz tone at 44.1 kHz. */
function takeOf(n) {
  const f = new Float32Array(n);
  for (let i = 0; i < n; i++) f[i] = 0.4 * Math.sin((i * 330 * 2 * Math.PI) / 44_100);
  return { format: "f32le-base64", sample_rate: 44_100, length: n, data: Buffer.from(f.buffer).toString("base64") };
}

test("TRACK and CAPTURE are in the module rail, and placing TRACK asks for an input", async ({ page }) => {
  const errors = await boot(page);
  await bankTab(page, "presets");
  await page.locator(".bank-item", { hasText: "Glass Pad" }).first().click();
  await expect(page.locator("#rack-subject")).toContainText("Glass Pad", { timeout: 60_000 });
  await openCatalog(page);
  for (const kind of ["track", "capture"]) {
    await expect(page.locator(`.nb-item[data-kind="${kind}"]`)).toHaveCount(1);
  }
  expect(await page.evaluate(() => window.__pwMic.calls.length)).toBe(0);
  const chip = page.locator('.nb-item[data-kind="track"]');
  await chip.scrollIntoViewIfNeeded();
  await chip.click();
  await page.locator("#rack-svg .jack.legal[data-childkey]").first().click();
  await expect.poll(() => page.evaluate(() => window.__pwMic.calls.length), { timeout: 10_000 }).toBe(1);
  await expect(page.locator("#rack-svg g.mod-group[data-kind='track']")).toHaveCount(1, { timeout: 30_000 });
  await expect(page.locator("#rack-svg g.mod-group[data-kind='audio_in']")).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("a tracked sound plays from the input with one voice, and keys over it stop with their keys", async ({ page }, info) => {
  const errors = await boot(page, { granted: true });
  // A saw VCO played by the pitch of input 1 (a 440 Hz tone).
  await openFile(page, {
    name: "Sung Saw",
    tree: { amp, root: { Track: { band: "mid", sensitivity: 0.5, dynamics: 0, input: saw, listen: ain(0) } } },
  }, info.outputDir);
  const lane = page.locator("#rack-svg .ain-lane").first();
  await expect(lane).toHaveAttribute("data-state", "live", { timeout: 60_000 });
  await page.waitForTimeout(1500);
  const off = await loudest(page, 440);
  await lane.locator(".ain-monitor").click();
  await expect.poll(() => loudest(page, 440, 600), { timeout: 15_000 }).toBeGreaterThan(-60);
  await page.waitForTimeout(1500);
  await shotOf(page, "track-plate", [plate(page, "track"), plate(page, "audio_in")]);
  const alone = await loudest(page, 440, 1500);
  const lead = await loudest(page, 440, 1500, { rms: true });
  // Keys over it: three held, then let go.
  for (const k of ["a", "d", "g"]) await page.keyboard.down(k);
  await page.waitForTimeout(1200);
  const held = await loudest(page, 440, 800, { rms: true });
  for (const k of ["a", "d", "g"]) await page.keyboard.up(k);
  await page.waitForTimeout(2500);
  const after = await loudest(page, 440, 1500);
  console.log(`440 Hz: unmonitored ${off.toFixed(1)} dB, the tracked voice ${alone.toFixed(1)} dB, keys let go ${after.toFixed(1)} dB; ` +
    `RMS: the tracked voice ${lead.toFixed(1)} dBFS, keys held ${held.toFixed(1)} dBFS (${(held - lead).toFixed(1)} dB)`);
  expect(off).toBeLessThan(-100);
  expect(alone).toBeGreaterThan(-45);
  // Every key plays the tracked note, so the held keys and the tracked voice
  // are four voices at one pitch, summing by their phases: at 440 Hz alone
  // they read anywhere from cancelled to in phase. A saw's whole output does
  // not cancel. The keys sound at a gain of 0.75 (a computer key's velocity,
  // 0.78, through the velocity curve) against the lead's 1.0 (the open voice
  // is held at full velocity); a saw at 1.0 and three at 0.75 of one period
  // sum to no less than 1.6 dB under the lead alone (their lowest, searched
  // over every phase), and to no more than 20·log10(1 + 3 × 0.75) = +10.2 dB
  // in phase, and the leveler and brickwall only take away. The keys sound,
  // as voices of the tracked note, and no more than three of them.
  expect(held).toBeGreaterThan(lead - 3);
  expect(held).toBeLessThan(lead + 11);
  // And they stop with their keys: the tracked voice alone again.
  expect(Math.abs(after - alone)).toBeLessThan(1);
  expect(errors).toEqual([]);
});

test("CAPTURE's RECORD puts a take of its input in the sound, and a key plays it", async ({ page }, info) => {
  const errors = await boot(page, { granted: true });
  await openFile(page, {
    name: "Mic Loop",
    // A short take to start from (a sound that plays nothing is not
    // taken into the pool): RECORD replaces it.
    tree: { amp, root: { Capture: { play: "hold", input: ain(0), take: takeOf(4000) } } },
  }, info.outputDir);
  const lane = page.locator("#rack-svg .take-lane").first();
  await expect(lane).toBeVisible({ timeout: 60_000 });
  await expect(lane.locator(".take-line")).toHaveText("take · 0.1 s");
  // Its input is open (the sound listens), so RECORD records the tone.
  await expect(page.locator("#rack-svg .ain-lane").first()).toHaveAttribute("data-state", "live", { timeout: 30_000 });
  // When RECORD and STOP were pressed, by the page's clock: the take is as
  // long as the time between them. Playwright's own steps between the two
  // clicks took half a second on a loaded CI runner, so a fixed "1.x s" read
  // the runner, not the take.
  await page.evaluate(() => {
    window.__recClicks = [];
    document.addEventListener("click", (e) => { if (e.target.closest && e.target.closest(".take-rec")) window.__recClicks.push(performance.now()); }, true);
  });
  await lane.locator(".take-rec").click();
  await expect(lane.locator(".take-rec")).toHaveClass(/\bon\b/);
  await expect(lane.locator(".take-line")).toHaveText("recording…");
  await page.waitForTimeout(1500);
  await lane.locator(".take-rec").click();
  await expect.poll(() => page.evaluate(() => window.__pwToasts.join("\n")), { timeout: 20_000 })
    .toMatch(/Recorded \d\.\d s into CAPTURE\./);
  const [recAt, stopAt] = await page.evaluate(() => window.__recClicks);
  const held = (stopAt - recAt) / 1000;
  await expect(lane.locator(".take-line")).toHaveText(/^take · \d\.\d s$/, { timeout: 30_000 });
  const said = Number((await lane.locator(".take-line").textContent()).match(/(\d\.\d) s/)[1]);
  console.log(`RECORD held ${held.toFixed(2)} s; the take says ${said} s`);
  expect(Math.abs(said - held), `a take of ${said} s for RECORD held ${held.toFixed(2)} s`).toBeLessThanOrEqual(0.15);
  await shotOf(page, "capture-plate", [plate(page, "capture"), plate(page, "audio_in")]);
  const len = await page.evaluate(() => {
    const t = window.__aur.wb.tree.root.Capture.take;
    return t ? t.length / t.sample_rate : 0;
  });
  console.log(`recorded ${len.toFixed(2)} s`);
  expect(len).toBeGreaterThan(1.0);
  // A key plays it: the tone (440 Hz) comes back from the take, with
  // nothing monitored.
  await page.waitForTimeout(1000);
  await page.keyboard.down("a");
  const played = await loudest(page, 440, 800);
  await page.keyboard.up("a");
  console.log(`the take, played from C4: ${played.toFixed(1)} dB at 440 Hz`);
  expect(played).toBeGreaterThan(-60);
  expect(errors).toEqual([]);
});

test("a STOP before anything was recorded leaves the take as it was, and says nothing was recorded", async ({ page }, info) => {
  const errors = await boot(page, { granted: true });
  await openFile(page, {
    name: "Mic Loop",
    tree: { amp, root: { Capture: { play: "hold", input: ain(0), take: takeOf(4000) } } },
  }, info.outputDir);
  const lane = page.locator("#rack-svg .take-lane").first();
  await expect(lane.locator(".take-line")).toHaveText("take · 0.1 s", { timeout: 60_000 });
  await expect(page.locator("#rack-svg .ain-lane").first()).toHaveAttribute("data-state", "live", { timeout: 30_000 });
  // The worklet's answer to a STOP before its first quantum is no frames
  // (apps/web/tests/worklet-take.test.mjs holds that exactly; a browser can
  // only race for it). Here the page is handed that answer while RECORD
  // rolls: it says nothing was recorded, and sends no take: not the one the
  // CAPTURE already holds, as if it were new (which was an edit, an undo
  // step and "Recorded 0.1 s").
  await lane.locator(".take-rec").click();
  await expect.poll(async () => (await takes(page)).rolling, { timeout: 10_000 }).toMatchObject({ waiting: false });
  await page.evaluate(() => {
    const live = window.__aur.getLive();
    live.node.port.dispatchEvent(new MessageEvent("message", {
      data: { type: "take_done", key: "node", buf: new Float32Array(16), frames: 0 },
    }));
    live.takeStop("node"); // the worklet's own recording ends (its answer finds nothing rolling)
  });
  await expect.poll(() => page.evaluate(() => window.__pwToasts.join("\n")), { timeout: 10_000 })
    .toContain("Nothing was recorded. Play into the capture’s input while STOP is lit, then try again.");
  await expect.poll(async () => (await takes(page)).rolling, { timeout: 10_000 }).toBe(null);
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => window.__pwToasts.join("\n"))).not.toMatch(/Recorded \d\.\d s into CAPTURE\./);
  await expect(lane.locator(".take-line")).toHaveText("take · 0.1 s");
  expect(errors).toEqual([]);
});

test("a recording stops when you move to another sound, and its take lands on neither", async ({ page }, info) => {
  const errors = await boot(page, { granted: true });
  // Two sounds with a CAPTURE at the same key: A holds 0.1 s, B 0.2 s.
  const capture = (n) => ({ amp, root: { Capture: { play: "hold", input: ain(0), take: takeOf(n) } } });
  await openFile(page, { name: "Loop A", tree: capture(4000) }, info.outputDir);
  await expect(page.locator("#rack-subject")).toContainText("Loop A", { timeout: 60_000 });
  await openFile(page, { name: "Loop B", tree: capture(8000) }, info.outputDir);
  await expect(page.locator("#rack-subject")).toContainText("Loop B", { timeout: 60_000 });
  const lane = page.locator("#rack-svg .take-lane").first();
  const line = lane.locator(".take-line");
  await expect(line).toHaveText("take · 0.2 s");
  await bankTab(page, "pool");
  const open = async (name) => {
    await page.locator("#bank-list .bank-item", { hasText: name }).first().locator(".bi-name").click();
    await expect(page.locator("#rack-subject")).toContainText(name, { timeout: 60_000 });
  };

  // Recording on A, then B opened before STOP.
  await open("Loop A");
  await expect(line).toHaveText("take · 0.1 s", { timeout: 30_000 });
  await expect(page.locator("#rack-svg .ain-lane").first()).toHaveAttribute("data-state", "live", { timeout: 30_000 });
  await lane.locator(".take-rec").click();
  await expect(line).toHaveText("recording…");
  await page.waitForTimeout(1200);
  await open("Loop B");
  await expect.poll(() => page.evaluate(() => window.__pwToasts.join("\n")), { timeout: 10_000 })
    .toContain("Recording stopped: you moved to another sound.");
  // B is as it was: its own take, RECORD not lit, and no take lands on it.
  await expect(line).toHaveText("take · 0.2 s", { timeout: 30_000 });
  await expect(lane.locator(".take-rec")).not.toHaveClass(/\bon\b/);
  await expect.poll(async () => (await takes(page)).rolling, { timeout: 10_000 }).toBe(null);
  await page.waitForTimeout(1500);
  await expect(line).toHaveText("take · 0.2 s");
  const toasts = await page.evaluate(() => window.__pwToasts.join("\n"));
  expect(toasts).not.toMatch(/Recorded \d\.\d s into CAPTURE\./);
  // …and A keeps its old take.
  await open("Loop A");
  await expect(line).toHaveText("take · 0.1 s", { timeout: 30_000 });
  expect(errors).toEqual([]);
});

/** A sound kept safe: Mic Loop saved on a first visit with its take made
 *  unreadable, then a new visit (`extra`: an init script for it, after the
 *  stub) that keeps it safe. Returns the new visit, at the pool, its kept-safe
 *  row on screen. */
async function keptSafeVisit(page, browser, info, { granted = true, extra = null } = {}) {
  await openFile(page, {
    name: "Mic Loop",
    tree: { amp, root: { Capture: { play: "hold", input: ain(0), take: takeOf(4000) } } },
  }, info.outputDir);
  await expect(page.locator("#rack-subject")).toContainText("Mic Loop", { timeout: 60_000 });
  const saves = await page.evaluate(() => window.__pwCounts.saved || 0);
  await expect.poll(() => page.evaluate(() => window.__pwCounts.saved || 0), { timeout: 30_000 }).toBeGreaterThan(saves);
  // The saved session, with that take made unreadable (its length no longer
  // agrees with its data).
  const record = await page.evaluate(() => new Promise((resolve) => {
    const req = indexedDB.open("auracle", 1);
    req.onsuccess = () => {
      const get = req.result.transaction("kv", "readonly").objectStore("kv").get("state");
      get.onsuccess = () => resolve(get.result);
    };
  }));
  expect(record.session).toContain('"length":4000');
  record.session = record.session.replace('"length":4000', '"length":4001');

  // A new visit with that save.
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const next = await ctx.newPage();
  const errors = [];
  next.on("pageerror", (err) => errors.push(err.message));
  if (granted) await next.addInitScript(GRANTED);
  await next.addInitScript(STUB);
  if (extra) await next.addInitScript(extra);
  await next.addInitScript(INIT);
  await next.goto("/pkg/build.json");
  await next.evaluate((rec) => new Promise((resolve) => {
    const req = indexedDB.open("auracle", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("kv");
    req.onsuccess = () => {
      const tx = req.result.transaction("kv", "readwrite");
      tx.objectStore("kv").put(rec, "state");
      tx.oncomplete = () => { req.result.close(); resolve(); };
    };
  }), record);
  await next.goto("/");
  await expect(next.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 120_000 });
  await expect.poll(() => next.evaluate(() => window.__pwToasts.join("\n")), { timeout: 30_000 })
    .toContain("One sound’s take couldn’t be read. It’s kept safe until you record it again.");
  await goLevel(next, "patch");
  await bankTab(next, "pool");
  const row = next.locator("#bank-list .kept-row", { hasText: "Mic Loop" });
  await expect(row).toBeVisible({ timeout: 30_000 });
  return { ctx, next, row, errors };
}

/** A player's beat between RECORD and STOP: the take is then longer than the
 *  0.1 s one the CAPTURE holds, and the two can't be read for each other. */
const RECORD_BEAT_MS = 500;

// The keep lands while RECORD records, however long the engine takes to keep
// the sound: its answer is held from main (HOLD) until RECORD is rolling.
// With RECORD pressed first and the keep's whole round trip after it, STOP
// came after RECORD's 4 s limit on a slow runner (#243: a keep of 3.2 s on
// CI, then a fixed 1.2 s), so RECORD had stopped itself and the click
// started another recording. Now STOP is pressed once the kept sound is in
// hand and its lane is lit: on a 16-core M3 Max 0.6 s into the recording,
// and 1.0 s at AURACLE_CPU_THROTTLE=4.
test("a recording goes on through a keep as new, and its take lands on the kept sound", async ({ page }, info) => {
  const errors = await boot(page, { granted: true, hold: true });
  await openFile(page, {
    name: "Mic Loop",
    tree: { amp, root: { Capture: { play: "hold", input: ain(0), take: takeOf(4000) } } },
  }, info.outputDir);
  // The CAPTURE's lane on the rack drawn now, never a leaving rack's copy
  // (`.rack-exit`; a keep draws none, the tree being the same).
  const lane = page.locator("#rack-svg > :not(.rack-exit) .take-lane").first();
  const rec = lane.locator(".take-rec");
  const line = lane.locator(".take-line");
  await expect(line).toHaveText("take · 0.1 s", { timeout: 60_000 });
  await expect(page.locator("#rack-svg .ain-lane").first()).toHaveAttribute("data-state", "live", { timeout: 30_000 });
  // An edit to keep: CAPTURE's PLAY from hold to the next.
  await page.locator('#rack-svg g[data-addr$="#play"]').first().click();
  await expect(page.locator("#rack-commit")).toBeEnabled({ timeout: 30_000 });
  // Kept as new (the express path: no card). The engine answers; main has
  // not heard it yet, and Mic Loop is still in hand.
  const before = await page.evaluate(() => (window.__pwLast.committed ? window.__pwLast.committed.id : null));
  await page.evaluate(() => {
    window.__pwHoldFrom = "committed";
    document.getElementById("improve-check").checked = true;
  });
  await page.locator("#rack-commit").click();
  await expect.poll(() => page.evaluate(() => (window.__pwLast.committed ? window.__pwLast.committed.id : null)), { timeout: 60_000 })
    .not.toBe(before);
  const kept = await page.evaluate(() => window.__pwLast.committed.id);
  await expect(page.locator("#live-label")).toContainText("Mic Loop");
  // RECORD, while the keep is on its way.
  await rec.click();
  await expect.poll(async () => (await takes(page)).rolling, { timeout: 10_000 }).toMatchObject({ waiting: false });
  // eslint-disable-next-line playwright/no-wait-for-timeout -- a player's beat between RECORD and STOP
  await page.waitForTimeout(RECORD_BEAT_MS);
  // The keep lands: the kept sound is in hand, and its CAPTURE's RECORD is
  // still lit, recording.
  await page.evaluate(() => window.__pwRelease());
  const name = await page.locator(`#bank-list .bank-item[data-id="${kept}"] .bi-name`).first().textContent();
  await expect(page.locator("#live-label")).toContainText(name);
  await expect(page.locator("#rack-subject")).toContainText(name);
  await expect(rec).toHaveAttribute("aria-pressed", "true");
  await expect(line).toHaveText("recording…");
  await expect.poll(async () => (await takes(page)).rolling).toMatchObject({ waiting: false, held: null });
  // STOP: the take is rendered and lands on the kept sound, as an edit.
  await rec.click();
  await expect.poll(async () => (await takes(page)).rolling, { timeout: 10_000 }).toBe(null);
  await expect(line).not.toHaveText("take · 0.1 s", { timeout: 30_000 });
  await expect(line).toHaveText(/^take · \d\.\d s$/);
  await expect(page.locator("#rack-subject")).toContainText(name);
  expect(await page.evaluate(() => window.__pwToasts.join("\n"))).not.toContain("you moved to another sound");
  expect(errors).toEqual([]);
});

test("a sound whose take couldn't be read is kept safe, and RECORD AGAIN brings it back", async ({ page, browser }, info) => {
  test.setTimeout(300_000);
  const errors = await boot(page, { granted: true });
  const { ctx, next, row, errors: errors2 } = await keptSafeVisit(page, browser, info);
  await expect(next.locator("#bank-list .bank-group.kept")).toContainText("kept safe");
  await shotOf(next, "kept-safe", [next.locator("#bank-list .bank-group.kept"), row], { scroll: true });
  expect(await next.locator("#bank-list .bank-item", { hasText: "Mic Loop" }).count()).toBe(0);

  // The bench reads input 2 (Fake Interface B), and Mic Loop input 1.
  await openFile(next, { name: "Line B", tree: { amp, root: ain(1) } }, info.outputDir);
  await expect(next.locator("#rack-svg .ain-lane").first()).toHaveAttribute("data-state", "live", { timeout: 60_000 });
  await bankTab(next, "pool");
  await expect(row).toBeVisible({ timeout: 30_000 });
  const ins = () => next.evaluate(() => window.__aur.audioIn());
  expect((await ins()).voiceId).toBe("mic-b");

  // RECORD AGAIN while the browser is slow to open Mic Loop's input: the
  // recording waits for it, and starts once it is open and connected.
  await next.evaluate(() => { window.__pwMic.hold = new Promise((r) => (window.__pwRelease = r)); });
  await row.locator(".kept-rec").click();
  await expect.poll(async () => (await takes(next)).rolling, { timeout: 10_000 }).toMatchObject({ waiting: true });
  await next.waitForTimeout(1500);
  expect((await takes(next)).rolling).toMatchObject({ waiting: true });
  expect((await ins()).recordId).toBe(null);
  await next.evaluate(() => window.__pwRelease());
  await expect.poll(async () => (await takes(next)).rolling, { timeout: 10_000 }).toMatchObject({ waiting: false });
  // It records Mic Loop's input, while the voices go on reading the bench's.
  const st = await ins();
  expect(st.recordId).toBe("mic-a");
  expect(st.voiceId).toBe("mic-b");
  await next.waitForTimeout(1500);
  await row.locator(".kept-rec").click();
  await expect.poll(() => next.evaluate(() => window.__pwToasts.join("\n")), { timeout: 30_000 })
    .toContain("Mic Loop has a new take, and it’s back in the pool.");
  await expect(next.locator("#bank-list .kept-row")).toHaveCount(0, { timeout: 30_000 });
  await expect(next.locator("#bank-list .bank-item", { hasText: "Mic Loop" }).first()).toBeVisible({ timeout: 30_000 });
  expect((await takes(next)).held).toEqual([]);
  // The input lent for it is closed again: the bench reads only input 2.
  await expect.poll(async () => (await ins()).open, { timeout: 10_000 }).toEqual(["mic-b"]);
  await ctx.close();
  expect(errors).toEqual([]);
  expect(errors2).toEqual([]);
});

test("RECORD AGAIN says plainly when the browser refuses the input, and records nothing", async ({ page, browser }, info) => {
  test.setTimeout(300_000);
  const errors = await boot(page, { granted: true });
  const { ctx, next, row, errors: errors2 } = await keptSafeVisit(page, browser, info, {
    granted: false,
    extra: "window.__pwMic.refuse = true;",
  });
  // From the keyboard: the bank's cursor runs on past the pool's last row
  // onto the sound kept safe, and Enter presses RECORD AGAIN.
  await next.locator("#bank-list").focus();
  let presses = 0;
  while (presses < 120 && (await row.getAttribute("class")).split(" ").indexOf("kbd") < 0) {
    await next.keyboard.press("ArrowDown");
    presses++;
  }
  await expect(row).toHaveClass(/\bkbd\b/);
  await expect(next.locator("#bank-list")).toHaveAttribute("aria-activedescendant", await row.getAttribute("id"));
  console.log(`the kept-safe row is ${presses} arrows down`);
  await next.keyboard.press("Enter");
  await expect.poll(() => next.evaluate(() => window.__pwToasts.join("\n")), { timeout: 15_000 })
    .toContain("The browser was refused the input, so nothing was recorded. Allow the microphone in this site’s settings, then press RECORD again.");
  await expect.poll(async () => (await takes(next)).rolling, { timeout: 10_000 }).toBe(null);
  // Still kept safe, and RECORD AGAIN is there to press once it's allowed.
  await expect(row).toBeVisible();
  await expect(row.locator(".kept-rec")).toHaveText(/record again/i);
  expect((await takes(next)).held.length).toBe(1);
  await ctx.close();
  expect(errors).toEqual([]);
  expect(errors2).toEqual([]);
});

test("AUDIO IN's and CAPTURE's buttons are reached from the keyboard and pressed with it", async ({ page }, info) => {
  const errors = await boot(page, { granted: true });
  await openFile(page, {
    name: "Mic Loop",
    tree: { amp, root: { Capture: { play: "hold", input: ain(0), take: takeOf(4000) } } },
  }, info.outputDir);
  const take = page.locator("#rack-svg .take-lane").first();
  const input = page.locator("#rack-svg .ain-lane").first();
  await expect(take).toBeVisible({ timeout: 60_000 });
  await expect(input).toHaveAttribute("data-state", "live", { timeout: 30_000 });

  // CAPTURE: from its plate, Enter into its controls, past its knob, to
  // RECORD; Enter rolls, Enter stops, and the take lands.
  await plate(page, "capture").focus();
  await page.keyboard.press("Enter");
  const toRec = await walkTo(page, "take-rec");
  expect((await focused(page)).tab).toBe("0");
  await page.keyboard.press("Enter");
  await expect(take.locator(".take-rec")).toHaveClass(/\bon\b/);
  await page.waitForTimeout(1200);
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => window.__pwToasts.join("\n")), { timeout: 20_000 })
    .toMatch(/Recorded \d\.\d s into CAPTURE\./);
  // A new take, at least a second long: the keys held RECORD for 1.2 s. How
  // much longer it is, is Playwright's pace between the two keys on this
  // machine ("1.x s" read that as a bound): a budget (ADR-022).
  await expect(take.locator(".take-line")).toHaveText(/^take · \d\.\d s$/, { timeout: 30_000 });
  const took = Number((await take.locator(".take-line").textContent()).match(/(\d\.\d) s/)[1]);
  expect(took, "the take is as long as RECORD was held from the keyboard").toBeGreaterThanOrEqual(1.0);
  budget("RECORD held 1.2 s from the keyboard → the take's length", took * 1000, 1999);
  // The take is an edit, so the rack was drawn again: the keyboard is still
  // on RECORD.
  await expect.poll(async () => (await focused(page)).stop, { timeout: 10_000 }).toBe("take-rec");

  // AUDIO IN: its input line, then MONITOR; Space presses MONITOR, and the
  // arrows go on to NEW CLIP. ALLOW INPUT is hidden while the input is open,
  // so the walk passes it by.
  await plate(page, "audio_in").focus();
  await page.keyboard.press("Enter");
  const toLine = await walkTo(page, "ain-dev");
  await page.keyboard.press("ArrowRight");
  expect((await focused(page)).stop).toBe("ain-monitor");
  await page.keyboard.press(" ");
  await expect(input.locator(".ain-monitor")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("ArrowRight");
  expect((await focused(page)).stop).toBe("ain-clip");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  expect((await focused(page)).stop).toBe("ain-dev");
  // Enter on the input line opens the input menu, as a click does.
  await page.keyboard.press("Enter");
  await expect(page.locator("#ctx-menu")).toBeVisible();
  await expect(page.locator("#ctx-menu .cm-item").first()).toHaveText(/^1 · Fake Mic A/);
  await page.keyboard.press("Escape");
  // Escape on a button backs out to its plate, as on a knob.
  await plate(page, "audio_in").locator("[data-stop='ain-monitor']").focus();
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => document.activeElement?.getAttribute("data-kind"))).toBe("audio_in");
  console.log(`arrows from the plate: ${toRec} to RECORD, ${toLine} to AUDIO IN's input line`);
  expect(errors).toEqual([]);
});
