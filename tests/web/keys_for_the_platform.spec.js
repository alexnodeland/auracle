// The app prints each platform's own keys: ⌘, ⌥ and ⇧ on an Apple platform,
// Ctrl, Alt and Shift elsewhere.
//
// ⌘K's button and the keys ⌘K's list prints beside its commands (⌘Z, the
// levels' ⌥ digits, PATCH's camera keys and redo, booth mode's New visitor),
// and the minimap's tooltip, are written with the Mac's symbols, and were
// once printed ⌘Z on every platform, though the app takes Ctrl wherever it
// takes ⌘. www/brand/voice.md: "The app shows the platform's own." Off
// Apple platforms they read Ctrl Z, Ctrl Shift Z, Shift Esc, spelled as the
// guide spells them ("⌘K (Ctrl K)"); one helper (words.js `platformKeys`,
// unit-tested) writes every one, the list's as it draws them. The levels'
// stops carry their key in a tooltip written in the page (`title`, "Taste ·
// ⌥4"), which the app rewrites at boot with every other: off Apple platforms
// it reads Taste · Alt 4.
//
// The platform is set by replacing `navigator.platform` and
// `navigator.userAgentData` before the app runs, so the spec reads the same
// on a Mac and on CI's Linux. What it does not claim: what the keys do
// (evolve_truth.spec.js holds ⌘Z, and Ctrl Z is the same handler).
const { test, expect, goLevel, commandRow, runCommand } = require("./fixtures");

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

const mapTip = (page) => page.locator("span.tt:has(#rack-map-btn)");
const tasteStop = (page) => page.locator('.rail-stop[data-level="taste"]');

/** The keys ⌘K's list prints beside `label`. */
const keysOf = (page, label) => commandRow(page, label).locator(".cmdk-hint kbd");

/** ⌘K's keys, as the list prints them: at PERFORM, then PATCH, then with
 *  booth mode on; `keys` names what each should read. */
async function listKeys(page, keys) {
  await expect(page.locator("#cmdk-btn kbd")).toHaveText(keys.k);
  await page.keyboard.press("Control+k");
  await expect(page.locator("#cmdk")).toBeVisible();
  await expect(keysOf(page, "Take back your last pick or cut")).toHaveText(keys.z);
  await expect(keysOf(page, "PATCH: what the sound is made of")).toHaveText(keys.patch);
  await expect(keysOf(page, "Take the offer in B")).toHaveText(keys.take);
  await page.keyboard.press("Escape");
  await goLevel(page, "patch");
  await page.keyboard.press("Control+k");
  await expect(keysOf(page, "Actual size")).toHaveText(keys.actual);
  await expect(keysOf(page, "Zoom out on the patch")).toHaveText(keys.out);
  await expect(keysOf(page, "Zoom in on the patch")).toHaveText(keys.in);
  await expect(keysOf(page, "Redo an edit")).toHaveText(keys.redo);
  await page.keyboard.press("Escape");
  await runCommand(page, "Booth mode");
  await page.locator("#cmdk-btn").click();
  await expect(keysOf(page, "New visitor")).toHaveText(keys.visitor);
  return (await page.locator("#cmdk-list .cmdk-hint kbd").allTextContents()).join(" ");
}

test("off Apple platforms ⌘K's keys, booth mode's New visitor and the tooltips of the minimap and the levels print Ctrl, Alt and Shift, never ⌘ or ⌥", async ({ page, app }) => {
  await boot(page, app, "Win32", "Windows");
  await expect(page.locator("#cmdk-btn")).toHaveAttribute("title", "Find or do anything · Ctrl K");
  const all = await listKeys(page, {
    k: "Ctrl K", z: "Ctrl Z", patch: "Alt 2", take: "Shift ↵", actual: "Ctrl 0", out: "Ctrl −", in: "Ctrl =", redo: "Ctrl Shift Z", visitor: "Shift Esc",
  });
  expect(all).not.toMatch(/[⌘⇧⌥]/);
  await page.keyboard.press("Escape");
  await expect(mapTip(page)).toHaveAttribute("title", /Shift 1–9 jumps to one/);
  await expect(mapTip(page)).not.toHaveAttribute("title", /⇧/);
  await expect(tasteStop(page)).toHaveAttribute("title", "Taste · Alt 4");
});

test("on an Apple platform the same places print ⌘, ⌥ and ⇧", async ({ page, app }) => {
  await boot(page, app, "MacIntel", "macOS");
  await expect(page.locator("#cmdk-btn")).toHaveAttribute("title", "Find or do anything · ⌘K");
  const all = await listKeys(page, {
    k: "⌘K", z: "⌘Z", patch: "⌥2", take: "⇧↵", actual: "⌘0", out: "⌘−", in: "⌘=", redo: "⇧⌘Z", visitor: "⇧Esc",
  });
  expect(all).not.toMatch(/\bCtrl [Z0]/);
  await page.keyboard.press("Escape");
  await expect(mapTip(page)).toHaveAttribute("title", /⇧1–9 jumps to one/);
  await expect(tasteStop(page)).toHaveAttribute("title", "Taste · ⌥4");
});
