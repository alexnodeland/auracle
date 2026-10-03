// PERFORM's controls stay under the hands.
//
// A Keep (like a new measurement, a Take or a glide) folds the controls'
// turns into the patch and puts them back at 12 o'clock; the sound does not
// move. The dial used to jump there in one frame, which read as "I set Bright
// to 70% and now it says 0", and a background re-check re-centred them too,
// seconds after the player had let go. Now a re-centre glides the pointer home
// over --d-state (180 ms) with a ghost tick fading where it was, and a background
// re-check leaves the controls where they are unless it wired them to
// different knobs.
//
// Blend is the exception for a MIDI pot. When B empties (a pass, a Take),
// Blend comes home and a pot on it is let go: it has to come back down through
// home before it drives Blend again. It used to be re-anchored at home like a
// re-centred control, so a pot left at 0.9 spread the whole blend over its
// last tenth of travel, and the next nudge poured the next offer in.
//
// A MIDI device is stood in for by replacing navigator.requestMIDIAccess
// before the app runs, with one input the spec sends control changes from.
const { test, expect } = require("@playwright/test");
const { goLevel } = require("./shell");
const budget = require("./perform_budget.js");

const FAKE_MIDI = `(() => {
  const input = { id: "pw", name: "Test pot", manufacturer: "", state: "connected", onmidimessage: null };
  const access = { inputs: new Map([["pw", input]]), outputs: new Map(), onstatechange: null, sysexEnabled: false };
  Object.defineProperty(navigator, "requestMIDIAccess", { configurable: true, value: () => Promise.resolve(access) });
  window.__cc = (cc, v) => input.onmidimessage && input.onmidimessage({ data: new Uint8Array([0xb0, cc, v]), timeStamp: performance.now() });
})();`;

async function boot(page, { midi = false } = {}) {
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await budget.watch(page);
  if (midi) await page.addInitScript(FAKE_MIDI);
  await page.goto("/");
  await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 120_000 });
  await page.locator("#warm-skip").click();
  return errs;
}

async function openOnPerform(page, name) {
  await page.locator('.bf[data-f="preset"]').click();
  await page.locator(".bank-item", { hasText: name }).first().click();
  await page.waitForFunction((n) => (document.getElementById("rack-subject")?.textContent || "").includes(n), name, { timeout: 90_000 });
  await goLevel(page, "perform");
  await expect(page.locator(".pf-name")).toHaveText(name, { timeout: 30_000 });
  await expect(page.locator(".pf-status")).toContainText("controls reach", { timeout: 120_000 });
}

async function drag(page, loc, dy) {
  const b = await loc.boundingBox();
  const x = b.x + b.width / 2;
  const y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + dy, { steps: 10 });
  await page.mouse.up();
  await page.mouse.move(10, 10);
}

test("a re-centred control glides home with a fading ghost, and a background re-check leaves it where it is", { tag: "@slow" }, async ({ page }) => {
  test.setTimeout(420_000);
  const errs = await boot(page);
  await openOnPerform(page, "Glass Pad");
  // Two background re-checks are waited for below, each a measurement
  // (about thirty renders) that may wait behind a spare.
  const RECHECK_MS = await budget.offerBudget(page, { waits: 2 });
  const status = page.locator(".pf-status");
  // The shipped wiring's background re-check, done.
  await expect(status).not.toContainText("re-checking", { timeout: RECHECK_MS });
  const bright = page.locator('.pf-knob[data-i="0"]');
  await drag(page, bright, -150);
  expect(Number(await bright.getAttribute("aria-valuenow"))).toBeGreaterThan(0.5);

  // Every angle the pointer is drawn at, from here on.
  await page.evaluate(() => {
    const turn = document.querySelector('.pf-knob[data-i="0"] .pf-k-ptr');
    window.__angles = [];
    new MutationObserver(() => {
      const m = /rotate\((-?[\d.]+)\)/.exec(turn.getAttribute("transform") || "");
      window.__angles.push([performance.now(), m ? Number(m[1]) : NaN]);
    }).observe(turn, { attributes: true, attributeFilter: ["transform"] });
  });
  await page.locator(".pf-pad", { hasText: "Keep" }).click();
  await expect(page.locator("#toasts")).toContainText("Kept: this is home now.", { timeout: 15_000 });
  await expect(bright).toHaveAttribute("aria-valuenow", "0.00");
  await page.waitForTimeout(600);
  const angles = await page.evaluate(() => window.__angles);
  const moving = angles.filter(([, a]) => Math.abs(a) > 0.5);
  expect(moving.length, "the pointer passed through angles between where it was and 12 o'clock").toBeGreaterThan(2);
  expect(angles[angles.length - 1][1]).toBe(0);
  const took = angles[angles.length - 1][0] - angles[0][0];
  console.log(`re-centre glide: ${angles.length} frames over ${took.toFixed(0)} ms`);
  expect(took).toBeLessThan(600);
  await expect(bright.locator(".pf-k-ghost")).toHaveClass(/\bfade\b/);

  // Turned again after the Keep; the Keep's re-check (the knobs had travelled
  // far) lands in the background and must not take the turn away.
  const caption = await bright.locator(".pf-k-sub").textContent();
  await drag(page, bright, -90);
  const set = await bright.getAttribute("aria-valuenow");
  expect(Number(set)).toBeGreaterThan(0.3);
  await expect(status).not.toContainText("re-checking", { timeout: RECHECK_MS });
  await page.waitForTimeout(2_500); // past the pause a re-check waits for
  if ((await bright.locator(".pf-k-sub").textContent()) === caption) {
    await expect(bright, "same knobs: the control stays where the hand left it").toHaveAttribute("aria-valuenow", set);
  }
  expect(errs).toEqual([]);
});

test("a pot on Blend is let go when Blend comes home, and takes it again from home", async ({ page }) => {
  test.setTimeout(420_000);
  const errs = await boot(page, { midi: true });
  await openOnPerform(page, "Glass Pad");
  const OFFER_MS = await budget.offerBudget(page, { waits: 1 });
  await page.locator(".pf-pad", { hasText: "Offer" }).click();
  await page.waitForSelector(".pf-offer.ready", { timeout: OFFER_MS });
  // CC 20 learned onto Blend (the seventh row of the MIDI panel).
  await page.locator("#midi-ind").click();
  await page.locator("#midi-panel .midi-row").nth(6).locator("button", { hasText: "learn" }).click();
  await page.evaluate(() => window.__cc(20, 0));
  await expect(page.locator("#midi-panel .midi-row").nth(6)).toContainText("CC 20");
  await page.locator("#midi-ind").click();
  const blend = page.locator('.pf-knob[data-i="6"]');
  const at = async () => Number(await blend.getAttribute("aria-valuenow"));
  // The pot picks Blend up at home and turns it most of the way to the offer.
  for (const v of [2, 20, 45, 70, 95, 115]) await page.evaluate((v) => window.__cc(20, v), v);
  expect(await at()).toBeCloseTo(115 / 127, 2);
  // Next passes on B: B empties and Blend comes home.
  await page.locator(".pf-pad", { hasText: "Next" }).click();
  await expect(blend).toHaveAttribute("aria-valuenow", "0.00", { timeout: 2_000 });
  // The pot, still near the top, is let go: nudging it on does nothing.
  const up = [];
  for (const v of [117, 120, 124, 127]) {
    await page.evaluate((v) => window.__cc(20, v), v);
    up.push(await at());
  }
  console.log(`Blend under the pot's last steps after coming home: ${up.join(", ")}`);
  expect(up).toEqual([0, 0, 0, 0]);
  // Brought back down through home, it takes Blend again and follows.
  for (const v of [90, 50, 10]) await page.evaluate((v) => window.__cc(20, v), v);
  expect(await at()).toBe(0);
  await page.evaluate(() => window.__cc(20, 2));
  await page.evaluate(() => window.__cc(20, 40));
  expect(await at()).toBeCloseTo(40 / 127, 2);
  expect(errs).toEqual([]);
});
