// PERFORM and EVOLVE under a finger (Plan-008 PR C1): every function the
// layout moved is a tap away on a touch screen, and no printed key shows.
//
// - Wander freezes on a tap; XY opens in the well, a tap on its field moves
//   its two controls, and the moved bar's KEEP answers a tap; HOW IT WORKS and
//   ARRANGE (with what velocity plays) open; stage mode says a tap plays and
//   its × leaves.
// - EVOLVE's corner (⇄ circuit) and what each generation did answer a tap.
const { test, expect } = require("@playwright/test");
const { goLevel } = require("./shell");

// A tablet: a coarse pointer and touch, wide enough to have no gate.
test.use({ viewport: { width: 1280, height: 800 }, hasTouch: true, isMobile: true });

async function boot(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    try {
      for (const k of ["auracle-played", "auracle-bench-tour", "auracle-bank-toured", "auracle-warmed"]) localStorage.setItem(k, "1");
    } catch (_) {}
  });
  await page.goto("/");
  const anyway = page.locator("#hg-anyway");
  if (await anyway.isVisible().catch(() => false)) await anyway.click();
  await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 150_000 });
  await goLevel(page, "perform");
  await expect(page.locator(".pf-status")).toContainText("controls reach", { timeout: 120_000 });
  return errors;
}

test("on a touch screen every PERFORM function the layout moved is a tap away, with no printed keys", async ({ page }) => {
  test.setTimeout(240_000);
  const errors = await boot(page);
  // No printed key on a pad or in the moved bar under a finger.
  const keyShown = await page.evaluate(() =>
    [...document.querySelectorAll(".pf-pad[data-key]")].some((b) => getComputedStyle(b, "::before").display !== "none"),
  );
  expect(keyShown, "no printed key on a pad").toBe(false);
  // Wander: a tap freezes it, another lets it go.
  const wander = page.locator(".pf-pads .pf-wander");
  await wander.tap();
  await expect(wander).toHaveAttribute("data-frozen", "true");
  await wander.tap();
  await expect(wander).toHaveAttribute("data-frozen", "false");
  // XY in the well: a tap on its field moves its two controls, and the sound
  // has moved, so the bar offers KEEP, which answers a tap.
  await page.locator(".pf-xy-btn").tap();
  await expect(page.locator(".pf-well")).toHaveAttribute("data-mode", "xy");
  const f = await page.locator(".pf-xy-field").boundingBox();
  await page.touchscreen.tap(f.x + f.width * 0.85, f.y + f.height * 0.15);
  await expect(page.locator(".pf-moved")).toHaveClass(/\bon\b/);
  await page.locator(".pf-xy-btn").tap();
  await expect(page.locator(".pf-well")).toHaveAttribute("data-mode", "face");
  await page.locator(".pf-moved .pf-keep").tap();
  await expect(page.locator("#toasts")).toContainText("Kept: this is home now.", { timeout: 15_000 });
  // HOW IT WORKS opens in the well.
  await page.locator(".pf-why-btn").tap();
  await expect(page.locator(".pf-why-body")).toBeVisible();
  await page.locator(".pf-why-x").tap();
  await expect(page.locator(".pf-why-body")).toBeHidden();
  // ARRANGE holds what velocity plays.
  await page.locator(".pf-arrange").tap();
  await expect(page.locator(".pp .pp-vel #pf-touch-sel")).toBeVisible();
  await expect(page.locator(".pp .pp-vel #pf-touch-depth")).toBeVisible();
  await page.locator(".pp-x").tap();
  // Stage mode: a tap plays, and × leaves.
  await page.locator(".pf-stage-btn").tap();
  await expect(page.locator(".st-stage")).toBeVisible();
  await expect(page.locator(".st-hint")).toHaveText("tap to play the sound · × leaves");
  await page.locator(".st-leave").tap();
  await expect(page.locator(".st-stage")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("on a touch screen EVOLVE's corner and what each generation did answer a tap", async ({ page }) => {
  test.setTimeout(240_000);
  const errors = await boot(page);
  await goLevel(page, "evolve");
  await expect(page.locator("#name-a")).not.toHaveText("sound a", { timeout: 90_000 });
  await page.locator("#flip-a").tap();
  await expect(page.locator("#mini-a")).toBeVisible();
  await page.locator("#flip-a").tap();
  await expect(page.locator("#face-a")).toBeVisible();
  await page.locator("#lineage-btn").tap();
  await expect(page.locator("#lineage-pop")).toBeVisible();
  await page.locator("#lineage-x").tap();
  await expect(page.locator("#lineage-pop")).toBeHidden();
  expect(errors).toEqual([]);
});
