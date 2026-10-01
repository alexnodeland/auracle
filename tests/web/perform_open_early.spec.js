// An open reaches the voices (and PERFORM) before the engine has rendered it
// for the rack: from the engine's first word about it, or, for a preset
// opened before in this browser, from the page's memory at the click. Until
// the rack lands the patch is PERFORM's but not the bench's, and these are
// the ways that can go wrong:
//
// - a Keep made then would land on the rack being replaced, so it is refused
//   and says why (Take and Back go the same way; an offer cannot be on a
//   patch that has not landed, so Keep is the one a player can reach here);
// - a second preset clicked before the first lands is the one opened: the
//   first stays in the bank, the voices never go back to it;
// - an open the engine cannot complete puts the voices back on the rack.
//
// Every message to the engine is held while the open is made, so the state
// between the click and the rack is there to look at, not a race.
const { test, expect } = require("@playwright/test");

const INIT = `(() => {
  const Orig = window.Worker;
  window.__hold = false;
  window.__held = [];
  window.__failBench = false;
  window.__toasts = [];
  const accessor = (o, k) => { for (; o; o = Object.getPrototypeOf(o)) { const d = Object.getOwnPropertyDescriptor(o, k); if (d) return d; } return null; };
  function Wrapped(url, opts) {
    const w = new Orig(url, opts);
    if (/worker\\.js/.test(String(url))) {
      const post0 = w.postMessage.bind(w);
      // With __failBench armed, the next bench open asks the engine for a
      // patch it does not hold, and its answer is handed back under the id
      // that was asked for: what a generation replacing the patch looks like,
      // with the engine's bench left where it was.
      let failing = null;
      const post = (m, t) => {
        if (window.__failBench && m && m.type === "edit_begin") {
          window.__failBench = false;
          failing = m.id;
          m = { ...m, id: 4294967295 };
        }
        return post0(m, t);
      };
      w.postMessage = (m, t) => (window.__hold ? window.__held.push([m, t]) : post(m, t));
      window.__release = () => {
        window.__hold = false;
        for (const [m, t] of window.__held.splice(0)) post(m, t);
      };
      const d = accessor(w, "onmessage");
      Object.defineProperty(w, "onmessage", {
        get: () => d.get.call(w),
        set: (fn) => d.set.call(w, (e) => {
          const m = e.data;
          if (failing != null && m && m.type === "bench_missing" && m.id === 4294967295) {
            const id = failing;
            failing = null;
            return fn({ data: { ...m, id } });
          }
          return fn(e);
        }),
      });
    }
    return w;
  }
  Wrapped.prototype = Orig.prototype;
  window.Worker = Wrapped;
  document.addEventListener("DOMContentLoaded", () => {
    const lane = document.getElementById("toasts");
    if (!lane) return;
    new MutationObserver(() => {
      for (const n of lane.querySelectorAll(".toast-msg")) {
        const t = n.textContent;
        if (window.__toasts[window.__toasts.length - 1] !== t) window.__toasts.push(t);
      }
    }).observe(lane, { childList: true, subtree: true, characterData: true });
  });
})();`;

// Boot, open two presets (so the page remembers them), reload, and wait for
// the patch the app opens by itself after the reload to be on the rack.
async function remembered(page) {
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.addInitScript(INIT);
  await page.goto("/");
  await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 120_000 });
  await page.locator("#warm-skip").click();
  await page.locator('.bf[data-f="preset"]').click();
  for (const name of ["Acid Line", "Glass Pad"]) {
    await page.locator(".bank-item", { hasText: name }).first().click();
    await expect(page.locator("#live-label")).toHaveText(name, { timeout: 60_000 });
    await expect(page.locator("#rack-subject")).toHaveText(new RegExp(`^${name}`), { timeout: 60_000 });
  }
  // No wait: the memory is written when the page is left (`flushVoiced`).
  await page.reload();
  await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 120_000 });
  await expect(page.locator("#rack-subject")).not.toHaveText(/no sound open/, { timeout: 60_000 });
  await expect(page.locator("#rack-meta")).not.toHaveText(/opening/, { timeout: 60_000 });
  await page.locator('.bf[data-f="preset"]').click();
  return errs;
}

const clickRow = (name) => {
  const row = [...document.querySelectorAll(".bank-item")].find((e) => e.querySelector(".bi-name")?.textContent === name);
  row.click();
};

test("a Keep while a patch is still opening is refused and says why, and the preset clicked last is the one opened", async ({ page }) => {
  test.setTimeout(300_000);
  const errs = await remembered(page);
  await page.evaluate(() => (window.__hold = true));
  await page.evaluate(clickRow, "Acid Line");
  await page.locator('.viewtab[data-view="perform"]').click();
  await expect(page.locator(".pf-name")).toHaveText("Acid Line");
  const keepPad = page.locator(".pf-pad", { hasText: /^Keep$/ });
  await keepPad.click();
  await expect.poll(() => page.evaluate(() => window.__toasts.join("\n"))).toContain("Keep waits for Acid Line to finish opening");
  expect(await page.evaluate(() => window.__toasts.join("\n"))).not.toContain("Kept");
  await expect(keepPad).not.toHaveClass(/\bflash\b/);
  // The rack is still the patch from before: nothing was sent to it.
  await expect(page.locator("#rack-subject")).not.toHaveText(/^Acid Line/);
  // Another preset before the first has landed: the voices take it now.
  await page.evaluate(clickRow, "Glass Pad");
  await expect(page.locator("#live-label")).toHaveText("Glass Pad");
  await expect(page.locator(".pf-name")).toHaveText("Glass Pad");
  await page.evaluate(() => window.__release());
  await expect(page.locator("#rack-subject")).toHaveText(/^Glass Pad/, { timeout: 60_000 });
  await expect(page.locator("#rack-meta")).not.toHaveText(/opening/, { timeout: 60_000 });
  await page.waitForTimeout(1500); // anything still on its way lands
  await expect(page.locator("#rack-subject")).toHaveText(/^Glass Pad/);
  await expect(page.locator("#live-label")).toHaveText("Glass Pad");
  await expect(page.locator(".pf-name")).toHaveText("Glass Pad");
  // Now it has landed, Keep is Keep: the pad lights when it is made. (Its
  // toast can queue behind the open's own news, so the pad is what is read.)
  await keepPad.click();
  await expect(keepPad).toHaveClass(/\bflash\b/, { timeout: 30_000 });
  expect(await page.evaluate(() => window.__toasts.join("\n"))).not.toMatch(/Keep waits for Glass Pad/);
  await expect(page.locator("#rack-subject")).toHaveText(/^Glass Pad/, { timeout: 30_000 });
  expect(errs).toEqual([]);
});

test("an open that cannot complete puts the voices back on the rack", async ({ page }) => {
  test.setTimeout(300_000);
  const errs = await remembered(page);
  expect(await page.locator("#rack-subject").textContent()).not.toMatch(/^Acid Line/);
  await page.evaluate(() => (window.__hold = true));
  await page.evaluate(clickRow, "Acid Line");
  await expect(page.locator("#live-label")).toHaveText("Acid Line");
  await page.evaluate(() => {
    window.__failBench = true;
    window.__release();
  });
  await expect.poll(() => page.evaluate(() => window.__toasts.join("\n")), { timeout: 60_000 }).toContain("was replaced by a generation");
  // Back on the rack's patch (by the name it has now: a pool patch's name
  // follows the model, and the pool may still be filling).
  const same = () => page.evaluate(() => {
    const rack = document.getElementById("rack-subject").textContent.trim();
    return document.getElementById("live-label").textContent === rack && !/^Acid Line/.test(rack) ? "same" : "differ";
  });
  await expect.poll(same, { timeout: 10_000 }).toBe("same");
  await page.locator('.viewtab[data-view="perform"]').click();
  await expect.poll(() => page.evaluate(() =>
    document.querySelector(".pf-name").textContent === document.getElementById("live-label").textContent ? "same" : "differ"), { timeout: 10_000 }).toBe("same");
  await expect(page.locator(".pf-name")).not.toHaveText("Acid Line");
  expect(errs).toEqual([]);
});
