// EVOLVE: the next pair is already waiting.
//
// A pick used to put the pair away and wait for the engine to deal the next
// (about 30 ms on a quiet engine, a whole seed's walk during a generation),
// and then for its two sounds to render. Now, while a pair is on the table,
// the next is dealt and both its sounds fetched; a pick or ↻ puts it up at
// once, and the one after is dealt behind it. A pick taken back puts its pair
// back and keeps the other as the next; a patch cut meanwhile is never put up.
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
  function Wrapped(url, opts) {
    const w = new Orig(url, opts);
    if (/worker\\.js/.test(String(url))) {
      w.addEventListener("message", (e) => {
        const d = e.data;
        if (d && d.type === "duel") deals.push(["got", !!d.ahead, d.pair, performance.now()]);
        if (d && d.type === "duel" && d.ahead && d.pair) ahead.push(d.pair);
      });
      const post = w.postMessage.bind(w);
      w.postMessage = (m, t) => {
        if (m && m.type === "duel") deals.push(["sent", !!m.ahead, null, performance.now()]);
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
