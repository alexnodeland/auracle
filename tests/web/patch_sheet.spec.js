// On touch, a tapped module opens a sheet with every setting (Plan-005 task
// 7), and an AUDIO IN module is drawn as the engine describes it. A touch
// screen here is a tablet in landscape (1024 × 768, a coarse pointer): wide
// enough for both of index.html's gates, which a phone still meets.
const { test, expect } = require("@playwright/test");
const { boot, openPreset } = require("./patch_page.js");

test.use({ viewport: { width: 1024, height: 768 }, hasTouch: true, isMobile: true });

/** The knobs the engine describes for the module of `kind`. */
const knobsOf = (page, kind) =>
  page.evaluate((k) => {
    const m = window.__aur.wb.rack.modules.find((x) => x.kind === k);
    return m.knobs.map((x) => ({ addr: x.addr, t: x.kind.t, n: x.kind.t === "octave" ? 5 : (x.kind.options || []).length, value: x.value }));
  }, kind);

/** Tap a module's plate by its title, clear of its knobs and jacks, once the
 *  rack has settled (its cables measured, so nothing is rebuilding it). */
async function tapPlate(page, kind) {
  await expect(page.locator("#rack-svg .cable-mark:not(.unknown)").first()).toBeVisible({ timeout: 60_000 });
  // …and the camera has stopped moving (an open fits the patch to the frame).
  const where = () => page.evaluate((k) => JSON.stringify(document.querySelector(`#rack-svg g[data-kind="${k}"]:not(.mod-group) .mod-plate`).getBoundingClientRect()), kind);
  await expect.poll(async () => {
    const a = await where();
    await page.waitForTimeout(400);
    return a === (await where());
  }, { timeout: 30_000 }).toBe(true);
  // The point of bare panel farthest from every control on the plate: a
  // touch screen moves a tap onto anything that answers one nearby (a knob's
  // lock dot), and a tap there is that control's.
  const at = await page.evaluate((k) => {
    const plate = document.querySelector(`#rack-svg g[data-kind="${k}"]:not(.mod-group) .mod-plate`);
    const b = plate.getBoundingClientRect();
    const group = document.querySelector(`#rack-svg g.mod-group[data-kind="${k}"]`);
    const ctrls = [...group.querySelectorAll("[data-addr], .jack, .mod-menu-btn, .mod-lock, .lock-dot")].map((e) => e.getBoundingClientRect());
    let best = null;
    for (let fx = 0.08; fx < 0.95; fx += 0.04) {
      for (let fy = 0.08; fy < 0.95; fy += 0.04) {
        const x = b.left + fx * b.width;
        const y = b.top + fy * b.height;
        if (document.elementFromPoint(x, y) !== plate) continue;
        const d = Math.min(...ctrls.map((r) => Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom))));
        if (!best || d > best.d) best = { x, y, d };
      }
    }
    return best;
  }, kind);
  await page.touchscreen.tap(at.x, at.y);
}

test("on touch, a tapped module opens a sheet with every setting, and its steps edit the patch", async ({ page }) => {
  test.setTimeout(300_000);
  const errors = await boot(page, { warmed: true });
  expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
  await openPreset(page, "Reese");

  const knobs = await knobsOf(page, "filter");
  await tapPlate(page, "filter");
  const sheet = page.locator("#module-sheet");
  await expect(sheet).toHaveClass(/\bon\b/);
  await expect(sheet.locator(".ms-name")).toHaveText("filter");
  // Every setting: a slider with − and + for each continuous knob, and the
  // choices of each named one.
  await expect(sheet.locator(".ms-row")).toHaveCount(knobs.length);
  for (const k of knobs) {
    const row = sheet.locator(`.ms-row[data-addr="${k.addr}"]`);
    if (k.t === "continuous") {
      await expect(row.locator(".ms-track[role=slider]")).toHaveCount(1);
      await expect(row.locator(".ms-step")).toHaveCount(2);
    } else {
      await expect(row.locator(".ms-seg button")).toHaveCount(k.n);
    }
  }
  // The sheet's controls are a finger's width.
  const step = await sheet.locator(".ms-step").first().boundingBox();
  expect(step.width).toBeGreaterThanOrEqual(44);
  expect(step.height).toBeGreaterThanOrEqual(44);

  // + raises the knob on the rack and in the engine, through the edit lane.
  const cont = knobs.find((k) => k.t === "continuous" && k.value < 0.9);
  const row = sheet.locator(`.ms-row[data-addr="${cont.addr}"]`);
  await row.locator(".ms-step").last().tap();
  await expect.poll(() => page.evaluate(() => window.__pwPosted.filter((p) => p.type === "edit_param").length), { timeout: 15_000 }).toBeGreaterThan(0);
  await expect
    .poll(() => page.evaluate((a) => window.__aur.wb.rack.modules.flatMap((m) => m.knobs).find((k) => k.addr === a).value, cont.addr), { timeout: 30_000 })
    .toBeGreaterThan(cont.value);
  // A named setting's choice.
  const named = knobs.find((k) => k.t !== "continuous");
  if (named) {
    const seg = sheet.locator(`.ms-row[data-addr="${named.addr}"] .ms-seg button`);
    const pick = Math.round(named.value) === 0 ? 1 : 0;
    await seg.nth(pick).tap();
    await expect(seg.nth(pick)).toHaveAttribute("aria-checked", "true", { timeout: 30_000 });
  }

  // ×, then a tap on another module opens that one.
  await sheet.locator(".ms-x").tap();
  await expect(sheet).not.toHaveClass(/\bon\b/);
  await tapPlate(page, "lfo");
  await expect(sheet).toHaveClass(/\bon\b/);
  await expect(sheet.locator(".ms-name")).toHaveText("lfo");
  expect(errors, errors.join("\n")).toEqual([]);
});

test("an AUDIO IN module is drawn as the engine describes it, and its sheet has its settings", async ({ page }) => {
  test.setTimeout(300_000);
  const errors = await boot(page, { warmed: true });
  await openPreset(page, "Reese");
  // The patch with an AUDIO IN in its first socket, as an edit the engine
  // takes (the module rail has no AUDIO IN yet).
  await page.evaluate(() => {
    const t = JSON.parse(JSON.stringify(window.__aur.wb.tree));
    const body = Object.values(t.root)[0];
    const field = ["input", "a", "carrier"].find((f) => body[f] && typeof body[f] === "object");
    body[field] = { AudioIn: { input: 0, gain: 0.66, channel: "Both" } };
    window.__pwEngine().postMessage({ type: "edit_set_tree", json: JSON.stringify(t) });
  });
  const plate = page.locator('#rack-svg g.mod-group[data-kind="audio_in"]');
  await expect(plate).toHaveCount(1, { timeout: 30_000 });
  await expect(page.locator('#rack-svg g[data-kind="audio_in"] .mod-title')).toHaveText("audio in");
  const knobs = await knobsOf(page, "audio_in");
  expect(knobs.map((k) => k.addr.split("#").pop()).sort()).toEqual(["channel", "gain", "input"]);
  await tapPlate(page, "audio_in");
  const sheet = page.locator("#module-sheet");
  await expect(sheet).toHaveClass(/\bon\b/);
  await expect(sheet.locator(".ms-row")).toHaveCount(3);
  expect(errors, errors.join("\n")).toEqual([]);
});
