// Each audio cable carries light by the level the engine measured on it
// (Plan-005 task 7, the worker's `cable_levels`, `edit_cable_levels`). The
// levels are read as the worker posts them, and the rack is held to them: a
// cable for every level, keyed as the rack draws it; its light the level on
// the meter's scale; a mark lit by the same number; modulation cables unlit;
// a structure not measured yet drawn unlit, not estimated; and the probe
// asked once an edit settles, not per knob step.
const { test, expect } = require("@playwright/test");
const { boot, openPreset, slowWorker } = require("./patch_page.js");

const FLOOR = -54;
const gain = (db) => Math.max(0, Math.min(1, (db - FLOOR) / -FLOOR));

/** The rack's audio cables and marks, as drawn. */
const drawn = (page) =>
  page.evaluate(() => ({
    wires: [...document.querySelectorAll("#rack-svg path.wire.audio[data-from]")].map((w) => ({
      key: `${w.dataset.from}>${w.dataset.to}`,
      opacity: Number(w.style.strokeOpacity),
    })),
    marks: [...document.querySelectorAll("#rack-svg .cable-mark")].map((m) => ({
      key: `${m.dataset.from}>${m.dataset.to}`,
      unknown: m.classList.contains("unknown"),
      lit: m.querySelectorAll(".lm-bar.on").length,
    })),
    mods: [...document.querySelectorAll("#rack-svg path.wire.mod[data-from]")].map((w) => ({
      key: `${w.dataset.from}>${w.dataset.to}`,
      opacity: w.style.strokeOpacity,
    })),
  }));

test("cables carry light by the levels the engine measured, keyed as the rack draws them, and modulation cables carry none", async ({ page }) => {
  test.setTimeout(300_000);
  const errors = await boot(page, { warmed: true, slow: true });
  await openPreset(page, "Reese");
  // The levels measured on the tree the rack is drawing (an earlier reply can
  // be for the sound the boot opened).
  await expect
    .poll(() => page.evaluate(() => !!window.__pwLast.cable_levels && window.__pwLast.cable_levels.tree === window.__pwLast.bench.treeJson), { timeout: 60_000 })
    .toBe(true);
  const reply = await page.evaluate(() => window.__pwLast.cable_levels);
  const levels = reply.levels.cables;
  expect(levels.length).toBeGreaterThan(0);

  await expect.poll(async () => (await drawn(page)).marks.filter((m) => !m.unknown).length, { timeout: 15_000 }).toBe(levels.length);
  const d = await drawn(page);
  // One cable and one mark per measured cable, by the rack's keys.
  expect(d.wires.map((w) => w.key).sort()).toEqual(levels.map((c) => `${c.from}>${c.to}`).sort());
  for (const c of levels) {
    const key = `${c.from}>${c.to}`;
    const w = d.wires.find((x) => x.key === key);
    const lv = gain(c.rms_db);
    expect(w.opacity, `${key} at ${c.rms_db} dB`).toBeCloseTo(0.2 + 0.62 * lv, 2);
    const m = d.marks.find((x) => x.key === key);
    expect(m.lit, `${key}'s mark`).toBe(lv > 0.66 ? 3 : lv > 0.33 ? 2 : lv > 0.02 ? 1 : 0);
  }
  // Reese's LFO: a modulation cable, not measured, with no mark and no light.
  expect(d.mods.length).toBeGreaterThan(0);
  for (const m of d.mods) {
    expect(d.marks.some((x) => x.key === m.key)).toBe(false);
    expect(m.opacity).toBe("");
  }

  // One probe for the open, not one per knob step: a drag of ten steps asks
  // once, after it settles.
  const asked = () => page.evaluate(() => window.__pwPosted.filter((p) => p.type === "cable_levels").length);
  const before = await asked();
  const knob = page.locator("#rack-svg g[data-addr] .knob-hit").first();
  const box = await knob.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - i * 4);
  await page.mouse.up();
  // While the change is unmeasured, the marks are hollow.
  await expect.poll(async () => (await drawn(page)).marks.every((m) => m.unknown), { timeout: 15_000 }).toBe(true);
  await expect.poll(asked, { timeout: 30_000 }).toBe(before + 1);
  await expect.poll(async () => (await drawn(page)).marks.every((m) => !m.unknown), { timeout: 30_000 }).toBe(true);

  // A new structure is unlit until it is measured: no estimate is drawn.
  await slowWorker(page, { cable_levels: 4000 });
  await page.locator("#patch-new-btn").click();
  // The empty socket is on the rack before a source is put in it.
  await expect(page.locator('#rack-svg g.mod-group[data-kind="silence"]')).toHaveCount(1, { timeout: 30_000 });
  await page.locator('#nb-groups .nb-item[data-kind="supersaw"]').click();
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => document.querySelectorAll('#rack-svg g.mod-group[data-kind="supersaw"]').length), { timeout: 30_000 }).toBe(1);
  const unmeasured = await drawn(page);
  for (const w of unmeasured.wires) expect(w.opacity, `${w.key} before its level`).toBeCloseTo(0.2, 2);
  for (const m of unmeasured.marks) expect(m.unknown).toBe(true);
  await expect.poll(async () => (await drawn(page)).marks.some((m) => !m.unknown), { timeout: 30_000 }).toBe(true);
  await slowWorker(page, {});
  // Never more than one probe at the engine: a probe asked while one was
  // out waited for its answer (the slow probe above had edits settle under it).
  const most = await page.evaluate(() => {
    const ev = [
      ...window.__pwPosted.filter((p) => p.type === "cable_levels").map((p) => [p.t, 1]),
      ...window.__pwReplies.filter((r) => r.type === "cable_levels").map((r) => [r.t, -1]),
    ].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let out = 0;
    let max = 0;
    for (const [, d] of ev) { out += d; max = Math.max(max, out); }
    return max;
  });
  expect(most, "probes piled up at the engine").toBe(1);
  expect(errors, errors.join("\n")).toEqual([]);
});
