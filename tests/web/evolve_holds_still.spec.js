// EVOLVE holds still under the hand (#312, ADR-025):
//
// - ⚡'s child opens itself on the bench only when the bench still holds its
//   seed, nothing was opened since the press, and nothing sounds. Over notes
//   held, or a sound opened since, it waits in the bank and the toast says
//   why, with OPEN IT, which opens it.
// - A generation's end that replaces a side of the pair on the table leaves
//   the pair standing: that side says it was replaced and goes quiet, and
//   the next pick says it taught nothing and puts up the next pair.
//
// The engine's own ⚡ answer is held (`app.hold`) and one is posted as the
// worker posts it (`app.inject`), with a child from the pool, so the test
// does not wait out a walk or depend on one breeding. The pair is read off
// the cards, and the generation's end is posted in the cards' own task.
const { test, expect, goLevel, bankTab } = require("./fixtures");

/** The pool sound on the bench, once one is. */
async function benchId(app) {
  let id = null;
  await app.engine((timeout) => expect.poll(async () => {
    // eslint-disable-next-line playwright/no-useless-await -- app.last is the tap's (a promise), not Locator.last()
    const b = await app.last("bench");
    return (id = b?.subject ?? null);
  }, { timeout }).not.toBeNull(), { ms: 60_000 });
  return id;
}

/** ⚡'s answer as the worker posts it: `childId` bred from `seedId`. */
async function zapLands(app, seedId, childId) {
  const s = await app.facts();
  await app.inject({ type: "evolved_from", seedId, childId, reason: null, views: s.views, status: s.status });
}

const opened = async (app, id, after) => (await app.sent({ type: "edit_begin", id }, { after })).length;

test("⚡'s child opens itself only with nothing in the hand, and else says why with OPEN IT", async ({ page, app }) => {
  await app.boot({ random: 20260928, reuseRenders: true });
  await app.engine((timeout) => expect.poll(async () => ((await app.facts()).ranked || []).length, { timeout }).toBeGreaterThanOrEqual(40), { ms: 60_000 });
  await app.hold(["evolved_from", { views: true }]);
  await goLevel(page, "patch");
  await app.engine((timeout) => expect(page.locator("#rack-evolve")).toBeEnabled({ timeout }), { ms: 60_000 });
  const seed = await benchId(app);
  const pool = (await app.facts()).ranked.map((r) => r.id).filter((id) => id !== seed);
  await page.locator("#rack-evolve").click();
  await expect.poll(async () => (await app.sent({ type: "refine_from", id: seed })).length).toBe(1);
  await page.mouse.move(5, 5);

  // Nothing in the hand: the child opens itself.
  let t = await app.now();
  await zapLands(app, seed, pool[0]);
  await expect.poll(() => opened(app, pool[0], t), { message: "the child opened itself" }).toBe(1);
  await app.engine((timeout) => expect.poll(() => benchId(app), { timeout }).toBe(pool[0]), { ms: 60_000 });

  // A note held: the child waits, and the toast says why.
  await page.locator("#rack-svg").hover();
  await page.mouse.move(5, 5);
  let mark = await app.toastMark();
  t = await app.now();
  await page.keyboard.down("a");
  await zapLands(app, pool[0], pool[1]);
  // The clean case's "ready to play" can still be on its way into the
  // lane: this one is told by its own words.
  await app.toast(/^⚡ bred .*, and what you’re playing goes on\./, { since: mark });
  await page.keyboard.up("a");
  await app.quiet();
  expect(await opened(app, pool[1], t), "the child opened over a held note").toBe(0);

  // Another sound opened since: the child waits, OPEN IT opens it.
  await bankTab(page, "pool");
  await page.locator(`#bank-list .bank-item[data-id="${pool[2]}"] .bi-name`).click();
  await app.engine((timeout) => expect.poll(() => benchId(app), { timeout }).toBe(pool[2]), { ms: 60_000 });
  mark = await app.toastMark();
  t = await app.now();
  await zapLands(app, pool[0], pool[3]);
  const name = (await app.facts()).names[pool[2]];
  await app.toast(`, and ${name} is still the sound in hand.`, { since: mark });
  expect(await opened(app, pool[3], t), "the child opened over the sound opened since").toBe(0);
  await page.locator("#toasts .toast button", { hasText: /open it/i }).last().click();
  await expect.poll(() => opened(app, pool[3], t), { message: "OPEN IT opened the child" }).toBe(1);
});

test("a generation's end that replaces a side of the pair on the table leaves the pair up, and the next pick deals the next", async ({ page, app }) => {
  await app.boot({ random: 20260928 });
  await goLevel(page, "evolve");
  await app.engine((timeout) => expect(page.locator("#choose-a")).toBeEnabled({ timeout }), { ms: 60_000 });
  // Only what the test posts changes the pool from here.
  await app.hold([{ views: true }, "refine_child", "refined"]);
  const s = await app.facts();
  const was = await page.evaluate((s) => {
    const ids = () => ["a", "b"].map((x) => Number(document.querySelector(`#name-${x} .dn-id`).textContent.replace("#", "")));
    const pair = ids();
    window.__tap.inject({
      type: "refined", views: { ...s.views, ranked: s.ranked.filter((r) => r.id !== pair[0]) },
      status: { ...s.status, generation: (s.status.generation || 0) + 1 }, born: [], retired: [pair[0]], reasons: [],
    });
    return { pair, now: ids(), gone: document.getElementById("duel-a").classList.contains("gone") };
  }, s);
  expect(was.now, "the pair on the table, as the generation ended").toEqual(was.pair);
  expect(was.gone).toBe(true);
  await expect(page.locator("#fam-a")).toHaveText("Replaced in the pool. A pick or ANOTHER PAIR deals the next pair.");
  await expect(page.locator("#play-a")).toBeDisabled();
  await expect(page.locator("#promote-a")).toBeDisabled();
  await expect(page.locator("#play-b")).toBeEnabled();
  await expect(page.locator("#choose-a")).toBeEnabled();
  // The table stays as it is while nothing is pressed.
  await app.quiet();
  const ids = () => page.evaluate(() => ["a", "b"].map((x) => Number(document.querySelector(`#name-${x} .dn-id`).textContent.replace("#", ""))));
  expect(await ids()).toEqual(was.pair);
  // A pick on it teaches nothing, says so, and puts up the next pair.
  const mark = await app.toastMark();
  const t = await app.now();
  await page.locator("#choose-b").click();
  await app.toast(/was replaced, so that pick taught nothing\. Here is the next pair\.$/, { since: mark });
  await app.engine((timeout) => expect.poll(ids, { timeout }).not.toEqual(was.pair), { ms: 30_000 });
  await expect(page.locator("#duel-a")).not.toHaveClass(/\bgone\b/);
  expect(await app.sent({ type: "record_duel" }, { after: t }), "a vote sent for a pair with a side gone").toEqual([]);
});
