// The shell's ways in, for the specs (Plan-008): the level rail and KEYS ⋯.
// They use the app's own hooks (the rail's `aria-current`, KEYS ⋯'s
// popover), never a test-only attribute.
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

module.exports = { goLevel, openKeys };
