// PATCH's keys, the mock's (Plan-008 C2a, round 2's keys decision).
//
// What this claims:
//
// - On a module, ←/→ walk the modules in signal order (left to right as the
//   layout draws them), ↑/↓ go into a module's modulator and back out, and
//   Home/End reach the first module and the last (the amp, at OUT), from a
//   module or with nothing in focus.
// - Enter goes into a module's knobs, ↑/↓ turn one, Esc goes back to the
//   module, and Esc again leaves it; ⇧Home fits the whole patch.
// - F2 opens the structure menu, and Delete on a two-input module asks which
//   input survives.
// - Esc walks out one thing at a time: the module, then the catalog, then a
//   new patch.
// - With a module in hand the arrows choose a socket and Enter places it.
// - The keys yield to a text field (the catalog's search), and the note keys
//   still play on a module.
// - Home and End are the canvas's: on VOL they are the slider's, and under
//   the keep-as-new comparison nothing behind it moves.
// - One Esc closes one thing: an open menu goes, and the selection and the
//   catalog wait for the next press.
// - The selection follows the module, not its address: an insert before it
//   moves its key, and it stays selected.
const { test, expect } = require("@playwright/test");
const { boot, openPreset, now, replied } = require("./patch_page");
const { openCatalog } = require("./shell");

const active = (page) => page.evaluate(() => {
  const a = document.activeElement;
  const g = a?.closest?.("g[data-key]");
  return { key: g?.getAttribute("data-key") || null, kind: g?.getAttribute("data-kind") || null, addr: a?.getAttribute?.("data-addr") || null, plate: !!a?.matches?.("g.mod-group") };
});
/** The modules' keys in signal order: by the plates' left edges, then tops. */
const signalOrder = (page) => page.evaluate(() =>
  [...document.querySelectorAll("#rack-svg .rack-plates g[data-key]")]
    .map((g) => ({ key: g.getAttribute("data-key"), r: g.getBoundingClientRect() }))
    .sort((a, b) => a.r.left - b.r.left || a.r.top - b.r.top)
    .map((x) => x.key));

test("←/→ walk the modules in signal order, ↑/↓ go into a modulator and back, and Home/End reach the ends", async ({ page }) => {
  const errors = await boot(page, { warmed: true });
  await openPreset(page, "Reese");
  const order = await signalOrder(page);
  // Home, with nothing in focus: the first module.
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press("Home");
  expect((await active(page)).key).toBe(order[0]);
  for (let i = 1; i < order.length; i++) {
    await page.keyboard.press("ArrowRight");
    expect((await active(page)).key, `step ${i}`).toBe(order[i]);
  }
  // The last is the amp, at OUT.
  expect((await active(page)).kind).toBe("amp");
  await page.keyboard.press("Home");
  expect((await active(page)).key).toBe(order[0]);
  await page.keyboard.press("End");
  expect((await active(page)).kind).toBe("amp");
  // ↓ from the filter is its LFO, ↑ is back out of it.
  await page.locator('#rack-svg .rack-controls g.mod-group[data-kind="filter"]').focus();
  await page.keyboard.press("ArrowDown");
  expect((await active(page)).kind).toBe("lfo");
  await page.keyboard.press("ArrowUp");
  expect((await active(page)).kind).not.toBe("lfo");
  expect(errors).toEqual([]);
});

test("Enter goes into a module's knobs, ↑/↓ turn one, Esc backs out, and ⇧Home fits the patch", async ({ page }) => {
  const errors = await boot(page, { warmed: true });
  await openPreset(page, "Reese");
  const plate = page.locator('#rack-svg .rack-controls g.mod-group[data-kind="filter"]');
  await plate.focus();
  await page.keyboard.press("Enter");
  const into = await active(page);
  expect(into.kind).toBe("filter");
  expect(into.addr).not.toBeNull();
  // Turn a continuous knob: walk to one, then ↑.
  for (let i = 0; i < 6; i++) {
    const role = await page.evaluate(() => document.activeElement.getAttribute("role"));
    if (role === "slider") break;
    await page.keyboard.press("ArrowRight");
  }
  const knob = await active(page);
  const was = Number(await page.locator(`#rack-svg g[data-addr="${knob.addr}"]`).getAttribute("aria-valuenow"));
  const t0 = await now(page);
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await replied(page, "bench", t0);
  await expect.poll(async () => Number(await page.locator(`#rack-svg g[data-addr="${knob.addr}"]`).getAttribute("aria-valuenow"))).toBeGreaterThan(was);
  // The arrows stay inside the module.
  for (let i = 0; i < 12; i++) await page.keyboard.press("ArrowRight");
  expect((await active(page)).kind).toBe("filter");
  // Esc: the module; Esc again: out of it, the selection gone.
  await page.keyboard.press("Escape");
  expect(await active(page)).toMatchObject({ kind: "filter", plate: true });
  await page.keyboard.press("Escape");
  expect((await active(page)).key).toBeNull();
  await expect(page.locator("#rack-svg g.selected")).toHaveCount(0);
  // ⇧Home fits what ⌘= zoomed into.
  const vb = () => page.evaluate(() => document.getElementById("rack-svg").getAttribute("viewBox").split(/\s+/).map(Number));
  const fitted = await vb();
  const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1);
  await page.keyboard.press("Control+=");
  await page.keyboard.press("Control+=");
  await expect.poll(async () => near(await vb(), fitted)).toBe(false);
  await page.keyboard.press("Shift+Home");
  await expect.poll(async () => near(await vb(), fitted), { timeout: 5_000 }).toBe(true);
  expect(errors).toEqual([]);
});

test("F2 opens the structure menu, and Delete on a two-input module asks which input survives", async ({ page }) => {
  const errors = await boot(page, { warmed: true });
  await openPreset(page, "Reese");
  await page.locator('#rack-svg .rack-controls g.mod-group[data-kind="filter"]').focus();
  await page.keyboard.press("F2");
  await expect(page.locator("#ctx-menu")).toBeVisible();
  await expect(page.locator("#ctx-menu .cm-item").filter({ hasText: /^replace with/ })).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.locator("#ctx-menu")).toBeHidden();
  await page.locator('#rack-svg .rack-controls g.mod-group[data-kind="mix"]').focus();
  await page.keyboard.press("Delete");
  await expect(page.locator("#ctx-menu")).toBeVisible();
  await expect(page.locator("#ctx-menu .cm-item").filter({ hasText: /keep/i }).first()).toBeVisible();
  await page.keyboard.press("Escape");
  // Nothing was deleted.
  await expect(page.locator('#rack-svg g.mod-group[data-kind="mix"]')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("Esc walks out one thing at a time: the module, the catalog, then a new patch", async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await boot(page, { warmed: true });
  await openPreset(page, "Reese");
  await page.locator("#patch-new-btn").click();
  await expect(page.locator("#rack-subject")).toHaveText("New patch", { timeout: 30_000 });
  await expect(page.locator("#nodebank")).toBeVisible();
  await expect(page.locator('#rack-svg g.mod-group[data-kind="amp"]')).toHaveCount(1);
  await page.locator('#rack-svg .rack-controls g.mod-group[data-kind="amp"]').focus();
  await page.keyboard.press("Escape");
  expect((await active(page)).key).toBeNull();
  await expect(page.locator("#nodebank")).toBeVisible();
  await expect(page.locator("#rack-subject")).toHaveText("New patch");
  await page.keyboard.press("Escape");
  await expect(page.locator("#nodebank")).toBeHidden();
  await expect(page.locator("#rack-subject")).toHaveText("New patch");
  await page.keyboard.press("Escape");
  await expect(page.locator("#rack-subject")).toContainText("Reese", { timeout: 30_000 });
  expect(errors).toEqual([]);
});

test("a module in hand: the arrows choose a socket and Enter places it", async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await boot(page, { warmed: true });
  await openPreset(page, "Glass Pad");
  await openCatalog(page);
  await page.locator('#nb-groups .nb-item[data-kind="distortion"]').click();
  await expect(page.locator("#rack-svg .jack.legal").first()).toBeVisible();
  // The rack at rest first: the open catalog refits the patch, and the level
  // of detail it lands at redraws it a frame later.
  await expect.poll(() => page.evaluate(() => new Promise((done) => {
    const at = () => JSON.stringify([...document.querySelectorAll("#rack-svg .jack.legal")].map((j) => j.getBoundingClientRect()));
    const a = at();
    requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => done(a === at()))));
  })), { timeout: 30_000 }).toBe(true);
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#rack-svg .jack.legal.hot")).toHaveCount(1);
  await expect(page.locator("#pick-chip .pick-chip-text")).toHaveText(/^insert after /i);
  const t0 = await now(page);
  await page.keyboard.press("Enter");
  await replied(page, "bench", t0);
  await expect(page.locator('#rack-svg g.mod-group[data-kind="distortion"]')).toHaveCount(1, { timeout: 30_000 });
  expect(errors).toEqual([]);
});

test("the keys yield to the catalog's search, and the note keys still play on a module", async ({ page }) => {
  const errors = await boot(page, { warmed: true });
  await openPreset(page, "Reese");
  // In the search, l and the arrows are text.
  await page.keyboard.press("/");
  await expect(page.locator("#nb-q")).toBeFocused();
  await page.keyboard.type("lfo");
  await page.keyboard.press("Home");
  await expect(page.locator("#nb-q")).toHaveValue("lfo");
  await expect(page.locator("#nb-q")).toBeFocused();
  await expect(page.locator("#rack-svg .mod-plate.locked")).toHaveCount(0);
  // On a module, a is a note (C4).
  await page.locator('#rack-svg .rack-controls g.mod-group[data-kind="filter"]').focus();
  await page.keyboard.down("a");
  await expect(page.locator('.pkey[data-note="60"]')).toHaveClass(/\bdown\b/);
  await page.keyboard.up("a");
  expect(errors).toEqual([]);
});

test("Home and End are the canvas's: on VOL they stay the slider's, and under the comparison nothing behind it moves", async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await boot(page, { warmed: true });
  await openPreset(page, "Reese");
  // VOL: End is the slider's top, and the focus stays on it.
  await page.locator("#vol").focus();
  await page.keyboard.press("End");
  await expect(page.locator("#vol")).toBeFocused();
  expect(Number(await page.locator("#vol").inputValue())).toBe(1);
  await page.keyboard.press("Home");
  await expect(page.locator("#vol")).toBeFocused();
  expect((await active(page)).key).toBeNull();
  // An edit, then KEEP AS NEW's comparison (a modal): Home and Delete reach
  // nothing behind it.
  const knob = page.locator("#rack-svg [data-addr]").first();
  await knob.focus();
  const before = await knob.getAttribute("aria-valuetext");
  for (let i = 0; i < 8; i++) await page.keyboard.press("ArrowUp");
  await expect(knob).not.toHaveAttribute("aria-valuetext", before, { timeout: 10_000 });
  await expect(page.locator("#rack-commit")).toBeEnabled({ timeout: 15_000 });
  await page.locator("#rack-commit").click();
  await expect(page.locator("#cduel")).toBeVisible({ timeout: 30_000 });
  const modules = await page.locator("#rack-svg .rack-plates g[data-key]").count();
  const structs = () => page.evaluate(() => window.__pwPosted.filter((p) => /edit_structure|edit_set_tree/.test(p.type)).length);
  const s0 = await structs();
  await page.keyboard.press("Home");
  expect((await active(page)).plate).toBe(false);
  await page.keyboard.press("Delete");
  expect(await structs()).toBe(s0);
  await expect(page.locator("#rack-svg .rack-plates g[data-key]")).toHaveCount(modules);
  await page.keyboard.press("Escape");
  await expect(page.locator("#cduel")).toBeHidden();
  expect(errors).toEqual([]);
});

test("one Esc closes one thing: an open menu goes first, and the selection waits for the next press", async ({ page }) => {
  const errors = await boot(page, { warmed: true });
  await openPreset(page, "Reese");
  await page.locator('#rack-svg .rack-controls g.mod-group[data-kind="filter"]').focus();
  await expect(page.locator('#rack-svg .rack-plates g[data-kind="filter"].selected')).toHaveCount(1);
  await openCatalog(page);
  await page.locator("#rack-layout").click();
  await expect(page.locator("#pt-laymenu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#pt-laymenu")).toBeHidden();
  await expect(page.locator("#nodebank")).toBeVisible();
  await expect(page.locator('#rack-svg .rack-plates g[data-kind="filter"].selected')).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.locator('#rack-svg .rack-plates g.selected')).toHaveCount(0);
  await expect(page.locator("#nodebank")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#nodebank")).toBeHidden();
  expect(errors).toEqual([]);
});

test("the selection follows the module: an insert before it moves its key, and it stays selected", async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await boot(page, { warmed: true });
  await openPreset(page, "Reese");
  const filter = page.locator('#rack-svg .rack-controls g.mod-group[data-kind="filter"]');
  await filter.focus();
  const key0 = await filter.getAttribute("data-key");
  // F2's "insert after…" (the new module takes the filter's place in the
  // tree, and the filter moves down one), then a distortion from the catalog.
  await page.keyboard.press("F2");
  await page.locator("#ctx-menu .cm-item").filter({ hasText: /^insert after/ }).click();
  const t0 = await now(page);
  await page.locator('#nb-groups .nb-item[data-kind="distortion"]').click();
  await replied(page, "bench", t0);
  await expect(page.locator('#rack-svg g.mod-group[data-kind="distortion"]')).toHaveCount(1, { timeout: 30_000 });
  const key1 = await page.locator('#rack-svg .rack-controls g.mod-group[data-kind="filter"]').getAttribute("data-key");
  expect(key1).not.toBe(key0);
  await expect(page.locator('#rack-svg .rack-plates g[data-kind="filter"].selected')).toHaveCount(1);
  await expect(page.locator("#pt-read .pr-name")).toHaveText(/filter|ladder|svf/i);
  expect(errors).toEqual([]);
});
