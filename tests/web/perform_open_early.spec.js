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
// Every message to the engine is held while the open is made
// (`app.holdRequests`), so the state between the click and the rack is there
// to look at, not a race.
const { test, expect, PERFORM_SEED, bankTab } = require("./fixtures");

// An open the engine cannot complete. With `__failBench` armed, the next
// bench open asks the engine for a patch it does not hold (`__failing` keeps
// the id it was for), and its answer is handed back under the id that was
// asked for, before main reads it: what a generation replacing the patch
// looks like, with the engine's bench left where it was. A wrapper outside
// the fixture's tap, so the tap sees the open as the engine is asked it.
const MISSING = 4294967295;
const FAIL_BENCH = `(() => {
  const Orig = window.Worker;
  window.__failBench = false;
  window.__failing = null;
  function Wrapped(url, opts) {
    const w = new Orig(url, opts);
    if (/worker\\.js/.test(String(url))) {
      const post = w.postMessage.bind(w);
      w.postMessage = (m, t) => {
        if (window.__failBench && m && m.type === "edit_begin") {
          window.__failBench = false;
          window.__failing = m.id;
          m = { ...m, id: ${MISSING} };
        }
        return post(m, t);
      };
      // After the tap's listener and before main.js's own.
      w.addEventListener("message", (e) => {
        const d = e.data;
        if (window.__failing != null && d && d.type === "bench_missing" && d.id === ${MISSING}) {
          d.id = window.__failing;
          window.__failing = null;
        }
      });
    }
    return w;
  }
  Wrapped.prototype = Orig.prototype;
  window.Worker = Wrapped;
})();`;

// Boot, open two presets (so the page remembers them), reload, and wait for
// the patch the app opens by itself after the reload to be on the rack.
async function remembered(page, app) {
  await page.addInitScript(FAIL_BENCH);
  await app.boot({ seed: PERFORM_SEED, random: PERFORM_SEED });
  await bankTab(page, "presets");
  for (const name of ["Acid Line", "Glass Pad"]) {
    await page.locator(".bank-item", { hasText: name }).first().click();
    await app.engine((timeout) => expect(page.locator("#live-label")).toHaveText(name, { timeout }), { ms: 60_000 });
    await app.engine((timeout) => expect(page.locator("#rack-subject")).toHaveText(new RegExp(`^${name}`), { timeout }), { ms: 60_000 });
  }
  // No wait: the memory is written when the page is left (`flushVoiced`).
  await app.reload();
  await app.engine((timeout) => expect(page.locator("#rack-subject")).not.toHaveText(/no sound open/, { timeout }), { ms: 60_000 });
  await app.engine((timeout) => expect(page.locator("#rack-meta")).not.toHaveText(/opening/, { timeout }), { ms: 60_000 });
  await bankTab(page, "presets");
}

const clickRow = (name) => {
  const row = [...document.querySelectorAll(".bank-item")].find((e) => e.querySelector(".bi-name")?.textContent === name);
  row.click();
};

test("a Keep while a patch is still opening is refused and says why, and the preset clicked last is the one opened", async ({ page, app }) => {
  await remembered(page, app);
  await app.holdRequests();
  await page.evaluate(clickRow, "Acid Line");
  await app.level("perform");
  await expect(page.locator(".pf-name")).toHaveText("Acid Line");
  // Keep is in the moved bar, there once the sound has left home: a control
  // turned on the patch PERFORM already plays (its shipped wiring) moves it.
  const turned = page.locator('.pf-deck .pf-knob:not(.search):not(.pending):not(.half-hi)').first();
  await turned.focus();
  for (let i = 0; i < 8; i++) await page.keyboard.press("ArrowUp");
  const keepPad = page.locator(".pf-moved .pf-keep");
  await expect(page.locator(".pf-moved")).toHaveClass(/\bon\b/);
  const kept = await app.toastMark();
  await keepPad.click();
  await app.toast("Keep waits for Acid Line to finish opening", { since: kept });
  expect((await app.toasts(kept)).join("\n")).not.toContain("Kept");
  await expect(keepPad).not.toHaveClass(/\bflash\b/);
  // The rack is still the patch from before: nothing was sent to it.
  await expect(page.locator("#rack-subject")).not.toHaveText(/^Acid Line/);
  // Another preset before the first has landed: the voices take it now.
  await page.evaluate(clickRow, "Glass Pad");
  await expect(page.locator("#live-label")).toHaveText("Glass Pad");
  await expect(page.locator(".pf-name")).toHaveText("Glass Pad");
  await app.releaseRequests();
  await app.engine((timeout) => expect(page.locator("#rack-subject")).toHaveText(/^Glass Pad/, { timeout }), { ms: 60_000 });
  await app.engine((timeout) => expect(page.locator("#rack-meta")).not.toHaveText(/opening/, { timeout }), { ms: 60_000 });
  // Anything still on its way lands, and changes nothing.
  await app.quiet();
  await expect(page.locator("#rack-subject")).toHaveText(/^Glass Pad/);
  await expect(page.locator("#live-label")).toHaveText("Glass Pad");
  await expect(page.locator(".pf-name")).toHaveText("Glass Pad");
  // Now it has landed, Keep is Keep: the pad lights when it is made. (Its
  // toast can queue behind the open's own news, so the pad is what is read.)
  // A control turned on Glass Pad moves it, and the bar offers Keep again.
  await app.reached();
  const turnedHere = page.locator('.pf-deck .pf-knob:not(.search):not(.pending):not(.half-hi)').first();
  await turnedHere.focus();
  for (let i = 0; i < 8; i++) await page.keyboard.press("ArrowUp");
  await expect(page.locator(".pf-moved")).toHaveClass(/\bon\b/);
  await keepPad.click();
  await app.engine((timeout) => expect(keepPad).toHaveClass(/\bflash\b/, { timeout }), { ms: 30_000 });
  expect((await app.toasts()).join("\n")).not.toMatch(/Keep waits for Glass Pad/);
  await app.engine((timeout) => expect(page.locator("#rack-subject")).toHaveText(/^Glass Pad/, { timeout }), { ms: 30_000 });
});

test("an open that cannot complete puts the voices back on the rack", async ({ page, app }) => {
  await remembered(page, app);
  expect(await page.locator("#rack-subject").textContent()).not.toMatch(/^Acid Line/);
  const asked = await app.now();
  await app.holdRequests();
  await page.evaluate(clickRow, "Acid Line");
  await expect(page.locator("#live-label")).toHaveText("Acid Line");
  // Armed and let go in one breath (the tap's own release, in the page): the
  // open Acid Line's arrival asks for is the one failed.
  await page.evaluate(() => {
    window.__failBench = true;
    window.__tap.releaseRequests();
  });
  await app.engine((timeout) => app.toast("was replaced by a generation", { timeout }), { ms: 60_000 });
  // The first open asked for since was the one failed: asked of a patch the
  // engine does not hold (and answered, as the toast says, under its own id).
  const [open] = await app.sent({ type: "edit_begin" }, { after: asked });
  expect(open && open.id, "the open the spec failed").toBe(MISSING);
  // Back on the rack's patch (by the name it has now: a pool patch's name
  // follows the model, and the pool may still be filling).
  const same = () => page.evaluate(() => {
    const rack = document.getElementById("rack-subject").textContent.trim();
    return document.getElementById("live-label").textContent === rack && !/^Acid Line/.test(rack) ? "same" : "differ";
  });
  await expect.poll(same, { timeout: 10_000 }).toBe("same");
  await app.level("perform");
  await expect.poll(() => page.evaluate(() =>
    document.querySelector(".pf-name").textContent === document.getElementById("live-label").textContent ? "same" : "differ"), { timeout: 10_000 }).toBe("same");
  await expect(page.locator(".pf-name")).not.toHaveText("Acid Line");
});
