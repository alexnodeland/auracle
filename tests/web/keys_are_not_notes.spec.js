// A key that a focused list, the rack or a dialog handles does only that:
// it is not also a note, and not also a global shortcut. The global handler
// lets note letters through a focused control on purpose (a click on HOLD
// must not silence the keyboard), so each handler that takes a letter or a
// digit for itself has to stop it. Three did not:
//
// - `p` in the presets list heard the preset and played a D♯ over it;
// - `L` on a rack plate or knob locked it and played a D;
// - `1` / `2` in PATCH's keep-as-new comparison played a side and also rated
//   the bank's row 1★ or 2★.
//
// Reached the way the other specs reach the app: a wrapped `Worker`, seeded.
const { test, expect } = require("@playwright/test");
const { goLevel } = require("./shell");

const SEED = `(() => { let s = 20260927 >>> 0; Math.random = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();`;

const init = ({ warmed = true } = {}) => `(() => {
  const Orig = window.Worker;
  const workers = (window.__pwWorkers = []);
  const last = (window.__pwLast = {});
  const sent = (window.__pwSent = {});
  const counts = (window.__pwCounts = {});
  const log = (window.__pwLog = []);
  function Wrapped(url, opts) {
    const w = new Orig(url, opts);
    w.__pwUrl = String(url);
    workers.push(w);
    w.addEventListener("message", (e) => {
      const d = e.data;
      if (d && typeof d.type === "string") {
        last[d.type] = d;
        counts[d.type] = (counts[d.type] || 0) + 1;
        log.push({ type: d.type, at: performance.now() });
      }
    });
    const post = w.postMessage.bind(w);
    w.postMessage = (m, t) => {
      if (m && m.type) {
        counts["sent:" + m.type] = (counts["sent:" + m.type] || 0) + 1;
        sent[m.type] = m;
        log.push({ type: "sent:" + m.type, at: performance.now() });
        // A request held back on request (a deal, an open): the stand-in for
        // an engine busy with a generation, which is when they wait seconds.
        const ms = (window.__pwHold || {})[m.type];
        if (ms > 0) {
          setTimeout(() => post(m, t), ms);
          return;
        }
      }
      return post(m, t);
    };
    return w;
  }
  Wrapped.prototype = Orig.prototype;
  window.Worker = Wrapped;
  window.__pwEngine = () => workers.find((w) => /worker\\.js/.test(w.__pwUrl)) || null;
  const toasts = (window.__pwToasts = []);
  const teach = (window.__pwTeach = []);
  document.addEventListener("DOMContentLoaded", () => {
    const lane = document.getElementById("toasts");
    if (lane) {
      new MutationObserver((muts) => {
        for (const m of muts)
          for (const n of m.addedNodes) {
            const msg = n.querySelector && n.querySelector(".toast-msg");
            if (msg) toasts.push({ text: msg.textContent, at: performance.now() });
          }
      }).observe(lane, { childList: true });
    }
    // Every sentence the teaching meter says, with when it said it.
    const copy = document.getElementById("teach-copy");
    if (copy) {
      new MutationObserver(() => teach.push({ text: copy.textContent, at: performance.now() }))
        .observe(copy, { childList: true, subtree: true, characterData: true });
    }
  });
  try {
    const seen = ["auracle-played", "auracle-bench-tour", "auracle-bank-toured"];
    if (${warmed}) seen.push("auracle-warmed");
    for (const k of seen) localStorage.setItem(k, "1");
  } catch (_) {}
})();`;

async function boot(page, opts = {}) {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await page.addInitScript(SEED);
  await page.addInitScript(init(opts));
  await page.goto("/");
  await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 150_000 });
  return pageErrors;
}

const count = (page, type) => page.evaluate((t) => window.__pwCounts[t] || 0, type);
const picks = async (page) => Number(await page.locator("#duel-count").textContent());
const cardIds = (page) =>
  page.evaluate(() => ["a", "b"].map((s) => Number(document.querySelector(`#name-${s} .dn-id`).textContent.replace("#", ""))));
const toastsSince = (page, k) => page.evaluate((i) => window.__pwToasts.slice(i).map((t) => t.text), k);
const toastMark = (page) => page.evaluate(() => window.__pwToasts.length);

test("1 and 2 in the keep-as-new comparison play a side and rate nothing", async ({ page }) => {
  const pageErrors = await boot(page);
  await page.waitForFunction(() => window.__aur && window.__aur.wb && window.__aur.wb.rack, null, { timeout: 60_000 });
  await goLevel(page, "patch");
  const knob = page.locator("#rack-svg [data-addr]").first();
  await expect(knob).toBeAttached({ timeout: 30_000 });
  await knob.focus();
  const before = await knob.getAttribute("aria-valuetext");
  for (let i = 0; i < 8; i++) await page.keyboard.press("ArrowUp");
  await expect(knob).not.toHaveAttribute("aria-valuetext", before, { timeout: 10_000 });
  await expect(page.locator("#rack-commit")).toBeEnabled({ timeout: 15_000 });
  await page.locator("#rack-commit").click();
  await expect(page.locator("#cduel")).toBeVisible({ timeout: 30_000 });
  const stars = await count(page, "sent:record_stars");
  const mark = await toastMark(page);
  await page.keyboard.press("1");
  await page.keyboard.press("2");
  await page.waitForTimeout(1500);
  expect(await count(page, "sent:record_stars"), "a comparison key rated the bank's row").toBe(stars);
  for (const t of await toastsSince(page, mark)) expect(t).not.toMatch(/rated|already \d★|Nothing selected to rate/);
  expect(pageErrors, `uncaught exceptions:\n${pageErrors.join("\n")}`).toEqual([]);
});

test("L on a rack knob locks it without playing a note", async ({ page }) => {
  const pageErrors = await boot(page);
  await page.waitForFunction(() => window.__aur && window.__aur.wb && window.__aur.wb.rack, null, { timeout: 60_000 });
  await goLevel(page, "patch");
  const knob = page.locator("#rack-svg [data-addr]").first();
  await expect(knob).toBeAttached({ timeout: 30_000 });
  const halos = () => page.locator("#rack-svg .knob-locked-halo").count();
  const h0 = await halos();
  await knob.focus();
  const down = () => page.evaluate(() => document.querySelectorAll(".pkey.down, .bkey.down").length);
  await page.keyboard.down("l");
  await page.waitForTimeout(200);
  expect(await down(), "l played a note from a rack knob").toBe(0);
  await page.keyboard.up("l");
  await expect.poll(halos).toBeGreaterThan(h0);
  expect(pageErrors, `uncaught exceptions:\n${pageErrors.join("\n")}`).toEqual([]);
});

test("p in the preset list hears the preset without playing a note", async ({ page }) => {
  const pageErrors = await boot(page);
  await page.waitForFunction(() => window.__aur && window.__aur.getLive && window.__aur.getLive(), null, { timeout: 60_000 });
  await page.locator('.bf[data-f="preset"]').click();
  await expect(page.locator("#bank-list .preset-item").first()).toBeVisible({ timeout: 30_000 });
  await page.locator("#bank-list").focus();
  await page.keyboard.press("ArrowDown");
  const down = () => page.evaluate(() => document.querySelectorAll(".pkey.down, .bkey.down").length);
  await page.keyboard.down("p");
  await page.waitForTimeout(200);
  expect(await down(), "p played a note from the preset list").toBe(0);
  await page.keyboard.up("p");
  // …while the same key away from the list is still a note.
  await page.locator("#bank-list").evaluate((el) => el.blur());
  await page.keyboard.down("p");
  await expect.poll(down).toBe(1);
  await page.keyboard.up("p");
  expect(pageErrors, `uncaught exceptions:\n${pageErrors.join("\n")}`).toEqual([]);
});
