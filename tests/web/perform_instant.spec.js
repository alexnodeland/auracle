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
test("a patch measured once is playable at once, even after a reload", { tag: "@slow" }, async ({ page }) => {
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

// A preset opened before is remembered by the page (its tree and makeup), so
// after a reload it reaches the voices and PERFORM from the click, without
// waiting for the engine. The engine's one thread is always busy just after a
// boot (the first patch's render, the table's pair), and one render there is
// seconds on a slow machine: the reload above was wired 9.3 s after the tab
// click on a CI runner. Here every message to the engine is held back after
// the reload, so nothing the engine does can be what wires the controls.
test("a preset opened before plays at once after a reload, however busy the engine is", { tag: "@slow" }, async ({ page }) => {
  test.setTimeout(300_000);
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  // Holds every message to the engine while `window.__hold` is set.
  await page.addInitScript(`(() => {
    const Orig = window.Worker;
    window.__hold = false;
    window.__held = [];
    function Wrapped(url, opts) {
      const w = new Orig(url, opts);
      if (/worker\\.js/.test(String(url))) {
        const post = w.postMessage.bind(w);
        w.postMessage = (m, t) => (window.__hold ? window.__held.push([m, t]) : post(m, t));
        window.__release = () => {
          window.__hold = false;
          for (const [m, t] of window.__held.splice(0)) post(m, t);
        };
      }
      return w;
    }
    Wrapped.prototype = Orig.prototype;
    window.Worker = Wrapped;
  })();`);
  await page.route("**/perform-wirings.json*", (r) => r.abort());
  await page.goto("/");
  await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 120_000 });
  await page.locator("#warm-skip").click();
  await page.locator('.bf[data-f="preset"]').click();
  await page.locator(".bank-item", { hasText: "Acid Line" }).first().click();
  await expect(page.locator("#live-label")).toHaveText("Acid Line", { timeout: 60_000 });
  await page.locator('.viewtab[data-view="perform"]').click();
  await page.waitForFunction(() => /controls reach/.test(document.querySelector(".pf-status")?.textContent || ""), null, { timeout: 120_000 });
  await page.locator('.viewtab[data-view="play"]').click();
  await page.waitForTimeout(2000); // both caches are written 1.5 s after they change
  await page.reload();
  await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 120_000 });
  await page.locator('.bf[data-f="preset"]').click();
  const ms = await page.evaluate(async () => {
    window.__hold = true;
    const row = [...document.querySelectorAll(".bank-item")].find((e) => e.querySelector(".bi-name")?.textContent === "Acid Line");
    const t0 = performance.now();
    row.click();
    document.querySelector('.viewtab[data-view="perform"]').click();
    const live = () =>
      document.getElementById("live-label")?.textContent === "Acid Line" &&
      document.querySelector(".pf-name")?.textContent === "Acid Line" &&
      /controls reach/.test(document.querySelector(".pf-status")?.textContent || "") &&
      ![0, 1, 2, 3, 4, 5].some((i) => document.querySelector(`.pf-knob[data-i="${i}"]`)?.classList.contains("unwired"));
    while (!live() && performance.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 2));
    return performance.now() - t0;
  });
  console.log(`click → PERFORM wired, with the engine held: ${ms.toFixed(0)} ms`);
  expect(ms, "wired without the engine").toBeLessThan(1500);
  expect(await page.evaluate(() => window.__held.length), "the open was asked of the engine").toBeGreaterThan(0);
  // Let the engine answer: the bench becomes the patch the voices play, and
  // PERFORM stays on it.
  await page.evaluate(() => window.__release());
  await page.locator('.viewtab[data-view="play"]').click();
  await expect(page.locator("#rack-subject")).toHaveText(/^Acid Line/, { timeout: 60_000 });
  await expect(page.locator("#rack-meta")).not.toHaveText(/opening/, { timeout: 60_000 });
  await page.locator('.viewtab[data-view="perform"]').click();
  await expect(page.locator(".pf-name")).toHaveText("Acid Line");
  await expect(page.locator(".pf-status")).toHaveText(/controls reach/, { timeout: 30_000 });
  expect(errs).toEqual([]);
});

test("an offer grown ahead lands the moment Offer is pressed", { tag: "@slow" }, async ({ page }) => {
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
