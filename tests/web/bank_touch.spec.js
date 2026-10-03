// The bank under a finger (Plan-008 PR B). A tap on a row opens it and goes
// to PATCH, so on a touch screen a row's actions (▶, ★, save, cut) and a
// preset's ▶ are shown on every row at rest, on a line under the name, and
// answer a tap without opening the row; a mouse keeps the mock's actions on
// approach. A touch pointer "leaves" as it lifts, before its tap's click: the
// stars ★ folds out stay out for that click, so tapping the fifth star rates
// five and cannot press cut, which sits under it.
const { test, expect } = require("@playwright/test");
const { bankTab } = require("./shell");

// A tablet: a coarse pointer and touch, wide enough to have no gate.
test.use({ viewport: { width: 1280, height: 800 }, hasTouch: true, isMobile: true });

const INIT = `(() => {
  const Orig = window.Worker;
  window.__pwSent = [];
  window.__pwToasts = [];
  function Wrapped(url, opts) {
    const w = new Orig(url, opts);
    if (/worker\\.js/.test(String(url))) {
      const post = w.postMessage.bind(w);
      w.postMessage = (m, t) => { if (m && m.type) window.__pwSent.push(m); return post(m, t); };
    }
    return w;
  }
  Wrapped.prototype = Orig.prototype;
  window.Worker = Wrapped;
  document.addEventListener("DOMContentLoaded", () => {
    const lane = document.getElementById("toasts");
    if (lane) new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) {
        const msg = n.querySelector && n.querySelector(".toast-msg");
        if (msg) window.__pwToasts.push(msg.textContent);
      }
    }).observe(lane, { childList: true });
  });
  try {
    for (const k of ["auracle-played", "auracle-bench-tour", "auracle-bank-toured", "auracle-warmed"]) localStorage.setItem(k, "1");
  } catch (_) {}
})();`;

async function boot(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(INIT);
  await page.goto("/");
  const anyway = page.locator("#hg-anyway");
  if (await anyway.isVisible().catch(() => false)) await anyway.click();
  await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 150_000 });
  await expect.poll(() => page.locator("#bank-list .bank-item[data-id]").count(), { timeout: 120_000 }).toBe(40);
  return errors;
}
const at = (page, level) => expect(page.locator(`.rail-stop[data-level="${level}"]`)).toHaveAttribute("aria-current", "location");
const toasts = (page) => page.evaluate(() => window.__pwToasts.slice());

test("on a touch screen a pool row's and a preset's actions show at rest and answer a tap without opening the row", async ({ page }) => {
  test.setTimeout(240_000);
  const errors = await boot(page);
  expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches), "a coarse pointer").toBe(true);
  await at(page, "perform");
  // A preset's ▶, at rest, hears it without opening it. (First, while
  // nothing sounds: a ▶ pressed while another phrase plays stops that one.)
  await bankTab(page, "presets");
  const preset = page.locator("#bank-list .preset-item:not(.in-bank)").first();
  await expect(preset).toBeVisible({ timeout: 30_000 });
  const index = Number(await preset.getAttribute("data-index"));
  await expect(preset.locator(".bi-hear")).toBeVisible();
  await preset.locator(".bi-hear").tap();
  await expect.poll(() => page.evaluate((i) => window.__pwSent.some((m) => m.type === "load_preset" && m.index === i && m.preview && !m.open), index), { timeout: 15_000 }).toBe(true);
  await at(page, "perform");
  await bankTab(page, "pool");
  const id = await page.locator("#bank-list .bank-item[data-id]:not(.live)").nth(2).getAttribute("data-id");
  const row = page.locator(`#bank-list .bank-item[data-id="${id}"]`);
  await row.scrollIntoViewIfNeeded();
  // At rest, nothing pointed at: its actions are there.
  for (const a of [".bi-hear", ".bi-star", ".bi-save", ".bi-kill"]) await expect(row.locator(a), a).toBeVisible();
  // ▶ plays it (lit, or on its way), and the row is not opened.
  await row.locator(".bi-hear").tap();
  await expect(row.locator(".bi-hear")).toHaveClass(/\b(playing|pending)\b/, { timeout: 30_000 });
  await at(page, "perform");
  await expect(row).not.toHaveClass(/\blive\b|\bopening\b/);
  // ★ opens the stars in place, still without opening the row.
  await row.locator(".bi-star").tap();
  await expect(row).toHaveClass(/\brating\b/);
  await expect(row.locator('.star[data-s="3"]')).toBeVisible();
  await at(page, "perform");
  expect(errors).toEqual([]);
});

test("on a touch screen tapping ★ and then the fifth star rates five, and cuts nothing", async ({ page }) => {
  test.setTimeout(240_000);
  const errors = await boot(page);
  const id = await page.locator("#bank-list .bank-item[data-id]:not(.live):not(.saved)").nth(1).getAttribute("data-id");
  const row = page.locator(`#bank-list .bank-item[data-id="${id}"]`);
  await row.scrollIntoViewIfNeeded();
  await row.locator(".bi-star").tap();
  await expect(row).toHaveClass(/\brating\b/);
  // The finger lifts (its pointer "leaves") before the tap's click: the
  // stars are still out for it.
  await row.locator('.star[data-s="5"]').tap();
  await expect.poll(() => toasts(page), { timeout: 10_000 }).toEqual(expect.arrayContaining([expect.stringMatching(/^Rated .+ 5★\.$/)]));
  await expect(row.locator(".bi-star")).toHaveAttribute("aria-pressed", "true");
  await expect(row.locator(".star.lit")).toHaveCount(5);
  await page.waitForTimeout(500);
  expect((await toasts(page)).filter((t) => /^Cut /.test(t)), "a cut under the fifth star").toEqual([]);
  await expect(row).toHaveCount(1);
  expect(errors).toEqual([]);
});
