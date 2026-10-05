// PERFORM and EVOLVE under a finger (Plan-008 PR C1): every function the
// layout moved is a tap away on a touch screen, and no printed key shows.
//
// - Wander freezes on a tap; XY opens in the well, a tap on its field moves
//   its two controls, and the moved bar's KEEP answers a tap; HOW IT WORKS and
//   ARRANGE (with what velocity plays) open; stage mode says a tap plays and
//   its × leaves.
// - EVOLVE's corner (⇄ circuit) and what each generation did answer a tap.
// - KEEP, BACK and the pill's × are a finger's size; BACK answers a tap.
// - PEEK held with a finger plays B (heard, so a pass counts it).
const { test, expect, PERFORM_SEED, bankTab } = require("./fixtures");

// A tablet: a coarse pointer and touch, wide enough to have no gate.
test.use({ viewport: { width: 1280, height: 800 }, hasTouch: true, isMobile: true });

// PEEK held long enough for B to be heard: a second of it while a note sounds.
const HEARD_MS = 1_800;

async function boot(page, app) {
  await app.boot({ seed: PERFORM_SEED, random: PERFORM_SEED, wait: false });
  const anyway = page.locator("#hg-anyway");
  if (await anyway.isVisible().catch(() => false)) await anyway.click();
  await app.booted();
  await app.level("perform");
  await app.reached();
}

/** Glass Pad, tapped in PRESETS, on PERFORM with its controls reached. */
async function glassPad(page, app) {
  await bankTab(page, "presets");
  await page.locator(".bank-item", { hasText: "Glass Pad" }).first().tap();
  await app.level("perform");
  await app.engine((timeout) => expect(page.locator(".pf-name")).toHaveText("Glass Pad", { timeout }), { ms: 60_000 });
  await app.reached();
}

test("on a touch screen every PERFORM function the layout moved is a tap away, with no printed keys", async ({ page, app }) => {
  await boot(page, app);
  // Glass Pad, whose BRIGHT turns both ways: the XY pad's first axis moves.
  await glassPad(page, app);
  // No printed key on a pad or in the moved bar under a finger.
  const keyShown = await page.evaluate(() => ({
    pads: [...document.querySelectorAll(".pf-pad[data-key]")].some((b) => getComputedStyle(b, "::before").display !== "none"),
    bar: [...document.querySelectorAll(".pf-mv[data-key]")].some((b) => getComputedStyle(b, "::after").display !== "none"),
  }));
  expect(keyShown, "no printed key on a pad or in the moved bar").toEqual({ pads: false, bar: false });
  // The first-steps pill's × is a finger's size.
  const x = await page.locator("#guide .x").boundingBox();
  expect(Math.min(x.width, x.height), "the pill's ×").toBeGreaterThanOrEqual(40);
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
  // A control that turns one way only stops at the center on the other, so
  // the corners are tried until one moves the sound.
  const f = await page.locator(".pf-xy-field").boundingBox();
  let corner = null;
  for (const [fx, fy] of [[0.85, 0.15], [0.15, 0.85], [0.15, 0.15], [0.85, 0.85]]) {
    await page.touchscreen.tap(f.x + f.width * fx, f.y + f.height * fy);
    const moved = await expect(page.locator(".pf-moved.on")).toHaveCount(1, { timeout: 2_000 }).then(() => true, () => false);
    if (moved) {
      corner = [fx, fy];
      break;
    }
  }
  await expect(page.locator(".pf-moved")).toHaveClass(/\bon\b/);
  await page.locator(".pf-xy-btn").tap();
  await expect(page.locator(".pf-well")).toHaveAttribute("data-mode", "face");
  // KEEP and BACK are a finger's size, and BACK answers a tap: the sound
  // glides home, and the bar goes.
  for (const b of await page.locator(".pf-moved .pf-mv").all()) expect((await b.boundingBox()).height).toBeGreaterThanOrEqual(40);
  await page.locator(".pf-moved .pf-back").tap();
  await expect(page.locator(".pf-moved")).not.toHaveClass(/\bon\b/, { timeout: 10_000 });
  // Moved again from the same corner, KEEP answers a tap.
  await page.locator(".pf-xy-btn").tap();
  await page.touchscreen.tap(f.x + f.width * corner[0], f.y + f.height * corner[1]);
  await expect(page.locator(".pf-moved")).toHaveClass(/\bon\b/);
  await page.locator(".pf-xy-btn").tap();
  await page.locator(".pf-moved .pf-keep").tap();
  await app.engine((timeout) => expect(page.locator("#toasts")).toContainText("Kept: this is home now.", { timeout }), { ms: 15_000 });
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
});

test("on a touch screen EVOLVE's corner and what each generation did answer a tap", async ({ page, app }) => {
  await boot(page, app);
  await app.level("evolve");
  await app.engine((timeout) => expect(page.locator("#name-a")).not.toHaveText("sound a", { timeout }), { ms: 90_000 });
  await page.locator("#flip-a").tap();
  await expect(page.locator("#mini-a")).toBeVisible();
  await page.locator("#flip-a").tap();
  await expect(page.locator("#face-a")).toBeVisible();
  await page.locator("#lineage-btn").tap();
  await expect(page.locator("#lineage-pop")).toBeVisible();
  await page.locator("#lineage-x").tap();
  await expect(page.locator("#lineage-pop")).toBeHidden();
});

// A finger held on PEEK: the pad's press and its release, as a touch screen
// sends them (CDP touch events), with a note sounding. B was heard, so PASS
// counts it as a pick for what you had.
test("on a touch screen PEEK held with a finger plays B", { tag: "@slow" }, async ({ page, app }) => {
  test.setTimeout(110_000); // about 41 to 50 s on CI: an offer grown
  await boot(page, app);
  await glassPad(page, app);
  const OFFER_MS = await app.offerBudget({ waits: 1 });
  await page.locator(".pf-pad", { hasText: /^Offer$/ }).tap();
  await expect(page.locator(".pf-offer")).toHaveClass(/\bready\b/, { timeout: OFFER_MS });
  const peek = await page.locator(".pf-pad", { hasText: "Peek" }).boundingBox();
  const at = { x: Math.round(peek.x + peek.width / 2), y: Math.round(peek.y + peek.height / 2) };
  const cdp = await page.context().newCDPSession(page);
  await page.keyboard.down("a");
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [at] });
  await page.waitForTimeout(HEARD_MS); // held: B must sound for a second while a note does
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.keyboard.up("a");
  await page.locator(".pf-pad.pf-pass").tap();
  await expect(page.locator("#toasts")).toContainText("Passed on B. That counts as a pick for what you had.");
});
