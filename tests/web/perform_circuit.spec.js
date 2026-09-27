// The circuit shows what PERFORM is playing.
//
// PATCH draws the kept patch; until Keep, PERFORM's moves live only in the
// voices. A knob PERFORM is playing away from its kept value carries an amber
// pointer at the sounding value, and its readout says that value: turn Bright
// on First Bass, open PATCH, and the ladder's cutoff is visibly performed.
const { test, expect } = require("@playwright/test");
test("a knob turned in PERFORM is drawn performed in PATCH", async ({ page }) => {
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto("/");
  await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 120_000 });
  await page.locator("#warm-skip").click();
  await page.locator('.bf[data-f="preset"]').click();
  await page.locator(".bank-item", { hasText: "First Bass" }).first().click();
  await page.waitForTimeout(800);
  await page.locator('.viewtab[data-view="perform"]').click();
  // Until PERFORM names the preset, "controls reach" may be the previous
  // patch's (the first pool patch lands on the bench at boot).
  await expect(page.locator(".pf-name")).toHaveText("First Bass", { timeout: 30000 });
  await page.waitForFunction(() => /controls reach/.test(document.querySelector(".pf-status")?.textContent || ""), null, { timeout: 90000 });
  const box = await page.locator(".pf-knob").nth(0).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - i * 9);
  await page.mouse.up();
  await page.locator('.viewtab[data-view="play"]').click();
  await page.waitForTimeout(1200);
  const n = await page.locator("#rack-svg .knob-ghost").count();
  expect(n).toBeGreaterThan(0);
  await expect(page.locator("#rack-svg g.performed[data-addr=\"node#cut\"] .knob-value")).toHaveText(/kHz|Hz/);
  expect(errs).toEqual([]);
});
