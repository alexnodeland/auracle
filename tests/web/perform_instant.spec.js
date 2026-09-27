// PERFORM is playable at once on a patch it has measured before.
//
// Measuring a patch is ~one render per knob plus verification, 10-30 s on a
// CI runner. A booth flicks between the same demo patches all day, so every
// measurement is kept (stale-while-revalidate, persisted across reloads):
// a revisit, and the same patch after a reload, must be playable in a
// fraction of that. Thresholds are generous on purpose: this checks the cache
// works, not how fast the runner is.
//
// The same holds for Offer: one offer is grown in the background once a patch
// is steady, and pressing Offer hands it over instead of starting ~10 s of
// renders.
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

test("an offer grown ahead lands the moment Offer is pressed", async ({ page }) => {
  test.setTimeout(240_000);
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto("/");
  await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 120_000 });
  await page.locator("#warm-skip").click();
  await page.locator('.bf[data-f="preset"]').click();
  await page.locator(".bank-item", { hasText: "Glass Pad" }).first().click();
  await page.waitForTimeout(800);
  await page.locator('.viewtab[data-view="perform"]').click();
  await expect(page.locator(".pf-name")).toHaveText("Glass Pad", { timeout: 30000 });
  await page.waitForFunction(() => /controls reach/.test(document.querySelector(".pf-status")?.textContent || ""), null, { timeout: 90000 });
  await page.waitForTimeout(25000); // steady: the spare grows
  const t0 = Date.now();
  await page.locator(".pf-pad", { hasText: "Offer" }).click();
  await page.waitForSelector(".pf-offer.ready", { timeout: 90000 });
  expect(Date.now() - t0, "a spare offer is handed over, not grown").toBeLessThan(3000);
  expect(errs).toEqual([]);
});
