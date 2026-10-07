// A bank row's actions exist on approach, as the mock draws them (Plan-008
// PR B): compare, ▶, ★, save and cut sit over the row's end when the pointer
// is on it or the keyboard cursor is, and not at rest, when they can't be
// pressed either. Cut can then be pressed. Its reveal rules once lost to the
// rule that hides it (CSS specificity), so the control could never appear.
// ★ folds the five stars out in the actions' place, and a star rates. And
// m in the list saves the row under the cursor once a press, held or not.
const { test, expect, bankTab } = require("./fixtures");

test("a bank row's cut appears on hover and can be pressed", async ({ page, app }) => {
  await app.boot();
  const row = page.locator("#bank-list .bank-item:not(.saved):not(.live)").first();
  await app.engine((timeout) => expect(row).toBeVisible({ timeout }));
  const acts = row.locator(".bi-acts");
  const cut = row.locator(".bi-kill");
  // At rest: not drawn, and not live under the pointer either.
  await page.mouse.move(5, 5);
  await expect(acts).toHaveCSS("opacity", "0");
  await expect(cut).toBeHidden();
  await row.hover();
  await expect(acts).toHaveCSS("opacity", "1");
  await expect(cut).toBeVisible();
  await cut.click();
  await expect(page.locator("#toasts .toast").last()).toContainText(/^Cut /);
});

test("a bank row's actions show on the keyboard cursor, and its ★ folds out the five stars, which rate it", async ({ page, app }) => {
  await app.boot();
  await app.engine((timeout) => expect(page.locator("#bank-list .bank-item[data-id]").first()).toBeVisible({ timeout }));
  await page.mouse.move(5, 5);
  // The list is one tab stop; ↓ puts the cursor on its first row, and the
  // row's actions show there.
  await page.locator("#bank-list").focus();
  await page.keyboard.press("ArrowDown");
  const row = page.locator("#bank-list .bank-item.kbd");
  await expect(row).toHaveCount(1);
  await expect(row.locator(".bi-acts")).toHaveCSS("opacity", "1");
  // ★ (unrated): the stars fold out in the actions' place.
  const id = await row.getAttribute("data-id");
  const r = page.locator(`#bank-list .bank-item[data-id="${id}"]`);
  await r.hover();
  await expect(r.locator(".bi-star")).toHaveAttribute("aria-pressed", "false");
  await r.locator(".bi-star").click();
  await expect(r).toHaveClass(/\brating\b/);
  await expect(r.locator(".bi-save")).toBeHidden();
  await r.locator('.star[data-s="4"]').click();
  await expect(page.locator("#toasts .toast").last()).toContainText(/Rated .+ 4★\./);
  // Rated: the stars fold back, and ★ says it is rated.
  await expect(r).not.toHaveClass(/\brating\b/);
  await expect(r.locator(".bi-star")).toHaveAttribute("aria-pressed", "true");
  await expect(r.locator(".star.lit")).toHaveCount(4);
  // 1–5 still rate the cursor row without it.
  await page.locator("#bank-list").focus();
  await page.keyboard.press("2");
  await expect(page.locator("#toasts .toast").last()).toContainText(/Rated .+ 2★\./);
  await expect(r.locator(".star.lit")).toHaveCount(2);
});

// m in the list saves the sound under the cursor, as the global m does. Held,
// the key repeats, and the list's m answered every repeat: the sound was
// saved or released again each time, each with a toast about it, and the
// lane shows every one of those in turn (#183). A press saves once.
test("a held m in the bank list saves the sound once, not again on every repeat", async ({ page, app }) => {
  await app.boot();
  await app.engine((timeout) => expect(page.locator("#bank-list .bank-item[data-id]").first()).toBeVisible({ timeout }));
  await page.mouse.move(5, 5);
  await page.locator("#bank-list").focus();
  await page.keyboard.press("ArrowDown");
  const row = page.locator("#bank-list .bank-item.kbd");
  await expect(row).toHaveCount(1);
  const id = Number(await row.getAttribute("data-id"));
  const sent0 = await app.sentCount("set_pinned");
  const t0 = await app.now();
  await page.keyboard.press("m");
  const first = await app.reply("pinned", { after: t0 });
  expect(first.id).toBe(id);
  // The key held down: the keydowns a browser sends while it repeats.
  await page.locator("#bank-list").evaluate((el) => {
    for (let i = 0; i < 5; i++) {
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "m", repeat: true, bubbles: true, cancelable: true }));
    }
  });
  // Pressed again, it does the other half of the toggle. The engine answers
  // in order, so by this reply anything a repeat sent has been answered too.
  const t1 = await app.now();
  await page.keyboard.press("m");
  const second = await app.reply("pinned", { after: t1 });
  expect(second.pinned, "a repeat saved or released the sound").toBe(!first.pinned);
  expect(await app.sentCount("set_pinned") - sent0, "a repeat asked the engine again").toBe(2);
});

// The pool stands in the order it joined at rest, so the sound boot opens,
// or one opened from elsewhere (here EVOLVE's OPEN IN PATCH), can be anywhere
// in the list: its row is brought into view.
test("a sound opened from outside the bank has its row brought into the bank's view", async ({ page, app }) => {
  // Short enough that the full pool's 40 rows must scroll.
  await page.setViewportSize({ width: 1440, height: 700 });
  // The bank whole (`filled`), so the list is as long as it will be and
  // nothing still arriving moves it. A cold boot, not one that reuses
  // renders (fixtures.js `reuseRenders`): card A is EVOLVE's first pair's,
  // dealt as the app turns playable, from the sounds there are by then.
  await app.boot();
  await app.filled();
  await expect.poll(() => page.locator("#bank-list .bank-item[data-id]").count()).toBe(40);
  const inView = (id) => page.evaluate((i) => {
    const r = document.querySelector(`#bank-list .bank-item[data-id="${i}"]`);
    if (!r) return false;
    const a = document.getElementById("bank-list").getBoundingClientRect();
    const b = r.getBoundingClientRect();
    return b.bottom > a.top + 1 && b.top < a.bottom - 1;
  }, id);
  // EVOLVE's card A, by its id, its row scrolled out of the bank's view.
  await page.locator('.rail-stop[data-level="evolve"]').click();
  await app.engine((timeout) => expect(page.locator("#choose-a")).toBeEnabled({ timeout }));
  const id = await page.evaluate(() => (document.querySelector("#name-a .dn-id")?.textContent || "").replace("#", "").trim());
  await expect(page.locator(`#bank-list .bank-item[data-id="${id}"]`), "card A's row in the pool").toHaveCount(1);
  // The scroll end that hides the row: the top if the row starts below one
  // list's height, else the bottom if it ends above the last screenful.
  const end = await page.evaluate((i) => {
    const list = document.getElementById("bank-list");
    const r = document.querySelector(`#bank-list .bank-item[data-id="${i}"]`);
    const top = r.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
    const max = list.scrollHeight - list.clientHeight;
    if (max < r.offsetHeight) return { err: `the list does not scroll: ${list.scrollHeight} px in ${list.clientHeight}` };
    if (top >= list.clientHeight) return { to: 0 };
    if (top + r.offsetHeight <= max) return { to: max };
    return { err: `no scroll end hides a row at ${top} px (list ${list.clientHeight} of ${list.scrollHeight})` };
  }, id);
  expect(end.err, end.err).toBeUndefined();
  // (Set again until it holds: a smooth scroll already under way would win.)
  await expect.poll(async () => {
    await page.evaluate(([to]) => document.getElementById("bank-list").scrollTo({ top: to, behavior: "instant" }), [end.to]);
    return inView(id);
  }, { message: "card A's row out of view before it opens" }).toBe(false);
  await page.locator("#promote-a").click();
  await app.engine((timeout) => expect(page.locator(`#bank-list .bank-item[data-id="${id}"]`)).toHaveClass(/\b(live|opening)\b/, { timeout }), { ms: 30_000 });
  await expect.poll(() => inView(id), { timeout: 15_000 }).toBe(true);
});

// A preset row's IN POOL and its ▶ (#130): once a preset is in the pool its
// row says so at its end, and its ▶ shows on approach, with the focus in the
// row, and while it plays. Both read whole in every one of those states, at
// the narrowest window the app allows and a wide one: IN POOL's words inside
// the row and clear of the ▶'s strip (its fade too), and the ▶ inside the
// row. The name keeps its x, the x of every other preset row's name. (IN
// POOL used to be cut by the ▶ wherever the ▶ showed without the pointer on
// the row: with the focus on it, or while it played.) Each state is measured
// as it is drawn, the way text_fits measures a caption's: the pointer, the
// keyboard cursor and the focus for real, the ▶'s playing mark set on it in
// the page.

/** A preset row as drawn: IN POOL's words and the ▶'s strip, as boxes. */
const presetRowDrawn = (row) =>
  row.evaluate((r) => {
    const box = (b) => ({ l: Math.round(b.left * 10) / 10, r: Math.round(b.right * 10) / 10 });
    const tag = r.querySelector(".pb-in");
    const words = document.createRange();
    words.selectNodeContents(tag);
    const acts = r.querySelector(".bi-acts");
    const cs = getComputedStyle(acts);
    const xOf = (n) => Math.round(n.getBoundingClientRect().left - n.closest(".preset-item").getBoundingClientRect().left);
    return {
      row: box(r.getBoundingClientRect()),
      tagShown: getComputedStyle(tag).visibility === "visible",
      words: box(words.getBoundingClientRect()),
      actsShown: cs.visibility === "visible" && cs.opacity === "1",
      acts: box(acts.getBoundingClientRect()),
      hear: box(r.querySelector(".bi-hear").getBoundingClientRect()),
      nameX: xOf(r.querySelector(".bi-name")),
      othersX: [...new Set([...document.querySelectorAll("#bank-list .preset-item:not(.in-bank) .bi-name")].map(xOf))],
    };
  });

/** What the spec asks of a row as drawn, each as a yes or no. */
const inPoolFacts = (d) => ({
  tagShown: d.tagShown,
  tagInRow: d.words.l >= d.row.l && d.words.r <= d.row.r,
  actsShown: d.actsShown,
  tagClearOfActs: d.words.r <= d.acts.l + 0.5,
  hearInRow: d.hear.l >= d.row.l && d.hear.r <= d.row.r,
  namesAtOneX: d.othersX.length === 1,
  nameKeepsX: d.nameX === d.othersX[0],
});
const AT_REST = { tagShown: true, tagInRow: true, actsShown: false, namesAtOneX: true, nameKeepsX: true };
const WITH_PLAY = { ...AT_REST, actsShown: true, tagClearOfActs: true, hearInRow: true };

for (const [width, height] of [[1000, 800], [1440, 900]]) {
  test.describe(`at ${width} px`, () => {
    test.use({ viewport: { width, height } });

    test(`a preset row's IN POOL and its ▶ both read whole at ${width} px, and its name keeps its x`, async ({ page, app }) => {
      await app.boot();
      await bankTab(page, "presets");
      // Heard, a preset joins the pool, and its row says IN POOL.
      const row = page.locator("#bank-list .preset-item").nth(2);
      const index = await row.getAttribute("data-index");
      const at = page.locator(`#bank-list .preset-item[data-index="${index}"]`);
      const acts = at.locator(".bi-acts");
      const hear = at.locator(".bi-hear");
      await row.hover();
      await row.locator(".bi-hear").click();
      await app.engine((timeout) => expect(at.locator(".pb-in")).toBeAttached({ timeout }), { ms: 60_000 });
      await expect(hear).not.toHaveClass(/\bplaying\b/, { timeout: 30_000 });
      // At rest: the pointer away, the focus elsewhere. IN POOL alone.
      await page.mouse.move(5, 5);
      await page.evaluate(() => document.activeElement?.blur?.());
      await expect(acts).toHaveCSS("opacity", "0");
      expect(inPoolFacts(await presetRowDrawn(at)), "at rest").toMatchObject(AT_REST);
      // The pointer on the row.
      await at.hover();
      await expect(acts).toHaveCSS("opacity", "1");
      expect(inPoolFacts(await presetRowDrawn(at)), "under the pointer").toMatchObject(WITH_PLAY);
      // From here to the last state the engine's replies wait (`app.hold`),
      // and are handed to main at the end. A reply that redraws the bank
      // rebuilds this row (the pool's `taste_views` once the fill ends, which
      // this cold boot's can do in any of these steps, among others), and a
      // rebuilt ▶ has lost the focus and the playing mark set on it here.
      await app.hold({});
      // The focus on its ▶, the pointer away: focused while the pointer is
      // on the row, as a press would, then the pointer moved off. A hidden ▶
      // cannot take the focus, and the strip hides `--d-press` after the
      // pointer leaves (its `visibility`), so a focus asked for after the move
      // stayed on the page whenever the move had hidden it first: 3 runs of
      // 20 here, none of 40 since.
      await hear.focus();
      await page.mouse.move(5, 5);
      await expect(acts).toHaveCSS("opacity", "1");
      expect(inPoolFacts(await presetRowDrawn(at)), "with the focus on its ▶").toMatchObject(WITH_PLAY);
      // Playing, the pointer and the focus away: the mark a ▶ pressed on a
      // preset in the pool carries while it sounds, set for as long as this
      // takes to measure.
      await hear.evaluate((b) => { b.blur(); b.classList.add("playing"); });
      await expect(acts).toHaveCSS("opacity", "1");
      expect(inPoolFacts(await presetRowDrawn(at)), "while its ▶ plays").toMatchObject(WITH_PLAY);
      await hear.evaluate((b) => b.classList.remove("playing"));
      // The keyboard's cursor on it: Home, then ↓ to the third row.
      await page.locator("#bank-list").focus();
      await page.keyboard.press("Home");
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("ArrowDown");
      await expect(at).toHaveClass(/\bkbd\b/);
      await expect(acts).toHaveCSS("opacity", "1");
      expect(inPoolFacts(await presetRowDrawn(at)), "under the keyboard's cursor").toMatchObject(WITH_PLAY);
      await app.release();
    });
  });
}
