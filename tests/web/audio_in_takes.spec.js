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
// - AUDIO IN's and CAPTURE's buttons are on the rack's keyboard walk: the
//   arrows reach them after a module's knobs, Enter or Space presses them,
//   and the focus stays on a button the press redrew.
const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");

// The stub, and the page's spies, as audio_in.spec.js uses them.
const { STUB, INIT } = require("./audio_in_stub.js");

const GRANTED = `try { sessionStorage.setItem("__pwMicGranted", "1"); } catch (_) {}`;

async function boot(page, { granted = false } = {}) {
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  if (granted) await page.addInitScript(GRANTED);
  await page.addInitScript(STUB);
  await page.addInitScript(INIT);
  await page.goto("/");
  await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 120_000 });
  await page.locator('.viewtab[data-view="play"]').click();
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
  await page.locator('.bf[data-f="preset"]').click();
  await page.locator(".bank-item", { hasText: "Glass Pad" }).first().click();
  await expect(page.locator("#rack-subject")).toContainText("Glass Pad", { timeout: 60_000 });
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
  // not cancel: four saws of one period sum to no less than one saw's RMS
  // (evenly spaced, a saw of a quarter the period) and to no more than four
  // in phase (+12 dB), and the leveler and brickwall only take away. The keys
  // sound, as voices of the tracked note, and no more than four of them.
  expect(held).toBeGreaterThan(lead - 3);
  expect(held).toBeLessThan(lead + 13);
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
  await lane.locator(".take-rec").click();
  await expect(lane.locator(".take-rec")).toHaveClass(/\bon\b/);
  await expect(lane.locator(".take-line")).toHaveText("recording…");
  await page.waitForTimeout(1500);
  await lane.locator(".take-rec").click();
  await expect.poll(() => page.evaluate(() => window.__pwToasts.join("\n")), { timeout: 20_000 })
    .toMatch(/Recorded \d\.\d s into CAPTURE\./);
  await expect(lane.locator(".take-line")).toHaveText(/^take · 1\.\d s$/, { timeout: 30_000 });
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
  // RECORD and STOP in one task: both reach the worklet before its next
  // quantum, so nothing is recorded. The CAPTURE's take is not sent back as
  // a new one (which was an edit, an undo step and "Recorded 0.1 s").
  await lane.locator(".take-rec").evaluate((b) => {
    b.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    b.dispatchEvent(new MouseEvent("click", { bubbles: true }));
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
  await page.locator('.bf[data-f="pool"]').click();
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

test("a sound whose take couldn't be read is kept safe, and RECORD AGAIN brings it back", async ({ page, browser }, info) => {
  test.setTimeout(300_000);
  const errors = await boot(page, { granted: true });
  await openFile(page, {
    name: "Mic Loop",
    tree: { amp, root: { Capture: { play: "hold", input: ain(0), take: takeOf(4000) } } },
  }, info.outputDir);
  await expect(page.locator("#rack-subject")).toContainText("Mic Loop", { timeout: 60_000 });
  const saves = await page.evaluate(() => window.__pwCounts.saved || 0);
  await expect.poll(() => page.evaluate(() => window.__pwCounts.saved || 0), { timeout: 30_000 }).toBeGreaterThan(saves);
  // The saved session, with that recording made unreadable (its length no
  // longer agrees with its data).
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
  const errors2 = [];
  next.on("pageerror", (err) => errors2.push(err.message));
  await next.addInitScript(GRANTED);
  await next.addInitScript(STUB);
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
  await next.locator('.viewtab[data-view="play"]').click();
  await next.locator('.bf[data-f="pool"]').click();
  const row = next.locator("#bank-list .kept-row", { hasText: "Mic Loop" });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await expect(next.locator("#bank-list .bank-group.kept")).toContainText("kept safe");
  await shotOf(next, "kept-safe", [next.locator("#bank-list .bank-group.kept"), row], { scroll: true });
  expect(await next.locator("#bank-list .bank-item", { hasText: "Mic Loop" }).count()).toBe(0);

  await row.locator(".kept-rec").click();
  await expect.poll(async () => (await takes(next)).rolling, { timeout: 10_000 }).not.toBe(null);
  await next.waitForTimeout(1500);
  await row.locator(".kept-rec").click();
  await expect.poll(() => next.evaluate(() => window.__pwToasts.join("\n")), { timeout: 30_000 })
    .toContain("Mic Loop has a new take, and it’s back in the pool.");
  await expect(next.locator("#bank-list .kept-row")).toHaveCount(0, { timeout: 30_000 });
  await expect(next.locator("#bank-list .bank-item", { hasText: "Mic Loop" }).first()).toBeVisible({ timeout: 30_000 });
  expect((await takes(next)).held).toEqual([]);
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

  // CAPTURE: from its plate, past its knob, to RECORD; Enter rolls, Enter
  // stops, and the take lands.
  await plate(page, "capture").focus();
  const toRec = await walkTo(page, "take-rec");
  expect((await focused(page)).tab).toBe("0");
  await page.keyboard.press("Enter");
  await expect(take.locator(".take-rec")).toHaveClass(/\bon\b/);
  await page.waitForTimeout(1200);
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => window.__pwToasts.join("\n")), { timeout: 20_000 })
    .toMatch(/Recorded \d\.\d s into CAPTURE\./);
  await expect(take.locator(".take-line")).toHaveText(/^take · 1\.\d s$/, { timeout: 30_000 });
  // The take is an edit, so the rack was drawn again: the keyboard is still
  // on RECORD.
  await expect.poll(async () => (await focused(page)).stop, { timeout: 10_000 }).toBe("take-rec");

  // AUDIO IN: its input line, then MONITOR; Space presses MONITOR, and the
  // arrows go on to NEW CLIP. ALLOW INPUT is hidden while the input is open,
  // so the walk passes it by.
  await plate(page, "audio_in").focus();
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
