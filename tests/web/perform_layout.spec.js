// PERFORM is laid out as the specimen's well and panel (Plan-008 PR C1), and
// every function it had keeps a place in it.
//
// - At 1000, 1280 and 1440 px the sound is on the left (the cap, the name,
//   the well with its face) and what you turn is on the right (CONTROLS, the
//   knobs, the hood, the pad row WANDER · OFFER · PEEK · TAKE · PASS), with
//   the pads above the keybed and no pad's words past its edge.
// - XY is a mode of the well: its button swaps the face (dimmed behind) for
//   the field, and the button or Esc puts the face back.
// - Blend is a slider under the two faces, shown only while B holds an
//   offer.
// - Freeze is a tap on Wander (or Enter on it), and says so on Wander.
// - The moved bar shows exactly when the sound has left home; BACK glides it
//   home and KEEP makes it home, and either way the bar goes.
// - PASS passes on B without growing another: heard, it is recorded as
//   Next's pass is (`perform_record`, took false) after its window, and its
//   UNDO brings B back.
const { test, expect } = require("@playwright/test");
const { goLevel, bankTab } = require("./shell");
const budget = require("./perform_budget.js");

const INIT = `(() => {
  const records = (window.__records = []);
  const offers = (window.__offers = []);
  const Orig = window.Worker;
  function Wrapped(url, o) {
    const w = new Orig(url, o);
    if (/worker\\.js/.test(String(url))) {
      const post = w.postMessage.bind(w);
      w.postMessage = (m, t) => {
        if (m && m.type === "perform_record") records.push({ took: !!m.took, at: performance.now() });
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

/** A control that turns up on this patch, focused. */
async function turnUp(page, presses = 8) {
  const k = page.locator(".pf-deck .pf-knob:not(.search):not(.pending):not(.half-hi)").first();
  await k.focus();
  for (let i = 0; i < presses; i++) await page.keyboard.press("ArrowUp");
  return k;
}

async function grow(page, ms) {
  await page.locator(".pf-pad", { hasText: /^(Offer|Next)$/ }).click();
  await expect(page.locator(".pf-offer")).toHaveClass(/\bready\b/, { timeout: ms });
}

async function peek(page, ms) {
  const b = await page.locator(".pf-pad", { hasText: "Peek" }).boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
  await page.mouse.move(10, 10);
}

for (const [width, height] of [[1000, 760], [1280, 800], [1440, 900]]) {
  test.describe(`a ${width} px window`, () => {
    test.use({ viewport: { width, height } });
    test(`PERFORM is a well and a panel at ${width} px, its pads above the keybed and whole`, async ({ page }) => {
      test.setTimeout(240_000);
      const errs = await boot(page);
      await openOnPerform(page, "Glass Pad");
      await expect(page.locator(".pf-faces > .pf-face img.face")).toHaveCount(1, { timeout: 60_000 });
      const box = await page.evaluate(() => {
        const r = (sel) => {
          const b = document.querySelector(sel).getBoundingClientRect();
          return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, height: b.height };
        };
        const pads = [...document.querySelectorAll(".pf-pads > *")].map((e) => e.getAttribute("aria-label") || e.textContent.trim());
        const cut = [...document.querySelectorAll(".pf-pads .pf-pad, .pf-pads .pf-k-name, .pf-ctlhead button, .pf-cap")]
          .filter((e) => e.scrollWidth > e.clientWidth + 1)
          .map((e) => e.textContent.trim());
        return { left: r(".pf-left"), right: r(".pf-right"), well: r(".pf-well"), deck: r(".pf-deck"), pads: r(".pf-pads"), keybar: r(".keybar"), order: pads, cut };
      });
      // Two columns: the sound on the left, what you turn on the right.
      expect(box.right.left, "the panel is right of the sound").toBeGreaterThanOrEqual(box.left.right - 1);
      expect(box.well.width).toBeGreaterThan(200);
      expect(box.well.height).toBeGreaterThan(200);
      expect(box.deck.left).toBeGreaterThanOrEqual(box.right.left - 1);
      // The pad row, in its order, above the keybed, and nothing in it cut.
      expect(box.order).toEqual(["Wander", "Offer", "Peek", "Take", "Pass"]);
      expect(box.pads.bottom, "the pads are above the keybed").toBeLessThanOrEqual(box.keybar.top + 1);
      expect(box.cut, "words past their edge").toEqual([]);
      expect(errs).toEqual([]);
    });
  });
}

test("XY is a mode of the well: the button swaps the face for the field, and the button or Esc puts it back", async ({ page }) => {
  test.setTimeout(240_000);
  const errs = await boot(page);
  await openOnPerform(page, "Glass Pad");
  const well = page.locator(".pf-well");
  const btn = page.locator(".pf-xy-btn");
  await expect(page.locator(".pf-xy")).toBeHidden();
  await btn.click();
  await expect(btn).toHaveAttribute("aria-pressed", "true");
  await expect(well).toHaveAttribute("data-mode", "xy");
  await expect(page.locator(".pf-xy-field")).toBeVisible();
  await expect(page.locator(".pf-xy select")).toHaveCount(2);
  // The face stays, dimmed behind the field.
  expect(Number(await page.locator(".pf-faces").evaluate((e) => getComputedStyle(e).opacity))).toBeLessThan(0.5);
  // The field moves the knobs it is on.
  const f = await page.locator(".pf-xy-field").boundingBox();
  await page.mouse.click(f.x + f.width * 0.8, f.y + f.height * 0.2);
  // Esc puts the face back, and focus on the button that opens it.
  await page.locator(".pf-xy-field").focus();
  await page.keyboard.press("Escape");
  await expect(well).toHaveAttribute("data-mode", "face");
  await expect(btn).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".pf-xy")).toBeHidden();
  expect(await page.evaluate(() => document.activeElement?.classList.contains("pf-xy-btn"))).toBe(true);
  // …and so does the button, pressed again.
  await btn.click();
  await expect(well).toHaveAttribute("data-mode", "xy");
  await btn.click();
  await expect(well).toHaveAttribute("data-mode", "face");
  // How it works is the well's other mode, one at a time.
  await page.locator(".pf-why-btn").click();
  await expect(well).toHaveAttribute("data-mode", "how");
  await expect(page.locator(".pf-why-body")).toBeVisible();
  await btn.click();
  await expect(well).toHaveAttribute("data-mode", "xy");
  await expect(page.locator(".pf-why-body")).toBeHidden();
  expect(errs).toEqual([]);
});

test("Freeze is a tap on Wander, or Enter on it, and Wander says so", async ({ page }) => {
  test.setTimeout(240_000);
  const errs = await boot(page);
  await openOnPerform(page, "Glass Pad");
  const wander = page.locator(".pf-pads .pf-wander");
  await expect(wander).toHaveAttribute("data-frozen", "false");
  await expect(page.locator(".pf-pad", { hasText: /^Freeze$/ })).toHaveCount(0);
  await wander.click();
  await expect(wander).toHaveAttribute("data-frozen", "true");
  await expect(wander).toHaveClass(/\bheld\b/);
  await expect(wander.locator(".pf-k-sub")).toHaveText("frozen");
  await expect(wander).toHaveAttribute("aria-valuetext", "frozen");
  // Enter on the focused dial: unfrozen, and the dial did not turn.
  const v = await wander.getAttribute("aria-valuenow");
  await wander.focus();
  await page.keyboard.press("Enter");
  await expect(wander).toHaveAttribute("data-frozen", "false");
  await expect(wander).toHaveAttribute("aria-valuenow", v);
  expect(errs).toEqual([]);
});

test("the moved bar shows only when the sound has left home, and KEEP and BACK settle it", async ({ page }) => {
  test.setTimeout(240_000);
  const errs = await boot(page);
  await openOnPerform(page, "Glass Pad");
  const bar = page.locator(".pf-moved");
  await expect(bar).not.toHaveClass(/\bon\b/);
  await expect(bar).toBeHidden();
  // Its slot is kept: nothing in the head moves when it comes.
  const nameAt = await page.locator(".pf-name").boundingBox();
  const k = await turnUp(page);
  await expect(bar).toHaveClass(/\bon\b/);
  await expect(bar).toBeVisible();
  await expect(bar).toContainText("moved");
  expect(await page.locator(".pf-name").boundingBox()).toEqual(nameAt);
  // BACK glides home: the bar goes once the glide has landed.
  await page.locator(".pf-moved .pf-back").click();
  await expect(bar).not.toHaveClass(/\bon\b/, { timeout: 10_000 });
  // Moved again, KEEP makes it home.
  await turnUp(page);
  await expect(bar).toHaveClass(/\bon\b/);
  await page.locator(".pf-moved .pf-keep").click();
  await expect(page.locator("#toasts")).toContainText("Kept: this is home now.", { timeout: 15_000 });
  await expect(bar).not.toHaveClass(/\bon\b/);
  await expect(k).toHaveAttribute("aria-valuenow", "0.00");
  expect(errs).toEqual([]);
});

test("Blend shows only while B holds an offer, and PASS passes on B without growing another", { tag: "@slow" }, async ({ page }) => {
  test.setTimeout(420_000);
  const errs = await boot(page);
  await openOnPerform(page, "Glass Pad");
  const OFFER_MS = await budget.offerBudget(page, { waits: 2 });
  const slot = page.locator(".pf-blend-slot");
  const pass = page.locator(".pf-pad.pf-pass");
  await expect(slot).toBeHidden();
  await expect(pass).toBeDisabled();
  // An offer: Blend under the two faces, and PASS ready.
  await grow(page, OFFER_MS);
  await expect(slot).toBeVisible();
  await expect(page.locator(".pf-well")).toHaveClass(/\boffered\b/);
  await expect(pass).toBeEnabled();
  // Heard (a note sounding, a second and a half of Peek), then passed.
  await page.keyboard.down("a");
  await peek(page, 1600);
  await page.keyboard.up("a");
  const asked = await page.evaluate(() => window.__offers.length);
  await pass.click();
  await expect(page.locator(".pf-offer")).not.toHaveClass(/\bready\b/);
  await expect(slot).toBeHidden();
  await expect(page.locator("#toasts")).toContainText("Passed on B. That counts as a pick for what you had.");
  // No offer was asked for: a pass, not a Next (an offer is asked in the
  // press itself, so none by now is none).
  expect(await page.evaluate(() => window.__offers.length), "PASS grows nothing").toBe(asked);
  await expect(page.locator(".pf-pad.primary")).toHaveText("Offer");
  // UNDO brings B back, heard as it was, and nothing is recorded.
  await page.locator("#toasts .toast-undo", { hasText: "undo" }).last().click();
  await expect(page.locator(".pf-offer")).toHaveClass(/\bready\b/);
  await expect(slot).toBeVisible();
  // Passed again, and left: after its window it is recorded as Next's pass
  // is, a pick for what you had.
  await pass.click();
  await expect.poll(() => page.evaluate(() => window.__records.slice()), { timeout: 30_000 }).toEqual([expect.objectContaining({ took: false })]);
  expect(errs).toEqual([]);
});
