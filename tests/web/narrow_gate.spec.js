// A window too narrow for the instrument says so, whatever the pointer.
//
// The narrow gate asked for a fine pointer and the handheld gate for a short
// side under 620 px, so a tablet in portrait (coarse, 768 × 1024) got neither:
// the app loaded with PERFORM's pads half under the keybar. The narrow gate
// now takes any pointer under 1000 px wide, except behind the handheld gate
// and after "look around anyway".
//
// CSS only, so these load the page and read what is on screen; they do not
// wait for the engine. A page error fails them (the fixture's `pageErrors`).
const { test, expect } = require("./fixtures");

const TABLET = { viewport: { width: 900, height: 1180 }, hasTouch: true, isMobile: true };

test.describe("a coarse pointer at 900 px", () => {
  test.use(TABLET);

  test("gets the narrow gate, which says to turn the tablet or widen the window", async ({ page }) => {
    await page.goto("/");
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches), "the emulated pointer is coarse").toBe(true);
    // Not a phone: the handheld gate lets it through.
    await expect(page.locator("html")).not.toHaveClass(/\bhandheld\b/);
    const gate = page.locator("#narrow-gate");
    await expect(gate).toBeVisible();
    await expect(gate).toContainText("Turn your tablet sideways, or widen the window");
  });
});

test.describe("a coarse pointer at 1100 px", () => {
  test.use({ ...TABLET, viewport: { width: 1100, height: 800 } });

  test("is wide enough, and gets no gate", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#narrow-gate")).toBeHidden();
  });
});

test.describe("a fine pointer at 900 px", () => {
  test.use({ viewport: { width: 900, height: 800 } });

  test("still gets the narrow gate", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#narrow-gate")).toBeVisible();
  });
});

test.describe("a phone that chose to look around anyway", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("sees the app, not the narrow gate", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#handheld")).toBeVisible();
    await expect(page.locator("#narrow-gate")).toBeHidden();
    await page.locator("#hg-anyway").click();
    await page.waitForLoadState("load");
    await expect(page.locator("html")).toHaveClass(/\banyway\b/);
    await expect(page.locator("#narrow-gate")).toBeHidden();
  });
});
