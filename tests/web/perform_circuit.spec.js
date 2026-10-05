// The circuit shows what PERFORM is playing.
//
// PATCH draws the kept patch; until Keep, PERFORM's moves live only in the
// voices. A knob PERFORM is playing away from its kept value carries an amber
// pointer at the sounding value, and its readout says that value: turn Bright
// on First Bass, open PATCH, and the ladder's cutoff is visibly performed.
const { test, expect } = require("./fixtures");

test("a knob turned in PERFORM is drawn performed in PATCH", async ({ page, app }) => {
  await app.boot();
  // Until PERFORM names the preset, "controls reach" may be the previous
  // patch's (the first pool patch lands on the bench at boot).
  await app.openOnPerform("First Bass");
  const box = await page.locator(".pf-knob").nth(0).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - i * 9);
  await page.mouse.up();
  await app.level("patch");
  // The ghosts land when PATCH draws the rack: waited for, not counted after
  // a fixed time, which a slow runner outran (#159).
  await app.engine((timeout) => expect(page.locator("#rack-svg .knob-ghost")).not.toHaveCount(0, { timeout }), { ms: 30_000 });
  await expect(page.locator("#rack-svg g.performed[data-addr=\"node#cut\"] .knob-value")).toHaveText(/kHz|Hz/);
});
