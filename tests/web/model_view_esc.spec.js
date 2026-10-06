// Esc and the model view, at every level (#153): Esc closes the nearest
// thing first, and that press is spent; a tapped model view ends on the
// press that has nothing nearer left to close (shell.js takes Esc last, and
// leaves it when a closer said it used it: `preventDefault`). PATCH's chain
// is model_view.spec.js's; here, the closers outside it that once let the
// same press end the view too: PERFORM's well modes (XY, How it works), the
// ? card, the scope panel, the picture panel and TASTE's selected point; and
// with two open (KEYS ⋯ or a bank row's ★ over PERFORM's XY), a press closes
// the nearer only. And XY goes from an axis's drop-down too, where the focus
// stays after a choice.
const { test, expect, modelView, openKeys, bankTab } = require("./fixtures");

test("Esc closes what is nearer before it ends a tapped model view, at every level", async ({ page, app }) => {
  await app.boot();
  await modelView(page, true);
  const body = page.locator("body");
  /** Esc, and the view still up once `closed` says the nearer thing went. */
  const escCloses = async (closed, what) => {
    await page.keyboard.press("Escape");
    await closed();
    await expect(body, `Esc on ${what} left the model view up`).toHaveClass(/\bmodel-view\b/);
  };

  // PERFORM's well: XY, then How it works, each put away by Esc while PERFORM
  // shows (a press on HOW IT WORKS leaves the focus nowhere).
  await app.level("perform");
  const well = page.locator(".pf-well");
  await page.locator(".pf-xy-btn").click();
  await expect(well).toHaveAttribute("data-mode", "xy");
  // KEYS ⋯ open over it is nearer: that press closes it and only it.
  await openKeys(page);
  await escCloses(() => expect(page.locator("#keys-pop")).toBeHidden(), "KEYS ⋯");
  await expect(well).toHaveAttribute("data-mode", "xy");
  await escCloses(() => expect(well).toHaveAttribute("data-mode", "face"), "PERFORM's XY");
  // With the focus left on an axis's drop-down (an axis chosen, or moved
  // with the arrow keys), Esc puts the face back all the same: a closed
  // drop-down has no Esc of its own. (The view stays up for this press
  // whatever the well does: the face is what this step reads.)
  await page.locator(".pf-xy-btn").click();
  await expect(well).toHaveAttribute("data-mode", "xy");
  const axis = page.locator(".pf-xy-head select").first();
  await axis.focus();
  await page.keyboard.press("Escape");
  await expect(well, "Esc on an axis's drop-down put the face back").toHaveAttribute("data-mode", "face");
  // A bank row's ★ folded out over XY is nearer: that press folds it, and XY
  // stays for the next.
  await bankTab(page, "pool");
  await page.locator(".pf-xy-btn").click();
  await expect(well).toHaveAttribute("data-mode", "xy");
  const row = page.locator("#bank-list .bank-item[data-id]").first();
  await row.hover();
  await row.locator(".bi-star").click();
  await expect(row).toHaveClass(/\brating\b/);
  await escCloses(() => expect(row).not.toHaveClass(/\brating\b/), "a bank row's ★");
  await expect(well, "the press that folded the ★ left XY up").toHaveAttribute("data-mode", "xy");
  await escCloses(() => expect(well).toHaveAttribute("data-mode", "face"), "PERFORM's XY, after the ★");
  await page.locator(".pf-why-btn").click();
  await expect(well).toHaveAttribute("data-mode", "how");
  await escCloses(() => expect(well).toHaveAttribute("data-mode", "face"), "How it works");

  // The ? card, where ? asks for it (nothing askable in reach).
  await app.level("evolve");
  await page.keyboard.press("?");
  await expect(page.locator("#help")).toBeVisible();
  await escCloses(() => expect(page.locator("#help")).toBeHidden(), "the ? card");

  // The scope panel and the picture panel, from ⋯.
  for (const [item, panel] of [["#scope-btn", "#scope-panel"], ["#image-btn", "#image-panel"]]) {
    await page.locator("#ovf-btn").click();
    await page.locator(item).click();
    await expect(page.locator(panel)).toBeVisible();
    await escCloses(() => expect(page.locator(panel)).toBeHidden(), panel);
  }

  // TASTE: a point selected from the keyboard.
  await app.level("taste");
  await page.locator("#taste-crt").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#taste-plate")).toHaveClass(/\bon\b/);
  await escCloses(() => expect(page.locator("#taste-plate")).not.toHaveClass(/\bon\b/), "TASTE's selected point");

  // Nothing nearer left: this press ends the view.
  await page.keyboard.press("Escape");
  await expect(body).not.toHaveClass(/\bmodel-view\b/);
  await expect(page.locator("#model-btn")).toHaveAttribute("aria-pressed", "false");
});
