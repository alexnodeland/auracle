// A patch from nothing (Plan-005 task 7): NEW PATCH empties the sound in hand
// to its amp envelope, a module comes out with an undo (a source leaving its
// socket empty), CLEAR empties it again with an undo, and BACK TO ‹name›
// returns to the sound it was started from. What is asserted is what the
// player sees: the rack's modules, the name and caption, and the toasts.
const { test, expect } = require("@playwright/test");
const { boot, openPreset } = require("./patch_page.js");

/** The rack's modules by kind, the amp and empty sockets included, sorted. */
const kinds = (page) =>
  page.evaluate(() => [...document.querySelectorAll("#rack-svg g.mod-group")].map((g) => g.getAttribute("data-kind")).sort());

const toastSaid = (page, re) =>
  expect.poll(() => page.evaluate(() => window.__pwToasts.join("\n")), { timeout: 30_000 }).toMatch(re);

/** Press the undo on the newest toast that offers one. */
async function undoToast(page) {
  const btn = page.locator("#toasts .toast button", { hasText: /undo|put it back/i }).last();
  await btn.click();
}

/** A module from the rail, placed at the socket it starts on (an empty
 *  socket first), or at the socket named. */
async function place(page, kind, childKey) {
  await page.locator(`#nb-groups .nb-item[data-kind="${kind}"]`).click();
  if (childKey) await page.locator(`#rack-svg .jack[data-childkey="${childKey}"]`).click();
  else await page.keyboard.press("Enter");
}

test("a new patch starts empty, a module comes out with an undo, and the patch clears", async ({ page }) => {
  test.setTimeout(300_000);
  const errors = await boot(page, { warmed: true });
  await openPreset(page, "Reese");
  const reese = await kinds(page);
  expect(reese.length).toBeGreaterThan(3);

  await page.locator("#patch-new-btn").click();
  await expect(page.locator("#rack-subject")).toHaveText("New patch", { timeout: 30_000 });
  await expect(page.locator("#pt-family")).toHaveText("· from nothing");
  await expect(page.locator("#rack-meta")).toHaveText(/^0 modules · nothing to hear yet/);
  await expect.poll(() => kinds(page)).toEqual(["amp", "silence"]);
  await expect(page.locator("#patch-clear")).toBeDisabled();
  await expect(page.locator("#patch-back")).toContainText("back to Reese");

  // Build: a vco in the empty socket, a filter at the output.
  await place(page, "vco");
  await expect.poll(() => kinds(page), { timeout: 30_000 }).toEqual(["amp", "vco"]);
  await place(page, "filter", "node");
  await expect.poll(() => kinds(page), { timeout: 30_000 }).toEqual(["amp", "filter", "vco"]);
  await expect(page.locator("#rack-meta")).toHaveText(/^2 modules/);

  // The filter out, and back with the toast's undo.
  await page.locator('#rack-svg g.mod-group[data-kind="filter"] .mod-menu-btn').click();
  await page.getByRole("menuitem", { name: /^delete one module/ }).click();
  await toastSaid(page, /Filter deleted and set aside below\./);
  await expect.poll(() => kinds(page), { timeout: 30_000 }).toEqual(["amp", "vco"]);
  await undoToast(page);
  await expect.poll(() => kinds(page), { timeout: 30_000 }).toEqual(["amp", "filter", "vco"]);

  // The source out: its socket is left empty, and the patch says nothing to hear.
  await page.locator('#rack-svg g.mod-group[data-kind="vco"] .mod-menu-btn').click();
  await page.getByRole("menuitem", { name: /^delete the socket it leaves is empty/ }).click();
  await toastSaid(page, /Vco deleted and set aside below\. Its socket is empty\./);
  await expect.poll(() => kinds(page), { timeout: 30_000 }).toEqual(["amp", "filter", "silence"]);
  await expect(page.locator("#rack-meta")).toHaveText(/1 module · nothing to hear yet/);

  // CLEAR, then its undo.
  await page.locator("#patch-clear").click();
  await toastSaid(page, /Cleared the patch\./);
  await expect.poll(() => kinds(page), { timeout: 30_000 }).toEqual(["amp", "silence"]);
  await undoToast(page);
  await expect.poll(() => kinds(page), { timeout: 30_000 }).toEqual(["amp", "filter", "silence"]);

  // Back to Reese, and the new patch waits under NEW PATCH.
  await page.locator("#patch-back").click();
  await expect(page.locator("#rack-subject")).toHaveText("Reese", { timeout: 60_000 });
  await expect.poll(() => kinds(page)).toEqual(reese);
  await page.locator("#patch-new-btn").click();
  await toastSaid(page, /Back to your new patch\./);
  await expect.poll(() => kinds(page), { timeout: 30_000 }).toEqual(["amp", "filter", "silence"]);

  // ⌘Z past its start ends it: the sound it was started from is back.
  await page.locator("#rack-svg").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator("#rack-subject")).toContainText("Reese", { timeout: 30_000 });
  await expect(page.locator("#patch-new-btn")).toBeVisible();
  expect(errors, errors.join("\n")).toEqual([]);
});

test("Esc on a plate button in a new patch backs out to its plate and keeps the new patch", async ({ page }) => {
  test.setTimeout(300_000);
  const errors = await boot(page, { warmed: true });
  await openPreset(page, "Reese");
  await page.locator("#patch-new-btn").click();
  await expect(page.locator("#rack-subject")).toHaveText("New patch", { timeout: 30_000 });
  // The name changes before the new patch's rack is drawn: the module is
  // placed on the new rack, as the first test waits for it.
  await expect.poll(() => kinds(page)).toEqual(["amp", "silence"]);
  await place(page, "capture");
  await expect.poll(() => kinds(page), { timeout: 30_000 }).toContain("capture");
  // The keyboard on CAPTURE's RECORD (a plate button, on the rack's walk),
  // then Esc: it backs out to the plate, as it does from a knob, and the new
  // patch stays (Esc ends a new patch only when nothing else wants it).
  const rec = page.locator('#rack-svg [data-stop="take-rec"]');
  await expect(rec).toBeVisible({ timeout: 30_000 });
  await rec.focus();
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => document.activeElement?.getAttribute("data-kind"))).toBe("capture");
  await page.waitForTimeout(500);
  await expect(page.locator("#rack-subject")).toHaveText("New patch");
  expect(await kinds(page)).toContain("capture");
  expect(errors, errors.join("\n")).toEqual([]);
});
