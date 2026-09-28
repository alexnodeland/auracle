// A bank row's controls exist on approach: cut appears on hover and on the
// keyboard cursor, and can then be pressed. Its reveal rules once lost to the
// rule that hides it (CSS specificity), so the control could never appear.
const { test, expect } = require("@playwright/test");

test("a bank row's cut appears on hover and can be pressed", async ({ page }) => {
  test.setTimeout(180_000);
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto("/");
  await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 120_000 });
  await page.locator("#warm-skip").click();
  const row = page.locator("#bank-list .bank-item:not(.saved)").first();
  await expect(row).toBeVisible({ timeout: 60_000 });
  const cut = row.locator(".bi-kill");
  await expect(cut).toBeHidden();
  await row.hover();
  await expect(cut).toBeVisible();
  await cut.click();
  await expect(page.locator("#toasts .toast").last()).toContainText(/^Cut /, { timeout: 10_000 });
  expect(errs).toEqual([]);
});
