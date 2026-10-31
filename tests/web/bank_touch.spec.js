// The bank under a finger (Plan-008 PR B). A tap on a row opens it and goes
// to PATCH, so on a touch screen a row's actions (▶, ★, save, cut) and a
// preset's ▶ are shown on every row at rest, on a line under the name, and
// answer a tap without opening the row; a mouse keeps the mock's actions on
// approach. A touch pointer "leaves" as it lifts, before its tap's click: the
// stars ★ folds out stay out for that click, so tapping the fifth star rates
// five and cannot press cut, which sits under it. Under the model view, which
// a mouse sees the actions of only on approach, a finger still has them.
const { test, expect, bankTab, modelView } = require("./fixtures");

// A tablet: a coarse pointer and touch, wide enough to have no gate.
test.use({ viewport: { width: 1280, height: 800 }, hasTouch: true, isMobile: true });

/** Boot, and wait for the whole pool: with the renders an earlier boot of
 *  the seed kept, since nothing here happens before the pool is whole
 *  (fixtures.js `reuseRenders`). */
async function boot(page, app) {
  await app.boot({ reuseRenders: true });
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
  // nothing sounds: a ▶ pressed while another phrase plays stops it, and the
  // row's ▶ below may be pressed while the preset's still sounds.)
  await bankTab(page, "presets");
  const preset = page.locator("#bank-list .preset-item:not(.in-bank)").first();
  await expect(preset).toBeVisible();
  const index = Number(await preset.getAttribute("data-index"));
  await expect(preset.locator(".bi-hear")).toBeVisible();
  await preset.locator(".bi-hear").tap();
  await expect.poll(async () => (await app.sent({ type: "load_preset", index, preview: true, open: false })).length).toBeGreaterThan(0);
  await at(page, "perform");
  // It joins the pool (the bank redraws for it), and its phrase sounds: its
  // ▶ is lit. Joining says only that the load came back; the render it then
  // waits on is still on its way, and a ▶ tapped in that gap is a different
  // case (the latest ▶ wins: the specs below, one tapping while the load is
  // held, one while the render is). So the pool is acted on once the preset
  // is heard.
  const presetRow = page.locator(`#bank-list .preset-item[data-index="${index}"]`);
  await app.engine((timeout) => expect(presetRow).toHaveClass(/\bin-bank\b/, { timeout }), { ms: 60_000 });
  await app.engine((timeout) => expect(presetRow.locator(".bi-hear")).toHaveClass(/\bplaying\b/, { timeout }), { ms: 60_000 });
  await bankTab(page, "pool");
  const id = await page.locator("#bank-list .bank-item[data-id]:not(.live)").nth(2).getAttribute("data-id");
  const row = page.locator(`#bank-list .bank-item[data-id="${id}"]`);
  await toRow(row);
  // At rest, nothing pointed at: its actions are there.
  for (const a of [".bi-hear", ".bi-star", ".bi-save", ".bi-kill"]) await expect(row.locator(a), a).toBeVisible();
  // ▶ plays the row (lit, or on its way), over the preset's phrase when it
  // is still sounding, and the row is not opened.
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

test("under the model view a touch screen's rows still show their actions at rest", async ({ page, app }) => {
  await boot(page, app);
  await modelView(page, true);
  const row = page.locator("#bank-list .bank-item[data-id]:not(.live)").nth(2);
  await toRow(row);
  for (const a of [".bi-hear", ".bi-star", ".bi-save", ".bi-kill"]) await expect(row.locator(a), a).toBeVisible();
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
  await app.engine((timeout) => expect.poll(phrases, { timeout, message: "the row's phrase starts" }).toBe(before + 1), { ms: 30_000 });
  // Now the preset loads, and anything it would render is answered.
  await app.releaseRequests();
  await app.replyTo((await app.sent({ type: "load_preset", preview: true }))[0]);
  await app.answered({ types: ["render"] });
  await app.quiet();
  expect(await phrases(), "a phrase started after the row's: the preset's, over it").toBe(before + 1);
});

// The same, a step later (#421's own gap): the preset's load has come back
// (it joins the pool) and its render is on its way when the row's ▶ is
// tapped. The render is held only until the row's tap, well inside the
// render's wait (RENDER_WAIT_MS, 12 s), so the preset's wait is still
// standing when the row takes it back.
test("a pool row's ▶ tapped while a preset's ▶ waits for its render is the one heard", async ({ page, app }) => {
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
  await bankTab(page, "presets");
  const preset = page.locator("#bank-list .preset-item:not(.in-bank)").first();
  const index = Number(await preset.getAttribute("data-index"));
  const presetRow = page.locator(`#bank-list .preset-item[data-index="${index}"]`);
  const renders = await app.sentCount("render");
  await app.holdRequests("render");
  await preset.locator(".bi-hear").tap();
  // The load comes back (the preset joins the pool) and its render is asked
  // for, and held.
  await app.engine((timeout) => expect(presetRow).toHaveClass(/\bin-bank\b/, { timeout }), { ms: 60_000 });
  await expect.poll(() => app.sentCount("render")).toBeGreaterThan(renders);
  await bankTab(page, "pool");
  const id = await page.locator("#bank-list .bank-item[data-id]:not(.live)").nth(2).getAttribute("data-id");
  const row = page.locator(`#bank-list .bank-item[data-id="${id}"]`);
  await toRow(row);
  const before = await phrases();
  await row.locator(".bi-hear").tap();
  await expect(row.locator(".bi-hear")).toHaveClass(/\b(playing|pending)\b/);
  // Now the preset's render, and any the row asked for, are answered.
  await app.releaseRequests();
  await app.answered({ types: ["render"] });
  await app.engine((timeout) => expect.poll(phrases, { timeout, message: "the row's phrase starts" }).toBeGreaterThan(before), { ms: 30_000 });
  await app.quiet();
  expect(await phrases(), "a phrase started after the row's: the preset's, over it").toBe(before + 1);
});

// The same, through the ▶ that plays everywhere (ADR-016): the header's ▶
// (Space's press) with a patch on the bench goes to the bench's ▶, not
// through a render's wait, and it too takes the preset's wait back.
test("the header's ▶ pressed while a preset's ▶ waits for its sound is the one heard", async ({ page, app }) => {
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
  await app.holdRequests("load_preset");
  await bankTab(page, "presets");
  const preset = page.locator("#bank-list .preset-item:not(.in-bank)").first();
  await preset.locator(".bi-hear").tap();
  await expect.poll(() => app.sentCount("load_preset")).toBeGreaterThan(0);
  await bankTab(page, "pool");
  const before = await phrases();
  await page.locator("#inhand-play").tap();
  await app.engine((timeout) => expect.poll(phrases, { timeout, message: "the sound in hand's phrase starts" }).toBe(before + 1), { ms: 30_000 });
  await app.releaseRequests();
  await app.replyTo((await app.sent({ type: "load_preset", preview: true }))[0]);
  await app.answered({ types: ["render"] });
  await app.quiet();
  expect(await phrases(), "a phrase started after the header's: the preset's, over it").toBe(before + 1);
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
