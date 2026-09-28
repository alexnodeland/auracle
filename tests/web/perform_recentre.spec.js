// PERFORM's controls stay under the hands.
//
// A Keep (like a new measurement, a Take or a glide) folds the controls'
// turns into the patch and puts them back at 12 o'clock; the sound does not
// move. The dial used to jump there in one frame, which read as "I set Bright
// to 70% and now it says 0", and a background re-check re-centred them too,
// seconds after the player had let go. Now a re-centre glides the pointer home
// over about 250 ms with a ghost tick fading where it was, and a background
// re-check leaves the controls where they are unless it wired them to
// different knobs.
const { test, expect } = require("@playwright/test");

async function boot(page) {
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto("/");
  await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 120_000 });
  await page.locator("#warm-skip").click();
  return errs;
}

async function openOnPerform(page, name) {
  await page.locator('.bf[data-f="preset"]').click();
  await page.locator(".bank-item", { hasText: name }).first().click();
  await page.waitForFunction((n) => (document.getElementById("rack-subject")?.textContent || "").includes(n), name, { timeout: 90_000 });
  await page.locator('.viewtab[data-view="perform"]').click();
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

test("a re-centred control glides home with a fading ghost, and a background re-check leaves it where it is", async ({ page }) => {
  test.setTimeout(420_000);
  const errs = await boot(page);
  await openOnPerform(page, "Glass Pad");
  const status = page.locator(".pf-status");
  // The shipped wiring's background re-check, done.
  await expect(status).not.toContainText("re-checking", { timeout: 180_000 });
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
  await expect(page.locator("#toasts")).toContainText("Kept — this is home now.", { timeout: 15_000 });
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
  await expect(status).not.toContainText("re-checking", { timeout: 180_000 });
  await page.waitForTimeout(2_500); // past the pause a re-check waits for
  if ((await bright.locator(".pf-k-sub").textContent()) === caption) {
    await expect(bright, "same knobs: the control stays where the hand left it").toHaveAttribute("aria-valuenow", set);
  }
  expect(errs).toEqual([]);
});
