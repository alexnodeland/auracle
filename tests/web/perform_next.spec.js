// PERFORM: the second offer comes as fast as the first, and a pass says what
// it did and can be taken back.
//
// Offer used to hand over a spare grown in the background (0.01 s), but no
// spare was grown while B held an offer, so the natural rhythm — offer, hear
// it, pass, offer — paid a whole walk on demand the second time (10.9 s in
// the films). Pressing Offer with B full was also a hidden verdict: the pad
// said "Offer", the pass was recorded at once with no undo, and a B passed on
// unheard vanished without a word.
//
// Now a spare grows while B holds an offer, the pad reads NEXT with "passes on
// B" under it, a heard pass waits out a seven-second window with UNDO (B comes
// back and nothing is recorded), and an unheard pass says it was not counted.
//
// The worker's replies are read through the fixture's tap, to know when a
// spare has landed.
const { test, expect, PERFORM_SEED } = require("./fixtures");

/** Press the Offer/Next pad and return how long, in the page's own clock,
 *  until B holds an offer. */
async function pressOffer(page) {
  return page.evaluate(async () => {
    const pad = document.querySelector(".pf-pad.primary");
    const t0 = performance.now();
    pad.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 1 }));
    pad.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, pointerId: 1 }));
    for (;;) {
      if (document.querySelector(".pf-offer.ready")) return performance.now() - t0;
      if (performance.now() - t0 > 180_000) return Infinity;
      await new Promise((r) => setTimeout(r, 5));
    }
  });
}

// PEEK held long enough for B to be heard: a second of it while a note sounds.
const HEARD_MS = 1_800;

async function peek(page) {
  const b = await page.locator(".pf-pad", { hasText: "Peek" }).boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(HEARD_MS);
  await page.mouse.up();
  await page.mouse.move(10, 10);
}

// The offers the engine has handed the page: its own, not perform_budget.js's
// probes (ids from 8_800_000), which are not spares.
const spares = async (app) => (await app.replies("perform_offered")).filter((r) => r.req < 8_000_000 && r.offer && r.offer.tree).length;

test("the second offer is as fast as the first, and a pass says what it did and can be undone", { tag: "@slow" }, async ({ page, app }) => {
  test.setTimeout(210_000); // about 91 to 103 s on CI: two spares grown, and 17 s of pass windows watched
  await app.boot({ seed: PERFORM_SEED, random: PERFORM_SEED });
  await app.openOnPerform("Glass Pad");
  // Two spares waited for: each behind whatever the engine has queued (the
  // first behind the shipped wiring's re-check), then grown.
  const OFFER_MS = await app.offerBudget({ waits: 2 });
  const picks = async () => Number(await page.locator("#duel-count").textContent());
  await page.keyboard.down("a");

  // The first spare grows once the patch is steady and the hands are off.
  await expect.poll(() => spares(app), { timeout: OFFER_MS }).toBeGreaterThanOrEqual(1);
  const first = await pressOffer(page);
  expect(first, "the first offer is handed over").toBeLessThan(300);
  await expect(page.locator(".pf-pad.primary")).toHaveText("Next");
  const sub = await page.locator(".pf-pad.primary").evaluate((e) => getComputedStyle(e, "::after").content);
  expect(sub).toContain("passes on B");
  const bFirst = await page.locator(".pf-offer-body").textContent();

  // Heard, and a second spare grows while B holds the first.
  await peek(page);
  await expect.poll(() => spares(app), { timeout: OFFER_MS }).toBeGreaterThanOrEqual(2);
  const p0 = await picks();
  const second = await pressOffer(page);
  console.log(`offer → B: first ${first.toFixed(0)} ms, NEXT ${second.toFixed(0)} ms`);
  expect(second, "NEXT hands over the spare grown while B was full").toBeLessThan(300);
  const toast = page.locator(".toast", { hasText: "Passed on B. That counts as a pick for what you had." });
  await expect(toast).toBeVisible({ timeout: 5_000 });
  await expect(toast.locator(".toast-undo")).toHaveText("undo");

  // Undo: B is the offer passed on again, and the pass is never counted.
  await toast.locator(".toast-undo").click();
  await expect(page.locator(".pf-offer")).toHaveClass(/\bready\b/);
  await expect(page.locator(".pf-offer-body")).toHaveText(bFirst);
  // Watched past the pass's seven-second window.
  await app.quiet(9_000);
  expect(await picks(), "an undone pass is not recorded").toBe(p0);

  // A heard pass left alone counts once its window closes.
  await pressOffer(page);
  await expect(page.locator(".toast", { hasText: "Passed on B" })).toBeVisible({ timeout: 5_000 });
  await app.engine((timeout) => expect.poll(picks, { timeout }).toBe(p0 + 1), { ms: 30_000 });

  // An unheard B passed on says it was not counted, and can come back.
  const bUnheard = await page.locator(".pf-offer-body").textContent();
  await page.locator(".pf-pad", { hasText: "Next" }).click();
  const skipped = page.locator(".toast", { hasText: "Skipped B. Not counted, because you hadn’t heard it." });
  await expect(skipped).toBeVisible({ timeout: 5_000 });
  await skipped.locator(".toast-undo").click();
  await expect(page.locator(".pf-offer-body")).toHaveText(bUnheard, { timeout: 5_000 });
  // Watched past a pass's seven-second window.
  await app.quiet(8_000);
  expect(await picks(), "a skip teaches nothing").toBe(p0 + 1);
  await page.keyboard.up("a");
});
