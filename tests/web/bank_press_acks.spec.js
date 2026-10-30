// The bank: Save answers the press (#305, ADR-025). It used to change nothing
// until the engine's `pinned` reply. Now the row shows what was asked for in
// the press's own task, the reply confirms it, and a refusal puts the row
// back as the engine has it and says why (both of the engine's reasons are
// main's to say: the budget is full, or the sound has left the pool).
//
// The press and the row are read in one `page.evaluate` (ADR-022: the app's
// own order), with the engine's reply held at the tap (`app.hold`) or given
// by the spec (`app.answer`, a refusal the engine reaches only at the cap).
const { test, expect } = require("./fixtures");

const row = (page, id) => page.locator(`#bank-list .bank-item[data-id="${id}"]`);

test("Save shows the row saved at the press, and a refusal puts it back and says why", async ({ page, app }) => {
  await app.boot();
  const first = page.locator("#bank-list .bank-item[data-id]:not(.saved)").first();
  await app.engine((timeout) => expect(first).toBeVisible({ timeout }));
  const id = Number(await first.getAttribute("data-id"));

  // By the mouse, with the engine's answer held: saved in the click's task.
  await app.hold(["pinned"]);
  await first.hover();
  const press = await page.evaluate((id) => {
    const sel = `#bank-list .bank-item[data-id="${id}"]`;
    const t0 = performance.now();
    document.querySelector(`${sel} .bi-save`).click();
    const r = document.querySelector(sel);
    const save = r.querySelector(".bi-save");
    return { saved: r.classList.contains("saved"), on: save.classList.contains("on"), pressed: save.getAttribute("aria-pressed"), ms: performance.now() - t0 };
  }, id);
  expect(press.saved, "the row says saved in the click's own task").toBe(true);
  expect(press.on).toBe(true);
  expect(press.pressed).toBe("true");
  app.budget("Save: the press → the row saved", press.ms, 100);
  // The engine's word, let through: it stands, and the toast says it.
  await app.engine(() => expect.poll(() => app.held().then((h) => h.length), { timeout: 30_000 }).toBeGreaterThan(0));
  await app.release();
  await expect(page.locator("#toasts .toast-msg").last()).toContainText(/^Saved /);
  await expect(row(page, id)).toHaveClass(/\bsaved\b/);

  // By the keyboard: the cursor stepped onto the next row (the list
  // focused, ↓), and m saves it, refused at the cap: saved at the press,
  // back as it was with the reason.
  await page.mouse.move(5, 5);
  await page.locator("#bank-list").focus();
  await page.keyboard.press("ArrowDown");
  const cursor = page.locator("#bank-list .bank-item.kbd[data-id]");
  await expect(cursor).toHaveCount(1);
  await expect(cursor).not.toHaveClass(/\bsaved\b/);
  const id2 = Number(await cursor.getAttribute("data-id"));
  expect(id2).not.toBe(id);
  await app.answer({ type: "set_pinned", id: id2 }, { type: "pinned", id: id2, pinned: true, ok: false, budget: [8, 8] });
  const keyed = await page.evaluate((id) => {
    document.getElementById("bank-list").dispatchEvent(new KeyboardEvent("keydown", { key: "m", code: "KeyM", bubbles: true }));
    const ask = window.__tap.sent.filter((q) => q.type === "set_pinned").pop();
    return { asked: ask && ask.m, saved: document.querySelector(`#bank-list .bank-item[data-id="${id}"]`).classList.contains("saved") };
  }, id2);
  expect(keyed.asked, "m asked to save the cursor's row").toMatchObject({ id: id2, pinned: true });
  expect(keyed.saved, "m: the row saved in the key's own task").toBe(true);
  await expect(page.locator("#toasts .toast-msg", { hasText: "That would pass your limit of 8 saved sounds. Release one first." })).toBeVisible();
  await expect(row(page, id2), "the refusal put the row back").not.toHaveClass(/\bsaved\b/);
});

test("a sound saved and cut before the engine answers leaves no save behind", async ({ page, app }) => {
  await app.boot();
  const first = page.locator("#bank-list .bank-item[data-id]:not(.saved):not(.live)").first();
  await app.engine((timeout) => expect(first).toBeVisible({ timeout }));
  const id = Number(await first.getAttribute("data-id"));
  const used = () => app.last("pinned").then((m) => (m && m.budget ? m.budget[0] : 0));
  const before = await used();
  await app.hold(["pinned"]);
  await first.hover();
  // Saved, then cut, before the Save's answer: the cut releases the save the
  // row shows, not the one the engine has.
  await page.evaluate((id) => {
    const sel = `#bank-list .bank-item[data-id="${id}"]`;
    document.querySelector(`${sel} .bi-save`).click();
    document.querySelector(`${sel} .bi-kill`).click();
  }, id);
  const asks = (await app.sent("set_pinned")).filter((q) => q.id === id).map((q) => q.pinned);
  expect(asks, "the cut asked for the save to go").toEqual([true, false]);
  await app.release();
  // Both answered: the engine holds no save for it, and its count is as it was.
  await app.engine(() => expect.poll(async () => (await app.replies("pinned")).filter((r) => r.id === id).length, { timeout: 30_000 }).toBe(2));
  // eslint-disable-next-line playwright/no-useless-await -- app.last is the tap's (a promise), not Locator.last()
  expect(await app.last("pinned"), "the last word: released").toMatchObject({ id, pinned: false, ok: true });
  expect(await used()).toBe(before);
});
