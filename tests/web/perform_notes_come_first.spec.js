// On a machine with four threads or fewer, the engine worker's background
// work and the farm's step aside while notes sound (#288): the page says when
// the first note starts and the last one stops (`playing`, which the worker
// never answers), and the worker holds its background work back from then
// until a second after (tests/worker/playing.test.mjs holds the worker's
// half). This holds the page's half: a key held and let go says so once each,
// HOLD keeps the notes sounding until it is switched off, and a machine with
// threads to spare says nothing. The machine's threads are the page's
// `navigator.hardwareConcurrency`, set before main.js reads it.
const { test, expect, openKeys } = require("./fixtures");

const threads = (n) => `Object.defineProperty(navigator, "hardwareConcurrency", { get: () => ${n} });`;

/** Booted with `n` threads, and the live voice up. */
async function boot(page, app, n) {
  await page.addInitScript(threads(n));
  await app.boot();
  await app.liveUp();
}

const said = async (app) => (await app.sent({ type: "playing" })).map((m) => m.on);

test("on a four-thread machine, a note held says notes are sounding and its release says they stopped, once each", async ({ page, app }) => {
  await boot(page, app, 4);
  await page.keyboard.down("a");
  await expect.poll(() => said(app)).toEqual([true]);
  // A second key over the first: still sounding, nothing more said.
  await page.keyboard.down("s");
  await page.keyboard.up("a");
  await app.quiet();
  expect(await said(app)).toEqual([true]);
  await page.keyboard.up("s");
  await expect.poll(() => said(app)).toEqual([true, false]);
});

test("on a four-thread machine, HOLD keeps the notes sounding until it is switched off", async ({ page, app }) => {
  await boot(page, app, 4);
  // HOLD is in KEYS ⋯.
  await openKeys(page);
  const hold = page.locator("#hold-btn");
  await hold.click();
  await expect(hold).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.down("a");
  await page.keyboard.up("a");
  await app.quiet();
  expect(await said(app), "a latched note still sounds").toEqual([true]);
  await hold.click();
  await expect.poll(() => said(app)).toEqual([true, false]);
});

test("on a machine with threads to spare, playing says nothing to the engine", async ({ page, app }) => {
  await boot(page, app, 16);
  await page.keyboard.down("a");
  await page.keyboard.up("a");
  await app.quiet();
  expect(await app.sentCount("playing")).toBe(0);
});
