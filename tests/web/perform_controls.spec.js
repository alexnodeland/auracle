// PERFORM's controls do what the guide says they do.
//
// A half-closed control (one whose wiring confirmed only one direction on this
// patch) stops at the centre on the closed side. The sound always did; the
// dial used to turn on past it, drawing an arc on the closed side that nothing
// played, and the next drag then started from a value the sound never had.
// Glass Pad's measured wiring has at least one such control (Space sits at
// its close end), and the measurement is deterministic, so it is the patch.
//
// An XY axis set to a control the patch cannot move strikes its end words
// through, as the guide promises, rather than only dimming them.
const { test, expect } = require("@playwright/test");

async function openOnPerform(page, name) {
  await page.goto("/");
  await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 120_000 });
  await page.locator("#warm-skip").click();
  await page.locator('.bf[data-f="preset"]').click();
  await page.locator(".bank-item", { hasText: name }).first().click();
  await page.waitForTimeout(800);
  await page.locator('.viewtab[data-view="perform"]').click();
  await expect(page.locator(".pf-name")).toHaveText(name, { timeout: 30000 });
  await page.waitForFunction(
    () =>
      /controls reach/.test(document.querySelector(".pf-status")?.textContent || "") &&
      ![0, 1, 2, 3, 4, 5].some((i) => document.querySelector(`.pf-knob[data-i="${i}"]`)?.classList.contains("unwired")),
    null,
    { timeout: 90000 },
  );
}

test("a half-closed control stops at the centre on its closed side", async ({ page }) => {
  test.setTimeout(240_000);
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await openOnPerform(page, "Glass Pad");

  const half = page.locator(".pf-knob.half-lo, .pf-knob.half-hi").first();
  await expect(half, "Glass Pad has a half-closed control").toHaveCount(1);
  const up = await half.evaluate((el) => el.classList.contains("half-lo")); // only goes up
  const value = async () => Number(await half.getAttribute("aria-valuenow"));
  const box = await half.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // Drag the closed way, well past where the centre would be.
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy + (up ? 120 : -120), { steps: 12 });
  await page.mouse.up();
  expect(await value(), "the dial stops at the centre").toBe(0);

  // The open way still turns, and from the centre, not from below it.
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy + (up ? -60 : 60), { steps: 8 });
  await page.mouse.up();
  const opened = await value();
  expect(up ? opened : -opened, "the open way turns").toBeGreaterThan(0.3);

  // The keys stop at the centre too.
  await half.focus();
  await page.keyboard.press("Home");
  for (let n = 0; n < 8; n++) await page.keyboard.press(up ? "ArrowDown" : "ArrowUp");
  expect(await value(), "arrow keys stop at the centre").toBe(0);
  expect(errs).toEqual([]);
});

test("an XY axis the patch can't move strikes its end words through", async ({ page }) => {
  test.setTimeout(240_000);
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await openOnPerform(page, "Glass Pad");

  // A search control is one this patch can't move; put it on the pad's y axis.
  const i = await page.evaluate(() =>
    [0, 1, 2, 3, 4, 5].find((k) => document.querySelector(`.pf-knob[data-i="${k}"]`)?.classList.contains("search")),
  );
  expect(i, "Glass Pad has a search control").not.toBeUndefined();
  const sels = page.locator(".pf-xy select");
  await expect(sels).toHaveCount(2);
  await sels.nth(1).selectOption(String(i));
  await expect(page.locator(".pf-xy-field")).toHaveClass(/\bdead-y\b/);
  const deco = await page.locator(".pf-xy-t").evaluate((el) => getComputedStyle(el).textDecorationLine);
  expect(deco).toContain("line-through");
  expect(errs).toEqual([]);
});
