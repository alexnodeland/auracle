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
//   pick does: inert buttons, and after 300 ms a reason on the cards. It used
//   to leave the old pair up with buttons that looked live and did nothing.
// - A cut patch is never dealt again, and its toast names it without an id.
//   That holds for a deal asked for while the cut was taken back, which
//   rightly did not exclude it, whenever its pair lands, and for the deal a
//   waiting table puts up after three tries, which used to go up anyway.
// - After clicking the EVOLVE tab, → picks.
// - An open is not announced unless it kept the player waiting.
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

// A deal asked for ahead of the pick (main.js requestAhead), answered with no
// pair, as an engine with none to deal answers, so a spec can have no pair
// waiting. (Held instead, it would be the deal a pick waits for: a pick with
// a deal already out waits for that one rather than asking for another.)
const NO_AHEAD = [{ type: "duel", ahead: true }, { type: "duel", pair: null, meta: null, ahead: true }];
// "duel" is the table's deal, the next pair's is `ahead`.
const TABLE = { type: "duel", ahead: false };
const AHEAD = { type: "duel", ahead: true };

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
  // Pressed again, it is said once, not queued twice.
  await page.keyboard.press("Control+z");
  await app.quiet();
  expect(await app.sentCount("edit_set_tree"), "⌘Z in EVOLVE sent an edit undo").toBe(restores);
  expect(await page.locator("#toasts .toast").count()).toBe(1);

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
  const n0 = await picks(page);
  const [a0, b0] = await cardIds(page);
  await app.delay(TABLE, 2_500);
  await page.locator("#skip-duel").click();
  // Inert at once, like after a pick.
  for (const id of ["#choose-a", "#choose-b", "#skip-duel", "#pd-pick-a", "#pd-pick-b", "#pd-skip"]) {
    await expect(page.locator(id)).toBeDisabled();
  }
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
  // (CI on PRs #80 and #87; the test below forces it).
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

// The race behind that test's failures on CI: a deal asked for between ⌘Z
// and cutting the patch again, while it was not cut, so rightly without it in
// `exclude`. Here that deal is made to happen (↻ asks for one), held from the
// engine, and answered by the spec at a chosen moment with a chosen pair, as
// an engine that dealt the patch then would. Whenever it lands, the patch cut
// again never goes up, and every deal asked for after the cut excludes it
// (`onDealt`, `checkAhead` and `aheadUsable` in main.js). With a pair that
// does not hold the patch, landing before the cut, nothing needs dealing
// again: the shape CI caught.
for (const { holds, lands } of [
  { holds: true, lands: "after" },
  { holds: true, lands: "before" },
  { holds: false, lands: "before" },
]) {
  test(`a pair dealt while a cut was taken back never puts the patch up once it is cut again (${holds ? "it holds the patch" : "it does not hold the patch"}, landing ${lands} the cut)`, async ({ page, app }) => {
    await boot(page, app);
    await toEvolve(page, app);
    const [cut] = await cardIds(page);
    const row = page.locator(`#bank-list .bank-item[data-id="${cut}"]`);
    const cutIt = async () => {
      await row.scrollIntoViewIfNeeded();
      await row.hover();
      await row.locator(".bi-kill").click();
      await expect(row).toHaveCount(0);
    };
    await cutIt();
    await page.keyboard.press("Control+z");
    await expect(row).toBeVisible();

    // A deal asked for now, with the patch not cut: ↻ puts the pair waiting
    // up and asks for the next, or waits on a deal it asks for.
    await expect(page.locator("#choose-a")).toBeEnabled();
    await app.stall(TABLE, AHEAD);
    await page.locator("#skip-duel").click();
    const asked = await app.stalled();
    expect(asked.exclude, "the deal was asked for while the patch was cut").not.toContain(cut);

    // The engine's answer: the patch with a partner from the pool (or two
    // others), none of them on the cards, so the pair is not the one up.
    const answer = () =>
      page.evaluate(({ c, holds }) => {
        const cards = ["a", "b"].map((s) => {
          const el = document.querySelector(`#name-${s} .dn-id`);
          return el ? Number(el.textContent.replace("#", "")) : null;
        });
        const free = [...document.querySelectorAll("#bank-list .bank-item[data-id]")]
          .map((el) => Number(el.dataset.id))
          .filter((id) => id !== c && !cards.includes(id));
        const pair = holds ? [c, free[0]] : [free[0], free[1]];
        const last = window.__tap.last.duel && window.__tap.last.duel.meta;
        const meta = last ? { ...last, a: pair[0], b: pair[1] } : null;
        const stalled = window.__tap.stalled[window.__tap.stalled.length - 1];
        window.__tap.inject({ type: "duel", pair, meta, ahead: !!stalled.ahead });
      }, { c: cut, holds });
    if (lands === "after") {
      await cutIt();
      await answer();
    } else {
      await answer();
      await cutIt();
    }

    await expect(page.locator("#choose-a")).toBeEnabled();
    for (let i = 0; i < 3; i++) {
      await expectNotDealtSinceCut(page, cut);
      expect(await cardIds(page)).not.toContain(cut);
      await page.locator("#skip-duel").click();
      await expect(page.locator("#choose-a")).toBeEnabled();
    }
    const { deals, shown } = await expectNotDealtSinceCut(page, cut);
    console.log(`deal held: ${asked.ahead ? "the next pair's" : "the table's"}; since the cut ${deals.length} deals, ${shown.length} pairs up`);
    expect(shown.length).toBeGreaterThanOrEqual(3);
    expect(deals.length).toBeGreaterThanOrEqual(2);
  });
}

// With the table waiting, a deal that may not go up is dealt again, and after
// three tries the next answer goes up anyway: a pool too small to deal
// anything else must not leave the cards dimmed for good (`onDealt`). That
// last answer used to go up even holding a sound cut while it was out. Here
// the engine answers the table's deal three times with the pair just put
// away (the one answer a small pool can be stuck on), a sound is cut while
// the fourth is out, and the fourth answer holds it.
test("a sound cut while the table waits on its fourth deal is not put up by it", async ({ page, app }) => {
  // No pair waiting (see the ↻ test above), so ↻ waits on a deal.
  await boot(page, app, { holdAhead: true });
  await toEvolve(page, app);
  const [a, b] = await cardIds(page);
  const ids = await page.evaluate(() =>
    [...document.querySelectorAll("#bank-list .bank-item[data-id]")].map((el) => Number(el.dataset.id)));
  const [cut, partner] = ids.filter((id) => id !== a && id !== b);
  const row = page.locator(`#bank-list .bank-item[data-id="${cut}"]`);

  // ↻: the pair goes away and the table waits on the deal it asks for.
  await app.stall(TABLE);
  await page.locator("#skip-duel").click();
  await app.stalled();
  // Three answers with the pair just put away, each refused, and each
  // followed by another deal, held in its turn.
  for (let i = 1; i <= 3; i++) {
    const again = await page.evaluate(([pair, table]) => {
      const T = window.__tap;
      const m = T.stalled[T.stalled.length - 1];
      const n = T.stalled.length;
      T.stalls = [table];
      T.inject({ type: "duel", pair, meta: null, ahead: !!m.ahead });
      return T.stalled.length > n;
    }, [[a, b], TABLE]);
    expect(again, `the answer ${i} was put up rather than dealt again`).toBe(true);
    await expect(page.locator("#choose-a")).toBeDisabled();
  }
  // The fourth deal is out. A sound is cut now…
  await row.scrollIntoViewIfNeeded();
  await row.hover();
  await row.locator(".bi-kill").click();
  await expect(row).toHaveCount(0);
  // …and the fourth answer holds it: the engine dealt it before the cut.
  await page.evaluate((pair) => {
    const T = window.__tap;
    const m = T.stalled[T.stalled.length - 1];
    T.stalls = [];
    T.inject({ type: "duel", pair, meta: null, ahead: !!m.ahead });
  }, [cut, partner]);

  // It is dealt again, and a pair without it goes up.
  await expect(page.locator("#choose-a")).toBeEnabled();
  expect(await cardIds(page)).not.toContain(cut);
  const { deals, shown } = await expectNotDealtSinceCut(page, cut);
  expect(shown.length).toBe(1);
  expect(deals.length).toBeGreaterThanOrEqual(1);
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

test("opening a patch is not announced unless it kept you waiting", async ({ page, app }) => {
  await boot(page, app);
  await toEvolve(page, app);
  await goLevel(page, "patch");
  const mark = await app.toastMark();
  const rows = page.locator("#bank-list .bank-item");
  for (const i of [1, 2]) {
    const id = Number(await rows.nth(i).getAttribute("data-id"));
    await rows.nth(i).locator(".bi-name").click();
    await app.engine((timeout) => page.waitForFunction((id) => window.__aur.wb.subjectId === id, id, { timeout }), { ms: 30_000 });
  }
  // Nothing is said of a quick open, however long one looks.
  await app.quiet();
  const said = await app.toasts(mark);
  console.log(`toasts while opening: ${JSON.stringify(said)}`);
  for (const t of said) {
    expect(t).not.toMatch(/on the bench|workbench|under your fingers|Opened/);
  }
  // An open that keeps the player waiting over a second is said when it
  // lands, by name: news, because the click showed nothing for a while.
  await app.delay("edit_begin", 1_800);
  const slow = rows.nth(3);
  const name = (await slow.locator(".bi-name").textContent()).trim();
  const mark2 = await app.toastMark();
  await slow.locator(".bi-name").click();
  // A sentence, so it ends in a period.
  await expect.poll(() => app.toasts(mark2), { timeout: 15_000 }).toContain(`Opened ${name}.`);
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

