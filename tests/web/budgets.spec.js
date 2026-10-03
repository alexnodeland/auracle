// What the instrument promises about time, measured (the interaction spec's
// response-time budget, RT12).
//
// - The app marks its own moments (`performance.mark("auracle:…")`, listed by
//   `window.__aur.marks()`): boot start, veil down, first sound, pool full,
//   PERFORM wired, patch opened. The film recorder writes them into every
//   rehearsal's sidecar.
// - A preset's controls are live the moment PERFORM names it (every preset
//   ships measured), and within a second of its click. What stands between
//   the click and PERFORM having the patch is the open itself: the preset's
//   insert (one render, about 0.4 s on a quiet machine) and the bench. The
//   budget is judged where the insert took the time it was set for (under
//   0.5 s); on a machine loaded enough that one render takes longer, the
//   miss is recorded as an annotation with the split, not failed, and
//   "live the moment it lands" is still required.
// - A warm-start pick's controls are live within a second of "teach it",
//   judged the same way (its insert is the first thing the worker does).
// - A pick puts the next pair up within 0.3 s, and its ▶ sounds within
//   0.15 s: the next pair is dealt, and its sounds fetched, ahead.
//
// Times are taken in the page's own clock, from the gesture's own task, so
// Playwright's polling is not in them. The budgets are the spec's; a miss on
// a loaded machine is a finding about the machine only if the log says so.
const { test, expect } = require("@playwright/test");
const { goLevel, bankTab } = require("./shell");

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
    const row = page.locator(".bank-item", { hasText: name }).first();
    await row.scrollIntoViewIfNeeded();
    const [ms, named, steps, insert] = await page.evaluate(
      async ([name, js]) => {
        window.__want = name;
        window.__named = null;
        const el = [...document.querySelectorAll(".bank-item")].find((e) => e.querySelector(".bi-name")?.textContent === name);
        const t0 = performance.now();
        const from = window.__steps.length;
        el.click();
        const ms = await eval(js);
        const s = window.__steps.slice(from);
        const at = (k) => (s.find(([x]) => x === k) || [])[1];
        return [ms, window.__named - t0, s.map(([k, t]) => `${k} ${Math.round(t - t0)}`).join(", "), at("preset_loaded") - at("load_preset")];
      },
      [name, until(LIVE)],
    );
    console.log(`${name}: click → named in PERFORM ${named.toFixed(0)} ms → controls live ${ms.toFixed(0)} ms (${steps})`);
    expect(ms - named, `${name}'s controls live when it lands`).toBeLessThan(100);
    if (insert < 500) expect(ms, `${name}'s controls, from the click`).toBeLessThan(1000);
    else if (ms >= 1000) {
      test.info().annotations.push({ type: "budget not judged", description: `${name}: its insert alone took ${Math.round(insert)} ms on this machine; click → live ${Math.round(ms)} ms` });
    }
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
  const [ms, named, insert] = await page.evaluate(
    async ([name, js]) => {
      window.__want = name;
      window.__named = null;
      const from = window.__steps.length;
      const t0 = performance.now();
      document.getElementById("warm-go").click();
      const ms = await eval(js);
      const s = window.__steps.slice(from);
      const at = (k) => (s.find(([x]) => x === k) || [])[1];
      return [ms, window.__named - t0, at("warm_first") - at("warm_start")];
    },
    [first, until(LIVE)],
  );
  console.log(`teach it → ${first} named ${named.toFixed(0)} ms (its insert ${insert.toFixed(0)} ms) → controls live ${ms.toFixed(0)} ms`);
  expect(ms - named, "its controls are live when it lands").toBeLessThan(100);
  if (insert < 500) expect(ms, "teach it → controls live").toBeLessThan(1000);
  else if (ms >= 1000) {
    test.info().annotations.push({ type: "budget not judged", description: `the first pick's insert alone took ${Math.round(insert)} ms on this machine; teach it → live ${Math.round(ms)} ms` });
  }
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
    // deals again (`aheadUsable`).
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
    const d = await page.evaluate(async ([side, js]) => {
      const ids = () => ["a", "b"].map((s) => document.querySelector(`#name-${s} .dn-id`)?.textContent).join();
      const before = ids();
      window.__cond = () => ids() !== before && !document.getElementById("choose-a").disabled;
      document.getElementById(`choose-${side}`).click();
      return eval(js);
    }, [i % 2 ? "b" : "a", until("window.__cond")]);
    deals.push(d);
    const p = await page.evaluate(async (js) => {
      const b = document.getElementById("play-a");
      window.__cond = () => b.classList.contains("playing");
      b.click();
      return eval(js);
    }, until("window.__cond"));
    plays.push(p);
    await page.locator("#play-a").click(); // stop
  }
  console.log(`pick → next pair (ms): ${deals.map((x) => x.toFixed(0)).join(", ")}; ▶ → sounding (ms): ${plays.map((x) => x.toFixed(0)).join(", ")}`);
  for (const d of deals) expect(d).toBeLessThan(300);
  for (const p of plays) expect(p).toBeLessThan(150);
  expect(errs).toEqual([]);
});
