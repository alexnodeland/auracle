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
//   does, and a memo hit, the engine having measured the cards while they
//   were chosen (`warm_cards`, the picks first; what is left is the render in
//   progress when "teach it" arrives, #221).
// - A pick puts the next pair up in the click's own task, with no deal
//   asked for, and its ▶ sounds in its own: the next pair is dealt, and its
//   sounds fetched, ahead. Within 0.3 s and 0.15 s.
//
// The order is asserted; the seconds are budgets (ADR-022, fixtures.js
// `budget`): each recorded as the test's annotation, with the insert's share
// in its name, and judged only with AURACLE_PERF=1, by the nightly Speed
// budgets job. Times are taken in the page's own clock, from the gesture's
// own task, so Playwright's polling is not in them.
const { test, expect } = require("@playwright/test");
const { goLevel, bankTab } = require("./shell");
const { budget } = require("./fixtures");

const INIT = ({ warmed }) => `(() => {
  const Orig = window.Worker;
  const ahead = (window.__ahead = []);
  const rendered = (window.__rendered = new Set());
  // The pair on the table, as main says it showed it (\`duel_shown\`), the
  // one before it, and for each pair dealt ahead, which table it was dealt for.
  window.__shown = null;
  window.__shownBefore = null;
  const aheadFor = (window.__aheadFor = []);
  let shownSeq = 0;
  // Where an open's time goes: [what, t] for the load, its reply, the bench
  // open and the bench's reply.
  const steps = (window.__steps = []);
  // Every request posted to the engine, in order: [type, ahead, bg].
  window.__sent = [];
  // The warm start's cards as main asked the engine to measure them, in
  // order, and its "teach it": [type, order].
  window.__warm = [];
  function Wrapped(url, opts) {
    const w = new Orig(url, opts);
    if (/worker\\.js/.test(String(url))) {
      w.addEventListener("message", (e) => {
        const d = e.data;
        if (d && d.type === "duel" && d.ahead && d.pair) {
          ahead.push(d.pair);
          aheadFor.push(shownSeq);
        }
        if (d && d.type === "render" && !d.failed) rendered.add(d.id);
        if (d && (d.type === "preset_loaded" || d.type === "warm_first" || (d.type === "bench" && d.subject != null))) steps.push([d.type, performance.now()]);
      });
      const post = w.postMessage.bind(w);
      w.postMessage = (m, t) => {
        if (m && typeof m.type === "string") window.__sent.push([m.type, !!m.ahead, !!m.bg]);
        if (m && (m.type === "warm_cards" || m.type === "warm_start")) window.__warm.push([m.type, m.order || null]);
        if (m && (m.type === "load_preset" || m.type === "edit_begin" || m.type === "warm_start")) steps.push([m.type, performance.now()]);
        if (m && m.type === "duel_shown") {
          window.__shownBefore = window.__shown;
          window.__shown = { a: m.a, b: m.b, seq: ++shownSeq };
        }
        return post(m, t);
      };
    }
    return w;
  }
  Wrapped.prototype = Orig.prototype;
  window.Worker = Wrapped;
  try {
    const seen = ["auracle-played", "auracle-bench-tour", "auracle-bank-toured"];
    if (${warmed}) seen.push("auracle-warmed");
    for (const k of seen) localStorage.setItem(k, "1");
  } catch (_) {}
})();`;

async function boot(page, { warmed = true } = {}) {
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.addInitScript(INIT({ warmed }));
  await page.goto("/");
  await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 150_000 });
  return errs;
}

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

test("the app marks boot, the veil, first sound, a full pool, PERFORM wired and a patch opened", async ({ page }) => {
  test.setTimeout(300_000);
  const errs = await boot(page);
  await goLevel(page, "perform");
  await page.keyboard.down("a");
  await page.waitForTimeout(300);
  await page.keyboard.up("a");
  await bankTab(page, "presets");
  await page.locator(".bank-item", { hasText: "Glass Pad" }).first().click();
  await expect(page.locator(".pf-name")).toHaveText("Glass Pad", { timeout: 60_000 });
  await expect.poll(async () => (await page.evaluate(() => window.__aur.marks())).map((m) => m.name), { timeout: 200_000 })
    .toEqual(expect.arrayContaining(["boot-start", "veil-down", "first-sound", "pool-full", "perform-wired", "patch-opened"]));
  const marks = await page.evaluate(() => window.__aur.marks());
  const at = (n) => marks.find((m) => m.name === n).t;
  console.log(`marks (ms since load): ${marks.map((m) => `${m.name} ${m.t}`).join(" · ")}`);
  expect(at("boot-start")).toBeLessThanOrEqual(at("veil-down"));
  expect(at("veil-down")).toBeLessThanOrEqual(at("pool-full"));
  expect(marks.some((m) => m.name === "perform-wired" && m.detail?.how === "shipped"), "a preset wired from the shipped file").toBe(true);
  expect(errs).toEqual([]);
});

test("a preset's controls are live within a second of its click", async ({ page }) => {
  test.setTimeout(300_000);
  const errs = await boot(page);
  await goLevel(page, "perform");
  await bankTab(page, "presets");
  for (const name of ["Acid Line", "Bell Jar", "Glass Pad"]) {
    await expect(page.locator(".bank-item", { hasText: name }).first()).toBeAttached();
    const [ms, named, steps, insert, liveAtName, how] = await page.evaluate(
      async ([name, js, watch]) => {
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
        const from = window.__steps.length;
        el.click();
        const ms = await eval(js);
        const s = window.__steps.slice(from);
        const at = (k) => (s.find(([x]) => x === k) || [])[1];
        const how = performance.getEntriesByName("auracle:perform-wired").find((e) => e.startTime >= t0 && e.detail?.name === name)?.detail?.how ?? null;
        return [ms, window.__named - t0, s.map(([k, t]) => `${k} ${Math.round(t - t0)}`).join(", "), at("preset_loaded") - at("load_preset"), window.__liveAtName, how];
      },
      [name, until(LIVE), WATCH_NAMING],
    );
    console.log(`${name}: click → named in PERFORM ${named.toFixed(0)} ms → controls live ${ms.toFixed(0)} ms (${steps}); live in the naming's task: ${liveAtName}; wired from ${how}`);
    expect(liveAtName, `${name}'s controls are live in the task PERFORM names it`).toBe(true);
    expect(how, `${name} is wired from the shipped file (the app's mark), not measured`).toBe("shipped");
    budget(`${name}: the click → its controls live (its insert ${Math.round(insert)} ms)`, ms, 1000);
    await page.waitForTimeout(1500);
  }
  expect(errs).toEqual([]);
});

test("a warm-start pick's controls are live within a second of teach it", async ({ page }) => {
  test.setTimeout(300_000);
  const errs = await boot(page, { warmed: false });
  await expect(page.locator("#warmstart")).not.toHaveClass(/\bhidden\b/, { timeout: 30_000 });
  const cards = page.locator(".warm-cell .warm-item");
  for (const i of [0, 3, 6]) await cards.nth(i).click();
  const first = (await cards.nth(0).locator(".wi-name").textContent()).trim();
  const [ms, named, insert, liveAtName, how] = await page.evaluate(
    async ([name, js, watch]) => {
      window.__want = name;
      window.__named = null;
      eval(watch);
      const from = window.__steps.length;
      const t0 = performance.now();
      document.getElementById("warm-go").click();
      const ms = await eval(js);
      const s = window.__steps.slice(from);
      const at = (k) => (s.find(([x]) => x === k) || [])[1];
      const how = performance.getEntriesByName("auracle:perform-wired").find((e) => e.startTime >= t0 && e.detail?.name === name)?.detail?.how ?? null;
      return [ms, window.__named - t0, at("warm_first") - at("warm_start"), window.__liveAtName, how];
    },
    [first, until(LIVE), WATCH_NAMING],
  );
  console.log(`teach it → ${first} named ${named.toFixed(0)} ms (its insert ${insert.toFixed(0)} ms) → controls live ${ms.toFixed(0)} ms; live in the naming's task: ${liveAtName}; wired from ${how}`);
  expect(liveAtName, "its controls are live in the task PERFORM names it").toBe(true);
  expect(how, "it is wired from the shipped file (the app's mark), not measured").toBe("shipped");
  // The engine was asked to measure the nine cards as they were dealt, then
  // the picks first in the order they were made, and none once the card
  // closed with "teach it".
  const warm = await page.evaluate(() => window.__warm);
  const dealt = warm[0][1];
  expect(warm[0][0]).toBe("warm_cards");
  expect(dealt).toHaveLength(9);
  const picks = [dealt[0], dealt[3], dealt[6]];
  const teachAt = warm.findIndex(([type]) => type === "warm_start");
  expect(warm[teachAt - 1], "the last order before teach it").toEqual(["warm_cards", [...picks, ...dealt.filter((i) => !picks.includes(i))]]);
  expect(warm.slice(teachAt + 1), "the order after it").toEqual([["warm_cards", []]]);
  budget(`teach it → the first pick's controls live (its insert ${Math.round(insert)} ms)`, ms, 1000);
  expect(errs).toEqual([]);
});

test("a pick puts the next pair up within 0.3 s, and its ▶ sounds within 0.15 s", async ({ page }) => {
  test.setTimeout(300_000);
  const errs = await boot(page);
  await goLevel(page, "evolve");
  await expect(page.locator("#choose-a")).toBeEnabled({ timeout: 60_000 });
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
    // deals again (deal.js `usable`).
    await page.waitForFunction(() => {
      const n = window.__ahead.length - 1;
      const p = window.__ahead[n];
      const s = window.__shown;
      if (!p || !s || window.__aheadFor[n] !== s.seq) return false;
      const same = (q) => !!q && p.includes(q.a) && p.includes(q.b);
      if (same(s) || same(window.__shownBefore)) return false;
      return p.every((id) => window.__rendered.has(id));
    }, null, { timeout: 60_000 });
    await page.waitForTimeout(500);
    // In the click's own task, before anything else can run: the cards show
    // another pair, live, and no deal for the table was asked for.
    const d = await page.evaluate(async ([side, js]) => {
      const ids = () => ["a", "b"].map((s) => document.querySelector(`#name-${s} .dn-id`)?.textContent).join();
      const before = ids();
      window.__cond = () => ids() !== before && !document.getElementById("choose-a").disabled;
      const n0 = window.__sent.length;
      document.getElementById(`choose-${side}`).click();
      const sync = window.__cond();
      const tableDeals = window.__sent.slice(n0).filter(([type, ahead]) => type === "duel" && !ahead).length;
      return { sync, tableDeals, ms: await eval(js) };
    }, [i % 2 ? "b" : "a", until("window.__cond")]);
    expect(d.sync, `pick ${i + 1}: the next pair went up in the click's own task`).toBe(true);
    expect(d.tableDeals, `pick ${i + 1}: a deal for the table was asked for`).toBe(0);
    deals.push(d.ms);
    // ▶ sounds in its click's task, and asks for no render: its sound is here.
    const p = await page.evaluate(async (js) => {
      const b = document.getElementById("play-a");
      window.__cond = () => b.classList.contains("playing");
      const n0 = window.__sent.length;
      b.click();
      const sync = window.__cond();
      const renders = window.__sent.slice(n0).filter(([type]) => type === "render").length;
      return { sync, renders, ms: await eval(js) };
    }, until("window.__cond"));
    expect(p.sync, `▶ after pick ${i + 1} sounds in its click's own task`).toBe(true);
    expect(p.renders, `▶ after pick ${i + 1} asked for a render: its sound was not here`).toBe(0);
    plays.push(p.ms);
    await page.locator("#play-a").click(); // stop
  }
  console.log(`pick → next pair (ms): ${deals.map((x) => x.toFixed(0)).join(", ")}; ▶ → sounding (ms): ${plays.map((x) => x.toFixed(0)).join(", ")}`);
  deals.forEach((ms, i) => budget(`pick ${i + 1} → the next pair on the table`, ms, 300));
  plays.forEach((ms, i) => budget(`▶ after pick ${i + 1} → sounding`, ms, 150));
  expect(errs).toEqual([]);
});
