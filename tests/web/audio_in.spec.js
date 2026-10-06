// AUDIO IN: your own input in the patch (Plan-007 task 4, ADR-015).
//
// The browser's inputs are a stub (an init script): `getUserMedia` answers
// with a tone per fake device (Fake Mic A at 440 Hz, Fake Interface B at
// 660 Hz) from an oscillator in the stub's own AudioContext, never from a real
// microphone; `enumerateDevices` lists them; `navigator.permissions` answers
// for the microphone; an unplug ends the device's tracks and fires
// `devicechange`, as a real one does. The browser's grant lasts the tab
// (sessionStorage), as a real grant outlives a reload.
//
// The output is read as patch_audible.spec.js reads it: anything the app
// connects to the destination is also connected to one analyser, and its
// spectrum is read at the tone.
//
// What this claims:
//
// - The browser is asked for an input only when a player adds AUDIO IN: not at
//   boot, not on opening or playing sounds, not on placing another module.
//   While the browser's prompt is up, the app says what the input is for.
// - A refusal keeps AUDIO IN in the patch and plays it silent, says so, and
//   ASK AGAIN asks again.
// - One capture stream per input: a patch with three AUDIO INs on two inputs
//   opens each device once, and every module reading an input shows its
//   level. Picking an input from a module's menu reuses the stream already
//   open.
// - The input reaches the voices: a tone in is heard at the output with no
//   key down once MONITOR is on, and not at all while it is off, even with a
//   key held. Monitoring starts off on every load, and a sound that listens
//   opened after a reload gets its input without a prompt.
// - The first listen captures a clip and the engine takes it as the
//   session's audition clip; NEW CLIP captures another. The clip is saved
//   with the session, and after a reload it is the session's clip again.
//   (That the farm is then handed the phrase with the clip, after a capture
//   or a restore, is the engine worker's: tests/worker/farm.test.mjs.)
// - An unplugged input silences its module and says so; plugged back in, it
//   is reopened and heard again.
// - The browser's "default" is numbered as the input it stands for, even when
//   only the list's "Default - X" label names it.
// - The plate's square draws the input's live face (against the bank's
//   faces) while it plays, and nothing, level included, once it is gone.
//
// What it does not claim: anything about a real microphone, the latency of
// the worklet path, or what the clip does to a sound's ratings (the engine's
// tests hold that).
const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");
const { goLevel, bankTab, openCatalog } = require("./shell");

const SHOTS = process.env.AURACLE_SHOTS || null;

const { STUB, INIT } = require("./audio_in_stub.js");

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

async function boot(page) {
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await page.addInitScript(STUB);
  await page.addInitScript(INIT);
  await page.goto("/");
  await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 120_000 });
  return errors;
}

async function openPreset(page, name) {
  await goLevel(page, "patch");
  await bankTab(page, "presets");
  await page.locator(".bank-item", { hasText: name }).first().click();
  await expect(page.locator("#rack-subject")).toContainText(name, { timeout: 60_000 });
  await expect(page.locator("#rack-svg .knob-hit").first()).toBeVisible();
}

/** Place AUDIO IN from the module rail into the first socket it lights. */
async function placeAudioIn(page) {
  await openCatalog(page);
  const chip = page.locator('.nb-item[data-kind="audio_in"]');
  await chip.scrollIntoViewIfNeeded();
  await chip.click();
  await page.locator("#rack-svg .jack.legal[data-childkey]").first().click();
}

const lane = (page) => page.locator("#rack-svg .ain-lane").first();
/** The audition clip's source in the session main stored (IndexedDB
 *  `auracle`, `kv`, `state`, as fixtures.js `savedUi` reads it), or null. */
const storedClip = (page) =>
  page.evaluate(() => new Promise((resolve) => {
    let req;
    try {
      req = indexedDB.open("auracle");
    } catch (_) {
      return resolve(null);
    }
    req.onupgradeneeded = () => {
      try { req.transaction.abort(); } catch (_) {}
      resolve(null);
    };
    req.onerror = () => resolve(null);
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("kv")) { db.close(); return resolve(null); }
      const get = db.transaction("kv", "readonly").objectStore("kv").get("state");
      get.onsuccess = () => {
        db.close();
        try {
          const clip = get.result && JSON.parse(get.result.session).audition_clip;
          resolve(clip ? clip.source : null);
        } catch (_) {
          resolve(null);
        }
      };
      get.onerror = () => { db.close(); resolve(null); };
    };
  }));
const state = (page) => page.evaluate(() => window.__aur.audioIn());
const calls = (page) => page.evaluate(() => window.__pwMic.calls.length);
const at = (page, hz) => page.evaluate((h) => window.__pwAt(h), hz);
// AURACLE_SHOTS=dir saves the states a reviewer looks at; the rack is let
// settle first (a placement moves the plates).
const shot = async (page, name, el) => {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.waitForTimeout(1500);
  await (el || page).screenshot({ path: path.join(SHOTS, `${name}.png`) });
};

/** The AUDIO IN module's plate, with a margin, for the record. */
const plateShot = async (page, name) => {
  if (!SHOTS) return;
  await page.waitForTimeout(1500);
  const box = await page.locator("#rack-svg g.mod-group[data-kind='audio_in']").first().boundingBox();
  if (!box) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  const m = 24;
  await page.screenshot({
    path: path.join(SHOTS, `${name}.png`),
    clip: { x: Math.max(0, box.x - m), y: Math.max(0, box.y - m), width: box.width + 2 * m, height: box.height + 2 * m },
  });
};

/** The loudest level at `hz` over `ms` (read every 100 ms). */
async function loudest(page, hz, ms = 1500) {
  let db = -Infinity;
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const r = await at(page, hz);
    if (r) db = Math.max(db, r.db);
    await page.waitForTimeout(100);
  }
  return db;
}

test("the browser is asked for an input only when AUDIO IN is added", async ({ page }) => {
  const errors = await boot(page);
  // Booted, a sound opened and played, another module placed: nothing asked.
  await openPreset(page, "Glass Pad");
  await page.keyboard.down("a");
  await page.waitForTimeout(300);
  await page.keyboard.up("a");
  await openCatalog(page);
  await page.locator('.nb-item[data-kind="distortion"]').click();
  await page.locator("#rack-svg .jack.legal[data-childkey]").first().click();
  await expect(page.locator("#rack-svg g.mod-group[data-kind='distortion']").first()).toBeVisible({ timeout: 30_000 });
  expect(await calls(page)).toBe(0);
  expect(await page.evaluate(() => window.__pwMic.queries)).toBe(0);

  // AUDIO IN placed: the browser's prompt is up (held open here), and the app
  // says what the input is for.
  await page.evaluate(() => { window.__pwMic.hold = new Promise((r) => (window.__pwRelease = r)); });
  await placeAudioIn(page);
  await expect.poll(() => calls(page), { timeout: 10_000 }).toBe(1);
  // On screen while the question is, not queued behind the sound's news.
  await expect(page.locator(".toast-msg").first()).toContainText("AUDIO IN asks the browser for a microphone or an interface", { timeout: 2_000 });
  await expect(lane(page)).toBeVisible({ timeout: 30_000 });
  await expect(lane(page).locator(".ain-dev-text")).toHaveText("asking…");
  await shot(page, "permission-ask");
  await page.evaluate(() => window.__pwRelease());
  await expect(lane(page)).toHaveAttribute("data-state", "live", { timeout: 15_000 });
  await expect(lane(page).locator(".ain-dev-text")).toHaveText("1 · Fake Mic A");
  expect(await calls(page)).toBe(1);
  // The browser opened its pseudo-device "default" (as Chrome and Edge do);
  // input 1 is the real input it stands for, and it stays open past the
  // hold the ask keeps on its stream.
  expect((await state(page)).list[0].id).toBe("mic-a");
  await page.waitForTimeout(16_000);
  await expect(lane(page)).toHaveAttribute("data-state", "live");
  expect(await page.evaluate(() => window.__pwLiveTracks())).toEqual({ "mic-a": 1 });
  expect(await calls(page)).toBe(1);
  expect(errors).toEqual([]);
});

test("a refused input keeps AUDIO IN in the patch, silent, and ASK AGAIN asks again", async ({ page }) => {
  const errors = await boot(page);
  await openPreset(page, "Glass Pad");
  await page.evaluate(() => { window.__pwMic.refuse = true; });
  await placeAudioIn(page);
  await expect.poll(() => page.evaluate(() => window.__pwToasts.join("\n")), { timeout: 15_000 })
    .toContain("The browser was refused the input, so AUDIO IN stays in the patch, silent.");
  // The module stays, says why it has no input, and offers to ask again.
  await expect(lane(page)).toHaveAttribute("data-state", "refused", { timeout: 30_000 });
  await expect(page.locator("#rack-svg g.mod-group[data-kind='audio_in']")).toHaveCount(1);
  await expect(lane(page).locator(".ain-dev-text")).toHaveText("input refused");
  await expect(lane(page).locator(".ain-ask")).toBeVisible();
  await expect(lane(page).locator(".ain-ask .ain-btn-text")).toHaveText("ask again");
  await expect(lane(page).locator(".ain-monitor")).toBeHidden();
  await shot(page, "refused");
  // Played, it is silent: a key held, nothing of the input at the output.
  await page.keyboard.down("a");
  const held = await loudest(page, 440, 1200);
  await page.keyboard.up("a");
  console.log(`refused, a key held: ${held.toFixed(1)} dB at 440 Hz`);
  expect(held).toBeLessThan(-100);
  // Allowed in the browser this time: ASK AGAIN asks, and the input opens.
  await page.evaluate(() => { window.__pwMic.refuse = false; });
  await lane(page).locator(".ain-ask").click();
  await expect(lane(page)).toHaveAttribute("data-state", "live", { timeout: 15_000 });
  expect(await calls(page)).toBe(2);
  expect(errors).toEqual([]);
});

// Three AUDIO INs: two on input 1, one on input 2.
const amp = { attack: 0.05, decay: 0.3, sustain: 0.95, release: 0.3 };
const ain = (input) => ({ AudioIn: { input, gain: 24 / 36, channel: "Both" } });
const THREE = { name: "Three Ears", tree: { amp, root: { Mix: { balance: 0.5, a: ain(0), b: { Mix: { balance: 0.5, a: ain(0), b: ain(1) } } } } } };

async function openFile(page, data, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${data.name.replace(/\s/g, "-")}.json`);
  fs.writeFileSync(file, JSON.stringify(data));
  await page.setInputFiles("#patch-import-input", file);
}

test("each input is opened once and fanned out to every AUDIO IN that reads it", async ({ page }, info) => {
  const errors = await boot(page);
  await openPreset(page, "Glass Pad");
  await placeAudioIn(page);
  await expect(lane(page)).toHaveAttribute("data-state", "live", { timeout: 30_000 });
  expect(await calls(page)).toBe(1);

  await openFile(page, THREE, info.outputDir);
  const lanes = page.locator("#rack-svg .ain-lane");
  await expect(lanes).toHaveCount(3, { timeout: 60_000 });
  // One stream per device: the ask opened Fake Mic A, and Fake Interface B
  // is opened once, for the one module that reads it.
  await expect.poll(() => page.evaluate(() => window.__pwLiveTracks()), { timeout: 15_000 })
    .toEqual({ "mic-a": 1, "mic-b": 1 });
  expect(await calls(page)).toBe(2);
  // Every module shows its input's level; the keys read input 1, so the one
  // on input 2 says it is the meter's only.
  await expect.poll(async () => (await lanes.evaluateAll((ls) => ls.map((l) => l.dataset.state))).sort(), { timeout: 15_000 })
    .toEqual(["live", "live", "meter"]);
  await expect(page.locator("#rack-svg .ain-lane[data-state='meter'] .ain-dev")).toHaveAttribute("aria-label", "Input 2 · Fake Interface B · meter only");
  await expect(page.locator("#rack-svg .ain-lane[data-state='meter'] .ain-dev-text")).toHaveText(/^2 · Fake .*… · meter only$/);
  await expect.poll(() => lanes.evaluateAll((ls) => ls.every((l) => Number(l.dataset.db) > -30)), { timeout: 10_000 })
    .toBe(true);
  const dbs = await lanes.evaluateAll((ls) => ls.map((l) => Number(l.dataset.db)));
  console.log(`meters: ${dbs.map((d) => d.toFixed(1)).join(", ")} dBFS`);

  // The input menu: picking input 2 for a module on input 1 opens nothing new.
  const first = page.locator("#rack-svg .ain-lane[data-state='live']").first();
  await first.locator(".ain-dev").click();
  const menu = page.locator("#ctx-menu");
  await expect(menu).toBeVisible();
  await expect(menu.locator(".cm-item")).toHaveText([/^1 · Fake Mic A/, /^2 · Fake Interface B/]);
  await shot(page, "device-select");
  await menu.locator(".cm-item", { hasText: "2 · Fake Interface B" }).click();
  await expect.poll(async () => (await lanes.evaluateAll((ls) => ls.map((l) => l.dataset.slot))).sort(), { timeout: 30_000 })
    .toEqual(["0", "1", "1"]);
  expect(await calls(page)).toBe(2);
  expect(await page.evaluate(() => window.__pwLiveTracks())).toEqual({ "mic-a": 1, "mic-b": 1 });
  expect(errors).toEqual([]);
});

test("the input is heard with no key down once MONITOR is on, and not at all while it is off", async ({ page }, info) => {
  const errors = await boot(page);
  await openPreset(page, "Glass Pad");
  await placeAudioIn(page);
  await expect(lane(page)).toHaveAttribute("data-state", "live", { timeout: 30_000 });
  // Monitoring starts off: the input moves the meter and nothing else, with
  // no key and with one held.
  const mon = lane(page).locator(".ain-monitor");
  await expect(mon).toHaveAttribute("aria-pressed", "false");
  await page.waitForTimeout(1500);
  const offIdle = await loudest(page, 440, 1200);
  await page.keyboard.down("a");
  const offHeld = await loudest(page, 440, 1200);
  await page.keyboard.up("a");
  await plateShot(page, "meter");

  // On: the tone comes through the patch with no key down, and the toast
  // says to use headphones.
  await mon.click();
  await expect(mon).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => page.evaluate(() => window.__pwToasts.join("\n")), { timeout: 20_000 })
    .toContain("Use headphones, or the speakers feed back into the microphone.");
  await expect.poll(() => loudest(page, 440, 600), { timeout: 15_000 }).toBeGreaterThan(-60);
  const on = await loudest(page, 440, 1500);
  await plateShot(page, "monitor-on");

  // Off again: silent again.
  await mon.click();
  await expect(mon).toHaveAttribute("aria-pressed", "false");
  await page.waitForTimeout(1500);
  const offAgain = await loudest(page, 440, 1200);
  console.log(`440 Hz at the output: off ${offIdle.toFixed(1)} dB, off with a key ${offHeld.toFixed(1)} dB, on ${on.toFixed(1)} dB, off again ${offAgain.toFixed(1)} dB`);
  expect(offIdle).toBeLessThan(-100);
  expect(offHeld).toBeLessThan(-100);
  expect(on).toBeGreaterThan(-45);
  expect(offAgain).toBeLessThan(-100);

  // Monitoring is not kept: after a reload it is off, and a sound that
  // listens, opened again, gets its input without a prompt (the browser
  // granted it) and stays silent.
  await mon.click();
  await expect(mon).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 120_000 });
  await goLevel(page, "patch");
  await openFile(page, { name: "Mic Pad", tree: { amp, root: ain(0) } }, info.outputDir);
  await expect(lane(page)).toHaveAttribute("data-state", "live", { timeout: 60_000 });
  expect(await page.evaluate(() => window.__pwToasts.some((t) => t.startsWith("AUDIO IN asks")))).toBe(false);
  expect((await state(page)).monitor).toBe(false);
  await expect(lane(page).locator(".ain-monitor")).toHaveAttribute("aria-pressed", "false");
  await page.waitForTimeout(1500);
  const afterReload = await loudest(page, 440, 1200);
  console.log(`after a reload: ${afterReload.toFixed(1)} dB at 440 Hz`);
  expect(afterReload).toBeLessThan(-100);
  expect(errors).toEqual([]);
});

test("the first listen captures a clip, and the engine measures with it", async ({ page }) => {
  const errors = await boot(page);
  expect((await state(page)).clipSource).toBe("reference");
  await openPreset(page, "Glass Pad");
  await placeAudioIn(page);
  await expect(lane(page)).toHaveAttribute("data-state", "live", { timeout: 30_000 });
  // The input carries a signal, so a capture starts, says so at once (NEW
  // CLIP lit while it rolls), and goes to the engine: six seconds of two
  // channels at the context's rate.
  await expect.poll(async () => (await state(page)).capture, { timeout: 15_000 }).toBe("rolling");
  await expect(lane(page).locator(".ain-clip")).toHaveClass(/\bon\b/);
  await expect(page.locator(".toast-msg").first())
    .toHaveText("Capturing 6 s of Fake Mic A as the clip the model hears it through…", { timeout: 2_000 });
  await expect.poll(() => page.evaluate(() => window.__pwSent.length), { timeout: 20_000 }).toBe(1);
  const sent = await page.evaluate(() => window.__pwSent[0]);
  const rate = await page.evaluate(() => window.__aur.audioCtx.sampleRate);
  console.log(`clip sent: ${sent.frames} frames × ${sent.channels} at ${sent.sampleRate} Hz`);
  expect(sent.channels).toBe(2);
  expect(sent.sampleRate).toBe(rate);
  expect(sent.frames / rate).toBeGreaterThan(5.5);
  // The engine took it as the session's clip, and says so.
  await expect.poll(() => page.evaluate(() => window.__pwLast.audition_clip && window.__pwLast.audition_clip.ok), { timeout: 30_000 }).toBe(true);
  const reply = await page.evaluate(() => window.__pwLast.audition_clip);
  expect(reply.clip.source).toBe("captured");
  await expect.poll(() => page.evaluate(() => window.__pwToasts.join("\n")), { timeout: 20_000 })
    .toContain("The model hears sounds with an input through the clip captured from it.");
  expect((await state(page)).clipSource).toBe("captured");
  // Only the first listen captures by itself; NEW CLIP captures again.
  await page.waitForTimeout(2000);
  expect(await page.evaluate(() => window.__pwSent.length)).toBe(1);
  await lane(page).locator(".ain-clip").click();
  await expect.poll(() => page.evaluate(() => window.__pwSent.length), { timeout: 20_000 }).toBe(2);
  await expect.poll(() => page.evaluate(() => window.__pwCounts.audition_clip), { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
  expect(errors).toEqual([]);
});

test("a captured clip is saved with the session, and is the session's clip again after a reload", async ({ page }) => {
  const errors = await boot(page);
  await openPreset(page, "Glass Pad");
  await placeAudioIn(page);
  await expect.poll(() => page.evaluate(() => window.__pwLast.audition_clip && window.__pwLast.audition_clip.ok), { timeout: 40_000 }).toBe(true);
  // The clip is saved with the session: reload only once the record main
  // stores (`persistState`, written after the worker's `saved`) holds it, or
  // the reload can cut the write short.
  await expect.poll(() => storedClip(page), { timeout: 30_000 }).toBe("captured");

  await page.reload();
  await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 120_000 });
  // The restore's word on the clip reaches AUDIO IN (main.js `audioIn.clip`).
  await expect.poll(async () => (await state(page)).clipSource, { timeout: 30_000 }).toBe("captured");
  expect(errors).toEqual([]);
});

test("an unplugged input silences its module and says so, and plays again when it is back", async ({ page }) => {
  const errors = await boot(page);
  await openPreset(page, "Glass Pad");
  await placeAudioIn(page);
  await expect(lane(page)).toHaveAttribute("data-state", "live", { timeout: 30_000 });
  await lane(page).locator(".ain-monitor").click();
  await expect.poll(() => loudest(page, 440, 600), { timeout: 15_000 }).toBeGreaterThan(-60);

  await page.evaluate(() => window.__pwUnplug("mic-a"));
  await expect.poll(() => page.evaluate(() => window.__pwToasts.join("\n")), { timeout: 20_000 })
    .toContain("Fake Mic A was unplugged, so AUDIO IN is silent until it’s back.");
  await expect(lane(page)).toHaveAttribute("data-state", "unplugged");
  await expect(lane(page).locator(".ain-dev-text")).toHaveText("1 · Fake Mic A · unplugged");
  expect(await page.evaluate(() => window.__pwLiveTracks())).toEqual({});
  await page.waitForTimeout(1500);
  const gone = await loudest(page, 440, 1200);

  const asked = await calls(page);
  await page.evaluate(() => window.__pwReplug("mic-a"));
  await expect.poll(() => page.evaluate(() => window.__pwToasts.join("\n")), { timeout: 20_000 })
    .toContain("Fake Mic A is back.");
  await expect(lane(page)).toHaveAttribute("data-state", "live", { timeout: 15_000 });
  expect(await calls(page)).toBe(asked + 1);
  await expect.poll(() => loudest(page, 440, 600), { timeout: 15_000 }).toBeGreaterThan(-60);
  console.log(`unplugged: ${gone.toFixed(1)} dB at 440 Hz`);
  expect(gone).toBeLessThan(-100);
  expect(errors).toEqual([]);
});

test("a capture cut short drops its take, and the tap stops", async ({ page }) => {
  const errors = await boot(page);
  await openPreset(page, "Glass Pad");
  await placeAudioIn(page);
  await expect.poll(async () => (await state(page)).capture, { timeout: 15_000 }).toBe("rolling");
  // Another sound, with no AUDIO IN: its input closes under the capture.
  await page.locator(".bank-item", { hasText: "Glass Pad" }).first().click();
  await expect(page.locator("#rack-svg .ain-lane")).toHaveCount(0, { timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => window.__pwTapSaid), { timeout: 5_000 }).toContain("drop");
  // Nothing comes of it: no clip goes to the engine.
  await page.waitForTimeout(8_000);
  expect(await page.evaluate(() => window.__pwSent.length)).toBe(0);
  expect((await state(page)).capture).toBe(null);
  expect(errors).toEqual([]);
});

test("a refused capture is not taken again by itself; NEW CLIP takes another", async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => { window.__pwRefuseClip = true; });
  await openPreset(page, "Glass Pad");
  await placeAudioIn(page);
  await expect.poll(() => page.evaluate(() => window.__pwSent.length), { timeout: 20_000 }).toBe(1);
  await expect.poll(() => page.evaluate(() => window.__pwToasts.join("\n")), { timeout: 20_000 })
    .toContain("That capture was silent, so nothing changed.");
  // The input still carries a signal, and nothing captures by itself.
  await page.waitForTimeout(10_000);
  expect(await page.evaluate(() => window.__pwSent.length)).toBe(1);
  expect((await state(page)).capture).toBe(null);
  await lane(page).locator(".ain-clip").click();
  await expect.poll(() => page.evaluate(() => window.__pwSent.length), { timeout: 20_000 }).toBe(2);
  expect(errors).toEqual([]);
});

test("MONITOR ends when the last AUDIO IN leaves the sound you're playing", async ({ page }, info) => {
  const errors = await boot(page);
  await openPreset(page, "Glass Pad");
  await placeAudioIn(page);
  await expect(lane(page)).toHaveAttribute("data-state", "live", { timeout: 30_000 });
  await lane(page).locator(".ain-monitor").click();
  expect((await state(page)).monitor).toBe(true);
  // A sound with no AUDIO IN: monitoring ends with it.
  await page.locator(".bank-item", { hasText: "Glass Pad" }).first().click();
  await expect(page.locator("#rack-svg .ain-lane")).toHaveCount(0, { timeout: 30_000 });
  expect((await state(page)).monitor).toBe(false);
  // The next sound that listens comes up unmonitored, and silent.
  await openFile(page, { name: "Mic Pad", tree: { amp, root: ain(0) } }, info.outputDir);
  await expect(lane(page)).toHaveAttribute("data-state", "live", { timeout: 60_000 });
  await expect(lane(page).locator(".ain-monitor")).toHaveAttribute("aria-pressed", "false");
  await page.waitForTimeout(1500);
  expect(await loudest(page, 440, 1200)).toBeLessThan(-100);
  expect(errors).toEqual([]);
});

test("a mono input with no channel count in its settings is captured as one channel", async ({ page }) => {
  await page.addInitScript(() => { try { sessionStorage.setItem("__pwMonoA", "1"); } catch (_) {} });
  const errors = await boot(page);
  await openPreset(page, "Glass Pad");
  await placeAudioIn(page);
  await expect.poll(() => page.evaluate(() => window.__pwSent.length), { timeout: 20_000 }).toBe(1);
  const sent = await page.evaluate(() => window.__pwSent[0]);
  console.log(`mono clip sent: ${sent.frames} frames × ${sent.channels}`);
  expect(sent.channels).toBe(1);
  expect(errors).toEqual([]);
});

test("the browser's default input is numbered as the input it stands for when only the list's label names it", async ({ page }) => {
  // "default" stands for Fake Interface B, the second input listed, in a group
  // of its own, and its track's label is plain: only the list's "Default -
  // Fake Interface B" says which input it is. Unresolved, input 1 would be
  // the first input listed (Fake Mic A), not the one the browser opened.
  await page.addInitScript(() => { try { sessionStorage.setItem("__pwDefaultOwn", "1"); } catch (_) {} });
  const errors = await boot(page);
  await openPreset(page, "Glass Pad");
  await placeAudioIn(page);
  await expect(lane(page)).toHaveAttribute("data-state", "live", { timeout: 30_000 });
  await expect(lane(page).locator(".ain-dev-text")).toHaveText("1 · Fake Interface B");
  const st = await state(page);
  expect(st.list.map((e) => e.id)).toEqual(["mic-b", "mic-a"]);
  // The stream the ask opened is kept and filed under the real input: one
  // ask, one track, nothing opened again by id.
  expect(await calls(page)).toBe(1);
  expect(await page.evaluate(() => window.__pwLiveTracks())).toEqual({ "mic-b": 1 });
  expect(errors).toEqual([]);
});

test("the square draws the input's live face while it plays, and nothing once it is unplugged", async ({ page }) => {
  const errors = await boot(page);
  await openPreset(page, "Glass Pad");
  await placeAudioIn(page);
  await expect(lane(page)).toHaveAttribute("data-state", "live", { timeout: 30_000 });
  // A face is drawn against the bank, so it waits for the bank's faces.
  await expect(lane(page)).toHaveAttribute("data-face", "live", { timeout: 120_000 });
  const lit = () => lane(page).locator(".ain-face-live canvas").evaluate((c) => {
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
    return { n, of: c.width * c.height };
  });
  const on = await lit();
  console.log(`live face: ${on.n} of ${on.of} px lit, meter ${await lane(page).getAttribute("data-db")} dBFS`);
  expect(on.n).toBeGreaterThan(50);
  await plateShot(page, "live-face");

  await page.evaluate(() => window.__pwUnplug("mic-a"));
  await expect(lane(page)).toHaveAttribute("data-state", "unplugged", { timeout: 20_000 });
  await expect(lane(page)).toHaveAttribute("data-face", "none", { timeout: 5_000 });
  expect((await lit()).n).toBe(0);
  await expect(lane(page).locator(".ain-meter-fill")).toHaveAttribute("height", "0.0");
  expect(errors).toEqual([]);
});
