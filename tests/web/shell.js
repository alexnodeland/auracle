// The shell's ways in, for the specs (Plan-008): the level rail, KEYS ⋯, the
// bank's tabs, the model view, PATCH's catalog and ⌘K's list. They use the
// app's own hooks (the rail's `aria-current`, KEYS ⋯'s popover, the tabs'
// `aria-selected`, `body.model-view`, the list's options), never a
// test-only attribute.
const { expect } = require("@playwright/test");

/** Go to a level by its stop on the rail, as a player does, and wait until
 *  the rail says you are there and the move has landed: its level alone on,
 *  nothing scaled or flying (shell.js `settle`), so what a spec reads next
 *  is where it rests. `level` is perform, patch, evolve, taste or
 *  learning. */
async function goLevel(page, level) {
  const stop = page.locator(`.rail-stop[data-level="${level}"]`);
  await stop.click();
  await expect(stop).toHaveAttribute("aria-current", "location");
  await landed(page);
}

/** The move between the levels in flight has landed (shell.js `settle`):
 *  one level on, the rail's puck home, and no face in flight. */
async function landed(page) {
  await expect(page.locator("section.view.on")).toHaveCount(1);
  await expect(page.locator("#rail")).not.toHaveClass(/\btraveling\b/);
  await expect(page.locator(".zoom-face.on")).toHaveCount(0);
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

/** The row of ⌘K's list whose label is `label`, exactly. */
function commandRow(page, label) {
  const exact = new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
  return page.locator("#cmdk-list .cmdk-it").filter({ has: page.locator(".cmdk-lab", { hasText: exact }) });
}

/** Run a command from ⌘K's list as a player does with the mouse: ⌘K's
 *  button, the label typed, its row clicked; and wait for the list to close.
 *  What it opens (a panel, a file's picker) is the caller's to wait for. */
async function runCommand(page, label) {
  const list = page.locator("#cmdk");
  if (await list.isHidden()) await page.locator("#cmdk-btn").click();
  await expect(list).toBeVisible();
  await page.locator("#cmdk-input").fill(label);
  const row = commandRow(page, label);
  await expect(row).toHaveCount(1);
  await row.click();
  await expect(list).toBeHidden();
}

module.exports = { goLevel, landed, openKeys, bankTab, modelView, openCatalog, commandRow, runCommand };
