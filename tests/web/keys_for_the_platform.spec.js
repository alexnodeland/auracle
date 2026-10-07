// The app prints each platform's own keys: ⌘, ⌥ and ⇧ on an Apple platform,
// Ctrl, Alt and Shift elsewhere.
//
// The ? card, the booth menu's New visitor and the minimap's tooltip are
// written with the Mac's symbols, and printed ⌘Z on every platform, though
// the app takes Ctrl wherever it takes ⌘. www/brand/voice.md: "The app shows
// the platform's own." Off Apple platforms they read Ctrl Z, Ctrl Shift Z,
// Shift Esc, spelled as the guide spells them ("⌘K (Ctrl K)"); one helper
// (words.js `platformKeys`, unit-tested) writes every one. The levels' stops
// carry their key in a tooltip written in the page (`title`, "Taste · ⌥4"),
// which the app rewrites at boot with every other: off Apple platforms it
// reads Taste · Alt 4.
//
// The platform is set by replacing `navigator.platform` and
// `navigator.userAgentData` before the app runs, so the spec reads the same
// on a Mac and on CI's Linux. What it does not claim: what the keys do
// (evolve_truth.spec.js holds ⌘Z, and Ctrl Z is the same handler).
const { test, expect } = require("./fixtures");

const as = (platform, uaPlatform) => `(() => {
  Object.defineProperty(Navigator.prototype, "platform", { configurable: true, get: () => ${JSON.stringify(platform)} });
  Object.defineProperty(Navigator.prototype, "userAgentData", { configurable: true, get: () => ({ platform: ${JSON.stringify(uaPlatform)}, mobile: false, brands: [] }) });
})();`;

/** Boot as the platform says it is: seeded, the warm start and the tours
 *  seen (the fixture's `app.boot`). */
async function boot(page, app, platform, uaPlatform) {
  await page.addInitScript(as(platform, uaPlatform));
  await app.boot();
}

const helpKeys = (page) => page.locator("#help kbd").allTextContents();
const mapTip = (page) => page.locator("span.tt:has(#rack-map-btn)");
const tasteStop = (page) => page.locator('.rail-stop[data-level="taste"]');

test("off Apple platforms the ? card, the booth menu and the tooltips of the minimap and the levels print Ctrl, Alt and Shift, never ⌘ or ⌥", async ({ page, app }) => {
  await boot(page, app, "Win32", "Windows");
  await page.keyboard.press("?");
  await expect(page.locator("#help")).toBeVisible();
  const keys = await helpKeys(page);
  for (const k of ["Ctrl Z", "Ctrl Shift Z", "Ctrl 0", "Ctrl −", "Ctrl ="]) expect(keys).toContain(k);
  expect(await page.locator("#help").textContent()).not.toMatch(/[⌘⇧⌥]/);
  await expect(page.locator("#booth-reset-btn kbd")).toHaveText("Shift Esc");
  await expect(mapTip(page)).toHaveAttribute("title", /Shift 1–9 jumps to one/);
  await expect(mapTip(page)).not.toHaveAttribute("title", /⇧/);
  await expect(tasteStop(page)).toHaveAttribute("title", "Taste · Alt 4");
});

test("on an Apple platform the same places print ⌘, ⌥ and ⇧", async ({ page, app }) => {
  await boot(page, app, "MacIntel", "macOS");
  await page.keyboard.press("?");
  await expect(page.locator("#help")).toBeVisible();
  const keys = await helpKeys(page);
  for (const k of ["⌘Z", "⇧⌘Z", "⌘0", "⌘−", "⌘="]) expect(keys).toContain(k);
  expect(await page.locator("#help").textContent()).not.toMatch(/\bCtrl [Z0]/);
  await expect(page.locator("#booth-reset-btn kbd")).toHaveText("⇧Esc");
  await expect(mapTip(page)).toHaveAttribute("title", /⇧1–9 jumps to one/);
  await expect(tasteStop(page)).toHaveAttribute("title", "Taste · ⌥4");
});
