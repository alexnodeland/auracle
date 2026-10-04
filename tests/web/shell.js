// The shell's ways in, for the specs (Plan-008): the level rail, KEYS ⋯, the
// bank's tabs, the model view and PATCH's catalog. They use the app's own hooks (the rail's
// `aria-current`, KEYS ⋯'s popover, the tabs' `aria-selected`,
// `body.model-view`), never a test-only attribute.
const { expect } = require("@playwright/test");

/** Go to a level by its stop on the rail, as a player does, and wait until
 *  the rail says you are there. `level` is perform, patch, evolve, taste or
 *  learning. */
async function goLevel(page, level) {
  const stop = page.locator(`.rail-stop[data-level="${level}"]`);
  await stop.click();
  await expect(stop).toHaveAttribute("aria-current", "location");
}

/** Open KEYS ⋯, where HOLD, UNI, ARP, SYNC, glide, the keybed's size, panic
 *  and the arp's settings live; a no-op when it is open. */
async function openKeys(page) {
  const pop = page.locator("#keys-pop");
  if (await pop.isHidden()) await page.locator("#keys-btn").click();
  await expect(pop).toBeVisible();
}

/** Show a bank by its tab, as a player does, and wait until the tab says it
 *  is shown. `bank` is pool, saved or presets. */
async function bankTab(page, bank) {
  const tab = page.locator(`.bank-tabs [role=tab][data-bank="${bank}"]`);
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
}

/** Turn the model view on (or off) with a tap on MODEL, and wait until the
 *  page says so (`body.model-view`). */
async function modelView(page, on = true) {
  const body = page.locator("body");
  const is = await body.evaluate((b) => b.classList.contains("model-view"));
  if (is !== on) await page.locator("#model-btn").click();
  if (on) await expect(body).toHaveClass(/\bmodel-view\b/);
  else await expect(body).not.toHaveClass(/\bmodel-view\b/);
}

/** Open PATCH's catalog (ADD MODULE), where every module is added from;
 *  a no-op when it is open (a new patch opens it). */
async function openCatalog(page) {
  const cat = page.locator("#nodebank");
  if (await cat.isHidden()) await page.locator("#pt-add").click();
  await expect(cat).toBeVisible();
}

module.exports = { goLevel, openKeys, bankTab, modelView, openCatalog };
