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

  // By the keyboard (m saves the sound in hand when no row has the cursor),
  // refused at the cap: shown at the press, back as it was with the reason.
  await page.mouse.move(5, 5);
  const live = page.locator("#bank-list .bank-item.live[data-id]");
  await expect(live).toHaveCount(1);
  const id2 = Number(await live.getAttribute("data-id"));
  const was = /\bsaved\b/.test(await live.getAttribute("class"));
  await app.answer({ type: "set_pinned", id: id2 }, { type: "pinned", id: id2, pinned: !was, ok: false, budget: [8, 8] });
  const keyed = await page.evaluate((id) => {
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "m", code: "KeyM", bubbles: true }));
    return document.querySelector(`#bank-list .bank-item[data-id="${id}"]`).classList.contains("saved");
  }, id2);
  expect(keyed, "m: the row shows what was asked for in the key's own task").toBe(!was);
  await expect(page.locator("#toasts .toast-msg").last()).toContainText("That would pass your limit of 8 saved sounds. Release one first.");
  await expect.poll(() => row(page, id2).evaluate((e) => e.classList.contains("saved")), { message: "the refusal put the row back" }).toBe(was);
});
