// A patch from nothing (Plan-005 task 7): NEW PATCH empties the sound in hand
// to its amp envelope, a module comes out with an undo (a source leaving its
// socket empty), CLEAR empties it again with an undo, and BACK TO ‹name›
// returns to the sound it was started from. What is asserted is what the
// player sees: the rack's modules, the name and caption, and the toasts.
const { test, expect, openCatalog } = require("./fixtures");
const { openPreset } = require("./patch_page.js");

/** The rack's modules by kind, the amp and empty sockets included, sorted. */
const kinds = (page) =>
  page.evaluate(() => [...document.querySelectorAll("#rack-svg g.mod-group")].map((g) => g.getAttribute("data-kind")).sort());

/** A toast saying `re` has entered the lane (one at a time, so it may wait
 *  its turn behind another): an engine wait, as it follows the edit's reply. */
const toastSaid = (app, re) => app.engine((timeout) => app.toast(re, { timeout }), { ms: 30_000 });

/** Press the undo on the newest toast that offers one. */
async function undoToast(page) {
  const btn = page.locator("#toasts .toast button", { hasText: /undo|put it back/i }).last();
  await btn.click();
}

/** A module from the rail, placed at the socket it starts on (an empty
 *  socket first), or at the socket named. */
async function place(page, kind, childKey) {
  await openCatalog(page);
  await page.locator(`#nb-groups .nb-item[data-kind="${kind}"]`).click();
  if (childKey) await page.locator(`#rack-svg .jack[data-childkey="${childKey}"]`).click();
  else await page.keyboard.press("Enter");
}

test("a new patch starts empty, a module comes out with an undo, and the patch clears", async ({ page, app }) => {
  await app.boot();
  await openPreset(app, "Reese");
  const reese = await kinds(page);
  expect(reese.length).toBeGreaterThan(3);

  await page.locator("#patch-new-btn").click();
  await app.engine((timeout) => expect(page.locator("#rack-subject")).toHaveText("New patch", { timeout }), { ms: 30_000 });
  await expect(page.locator("#pt-family")).toHaveText("· from nothing");
  await expect(page.locator("#rack-meta")).toHaveText(/^0 modules · nothing to hear yet/);
  await expect.poll(() => kinds(page)).toEqual(["amp", "silence"]);
  await expect(page.locator("#patch-clear")).toBeDisabled();
  await expect(page.locator("#patch-back")).toContainText("back to Reese");

  // Build: a vco in the empty socket, a filter at the output.
  await place(page, "vco");
  await app.engine((timeout) => expect.poll(() => kinds(page), { timeout }).toEqual(["amp", "vco"]), { ms: 30_000 });
  await place(page, "filter", "node");
  await app.engine((timeout) => expect.poll(() => kinds(page), { timeout }).toEqual(["amp", "filter", "vco"]), { ms: 30_000 });
  await expect(page.locator("#rack-meta")).toHaveText(/^2 modules/);

  // The filter out, and back with the toast's undo.
  await page.locator('#rack-svg g.mod-group[data-kind="filter"] .mod-menu-btn').click();
  await page.getByRole("menuitem", { name: /^delete one module/ }).click();
  await toastSaid(app, /Filter deleted and set aside below\./);
  await app.engine((timeout) => expect.poll(() => kinds(page), { timeout }).toEqual(["amp", "vco"]), { ms: 30_000 });
  await undoToast(page);
  await app.engine((timeout) => expect.poll(() => kinds(page), { timeout }).toEqual(["amp", "filter", "vco"]), { ms: 30_000 });

  // The source out: its socket is left empty, and the patch says nothing to hear.
  await page.locator('#rack-svg g.mod-group[data-kind="vco"] .mod-menu-btn').click();
  await page.getByRole("menuitem", { name: /^delete the socket it leaves is empty/ }).click();
  await toastSaid(app, /Vco deleted and set aside below\. Its socket is empty\./);
  await app.engine((timeout) => expect.poll(() => kinds(page), { timeout }).toEqual(["amp", "filter", "silence"]), { ms: 30_000 });
  await expect(page.locator("#rack-meta")).toHaveText(/1 module · nothing to hear yet/);

  // CLEAR, then its undo.
  await page.locator("#patch-clear").click();
  await toastSaid(app, /Cleared the patch\./);
  await app.engine((timeout) => expect.poll(() => kinds(page), { timeout }).toEqual(["amp", "silence"]), { ms: 30_000 });
  await undoToast(page);
  await app.engine((timeout) => expect.poll(() => kinds(page), { timeout }).toEqual(["amp", "filter", "silence"]), { ms: 30_000 });

  // Back to Reese, and the new patch waits under NEW PATCH.
  await page.locator("#patch-back").click();
  await app.engine((timeout) => expect(page.locator("#rack-subject")).toHaveText("Reese", { timeout }), { ms: 60_000 });
  await expect.poll(() => kinds(page)).toEqual(reese);
  await page.locator("#patch-new-btn").click();
  await toastSaid(app, /Back to your new patch\./);
  await app.engine((timeout) => expect.poll(() => kinds(page), { timeout }).toEqual(["amp", "filter", "silence"]), { ms: 30_000 });

  // ⌘Z past its start ends it: the sound it was started from is back.
  await page.locator("#rack-svg").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("ControlOrMeta+z");
  await app.engine((timeout) => expect(page.locator("#rack-subject")).toContainText("Reese", { timeout }), { ms: 30_000 });
  await expect(page.locator("#patch-new-btn")).toBeVisible();
});

test("Esc on a plate button in a new patch backs out to its plate and keeps the new patch", async ({ page, app }) => {
  await app.boot();
  await openPreset(app, "Reese");
  await page.locator("#patch-new-btn").click();
  await app.engine((timeout) => expect(page.locator("#rack-subject")).toHaveText("New patch", { timeout }), { ms: 30_000 });
  // The name changes before the new patch's rack is drawn: the module is
  // placed on the new rack, as the first test waits for it.
  await expect.poll(() => kinds(page)).toEqual(["amp", "silence"]);
  await place(page, "capture");
  await app.engine((timeout) => expect.poll(() => kinds(page), { timeout }).toContain("capture"), { ms: 30_000 });
  // The keyboard on CAPTURE's RECORD (a plate button, on the rack's walk),
  // then Esc: it backs out to the plate, as it does from a knob, and the new
  // patch stays (Esc ends a new patch only when nothing else wants it).
  const rec = page.locator('#rack-svg [data-stop="take-rec"]');
  await app.engine((timeout) => expect(rec).toBeVisible({ timeout }), { ms: 30_000 });
  await rec.focus();
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => document.activeElement?.getAttribute("data-kind"))).toBe("capture");
  await app.quiet();
  await expect(page.locator("#rack-subject")).toHaveText("New patch");
  expect(await kinds(page)).toContain("capture");
});
