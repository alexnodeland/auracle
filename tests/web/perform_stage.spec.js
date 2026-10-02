// Stage mode (Plan-005 task 5): ⇧F puts the sound under your hands on the
// whole screen, drawn from what you hear, for a gig or a stream.
//
// What this claims:
// - ⇧F enters it from PERFORM, and ⇧F or Esc leaves it, putting focus back.
// - Space still plays the sound in it (ADR-016), and what it draws is the
//   output: the canvas is empty while nothing sounds, and lit while the
//   phrase plays.
// - F alone still plays its note: only Shift and F is stage mode.
//
// It reads the output level through an analyser on everything the app
// connects to the destination, as space_after_a_click.spec.js does.
const { test, expect } = require("@playwright/test");

const INIT = `(() => {
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (dest, ...rest) {
    const r = connect.call(this, dest, ...rest);
    if (typeof AudioDestinationNode !== "undefined" && dest instanceof AudioDestinationNode) {
      let a = this.context.__pwTap;
      if (!a) {
        a = this.context.createAnalyser();
        a.fftSize = 2048;
        this.context.__pwTap = a;
        window.__pwTap = a;
      }
      connect.call(this, a);
    }
    return r;
  };
  window.__pwPeakDb = () => {
    const a = window.__pwTap;
    if (!a) return -Infinity;
    const b = new Float32Array(a.fftSize);
    a.getFloatTimeDomainData(b);
    let peak = 0;
    for (const x of b) peak = Math.max(peak, Math.abs(x));
    return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
  };
  // How much of the stage's canvas is lit (any pixel with alpha).
  window.__stageLit = () => {
    const c = document.querySelector(".st-canvas");
    if (!c || !c.width) return 0;
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 16) if (d[i] > 40) n++;
    return n;
  };
  try {
    for (const k of ["auracle-warmed", "auracle-played", "auracle-bench-tour", "auracle-bank-toured"])
      localStorage.setItem(k, "1");
  } catch (_) {}
})();`;

test("stage mode enters with ⇧F, leaves with ⇧F or Esc, and Space still plays in it", async ({ page }) => {
  test.setTimeout(240_000);
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.addInitScript(INIT);
  await page.goto("/");
  await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 120_000 });
  await page.locator('.bf[data-f="preset"]').click();
  await page.locator(".bank-item", { hasText: "Glass Pad" }).first().click();
  await expect(page.locator("#rack-subject")).toContainText("Glass Pad", { timeout: 90_000 });
  await page.locator('.viewtab[data-view="perform"]').click();
  await expect(page.locator(".pf-name")).toHaveText("Glass Pad", { timeout: 30_000 });
  await expect(page.locator(".pf-status")).toContainText("controls reach", { timeout: 120_000 });

  const stage = page.locator(".st-stage");
  await page.keyboard.press("Shift+F");
  await expect(stage).toBeVisible();
  await expect(page.locator("html")).toHaveClass(/\bst-on\b/);
  await expect(stage.locator(".st-name")).toHaveText("Glass Pad");
  expect(await page.evaluate(() => document.activeElement === document.querySelector(".st-stage"))).toBe(true);

  // Quiet: nothing drawn.
  await expect.poll(() => page.evaluate(() => window.__pwPeakDb()), { timeout: 30_000 }).toBeLessThan(-60);
  await expect.poll(() => page.evaluate(() => window.__stageLit()), { timeout: 10_000 }).toBe(0);
  // Space plays the sound, and the stage draws it.
  await page.keyboard.press(" ");
  await expect.poll(() => page.evaluate(() => window.__pwPeakDb()), { timeout: 30_000 }).toBeGreaterThan(-40);
  await expect.poll(() => page.evaluate(() => window.__stageLit()), { timeout: 10_000 }).toBeGreaterThan(50);
  await expect(stage).toBeVisible();
  await page.keyboard.press(" ");
  await expect.poll(() => page.evaluate(() => window.__pwPeakDb()), { timeout: 30_000 }).toBeLessThan(-60);

  // ⇧F leaves, and focus goes back where it was.
  await page.keyboard.press("Shift+F");
  await expect(stage).toHaveCount(0);
  await expect(page.locator("html")).not.toHaveClass(/\bst-on\b/);
  // Esc leaves too.
  await page.keyboard.press("Shift+F");
  await expect(stage).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(stage).toHaveCount(0);

  // F alone is a note, as it always was.
  await page.keyboard.down("f");
  await expect.poll(() => page.evaluate(() => window.__pwPeakDb()), { timeout: 30_000 }).toBeGreaterThan(-40);
  await page.keyboard.up("f");
  await expect(stage).toHaveCount(0);
  expect(errs).toEqual([]);
});
