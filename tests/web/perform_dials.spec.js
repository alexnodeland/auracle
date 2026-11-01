// PERFORM's dials and the pads beside them (#532, #523).
//
// - A dial or the XY pad pressed with the mouse takes the focus with no
//   ring, once a key has been pressed too (any key in Chromium, Tab in
//   Firefox, made focus a script gives count as the keyboard's: the ring
//   came up under the mouse). A dial reached with Tab still shows it, and
//   its arrows still turn it.
const { test, expect, goLevel, PERFORM_SEED } = require("./fixtures");

test("a dial or the XY pad pressed with the mouse shows no focus ring, and a dial reached with Tab shows one", async ({ page, app }) => {
  await app.boot({ seed: PERFORM_SEED, random: PERFORM_SEED });
  await goLevel(page, "perform");
  await app.reached();
  const dial = page.locator('.pf-knob[data-i="0"]');
  // A key first: after one, focus a script gives counts as the keyboard's
  // (Tab in Firefox, any key in Chromium), and that drew the ring.
  await page.keyboard.press("Tab");
  const b = await dial.boundingBox();
  const x = b.x + b.width / 2;
  const y = b.y + b.height / 3;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 30, { steps: 5 });
  // Held: the dial has the keys, and no ring.
  await expect(dial).toBeFocused();
  await expect(dial).toHaveCSS("outline-style", "none");
  await page.mouse.up();
  // Let go: a pointer's turn leaves no focus (↵ is KEEP).
  await expect(dial).not.toBeFocused();
  await expect(dial).toHaveCSS("outline-style", "none");

  // The XY pad, the same: pressed after a key, it keeps the focus (its
  // arrows), with no ring.
  await page.locator(".pf-xy-btn").click();
  const field = page.locator(".pf-xy-field");
  await expect(field).toBeVisible();
  await page.keyboard.press("Tab");
  const f = await field.boundingBox();
  await page.mouse.move(f.x + f.width * 0.3, f.y + f.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(f.x + f.width * 0.6, f.y + f.height * 0.4, { steps: 5 });
  await expect(field).toBeFocused();
  await expect(field).toHaveCSS("outline-style", "none");
  await page.mouse.up();
  await expect(field).toHaveCSS("outline-style", "none");
  await page.locator(".pf-xy-btn").click();
  await expect(field).toBeHidden();

  // Reached with the keyboard (Shift+Tab back from the next dial), the ring
  // shows, and the arrows turn it.
  await page.locator('.pf-knob[data-i="1"]').focus();
  await page.keyboard.press("Shift+Tab");
  await expect(dial).toBeFocused();
  await expect(dial).toHaveCSS("outline-style", "solid");
  const before = await dial.getAttribute("aria-valuetext");
  await page.keyboard.press("ArrowUp");
  await expect(dial).not.toHaveAttribute("aria-valuetext", before);
  await expect(dial).toHaveCSS("outline-style", "solid");
});
