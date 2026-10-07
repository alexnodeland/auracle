// EVOLVE's deals while the pool fills (#211), and a deal that fails.
//
// The app hands the player a pair at eight sounds and fills the rest of the
// pool behind them. Each deal used to draw over however many sounds had
// joined by then, so the same seed dealt other pairs on a faster machine. Now
// the k-th deal of a session whose pool fills at boot draws only from the
// first 8·(k+1) sounds, in the order the seed's fill folds them in, and the
// worker holds a deal until they have joined (worker.js `dealsWaiting`). The
// worker's half is
// tests/worker/deal.test.mjs; here it is the page's: the same gestures on two
// boots of one seed, one dealt from a full pool and one held at its first
// eight sounds while ANOTHER PAIR asks for the next, show the same pairs.
//
// The hold is a gate on the fill, prefixed onto the engine worker
// (`FILL_GATE`), on a boot with no render farm (`?farm=0`), so the pool grows
// two sounds a step and stops there: a state reached by a gate the spec
// opens, never by a time (ADR-022).
//
// A deal the engine could not run used to turn the buttons back on over no
// pair. Now the cards say so and ANOTHER PAIR deals again.
const { test, expect, goLevel } = require("./fixtures");

const SEED = 20260928;
// How many pairs each boot shows: the deals that reach 8, 16, 24 and 32
// sounds. (That a deal from the whole pool waits for all of it is the
// worker's test.)
const PAIRS = 4;
const FAILED = "Couldn’t deal a pair. ANOTHER PAIR tries again.";

// Run in the engine worker ahead of worker.js. Once a `fill_progress` says
// the pool holds 8 sounds or more, and is not yet full, every timer of 0 ms
// waits until the spec posts `__fill_gate`: the serial fill's yield between
// steps (`yieldToQueue`) among them, so the fill stops where it is. So does
// every other yield: the `now` lane's before a background render (the
// table's sounds, asked for once the first pair is up), after which that
// lane serves nothing (`drainNow` is still draining), and the pump's. So
// while the gate is shut no request of the player's is served, a deal
// among them, whether or not the worker would hold it. What tells a deal
// that waits for its sounds from one drawn at once comes after the gate
// opens: it is answered only once 16 sounds have joined, and the pairs are
// the first boot's.
const FILL_GATE = `(() => {
  let shut = false;
  let opened = false;
  const later = [];
  const post = self.postMessage.bind(self);
  self.postMessage = (msg, transfer) => {
    if (!opened && msg && msg.type === "fill_progress" && msg.pool >= 8 && msg.pool < msg.target) shut = true;
    return post(msg, transfer);
  };
  const timeout = self.setTimeout.bind(self);
  self.setTimeout = (fn, ms, ...args) => {
    if (shut && !ms) {
      later.push(() => fn(...args));
      return 0;
    }
    return timeout(fn, ms, ...args);
  };
  self.addEventListener("message", (e) => {
    if (!e.data || e.data.type !== "__fill_gate") return;
    e.stopImmediatePropagation();
    opened = true;
    shut = false;
    for (const run of later.splice(0)) timeout(run, 0);
  });
})();
`;

/** The pair on the table, sorted, as a string (sides are shuffled). */
const tableKey = (page) =>
  page.evaluate(() =>
    ["a", "b"]
      .map((s) => Number(document.querySelector(`#name-${s} .dn-id`).textContent.replace("#", "")))
      .sort((x, y) => x - y)
      .join(),
  );

/** A pair on the table, live. */
const pairUp = (page, app) =>
  app.engine((timeout) => expect(page.locator("#choose-a")).toBeEnabled({ timeout }), { ms: 60_000 });

/** ANOTHER PAIR until `n` pairs have been shown, each once it is live: the
 *  pairs, in order. ↻ records nothing, so the next pair is the next deal. */
async function skipThrough(page, app, n, shown) {
  while (shown.length < n) {
    await page.locator("#skip-duel").click();
    await app.engine((timeout) => expect.poll(() => tableKey(page), { timeout }).not.toBe(shown.at(-1)), { ms: 60_000 });
    await pairUp(page, app);
    shown.push(await tableKey(page));
  }
  return shown;
}

// Two boots, the second filling serially: about 28 s on a 16-core M3 Max,
// so over 40 s on a CI runner.
test("the same seed deals the same pairs whether the pool had filled or was still filling when each was asked for", { tag: "@slow" }, async ({ page, app }) => {
  test.setTimeout(180_000);
  // Neither boot keeps a session, so the second starts afresh as the first did.
  await app.hold({ type: "saved" });

  // The pool full before any pair after the first is dealt.
  await app.boot({ seed: SEED, random: SEED });
  await app.filled();
  await goLevel(page, "evolve");
  await pairUp(page, app);
  const filled = await skipThrough(page, app, PAIRS, [await tableKey(page)]);

  // The same seed, the fill held at its first eight sounds.
  await app.boot({ seed: SEED, random: SEED, query: "?farm=0", workerPrefix: FILL_GATE });
  await goLevel(page, "evolve");
  await pairUp(page, app);
  const filling = [await tableKey(page)];
  const progress = await app.replies("fill_progress");
  const held = progress.at(-1).pool;
  expect(held, "the gate held the fill short of the second deal's 16 sounds").toBeLessThan(16);
  // eslint-disable-next-line playwright/prefer-to-have-count -- app.count is the tap's count, not a locator's
  expect(await app.count("filled"), "the pool filled past the gate").toBe(0);
  // ANOTHER PAIR puts the first pair away, and the table waits on the
  // second deal, which reaches 16 sounds: asked for by the click, or ahead
  // of it had the table's sounds been rendered. Either way one deal is out,
  // and it stays out while the gate is shut.
  const out = async () => (await app.unanswered({ types: ["duel"] })).length;
  await page.locator("#skip-duel").click();
  await expect(page.locator("#choose-a")).toBeDisabled();
  await expect.poll(out, { message: "the second deal was asked for" }).toBe(1);
  await app.quiet();
  expect(await out(), "a deal was answered with the fill held short of 16 sounds").toBe(1);
  // The fill goes on, and the deal is answered once its sounds have joined.
  await app.post({ type: "__fill_gate" });
  await pairUp(page, app);
  filling.push(await tableKey(page));
  // The pool as the last word on it before the deal came back said, in the
  // order main heard them (two messages can land in one millisecond).
  const log = await app.log();
  const answered = log.findLastIndex((e) => e.type === "duel");
  const before = log.slice(0, answered).filter((e) => e.type === "fill_progress").at(-1);
  expect(before.pool, "the second deal was answered before its 16 sounds had joined").toBeGreaterThanOrEqual(16);
  await skipThrough(page, app, PAIRS, filling);

  console.log(`pairs from the full pool: ${filled.join(" | ")}; from the filling pool: ${filling.join(" | ")}`);
  expect(filling).toEqual(filled);
});

test("a deal the engine could not run leaves the picks and ▶ off, says so, and ANOTHER PAIR deals again", async ({ page, app }) => {
  // The first deal, at boot, fails as the worker fails a request it could
  // not run.
  await app.fail({ type: "duel" }, { once: true });
  await app.boot();
  await goLevel(page, "evolve");
  await expect(page.locator("#duel-a .deal-why")).toHaveText(FAILED);
  await expect(page.locator("#duel-b .deal-why")).toHaveText(FAILED);
  for (const id of ["choose-a", "choose-b", "play-a", "play-b", "flip-a", "flip-b", "promote-a", "promote-b"]) {
    await expect(page.locator(`#${id}`), `#${id} is live over no pair`).toBeDisabled();
  }
  await expect(page.locator("#skip-duel")).toBeEnabled();
  // Nothing deals by itself, the pool filling included: ANOTHER PAIR is the
  // retry.
  await app.reply("filled");
  await app.quiet();
  expect(await app.sentCount("duel"), "a deal was asked for without ANOTHER PAIR").toBe(1);
  await expect(page.locator("#duel-a .deal-why")).toHaveText(FAILED);
  // N, ANOTHER PAIR's key, deals again, and the pair goes up live.
  await page.keyboard.press("n");
  await pairUp(page, app);
  expect(await app.sentCount("duel")).toBeGreaterThanOrEqual(2);
  await expect(page.locator("#duel-a .deal-why")).toBeHidden();
});
