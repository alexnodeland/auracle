// The protections for a slow machine come on only when the audio is
// struggling (#288): main reads how far the audio clock falls behind the
// page's (`getOutputTimestamp`), and while it keeps falling behind it tells
// the worklet (`strain`: an offer in B rests at BLEND's home) and, while
// notes sound, the engine worker (`make_room`, never answered: background
// work steps aside). With headroom it says neither. This holds the page's
// half, on an audio clock the spec writes: one that falls half a second
// behind every second, and one that keeps time. The worklet's half is
// apps/web/tests/worklet-blend.test.mjs, the worker's
// tests/worker/room.test.mjs, and the rule over the samples
// apps/web/tests/strain.test.mjs.
const { test, expect, openKeys } = require("./fixtures");

/** The audio context's output timestamp on a clock of the spec's: running
 *  at `rate` of the page's (1: keeping time), and an underrun count that
 *  stays at 0, so the rule reads only the spec's clock: a loaded runner's own
 *  underruns (headless Chromium counts them) would otherwise switch the
 *  protections on in a test that says they stay off. And every message the
 *  page posts to the worklet, by type, in `window.__worklet`. */
const AUDIO = (rate) => `(() => {
  const t0 = performance.now();
  AudioContext.prototype.getOutputTimestamp = function () {
    const p = performance.now();
    return { contextTime: (t0 + (p - t0) * ${rate}) / 1000, performanceTime: p };
  };
  Object.defineProperty(AudioContext.prototype, "playbackStats", { configurable: true, get: () => ({ underrunEvents: 0 }) });
  const seen = (window.__worklet = []);
  const post = MessagePort.prototype.postMessage;
  MessagePort.prototype.postMessage = function (d, ...rest) {
    if (d && d.type === "strain") seen.push(d.on);
    return post.call(this, d, ...rest);
  };
})();`;

/** Booted with the audio clock at `rate`, and the live voice up. */
async function boot(page, app, rate) {
  await page.addInitScript(AUDIO(rate));
  await app.boot();
  await app.liveUp();
}

const room = async (app) => (await app.sent({ type: "make_room" })).map((m) => m.on);
const strained = (page) => page.evaluate(() => window.__worklet.slice());

test("when the audio clock falls behind, B is told to rest and a held note makes room, once each way", async ({ page, app }) => {
  await boot(page, app, 0.5);
  // A key starts the audio; the clock falls behind from then, and past the
  // audio's warm-up (strain.js) the protections come on.
  await page.keyboard.down("a");
  await expect(page.locator(".pkey.down, .bkey.down")).not.toHaveCount(0);
  await expect.poll(() => strained(page), { timeout: 20_000 }).toEqual([true]);
  await expect.poll(() => room(app)).toEqual([true]);
  // A second key over the first: still sounding, nothing more said.
  await page.keyboard.down("s");
  await page.keyboard.up("a");
  await app.quiet();
  expect(await room(app)).toEqual([true]);
  await page.keyboard.up("s");
  await expect.poll(() => room(app)).toEqual([true, false]);
  expect(await strained(page), "the protections stay on").toEqual([true]);
});

test("while the audio struggles, HOLD keeps room made until it is switched off", async ({ page, app }) => {
  await boot(page, app, 0.5);
  // HOLD is in KEYS ⋯.
  await openKeys(page);
  const hold = page.locator("#hold-btn");
  await hold.click();
  await expect(hold).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.down("a");
  await page.keyboard.up("a");
  await expect.poll(() => strained(page), { timeout: 20_000 }).toEqual([true]);
  await expect.poll(() => room(app)).toEqual([true]);
  await app.quiet();
  expect(await room(app), "a latched note still sounds").toEqual([true]);
  await hold.click();
  await expect.poll(() => room(app)).toEqual([true, false]);
});

test("with headroom, a note sounds, B is never told to rest, and nothing is said to the engine", async ({ page, app }) => {
  await boot(page, app, 1);
  await page.keyboard.down("a");
  await expect(page.locator(".pkey.down, .bkey.down")).not.toHaveCount(0);
  // Past the audio's warm-up, as long as the struggling clock took to tell.
  await app.quiet(6_000);
  expect(await strained(page)).toEqual([]);
  expect(await app.sentCount("make_room")).toBe(0);
  await page.keyboard.up("a");
});
