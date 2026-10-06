// A MIDI knob that takes one of PERFORM's controls is announced in a sentence.
//
// With the panel's switch on, the first knobs turned claim the free controls
// in order (BRIGHT first), and LEARN binds a knob to the row the player chose.
// Each says so in a toast, and a later one replaces the earlier. They used to
// be lowercase fragments with an arrow (`mapped: CC 74 → Bright`, `learned:
// CC 21 → Snap`); a toast is a sentence (www/brand/voice.md).
//
// A MIDI device is stood in for by replacing navigator.requestMIDIAccess
// before the app runs, with one input the spec sends control changes from
// (as perform_recentre.spec.js does). What it does not claim: what the knob
// then does to the sound (perform_recentre.spec.js and the guide's MIDI
// section).
const { test, expect } = require("./fixtures");

const INIT = `(() => {
  const input = { id: "pw", name: "Test pot", manufacturer: "", state: "connected", onmidimessage: null };
  const access = { inputs: new Map([["pw", input]]), outputs: new Map(), onstatechange: null, sysexEnabled: false };
  Object.defineProperty(navigator, "requestMIDIAccess", { configurable: true, value: () => Promise.resolve(access) });
  window.__cc = (cc, v) => input.onmidimessage && input.onmidimessage({ data: new Uint8Array([0xb0, cc, v]), timeStamp: performance.now() });
})();`;

test("a MIDI knob that claims or learns a control is announced in a sentence", async ({ page, app }) => {
  await page.addInitScript(INIT);
  await app.boot();
  await expect(page.locator("#midi-ind")).toContainText("●", { timeout: 15_000 });
  const toast = page.locator("#toasts .toast-msg");

  // A knob turned with nothing mapped claims the first free control.
  await page.evaluate(() => window.__cc(74, 64));
  await expect(toast.filter({ hasText: "CC 74" })).toHaveText("CC 74 now moves Bright, the first free control.", { timeout: 10_000 });
  await page.locator("#midi-ind").click();
  await expect(page.locator("#midi-panel .midi-row").nth(0)).toContainText("CC 74");

  // LEARN on SNAP's row, then a knob: it takes SNAP, and its toast replaces
  // the last one rather than queueing behind it.
  await page.locator("#midi-panel .midi-row").nth(1).locator("button", { hasText: "learn" }).click();
  await page.evaluate(() => window.__cc(21, 30));
  await expect(page.locator("#midi-panel .midi-row").nth(1)).toContainText("CC 21");
  await expect(toast.filter({ hasText: "CC 21" })).toHaveText("CC 21 now moves Snap.", { timeout: 10_000 });
  await expect(toast.filter({ hasText: "CC 74" })).toHaveCount(0);
});
