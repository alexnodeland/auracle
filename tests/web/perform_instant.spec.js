// PERFORM is playable at once on a patch it has measured before.
//
// Measuring a patch is ~one render per knob plus verification, 10-30 s on a
// CI runner. A booth flicks between the same demo patches all day, so every
// measurement is kept (stale-while-revalidate, persisted across reloads):
// a revisit is wired within 0.5 s of PERFORM showing it, and the same patch
// after a reload within 1.5 s (the interaction spec's budget; this allowed 5 s
// and 8 s). The presets ship measured (budgets.spec.js), so this blocks that
// file: it is the player's own cache being checked here.
//
// The same holds for Offer: one offer is grown in the background once a patch
// is steady, and pressing Offer hands it over instead of starting ~10 s of
// renders.
const { test, expect } = require("@playwright/test");
test("a patch measured once is playable at once, even after a reload", async ({ page }) => {
  test.setTimeout(300_000);
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.route("**/perform-wirings.json*", (r) => r.abort());
  await page.goto("/");
  await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 120_000 });
  await page.locator("#warm-skip").click();
  await page.locator('.bf[data-f="preset"]').click();
  const open = async (name) => {
    await page.locator(".bank-item", { hasText: name }).first().click();
    await page.waitForTimeout(800);
    // From the tab's click to wired controls, in the page's own clock.
    const ms = await page.evaluate(async (name) => {
      const live = () =>
        document.querySelector(".pf-name")?.textContent === name &&
        /controls reach/.test(document.querySelector(".pf-status")?.textContent || "") &&
        ![0, 1, 2, 3, 4, 5].some((i) => document.querySelector(`.pf-knob[data-i="${i}"]`)?.classList.contains("unwired"));
      const t0 = performance.now();
      document.querySelector('.viewtab[data-view="perform"]').click();
      for (;;) {
        if (live()) return Math.round(performance.now() - t0);
        if (performance.now() - t0 > 120_000) return Infinity;
        await new Promise((r) => setTimeout(r, 2));
      }
    }, name);
    await page.locator('.viewtab[data-view="play"]').click();
    return ms;
  };
  await open("Glass Pad");
  await open("Acid Line");
  const revisit = await open("Glass Pad");
  console.log(`revisit wired in ${revisit} ms`);
  expect(revisit, "revisit").toBeLessThan(500);
  // reload: persisted
  await page.reload();
  await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 120_000 });
  await page.locator('.bf[data-f="preset"]').click();
  const reloaded = await open("Acid Line");
  console.log(`after a reload, wired in ${reloaded} ms`);
  expect(reloaded, "after a reload").toBeLessThan(1500);
  expect(errs).toEqual([]);
});

test("an offer grown ahead lands the moment Offer is pressed", async ({ page }) => {
  test.setTimeout(240_000);
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  // Counts the offers the engine hands back, to know when the spare is here
  // (a state, not a guess at how long a loaded machine takes to grow one).
  await page.addInitScript(`(() => {
    const Orig = window.Worker;
    window.__offered = 0;
    function Wrapped(url, opts) {
      const w = new Orig(url, opts);
      if (/worker\\.js/.test(String(url))) w.addEventListener("message", (e) => {
        if (e.data && e.data.type === "perform_offered" && e.data.offer && e.data.offer.tree) window.__offered += 1;
      });
      return w;
    }
    Wrapped.prototype = Orig.prototype;
    window.Worker = Wrapped;
  })();`);
  await page.goto("/");
  await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 120_000 });
  await page.locator("#warm-skip").click();
  await page.locator('.bf[data-f="preset"]').click();
  await page.locator(".bank-item", { hasText: "Glass Pad" }).first().click();
  await page.waitForTimeout(800);
  await page.locator('.viewtab[data-view="perform"]').click();
  await expect(page.locator(".pf-name")).toHaveText("Glass Pad", { timeout: 30000 });
  await page.waitForFunction(() => /controls reach/.test(document.querySelector(".pf-status")?.textContent || ""), null, { timeout: 90000 });
  // Steady, hands off: the spare grows.
  await page.waitForFunction(() => window.__offered >= 1, null, { timeout: 150_000 });
  const ms = await page.evaluate(async () => {
    const pad = document.querySelector(".pf-pad.primary");
    const t0 = performance.now();
    pad.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 1 }));
    pad.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, pointerId: 1 }));
    while (!document.querySelector(".pf-offer.ready") && performance.now() - t0 < 90_000) await new Promise((r) => setTimeout(r, 2));
    return performance.now() - t0;
  });
  console.log(`Offer with a spare waiting: ${ms.toFixed(0)} ms`);
  expect(ms, "a spare offer is handed over, not grown").toBeLessThan(300);
  expect(errs).toEqual([]);
});
