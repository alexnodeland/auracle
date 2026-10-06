// The warm start run again, from ⋯ › Re-run the three-pick warm start (the
// guide's "any time, to teach it 18 more"): nine new cards, none of them
// picked, TEACH IT reached by picking three of them, and those three taught.
//
// The picks used to outlive their deal (main.js `warmPicked`): on the new
// deal a click could add no card, since three were still held from the last
// one, so the first card clicked read "teach it" with nothing marked, and
// TEACH IT taught the last deal's three again.
//
// The warm start's first run, its 18 preferences and PERFORM's first steps
// after it, are `first_run.spec.js`'s, which is not on the fixture yet (#170).
const { test, expect } = require("./fixtures");

test("the warm start run again starts with no card picked and teaches the three picked on it", async ({ page, app }) => {
  await app.boot({ warmed: false });
  await app.warmStart([1, 4, 7]);
  await expect(page.locator("#duel-count")).toHaveText("18");

  await page.locator("#ovf-btn").click();
  await page.locator("#warm-rerun-btn").click();
  // The deal waits on the engine's `presets` reply.
  await app.engine((timeout) => expect(page.locator("#warmstart")).not.toHaveClass(/\bhidden\b/, { timeout }));
  const items = page.locator("#warm-grid .warm-item");
  const picked = page.locator("#warm-grid .warm-item.picked");
  const go = page.locator("#warm-go");
  await expect(items).toHaveCount(9);
  await expect(picked).toHaveCount(0);
  await expect(go).toHaveText("pick any three");
  await expect(go).toBeDisabled();

  // One card is one of three…
  await items.nth(0).click();
  await expect(items.nth(0)).toHaveAttribute("aria-pressed", "true");
  await expect(go).toHaveText("2 more");
  await expect(go).toBeDisabled();
  // …and three reach TEACH IT.
  await items.nth(2).click();
  await items.nth(5).click();
  await expect(picked).toHaveCount(3);
  await expect(go).toHaveText("teach it");
  await expect(go).toBeEnabled();

  // TEACH IT teaches these three, not the last deal's: 18 more picks.
  const names = await picked.locator(".wi-name").allTextContents();
  // eslint-disable-next-line playwright/no-useless-await -- app.last is the tap's (a promise), not Locator.last()
  const { rows } = await app.last("presets");
  const want = names.map((n) => rows.find((r) => r.name === n).index).sort((a, b) => a - b);
  const t0 = await app.now();
  await go.click();
  let sent = null;
  await expect.poll(async () => (sent = (await app.sent("warm_start", { after: t0 }))[0] || null)).not.toBeNull();
  expect([...sent.picked].sort((a, b) => a - b)).toEqual(want);
  await app.replyTo(sent);
  await expect(page.locator("#duel-count")).toHaveText("36");
});
