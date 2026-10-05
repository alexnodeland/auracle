// A bank row's actions exist on approach, as the mock draws them (Plan-008
// PR B): compare, ▶, ★, save and cut sit over the row's end when the pointer
// is on it or the keyboard cursor is, and not at rest, when they can't be
// pressed either. Cut can then be pressed. Its reveal rules once lost to the
// rule that hides it (CSS specificity), so the control could never appear.
// ★ folds the five stars out in the actions' place, and a star rates.
const { test, expect } = require("./fixtures");

test("a bank row's cut appears on hover and can be pressed", async ({ page, app }) => {
  await app.boot();
  const row = page.locator("#bank-list .bank-item:not(.saved):not(.live)").first();
  await app.engine((timeout) => expect(row).toBeVisible({ timeout }));
  const acts = row.locator(".bi-acts");
  const cut = row.locator(".bi-kill");
  // At rest: not drawn, and not live under the pointer either.
  await page.mouse.move(5, 5);
  await expect(acts).toHaveCSS("opacity", "0");
  await expect(cut).toBeHidden();
  await row.hover();
  await expect(acts).toHaveCSS("opacity", "1");
  await expect(cut).toBeVisible();
  await cut.click();
  await expect(page.locator("#toasts .toast").last()).toContainText(/^Cut /);
});

test("a bank row's actions show on the keyboard cursor, and its ★ folds out the five stars, which rate it", async ({ page, app }) => {
  await app.boot();
  await app.engine((timeout) => expect(page.locator("#bank-list .bank-item[data-id]").first()).toBeVisible({ timeout }));
  await page.mouse.move(5, 5);
  // The list is one tab stop; ↓ puts the cursor on its first row, and the
  // row's actions show there.
  await page.locator("#bank-list").focus();
  await page.keyboard.press("ArrowDown");
  const row = page.locator("#bank-list .bank-item.kbd");
  await expect(row).toHaveCount(1);
  await expect(row.locator(".bi-acts")).toHaveCSS("opacity", "1");
  // ★ (unrated): the stars fold out in the actions' place.
  const id = await row.getAttribute("data-id");
  const r = page.locator(`#bank-list .bank-item[data-id="${id}"]`);
  await r.hover();
  await expect(r.locator(".bi-star")).toHaveAttribute("aria-pressed", "false");
  await r.locator(".bi-star").click();
  await expect(r).toHaveClass(/\brating\b/);
  await expect(r.locator(".bi-save")).toBeHidden();
  await r.locator('.star[data-s="4"]').click();
  await expect(page.locator("#toasts .toast").last()).toContainText(/Rated .+ 4★\./);
  // Rated: the stars fold back, and ★ says it is rated.
  await expect(r).not.toHaveClass(/\brating\b/);
  await expect(r.locator(".bi-star")).toHaveAttribute("aria-pressed", "true");
  await expect(r.locator(".star.lit")).toHaveCount(4);
  // 1–5 still rate the cursor row without it.
  await page.locator("#bank-list").focus();
  await page.keyboard.press("2");
  await expect(page.locator("#toasts .toast").last()).toContainText(/Rated .+ 2★\./);
  await expect(r.locator(".star.lit")).toHaveCount(2);
});

// The pool stands in the order it joined at rest, so the sound boot opens,
// or one opened from elsewhere (here EVOLVE's OPEN IN PATCH), can be anywhere
// in the list: its row is brought into view.
test("a sound opened from outside the bank has its row brought into the bank's view", async ({ page, app }) => {
  // Short enough that the full pool's 40 rows must scroll.
  await page.setViewportSize({ width: 1440, height: 700 });
  // The bank whole (`filled`), so the list is as long as it will be and
  // nothing still arriving moves it.
  await app.boot();
  await app.filled();
  await expect.poll(() => page.locator("#bank-list .bank-item[data-id]").count()).toBe(40);
  const inView = (id) => page.evaluate((i) => {
    const r = document.querySelector(`#bank-list .bank-item[data-id="${i}"]`);
    if (!r) return false;
    const a = document.getElementById("bank-list").getBoundingClientRect();
    const b = r.getBoundingClientRect();
    return b.bottom > a.top + 1 && b.top < a.bottom - 1;
  }, id);
  // EVOLVE's card A, by its id, its row scrolled out of the bank's view.
  await page.locator('.rail-stop[data-level="evolve"]').click();
  await app.engine((timeout) => expect(page.locator("#choose-a")).toBeEnabled({ timeout }));
  const id = await page.evaluate(() => (document.querySelector("#name-a .dn-id")?.textContent || "").replace("#", "").trim());
  await expect(page.locator(`#bank-list .bank-item[data-id="${id}"]`), "card A's row in the pool").toHaveCount(1);
  // The scroll end that hides the row: the top if the row starts below one
  // list's height, else the bottom if it ends above the last screenful.
  const end = await page.evaluate((i) => {
    const list = document.getElementById("bank-list");
    const r = document.querySelector(`#bank-list .bank-item[data-id="${i}"]`);
    const top = r.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
    const max = list.scrollHeight - list.clientHeight;
    if (max < r.offsetHeight) return { err: `the list does not scroll: ${list.scrollHeight} px in ${list.clientHeight}` };
    if (top >= list.clientHeight) return { to: 0 };
    if (top + r.offsetHeight <= max) return { to: max };
    return { err: `no scroll end hides a row at ${top} px (list ${list.clientHeight} of ${list.scrollHeight})` };
  }, id);
  expect(end.err, end.err).toBeUndefined();
  // (Set again until it holds: a smooth scroll already under way would win.)
  await expect.poll(async () => {
    await page.evaluate(([to]) => document.getElementById("bank-list").scrollTo({ top: to, behavior: "instant" }), [end.to]);
    return inView(id);
  }, { message: "card A's row out of view before it opens" }).toBe(false);
  await page.locator("#promote-a").click();
  await app.engine((timeout) => expect(page.locator(`#bank-list .bank-item[data-id="${id}"]`)).toHaveClass(/\b(live|opening)\b/, { timeout }), { ms: 30_000 });
  await expect.poll(() => inView(id), { timeout: 15_000 }).toBe(true);
});
