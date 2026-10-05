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
// - At 1440 the fit a four-module patch opens at prints every module's name,
//   the setting that names its kind (in its head, as set) and each knob's
//   value and name at a size you can read; a setting is printed as its value,
//   never an empty chip; the amp's head draws its envelope from its knobs.
// - Audio cables are curves between the jacks; a two-input module names its
//   inputs (a, b) outside the plate, by the cables; the modulation cable's
//   words ("depth 25% · 0.51 Hz") show at that fit.
// - The scope is folded until asked for; the belief line is the subtitle's
//   under the model view only, standing in for its counts, and without a
//   guess says why (and that nothing is settled); TEACH counts the picks in
//   one place, the chip at the well's foot.
// - "Undo to as opened" waits for a sound on its way: pressed while another
//   opens, it posts nothing and says why (so does ⌘Z, which waits).
const { test, expect } = require("@playwright/test");
const { boot, openPreset, now, replied, slowWorker } = require("./patch_page");
const { modelView } = require("./shell");

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

/** The rack at rest: the `i`th knob in the same place across three frames
 *  (an open fits the patch with a tween, and a press aimed mid-tween lands
 *  beside the knob). */
async function knobAtRest(page, i) {
  await expect.poll(() => page.evaluate((n) => new Promise((done) => {
    const at = () => JSON.stringify(document.querySelectorAll("#rack-svg g[data-addr] > .knob-hit")[n]?.getBoundingClientRect() || null);
    const a = at();
    requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => done(a !== "null" && a === at()))));
  }), i), { timeout: 30_000 }).toBe(true);
}

/** Drag the `i`th continuous knob up by `dy` px, and wait for its reply. */
async function turnKnob(page, i = 0, dy = 30) {
  await knobAtRest(page, i);
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
  // The lane shows one toast at a time: it may wait behind the open's.
  await expect(page.locator("#toasts")).toContainText("Back as it was opened: 2 changes undone.", { timeout: 20_000 });
  // Nothing left to take back: a press says so, and posts nothing.
  await expect(page.locator("#pt-revert")).toHaveAttribute("aria-disabled", "true");
  // (aria-disabled: in reach, so the press arrives; Playwright would wait.)
  await page.locator("#pt-revert").click({ force: true });
  await expect(page.locator("#toasts")).toContainText("Already as it was opened.", { timeout: 20_000 });
  expect(await sets()).toBe(before + 1);
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
  for (const verb of ["replace with", "insert before", "insert after", "duplicate", "set aside", "bypass", "probe this output", "what goes here", "swap the two inputs", "delete"]) {
    await expect(items.filter({ hasText: new RegExp(`^${verb}`) }), verb).toHaveCount(1);
  }
  await page.keyboard.press("Escape");
  // A modulator's own: replace it, or unplug it.
  await menu("lfo").click({ force: true });
  await expect(items.filter({ hasText: /^unplug this modulator/ })).toHaveCount(1);
  await expect(items.filter({ hasText: /^what goes here/ })).toHaveCount(1);
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

test("at 1440 the opening fit prints every module's name, its setting and each knob's value and name at a size you can read", async ({ page }) => {
  const errors = await boot(page, { warmed: true });
  await openPreset(page, "Reese");
  await expect(page.locator("#rack-svg .rack-plates g[data-key]").first()).toBeVisible();
  const read = await page.evaluate(() => {
    const svg = document.getElementById("rack-svg");
    const px = (el) => el.getBoundingClientRect().height;
    const shown = (el) => getComputedStyle(el).visibility !== "hidden" && getComputedStyle(el).display !== "none";
    const titles = [...svg.querySelectorAll(".rack-plates .mod-title")];
    const values = [...svg.querySelectorAll(".rack-controls .knob-value")];
    const labels = [...svg.querySelectorAll(".rack-controls .knob-label")];
    const heads = [...svg.querySelectorAll(".rack-controls .plate-set .enum-text")].map((t) => t.textContent);
    const settings = [...svg.querySelectorAll(".rack-controls g[data-addr]:not(.plate-set) .enum-text")];
    const plates = [...svg.querySelectorAll(".rack-plates g[data-key] .mod-plate")].map((p) => p.getBoundingClientRect().width);
    return {
      lod: svg.classList.contains("lod-compact"),
      titles: titles.map((t) => [shown(t), px(t)]),
      values: values.map((t) => [shown(t), px(t), t.textContent]),
      labels: labels.map((t) => [shown(t), px(t)]),
      heads,
      settings: settings.map((t) => [shown(t), t.textContent]),
      plates,
      env: !!svg.querySelector(".env-fig")?.getAttribute("d"),
    };
  });
  expect(read.lod).toBe(false);
  // Every name, value and label is drawn, and none smaller than 8 px.
  for (const [s, h] of read.titles) { expect(s).toBe(true); expect(h).toBeGreaterThanOrEqual(8); }
  expect(read.values.length).toBeGreaterThan(6);
  for (const [s, h, t] of read.values) { expect(s).toBe(true); expect(h).toBeGreaterThanOrEqual(8); expect(t).not.toBe(""); }
  for (const [s, h] of read.labels) { expect(s).toBe(true); expect(h).toBeGreaterThanOrEqual(7.5); }
  // The kinds' settings in the heads: two VCOs' waves, the filter's mode, the LFO's wave.
  expect(read.heads.length).toBe(4);
  for (const t of read.heads) expect(t).toMatch(/^(sin|tri|saw|sqr|svf lp|svf bp|svf hp|ladder)$/);
  // The octaves, printed as their values.
  expect(read.settings.length).toBeGreaterThan(0);
  for (const [s, t] of read.settings) { expect(s).toBe(true); expect(t).toMatch(/^[+-]?\d$/); }
  // Plates at the specimen's scale: about 80 to 210 px wide.
  for (const w of read.plates) { expect(w).toBeGreaterThan(70); expect(w).toBeLessThan(215); }
  expect(read.env).toBe(true);
  expect(errors).toEqual([]);
});

test("the amp's envelope figure follows its knobs", async ({ page }) => {
  const errors = await boot(page, { warmed: true });
  await openPreset(page, "Reese");
  const fig = page.locator("#rack-svg .env-fig");
  const d0 = await fig.getAttribute("d");
  const attack = page.locator('#rack-svg g.mod-group[data-kind="amp"] [data-addr$="#attack"], #rack-svg g.mod-group[data-kind="amp"] [role="slider"]').first();
  await attack.focus();
  for (let i = 0; i < 10; i++) await page.keyboard.press("ArrowUp");
  await expect.poll(() => fig.getAttribute("d")).not.toBe(d0);
  expect(errors).toEqual([]);
});

test("audio cables curve between the jacks, a two-input module names its inputs outside the plate, and the modulation cable's words show", async ({ page }) => {
  const errors = await boot(page, { warmed: true });
  await openPreset(page, "Reese");
  const got = await page.evaluate(() => {
    const svg = document.getElementById("rack-svg");
    const audio = [...svg.querySelectorAll("path.wire.audio")].map((p) => p.getAttribute("d"));
    const mix = svg.querySelector('g.mod-group[data-kind="mix"]');
    const ins = [...(mix?.querySelectorAll(".jack[data-childkey] text") || [])].map((t) => ({ text: t.textContent, x: Number(t.getAttribute("x")) }));
    const label = svg.querySelector(".mod-cable-label");
    return { audio, ins, label: label ? { text: label.textContent, shown: getComputedStyle(label).visibility !== "hidden" } : null };
  });
  expect(got.audio.length).toBeGreaterThan(2);
  for (const d of got.audio) expect(d).toMatch(/ C /);
  expect(got.ins.map((i) => i.text).sort()).toEqual(["a", "b"]);
  for (const i of got.ins) expect(i.x).toBeLessThan(0);
  expect(got.label).not.toBeNull();
  expect(got.label.shown).toBe(true);
  expect(got.label.text).toMatch(/^depth \S+ · \S+ Hz$/);
  expect(errors).toEqual([]);
});

test("the scope is folded until asked for, the belief line is the model view's and says why it has no guess, and TEACH counts the picks in one place", async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await boot(page, { warmed: true });
  await openPreset(page, "Reese");
  await expect(page.locator("#scope-shell")).toBeHidden();
  // The belief line: in the subtitle, hidden at rest, where the subtitle
  // says what the patch is made of.
  expect(await page.locator(".pt-sub #belief").count()).toBe(1);
  await expect(page.locator("#belief")).toBeHidden();
  await expect(page.locator("#rack-meta")).toBeVisible();
  // Under the model view it stands in for the counts: with no picks, its
  // limit; and with nothing settled no module's edge is tinted, which the
  // model says.
  await modelView(page, true);
  await expect(page.locator("#belief")).toBeVisible();
  await expect(page.locator("#rack-meta .pt-made")).toBeHidden();
  await expect(page.locator("#belief .bl-u")).toHaveCount(0);
  await expect(page.locator("#belief .bl-none")).toHaveText("no guess yet: it needs a few picks first");
  await expect(page.locator("#rack-svg .belief-edge")).toHaveCount(0);
  await expect(page.locator("#pt-worth .pt-worth-none")).toHaveText("no settled lean on anything in this patch yet");
  await modelView(page, false);
  await expect(page.locator("#belief")).toBeHidden();
  await expect(page.locator("#rack-meta .pt-made")).toBeVisible();
  await expect(page.locator("#pt-worth")).toBeHidden();
  // A pair dealt: the chip counts the picks, and the head says nothing more.
  await expect(page.locator("#pt-teach")).toBeVisible({ timeout: 90_000 });
  await expect(page.locator("#pt-teach")).toHaveText("teach · 6 picks ▸");
  await expect(page.locator("#nextstep")).toHaveText("");
  expect(errors).toEqual([]);
});

test("undo waits for a sound on its way: ⌘Z and undo to as opened, pressed while another opens, post nothing", async ({ page }) => {
  test.setTimeout(240_000);
  const errors = await boot(page, { warmed: true, slow: true });
  await openPreset(page, "Reese");
  await turnKnob(page, 0);
  await expect(page.locator("#pt-ed-n")).toHaveText("1 change");
  const sets = () => page.evaluate(() => window.__pwPosted.filter((p) => p.type === "edit_set_tree").length);
  const before = await sets();
  // The next sound takes its time arriving.
  await slowWorker(page, { edit_begin: 4000 });
  await page.locator(".bank-item", { hasText: "Glass Pad" }).first().click();
  // ↺ cannot go while it is on its way (and says why, where it is shown).
  await expect.poll(() => page.evaluate(() => {
    const b = document.getElementById("pt-revert");
    return b.getAttribute("aria-disabled") === "true" && b.parentElement.title === "Waiting for the sound you opened to arrive";
  }), { timeout: 3_000 }).toBe(true);
  // ⌘Z waits, and is dropped with the patch it was aimed at.
  await page.keyboard.press("Control+z");
  await expect(page.locator("#rack-subject")).toContainText("Glass Pad", { timeout: 60_000 });
  await slowWorker(page, {});
  await page.waitForFunction(() => window.__aur.wb.subjectId != null);
  expect(await sets()).toBe(before);
  await expect(page.locator("#pt-editbar")).toBeHidden();
  expect(errors).toEqual([]);
});

test("a module dragged by hand takes its cables along, and the modulation cable's words step aside until it is put down", async ({ page }) => {
  const errors = await boot(page, { warmed: true });
  await openPreset(page, "Reese");
  await page.locator("#rack-layout").click();
  await page.locator('#pt-laymenu [data-layout="freeform"]').click();
  await expect(page.locator("#rack-layout")).toHaveText(/^by hand/);
  const label = page.locator("#rack-svg .mod-cable-label").first();
  await expect(label).toBeVisible();
  const plate = page.locator('#rack-svg .rack-plates g[data-kind="mix"] .mod-plate').first();
  const b = await plate.boundingBox();
  await page.mouse.move(b.x + 10, b.y + b.height - 6);
  await page.mouse.down();
  await page.mouse.move(b.x + 40, b.y + b.height + 30, { steps: 6 });
  await expect(page.locator("#rack-scroll")).toHaveClass(/\bmoving-plate\b/);
  expect(await label.evaluate((t) => getComputedStyle(t).visibility)).toBe("hidden");
  await page.mouse.up();
  await expect(page.locator("#rack-svg .mod-cable-label").first()).toBeVisible();
  // Put back as it was.
  await page.locator("#rack-layout").click();
  await page.locator('#pt-laymenu [data-layout="chain"]').click();
  expect(errors).toEqual([]);
});

test("zoomed out past where labels read, every knob is still a control: the values go, the names and settings print larger", async ({ page }) => {
  const errors = await boot(page, { warmed: true });
  await openPreset(page, "Reese");
  // Three steps out from the fit (about 0.48×): a ten-module patch's opening
  // size at 1440, under the readouts' floor and over the knobs'.
  for (let i = 0; i < 3; i++) await page.locator("#pt-zoom-out").click();
  await knobAtRest(page, 0);
  const got = await page.evaluate(() => {
    const svg = document.getElementById("rack-svg");
    const vb = svg.getAttribute("viewBox").split(/\s+/).map(Number);
    const title = svg.querySelector(".rack-plates .mod-title");
    const value = svg.querySelector(".rack-controls .knob-value");
    return {
      zoom: svg.getBoundingClientRect().width / vb[2],
      compact: svg.classList.contains("lod-compact"),
      hits: svg.querySelectorAll("g[data-addr] > .knob-hit").length,
      titleShown: getComputedStyle(title).visibility,
      titlePx: title.getBoundingClientRect().height,
      valueShown: getComputedStyle(value).visibility,
    };
  });
  expect(got.zoom).toBeLessThan(0.62);
  expect(got.compact).toBe(false);
  expect(got.hits).toBeGreaterThan(6);
  expect(got.valueShown).toBe("hidden");
  expect(got.titleShown).toBe("visible");
  expect(got.titlePx).toBeGreaterThanOrEqual(8);
  // …and the keyboard still turns one.
  await page.locator('#rack-svg .rack-controls g.mod-group[data-kind="filter"]').focus();
  await page.keyboard.press("Enter");
  for (let i = 0; i < 4; i++) {
    if (await page.evaluate(() => document.activeElement.getAttribute("role")) === "slider") break;
    await page.keyboard.press("ArrowRight");
  }
  const knob = page.locator(":focus");
  const before = await knob.getAttribute("aria-valuetext");
  for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowUp");
  await expect(knob).not.toHaveAttribute("aria-valuetext", before);
  expect(errors).toEqual([]);
});
