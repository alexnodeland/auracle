// PERFORM's pad keys (ADR-018): N offers (Next while B holds one), B held
// peeks, ⇧↵ takes, ↵ keeps with no control focused, ⇧⌫ goes back. N is
// ANOTHER PAIR in EVOLVE.
//
// - N asks for an offer, and with one in B it passes on it and asks again.
//   B held is PEEK held (the pad pressed while the key is down). ⇧↵ takes B.
// - ↵ keeps only when no control has focus: with a dial focused it is the
//   dial's own (its long-press sweep), and nothing is kept. ⇧⌫ goes back. With
//   the sound at home, each says there is nothing to do.
// - The keys yield to a text field and to a modal dialog, and the note keys
//   still play in PERFORM.
const { test, expect } = require("@playwright/test");
const { goLevel, bankTab } = require("./shell");
const budget = require("./perform_budget.js");

const INIT = `(() => {
  const offers = (window.__offers = []);
  const Orig = window.Worker;
  function Wrapped(url, o) {
    const w = new Orig(url, o);
    if (/worker\\.js/.test(String(url))) {
      const post = w.postMessage.bind(w);
      w.postMessage = (m, t) => {
        if (m && m.type === "perform_offer" && !m.bg) offers.push(performance.now());
        return post(m, t);
      };
    }
    return w;
  }
  Wrapped.prototype = Orig.prototype;
  window.Worker = Wrapped;
})();`;

async function boot(page) {
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await budget.watch(page);
  await page.addInitScript(INIT);
  await page.goto("/");
  await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 120_000 });
  await page.locator("#warm-skip").click();
  return errs;
}

async function openOnPerform(page, name) {
  await bankTab(page, "presets");
  await page.locator(".bank-item", { hasText: name }).first().click();
  await page.waitForFunction((n) => (document.getElementById("rack-subject")?.textContent || "").includes(n), name, { timeout: 90_000 });
  await goLevel(page, "perform");
  await expect(page.locator(".pf-name")).toHaveText(name, { timeout: 30_000 });
  await expect(page.locator(".pf-status")).toContainText("controls reach", { timeout: 120_000 });
}

const blur = (page) => page.evaluate(() => document.activeElement?.blur());
const offersAsked = (page) => page.evaluate(() => window.__offers.length);

test("N offers and, with B full, passes and offers again; B held peeks; ⇧↵ takes", { tag: "@slow" }, async ({ page }) => {
  test.setTimeout(420_000);
  const errs = await boot(page);
  await openOnPerform(page, "Glass Pad");
  const OFFER_MS = await budget.offerBudget(page, { waits: 2 });
  await blur(page);
  const n0 = await offersAsked(page);
  await page.keyboard.press("n");
  await expect.poll(() => offersAsked(page)).toBe(n0 + 1);
  await expect(page.locator(".pf-offer")).toHaveClass(/\bready\b/, { timeout: OFFER_MS });
  await expect(page.locator(".pf-pad.primary")).toHaveText("Next");
  // B held is PEEK held; let go, it is up again.
  const peekPad = page.locator(".pf-pad", { hasText: "Peek" });
  await page.keyboard.down("b");
  await expect(peekPad).toHaveClass(/\bdown\b/);
  await page.keyboard.up("b");
  await expect(peekPad).not.toHaveClass(/\bdown\b/);
  // N again: Next, a pass on B (unheard, so not counted) and another offer.
  await page.keyboard.press("n");
  await expect(page.locator("#toasts")).toContainText("Skipped B.");
  await expect.poll(() => offersAsked(page)).toBe(n0 + 2);
  await expect(page.locator(".pf-offer")).toHaveClass(/\bready\b/, { timeout: OFFER_MS });
  // ⇧↵ takes it: the sound in hand is the offer.
  await page.keyboard.press("Shift+Enter");
  await expect(page.locator(".pf-name")).toHaveText("Glass Pad (taken offer)", { timeout: 60_000 });
  await expect(page.locator(".pf-offer")).not.toHaveClass(/\bready\b/);
  expect(errs).toEqual([]);
});

test("↵ keeps only with no control focused, ⇧⌫ goes back, and at home each says there is nothing to do", async ({ page }) => {
  test.setTimeout(240_000);
  const errs = await boot(page);
  await openOnPerform(page, "Glass Pad");
  const bar = page.locator(".pf-moved");
  // At home: nothing to keep, nothing to go back to.
  await blur(page);
  await page.keyboard.press("Enter");
  await expect(page.locator("#toasts")).toContainText("Nothing to keep: this sound is home.");
  await page.keyboard.press("Shift+Backspace");
  await expect(page.locator("#toasts")).toContainText("Nothing to go back to: this sound is home.");
  // Turned: the sound has moved, and the dial keeps the focus.
  const k = page.locator(".pf-deck .pf-knob:not(.search):not(.pending):not(.half-hi)").first();
  await k.focus();
  for (let i = 0; i < 8; i++) await page.keyboard.press("ArrowUp");
  await expect(bar).toHaveClass(/\bon\b/);
  // ↵ with the dial focused is the dial's (its sweep through both ends and
  // back to where it was): nothing is kept. Waited out, so the sweep's
  // return does not land after the Keep below.
  const at = await k.getAttribute("aria-valuenow");
  await page.keyboard.press("Enter");
  await expect(k).not.toHaveAttribute("aria-valuenow", at, { timeout: 5_000 });
  await expect(k).toHaveAttribute("aria-valuenow", at, { timeout: 10_000 });
  await expect(bar).toHaveClass(/\bon\b/);
  await expect(page.locator("#toasts")).not.toContainText("Kept: this is home now.");
  // With nothing focused, ↵ keeps.
  await blur(page);
  await page.keyboard.press("Enter");
  await expect(page.locator("#toasts")).toContainText("Kept: this is home now.", { timeout: 15_000 });
  await expect(bar).not.toHaveClass(/\bon\b/);
  // Moved again, ⇧⌫ glides back home.
  await k.focus();
  for (let i = 0; i < 8; i++) await page.keyboard.press("ArrowUp");
  await expect(bar).toHaveClass(/\bon\b/);
  await blur(page);
  await page.keyboard.press("Shift+Backspace");
  await expect(bar).not.toHaveClass(/\bon\b/, { timeout: 10_000 });
  expect(errs).toEqual([]);
});

test("the pad keys yield to a text field and a modal, the note keys still play, and N in EVOLVE is another pair", async ({ page }) => {
  test.setTimeout(240_000);
  const errs = await boot(page);
  await openOnPerform(page, "Glass Pad");
  const n0 = await offersAsked(page);
  // Typed into Find a sound: letters, not an offer or a peek.
  const find = page.locator("#bank-find");
  await find.click();
  await page.keyboard.type("nb");
  await expect(find).toHaveValue("nb");
  await find.fill("");
  await expect(page.locator(".pf-pad", { hasText: "Peek" })).not.toHaveClass(/\bdown\b/);
  // Under the ? card (a modal): nothing either.
  await blur(page);
  await page.keyboard.press("?");
  await expect(page.locator("#help")).toBeVisible();
  await page.keyboard.press("n");
  await page.keyboard.press("Escape");
  await expect(page.locator("#help")).toBeHidden();
  await page.waitForTimeout(800);
  expect(await offersAsked(page), "no offer asked for from a text field or under a modal").toBe(n0);
  // The note keys still play in PERFORM, beside the pad keys.
  await page.keyboard.down("a");
  await expect(page.locator('.pkey[data-note="60"]')).toHaveClass(/\bdown\b/);
  await page.keyboard.up("a");
  // In EVOLVE, N deals another pair.
  await goLevel(page, "evolve");
  const name = page.locator("#name-a");
  await expect(name).not.toHaveText("sound a", { timeout: 60_000 });
  const before = await name.textContent();
  await expect(async () => {
    await page.keyboard.press("n");
    await expect(name).not.toHaveText(before, { timeout: 5_000 });
  }).toPass({ timeout: 60_000 });
  expect(errs).toEqual([]);
});
