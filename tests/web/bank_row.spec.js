// A bank row's actions exist on approach, as the mock draws them (Plan-008
// PR B): compare, ▶, ★, save and cut sit over the row's end when the pointer
// is on it or the keyboard cursor is, and not at rest, when they can't be
// pressed either. Cut can then be pressed. Its reveal rules once lost to the
// rule that hides it (CSS specificity), so the control could never appear.
// ★ folds the five stars out in the actions' place, and a star rates.
const { test, expect } = require("@playwright/test");

async function boot(page) {
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto("/");
  await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 120_000 });
  await page.locator("#warm-skip").click();
  return errs;
}

test("a bank row's cut appears on hover and can be pressed", async ({ page }) => {
  test.setTimeout(180_000);
  const errs = await boot(page);
  const row = page.locator("#bank-list .bank-item:not(.saved):not(.live)").first();
  await expect(row).toBeVisible({ timeout: 60_000 });
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
  await expect(page.locator("#toasts .toast").last()).toContainText(/^Cut /, { timeout: 10_000 });
  expect(errs).toEqual([]);
});

test("a bank row's actions show on the keyboard cursor, and its ★ folds out the five stars, which rate it", async ({ page }) => {
  test.setTimeout(180_000);
  const errs = await boot(page);
  await expect(page.locator("#bank-list .bank-item[data-id]").first()).toBeVisible({ timeout: 60_000 });
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
  await expect(page.locator("#toasts .toast").last()).toContainText(/Rated .+ 4★\./, { timeout: 10_000 });
  // Rated: the stars fold back, and ★ says it is rated.
  await expect(r).not.toHaveClass(/\brating\b/);
  await expect(r.locator(".bi-star")).toHaveAttribute("aria-pressed", "true");
  await expect(r.locator(".star.lit")).toHaveCount(4);
  // 1–5 still rate the cursor row without it.
  await page.locator("#bank-list").focus();
  await page.keyboard.press("2");
  await expect(page.locator("#toasts .toast").last()).toContainText(/Rated .+ 2★\./, { timeout: 10_000 });
  await expect(r.locator(".star.lit")).toHaveCount(2);
  expect(errs).toEqual([]);
});

// The pool stands in the order it joined at rest, so the sound boot opens,
// or one opened from elsewhere (here EVOLVE's OPEN IN PATCH), can be anywhere
// in the list: its row is brought into view.
test("a sound opened from outside the bank has its row brought into the bank's view", async ({ page }) => {
  test.setTimeout(180_000);
  const errs = await boot(page);
  const inView = (id) => page.evaluate((i) => {
    const r = document.querySelector(`#bank-list .bank-item[data-id="${i}"]`);
    if (!r) return false;
    const a = document.getElementById("bank-list").getBoundingClientRect();
    const b = r.getBoundingClientRect();
    return b.top >= a.top - 1 && b.bottom <= a.bottom + 1;
  }, id);
  const live = page.locator("#bank-list .bank-item.live");
  await expect(live).toHaveCount(1, { timeout: 60_000 });
  await expect.poll(async () => inView(await live.getAttribute("data-id")), { timeout: 15_000 }).toBe(true);
  // EVOLVE's card A, its row scrolled out of the bank's view, then opened.
  await page.locator('.rail-stop[data-level="evolve"]').click();
  await expect(page.locator("#choose-a")).toBeEnabled({ timeout: 60_000 });
  const id = await page.evaluate(() => {
    const t = document.getElementById("name-a").textContent;
    const r = [...document.querySelectorAll("#bank-list .bank-item[data-id]")].find((e) => t.includes(e.querySelector(".bi-name").textContent.trim()));
    return r ? r.dataset.id : null;
  });
  expect(id, "card A's row in the pool").not.toBeNull();
  // (Set again until it holds: a smooth scroll already under way would win.)
  await expect.poll(async () => {
    await page.evaluate((i) => {
      const list = document.getElementById("bank-list");
      const r = document.querySelector(`#bank-list .bank-item[data-id="${i}"]`);
      const mid = r.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
      list.scrollTo({ top: mid > list.scrollHeight / 2 ? 0 : list.scrollHeight, behavior: "instant" });
    }, id);
    return inView(id);
  }, { timeout: 10_000, message: "card A's row out of view before it opens" }).toBe(false);
  await page.locator("#promote-a").click();
  await expect(page.locator(`#bank-list .bank-item[data-id="${id}"]`)).toHaveClass(/\b(live|opening)\b/, { timeout: 30_000 });
  await expect.poll(() => inView(id), { timeout: 15_000 }).toBe(true);
  expect(errs).toEqual([]);
});
