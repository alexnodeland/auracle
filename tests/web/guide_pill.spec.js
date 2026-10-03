// The guide pill (Plan-008 PR C1, ADR-009's one onboarding surface): the
// first-visit steps, one at a time, bottom left of the stage, with pips and
// ×. PERFORM's three first steps are its steps.
//
// - It shows the step that is next, ticks it off when it happens (a note
//   played, a control turned, an offer asked for), and after the last says
//   what the loop was, then goes.
// - It sits bottom left of the stage, under PERFORM's well, and shows each
//   level's own steps: PERFORM's on PERFORM, PATCH's on PATCH (Plan-008 C2a).
// - × stops it, and a reload keeps it stopped (`auracle-guide`).
// - The first steps' ticks kept before the pill (`auracle-perform-steps`)
//   carry over: the pill opens at the next step, and the old key is gone.
const { test, expect } = require("@playwright/test");
const { goLevel } = require("./shell");

async function boot(page, { seed = null } = {}) {
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  if (seed) {
    await page.addInitScript((s) => {
      try {
        if (!sessionStorage.getItem("seeded")) {
          for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
          sessionStorage.setItem("seeded", "1");
        }
      } catch (_) {}
    }, seed);
  }
  await page.goto("/");
  await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 120_000 });
  await page.locator("#warm-skip").click();
  await goLevel(page, "perform");
  return errs;
}

const pill = (page) => page.locator("#guide");
const pips = (page) => page.locator("#guide .pips i");

test("the pill shows one step at a time and ticks each off as it happens", async ({ page }) => {
  test.setTimeout(240_000);
  const errs = await boot(page);
  await expect(page.locator(".pf-status")).toContainText("controls reach", { timeout: 120_000 });
  await expect(pill(page)).toBeVisible();
  await expect(page.locator("#guide .pf-step")).toHaveCount(1);
  await expect(page.locator("#guide .pf-step.now")).toContainText("Play a key");
  await expect(pips(page)).toHaveCount(3);
  await expect(page.locator("#guide .pips i.done")).toHaveCount(0);
  // Bottom left of the stage, under the well.
  const g = await pill(page).boundingBox();
  const well = await page.locator(".pf-well").boundingBox();
  const stage = await page.locator(".stage").boundingBox();
  expect(g.x).toBeLessThan(well.x + well.width);
  expect(g.y).toBeGreaterThanOrEqual(well.y + well.height - 1);
  expect(g.y + g.height).toBeLessThanOrEqual(stage.y + stage.height);
  // A note: step 2, which names a control that turns here.
  await page.keyboard.press("a");
  await expect(page.locator("#guide .pf-step.now")).toContainText(/^Turn [A-Z]+: drag/);
  await expect(page.locator("#guide .pips i.done")).toHaveCount(1);
  // A turn: step 3.
  const k = page.locator(".pf-deck .pf-knob:not(.search):not(.pending)").first();
  await k.focus();
  for (let i = 0; i < 6; i++) await page.keyboard.press(/half-hi/.test(await k.getAttribute("class")) ? "ArrowDown" : "ArrowUp");
  await expect(page.locator("#guide .pf-step.now")).toContainText("Press OFFER");
  // PATCH shows its own steps; back on PERFORM, PERFORM's.
  await goLevel(page, "patch");
  await expect(page.locator("#guide .pf-step.now")).toContainText(/^(Drag a knob|Tap a module)/);
  await expect(pips(page)).toHaveCount(3);
  await expect(page.locator("#guide .pips i.done")).toHaveCount(0);
  await goLevel(page, "perform");
  await expect(pill(page)).toBeVisible();
  await expect(page.locator("#guide .pf-step.now")).toContainText("Press OFFER");
  // An offer asked for: the last step, said once, then the pill goes.
  await page.locator(".pf-pad", { hasText: /^Offer$/ }).click();
  await expect(page.locator("#guide .pf-step.all")).toContainText("That is the loop");
  await expect(pill(page)).toBeHidden({ timeout: 15_000 });
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem("auracle-guide")));
  expect(kept.done.sort()).toEqual(["offer", "play", "turn"]);
  expect(errs).toEqual([]);
});

test("× stops the pill, and a reload keeps it stopped", async ({ page }) => {
  test.setTimeout(240_000);
  const errs = await boot(page);
  await expect(pill(page)).toBeVisible();
  await page.locator("#guide .x").click();
  await expect(pill(page)).toBeHidden();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("auracle-guide")).closed)).toBe(true);
  await page.reload();
  await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 120_000 });
  await goLevel(page, "perform");
  await expect(page.locator(".pf-name")).not.toHaveText("·", { timeout: 60_000 });
  await expect(pill(page)).toBeHidden();
  expect(errs).toEqual([]);
});

test("the first steps' old ticks carry over into the pill, and the old key goes", async ({ page }) => {
  test.setTimeout(240_000);
  const errs = await boot(page, { seed: { "auracle-perform-steps": JSON.stringify(["play"]) } });
  await expect(pill(page)).toBeVisible();
  await expect(page.locator("#guide .pf-step.now")).toContainText(/^Turn /);
  await expect(page.locator("#guide .pips i.done")).toHaveCount(1);
  const store = await page.evaluate(() => ({ old: localStorage.getItem("auracle-perform-steps"), now: JSON.parse(localStorage.getItem("auracle-guide")) }));
  expect(store.old).toBeNull();
  expect(store.now).toEqual({ done: ["play"], closed: false });
  expect(errs).toEqual([]);
});
