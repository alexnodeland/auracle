// EVOLVE says what is true, and its gestures mean one thing (the interaction
// spec's Wave 0, "true today").
//
// - ⌘Z outside PATCH never reaches the PATCH edit undo: with no pick or cut
//   to take back it says so and changes nothing. It used to fall through and
//   revert a knob turned minutes earlier on a patch the player could not see.
// - The sixth pick is undoable like the other five: its refit waits for its
//   window. It used to be committed the moment the next pair landed.
// - "● it just learned" appears only once `fitted` has answered, and stays
//   until the next pick. It used to appear when the refit was *sent*.
// - "another pair" (↻) with no pair dealt ahead puts the pair away like a
//   pick does: inert buttons, ▶ and the cards' corners among them, and after
//   300 ms a reason on the cards. It used to leave the old pair up with
//   buttons that looked live and did nothing. A deal that comes back empty
//   (no pair left to deal) leaves them off, and the cards say why at once
//   (#195).
// - A cut patch is never dealt again, and its toast names it without an id.
//   Which answers a cut keeps from going up, wherever they land (a deal
//   asked for while the cut was taken back, which rightly did not exclude
//   it; the fourth try of a waiting table, which used to go up anyway), is
//   deal.js's rule, unit-tested in apps/web/tests/deal.test.mjs.
// - After clicking the EVOLVE tab, → picks.
// - An open is not announced unless it kept the player waiting: "Opened …"
//   is said exactly when the app's own mark for the open says it waited over
//   `OPEN_SAID_MS` (main.js), however quick or slow the machine made it.
//
// The engine worker is reached through the fixture's tap (fixtures.js): a
// request held back for a moment (`app.delay`) stands in for an engine busy
// with a generation, and a deal stalled (`app.stall`) is answered by the spec
// (`app.inject`) as an engine that dealt that pair would. Sessions are seeded
// (the films' own Math.random), so the pool and the sides are the same run to
// run.
const { test, expect, goLevel } = require("./fixtures");

// What this spec watches besides the engine: where the requests stood when
// each cut was pressed (taken in the click's capture phase, before the cut's
// own handler runs, so whatever that handler asks for counts as after the
// cut), and every sentence the teaching meter says, with when.
const WATCH = `(() => {
  const cuts = (window.__pwCuts = []);
  document.addEventListener("click", (e) => {
    if (e.target && e.target.closest && e.target.closest(".bi-kill")) cuts.push(window.__tap.sent.length);
  }, true);
  const teach = (window.__pwTeach = []);
  document.addEventListener("DOMContentLoaded", () => {
    const copy = document.getElementById("teach-copy");
    if (copy) {
      new MutationObserver(() => teach.push({ text: copy.textContent, at: performance.now() }))
        .observe(copy, { childList: true, subtree: true, characterData: true });
    }
  });
})();`;

// A deal asked for ahead of the pick (deal.js `dealAhead`), answered with no
// pair, as an engine with none to deal answers, so a spec can have no pair
// waiting. (Held instead, it would be the deal a pick waits for: a pick with
// a deal already out waits for that one rather than asking for another.)
const NO_AHEAD = [{ type: "duel", ahead: true }, { type: "duel", pair: null, meta: null, ahead: true }];
// "duel" is the table's deal, the next pair's is `ahead`.
const TABLE = { type: "duel", ahead: false };
const AHEAD = { type: "duel", ahead: true };
// The pair's buttons, on EVOLVE's cards (the picks, ▶, ↻ and the corners'
// ⇄ circuit and ↓ patch) and PATCH's strip: off while the table has no pair
// to show.
const DUEL_CONTROLS = [
  "#choose-a", "#choose-b", "#skip-duel", "#play-a", "#play-b",
  "#flip-a", "#flip-b", "#promote-a", "#promote-b",
  "#pd-pick-a", "#pd-pick-b", "#pd-skip",
];

async function boot(page, app, { holdAhead = false, query = "" } = {}) {
  await page.addInitScript(WATCH);
  if (holdAhead) await app.answer(...NO_AHEAD);
  await app.boot({ random: 20260927, query });
}

const picks = async (page) => Number(await page.locator("#duel-count").textContent());
const cardIds = (page) =>
  page.evaluate(() => ["a", "b"].map((s) => Number(document.querySelector(`#name-${s} .dn-id`).textContent.replace("#", ""))));

/** The deals asked for (with the cuts each excluded) and the pairs put on the
 *  table (`duel_shown`, sent from placePair, the one place a pair goes up)
 *  since the last cut was pressed. */
const sinceCut = (page) =>
  page.evaluate(() => {
    const at = window.__pwCuts[window.__pwCuts.length - 1];
    const sent = window.__tap.sent.slice(at).map((s) => s.m);
    return {
      deals: sent.filter((m) => m.type === "duel").map((m) => ({ exclude: [...(m.exclude || [])], ahead: !!m.ahead })),
      shown: sent.filter((m) => m.type === "duel_shown").map((m) => [m.a, m.b]),
    };
  });

/** A cut patch is not dealt again: every deal asked for since the cut
 *  excludes it, and no pair put on the table since holds it. Every one, not
 *  the latest: the latest can be a deal asked for before the cut. */
async function expectNotDealtSinceCut(page, cut) {
  const { deals, shown } = await sinceCut(page);
  for (const d of deals) expect(d.exclude, "a deal asked for after the cut did not exclude it").toContain(cut);
  for (const p of shown) expect(p, "a pair put up after the cut holds it").not.toContain(cut);
  return { deals, shown };
}

async function toEvolve(page, app) {
  await app.reply("duel", { where: { pair: true }, timeout: 60_000 });
  await goLevel(page, "evolve");
  await app.engine((timeout) => expect(page.locator("#choose-a")).toBeEnabled({ timeout }), { ms: 30_000 });
  await app.engine((timeout) => expect(page.locator("#name-a .dn-id")).toBeAttached({ timeout }), { ms: 30_000 });
}

async function pick(page, app, side = "a") {
  await app.engine((timeout) => expect(page.locator(`#choose-${side}`)).toBeEnabled({ timeout }), { ms: 30_000 });
  await page.locator(`#choose-${side}`).click();
}

// A player's pace between picks.
const PICK_PACE_MS = 300;

test("⌘Z in EVOLVE with nothing to take back says so and leaves the PATCH edit alone", async ({ page, app }) => {
  await boot(page, app);
  // An edit in PATCH, so there is something edit undo *could* take back.
  await app.engine((timeout) => page.waitForFunction(() => window.__aur && window.__aur.wb && window.__aur.wb.rack, null, { timeout }), { ms: 60_000 });
  await goLevel(page, "patch");
  const knob = page.locator("#rack-svg [data-addr]").first();
  await app.engine((timeout) => expect(knob).toBeAttached({ timeout }), { ms: 30_000 });
  await knob.focus();
  const before = await knob.getAttribute("aria-valuetext");
  const t0 = await app.now();
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowUp");
  await expect(knob).not.toHaveAttribute("aria-valuetext", before);
  const edited = await knob.getAttribute("aria-valuetext");
  // The edit's replies, so the stack holds it: every knob write sent has its
  // bench, by its token.
  await app.engine((timeout) => expect.poll(async () => {
    const sent = await app.sent("edit_param", { after: t0 });
    const got = (await app.replies("bench", { after: t0 })).map((r) => r.token);
    return sent.length > 0 && sent.every((m) => got.includes(m.token));
  }, { timeout }).toBe(true), { ms: 30_000 });

  await toEvolve(page, app);
  const restores = await app.sentCount("edit_set_tree");
  await page.keyboard.press("Control+z");
  await expect(page.locator("#toasts .toast-msg")).toHaveText("Nothing to undo here. PATCH edits undo in PATCH.", { timeout: 1_500 });
  // Pressed again, it is said once: the second refusal takes the first's
  // place, so what waits behind it does not grow. main.js gives the refusal
  // `replace: "undo-here"`; without it the first refusal goes back in line
  // behind the second, one more waiting (the lane's rule is
  // apps/web/tests/toasts.test.mjs's). A waiting toast is not in the page, so
  // the count is the one the player sees, the toast's +N. Both presses and
  // their reads are one task, so no other toast can arrive between them.
  const said = await page.evaluate(async () => {
    const { MAX_TOASTS } = await import("/toasts.js");
    const press = () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true }));
    const read = () => [...document.querySelectorAll("#toasts .toast")].map((t) => ({
      msg: t.querySelector(".toast-msg").textContent,
      waiting: Number(t.querySelector(".toast-stack").textContent.slice(1)),
    }));
    press();
    const first = read();
    press();
    return { max: MAX_TOASTS, first, second: read() };
  });
  const REFUSAL = "Nothing to undo here. PATCH edits undo in PATCH.";
  expect(said.first.map((t) => t.msg), JSON.stringify(said)).toEqual([REFUSAL]);
  expect(said.second.map((t) => t.msg), JSON.stringify(said)).toEqual([REFUSAL]);
  // A full backlog is trimmed to MAX_TOASTS, which would hide a second copy.
  expect(said.first[0].waiting, JSON.stringify(said)).toBeLessThan(said.max);
  expect(said.second[0].waiting, `the second ⌘Z's refusal queued the first again: ${JSON.stringify(said)}`).toBe(said.first[0].waiting);
  await app.quiet();
  expect(await app.sentCount("edit_set_tree"), "⌘Z in EVOLVE sent an edit undo").toBe(restores);

  // Back in PATCH the edit is still there, and ⌘Z there does undo it.
  await goLevel(page, "patch");
  await expect(knob).toHaveAttribute("aria-valuetext", edited);
  await page.keyboard.press("Control+z");
  await expect.poll(() => app.sentCount("edit_set_tree")).toBeGreaterThan(restores);
  await expect(knob).toHaveAttribute("aria-valuetext", before);
});

test("the sixth pick can be taken back, and it just learned only once fitted has landed", async ({ page, app }) => {
  await boot(page, app);
  await toEvolve(page, app);
  const copy = page.locator("#teach-copy");
  const n0 = await picks(page);
  const fits = await app.sentCount("fit");

  for (let i = 1; i <= 6; i++) {
    await pick(page, app, i % 2 ? "a" : "b");
    // A player's pace between picks.
    if (i < 6) await page.waitForTimeout(PICK_PACE_MS);
  }
  // Six pips, and the meter says the refit is coming — not that it came.
  await expect(page.locator("#teach-pips i.lit")).toHaveCount(6);
  await expect(copy).toHaveText("● learning from your last 6 picks…");
  await expect(page.locator("#duel-mid")).toHaveClass(/\blearning\b/);
  await app.quiet();
  expect(await app.sentCount("fit"), "the refit went out inside the sixth pick's window").toBe(fits);

  // ⌘Z takes the sixth pick back like any other.
  await page.keyboard.press("Control+z");
  expect(await picks(page)).toBe(n0 + 5);
  await expect(page.locator("#teach-pips i.lit")).toHaveCount(5);
  await expect(copy).toContainText("1 more pick");
  await expect(page.locator("#toasts .toast", { hasText: "Picked " })).toHaveCount(0);

  // The sixth again: the refit goes out when its window closes, 7 s on.
  await pick(page, app, "b");
  await expect.poll(() => app.sentCount("fit"), { timeout: 20_000 }).toBeGreaterThan(fits);
  // From the pick itself (its forecast request goes out in the click's own
  // task) to the refit.
  const fitAt = (await app.sent("fit"))[0]._at;
  const pickAt = (await app.sent("duel_pred")).filter((m) => m._at < fitAt).pop()._at;
  const waited = fitAt - pickAt;
  console.log(`refit sent ${Math.round(waited)} ms after the sixth pick`);
  expect(waited, "the refit did not wait for the sixth pick's window").toBeGreaterThanOrEqual(6_990);
  // Its toast's window closed with it: the button goes, no dead "IN THE LOG".
  await expect(page.locator("#toasts .toast-undo", { hasText: /in the log/i })).toHaveCount(0);

  // "● it just learned" only after `fitted`, and it stays with no timer.
  const fitted = await app.reply("fitted");
  await expect(copy).toContainText("● it just learned: see what changed ▸", { timeout: 2_000 });
  const learned = await page.evaluate(() => (window.__pwTeach.find((e) => e.text.includes("it just learned")) || {}).at);
  expect(learned, "it said it had learned before fitted landed").toBeGreaterThanOrEqual(fitted._at);
  await expect(page.locator("#duel-mid")).toHaveClass(/\blearned\b/);
  // Nothing takes it down: not over the five seconds it was always watched.
  await app.quiet(5_000);
  await expect(copy).toContainText("it just learned");

  // "see what changed" is the map.
  await page.locator("#teach-copy .teach-link").click();
  await expect(page.locator("#view-taste")).toBeVisible();
  await expect(page.locator("#taste-crt")).toBeVisible();

  // The next pick ends it.
  await goLevel(page, "evolve");
  await pick(page, app, "a");
  await expect(copy).toContainText("5 more picks");
  await expect(page.locator("#teach-pips i.lit")).toHaveCount(1);
});

test("another pair leaves no live-looking buttons while it deals, and says why when slow", async ({ page, app }) => {
  // No pair dealt ahead (it would go up at once; see evolve_ahead.spec.js):
  // this is the deal a pick or ↻ waits for when none is waiting.
  await boot(page, app, { holdAhead: true });
  await toEvolve(page, app);
  // The deal ahead is asked once the table's own two sounds are here, and
  // answered empty at once (NO_AHEAD): waited for, both. A ↻ made while that
  // answer is still on its way waits for it rather than asking for a deal of
  // its own (main.js `dealAnother`), and the empty answer then ends the wait
  // before the 300 ms the reason waits for.
  await app.engine((timeout) => expect.poll(async () => {
    const asked = (await app.sent(AHEAD)).length;
    const answered = (await app.replies("duel", { where: { ahead: true }, injected: true })).length;
    return asked > 0 && answered >= asked;
  }, { timeout, message: "the deal ahead asked and answered" }).toBe(true), { ms: 30_000 });
  const n0 = await picks(page);
  const [a0, b0] = await cardIds(page);
  await app.delay(TABLE, 2_500);
  await page.locator("#skip-duel").click();
  // Inert at once, like after a pick: the picks, ▶, ↻ and the corners.
  for (const id of DUEL_CONTROLS) await expect(page.locator(id)).toBeDisabled();
  await expect(page.locator("#duel-a")).toHaveClass(/\bdealing\b/);
  // After 300 ms the dimmed cards say why.
  await expect(page.locator("#duel-a .deal-why")).toBeVisible({ timeout: 1_500 });
  await expect(page.locator("#duel-a .deal-why")).toHaveText(/^dealing/);
  // A pick by key now does nothing at all — no vote on a pair being put away.
  await page.keyboard.press("ArrowRight");
  expect(await picks(page)).toBe(n0);
  await expect(page.locator("#toasts .toast", { hasText: "Picked " })).toHaveCount(0);
  // The new pair lands live, and the reason goes.
  await app.undelay();
  await expect(page.locator("#choose-a")).toBeEnabled();
  await expect(page.locator("#duel-a .deal-why")).toBeHidden();
  await expect(page.locator("#duel-a")).not.toHaveClass(/\bdealing\b/);
  const [a1, b1] = await cardIds(page);
  expect([a1, b1]).not.toEqual([a0, b0]);
});

// A table whose deal comes back empty (#195). The engine deals nothing when
// fewer than two sounds in the pool may be dealt (every other one is cut).
// Here the deal ahead is stalled, ↻ waits on it, and the spec answers it
// empty, as that engine would; from then on every deal the engine answers is
// rewritten empty (`app.amend`), until a sound comes back. The table used to
// come back live over the pair just put away, with no pair and no reason.
// What the dealer does with an empty answer is deal.test.mjs's; this is the
// wiring: the cards, their buttons, the words, and the deal asked for again
// when a cut is taken back.
const NOTHING_TO_PAIR = "Nothing to pair. Fewer than two sounds are left to deal.";

test("a deal that comes back empty leaves the table off and says there is nothing to pair", async ({ page, app }) => {
  await app.stall(AHEAD);
  await boot(page, app);
  // The pool whole first: `filled` deals for a table with no pair, so landing
  // after the table emptied it would ask for a deal of its own, and the pair
  // at the end could be that deal's rather than the take-back's.
  await app.filled();
  await toEvolve(page, app);
  const asked = await app.stalled();
  await app.amend({ type: "duel" }, { pair: null, meta: null });
  await page.locator("#skip-duel").click();
  await expect(page.locator("#choose-a")).toBeDisabled();
  const deals = await app.sentCount("duel");
  await app.inject({ type: "duel", pair: null, meta: null, ahead: true, re: asked.rid });

  const why = page.locator("#duel-a .deal-why");
  await expect(why).toHaveText(NOTHING_TO_PAIR);
  await expect(why).toBeVisible();
  await expect(page.locator("#duel-b .deal-why")).toHaveText(NOTHING_TO_PAIR);
  for (const id of DUEL_CONTROLS) await expect(page.locator(id)).toBeDisabled();
  await expect(page.locator("#duel-a")).toHaveClass(/\bdealing\b/);
  // It stays so: no button comes back live, and no deal is asked for.
  await app.quiet();
  for (const id of DUEL_CONTROLS) await expect(page.locator(id)).toBeDisabled();
  await expect(why).toHaveText(NOTHING_TO_PAIR);
  expect(await app.sentCount("duel"), "a deal was asked for with nothing come back").toBe(deals);

  // A sound comes back (a cut taken back), and the engine can deal again:
  // the table asks, and the pair it deals goes up live.
  await app.unamend();
  const id = await page.locator("#bank-list .bank-item[data-id]").first().getAttribute("data-id");
  const row = page.locator(`#bank-list .bank-item[data-id="${id}"]`);
  await row.scrollIntoViewIfNeeded();
  await row.hover();
  await row.locator(".bi-kill").click();
  await expect(row).toHaveCount(0);
  expect(await app.sentCount("duel"), "a deal was asked for before the cut was taken back").toBe(deals);
  const mark = await app.now();
  await page.keyboard.press("Control+z");
  await app.reply("duel", { where: { pair: true }, after: mark, timeout: 30_000 });
  for (const id of DUEL_CONTROLS) await expect(page.locator(id)).toBeEnabled();
  await expect(why).toBeHidden();
  await expect(page.locator("#duel-a")).not.toHaveClass(/\bdealing\b/);
});

test("a cut patch is not dealt again, and its toast names it without an id", async ({ page, app }) => {
  await boot(page, app);
  await toEvolve(page, app);
  const [cut] = await cardIds(page);
  const row = page.locator(`#bank-list .bank-item[data-id="${cut}"]`);
  await row.scrollIntoViewIfNeeded();
  await row.hover();
  // ⌘Z takes a cut back — the newest teaching act, inside its window — and
  // the row comes back. Then it is cut for good.
  await row.locator(".bi-kill").click();
  await expect(row).toHaveCount(0);
  await page.keyboard.press("Control+z");
  await expect(row).toBeVisible();
  await row.hover();
  const mark = await app.toastMark();
  await row.locator(".bi-kill").click();
  await expect(row).toHaveCount(0);
  // Its toast may wait its turn in the lane behind one already on screen.
  const said = await app.toast(/^Cut /, { since: mark, timeout: 15_000 });
  expect(said).toMatch(/^Cut .+\. It won’t be dealt again\.$/);
  expect(said).not.toMatch(/#\d/);
  // No deal from here on includes it: every deal asked for since the cut
  // excludes it, and no pair put up since holds it. Not the latest request
  // alone: between ⌘Z and the cut the patch was not cut, and a deal asked for
  // then (the next pair, once the table's sounds were in) rightly did not
  // exclude it. When its pair does not hold the patch either, neither pair
  // needs dealing again, so that deal stays the latest until the next one
  // (CI on PRs #80 and #87; deal.test.mjs forces each shape of that race).
  await expect(page.locator("#choose-a")).toBeEnabled();
  for (let i = 0; i < 8; i++) {
    await expectNotDealtSinceCut(page, cut);
    expect(await cardIds(page)).not.toContain(cut);
    await page.locator("#skip-duel").click();
    await expect(page.locator("#choose-a")).toBeEnabled();
  }
  // Eight pairs went up since the cut, and every one was dealt after it but
  // the first, which can be the pair dealt before it: one deal at most is
  // ever out or waiting beside the table's.
  const { deals, shown } = await expectNotDealtSinceCut(page, cut);
  expect(shown.length).toBeGreaterThanOrEqual(8);
  expect(deals.length).toBeGreaterThanOrEqual(7);
});

test("after clicking EVOLVE's stop on the rail, → picks", async ({ page, app }) => {
  await boot(page, app);
  await toEvolve(page, app); // arrives by a pointer click on its stop
  const focus = await page.evaluate(() => document.activeElement && (document.activeElement.id || document.activeElement.tagName));
  console.log(`focus after the stop's click: ${focus}`);
  expect(focus).toBe("view-evolve");
  const n0 = await picks(page);
  await page.keyboard.press("ArrowRight");
  expect(await picks(page)).toBe(n0 + 1);
  await expect(page.locator("#view-evolve")).toBeVisible();
  await expect(page.locator("#toasts .toast-msg")).toContainText("Picked ");
  // A keyboard user on the rail walks the levels with the arrows: from
  // EVOLVE, → goes back to PERFORM, and is not a pick.
  await page.locator('.rail-stop[data-level="evolve"]').focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#view-perform")).toBeVisible();
  expect(await picks(page)).toBe(n0 + 1);
});

// main.js `OPEN_SAID_MS`: an open the player asked for that waited longer is
// said when it lands.
const OPEN_SAID_MS = 1_000;

test("opening a patch is not announced unless it kept you waiting", async ({ page, app }) => {
  await boot(page, app);
  await toEvolve(page, app);
  await goLevel(page, "patch");
  const mark = await app.toastMark();
  const rows = page.locator("#bank-list .bank-item");
  // Two opens as they come. Whether each kept the player waiting is the
  // app's own mark (`patch-opened`, its `waited`), not a guess that a
  // runner opens a patch within the second (#186). One that did is said by
  // name before the next click: a later "Opened" replaces an earlier one.
  const opens = [];
  for (const i of [1, 2]) {
    const id = Number(await rows.nth(i).getAttribute("data-id"));
    const name = (await rows.nth(i).locator(".bi-name").textContent()).trim();
    const at = await app.now();
    await rows.nth(i).locator(".bi-name").click();
    await app.engine((timeout) => page.waitForFunction((id) => window.__aur.wb.subjectId === id, id, { timeout }), { ms: 30_000 });
    let opened = null;
    await expect.poll(async () => (opened = (await app.marks("patch-opened", { after: at })).find((m) => m.detail?.name === name) || null), { message: `the app marked ${name}'s open` }).not.toBeNull();
    const waited = opened.detail.waited;
    opens.push({ name, waited });
    if (waited > OPEN_SAID_MS + 1) await app.toast(`Opened ${name}.`, { since: mark });
    // An open the app did not see asked for (no `openAsk`) marks no wait.
    if (waited != null) app.budget(`opening ${name} from the bank`, waited, OPEN_SAID_MS);
  }
  // Nothing else is said of an open, however long one looks; a quick one is
  // not said at all. (The mark rounds what it waited; within a millisecond of
  // the line, either is right.)
  await app.quiet();
  const said = await app.toasts(mark);
  console.log(`opens: ${JSON.stringify(opens)}; toasts while opening: ${JSON.stringify(said)}`);
  for (const t of said) {
    expect(t).not.toMatch(/on the bench|workbench|under your fingers/);
    if (/Opened/.test(t)) expect(opens.some((o) => t === `Opened ${o.name}.` && o.waited >= OPEN_SAID_MS - 1), `"${t}" said of an open that waited ${JSON.stringify(opens)}`).toBe(true);
  }
  for (const o of opens) {
    if (Math.abs(o.waited - OPEN_SAID_MS) <= 1) continue;
    expect(said.includes(`Opened ${o.name}.`), `"Opened ${o.name}." is said exactly when its open waited over ${OPEN_SAID_MS} ms (it waited ${o.waited} ms)`).toBe(o.waited > OPEN_SAID_MS);
  }
  // An open that keeps the player waiting over a second is said when it
  // lands, by name: news, because the click showed nothing for a while.
  await app.delay("edit_begin", 1_800);
  const slow = rows.nth(3);
  const name = (await slow.locator(".bi-name").textContent()).trim();
  const mark2 = await app.toastMark();
  const at = await app.now();
  await slow.locator(".bi-name").click();
  // A sentence, so it ends in a period.
  await expect.poll(() => app.toasts(mark2), { timeout: 15_000 }).toContain(`Opened ${name}.`);
  // …and the app's own mark agrees that it kept the player waiting.
  const [opened] = (await app.marks("patch-opened", { after: at })).filter((m) => m.detail?.name === name);
  expect(opened && opened.detail.waited, `the app marked ${name}'s open as waiting over ${OPEN_SAID_MS} ms`).toBeGreaterThan(OPEN_SAID_MS);
  await app.undelay();
});

// With no render farm (`?farm=0`, or a machine too small for one) a
// generation's walks run in the engine worker, and a deal can wait for the
// walk in progress. On the farm it does not wait at all
// (evolve_breeds_beside_you.spec.js).
test("with no farm, a pick's deal during a generation says which seed it waits on, and what it bred and replaced is named", { tag: "@slow" }, async ({ page, app }) => {
  test.setTimeout(240_000);
  await boot(page, app, { query: "?farm=0" });
  await toEvolve(page, app);
  // A model to breed toward: six picks, and their refit landed.
  for (let i = 1; i <= 6; i++) await pick(page, app, i % 2 ? "a" : "b");
  await app.reply("fitted");
  await expect(page.locator("#wm-lamp")).not.toHaveClass(/\bthinking\b/, { timeout: 5_000 });
  // Every reason the dimmed cards give while a deal waits, as they give it.
  await page.evaluate(() => {
    const card = document.getElementById("duel-a");
    window.__pwWhy = [];
    new MutationObserver(() => {
      const el = card.querySelector(".deal-why");
      if (el && el.offsetParent !== null) window.__pwWhy.push(el.textContent.trim());
    }).observe(card, { childList: true, subtree: true, characterData: true, attributes: true });
  });

  const mark = await app.toastMark();
  await page.locator("#evolve-btn").click();
  await expect(page.locator("#wm-lamp")).toHaveClass(/\bthinking\b/);
  const breedingNow = () => page.locator("#evolve-btn").isDisabled();
  // Picks while it breeds. A deal waits for the seed being bred, and the
  // dimmed cards say so, with the seed it waits on.
  // Pick until six picks have counted toward the next refit. A pick can be
  // refused inside its undo window when a seed of this generation replaces
  // the patch it chose (the engine replaces as it breeds): the app un-counts
  // it and says so, so a sixth click is not always a sixth pick.
  let sawSixth = false;
  for (let i = 1; i <= 12 && !sawSixth && (await breedingNow()); i++) {
    await pick(page, app, i % 2 ? "a" : "b");
    // The deal it waits for (seconds, while a walk runs in the engine).
    await app.engine((timeout) => expect(page.locator("#choose-a")).toBeEnabled({ timeout }), { ms: 60_000 });
    // The sixth of a new row: the refit waits for the generation, and the
    // meter says that rather than "learning" or "it just learned".
    const copy = (await page.locator("#teach-copy").textContent()).trim();
    if (copy.startsWith("●")) {
      if (await breedingNow()) expect(copy).toBe("● it will learn from these 6 when breeding finishes");
      sawSixth = true;
    }
  }
  const reasons = new Set(await page.evaluate(() => window.__pwWhy));
  console.log(`deal reasons seen during the generation: ${JSON.stringify([...reasons])}`);
  for (const r of reasons) {
    expect(r).toMatch(/^dealing: the engine is (breeding \(seed \d+\/\d+\)|breeding|placing a bred generation in the pool)$|^dealing…$/);
  }
  expect([...reasons].some((r) => /breeding \(seed \d+\/10\)/.test(r)), "no deal said which seed it waited on").toBe(true);

  await app.engine((timeout) => expect(page.locator("#evolve-btn")).toBeEnabled({ timeout }), { ms: 400_000 });
  const said = await app.toasts(mark);
  const receipt = said.find((t) => /^Generation \d+:/.test(t));
  console.log(`generation receipt: ${receipt}`);
  expect(receipt).toBeTruthy();
  expect(receipt).not.toMatch(/#\d|retired/);
  if (/replaced/.test(receipt)) expect(receipt).toMatch(/it could: [^.]*\S\./);
  // The strip names parent and child and says "liked", not "Δtaste" or ids.
  const lineage = (await page.locator("#lineage-log").textContent()).trim();
  console.log(`lineage strip: ${lineage.slice(0, 300)}`);
  expect(lineage).not.toMatch(/#\d|Δtaste|no proposal beat/);
  if (/gen \d/.test(lineage)) expect(lineage).toMatch(/→ .+ · .* liked [+−]\d/);
  else expect(lineage).toMatch(/ran, and none put a new sound in the pool/);
  // The lamp stays lit while the refit the sixth pick armed still runs; the
  // generation's reply no longer puts it out under the refit.
  if (sawSixth) {
    const state = await page.evaluate(() => ({
      fitted: window.__tap.counts.fitted || 0,
      lit: document.getElementById("wm-lamp").classList.contains("thinking"),
    }));
    if (state.fitted === 1) expect(state.lit, "the generation's reply put out the refit's lamp").toBe(true);
    await app.engine((timeout) => expect.poll(() => app.count("fitted"), { timeout }).toBeGreaterThan(1));
    await expect(page.locator("#teach-copy")).toContainText("it just learned", { timeout: 5_000 });
  }
  await expect(page.locator("#wm-lamp")).not.toHaveClass(/\bthinking\b/, { timeout: 5_000 });
});

