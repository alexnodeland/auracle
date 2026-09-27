// PERFORM is playable at once on a patch it has measured before.
//
// Measuring a patch is ~one render per knob plus verification, 10-30 s on a
// CI runner. A booth flicks between the same demo patches all day, so every
// measurement is kept (stale-while-revalidate, persisted across reloads):
// a revisit, and the same patch after a reload, must be playable in a
// fraction of that. Thresholds are generous on purpose: this checks the cache
// works, not how fast the runner is.
const { test, expect } = require("@playwright/test");
test("a patch measured once is playable at once, even after a reload", async ({ page }) => {
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto("/");
  await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 120_000 });
  await page.locator("#warm-skip").click();
  await page.locator('.bf[data-f="preset"]').click();
  const open = async (name) => {
    await page.locator(".bank-item", { hasText: name }).first().click();
    await page.waitForTimeout(800);
    await page.locator('.viewtab[data-view="perform"]').click();
    const t0 = Date.now();
    await expect(page.locator(".pf-name")).toHaveText(name, { timeout: 30000 });
    await page.waitForFunction(() => /controls reach/.test(document.querySelector(".pf-status")?.textContent || "") && ![0,1,2,3,4,5].some((i) => document.querySelector(`.pf-knob[data-i="${i}"]`)?.classList.contains("unwired")), null, { timeout: 90000 });
    const ms = Date.now() - t0;
    await page.locator('.viewtab[data-view="play"]').click();
    return ms;
  };
  await open("Glass Pad");
  await open("Acid Line");
  expect(await open("Glass Pad"), "revisit").toBeLessThan(5000);
  // reload: persisted
  await page.reload();
  await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 120_000 });
  await page.locator('.bf[data-f="preset"]').click();
  expect(await open("Acid Line"), "after a reload").toBeLessThan(8000);
  expect(errs).toEqual([]);
});
