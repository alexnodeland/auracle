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
//   was pressed on.
// - A redraw keeps the focus on the ▶ that had it, and a preset's ▶ playing
//   keeps its mark.
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
    expect(await topOf(page, under), "the row under the moving pointer").toBe(landed.before);
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
  const landed = await landNow(page, rows[3], childReply(s, rows[rows.length - 1], (s.status.generation || 0) + 1));
  expect(landed.after, "the cursor's row, as the child landed").toBe(landed.before);
  // A second after the last key the child lands; the cursor's row stays put
  // and keeps the cursor.
  await expect(page.locator("#bank-list .bank-group.new")).toBeVisible();
  await expect.poll(() => topOf(page, rows[3])).toBeCloseTo(landed.before, 0);
  await expect(cursor).toHaveAttribute("data-id", String(rows[3]));
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
  // A knob turned on the rack; its reply waits (`app.hold`) while a preset
  // row is pressed, lands, and then the press is released.
  const knob = await page.evaluate(() => {
    const hit = [...document.querySelectorAll("#rack-svg g[data-addr] > .knob-hit")].map((h) => h.getBoundingClientRect()).find((r) => r.width > 0 && r.top > 0 && r.bottom < innerHeight);
    return hit && { x: hit.x + hit.width / 2, y: hit.y + hit.height / 2 };
  });
  expect(knob, "a knob on screen").toBeTruthy();
  await app.hold(["bench"]);
  const t0 = await app.now();
  await page.mouse.move(knob.x, knob.y);
  await page.mouse.down();
  await page.mouse.move(knob.x, knob.y - 20, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await app.held()).filter((h) => h.type === "bench").length).toBeGreaterThan(0);
  const row = page.locator("#bank-list .preset-item:not(.in-bank)").nth(3);
  const index = Number(await row.getAttribute("data-index"));
  await row.scrollIntoViewIfNeeded();
  const box = await row.locator(".bi-name").boundingBox();
  await page.mouse.move(box.x + 4, box.y + box.height / 2);
  await page.mouse.down();
  await app.release();
  await expect.poll(() => app.count("bench")).toBeGreaterThan(0);
  await expect.poll(async () => (await app.replies("bench", { after: t0 })).length).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__rebuilt), "the preset list rebuilt by the knob's reply").toBe(0);
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
