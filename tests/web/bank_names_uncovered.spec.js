// A bank row's actions and stars never cover its name (#534). A row's hover
// actions sat over its end, and its five stars over its actions' place:
// "Bright Sweep With A Long Name" read "Bright Swe", and a short "Round" went
// under the stars altogether, so the player could not see which sound they
// were about to rate or cut. Now a row is two lines, the name on the first
// with the row's whole width and the actions (or the stars) on the second,
// kept whether they show or not; on a touch tablet they are on that line
// always; on a phone the name gives up the room the swiped actions or the
// stars take.
//
// What this claims, at five sizes, with a short name, a long one and a bred
// sound's (whose row has a compare mark besides), for a mouse hovering the
// row and opening its stars (1440 × 900, 1040 × 700: the bank at 280 and at
// 228 px) and for a finger (a tablet at 1024 × 768, where the bank is 228
// px; a phone at 390 × 844 and on its side at 844 × 390, where the actions
// are swiped out and the stars tapped open):
//
// - No visible action, no star and no strip's own box meets the name's box,
//   and every point across the name (its two ends and its middle), asked of
//   `elementFromPoint`, is the name's. (`elementFromPoint` alone is no proof:
//   the strip takes no pointer between its buttons, so a strip over the name
//   would still answer with the name.)
// - The name's box is as wide under the pointer and with the stars out as at
//   rest, on a mouse's screen and a tablet's: it is never narrowed, so what
//   does not fit ends in an ellipsis wherever it did. On a phone, where the
//   actions take the row's end, it gives up exactly what they take and keeps
//   at least 48 px.
// - The full name is in the name's tooltip, so what an ellipsis hides is
//   reachable.
// - The bank holds still while they show: the row is as tall, and every row
//   after it is where it was, with the actions or the stars out as at rest.
// - Every action is inside the list (on a tablet at 228 px the cut sat past
//   its edge, out of reach).
// - A preset's IN POOL stands clear of its name's column and of its ▶ (and
//   the strip's box) at rest, under a mouse's pointer and in the model view,
//   at every size (on a phone it stood over its ▶).
//
// What it does not claim: the marks. The seed and may-be-replaced words and
// the model view's percentage are said about a row, not pressed, and stand
// over the end of the name's line, as they did (the bank's guide says so).
//
// The rows are named by the rename the player has (a double-click on the
// name), and the bred sound's lineage is handed to main as the engine sends
// it (bank_lineage.spec.js does the same).
//
// Touch is a touch screen's (`hasTouch`), with `isMobile` besides in
// Chromium: Playwright refuses it in Firefox, which with a touch screen alone
// still reports a coarse pointer and lays a phone out by its width.
const { test, expect, bankTab } = require("./fixtures");

const TOUCH = process.env.AURACLE_BROWSER === "firefox" ? { hasTouch: true } : { hasTouch: true, isMobile: true };

// Four rows of the pool, by place: a short name, a bred sound's long one, a
// bred sound's short one and a long one (the rename field's limit is 40).
const NAMES = ["Zed", "Bright Sweep With A Long Name", "Round", "An Extremely Long Name For A Sound Yes"];
const BRED = [1, 2];
/** What a phone's name keeps while its actions are swiped out (px). */
const PHONE_FLOOR = 48;
const FOUR = ["bi-hear", "bi-star", "bi-save", "bi-kill"];
const FIVE = ["bi-cmp", ...FOUR];
const STARS = ["star", "star", "star", "star", "star"];
/** The actions row `i` carries: a bred sound's compare mark besides. */
const actionsOf = (i) => (BRED.includes(i) ? FIVE : FOUR);

/** The pool's rows 2 to 5, named, two of them bred, and the bank where the
 *  size asks it to be (a phone's is a sheet). Their ids. */
async function setUp(page, app, { sheet }) {
  await app.boot({ random: 20260928, reuseRenders: true });
  await app.poolRows(40);
  // A toast stands over a phone's sheet (the boot's "32 more sounds are still
  // arriving" can come after the rows do, and covered a name in Firefox). What
  // this holds is what the row draws over its name: not the lane's.
  await page.addStyleTag({ content: "#toasts { display: none !important; }" });
  if (sheet) {
    await page.locator("#bank-btn").tap();
    await expect(page.locator("body")).toHaveClass(/\bbank-open\b/);
  }
  const ids = await page.locator("#bank-list .bank-item[data-id]").evaluateAll((els) => els.slice(2, 6).map((e) => Number(e.dataset.id)));
  for (const [i, id] of ids.entries()) {
    // The name's own double-click, as the page hears it on any screen (a real
    // one opens the row, which on a phone puts the sheet away).
    await page.locator(`#bank-list .bank-item[data-id="${id}"] .bi-name`).evaluate((e) => e.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    await page.locator("#bank-list input.bi-rename").fill(NAMES[i]);
    await page.keyboard.press("Enter");
    await expect(page.locator(`#bank-list .bank-item[data-id="${id}"] .bi-name`)).toHaveText(NAMES[i]);
  }
  // Only what this posts lands from here: no fill, refit or generation redraws
  // the rows under the measure.
  await app.hold([{ views: true }, "refine_child", "refined", "ranked"]);
  const s = await app.facts();
  const lineage = BRED.map((i) => ({
    generation: 1, kind: "refine", parent_id: s.ranked[0].id, child_id: ids[i],
    diff: [{ addr: "node/0#cut", before: "0.41", after: "0.62" }], parent_utility: 0.4, child_utility: 0.1,
  }));
  await app.inject({ type: "taste_views", views: { ...s.views, lineage: [...(s.lineage || []), ...lineage] } });
  for (const i of BRED) await expect(page.locator(`#bank-list .bank-item[data-id="${ids[i]}"]`)).toHaveClass(/\bbred\b/);
  return ids;
}

const rowOf = (page, id) => page.locator(`#bank-list .bank-item[data-id="${id}"]`);

/** Where the four rows (and the one after them) are from the first, and how
 *  tall: the list may scroll as a finger's tap takes the focus, which moves no
 *  row from another. */
const layout = (page, ids) =>
  page.evaluate((ids) => {
    const rows = ids.map((id) => document.querySelector(`#bank-list .bank-item[data-id="${id}"]`));
    const after = rows[rows.length - 1].nextElementSibling;
    const first = rows[0].getBoundingClientRect().top;
    return [...rows, after].map((r) => { const b = r.getBoundingClientRect(); return { from: Math.round((b.top - first) * 10) / 10, height: Math.round(b.height * 10) / 10 }; });
  }, ids);

/** One row as drawn: the name's box, whether a point across it is the name's,
 *  and the boxes of what shows over the row (the strip and each visible
 *  button), and the list's. */
const drawn = (page, id) =>
  page.evaluate(async (id) => {
    const row = document.querySelector(`#bank-list .bank-item[data-id="${id}"]`);
    // In the list's view, where a point on the name is the list's and not
    // what stands under its edge (a finger's tap takes the focus, and a short
    // list scrolls to it), and drawn where it will stay: the strip's slide out
    // and fade in are done (none runs under reduced motion).
    row.scrollIntoView({ block: "nearest", behavior: "instant" });
    await Promise.all(row.querySelector(".bi-acts").getAnimations().map((a) => a.finished));
    const name = row.querySelector(".bi-name");
    const box = (e) => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom }; };
    const visible = (e) => { const cs = getComputedStyle(e); const b = e.getBoundingClientRect(); return cs.visibility === "visible" && cs.display !== "none" && b.width > 1 && b.height > 1; };
    const strip = row.querySelector(".bi-acts");
    const cs = getComputedStyle(strip);
    const nb = box(name);
    const y = (nb.t + nb.b) / 2;
    // What answers at each point, as the name's own or as what stands there.
    const hits = [nb.l + 2, (nb.l + nb.r) / 2, nb.r - 2].map((x) => {
      const hit = document.elementFromPoint(x, y);
      return !!hit && (hit === name || name.contains(hit)) ? "the name" : `${hit?.tagName}.${hit?.className} at ${Math.round(x)}, ${Math.round(y)}${hit?.closest(".toast") ? `, a toast: ${hit.closest(".toast").textContent.trim()}` : ""}`;
    });
    return {
      name: nb,
      text: name.textContent,
      title: name.title,
      overflows: name.scrollWidth > name.clientWidth,
      hits,
      strip: cs.visibility === "visible" && Number(cs.opacity) > 0 && visible(strip) ? box(strip) : null,
      buttons: [...row.querySelectorAll(".bi-acts button")].filter(visible).map((b) => ({ kind: b.className.replace(/\s.*/, ""), ...box(b) })),
      list: box(document.getElementById("bank-list")),
    };
  }, id);

/** `a` and `b` share no area. */
const apart = (a, b) => a.r <= b.l + 0.5 || b.r <= a.l + 0.5 || a.b <= b.t + 0.5 || b.b <= a.t + 0.5;

/** What every state of a row owes: nothing over the name, the name's text
 *  across it, its full text in its tooltip, every action in the list. */
function uncovered(d, what) {
  for (const over of [...(d.strip ? [{ kind: "the strip", ...d.strip }] : []), ...d.buttons]) {
    expect(apart(d.name, over), `${what}: ${over.kind} (${Math.round(over.l)}–${Math.round(over.r)}, ${Math.round(over.t)}–${Math.round(over.b)}) is over the name (${Math.round(d.name.l)}–${Math.round(d.name.r)}, ${Math.round(d.name.t)}–${Math.round(d.name.b)})`).toBe(true);
  }
  expect(d.hits, `${what}: the name answers across it (its left, middle and right)`).toEqual(["the name", "the name", "the name"]);
  expect(d.title, `${what}: the full name is in its tooltip`).toContain(d.text);
  for (const b of d.buttons) {
    expect(b.l, `${what}: ${b.kind} is inside the list's left edge`).toBeGreaterThanOrEqual(d.list.l - 0.5);
    expect(b.r, `${what}: ${b.kind} is inside the list's right edge`).toBeLessThanOrEqual(d.list.r + 0.5);
  }
}

/** The bank held still: each row the height and place it had at rest. */
function still(now, rest, what) {
  expect(now, `${what}: the rows' places and heights`).toEqual(rest);
}

const width = (d) => d.name.r - d.name.l;

// ---- a preset's IN POOL ----

/** The app booted with its pool whole and no toast over the rows. */
async function readyBank(page, app) {
  await app.boot({ random: 20260928, reuseRenders: true });
  await app.poolRows(40);
  await page.addStyleTag({ content: "#toasts { display: none !important; }" });
}

/** The third preset heard, which puts it in the pool and its row says IN POOL
 *  (`bank_row.spec.js` does the same), then the engine's replies held, so no
 *  redraw takes the row from under a measure. Its index. A finger taps the
 *  ▶, which a phone and a tablet show at rest; a mouse's pointer goes to it. */
async function presetInPool(page, app, { finger }) {
  await bankTab(page, "presets");
  const index = await page.locator("#bank-list .preset-item").nth(2).getAttribute("data-index");
  const at = page.locator(`#bank-list .preset-item[data-index="${index}"]`);
  await at.hover();
  await (finger ? at.locator(".bi-hear").tap() : at.locator(".bi-hear").click());
  await app.engine((timeout) => expect(at.locator(".pb-in")).toBeAttached({ timeout }), { ms: 60_000 });
  // Its sound has come and gone: a ▶ still waiting on it, or sounding, keeps
  // its strip shown, and the held replies would keep it waiting.
  await expect(at.locator(".bi-hear")).not.toHaveClass(/\b(loading|playing|pending)\b/, { timeout: 30_000 });
  await app.hold({});
  return index;
}

/** The model view, held as a keyboard holds it (⌥), for the rest of the test:
 *  a phone's sheet stands over MODEL. */
const modelViewHeld = async (page) => {
  await page.keyboard.down("Alt");
  await expect(page.locator("body")).toHaveClass(/\bmodel-view\b/);
};

/** The preset row's IN POOL words, its name's column and what else shows:
 *  each visible button and the strip, as boxes. */
const inPoolDrawn = (page, index) =>
  page.evaluate((index) => {
    const row = document.querySelector(`#bank-list .preset-item[data-index="${index}"]`);
    row.scrollIntoView({ block: "nearest", behavior: "instant" });
    const box = (b) => ({ l: b.left, r: b.right, t: b.top, b: b.bottom });
    const visible = (e) => { const cs = getComputedStyle(e); const b = e.getBoundingClientRect(); return cs.visibility === "visible" && cs.display !== "none" && b.width > 1 && b.height > 1; };
    const words = document.createRange();
    words.selectNodeContents(row.querySelector(".pb-in"));
    const strip = row.querySelector(".bi-acts");
    const cs = getComputedStyle(strip);
    return {
      row: box(row.getBoundingClientRect()),
      column: box(row.querySelector(".bi-top").getBoundingClientRect()),
      words: box(words.getBoundingClientRect()),
      shown: visible(row.querySelector(".pb-in")),
      strip: cs.visibility === "visible" && Number(cs.opacity) > 0 && visible(strip) ? box(strip.getBoundingClientRect()) : null,
      buttons: [...strip.querySelectorAll("button")].filter(visible).map((b) => ({ kind: b.className.replace(/\s.*/, ""), ...box(b.getBoundingClientRect()) })),
    };
  }, index);

/** IN POOL read whole and clear of the name's column and of the ▶ with its
 *  strip, wherever the ▶ shows, inside the row. */
function inPoolClear(d, what) {
  expect(d.shown, `${what}: IN POOL shows`).toBe(true);
  expect(d.words.r - d.words.l, `${what}: IN POOL has its words`).toBeGreaterThan(20);
  expect(d.words.l, `${what}: IN POOL is inside the row's left edge`).toBeGreaterThanOrEqual(d.row.l);
  expect(d.words.r, `${what}: IN POOL is inside the row's right edge`).toBeLessThanOrEqual(d.row.r);
  expect(apart(d.words, d.column), `${what}: IN POOL (${Math.round(d.words.l)}–${Math.round(d.words.r)}) is clear of the name's column (${Math.round(d.column.l)}–${Math.round(d.column.r)})`).toBe(true);
  for (const over of [...(d.strip ? [{ kind: "the strip", ...d.strip }] : []), ...d.buttons]) {
    expect(apart(d.words, over), `${what}: IN POOL (${Math.round(d.words.l)}–${Math.round(d.words.r)}) is clear of ${over.kind} (${Math.round(over.l)}–${Math.round(over.r)})`).toBe(true);
  }
}

// ---- a mouse ----

for (const [w, h, bank] of [[1440, 900, 280], [1040, 700, 228]]) {
  test.describe(`a mouse at ${w} × ${h} (the bank ${bank} px)`, () => {
    test.use({ viewport: { width: w, height: h } });

    test(`hovering a row or opening its stars covers no name at ${w} px, and moves no row`, async ({ page, app }) => {
      const ids = await setUp(page, app, { sheet: false });
      await page.mouse.move(5, 5);
      const rest = await layout(page, ids);
      for (const [i, id] of ids.entries()) {
        const row = rowOf(page, id);
        await row.scrollIntoViewIfNeeded();
        await page.mouse.move(5, 5);
        const resting = await layout(page, ids);
        const at = await drawn(page, id);
        expect(at.strip, "at rest the actions are away").toBeNull();
        uncovered(at, `${NAMES[i]} at rest`);

        // The pointer on the row: its actions show on the line under the name.
        await row.hover();
        await expect(row.locator(".bi-acts")).toHaveCSS("opacity", "1");
        await expect(row.locator(".bi-kill")).toBeVisible();
        const hovered = await drawn(page, id);
        expect(hovered.buttons.map((b) => b.kind), `${NAMES[i]}: the actions shown`).toEqual(actionsOf(i));
        uncovered(hovered, `${NAMES[i]} hovered`);
        expect(width(hovered), `${NAMES[i]} hovered: the name's box is as wide as at rest`).toBe(width(at));
        still(await layout(page, ids), resting, `${NAMES[i]} hovered`);

        // ★: the five stars in the actions' place.
        await row.locator(".bi-star").click();
        await expect(row).toHaveClass(/\brating\b/);
        await expect(row.locator(".stars")).toBeVisible();
        const stars = await drawn(page, id);
        expect(stars.buttons.map((b) => b.kind), `${NAMES[i]}: the stars shown`).toEqual(STARS);
        uncovered(stars, `${NAMES[i]} with its stars out`);
        expect(width(stars), `${NAMES[i]} with its stars out: the name's box is as wide as at rest`).toBe(width(at));
        still(await layout(page, ids), resting, `${NAMES[i]} with its stars out`);
        // The name that does not fit still ends in an ellipsis, and the one
        // that does has all its text.
        expect(stars.overflows, `${NAMES[i]}: whether it ends in an ellipsis`).toBe(at.overflows);
        await page.keyboard.press("Escape");
        await expect(row).not.toHaveClass(/\brating\b/);
      }
      // The rows are where they were before any of it.
      await page.mouse.move(5, 5);
      await expect.poll(() => layout(page, ids), { message: "the rows are where they were before any of it" }).toEqual(rest);
      // A name this long does not fit at 228 px: it ends in an ellipsis, as
      // it does at rest, and the bank at 280 px holds all but the longest.
      const long = await drawn(page, ids[3]);
      expect(long.overflows, "the 38-character name ends in an ellipsis").toBe(true);
    });

    test(`a preset's IN POOL stands clear of its name's column and its ▶ at ${w} px, at rest, under the pointer and in the model view`, async ({ page, app }) => {
      await readyBank(page, app);
      const index = await presetInPool(page, app, { finger: false });
      const row = page.locator(`#bank-list .preset-item[data-index="${index}"]`);
      // At rest: the pointer away and the focus off the ▶ that heard it.
      await page.mouse.move(5, 5);
      await page.evaluate(() => document.activeElement?.blur?.());
      await expect(row.locator(".bi-acts")).toHaveCSS("opacity", "0");
      inPoolClear(await inPoolDrawn(page, index), "at rest");
      await row.hover();
      await expect(row.locator(".bi-acts")).toHaveCSS("opacity", "1");
      const hovered = await inPoolDrawn(page, index);
      expect(hovered.buttons.map((b) => b.kind), "the ▶ shows under the pointer").toEqual(["bi-hear"]);
      inPoolClear(hovered, "under the pointer");
      await page.mouse.move(5, 5);
      await modelViewHeld(page);
      await expect(row.locator(".bi-acts")).toHaveCSS("opacity", "0");
      inPoolClear(await inPoolDrawn(page, index), "in the model view");
    });
  });
}

// ---- a finger ----

/** A finger on `row`'s name moved sideways by `dx` px in steps, then lifted
 *  (bank_swipe.spec.js's: the page's own handling, not the browser's scroll). */
const swipe = (row, dx) => row.evaluate((el, dx) => {
  const r = el.querySelector(".bi-name").getBoundingClientRect();
  const x0 = r.left + 10;
  const y = r.top + r.height / 2;
  const at = (x) => {
    try {
      return [new Touch({ identifier: 3, target: el, clientX: x, clientY: y })];
    } catch {
      return [{ identifier: 3, target: el, clientX: x, clientY: y }];
    }
  };
  const fire = (type, x, list) => {
    let e;
    try {
      e = new TouchEvent(type, { bubbles: true, cancelable: true, touches: list, targetTouches: list, changedTouches: at(x) });
    } catch {
      e = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(e, "touches", { value: list });
      Object.defineProperty(e, "changedTouches", { value: at(x) });
    }
    el.dispatchEvent(e);
  };
  fire("touchstart", x0, at(x0));
  for (let i = 1; i <= 6; i++) fire("touchmove", x0 + (dx * i) / 6, at(x0 + (dx * i) / 6));
  fire("touchend", x0 + dx, []);
}, dx);

test.describe("a touch tablet at 1024 × 768 (the bank 228 px)", () => {
  test.use({ viewport: { width: 1024, height: 768 }, ...TOUCH });

  test("a tablet's actions and stars, on their line under the name, cover no name, reach every action and move no row", async ({ page, app }) => {
    const ids = await setUp(page, app, { sheet: false });
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches), "a coarse pointer").toBe(true);
    const rest = await layout(page, ids);
    for (const [i, id] of ids.entries()) {
      const row = rowOf(page, id);
      await row.scrollIntoViewIfNeeded();
      const resting = await layout(page, ids);
      const at = await drawn(page, id);
      // On a touch screen they are there at rest.
      expect(at.buttons.map((b) => b.kind), `${NAMES[i]}: the actions at rest`).toEqual(actionsOf(i));
      uncovered(at, `${NAMES[i]} at rest`);
      await row.locator(".bi-star").tap();
      await expect(row).toHaveClass(/\brating\b/);
      await expect(row.locator(".stars")).toBeVisible();
      const stars = await drawn(page, id);
      expect(stars.buttons.map((b) => b.kind), `${NAMES[i]}: the stars shown`).toEqual(STARS);
      uncovered(stars, `${NAMES[i]} with its stars out`);
      expect(width(stars), `${NAMES[i]} with its stars out: the name's box is as wide as at rest`).toBe(width(at));
      still(await layout(page, ids), resting, `${NAMES[i]} with its stars out`);
      await page.keyboard.press("Escape");
      await expect(row).not.toHaveClass(/\brating\b/);
    }
    await expect.poll(() => layout(page, ids), { message: "the rows are where they were before any of it" }).toEqual(rest);
  });

  test("a tablet's preset keeps its name's column clear of IN POOL, and IN POOL clear of its ▶", async ({ page, app }) => {
    await readyBank(page, app);
    const index = await presetInPool(page, app, { finger: true });
    const at = await inPoolDrawn(page, index);
    expect(at.buttons.map((b) => b.kind), "the ▶ is there at rest").toEqual(["bi-hear"]);
    inPoolClear(at, "at rest");
    await modelViewHeld(page);
    inPoolClear(await inPoolDrawn(page, index), "in the model view");
  });
});

for (const [w, h] of [[390, 844], [844, 390]]) {
  test.describe(`a phone at ${w} × ${h}`, () => {
    test.use({ viewport: { width: w, height: h }, ...TOUCH });

    test(`a phone's swiped actions and its stars give the name their room at ${w} × ${h}, cover none, and move no row`, async ({ page, app }) => {
      const ids = await setUp(page, app, { sheet: true });
      for (const [i, id] of ids.entries()) {
        const row = rowOf(page, id);
        await row.scrollIntoViewIfNeeded();
        const resting = await layout(page, ids);
        // At rest: the name and the ▶ at the row's end.
        const at = await drawn(page, id);
        expect(at.buttons.map((b) => b.kind), `${NAMES[i]}: at rest only the ▶`).toEqual(["bi-hear"]);
        uncovered(at, `${NAMES[i]} at rest`);

        // Swiped left: the other actions slide out beside it.
        await swipe(row, -120);
        await expect(row).toHaveClass(/\bacts-open\b/);
        await expect(row.locator(".bi-kill")).toBeVisible();
        const open = await drawn(page, id);
        expect(open.buttons.map((b) => b.kind), `${NAMES[i]}: the actions swiped out`).toEqual(actionsOf(i));
        uncovered(open, `${NAMES[i]} swiped`);
        expect(width(open), `${NAMES[i]} swiped: the name keeps ${PHONE_FLOOR} px or its own width`).toBeGreaterThanOrEqual(Math.min(PHONE_FLOOR, width(at)));
        still(await layout(page, ids), resting, `${NAMES[i]} swiped`);

        // ★ tapped: the stars in their place.
        await row.locator(".bi-star").tap();
        await expect(row).toHaveClass(/\brating\b/);
        await expect(row.locator(".stars")).toBeVisible();
        const stars = await drawn(page, id);
        expect(stars.buttons.map((b) => b.kind), `${NAMES[i]}: the stars shown`).toEqual(STARS);
        uncovered(stars, `${NAMES[i]} with its stars out`);
        expect(width(stars), `${NAMES[i]} with its stars out: the name keeps ${PHONE_FLOOR} px or its own width`).toBeGreaterThanOrEqual(Math.min(PHONE_FLOOR, width(at)));
        still(await layout(page, ids), resting, `${NAMES[i]} with its stars out`);
        await page.keyboard.press("Escape");
        await expect(row).not.toHaveClass(/\brating\b/);
      }
    });

    test(`a phone's preset keeps its name's column clear of IN POOL, and IN POOL clear of its ▶, at ${w} × ${h}`, async ({ page, app }) => {
      await readyBank(page, app);
      await page.locator("#bank-btn").tap();
      await expect(page.locator("body")).toHaveClass(/\bbank-open\b/);
      const index = await presetInPool(page, app, { finger: true });
      const at = await inPoolDrawn(page, index);
      expect(at.buttons.map((b) => b.kind), "the ▶ is at the row's end at rest").toEqual(["bi-hear"]);
      inPoolClear(at, "at rest");
      await modelViewHeld(page);
      inPoolClear(await inPoolDrawn(page, index), "in the model view");
    });
  });
}
