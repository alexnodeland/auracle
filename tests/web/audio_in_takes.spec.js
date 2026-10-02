// TRACK and CAPTURE in the app (Plan-007 tasks 5 and 6): the module rail,
// one tracked live voice, CAPTURE's RECORD, and the sounds a restore kept safe
// because their recording couldn't be read.
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
// - CAPTURE's RECORD records what is patched into it and puts the recording
//   in the sound, as an edit: the module then says how long it is, and a key
//   plays it.
// - A sound whose recording couldn't be read is kept safe, out of the pool,
//   listed under *kept safe*; RECORD AGAIN records it and brings it back into
//   the pool.
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
const vco = { Vco: { wave: "Sine", octave: 0, detune: 0.5, mod_depth: 0, modulation: "None" } };

async function openFile(page, data, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${data.name.replace(/\s/g, "-")}.json`);
  fs.writeFileSync(file, JSON.stringify(data));
  await page.setInputFiles("#patch-import-input", file);
}

const at = (page, hz) => page.evaluate((h) => window.__pwAt(h), hz);
async function loudest(page, hz, ms = 1200) {
  let db = -Infinity;
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const r = await at(page, hz);
    if (r) db = Math.max(db, r.db);
    await page.waitForTimeout(100);
  }
  return db;
}
const takes = (page) => page.evaluate(() => window.__aur.takes());

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
  // A sine VCO played by the pitch of input 1 (a 440 Hz tone).
  await openFile(page, {
    name: "Sung Sine",
    tree: { amp, root: { Track: { band: "mid", sensitivity: 0.5, dynamics: 0, input: vco, listen: ain(0) } } },
  }, info.outputDir);
  const lane = page.locator("#rack-svg .ain-lane").first();
  await expect(lane).toHaveAttribute("data-state", "live", { timeout: 60_000 });
  await page.waitForTimeout(1500);
  const off = await loudest(page, 440);
  await lane.locator(".ain-monitor").click();
  await expect.poll(() => loudest(page, 440, 600), { timeout: 15_000 }).toBeGreaterThan(-60);
  await page.waitForTimeout(1500);
  const alone = await loudest(page, 440, 1500);
  // Keys over it: three held, then let go.
  for (const k of ["a", "d", "g"]) await page.keyboard.down(k);
  await page.waitForTimeout(1200);
  const held = await loudest(page, 440, 800);
  for (const k of ["a", "d", "g"]) await page.keyboard.up(k);
  await page.waitForTimeout(2500);
  const after = await loudest(page, 440, 1500);
  console.log(`440 Hz: unmonitored ${off.toFixed(1)} dB, the tracked voice ${alone.toFixed(1)} dB, keys held ${held.toFixed(1)} dB, keys let go ${after.toFixed(1)} dB`);
  expect(off).toBeLessThan(-100);
  expect(alone).toBeGreaterThan(-45);
  expect(held).toBeGreaterThan(alone + 1);
  expect(Math.abs(after - alone)).toBeLessThan(1);
  expect(errors).toEqual([]);
});

test("CAPTURE's RECORD puts a recording of its input in the sound, and a key plays it", async ({ page }, info) => {
  const errors = await boot(page, { granted: true });
  await openFile(page, {
    name: "Mic Loop",
    // A short recording to start from (a sound that plays nothing is not
    // taken into the pool): RECORD replaces it.
    tree: { amp, root: { Capture: { play: "hold", input: ain(0), take: takeOf(4000) } } },
  }, info.outputDir);
  const lane = page.locator("#rack-svg .take-lane").first();
  await expect(lane).toBeVisible({ timeout: 60_000 });
  await expect(lane.locator(".take-line")).toHaveText("recording · 0.1 s");
  // Its input is open (the sound listens), so RECORD records the tone.
  await expect(page.locator("#rack-svg .ain-lane").first()).toHaveAttribute("data-state", "live", { timeout: 30_000 });
  await lane.locator(".take-rec").click();
  await expect(lane.locator(".take-rec")).toHaveClass(/\bon\b/);
  await expect(lane.locator(".take-line")).toHaveText("recording…");
  await page.waitForTimeout(1500);
  await lane.locator(".take-rec").click();
  await expect.poll(() => page.evaluate(() => window.__pwToasts.join("\n")), { timeout: 20_000 })
    .toMatch(/Recorded \d\.\d s into CAPTURE\./);
  await expect(lane.locator(".take-line")).toHaveText(/^recording · 1\.\d s$/, { timeout: 30_000 });
  const len = await page.evaluate(() => {
    const t = window.__aur.wb.tree.root.Capture.take;
    return t ? t.length / t.sample_rate : 0;
  });
  console.log(`recorded ${len.toFixed(2)} s`);
  expect(len).toBeGreaterThan(1.0);
  // A key plays it: the tone (440 Hz) comes back from the recording, with
  // nothing monitored.
  await page.waitForTimeout(1000);
  await page.keyboard.down("a");
  const played = await loudest(page, 440, 800);
  await page.keyboard.up("a");
  console.log(`the recording, played from C4: ${played.toFixed(1)} dB at 440 Hz`);
  expect(played).toBeGreaterThan(-60);
  expect(errors).toEqual([]);
});

test("a sound whose recording couldn't be read is kept safe, and RECORD AGAIN brings it back", async ({ page, browser }, info) => {
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
    .toContain("One sound’s recording couldn’t be read. It’s kept safe until you record it again.");
  await next.locator('.viewtab[data-view="play"]').click();
  await next.locator('.bf[data-f="pool"]').click();
  const row = next.locator("#bank-list .kept-row", { hasText: "Mic Loop" });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await expect(next.locator("#bank-list .bank-group.kept")).toContainText("kept safe");
  expect(await next.locator("#bank-list .bank-item", { hasText: "Mic Loop" }).count()).toBe(0);

  await row.locator(".kept-rec").click();
  await expect.poll(async () => (await takes(next)).rolling, { timeout: 10_000 }).not.toBe(null);
  await next.waitForTimeout(1500);
  await row.locator(".kept-rec").click();
  await expect.poll(() => next.evaluate(() => window.__pwToasts.join("\n")), { timeout: 30_000 })
    .toContain("Mic Loop has its recording again, and it’s back in the pool.");
  await expect(next.locator("#bank-list .kept-row")).toHaveCount(0, { timeout: 30_000 });
  await expect(next.locator("#bank-list .bank-item", { hasText: "Mic Loop" }).first()).toBeVisible({ timeout: 30_000 });
  expect((await takes(next)).held).toEqual([]);
  await ctx.close();
  expect(errors).toEqual([]);
  expect(errors2).toEqual([]);
});
