// The circuit shows what PERFORM is playing.
//
// PATCH draws the kept patch; until Keep, PERFORM's moves live only in the
// voices. A knob PERFORM is playing away from its kept value carries an amber
// pointer at the sounding value, and its readout says that value: turn Bright
// on First Bass, open PATCH, and the ladder's cutoff is visibly performed.
const { test, expect, PERFORM_SEED } = require("./fixtures");

test("a knob turned in PERFORM is drawn performed in PATCH", async ({ page, app }) => {
  await app.boot({ seed: PERFORM_SEED, random: PERFORM_SEED });
  // Until PERFORM names the preset, "controls reach" may be the previous
  // patch's (the first pool patch lands on the bench at boot).
  await app.openOnPerform("First Bass");
  const box = await page.locator(".pf-knob").nth(0).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - i * 9);
  await page.mouse.up();
  await app.level("patch");
  // The ghosts land when PATCH draws the rack: waited for, not counted after
  // a fixed time, which a slow runner outran (#159).
  await app.engine((timeout) => expect(page.locator("#rack-svg .knob-ghost")).not.toHaveCount(0, { timeout }), { ms: 30_000 });
  await expect(page.locator("#rack-svg g.performed[data-addr=\"node#cut\"] .knob-value")).toHaveText(/kHz|Hz/);
});

// Velocity plays a control (ARRANGE's "Velocity plays", Bright by default,
// which reaches First Bass's cutoff): each note writes its own offset on the
// knobs at note-on, and PATCH draws the last struck held note's. A soft note
// and a hard one read two values on the cutoff, and letting go folds it back.
// A MIDI device is stood in for by replacing navigator.requestMIDIAccess.
const FAKE_MIDI = `(() => {
  const input = { id: "pw", name: "Test keys", manufacturer: "", state: "connected", onmidimessage: null };
  const access = { inputs: new Map([["pw", input]]), outputs: new Map(), onstatechange: null, sysexEnabled: false };
  Object.defineProperty(navigator, "requestMIDIAccess", { configurable: true, value: () => Promise.resolve(access) });
  window.__midi = (bytes) => input.onmidimessage && input.onmidimessage({ data: new Uint8Array(bytes), timeStamp: performance.now() });
})();`;

test("a knob velocity plays is drawn performed in PATCH at the note's velocity", async ({ page, app }) => {
  await page.addInitScript(FAKE_MIDI);
  await app.boot({ seed: PERFORM_SEED, random: PERFORM_SEED });
  await app.openOnPerform("First Bass");
  await app.level("patch");
  const cut = page.locator('#rack-svg g[data-addr="node#cut"]');
  await expect(cut.locator(".knob-hit")).toBeVisible();
  await expect(cut).not.toHaveClass(/\bperformed\b/);
  const played = async () => {
    await expect(cut).toHaveClass(/\bperformed\b/, { timeout: 5_000 });
    const t = await cut.locator(".knob-ghost > title").textContent();
    expect(t).toContain("velocity");
    return { pct: Number(/Playing at (\d+)%/.exec(t)[1]), text: await cut.locator(".knob-value").textContent() };
  };
  await page.evaluate(() => window.__midi([0x90, 48, 40]));
  const soft = await played();
  await page.evaluate(() => window.__midi([0x80, 48, 0]));
  await expect(cut).not.toHaveClass(/\bperformed\b/, { timeout: 5_000 });
  await page.evaluate(() => window.__midi([0x90, 48, 120]));
  const hard = await played();
  await page.evaluate(() => window.__midi([0x80, 48, 0]));
  await expect(cut).not.toHaveClass(/\bperformed\b/, { timeout: 5_000 });
  expect(hard.pct, "a hard note and a soft one play the cutoff apart").not.toBe(soft.pct);
  expect(hard.text).not.toBe(soft.text);
});

// Under the arp each step re-presses the voice, which plays the note's
// velocity offset again on the knob's new value (live.rs `press`): a turn of
// the knob does not take velocity's pointer away while the note is held.
test("under the arp a knob turned under a held note keeps velocity's pointer", async ({ page, app }) => {
  await page.addInitScript(FAKE_MIDI);
  await app.boot({ seed: PERFORM_SEED, random: PERFORM_SEED });
  await app.openOnPerform("First Bass");
  await page.evaluate(() => document.getElementById("arp-btn").click());
  await expect(page.locator("#arp-btn")).toHaveAttribute("aria-pressed", "true");
  await app.level("patch");
  const cut = page.locator('#rack-svg g[data-addr="node#cut"]');
  await expect(cut.locator(".knob-hit")).toBeVisible();
  await page.evaluate(() => window.__midi([0x90, 48, 120]));
  // The velocity pointer's value, or null when none is drawn.
  const ghostPct = () => page.evaluate(() => {
    const g = document.querySelector('#rack-svg g[data-addr="node#cut"]');
    const t = g && g.classList.contains("performed") && g.querySelector(".knob-ghost > title");
    const m = t && /Playing at (\d+)% in PERFORM \(velocity\)/.exec(t.textContent);
    return m ? Number(m[1]) : null;
  });
  await expect.poll(ghostPct, { timeout: 5_000 }).not.toBeNull();
  const before = await ghostPct();
  await cut.focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowDown");
  // The pointer follows the knob down, still velocity's: the note plays its
  // offset on the new value. Without the arp's exception it went away.
  await expect.poll(ghostPct, { timeout: 5_000 }).toBeLessThan(before);
  await page.evaluate(() => window.__midi([0x80, 48, 0]));
  await expect(cut).not.toHaveClass(/\bperformed\b/, { timeout: 5_000 });
});
