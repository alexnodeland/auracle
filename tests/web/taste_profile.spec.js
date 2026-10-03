// The taste profile's three menu items say what they do, and Reset keeps what
// is yours.
//
// - Reset asked "Every pick, star and generation is forgotten", kept no copy,
//   and deleted the whole saved record — the saved patches (MY PATCHES) with
//   it, which the guide says a reset leaves alone. It now asks with the
//   counts, downloads the profile first (as Load does), and keeps the saved
//   patches.
// - Save taste profile downloaded a file and said nothing in the app.
//
// Downloads are Playwright's `download` event; the file is read back to check
// it holds the picks the question counted. The engine worker is reached the
// way failure_flows.spec.js reaches it: by wrapping `Worker` before main.js
// runs.
const { test, expect } = require("@playwright/test");
const { goLevel } = require("./shell");
const fs = require("fs");

const SEED = `(() => { let s = 20260928 >>> 0; Math.random = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();`;

// The first-run marks are set once per tab, not on every load: after a reset
// the warm start is owed again, and a spec that re-set them would hide it.
const INIT = `(() => {
  const Orig = window.Worker;
  const workers = (window.__pwWorkers = []);
  const last = (window.__pwLast = {});
  function Wrapped(url, opts) {
    const w = new Orig(url, opts);
    w.__pwUrl = String(url);
    workers.push(w);
    w.addEventListener("message", (e) => {
      const d = e.data;
      if (d && typeof d.type === "string") last[d.type] = d;
    });
    return w;
  }
  Wrapped.prototype = Orig.prototype;
  window.Worker = Wrapped;
  try {
    if (!sessionStorage.getItem("pw-first-run-set")) {
      sessionStorage.setItem("pw-first-run-set", "1");
      for (const k of ["auracle-warmed", "auracle-played", "auracle-bench-tour", "auracle-bank-toured"])
        localStorage.setItem(k, "1");
    }
  } catch (_) {}
})();`;

async function boot(page) {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await page.addInitScript(SEED);
  await page.addInitScript(INIT);
  await page.goto("/");
  await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 150_000 });
  return pageErrors;
}

async function pick(page, n) {
  await goLevel(page, "evolve");
  for (let i = 0; i < n; i++) {
    await expect(page.locator("#choose-a")).toBeEnabled({ timeout: 30_000 });
    await page.locator("#choose-a").click();
    await page.waitForTimeout(400);
  }
}

async function menu(page, id) {
  await page.locator("#ovf-btn").click();
  await page.locator(`#${id}`).click();
}

const readJson = async (download) => JSON.parse(fs.readFileSync(await download.path(), "utf8"));

test("Reset asks with the counts, downloads the profile first, and keeps the saved patches", async ({ page }) => {
  test.setTimeout(360_000);
  const pageErrors = await boot(page);
  await page.waitForFunction(() => window.__pwLast.duel && window.__pwLast.duel.pair, null, { timeout: 60_000 });
  await pick(page, 2);
  await expect(page.locator("#duel-count")).toHaveText("2");

  // Save one patch from the pool.
  await page.locator('.bf[data-f="pool"]').click();
  const row = page.locator("#bank-list .bank-item").first();
  // By id: the name of a patch nobody has named is drawn from the pool
  // around it, and the pool is new after a reset.
  const id = (await row.locator(".bi-id").first().textContent()).trim();
  await row.hover();
  await row.locator(".bi-save").click();
  await expect(page.locator('.bf-n[data-n="mine"]')).toHaveText("1", { timeout: 20_000 });

  // The question names what goes and what stays, and "keep it" keeps it.
  await menu(page, "taste-reset-btn");
  const alarm = page.locator("#alarm");
  await expect(alarm).toContainText(
    "Reset your taste? Your 2 picks, 0 stars, 0 cuts, and 0 generations are forgotten, with every sound you haven’t saved. " +
      "Your 1 saved sound stays. A copy of your taste downloads first.",
  );
  await expect(alarm.locator("button", { hasText: "download & reset" })).toBeVisible();
  await alarm.locator("button", { hasText: "keep it" }).click();
  await expect(alarm).toHaveClass(/\bhidden\b/);
  await expect(page.locator("#duel-count")).toHaveText("2");

  // "download & reset": the copy first, holding the two picks, then the reload.
  await menu(page, "taste-reset-btn");
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 30_000 }),
    alarm.locator("button", { hasText: "download & reset" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("auracle-profile-before-reset.json");
  const copy = await readJson(download);
  expect(copy.log.observations.length).toBe(2);

  // A fresh taste on the reload: no picks, the warm start again, and the
  // saved patch still saved.
  await page.waitForEvent("load", { timeout: 60_000 });
  await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 150_000 });
  await expect(page.locator("#warmstart")).not.toHaveClass(/\bhidden\b/, { timeout: 30_000 });
  await page.locator("#warm-skip").click();
  await expect(page.locator("#duel-count")).toHaveText("0");
  await expect(page.locator('.bf-n[data-n="mine"]')).toHaveText("1", { timeout: 60_000 });
  await page.locator('.bf[data-f="mine"]').click();
  await expect(page.locator("#bank-list .bank-item .bi-id")).toHaveText([id]);
  expect(pageErrors, `uncaught exceptions:\n${pageErrors.join("\n")}`).toEqual([]);
});

test("Save taste profile says what it downloaded", async ({ page }) => {
  test.setTimeout(240_000);
  const pageErrors = await boot(page);
  await page.waitForFunction(() => window.__pwLast.duel && window.__pwLast.duel.pair, null, { timeout: 60_000 });
  await pick(page, 1);
  // The pick's undo window closes and it joins the log the file is made from.
  await expect.poll(() => page.evaluate(() => window.__pwLast.status && window.__pwLast.status.status.observations), { timeout: 30_000 }).toBe(1);
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 30_000 }), menu(page, "export-btn")]);
  expect(download.suggestedFilename()).toBe("auracle-profile.json");
  expect((await readJson(download)).log.observations.length).toBe(1);
  await expect(page.locator("#toasts .toast-msg", { hasText: "Downloaded your taste" })).toHaveText(
    "Downloaded your taste (auracle-profile.json): 1 pick, 0 stars, and 0 cuts.",
    { timeout: 15_000 },
  );
  expect(pageErrors, `uncaught exceptions:\n${pageErrors.join("\n")}`).toEqual([]);
});
