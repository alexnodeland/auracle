// The bank under a finger (Plan-008 PR B). A tap on a row opens it and goes
// to PATCH, so on a touch screen a row's actions (▶, ★, save, cut) and a
// preset's ▶ are shown on every row at rest, on a line under the name, and
// answer a tap without opening the row; a mouse keeps the mock's actions on
// approach. A touch pointer "leaves" as it lifts, before its tap's click: the
// stars ★ folds out stay out for that click, so tapping the fifth star rates
// five and cannot press cut, which sits under it.
const { test, expect, bankTab } = require("./fixtures");

// A tablet: a coarse pointer and touch, wide enough to have no gate.
test.use({ viewport: { width: 1280, height: 800 }, hasTouch: true, isMobile: true });

/** Boot past the handheld gate if it shows, and wait for the whole pool:
 *  with the renders an earlier boot of the seed kept, since nothing here
 *  happens before the pool is whole (fixtures.js `reuseRenders`). */
async function boot(page, app) {
  await app.boot({ wait: false, reuseRenders: true });
  const anyway = page.locator("#hg-anyway");
  if (await anyway.isVisible().catch(() => false)) await anyway.click();
  await app.booted();
  await app.poolRows(40);
}
const at = (page, level) => expect(page.locator(`.rail-stop[data-level="${level}"]`)).toHaveAttribute("aria-current", "location");
// The bank redraws as the engine answers, so a row's node can be swapped
// mid-scroll: the scroll is retried on the row as it is then.
const toRow = (row) => expect(async () => { await row.scrollIntoViewIfNeeded({ timeout: 2_000 }); }).toPass({ timeout: 15_000 });

test("on a touch screen a pool row's and a preset's actions show at rest and answer a tap without opening the row", async ({ page, app }) => {
  await boot(page, app);
  expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches), "a coarse pointer").toBe(true);
  await at(page, "perform");
  // A preset's ▶, at rest, hears it without opening it. (First, while
  // nothing sounds: a ▶ pressed while another phrase plays stops that one.)
  await bankTab(page, "presets");
  const preset = page.locator("#bank-list .preset-item:not(.in-bank)").first();
  await expect(preset).toBeVisible();
  const index = Number(await preset.getAttribute("data-index"));
  await expect(preset.locator(".bi-hear")).toBeVisible();
  await preset.locator(".bi-hear").tap();
  await expect.poll(async () => (await app.sent({ type: "load_preset", index, preview: true, open: false })).length).toBeGreaterThan(0);
  await at(page, "perform");
  // It joins the pool (the bank redraws for it): act on the pool once it has.
  await app.engine((timeout) => expect(page.locator(`#bank-list .preset-item[data-index="${index}"]`)).toHaveClass(/\bin-bank\b/, { timeout }), { ms: 60_000 });
  await bankTab(page, "pool");
  const id = await page.locator("#bank-list .bank-item[data-id]:not(.live)").nth(2).getAttribute("data-id");
  const row = page.locator(`#bank-list .bank-item[data-id="${id}"]`);
  await toRow(row);
  // At rest, nothing pointed at: its actions are there.
  for (const a of [".bi-hear", ".bi-star", ".bi-save", ".bi-kill"]) await expect(row.locator(a), a).toBeVisible();
  // ▶ plays it (lit, or on its way), and the row is not opened.
  await row.locator(".bi-hear").tap();
  await app.engine((timeout) => expect(row.locator(".bi-hear")).toHaveClass(/\b(playing|pending)\b/, { timeout }), { ms: 30_000 });
  await at(page, "perform");
  await expect(row).not.toHaveClass(/\blive\b|\bopening\b/);
  // ★ opens the stars in place, still without opening the row.
  await row.locator(".bi-star").tap();
  await expect(row).toHaveClass(/\brating\b/);
  await expect(row.locator('.star[data-s="3"]')).toBeVisible();
  await at(page, "perform");
});

// The latest ▶ wins (#421): a preset's ▶ waits for its sound to be loaded and
// rendered, and a pool row's ▶ tapped meanwhile takes that wait back, so the
// preset's phrase, landing later, does not start over the row's. Every phrase
// that starts is counted on the page as it starts (a ▶'s phrase is a buffer
// played from its start), so what is heard is read on the app's own timeline,
// however late the preset's render is.
test("a pool row's ▶ tapped while a preset's ▶ waits for its sound is the one heard", async ({ page, app }) => {
  await page.addInitScript(() => {
    window.__phrases = 0;
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...a) {
      window.__phrases++;
      return start.apply(this, a);
    };
  });
  const phrases = () => page.evaluate(() => window.__phrases);
  await boot(page, app);
  // The preset's load waits in the tap until the row's ▶ has been tapped.
  await app.holdRequests("load_preset");
  await bankTab(page, "presets");
  const preset = page.locator("#bank-list .preset-item:not(.in-bank)").first();
  await preset.locator(".bi-hear").tap();
  await expect.poll(() => app.sentCount("load_preset")).toBeGreaterThan(0);
  await bankTab(page, "pool");
  const id = await page.locator("#bank-list .bank-item[data-id]:not(.live)").nth(2).getAttribute("data-id");
  const row = page.locator(`#bank-list .bank-item[data-id="${id}"]`);
  await toRow(row);
  const before = await phrases();
  await row.locator(".bi-hear").tap();
  await expect.poll(phrases, "the row's phrase starts").toBe(before + 1);
  // Now the preset loads, and anything it would render is answered.
  await app.releaseRequests();
  await app.reply("preset_loaded");
  await app.answered({ types: ["render"] });
  await app.quiet();
  expect(await phrases(), "a phrase started after the row's: the preset's, over it").toBe(before + 1);
});

test("on a touch screen tapping ★ and then the fifth star rates five, and cuts nothing", async ({ page, app }) => {
  await boot(page, app);
  const id = await page.locator("#bank-list .bank-item[data-id]:not(.live):not(.saved)").nth(1).getAttribute("data-id");
  const row = page.locator(`#bank-list .bank-item[data-id="${id}"]`);
  await toRow(row);
  await row.locator(".bi-star").tap();
  await expect(row).toHaveClass(/\brating\b/);
  // The finger lifts (its pointer "leaves") before the tap's click: the
  // stars are still out for it.
  await row.locator('.star[data-s="5"]').tap();
  await app.toast(/^Rated .+ 5★\.$/);
  await expect(row.locator(".bi-star")).toHaveAttribute("aria-pressed", "true");
  await expect(row.locator(".star.lit")).toHaveCount(5);
  await app.quiet();
  expect((await app.toasts()).filter((t) => /^Cut /.test(t)), "a cut under the fifth star").toEqual([]);
  await expect(row).toHaveCount(1);
});
