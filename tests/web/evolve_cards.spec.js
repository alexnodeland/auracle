// EVOLVE's cards to the specimen (Plan-008 PR C1, `z-desk-evolve.png`).
//
// - Each card's well holds its sound's face, large (the scope's waveform it
//   replaces), with ⇄ circuit and ↓ patch in its corner: the circuit swaps
//   the face for the patch, and ↓ patch opens the sound in PATCH.
// - The buttons are relabelled (PLAY · 1, PICK A · ←, ANOTHER PAIR · N) and
//   keep their ids; the head asks the question, with a small TASTE map that
//   goes to TASTE.
// - What each generation did is a disclosure under EVOLVE POOL, opened over
//   the foot of the cards, and Esc folds it.
// - EVOLVE POOL is dashed until the model has learned from your picks.
const { test, expect, goLevel } = require("./fixtures");

async function boot(page, app) {
  await app.boot();
  await goLevel(page, "evolve");
  await app.engine((timeout) => expect(page.locator("#name-a")).not.toHaveText("sound a", { timeout }), { ms: 90_000 });
}

test("each card's well holds its sound's face, with ⇄ circuit and ↓ patch in its corner", async ({ page, app }) => {
  await boot(page, app);
  const face = page.locator("#face-a.face-slot.face-evolve img.face");
  await app.engine((timeout) => expect(face).toHaveCount(1, { timeout }), { ms: 60_000 });
  await app.engine((timeout) => expect(page.locator("#face-b.face-slot.face-evolve img.face")).toHaveCount(1, { timeout }), { ms: 60_000 });
  // Large: it fills the card's well, as the waveform did.
  const well = await page.locator("#duel-a .duel-well").boundingBox();
  const fb = await face.boundingBox();
  expect(fb.height).toBeGreaterThan(well.height * 0.6);
  // Its corner: the circuit and open in PATCH.
  const corner = page.locator("#duel-a .duel-corner");
  await expect(corner.locator("#flip-a")).toHaveText("⇄ circuit");
  await expect(corner.locator("#promote-a")).toHaveText("↓ patch");
  // ⇄ circuit swaps the face for the patch, and back.
  await page.locator("#flip-a").click();
  await expect(page.locator("#mini-a")).toBeVisible();
  await expect(page.locator("#face-a")).toBeHidden();
  await expect(page.locator("#flip-a")).toHaveText("⇄ face");
  await page.locator("#flip-a").click();
  await expect(page.locator("#face-a")).toBeVisible();
  await expect(page.locator("#mini-a")).toBeHidden();
  // ↓ patch opens the sound in PATCH.
  const name = (await page.locator("#name-a").evaluate((e) => e.firstChild.textContent)).trim();
  await page.locator("#promote-a").click();
  await expect(page.locator('.rail-stop[data-level="patch"]')).toHaveAttribute("aria-current", "location");
  await app.engine((timeout) => expect(page.locator("#rack-subject")).toContainText(name, { timeout }), { ms: 60_000 });
});

test("the buttons keep their ids under the specimen's words, and the small map goes to TASTE", async ({ page, app }) => {
  await boot(page, app);
  await expect(page.locator("#view-evolve .ev-title")).toHaveText("Pick the one you’d reach for.");
  await expect(page.locator("#play-a")).toHaveText(/^▶ play\s*1$/);
  await expect(page.locator("#play-b")).toHaveText(/^▶ play\s*2$/);
  await expect(page.locator("#choose-a")).toHaveText(/^pick a\s*←$/);
  await expect(page.locator("#choose-b")).toHaveText(/^pick b\s*→$/);
  await expect(page.locator("#skip-duel")).toHaveText(/^another pair\s*N$/);
  await expect(page.locator("#evolve-btn")).toHaveText("evolve pool");
  await expect(page.locator("#teach-pips i")).toHaveCount(6);
  // No picks have taught it yet: EVOLVE POOL is dashed, and still pressable.
  await expect(page.locator("#evolve-btn")).toHaveClass(/\buntaught\b/);
  await expect(page.locator("#evolve-btn")).toBeEnabled();
  // The small map is TASTE's, and goes there.
  await page.locator("#ev-map").click();
  await expect(page.locator('.rail-stop[data-level="taste"]')).toHaveAttribute("aria-current", "location");
});

test("what each generation did opens over the foot of the cards, and Esc folds it", async ({ page, app }) => {
  await boot(page, app);
  const btn = page.locator("#lineage-btn");
  const pop = page.locator("#lineage-pop");
  await expect(pop).toBeHidden();
  await expect(btn).toHaveAttribute("aria-expanded", "false");
  await btn.click();
  await expect(pop).toBeVisible();
  await expect(btn).toHaveAttribute("aria-expanded", "true");
  await expect(pop.locator("#lineage-log")).toContainText("No generations yet");
  // Over the foot of the cards: it overlaps the cards' bottom edge.
  const card = await page.locator("#duel-a").boundingBox();
  const p = await pop.boundingBox();
  expect(p.y).toBeLessThan(card.y + card.height);
  expect(p.y + p.height).toBeGreaterThan(card.y + card.height * 0.5);
  await page.keyboard.press("Escape");
  await expect(pop).toBeHidden();
  await expect(btn).toHaveAttribute("aria-expanded", "false");
  expect(await page.evaluate(() => document.activeElement?.id)).toBe("lineage-btn");
});
