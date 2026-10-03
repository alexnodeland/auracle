// PATCH rebuilt as the mock's canvas (Plan-008 C2a): the head, the face at
// OUT, the edit bar, the structure menu on the selected module, the locks and
// ⚡'s ▾.
//
// What this claims:
//
// - The head names the patch at the display size under PATCH · FAMILY (a
//   preset's category), and its subtitle is the rack's own count: modules in
//   the audio path (not the amp, not an empty socket) and modulators, "in
//   signal order" for the chain.
// - The face at OUT is the bench's face (the menu bar's chip shows the same
//   one), stands past the amp, and a click on it plays the sound.
// - The edit bar shows only once the bench is edited, counts the undo steps
//   since the open, and KEEP AS NEW keeps the edit as a new sound; "undo to
//   as opened" takes every change back in one restore, and ⇧⌘Z brings them
//   back one at a time.
// - The selected module shows its ⋯ (the structure menu), which reaches
//   every verb; the others show theirs only under the pointer.
// - L on the selected module locks it and its edge goes solid amber; ⚡'s ▾
//   holds lock knobs, lock wiring and clear locks.
const { test, expect } = require("@playwright/test");
const { boot, openPreset, now, replied } = require("./patch_page");

/** The rack's counts, as the head should say them. */
const counts = (page) => page.evaluate(() => {
  let a = 0;
  let c = 0;
  for (const m of window.__aur.wb.rack.modules) {
    if (m.kind === "amp" || m.kind === "silence") continue;
    if (m.is_mod) c += 1;
    else a += 1;
  }
  return { a, c };
});
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** Drag the `i`th continuous knob up by `dy` px, and wait for its reply. */
async function turnKnob(page, i = 0, dy = 30) {
  const hit = page.locator("#rack-svg g[data-addr] > .knob-hit").nth(i);
  const b = await hit.boundingBox();
  const t0 = await now(page);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 - dy, { steps: 5 });
  await page.mouse.up();
  await replied(page, "bench", t0);
}

/** A press on a module's bare panel (its title's corner), which selects it. */
async function selectPlate(page, kind) {
  const plate = page.locator(`#rack-svg .rack-plates g[data-kind="${kind}"] .mod-plate`).first();
  const b = await plate.boundingBox();
  await page.mouse.click(b.x + 10, b.y + b.height - 6);
}

test("the head names the patch and counts what the rack is made of, in signal order", async ({ page }) => {
  const errors = await boot(page, { warmed: true });
  await openPreset(page, "Reese");
  await expect(page.locator("#rack-subject")).toHaveText("Reese");
  await expect(page.locator("#pt-family")).toHaveText("· bass");
  const { a, c } = await counts(page);
  await expect(page.locator("#rack-meta")).toHaveText(
    new RegExp(`^${plural(a, "module")} · ${c ? plural(c, "modulator") : "no modulators"}, in signal order`));
  // The edit bar keeps its place at rest, and says nothing.
  await expect(page.locator("#pt-editbar")).toBeHidden();
  expect(errors).toEqual([]);
});

test("the face at OUT is the bench's face, past the amp, and a click on it plays the sound", async ({ page }) => {
  const errors = await boot(page, { warmed: true });
  await openPreset(page, "Glass Pad");
  const face = page.locator("#out-face img.face");
  await expect(face).toHaveCount(1, { timeout: 60_000 });
  // The bench's face: its target is the bench's tree (main.js `treeRef`,
  // FNV-1a over the tree's text), never an estimate drawn from its knobs.
  await expect.poll(() => page.evaluate(() => {
    const json = window.__pwLast.bench && window.__pwLast.bench.treeJson;
    if (!json) return null;
    let h = 0x811c9dc5;
    for (let i = 0; i < json.length; i++) h = Math.imul(h ^ json.charCodeAt(i), 0x01000193);
    const ref = `r${(h >>> 0).toString(36)}${json.length.toString(36)}`;
    return document.getElementById("out-face").dataset.face === ref;
  }), { timeout: 30_000 }).toBe(true);
  // Past the amp, on its right.
  const amp = await page.locator('#rack-svg .rack-plates g[data-kind="amp"] .mod-plate').boundingBox();
  const play = page.locator("#rack-play");
  const at = await play.boundingBox();
  expect(at.x).toBeGreaterThan(amp.x + amp.width);
  await expect(play).toBeEnabled();
  await play.click();
  await expect(play).toHaveClass(/\bplaying\b/, { timeout: 30_000 });
  await expect(page.locator("#inhand-play")).toHaveClass(/\bplaying\b/);
  expect(errors).toEqual([]);
});

test("the edit bar appears after an edit, counts it, and KEEP AS NEW keeps it as a new sound", async ({ page }) => {
  test.setTimeout(240_000);
  const errors = await boot(page, { warmed: true });
  await openPreset(page, "Glass Pad");
  const bar = page.locator("#pt-editbar");
  await expect(bar).toBeHidden();
  await turnKnob(page, 0);
  await expect(bar).toBeVisible();
  await expect(page.locator("#pt-ed-n")).toHaveText("1 change");
  await page.locator("#improve-check").check();
  const t0 = await now(page);
  await page.locator("#rack-commit").click();
  await replied(page, "committed", t0);
  expect(await page.evaluate(() => window.__pwLast.committed.outcome)).toBe("self_edited");
  // A new sound, as it was made: nothing edited, so no bar.
  await expect(bar).toBeHidden({ timeout: 30_000 });
  expect(errors).toEqual([]);
});

test("undo to as opened takes every change back in one restore, and ⇧⌘Z brings them back one at a time", async ({ page }) => {
  test.setTimeout(240_000);
  const errors = await boot(page, { warmed: true });
  await openPreset(page, "Glass Pad");
  const opened = await page.evaluate(() => window.__pwLast.bench.treeJson);
  await turnKnob(page, 0);
  await turnKnob(page, 1);
  await expect(page.locator("#pt-ed-n")).toHaveText("2 changes");
  const sets = () => page.evaluate(() => window.__pwPosted.filter((p) => p.type === "edit_set_tree").length);
  const before = await sets();
  const t0 = await now(page);
  await page.locator("#pt-revert").click();
  await replied(page, "bench", t0);
  // One restore, to the tree as it was opened.
  expect(await sets()).toBe(before + 1);
  await expect.poll(() => page.evaluate(() => window.__pwLast.bench.treeJson)).toBe(opened);
  await expect(page.locator("#pt-ed-n")).toHaveText("as opened");
  // ⇧⌘Z: the first change again.
  const t1 = await now(page);
  await page.keyboard.press("Shift+Control+z");
  await replied(page, "bench", t1);
  await expect(page.locator("#pt-ed-n")).toHaveText("1 change");
  expect(errors).toEqual([]);
});

test("the selected module shows its ⋯, which reaches every verb of the structure menu", async ({ page }) => {
  const errors = await boot(page, { warmed: true });
  await openPreset(page, "Reese");
  // At rest no ⋯ shows; the selected module's does.
  const menu = (kind) => page.locator(`#rack-svg .rack-controls g[data-kind="${kind}"] .mod-menu-btn`).first();
  await page.mouse.move(5, 5);
  await expect(menu("mix")).toHaveCSS("opacity", "0");
  await selectPlate(page, "mix");
  await page.mouse.move(5, 5);
  await expect(page.locator('#rack-svg .rack-controls g.mod-group[data-kind="mix"]')).toHaveClass(/\bselected\b/);
  await expect(menu("mix")).toHaveCSS("opacity", "1");
  await expect(menu("filter")).toHaveCSS("opacity", "0");
  // The readout names it.
  await expect(page.locator("#pt-read .pr-name")).toHaveText(/mix/i);
  await menu("mix").click();
  const items = page.locator("#ctx-menu .cm-item");
  for (const verb of ["replace with", "insert before", "insert after", "duplicate", "set aside", "bypass", "probe this output", "swap the two inputs", "delete"]) {
    await expect(items.filter({ hasText: new RegExp(`^${verb}`) }), verb).toHaveCount(1);
  }
  await page.keyboard.press("Escape");
  // A modulator's own: replace it, or unplug it.
  await menu("lfo").click({ force: true });
  await expect(items.filter({ hasText: /^unplug this modulator/ })).toHaveCount(1);
  await page.keyboard.press("Escape");
  // modulate → is on a module with a mod slot.
  await menu("filter").click({ force: true });
  await expect(items.filter({ hasText: /^modulate →/ })).toHaveCount(1);
  await page.keyboard.press("Escape");
  expect(errors).toEqual([]);
});

test("L locks the selected module, its edge goes solid amber, and ⚡'s ▾ clears it", async ({ page }) => {
  const errors = await boot(page, { warmed: true });
  await openPreset(page, "Reese");
  const plate = page.locator('#rack-svg .rack-controls g.mod-group[data-kind="filter"]');
  await plate.focus();
  await page.keyboard.press("l");
  const edge = page.locator('#rack-svg .rack-plates g[data-kind="filter"] .mod-plate');
  await expect(edge).toHaveClass(/\blocked\b/);
  await expect(edge).toHaveCSS("stroke-dasharray", "none");
  await expect(page.locator("#rack-meta")).toContainText("locked");
  // L is a lock here, not a note.
  await expect(page.locator('.pkey[data-note="74"]')).not.toHaveClass(/\bdown\b/);
  // ⚡'s ▾: lock knobs, lock wiring, clear locks.
  await page.locator("#pt-evolve-more").click();
  const evmenu = page.locator("#pt-evmenu");
  await expect(evmenu).toBeVisible();
  for (const id of ["#lock-knobs", "#lock-structure", "#lock-clear"]) await expect(evmenu.locator(id)).toBeVisible();
  await evmenu.locator("#lock-clear").click();
  await expect(evmenu).toBeHidden();
  await expect(edge).not.toHaveClass(/\blocked\b/);
  // Lock knobs locks every knob; the subtitle counts them.
  await page.locator("#pt-evolve-more").click();
  await evmenu.locator("#lock-knobs").click();
  await expect(page.locator("#rack-meta")).toContainText(/\d+ locked/);
  await page.locator("#pt-evolve-more").click();
  await evmenu.locator("#lock-clear").click();
  await expect(page.locator("#rack-meta")).not.toContainText("locked");
  expect(errors).toEqual([]);
});
