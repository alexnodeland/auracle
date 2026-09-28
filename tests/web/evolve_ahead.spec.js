// EVOLVE: the next pair is already waiting.
//
// A pick used to put the pair away and wait for the engine to deal the next
// (about 30 ms on a quiet engine, a whole seed's walk during a generation),
// and then for its two sounds to render. Now, while a pair is on the table,
// the next is dealt and both its sounds fetched; a pick or ↻ puts it up at
// once, and the one after is dealt behind it. A pick taken back puts its pair
// back and keeps the other as the next; a patch cut meanwhile is never put up.
//
// Pairs go up in the order the engine dealt them, whatever the timing. A pick
// made while the next deal is still out (a generation holds deals behind the
// seed being bred) used to ask for a second deal, keep the first answer as
// "the next" and put the second up: the table ran P, R, Q instead of P, Q, R,
// so when an answer landed changed what a seeded session showed.
//
// The engine worker is reached by wrapping `Worker` before main.js runs, to
// see which deals were asked for ahead. Sessions are seeded.
const { test, expect } = require("@playwright/test");

const SEED = `(() => { let s = 20260928 >>> 0; Math.random = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();`;

const INIT = `(() => {
  const Orig = window.Worker;
  const ahead = (window.__ahead = []);
  // Every deal asked for and answered, in order: [sent|got, ahead?, pair, t].
  const deals = (window.__deals = []);
  // A gate on what the engine says: while closed, its replies wait in order,
  // as they do while it breeds a generation, and opening it hands them over
  // in the order they were sent. Armed, it closes on the next deal asked for
  // ahead, so that deal is still out when the player picks.
  const gate = (window.__gate = { armed: false, closed: false, q: [] });
  function Wrapped(url, opts) {
    const w = new Orig(url, opts);
    if (/worker\\.js/.test(String(url))) {
      let handler = null;
      Object.defineProperty(w, "onmessage", { configurable: true, get: () => handler, set: (fn) => { handler = fn; } });
      window.__openGate = () => {
        gate.closed = false;
        for (const e of gate.q.splice(0)) handler && handler.call(w, e);
      };
      w.addEventListener("message", (e) => {
        const d = e.data;
        if (d && d.type === "duel") deals.push(["got", !!d.ahead, d.pair, performance.now()]);
        if (d && d.type === "duel" && d.ahead && d.pair) ahead.push(d.pair);
        if (gate.closed) gate.q.push(e);
        else if (handler) handler.call(w, e);
      });
      const post = w.postMessage.bind(w);
      w.postMessage = (m, t) => {
        if (m && m.type === "duel") deals.push(["sent", !!m.ahead, null, performance.now()]);
        if (m && m.type === "duel" && m.ahead && gate.armed) {
          gate.armed = false;
          gate.closed = true;
        }
        return post(m, t);
      };
    }
    return w;
  }
  Wrapped.prototype = Orig.prototype;
  window.Worker = Wrapped;
  try {
    for (const k of ["auracle-played", "auracle-bench-tour", "auracle-bank-toured", "auracle-warmed"]) localStorage.setItem(k, "1");
  } catch (_) {}
})();`;

async function boot(page) {
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.addInitScript(SEED);
  await page.addInitScript(INIT);
  await page.goto("/");
  await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 150_000 });
  await page.locator('.viewtab[data-view="evolve"]').click();
  await expect(page.locator("#choose-a")).toBeEnabled({ timeout: 60_000 });
  return errs;
}

const cardIds = (page) =>
  page.evaluate(() => ["a", "b"].map((s) => Number(document.querySelector(`#name-${s} .dn-id`).textContent.replace("#", ""))));
const aheadCount = (page) => page.evaluate(() => window.__ahead.length);

/** Click a card's control in the page and return how long, in the page's
 *  clock, until the cards show a different pair. */
async function pickAndTime(page, sel) {
  return page.evaluate(async (sel) => {
    const ids = () => ["a", "b"].map((s) => document.querySelector(`#name-${s} .dn-id`)?.textContent).join();
    const before = ids();
    const t0 = performance.now();
    document.querySelector(sel).click();
    for (;;) {
      if (ids() !== before && !document.querySelector("#choose-a").disabled) return performance.now() - t0;
      if (performance.now() - t0 > 60_000) return Infinity;
      await new Promise((r) => setTimeout(r, 2));
    }
  }, sel);
}

test("a pick puts the pair dealt ahead on the table at once, sounds and all", async ({ page }) => {
  test.setTimeout(300_000);
  const errs = await boot(page);
  // A pair dealt ahead, and its sounds fetched.
  await expect.poll(() => aheadCount(page), { timeout: 60_000 }).toBeGreaterThanOrEqual(1);
  await page.waitForTimeout(3_000);
  const before = await cardIds(page);
  const mark = await page.evaluate(() => window.__deals.length);

  const ms = await pickAndTime(page, "#choose-a");
  console.log(`pick → next pair on the table: ${ms.toFixed(0)} ms`);
  const now = await cardIds(page);
  const deals = await page.evaluate(() => window.__deals);
  console.log(`deals: ${JSON.stringify(deals.map(([k, a, p]) => [k, a ? "ahead" : "table", p]))}`);
  expect(ms).toBeLessThan(300);
  // It was a pair dealt ahead, and no deal for the table was asked for.
  expect(await page.evaluate(() => window.__ahead.map((p) => [...p].sort().join()))).toContain([...now].sort().join());
  expect(deals.slice(mark).filter(([k, a]) => k === "sent" && !a), "a deal was asked for after the pick").toEqual([]);
  expect(now).not.toEqual(before);
  // Its sound is here: ▶ SAMPLE plays at once.
  const play = await page.evaluate(async () => {
    const b = document.querySelector("#play-a");
    const t0 = performance.now();
    b.click();
    for (;;) {
      if (b.classList.contains("playing")) return performance.now() - t0;
      if (performance.now() - t0 > 30_000) return Infinity;
      await new Promise((r) => setTimeout(r, 2));
    }
  });
  console.log(`▶ SAMPLE on the pair dealt ahead: ${play.toFixed(0)} ms`);
  expect(play).toBeLessThan(150);
  await page.locator("#play-a").click(); // stop it

  // Taken back: the pick's pair returns, and the one it brought up waits.
  await page.keyboard.press("Control+z");
  await expect.poll(async () => [...(await cardIds(page))].sort().join()).toBe([...before].sort().join());
  const again = await pickAndTime(page, "#choose-b");
  expect(again).toBeLessThan(300);
  expect([...(await cardIds(page))].sort()).toEqual([...now].sort());

  // ↻ swaps too, and the one after that is dealt behind it.
  await expect.poll(() => aheadCount(page), { timeout: 60_000 }).toBeGreaterThanOrEqual(2);
  await page.waitForTimeout(2_000);
  const skip = await pickAndTime(page, "#skip-duel");
  console.log(`another pair ↻: ${skip.toFixed(0)} ms`);
  expect(skip).toBeLessThan(300);
  expect(errs).toEqual([]);
});

test("a patch cut while its pair waits ahead is never put up", async ({ page }) => {
  test.setTimeout(300_000);
  const errs = await boot(page);
  await expect.poll(() => aheadCount(page), { timeout: 60_000 }).toBeGreaterThanOrEqual(1);
  const [cut] = await page.evaluate(() => window.__ahead[window.__ahead.length - 1]);
  const row = page.locator(`#bank-list .bank-item[data-id="${cut}"]`);
  await row.scrollIntoViewIfNeeded();
  await row.hover();
  await row.locator(".bi-kill").click();
  await expect(row).toHaveCount(0);
  for (let i = 0; i < 4; i++) {
    await expect(page.locator("#choose-a")).toBeEnabled({ timeout: 30_000 });
    await page.locator("#choose-a").click();
    await expect(page.locator("#choose-a")).toBeEnabled({ timeout: 30_000 });
    expect(await cardIds(page), "a cut patch was dealt from ahead").not.toContain(cut);
  }
  expect(errs).toEqual([]);
});

/** The pair on the table, sorted, as a string (sides are shuffled). */
const tableKey = async (page) => [...(await cardIds(page))].sort((x, y) => x - y).join();
const key = (p) => [...p].sort((x, y) => x - y).join();

test("pairs go up in the order they were dealt when a pick lands while the next deal is out", async ({ page }) => {
  test.setTimeout(300_000);
  const errs = await boot(page);
  await expect.poll(() => aheadCount(page), { timeout: 60_000 }).toBeGreaterThanOrEqual(1);
  await page.waitForTimeout(3_000);

  // A pick puts the waiting pair up; the deal after it goes out, and the
  // gate holds its answer.
  await page.evaluate(() => { window.__gate.armed = true; });
  const mark = await page.evaluate(() => window.__deals.length);
  expect(await pickAndTime(page, "#choose-a")).toBeLessThan(300);
  await expect.poll(() => page.evaluate(() => window.__gate.closed)).toBe(true);
  // Picked again while that deal is out: the cards wait for it.
  await page.locator("#choose-b").click();
  await expect(page.locator("#choose-a")).toBeDisabled();
  await page.waitForTimeout(1_500);
  await page.evaluate(() => window.__openGate());
  await expect(page.locator("#choose-a")).toBeEnabled({ timeout: 30_000 });
  const dealt = () =>
    page.evaluate((m) => window.__deals.slice(m).filter(([k, , p]) => k === "got" && p).map(([, , p]) => p), mark);
  const first = await dealt();
  console.log(`dealt after the pick: ${JSON.stringify(first)}; on the table: ${await tableKey(page)}`);
  // The first pair dealt after the pick is the one on the table…
  expect(await tableKey(page)).toBe(key(first[0]));
  // …and nothing was dealt for the table on top of the deal already out.
  const sentForTable = await page.evaluate((m) => window.__deals.slice(m).filter(([k, a]) => k === "sent" && !a).length, mark);
  expect(sentForTable, "a second deal was asked for while one was out").toBe(0);

  // The next pick puts up the pair dealt after that one, at once.
  await expect.poll(async () => (await dealt()).length, { timeout: 60_000 }).toBeGreaterThanOrEqual(2);
  await page.waitForTimeout(2_000);
  expect(await pickAndTime(page, "#choose-a")).toBeLessThan(300);
  expect(await tableKey(page)).toBe(key((await dealt())[1]));
  expect(errs).toEqual([]);
});

test("a pick taken back while the next deal is out leaves that pair waiting as the next", async ({ page }) => {
  test.setTimeout(300_000);
  const errs = await boot(page);
  await expect.poll(() => aheadCount(page), { timeout: 60_000 }).toBeGreaterThanOrEqual(1);
  await page.waitForTimeout(3_000);
  const mark = await page.evaluate(() => window.__deals.length);
  await page.evaluate(() => { window.__gate.armed = true; });
  expect(await pickAndTime(page, "#choose-a")).toBeLessThan(300);
  await expect.poll(() => page.evaluate(() => window.__gate.closed)).toBe(true);
  const before = await tableKey(page);
  await page.locator("#choose-b").click();
  await expect(page.locator("#choose-a")).toBeDisabled();
  // Taken back: the pair returns, live, while the deal is still out.
  await page.keyboard.press("Control+z");
  await expect(page.locator("#choose-a")).toBeEnabled();
  expect(await tableKey(page)).toBe(before);
  await page.evaluate(() => window.__openGate());
  // The deal that was out is the next pair, sounds and all: the next pick
  // puts it up at once, without a deal.
  await expect.poll(() => page.evaluate((m) => window.__deals.slice(m).some(([k, , p]) => k === "got" && p), mark), { timeout: 60_000 }).toBe(true);
  await page.waitForTimeout(3_000);
  const next = await page.evaluate((m) => window.__deals.slice(m).find(([k, , p]) => k === "got" && p)[2], mark);
  const pickMark = await page.evaluate(() => window.__deals.length);
  expect(await pickAndTime(page, "#choose-a")).toBeLessThan(300);
  expect(await tableKey(page)).toBe(key(next));
  const sentForTable = await page.evaluate((m) => window.__deals.slice(m).filter(([k, a]) => k === "sent" && !a).length, pickMark);
  expect(sentForTable).toBe(0);
  expect(errs).toEqual([]);
});
