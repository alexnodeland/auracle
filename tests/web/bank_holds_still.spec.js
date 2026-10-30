// The bank holds still under the hand (#312, ADR-025's hold rule, hand.js):
//
// - With the pointer over the bank, a child landing, a generation's end and
//   a refit (under the model view, which orders the rows by it) move no row:
//   the row under the pointer keeps its place on screen. Each lands when the
//   pointer leaves, or after a second's rest over the bank, and then the row
//   under a resting pointer still keeps its place (the list scrolls by what
//   moved it). With the keyboard's cursor in the list, the same.
// - A bench reply (a knob's) rebuilds no row of the preset list, and a click
//   pressed before it lands and released after still opens the preset it
//   was pressed on. An open by ] or a click moves the keyboard's cursor to
//   the row opened, and a preset opened from its row says IN POOL.
// - A redraw keeps the focus on the ▶ that had it, and a preset's ▶ playing
//   keeps its mark. A held redraw landing under the resting pointer shows
//   the row's actions at once, so its ▶ takes the focus, and the focus stays
//   when the pointer leaves; one landing as the pointer leaves leaves the
//   row's actions to hide as on any leave (#458).
//
// What must hold in the result's own task is read there: the tap hands main
// an injected reply synchronously (`window.__tap.inject`), so one
// `page.evaluate` reads a row, hands main the reply and reads the row again
// (ADR-022). The engine's own views, children and generation ends are held
// (`app.hold`) once the pool is whole, so only what the test posts lands.
const { test, expect, goLevel, bankTab, modelView } = require("./fixtures");
const patchPage = require("./patch_page.js");

// A hand over the bank, moving: under the rest of a second (`HAND_REST_MS`).
const STIR_MS = 300;

async function pooled(page, app) {
  await app.boot({ random: 20260928, reuseRenders: true });
  await app.engine((timeout) => expect.poll(async () => ((await app.facts()).ranked || []).length, { timeout }).toBeGreaterThanOrEqual(40), { ms: 60_000 });
  await goLevel(page, "evolve");
  await bankTab(page, "pool");
  // Only what the test posts lands from here.
  await app.hold([{ views: true }, "refine_child", "refined", "ranked"]);
}

/** The pool's rows as drawn, in order. */
const rowIds = (page) =>
  page.evaluate(() => [...document.querySelectorAll("#bank-list .bank-item[data-id]")].map((e) => Number(e.dataset.id)));

/** Hand main `reply` in this task, and read row `id`'s top before and after,
 *  and whether the New group is drawn after. */
const landNow = (page, id, reply) =>
  page.evaluate(([id, reply]) => {
    const top = () => document.querySelector(`#bank-list .bank-item[data-id="${id}"]`)?.getBoundingClientRect().top ?? null;
    const before = top();
    window.__tap.inject(reply);
    return { before, after: top(), rows: [...document.querySelectorAll("#bank-list .bank-item[data-id]")].map((e) => Number(e.dataset.id)) };
  }, [id, reply]);

const topOf = (page, id) =>
  page.evaluate((i) => document.querySelector(`#bank-list .bank-item[data-id="${i}"]`)?.getBoundingClientRect().top ?? null, id);

/** The pointer on row `id`'s name, a pixel either way each time. */
async function pointAt(page, id, nudge = 0) {
  const box = await page.locator(`#bank-list .bank-item[data-id="${id}"] .bi-name`).boundingBox();
  await page.mouse.move(box.x + box.width / 2 + nudge, box.y + box.height / 2);
}

/** Watch the row `sel` names for the redraw that replaces it, and read, in
 *  that redraw's own task, whether the new row's actions show and its ▶
 *  takes the focus (`window.__redrawn`). */
const watchRedraw = (page, sel) =>
  page.evaluate((sel) => {
    const was = document.querySelector(sel);
    window.__redrawn = null;
    const seen = new MutationObserver(() => {
      const row = document.querySelector(sel);
      if (!row || row === was) return;
      seen.disconnect();
      const hear = row.querySelector(".bi-hear");
      const shown = getComputedStyle(row.querySelector(".bi-acts")).visibility === "visible";
      hear.focus();
      window.__redrawn = { shown, focused: document.activeElement === hear };
    });
    seen.observe(document.getElementById("bank-list"), { childList: true, subtree: true });
  }, sel);

/** A child landing as the worker posts it, `child` a sound of the pool. */
function childReply(s, child, generation) {
  return {
    type: "refine_child", generation, index: 0, child, reason: null, seed: s.ranked[0].id,
    done: 1, total: 10, ranked: s.ranked, lineage: s.lineage, retiring: [], ratings: s.ratings, eta: null,
  };
}

test("the row under the pointer keeps its place while a child lands, a generation ends and a refit lands", async ({ page, app }) => {
  await pooled(page, app);
  const s = await app.facts();
  const rows = await rowIds(page);
  // A row a few down, in view, under the pointer; a child from the foot of
  // the pool, which lands at the top, in New.
  const under = rows[5];
  const child = rows[rows.length - 1];
  await pointAt(page, under);

  // A child lands: nothing moves under the moving hand.
  await pointAt(page, under, 1);
  const landed = await landNow(page, under, childReply(s, child, (s.status.generation || 0) + 1));
  expect(landed.after, "the row under the pointer, as the child landed").toBe(landed.before);
  expect(landed.rows[0], "the child drawn at once under the hand").not.toBe(child);
  for (let i = 0; i < 4; i++) {
    // eslint-disable-next-line playwright/no-wait-for-timeout -- the hand stirring over the bank, under a rest
    await page.waitForTimeout(STIR_MS);
    await pointAt(page, under, i % 2 ? 1 : -1);
    // Held, or (on a slow runner, past a rest) landed with the list scrolled
    // to keep it: either way where it was.
    expect(await topOf(page, under), "the row under the moving pointer").toBeCloseTo(landed.before, 0);
  }
  // At rest a second over the bank, the child lands, and the row under the
  // pointer is where it was: the list scrolled by what moved it.
  await expect(page.locator("#bank-list .bank-group.new")).toBeVisible();
  await expect.poll(() => rowIds(page).then((r) => r[0])).toBe(child);
  await expect.poll(() => topOf(page, under), { message: "the row under the resting pointer" }).toBeCloseTo(landed.before, 0);

  // A generation ends, replacing the two rows drawn above the pointer: held
  // while the hand moves, and drawn when it leaves.
  const now = await rowIds(page);
  const gone = now.slice(now.indexOf(under) - 2, now.indexOf(under));
  expect(gone).not.toContain(child);
  const left = s.ranked.filter((r) => !gone.includes(r.id));
  await pointAt(page, under, 1);
  const was = await topOf(page, under);
  const ended = await landNow(page, under, {
    type: "refined", views: { ...s.views, ranked: left }, status: { ...s.status, generation: (s.status.generation || 0) + 1 },
    born: [child], retired: gone, reasons: [],
  });
  expect(ended.after, "the row under the pointer, as the generation ended").toBe(was);
  expect(ended.rows, "the rows replaced, drawn at once under the hand").toEqual(expect.arrayContaining(gone));
  await page.mouse.move(5, 5);
  await expect.poll(() => rowIds(page)).not.toEqual(expect.arrayContaining([gone[0]]));

  // Under the model view the rows stand in the model's order: a refit that
  // puts the pool's last row first moves nothing under the hand.
  await modelView(page, true);
  // A first fit, with the pointer away, puts the rows in the model's order.
  const styles = s.views.styles || [];
  await app.inject({ type: "fitted", views: { ...s.views, styles, ranked: left }, status: s.status });
  await expect(page.locator("#bank-list .bank-group").nth(1)).toHaveText(/ranked by the model/);
  const ranked = await rowIds(page);
  const target = ranked[6];
  const last = left.find((r) => r.id === ranked[ranked.length - 1]);
  const order = [last, ...left.filter((r) => r !== last)];
  await pointAt(page, target);
  await pointAt(page, target, 1);
  const before = await topOf(page, target);
  const refit = await landNow(page, target, { type: "fitted", views: { ...s.views, styles, ranked: order }, status: s.status });
  expect(refit.after, "the row under the pointer, as the refit landed").toBe(before);
  expect(refit.rows, "the order, as the refit landed under the hand").toEqual(ranked);
  // At rest, the order lands, and the row under the pointer stays.
  await expect.poll(() => rowIds(page).then((r) => r.indexOf(last.id))).toBeLessThan(ranked.indexOf(last.id));
  await expect.poll(() => topOf(page, target), { message: "the row under the resting pointer" }).toBeCloseTo(before, 0);
});

test("with the keyboard's cursor in the bank, a child landing moves no row until a rest", async ({ page, app }) => {
  await pooled(page, app);
  const s = await app.facts();
  const rows = await rowIds(page);
  await page.mouse.move(5, 5);
  await page.locator("#bank-list").focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowDown");
  const cursor = page.locator("#bank-list .bank-item.kbd");
  await expect(cursor).toHaveAttribute("data-id", String(rows[3]));
  const child = rows[rows.length - 1];
  const landed = await landNow(page, rows[3], childReply(s, child, (s.status.generation || 0) + 1));
  expect(landed.after, "the cursor's row, as the child landed").toBe(landed.before);
  expect(landed.rows[0], "the child drawn at once under the cursor").not.toBe(child);
  // A second after the last step the child lands, though note keys go on
  // being played with the focus in the list (they are no step through it);
  // the cursor's row stays put and keeps the cursor.
  const fresh = page.locator("#bank-list .bank-group.new");
  // A note at each look, a player's pace apart.
  await expect.poll(async () => {
    await page.keyboard.press("a");
    return fresh.count();
  }, { intervals: [STIR_MS], message: "the child landed while notes were played" }).toBe(1);
  await expect.poll(() => rowIds(page).then((r) => r[0])).toBe(child);
  await expect.poll(() => topOf(page, rows[3])).toBeCloseTo(landed.before, 0);
  await expect(cursor).toHaveAttribute("data-id", String(rows[3]));
});

test("an open by ] or a row's click moves the keyboard's cursor to it, and 1–5 rates the row it highlights", async ({ page, app }) => {
  await pooled(page, app);
  await goLevel(page, "patch");
  await page.mouse.move(5, 5);
  const cursor = page.locator("#bank-list .bank-item.kbd");
  const list = page.locator("#bank-list");
  // ] steps to the next sound and opens it: the cursor is on its row.
  const t0 = await app.now();
  await page.keyboard.press("]");
  await expect.poll(async () => (await app.sent({ type: "edit_begin" }, { after: t0 })).length).toBe(1);
  const [{ id: stepped }] = await app.sent({ type: "edit_begin" }, { after: t0 });
  await expect(cursor).toHaveAttribute("data-id", String(stepped));
  await expect(list).toHaveAttribute("aria-activedescendant", `bank-row-${stepped}`);
  await page.keyboard.press("3");
  await expect.poll(async () => (await app.sent({ type: "record_stars", rating: 3 }, { after: t0 })).map((m) => m.id)).toEqual([stepped]);
  // A click on another row: the cursor follows it, and 1–5 rates that row.
  const rows = await rowIds(page);
  const other = rows.find((id) => id !== stepped && id !== rows[0]);
  await page.locator(`#bank-list .bank-item[data-id="${other}"] .bi-name`).click();
  await page.mouse.move(5, 5);
  await expect(cursor).toHaveAttribute("data-id", String(other));
  await expect(list).toHaveAttribute("aria-activedescendant", `bank-row-${other}`);
  await page.keyboard.press("4");
  await expect.poll(async () => (await app.sent({ type: "record_stars", rating: 4 }, { after: t0 })).map((m) => m.id)).toEqual([other]);
});

test("a preset opened from its row says IN POOL once it lands", async ({ page, app }) => {
  await app.boot({ random: 20260928, reuseRenders: true });
  await app.engine((timeout) => expect.poll(async () => ((await app.facts()).ranked || []).length, { timeout }).toBeGreaterThanOrEqual(40), { ms: 60_000 });
  // Nothing but the preset's own replies draws the bank from here.
  await app.hold(["taste_views", "refine_child", "refined", "fitted", "ranked"]);
  await bankTab(page, "presets");
  const row = page.locator("#bank-list .preset-item:not(.in-bank)").nth(4);
  const index = await row.getAttribute("data-index");
  const at = page.locator(`#bank-list .preset-item[data-index="${index}"]`);
  await row.locator(".bi-name").click();
  await app.engine((timeout) => expect(at).toHaveClass(/\bin-bank\b/, { timeout }), { ms: 60_000 });
  await expect(at.locator(".pb-in")).toHaveText("in pool");
});

test("a knob's reply rebuilds no preset row, and a click held across it opens the preset pressed", async ({ page, app }) => {
  await app.boot({ random: 20260928 });
  await patchPage.openPreset(app, "Glass Pad");
  await patchPage.settled(app);
  // Every row the bank list gains or loses from here.
  await page.evaluate(() => {
    window.__rebuilt = 0;
    new MutationObserver((m) => { window.__rebuilt += m.length; }).observe(document.getElementById("bank-list"), { childList: true });
  });
  // A knob turned on the rack, its reply held (`app.hold`) and then handed
  // to main with nothing pressed: no row is rebuilt. Then again, with a
  // preset row pressed while it lands and released after: the click opens it.
  const knob = await page.evaluate(() => {
    const hit = [...document.querySelectorAll("#rack-svg g[data-addr] > .knob-hit")].map((h) => h.getBoundingClientRect()).find((r) => r.width > 0 && r.top > 0 && r.bottom < innerHeight);
    return hit && { x: hit.x + hit.width / 2, y: hit.y + hit.height / 2 };
  });
  expect(knob, "a knob on screen").toBeTruthy();
  const turn = async (dy) => {
    await app.hold(["bench"]);
    await page.mouse.move(knob.x, knob.y);
    await page.mouse.down();
    await page.mouse.move(knob.x, knob.y - dy, { steps: 4 });
    await page.mouse.up();
    await expect.poll(async () => (await app.held()).filter((h) => h.type === "bench").length).toBeGreaterThan(0);
  };
  let t0 = await app.now();
  await turn(20);
  await page.mouse.move(5, 5);
  await app.release();
  await expect.poll(async () => (await app.replies("bench", { after: t0 })).length).toBeGreaterThan(0);
  await patchPage.settled(app);
  expect(await page.evaluate(() => window.__rebuilt), "the preset list rebuilt by the knob's reply").toBe(0);

  t0 = await app.now();
  await turn(-20);
  // The row found, brought into view and aimed at in one page task: a
  // redraw between round trips replaces the row measured (#458).
  const { index, x, y } = await page.evaluate(() => {
    const row = document.querySelectorAll("#bank-list .preset-item:not(.in-bank)")[3];
    row.scrollIntoView({ block: "nearest" });
    const box = row.querySelector(".bi-name").getBoundingClientRect();
    return { index: Number(row.dataset.index), x: box.x + 4, y: box.y + box.height / 2 };
  });
  await page.mouse.move(x, y);
  await page.mouse.down();
  await app.release();
  await expect.poll(async () => (await app.replies("bench", { after: t0 })).length).toBeGreaterThan(0);
  const before = (await app.sent({ type: "load_preset", index })).length;
  await page.mouse.up();
  await expect.poll(async () => (await app.sent({ type: "load_preset", index })).length, { message: "the click opened the preset pressed" }).toBe(before + 1);
});

test("a redraw of the bank keeps the focus on the ▶ that had it, and a preset's ▶ playing keeps its mark", async ({ page, app }) => {
  await app.boot({ random: 20260928 });
  await bankTab(page, "presets");
  const row = page.locator("#bank-list .preset-item").nth(2);
  const index = await row.getAttribute("data-index");
  const hear = page.locator(`#bank-list .preset-item[data-index="${index}"] .bi-hear`);
  await row.hover();
  await hear.click();
  await app.engine((timeout) => expect(hear).toHaveClass(/\bplaying\b/, { timeout }), { ms: 60_000 });
  // The focus on it (a press leaves none, so Space plays: ADR-016).
  await hear.focus();
  await expect(hear).toBeFocused();
  // The bank drawn again while it plays (the library's reply, as the worker
  // posts it), in the task the ▶ plays in.
  const after = await page.evaluate((i) => {
    const presets = window.__tap.last.presets;
    const was = document.querySelector(`#bank-list .preset-item[data-index="${i}"] .bi-hear`);
    window.__tap.inject({ type: "presets", rows: presets.rows });
    const now = document.querySelector(`#bank-list .preset-item[data-index="${i}"] .bi-hear`);
    return { rebuilt: now !== was, playing: now.classList.contains("playing"), focused: document.activeElement === now };
  }, index);
  expect(after).toEqual({ rebuilt: true, playing: true, focused: true });
});

test("a held redraw landing under the resting pointer shows the row's actions at once, and the focus its ▶ takes stays when the pointer leaves", async ({ page, app }) => {
  await pooled(page, app);
  const s = await app.facts();
  const [, , third] = await rowIds(page);
  await bankTab(page, "presets");
  const preset = await page.locator("#bank-list .preset-item").nth(2).getAttribute("data-index");
  for (const [tab, sel] of [["presets", `#bank-list .preset-item[data-index="${preset}"]`], ["pool", `#bank-list .bank-item[data-id="${third}"]`]]) {
    await bankTab(page, tab);
    const row = page.locator(sel);
    const acts = row.locator(".bi-acts");
    // The pointer on the row, at rest: its actions show.
    await row.locator(".bi-name").hover();
    await expect(acts).toHaveCSS("opacity", "1");
    // The pool's views again, as the worker posts them: held for the hand,
    // they land after a second's rest and draw the row again under the
    // pointer. Its actions were showing, and show in the redraw's task: a
    // row drawn again took the approach's delay to show them, and its ▶
    // took no focus meanwhile (#458).
    await watchRedraw(page, sel);
    await app.inject({ type: "taste_views", views: s.views });
    await expect.poll(() => page.evaluate(() => window.__redrawn), { message: `the ${tab} row drawn again under the pointer` }).toEqual({ shown: true, focused: true });
    // The pointer away: the focus keeps the actions up.
    await page.mouse.move(5, 5);
    await expect(row.locator(".bi-hear")).toBeFocused();
    await expect(acts).toHaveCSS("opacity", "1");
    await expect(row).not.toHaveClass(/\bunder\b/);
    await row.locator(".bi-hear").blur();
  }
  // The views handed to main as the pointer leaves the bank, in the leave's
  // capture, before the hold's own listener ends the hold: held, they land as
  // it leaves, whatever the runner's speed. The row it left hides its actions
  // as on any leave, held up by nothing.
  const row = page.locator(`#bank-list .bank-item[data-id="${third}"]`);
  await row.locator(".bi-name").hover();
  await expect(row.locator(".bi-acts")).toHaveCSS("opacity", "1");
  await watchRedraw(page, `#bank-list .bank-item[data-id="${third}"]`);
  await page.evaluate((views) => {
    document.getElementById("bank-list").addEventListener("pointerleave", () => window.__tap.inject({ type: "taste_views", views }), { capture: true, once: true });
  }, s.views);
  await page.mouse.move(5, 5);
  await expect.poll(() => page.evaluate(() => window.__redrawn), { message: "the pool drawn as the pointer left" }).not.toBeNull();
  await page.evaluate(() => document.activeElement?.blur?.());
  await expect(row).not.toHaveClass(/\bunder\b/);
  await expect(row.locator(".bi-acts")).toHaveCSS("opacity", "0");
});
