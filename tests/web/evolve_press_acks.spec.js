// EVOLVE: a press shows it was taken, and a waited ▶ starts as its sound
// arrives (#305, ADR-025).
//
// - ▶ on a side whose sound has not arrived was dimmed at the deal and looked
//   the same before and after the press. Pressed, it now wears the bank's
//   dotted ring (`.pending`) until it plays.
// - A waited ▶ polled for its sound every 100 ms (`awaitRender`), up to a
//   tenth of a second late. It now starts in the `render` reply's own task.
// - A pair a taken-back pick puts back asked for its sounds after a settle
//   delay (180 ms); it now asks in ⌘Z's own task, as a pair put up by a pick
//   or ↻ does (`placePair`).
//
// Each is the app's own order (ADR-022), read in the task that makes the
// press or lets the reply through: the render replies are held at the tap
// (`app.hold`) and released inside the same `page.evaluate` that reads the
// cards. How long a press's task took is a budget.
const { test, expect, goLevel } = require("./fixtures");

// Every phrase that starts sounding (its source's start()): what a player
// hears from a ▶.
const SOURCES = `(() => {
  const src = (window.__paSources = []);
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (...a) {
    src.push(performance.now());
    return start.apply(this, a);
  };
})();`;

async function boot(page, app) {
  await page.addInitScript(SOURCES);
  await app.boot({ random: 20261030 });
  await goLevel(page, "evolve");
  await app.engine((timeout) => expect(page.locator("#choose-a")).toBeEnabled({ timeout }), { ms: 60_000 });
}

const cardIds = (page) =>
  page.evaluate(() => ["a", "b"].map((s) => Number(document.querySelector(`#name-${s} .dn-id`).textContent.replace("#", ""))));

/** A pair on the table whose sounds main has not heard: every render reply
 *  is held from here, and ↻ deals on until the pair up is one whose renders
 *  were asked for after the hold (the pair dealt ahead had its sounds
 *  fetched already). Returns its ids. */
async function unheardPair(page, app) {
  await app.hold(["render"]);
  await expect(async () => {
    await page.locator("#skip-duel").click();
    await expect(page.locator("#choose-a")).toBeEnabled({ timeout: 30_000 });
    const ids = await cardIds(page);
    const heard = await page.evaluate((ids) => window.__tap.replies.some((r) => r.type === "render" && ids.includes(r.d.id)), ids);
    expect(heard, "a side of the pair on the table has its sound").toBe(false);
  }).toPass({ timeout: 120_000 });
  return cardIds(page);
}

/** A render reply for `id` is held at the tap. */
const heldFor = (page, id) =>
  expect.poll(() => page.evaluate((id) => window.__tap.held.some((h) => h.type === "render" && h.d.id === id), id), { timeout: 60_000 }).toBe(true);

/** Let the held replies through, and read the ▶ in the same task. */
const releaseAndRead = (page, sel) =>
  page.evaluate((sel) => {
    const b = document.querySelector(sel);
    const n0 = window.__paSources.length;
    window.__tap.release();
    return { playing: b.classList.contains("playing"), pending: b.classList.contains("pending"), started: window.__paSources.length - n0 };
  }, sel);

test("a duel side's ▶ pressed before its sound is here says so at the press, and sounds as the sound lands", async ({ page, app }) => {
  await boot(page, app);
  const [a, b] = await unheardPair(page, app);

  // By the mouse: the ring is on in the click's own task, where before the
  // press there was none.
  const pressA = await page.evaluate(() => {
    const btn = document.querySelector("#play-a");
    const before = getComputedStyle(btn).outlineStyle;
    const t0 = performance.now();
    btn.click();
    return { before, after: getComputedStyle(btn).outlineStyle, busy: btn.getAttribute("aria-busy"), ms: performance.now() - t0 };
  });
  expect(pressA.before, "▶ A wore the ring before it was pressed").not.toBe("dotted");
  expect(pressA.after, "▶ A pressed: the dotted ring in the press's task").toBe("dotted");
  expect(pressA.busy).toBe("true");
  app.budget("▶ on a side still rendering: the press → its ring", pressA.ms, 100);

  await app.engine(() => heldFor(page, a), { ms: 60_000 });
  const heardA = await releaseAndRead(page, "#play-a");
  expect(heardA.playing, "▶ A lit in the render reply's own task").toBe(true);
  expect(heardA.started, "▶ A's phrase started in the render reply's own task").toBe(1);
  expect(heardA.pending, "the ring is gone once the phrase starts").toBe(false);
  await page.locator("#play-a").click(); // stop it

  // By the keyboard (2 plays B), on another unheard pair.
  const [, b2] = await unheardPair(page, app);
  expect(b2).not.toBe(b);
  const pressB = await page.evaluate(() => {
    const btn = document.querySelector("#play-b");
    const before = getComputedStyle(btn).outlineStyle;
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "2", code: "Digit2", bubbles: true }));
    return { before, after: getComputedStyle(btn).outlineStyle };
  });
  expect(pressB.before).not.toBe("dotted");
  expect(pressB.after, "2 pressed: ▶ B's ring in the key's task").toBe("dotted");
  await app.engine(() => heldFor(page, b2), { ms: 60_000 });
  const heardB = await releaseAndRead(page, "#play-b");
  expect(heardB.playing, "▶ B lit in the render reply's own task").toBe(true);
  expect(heardB.started).toBe(1);
});

test("a pair a taken-back pick puts back asks for its sounds in ⌘Z's own task", async ({ page, app }) => {
  await boot(page, app);
  const pair = await unheardPair(page, app);
  // Picked, the next pair goes up (dealt now: nothing was dealt ahead of a
  // pair whose sounds are not here).
  await page.locator("#choose-a").click();
  await app.engine((timeout) => expect.poll(async () => (await cardIds(page)).join(), { timeout }).not.toBe(pair.join()), { ms: 30_000 });
  await app.engine((timeout) => expect(page.locator("#choose-a")).toBeEnabled({ timeout }), { ms: 30_000 });

  const back = await page.evaluate(() => {
    const n0 = window.__tap.sent.length;
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "z", code: "KeyZ", ctrlKey: true, metaKey: true, bubbles: true }));
    const ids = ["a", "b"].map((s) => Number(document.querySelector(`#name-${s} .dn-id`).textContent.replace("#", "")));
    return { ids, asked: window.__tap.sent.slice(n0).filter((q) => q.type === "render").map((q) => q.m.id) };
  });
  expect([...back.ids].sort(), "⌘Z put the pick's pair back").toEqual([...pair].sort());
  expect([...back.asked].sort(), "its sounds were asked for in ⌘Z's own task").toEqual([...pair].sort());
  await app.release();
});
