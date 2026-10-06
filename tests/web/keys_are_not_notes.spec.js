// A key that a focused list, the rack or a dialog handles does only that:
// it is not also a note, and not also a global shortcut. The global handler
// lets note letters through a focused control on purpose (a click on HOLD
// must not silence the keyboard), so each handler that takes a letter or a
// digit for itself has to stop it. Three did not:
//
// - `p` in the presets list heard the preset and played a D♯ over it;
// - `L` on a rack plate or knob locked it and played a D;
// - `1` / `2` in PATCH's keep-as-new comparison played a side and also rated
//   the bank's row 1★ or 2★.
//
// Reached through the fixture's tap, the page's Math.random seeded as the
// films seed it (20260927, no `?seed`: the session's seed is drawn from it).
const { test, expect, goLevel, bankTab } = require("./fixtures");

/** Seeded the films' way, with the warm start and the tours seen. */
const boot = (app) => app.boot({ random: 20260927 });

const down = (page) => page.evaluate(() => document.querySelectorAll(".pkey.down, .bkey.down").length);

test("1 and 2 in the keep-as-new comparison play a side and rate nothing", async ({ page, app }) => {
  await boot(app);
  await app.engine((timeout) => page.waitForFunction(() => window.__aur && window.__aur.wb && window.__aur.wb.rack, null, { timeout }), { ms: 60_000 });
  await goLevel(page, "patch");
  const knob = page.locator("#rack-svg [data-addr]").first();
  await expect(knob).toBeAttached({ timeout: 30_000 });
  await knob.focus();
  const before = await knob.getAttribute("aria-valuetext");
  for (let i = 0; i < 8; i++) await page.keyboard.press("ArrowUp");
  await expect(knob).not.toHaveAttribute("aria-valuetext", before, { timeout: 10_000 });
  await app.engine((timeout) => expect(page.locator("#rack-commit")).toBeEnabled({ timeout }), { ms: 15_000 });
  await page.locator("#rack-commit").click();
  await app.engine((timeout) => expect(page.locator("#cduel")).toBeVisible({ timeout }), { ms: 30_000 });
  const stars = await app.sentCount("record_stars");
  const mark = await app.toastMark();
  await page.keyboard.press("1");
  await page.keyboard.press("2");
  await app.quiet();
  expect(await app.sentCount("record_stars"), "a comparison key rated the bank's row").toBe(stars);
  for (const t of await app.toasts(mark)) expect(t).not.toMatch(/rated|already \d★|Nothing selected to rate/);
});

test("L on a rack knob locks it without playing a note", async ({ page, app }) => {
  await boot(app);
  await app.engine((timeout) => page.waitForFunction(() => window.__aur && window.__aur.wb && window.__aur.wb.rack, null, { timeout }), { ms: 60_000 });
  await goLevel(page, "patch");
  const knob = page.locator("#rack-svg [data-addr]").first();
  await expect(knob).toBeAttached({ timeout: 30_000 });
  const halos = () => page.locator("#rack-svg .knob-locked-halo").count();
  const h0 = await halos();
  await knob.focus();
  await page.keyboard.down("l");
  await app.quiet();
  expect(await down(page), "l played a note from a rack knob").toBe(0);
  await page.keyboard.up("l");
  await expect.poll(halos).toBeGreaterThan(h0);
});

test("p in the preset list hears the preset without playing a note", async ({ page, app }) => {
  await boot(app);
  await app.engine((timeout) => page.waitForFunction(() => window.__aur && window.__aur.getLive && window.__aur.getLive(), null, { timeout }), { ms: 60_000 });
  await bankTab(page, "presets");
  await expect(page.locator("#bank-list .preset-item").first()).toBeVisible({ timeout: 30_000 });
  await page.locator("#bank-list").focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.down("p");
  await app.quiet();
  expect(await down(page), "p played a note from the preset list").toBe(0);
  await page.keyboard.up("p");
  // …while the same key away from the list is still a note.
  await page.locator("#bank-list").evaluate((el) => el.blur());
  await page.keyboard.down("p");
  await expect.poll(() => down(page)).toBe(1);
  await page.keyboard.up("p");
});
