// The app prints each platform's own keys: ⌘ and ⇧ on an Apple platform,
// Ctrl and Shift elsewhere.
//
// The ? card, the booth menu's New visitor and the minimap's tooltip are
// written with the Mac's symbols, and printed ⌘Z on every platform, though
// the app takes Ctrl wherever it takes ⌘. www/brand/voice.md: "The app shows
// the platform's own." Off Apple platforms they read Ctrl Z, Ctrl Shift Z,
// Shift Esc, spelled as the guide spells them ("⌘K (Ctrl K)"); one helper
// (words.js `platformKeys`, unit-tested) writes every one.
//
// The platform is set by replacing `navigator.platform` and
// `navigator.userAgentData` before the app runs, so the spec reads the same
// on a Mac and on CI's Linux. What it does not claim: what the keys do
// (evolve_truth.spec.js holds ⌘Z, and Ctrl Z is the same handler).
const { test, expect } = require("@playwright/test");

const as = (platform, uaPlatform) => `(() => {
  Object.defineProperty(Navigator.prototype, "platform", { configurable: true, get: () => ${JSON.stringify(platform)} });
  Object.defineProperty(Navigator.prototype, "userAgentData", { configurable: true, get: () => ({ platform: ${JSON.stringify(uaPlatform)}, mobile: false, brands: [] }) });
  try {
    for (const k of ["auracle-warmed", "auracle-played", "auracle-bench-tour", "auracle-bank-toured"])
      localStorage.setItem(k, "1");
  } catch (_) {}
})();`;

async function boot(page, platform, uaPlatform) {
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await page.addInitScript(as(platform, uaPlatform));
  await page.goto("/");
  await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 60_000 });
  return errors;
}

const helpKeys = (page) => page.locator("#help kbd").allTextContents();
const mapTip = (page) => page.locator("span.tt:has(#rack-map-btn)");

test("off Apple platforms the ? card, the booth menu and the minimap's tooltip print Ctrl and Shift, never ⌘", async ({ page }) => {
  const errors = await boot(page, "Win32", "Windows");
  await page.keyboard.press("?");
  await expect(page.locator("#help")).toBeVisible();
  const keys = await helpKeys(page);
  for (const k of ["Ctrl Z", "Ctrl Shift Z", "Ctrl 0", "Ctrl −", "Ctrl ="]) expect(keys).toContain(k);
  expect(await page.locator("#help").textContent()).not.toMatch(/[⌘⇧⌥]/);
  await expect(page.locator("#booth-reset-btn kbd")).toHaveText("Shift Esc");
  await expect(mapTip(page)).toHaveAttribute("title", /Shift 1–9 jumps to one/);
  await expect(mapTip(page)).not.toHaveAttribute("title", /⇧/);
  expect(errors).toEqual([]);
});

test("on an Apple platform the same places print ⌘ and ⇧", async ({ page }) => {
  const errors = await boot(page, "MacIntel", "macOS");
  await page.keyboard.press("?");
  await expect(page.locator("#help")).toBeVisible();
  const keys = await helpKeys(page);
  for (const k of ["⌘Z", "⇧⌘Z", "⌘0", "⌘−", "⌘="]) expect(keys).toContain(k);
  expect(await page.locator("#help").textContent()).not.toMatch(/\bCtrl [Z0]/);
  await expect(page.locator("#booth-reset-btn kbd")).toHaveText("⇧Esc");
  await expect(mapTip(page)).toHaveAttribute("title", /⇧1–9 jumps to one/);
  expect(errors).toEqual([]);
});
