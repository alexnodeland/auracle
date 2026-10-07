// What the instrument promises about time, measured (the interaction spec's
// response-time budget, RT12).
//
// - The app marks its own moments (`performance.mark("auracle:…")`, listed by
//   `window.__aur.marks()`): boot start, veil down, first sound, pool full,
//   PERFORM wired, patch opened. The film recorder writes them into every
//   rehearsal's sidecar.
// - A preset's controls are live the moment PERFORM names it (every preset
//   ships measured): in the same task, wired from the shipped file, with no
//   measurement asked of the engine. And within a second of its click: what
//   stands between the click and PERFORM having the patch is the open
//   itself, the preset's insert (one render, about 0.4 s on a quiet machine)
//   and the bench.
// - A warm-start pick's controls are live the moment PERFORM names it, and
//   within a second of "teach it": its insert is the first thing the worker
//   does, and a memo hit when the pick's card was measured before "teach it"
//   arrived (the engine measures the cards while they are chosen,
//   `warm_cards`, the picks first). This spec presses it about half a second
//   after the deal, and the card usually was; what is left then is the
//   render in progress when "teach it" arrives (#221).
// - A pick puts the next pair up in the click's own task, with no deal
//   asked for, and its ▶ sounds in its own: the next pair is dealt, and its
//   sounds fetched, ahead. Within 0.3 s and 0.15 s, in a seeded session and
//   in one with no seed, whose deals never wait for more sounds (#211).
//
// The order is asserted; the seconds are budgets (ADR-022, `app.budget`):
// each recorded as the test's annotation, with the insert's share in its
// name, and judged only with AURACLE_PERF=1, by the nightly Speed budgets
// job. Times are taken in the page's own clock, from the gesture's
// own task, so Playwright's polling is not in them.
const { test, expect, goLevel, bankTab } = require("./fixtures");

/** A key held long enough to be played. */
const KEY_HELD_MS = 300;
/** A player listens before choosing. */
const LISTEN_MS = 500;

/** Seeded, the tours seen, and the warm start unless `warmed` is false (the
 *  fixture's `app.boot`). What was asked of the engine and what it answered,
 *  and when, is the fixture's tap (`window.__tap`), read in the page. */
const boot = (app, { warmed = true } = {}) => app.boot({ warmed });

// In the page: where an open's time went, from the tap's requests and
// replies from `sent0` and `got0` on: [what, t] for the load and its reply,
// the bench open and the bench's reply (a warm start's pick: its insert and
// the first card's answer), in the order they happened.
const STEPS = `(sent0, got0) => {
  const T = window.__tap;
  const asked = T.sent.slice(sent0).filter((x) => x.type === "load_preset" || x.type === "edit_begin" || x.type === "warm_start");
  const heard = T.replies.slice(got0).filter((r) => !r.injected && (r.type === "preset_loaded" || r.type === "warm_first" || (r.type === "bench" && r.d.subject != null)));
  return [...asked.map((x) => [x.type, x.at]), ...heard.map((r) => [r.type, r.at])].sort((a, b) => a[1] - b[1]);
}`;

// In the page: resolve with ms from now until `cond()` holds.
const until = (cond, limit = 60_000) => `(async () => {
  const t0 = performance.now();
  for (;;) {
    if ((${cond})()) return performance.now() - t0;
    if (performance.now() - t0 > ${limit}) return Infinity;
    await new Promise((r) => setTimeout(r, 2));
  }
})()`;

// Named: PERFORM names the patch as the one under the keys. Live: and its
// six controls are wired. `window.__named` records when it was first named.
const LIVE = `() => {
  const n = document.querySelector(".pf-name");
  const named = n && n.textContent === window.__want && !n.classList.contains("pending");
  if (named && window.__named == null) window.__named = performance.now();
  return named &&
    /controls reach/.test(document.querySelector(".pf-status")?.textContent || "") &&
    ![0, 1, 2, 3, 4, 5].some((i) => document.querySelector('.pf-knob[data-i="' + i + '"]')?.classList.contains("unwired"));
}`;

// In the page, before the gesture: watch for the task in which PERFORM names
// `window.__want`, and record in `window.__liveAtName` whether its controls
// were live by the end of that same task (an observer's callback runs at the
// end of the task that made the change).
const WATCH_NAMING = `(() => {
  window.__liveAtName = null;
  const live = () => {
    const n = document.querySelector(".pf-name");
    return !!n && n.textContent === window.__want && !n.classList.contains("pending") &&
      /controls reach/.test(document.querySelector(".pf-status")?.textContent || "") &&
      ![0, 1, 2, 3, 4, 5].some((i) => document.querySelector('.pf-knob[data-i="' + i + '"]')?.classList.contains("unwired"));
  };
  const mo = new MutationObserver(() => {
    const n = document.querySelector(".pf-name");
    if (!n || n.textContent !== window.__want || n.classList.contains("pending")) return;
    window.__liveAtName = live();
    mo.disconnect();
  });
  mo.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class"] });
})()`;

test("the app marks boot, the veil, first sound, a full pool, PERFORM wired and a patch opened", async ({ page, app }) => {
  await boot(app);
  await goLevel(page, "perform");
  await page.keyboard.down("a");
  // eslint-disable-next-line playwright/no-wait-for-timeout -- a key held to be played
  await page.waitForTimeout(KEY_HELD_MS);
  await page.keyboard.up("a");
  await bankTab(page, "presets");
  await page.locator(".bank-item", { hasText: "Glass Pad" }).first().click();
  await app.engine((timeout) => expect(page.locator(".pf-name")).toHaveText("Glass Pad", { timeout }), { ms: 60_000 });
  // The pool full is the engine's to reach: an engine wait.
  await app.engine((timeout) => expect.poll(async () => (await page.evaluate(() => window.__aur.marks())).map((m) => m.name), { timeout })
    .toEqual(expect.arrayContaining(["boot-start", "veil-down", "first-sound", "pool-full", "perform-wired", "patch-opened"])), { ms: 200_000 });
  const marks = await page.evaluate(() => window.__aur.marks());
  const at = (n) => marks.find((m) => m.name === n).t;
  console.log(`marks (ms since load): ${marks.map((m) => `${m.name} ${m.t}`).join(" · ")}`);
  expect(at("boot-start")).toBeLessThanOrEqual(at("veil-down"));
  expect(at("veil-down")).toBeLessThanOrEqual(at("pool-full"));
  expect(marks.some((m) => m.name === "perform-wired" && m.detail?.how === "shipped"), "a preset wired from the shipped file").toBe(true);
});

test("a preset's controls are live within a second of its click", async ({ page, app }) => {
  await boot(app);
  await goLevel(page, "perform");
  await bankTab(page, "presets");
  for (const name of ["Acid Line", "Bell Jar", "Glass Pad"]) {
    await expect(page.locator(".bank-item", { hasText: name }).first()).toBeAttached();
    // The open is the engine's to finish: its in-page wait (`until`, up to a
    // minute) is an engine wait.
    const [ms, named, steps, insert, liveAtName, how] = await app.engine(() => page.evaluate(
      async ([name, js, watch, steps]) => {
        window.__want = name;
        window.__named = null;
        eval(watch);
        const el = [...document.querySelectorAll(".bank-item")].find((e) => e.querySelector(".bi-name")?.textContent === name);
        // Into view as a player's click finds it, in the click's own task: the
        // bank is rebuilt by every reply that carries the views (an open's
        // insert, its bench), and a row scrolled to from the test, a turn
        // earlier, could be gone by the time it was scrolled.
        el.scrollIntoView({ block: "nearest" });
        const t0 = performance.now();
        const [sent0, got0] = [window.__tap.sent.length, window.__tap.replies.length];
        el.click();
        const ms = await eval(js);
        const s = eval(steps)(sent0, got0);
        const at = (k) => (s.find(([x]) => x === k) || [])[1];
        const how = performance.getEntriesByName("auracle:perform-wired").find((e) => e.startTime >= t0 && e.detail?.name === name)?.detail?.how ?? null;
        return [ms, window.__named - t0, s.map(([k, t]) => `${k} ${Math.round(t - t0)}`).join(", "), at("preset_loaded") - at("load_preset"), window.__liveAtName, how];
      },
      [name, until(LIVE), WATCH_NAMING, STEPS],
    ), { ms: 60_000 });
    console.log(`${name}: click → named in PERFORM ${named.toFixed(0)} ms → controls live ${ms.toFixed(0)} ms (${steps}); live in the naming's task: ${liveAtName}; wired from ${how}`);
    expect(liveAtName, `${name}'s controls are live in the task PERFORM names it`).toBe(true);
    expect(how, `${name} is wired from the shipped file (the app's mark), not measured`).toBe("shipped");
    app.budget(`${name}: the click → its controls live (its insert ${Math.round(insert)} ms)`, ms, 1000);
    // The open settled before the next is clicked: its load and the bench's
    // edits answered.
    await app.answered({ types: ["load_preset", "edit_begin"], lanes: ["bench"] });
  }
});

test("a warm-start pick's controls are live within a second of teach it", async ({ page, app }) => {
  await boot(app, { warmed: false });
  await app.engine((timeout) => expect(page.locator("#warmstart")).not.toHaveClass(/\bhidden\b/, { timeout }), { ms: 30_000 });
  const cards = page.locator(".warm-cell .warm-item");
  for (const i of [0, 3, 6]) await cards.nth(i).click();
  const first = (await cards.nth(0).locator(".wi-name").textContent()).trim();
  const [ms, named, insert, liveAtName, how] = await app.engine(() => page.evaluate(
    async ([name, js, watch, steps]) => {
      window.__want = name;
      window.__named = null;
      eval(watch);
      const [sent0, got0] = [window.__tap.sent.length, window.__tap.replies.length];
      const t0 = performance.now();
      document.getElementById("warm-go").click();
      const ms = await eval(js);
      const s = eval(steps)(sent0, got0);
      const at = (k) => (s.find(([x]) => x === k) || [])[1];
      const how = performance.getEntriesByName("auracle:perform-wired").find((e) => e.startTime >= t0 && e.detail?.name === name)?.detail?.how ?? null;
      return [ms, window.__named - t0, at("warm_first") - at("warm_start"), window.__liveAtName, how];
    },
    [first, until(LIVE), WATCH_NAMING, STEPS],
  ), { ms: 60_000 });
  console.log(`teach it → ${first} named ${named.toFixed(0)} ms (its insert ${insert.toFixed(0)} ms) → controls live ${ms.toFixed(0)} ms; live in the naming's task: ${liveAtName}; wired from ${how}`);
  expect(liveAtName, "its controls are live in the task PERFORM names it").toBe(true);
  expect(how, "it is wired from the shipped file (the app's mark), not measured").toBe("shipped");
  // The engine was asked to measure the nine cards as they were dealt, then
  // the picks first in the order they were made, and none once the card
  // closed with "teach it".
  const warm = await page.evaluate(() =>
    window.__tap.sent.filter((x) => x.type === "warm_cards" || x.type === "warm_start").map((x) => [x.type, x.m.order || null]),
  );
  const dealt = warm[0][1];
  expect(warm[0][0]).toBe("warm_cards");
  expect(dealt).toHaveLength(9);
  const picks = [dealt[0], dealt[3], dealt[6]];
  const teachAt = warm.findIndex(([type]) => type === "warm_start");
  expect(warm[teachAt - 1], "the last order before teach it").toEqual(["warm_cards", [...picks, ...dealt.filter((i) => !picks.includes(i))]]);
  expect(warm.slice(teachAt + 1), "the order after it").toEqual([["warm_cards", []]]);
  app.budget(`teach it → the first pick's controls live (its insert ${Math.round(insert)} ms)`, ms, 1000);
});

// The session a player opens has no seed in the address, and its deals are
// drawn at once from the sounds that have arrived, while the pool fills too;
// only a seeded session's keep to the fill's schedule and wait for its
// sounds (#211). So the same picks are measured in both, with the same
// budgets, the second's named for it.
for (const [title, session, as] of [
  ["a pick puts the next pair up within 0.3 s, and its ▶ sounds within 0.15 s", {}, ""],
  ["in a session with no seed, a pick puts the next pair up within 0.3 s, and its ▶ sounds within 0.15 s", { seed: null, random: null }, "no seed: "],
]) test(title, async ({ page, app }) => {
  await app.boot(session);
  // Only a seed in the address deals by the fill's schedule (#211): the
  // page says which it is with `init`.
  const [init] = await app.sent({ type: "init" });
  expect(init.seeded, "seeded only with a seed in the address").toBe(session.seed !== null);
  await goLevel(page, "evolve");
  await app.engine((timeout) => expect(page.locator("#choose-a")).toBeEnabled({ timeout }), { ms: 60_000 });
  const deals = [];
  const plays = [];
  for (let i = 0; i < 5; i++) {
    // A player listens before choosing: by then the next pair and its sounds
    // are here. The next pair is the one dealt for the pair now on the table:
    // right after a pick the newest pair dealt ahead is the one the pick just
    // put up, whose sounds are already here, and a pick made then raced the
    // next deal and its renders (on a CI runner, behind a render of PERFORM's
    // measurement of the sound the app opened with). Nor is it a deal of the
    // table's own pair or of the pair just picked, which main refuses and
    // deals again (deal.js `usable`). Read from the tap: the table is the pair
    // main last said it showed (`duel_shown`), and the deal for it is the
    // newest deal ahead main asked for after that, by the reply carrying
    // its request's number.
    await app.engine((timeout) => page.waitForFunction(() => {
      const T = window.__tap;
      const shown = T.sent.filter((x) => x.type === "duel_shown");
      const s = shown[shown.length - 1];
      if (!s) return false;
      const before = shown[shown.length - 2];
      const asked = T.sent.slice(T.sent.indexOf(s) + 1).filter((x) => x.type === "duel" && x.m.ahead);
      const ask = asked[asked.length - 1];
      const at = ask ? T.finals[ask.m.rid] : null;
      const p = at == null ? null : T.replies[at].d.pair;
      if (!p) return false;
      const same = (q) => !!q && p.includes(q.m.a) && p.includes(q.m.b);
      if (same(s) || same(before)) return false;
      const rendered = new Set(T.replies.filter((r) => r.type === "render" && !r.injected && !r.d.failed).map((r) => r.d.id));
      return p.every((id) => rendered.has(id));
    }, null, { timeout }), { ms: 60_000 });
    // eslint-disable-next-line playwright/no-wait-for-timeout -- a player listens before choosing
    await page.waitForTimeout(LISTEN_MS);
    // In the click's own task, before anything else can run: the cards show
    // another pair, live, and no deal for the table was asked for.
    const d = await page.evaluate(async ([side, js]) => {
      const ids = () => ["a", "b"].map((s) => document.querySelector(`#name-${s} .dn-id`)?.textContent).join();
      const before = ids();
      window.__cond = () => ids() !== before && !document.getElementById("choose-a").disabled;
      const n0 = window.__tap.sent.length;
      document.getElementById(`choose-${side}`).click();
      const sync = window.__cond();
      const tableDeals = window.__tap.sent.slice(n0).filter((x) => x.type === "duel" && !x.m.ahead).length;
      return { sync, tableDeals, ms: await eval(js) };
    }, [i % 2 ? "b" : "a", until("window.__cond")]);
    expect(d.sync, `pick ${i + 1}: the next pair went up in the click's own task`).toBe(true);
    expect(d.tableDeals, `pick ${i + 1}: a deal for the table was asked for`).toBe(0);
    deals.push(d.ms);
    // ▶ sounds in its click's task, and asks for no render: its sound is here.
    const p = await page.evaluate(async (js) => {
      const b = document.getElementById("play-a");
      window.__cond = () => b.classList.contains("playing");
      const n0 = window.__tap.sent.length;
      b.click();
      const sync = window.__cond();
      const renders = window.__tap.sent.slice(n0).filter((x) => x.type === "render").length;
      return { sync, renders, ms: await eval(js) };
    }, until("window.__cond"));
    expect(p.sync, `▶ after pick ${i + 1} sounds in its click's own task`).toBe(true);
    expect(p.renders, `▶ after pick ${i + 1} asked for a render: its sound was not here`).toBe(0);
    plays.push(p.ms);
    await page.locator("#play-a").click(); // stop
  }
  console.log(`${as}pick → next pair (ms): ${deals.map((x) => x.toFixed(0)).join(", ")}; ▶ → sounding (ms): ${plays.map((x) => x.toFixed(0)).join(", ")}`);
  deals.forEach((ms, i) => app.budget(`${as}pick ${i + 1} → the next pair on the table`, ms, 300));
  plays.forEach((ms, i) => app.budget(`${as}▶ after pick ${i + 1} → sounding`, ms, 150));
});
