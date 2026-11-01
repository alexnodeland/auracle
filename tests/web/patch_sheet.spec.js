// On touch, a tapped module opens a sheet with every setting (Plan-005 task
// 7), and an AUDIO IN module is drawn as the engine describes it. A touch
// screen here is a tablet in landscape (1024 × 768, a coarse pointer): wide
// enough for both of index.html's gates, which a phone still meets.
const { test, expect } = require("./fixtures");
const { openPreset } = require("./patch_page.js");

test.use({ viewport: { width: 1024, height: 768 }, hasTouch: true, isMobile: true });

/** The knobs the engine describes for the module of `kind`. */
const knobsOf = (page, kind) =>
  page.evaluate((k) => {
    const m = window.__aur.wb.rack.modules.find((x) => x.kind === k);
    return m.knobs.map((x) => ({ addr: x.addr, t: x.kind.t, n: x.kind.t === "octave" ? 5 : (x.kind.options || []).length, value: x.value }));
  }, kind);

/** An element's place on screen is the same across three frames: the
 *  camera has stopped moving (an open, or an edit, fits the patch to the
 *  frame on a tween). */
const stillAt = (page, selector) =>
  expect.poll(() => page.evaluate((sel) => new Promise((done) => {
    const rect = () => JSON.stringify(document.querySelector(sel)?.getBoundingClientRect() || null);
    const a = rect();
    requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => done(a !== "null" && a === rect()))));
  }), selector), { timeout: 30_000 }).toBe(true);

/** Tap a module's plate by its title, clear of its knobs and jacks, once the
 *  rack has settled (its cables measured, so nothing is rebuilding it). */
async function tapPlate(app, kind) {
  const { page } = app;
  await app.engine((timeout) => expect(page.locator("#rack-svg .cable-mark:not(.unknown)").first()).toBeVisible({ timeout }), { ms: 60_000 });
  // …and the camera has stopped moving.
  await stillAt(page, `#rack-svg g[data-kind="${kind}"]:not(.mod-group) .mod-plate`);
  // The point of bare panel farthest from every control on the plate: a
  // touch screen moves a tap onto anything that answers one nearby (a knob's
  // lock dot, a plate button), and a tap there is that control's.
  const at = await page.evaluate((k) => {
    const plate = document.querySelector(`#rack-svg g[data-kind="${k}"]:not(.mod-group) .mod-plate`);
    const b = plate.getBoundingClientRect();
    const group = document.querySelector(`#rack-svg g.mod-group[data-kind="${k}"]`);
    const ctrls = [...group.querySelectorAll("[data-addr], [data-stop], .jack, .mod-menu-btn, .mod-lock, .lock-dot")].map((e) => e.getBoundingClientRect());
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

test("on touch, a tapped module opens a sheet with every setting, and its steps edit the patch", async ({ page, app }) => {
  await app.boot();
  expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
  await openPreset(app, "Reese");

  const knobs = await knobsOf(page, "filter");
  await tapPlate(app, "filter");
  const sheet = page.locator("#module-sheet");
  await expect(sheet).toHaveClass(/\bon\b/);
  // Focus goes into the sheet when it opens.
  expect(await page.evaluate(() => document.getElementById("module-sheet").contains(document.activeElement))).toBe(true);
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
  await expect.poll(() => app.sentCount("edit_param"), { timeout: 15_000 }).toBeGreaterThan(0);
  await app.engine((timeout) => expect
    .poll(() => page.evaluate((a) => window.__aur.wb.rack.modules.flatMap((m) => m.knobs).find((k) => k.addr === a).value, cont.addr), { timeout })
    .toBeGreaterThan(cont.value), { ms: 30_000 });
  // A named setting's choice.
  const named = knobs.find((k) => k.t !== "continuous");
  if (named) {
    const seg = sheet.locator(`.ms-row[data-addr="${named.addr}"] .ms-seg button`);
    const pick = Math.round(named.value) === 0 ? 1 : 0;
    await seg.nth(pick).tap();
    await app.engine((timeout) => expect(seg.nth(pick)).toHaveAttribute("aria-checked", "true", { timeout }), { ms: 30_000 });
    // A radio group: the checked choice is its one Tab stop, and an arrow
    // key moves to the next choice and chooses it.
    await expect(seg.nth(pick)).toHaveAttribute("tabindex", "0");
    await seg.nth(pick).focus();
    await page.keyboard.press("ArrowRight");
    const after = (pick + 1) % (await seg.count());
    await app.engine((timeout) => expect(seg.nth(after)).toHaveAttribute("aria-checked", "true", { timeout }), { ms: 30_000 });
    await expect(seg.nth(after)).toBeFocused();
  }

  // ×, then a tap on another module opens that one.
  await sheet.locator(".ms-x").tap();
  await expect(sheet).not.toHaveClass(/\bon\b/);
  // …and leaves it when it closes.
  expect(await page.evaluate(() => document.getElementById("module-sheet").contains(document.activeElement))).toBe(false);
  await tapPlate(app, "lfo");
  await expect(sheet).toHaveClass(/\bon\b/);
  await expect(sheet.locator(".ms-name")).toHaveText("lfo");
});

test("an AUDIO IN module is drawn as the engine describes it, and its sheet has its settings", async ({ page, app }) => {
  await app.boot();
  await openPreset(app, "Reese");
  // The patch with an AUDIO IN in its first socket, as an edit the engine
  // takes (the module rail has no AUDIO IN yet).
  await page.evaluate(() => {
    const t = JSON.parse(JSON.stringify(window.__aur.wb.tree));
    const body = Object.values(t.root)[0];
    const field = ["input", "a", "carrier"].find((f) => body[f] && typeof body[f] === "object");
    body[field] = { AudioIn: { input: 0, gain: 0.66, channel: "Both" } };
    window.__tap.engine.postMessage({ type: "edit_set_tree", json: JSON.stringify(t) });
  });
  const plate = page.locator('#rack-svg g.mod-group[data-kind="audio_in"]');
  await app.engine((timeout) => expect(plate).toHaveCount(1, { timeout }), { ms: 30_000 });
  await expect(page.locator('#rack-svg g[data-kind="audio_in"] .mod-title')).toHaveText("audio in");
  const knobs = await knobsOf(page, "audio_in");
  expect(knobs.map((k) => k.addr.split("#").pop()).sort()).toEqual(["channel", "gain", "input"]);
  await tapPlate(app, "audio_in");
  const sheet = page.locator("#module-sheet");
  await expect(sheet).toHaveClass(/\bon\b/);
  await expect(sheet.locator(".ms-row")).toHaveCount(3);
});

test("on touch, a tap on a plate button presses it and opens no sheet", async ({ page, app }) => {
  await app.boot();
  await openPreset(app, "Reese");
  // A CAPTURE around the first socket's branch, as an edit the engine takes:
  // RECORD records that branch, with no input to ask for.
  await page.evaluate(() => {
    const t = JSON.parse(JSON.stringify(window.__aur.wb.tree));
    const body = Object.values(t.root)[0];
    const field = ["input", "a", "carrier"].find((f) => body[f] && typeof body[f] === "object");
    const take = { format: "f32le-base64", sample_rate: 44100, length: 0, data: "" };
    body[field] = { Capture: { play: "hold", input: body[field], take } };
    window.__tap.engine.postMessage({ type: "edit_set_tree", json: JSON.stringify(t) });
  });
  const rec = page.locator('#rack-svg [data-stop="take-rec"]');
  await app.engine((timeout) => expect(rec).toBeVisible({ timeout }), { ms: 30_000 });
  await app.engine((timeout) => expect(page.locator("#rack-svg .cable-mark:not(.unknown)").first()).toBeVisible({ timeout }), { ms: 60_000 });
  // The camera settles after the edit.
  await stillAt(page, '#rack-svg [data-stop="take-rec"]');
  await rec.evaluate((b) => b.addEventListener("click", () => { window.__pwRecTapped = true; }));
  const box = await rec.boundingBox();
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  // RECORD took the tap (it records), and no sheet came up over it.
  await expect.poll(() => page.evaluate(() => !!window.__pwRecTapped), { timeout: 5_000 }).toBe(true);
  await app.quiet();
  await expect(page.locator("#module-sheet.on")).toHaveCount(0);
});
